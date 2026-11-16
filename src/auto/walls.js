/* Modo automático: paredes cortafuego de un arquitectónico.
   - guessFireRules: si la hoja no tiene paredes elegidas, las busca por la simbología del plano
     ("pared con resistencia al fuego…" con su muestra de color al lado).
   - arqContext: abre la hoja por detrás con la misma maquinaria del editor (mismas paredes, cargadores y
     ajustes que ve el usuario) y arma la máscara de paredes, la rejilla de líneas y los ejes. */
import { P, RT, S, uid } from '../core/state.js';
import { PDF_UNIT } from '../core/constants.js';
import { save } from '../core/storage.js';
import { ensurePdf } from '../plans/load.js';
import { ensureLintels, ensureVec, fillColors, fireEdits, maskByPlan, paintCover, paintExtras, visibleEvents } from '../detect/vector.js';
import { paintRules } from '../detect/cross.js';
import { openSheet } from '../project/sheets.js';
import { closeGaps, makeMask, wallThickness } from './engine.js';
import { occupancy, sheetAxes } from './align.js';
import { isGray } from './styles.js';
import { textRuns } from './text.js';

const FIRE_RE = /RESISTEN\w*\s+(?:A\s+|AL\s+)?FUEGO|CORTA\s*-?\s*FUEGO|(?:PARED(?:ES)?|MURO)\s+R\.?F\.?\b|\bF\s*-?\s*RATING/i, NOT_WALL = /HUMO|PUERTA|VENTANA|VIDRIO|SELLO|CIELO|LOSA|COMPUERTA|DAMPER/i;
function hue(c) { const n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, mx = Math.max(r, g, b), ch = mx - Math.min(r, g, b); if (ch < 24) return -1; const h = mx === r ? ((g - b)/ch) % 6 : mx === g ? (b - r)/ch + 2 : (r - g)/ch + 4; return (h*60 + 360) % 360; }
/* Reglas de pared a partir de la simbología. byKey: Map estilo → formas; lines: textos de la página. */
export function guessFireRules(byKey, lines) {
  const fills = [];
  for (const [key, shapes] of byKey) {
    if (key[0] !== 'f') continue;
    const c = key.slice(1, 8); if (/^#(fff|000)/i.test(c) && /^#(ffffff|000000)$/i.test(c)) continue;
    for (const s of shapes) { const w = s.bb[2] - s.bb[0], h = s.bb[3] - s.bb[1]; if (w >= 16 && w <= 420 && h >= 6 && h <= 140) fills.push({key, c, s, n: shapes.length}); }
  }
  const rules = [];
  for (const t of lines) {
    if (!FIRE_RE.test(t.s) || NOT_WALL.test(t.s)) continue;
    let best = null, bd = Infinity;
    for (const f of fills) {
      const b = f.s.bb, cy = (b[1] + b[3])/2, dx = t.x0 - b[2];
      if (dx < -8 || dx > 520 || Math.abs(cy - t.y) > Math.max(t.h*1.6, 14)) continue;
      if (dx < bd) { bd = dx; best = f; }
    }
    if (!best) continue;
    if (best.n < 8) {
      // la muestra de la simbología a veces viene en un tono algo distinto al de las paredes: se toma el relleno
      // del plano con el tono más parecido
      const h0 = hue(best.c); let alt = null, an = 0;
      if (h0 >= 0) for (const [key, shapes] of byKey) {
        if (key[0] !== 'f' || shapes.length < 8) continue;
        const h = hue(key.slice(1, 8)); if (h < 0) continue;
        let d = Math.abs(h - h0); if (d > 180) d = 360 - d;
        if (d <= 15 && shapes.length > an) { an = shapes.length; alt = {key, c: key.slice(1, 8)}; }
      }
      if (!alt) continue;
      best = alt;
    }
    if (rules.some(r => r.key === best.key)) continue;
    const hm = t.s.match(/(\d)\s*(?:H(?:ORA|R)?S?)\b/i);
    rules.push({id: 'r' + uid(), plan: 'A', key: best.key, kind: 'f', color: best.c, w: 0, name: `Pared cortafuego${hm ? ` ${hm[1]} ${hm[1] === '1' ? 'hora' : 'horas'}` : ''}`, on: true, noDots: false, auto: true, gray: isGray(best.c)});
  }
  return rules;
}

const LINT = 'Cargador sobre puerta', ADD = 'Pared agregada a mano';
/* Abre el arquitectónico por detrás y devuelve lo que necesita el cálculo. null si no hay paredes elegidas. */
export async function arqContext(arq) {
  await openSheet(arq.id, {quiet: true});
  if (P.active !== arq.id || !RT.A.bmp) throw new Error('No se pudo abrir el arquitectónico.');
  if (!RT.A.isPdf) throw new Error('El arquitectónico no es un PDF.');
  const vec = await ensureVec('A');
  const pdf = await ensurePdf(RT.A), pg = await pdf.getPage(S.plans.A.page || 1);
  const txt = textRuns(await pg.getTextContent(), pg.getViewport({scale: PDF_UNIT}).transform, PDF_UNIT);
  if (!S.auto.fire.some(r => r.on)) {
    const found = guessFireRules(vec.byKey, txt.lines);
    if (!found.length) return null;
    S.auto.fire = found; save();
  }
  const rules = S.auto.fire.filter(r => r.on), p = S.plans.A, rt = RT.A;
  const extras = ensureLintels('A');
  const k = Math.min(1, Math.sqrt(30e6/(p.w*p.h))), W = Math.ceil(p.w*k), H = Math.ceil(p.h*k), d = new Uint8Array(W*H);
  const fr = {...p, x: 0, y: 0, s: 1, r: 0}, TS = 2048, cols = fillColors(rules), ev = visibleEvents(vec, rules, fireEdits('A'));
  const mk = () => { const c = document.createElement('canvas'); c.width = TS; c.height = TS; return c; };
  const c1 = mk(), c2 = mk(), g = c1.getContext('2d', {willReadFrequently: true}), g2 = c2.getContext('2d', {willReadFrequently: true});
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let ty = 0; ty < H; ty += TS) for (let tx = 0; tx < W; tx += TS) {
    const w = Math.min(TS, W - tx), h = Math.min(TS, H - ty);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, TS, TS);
    paintRules(g, rules, r => `rgb(${(rules.indexOf(r) + 1)*12},0,0)`, k, tx/k, ty/k, 1, fr, null);
    const F = g.getImageData(0, 0, w, h).data;
    if (cols.length) {
      // misma comprobación que el resaltado: solo cuenta lo que en el plano se ve del color de la pared
      g2.setTransform(1, 0, 0, 1, 0, 0); g2.fillStyle = '#fff'; g2.fillRect(0, 0, TS, TS);
      g2.setTransform(k, 0, 0, k, -tx, -ty); g2.drawImage(rt.bmp, 0, 0, p.w, p.h);
      paintCover(g2, ev, cols[0]);
      maskByPlan(F, g2.getImageData(0, 0, w, h).data, w, h, cols);
    }
    let E = null;
    if (extras.lint.length || extras.adds.length) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, TS, TS); g.setTransform(k, 0, 0, k, -tx, -ty);
      paintExtras(g, extras, 'rgb(240,0,0)', 'rgb(252,0,0)');
      E = g.getImageData(0, 0, w, h).data;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y*w + x)*4; let v = 0;
      if (F[i+3] > 60) v = Math.max(1, Math.min(rules.length, Math.round(F[i]/12)));
      if (E && E[i+3] > 60) v = E[i] >= 246 ? 251 : 250;
      if (!v) continue;
      d[(ty + y)*W + tx + x] = v;
      const X = tx + x, Y = ty + y; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
  }
  c1.width = c1.height = c2.width = c2.height = 0;
  if (x1 < 0) return null;
  closeGaps(d, W, H, Math.round(6*k));
  const mask = makeMask(d, W, H, k), tw = wallThickness(mask);
  let u = tw/5; u = u > 0.8 && u < 1.25 ? 1 : Math.max(0.6, Math.min(4, u));
  return {id: arq.id, W: p.w, H: p.h, mask, occ: occupancy(vec.shapes, p.w, p.h, 2), axes: sheetAxes(txt.items, vec.shapes), u,
    bbox: [x0/k, y0/k, x1/k, y1/k], wallName: v => v === 250 ? LINT : v === 251 ? ADD : (rules[v - 1] || rules[0]).name,
    rules: rules.map(r => r.name), guessed: rules.some(r => r.auto)};
}
