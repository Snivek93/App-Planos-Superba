/* Pantalla de inicio del proyecto: secciones, tarjetas de planos y orden. */
import { $, esc } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { L, P, S } from '../core/state.js';
import { sealsSorted } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { ask, renderAll, renderTop } from '../ui/app.js';
import { exportQuant, sealWeight } from '../core/levels.js';
import { catPropsDialog } from '../export/penetrante.js';
import { fsDialog } from '../export/firestop.js';
import { aLevelsLabel, pid, secById, sheetsOf, subById, withState } from '../project/model.js';
import { gcFiles } from '../project/files.js';
import { commitShared, isSharedLayer } from '../project/shared.js';
import { addArqPick, closeSheet, newPairDialog, openSheet, sheetDialog } from '../project/sheets.js';
import { goSeal, homeView, penetrantesVars, penF, penHtml, penSort, renderPenTable } from './penetrantes.js';
import { newProject, saveProject } from '../project/archive.js';
import { fillThumbs, warmUp } from '../project/warm.js';

/* --- inicio del proyecto --- */
export function sheetTotals(sh) {
  return withState(sh.state, () => {
    const ss = sealsSorted();
    return {seals:ss.length, q:ss.reduce((a, m) => a + sealWeight(m), 0), walls:S.marks.filter(m => L(m.layer) && isSharedLayer(L(m.layer))).length + (S.auto.fire || []).filter(r => r.on).length};
  });
}

function thumbOf(sh) {
  const pl = sh.kind === 'arq' ? sh.state.plans.A : sh.state.plans.B;
  return pl && pl.fileId ? pl.fileId + '#' + (pl.page || 1) : '';
}
/* botón mínimo para agregar: solo el signo +, con el texto como ayuda al pasar el mouse */
function addTile(act, label) { return `<li class="taddli"><button class="tadd" data-pa="${act}" title="${label}" aria-label="${label}"><span aria-hidden="true">+</span></button></li>`; }

export function itemHtml(sh, T) {
  const t = T[sh.id], last = P.last === sh.id, grid = (P.layout || 'grid') === 'grid';
  let meta, q = '';
  if (sh.kind === 'arq') { const users = Object.values(P.sheets).filter(s => s.aSheet === sh.id || (s.aMore || []).some(m => m.aSheet === sh.id)).length; const nl = (sh.state.lvls || []).length; meta = [nl ? `${nl} ${nl === 1 ? 'nivel' : 'niveles'}` : '', t.walls ? 'Paredes marcadas' : 'Sin paredes marcadas', `en ${users} ${users === 1 ? 'plano' : 'planos'}`].filter(Boolean).join(' · '); }
  else {
    const a = P.sheets[sh.aSheet], st = sh.state, below = st.below || st.floors.some(f => f.below);
    const lv = st.floors.length ? `${st.floors.length} ${st.floors.length === 1 ? 'planta' : 'plantas'}` : (st.levels ? `Nivel ${st.levels}` : '');
    meta = [lv, `A: ${a ? a.name : '—'}${aLevelsLabel(sh)}`, below ? 'bajo losa' : ''].filter(Boolean).join(' · ');
    q = `<span class="tq" title="Sellos para cuantificar">${t.q}<small>${t.q === 1 ? 'sello' : 'sellos'}</small></span>`;
  }
  const th = thumbOf(sh);
  const acts = `<span class="tacts"><button class="icon" data-pa="rename" title="Cambiar nombre" aria-label="Cambiar nombre de ${esc(sh.name)}">${ICON.edit}</button><button class="icon" data-pa="item" title="Opciones" aria-label="Opciones de ${esc(sh.name)}">${ICON.more}</button></span>`;
  const drag = sh.kind === 'pair' ? ' draggable="true"' : '';
  if (grid) return `<li class="tile card${last ? ' last' : ''}" data-sheet="${sh.id}"${drag}><button class="tmain" data-pa="openSheet" title="${esc(sh.name)}${meta ? ' · ' + esc(meta) : ''}">
      <span class="tthumb">${th ? `<img data-thumb="${esc(th)}" alt="" draggable="false">` : ''}<span class="tph">Preparando vista previa…</span></span>
      <span class="tbody"><span class="tname">${esc(sh.name).replace(/_/g, '_<wbr>')}</span></span></button>
    ${q}${acts}</li>`;
  return `<li class="tile${last ? ' last' : ''}" data-sheet="${sh.id}"${drag}><button class="tmain" data-pa="openSheet" title="${esc(meta)}"><span class="tname">${esc(sh.name)}</span></button>
    ${q}${acts}</li>`;
}

/* Cambiar el nombre directamente en la tarjeta. */
export function startRename(li) {
  const sh = P.sheets[li.dataset.sheet]; if (!sh) return;
  const nm = li.querySelector('.tname'); if (!nm || nm.querySelector('input')) return;
  li.setAttribute('draggable', 'false');
  nm.innerHTML = `<input class="trename" value="${esc(sh.name)}" aria-label="Nombre del plano">`;
  const inp = nm.querySelector('input');
  const stop = e => e.stopPropagation();
  inp.addEventListener('click', stop); inp.addEventListener('mousedown', stop); inp.addEventListener('pointerdown', stop);
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== sh.name) { sh.name = v; save(); renderTop(); }
    renderProject();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
  inp.focus(); inp.select();
}

export function renderProject() {
  if (!P) return;
  const body = $('#homeBody'); if (!body) return;
  const all = Object.values(P.sheets), pairs = all.filter(s => s.kind === 'pair'), arqs = sheetsOf('arq');
  if (!all.length) {
    body.innerHTML = `<div class="hwelcome"><input class="hname" data-pa="pname" value="${esc(P.name)}" aria-label="Nombre del proyecto">
      <h2>Empiece con los arquitectónicos</h2>
      <p>Suba las plantas de paredes (plano A). Ahí se marcan las paredes cortafuego una sola vez. Después, cada plano eléctrico, mecánico o de supresión elige su arquitectónico de la lista y se le sube el plano de instalaciones.</p>
      <div class="btnrow"><button class="btn primary" data-pa="addArq">Agregar arquitectónicos</button><button class="btn" data-pa="openProj">Abrir proyecto guardado (.zip)</button></div>
      <p class="muted small" style="margin:12px 0 0">PDF o imagen. También puede arrastrarlos a esta pantalla.</p></div>`;
    return;
  }
  const T = {}; let total = 0; const per = {};
  for (const sh of all) { T[sh.id] = sheetTotals(sh); total += T[sh.id].q; per[sh.sec] = (per[sh.sec] || 0) + T[sh.id].q; }
  const chips = P.sections.filter(s => s.kind !== 'arq' && per[s.id]).map(s => `<span class="hchip">${esc(s.name)} <b>${per[s.id]}</b></span>`).join('');
  let h = `<div class="hhead"><div><input class="hname" data-pa="pname" value="${esc(P.name)}" aria-label="Nombre del proyecto">
      <div class="hsum"><span class="hbig">${total}</span><div><h3>${total === 1 ? 'Sello' : 'Sellos'} para cuantificar</h3><div class="small muted">${pairs.length} ${pairs.length === 1 ? 'plano de instalaciones' : 'planos de instalaciones'} · ${arqs.length} ${arqs.length === 1 ? 'arquitectónico' : 'arquitectónicos'}</div>${chips ? `<div class="hchips">${chips}</div>` : ''}</div></div></div>
    <div class="hacts"><div class="seg hsort" role="group" aria-label="Ordenar planos">${[['az', 'A → Z'], ['za', 'Z → A'], ['fecha', 'Por fecha']].map(([v, t]) => `<button data-pa="sort" data-v="${v}" class="${(P.sort || 'az') === v ? 'on' : ''}" title="Ordenar los planos ${v === 'fecha' ? 'en el orden en que se agregaron' : 'alfabéticamente'}">${t}</button>`).join('')}</div><div class="seg hlay" role="group" aria-label="Vista de los planos">${[['grid', 'Galería', ICON.grid], ['list', 'Lista', ICON.list]].map(([v, t, ic]) => `<button data-pa="layout" data-v="${v}" class="${(P.layout || 'grid') === v ? 'on' : ''}" title="Ver como ${t.toLowerCase()}" aria-label="${t}">${ic}<span class="hide-sm">${t}</span></button>`).join('')}</div><button class="btn" data-pa="newPair">＋ Nuevo plano</button><button class="btn primary" data-pa="fss">Excel para Firestop Suite</button></div></div>`;
  const nSeals = Object.values(T).reduce((a, t) => a + t.seals, 0);
  h += `<div class="seg hview" role="tablist">${[['plans', 'Planos'], ['pen', 'Penetrantes']].map(([v, t]) => `<button data-pa="hview" data-v="${v}" role="tab" class="${homeView === v ? 'on' : ''}">${t}${v === 'pen' ? `<span class="n">${total}</span>` : ''}</button>`).join('')}</div>`;
  if (homeView === 'pen') { body.innerHTML = h + penHtml(); renderPenTable(); return; }
  const tiles = (list, add) => `<ul class="tiles ${(P.layout || 'grid') === 'grid' ? 'grid' : 'list'}">${list.map(sh => itemHtml(sh, T)).join('')}${add}</ul>`;
  for (const [i, s] of P.sections.entries()) {
    const arq = s.kind === 'arq';
    h += `<section class="hsec" data-sec="${s.id}"><header>
      <input data-pa="secName" value="${esc(s.name)}" aria-label="Nombre de la sección"${arq ? ' readonly' : ''}>
      ${per[s.id] ? `<span class="pcount" title="Sellos en la sección">${per[s.id]}</span>` : ''}
      ${arq ? '' : `<button class="icon" data-pa="secUp" title="Subir sección"${i <= 1 ? ' disabled' : ''}>↑</button><button class="icon" data-pa="secDown" title="Bajar sección"${i === P.sections.length - 1 ? ' disabled' : ''}>↓</button><button class="icon" data-pa="addSub" title="Agregar subsección">＋</button><button class="icon" data-pa="secDel" title="Eliminar sección">${ICON.trash}</button>`}</header>`;
    const root = sheetsOf(s.id, null);
    if (arq) h += tiles(root, addTile('addArq', 'Agregar arquitectónicos'));
    else if (root.length || !s.subs.length) h += tiles(root, addTile('newPair', s.subs.length ? 'Agregar plano sin subsección' : 'Agregar plano'));
    for (const [j, u] of s.subs.entries()) {
      h += `<div class="hsub" data-sub="${u.id}"><header><input data-pa="subName" value="${esc(u.name)}" aria-label="Nombre de la subsección">
        <label class="subbelow" title="Las tuberías corren bajo la losa: las paredes que cruzan son del nivel inferior"><input type="checkbox" data-pa="subBelow"${u.below ? ' checked' : ''}> <span class="lt">Tuberías</span> bajo losa</label>
        <button class="icon" data-pa="subUp" title="Subir"${j === 0 ? ' disabled' : ''}>↑</button><button class="icon" data-pa="subDown" title="Bajar"${j === s.subs.length - 1 ? ' disabled' : ''}>↓</button><button class="icon" data-pa="subDel" title="Eliminar subsección">${ICON.trash}</button></header>
        ${tiles(sheetsOf(s.id, u.id), addTile('newPair', 'Agregar plano'))}</div>`;
    }
    h += `</section>`;
  }
  h += `<div class="btnrow"><button class="btn" data-pa="addSec">＋ Nueva sección</button></div>
    <p class="hfoot">El proyecto se guarda solo en este navegador, con todos los planos. Para respaldo o para pasarlo a otro equipo use "Descargar .zip" (arriba): incluye los PDF, las marcas, los sellos, las categorías y las tablas.</p>`;
  body.innerHTML = h;
  fillThumbs(body); warmUp();
}

export let tpj;

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  tpj = $('#home');
  tpj.addEventListener('click', async e => {
    const b = e.target.closest('[data-pa]'); if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.pa, secEl = b.closest('[data-sec]'), sec = secEl && secById(secEl.dataset.sec), subEl = b.closest('[data-sub]'), sheetEl = b.closest('[data-sheet]');
    const mv = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (a === 'openSheet') openSheet(sheetEl.dataset.sheet);
    else if (a === 'item') sheetDialog(sheetEl.dataset.sheet);
    else if (a === 'addArq') addArqPick();
    else if (a === 'newPair') newPairDialog(sec?.id, sec ? (subEl?.dataset.sub || null) : null);
    else if (a === 'secUp' || a === 'secDown') { const i = P.sections.indexOf(sec); if (a === 'secUp' && i <= 1) return; mv(P.sections, i, a === 'secUp' ? -1 : 1); save(); renderProject(); }
    else if (a === 'addSub') { const n = await ask({title:'Nueva subsección', input:'', placeholder:'Ej.: Pluvial', ok:'Crear'}); if (n) { sec.subs.push({id:pid('u'), name:n, below:/pluvial|sanitari|negras|servidas|grises/i.test(n)}); save(); renderProject(); } }
    else if (a === 'secDel') {
      const items = sheetsOf(sec.id);
      const ok = await ask({title:'Eliminar sección', body: items.length ? `"${sec.name}" tiene ${items.length} ${items.length === 1 ? 'plano' : 'planos'}. Se eliminan con todas sus marcas.` : `Se elimina "${sec.name}".`, buttons:[{label:'Cancelar', value:false}, {label:'Eliminar', value:true, danger:true}]});
      if (!ok) return;
      commitShared();
      for (const sh of items) { if (P.active === sh.id) closeSheet(); delete P.sheets[sh.id]; }
      P.sections = P.sections.filter(s => s !== sec); await gcFiles(); save(); renderAll();
    }
    else if (a === 'subUp' || a === 'subDown') { const i = sec.subs.findIndex(u => u.id === subEl.dataset.sub); mv(sec.subs, i, a === 'subUp' ? -1 : 1); save(); renderProject(); }
    else if (a === 'subDel') {
      const u = subById(sec.id, subEl.dataset.sub), items = sheetsOf(sec.id, u.id);
      const ok = await ask({title:'Eliminar subsección', body: items.length ? `Los ${items.length} planos de "${u.name}" pasan a "${sec.name}" sin subsección.` : `Se elimina "${u.name}".`, buttons:[{label:'Cancelar', value:false}, {label:'Eliminar', value:true, danger:true}]});
      if (!ok) return;
      items.forEach(sh => sh.sub = null); sec.subs = sec.subs.filter(x => x !== u); save(); renderProject();
    }
    else if (a === 'addSec') { const n = await ask({title:'Nueva sección', input:'', placeholder:'Ej.: Telecomunicaciones', ok:'Crear'}); if (n) { P.sections.push({id:pid('s'), name:n, subs:[]}); save(); renderProject(); } }
    else if (a === 'hview') { penetrantesVars.homeView = b.dataset.v; renderProject(); }
    else if (a === 'pmode') { penF.mode = b.dataset.v; renderProject(); }
    else if (a === 'psort') { const k = b.dataset.k; penetrantesVars.penSort = penSort.k === k ? {k, d:-penSort.d} : {k, d:1}; renderPenTable(); }
    else if (a === 'pcat') { await catPropsDialog(b.dataset.st); renderProject(); }
    else if (a === 'pgo') goSeal(b.dataset.sh, b.dataset.m);
    else if (a === 'pclear') { penetrantesVars.penF = {...penF, sec:'', lv:'', loc:'', q:''}; renderProject(); }
    else if (a === 'rename') startRename(sheetEl);
    else if (a === 'layout') { P.layout = b.dataset.v; save(); renderProject(); }
    else if (a === 'sort') { P.sort = b.dataset.v; save(); renderProject(); renderTop(); }
    else if (a === 'fss') fsDialog();
    else if (a === 'quant') exportQuant('all');
    else if (a === 'saveProj') saveProject();
    else if (a === 'openProj') $('#fileProject').click();
    else if (a === 'newProj') newProject();
  });
}
