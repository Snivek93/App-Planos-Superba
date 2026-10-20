/* Paredes cortafuego por etiqueta.
   Para planos donde las paredes no vienen de colores (Revit con todo en negro) pero cada pared lleva su código de
   ensamble ("X4-4C-F2F2", "C2C2-3F-C2C2", "CO25"…) y la lámina trae la tabla de ensambles con su resistencia.
   1. Se leen los textos del PDF: las etiquetas en la planta y, en la tabla, la resistencia de cada código ("2 horas").
   2. De cada etiqueta se sigue su línea guía hasta el punto que toca la pared.
   3. En ese punto se miden las líneas paralelas de la pared (su grosor) y se sigue la pared a lo largo hasta que
      termina o hasta una línea transversal que la cierra (cambio de tipo de pared, esquina).
   El resultado son franjas (polígonos) en coordenadas del plano A, guardadas en los ajustes de paredes del plano
   (fx.tagw) y usadas como una pared más por la detección de cruces, el resaltado y el tipo de pared de cada sello. */
import { PDF_UNIT } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { apT, ensureVec, undouble } from './vector.js';
import { ensurePdf } from '../plans/load.js';

const U = PDF_UNIT;                       // unidades de plano por punto PDF
export const CODE_RE = /^(?:[A-Z]{1,2}\d(?:[A-Z]\d)?-\d+[A-Z]?(?:-[A-Z]\d(?:[A-Z]\d)?)?|CO\d+(?:\.\d+)?)$/;
export const TAG_PREFIX = 'tag:';

function luma(c) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(c || '')); if (!m) return 1;
  const n = parseInt(m[1], 16); return ((n >> 16 & 255)*0.299 + (n >> 8 & 255)*0.587 + (n & 255)*0.114)/255;
}

/* textos de la lámina, con su caja en coordenadas del plano */
async function textRuns(k) {
  const rt = RT[k], p = S.plans[k];
  const pg = await (await ensurePdf(rt)).getPage(p.page || 1);
  const VT = pg.getViewport({scale:U}).transform;
  const tc = await pg.getTextContent();
  const runs = []; let cur = null;
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    const t = it.transform, h = Math.hypot(t[2], t[3]) || 4, n = Math.hypot(t[0], t[1]) || 1, dx = t[0]/n, dy = t[1]/n;
    const sx = t[4], sy = t[5], ex = sx + dx*it.width, ey = sy + dy*it.width;
    if (cur && Math.hypot(sx - cur.ex, sy - cur.ey) < h*0.35 && Math.abs(dx - cur.dx) < 0.01) { cur.str += it.str; cur.ex = ex; cur.ey = ey; }
    else { cur = {str:it.str, sx, sy, ex, ey, h, dx, dy}; runs.push(cur); }
  }
  // caja de cada palabra en coordenadas del plano (los textos girados también)
  const out = [];
  for (const r of runs) {
    const s = undouble(r.str); if (!s.trim()) continue;
    const L = Math.hypot(r.ex - r.sx, r.ey - r.sy) || 1, nx = -r.dy, ny = r.dx;
    // separar por espacios conservando la posición aproximada de cada palabra
    let pos = 0;
    for (const w of s.split(/(\s+)/)) {
      const a = pos/s.length, b = (pos + w.length)/s.length; pos += w.length;
      if (!w.trim()) continue;
      const P = f => [r.sx + r.dx*L*f, r.sy + r.dy*L*f];
      const c = [P(a), P(b)].flatMap(([x, y]) => [[x, y], [x + nx*r.h, y + ny*r.h]]).map(([x, y]) => apT(VT, x, y));
      const xs = c.map(q => q[0]), ys = c.map(q => q[1]);
      out.push({t:w.trim(), x0:Math.min(...xs), y0:Math.min(...ys), x1:Math.max(...xs), y1:Math.max(...ys), h:r.h*U, rot:Math.abs(r.dy) > 0.5});
    }
  }
  return out;
}

/* resistencia de cada código según la tabla de ensambles: en la misma fila, a la derecha, "2 horas" / "1 hora" */
function ratings(words) {
  const res = new Map();
  for (const w of words) {
    if (!CODE_RE.test(w.t) || w.rot) continue;
    const cy = (w.y0 + w.y1)/2, H = (w.y1 - w.y0) || 8;
    let best = null;
    for (const v of words) {
      if (v === w || v.rot || v.x0 < w.x1 - 1 || v.x0 - w.x1 > 180*U) continue;
      if (Math.abs((v.y0 + v.y1)/2 - cy) > H*0.6) continue;
      if (CODE_RE.test(v.t)) { if (!best || v.x0 < best.x0) best = {x0:v.x0, stop:true}; continue; }
      if (/^hora?s?$/i.test(v.t)) {
        const num = words.find(z => z !== v && !z.rot && Math.abs((z.y0 + z.y1)/2 - cy) < H*0.6 && z.x1 <= v.x0 + 1 && v.x0 - z.x1 < 8*U && /^\d+(?:[.,]\d+)?$/.test(z.t));
        if (num && (!best || v.x0 < best.x0)) best = {x0:v.x0, h:+num.t.replace(',', '.')};
      }
    }
    if (best && best.h && !best.stop) { const prev = res.get(w.t); if (!prev || best.h > prev) res.set(w.t, best.h); }
  }
  return res;
}

/* segmentos de los trazos oscuros del plano, con índice espacial */
function segIndex(vec) {
  const segs = [], G = 40*U, grid = new Map();
  for (const s of vec.shapes) {
    if (s.k !== 's' || luma(s.c) > 0.38) continue;
    for (const sp of s.sp) for (let i = 2; i < sp.length; i += 2) {
      const x0 = sp[i-2], y0 = sp[i-1], x1 = sp[i], y1 = sp[i+1], L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 0.3*U) continue;
      const id = segs.length; segs.push({x0, y0, x1, y1, L, w:s.w});
      for (let gx = Math.floor(Math.min(x0, x1)/G); gx <= Math.floor(Math.max(x0, x1)/G); gx++)
        for (let gy = Math.floor(Math.min(y0, y1)/G); gy <= Math.floor(Math.max(y0, y1)/G); gy++) {
          const key = gx + ',' + gy; let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(id);
        }
    }
  }
  const near = (x, y, r) => {
    const out = new Set();
    for (let gx = Math.floor((x - r)/G); gx <= Math.floor((x + r)/G); gx++)
      for (let gy = Math.floor((y - r)/G); gy <= Math.floor((y + r)/G); gy++) for (const id of grid.get(gx + ',' + gy) || []) out.add(id);
    return [...out].map(i => segs[i]);
  };
  // puntos de las líneas guía: rellenos pequeños casi cuadrados
  const dots = [];
  for (const s of vec.shapes) {
    if (s.k !== 'f') continue;
    const w = s.bb[2] - s.bb[0], h = s.bb[3] - s.bb[1];
    if (w > 1.5*U && w < 8*U && Math.abs(w - h) < 1*U && luma(s.c) < 0.5) dots.push({x:(s.bb[0] + s.bb[2])/2, y:(s.bb[1] + s.bb[3])/2, r:w/2});
  }
  return {segs, near, dots};
}

/* sigue la línea guía de una etiqueta hasta el punto sobre la pared */
function leaderPoint(w, ix) {
  const m = 2.5*U, box = [w.x0 - m, w.y0 - m, w.x1 + m, w.y1 + m];
  const inb = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const thin = s => s.w <= 0.9*U;
  const dotAt = (x, y) => ix.dots.find(d => Math.hypot(d.x - x, d.y - y) < d.r + 0.8*U);
  const starts = [];
  for (const s of ix.near((w.x0 + w.x1)/2, (w.y0 + w.y1)/2, (w.x1 - w.x0)/2 + 12*U)) {
    if (!thin(s)) continue;
    if (inb(s.x0, s.y0) && !inb(s.x1, s.y1)) starts.push([[s.x0, s.y0], [s.x1, s.y1]]);
    else if (inb(s.x1, s.y1) && !inb(s.x0, s.y0)) starts.push([[s.x1, s.y1], [s.x0, s.y0]]);
  }
  for (const [A, B] of starts) {
    let prev = A, cur = B;
    for (let step = 0; step < 5; step++) {
      const d = dotAt(cur[0], cur[1]); if (d) return [d.x, d.y];
      let nxt = null;
      for (const s of ix.near(cur[0], cur[1], 1*U)) {
        if (!thin(s)) continue;
        for (const [P, Q] of [[[s.x0, s.y0], [s.x1, s.y1]], [[s.x1, s.y1], [s.x0, s.y0]]])
          if (Math.hypot(P[0] - cur[0], P[1] - cur[1]) < 0.3*U && Math.hypot(Q[0] - prev[0], Q[1] - prev[1]) > 0.5*U && Math.hypot(Q[0] - P[0], Q[1] - P[1]) > 1*U) nxt = Q;
      }
      if (!nxt) break;
      prev = cur; cur = nxt;
    }
  }
  return null;
}

/* la pared en el punto P: dirección, grosor y largo. Devuelve el polígono de la franja o null */
function wallAt(P, ix) {
  const [x, y] = P, R = 9*U, rows = [];
  for (const s of ix.near(x, y, R)) {
    if (s.L < 2*U) continue;
    let ux = (s.x1 - s.x0)/s.L, uy = (s.y1 - s.y0)/s.L;
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
    const t0 = (s.x0 - x)*ux + (s.y0 - y)*uy, t1 = (s.x1 - x)*ux + (s.y1 - y)*uy;
    if (Math.min(t0, t1) > 1*U || Math.max(t0, t1) < -1*U) continue;      // la línea debe pasar a la altura de P
    const off = (s.x0 - x)*(-uy) + (s.y0 - y)*ux;
    if (Math.abs(off) > R) continue;
    rows.push({ang:(Math.round(Math.atan2(uy, ux)*180/Math.PI) + 180) % 180, off, L:s.L, s});
  }
  // dirección dominante cerca del punto
  const score = new Map();
  for (const r of rows) if (Math.abs(r.off) < 4*U) score.set(r.ang, (score.get(r.ang) || 0) + r.L);
  let ang = null, best = 0;
  for (const [a, sc] of score) { let t = 0; for (const [b, v] of score) if (Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) <= 2) t += v; if (t > best) { best = t; ang = a; } }
  if (ang === null) return null;
  const par = rows.filter(r => Math.min(Math.abs(r.ang - ang), 180 - Math.abs(r.ang - ang)) <= 2);
  const ux = Math.cos(ang*Math.PI/180), uy = Math.sin(ang*Math.PI/180), nx = -uy, ny = ux;
  // grosor: líneas paralelas seguidas a cada lado, con huecos de hasta 3 pt (cámara de los postes)
  const offs = [...new Set(par.map(r => Math.round(((r.s.x0 - x)*nx + (r.s.y0 - y)*ny)*100)/100))].sort((a, b) => a - b);
  let lo = 0, hi = 0;
  for (const o of offs.filter(o => o > 0.15*U)) { if (o - hi <= 3*U) hi = o; else break; }
  for (const o of offs.filter(o => o < -0.15*U).reverse()) { if (lo - o <= 3*U) lo = o; else break; }
  if (hi - lo < 0.8*U) return null;
  // largo: las caras de la pared siguen mientras haya línea (huecos de hasta 1 pt) y sin línea transversal que la cierre
  const segs = ix.near(x, y, 450*U);
  const proj = s => [(s.x0 - x)*ux + (s.y0 - y)*uy, (s.x0 - x)*nx + (s.y0 - y)*ny, (s.x1 - x)*ux + (s.y1 - y)*uy, (s.x1 - x)*nx + (s.y1 - y)*ny];
  const face = off => {
    const iv = [];
    for (const s of segs) { const [a0, o0, a1, o1] = proj(s); if (Math.abs(o0 - off) < 0.15*U && Math.abs(o1 - off) < 0.15*U) iv.push([Math.min(a0, a1), Math.max(a0, a1)]); }
    iv.sort((a, b) => a[0] - b[0]);
    const m = [];
    for (const [a, b] of iv) { if (m.length && a <= m[m.length - 1][1] + 1*U) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); }
    return m.find(([a, b]) => a <= 0.6*U && b >= -0.6*U) || null;
  };
  const e1 = face(hi), e2 = face(lo), ex = [e1, e2].filter(Boolean);
  if (!ex.length) return null;
  let a = ex.length === 2 ? Math.max(e1[0], e2[0]) : ex[0][0], b = ex.length === 2 ? Math.min(e1[1], e2[1]) : ex[0][1];
  if (b - a < 2*U) { a = Math.min(...ex.map(e => e[0])); b = Math.max(...ex.map(e => e[1])); }
  // cortes: líneas transversales que cruzan todo el grosor (fin de la pared, cambio de tipo)
  const band = hi - lo;
  for (const s of segs) {
    const [a0, o0, a1, o1] = proj(s);
    if (Math.abs(a0 - a1) > 0.3*U) continue;                               // no es transversal
    const omin = Math.min(o0, o1), omax = Math.max(o0, o1);
    if (omin > lo + band*0.15 || omax < hi - band*0.15) continue;           // no cruza todo el grosor
    const t = (a0 + a1)/2;
    if (t > 1.5*U && t < b) b = t; else if (t < -1.5*U && t > a) a = t;
  }
  if (b - a < 1*U) return null;
  const pt = (t, o) => [x + ux*t + nx*o, y + uy*t + ny*o];
  return [pt(a, lo), pt(b, lo), pt(b, hi), pt(a, hi)].flat();
}

/* Analiza la lámina del plano A k: códigos con su resistencia, etiquetas encontradas y paredes. */
export async function analyzeTags(k = 'A') {
  const vec = await ensureVec(k);
  const words = await textRuns(k);
  const rate = ratings(words);
  const ix = segIndex(vec);
  const codes = new Map();
  for (const w of words) {
    if (!CODE_RE.test(w.t)) continue;
    const P = leaderPoint(w, ix);
    if (!P) continue;                                                       // texto suelto (tabla, notas)
    let c = codes.get(w.t); if (!c) codes.set(w.t, c = {code:w.t, h:rate.get(w.t) || 0, tags:0, walls:[], miss:0});
    c.tags++;
    const poly = wallAt(P, ix);
    if (!poly) { c.miss++; continue; }
    // la misma pared etiquetada dos veces: no se repite
    const cx = (poly[0] + poly[4])/2, cy = (poly[1] + poly[5])/2;
    if (c.walls.some(q => Math.hypot((q[0] + q[4])/2 - cx, (q[1] + q[5])/2 - cy) < 1*U)) continue;
    c.walls.push(poly.map(v => Math.round(v*10)/10));
  }
  for (const [code, h] of rate) if (!codes.has(code)) codes.set(code, {code, h, tags:0, walls:[], miss:0});
  return [...codes.values()].sort((a, b) => (b.h - a.h) || a.code.localeCompare(b.code));
}

/* formas sintéticas (una por pared) para la detección: se agregan al final, sobre todo lo demás */
const cache = new WeakMap();
export function tagShapes(fx) {
  if (!fx || !fx.tagw || !fx.tagw.length) return [];
  const hit = cache.get(fx.tagw); if (hit) return hit;
  const out = [];
  fx.tagw.forEach((g, gi) => g.walls.forEach((poly, wi) => {
    const xs = poly.filter((_, i) => !(i % 2)), ys = poly.filter((_, i) => i % 2);
    const sp = Float32Array.from([...poly, poly[0], poly[1]]);
    out.push({k:'f', c:'#000000', w:0, sp:[sp], cv:false, eo:false, bb:[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      key:TAG_PREFIX + g.code, i:1e7 + gi*1e4 + wi, sym:false, tag:g.code});
  }));
  cache.set(fx.tagw, out);
  return out;
}
export const isTagRule = r => String(r && r.key || '').startsWith(TAG_PREFIX);
export const hoursTxt = h => h ? `${h} ${h === 1 ? 'hora' : 'horas'}` : 'sin resistencia';
