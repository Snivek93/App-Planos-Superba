/* Pestaña Planos: tarjetas de plano A y B, opacidad, color y ajuste. */
import { $, esc, TINTS } from '../core/constants.js';
import { P, RT, S } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { setBTransform, startAlign } from '../editor/align.js';
import { pushUndo } from '../core/undo.js';
import { loadVars, makeTint, removePlan, swapPlans } from '../plans/load.js';
import { renderSeals } from './sellos.js';
import { save } from '../core/storage.js';
import { changed, closePanel, toast } from '../ui/app.js';
import { floorLevels, floorMult, joinY, levelsHtml, parseLevels } from '../core/levels.js';
import { addFloor, autoAlignFloor, deleteFloor, editFloorZoneB, fitRect, floorById, setFloorLevels, floorRectWorld, floorsHtml } from '../plans/floors.js';
import { aLevelsLabel, curSheet, showHome } from '../project/model.js';
import { changePage, chooseA } from '../project/sheets.js';
import { renderOpBubble } from '../ui/opacity.js';
import { arqLevelsHtml, levelsChange, levelsClick } from '../plans/arqlevels.js';

/* ---------- panel: planos ---------- */
export function planCard(k) {
  const p = S.plans[k], rt = RT[k], sh = curSheet(), arqMode = sh && sh.kind === 'arq';
  const title = k === 'A' ? (arqMode ? 'Arquitectónico' : 'Plano A: arquitectónico') : 'Plano B: instalaciones';
  const sub = k === 'A' ? (arqMode ? 'Aquí se marcan las paredes cortafuego' : 'Las paredes marcadas vienen de esta hoja') : 'Eléctrico, mecánico, plomería o supresión';
  const badge = k === 'A' ? '#5A6268' : (p.tint || '#1E6FB8');
  let h = `<section class="plan" data-k="${k}"><header><span class="badge" style="background:${badge}">${k}</span><div><h3>${title}</h3><p class="muted">${sub}</p></div></header>`;
  if (rt.loading) return h + `<p class="muted">Cargando el plano…</p></section>`;
  const pairA = k === 'A' && !arqMode;
  if (!rt.bmp) {
    if (pairA) return h + `<p class="help" style="margin:0 0 8px">${p.fileId ? 'No se encontró el archivo de ese arquitectónico en este navegador.' : 'Elija la hoja de arquitectónicos.'}</p><button class="btn" data-act="chooseA">Elegir arquitectónico</button></section>`;
    return h + `<button class="drop" data-act="upload" data-k="${k}">Subir PDF o imagen</button>${p.w ? '<p class="help">Aquí había un plano. Súbalo de nuevo para ver las marcas sobre él.</p>' : ''}</section>`;
  }
  const label = pairA ? (P.sheets[sh.aSheet]?.name || rt.name) + aLevelsLabel(sh) : rt.name;
  h += `<div class="fname"><span title="${esc(rt.name)}">${esc(label)}</span>${pairA ? `<button class="linkbtn" data-act="chooseA">Cambiar</button>` :
    `<button class="linkbtn" data-act="upload" data-k="${k}">Cambiar archivo</button>${k === 'B' ? `<button class="linkbtn red" data-act="remove" data-k="${k}">Quitar</button>` : ''}`}</div>`;
  if (p.pages > 1 && !pairA) h += `<div class="field"><label>Página</label><select data-act="page" data-k="${k}">${Array.from({length:p.pages}, (_, i) => `<option value="${i+1}"${p.page === i+1 ? ' selected' : ''}>${i+1} de ${p.pages}</option>`).join('')}</select><span></span></div>`;
  h += `<label class="chk"><input type="checkbox" data-act="visible" data-k="${k}"${p.visible ? ' checked' : ''}> Mostrar plano</label>`;
  h += `<div class="field"><label>Opacidad</label><input type="range" min="0.05" max="1" step="0.05" value="${p.opacity}" data-act="opacity" data-k="${k}"><output>${Math.round(p.opacity*100)} %</output></div>`;
  h += `<div class="field"><label>Fondo</label><div class="seg"><button data-act="blend" data-k="${k}" data-v="normal" class="${p.blend !== 'multiply' ? 'on' : ''}">Normal</button><button data-act="blend" data-k="${k}" data-v="multiply" class="${p.blend === 'multiply' ? 'on' : ''}" title="El blanco se vuelve transparente">Sin blanco</button></div><span></span></div>`;
  h += `<div class="field"><label>Color</label><div class="tints">${TINTS.map(t => `<button class="tint${t.id ? '' : ' orig'}${p.tint === t.id ? ' on' : ''}" style="--c:${t.id || '#fff'}" data-act="tint" data-k="${k}" data-v="${t.id}" title="${t.name}" aria-label="${t.name}"></button>`).join('')}</div><span></span></div>`;
  if (k === 'B' && S.floors.length) {
    h += `<div class="adj"><p class="help" style="margin:0">Hay plantas definidas: la alineación del plano B se hace por planta, más abajo.</p></div>`;
  } else if (k === 'B') {
    const deg = (p.r*180/Math.PI);
    h += `<div class="adj"><h3 style="font-size:15px">Ajuste sobre el plano A</h3>
      <div class="btnrow"><button class="btn primary" data-act="align">Alinear con 2 puntos</button><button class="btn" data-act="handMove">Mover a mano</button></div>
      <div class="field"><label>Rotación</label><input type="range" min="-180" max="180" step="0.1" value="${deg.toFixed(1)}" data-act="rot"><output id="rotOut">${deg.toFixed(1)}°</output></div>
      <div class="btnrow"><button class="btn" data-act="rotBy" data-v="-90">−90°</button><button class="btn" data-act="rotBy" data-v="-0.1">−0,1°</button><button class="btn" data-act="rotBy" data-v="0.1">+0,1°</button><button class="btn" data-act="rotBy" data-v="90">+90°</button></div>
      <div class="field"><label>Escala</label><input type="number" step="0.1" min="1" value="${(p.s*100).toFixed(2)}" data-act="scale"><span>%</span></div>
      <label class="chk"><input type="checkbox" data-act="lockB"${p.locked ? ' checked' : ''}> Bloquear posición del plano B</label>
      <button class="linkbtn" data-act="resetB">Restablecer posición</button></div>`;
  }
  return h + '</section>';
}

export function renderPlans() {
  renderOpBubble();
  const sh = curSheet(), el = $('#tab-planos');
  if (!sh) { el.innerHTML = `<p class="help">No hay ningún plano abierto.</p><div class="btnrow"><button class="btn primary" data-act="goProj">Ir al inicio del proyecto</button></div>`; return; }
  if (sh.kind === 'arq') { el.innerHTML = planCard('A') + (RT.A.bmp ? arqLevelsHtml() : '') + `<p class="help"><b>Hoja de arquitectónicos.</b> Marque aquí las paredes cortafuego, a mano o con la detección automática. Todos los planos de instalaciones que usen esta hoja como plano A ven estas paredes, y lo que se marque o corrija en ellos vuelve aquí.</p>`; return; }
  el.innerHTML = planCard('A') + planCard('B') + levelsHtml() + floorsHtml() +
    `<p class="help"><b>Cómo se usa.</b> Las paredes cortafuego vienen del arquitectónico. Trace los ductos y tuberías del plano B en la capa Instalaciones o use la detección automática, y ponga los sellos a mano con la herramienta Sello cuando haga falta.</p>`;
}

export let tp;

export let sliding = false;

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  tp = $('#tab-planos');
  tp.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const a = b.dataset.act, k = b.dataset.k, p = k ? S.plans[k] : S.plans.B;
    if (a === 'goProj') { showHome(); return; }
    if (a.startsWith('lv')) { levelsClick(a, b.closest('[data-lvl]'), b); return; }
    if (a === 'chooseA') { chooseA(); return; }
    if (a === 'upload') { loadVars.uploadTarget = k; $('#fileOne').click(); }
    else if (a === 'remove') removePlan(k);
    else if (a === 'blend') { p.blend = b.dataset.v; save(); renderPlans(); dirty(); }
    else if (a === 'tint') { p.tint = b.dataset.v; makeTint(k); if (p.tint && p.blend !== 'multiply') p.blend = 'normal'; save(); renderPlans(); dirty(); }
    else if (a === 'align') startAlign();
    else if (a === 'handMove') { closePanel(); setTool('moveB'); }
    else if (a === 'rotBy') { if (p.locked) return toast('El plano B está bloqueado.'); pushUndo(); setBTransform(p.s, p.r + (+b.dataset.v)*Math.PI/180); changed(); renderPlans(); }
    else if (a === 'resetB') { if (p.locked) return toast('El plano B está bloqueado.'); pushUndo(); const A = S.plans.A; p.r = 0; p.x = 0; p.y = 0; p.s = (A.w && p.w) ? (A.w*A.s)/p.w : 1; changed(); renderPlans(); }
    else if (a === 'swap') swapPlans();
    else if (a === 'addFloor') addFloor();
    else if (['fAxes', 'fAlign', 'fMove', 'fView', 'fDel', 'fZoneB'].includes(a)) {
      const fl = floorById(b.closest('[data-floor]').dataset.floor); if (!fl) return;
      if (a === 'fAxes') autoAlignFloor(fl);
      else if (a === 'fZoneB') editFloorZoneB(fl);
      else if (a === 'fAlign') startAlign(fl.id);
      else if (a === 'fMove') { closePanel(); setTool('moveB'); fitRect(floorRectWorld(fl)); }
      else if (a === 'fView') { closePanel(); fitRect(floorRectWorld(fl)); }
      else if (a === 'fDel') deleteFloor(fl.id);
    }
  });
  tp.addEventListener('input', e => {
    const t = e.target, a = t.dataset.act, k = t.dataset.k;
    if (a === 'opacity') { S.plans[k].opacity = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; dirty(); save(); }
    else if (a === 'rot') {
      const p = S.plans.B; if (p.locked) { t.value = (p.r*180/Math.PI).toFixed(1); return toast('El plano B está bloqueado.'); }
      if (!sliding) { pushUndo(); sliding = true; }
      setBTransform(p.s, (+t.value)*Math.PI/180); $('#rotOut').textContent = (+t.value).toFixed(1) + '°'; dirty();
    }
  });
  tp.addEventListener('change', e => {
    const t = e.target, a = t.dataset.act, k = t.dataset.k;
    if (a === 'fname') { const fl = floorById(t.closest('[data-floor]').dataset.floor); if (fl) { fl.name = t.value.trim() || fl.name; save(); dirty(); renderSeals(); } return; }
    if (a === 'flevels') { const fl = floorById(t.closest('[data-floor]').dataset.floor); if (fl) { setFloorLevels(fl, t.value.trim()); save(); renderPlans(); renderSeals(); dirty(); toast(`"${fl.name}" representa ${floorMult(fl) === 1 ? 'el nivel' : 'los niveles'} ${joinY(floorLevels(fl))} (×${floorMult(fl)}).`); } return; }
    if (a === 'pbelow') { S.below = t.checked; S.floors.forEach(f => f.below = t.checked); save(); renderPlans(); renderSeals(); return; }
    if (a === 'fbelow') { const fl = floorById(t.closest('[data-floor]').dataset.floor); if (fl) { fl.below = t.checked; save(); renderSeals(); } return; }
    if (a === 'lvName' || a === 'lvLevels') { levelsChange(t, t.closest('[data-lvl]')); return; }
    if (a === 'plevels') { S.levels = t.value.trim(); S.levelsAuto = false; save(); renderSeals(); const lv = parseLevels(S.levels); if (lv.length) toast(`Este plano: ${lv.length === 1 ? 'nivel' : 'niveles'} ${joinY(lv)}${lv.length > 1 ? ` (×${lv.length})` : ''}.`); return; }
    if (a === 'visible') { S.plans[k].visible = t.checked; save(); dirty(); }
    else if (a === 'page') { changePage(k, +t.value); }
    else if (a === 'rot') { sliding = false; changed(); }
    else if (a === 'scale') {
      const p = S.plans.B, v = parseFloat(String(t.value).replace(',', '.'));
      if (p.locked) { t.value = (p.s*100).toFixed(2); return toast('El plano B está bloqueado.'); }
      if (!(v > 0)) { t.value = (p.s*100).toFixed(2); return; }
      pushUndo(); setBTransform(v/100, p.r); changed();
    }
    else if (a === 'lockB') { S.plans.B.locked = t.checked; save(); }
  });
}
