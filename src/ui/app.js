/* Interfaz general: refresco, pestañas, menú Archivo, avisos y diálogos. */
import { $, esc } from '../core/constants.js';
import { ICON } from './icons.js';
import { redoStack, S, undoStack } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { renderOpts, renderTools } from '../editor/tools.js';
import { renderPlans } from '../panels/planos.js';
import { renderLayers } from '../panels/capas.js';
import { renderSeals, updateCounts } from '../panels/sellos.js';
import { exportCSV, exportPNG } from '../export/files.js';
import { pdfDialog } from '../export/pdf.js';
import { save } from '../core/storage.js';
import { exportQuant } from '../core/levels.js';
import { fsDialog } from '../export/firestop.js';
import { renderAuto } from '../panels/deteccion.js';
import { curTab, homeOn, modelVars, renderSheetSel, showHome } from '../project/model.js';
import { addArqPick, newPairDialog } from '../project/sheets.js';
import { renderProject } from '../home/home.js';
import { newProject, saveProject } from '../project/archive.js';
import { renderEmpty } from '../home/empty.js';

/* ---------- interfaz general ---------- */
export function changed() { save(); renderSeals(); renderLayers(); renderOpts(); renderTop(); if (homeOn) renderProject(); dirty(); }

export function renderTop() {
  $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length; updateCounts();
  renderSheetSel();
}

export function setTab(t) {
  if (t === 'proj' || !$('#tab-' + t)) t = 'planos';
  modelVars.curTab = t; S.tab = t;
  for (const b of document.querySelectorAll('#tabs button')) { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
  for (const id of ['planos', 'capas', 'sellos', 'auto']) $('#tab-' + id).hidden = id !== t;
}

export function renderAll() { renderTools(); renderPlans(); renderLayers(); renderSeals(); renderAuto(); renderOpts(); renderTop(); renderEmpty(); if (homeOn) renderProject(); setTab(curTab || S.tab || 'planos'); }

export function openPanel() { $('#panel').classList.add('open'); $('#backdrop').classList.add('open'); }

export function closePanel() { $('#panel').classList.remove('open'); $('#backdrop').classList.remove('open'); }

export let toastTimer = null;

export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200); }

export function ask({title, body = '', input, placeholder = '', ok = 'Aceptar', buttons, html = '', setup, read, wide}) {
  return new Promise(res => {
    const md = $('#modal'), inp = $('#mInput'), acts = $('#mActions');
    $('#mTitle').textContent = title; $('#mBody').textContent = body; $('#mBody').hidden = !body;
    const hasInput = input !== undefined;
    inp.hidden = !hasInput; inp.value = input || ''; inp.placeholder = placeholder;
    const box = $('#mHtml'); box.innerHTML = html; if (setup) setup(box);
    md.querySelector('.card').classList.toggle('wide', !!wide);
    const btns = buttons || [{label:'Cancelar', value:null}, {label:ok, value:'__input', primary:true}];
    acts.innerHTML = btns.map((b, i) => `<button class="btn${b.primary ? ' primary' : ''}${b.danger ? ' red' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('');
    md.hidden = false;
    const done = v => { md.hidden = true; acts.onclick = null; inp.onkeydown = null; md.onclick = null; res(v); };
    acts.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const v = btns[+b.dataset.i].value; done(v === '__input' ? inp.value.trim() : (v && read ? read(box, v) : v)); };
    md.onclick = e => { if (e.target === md) done(btns[0].value === '__input' ? null : btns[0].value); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); };
    setTimeout(() => (hasInput ? inp : acts.lastElementChild).focus(), 30);
  });
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#btnPanel').innerHTML = ICON.panel;
  $('#btnHome').innerHTML = ICON.home + '<span class="hide-sm">Proyecto</span>';
  $('#btnHome').onclick = () => showHome();
  $('#hBrand').innerHTML = ICON.seal + '<span>Sellos cortafuego</span>';
  $('#btnPanel').onclick = () => $('#panel').classList.contains('open') ? closePanel() : openPanel();
  $('#backdrop').onclick = closePanel;
  $('#countTag').onclick = () => { setTab('sellos'); openPanel(); };
  $('#btnMenu').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; $('#btnMenu').setAttribute('aria-expanded', !m.hidden); };
  document.addEventListener('click', e => { if (!e.target.closest('#menuWrap')) { $('#menu').hidden = true; $('#btnMenu').setAttribute('aria-expanded', 'false'); } });
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return; $('#menu').hidden = true;
    ({home:() => showHome(), addArq:addArqPick, newPair:() => newPairDialog(), save:saveProject, open:() => $('#fileProject').click(), csv:exportCSV, quant:exportQuant, fss:fsDialog, pdf:pdfDialog, png:exportPNG, new:newProject})[b.dataset.m]();
  });
}
