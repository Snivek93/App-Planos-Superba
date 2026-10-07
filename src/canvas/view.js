/* Zoom, desplazamiento y ajuste de la vista. */
import { $ } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { RT, S, view } from '../core/state.js';
import { clampZ, s2w, toWorld } from '../core/geometry.js';
import { CH, cv, CW, dirty, renderVars } from './render.js';
import { pos } from '../editor/pointer.js';
import { aKeys, lookOf } from '../plans/extraA.js';
import { planFrames } from '../plans/floors.js';

/* ---------- vista ---------- */
export function zoomAt(p, z) { z = clampZ(z); const w = s2w(...p); view.z = z; view.x = p[0] - w[0]*z; view.y = p[1] - w[1]*z; dirty(); }

export let wheelTimer = null;

export function fit() {
  // lo que se ve: el plano B completo y el A (completo, su nivel o sus niveles)
  const pts = [];
  for (const k of [...aKeys(), 'B']) {
    const p = S.plans[k], rt = RT[k];
    if (!p || !rt || !rt.bmp || !lookOf(k).visible) continue;
    for (const [fr, clip] of planFrames(k)) { const c = clip || [0, 0, p.w, p.h]; for (const q of [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]]) pts.push(toWorld(fr, q)); }
  }
  if (!pts.length) { view.x = 0; view.y = 0; view.z = 1; dirty(); return; }
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 24, top = 56;
  const z = clampZ(Math.min((CW - pad*2)/(x1-x0 || 1), (CH - pad - top)/(y1-y0 || 1)));
  view.z = z; view.x = (CW - (x1-x0)*z)/2 - x0*z; view.y = top + (CH - top - pad - (y1-y0)*z)/2 - y0*z; dirty();
}

export function centerOn(w) { const z = Math.max(view.z, 0.6*(fitZ() || 1)); view.z = clampZ(z); view.x = CW/2 - w[0]*view.z; view.y = CH/2 - w[1]*view.z; dirty(); }

export function fitZ() { const p = S.plans.A.w ? S.plans.A : S.plans.B; if (!p.w) return 1; return Math.min(CW/(p.w*p.s), CH/(p.h*p.s)) * 3; }

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    renderVars.lastWheel = performance.now(); clearTimeout(wheelTimer); wheelTimer = setTimeout(dirty, 240);
    zoomAt(pos(e), view.z * k);
  }, {passive:false});
  $('#zIn').innerHTML = ICON.plus;
   $('#zOut').innerHTML = ICON.minus;
   $('#zFit').innerHTML = ICON.fit;
  $('#zIn').onclick = () => zoomAt([CW/2, CH/2], view.z*1.35);
  $('#zOut').onclick = () => zoomAt([CW/2, CH/2], view.z/1.35);
  $('#zFit').onclick = fit;
}
