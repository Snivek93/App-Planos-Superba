/* Alineación automática de una lámina completa por sus ejes (A, B, C… y 1, 2, 3…): se buscan las filas y
   columnas de globos de eje en el plano de instalaciones y en el arquitectónico, y se calcula la escala y el
   desplazamiento que hacen coincidir los ejes del mismo nombre. Sin pantalla. */
export const AXIS_RE = /^([A-Z]{1,2}|\d{1,2})['′.]?$/;

function bbOf(s) {
  if (s.bb) return s.bb;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of s.sp) for (let i = 0; i < sp.length; i += 2) { if (sp[i] < x0) x0 = sp[i]; if (sp[i] > x1) x1 = sp[i]; if (sp[i+1] < y0) y0 = sp[i+1]; if (sp[i+1] > y1) y1 = sp[i+1]; }
  return (s.bb = [x0, y0, x1, y1]);
}
/* globos de eje: rótulo corto dentro de un círculo (u otra figura cuadrada) pequeño */
export function axisBubbles(words, shapes) {
  const cand = words.filter(r => AXIS_RE.test(r.s));
  if (!cand.length) return [];
  const G = 128, grid = new Map();
  for (const s of shapes) {
    const b = bbOf(s), w = b[2] - b[0], h = b[3] - b[1];
    if (w < 14 || w > 300 || Math.abs(w - h) > w*0.15) continue;
    const k = Math.floor((b[0] + b[2])/2/G) + ',' + Math.floor((b[1] + b[3])/2/G);
    let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(b);
  }
  const out = [];
  for (const r of cand) {
    let best = null, bw = Infinity;
    const cx = Math.floor(r.x/G), cy = Math.floor(r.y/G);
    for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gy = cy - 2; gy <= cy + 2; gy++) for (const b of grid.get(gx + ',' + gy) || []) {
      const w = b[2] - b[0];
      if (w < r.h*1.1 || w > r.h*7 || r.x < b[0] || r.x > b[2] || r.y < b[1] || r.y > b[3]) continue;
      if (w < bw) { bw = w; best = b; }
    }
    if (best) out.push({s: r.s.replace(/[.′]/g, m => m === '′' ? "'" : '').replace(/^0+(?=\d)/, ''), x: (best[0] + best[2])/2, y: (best[1] + best[3])/2, d: bw});
  }
  // un mismo globo puede traer el texto repetido
  return out.filter((b, i) => !out.some((o, j) => j < i && o.s === b.s && Math.abs(o.x - b.x) < 2 && Math.abs(o.y - b.y) < 2));
}
const ordVal = s => { const m = s.match(/^(\d+)|^([A-Z]+)/); const v = m[1] ? +m[1] : [...m[2]].reduce((a, c) => a*26 + c.charCodeAt(0) - 64, 0); return v + (/'/.test(s) ? 0.5 : 0); };
/* filas (o columnas) de globos: mismo nivel, mismo tamaño, tres o más ejes distintos y en orden */
function rowsOf(bub, ax) {
  const o = ax === 'x' ? 'y' : 'x';
  const list = bub.slice().sort((a, b) => a[o] - b[o]), rows = [];
  let cur = [];
  const flush = () => {
    if (cur.length >= 3) {
      // por tamaño de globo
      const ds = cur.map(b => b.d).sort((a, b) => a - b), md = ds[ds.length >> 1];
      const g = cur.filter(b => Math.abs(b.d - md) < md*0.2).sort((a, b) => a[ax] - b[ax]);
      const uniq = []; for (const b of g) if (!uniq.some(u => u.s === b.s)) uniq.push(b);
      const num = uniq.filter(b => /^\d/.test(b.s)), let_ = uniq.filter(b => !/^\d/.test(b.s));
      for (const set of [num, let_]) {
        if (set.length < 3) continue;
        let up = 0, dn = 0; for (let i = 1; i < set.length; i++) ordVal(set[i].s) > ordVal(set[i-1].s) ? up++ : dn++;
        if (Math.min(up, dn) <= Math.max(1, set.length*0.15)) rows.push(set);
      }
    }
    cur = [];
  };
  for (const b of list) { if (cur.length && b[o] - cur[cur.length-1][o] > Math.max(6, b.d*0.3)) flush(); cur.push(b); }
  flush();
  return rows.sort((a, b) => b.length - a.length);
}
/* ejes de la lámina: X = ejes verticales [nombre, x], Y = ejes horizontales [nombre, y]. Un nombre puede salir
   en más de un lugar (otra planta en la misma lámina, otra fila de globos numerados): el ajuste decide cuál calza. */
export function sheetAxes(items, shapes) {
  const bub = axisBubbles(items, shapes);
  const take = ax => {
    const out = [];
    for (const row of rowsOf(bub, ax)) for (const b of row) if (!out.some(o => o[0] === b.s && Math.abs(o[1] - b[ax]) < 3)) out.push([b.s, b[ax]]);
    return out;
  };
  return {X: take('x'), Y: take('y'), n: bub.length};
}
/* Transformación B → A (a = s·b + t) que hace coincidir los ejes comunes. Devuelve null si no alcanza.
   En una lámina puede haber otras filas de globos numerados (cortes, detalles, otra planta): se prueba la
   escala que da cada par de ejes comunes y queda la que hace calzar más ejes. */
export function fitAxes(A, B) {
  const P = [[], []];
  for (const [k, bx] of B.X) for (const [ka, ax] of A.X) if (ka === k) P[0].push([bx, ax, k]);
  for (const [k, by] of B.Y) for (const [ka, ay] of A.Y) if (ka === k) P[1].push([by, ay, k]);
  const TOL = 3;
  // ejes que calzan, uno por nombre
  const inl = (rows, s, t) => { const seen = new Set(); return rows.filter(r => Math.abs(s*r[0] + t - r[1]) < TOL && !seen.has(r[2]) && seen.add(r[2])); };
  const bestT = (rows, s) => { let b = [], bt = null; for (const r of rows) { const t = r[1] - s*r[0], q = inl(rows, s, t); if (q.length > b.length) { b = q; bt = t; } } return [b, bt]; };
  let best = null;
  for (const d of [0, 1]) {
    const rows = P[d];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const db = rows[j][0] - rows[i][0]; if (Math.abs(db) < 20) continue;
      const s = (rows[j][1] - rows[i][1])/db; if (!(s > 0.05 && s < 20)) continue;
      const a = inl(rows, s, rows[i][1] - s*rows[i][0]), [o] = bestT(P[1-d], s);
      const score = a.length + (o.length >= 2 ? o.length : o.length*0.5);
      if (a.length >= 3 && (!best || score > best.score)) best = {score, d, a, o};
    }
  }
  if (!best) return null;
  if (best.o.length < 2) best.o = [];   // un solo eje en la otra dirección no alcanza para confiar: se resuelve aparte
  // ajuste fino por mínimos cuadrados con los ejes que calzaron
  const g = best.d === 0 ? [best.a, best.o] : [best.o, best.a];
  const mean = (l, i) => l.reduce((t, r) => t + r[i], 0)/(l.length || 1);
  const mb = g.map(l => mean(l, 0)), ma = g.map(l => mean(l, 1));
  let num = 0, den = 0;
  g.forEach((l, q) => { for (const r of l) { num += (r[0] - mb[q])*(r[1] - ma[q]); den += (r[0] - mb[q])**2; } });
  if (den < 1e-6) return null;
  const s = num/den, t = [g[0].length ? ma[0] - s*mb[0] : null, g[1].length ? ma[1] - s*mb[1] : null];
  let maxRes = 0; g.forEach((l, q) => { for (const r of l) maxRes = Math.max(maxRes, Math.abs(s*r[0] + t[q] - r[1])); });
  return {s, x: t[0], y: t[1], nx: g[0].length, ny: g[1].length, maxRes, xs: g[0].map(r => r[2]), ys: g[1].map(r => r[2])};
}

/* Rejilla de ocupación de un plano: celdas por donde pasa alguna línea (con una celda de holgura).
   Sirve para saber qué líneas del plano de instalaciones son el fondo arquitectónico y para terminar de
   ubicar una lámina cuando los ejes solo dan una dirección. */
export function occupancy(shapes, W, H, cell = 2) {
  const gw = Math.ceil(W/cell), gh = Math.ceil(H/cell), d = new Uint8Array(gw*gh);
  const put = (x, y) => {
    const cx = Math.floor(x/cell), cy = Math.floor(y/cell);
    if (cx < 1 || cy < 1 || cx >= gw - 1 || cy >= gh - 1) return;
    const i = cy*gw + cx;
    d[i] = d[i-1] = d[i+1] = d[i-gw] = d[i+gw] = d[i-gw-1] = d[i-gw+1] = d[i+gw-1] = d[i+gw+1] = 1;
  };
  for (const s of shapes) for (const sp of s.sp) for (let q = 0; q + 3 < sp.length; q += 2) {
    const ax = sp[q], ay = sp[q+1], bx = sp[q+2], by = sp[q+3], L = Math.hypot(bx - ax, by - ay);
    if (L > 5000) continue;
    const n = Math.max(1, Math.ceil(L/cell));
    for (let k = 0; k <= n; k++) put(ax + (bx - ax)*k/n, ay + (by - ay)*k/n);
  }
  return {d, gw, gh, cell, at: (x, y) => { const cx = Math.floor(x/cell), cy = Math.floor(y/cell); return cx >= 0 && cy >= 0 && cx < gw && cy < gh ? d[cy*gw + cx] : 0; }};
}
/* puntos de muestra de las líneas de un plano (hasta max), para comparar con la rejilla del otro */
export function samplePoints(shapes, max = 30000) {
  let total = 0;
  for (const s of shapes) for (const sp of s.sp) for (let q = 0; q + 3 < sp.length; q += 2) total += Math.hypot(sp[q+2] - sp[q], sp[q+3] - sp[q+1]);
  const step = Math.max(4, total/max), out = []; let acc = 0;
  for (const s of shapes) for (const sp of s.sp) for (let q = 0; q + 3 < sp.length; q += 2) {
    const L = Math.hypot(sp[q+2] - sp[q], sp[q+3] - sp[q+1]); if (L < 0.01) continue;
    for (acc += L; acc >= step; acc -= step) { const t = 1 - (acc - step)/L; out.push(sp[q] + (sp[q+2] - sp[q])*Math.min(1, Math.max(0, t)), sp[q+1] + (sp[q+3] - sp[q+1])*Math.min(1, Math.max(0, t))); }
  }
  return out;
}
/* Con la escala y una dirección ya resueltas por los ejes, busca el desplazamiento en la otra dirección que
   hace coincidir más líneas del plano B con las del plano A. dir: 'x' o 'y' (la que falta). */
export function slideFit(pts, occ, f, dir, range) {
  const score = t => { let n = 0; for (let i = 0; i < pts.length; i += 2) { const x = f.s*pts[i] + (dir === 'x' ? t : f.x), y = f.s*pts[i+1] + (dir === 'y' ? t : f.y); if (occ.at(x, y)) n++; } return n; };
  let best = null, bs = -1, sum = 0, cnt = 0;
  for (let t = range[0]; t <= range[1]; t += occ.cell) { const v = score(t); sum += v; cnt++; if (v > bs) { bs = v; best = t; } }
  // la rejilla tiene holgura: se toma el centro de la franja donde el calce es casi el máximo
  { let w = 0, m = 0; for (let t = best - 3*occ.cell; t <= best + 3*occ.cell; t += 0.25) { const v = score(t); if (v >= bs*0.97) { w += v; m += v*t; } } if (w) best = m/w; }
  const frac = bs/(pts.length/2), mean = sum/cnt/(pts.length/2);
  return {t: best, frac, mean};
}
/* fracción de los puntos de B que caen sobre líneas de A con la transformación dada (para comprobar el calce) */
export function fitScore(pts, occ, f) {
  let n = 0; for (let i = 0; i < pts.length; i += 2) if (occ.at(f.s*pts[i] + f.x, f.s*pts[i+1] + f.y)) n++;
  return n/(pts.length/2 || 1);
}
