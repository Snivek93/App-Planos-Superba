/* Tipo de pared de un sello: se lee del plano A en el punto del sello (las mismas paredes cortafuego elegidas
   en Detección). Sirve para los sellos puestos a mano, que no traen tipo de pared, y así el Excel de Firestop
   Suite puede asignar el material (concreto o panel de yeso) y el F rating de esa pared. */
import { RT, S } from '../core/state.js';
import { locOf } from '../core/levels.js';
import { baseW, toWorld } from '../core/geometry.js';
import { atOf, frameOf } from '../plans/floors.js';
import { akOf, extraFireRules } from '../plans/extraA.js';
import { sealFloor } from '../canvas/tables.js';
import { ensureLintels, ensureVec, paintExtras } from './vector.js';
import { paintRules } from './cross.js';
import { M } from '../core/geometry.js';

const LINT = 'Cargador sobre puerta', ADD = 'Pared agregada a mano';
/* sello de pared sin pared cortafuego marcada debajo (o plano sin plano A): se toma como panel de yeso de 2 horas */
export const NO_WALL = 'Sin pared marcada en el plano A';

export function fireRulesOf(k) { return k === 'A' ? (S.auto.fire || []).filter(r => r.on) : extraFireRules(k).filter(r => r.on); }

/* nombres de tipo de pared conocidos en este plano (para elegir a mano) */
export function wallNames() {
  const out = [];
  const add = n => { if (n && !out.includes(n)) out.push(n); };
  (S.auto.fire || []).filter(r => r.on).forEach(r => add(r.name));
  for (const f of S.floors) if (akOf(f) !== 'A') fireRulesOf(akOf(f)).forEach(r => add(r.name));
  S.marks.filter(m => m.type === 'seal' && m.wall).forEach(m => add(m.wall));
  add(LINT); add(ADD); add(NO_WALL);
  return out;
}

/* tipo de pared bajo el punto w (coordenadas del mundo), o '' si no hay pared cortafuego cerca */
export async function wallAtWorld(w, f) {
  const ak = f ? akOf(f) : 'A', rules = fireRulesOf(ak);
  if (!rules.length) return '';
  try { await ensureVec(ak); } catch (e) { return ''; }
  const frame = f ? atOf(f) : S.plans.A, clip = f ? f.a : null;
  const R = Math.max(baseW()*4, 6), res = Math.min(6, 60/R);
  const reg = [w[0] - R, w[1] - R], W = Math.max(3, Math.ceil(2*R*res)), H = W;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', {willReadFrequently:true});
  paintRules(g, rules, r => `rgb(${(rules.indexOf(r) + 1)*12},0,0)`, res, reg[0], reg[1], 1, frame, clip);
  // cargadores sobre puertas y paredes agregadas a mano también son pared cortafuego
  const ex = ensureLintels(ak);
  if (ex && (ex.lint.length || ex.adds.length)) {
    const m = M(frame);
    g.save(); g.setTransform(res, 0, 0, res, -reg[0]*res, -reg[1]*res); g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (clip) { g.beginPath(); g.rect(clip[0], clip[1], clip[2]-clip[0], clip[3]-clip[1]); g.clip(); }
    paintExtras(g, ex, 'rgb(240,0,0)', 'rgb(252,0,0)');
    g.restore();
  }
  const d = g.getImageData(0, 0, W, H).data, cx = W/2, cy = H/2;
  let best = Infinity, red = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y*W + x)*4; if (d[i+3] < 60) continue;
    const dd = (x - cx)*(x - cx) + (y - cy)*(y - cy); if (dd < best) { best = dd; red = d[i]; }
  }
  if (red < 0) return '';
  if (red === 240) return LINT;
  if (red === 252) return ADD;
  const r = rules[Math.round(red/12) - 1];
  return r ? r.name : '';
}

export async function wallOf(m) {
  if (!m.pts) return '';
  const f = S.floors.length ? sealFloor(m) : null;
  return wallAtWorld(toWorld(frameOf(m), m.pts[0]), f);
}

/* completa el tipo de pared de los sellos de pared que no lo tienen; devuelve cuántos se completaron.
   Con def, los que no están sobre una pared cortafuego quedan como NO_WALL (panel de yeso, 2 horas). */
export async function fillWalls(list, def = false) {
  let n = 0;
  for (const m of list) {
    if (m.type !== 'seal' || m.loc === 'losa' || m.wall) continue;
    let w = ''; try { w = await wallOf(m); } catch (e) { w = ''; }
    if (w) { m.wall = w; delete m.wallNone; n++; }
    else if (def) { m.wall = NO_WALL; m.wallNone = true; }
  }
  return n;
}

/* firma de las paredes cortafuego elegidas: si cambia, se vuelven a buscar los sellos que quedaron sin pared */
function fireSig() {
  const ks = [...new Set(['A', ...S.floors.map(akOf)])];
  return JSON.stringify([S.plans.A.fileId || '', ks.map(k => [k, fireRulesOf(k).map(r => r.id + ':' + (r.key || r.name))])]);
}
/* hay sellos de pared por completar en este estado (sin mirar el plano) */
export function wallsPending(st = S) {
  return st.marks.some(m => m.type === 'seal' && locOf(m) === 'pared' && !m.wall);
}

/* Completa solo, al abrir el plano, el tipo de pared de los sellos de pared que no lo tienen: el de la pared
   cortafuego del plano A debajo del sello, o NO_WALL (panel de yeso, 2 horas) si no hay ninguna.
   Si las paredes elegidas en Detección cambiaron, vuelve a buscar los que habían quedado como NO_WALL.
   No toca los sellos con tipo de pared elegido o detectado. Devuelve {n, found, none} o null. */
const running = new WeakMap();
export function autoWalls(force = false) {
  const st = S;
  if (running.has(st)) return running.get(st);
  const pr = (async () => {
    const hasA = !!S.plans.A.fileId, sig = fireSig();
    const redo = force || S.wallSig !== sig;
    const list = S.marks.filter(m => m.type === 'seal' && locOf(m) === 'pared' && (!m.wall || (redo && m.wallNone)));
    if (!list.length) { if (S.wallSig !== sig) S.wallSig = sig; return null; }
    const anyRules = hasA && [...new Set(['A', ...S.floors.map(akOf)])].some(k => fireRulesOf(k).length);
    // plano A todavía cargando o con error: se intenta la próxima vez que se abra el plano
    if (anyRules && (!RT.A || !RT.A.bmp)) return null;
    const prev = new Map(list.map(m => [m, [m.wall, m.wallNone]]));
    list.forEach(m => { m.wall = ''; delete m.wallNone; });
    let found = 0, none = 0;
    for (const m of list) {
      if (S !== st) { prev.forEach(([w, wn], x) => { if (!x.wall) { x.wall = w || ''; if (wn) x.wallNone = true; } }); return null; }
      let w = '';
      if (anyRules) { try { w = await wallOf(m); } catch (e) { w = ''; } }
      if (S !== st) { m.wall = prev.get(m)[0] || ''; if (prev.get(m)[1]) m.wallNone = true; continue; }
      if (w) { m.wall = w; found++; } else { m.wall = NO_WALL; m.wallNone = true; none++; }
    }
    S.wallSig = sig;
    return {n: list.length, found, none};
  })();
  running.set(st, pr);
  pr.finally(() => running.delete(st));
  return pr;
}
