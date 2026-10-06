/* Abrir, crear, mover y eliminar hojas (arquitectónicos y planos de instalaciones). */
import { $, esc, isMobile, pdfjsLib, pdfReady } from '../core/constants.js';
import { P, RT, S, sel, stateVars } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { fit } from '../canvas/view.js';
import { renderPlans } from '../panels/planos.js';
import { save } from '../core/storage.js';
import { ask, closePanel, renderAll, renderTop, toast } from '../ui/app.js';
import { floorsVars } from '../plans/floors.js';
import { needVecInBackground, pathCache } from '../detect/vector.js';
import { arqState, blankState, curSheet, hideHome, homeOn, isPdfFile, isPlanFile, normState, pid, RT_BLANK, secLabel, sheetsOf, showHome, stripExt, subById } from './model.js';
import { gcFiles, loadPlanFile, storeFile } from './files.js';
import { commitShared, injectShared } from './shared.js';
import { renderProject } from '../home/home.js';

/* --- abrir hojas --- */
export async function openSheet(id, opt = {}) {
  const sh = P.sheets[id]; if (!sh) return;
  commitShared(); hideHome();
  P.active = id; P.last = id; stateVars.S = sh.state;
  if (sh.kind === 'pair') injectShared(sh);
  sel.clear(); stateVars.cur = null; stateVars.align = null; floorsVars.solo = null; floorsVars.floorDraft = null; stateVars.gesture = null; stateVars.undoStack = []; stateVars.redoStack = [];
  pathCache.clear();
  RT.A = RT_BLANK(); RT.B = RT_BLANK();
  if (S.plans.A.fileId) RT.A.loading = true;
  setTool('select'); renderAll();
  if (isMobile || innerWidth <= 820) closePanel();
  if (S.plans.A.fileId) await loadPlanFile('A', S.plans.A.fileId, S.plans.A.page);
  if (P.active !== id) return;
  if (sh.kind === 'pair' && S.plans.B.fileId) await loadPlanFile('B', S.plans.B.fileId, S.plans.B.page, {initB:opt.initB || sh.initB}); if (sh.initB) { delete sh.initB; save(); }
  if (P.active !== id) return;
  renderAll(); fit(); save(); needVecInBackground();
}

export function closeSheet() {
  commitShared(); P.active = null; stateVars.S = blankState(); RT.A = RT_BLANK(); RT.B = RT_BLANK();
  stateVars.undoStack = []; stateVars.redoStack = []; sel.clear(); stateVars.cur = null; renderAll(); dirty();
}

export async function changePage(k, page) {
  const p = S.plans[k]; if (!p.fileId) return;
  p.page = page;
  await loadPlanFile(k, p.fileId, page);
  renderPlans(); fit(); save();
}

/* --- crear hojas --- */
export async function addArqFiles(list) {
  const files = [...list].filter(isPlanFile);
  if (!files.length) return toast('Use archivos PDF, PNG o JPG.');
  let first = null, n = 0;
  for (const f of files) {
    toast(`Agregando "${f.name}"…`);
    const fid = await storeFile(f, f.name);
    let pages = 1;
    if (isPdfFile(f)) await pdfReady().catch(() => null);
    if (isPdfFile(f) && pdfjsLib) { try { const d = await pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise; pages = d.numPages; d.destroy && d.destroy(); } catch (e) {} }
    let use = [1];
    if (pages > 1) {
      const all = await ask({title:'PDF con varias páginas', body:`"${f.name}" tiene ${pages} páginas. ¿Agrega cada página como una hoja de arquitectónicos?`, buttons:[{label:'Solo la primera', value:'one'}, {label:'Todas las páginas', value:'all', primary:true}]});
      if (all === 'all') use = Array.from({length:pages}, (_, i) => i + 1);
    }
    for (const pg of use) {
      const id = pid('h');
      P.sheets[id] = {id, kind:'arq', name: stripExt(f.name) + (use.length > 1 ? ` · pág. ${pg}` : ''), sec:'arq', sub:null, state:arqState(fid, pg), order:Date.now() + pg};
      first = first || id; n++;
    }
  }
  save(); renderProject();
  toast(`${n} ${n === 1 ? 'hoja agregada' : 'hojas agregadas'} a Arquitectónicos. Ábrala para marcar las paredes cortafuego.`);
  if (first) { if (homeOn) { P.last = first; renderProject(); renderTop(); } else await openSheet(first); }
}

export function espLocOptions(sec, sub) {
  return P.sections.filter(s => s.kind !== 'arq').map(s => `<option value="${s.id}|"${s.id === sec && !sub ? ' selected' : ''}>${esc(s.name)}</option>` +
    s.subs.map(u => `<option value="${s.id}|${u.id}"${s.id === sec && u.id === sub ? ' selected' : ''}>${esc(s.name)} › ${esc(u.name)}</option>`).join('')).join('');
}

export function arqOptions(sel) { return sheetsOf('arq').map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join(''); }

export let pendingB = null;

export function newPairDialog(sec, sub, file) {
  if (file) return addPairFiles([file], sec, sub);
  if (!sheetsOf('arq').length) { toast('Primero agregue los arquitectónicos: el plano A sale de esa lista.'); return addArqPick(); }
  pendingB = {sec, sub}; $('#fileB').click();
}

export async function addPairFiles(list, sec, sub) {
  const files = [...list].filter(isPlanFile).sort((x, y) => x.name.localeCompare(y.name, 'es', {numeric:true}));
  if (!files.length) return toast('Use archivos PDF, PNG o JPG.');
  const arqs = sheetsOf('arq');
  if (!arqs.length) { toast('Primero agregue los arquitectónicos: el plano A sale de esa lista.'); return addArqPick(); }
  if (!sec) { const c = curSheet(); if (c && c.kind === 'pair') { sec = c.sec; sub = c.sub; } else sec = P.sections.find(s => s.kind !== 'arq')?.id; }
  const defA = (P.lastA && P.sheets[P.lastA]) ? P.lastA : arqs[0].id;
  const many = files.length > 1;
  const html = `<label class="row"><span>Sección</span><select id="npLoc">${espLocOptions(sec, sub)}</select></label>
    ${many ? `<label class="row"><span>Plano A (arquitectónico) para todos</span><select id="npAll">${arqOptions(defA)}</select></label>` : ''}
    <div class="row"><span class="muted small">${many ? 'Nombre y plano A de cada uno' : 'Nombre y plano A'}</span><div class="bfiles">${files.map((f, i) => `<div class="bfile" data-i="${i}"><input type="text" data-n value="${esc(stripExt(f.name))}" aria-label="Nombre del plano ${i + 1}"><select data-a aria-label="Plano A del plano ${i + 1}">${arqOptions(defA)}</select></div>`).join('')}</div></div>`;
  const v = await ask({title: many ? `Agregar ${files.length} planos de instalaciones` : 'Nuevo plano de instalaciones', html, wide: many,
    buttons:[{label:'Cancelar', value:null}, {label: many ? `Agregar ${files.length} planos` : 'Crear', value:'ok', primary:true}],
    setup: r => { const all = r.querySelector('#npAll'); if (all) all.onchange = () => r.querySelectorAll('[data-a]').forEach(x => x.value = all.value); },
    read: r => ({loc: r.querySelector('#npLoc').value, rows: [...r.querySelectorAll('.bfile')].map(row => ({name: row.querySelector('[data-n]').value.trim(), a: row.querySelector('[data-a]').value}))})});
  if (!v) return;
  const [s, u] = v.loc.split('|');
  const wasOpen = !homeOn && !!P.active;
  let first = null;
  for (const [i, f] of files.entries()) {
    toast(many ? `Agregando ${i + 1} de ${files.length}: "${f.name}"…` : 'Creando el plano…');
    const fid = await storeFile(f, f.name);
    const st = normState(null);
    st.plans.B.fileId = fid; st.plans.B.page = 1;
    st.below = !!(u && subById(s, u)?.below);
    const id = pid('h'), row = v.rows[i] || {};
    P.sheets[id] = {id, kind:'pair', name: row.name || stripExt(f.name), sec:s, sub:u || null, aSheet: row.a || defA, state:st, order:Date.now() + i, initB:true};
    P.lastA = row.a || defA; first = first || id;
  }
  save();
  if (!many && (wasOpen || !homeOn)) { await openSheet(first); toast('Plano creado. En la pestaña Planos defina las plantas o alinee el plano B.'); return; }
  P.last = first; renderProject(); renderTop();
  toast(`${files.length} ${files.length === 1 ? 'plano agregado' : 'planos agregados'} a ${secLabel({sec:s, sub:u || null})}.`);
}

export async function chooseA() {
  const sh = curSheet(); if (!sh || sh.kind !== 'pair') return;
  const v = await ask({title:'Plano A (arquitectónico)', body:'Las paredes marcadas en esa hoja de arquitectónicos aparecen en este plano.', html:`<label class="row"><span>Arquitectónico</span><select id="chA">${arqOptions(sh.aSheet)}</select></label>`,
    buttons:[{label:'Cancelar', value:null}, {label:'Usar este', value:'ok', primary:true}], read: r => r.querySelector('#chA').value});
  if (v && v !== sh.aSheet) await setPairA(sh, v);
}

export async function setPairA(sh, a) {
  if (P.active !== sh.id) { sh.aSheet = a; save(); renderProject(); return; }
  commitShared(); sh.aSheet = a; P.lastA = a; injectShared(sh); pathCache.clear();
  if (S.floors.length) toast('Cambió el plano A: revise la alineación de las plantas.');
  await loadPlanFile('A', S.plans.A.fileId, S.plans.A.page);
  renderAll(); fit(); save();
}

export async function sheetDialog(id) {
  const sh = P.sheets[id]; if (!sh) return;
  const pair = sh.kind === 'pair';
  const html = `<label class="row"><span>Nombre</span><input type="text" id="sdName" value="${esc(sh.name)}"></label>
    ${pair ? `<label class="row"><span>Sección</span><select id="sdLoc">${espLocOptions(sh.sec, sh.sub)}</select></label>
    <label class="row"><span>Plano A (arquitectónico)</span><select id="sdA">${arqOptions(sh.aSheet)}</select></label>` :
    `<p class="muted small" style="margin:0">Planos que usan esta hoja: ${Object.values(P.sheets).filter(s => s.aSheet === id).map(s => esc(s.name)).join(', ') || 'ninguno'}.</p>`}`;
  const v = await ask({title: pair ? 'Plano de instalaciones' : 'Hoja de arquitectónicos', html,
    buttons:[{label:'Cancelar', value:null}, {label:'Eliminar', value:'del', danger:true}, {label:'Guardar', value:'ok', primary:true}],
    read: (r, act) => ({act, name: r.querySelector('#sdName').value.trim(), loc: r.querySelector('#sdLoc')?.value, a: r.querySelector('#sdA')?.value})});
  if (!v) return;
  if (v.act === 'del') return deleteSheet(id);
  if (v.name) sh.name = v.name;
  if (pair) { const [s, u] = v.loc.split('|'); sh.sec = s; sh.sub = u || null; if (v.a && v.a !== sh.aSheet) await setPairA(sh, v.a); }
  save(); renderProject(); renderTop();
}

export async function deleteSheet(id) {
  const sh = P.sheets[id]; if (!sh) return;
  if (sh.kind === 'arq') {
    const users = Object.values(P.sheets).filter(s => s.aSheet === id);
    if (users.length) return toast(`No se puede eliminar: la usan ${users.length} ${users.length === 1 ? 'plano' : 'planos'} como plano A. Cámbieles el arquitectónico primero.`);
  }
  const ok = await ask({title:'Eliminar', body:`Se elimina "${sh.name}" con todas sus marcas y sellos. No se puede deshacer.`, buttons:[{label:'Cancelar', value:false}, {label:'Eliminar', value:true, danger:true}]});
  if (!ok) return;
  commitShared();
  if (P.active === id) { P.active = null; stateVars.S = blankState(); RT.A = RT_BLANK(); RT.B = RT_BLANK(); stateVars.undoStack = []; stateVars.redoStack = []; }
  delete P.sheets[id];
  await gcFiles(); save(); renderAll(); dirty();
  if (!P.active) showHome();
}

export function addArqPick() { $('#fileArq').click(); }

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#sheetSel').addEventListener('change', e => {
    const v = e.target.value; e.target.value = P.active || '';
    if (v === '__new') newPairDialog();
    else if (v === '__arq') addArqPick();
    else if (v === '__home') showHome();
    else if (v && v !== P.active) openSheet(v);
  });
  $('#fileB').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; const t = pendingB || {}; pendingB = null; if (fs.length) addPairFiles(fs, t.sec, t.sub); });
}
