/* Niveles en las hojas de arquitectónicos: recuadros con nombre y niveles (por ejemplo "Nivel 6" o
   "Niveles 7 y 8") dibujados una vez en el arquitectónico. Cada plano de instalaciones puede usar la
   hoja completa o uno o varios de esos niveles como plano A:
   - un nivel: el plano A muestra solo ese recuadro y los niveles del plano se llenan solos;
   - varios niveles: se crea una planta por nivel, ya ubicada según la alineación general. */
import { esc, PDF_UNIT } from '../core/constants.js';
import { P, RT, S, uid } from '../core/state.js';
import { toLocal, toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { centerAt, fitRect } from './floors.js';
import { ensureText, floorsVars } from './floors.js';
import { parseLevels, joinY } from '../core/levels.js';
import { save } from '../core/storage.js';
import { ask, changed, closePanel, renderTop, toast } from '../ui/app.js';
import { fit } from '../canvas/view.js';
import { setTool } from '../editor/tools.js';
import { renderPlans } from '../panels/planos.js';
import { ICON } from '../ui/icons.js';
import { curSheet, sheetsOf } from '../project/model.js';
import { akOf, keyOfSheet } from './extraA.js';

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
      ${regionLevels(l).length > 1 ? `<div class="lvchips"><span class="small muted">Ver:</span>${regionLevels(l).map(x => `<button class="chip" data-act="lvShow" data-v="${l.id}@${x}">${esc(x)}</button>`).join('')}</div>` : ''}
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
export async function levelsClick(a, li, btn) {
  const l = (S.lvls || []).find(x => x.id === li?.dataset.lvl);
  if (a === 'lvAdd') return startLevelRect(null);
  if (!l) return;
  if (a === 'lvView') { viewLevel = l.id; closePanel(); renderTop(); fit(); dirty(); }
  else if (a === 'lvShow') { viewLevel = btn?.dataset?.v || l.id; closePanel(); renderTop(); fit(); dirty(); }
  else if (a === 'lvRedraw') startLevelRect(l.id);
  else if (a === 'lvDel') {
    const mine = e => String(e).split('@')[0] === l.id;
    const users = Object.values(P.sheets).filter(s => (s.aLevels || []).some(mine));
    const ok = await ask({title:'Quitar nivel', body: users.length ? `"${l.name}" se usa en ${users.length} ${users.length === 1 ? 'plano' : 'planos'}; esos planos pasarán a usar la hoja completa (o los demás niveles elegidos).` : `Se quita "${l.name}".`, buttons:[{label:'Cancelar', value:false}, {label:'Quitar', value:true, danger:true}]});
    if (!ok) return;
    users.forEach(s => { s.aLevels = s.aLevels.filter(x => !mine(x)); });
    if (viewLevel && mine(viewLevel)) viewLevel = null;
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
  const v = viewLevelObj();
  for (const l0 of (S.lvls || [])) {
    if (v && v.region !== l0.id) continue;
    const l = v ? {...l0, name: v.typical ? `${v.name} · planta típica (${l0.name})` : l0.name} : l0;
    const r = lvlRectWorld(l), a = w2s(r[0], r[1]), b = w2s(r[2], r[3]);
    ctx.strokeStyle = 'rgba(18,134,107,.85)'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]);
    ctx.strokeRect(a[0], a[1], b[0]-a[0], b[1]-a[1]); ctx.setLineDash([]);
    ctx.font = '600 13px Barlow, sans-serif'; const tw = ctx.measureText(l.name).width;
    ctx.fillStyle = 'rgba(18,134,107,.92)'; ctx.fillRect(a[0], a[1] - 20, tw + 12, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(l.name, a[0] + 6, a[1] - 6);
  }
}

/* --- niveles individuales de una planta típica ---
   Un recuadro puede representar varios niveles ("Niveles 4 a 7"). Se puede usar completo o solo
   algunos de sus niveles: la entrada "id@6" es el nivel 6 de ese recuadro (mismo dibujo, otro nivel). */
export function regionLevels(l) { const lv = parseLevels(l.levels || ''); return lv.filter(x => /\d/.test(x)); }
const lvName = lv => `${lv.length === 1 ? 'Nivel' : 'Niveles'} ${joinY(lv)}`;
export function resolveEntry(arq, entry) {
  if (entry === '*') { // la hoja completa como una planta (cuando se combina con niveles de otra lámina)
    const a = arq && arq.state.plans.A; if (!a || !a.w) return null;
    return {id:'*', region:'*', name: arq.name, levels:'', a:[0, 0, a.w, a.h]};
  }
  const [id, sub] = String(entry).split('@'), l = lvlsOf(arq).find(x => x.id === id);
  if (!l) return null;
  if (!sub) return {...l, region:l.id};
  const all = regionLevels(l), lv = sub.split(',').filter(x => all.includes(x));
  if (!lv.length) return null;
  if (lv.length === all.length) return {...l, region:l.id};
  return {...l, id:entry, region:l.id, levels:lv.join(', '), name:lvName(lv), typical:l.name};
}
/* agrupa la selección: un recuadro completo, o los niveles sueltos de cada recuadro en una sola entrada */
export function normEntries(arq, entries) {
  const by = new Map(), star = (entries || []).includes('*');
  for (const e of entries || []) {
    const [id, sub] = String(e).split('@'); const l = lvlsOf(arq).find(x => x.id === id); if (!l) continue;
    const cur = by.get(id) || {all:false, lv:new Set()};
    if (!sub) cur.all = true; else sub.split(',').forEach(x => cur.lv.add(x));
    by.set(id, cur);
  }
  const out = [];
  for (const l of lvlsOf(arq)) {
    const c = by.get(l.id); if (!c) continue;
    const all = regionLevels(l), lv = all.filter(x => c.lv.has(x));
    out.push(c.all || !all.length || lv.length === all.length ? l.id : `${l.id}@${lv.join(',')}`);
  }
  if (star) out.push('*');
  return out;
}

/* --- en el plano de instalaciones --- */
export function aLevelObjs(sh) {
  const arq = P.sheets[sh.aSheet];
  return (sh.aLevels || []).map(e => resolveEntry(arq, e)).filter(Boolean);
}
/* niveles elegidos de otras láminas de arquitectónicos (cada uno con su lámina de origen en asheet) */
export function moreLevelObjs(sh) {
  const out = [];
  for (const m of sh.aMore || []) {
    const arq = P.sheets[m.aSheet]; if (!arq || m.aSheet === sh.aSheet) continue;
    const ent = (m.aLevels && m.aLevels.length) ? m.aLevels : ['*'];
    for (const e of ent) { const l = resolveEntry(arq, e); if (l) out.push({...l, asheet: m.aSheet, sheetName: arq.name}); }
  }
  return out;
}
/* Opciones "hoja completa", "hoja › recuadro" y "hoja › nivel suelto" para elegir el plano A en una lista. */
export function arqLevelOptions(selA, selLv) {
  const cur = (selLv || []).join(',');
  return sheetsOf('arq').map(a => {
    const L = lvlsOf(a);
    let h = `<option value="${a.id}"${a.id === selA && !cur ? ' selected' : ''}>${esc(a.name)}${L.length ? ' (hoja completa)' : ''}</option>`;
    const vals = new Set();
    for (const l of L) {
      vals.add(l.id);
      h += `<option value="${a.id}|${l.id}"${a.id === selA && cur === l.id ? ' selected' : ''}>${esc(a.name)} › ${esc(l.name)}</option>`;
      const all = regionLevels(l);
      if (all.length > 1) for (const x of all) { const v = `${l.id}@${x}`; vals.add(v); h += `<option value="${a.id}|${v}"${a.id === selA && cur === v ? ' selected' : ''}>${esc(a.name)} › Nivel ${esc(x)} (de ${esc(l.name)})</option>`; }
    }
    if (a.id === selA && cur && !vals.has(cur)) h += `<option value="${a.id}|${cur}" selected>${esc(a.name)} › ${esc(aLevelObjs({aSheet:a.id, aLevels:selLv}).map(l => l.name).join(', '))}</option>`;
    return h;
  }).join('');
}
export function parseALevel(v) { const [a, ids] = String(v || '').split('|'); return {a, lv: ids ? ids.split(',').filter(Boolean) : []}; }
/* casillas para elegir recuadros completos o niveles sueltos (diálogo "Plano A") */
export function levelChecksHtml(arq, sel) {
  const L = lvlsOf(arq), S2 = new Set();
  for (const e of sel || []) { const [id, sub] = String(e).split('@'); if (!sub) { S2.add(id); const l = L.find(x => x.id === id); if (l) regionLevels(l).forEach(x => S2.add(id + '@' + x)); } else sub.split(',').forEach(x => S2.add(id + '@' + x)); }
  return L.map(l => {
    const all = regionLevels(l);
    const head = `<label><input type="checkbox" data-region="${l.id}" value="${l.id}"${S2.has(l.id) ? ' checked' : ''}> <b>${esc(l.name)}</b>${all.length > 1 ? ` <span class="muted">(planta típica)</span>` : ''}</label>`;
    if (all.length < 2) return head;
    return head + `<div class="lvsubs">${all.map(x => `<label><input type="checkbox" data-of="${l.id}" value="${l.id}@${x}"${S2.has(l.id + '@' + x) ? ' checked' : ''}> Nivel ${esc(x)}</label>`).join('')}</div>`;
  }).join('');
}
export function wireLevelChecks(root) {
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.region) root.querySelectorAll(`[data-of="${t.dataset.region}"]`).forEach(c => c.checked = t.checked);
    else if (t.dataset.of) { const subs = [...root.querySelectorAll(`[data-of="${t.dataset.of}"]`)], head = root.querySelector(`[data-region="${t.dataset.of}"]`); if (head) head.checked = subs.every(c => c.checked); }
  });
}
export function readLevelChecks(root) {
  const out = [];
  for (const head of root.querySelectorAll('[data-region]')) {
    if (head.checked) { out.push(head.value); continue; }
    for (const c of root.querySelectorAll(`[data-of="${head.dataset.region}"]:checked`)) out.push(c.value);
  }
  return out;
}

/* --- visor de niveles en la hoja de arquitectónicos --- */
export let viewLevel = null;
export function setViewLevel(v) { viewLevel = v || null; }
export function viewLevelObj() { const sh = curSheet(); return sh && sh.kind === 'arq' && viewLevel ? resolveEntry(sh, viewLevel) : null; }
export function levelViewOptions() {
  const sh = curSheet(); if (!sh || sh.kind !== 'arq') return '';
  const L = lvlsOf(sh); if (!L.length) return '';
  let h = `<option value="">Hoja completa</option>`;
  for (const l of L) {
    const all = regionLevels(l);
    if (all.length > 1) h += `<optgroup label="${esc(l.name)}"><option value="${l.id}">Todos (${esc(joinY(all))})</option>${all.map(x => `<option value="${l.id}@${x}">Nivel ${esc(x)}</option>`).join('')}</optgroup>`;
    else h += `<option value="${l.id}">${esc(l.name)}</option>`;
  }
  return h;
}

function floorFromLevel(st, l) {
  const B = st.plans.B;
  if (l.asheet) return floorFromOther(st, l);
  const A = st.plans.A;
  const q = [[l.a[0], l.a[1]], [l.a[2], l.a[1]], [l.a[2], l.a[3]], [l.a[0], l.a[3]]].map(v => toLocal(B, toWorld(A, v)));
  const b = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
  return {id:'f' + uid(), src:l.id, name:l.name, levels:l.levels, a:l.a.slice(), b, at:{x:A.x, y:A.y, s:A.s, r:A.r || 0}, how:'nivel', pending:true,
    info:'Del arquitectónico, ubicada según la alineación general. Si no calza, use "Alinear por ejes" o "2 puntos".'};
}
/* Nivel de otra lámina: en el plano B se ubica en la parte que no ocupan las otras plantas
   (lo usual es que la lámina mecánica traiga los niveles lado a lado); después se alinea por ejes. */
function floorFromOther(st, l) {
  const B = st.plans.B;
  const others = st.floors.filter(f => f.b), W = B.w || 1, H = B.h || 1;
  let b = [0, 0, W, H];
  if (others.length) {
    const x0 = Math.min(...others.map(f => f.b[0])), x1 = Math.max(...others.map(f => f.b[2]));
    const left = x0, right = W - x1;
    if (Math.max(left, right) > W*0.2) b = right >= left ? [x1, 0, W, H] : [0, 0, x0, H];
  }
  // el nivel se pone con su centro sobre el centro de esa zona del B, con la escala general del A
  const at = centerAt(st.plans.A, l.a, b);
  return {id:'f' + uid(), src:l.id, asheet:l.asheet, name:l.name, levels:l.levels, a:l.a.slice(), b, at, how:'sin', pending:true,
    info:`Nivel de ${l.sheetName || 'otra lámina'}. Se intenta alinear por ejes; si no calza, use "Alinear por ejes" o "2 puntos".`};
}
/* Ajusta plantas, recorte del plano A y niveles según los niveles elegidos del arquitectónico. */
export function syncLevelFloors(sh) {
  const st = sh.state, arq = P.sheets[sh.aSheet];
  if (!arq || sh.kind !== 'pair') return false;
  const more = moreLevelObjs(sh);
  let lv = aLevelObjs(sh);
  if ((sh.aLevels || []).length !== lv.length) sh.aLevels = lv.map(l => l.id);
  const ne = normEntries(arq, sh.aLevels); if (ne.join('|') !== (sh.aLevels || []).join('|')) { sh.aLevels = ne; return syncLevelFloors(sh); }
  if (more.length) { if (!lv.length) lv = [resolveEntry(arq, '*')].filter(Boolean); lv = lv.concat(more); }
  const same = (f, l) => f.src === l.id && (f.asheet || null) === (l.asheet || null);
  let ch = false;
  if (lv.length >= 1 && !st.plans.B.fileId) {
    // sin plano B no hay plantas: se crean al cargar el plano B
    st.aClip = lv.length === 1 && !lv[0].asheet ? lv[0].a.slice() : null; const n = st.floors.length; st.floors = st.floors.filter(f => !f.src); return st.floors.length !== n;
  }
  if (lv.length >= 1) { // cada nivel es una planta: el B completo y el nivel del A debajo de su zona
    st.aClip = null;
    if (lv.length === 1 && (!st.levels || st.levelsAuto)) { st.levels = lv[0].levels; st.levelsAuto = true; }
    const n = st.floors.length; st.floors = st.floors.filter(f => !f.src || lv.some(l => same(f, l))); if (st.floors.length !== n) ch = true;
    for (const l of lv) {
      const f = st.floors.find(f => same(f, l));
      if (!f) { st.floors.push(floorFromLevel(st, l)); ch = true; }
      else { f.a = l.a.slice(); f.name = l.name; f.levels = l.levels; }
    }
  } else {
    const n = st.floors.length; st.floors = st.floors.filter(f => !f.src); if (st.floors.length !== n) ch = true;
    if (lv.length === 1) { st.aClip = lv[0].a.slice(); if (!st.levels || st.levelsAuto) { st.levels = lv[0].levels; st.levelsAuto = true; } }
    else { st.aClip = null; if (st.levelsAuto) { st.levels = ''; st.levelsAuto = false; } }
  }
  return ch;
}
/* recortes del plano A en el plano abierto: un nivel, o las plantas que vienen del arquitectónico */
export function aClips(k = 'A') {
  const sh = curSheet(); if (!sh) return null;
  if (sh.kind === 'arq') { const v = viewLevelObj(); return k === 'A' && v ? [v.a] : null; }
  if (sh.kind !== 'pair') return null;
  if (k === 'A' && S.aClip) return [S.aClip];
  const fs = S.floors.filter(f => f.src && akOf(f) === k);
  if (k !== 'A') return fs.map(f => f.a); // un plano A adicional solo muestra sus niveles
  return fs.length ? fs.map(f => f.a) : null;
}
export { PDF_UNIT };

/* --- selector del plano A: un arquitectónico principal y, si hace falta, niveles de otras láminas ---
   sel = {a, lv, more:[{aSheet, aLevels}]}. Se usa al crear un plano de instalaciones y en "Cambiar". */
function aRowHtml(aid, lv, first) {
  const arq = P.sheets[aid], L = lvlsOf(arq);
  const opts = sheetsOf('arq').map(a => `<option value="${a.id}"${a.id === aid ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  const checks = L.length ? `<div class="checks" data-lv>${levelChecksHtml(arq, lv)}</div>`
    : `<p class="muted small" data-lv style="margin:4px 0 0">Esta hoja no tiene niveles definidos: se usa completa.</p>`;
  return `<div class="apick" data-row><div class="apick-h"><select data-asel aria-label="Arquitectónico">${opts}</select>${first ? '' : `<button type="button" class="icon" data-arm title="Quitar esta lámina">${ICON.trash}</button>`}</div>${checks}</div>`;
}
export function aPickerHtml(sel) {
  const rows = [aRowHtml(sel.a, sel.lv || [], true), ...(sel.more || []).filter(m => P.sheets[m.aSheet]).map(m => aRowHtml(m.aSheet, m.aLevels || [], false))];
  return `<div class="apicker">${rows.join('')}<button type="button" class="btn" data-aadd>+ Nivel de otra lámina de arquitectónicos</button>
    <p class="muted small" style="margin:0">Sin marcar niveles se usa la hoja completa. Con varios niveles se crea una planta por nivel. Si un nivel está en otra lámina (por ejemplo el 5 en A-49 y el 6 en A-50), agréguela aquí.</p></div>`;
}
export function wireAPicker(root) {
  const box = root.querySelector('.apicker'); if (!box) return;
  box.querySelectorAll('[data-lv]').forEach(wireLevelChecks);
  box.addEventListener('change', e => {
    const s = e.target.closest('[data-asel]'); if (!s) return;
    const row = s.closest('[data-row]'), first = row === box.querySelector('[data-row]');
    const tmp = document.createElement('div'); tmp.innerHTML = aRowHtml(s.value, [], first);
    const nr = tmp.firstElementChild; row.replaceWith(nr); nr.querySelectorAll('[data-lv]').forEach(wireLevelChecks);
  });
  box.addEventListener('click', e => {
    if (e.target.closest('[data-arm]')) { e.target.closest('[data-row]').remove(); return; }
    if (e.target.closest('[data-aadd]')) {
      const used = new Set([...box.querySelectorAll('[data-asel]')].map(s => s.value));
      const next = sheetsOf('arq').find(a => !used.has(a.id)); if (!next) return toast('Ya están todas las láminas de arquitectónicos.');
      const tmp = document.createElement('div'); tmp.innerHTML = aRowHtml(next.id, [], false);
      const nr = tmp.firstElementChild; e.target.closest('[data-aadd]').before(nr); nr.querySelectorAll('[data-lv]').forEach(wireLevelChecks);
    }
  });
}
export function readAPicker(root) {
  const rows = [...root.querySelectorAll('.apicker [data-row]')];
  const read = row => { const a = row.querySelector('[data-asel]').value, c = row.querySelector('.checks[data-lv]'); return {a, lv: c ? normEntries(P.sheets[a], readLevelChecks(c)) : []}; };
  const main = read(rows[0]), seen = new Set([main.a]), more = [];
  for (const row of rows.slice(1)) { const r = read(row); if (seen.has(r.a)) continue; seen.add(r.a); more.push({aSheet: r.a, aLevels: r.lv}); }
  return {a: main.a, lv: main.lv, more};
}
