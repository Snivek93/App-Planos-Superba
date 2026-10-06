/* Pestaña Detección. */
import { $, esc } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { RT, S } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { save } from '../core/storage.js';
import { closePanel, toast } from '../ui/app.js';
import { ensureVec, isDot, pathCache, ruleCache } from '../detect/vector.js';
import { clearAutoSeals, runAuto } from '../detect/cross.js';

/* panel */
export function ruleHasDots(r) { const v = RT[r.plan].vec; return !!(v && (v.byKey.get(r.key) || []).some(isDot)); }

export function ruleRow(r, isFire) {
  const c = ruleCache(r), n = c ? c.count : '…';
  return `<li data-rule="${r.id}"><span class="ldot" style="--c:${r.color};width:20px;height:20px;border-radius:5px;box-shadow:0 0 0 1px rgba(0,0,0,.2)"></span>
    <input data-act="rname" value="${esc(r.name)}" aria-label="Nombre">
    <span class="cnt" title="Formas encontradas">${n}</span>
    <button class="icon" data-act="ron" aria-pressed="${!r.on}" title="${r.on ? 'Excluir de la búsqueda' : 'Incluir en la búsqueda'}">${r.on ? ICON.eye : ICON.eyeOff}</button>
    <button class="icon" data-act="rdel" title="Quitar">${ICON.trash}</button>
    ${ruleHasDots(r) ? `<label class="chk small" style="grid-column:2 / -1;margin:0"><input type="checkbox" data-act="rdots"${r.noDots === false ? '' : ' checked'}> Ignorar puntos y círculos pequeños</label>` : ''}</li>`;
}

export function renderAuto() {
  const a = S.auto, z = a.zone;
  $('#tab-auto').innerHTML = `
    <h3>Detección automática</h3>
    <p class="help" style="margin-top:4px">Opcional: puede seguir marcando todo a mano. Funciona con PDF exportados desde CAD o Revit, no con escaneos. Usted toca una pared o una tubería y la app toma todas las del mismo estilo.</p>
    <div class="sect"><header><h3>Paredes cortafuego (plano A)</h3></header>
      <ul class="cats rules">${a.fire.map(r => ruleRow(r, true)).join('') || '<li class="muted small" style="display:block">Ninguna todavía.</li>'}</ul>
      <div class="btnrow"><button class="btn" data-act="pickFire">Elegir en el plano</button></div></div>
    <div class="sect"><header><h3>Tuberías (plano B)</h3></header>
      <ul class="cats rules">${a.pipes.map(r => ruleRow(r, false)).join('') || '<li class="muted small" style="display:block">Ninguna todavía.</li>'}</ul>
      <div class="btnrow"><button class="btn" data-act="pickPipe">Elegir en el plano</button></div>
      <label class="chk"><input type="checkbox" data-act="diam"${a.diam ? ' checked' : ''}> Leer el diámetro de los rótulos (ø13 mm, Ø 100…)</label></div>
    <div class="sect"><header><h3>Zona de búsqueda</h3></header>
      <p class="help" style="margin-top:4px">${S.floors.length ? 'Hay plantas definidas en la pestaña Planos: se busca planta por planta y la zona no se usa.' : z ? 'Se busca solo dentro de la zona marcada.' : 'Se busca en toda la hoja. Si la hoja trae varios niveles, marque solo el que está revisando.'}</p>
      <div class="btnrow"><button class="btn" data-act="zone">${z ? 'Cambiar zona' : 'Dibujar zona'}</button>${z ? '<button class="btn" data-act="zoneClear">Quitar zona</button>' : ''}</div></div>
    <div class="sect"><header><h3>Buscar cruces</h3></header>
      <div class="field" style="grid-template-columns:110px 1fr"><label>Categoría</label><select data-act="catMode">
        ${[['diam', 'Por diámetro (ø13 mm, ø19 mm…)'], ['both', 'Por tubería y diámetro'], ['sys', 'Por tubería'], ['pend', 'Por definir']].map(([v, t]) => `<option value="${v}"${a.catMode === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <label class="chk"><input type="checkbox" data-act="showDiam"${S.showDiam ? ' checked' : ''}> Mostrar el diámetro junto a cada sello</label>
      <label class="chk"><input type="checkbox" data-act="show"${a.show ? ' checked' : ''}> Resaltar en el plano lo que se detectó</label>
      <div class="btnrow"><button class="btn red" data-act="run">Detectar cruces automáticamente</button><button class="btn" data-act="clearAuto">Quitar sellos automáticos</button></div>
      ${a.last ? `<p class="help">${esc(a.last)}</p>` : ''}
      <p class="help">Los sellos marcados con anillo naranja son casos dudosos: la tubería parece correr a lo largo de la pared en vez de atravesarla. El diámetro se toma del rótulo más cercano, revíselo en la lista de sellos.</p></div>`;
}

export let ta;

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  ta = $('#tab-auto');
  ta.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const a = b.dataset.act, li = b.closest('[data-rule]');
    const rule = li ? [...S.auto.fire, ...S.auto.pipes].find(r => r.id === li.dataset.rule) : null;
    if (a === 'pickFire' || a === 'pickPipe') {
      const k = a === 'pickFire' ? 'A' : 'B';
      if (!RT[k].bmp) return toast(`Primero suba el plano ${k}.`);
      if (!RT[k].pdf) return toast(`El plano ${k} es una imagen. La detección automática necesita el PDF original.`);
      S.auto.picking = a === 'pickFire' ? 'fire' : 'pipe';
      S.plans[k].visible = true; closePanel(); setTool('pick');
      ensureVec(k).catch(err => toast(err.message));
    }
    else if (a === 'ron') { rule.on = !rule.on; save(); renderAuto(); dirty(); }
    else if (a === 'rdel') { S.auto.fire = S.auto.fire.filter(r => r !== rule); S.auto.pipes = S.auto.pipes.filter(r => r !== rule); pathCache.delete(rule.id); save(); renderAuto(); dirty(); }
    else if (a === 'zone') { closePanel(); setTool('zone'); }
    else if (a === 'zoneClear') { S.auto.zone = null; save(); renderAuto(); dirty(); }
    else if (a === 'run') { closePanel(); runAuto(); }
    else if (a === 'clearAuto') clearAutoSeals();
  });
  ta.addEventListener('change', e => {
    const t = e.target, a = t.dataset.act;
    if (a === 'rname') { const li = t.closest('[data-rule]'); const r = [...S.auto.fire, ...S.auto.pipes].find(x => x.id === li.dataset.rule); if (r) r.name = t.value.trim() || r.name; save(); }
    else if (a === 'rdots') { const li = t.closest('[data-rule]'); const r = [...S.auto.fire, ...S.auto.pipes].find(x => x.id === li.dataset.rule); if (r) { r.noDots = t.checked; pathCache.delete(r.id); save(); renderAuto(); dirty(); } }
    else if (a === 'diam') { S.auto.diam = t.checked; save(); }
    else if (a === 'catMode') { S.auto.catMode = t.value; save(); }
    else if (a === 'showDiam') { S.showDiam = t.checked; save(); dirty(); }
    else if (a === 'show') { S.auto.show = t.checked; save(); dirty(); }
  });
}
