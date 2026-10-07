/* Niveles en las hojas de arquitectónicos: recuadros con nombre y niveles (por ejemplo "Nivel 6" o
   "Niveles 7 y 8") dibujados una vez en el arquitectónico. Cada plano de instalaciones puede usar la
   hoja completa o uno o varios de esos niveles como plano A:
   - un nivel: el plano A muestra solo ese recuadro y los niveles del plano se llenan solos;
   - varios niveles: se crea una planta por nivel, ya ubicada según la alineación general. */
import { esc, PDF_UNIT } from '../core/constants.js';
import { P, RT, S, uid } from '../core/state.js';
import { toLocal, toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { fitRect } from './floors.js';
import { ensureText, floorsVars } from './floors.js';
import { parseLevels, joinY } from '../core/levels.js';
import { save } from '../core/storage.js';
import { ask, changed, closePanel, toast } from '../ui/app.js';
import { setTool } from '../editor/tools.js';
import { renderPlans } from '../panels/planos.js';
import { ICON } from '../ui/icons.js';
import { curSheet, sheetsOf } from '../project/model.js';

export function lvlsOf(arqSheet) { return (arqSheet && arqSheet.state.lvls) || []; }
const lvlRectWorld = l => { const A = S.plans.A, q = [[l.a[0], l.a[1]], [l.a[2], l.a[3]]].map(v => toWorld(A, v)); return [Math.min(q[0][0], q[1][0]), Math.min(q[0][1], q[1][1]), Math.max(q[0][0], q[1][0]), Math.max(q[0][1], q[1][1])]; };

/* --- en la hoja de arquitectónicos --- */
export function arqLevelsHtml() {
  const L = S.lvls || [];
  return `<section class="plan"><header><span class="badge" style="background:#12866B">N</span><div><h3>Niveles en esta lámina</h3><p class="muted">Para usar uno o varios niveles como plano A</p></div></header>
    <p class="help" style="margin:0 0 10px">Encierre cada planta de la lámina (por ejemplo "Nivel 6" y "Niveles 7 y 8"). Después, en cada plano eléctrico, mecánico o de supresión puede elegir la hoja completa o solo esos niveles.</p>
    ${L.length ? `<ul class="floors">${L.map(l => `<li data-lvl="${l.id}">
      <div class="frow"><input data-act="lvName" value="${esc(l.name)}" aria-label="Nombre del nivel"><b class="fmult" title="Niveles que representa">×${Math.max(1, parseLevels(l.levels).length)}</b></div>
      <div class="frow" style="margin-top:6px"><span class="small muted" style="white-space:nowrap">Niveles</span><input data-act="lvLevels" value="${esc(l.levels || '')}" placeholder="Ej.: 6, o 7, 8" aria-label="Niveles"></div>
      <div class="small muted">${usersOf(l.id)}</div>
      <div class="btnrow"><button class="btn" data-act="lvView">Ver</button><button class="btn" data-act="lvRedraw">Redibujar</button><button class="icon" data-act="lvDel" title="Quitar nivel">${ICON.trash}</button></div></li>`).join('')}</ul>` : ''}
    <button class="btn primary" data-act="lvAdd">Agregar nivel</button></section>`;
}
function usersOf(id) {
  const n = Object.values(P.sheets).filter(s => (s.aLevels || []).includes(id)).length;
  return n ? `Usado en ${n} ${n === 1 ? 'plano' : 'planos'}` : 'Todavía no se usa en ningún plano';
}

let drawTarget = null; // id del nivel que se redibuja, o null para uno nuevo
export function startLevelRect(id) {
  if (!RT.A.bmp) return toast('Primero suba el plano.');
  drawTarget = id || null;
  closePanel(); floorsVars.solo = null; setTool('lvlRect'); dirty();
}
/* Texto del PDF dentro del recuadro, para proponer nombre y niveles ("NIVELES 7 Y 8"). */
async function suggest(a) {
  try {
    if (!RT.A.isPdf) return null;
    const runs = (await ensureText('A')).filter(r => r.x >= a[0] && r.x <= a[2] && r.y >= a[1] && r.y <= a[3]);
    runs.sort((p, q) => p.y - q.y || p.x - q.x);
    const lines = [];
    for (const r of runs) { const ln = lines.find(l => Math.abs(l.y - r.y) < r.h*0.6); if (ln) ln.t.push(r); else lines.push({y:r.y, t:[r]}); }
    for (const ln of lines) {
      const txt = ln.t.sort((p, q) => p.x - q.x).map(r => r.s).join(' ');
      const m = txt.match(/\bNIVEL(?:ES)?\b[\s:.#Nº°-]*((?:-?\d+)(?:\s*(?:,|Y|E|AL|A|-|–)\s*-?\d+)*)/i);
      if (m) { const lv = parseLevels(m[1].replace(/\s+(y|e)\s+/ig, ', ')); if (lv.length) return {name: `${lv.length === 1 ? 'Nivel' : 'Niveles'} ${joinY(lv)}`, levels: lv.join(', ')}; }
    }
  } catch (e) { console.warn(e); }
  return null;
}
export async function finishLevelRect(rw) {
  const A = S.plans.A, q = [[rw[0], rw[1]], [rw[2], rw[1]], [rw[2], rw[3]], [rw[0], rw[3]]].map(v => toLocal(A, v));
  const a = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))].map(v => Math.round(v*10)/10);
  setTool('select');
  if (!S.lvls) S.lvls = [];
  const ex = drawTarget && S.lvls.find(l => l.id === drawTarget); drawTarget = null;
  if (ex) { ex.a = a; save(); renderPlans(); dirty(); toast(`Recuadro de "${ex.name}" actualizado.`); return; }
  const sg = await suggest(a);
  const n = S.lvls.length + 1;
  const v = await ask({title:'Nuevo nivel', body: sg ? 'Se tomó el nombre del texto del plano; corríjalo si hace falta.' : '',
    html:`<label class="row"><span>Nombre</span><input type="text" id="lvN" value="${esc(sg ? sg.name : 'Nivel ' + n)}"></label>
      <label class="row"><span>Niveles que representa (planta típica: varios)</span><input type="text" id="lvL" value="${esc(sg ? sg.levels : '')}" placeholder="Ej.: 6, o 7, 8"></label>`,
    buttons:[{label:'Cancelar', value:null}, {label:'Agregar', value:'ok', primary:true}],
    read: r => ({name: r.querySelector('#lvN').value.trim(), levels: r.querySelector('#lvL').value.trim()})});
  if (!v) { dirty(); return; }
  const name = v.name || 'Nivel ' + n;
  const lv = parseLevels(v.levels || name);
  S.lvls.push({id:'v' + uid(), name, levels: lv.every(x => /\d/.test(x)) ? lv.join(', ') : (v.levels || ''), a});
  save(); renderPlans(); dirty();
  toast(`Nivel "${name}" agregado. Ya se puede elegir como plano A.`);
}
export async function levelsClick(a, li) {
  const l = (S.lvls || []).find(x => x.id === li?.dataset.lvl);
  if (a === 'lvAdd') return startLevelRect(null);
  if (!l) return;
  if (a === 'lvView') { closePanel(); fitRect(lvlRectWorld(l)); }
  else if (a === 'lvRedraw') startLevelRect(l.id);
  else if (a === 'lvDel') {
    const users = Object.values(P.sheets).filter(s => (s.aLevels || []).includes(l.id));
    const ok = await ask({title:'Quitar nivel', body: users.length ? `"${l.name}" se usa en ${users.length} ${users.length === 1 ? 'plano' : 'planos'}; esos planos pasarán a usar la hoja completa (o los demás niveles elegidos).` : `Se quita "${l.name}".`, buttons:[{label:'Cancelar', value:false}, {label:'Quitar', value:true, danger:true}]});
    if (!ok) return;
    users.forEach(s => { s.aLevels = s.aLevels.filter(x => x !== l.id); });
    S.lvls = S.lvls.filter(x => x !== l); save(); renderPlans(); dirty();
  }
}
export function levelsChange(t, li) {
  const l = (S.lvls || []).find(x => x.id === li?.dataset.lvl); if (!l) return false;
  if (t.dataset.act === 'lvName') { l.name = t.value.trim() || l.name; }
  else if (t.dataset.act === 'lvLevels') { l.levels = t.value.trim(); }
  else return false;
  save(); renderPlans(); dirty(); return true;
}
/* recuadros de nivel dibujados sobre la hoja de arquitectónicos */
export function drawLevelRects(ctx, w2s) {
  for (const l of (S.lvls || [])) {
    const r = lvlRectWorld(l), a = w2s(r[0], r[1]), b = w2s(r[2], r[3]);
    ctx.strokeStyle = 'rgba(18,134,107,.85)'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]);
    ctx.strokeRect(a[0], a[1], b[0]-a[0], b[1]-a[1]); ctx.setLineDash([]);
    ctx.font = '600 13px Barlow, sans-serif'; const tw = ctx.measureText(l.name).width;
    ctx.fillStyle = 'rgba(18,134,107,.92)'; ctx.fillRect(a[0], a[1] - 20, tw + 12, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(l.name, a[0] + 6, a[1] - 6);
  }
}

/* --- en el plano de instalaciones --- */
export function aLevelObjs(sh) {
  const arq = P.sheets[sh.aSheet];
  return (sh.aLevels || []).map(id => lvlsOf(arq).find(l => l.id === id)).filter(Boolean);
}
/* Opciones "hoja completa" y "hoja › nivel" para elegir el plano A en una lista. */
export function arqLevelOptions(selA, selLv) {
  const cur = (selLv || []).join(',');
  return sheetsOf('arq').map(a => {
    const L = lvlsOf(a);
    let h = `<option value="${a.id}"${a.id === selA && !cur ? ' selected' : ''}>${esc(a.name)}${L.length ? ' (hoja completa)' : ''}</option>`;
    h += L.map(l => `<option value="${a.id}|${l.id}"${a.id === selA && cur === l.id ? ' selected' : ''}>${esc(a.name)} › ${esc(l.name)}</option>`).join('');
    if (a.id === selA && (selLv || []).length > 1) h += `<option value="${a.id}|${cur}" selected>${esc(a.name)} › ${esc(selLv.map(id => L.find(l => l.id === id)?.name).filter(Boolean).join(', '))}</option>`;
    return h;
  }).join('');
}
export function parseALevel(v) { const [a, ids] = String(v || '').split('|'); return {a, lv: ids ? ids.split(',').filter(Boolean) : []}; }

function floorFromLevel(st, l) {
  const A = st.plans.A, B = st.plans.B;
  const q = [[l.a[0], l.a[1]], [l.a[2], l.a[1]], [l.a[2], l.a[3]], [l.a[0], l.a[3]]].map(v => toLocal(B, toWorld(A, v)));
  const b = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
  return {id:'f' + uid(), src:l.id, name:l.name, levels:l.levels, a:l.a.slice(), b, t:{x:B.x, y:B.y, s:B.s, r:B.r}, how:'nivel',
    info:'Del arquitectónico, ubicada según la alineación general. Si no calza, use "Alinear por ejes" o "2 puntos".'};
}
/* Ajusta plantas, recorte del plano A y niveles según los niveles elegidos del arquitectónico. */
export function syncLevelFloors(sh) {
  const st = sh.state, arq = P.sheets[sh.aSheet];
  if (!arq || sh.kind !== 'pair') return false;
  const lv = aLevelObjs(sh);
  if ((sh.aLevels || []).length !== lv.length) sh.aLevels = lv.map(l => l.id);
  let ch = false;
  if (lv.length >= 2) {
    st.aClip = null;
    for (const l of lv) {
      const f = st.floors.find(f => f.src === l.id);
      if (!f) { st.floors.push(floorFromLevel(st, l)); ch = true; }
      else { f.a = l.a.slice(); f.name = l.name; f.levels = l.levels; }
    }
    const n = st.floors.length; st.floors = st.floors.filter(f => !f.src || lv.some(l => l.id === f.src)); if (st.floors.length !== n) ch = true;
  } else {
    const n = st.floors.length; st.floors = st.floors.filter(f => !f.src); if (st.floors.length !== n) ch = true;
    if (lv.length === 1) { st.aClip = lv[0].a.slice(); if (!st.levels || st.levelsAuto) { st.levels = lv[0].levels; st.levelsAuto = true; } }
    else { st.aClip = null; if (st.levelsAuto) { st.levels = ''; st.levelsAuto = false; } }
  }
  return ch;
}
/* recortes del plano A en el plano abierto: un nivel, o las plantas que vienen del arquitectónico */
export function aClips() {
  const sh = curSheet(); if (!sh || sh.kind !== 'pair') return null;
  if (S.aClip) return [S.aClip];
  const fs = S.floors.filter(f => f.src);
  return fs.length ? fs.map(f => f.a) : null;
}
export { PDF_UNIT };
