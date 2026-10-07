/* Detección automática de cruces entre tuberías y paredes cortafuego. */
import { isMobile, nextCatColor } from '../core/constants.js';
import { S, sel, uid, undoStack } from '../core/state.js';
import { baseW, dist, M, toLocal, toWorld } from '../core/geometry.js';
import { placeSeal } from '../editor/pointer.js';
import { pushUndo } from '../core/undo.js';
import { changed, renderTop, toast } from '../ui/app.js';
import { floorRectWorld, frameOf } from '../plans/floors.js';
import { ensureLabels, ensureVec, fireEdits, paintEvents, ruleCache, visibleEvents } from './vector.js';
import { RT } from '../core/state.js';
import { renderAuto } from '../panels/deteccion.js';

/* cruces automáticos */
export function catForName(name) {
  let t = S.sealTypes.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!t) {
    t = {id:'c' + uid(), name, color: nextCatColor()};
    const pi = S.sealTypes.findIndex(x => x.id === 'pend');
    pi >= 0 ? S.sealTypes.splice(pi, 0, t) : S.sealTypes.push(t);
  }
  return t.id;
}

export function ruleWorldBB(r) {
  const c = ruleCache(r); if (!c || !c.count) return null;
  const p = S.plans[r.plan], [x0, y0, x1, y1] = c.bb;
  const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(v => toWorld(p, v));
  return [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
}

/* Pinta en g (región reg con resolución res) lo visible de las reglas elegidas, en el marco del plano o la planta. */
export function paintRules(g, rules, colorOf, res, ox, oy, minPx, fr, clip) {
  const k = rules[0].plan, rt = RT[k], p = fr || S.plans[k], m = M(p);
  const fx = fireEdits(k);
  g.save();
  g.setTransform(res, 0, 0, res, -ox*res, -oy*res); g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (clip) { g.beginPath(); g.rect(clip[0], clip[1], clip[2]-clip[0], clip[3]-clip[1]); g.clip(); }
  paintEvents(g, visibleEvents(rt.vec, rules, fx), colorOf, minPx/(res*p.s), fx);
  g.restore();
}

export async function runAuto() {
  const fr = S.auto.fire.filter(r => r.on), pr = S.auto.pipes.filter(r => r.on);
  if (!fr.length) return toast('Primero elija al menos un tipo de pared cortafuego en el plano A.');
  if (!pr.length) return toast('Primero elija al menos un tipo de tubería en el plano B.');
  toast('Buscando cruces…');
  try {
    for (const k of new Set([...fr, ...pr].map(r => r.plan))) await ensureVec(k);
  } catch (err) { return toast(err.message); }
  await new Promise(r => setTimeout(r, 30));
  // trabajos: una búsqueda por planta, o una sola para toda la lámina
  const jobs = [];
  if (S.floors.length) {
    for (const f of S.floors) {
      const rw = floorRectWorld(f);
      jobs.push({floor:f, reg:rw, frames:{A:[S.plans.A, f.a], B:[f.t, f.b]}});
    }
  } else {
    const bbs = fr.map(ruleWorldBB).filter(Boolean), pbs = pr.map(ruleWorldBB).filter(Boolean);
    if (!bbs.length || !pbs.length) return toast('No se encontraron formas con los estilos elegidos en esta página.');
    let reg = [Math.min(...bbs.map(b => b[0])), Math.min(...bbs.map(b => b[1])), Math.max(...bbs.map(b => b[2])), Math.max(...bbs.map(b => b[3]))];
    reg = [Math.max(reg[0], Math.min(...pbs.map(b => b[0]))), Math.max(reg[1], Math.min(...pbs.map(b => b[1]))), Math.min(reg[2], Math.max(...pbs.map(b => b[2]))), Math.min(reg[3], Math.max(...pbs.map(b => b[3])))];
    if (S.auto.zone) { const z = S.auto.zone; reg = [Math.max(reg[0], z[0]), Math.max(reg[1], z[1]), Math.min(reg[2], z[2]), Math.min(reg[3], z[3])]; }
    if (S.aClip) { const c = S.aClip, A = S.plans.A, q = [[c[0], c[1]], [c[2], c[3]]].map(v => toWorld(A, v)); reg = [Math.max(reg[0], Math.min(q[0][0], q[1][0])), Math.max(reg[1], Math.min(q[0][1], q[1][1])), Math.min(reg[2], Math.max(q[0][0], q[1][0])), Math.min(reg[3], Math.max(q[0][1], q[1][1]))]; }
    jobs.push({floor:null, reg, frames:{A:[S.plans.A, null], B:[S.plans.B, null]}});
  }
  const labelsBy = {};
  if (S.auto.diam) for (const r of pr) { try { labelsBy[r.plan] = labelsBy[r.plan] || await ensureLabels(r.plan); } catch (e) { labelsBy[r.plan] = []; } }
  const found = [];
  for (const job of jobs) {
    const pad = 10, reg = [job.reg[0]-pad, job.reg[1]-pad, job.reg[2]+pad, job.reg[3]+pad];
    const rw = reg[2]-reg[0], rh = reg[3]-reg[1];
    if (rw <= 0 || rh <= 0) continue;
    const res = Math.min(2, Math.sqrt((isMobile ? 6e6 : 12e6)/(rw*rh)));
    const W = Math.max(1, Math.ceil(rw*res)), H = Math.max(1, Math.ceil(rh*res));
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d', {willReadFrequently:true}); };
    const gf = mk();
    { const [f0, c0] = job.frames.A; paintRules(gf, fr, r => `rgb(${(fr.indexOf(r) + 1)*12},0,0)`, res, reg[0], reg[1], 1, f0, c0); }
    const F = gf.getImageData(0, 0, W, H).data;
    const gp = mk();
    const mark = new Uint8Array(W*H), stack = new Int32Array(W*H);
    pr.forEach(r => {
      gp.setTransform(1, 0, 0, 1, 0, 0); gp.clearRect(0, 0, W, H);
      const [f0, c0] = job.frames[r.plan]; paintRules(gp, [r], () => '#000', res, reg[0], reg[1], 1.2, f0, c0);
      const P = gp.getImageData(0, 0, W, H).data;
      mark.fill(0);
      for (let i = 0, n = W*H; i < n; i++) if (P[i*4+3] > 60 && F[i*4+3] > 60) mark[i] = 1;
      for (let i = 0, n = W*H; i < n; i++) {
        if (mark[i] !== 1) continue;
        let sp = 0; stack[sp++] = i; mark[i] = 2;
        let cnt = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; const votes = {};
        while (sp) {
          const q = stack[--sp], x = q % W, y = (q - x)/W;
          cnt++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          const fi = Math.round(F[q*4]/12) - 1; votes[fi] = (votes[fi] || 0) + 1;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nq = ny*W + nx; if (mark[nq] === 1) { mark[nq] = 2; stack[sp++] = nq; }
          }
        }
        if (cnt < 2) continue;
        const fi = +Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
        found.push({r, job, x: reg[0] + (sx/cnt + .5)/res, y: reg[1] + (sy/cnt + .5)/res, ext: Math.max(x1 - x0, y1 - y0)/res, wall: fr[Math.max(0, Math.min(fr.length - 1, fi))]});
      }
    });
  }
  const merged = [], mergeD = 8;
  for (const f of found) {
    const g = merged.find(m => m.r === f.r && m.job === f.job && Math.hypot(m.x - f.x, m.y - f.y) < mergeD);
    if (g) { g.x = (g.x + f.x)/2; g.y = (g.y + f.y)/2; g.ext = Math.max(g.ext, f.ext); } else merged.push({...f});
  }
  const existing = S.marks.filter(m => m.type === 'seal').map(m => ({p: toWorld(frameOf(m), m.pts[0]), sys: m.auto ? m.sys : null}));
  const tol = Math.max(baseW()*3, 6);
  pushUndo();
  let added = 0, review = 0, noD = 0;
  const perFloor = {};
  for (const f of merged) {
    if (existing.some(e => (e.sys === f.r.name && dist(e.p, [f.x, f.y]) < tol) || (e.sys === null && dist(e.p, [f.x, f.y]) < tol*0.5))) continue;
    let d = null;
    if (S.auto.diam) {
      const lp = toLocal(f.job.frames[f.r.plan][0], [f.x, f.y]);
      let best = 110;
      for (const lb of labelsBy[f.r.plan] || []) { const dd = Math.hypot(lb.x - lp[0], lb.y - lp[1]); if (dd < best) { best = dd; d = lb.d; } }
    }
    const rev = f.ext > 32;
    let st = 'pend';
    if (S.auto.catMode === 'diam' && d) st = catForName(d);
    else if (S.auto.catMode === 'sys') st = catForName(f.r.name);
    else if (S.auto.catMode === 'both' && d) st = catForName(`${f.r.name} ${d}`);
    const m = placeSeal([f.x, f.y], st, true);
    const fname = f.job.floor ? f.job.floor.name : '';
    Object.assign(m, {auto:true, loc:'pared', diam:d || '', sys:f.r.name, wall:f.wall ? f.wall.name : '', review:rev,
      note: [d || 'ø sin rótulo', f.r.name, f.wall ? f.wall.name : '', fname, rev ? 'revisar: corre a lo largo de la pared' : ''].filter(Boolean).join(' · ')});
    existing.push({p:[f.x, f.y], sys:f.r.name}); added++; if (rev) review++; if (!d) noD++;
    if (fname) perFloor[fname] = (perFloor[fname] || 0) + 1;
  }
  if (!added) { undoStack.pop(); renderTop(); S.auto.last = 'No se encontraron cruces nuevos.'; renderAuto(); return toast('No se encontraron cruces nuevos.'); }
  const pf = Object.keys(perFloor).length ? ' (' + Object.entries(perFloor).map(([k, v]) => `${k}: ${v}`).join(', ') + ')' : '';
  S.auto.last = `Última búsqueda: ${added} ${added === 1 ? 'sello agregado' : 'sellos agregados'}${pf}` + (review ? `, ${review} para revisar` : '') + (S.auto.diam && noD ? `, ${noD} sin diámetro identificado` : '') + '.';
  changed(); renderAuto();
  toast(S.auto.last.replace('Última búsqueda: ', 'Listo: '));
}

export function clearAutoSeals() {
  const n = S.marks.filter(m => m.type === 'seal' && m.auto).length;
  if (!n) return toast('No hay sellos automáticos.');
  pushUndo(); S.marks = S.marks.filter(m => !(m.type === 'seal' && m.auto)); sel.clear(); changed();
  toast(`Se quitaron ${n} sellos automáticos. Puede deshacerlo.`);
}
