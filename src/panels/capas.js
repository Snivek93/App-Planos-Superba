/* Pestaña Capas. */
import { $, esc, KINDS, LAYER_COLORS } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { L, MK, openLayers, RT, S, sel, uid } from '../core/state.js';
import { toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { renderOpts } from '../editor/tools.js';
import { reanchor } from '../editor/pointer.js';
import { pushUndo } from '../core/undo.js';
import { renderSeals } from './sellos.js';
import { save } from '../core/storage.js';
import { ask, changed, toast } from '../ui/app.js';
import { frameAt, frameOf } from '../plans/floors.js';

/* ---------- panel: capas ---------- */
export function renderLayers() {
  const counts = {};
  S.marks.forEach(m => { counts[m.layer] = (counts[m.layer] || 0) + 1; });
  $('#layers').innerHTML = S.layers.slice().reverse().map(l => {
    const open = openLayers.has(l.id), n = counts[l.id] || 0;
    return `<li class="layer${l.id === S.active ? ' on' : ''}" data-id="${l.id}" style="--c:${l.color}">
      <div class="lrow1">
        <button class="lpick" data-act="active" title="Dibujar en esta capa" aria-label="Dibujar en ${esc(l.name)}"><span class="ldot"></span></button>
        <input class="lname" data-act="name" value="${esc(l.name)}" aria-label="Nombre de la capa">
        <span class="lmeta">${l.plan} · ${n}</span>
        <button class="icon" data-act="vis" aria-pressed="${!l.visible}" title="${l.visible ? 'Ocultar' : 'Mostrar'}">${l.visible ? ICON.eye : ICON.eyeOff}</button>
        <button class="icon${l.locked ? ' warn' : ''}" data-act="lock" aria-pressed="${l.locked}" title="${l.locked ? 'Desbloquear' : 'Bloquear'}">${l.locked ? ICON.lock : ICON.unlock}</button>
        <button class="icon" data-act="more" aria-expanded="${open}" title="Opciones">${ICON.more}</button>
      </div>
      <div class="lrow2"${open ? '' : ' hidden'}>
        <div class="f"><label>Pegada al plano</label><div class="seg"><button data-act="plan" data-v="A" class="${l.plan === 'A' ? 'on' : ''}">Plano A</button><button data-act="plan" data-v="B" class="${l.plan === 'B' ? 'on' : ''}">Plano B</button></div></div>
        <div class="f"><label>Uso</label><select data-act="kind">${Object.entries(KINDS).map(([v, t]) => `<option value="${v}"${l.kind === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        ${l.kind === 'instalaciones' || l.kind === 'general' ? `<div class="f"><label>Sello al detectar</label><select data-act="st">${S.sealTypes.map(t => `<option value="${t.id}"${l.st === t.id ? ' selected' : ''}>${t.name}</option>`).join('')}</select></div>` : ''}
        <div class="f"><label>Color</label><input type="color" data-act="color" value="${l.color}"></div>
        <div class="btnrow"><button class="btn" data-act="up">Subir</button><button class="btn" data-act="down">Bajar</button><button class="btn ghost-red" data-act="del">Eliminar capa</button></div>
      </div>
    </li>`;
  }).join('');
}

export let lay;

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  lay = $('#layers');
  lay.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const li = b.closest('.layer'), l = L(li.dataset.id), a = b.dataset.act;
    if (a === 'active') { S.active = l.id; if (!l.visible) l.visible = true; save(); renderLayers(); renderOpts(); }
    else if (a === 'vis') { l.visible = !l.visible; if (!l.visible) [...sel].forEach(id => { if (MK(id)?.layer === l.id) sel.delete(id); }); save(); renderLayers(); renderOpts(); dirty(); }
    else if (a === 'lock') { l.locked = !l.locked; save(); renderLayers(); }
    else if (a === 'more') { openLayers.has(l.id) ? openLayers.delete(l.id) : openLayers.add(l.id); renderLayers(); }
    else if (a === 'plan') {
      const k = b.dataset.v; if (l.plan === k) return;
      pushUndo();
      const moves = S.marks.filter(m => m.layer === l.id).map(m => { const src = frameOf(m); return [m, src, frameAt({plan:k}, toWorld(src, m.pts[0]))]; });
      for (const [m, src, [dst, fl]] of moves) { reanchor(m, src, dst); m.fl = fl; }
      l.plan = k; changed(); toast(`La capa "${l.name}" ahora sigue al plano ${k}. Las marcas no se movieron.`);
    }
    else if (a === 'up' || a === 'down') {
      const i = S.layers.indexOf(l), j = a === 'up' ? i + 1 : i - 1;
      if (j < 0 || j >= S.layers.length) return;
      [S.layers[i], S.layers[j]] = [S.layers[j], S.layers[i]]; save(); renderLayers(); dirty();
    }
    else if (a === 'del') {
      if (S.layers.length === 1) return toast('Debe quedar al menos una capa.');
      const n = S.marks.filter(m => m.layer === l.id).length;
      const ok = n ? await ask({title:'Eliminar capa', body:`"${l.name}" tiene ${n} ${n === 1 ? 'marca' : 'marcas'}. Se eliminan junto con la capa.`, buttons:[{label:'Cancelar', value:false}, {label:'Eliminar', value:true, danger:true}]}) : true;
      if (!ok) return;
      pushUndo(); S.marks = S.marks.filter(m => m.layer !== l.id); S.layers = S.layers.filter(x => x !== l);
      if (S.active === l.id) S.active = S.layers[S.layers.length-1].id;
      sel.clear(); changed();
    }
  });
  lay.addEventListener('change', e => {
    const t = e.target, li = t.closest('.layer'); if (!li) return;
    const l = L(li.dataset.id), a = t.dataset.act;
    if (a === 'name') { l.name = t.value.trim() || 'Capa sin nombre'; save(); renderOpts(); renderSeals(); }
    else if (a === 'kind') { l.kind = t.value; save(); renderLayers(); }
    else if (a === 'st') { l.st = t.value; save(); }
    else if (a === 'color') { l.color = t.value; save(); renderLayers(); renderOpts(); dirty(); }
  });
  lay.addEventListener('input', e => { if (e.target.dataset.act === 'color') { const l = L(e.target.closest('.layer').dataset.id); l.color = e.target.value; dirty(); } });
  $('#addLayer').onclick = () => {
    const l = {id:'L' + uid(), name:'Capa ' + (S.layers.length + 1), plan: RT.B.bmp ? 'B' : 'A', color: LAYER_COLORS[S.layers.length % LAYER_COLORS.length], visible:true, locked:false, kind:'instalaciones', st:'pend'};
    S.layers.push(l); S.active = l.id; openLayers.add(l.id); save(); renderLayers(); renderOpts();
    setTimeout(() => { const inp = lay.querySelector(`[data-id="${l.id}"] .lname`); if (inp) { inp.focus(); inp.select(); } }, 30);
  };
}
