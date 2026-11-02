"""Projects a Canada provinces GeoJSON into src/map.json (SVG paths + capital markers).
Usage: python3 tools/mkmap.py canada.geojson src/map.json
Source data: https://github.com/codeforgermany/click_that_hood (public/data/canada.geojson, MIT)."""
import json, math, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
# Lambert conformal conic (StatCan): parallels 49 & 77, origin 63.390675N, 91.866667W
p1, p2, p0, l0 = map(math.radians, (49, 77, 63.390675, -91.866667))
n = math.log(math.cos(p1)/math.cos(p2)) / math.log(math.tan(math.pi/4+p2/2)/math.tan(math.pi/4+p1/2))
F = math.cos(p1)*math.tan(math.pi/4+p1/2)**n/n
r0 = F/math.tan(math.pi/4+p0/2)**n
def proj(lon, lat):
    r = F/math.tan(math.pi/4+math.radians(lat)/2)**n
    t = n*(math.radians(lon)-l0)
    return r*math.sin(t), -(r0 - r*math.cos(t))  # y down
def area(r):
    return abs(sum(r[i][0]*r[i-1][1]-r[i-1][0]*r[i][1] for i in range(len(r)))/2)
def dp(pts, eps):
    if len(pts) < 3: return pts
    (x1,y1),(x2,y2) = pts[0], pts[-1]
    dx,dy = x2-x1, y2-y1; L = math.hypot(dx,dy) or 1e-12
    best, bi = 0, 0
    for i in range(1,len(pts)-1):
        x,y = pts[i]
        dd = abs(dy*x-dx*y+x2*y1-y2*x1)/L if math.hypot(dx,dy)>0 else math.hypot(x-x1,y-y1)
        if dd > best: best, bi = dd, i
    if best > eps:
        return dp(pts[:bi+1],eps)[:-1] + dp(pts[bi:],eps)
    return [pts[0], pts[-1]]
IDS = {'Quebec':'QC','Newfoundland and Labrador':'NL','British Columbia':'BC','Nunavut':'NU','Northwest Territories':'NT',
       'New Brunswick':'NB','Nova Scotia':'NS','Saskatchewan':'SK','Alberta':'AB','Prince Edward Island':'PE',
       'Yukon Territory':'YT','Manitoba':'MB','Ontario':'ON'}
feats = []
for f in d['features']:
    g = f['geometry']; polys = g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    feats.append((IDS[f['properties']['name']], [[[proj(*pt[:2]) for pt in ring] for ring in poly] for poly in polys]))
xs = [p[0] for _,ps in feats for poly in ps for p in poly[0]]
ys = [p[1] for _,ps in feats for poly in ps for p in poly[0]]
minx,maxx,miny,maxy = min(xs),max(xs),min(ys),max(ys)
W = 1000; s = W/(maxx-minx); H = (maxy-miny)*s
pad = 10
res = {}
for pid, polys in feats:
    rings = []
    big = max(area(poly[0]) for poly in polys)
    for poly in polys:
        outer = [((x-minx)*s+pad, (y-miny)*s+pad) for x,y in poly[0]]
        a = area(outer)
        if a < 14 and a < big*s*s*0.5: continue   # drop tiny islands (keep if it's the main body)
        r = dp(outer + [outer[0]], 0.8)
        if len(r) < 4: continue
        rings.append(r)
    path = ''.join('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x,y in r[:-1]) + 'Z' for r in rings)
    # label anchor: centroid of largest ring
    lr = max(rings, key=area)
    A = 0; cx = cy = 0
    for i in range(len(lr)-1):
        x0,y0 = lr[i]; x1,y1 = lr[i+1]; c = x0*y1-x1*y0
        A += c; cx += (x0+x1)*c; cy += (y0+y1)*c
    A /= 2
    res[pid] = {'d': path, 'cx': round(cx/(6*A)), 'cy': round(cy/(6*A)), 'rings': len(rings)}
json.dump({'w': W+2*pad, 'h': round(H)+2*pad, 'p': res}, open(out,'w'))
print('viewBox', W+2*pad, round(H)+2*pad, 'bytes', sum(len(v['d']) for v in res.values()))
for k,v in res.items(): print(k, v['rings'], len(v['d']), v['cx'], v['cy'])
# Capital city markers (lat, lon), projected into the same viewBox
CAPS = {'BC':(48.428,-123.365),'AB':(53.546,-113.494),'SK':(50.445,-104.619),'MB':(49.895,-97.138),
        'ON':(43.651,-79.383),'QC':(46.813,-71.208),'NB':(45.964,-66.643),'NS':(44.649,-63.575),
        'PE':(46.238,-63.131),'NL':(47.561,-52.713),'YT':(60.721,-135.057),'NT':(62.454,-114.372),
        'NU':(63.749,-68.522),'OTTAWA':(45.421,-75.697)}
m = json.load(open(out))
m['caps'] = {}
for k,(la,lo) in CAPS.items():
    x,y = proj(lo,la)
    m['caps'][k] = [round((x-minx)*s+pad), round((y-miny)*s+pad)]
json.dump(m, open(out,'w'), separators=(',',':'))
print(m['caps'])
