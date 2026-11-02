"""Builds canada-map-challenge.js from src/card.src.js + src/style.css + src/map.json."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "src" / "card.src.js").read_text()
style = (root / "src" / "style.css").read_text()
mp = json.loads((root / "src" / "map.json").read_text())
out = src.replace("/*MAP_JSON*/", json.dumps(mp, separators=(",", ":"))).replace("/*STYLE*/", json.dumps(style))
(root / "canada-map-challenge.js").write_text(out)
print("wrote canada-map-challenge.js", len(out.encode()), "bytes")
