/* Alineación del plano B sobre el A con 2 puntos. */
import { align, RT, S, stateVars } from '../core/state.js';
import { normAng, toLocal, toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { renderOpts, setTool } from './tools.js';
import { pushUndo } from '../core/undo.js';
import { renderPlans } from '../panels/planos.js';
import { changed, closePanel, toast } from '../ui/app.js';
import { atOf, bFromA, fitRect, floorById, floorRectWorld } from '../plans/floors.js';

/* ---------- alineación por 2 puntos ---------- */
export function startAlign(floorId) {
  if (!RT.A.bmp || !RT.B.bmp) { toast('Suba ambos planos para alinearlos.'); return; }
  if (!floorId && S.floors.length) { toast('Con plantas definidas, la alineación se hace por planta en la pestaña Planos.'); return; }
  if (!floorId && S.plans.B.locked) { toast('Desbloquee el plano B para alinearlo.'); return; }
  closePanel();
  setTool('align'); stateVars.align = {pts:[], floor: floorId || null};
  if (floorId) { const fl = floorById(floorId); if (fl) fitRect(floorRectWorld(fl)); }
  renderOpts(); dirty();
}

export function alignTap(w) {
  align.pts.push(w);
  if (align.pts.length < 4) { renderOpts(); dirty(); return; }
  const fl = align.floor ? floorById(align.floor) : null;
  if (fl) { // con plantas el B queda fijo: se ubica el nivel del A para que sus puntos caigan sobre los del B
    const at = atOf(fl), a1 = toLocal(at, align.pts[1]), a2 = toLocal(at, align.pts[3]), w1 = align.pts[0], w2 = align.pts[2];
    const va = [a2[0]-a1[0], a2[1]-a1[1]], vw = [w2[0]-w1[0], w2[1]-w1[1]];
    if (Math.hypot(...va) < 1e-6 || Math.hypot(...vw) < 1e-6) { toast('Los dos puntos están demasiado cerca. Intente de nuevo.'); align.pts = []; renderOpts(); dirty(); return; }
    pushUndo();
    const s = Math.hypot(...vw)/Math.hypot(...va), r = normAng(Math.atan2(vw[1], vw[0]) - Math.atan2(va[1], va[0])), c = Math.cos(r)*s, sn = Math.sin(r)*s;
    fl.at = {x: w1[0] - (c*a1[0] - sn*a1[1]), y: w1[1] - (sn*a1[0] + c*a1[1]), s, r}; delete fl.t;
    if (fl.src) bFromA(fl);
    fl.how = 'manual'; fl.info = '';
    stateVars.align = null; setTool('select'); changed(); renderPlans();
    toast(`"${fl.name}" alineada: escala ${(s/(S.plans.A.s || 1)*100).toFixed(1)} %, rotación ${(r*180/Math.PI).toFixed(2)}°.`);
    return;
  }
  const pB = S.plans.B;
  const b1 = toLocal(pB, align.pts[0]), b2 = toLocal(pB, align.pts[2]), a1 = align.pts[1], a2 = align.pts[3];
  const vb = [b2[0]-b1[0], b2[1]-b1[1]], va = [a2[0]-a1[0], a2[1]-a1[1]];
  if (Math.hypot(...vb) < 1e-6 || Math.hypot(...va) < 1e-6) { toast('Los dos puntos están demasiado cerca. Intente de nuevo.'); align.pts = []; renderOpts(); dirty(); return; }
  pushUndo();
  const s = Math.hypot(...va)/Math.hypot(...vb), r = normAng(Math.atan2(va[1], va[0]) - Math.atan2(vb[1], vb[0]));
  pB.s = s; pB.r = r;
  const c = Math.cos(r)*s, sn = Math.sin(r)*s;
  pB.x = a1[0] - (c*b1[0] - sn*b1[1]); pB.y = a1[1] - (sn*b1[0] + c*b1[1]);
  stateVars.align = null; setTool('select'); changed(); renderPlans();
  toast(`${fl ? `"${fl.name}"` : 'Plano B'} alineado: escala ${(s*100).toFixed(1)} %, rotación ${(r*180/Math.PI).toFixed(2)}°.`);
}

export function setBTransform(ns, nr) {
  const p = S.plans.B, c = [p.w/2, p.h/2], w0 = toWorld(p, c);
  p.s = Math.max(1e-4, ns); p.r = normAng(nr);
  const w1 = toWorld(p, c); p.x += w0[0]-w1[0]; p.y += w0[1]-w1[1];
}
