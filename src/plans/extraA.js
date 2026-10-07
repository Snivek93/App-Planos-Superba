/* Plano A de varias láminas: un plano de instalaciones puede traer niveles que están en arquitectónicos
   distintos (por ejemplo el nivel 5 en A-49 y el 6 en A-50). El arquitectónico principal sigue siendo el
   plano A; los demás se cargan como planos A adicionales ("A1", "A2"…), solo mientras el plano está abierto,
   y se dibujan a la derecha del principal, mostrando solo sus niveles. Cada planta del plano B se alinea
   con el nivel que le corresponde, venga de la lámina que venga.
   En la hoja (P.sheets[id]) se guarda aMore: [{aSheet, aLevels}]; en cada planta, asheet = lámina de origen. */
import { newPlan, P, RT, S } from '../core/state.js';
import { RT_BLANK } from '../project/model.js';

export let extraKeys = [];          // claves de los planos A adicionales del plano abierto
let bySheet = {};                   // id del arquitectónico -> clave ("A1"…)
let sheetOf = {};                   // clave -> id del arquitectónico

export const isAKey = k => k === 'A' || /^A\d+$/.test(k);
export function planKeys() { return ['A', ...extraKeys, 'B']; }
export function aKeys() { return ['A', ...extraKeys]; }
export function keyOfSheet(id) { return bySheet[id] || null; }
export function sheetOfKey(k) { return k === 'A' ? null : sheetOf[k] || null; }
/* clave del plano A con el que se alinea una planta */
export function akOf(f) { return (f && f.asheet && bySheet[f.asheet]) || 'A'; }

export function clearExtras() {
  for (const k of extraKeys) { delete RT[k]; if (S && S.plans) delete S.plans[k]; }
  extraKeys = []; bySheet = {}; sheetOf = {};
}

/* Prepara los planos A adicionales de la hoja (sin cargar las imágenes): posición a la derecha del principal. */
export function setupExtras(sh) {
  clearExtras();
  if (!sh || sh.kind !== 'pair') return;
  const A = S.plans.A, more = (sh.aMore || []).filter(m => P.sheets[m.aSheet] && m.aSheet !== sh.aSheet);
  let x = A.x + (A.w || 0)*A.s;
  more.forEach((m, i) => {
    const arq = P.sheets[m.aSheet], a = arq.state.plans.A, k = 'A' + (i + 1);
    const gap = Math.max(200, (A.w || a.w || 1000)*A.s*0.06);
    x += gap;
    S.plans[k] = Object.assign(newPlan(), {fileId:a.fileId, page:a.page, w:a.w, h:a.h, pages:a.pages, name:a.name, x, y:A.y, s:A.s, r:0});
    x += (a.w || 0)*A.s;
    RT[k] = RT_BLANK(); if (a.fileId) RT[k].loading = true;
    extraKeys.push(k); bySheet[m.aSheet] = k; sheetOf[k] = m.aSheet;
  });
}

/* reglas de paredes cortafuego del arquitectónico de un plano A adicional, como reglas de ese plano */
export function extraFireRules(k) {
  const id = sheetOf[k], arq = id && P.sheets[id]; if (!arq) return [];
  return (arq.state.auto.fire || []).map(r => ({...r, id: k + ':' + r.id, plan: k}));
}
/* ajustes a mano (Afinar paredes) del arquitectónico de un plano A adicional */
export function extraEdits(k) {
  const id = sheetOf[k], arq = id && P.sheets[id]; if (!arq) return null;
  const fx = arq.state.auto.fx, rt = RT[k];
  if (!fx || !rt || !rt.fileId) return null;
  return fx.src === rt.fileId + '#' + (S.plans[k].page || 1) ? fx : null;
}
/* aspecto (opacidad, color, fondo) igual al del plano A principal */
export function lookOf(k) { return isAKey(k) ? S.plans.A : S.plans[k]; }
