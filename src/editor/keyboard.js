/* Atajos de teclado. */
import { $ } from '../core/constants.js';
import { align, cur, sel, spaceDown, stateVars, tool } from '../core/state.js';
import { cv, dirty } from '../canvas/render.js';
import { renderOpts, setTool } from './tools.js';
import { deleteSel, finishPoly } from './pointer.js';
import { fit } from '../canvas/view.js';
import { doRedo, doUndo } from '../core/undo.js';
import { highlightSealRow } from '../panels/sellos.js';
import { cancelFloor } from '../plans/floors.js';
import { homeOn } from '../project/model.js';
import { wallFixCancelDraft, wallFixFinish, wfDraft } from '../detect/wallfix.js';

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  /* ---------- teclado ---------- */
  addEventListener('keydown', e => {
    if (!$('#modal').hidden || homeOn) return;
    if (e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') { if (!spaceDown) { stateVars.spaceDown = true; cv.style.cursor = 'grab'; } e.preventDefault(); return; }
    if (k === 'escape') {
      if (tool === 'floorA' || tool === 'floorB') cancelFloor();
      else if (tool === 'wallfix' && wfDraft) wallFixCancelDraft();
      else if (cur && tool === 'poly') { stateVars.cur = null; renderOpts(); }
      else if (align) { stateVars.align = null; setTool('select'); }
      else { sel.clear(); renderOpts(); highlightSealRow(); }
      $('#menu').hidden = true; dirty(); return;
    }
    if (k === 'enter' && tool === 'poly') { finishPoly(); return; }
    if (k === 'enter' && tool === 'wallfix' && wfDraft) { wallFixFinish(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); return; }
    const map = {v:'select', h:'pan', p:'pen', k:'hl', l:'line', y:'poly', r:'rect', t:'text', s:'seal', e:'eraser', m:'moveB'};
    if (map[k]) setTool(map[k]);
    if (k === 'f') fit();
  });
  addEventListener('keyup', e => { if (e.key === ' ') { stateVars.spaceDown = false; setTool(tool); } });
}
