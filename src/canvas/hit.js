/* Selección: qué marca hay bajo el puntero. */
import { S, view } from '../core/state.js';
import { dist, distSeg, rectPts, s2w, toLocal, toWorld, w2s } from '../core/geometry.js';
import { textW } from './render.js';
import { tableLayout } from './tables.js';
import { frameOf } from '../plans/floors.js';

/* ---------- selección y búsqueda de marcas ---------- */
export function hitMark(m, l, p, sp) {
  if (m.type === 'seal') return dist(w2s(...toWorld(p, m.pts[0])), sp) <= 17;
  const lp = toLocal(p, s2w(...sp)), tol = 10/(view.z*p.s) + (m.w || 0)/2;
  if (m.type === 'table') {
    const {W, H} = tableLayout(m), [x, y] = m.pts[0];
    return lp[0] >= x-tol && lp[0] <= x + W + tol && lp[1] >= y-tol && lp[1] <= y + H + tol;
  }
  if (m.type === 'text') {
    const [x, y] = m.pts[0];
    return lp[0] >= x-tol && lp[0] <= x + textW(m) + tol && lp[1] >= y-tol && lp[1] <= y + m.size*1.2 + tol;
  }
  const pts = m.type === 'rect' ? rectPts(m) : m.pts;
  if (pts.length === 1) return dist(lp, pts[0]) <= tol;
  for (let i = 0; i < pts.length-1; i++) if (distSeg(lp, pts[i], pts[i+1]) <= tol) return true;
  return false;
}

export function hitTest(sp, onlySeals) {
  for (const pass of [true, false]) {
    if (!pass && onlySeals) break;
    for (let i = S.layers.length-1; i >= 0; i--) {
      const l = S.layers[i]; if (!l.visible || l.locked) continue;
      for (let j = S.marks.length-1; j >= 0; j--) {
        const m = S.marks[j];
        if (m.layer !== l.id || (m.type === 'seal') !== pass) continue;
        if (hitMark(m, l, frameOf(m), sp)) return m;
      }
    }
  }
  return null;
}
