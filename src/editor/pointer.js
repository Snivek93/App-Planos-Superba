/* Eventos del puntero (mouse, lápiz y táctil): dibujar, mover, seleccionar, borrar, colocar sellos. */
import { HL_WIDTHS, WIDTHS } from '../core/constants.js';
import { align, cur, gesture, L, MK, RT, S, sel, spaceDown, stateVars, tool, uid, undoStack, view } from '../core/state.js';
import { baseW, clampZ, dist, mid, normAng, rectPts, s2w, snapAngle, toLocal, toWorld, w2s } from '../core/geometry.js';
import { cv, dirty } from '../canvas/render.js';
import { placeTable, sealFloor } from '../canvas/tables.js';
import { hitTest } from '../canvas/hit.js';
import { activeDrawLayer, renderOpts, sealLayer, setTool } from './tools.js';
import { alignTap } from './align.js';
import { pushUndo } from '../core/undo.js';
import { renderPlans } from '../panels/planos.js';
import { highlightSealRow, updateCounts } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { ask, changed, toast } from '../ui/app.js';
import { aFrameAt, atOf, bFromA, floorAtWorld, floorRect, frameAt, frameOf } from '../plans/floors.js';
import { pickAt } from '../detect/pick.js';
import { renderAuto } from '../panels/deteccion.js';
import { wallFixAddLine, wallFixAddTap, wallFixRect, wallFixTap, wfMode } from '../detect/wallfix.js';
import { finishLevelRect } from '../plans/arqlevels.js';

/* ---------- eventos del puntero ---------- */
export let ptrs;

export function pos(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

export function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  setTimeout(dirty, 30);
  if (gesture && gesture.kind === 'pinch') { if (ptrs.size === 0) stateVars.gesture = null; return; }
  if (gesture) up(pos(e), e);
}

export function abortGesture() {
  const g = gesture; stateVars.gesture = null;
  if (!g) return;
  if (g.kind === 'draw') stateVars.cur = null;
  if (g.kind === 'move' && g.moved) { for (const [id, orig] of g.orig) { const m = MK(id); if (m) m.pts = orig; } undoStack.pop(); }
  if (g.kind === 'moveB') { g.tgt.x = g.x0; g.tgt.y = g.y0; undoStack.pop(); }
  dirty();
}

export function down(p, e) {
  const w = s2w(...p);
  switch (tool) {
    case 'select': {
      const m = hitTest(p);
      if (m) {
        if (e.shiftKey) { sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); }
        else if (!sel.has(m.id)) { sel.clear(); sel.add(m.id); }
        stateVars.gesture = {kind:'move', start:p, w0:w, moved:false, orig:new Map([...sel].map(id => [id, MK(id).pts.map(q => q.slice())]))};
        highlightSealRow();
      } else {
        stateVars.gesture = {kind:'marquee', start:p, end:p, add:e.shiftKey};
      }
      renderOpts(); dirty(); break;
    }
    case 'pen': case 'hl': case 'line': case 'rect': {
      const l = activeDrawLayer(); if (!l) return;
      const [pl, fl] = frameAt(l, w), lp = toLocal(pl, w), free = tool === 'pen' || tool === 'hl';
      stateVars.cur = {id:uid(), type:tool, layer:l.id, fl, pts: free ? [lp] : [lp, lp.slice()], w: baseW()*WIDTHS[S.width]/pl.s};
      if (tool === 'hl') { cur.color = S.hlColor; cur.alpha = S.hlAlpha; cur.w = baseW()*HL_WIDTHS[S.hlWidth]/pl.s; }
      else { if (S.drawColor) cur.color = S.drawColor; if (S.drawAlpha < 1) cur.alpha = S.drawAlpha; }
      stateVars.gesture = {kind:'draw', start:p}; dirty(); break;
    }
    case 'poly': case 'text': case 'seal': case 'align': case 'table': case 'pick':
      stateVars.gesture = {kind:'tap', start:p, v0:{...view}}; break;
    case 'eraser':
      stateVars.gesture = {kind:'erase', pushed:false}; eraseAt(p, gesture); break;
    case 'zone': case 'floorA': case 'floorB': case 'lvlRect':
      stateVars.gesture = {kind:'zone', start:p, end:p}; break;
    case 'wallfix':
      stateVars.gesture = {kind:'wallfix', start:p, end:p}; break;
    case 'moveB': {
      const pb = S.plans.B;
      if (!RT.B.bmp) { toast('Primero suba el plano B.'); return; }
      if (pb.locked) { toast('El plano B está bloqueado. Desbloquéelo en la pestaña Planos.'); return; }
      // con plantas el B es la base: se mueve el nivel del A que está debajo
      const fl = S.floors.length ? (floorAtWorld(w) || aFrameAt(w).f || (S.floors.length === 1 ? S.floors[0] : null)) : null;
      if (S.floors.length && !fl) { toast('Toque dentro de una planta para moverla.'); return; }
      const tgt = fl ? atOf(fl) : pb;
      pushUndo(); stateVars.gesture = {kind:'moveB', w0:w, x0:tgt.x, y0:tgt.y, tgt, fl}; break;
    }
  }
}

export function move(p, e) {
  const g = gesture;
  switch (g.kind) {
    case 'tap':
      if (dist(p, g.start) > 8) { g.kind = 'pan'; }
      else break;
      // falls through
    case 'pan':
      view.x = g.v0.x + p[0] - g.start[0]; view.y = g.v0.y + p[1] - g.start[1]; dirty(); break;
    case 'draw': {
      const l = L(cur.layer), pl = frameOf(cur); let w = s2w(...p);
      if (cur.type === 'pen' || cur.type === 'hl') {
        const last = w2s(...toWorld(pl, cur.pts[cur.pts.length-1]));
        if (dist(last, p) >= 2.5) cur.pts.push(toLocal(pl, w));
      } else {
        if (cur.type === 'line' && e.shiftKey) w = snapAngle(toWorld(pl, cur.pts[0]), w);
        cur.pts[1] = toLocal(pl, w);
      }
      dirty(); break;
    }
    case 'move': {
      if (!g.moved) { if (dist(p, g.start) < 4) return; g.moved = true; pushUndo(); }
      const w = s2w(...p), dx = w[0] - g.w0[0], dy = w[1] - g.w0[1];
      for (const [id, orig] of g.orig) {
        const m = MK(id); if (!m) continue;
        const l = L(m.layer); if (!l || l.locked) continue;
        const pl = frameOf(m);
        m.pts = orig.map(q => { const ww = toWorld(pl, q); return toLocal(pl, [ww[0] + dx, ww[1] + dy]); });
      }
      dirty(); break;
    }
    case 'marquee': case 'zone': case 'wallfix': g.end = p; dirty(); break;
    case 'erase': eraseAt(p, g); break;
    case 'moveB': {
      const w = s2w(...p), t = g.tgt;
      t.x = g.x0 + w[0] - g.w0[0]; t.y = g.y0 + w[1] - g.w0[1]; dirty(); break;
    }
  }
}

export function up(p, e) {
  const g = gesture; stateVars.gesture = null;
  if (tool === 'pan' || spaceDown) cv.style.cursor = 'grab';
  else if (g && g.kind === 'pan') setTool(tool);
  if (!g) return;
  switch (g.kind) {
    case 'draw': {
      const c = cur; stateVars.cur = null; if (!c) break;
      const pl = frameOf(c);
      const ok = (c.type === 'pen' || c.type === 'hl') ? c.pts.length > 1 : dist(w2s(...toWorld(pl, c.pts[0])), w2s(...toWorld(pl, c.pts[1]))) > 4;
      if (ok) { pushUndo(); S.marks.push(c); changed(); } else dirty();
      break;
    }
    case 'tap': tapAction(p, e); break;
    case 'marquee': {
      const a = g.start, b = g.end;
      if (!g.add) sel.clear();
      if (dist(a, b) >= 4) {
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        for (const l of S.layers) {
          if (!l.visible || l.locked) continue;
          for (const m of S.marks) {
            if (m.layer !== l.id) continue;
            const pl = frameOf(m);
            const pts = m.type === 'rect' ? rectPts(m) : m.pts;
            if (pts.some(q => { const s = w2s(...toWorld(pl, q)); return s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1; })) sel.add(m.id);
          }
        }
      }
      highlightSealRow(); renderOpts(); dirty(); break;
    }
    case 'move': if (g.moved) changed(); break;
    case 'erase': if (g.pushed) changed(); break;
    case 'moveB': if (g.fl) { g.fl.how = 'manual'; g.fl.info = 'Ajustada a mano'; delete g.fl.t; if (g.fl.src) bFromA(g.fl); } changed(); renderPlans(); break;
    case 'wallfix': {
      if (wfMode === 'agregar') { if (dist(g.start, g.end) < 8) wallFixAddTap(s2w(...g.end), 9/view.z); else wallFixAddLine(s2w(...g.start), s2w(...g.end)); }
      else if (dist(g.start, g.end) < 8) wallFixTap(s2w(...g.end), 9/view.z);
      else wallFixRect(s2w(...g.start), s2w(...g.end));
      dirty(); break;
    }
    case 'zone': {
      if (dist(g.start, g.end) < 10) { dirty(); break; }
      const a = s2w(...g.start), b = s2w(...g.end);
      if (tool === 'lvlRect') { finishLevelRect([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]); break; }
      if (tool === 'floorA' || tool === 'floorB') { floorRect([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]); break; }
      S.auto.zone = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      save(); setTool('select'); renderAuto(); toast('Zona de búsqueda guardada.'); break;
    }
  }
}

export function tapAction(p, e) {
  const w = s2w(...p);
  if (tool === 'seal') {
    const hit = hitTest(p, true);
    if (hit) { setTool('select'); sel.add(hit.id); renderOpts(); highlightSealRow(); dirty(); return; }
    placeSeal(w); return;
  }
  if (tool === 'text') {
    const l = activeDrawLayer(); if (!l) return;
    const [pl, fl] = frameAt(l, w), lp = toLocal(pl, w);
    ask({title:'Nueva nota', input:'', placeholder:'Por ejemplo: pared 2 h, revisar ducto', ok:'Agregar'}).then(t => {
      if (!t) return; pushUndo();
      S.marks.push(Object.assign({id:uid(), type:'text', layer:l.id, fl, pts:[lp], size:baseW()*13/pl.s, text:t, w:0}, S.drawColor ? {color:S.drawColor} : {}));
      changed();
    });
    return;
  }
  if (tool === 'poly') {
    if (!cur) {
      const l = activeDrawLayer(); if (!l) return;
      const [pl, fl] = frameAt(l, w);
      stateVars.cur = {id:uid(), type:'poly', layer:l.id, fl, pts:[toLocal(pl, w)], w: baseW()*WIDTHS[S.width]/pl.s}; if (S.drawColor) cur.color = S.drawColor; if (S.drawAlpha < 1) cur.alpha = S.drawAlpha;
      renderOpts();
    } else {
      const pl = frameOf(cur);
      const last = w2s(...toWorld(pl, cur.pts[cur.pts.length-1]));
      if (dist(last, p) < 10 && cur.pts.length > 1) { finishPoly(); return; }
      let ww = w; if (e.shiftKey) ww = snapAngle(toWorld(pl, cur.pts[cur.pts.length-1]), w);
      cur.pts.push(toLocal(pl, ww));
    }
    dirty(); return;
  }
  if (tool === 'align') alignTap(w);
  if (tool === 'table') placeTable(w);
  if (tool === 'pick') pickAt(w);
}

export function finishPoly() {
  const c = cur; stateVars.cur = null;
  if (c && c.pts.length >= 2) { pushUndo(); S.marks.push(c); changed(); }
  renderOpts(); dirty();
}

export function placeSeal(w, st, noUndo) {
  const l = sealLayer(), [pl, fl] = frameAt(l, w);
  if (!noUndo) pushUndo();
  let n = ++S.seq;
  const fw = S.numPerFloor && S.floors.length ? floorAtWorld(w) : null;
  if (fw) n = 1 + Math.max(0, ...S.marks.filter(x => x.type === 'seal' && sealFloor(x) === fw).map(x => x.n));
  const m = {id:uid(), type:'seal', layer:l.id, fl, pts:[toLocal(pl, w)], st: st || S.sealType, loc: S.sealLoc || 'pared', n, note:'', w:0};
  S.marks.push(m);
  if (!noUndo) changed();
  return m;
}

export function eraseAt(p, g) {
  const m = hitTest(p);
  if (!m) return;
  if (!g.pushed) { pushUndo(); g.pushed = true; }
  S.marks = S.marks.filter(x => x !== m); sel.delete(m.id);
  updateCounts(); dirty();
}

export function deleteSel() {
  if (!sel.size) return;
  pushUndo();
  S.marks = S.marks.filter(m => !sel.has(m.id) || L(m.layer)?.locked);
  sel.clear(); changed();
}

export function reanchor(m, p0, p1) {
  if (m.type === 'rect' && Math.abs(normAng(p0.r - p1.r)) > 1e-6) { m.pts = rectPts(m); m.type = 'poly'; }
  m.pts = m.pts.map(q => toLocal(p1, toWorld(p0, q)));
  const f = p0.s / p1.s; if (m.w) m.w *= f; if (m.size) m.size *= f;
}

export function moveSelToLayer(lid) {
  const target = L(lid); if (!target || !sel.size) return;
  pushUndo();
  for (const id of sel) {
    const m = MK(id); if (!m || m.layer === lid) continue;
    const src = frameOf(m), [dst, fl] = frameAt(target, toWorld(src, m.pts[0])); reanchor(m, src, dst); m.layer = lid; m.fl = fl;
  }
  if (!target.visible) target.visible = true;
  changed(); toast(`Marcas movidas a "${target.name}".`);
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  ptrs = new Map();
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    const p = pos(e); ptrs.set(e.pointerId, p); stateVars.hover = p;
    if (ptrs.size === 2) {
      abortGesture();
      const [a, b] = [...ptrs.values()];
      stateVars.gesture = {kind:'pinch', d0:Math.max(1, dist(a, b)), c0:mid(a, b), v0:{...view}};
      return;
    }
    if (ptrs.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan') {
      stateVars.gesture = {kind:'pan', start:p, v0:{...view}}; cv.style.cursor = 'grabbing'; e.preventDefault(); return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down(p, e);
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e); stateVars.hover = p;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (!gesture) { if ((tool === 'poly' && cur) || align || tool === 'wallfix') dirty(); return; }
    if (gesture.kind === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()], g = gesture, c = mid(a, b);
      const z = clampZ(g.v0.z * dist(a, b) / g.d0);
      const wx = (g.c0[0] - g.v0.x)/g.v0.z, wy = (g.c0[1] - g.v0.y)/g.v0.z;
      view.z = z; view.x = c[0] - wx*z; view.y = c[1] - wy*z; dirty(); return;
    }
    move(p, e);
  });
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (gesture && gesture.kind !== 'pinch') abortGesture(); if (!ptrs.size) stateVars.gesture = null; });
  cv.addEventListener('pointerleave', () => { if (!gesture) { stateVars.hover = null; dirty(); } });
}
