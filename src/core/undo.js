/* Deshacer y rehacer. */
import { $ } from './constants.js';
import { ICON } from '../ui/icons.js';
import { L, redoStack, S, sel, stateVars, undoStack } from './state.js';
import { renderPlans } from '../panels/planos.js';
import { changed, renderTop } from '../ui/app.js';

/* ---------- deshacer ---------- */
export function pickT(p) { return ({x:p.x, y:p.y, s:p.s, r:p.r}); }

export function snap() { return JSON.stringify({floors:S.floors, sealTypes:S.sealTypes, layers:S.layers, marks:S.marks, seq:S.seq, A:pickT(S.plans.A), B:pickT(S.plans.B)}); }

export function pushUndo() { undoStack.push(snap()); if (undoStack.length > 100) undoStack.shift(); stateVars.redoStack = []; renderTop(); }

export function restoreSnap(str) {
  const o = JSON.parse(str);
  S.layers = o.layers; S.marks = o.marks; S.seq = o.seq; if (o.sealTypes) S.sealTypes = o.sealTypes; if (o.floors) S.floors = o.floors;
  Object.assign(S.plans.A, o.A); Object.assign(S.plans.B, o.B);
  if (!L(S.active)) S.active = S.layers[0]?.id;
  sel.clear(); stateVars.cur = null; changed(); renderPlans();
}

export function doUndo() { if (!undoStack.length) return; redoStack.push(snap()); restoreSnap(undoStack.pop()); }

export function doRedo() { if (!redoStack.length) return; undoStack.push(snap()); restoreSnap(redoStack.pop()); }

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#btnUndo').innerHTML = ICON.undo;
   $('#btnRedo').innerHTML = ICON.redo;
  $('#btnUndo').onclick = doUndo;
   $('#btnRedo').onclick = doRedo;
}
