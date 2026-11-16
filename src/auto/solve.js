/* Modo automático: resolver una lámina de instalaciones contra su arquitectónico, sin pantalla.
   Alinea por ejes, elige los estilos de tubería y devuelve los cruces con paredes cortafuego. */
import { fitAxes, fitScore, samplePoints, sheetAxes, slideFit } from './align.js';
import { ductAxes, findCrossings } from './engine.js';
import { isGray, pickStyles, styleLines } from './styles.js';
import { styleSegments } from './engine.js';

/* A: {W, H, mask, occ, axes, u, bbox}; B: {w, h, shapes, byKey, items}; opt: {duct, keys, tr} */
export function alignSheet(A, B) {
  const f = fitAxes(A.axes, sheetAxes(B.items, B.shapes));
  if (!f) return {ok: false, why: 'No encontré ejes comunes con el arquitectónico'};
  const out = {ok: true, tr: {s: f.s, x: f.x, y: f.y, r: 0}, nx: f.nx, ny: f.ny, res: f.maxRes, how: 'ejes'};
  const pts = samplePoints(B.shapes.filter(s => s.k === 's'), 30000);
  if (f.x == null || f.y == null) {
    const dir = f.x == null ? 'x' : 'y';
    const r = slideFit(pts, A.occ, f, dir, dir === 'x' ? [-B.w*f.s, A.W] : [-B.h*f.s, A.H]);
    if (!(r.frac >= 0.25 && r.frac >= 2.5*r.mean)) return {ok: false, why: `Los ejes solo dan una dirección (${f.nx + f.ny} ejes) y no logré ubicar la otra comparando los dibujos`};
    out.tr[dir] = r.t; out.how = 'ejes+dibujo'; out.slide = r.frac;
  }
  out.match = fitScore(pts, A.occ, out.tr);
  out.area = drawnArea(pts, A.occ, out.tr);
  return out;
}
/* Zona de la lámina B donde está dibujada la planta: donde sus líneas coinciden con las del arquitectónico.
   Lo demás (rótulo, notas, tablas, simbología) no se revisa: al superponerse caería sobre otras partes del edificio. */
function drawnArea(pts, occ, tr) {
  // por casillas: es planta donde la mayoría de las líneas coinciden; queda el grupo de casillas más grande
  const C = 64, cells = new Map();
  for (let i = 0; i < pts.length; i += 2) {
    const k = Math.floor(pts[i]/C) + ',' + Math.floor(pts[i+1]/C);
    let c = cells.get(k); if (!c) cells.set(k, c = [0, 0]);
    c[0]++; if (occ.at(tr.s*pts[i] + tr.x, tr.s*pts[i+1] + tr.y)) c[1]++;
  }
  const good = new Set();
  for (const [k, c] of cells) if (c[0] >= 6 && c[1]/c[0] >= 0.5) good.add(k);
  if (good.size < 4) return null;
  const seen = new Set(), comps = [];
  for (const k0 of good) {
    if (seen.has(k0)) continue;
    const st = [k0], comp = []; seen.add(k0);
    while (st.length) {
      const k = st.pop(); comp.push(k);
      const [x, y] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const q = (x + dx) + ',' + (y + dy); if (good.has(q) && !seen.has(q)) { seen.add(q); st.push(q); } }
    }
    comps.push(comp);
  }
  const big = Math.max(...comps.map(c => c.length));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const comp of comps) if (comp.length >= Math.max(3, big*0.12)) for (const k of comp) { const [x, y] = k.split(',').map(Number); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [(x0 - 0.5)*C, (y0 - 0.5)*C, (x1 + 1.5)*C, (y1 + 1.5)*C];
}
export function solveSheet(A, B, opt = {}) {
  const al = opt.tr ? {ok: true, tr: opt.tr, how: 'previa'} : alignSheet(A, B);
  if (!al.ok) return al;
  if (opt.tr && !opt.tr.r) al.area = drawnArea(samplePoints(B.shapes.filter(s => s.k === 's'), 30000), A.occ, opt.tr);
  const tr = al.tr, M = 60, b = A.bbox;
  const vp = [Math.max(0, (b[0] - tr.x)/tr.s - M), Math.max(0, (b[1] - tr.y)/tr.s - M), Math.min(B.w, (b[2] - tr.x)/tr.s + M), Math.min(B.h, (b[3] - tr.y)/tr.s + M)];
  if (al.area) { const a = al.area, m = 12; vp[0] = Math.max(vp[0], a[0] - m); vp[1] = Math.max(vp[1], a[1] - m); vp[2] = Math.min(vp[2], a[2] + m); vp[3] = Math.min(vp[3], a[3] + m); }
  let styles;
  if (opt.keys) styles = opt.keys.filter(k => B.byKey.has(k)).map(k => ({key: k, pick: true, why: 'elegido'}));
  else styles = pickStyles(B.byKey, tr, vp, A.occ, A.mask, {u: A.u});
  let lines = [], boxes = [];
  for (const st of styles) if (st.pick) { const r = styleLines(B.byKey.get(st.key), st.key, vp, st.key[0] === 'f', !!opt.duct); lines.push(...r.lines); }
  // recuadros de rótulo (número de circuito), en cualquier estilo que no sea fondo
  if (!opt.duct) for (const [key, shapes] of B.byKey) if (key[0] === 's' && !isGray(key.slice(1, 8))) boxes.push(...styleSegments(shapes, vp).boxes);
  let res;
  if (opt.duct) res = findCrossings(ductAxes(lines).map(l => { const o = l.slice(0, 5); o.wd = l[5]; return o; }), tr, A.mask, {u: A.u, ends: false, onWall: false, dedupe: 6*A.u, keepSmall: true});
  else res = findCrossings(lines, tr, A.mask, {u: A.u, boxes});
  return {...al, vp, styles, cross: res.cross, nLines: res.lines.length};
}
