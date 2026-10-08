/* Arrastrar planos entre secciones y soltar archivos o carpetas. */
import { $ } from '../core/constants.js';
import { P } from '../core/state.js';
import { renderPlans } from '../panels/planos.js';
import { renderSeals } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { renderTop, toast } from '../ui/app.js';
import { adoptCats, catKey, isPlanFile, secById, secLabel, sheetsOf, subById } from '../project/model.js';
import { addArqFiles, addPairFiles } from '../project/sheets.js';
import { renderProject, tpj } from './home.js';
import { penF, renderPenTable } from './penetrantes.js';
import { handleFiles } from './empty.js';

/* arrastrar: mover planos entre secciones y soltar archivos o carpetas en una sección */
export let dragSheet = null;
export let hintTimer = null;

export function isFileDrag(e) { return [...(e.dataTransfer?.types || [])].includes('Files'); }

export function dropTargetOf(e) {
  const secEl = e.target.closest && e.target.closest('.hsec'); if (!secEl) return null;
  const subEl = e.target.closest('.hsub');
  return {el: subEl || secEl, sec: secEl.dataset.sec, sub: subEl ? subEl.dataset.sub : null};
}

export function clearDrop() { tpj.querySelectorAll('.dropon').forEach(x => { x.classList.remove('dropon'); x.removeAttribute('data-drop'); }); }

export function showHint(t) { const h = $('#dropHint'); h.textContent = t; h.hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(() => h.hidden = true, 400); }

export function moveSheet(id, sec, sub) {
  const sh = P.sheets[id]; if (!sh || sh.kind !== 'pair') return;
  if (sh.sec === sec && (sh.sub || null) === (sub || null)) return;
  const ok0 = catKey(sh);
  sh.sec = sec; sh.sub = sub || null;
  adoptCats(sh, ok0);
  let note = '';
  const u = sub ? subById(sec, sub) : null;
  if (u && !!u.below !== !!sh.state.below) {
    sh.state.below = !!u.below; sh.state.floors.forEach(f => f.below = !!u.below);
    note = u.below ? ' Ahora cuenta como tubería bajo losa (paredes en el nivel inferior).' : ' Ya no cuenta como tubería bajo losa.';
  }
  P.last = id; save(); renderProject(); renderTop();
  toast(`"${sh.name}" movido a ${secLabel(sh)}.${note}`);
}

/* lee archivos sueltos y carpetas completas (con subcarpetas) */
export async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map(i => i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async ent => {
    if (ent.isFile) { try { out.push(await new Promise((res, rej) => ent.file(res, rej))); } catch (_) {} }
    else if (ent.isDirectory) {
      const rd = ent.createReader(); let batch;
      do { batch = await new Promise(res => rd.readEntries(res, () => res([]))); for (const c of batch) await walk(c); } while (batch.length);
    }
  };
  for (const en of entries) await walk(en);
  return out.filter(f => !/^\./.test(f.name));
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  tpj.addEventListener('dragstart', e => {
    const t = e.target.closest && e.target.closest('.tile[draggable=true]'); if (!t) return;
    dragSheet = t.dataset.sheet; e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', P.sheets[dragSheet]?.name || ''); } catch (_) {}
    requestAnimationFrame(() => t.classList.add('dragging'));
  });
  tpj.addEventListener('dragend', () => { dragSheet = null; clearDrop(); tpj.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); $('#dropHint').hidden = true; });
  tpj.addEventListener('dragover', e => {
    const files = isFileDrag(e); if (!files && !dragSheet) return;
    e.preventDefault();
    const tg = dropTargetOf(e), arq = tg && tg.sec === 'arq';
    let label = '', ok = true;
    if (dragSheet) {
      const sh = P.sheets[dragSheet];
      if (!tg || arq) ok = false;
      else if (sh && sh.sec === tg.sec && (sh.sub || null) === (tg.sub || null)) ok = false;
      else label = `Mover a ${secLabel({sec:tg.sec, sub:tg.sub})}`;
      if (!ok) showHint(tg && arq ? 'Los planos de instalaciones no van en Arquitectónicos' : 'Suéltelo sobre otra sección o subsección');
    } else label = tg ? (arq ? 'Agregar como arquitectónicos' : `Agregar a ${secLabel({sec:tg.sec, sub:tg.sub})}`) : '';
    if (!tg && files) showHint('Suelte sobre una sección para agregar ahí los planos (o en cualquier parte para elegir después)');
    e.dataTransfer.dropEffect = ok ? (dragSheet ? 'move' : 'copy') : 'none';
    if (tg && ok && tg.el.classList.contains('dropon')) return;
    clearDrop();
    if (tg && ok) { tg.el.classList.add('dropon'); tg.el.setAttribute('data-drop', label); }
  });
  tpj.addEventListener('dragleave', e => { if (!tpj.contains(e.relatedTarget)) clearDrop(); });
  tpj.addEventListener('drop', async e => {
    e.preventDefault();
    const tg = dropTargetOf(e); clearDrop(); $('#dropHint').hidden = true;
    if (dragSheet) { const id = dragSheet; dragSheet = null; if (tg && tg.sec !== 'arq') moveSheet(id, tg.sec, tg.sub); return; }
    const files = await filesFromDrop(e.dataTransfer);
    if (!files.length) return;
    if (!tg) return handleFiles(files);
    const plans = files.filter(isPlanFile);
    if (!plans.length) return handleFiles(files);
    if (tg.sec === 'arq') addArqFiles(plans); else addPairFiles(plans, tg.sec, tg.sub);
  });
  tpj.addEventListener('input', e => { if (e.target.dataset.pf === 'q') { penF.q = e.target.value; renderPenTable(); } });
  tpj.addEventListener('change', e => {
    if (e.target.dataset.pf && e.target.dataset.pf !== 'q') { penF[e.target.dataset.pf] = e.target.value; renderPenTable(); return; }
    const t = e.target, a = t.dataset.pa, secEl = t.closest('[data-sec]'), sec = secEl && secById(secEl.dataset.sec);
    if (a === 'pname') { P.name = t.value.trim() || 'Proyecto'; save(); renderTop(); }
    else if (a === 'secName' && sec && sec.kind !== 'arq') { sec.name = t.value.trim() || sec.name; save(); renderTop(); }
    else if (a === 'subName') { const u = subById(sec.id, t.closest('[data-sub]').dataset.sub); u.name = t.value.trim() || u.name; save(); renderTop(); }
    else if (a === 'subBelow') {
      const u = subById(sec.id, t.closest('[data-sub]').dataset.sub); u.below = t.checked;
      const items = sheetsOf(sec.id, u.id).filter(s => s.kind === 'pair');
      items.forEach(sh => { sh.state.below = t.checked; sh.state.floors.forEach(f => f.below = t.checked); });
      save(); renderProject(); renderPlans(); renderSeals();
      if (items.length) toast(`${items.length} ${items.length === 1 ? 'plano actualizado' : 'planos actualizados'}: ${t.checked ? 'paredes en el nivel inferior' : 'paredes en el mismo nivel'}.`);
    }
  });
}
