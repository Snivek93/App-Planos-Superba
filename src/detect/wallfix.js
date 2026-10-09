/* Afinar paredes a mano. Modo Quitar: quitar un elemento detectado como pared (columna, símbolo, trozo suelto)
   tocándolo, o borrar una zona arrastrando un rectángulo. Lo quitado no se resalta, no cuenta para
   los cruces automáticos ni sale en el PDF. Modo Agregar: trazar con línea o polilínea un tramo que también
   es cortafuego (por ejemplo el cargador sobre una puerta). Se guarda con el arquitectónico y lo ven todos sus planos. */
import { RT, S } from '../core/state.js';
import { distSeg, toLocal } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { pushUndo } from '../core/undo.js';
import { save } from '../core/storage.js';
import { renderOpts } from '../editor/tools.js';
import { toast } from '../ui/app.js';
import { ensureVec, fireEdits, fireExtras, isSymbol, lintelsOn, pathCache, typicalWallW, visibleEvents } from './vector.js';
import { pointInPoly } from './pick.js';
import { renderAuto } from '../panels/deteccion.js';

function srcKey() { return RT.A.fileId ? RT.A.fileId + '#' + (S.plans.A.page || 1) : null; }

/* ajustes del archivo actual del plano A (se crean al primer uso) */
function editsForWrite() {
  const src = srcKey(); if (!src) return null;
  if (!S.auto.fx || S.auto.fx.src !== src) S.auto.fx = {src, excl:[], masks:[], adds:[], noLint:[], v:0};
  const fx = S.auto.fx; fx.adds = fx.adds || []; fx.noLint = fx.noLint || [];
  return fx;
}
function changedEdits() {
  const fx = S.auto.fx; if (fx) fx.v = (fx.v || 0) + 1;
  pathCache.clear(); RT.A.hl = null;
  save(); renderAuto(); dirty();
}

export async function startWallFix() {
  if (!S.auto.fire.some(r => r.on)) { toast('Primero elija las paredes cortafuego en la pestaña Detección.'); return false; }
  try { await ensureVec('A'); } catch (err) { toast(err.message); return false; }
  return true;
}

function shapeHit(s, lp, tol) {
  const t = tol + (s.w || 0)/2;
  if (lp[0] < s.bb[0]-t || lp[0] > s.bb[2]+t || lp[1] < s.bb[1]-t || lp[1] > s.bb[3]+t) return false;
  for (const sp of s.sp) {
    if (s.k === 'f' && sp.length >= 6 && pointInPoly(lp[0], lp[1], sp)) return true;
    for (let j = 0; j + 3 < sp.length; j += 2) if (distSeg(lp, [sp[j], sp[j+1]], [sp[j+2], sp[j+3]]) <= t) return true;
  }
  return false;
}

/* --- modo Agregar --- */
export let wfMode = 'quitar';
export let wfDraft = null; // trazo en curso: puntos en coordenadas del plano A
export function setWfMode(m) { wfMode = m; wfDraft = null; renderOpts(); dirty(); }
/* lleva el punto a horizontal o vertical respecto del anterior si está casi alineado */
function ortho(prev, q) {
  if (!prev) return q;
  const dx = q[0] - prev[0], dy = q[1] - prev[1], a = Math.abs(Math.atan2(dy, dx))*180/Math.PI;
  if (a < 8 || a > 172) return [q[0], prev[1]];
  if (Math.abs(a - 90) < 8) return [prev[0], q[1]];
  return q;
}
function addPath(pts) {
  const e = editsForWrite(); if (!e || pts.length < 2) return;
  pushUndo(); e.adds.push({pts: pts.map(q => q.map(v => Math.round(v*10)/10)), w: Math.round(typicalWallW()*10)/10}); changedEdits();
  toast('Tramo agregado como pared cortafuego. En modo Quitar, tóquelo para borrarlo.');
}
/* toque en modo Agregar: suma un punto a la polilínea; tocar otra vez el último punto la termina */
export function wallFixAddTap(w, tolPx) {
  const lp = toLocal(S.plans.A, w), tol = tolPx/(S.plans.A.s || 1);
  if (!wfDraft) { wfDraft = {pts:[lp]}; renderOpts(); dirty(); return; }
  const last = wfDraft.pts[wfDraft.pts.length - 1];
  if (Math.hypot(lp[0] - last[0], lp[1] - last[1]) <= tol*1.5) { wallFixFinish(); return; }
  wfDraft.pts.push(ortho(last, lp)); renderOpts(); dirty();
}
/* arrastre en modo Agregar: una línea recta */
export function wallFixAddLine(wa, wb) {
  const a = toLocal(S.plans.A, wa), b = ortho(a, toLocal(S.plans.A, wb));
  if (wfDraft) { wfDraft.pts.push(ortho(wfDraft.pts[wfDraft.pts.length - 1], a), b); return wallFixFinish(); }
  addPath([a, b]);
}
export function wallFixFinish() { const d = wfDraft; wfDraft = null; if (d && d.pts.length >= 2) addPath(d.pts); renderOpts(); dirty(); }
export function wallFixCancelDraft() { wfDraft = null; renderOpts(); dirty(); }
/* vista previa del trazo en curso, hasta el puntero */
export function wallFixPreview(hoverW) {
  if (!wfDraft) return null;
  const pts = wfDraft.pts.slice();
  if (hoverW) pts.push(ortho(pts[pts.length - 1], toLocal(S.plans.A, hoverW)));
  return {pts, w: typicalWallW()};
}
const segDist = (p, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(p, pts[i-1], pts[i])); return d; };

/* Toque en modo Quitar: quita el elemento de pared que está debajo, o lo devuelve si ya estaba quitado. */
export function wallFixTap(w, tolPx) {
  const vec = RT.A.vec; if (!vec) return;
  const lp = toLocal(S.plans.A, w), tol = tolPx/(S.plans.A.s || 1);
  {
    const fx0 = fireEdits('A');
    // tramo agregado a mano: borrarlo
    const ai = fx0 && fx0.adds ? fx0.adds.findIndex(a => segDist(lp, a.pts) <= a.w/2 + tol) : -1;
    if (ai >= 0) { pushUndo(); fx0.adds.splice(ai, 1); changedEdits(); toast('Tramo agregado borrado.'); return; }
    // cargador quitado: devolverlo
    const nl = fx0 && fx0.noLint ? fx0.noLint.findIndex(q => Math.hypot(q[0] - lp[0], q[1] - lp[1]) <= Math.max(tol*2, 6)) : -1;
    if (nl >= 0 && RT.A.lint && RT.A.lint.list.some(l => segDist(lp, [l.a, l.b]) <= l.w/2 + tol)) { pushUndo(); fx0.noLint.splice(nl, 1); changedEdits(); toast('Cargador devuelto.'); return; }
    // cargador quitado (guardado con los ajustes): devolverlo
    const back = fx0 && fx0.lint ? fx0.lint.find(l => l.off && segDist(lp, [l.a, l.b]) <= l.w/2 + tol) : null;
    if (back) { pushUndo(); delete back.off; changedEdits(); toast('Cargador devuelto.'); return; }
    // cargador sobre puerta: quitarlo
    const lt = fireExtras().lint.find(l => segDist(lp, [l.a, l.b]) <= l.w/2 + tol);
    if (lt) {
      pushUndo();
      if (fx0 && fx0.lint && fx0.lint.includes(lt)) lt.off = true;
      else { const e = editsForWrite(); e.noLint.push([(lt.a[0] + lt.b[0])/2, (lt.a[1] + lt.b[1])/2].map(v => Math.round(v*10)/10)); }
      changedEdits(); toast('Cargador quitado. Tóquelo otra vez para devolverlo.'); return;
    }
  }
  const rules = S.auto.fire.filter(r => r.on);
  const fx = fireEdits('A');
  const ev = visibleEvents(vec, rules, fx);
  let hit = null;
  for (let i = ev.length - 1; i >= 0; i--) { const [s, r] = ev[i]; if (r && shapeHit(s, lp, tol)) { hit = s; break; } }
  if (hit) {
    pushUndo();
    const e = editsForWrite(); e.excl.push(hit.i);
    changedEdits();
    toast('Elemento quitado de las paredes. Tóquelo otra vez para devolverlo.');
    return;
  }
  // ¿hay uno quitado aquí? devolverlo
  if (fx && fx.excl.length) {
    const keys = new Set(rules.map(r => r.key));
    for (let i = vec.shapes.length - 1; i >= 0; i--) {
      const s = vec.shapes[i];
      if (keys.has(s.key) && fx.excl.includes(s.i) && shapeHit(s, lp, tol)) {
        pushUndo(); fx.excl = fx.excl.filter(x => x !== s.i); changedEdits();
        toast('Elemento devuelto a las paredes.'); return;
      }
    }
  }
  // zona borrada debajo: quitarla
  if (fx && fx.masks.some(m => lp[0] >= m[0] && lp[0] <= m[2] && lp[1] >= m[1] && lp[1] <= m[3])) {
    pushUndo(); fx.masks = fx.masks.filter(m => !(lp[0] >= m[0] && lp[0] <= m[2] && lp[1] >= m[1] && lp[1] <= m[3])); changedEdits();
    toast('Zona restaurada.'); return;
  }
  toast('Aquí no hay pared detectada. Acerque el zoom y toque justo encima.');
}

/* Arrastre: borra la zona (rectángulo en coordenadas de pantalla convertidas al plano A). */
export function wallFixRect(wa, wb) {
  const A = S.plans.A, q = [[wa[0], wa[1]], [wb[0], wa[1]], [wb[0], wb[1]], [wa[0], wb[1]]].map(v => toLocal(A, v));
  const r = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
  const e = editsForWrite(); if (!e) return;
  pushUndo(); e.masks.push(r.map(v => Math.round(v*10)/10)); changedEdits();
  toast('Zona borrada de las paredes. Toque dentro de ella para restaurarla.');
}

export function wallFixSummary() {
  const fx = fireEdits('A'); if (!fx) return '';
  const a = fx.excl.length, b = fx.masks.length, c = (fx.adds || []).length, d = (fx.noLint || []).length + (fx.lint || []).filter(l => l.off).length;
  if (!a && !b && !c && !d) return '';
  return [a ? `${a} ${a === 1 ? 'elemento quitado' : 'elementos quitados'}` : '', b ? `${b} ${b === 1 ? 'zona borrada' : 'zonas borradas'}` : '',
    c ? `${c} ${c === 1 ? 'tramo agregado' : 'tramos agregados'}` : '', d ? `${d} ${d === 1 ? 'cargador quitado' : 'cargadores quitados'}` : ''].filter(Boolean).join(' · ');
}

export function wallFixReset() {
  const fx = fireEdits('A'); if (!fx) return;
  pushUndo(); fx.excl = []; fx.masks = []; fx.adds = []; fx.noLint = []; (fx.lint || []).forEach(l => delete l.off); changedEdits();
  toast('Se restauraron todas las paredes detectadas.');
}

/* para la vista: zonas borradas en coordenadas del plano A */
export function wallFixMasks() { const fx = fireEdits('A'); return fx ? fx.masks : []; }
/* para la vista: cargadores encontrados (activos y quitados) */
export function wallFixLintels() {
  const all = RT.A.lint && lintelsOn('A') ? RT.A.lint.list : [], on = new Set(fireExtras().lint);
  return all.map(l => ({...l, off: !on.has(l)}));
}
export { isSymbol };

/* vuelve a buscar los cargadores del plano A (los quitados a mano vuelven a aparecer) */
export function redetectLintels() {
  const fx = fireEdits('A'); if (!fx) return;
  pushUndo(); delete fx.lint; delete fx.lintTw; fx.noLint = []; RT.A.lint = null; changedEdits();
  toast('Se volvieron a buscar los cargadores sobre puertas.');
}
