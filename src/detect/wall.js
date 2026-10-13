/* Tipo de pared de un sello: se lee del plano A en el punto del sello (las mismas paredes cortafuego elegidas
   en Detección). Sirve para los sellos puestos a mano, que no traen tipo de pared, y así el Excel de Firestop
   Suite puede asignar el material (concreto o panel de yeso) y el F rating de esa pared. */
import { S } from '../core/state.js';
import { baseW, toWorld } from '../core/geometry.js';
import { atOf, frameOf } from '../plans/floors.js';
import { akOf, extraFireRules } from '../plans/extraA.js';
import { sealFloor } from '../canvas/tables.js';
import { ensureLintels, ensureVec, paintExtras } from './vector.js';
import { paintRules } from './cross.js';
import { M } from '../core/geometry.js';

const LINT = 'Cargador sobre puerta', ADD = 'Pared agregada a mano';

export function fireRulesOf(k) { return k === 'A' ? (S.auto.fire || []).filter(r => r.on) : extraFireRules(k).filter(r => r.on); }

/* nombres de tipo de pared conocidos en este plano (para elegir a mano) */
export function wallNames() {
  const out = [];
  const add = n => { if (n && !out.includes(n)) out.push(n); };
  (S.auto.fire || []).filter(r => r.on).forEach(r => add(r.name));
  for (const f of S.floors) if (akOf(f) !== 'A') fireRulesOf(akOf(f)).forEach(r => add(r.name));
  S.marks.filter(m => m.type === 'seal' && m.wall).forEach(m => add(m.wall));
  add(LINT); add(ADD);
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

/* completa el tipo de pared de los sellos de pared que no lo tienen; devuelve cuántos se completaron */
export async function fillWalls(list) {
  let n = 0;
  for (const m of list) {
    if (m.type !== 'seal' || m.loc === 'losa' || m.wall) continue;
    const w = await wallOf(m);
    if (w) { m.wall = w; n++; }
  }
  return n;
}
