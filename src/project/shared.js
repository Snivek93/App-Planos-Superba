/* Paredes compartidas entre el arquitectónico y los planos que lo usan. */
import { P, S, uid } from '../core/state.js';
import { clone, curSheet } from './model.js';

/* --- paredes compartidas entre el arquitectónico y los planos que lo usan --- */
export function isSharedLayer(l) { return l.plan === 'A' && l.kind === 'cortafuego'; }

export function injectShared(sh) {
  const st = sh.state, arq = P.sheets[sh.aSheet];
  const drop = new Set(st.layers.filter(isSharedLayer).map(l => l.id));
  st.layers = st.layers.filter(l => !drop.has(l.id)); st.marks = st.marks.filter(m => !drop.has(m.layer));
  if (!arq) return;
  const al = arq.state.layers.filter(isSharedLayer), ids = new Set(al.map(l => l.id));
  for (const l of st.layers) if (ids.has(l.id)) { const nid = 'L' + uid(); st.marks.forEach(m => { if (m.layer === l.id) m.layer = nid; }); if (st.active === l.id) st.active = nid; l.id = nid; }
  st.layers = clone(al).concat(st.layers);
  st.marks = clone(arq.state.marks.filter(m => ids.has(m.layer))).concat(st.marks);
  st.auto.fire = clone(arq.state.auto.fire || []);
  st.auto.fx = clone(arq.state.auto.fx || null);
  if (arq.state.auto.lintels === false) st.auto.lintels = false; else delete st.auto.lintels;
  const a = arq.state.plans.A;
  Object.assign(st.plans.A, {fileId:a.fileId, page:a.page, w:a.w, h:a.h, pages:a.pages, name:a.name, x:a.x, y:a.y, s:a.s, r:a.r});
  if (!st.layers.find(l => l.id === st.active)) st.active = st.layers[0]?.id;
}

export function commitShared() {
  const sh = curSheet();
  if (!sh || sh.kind !== 'pair' || sh.state !== S) return;
  const arq = P.sheets[sh.aSheet]; if (!arq) return;
  const al = S.layers.filter(isSharedLayer), ids = new Set(al.map(l => l.id));
  const old = new Set(arq.state.layers.filter(isSharedLayer).map(l => l.id));
  arq.state.layers = clone(al).concat(arq.state.layers.filter(l => !old.has(l.id)));
  arq.state.marks = arq.state.marks.filter(m => !old.has(m.layer)).concat(clone(S.marks.filter(m => ids.has(m.layer))));
  arq.state.auto.fire = clone(S.auto.fire || []);
  arq.state.auto.fx = clone(S.auto.fx || null);
  if (S.auto.lintels === false) arq.state.auto.lintels = false; else delete arq.state.auto.lintels;
  if (!arq.state.layers.find(l => l.id === arq.state.active)) arq.state.active = arq.state.layers[0]?.id;
}
