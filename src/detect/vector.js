/* Lectura vectorial del PDF (trazos, rellenos, rótulos de diámetro) y resaltado. */
import { isMobile, PDF_UNIT, pdfjsLib } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { blitPart, ctx, dirty, setWorld } from '../canvas/render.js';
import { planFrames, solo } from '../plans/floors.js';
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
const VEC_V = 3; // 3: guarda la transparencia de los rellenos
function vecKey(fileId, page) { return `vec:${fileId}#${page || 1}#v${VEC_V}`; }

export async function extractVec(pdf, pageNo) {
  const pg = await pdf.getPage(pageNo);
  const VT = pg.getViewport({scale:PDF_UNIT}).transform;
  const ol = await pg.getOperatorList();
  const O = pdfjsLib.OPS, fn = ol.fnArray, ar = ol.argsArray;
  let st = {ctm:[1,0,0,1,0,0], fill:'#000000', stroke:'#000000', lw:1, ca:1};
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
    const sh = {k:kind, c:color, w:wr, sp, cv:curved, eo: !!eo, bb:[x0, y0, x1, y1]};
    if (kind === 'f' && st.ca < 0.95) sh.a = st.ca; // relleno semitransparente: deja ver lo de abajo
    shapes.push(sh);
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
    else if (f === O.setGState) { for (const kv of (a && a[0]) || []) if (kv && kv[0] === 'ca' && typeof kv[1] === 'number') st.ca = kv[1]; }
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
function dropOldVec(fileId, page) { for (let v = 1; v < VEC_V; v++) DB.delPrefix(`vec:${fileId}#${page || 1}#v${v}`).catch(() => {}); }
export function hasVec(fileId, page) { return DB.has(vecKey(fileId, page)); }
/* Guarda en segundo plano la lectura vectorial de un archivo que todavía no la tiene. */
export async function prepareVec(fileId, page, pdf) {
  const key = vecKey(fileId, page);
  if (await DB.has(key)) return false;
  const shapes = await extractVec(pdf, page);
  await DB.put(key, {shapes}); dropOldVec(fileId, page);
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
      if (fileId) { DB.put(vecKey(fileId, page), {shapes}); dropOldVec(fileId, page); }
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
  const ev = [], cover = []; let started = false, count = 0;
  for (const s of vec.shapes) {
    const r = byKey.get(s.key);
    if (r) {
      if (r.noDots !== false && isSymbol(s)) continue;
      if (excl && excl.has(s.i)) continue;
      ev.push([s, r]); started = true; count++; continue;
    }
    if (!started || s.k !== 'f' || s.a !== undefined || !over(s.bb, U)) continue;
    if (!bbs.some(b => over(s.bb, b))) continue;
    // puntos, etiquetas y otros símbolos dibujados encima de la pared no la cortan: la pared sigue corrida debajo
    if (isSymbol(s)) cover.push(s); else ev.push([s, null]);
  }
  ev.count = count; ev.bb = U; ev.cover = cover;
  vec.ev.set(sig, ev);
  return ev;
}
/* Repinta en la copia del plano, con el color de la pared, los símbolos que la tapan (puntos, rombos de
   etiqueta), para que la comprobación de color no corte la pared en esos lugares. */
export function paintCover(g, ev, color) {
  if (!ev.cover || !ev.cover.length || !color) return;
  g.fillStyle = g.strokeStyle = color; g.lineWidth = 1;
  for (const s of ev.cover) { tracePath(g, s); g.fill(s.eo ? 'evenodd' : 'nonzero'); g.stroke(); }
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

/* Comprobación final contra el plano dibujado: solo queda resaltado donde el plano realmente muestra
   el color de la pared. Corrige lo que la lectura vectorial no puede saber: partes recortadas por el PDF,
   imágenes o achurados dibujados encima, etc. (los recuadros en esquinas). Solo para estilos de relleno.
   data: píxeles del resaltado (se modifican); plan: píxeles del plano en el mismo lugar. */
export function maskByPlan(data, plan, W, H, colors) {
  if (!colors.length) return;
  const rgb = colors.map(c => { const n = parseInt(String(c).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const T2 = 80*80, ok = new Uint8Array(W*H);
  for (let i = 0, n = W*H; i < n; i++) {
    if (!data[i*4+3]) continue;
    const r = plan[i*4], g = plan[i*4+1], b = plan[i*4+2];
    for (const c of rgb) { const dr = r - c[0], dg = g - c[1], db = b - c[2]; if (dr*dr + dg*dg + db*db < T2) { ok[i] = 1; break; } }
  }
  // tolerancia de 2 píxeles para bordes suavizados y achurados finos sobre la pared
  const R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y*W + x;
    if (!data[i*4+3] || ok[i]) continue;
    let near = false;
    for (let dy = -R; dy <= R && !near; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx >= 0 && xx < W && ok[yy*W + xx]) { near = true; break; } } }
    if (!near) data[i*4+3] = 0;
  }
}
/* Igual que maskByPlan, pero comparando contra el plano a su resolución completa (rt.bmp), para que
   las paredes delgadas no se pierdan al reducir la imagen. data: resaltado W×H (escala W/bmp.width). */
export function maskByPlanFull(data, W, H, bmp, colors, cover) {
  if (!colors.length) return;
  const BW = bmp.width, BH = bmp.height, k = W/BW;
  const t = document.createElement('canvas'); t.width = BW; t.height = BH;
  const tg = t.getContext('2d', {willReadFrequently:true}); tg.drawImage(bmp, 0, 0);
  if (cover) { tg.save(); tg.setTransform(cover.sc, 0, 0, cover.sc, 0, 0); paintCover(tg, cover.ev, colors[0]); tg.restore(); }
  const rgb = colors.map(c => { const n = parseInt(String(c).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const T2 = 80*80, ok = new Uint8Array(W*H);
  const STRIP = 256;
  for (let sy = 0; sy < BH; sy += STRIP) {
    const sh = Math.min(STRIP + 2, BH - sy), P = tg.getImageData(0, sy, BW, sh).data;
    // filas del resaltado cuyo píxel cae en esta franja
    const y0 = Math.floor(sy*k), y1 = Math.min(H - 1, Math.floor((sy + STRIP)*k));
    for (let y = y0; y <= y1; y++) {
      const ny0 = Math.max(sy, Math.floor(y/k) - 1), ny1 = Math.min(sy + sh - 1, Math.ceil((y + 1)/k));
      for (let x = 0; x < W; x++) {
        const i = y*W + x; if (!data[i*4+3] || ok[i]) continue;
        const nx0 = Math.max(0, Math.floor(x/k) - 1), nx1 = Math.min(BW - 1, Math.ceil((x + 1)/k));
        search: for (let ny = ny0; ny <= ny1; ny++) for (let nx = nx0; nx <= nx1; nx++) {
          const j = ((ny - sy)*BW + nx)*4, r = P[j], g = P[j+1], b = P[j+2];
          for (const c of rgb) { const dr = r - c[0], dg = g - c[1], db = b - c[2]; if (dr*dr + dg*dg + db*db < T2) { ok[i] = 1; break search; } }
        }
      }
    }
  }
  t.width = t.height = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y*W + x; if (!data[i*4+3] || ok[i]) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W && ok[yy*W + xx]) { near = true; break; } } }
    if (!near) data[i*4+3] = 0;
  }
}
export function fillColors(rules) { return [...new Set(rules.filter(r => r.kind === 'f' && /^f#[0-9a-f]{6}/i.test(r.key || '')).map(r => r.key.slice(1, 8)))]; }

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
  const cols = fillColors(rules.map(([r]) => r));
  if (cols.length && rt.bmp) {
    try {
      const g2 = c.getContext('2d', {willReadFrequently:true}), O = g2.getImageData(0, 0, c.width, c.height);
      maskByPlanFull(O.data, c.width, c.height, rt.bmp, cols, {ev, sc: rt.bmp.width/p.w});
      g2.putImageData(O, 0, 0);
    } catch (e) { console.warn(e); }
  }
  const ko = fire.size && rt.bmp ? knockout(c, rt.bmp, [...fire].map(r => r.kind === 'f' ? r.key.slice(1, 8) : r.color).filter(Boolean)) : null;
  return {c, sc, ko};
}
/* "Borrador" de las paredes cortafuego: blanco donde el plano muestra el color de la pared bajo el resaltado.
   Se pinta justo después del plano A (antes del B), así el rojo encima se ve siempre igual, sin mezclarse
   con el color propio de la pared, y las líneas negras, puntos, textos y el plano B siguen viéndose. */
function knockout(c, bmp, colors) {
  if (!colors.length) return null;
  try {
    const W = c.width, H = c.height;
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tg = t.getContext('2d', {willReadFrequently:true}); tg.imageSmoothingQuality = 'high'; tg.drawImage(bmp, 0, 0, W, H);
    const P = tg.getImageData(0, 0, W, H), pd = P.data, O = c.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, W, H).data;
    const fr = parseInt(FIRE_HL.slice(1, 3), 16), fg = parseInt(FIRE_HL.slice(3, 5), 16), fb = parseInt(FIRE_HL.slice(5, 7), 16);
    const rgb = colors.map(col => { const n = parseInt(String(col).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    const T2 = 120*120;
    for (let i = 0; i < pd.length; i += 4) {
      let on = false;
      if (O[i+3] > 40 && Math.abs(O[i] - fr) < 30 && Math.abs(O[i+1] - fg) < 30 && Math.abs(O[i+2] - fb) < 30) {
        const r = pd[i], g = pd[i+1], b = pd[i+2];
        for (const q of rgb) { const dr = r - q[0], dg = g - q[1], db = b - q[2]; if (dr*dr + dg*dg + db*db < T2) { on = true; break; } }
      }
      if (on) { pd[i] = pd[i+1] = pd[i+2] = 255; pd[i+3] = 255; } else pd[i+3] = 0;
    }
    tg.putImageData(P, 0, 0);
    return t;
  } catch (e) { console.warn(e); return null; }
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
  return (rt.hl = {sig, vec:rt.vec, c:oc.c, sc:oc.sc, ko:oc.ko});
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
      ctx.globalAlpha = k === 'A' ? (o.ko ? 0.78 : 0.5) : 0.8;
      blitPart(o.c, p, fr, clip);
      ctx.restore();
    }
  }
}

/* se llama desde drawPlan, justo después de pintar el plano A */
export function drawKnockout(k, p, fr, clip) {
  if (k !== 'A' || !S.auto.show || solo) return;
  const o = RT.A.vec ? overlayFor('A') : null; if (!o || !o.ko) return;
  ctx.save(); ctx.globalAlpha = p.opacity ?? 1; ctx.globalCompositeOperation = 'source-over'; blitPart(o.ko, p, fr, clip); ctx.restore();
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
