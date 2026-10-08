/* Segundo plano A para revisar losas. En planos de tuberías bajo losa (sanitario, pluvial) las paredes que
   cruzan son las del nivel inferior, y ese es el plano A de trabajo. Para revisar los pasos por losa conviene
   ver debajo el arquitectónico del mismo nivel del plano B: se elige aparte (sh.aAlt = {a, lv, more}) y con el
   selector de arriba se cambia la vista entre "Paredes" y "Losa". Solo cambia lo que se ve: la detección, los
   sellos y la exportación siguen usando el plano A de paredes. Cada planta guarda su nivel de losa en f.alt. */
import { P, RT, S } from '../core/state.js';
import { curSheet } from '../project/model.js';
import { resolveEntry } from './arqlevels.js';
import { parseLevels } from '../core/levels.js';
import { autoAlignFloor, centerAt } from './floors.js';
import { akOf, altOnly, extraKeys } from './extraA.js';
import { loadPlanFile } from '../project/files.js';

export function hasAlt(sh = curSheet()) { return !!(sh && sh.kind === 'pair' && sh.aAlt && sh.aAlt.a && P.sheets[sh.aAlt.a]); }
/* ¿se está viendo el plano A de losas? */
export function altOn() { return S.aView === 'losa' && hasAlt() && S.floors.some(f => f.alt); }

export function altLevelObjs(sh) {
  if (!hasAlt(sh)) return [];
  const al = sh.aAlt, out = [];
  const add = (id, lv) => {
    const arq = P.sheets[id]; if (!arq) return;
    for (const e of (lv && lv.length ? lv : ['*'])) { const l = resolveEntry(arq, e); if (l) out.push({...l, asheet: id === sh.aSheet ? null : id}); }
  };
  add(al.a, al.lv);
  for (const m of al.more || []) if (m.aSheet !== al.a) add(m.aSheet, m.aLevels);
  return out;
}
const firstNum = lv => { const v = parseLevels(lv || '').map(Number).filter(x => !isNaN(x)); return v.length ? Math.min(...v) : 1e9; };

/* cada planta del arquitectónico (de abajo hacia arriba) se empareja con un nivel de losa, en el mismo orden */
export function syncAltFloors(sh) {
  const fl = S.floors.filter(f => f.src).sort((a, b) => firstNum(a.lvArq ?? a.levels) - firstNum(b.lvArq ?? b.levels));
  const al = altLevelObjs(sh).sort((a, b) => firstNum(a.levels) - firstNum(b.levels));
  for (const f of S.floors) if (!f.src) delete f.alt;
  fl.forEach((f, i) => {
    const l = al[i];
    if (!l) { delete f.alt; return; }
    if (f.alt && f.alt.src === l.id && (f.alt.asheet || null) === (l.asheet || null)) Object.assign(f.alt, {a: l.a.slice(), name: l.name, levels: l.levels});
    else f.alt = {src: l.id, asheet: l.asheet || null, name: l.name, levels: l.levels, a: l.a.slice(), pending: true};
  });
}

/* carga las láminas de losa que falten y alinea los niveles nuevos con el plano B (por ejes; si no, centrado) */
export async function prepareAlt() {
  const sh = curSheet(); if (!hasAlt(sh)) return;
  syncAltFloors(sh);
  const need = extraKeys.filter(k => altOnly.has(k) && !RT[k].bmp && S.plans[k].fileId && S.floors.some(f => f.alt && akOf(f.alt) === k));
  await Promise.all(need.map(k => { RT[k].loading = true; return loadPlanFile(k, S.plans[k].fileId, S.plans[k].page); }));
  if (curSheet() !== sh) return;
  for (const f of S.floors) {
    const al = f.alt; if (!al || !al.pending) continue;
    const k = akOf(al); if (!RT[k] || !RT[k].bmp || !RT.B.bmp) continue;
    delete al.pending;
    const tmp = {id: f.id + '-losa', name: `${f.name} (losa: ${al.name})`, levels: al.levels, a: al.a, asheet: al.asheet, src: al.src, b: f.b.slice(), at: centerAt(S.plans[k], al.a, f.b), how: 'sin'};
    const ok = await autoAlignFloor(tmp, true);
    al.at = tmp.at; al.how = ok ? 'ejes' : 'centro';
  }
}
