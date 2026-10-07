/* Barra de herramientas, barra de opciones contextual y capas de dibujo. */
import { $, esc, HL_COLORS, PEN_COLORS, widthSeg } from '../core/constants.js';
import { ICON, TOOLS } from '../ui/icons.js';
import { align, cur, L, MK, RT, S, sel, stateVars, tool, uid } from '../core/state.js';
import { cv, dirty } from '../canvas/render.js';
import { editTable } from '../canvas/tables.js';
import { deleteSel, finishPoly, moveSelToLayer } from './pointer.js';
import { startAlign } from './align.js';
import { pushUndo } from '../core/undo.js';
import { renderLayers } from '../panels/capas.js';
import { addCategory } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { changed, openPanel, setTab, toast } from '../ui/app.js';
import { LOC_NAME, locOf } from '../core/levels.js';
import { cancelFloor, floorDraft, floorsVars, solo } from '../plans/floors.js';
import { setWfMode, wallFixCancelDraft, wallFixFinish, wfDraft, wfMode } from '../detect/wallfix.js';

/* ---------- herramientas ---------- */
export function renderTools() {
  $('#tools').innerHTML = TOOLS.map(t => t === '-' ? '<div class="tool-sep"></div>' :
    `<button class="tool${tool === t[0] ? ' on' : ''}" data-tool="${t[0]}" title="${t[1]} (${t[2]})" aria-pressed="${tool === t[0]}">${ICON[t[0]]}<span>${t[1]}</span></button>`).join('');
}

export function setTool(t) {
  if (tool === 'poly' && t !== 'poly' && cur) finishPoly();
  if (tool === 'wallfix' && t !== 'wallfix' && wfDraft) wallFixFinish();
  if (t !== 'align') stateVars.align = null;
  if (t === 'moveB' && !RT.B.bmp) { toast('Primero suba el plano B.'); return; }
  if (solo && t !== 'floorA' && t !== 'floorB') { floorsVars.solo = null; floorsVars.floorDraft = null; }
  stateVars.tool = t;
  if (t !== 'select') { sel.clear(); }
  cv.style.cursor = ({select:'default', pan:'grab', text:'text', moveB:'move'})[t] || 'crosshair';
  renderTools(); renderOpts(); dirty();
}

export function activeDrawLayer() {
  const l = L(S.active) || S.layers[S.layers.length-1];
  if (!l) { toast('Cree una capa en la pestaña Capas.'); return null; }
  if (l.locked) { toast(`La capa "${l.name}" está bloqueada. Desbloquéela o elija otra.`); return null; }
  if (!l.visible) { l.visible = true; renderLayers(); }
  return l;
}

export function sealLayer() {
  let l = L(S.active);
  if (l && l.kind === 'sellos' && !l.locked) return l;
  l = S.layers.find(x => x.kind === 'sellos' && !x.locked);
  if (!l) { l = {id:'L' + uid(), name:'Sellos', plan:'A', color:'#C81E2B', visible:true, locked:false, kind:'sellos', st:'pend'}; S.layers.push(l); }
  if (!l.visible) l.visible = true;
  return l;
}

export function layerSelectHtml(act, value) {
  return `<select data-o="${act}" aria-label="Capa">${S.layers.slice().reverse().map(l => `<option value="${l.id}"${l.id === value ? ' selected' : ''}>${esc(l.name)} (plano ${l.plan})</option>`).join('')}</select>`;
}

export function renderOpts() {
  const o = $('#opts'); let h = '';
  if (tool === 'select' && sel.size) {
    const ms = [...sel].map(MK).filter(Boolean);
    const allSeals = ms.length && ms.every(m => m.type === 'seal');
    const sameLayer = ms.every(m => m.layer === ms[0].layer) ? ms[0].layer : '';
    h = `<span><b>${ms.length}</b> ${ms.length === 1 ? 'marca' : 'marcas'}</span>
      <span class="lbl">Mover a capa</span>${layerSelectHtml('moveTo', sameLayer)}`;
    if (allSeals) {
      const lc = ms.every(m => locOf(m) === locOf(ms[0])) ? locOf(ms[0]) : '';
      h += `<span class="lbl">Ubicación</span><select data-o="selLoc">${lc ? '' : '<option value="">Varias</option>'}${['pared', 'losa'].map(v => `<option value="${v}"${v === lc ? ' selected' : ''}>${LOC_NAME[v]}</option>`).join('')}</select>`;
      const st = ms.every(m => m.st === ms[0].st) ? ms[0].st : '';
      const nm = ms.filter(m => m.mem).length;
      h += `<label class="chk small" title="Penetración de membrana: la tubería atraviesa una sola cara"><input type="checkbox" data-o="selMem"${nm === ms.length ? ' checked' : ''}${nm && nm < ms.length ? ' data-mixed="1"' : ''}> Membrana</label>`;
      h += `<span class="lbl">Tipo</span><select data-o="selType">${st ? '' : '<option value="">Varios</option>'}${S.sealTypes.map(t => `<option value="${t.id}"${t.id === st ? ' selected' : ''}>${t.name}</option>`).join('')}</select>`;
    }
    if (ms.length === 1 && ms[0].type === 'table') h += `<button class="btn primary" data-o="editTable">Editar tabla</button>`;
    const strokes = ms.filter(m => m.type !== 'seal' && m.type !== 'table');
    if (strokes.length) {
      const c0 = strokes[0].color || L(strokes[0].layer)?.color || '#C81E2B';
      h += `<span class="lbl">Color</span><label class="swc" style="background:${c0}" title="Cambiar color"><input type="color" data-o="selColor" value="${c0}" aria-label="Color de la selección"></label>`;
      if (strokes.every(m => m.type !== 'text')) {
        const a0 = strokes[0].alpha ?? (strokes[0].type === 'hl' ? 0.4 : 1);
        h += `<span class="lbl">Opacidad</span><input type="range" min="0.1" max="1" step="0.05" value="${a0}" data-o="selAlpha" aria-label="Opacidad"><output>${Math.round(a0*100)} %</output>`;
      }
    }
    h += `<button class="btn ghost-red" data-o="del">Eliminar</button>`;
  } else if (tool === 'hl') {
    h = `${layerSelectHtml('active', S.active)}<span class="optsep"></span>
      ${HL_COLORS.map(c => `<button class="sw${S.hlColor === c ? ' on' : ''}" style="--c:${c}" data-o="hlColor" data-v="${c}" aria-label="Color ${c}"></button>`).join('')}
      <label class="swc${HL_COLORS.includes(S.hlColor) ? '' : ' on'}" title="Otro color"${HL_COLORS.includes(S.hlColor) ? '' : ` style="background:${S.hlColor}"`}><input type="color" data-o="hlCustom" value="${S.hlColor}" aria-label="Otro color"></label>
      <span class="optsep"></span><span class="lbl">Opacidad</span><input type="range" min="0.1" max="0.9" step="0.05" value="${S.hlAlpha}" data-o="hlAlpha" aria-label="Opacidad del marcador"><output id="hlOut">${Math.round(S.hlAlpha*100)} %</output>
      ${widthSeg('hlWidth', S.hlWidth)}`;
  } else if (['pen', 'line', 'poly', 'rect', 'text'].includes(tool)) {
    const l = L(S.active), lc = l ? l.color : '#999';
    h = `${layerSelectHtml('active', S.active)}<span class="optsep"></span>
      <button class="sw layer${S.drawColor ? '' : ' on'}" data-o="drawColor" data-v="" title="Usar el color de la capa"><span class="ldot" style="--c:${lc}"></span>Capa</button>
      ${PEN_COLORS.map(c => `<button class="sw${S.drawColor === c ? ' on' : ''}" style="--c:${c}" data-o="drawColor" data-v="${c}" aria-label="Color ${c}"></button>`).join('')}
      <label class="swc${S.drawColor && !PEN_COLORS.includes(S.drawColor) ? ' on' : ''}" title="Otro color"${S.drawColor && !PEN_COLORS.includes(S.drawColor) ? ` style="background:${S.drawColor}"` : ''}><input type="color" data-o="drawCustom" value="${S.drawColor || lc}" aria-label="Otro color"></label>
      <span class="optsep"></span>`;
    if (tool !== 'text') h += widthSeg('width', S.width) + `<span class="optsep"></span><span class="lbl">Opacidad</span><input type="range" min="0.1" max="1" step="0.05" value="${S.drawAlpha}" data-o="drawAlpha" aria-label="Opacidad"><output>${Math.round(S.drawAlpha*100)} %</output>`;
    if (tool === 'poly') {
      h += cur ? `<button class="btn primary" data-o="polyDone">Terminar</button><button class="btn" data-o="polyCancel">Cancelar</button>`
               : `<span class="lbl">Toque cada vértice. Toque el último punto otra vez para terminar.</span>`;
    }
    if (tool === 'line') h += `<span class="lbl hide-sm">Shift: ángulos de 15°</span>`;
  } else if (tool === 'seal') {
    if (!S.sealTypes.some(t => t.id === S.sealType)) S.sealType = S.sealTypes[0]?.id || 'pend';
    h = `<div class="seg locseg" role="group" aria-label="Ubicación">${['pared', 'losa'].map(v => `<button data-o="sealLoc" data-v="${v}" class="${(S.sealLoc || 'pared') === v ? 'on' : ''}">${LOC_NAME[v]}</button>`).join('')}</div><span class="optsep"></span>` + S.sealTypes.map(t => `<button class="chip${S.sealType === t.id ? ' on' : ''}" data-o="sealType" data-v="${t.id}" style="--c:${t.color}"><i></i>${esc(t.name)}</button>`).join('') +
      `<button class="chip" data-o="newCat" title="Crear una categoría nueva">+ Nueva categoría</button>` +
      `<span class="optsep"></span><span class="lbl">Opacidad</span><input type="range" min="0.2" max="1" step="0.05" value="${S.sealAlpha ?? 0.7}" data-o="sealAlpha" aria-label="Opacidad de los sellos"><output>${Math.round((S.sealAlpha ?? 0.7)*100)} %</output>`;
  } else if (tool === 'pick') {
    const fire = S.auto.picking === 'fire';
    h = `<span class="hint">Toque ${fire ? 'una pared cortafuego en el plano A' : 'una tubería en el plano B'}. Acerque el zoom para tocar justo encima.</span><button class="btn primary" data-o="pickDone">Terminar</button>`;
  } else if (tool === 'floorA' || tool === 'floorB') {
    h = `<b>Paso ${tool === 'floorA' ? 1 : 2} de 2</b><span class="hint">Arrastre un rectángulo alrededor de "${esc(floorDraft ? floorDraft.name : '')}" en el plano ${tool === 'floorA' ? 'A (arquitectónico)' : 'B (instalaciones)'}. Incluya los círculos de los ejes.</span><button class="btn" data-o="floorCancel">Cancelar</button>`;
  } else if (tool === 'lvlRect') {
    h = `<span class="hint">Arrastre un rectángulo alrededor de la planta de ese nivel, incluyendo su título (por ejemplo "PLANTA NIVEL 6").</span><button class="btn" data-o="cancelTool">Cancelar</button>`;
  } else if (tool === 'wallfix') {
    const seg = `<div class="seg" role="group" aria-label="Modo">${[['quitar', 'Quitar'], ['agregar', 'Agregar']].map(([v, t]) => `<button data-o="wfMode" data-v="${v}" class="${wfMode === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    h = `<b>Afinar paredes</b>${seg}` + (wfMode === 'agregar'
      ? `<span class="hint">${wfDraft ? 'Toque el siguiente punto. Toque otra vez el último punto (o Enter) para terminar.' : 'Arrastre para trazar una línea, o toque punto por punto para una polilínea. Sirve para cargadores sobre puertas y tramos que faltan.'}</span>${wfDraft ? '<button class="btn" data-o="wfDone">Terminar trazo</button><button class="btn" data-o="wfCancel">Descartar</button>' : ''}`
      : `<span class="hint">Toque una columna, símbolo, trozo, cargador o tramo agregado para quitarlo (o devolverlo). Arrastre un rectángulo para borrar una zona; toque dentro de una zona borrada para restaurarla.</span>`)
      + `<button class="btn primary" data-o="cancelTool">Terminar</button>`;
  } else if (tool === 'zone') {
    h = `<span class="hint">Arrastre un rectángulo alrededor del nivel que quiere revisar.</span><button class="btn" data-o="cancelTool">Cancelar</button>`;
  } else if (tool === 'table') {
    h = `<span class="hint">Toque el punto del plano donde irá la esquina superior izquierda de la tabla.</span><button class="btn" data-o="cancelTool">Cancelar</button>`;
  } else if (tool === 'align' && align) {
    const steps = ['Toque un punto reconocible en el plano B, por ejemplo la esquina de una columna o un cruce de ejes.',
      'Ahora toque ese mismo punto en el plano A.',
      'Toque un segundo punto en el plano B, lo más lejos posible del primero.',
      'Toque ese mismo segundo punto en el plano A.'];
    h = `<b>Paso ${align.pts.length + 1} de 4</b><span class="hint">${steps[align.pts.length]}</span><button class="btn" data-o="alignCancel">Cancelar</button>`;
  } else if (tool === 'eraser') {
    h = `<span class="hint">Toque o arrastre sobre las marcas que quiera borrar.</span>`;
  } else if (tool === 'moveB') {
    h = S.floors.length ? `<span class="hint">Con plantas el plano B queda fijo: arrastre dentro de una planta para mover su nivel del arquitectónico hasta que calce.</span>`
      : `<span class="hint">Arrastre para mover el plano B. Rotación y escala están en la pestaña Planos.</span><button class="btn" data-o="alignStart">Alinear con 2 puntos</button>`;
  }
  o.innerHTML = h; o.querySelectorAll('[data-mixed]').forEach(i => i.indeterminate = true);
}

export let alphaSliding = false;

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#opts').addEventListener('click', e => {
    const b = e.target.closest('button[data-o]'); if (!b) return;
    const a = b.dataset.o;
    if (a === 'width') { S.width = +b.dataset.v; save(); renderOpts(); }
    else if (a === 'hlWidth') { S.hlWidth = +b.dataset.v; save(); renderOpts(); }
    else if (a === 'drawColor') { S.drawColor = b.dataset.v; save(); renderOpts(); }
    else if (a === 'hlColor') { S.hlColor = b.dataset.v; save(); renderOpts(); }
    else if (a === 'sealType') { S.sealType = b.dataset.v; save(); renderOpts(); }
    else if (a === 'sealLoc') { S.sealLoc = b.dataset.v; save(); renderOpts(); }
    else if (a === 'del') deleteSel();
    else if (a === 'polyDone') finishPoly();
    else if (a === 'polyCancel') { stateVars.cur = null; renderOpts(); dirty(); }
    else if (a === 'alignCancel') { stateVars.align = null; setTool('select'); }
    else if (a === 'alignStart') startAlign();
    else if (a === 'cancelTool') setTool('select');
    else if (a === 'wfMode') setWfMode(b.dataset.v);
    else if (a === 'wfDone') wallFixFinish();
    else if (a === 'wfCancel') wallFixCancelDraft();
    else if (a === 'floorCancel') cancelFloor();
    else if (a === 'pickDone') { setTool('select'); setTab('auto'); openPanel(); }
    else if (a === 'newCat') addCategory(true);
    else if (a === 'editTable') { const m = MK([...sel][0]); if (m) editTable(m); }
  });
  $('#opts').addEventListener('input', e => {
    const t = e.target, a = t.dataset.o;
    if (a === 'sealAlpha') { S.sealAlpha = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; save(); dirty(); return; }
    if (a === 'drawAlpha') { S.drawAlpha = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; save(); }
    else if (a === 'hlAlpha') { S.hlAlpha = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; save(); }
    else if (a === 'selAlpha') {
      if (!alphaSliding) { pushUndo(); alphaSliding = true; }
      for (const id of sel) { const m = MK(id); if (m && !['seal', 'text', 'table'].includes(m.type)) m.alpha = +t.value; }
      t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; dirty();
    }
    else if (a === 'drawCustom' || a === 'hlCustom' || a === 'selColor') t.parentElement.style.background = t.value;
  });
  $('#opts').addEventListener('change', e => {
    const t = e.target, a = t.dataset.o;
    if (a === 'drawCustom') { S.drawColor = t.value; save(); renderOpts(); return; }
    if (a === 'hlCustom') { S.hlColor = t.value; save(); renderOpts(); return; }
    if (a === 'selAlpha') { alphaSliding = false; changed(); return; }
    if (a === 'selColor') { pushUndo(); for (const id of sel) { const m = MK(id); if (m && m.type !== 'seal' && m.type !== 'table') m.color = t.value; } changed(); return; }

    const s = e.target.closest('select[data-o]'); if (!s) return;
    if (s.dataset.o === 'active') { S.active = s.value; save(); renderLayers(); renderOpts(); }
    else if (s.dataset.o === 'moveTo') moveSelToLayer(s.value);
    else if (s.dataset.o === 'selMem') { pushUndo(); for (const id of sel) { const m = MK(id); if (m && m.type === 'seal') { if (s.checked) m.mem = true; else delete m.mem; } } changed(); renderOpts(); }
    else if (s.dataset.o === 'selLoc' && s.value) { pushUndo(); for (const id of sel) { const m = MK(id); if (m && m.type === 'seal') m.loc = s.value; } changed(); }
    else if (s.dataset.o === 'selType' && s.value) { pushUndo(); for (const id of sel) { const m = MK(id); if (m && m.type === 'seal') m.st = s.value; } changed(); }
  });
}
