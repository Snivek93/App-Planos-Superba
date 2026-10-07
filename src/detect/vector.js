/* Lectura vectorial del PDF (trazos, rellenos, rótulos de diámetro) y resaltado. */
import { isMobile, PDF_UNIT, pdfjsLib } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { blitPart, ctx, dirty, setWorld } from '../canvas/render.js';
import { planFrames } from '../plans/floors.js';
import { renderAuto } from '../panels/deteccion.js';
import { ensurePdf } from '../plans/load.js';
import { DB } from '../core/storage.js';

/* ---------- detección automática (PDF vectorial) ---------- */
export const FIRE_HL = '#FF2D3D';

export const PIPE_HL = ['#00A3FF', '#FF7A00', '#00B85C', '#C04BF2', '#E6B800', '#FF4FA3'];

export let pathCache;

export function hex2(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }

export function colorArgs(a) {
  if (!a) return null;
  if (typeof a[0] === 'string') return a[0].length === 7 ? a[0].toLowerCase() : null;
  if (a.length >= 3) return '#' + hex2(a[0]) + hex2(a[1]) + hex2(a[2]);
  return null;
}

export function mulT(m, n) { return [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]]; }

export function apT(m, x, y) { return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]]; }

/* Lee los trazos y rellenos del PDF. Es lento en planos grandes (segundos), por eso el
   resultado se guarda en el navegador y la próxima vez se abre al instante. */
const VEC_V = 2;
function vecKey(fileId, page) { return `vec:${fileId}#${page || 1}#v${VEC_V}`; }

export async function extractVec(pdf, pageNo) {
  const pg = await pdf.getPage(pageNo);
  const VT = pg.getViewport({scale:PDF_UNIT}).transform;
  const ol = await pg.getOperatorList();
  const O = pdfjsLib.OPS, fn = ol.fnArray, ar = ol.argsArray;
  let st = {ctm:[1,0,0,1,0,0], fill:'#000000', stroke:'#000000', lw:1};
  const stack = [], shapes = [];
  let path = [];
  const FILL = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const STROKE = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const EO = new Set([O.eoFill, O.eoFillStroke, O.closeEOFillStroke]);
  let curved = false;
  const pushShape = (kind, color, w, eo) => {
    if (!path.length || !color) return;
    const sp = path.filter(s => s.length >= 4);
    if (!sp.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of sp) for (let i = 0; i < s.length; i += 2) { const x = s[i], y = s[i+1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const wr = kind === 's' ? Math.round(w*10)/10 : 0;
    shapes.push({k:kind, c:color, w:wr, sp, cv:curved, eo: !!eo, bb:[x0, y0, x1, y1]});
  };
  const paint = f => {
    if (FILL.has(f)) pushShape('f', st.fill, 0, EO.has(f));
    if (STROKE.has(f)) { const sc = Math.sqrt(Math.abs(st.ctm[0]*st.ctm[3] - st.ctm[1]*st.ctm[2])) || 1; pushShape('s', st.stroke, Math.max(st.lw*sc, 0.1)*PDF_UNIT); }
    path = []; curved = false;
  };
  for (let i = 0; i < fn.length; i++) {
    const f = fn[i], a = ar[i];
    if (f === O.save) stack.push({...st, ctm:st.ctm.slice()});
    else if (f === O.restore) { if (stack.length) st = stack.pop(); }
    else if (f === O.transform) st.ctm = mulT(st.ctm, a);
    else if (f === O.paintFormXObjectBegin) { stack.push({...st, ctm:st.ctm.slice()}); if (a && a[0] && a[0].length === 6) st.ctm = mulT(st.ctm, a[0]); }
    else if (f === O.paintFormXObjectEnd) { if (stack.length) st = stack.pop(); }
    else if (f === O.setLineWidth) st.lw = a[0];
    else if (f === O.setFillRGBColor) st.fill = colorArgs(a);
    else if (f === O.setStrokeRGBColor) st.stroke = colorArgs(a);
    else if (f === O.setFillColorN) st.fill = null;
    else if (f === O.setStrokeColorN) st.stroke = null;
    else if (f === O.constructPath && !Array.isArray(a[0])) {
      // pdf.js 4.10+: [operador de pintura, [datos del trazo], minMax]
      const d = a[1] && a[1][0], T = mulT(VT, st.ctm);
      let curSp = null;
      if (d) for (let j = 0; j < d.length;) {
        const op = d[j++];
        if (op === 0) { const q = apT(T, d[j], d[j+1]); j += 2; curSp = [q[0], q[1]]; path.push(curSp); }
        else if (op === 1) { const q = apT(T, d[j], d[j+1]); j += 2; if (!curSp) { curSp = []; path.push(curSp); } curSp.push(q[0], q[1]); }
        else if (op === 2) { curved = true; const q = apT(T, d[j+4], d[j+5]); j += 6; if (curSp) curSp.push(q[0], q[1]); }
        else if (op === 3) { curved = true; const q = apT(T, d[j+2], d[j+3]); j += 4; if (curSp) curSp.push(q[0], q[1]); }
        else if (op === 4) { if (curSp && curSp.length >= 2) curSp.push(curSp[0], curSp[1]); }
        else break;
      }
      paint(a[0]);
    }
    else if (f === O.constructPath) {
      const ops = a[0], c = a[1], T = mulT(VT, st.ctm);
      let j = 0, curSp = null;
      const P = (x, y) => apT(T, x, y);
      for (const op of ops) {
        if (op === O.moveTo) { const q = P(c[j], c[j+1]); curSp = [q[0], q[1]]; path.push(curSp); j += 2; }
        else if (op === O.lineTo) { const q = P(c[j], c[j+1]); if (!curSp) { curSp = []; path.push(curSp); } curSp.push(q[0], q[1]); j += 2; }
        else if (op === O.curveTo) { curved = true; const q = P(c[j+4], c[j+5]); if (curSp) curSp.push(q[0], q[1]); j += 6; }
        else if (op === O.curveTo2 || op === O.curveTo3) { curved = true; const q = P(c[j+2], c[j+3]); if (curSp) curSp.push(q[0], q[1]); j += 4; }
        else if (op === O.closePath) { if (curSp && curSp.length >= 2) curSp.push(curSp[0], curSp[1]); }
        else if (op === O.rectangle) {
          const x = c[j], y = c[j+1], w = c[j+2], h = c[j+3]; j += 4;
          const q = [P(x, y), P(x+w, y), P(x+w, y+h), P(x, y+h)];
          curSp = [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1], q[0][0], q[0][1]]; path.push(curSp); curSp = null;
        }
      }
    }
    else if (FILL.has(f) || STROKE.has(f) || f === O.endPath) paint(f);
  }
  return shapes.map(s => ({...s, sp: s.sp.map(a => Float32Array.from(a))}));
}
function buildVec(shapes, page) {
  const byKey = new Map();
  shapes.forEach((s, i) => {
    s.i = i; s.key = s.k === 'f' ? 'f' + s.c : 's' + s.c + '/' + s.w.toFixed(1);
    if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push(s);
  });
  return {page, shapes, byKey, ev:new Map()};
}
export function hasVec(fileId, page) { return DB.has(vecKey(fileId, page)); }
/* Guarda en segundo plano la lectura vectorial de un archivo que todavía no la tiene. */
export async function prepareVec(fileId, page, pdf) {
  const key = vecKey(fileId, page);
  if (await DB.has(key)) return false;
  const shapes = await extractVec(pdf, page);
  await DB.put(key, {shapes});
  return true;
}

export async function ensureVec(k) {
  const rt = RT[k], p = S.plans[k];
  if (!rt.bmp) throw new Error(`Primero suba el plano ${k}.`);
  if (!rt.isPdf) throw new Error(`La detección automática necesita que el plano ${k} sea un PDF exportado desde CAD o Revit. Con imágenes se marca a mano.`);
  if (rt.vec && rt.vec.page === p.page) return rt.vec;
  if (rt.vecLoading) return rt.vecLoading;
  rt.vecLoading = (async () => {
    const fileId = rt.fileId || p.fileId, page = p.page;
    const rec = fileId ? await DB.get(vecKey(fileId, page)) : null;
    let shapes = rec && rec.shapes;
    if (!shapes) {
      shapes = await extractVec(await ensurePdf(rt), page);
      if (fileId) DB.put(vecKey(fileId, page), {shapes});
    }
    rt.vec = buildVec(shapes, page);
    for (const [id, v] of pathCache) if (v.plan === k) pathCache.delete(id);
    rt.hl = null;
    return rt.vec;
  })();
  try { return await rt.vecLoading; } finally { rt.vecLoading = null; }
}

export function undouble(s) {
  for (const k of [3, 2]) {
    if (s.length < k*2 || s.length % k) continue;
    let ok = true;
    for (let i = 0; i < s.length && ok; i += k) for (let j = 1; j < k; j++) if (s[i+j] !== s[i]) { ok = false; break; }
    if (ok) { let o = ''; for (let i = 0; i < s.length; i += k) o += s[i]; return o; }
  }
  return s;
}

export const DIAM_RE = /[øØ⌀Φφ∅]\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(mm|"|”|''|pulg|in)?/g;

export function diamLabel(v, unit) {
  v = v.replace(/\s+/g, '').replace(',', '.');
  const inch = /\//.test(v) || (unit && unit !== 'mm');
  return inch ? `ø${v}"` : `ø${v} mm`;
}

export async function ensureLabels(k) {
  const rt = RT[k], p = S.plans[k];
  if (rt.labels && rt.labels.page === p.page) return rt.labels.list;
  const pg = await (await ensurePdf(rt)).getPage(p.page);
  const VT = pg.getViewport({scale:PDF_UNIT}).transform;
  const tc = await pg.getTextContent();
  const runs = [];
  let cur = null;
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    const t = it.transform, h = Math.hypot(t[2], t[3]) || 4, dx = t[0]/(Math.hypot(t[0], t[1]) || 1), dy = t[1]/(Math.hypot(t[0], t[1]) || 1);
    const sx = t[4], sy = t[5], ex = sx + dx*it.width, ey = sy + dy*it.width;
    if (cur && Math.hypot(sx - cur.ex, sy - cur.ey) < h*1.3) { cur.str += it.str; cur.ex = ex; cur.ey = ey; }
    else { cur = {str:it.str, sx, sy, ex, ey, h}; runs.push(cur); }
  }
  const list = [];
  for (const r of runs) {
    const s = undouble(r.str);
    DIAM_RE.lastIndex = 0; let mt;
    while ((mt = DIAM_RE.exec(s))) {
      const mx = (r.sx + r.ex)/2 + 0, my = (r.sy + r.ey)/2 + r.h*0.35;
      const q = apT(VT, mx, my);
      list.push({x:q[0], y:q[1], d:diamLabel(mt[1], mt[2])});
    }
  }
  rt.labels = {page:p.page, list};
  return list;
}

/* Símbolos pequeños que comparten color con las paredes pero no son paredes:
   círculos de nivel (N.L.T.), puntas de flecha (pendientes de parqueo), triángulos, puntos de etiqueta.
   Criterio: menos de ~9 mm en la lámina y con curvas o con lados que no son horizontales/verticales.
   Las columnas y trozos de pared (rectángulos) no se filtran; esos se quitan a mano si hace falta. */
const SYMBOL_MAX = 26*PDF_UNIT; // ≈ 9 mm en el papel
export function isSymbol(sh) {
  if (sh.sym !== undefined) return sh.sym;
  const w = sh.bb[2] - sh.bb[0], h = sh.bb[3] - sh.bb[1], m = Math.max(w, h);
  let sym = false;
  if (m < SYMBOL_MAX) {
    if (sh.cv) sym = true;
    else {
      const tol = Math.max(0.6, m*0.02);
      outer: for (const sp of sh.sp) for (let i = 2; i < sp.length; i += 2) {
        const dx = Math.abs(sp[i] - sp[i-2]), dy = Math.abs(sp[i+1] - sp[i-1]);
        if (dx > tol && dy > tol) { sym = true; break outer; } // lado inclinado
      }
    }
  }
  return (sh.sym = sym);
}
export const isDot = isSymbol;

/* Ajustes manuales de las paredes (herramienta "Afinar paredes"): elementos quitados y zonas borradas.
   Se guardan por archivo y página del plano A, porque los números de forma dependen del PDF. */
export function fireEdits(k = 'A') {
  if (k !== 'A') return null;
  const fx = S.auto.fx, src = RT.A.fileId ? RT.A.fileId + '#' + (S.plans.A.page || 1) : null;
  if (!fx || !src || fx.src !== src) return null;
  return fx;
}
function editsSig(fx) { return fx ? fx.src + ':' + fx.excl.length + ':' + fx.masks.length + ':' + (fx.v || 0) : ''; }

/* Qué se ve de cada estilo elegido, en el orden en que el PDF dibuja: si después de una pared
   se dibuja otro relleno encima (columna, otra pared, un parche blanco), esa parte queda tapada
   en el plano y tampoco se resalta. Así no aparecen recuadros en esquinas ni encuentros. */
export function visibleEvents(vec, rules, fx) {
  const sig = rules.map(r => r.id + ':' + r.key + ':' + (r.noDots !== false)).join('|') + '#' + editsSig(fx);
  const hit = vec.ev.get(sig); if (hit) return hit;
  const byKey = new Map(rules.map(r => [r.key, r]));
  const excl = fx ? new Set(fx.excl) : null;
  const bbs = [];
  for (const s of vec.shapes) {
    const r = byKey.get(s.key);
    if (r && !(r.noDots !== false && isSymbol(s)) && !(excl && excl.has(s.i))) bbs.push(s.bb);
  }
  const U = bbs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const over = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const ev = []; let started = false, count = 0;
  for (const s of vec.shapes) {
    const r = byKey.get(s.key);
    if (r) {
      if (r.noDots !== false && isSymbol(s)) continue;
      if (excl && excl.has(s.i)) continue;
      ev.push([s, r]); started = true; count++; continue;
    }
    if (!started || s.k !== 'f' || !over(s.bb, U)) continue;
    if (bbs.some(b => over(s.bb, b))) ev.push([s, null]);
  }
  ev.count = count; ev.bb = U;
  vec.ev.set(sig, ev);
  return ev;
}
function tracePath(g, s) {
  g.beginPath();
  for (const sp of s.sp) { g.moveTo(sp[0], sp[1]); for (let i = 2; i < sp.length; i += 2) g.lineTo(sp[i], sp[i+1]); if (s.k === 'f') g.closePath(); }
}
/* Pinta los eventos en g (ya transformado a coordenadas del plano). minW: grosor mínimo en unidades del plano. */
export function paintEvents(g, ev, colorOf, minW, fx) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [s, r] of ev) {
    tracePath(g, s);
    if (r) {
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = g.strokeStyle = colorOf(r);
      if (s.k === 'f') g.fill(s.eo ? 'evenodd' : 'nonzero');
      g.lineWidth = Math.max(s.w || 0, minW); g.stroke();
    } else {
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
      g.fill(s.eo ? 'evenodd' : 'nonzero');
    }
  }
  if (fx && fx.masks.length) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; for (const m of fx.masks) g.fillRect(m[0], m[1], m[2]-m[0], m[3]-m[1]); }
  g.globalCompositeOperation = 'source-over';
}

export function ruleCache(rule) {
  const rt = RT[rule.plan];
  if (!rt.vec) return null;
  const fx = rule.plan === 'A' ? fireEdits('A') : null;
  const sig = editsSig(fx) + '|' + (rule.noDots !== false);
  let c = pathCache.get(rule.id);
  if (c && c.vec === rt.vec && c.sig === sig) return c;
  const ev = visibleEvents(rt.vec, [rule], fx);
  c = {vec:rt.vec, sig, plan:rule.plan, count:ev.count, bb:ev.bb, k:rule.kind, w:rule.w || 0};
  pathCache.set(rule.id, c);
  return c;
}

export function autoRules() { return [...S.auto.fire.map(r => [r, true]), ...S.auto.pipes.map(r => [r, false])]; }

/* Capa de resaltado de un plano (paredes en rojo, tuberías en su color), como imagen transparente. */
export function overlayCanvas(k, rules, maxPx) {
  const rt = RT[k], p = S.plans[k];
  if (!rt.vec || !rules.length) return null;
  const fx = fireEdits(k);
  const ev = visibleEvents(rt.vec, rules.map(([r]) => r), fx);
  const fire = new Set(rules.filter(([, f]) => f).map(([r]) => r));
  const sc = Math.min(1, maxPx/Math.max(p.w, p.h));
  const c = document.createElement('canvas'); c.width = Math.ceil(p.w*sc); c.height = Math.ceil(p.h*sc);
  const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0);
  paintEvents(g, ev, r => fire.has(r) ? FIRE_HL : (r.hl || PIPE_HL[0]), (fire.size ? 1.5 : 2.6)/sc, fx);
  return {c, sc};
}

export const hlOverlay = {A:null, B:null};

export function overlayFor(k) {
  const rt = RT[k], p = S.plans[k];
  if (!rt.vec) return null;
  const rules = autoRules().filter(([r]) => r.on && r.plan === k);
  if (!rules.length) return null;
  const sig = rules.map(([r, f]) => [r.id, r.key, r.noDots, f ? FIRE_HL : r.hl].join(':')).join('|') + '|' + p.w + 'x' + p.h + '|' + editsSig(fireEdits(k));
  const o = rt.hl;
  if (o && o.sig === sig && o.vec === rt.vec) return o;
  const oc = overlayCanvas(k, rules, isMobile ? 3000 : 4096);
  return (rt.hl = {sig, vec:rt.vec, c:oc.c, sc:oc.sc});
}

export function drawAutoHighlights() {
  if (!S.auto.show) return;
  S.auto.pipes.forEach((r, i) => r.hl = PIPE_HL[i % PIPE_HL.length]);
  for (const k of ['A', 'B']) {
    if (!RT[k].bmp || !S.plans[k].visible) continue;
    const o = overlayFor(k); if (!o) continue;
    const p = S.plans[k];
    for (const [fr, clip] of planFrames(k)) {
      ctx.save(); setWorld(fr);
      ctx.globalAlpha = k === 'A' ? 0.5 : 0.8;
      blitPart(o.c, p, fr, clip);
      ctx.restore();
    }
  }
}

export function needVecInBackground() {
  for (const [r] of autoRules()) {
    const rt = RT[r.plan];
    if (rt.isPdf && rt.bmp && !rt.vec && !rt.vecLoading) ensureVec(r.plan).then(() => { renderAuto(); dirty(); }).catch(() => {});
  }
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  pathCache = new Map();
}
