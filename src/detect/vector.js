/* Lectura vectorial del PDF (trazos, rellenos, rótulos de diámetro) y resaltado. */
import { isMobile, PDF_UNIT, pdfjsLib } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { blitPart, ctx, dirty, setWorld } from '../canvas/render.js';
import { planFrames } from '../plans/floors.js';
import { renderAuto } from '../panels/deteccion.js';

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

export async function ensureVec(k) {
  const rt = RT[k], p = S.plans[k];
  if (!rt.bmp) throw new Error(`Primero suba el plano ${k}.`);
  if (!rt.pdf) throw new Error(`La detección automática necesita que el plano ${k} sea un PDF exportado desde CAD o Revit. Con imágenes se marca a mano.`);
  if (rt.vec && rt.vec.page === p.page) return rt.vec;
  if (rt.vecLoading) return rt.vecLoading;
  rt.vecLoading = (async () => {
    const pg = await rt.pdf.getPage(p.page);
    const VT = pg.getViewport({scale:PDF_UNIT}).transform;
    const ol = await pg.getOperatorList();
    const O = pdfjsLib.OPS, fn = ol.fnArray, ar = ol.argsArray;
    let st = {ctm:[1,0,0,1,0,0], fill:'#000000', stroke:'#000000', lw:1};
    const stack = [], shapes = [];
    let path = [];
    const FILL = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    const STROKE = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
    let curved = false;
    const pushShape = (kind, color, w) => {
      if (!path.length || !color) return;
      const sp = path.filter(s => s.length >= 4);
      if (!sp.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of sp) for (let i = 0; i < s.length; i += 2) { const x = s[i], y = s[i+1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const wr = kind === 's' ? Math.round(w*10)/10 : 0;
      shapes.push({k:kind, c:color, w:wr, sp, cv:curved, bb:[x0, y0, x1, y1], key: kind === 'f' ? 'f' + color : 's' + color + '/' + wr.toFixed(1)});
    };
    const paint = f => {
      if (FILL.has(f)) pushShape('f', st.fill, 0);
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
    const byKey = new Map();
    for (const s of shapes) { if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push(s); }
    rt.vec = {page:p.page, shapes, byKey};
    for (const [id, v] of pathCache) if (v.plan === k) pathCache.delete(id);
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
  const pg = await rt.pdf.getPage(p.page);
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

// puntos y círculos pequeños, como los de las etiquetas de tipo de pared
export function isDot(sh) {
  const w = sh.bb[2] - sh.bb[0], h = sh.bb[3] - sh.bb[1], m = Math.max(w, h);
  return sh.cv && m < 16*PDF_UNIT && Math.abs(w - h) <= m*0.25;
}

export function ruleCache(rule) {
  const rt = RT[rule.plan];
  if (!rt.vec) return null;
  let c = pathCache.get(rule.id);
  if (c && c.vec === rt.vec) return c;
  const shapes = (rt.vec.byKey.get(rule.key) || []).filter(sh => rule.noDots === false || !isDot(sh));
  const path = new Path2D();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    for (const sp of s.sp) { path.moveTo(sp[0], sp[1]); for (let i = 2; i < sp.length; i += 2) path.lineTo(sp[i], sp[i+1]); if (s.k === 'f') path.closePath(); }
    x0 = Math.min(x0, s.bb[0]); y0 = Math.min(y0, s.bb[1]); x1 = Math.max(x1, s.bb[2]); y1 = Math.max(y1, s.bb[3]);
  }
  c = {vec:rt.vec, plan:rule.plan, path, count:shapes.length, bb:[x0, y0, x1, y1], k:rule.kind, w:rule.w || 0};
  pathCache.set(rule.id, c);
  return c;
}

export function autoRules() { return [...S.auto.fire.map(r => [r, true]), ...S.auto.pipes.map(r => [r, false])]; }

export const hlOverlay = {A:null, B:null};

export function overlayFor(k) {
  const rt = RT[k], p = S.plans[k];
  if (!rt.vec) return null;
  const rules = autoRules().filter(([r]) => r.on && r.plan === k);
  if (!rules.length) return null;
  const sig = rules.map(([r, f]) => [r.id, r.key, r.noDots, f ? FIRE_HL : r.hl].join(':')).join('|') + '|' + p.w + 'x' + p.h;
  const o = hlOverlay[k];
  if (o && o.sig === sig && o.vec === rt.vec) return o;
  const sc = Math.min(1, (isMobile ? 3000 : 4096)/Math.max(p.w, p.h));
  const c = document.createElement('canvas'); c.width = Math.ceil(p.w*sc); c.height = Math.ceil(p.h*sc);
  const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0); g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [r, isFire] of rules) {
    const rc = ruleCache(r); if (!rc) continue;
    g.fillStyle = g.strokeStyle = isFire ? FIRE_HL : r.hl;
    g.lineWidth = Math.max(rc.w, (isFire ? 1.5 : 2.6)/sc);
    if (rc.k === 'f') g.fill(rc.path);
    g.stroke(rc.path);
  }
  return (hlOverlay[k] = {sig, vec:rt.vec, c, sc});
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
    if (rt.pdf && rt.bmp && !rt.vec && !rt.vecLoading) ensureVec(r.plan).then(() => { renderAuto(); dirty(); }).catch(() => {});
  }
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  pathCache = new Map();
}
