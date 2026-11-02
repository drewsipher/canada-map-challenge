// canada-map-challenge.js
// "Canada Map Challenge": a timed visual quiz on Canada's provinces,
// territories and capitals (grade 4 level). One self-contained web component
// (<canada-map-challenge>), no dependencies.
// - Find It: a name appears, tap that province on the map
// - Name It: a province glows, pick its name
// - Capitals: a province glows, pick its capital city
// - Explore: tap around the map to learn (no clock)
// Score = time taken (+3 s per wrong answer). Lower is better.
// High scores are kept in this browser's localStorage. Inside Home Assistant
// (as a Lovelace card) they go to input_text helpers instead if those exist,
// so every device shares them.
//
// Web page: <script src="canada-map-challenge.js"></script><canada-map-challenge></canada-map-challenge>
// Home Assistant: add this file as a module resource, then use
//   { "type": "custom:canada-map-challenge" } in a panel view.
// Built by tools/build.py from src/.

const VERSION = "1.0.0";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const LB_ENTITIES = {
  find: "input_text.canada_map_challenge_find",
  name: "input_text.canada_map_challenge_name",
  capitals: "input_text.canada_map_challenge_capitals",
};
const LB_SIZE = 8;
const PENALTY = 5; // seconds added for the first wrong answer on a question
const PENALTY_STEP = 3; // each extra wrong guess on the same question costs this much more (5, 8, 11…)
const FREEZE_MS = 1000; // after a wrong guess, taps are ignored this long while the clock keeps running
const MAX_TRIES = 3; // Find It: wrong taps before the answer is shown

const MODES = {
  find: { icon: "🗺️", title: "Find It", blurb: "Tap the province on the map", stars: [35, 55, 90] },
  name: { icon: "🏷️", title: "Name It", blurb: "Which one is glowing?", stars: [30, 45, 75] },
  capitals: { icon: "⭐", title: "Capitals", blurb: "Pick the capital city", stars: [35, 55, 90] },
};

// Ranks by star count (3 stars first)
const RANKS = [
  ["⚡", "Lightning Lynx"],
  ["🦫", "Busy Beaver"],
  ["🫎", "Mighty Moose"],
  ["🐻", "Brave Bear"],
];

// [name, short name, capital, territory?, colour, fun fact, tricky wrong capital]
const PROV = {
  BC: ["British Columbia", "B.C.", "Victoria", false, "#26c6da",
    "B.C. is on the Pacific Ocean and has giant rainforest trees older than castles!", "Vancouver"],
  AB: ["Alberta", "Alberta", "Edmonton", false, "#ff8a3d",
    "Alberta has the Rocky Mountains and LOTS of dinosaur fossils.", "Calgary"],
  SK: ["Saskatchewan", "Sask.", "Regina", false, "#c6e04a",
    "Saskatchewan is almost a perfect rectangle and grows tons of wheat.", "Saskatoon"],
  MB: ["Manitoba", "Manitoba", "Winnipeg", false, "#ff5d8f",
    "Manitoba has about 100,000 lakes, and polar bears visit the town of Churchill!", "Brandon"],
  ON: ["Ontario", "Ontario", "Toronto", false, "#4d96ff",
    "More Canadians live in Ontario than anywhere else, and Niagara Falls is here too!", "Ottawa"],
  QC: ["Quebec", "Quebec", "Quebec City", false, "#9b5de5",
    "Quebec is the biggest province, and most people there speak French.", "Montreal"],
  NB: ["New Brunswick", "N.B.", "Fredericton", false, "#2ec4b6",
    "New Brunswick is the only province with two official languages: English and French.", "Moncton"],
  NS: ["Nova Scotia", "N.S.", "Halifax", false, "#f15bb5",
    "Nova Scotia is almost an island. Nowhere there is more than 67 km from the ocean!", "Sydney"],
  PE: ["Prince Edward Island", "P.E.I.", "Charlottetown", false, "#ff4d4d",
    "P.E.I. is the smallest province. It has red sand beaches and grows lots of potatoes!", "Summerside"],
  NL: ["Newfoundland and Labrador", "N.L.", "St. John's", false, "#00bbf9",
    "In spring you can watch giant icebergs float past Newfoundland!", "Corner Brook"],
  YT: ["Yukon", "Yukon", "Whitehorse", true, "#7bd389",
    "Yukon is famous for the Klondike Gold Rush, when people raced north to find gold.", "Dawson City"],
  NT: ["Northwest Territories", "N.W.T.", "Yellowknife", true, "#f8961e",
    "The Northwest Territories is one of the best places on Earth to see the northern lights.", "Inuvik"],
  NU: ["Nunavut", "Nunavut", "Iqaluit", true, "#a0c4ff",
    "Nunavut is Canada's newest and biggest territory. It became a territory in 1999!", "Rankin Inlet"],
};
const IDS = Object.keys(PROV);

const PRAISE = ["Nice!", "Yes!", "Great!", "Correct!", "Super!", "You got it!", "Awesome!"];

const MAP = /*MAP_JSON*/;

// Zoom circle out in the north-east ocean, showing the Maritimes up close so
// little P.E.I. is easy to tap. Map points (fx, fy) are drawn k times bigger
// at the circle's centre (x, y).
const INSET = { x: 898, y: 200, r: 116, fx: 882, fy: 693, k: 4.8, ids: ["QC", "NB", "NS", "PE", "NL"] };
const toInset = (x, y) => [INSET.x + (x - INSET.fx) * INSET.k, INSET.y + (y - INSET.fy) * INSET.k];

// ─── helpers ───────────────────────────────────────────────────────────────
const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (s) => `${s.toFixed(1)}s`;
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const today = () => {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const prettyDate = (s) => {
  if (!/^\d{6}$/.test(s || "")) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+s.slice(2, 4) - 1];
  return `${m} ${+s.slice(4)}`;
};
const cleanName = (s) => (s || "").replace(/[~|]/g, "").trim().slice(0, 12) || "Player";

// Leaderboard text format (fits a 255-char input_text): name~seconds~yymmdd|...
const lbParse = (txt) => (txt || "").split("|").map((r) => {
  const [n, t, d] = r.split("~");
  return { n, t: parseFloat(t), d };
}).filter((e) => e.n && isFinite(e.t)).sort((a, b) => a.t - b.t).slice(0, LB_SIZE);
const lbFormat = (list) => {
  let rows = list.slice(0, LB_SIZE).map((e) => `${e.n}~${e.t.toFixed(1)}~${e.d}`);
  while (rows.join("|").length > 255) rows.pop();
  return rows.join("|");
};

// ─── sound (Web Audio, no files) ───────────────────────────────────────────
class Sfx {
  constructor() { this.on = ls.get("cmc_sound", "1") === "1"; this.ctx = null; }
  wake() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }
  tone(freq, at, dur, type = "sine", vol = 0.18, slideTo = null) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  correct(streak) {
    const base = 523 * Math.pow(2, Math.min(streak, 10) / 12); // climbs with the streak
    this.tone(base, 0, 0.12, "triangle");
    this.tone(base * 1.5, 0.08, 0.22, "triangle");
    if (streak >= 3) this.tone(base * 2, 0.16, 0.25, "sine", 0.12);
  }
  wrong() { this.tone(180, 0, 0.3, "sawtooth", 0.12, 90); }
  tick() { this.tone(660, 0, 0.12, "square", 0.08); }
  go() { this.tone(990, 0, 0.35, "square", 0.1); this.tone(1320, 0.05, 0.3, "triangle", 0.1); }
  fanfare(big) {
    const notes = big ? [523, 659, 784, 1047, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, i * 0.11, 0.25, "triangle", 0.16));
    const end = notes.length * 0.11;
    [523, 659, 784].forEach((f) => this.tone(f * (big ? 2 : 1), end, 0.7, "sine", 0.09));
  }
  pop() { this.tone(880, 0, 0.08, "sine", 0.1, 1320); }
}

// ─── card ──────────────────────────────────────────────────────────────────
class CanadaMapChallenge extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.sfx = new Sfx();
    this.s = { screen: "menu" };
    this._built = false;
    this._lbCache = {};
  }

  setConfig(config) {
    this._config = config || {};
  }

  getCardSize() {
    return 12;
  }

  connectedCallback() {
    // Standalone web page: no hass object will ever arrive, so start now
    if (!this._built) this._init();
  }

  _init() {
    this._build();
    this._built = true;
    this._showMenu();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) return this._init();
    // Another device may have posted a score: refresh the visible numbers only
    // (never re-render mid-game or while someone is typing a name).
    const sig = Object.values(LB_ENTITIES).map((e) => hass.states[e]?.state).join("¦");
    if (sig !== this._lbSig) {
      this._lbSig = sig;
      if (this.s.screen === "menu") this._refreshBests();
      if (this.s.screen === "board") this._showBoard(this.s.boardMode);
    }
  }

  // ── leaderboard storage ──────────────────────────────────────────────────
  _lbGet(mode) {
    const st = this._hass?.states[LB_ENTITIES[mode]];
    if (st && st.state !== "unknown" && st.state !== "unavailable") {
      const list = lbParse(st.state);
      // Keep our just-saved copy until HA echoes it back
      const mine = this._lbCache[mode];
      if (mine && lbFormat(mine) !== lbFormat(list) && Date.now() - (this._lbCacheAt?.[mode] || 0) < 5000) return mine;
      return list;
    }
    return lbParse(ls.get(`cmc_lb_${mode}`, ""));
  }

  _lbAdd(mode, entry) {
    const list = this._lbGet(mode).concat([entry]).sort((a, b) => a.t - b.t);
    const rank = list.indexOf(entry) + 1;
    const kept = list.slice(0, LB_SIZE);
    const txt = lbFormat(kept);
    ls.set(`cmc_lb_${mode}`, txt);
    this._lbCache[mode] = lbParse(txt);
    this._lbCacheAt = { ...(this._lbCacheAt || {}), [mode]: Date.now() };
    if (this._hass?.states[LB_ENTITIES[mode]]) {
      this._hass.callService("input_text", "set_value", { entity_id: LB_ENTITIES[mode], value: txt })
        .catch((e) => console.warn("canada-map-challenge: could not save score", e));
    }
    return rank <= LB_SIZE ? rank : 0;
  }

  // ── DOM skeleton ─────────────────────────────────────────────────────────
  _build() {
    const paths = IDS.map((id) => `<path class="prov" data-id="${id}" d="${MAP.p[id].d}"/>`).join("");
    const I = INSET;
    const zoomPaths = I.ids.map((id) => `<path class="prov" data-id="${id}" d="${MAP.p[id].d}"/>`).join("");
    // Leader line from P.E.I. to the bottom of the zoom circle
    const pe = MAP.p.PE;
    const ang = Math.atan2(pe.cy - I.y, pe.cx - I.x);
    const lx = I.x + Math.cos(ang) * I.r, ly = I.y + Math.sin(ang) * I.r;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="wrap" id="wrap">
          <header>
            <div class="aurora"></div>
            <div class="title"><span class="leaf">🍁</span> Canada Map Challenge</div>
            <div class="hbtns">
              <button class="hbtn" data-act="board" title="High scores">🏆</button>
              <button class="hbtn" data-act="sound" id="soundBtn" title="Sound">${this.sfx.on ? "🔊" : "🔇"}</button>
            </div>
          </header>
          <main id="main">
            <section class="top" id="top"></section>
            <section class="mapbox" id="mapbox">
              <svg id="map" viewBox="0 0 ${MAP.w} ${MAP.h}" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <radialGradient id="sea" cx="50%" cy="40%" r="75%">
                    <stop offset="0" stop-color="#1b5f8c"/><stop offset="1" stop-color="#0a2b48"/>
                  </radialGradient>
                  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="6" result="b"/>
                    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>
                <rect class="sea" x="0" y="0" width="${MAP.w}" height="${MAP.h}" rx="18"/>
                <g id="provs">${paths}</g>
                <g class="zoom">
                  <clipPath id="zoomClip"><circle cx="${I.x}" cy="${I.y}" r="${I.r}"/></clipPath>
                  <line class="leader" x1="${pe.cx}" y1="${pe.cy}" x2="${lx}" y2="${ly}"/>
                  <circle class="leaderdot" cx="${pe.cx}" cy="${pe.cy}" r="16"/>
                  <circle class="zoombg" cx="${I.x}" cy="${I.y}" r="${I.r}"/>
                  <g clip-path="url(#zoomClip)">
                    <g class="zoomed" transform="translate(${I.x} ${I.y}) scale(${I.k}) translate(${-I.fx} ${-I.fy})">${zoomPaths}</g>
                    <g id="zoommarks"></g>
                  </g>
                  <circle class="zoomring" cx="${I.x}" cy="${I.y}" r="${I.r}"/>
                  <text class="zoomlbl" x="${I.x}" y="${I.y - I.r - 10}" text-anchor="middle">🔍 Zoom</text>
                </g>
                <g id="marks"></g>
              </svg>
              <div class="overlay" id="overlay"></div>
            </section>
            <section class="bottom" id="bottom"></section>
          </main>
          <div class="fx" id="fx"></div>
          <canvas class="confetti" id="confetti"></canvas>
        </div>
      </ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this.$ = $;
    $("map").addEventListener("pointerdown", (e) => {
      const el = e.target.closest("[data-id]");
      if (el) this._onMapTap(el.dataset.id, e);
    });
    this.shadowRoot.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b && !b.disabled) this._onAction(b.dataset.act, b, e);
    });
    // Two-column layout when there's room for it
    this._ro = new ResizeObserver(([entry]) => {
      $("wrap").classList.toggle("wide", entry.contentRect.width >= 760);
    });
    this._ro.observe($("wrap"));
  }

  // A province can be drawn twice (main map + zoom circle); style both together
  _provEls(id) { return this.$("map").querySelectorAll(`.prov[data-id="${id}"]`); }

  _resetMap(colored = false) {
    this.$("marks").innerHTML = "";
    IDS.forEach((id, i) => {
      this._provEls(id).forEach((p) => {
        p.setAttribute("class", "prov" + (colored ? " shown wave" : ""));
        p.style.fill = colored ? PROV[id][4] : "";
        p.style.animationDelay = colored ? `${i * 70}ms` : "";
      });
    });
  }

  _colorIn(id, cls = "found") {
    this._provEls(id).forEach((p) => {
      p.style.fill = PROV[id][4];
      p.setAttribute("class", `prov shown ${cls}`);
    });
  }

  _setTarget(id) {
    IDS.forEach((k) => this._provEls(k).forEach((p) => p.classList.remove("target")));
    this.$("map").querySelectorAll(".ping").forEach((n) => n.remove());
    if (!id) return;
    this._provEls(id).forEach((p) => p.classList.add("target"));
    const { cx, cy } = MAP.p[id];
    const rings = (x, y) => `<circle class="ping" cx="${x}" cy="${y}" r="10"/><circle class="ping p2" cx="${x}" cy="${y}" r="10"/>`;
    // Radar rings so even tiny P.E.I. is easy to spot (and again in the zoom circle)
    this.$("marks").insertAdjacentHTML("beforeend", rings(cx, cy));
    if (["NB", "NS", "PE"].includes(id)) this.$("zoommarks").insertAdjacentHTML("beforeend", rings(...toInset(cx, cy)));
  }

  _addCapital(id, label) {
    const [x, y] = MAP.caps[id];
    const anchor = x > MAP.w - 160 ? "end" : x < 120 ? "start" : "middle";
    this.$("marks").insertAdjacentHTML("beforeend", `
      <g class="cap">
        <text class="star" x="${x}" y="${y + 9}" text-anchor="middle">★</text>
        <text class="caplbl" x="${x}" y="${y - 16}" text-anchor="${anchor}">${esc(label)}</text>
      </g>`);
  }

  // svg coords -> coords inside the card wrapper (for HTML effects)
  _svgToWrap(x, y) {
    const svg = this.$("map");
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    const c = pt.matrixTransform(svg.getScreenCTM());
    const r = this.$("wrap").getBoundingClientRect();
    return [c.x - r.left, c.y - r.top];
  }
  _clientToWrap(cx, cy) {
    const r = this.$("wrap").getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  }
  _elCenter(el) {
    const b = el.getBoundingClientRect();
    return this._clientToWrap(b.left + b.width / 2, b.top + b.height / 2);
  }

  // ── effects ──────────────────────────────────────────────────────────────
  _float([x, y], text, cls = "") {
    const el = document.createElement("div");
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.$("fx").appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  _burst([x, y], n = 10, chars = ["🍁"]) {
    const fx = this.$("fx");
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "bit";
      el.textContent = pick(chars);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      fx.appendChild(el);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const d = 50 + Math.random() * 70;
      el.animate([
        { transform: "translate(-50%,-50%) scale(.4) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 30}px)) scale(1.1) rotate(${(Math.random() - 0.5) * 540}deg)`, opacity: 0 },
      ], { duration: 750 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => el.remove();
    }
  }

  _confetti(seconds = 3) {
    const cv = this.$("confetti");
    const wrap = this.$("wrap");
    const W = (cv.width = wrap.clientWidth);
    const H = (cv.height = wrap.clientHeight);
    const ctx = cv.getContext("2d");
    const cols = ["#ff4d4d", "#ffd23f", "#26c6da", "#9b5de5", "#7bd389", "#ff8a3d", "#ffffff", "#f15bb5"];
    const parts = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: pick(cols), leaf: Math.random() < 0.15,
    }));
    const end = performance.now() + seconds * 1000;
    cancelAnimationFrame(this._confRaf);
    const step = (now) => {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        if (p.leaf) { ctx.font = `${p.s * 2.4}px serif`; ctx.fillText("🍁", -p.s, p.s); }
        else { ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
        ctx.restore();
      });
      if (now < end) this._confRaf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    };
    this._confRaf = requestAnimationFrame(step);
  }

  _shake(el) {
    el?.animate([
      { transform: "translateX(0)" }, { transform: "translateX(-9px)" }, { transform: "translateX(8px)" },
      { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" },
    ], { duration: 380 });
  }

  // ── actions ──────────────────────────────────────────────────────────────
  _onAction(act, el, e) {
    this.sfx.wake();
    if (act === "sound") {
      this.sfx.on = !this.sfx.on;
      ls.set("cmc_sound", this.sfx.on ? "1" : "0");
      this.$("soundBtn").textContent = this.sfx.on ? "🔊" : "🔇";
      if (this.sfx.on) this.sfx.pop();
    } else if (act === "board") {
      if (this._inGame()) return;
      this._showBoard(this.s.mode || "find");
    } else if (act === "tab") {
      this.sfx.pop();
      this._showBoard(el.dataset.mode);
    } else if (act === "menu") {
      this._stopGame();
      this._showMenu();
    } else if (act === "start") {
      this._start(el.dataset.mode);
    } else if (act === "again") {
      this._start(this.s.mode);
    } else if (act === "explore") {
      this._showExplore();
    } else if (act === "answer") {
      this._onChoice(el.dataset.val, el);
    }
  }

  _inGame() { return this.s.screen === "play" || this.s.screen === "countdown"; }

  _stopGame() {
    cancelAnimationFrame(this._clockRaf);
    clearTimeout(this._nextT);
    (this._cdTimers || []).forEach(clearTimeout);
    clearTimeout(this._freezeT);
    this.$("wrap").classList.remove("frozen");
    this.$("overlay").innerHTML = "";
  }

  // ── menu ─────────────────────────────────────────────────────────────────
  _player() {
    return cleanName(ls.get("cmc_player", this._config?.player || "Player"));
  }

  _showMenu() {
    this.s = { screen: "menu" };
    this.$("wrap").dataset.screen = "menu";
    this._resetMap(true);
    this._setTarget(null);
    this.$("top").innerHTML = `
      <div class="hello">
        <div class="big">Ready, explorer?</div>
        <label class="player">Player
          <input id="player" maxlength="12" value="${esc(this._player())}" autocomplete="off" spellcheck="false">
        </label>
        <div class="hint">Be quick! Your <b>time</b> is your score. An oops adds <b>+${PENALTY}s</b>, more each time you guess wrong again, and freezes you for a second. No wild guessing! 🥶</div>
      </div>`;
    this.$("bottom").innerHTML = `
      <div class="modes">
        ${Object.entries(MODES).map(([k, m]) => `
          <button class="mode" data-act="start" data-mode="${k}">
            <span class="micon">${m.icon}</span>
            <span class="mtext"><b>${m.title}</b><small>${m.blurb}</small></span>
            <span class="mbest" data-best="${k}"></span>
          </button>`).join("")}
        <button class="mode explore" data-act="explore">
          <span class="micon">🔎</span>
          <span class="mtext"><b>Explore</b><small>Tap the map to learn. No clock!</small></span>
        </button>
      </div>`;
    const inp = this.$("player");
    // Keep HA's keyboard shortcuts (e, c, m, a…) from firing while typing a name
    ["keydown", "keyup", "keypress"].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("input", () => ls.set("cmc_player", inp.value));
    inp.addEventListener("change", () => { inp.value = cleanName(inp.value); ls.set("cmc_player", inp.value); });
    this._refreshBests();
  }

  _refreshBests() {
    Object.keys(MODES).forEach((k) => {
      const el = this.shadowRoot.querySelector(`[data-best="${k}"]`);
      if (!el) return;
      const top = this._lbGet(k)[0];
      el.innerHTML = top ? `🏆 ${fmt(top.t)}<small>${esc(top.n)}</small>` : `<small>No record yet</small>`;
    });
  }

  // ── explore ──────────────────────────────────────────────────────────────
  _showExplore() {
    this._stopGame();
    this.s = { screen: "explore", seen: new Set() };
    this.$("wrap").dataset.screen = "explore";
    this._resetMap(false);
    this._setTarget(null);
    this.$("top").innerHTML = `
      <div class="prompt small">
        <div class="pre">Explore mode</div>
        <div class="name">Tap any province or territory!</div>
        <div class="sub">Canada has <b>10 provinces</b> and <b>3 territories</b>. You've found <b id="seen">0</b> of 13.</div>
      </div>`;
    this.$("bottom").innerHTML = `
      <div class="info" id="info"><div class="infoempty">👆 Tap the map to learn about a place.</div></div>
      <div class="row"><button class="btn ghost" data-act="menu">← Back</button></div>`;
  }

  _exploreTap(id, e) {
    const [name, , cap, terr, col, fact] = PROV[id];
    const fresh = !this.s.seen.has(id);
    this.s.seen.add(id);
    this._colorIn(id, "found");
    this.$("marks").innerHTML = "";
    this._setTarget(null);
    this._addCapital(id, cap);
    if (id === "ON") this._addCapital("OTTAWA", "Ottawa 🇨🇦");
    this.sfx.correct(Math.min(this.s.seen.size, 10));
    this._burst(this._clientToWrap(e.clientX, e.clientY), fresh ? 10 : 5);
    this.$("seen").textContent = this.s.seen.size;
    this.$("info").innerHTML = `
      <div class="card-info" style="--c:${col}">
        <div class="ititle">${esc(name)}</div>
        <div class="itype">${terr ? "Territory" : "Province"}</div>
        <div class="icap">★ Capital: <b>${esc(cap)}</b></div>
        ${id === "ON" ? `<div class="icap">🇨🇦 Ottawa is Canada's capital city!</div>` : ""}
        <div class="ifact">💡 ${esc(fact)}</div>
      </div>`;
    if (this.s.seen.size === 13 && fresh) {
      this._float(this._elCenter(this.$("top")), "You found them all! 🎉", "gold");
      this._confetti(2.5);
      this.sfx.fanfare(false);
    }
  }

  // ── game ─────────────────────────────────────────────────────────────────
  _start(mode) {
    this._stopGame();
    const inp = this.$("player");
    if (inp) ls.set("cmc_player", cleanName(inp.value));
    this.sfx.wake();
    this.s = {
      screen: "countdown", mode, queue: shuffle(IDS), qi: -1,
      elapsed: 0, running: false, runFrom: 0, penalty: 0,
      streak: 0, bestStreak: 0, wrongThis: 0, missed: new Set(), firstTry: 0, locked: true,
    };
    this.$("wrap").dataset.screen = "play";
    this._resetMap(false);
    this._setTarget(null);
    this._renderHud();
    this.$("bottom").innerHTML = mode === "find" ? `<div class="tapnote">👆 Tap the map!</div>` : "";
    // 3, 2, 1, GO!
    const ov = this.$("overlay");
    this._cdTimers = ["3", "2", "1", "GO!"].map((txt, i) => setTimeout(() => {
      ov.innerHTML = `<div class="count ${txt === "GO!" ? "go" : ""}">${txt}</div>`;
      txt === "GO!" ? this.sfx.go() : this.sfx.tick();
    }, i * 700));
    this._cdTimers.push(setTimeout(() => {
      ov.innerHTML = "";
      this.s.screen = "play";
      this._clockLoop();
      this._next();
    }, 4 * 700 + 150));
  }

  _time() {
    const s = this.s;
    return s.elapsed + (s.running ? (performance.now() - s.runFrom) / 1000 : 0);
  }
  _resume() { if (!this.s.running) { this.s.running = true; this.s.runFrom = performance.now(); } }
  _pause() {
    if (this.s.running) { this.s.elapsed += (performance.now() - this.s.runFrom) / 1000; this.s.running = false; }
  }

  _clockLoop() {
    const el = this.$("clock");
    if (el) el.textContent = fmt(this._time() + this.s.penalty);
    this._clockRaf = requestAnimationFrame(() => this._clockLoop());
  }

  _renderHud() {
    const s = this.s;
    const n = Math.max(0, s.qi) + (s.screen === "play" ? 1 : 0);
    this.$("top").innerHTML = `
      <div class="hud">
        <div class="clock" id="clock">${fmt(this._time() + s.penalty)}</div>
        <div class="streak ${s.streak >= 3 ? "hot" : ""}" id="streak">${s.streak >= 2 ? `🔥 x${s.streak}` : ""}</div>
        <div class="qnum"><span id="qn">${Math.min(n, 13)}</span>/13</div>
      </div>
      <div class="progress"><div class="bar" id="bar" style="width:${(Math.max(0, s.qi) / 13) * 100}%"></div></div>
      <div class="prompt" id="prompt"><div class="pre">${MODES[s.mode].icon} Get ready…</div></div>`;
  }

  _next() {
    const s = this.s;
    s.qi += 1;
    s.wrongThis = 0;
    if (s.qi >= s.queue.length) return this._finish();
    const id = s.queue[s.qi];
    const [name, , cap, terr] = PROV[id];
    s.target = id;
    s.qStart = this._time();
    this.$("qn").textContent = s.qi + 1;
    this.$("bar").style.width = `${(s.qi / 13) * 100}%`;
    const prompt = this.$("prompt");
    if (s.mode === "find") {
      this._setTarget(null);
      prompt.innerHTML = `<div class="pre">Find ${terr ? "the territory" : "the province"}</div><div class="name pop">${esc(name)}</div>`;
    } else if (s.mode === "name") {
      this._setTarget(id);
      prompt.innerHTML = `<div class="pre">What's the name of the</div><div class="name pop">glowing ${terr ? "territory" : "province"}?</div>`;
      this._choices(id, shuffle([id, ...shuffle(IDS.filter((k) => k !== id)).slice(0, 3)]).map((k) => [k, PROV[k][0]]));
    } else {
      this._setTarget(id);
      prompt.innerHTML = `<div class="pre">What's the capital of</div><div class="name pop">${esc(name)}?</div>`;
      const others = shuffle(IDS.filter((k) => k !== id).map((k) => PROV[k][2]));
      const opts = [cap, PROV[id][6], ...others].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
      this._choices(cap, shuffle(opts).map((c) => [c, c]));
    }
    s.locked = false;
    this._resume();
  }

  _choices(answer, opts) {
    this.s.answer = answer;
    this.$("bottom").innerHTML = `<div class="choices">${opts.map(([v, label], i) =>
      `<button class="choice" data-act="answer" data-val="${esc(v)}" style="animation-delay:${i * 50}ms">${esc(label)}</button>`).join("")}</div>`;
  }

  _onMapTap(id, e) {
    if (this.s.screen === "explore") return this._exploreTap(id, e);
    if (this.s.screen !== "play" || this.s.mode !== "find" || this.s.locked || this._frozen()) return;
    e.preventDefault();
    const at = this._clientToWrap(e.clientX, e.clientY);
    if (id === this.s.target) this._right(at);
    else this._wrong(at, id);
  }

  _onChoice(val, btn) {
    const s = this.s;
    if (s.screen !== "play" || s.locked || this._frozen()) return;
    if (val === s.answer) {
      btn.classList.add("right");
      this._right(this._elCenter(btn));
    } else {
      btn.classList.add("wrong");
      btn.disabled = true;
      this._wrong(this._elCenter(btn), null);
    }
  }

  _right(at) {
    const s = this.s;
    s.locked = true;
    this._pause();
    const took = this._time() - s.qStart;
    if (s.wrongThis === 0) { s.firstTry += 1; s.streak += 1; }
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    this._colorIn(s.target, "found");
    this._setTarget(null);
    if (s.mode === "capitals") this._addCapital(s.target, PROV[s.target][2]);
    this.sfx.correct(s.streak);
    this._burst(at, 9 + Math.min(s.streak, 8));
    let msg = pick(PRAISE);
    if (s.wrongThis === 0 && took < 1.5) msg = "⚡ Lightning!";
    else if (s.wrongThis === 0 && took < 3) msg = "💨 Speedy!";
    this._float([at[0], at[1] - 20], msg, "good");
    if (s.streak >= 3 && s.wrongThis === 0) {
      setTimeout(() => this._float([at[0], at[1] + 16], `🔥 ${s.streak} in a row!`, "fire"), 160);
    }
    const st = this.$("streak");
    st.textContent = s.streak >= 2 ? `🔥 x${s.streak}` : "";
    st.className = `streak ${s.streak >= 3 ? "hot" : ""}`;
    if (s.streak >= 2) st.animate([{ transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 300 });
    this._nextT = setTimeout(() => this._next(), s.mode === "capitals" ? 650 : 450);
  }

  _frozen() { return performance.now() < (this.s.frozenUntil || 0); }

  _wrong(at, tappedId) {
    const s = this.s;
    const cost = PENALTY + PENALTY_STEP * s.wrongThis;
    s.penalty += cost;
    s.wrongThis += 1;
    s.streak = 0;
    s.missed.add(s.target);
    this.sfx.wrong();
    this._float(at, `+${cost}s`, "bad");
    // Brief freeze: guessing fast doesn't pay
    s.frozenUntil = performance.now() + FREEZE_MS;
    const wrap = this.$("wrap");
    wrap.classList.add("frozen");
    clearTimeout(this._freezeT);
    this._freezeT = setTimeout(() => wrap.classList.remove("frozen"), FREEZE_MS);
    this._shake(this.$("prompt"));
    const st = this.$("streak");
    st.textContent = "";
    st.className = "streak";
    const clock = this.$("clock");
    clock.classList.remove("ouch");
    void clock.offsetWidth;
    clock.classList.add("ouch");
    if (tappedId) {
      // Teach while we're at it: say what they actually tapped
      const ps = this._provEls(tappedId);
      ps.forEach((p) => p.classList.add("oops"));
      setTimeout(() => ps.forEach((p) => p.classList.remove("oops")), 700);
      const c = MAP.p[tappedId];
      this._float(this._svgToWrap(c.cx, c.cy), `That's ${PROV[tappedId][1]}`, "info");
      if (s.wrongThis >= MAX_TRIES) {
        // Show the answer, then carry on
        s.locked = true;
        this._pause();
        this._setTarget(s.target);
        const t = MAP.p[s.target];
        setTimeout(() => this._float(this._svgToWrap(t.cx, t.cy), `Here's ${PROV[s.target][1]}!`, "info"), 250);
        this._nextT = setTimeout(() => {
          this._setTarget(null);
          this._colorIn(s.target, "found");
          this._next();
        }, 1700);
      }
    }
  }

  _finish() {
    const s = this.s;
    this._pause();
    cancelAnimationFrame(this._clockRaf);
    s.screen = "results";
    this.$("wrap").dataset.screen = "results";
    this._setTarget(null);
    const total = Math.round((s.elapsed + s.penalty) * 10) / 10;
    const m = MODES[s.mode];
    const stars = total <= m.stars[0] ? 3 : total <= m.stars[1] ? 2 : total <= m.stars[2] ? 1 : 0;
    const [rIcon, rName] = RANKS[3 - stars];
    const player = this._player();
    const prevBest = this._lbGet(s.mode)[0];
    const myBest = this._lbGet(s.mode).filter((e) => e.n === player)[0];
    const rank = this._lbAdd(s.mode, { n: player, t: total, d: today() });
    this._lastScore = { mode: s.mode, n: player, t: total };
    const record = rank === 1;
    const pb = !record && (!myBest || total < myBest.t);
    const missed = [...s.missed];

    this.$("top").innerHTML = `
      <div class="results">
        ${record ? `<div class="record">🏆 NEW RECORD! 🏆</div>` : pb ? `<div class="record pb">🎯 Personal best!</div>` : ""}
        <div class="rtime">${fmt(total)}</div>
        <div class="stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? "on" : ""}" style="animation-delay:${300 + i * 250}ms">★</span>`).join("")}</div>
        <div class="rank">${rIcon} You're a <b>${rName}</b>!</div>
        <div class="stats">
          <span>✅ ${s.firstTry}/13 first try</span>
          <span>🔥 Best streak ${s.bestStreak}</span>
          ${s.penalty ? `<span>⏱️ +${s.penalty}s oops</span>` : `<span>💯 No oops!</span>`}
        </div>
        ${rank ? `<div class="lbrank">#${rank} on the ${m.title} leaderboard${record && prevBest ? ` (beat ${esc(prevBest.n)}'s ${fmt(prevBest.t)})` : ""}</div>` : ""}
        ${stars < 3 ? `<div class="nextgoal">Next ★ at ${fmt(m.stars[Math.max(0, 2 - stars)])} or faster</div>` : ""}
      </div>`;
    this.$("bottom").innerHTML = `
      ${record ? `<div class="trophy">🏆</div>` : ""}
      ${missed.length ? `<div class="practice"><b>Practice these:</b> ${missed.map((k) =>
        `<span class="chip" style="--c:${PROV[k][4]}">${esc(s.mode === "capitals" ? `${PROV[k][1]}: ${PROV[k][2]}` : PROV[k][0])}</span>`).join("")}</div>` : ""}
      <div class="row">
        <button class="btn" data-act="again">🔁 Play again</button>
        <button class="btn ghost" data-act="board">🏆 Scores</button>
        <button class="btn ghost" data-act="menu">🏠 Menu</button>
      </div>`;
    this.sfx.fanfare(record || pb);
    if (stars >= 2 || record || pb) this._confetti(record ? 4.5 : 3);
    else this._burst(this._elCenter(this.$("top")), 14, ["🍁", "⭐"]);
    // Celebrate the full-colour map with a wave
    IDS.forEach((id, i) => {
      this._provEls(id).forEach((p) => {
        p.style.animationDelay = `${i * 60}ms`;
        p.setAttribute("class", "prov shown wave");
      });
    });
  }

  // ── leaderboard ──────────────────────────────────────────────────────────
  _showBoard(mode) {
    this._stopGame();
    const from = this.s.screen;
    const highlight = this._lastScore?.mode === mode ? this._lastScore : null;
    this.s = { screen: "board", boardMode: mode, mode };
    this.$("wrap").dataset.screen = "board";
    if (from !== "board") { this._resetMap(true); this._setTarget(null); }
    const list = this._lbGet(mode);
    const medal = ["🥇", "🥈", "🥉"];
    this.$("top").innerHTML = `
      <div class="board">
        <div class="btitle">🏆 Hall of Fame</div>
        <div class="tabs">${Object.entries(MODES).map(([k, m]) =>
          `<button class="tab ${k === mode ? "on" : ""}" data-act="tab" data-mode="${k}">${m.icon} ${m.title}</button>`).join("")}</div>
        <ol class="lb">
          ${list.length ? list.map((e, i) => `
            <li class="${highlight && e.n === highlight.n && e.t === highlight.t ? "me" : ""}" style="animation-delay:${i * 60}ms">
              <span class="pos">${medal[i] || i + 1}</span>
              <span class="who">${esc(e.n)}</span>
              <span class="when">${prettyDate(e.d)}</span>
              <span class="t">${fmt(e.t)}</span>
            </li>`).join("") : `<li class="empty">No scores yet. Be the first! 🚀</li>`}
        </ol>
      </div>`;
    this.$("bottom").innerHTML = `
      <div class="row">
        <button class="btn" data-act="start" data-mode="${mode}">▶ Play ${MODES[mode].title}</button>
        <button class="btn ghost" data-act="menu">🏠 Menu</button>
      </div>`;
  }
}

const STYLE = /*STYLE*/;

if (!customElements.get("canada-map-challenge")) {
  customElements.define("canada-map-challenge", CanadaMapChallenge);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "canada-map-challenge",
    name: "Canada Map Challenge",
    description: "Timed quiz on Canada's provinces, territories and capitals with high scores.",
  });
  console.info(`%c 🍁 CANADA-MAP-CHALLENGE %c v${VERSION} `, "background:#d52b1e;color:#fff;font-weight:700", "background:#fff;color:#d52b1e");
}
