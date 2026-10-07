/* Afinar paredes a mano: quitar un elemento detectado como pared (columna, símbolo, trozo suelto)
   tocándolo, o borrar una zona arrastrando un rectángulo. Lo quitado no se resalta, no cuenta para
   los cruces automáticos ni sale en el PDF. Se guarda con el arquitectónico y lo ven todos sus planos. */
import { RT, S } from '../core/state.js';
import { distSeg, toLocal } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { pushUndo } from '../core/undo.js';
import { save } from '../core/storage.js';
import { toast } from '../ui/app.js';
import { ensureVec, fireEdits, isSymbol, pathCache, visibleEvents } from './vector.js';
import { pointInPoly } from './pick.js';
import { renderAuto } from '../panels/deteccion.js';

function srcKey() { return RT.A.fileId ? RT.A.fileId + '#' + (S.plans.A.page || 1) : null; }

/* ajustes del archivo actual del plano A (se crean al primer uso) */
function editsForWrite() {
  const src = srcKey(); if (!src) return null;
  if (!S.auto.fx || S.auto.fx.src !== src) S.auto.fx = {src, excl:[], masks:[], v:0};
  return S.auto.fx;
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

/* Toque: quita el elemento de pared que está debajo, o lo devuelve si ya estaba quitado. */
export function wallFixTap(w, tolPx) {
  const vec = RT.A.vec; if (!vec) return;
  const lp = toLocal(S.plans.A, w), tol = tolPx/(S.plans.A.s || 1);
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
  const a = fx.excl.length, b = fx.masks.length;
  if (!a && !b) return '';
  return [a ? `${a} ${a === 1 ? 'elemento quitado' : 'elementos quitados'}` : '', b ? `${b} ${b === 1 ? 'zona borrada' : 'zonas borradas'}` : ''].filter(Boolean).join(' · ');
}

export function wallFixReset() {
  const fx = fireEdits('A'); if (!fx) return;
  pushUndo(); fx.excl = []; fx.masks = []; changedEdits();
  toast('Se restauraron todas las paredes detectadas.');
}

/* para la vista: zonas borradas en coordenadas del plano A */
export function wallFixMasks() { const fx = fireEdits('A'); return fx ? fx.masks : []; }
export { isSymbol };
