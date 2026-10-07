/* Varias plantas por lámina: recorte, alineación por ejes y lista de plantas. */
import { esc, PDF_UNIT } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { L, P, RT, S, tool, uid, view } from '../core/state.js';
import { clampZ, toLocal, toWorld } from '../core/geometry.js';
import { CH, CW, dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { reanchor } from '../editor/pointer.js';
import { fit } from '../canvas/view.js';
import { pushUndo } from '../core/undo.js';
import { renderPlans } from '../panels/planos.js';
import { ask, changed, closePanel, toast } from '../ui/app.js';
import { defaultLevels, floorMult, parseLevels } from '../core/levels.js';
import { apT, ensureVec, undouble } from '../detect/vector.js';
import { ensurePdf } from './load.js';
import { aClips } from './arqlevels.js';
import { akOf, isAKey } from './extraA.js';

/* ---------- plantas (varias plantas en una misma lámina) ---------- */
export let solo = null; // 'A' o 'B' mientras se dibuja el recorte de una planta

export let floorDraft = null;

export function floorById(id) { return S.floors.find(f => f.id === id); }

export function rectWorld(fr, r) {
  const q = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(v => toWorld(fr, v));
  return [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
}

/* El plano B (instalaciones) es la base y se ve completo. Cada planta es un nivel del arquitectónico
   (zona f.a de su lámina) puesto debajo de la zona f.b del plano B con su propia ubicación f.at.
   (Antes era al revés: el plano A fijo y trozos del B movidos encima, guardado en f.t; se convierte solo.) */
function simFrom(p0, q0, p1, q1) { // semejanza que lleva p0→q0 y p1→q1
  const vp = [p1[0]-p0[0], p1[1]-p0[1]], vq = [q1[0]-q0[0], q1[1]-q0[1]];
  const s = Math.hypot(...vq)/(Math.hypot(...vp) || 1), r = Math.atan2(vq[1], vq[0]) - Math.atan2(vp[1], vp[0]);
  const c = Math.cos(r)*s, sn = Math.sin(r)*s;
  return {x: q0[0] - (c*p0[0] - sn*p0[1]), y: q0[1] - (sn*p0[0] + c*p0[1]), s, r: Math.abs(r) < 1e-9 ? 0 : r};
}
export function atOf(f) {
  if (f.at) return f.at;
  const A = S.plans[akOf(f)] || S.plans.A, B = S.plans.B;
  if (f.t) { // conversión: mismo calce, pero ahora se mueve el nivel del A en vez del trozo del B
    const map = a => toWorld(B, toLocal(f.t, toWorld(A, a)));
    const p0 = [f.a[0], f.a[1]], p1 = [f.a[2], f.a[3]];
    f.at = simFrom(p0, map(p0), p1, map(p1));
  } else f.at = {x:A.x, y:A.y, s:A.s, r:A.r || 0};
  return f.at;
}
/* zona del plano B de la planta, en el mundo (el B no se mueve por planta) */
export function floorRectWorld(f) { return rectWorld(S.plans.B, f.b); }
/* zona del nivel del A, en el mundo */
export function floorARectWorld(f) { return rectWorld(atOf(f), f.a); }
/* ubicación del plano A en un punto: la del nivel que está ahí, o la general */
export function aFrameAt(w) {
  for (const f of S.floors) { const r = floorARectWorld(f); if (w[0] >= r[0] && w[0] <= r[2] && w[1] >= r[1] && w[1] <= r[3]) return {fr: atOf(f), k: akOf(f), f}; }
  return {fr: S.plans.A, k: 'A', f: null};
}
/* la zona del B de una planta de nivel sale de su nivel del A visto a través de su ubicación */
export function bFromA(f) {
  const B = S.plans.B, at = atOf(f);
  const q = [[f.a[0], f.a[1]], [f.a[2], f.a[1]], [f.a[2], f.a[3]], [f.a[0], f.a[3]]].map(v => toLocal(B, toWorld(at, v)));
  f.b = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
}

export function floorAtWorld(w) {
  for (const f of S.floors) { const r = floorRectWorld(f); if (w[0] >= r[0] && w[0] <= r[2] && w[1] >= r[1] && w[1] <= r[3]) return f; }
  return null;
}

export function planFrames(k) {
  if (k === 'B') return [[S.plans.B, null, null]]; // el plano B siempre completo
  if (isAKey(k) && S.floors.length && solo !== 'A') {
    // con plantas: el A se ve solo en sus niveles, cada uno debajo de su zona del B
    return S.floors.filter(f => akOf(f) === k).map(f => [atOf(f), f.a, f]);
  }
  if (k === 'A' && solo !== 'A') { const cl = aClips(); if (cl) return cl.map(c => [S.plans.A, c, null]); }
  if (isAKey(k) && k !== 'A') return [];
  return [[S.plans[k], null, null]];
}

export function frameOf(m) {
  const l = L(m.layer);
  if (l && l.plan === 'A' && S.floors.length && m.pts && m.pts[0]) {
    // marcas sobre el plano A con plantas: van con el nivel donde se pusieron (m.fl);
    // '-' = fuera de los niveles; sin fl (marcas antiguas o del arquitectónico): el nivel principal donde caen
    if (m.fl === '-') return S.plans.A;
    if (m.fl) { const f = floorById(m.fl); if (f) return atOf(f); }
    const f = S.floors.find(f => akOf(f) === 'A' && m.pts[0][0] >= f.a[0] && m.pts[0][0] <= f.a[2] && m.pts[0][1] >= f.a[1] && m.pts[0][1] <= f.a[3]);
    if (f) return atOf(f);
  }
  return l ? S.plans[l.plan] : S.plans.A;
}

export function frameAt(l, w) {
  if (l.plan === 'B' && S.floors.length) { const f = floorAtWorld(w); return [S.plans.B, f ? f.id : null]; }
  if (l.plan === 'A' && S.floors.length) { const a = aFrameAt(w); return [a.fr, a.f ? a.f.id : '-']; }
  return [S.plans[l.plan], null];
}

export function fitRect(r, padPx = 30) {
  const top = 56, z = clampZ(Math.min((CW - padPx*2)/((r[2]-r[0]) || 1), (CH - padPx - top)/((r[3]-r[1]) || 1)));
  view.z = z; view.x = (CW - (r[2]-r[0])*z)/2 - r[0]*z; view.y = top + (CH - top - padPx - (r[3]-r[1])*z)/2 - r[1]*z; dirty();
}

export function fitPlan(k) { const p = S.plans[k]; if (RT[k].bmp) fitRect(rectWorld(p, [0, 0, p.w, p.h])); }

export async function addFloor() {
  if (!RT.A.bmp || !RT.B.bmp) return toast('Suba los dos planos primero.');
  const name = await ask({title:'Nueva planta', body:'Primero encierra la planta en el plano A y después la misma planta en el plano B.', input:`Nivel ${S.floors.length + 1}`, placeholder:'Por ejemplo: Nivel 21', ok:'Continuar'});
  if (!name) return;
  floorDraft = {name};
  closePanel(); solo = 'A'; setTool('floorA'); fitPlan('A');
}

export function floorRect(r) {
  if (tool === 'floorA') {
    const a = r.map(v => v), A = S.plans.A;
    const q = [toLocal(A, [a[0], a[1]]), toLocal(A, [a[2], a[3]])];
    floorDraft.a = [Math.min(q[0][0], q[1][0]), Math.min(q[0][1], q[1][1]), Math.max(q[0][0], q[1][0]), Math.max(q[0][1], q[1][1])];
    solo = 'B'; setTool('floorB'); fitPlan('B'); return;
  }
  const B = S.plans.B, q = [toLocal(B, [r[0], r[1]]), toLocal(B, [r[2], r[3]])];
  floorDraft.b = [Math.min(q[0][0], q[1][0]), Math.min(q[0][1], q[1][1]), Math.max(q[0][0], q[1][0]), Math.max(q[0][1], q[1][1])];
  if (floorDraft.edit) { // zona en el plano B de una planta que ya existe (por ejemplo un nivel de otra lámina)
    const f = floorById(floorDraft.edit), fb = floorDraft.b; floorDraft = null; solo = null;
    if (!f) { setTool('select'); return; }
    const A = S.plans[akOf(f)] || S.plans.A;
    pushUndo(); f.b = fb; f.at = centerAt(A, f.a, fb); delete f.t; f.how = 'centro'; f.info = '';
    setTool('select'); fitRect(floorRectWorld(f)); changed(); renderPlans();
    autoAlignFloor(f, true); return;
  }
  const A = S.plans.A, fb = floorDraft.b;
  const f = {id:'f' + uid(), name:floorDraft.name, levels: defaultLevels(floorDraft.name), a:floorDraft.a, b:floorDraft.b, at: centerAt(A, floorDraft.a, fb), how:'centro', info:''};
  pushUndo(); S.floors.push(f); floorDraft = null; solo = null;
  setTool('select'); fitRect(floorRectWorld(f)); changed(); renderPlans();
  autoAlignFloor(f, true);
}

export function editFloorZoneB(f) {
  if (!RT.B.bmp) return toast('Suba el plano B primero.');
  floorDraft = {edit: f.id, name: f.name}; closePanel(); solo = 'B'; setTool('floorB'); fitPlan('B');
}

/* ubicación inicial de un nivel: su centro sobre el centro de la zona del B, con la escala general del A */
export function centerAt(A, a, b) {
  const B = S.plans.B, cb = toWorld(B, [(b[0] + b[2])/2, (b[1] + b[3])/2]), ca = [(a[0] + a[2])/2, (a[1] + a[3])/2];
  const s = A.s, r = A.r || 0, c = Math.cos(r)*s, sn = Math.sin(r)*s;
  return {x: cb[0] - (c*ca[0] - sn*ca[1]), y: cb[1] - (sn*ca[0] + c*ca[1]), s, r};
}

export function cancelFloor() { floorDraft = null; solo = null; setTool('select'); fit(); }

export async function deleteFloor(id) {
  const f = floorById(id); if (!f) return;
  const ok = await ask({title:'Quitar planta', body:`Se quita la planta "${f.name}". Las marcas se conservan en su lugar.`, buttons:[{label:'Cancelar', value:false}, {label:'Quitar', value:true, danger:true}]});
  if (!ok) return;
  pushUndo();
  for (const m of S.marks) if (m.fl === id) m.fl = null;
  S.floors = S.floors.filter(x => x !== f); changed(); renderPlans();
}

/* alineación automática por ejes */
export async function ensureText(k) {
  const rt = RT[k], p = S.plans[k];
  if (rt.text && rt.text.page === p.page) return rt.text.runs;
  const pg = await (await ensurePdf(rt)).getPage(p.page);
  const VT = pg.getViewport({scale:PDF_UNIT}).transform;
  const tc = await pg.getTextContent();
  const raw = []; let cur = null;
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    const t = it.transform, h = Math.hypot(t[2], t[3]) || 4, n = Math.hypot(t[0], t[1]) || 1, dx = t[0]/n, dy = t[1]/n;
    const sx = t[4], sy = t[5], ex = sx + dx*it.width, ey = sy + dy*it.width;
    if (cur && Math.hypot(sx - cur.ex, sy - cur.ey) < h*1.3) { cur.str += it.str; cur.ex = ex; cur.ey = ey; }
    else { cur = {str:it.str, sx, sy, ex, ey, h}; raw.push(cur); }
  }
  const runs = [];
  for (const r of raw) {
    const str = undouble(r.str), L = Math.hypot(r.ex - r.sx, r.ey - r.sy) || 1, ux = (r.ex - r.sx)/L, uy = (r.ey - r.sy)/L;
    const toks = [...str.matchAll(/\S+/g)];
    const put = (txt, along) => { const q = apT(VT, r.sx + ux*along, r.sy + uy*along + r.h*0.35); runs.push({s:txt, x:q[0], y:q[1], h:r.h*PDF_UNIT}); };
    if (toks.length <= 1) { put(str.trim(), L/2); continue; }
    toks.forEach((t, i) => {
      const tw = Math.min(L/2, t[0].length*r.h*0.6);
      const along = i === 0 ? tw/2 : i === toks.length - 1 ? L - tw/2 : (t.index + t[0].length/2)/str.length*L;
      put(t[0], along);
    });
  }
  rt.text = {page:p.page, runs};
  return runs;
}

export const AXIS_RE = /^([A-Z]{1,2}|\d{1,2})['′.]?$/;

export function snapBubble(r, shapes) {
  // centra el rótulo en el círculo del eje que lo rodea, si lo encuentra
  let best = null, bw = Infinity;
  for (const s of shapes) {
    const b = s.bb, w = b[2]-b[0], h = b[3]-b[1];
    if (w < r.h*1.1 || w > r.h*7 || Math.abs(w - h) > w*0.15) continue;
    if (r.x < b[0] || r.x > b[2] || r.y < b[1] || r.y > b[3]) continue;
    if (w < bw) { bw = w; best = s; }
  }
  return best ? {...r, x:(best.bb[0] + best.bb[2])/2, y:(best.bb[1] + best.bb[3])/2, snapped:true} : r;
}

export function axesIn(runs, rect, shapes) {
  const W = rect[2]-rect[0], H = rect[3]-rect[1], tol = 8;
  const by = {};
  for (let r of runs) if (AXIS_RE.test(r.s) && r.x >= rect[0] && r.x <= rect[2] && r.y >= rect[1] && r.y <= rect[3]) { if (shapes) r = snapBubble(r, shapes); (by[r.s] = by[r.s] || []).push(r); }
  const out = {};
  for (const [s, occ] of Object.entries(by)) {
    let bestH = 0, hy = 0, bestV = 0, vx = 0;
    for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i], b = occ[j];
      if (Math.abs(a.y - b.y) < tol && Math.abs(a.x - b.x) > bestH) { bestH = Math.abs(a.x - b.x); hy = (a.y + b.y)/2; }
      if (Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) > bestV) { bestV = Math.abs(a.y - b.y); vx = (a.x + b.x)/2; }
    }
    const rh = bestH/W, rv = bestV/H;
    if (rh > 0.3 && rh >= rv) out[s] = {o:'h', c:hy};
    else if (rv > 0.3) out[s] = {o:'v', c:vx};
  }
  return out;
}

export function fit1D(pairs, sFixed) {
  // pares [b, a]: a = s*b + d
  let s = sFixed;
  if (s == null) {
    const n = pairs.length, mb = pairs.reduce((t, p) => t + p[0], 0)/n, ma = pairs.reduce((t, p) => t + p[1], 0)/n;
    let num = 0, den = 0; for (const [b, a] of pairs) { num += (b - mb)*(a - ma); den += (b - mb)**2; }
    s = den > 1e-6 ? num/den : null;
    if (s == null) return null;
  }
  const d = pairs.reduce((t, [b, a]) => t + (a - s*b), 0)/pairs.length;
  const res = pairs.map(([b, a]) => Math.abs(a - (s*b + d)));
  return {s, d, res};
}

export async function autoAlignFloor(f, quiet) {
  try {
    const ak = akOf(f);
    if (!RT[ak] || !RT[ak].isPdf || !RT.B.isPdf) throw new Error('La alineación por ejes necesita que ambos planos sean PDF.');
    const [ta, tb] = await Promise.all([ensureText(ak), ensureText('B')]);
    let va = null, vb = null;
    try { va = await ensureVec(ak); vb = await ensureVec('B'); } catch (e) {}
    const A = S.plans[ak];
    const near = (vec, rect) => vec ? vec.shapes.filter(s => s.bb[2] >= rect[0] && s.bb[0] <= rect[2] && s.bb[3] >= rect[1] && s.bb[1] <= rect[3]) : null;
    const axA = axesIn(ta, f.a, near(va, f.a)), axB = axesIn(tb, f.b, near(vb, f.b));
    let V = [], Hh = [];
    const Bp = S.plans.B; // el B es la base: se busca dónde poner el nivel del A para que sus ejes caigan en los del B
    for (const [s, a] of Object.entries(axA)) {
      const b = axB[s]; if (!b || b.o !== a.o) continue;
      if (a.o === 'v') V.push([a.c, Bp.s*b.c + Bp.x, s]); else Hh.push([a.c, Bp.s*b.c + Bp.y, s]);
    }
    if (!V.length || !Hh.length) throw new Error(`No encontré ejes comunes suficientes en "${f.name}" (verticales: ${V.length}, horizontales: ${Hh.length}). Use "2 puntos".`);
    let s = null;
    for (let pass = 0; pass < 2; pass++) {
      const sx = V.length >= 2 ? fit1D(V)?.s : null, sy = Hh.length >= 2 ? fit1D(Hh)?.s : null;
      const cands = [sx, sy].filter(v => v && v > 0.05 && v < 20);
      s = cands.length ? cands.reduce((t, v) => t + v, 0)/cands.length : atOf(f).s;
      if (cands.length === 2 && Math.abs(sx/sy - 1) > 0.03) s = V.length >= Hh.length ? sx : sy;
      const fx = fit1D(V, s), fy = fit1D(Hh, s);
      const lim = 10;
      const V2 = V.filter((p, i) => fx.res[i] < lim), H2 = Hh.filter((p, i) => fy.res[i] < lim);
      if (pass === 0 && V2.length && H2.length && (V2.length < V.length || H2.length < Hh.length)) { V = V2; Hh = H2; continue; }
      break;
    }
    const fx = fit1D(V, s), fy = fit1D(Hh, s);
    const maxRes = Math.max(...fx.res, ...fy.res);
    if (maxRes > 20) throw new Error(`Los ejes de "${f.name}" no calzan bien (diferencia de ${(maxRes/PDF_UNIT*0.3528).toFixed(1)} mm en la lámina). Use "2 puntos".`);
    if (!quiet) pushUndo(); else { /* el deshacer ya quedó al crear la planta */ }
    f.at = {x:fx.d, y:fy.d, s, r:0}; delete f.t;
    f.how = 'ejes';
    if (f.src) bFromA(f); // planta de un nivel: su zona del B es la que queda sobre el nivel
    f.info = `${V.length} ${V.length === 1 ? 'eje vertical' : 'ejes verticales'} (${V.map(p => p[2]).join(', ')}) y ${Hh.length} ${Hh.length === 1 ? 'horizontal' : 'horizontales'} (${Hh.map(p => p[2]).join(', ')}), desviación máx. ${(maxRes/PDF_UNIT*0.3528).toFixed(2).replace('.', ',')} mm`;
    changed(); renderPlans();
    toast(`"${f.name}" alineada por ejes: ${f.info}.`);
    return true;
  } catch (err) {
    if (f.how !== 'nivel') f.how = f.how === 'ejes' ? 'ejes' : 'sin';
    renderPlans();
    toast(err.message || 'No se pudo alinear por ejes.');
    return false;
  }
}

/* Títulos de las plantas del plano B ("PLANTA DE AGUA POTABLE NIVEL 6"): dónde está cada nivel en la lámina. */
async function bTitles() {
  if (!RT.B.isPdf) return [];
  const runs = (await ensureText('B')).slice().sort((p, q) => p.y - q.y || p.x - q.x);
  const lines = [];
  for (const r of runs) { const ln = lines.find(l => Math.abs(l.y - r.y) < r.h*0.6 && r.x - l.x1 < r.h*4); if (ln) { ln.t.push(r); ln.x1 = Math.max(ln.x1, r.x); } else lines.push({y:r.y, x1:r.x, t:[r]}); }
  const out = [];
  for (const ln of lines) {
    const t = ln.t.sort((p, q) => p.x - q.x), txt = t.map(r => r.s).join(' ');
    const m = txt.match(/\bNIVEL(?:ES)?\b[\s:.#Nº°-]*((?:-?\d+)(?:\s*(?:,|Y|E|AL|A|-|–)\s*-?\d+)*)/i);
    if (!m) continue;
    const lv = parseLevels(m[1].replace(/\s+(y|e)\s+/ig, ', ')); if (!lv.length) continue;
    out.push({lv, x: (t[0].x + t[t.length - 1].x)/2, y: ln.y, h: t[0].h});
  }
  return out;
}
/* Zona del plano B donde está el nivel de la planta, según los títulos: la franja (columna) de su título. */
export async function guessBZone(f) {
  try {
    const want = parseLevels(String(f.levels || '')).filter(x => /\d/.test(x)); if (!want.length) return false;
    const ts = await bTitles(); if (ts.length < 2) return false;
    const mine = ts.filter(t => t.lv.some(x => want.includes(x)));
    if (!mine.length) return false;
    const t = mine.sort((p, q) => q.y - p.y)[0]; // el título más bajo (debajo del dibujo)
    const row = ts.filter(o => Math.abs(o.y - t.y) < t.h*6).sort((p, q) => p.x - q.x), i = row.indexOf(t), B = S.plans.B;
    const x0 = i > 0 ? (row[i-1].x + t.x)/2 : 0, x1 = i < row.length - 1 ? (t.x + row[i+1].x)/2 : B.w;
    f.b = [x0, 0, x1, Math.min(B.h, t.y + t.h*2)];
    f.at = centerAt(S.plans[akOf(f)] || S.plans.A, f.a, f.b); delete f.t;
    return true;
  } catch (e) { console.warn(e); return false; }
}
/* plantas de niveles recién creadas: se ubican por el título del nivel en el B y se alinean por ejes */
export async function alignPending() {
  for (const f of S.floors.filter(f => f.pending)) {
    if (!RT[akOf(f)]?.bmp || !RT.B.bmp) continue;
    delete f.pending;
    const before = {at: f.at && {...f.at}, b: f.b && f.b.slice(), how: f.how, info: f.info};
    await guessBZone(f);
    // si no se logra por ejes, queda como estaba (por ejemplo una alineación hecha antes a mano)
    if (!await autoAlignFloor(f, true)) { Object.assign(f, before); if (!before.at) delete f.at; }
  }
}

export function floorsHtml() {
  if (!RT.A.bmp || !RT.B.bmp) return '';
  const st = f => f.how === 'ejes' ? `<span class="fstat ok">Alineada por ejes</span>` : f.how === 'manual' ? `<span class="fstat ok">Alineada con 2 puntos</span>` : f.how === 'nivel' ? `<span class="fstat ok">Del arquitectónico</span>` : `<span class="fstat warn">Sin alinear</span>`;
  return `<section class="plan"><header><span class="badge" style="background:#7A4CC2">⇄</span><div><h3>Plantas en la lámina</h3><p class="muted">Para láminas con varias plantas</p></div></header>
    <p class="help" style="margin:0 0 10px">Si la lámina trae dos plantas (por ejemplo nivel 21 y 22) y no quedan a la misma distancia en el arquitectónico y en el mecánico, defina cada planta. Cada una se alinea por separado, por sus ejes.</p>
    ${S.floors.length ? `<ul class="floors">${S.floors.map(f => `<li data-floor="${f.id}">
      <div class="frow"><input data-act="fname" value="${esc(f.name)}" aria-label="Nombre de la planta"${f.src ? ' readonly title="Se cambia en el arquitectónico"' : ''}>${st(f)}</div>
      <div class="frow" style="margin-top:6px"><span class="small muted" style="white-space:nowrap">Niveles que representa</span><input data-act="flevels" value="${esc(f.levels ?? '')}" placeholder="Ej.: 7, 8 o 7-10" aria-label="Niveles que representa la planta"${f.src ? ' readonly title="Se cambia en el arquitectónico"' : ''}><b class="fmult" title="Multiplicador">×${floorMult(f)}</b></div>
      <label class="chk small" style="margin:6px 0 0"><input type="checkbox" data-act="fbelow"${(f.below ?? S.below) ? ' checked' : ''}> Tuberías bajo losa (paredes en el nivel inferior)</label>
      ${f.info ? `<div class="small muted">${esc(f.info)}</div>` : ''}
      ${f.asheet ? `<div class="small muted">Arquitectónico: ${esc(P.sheets[f.asheet]?.name || '')}</div>` : ''}
      <div class="btnrow"><button class="btn" data-act="fAxes">Alinear por ejes</button>${f.src ? '<button class="btn" data-act="fZoneB" title="Encerrar en el plano B la zona de esta planta">Zona en B</button>' : ''}<button class="btn" data-act="fAlign">2 puntos</button><button class="btn" data-act="fMove">Mover</button><button class="btn" data-act="fView">Ver</button>${f.src ? '' : `<button class="icon" data-act="fDel" title="Quitar planta">${ICON.trash}</button>`}</div></li>`).join('')}</ul>` : ''}
    <button class="btn primary" data-act="addFloor">Agregar planta</button></section>`;
}

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const floorsVars = {
  get solo() { return solo; }, set solo(v) { solo = v; },
  get floorDraft() { return floorDraft; }, set floorDraft(v) { floorDraft = v; },
};
