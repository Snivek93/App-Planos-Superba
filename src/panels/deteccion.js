/* Pestaña Detección. */
import { $, esc } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { RT, S } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { save } from '../core/storage.js';
import { ask, closePanel, toast } from '../ui/app.js';
import { ensureVec, isDot, pathCache, ruleCache } from '../detect/vector.js';
import { clearAutoSeals, runAuto } from '../detect/cross.js';
import { renderOpBubble } from '../ui/opacity.js';
import { redetectLintels, startWallFix, wallFixReset, wallFixSummary } from '../detect/wallfix.js';
import { fireEdits, fireExtras, fxCreate } from '../detect/vector.js';
import { analyzeTags, isTagRule, TAG_PREFIX } from '../detect/tagwalls.js';
import { uid } from '../core/state.js';

/* Paredes cortafuego por etiqueta: se leen los códigos de pared del plano A y su resistencia en la tabla de
   ensambles; el usuario elige cuáles son cortafuego y cada código queda como una pared de la lista. */
async function tagDialog() {
  if (!RT.A.bmp) return toast('Primero suba el plano A.');
  if (!RT.A.isPdf) return toast('El plano A es una imagen. Para leer las etiquetas se necesita el PDF original.');
  toast('Leyendo las etiquetas de pared del plano A…');
  let codes;
  try { codes = await analyzeTags('A'); } catch (e) { console.error(e); return toast('No se pudieron leer las etiquetas: ' + (e.message || e)); }
  const withTags = codes.filter(c => c.tags);
  if (!withTags.length) return toast('No se encontraron etiquetas de pared con línea guía en esta lámina.');
  const prev = new Map(S.auto.fire.filter(isTagRule).map(r => [r.key.slice(TAG_PREFIX.length), r]));
  const fx0 = fireEdits('A'), prevH = new Map(((fx0 && fx0.tagw) || []).map(g => [g.code, g.h]));
  const rows = withTags.map((c, i) => {
    const h = prevH.has(c.code) ? prevH.get(c.code) : c.h, on = prev.size ? prev.has(c.code) : h > 0;
    return `<tr data-i="${i}"><td><input type="checkbox" data-f="on"${on ? ' checked' : ''} aria-label="Cortafuego"></td><td><b>${esc(c.code)}</b></td>
      <td><select data-f="h">${[0, 1, 2, 3, 4].map(v => `<option value="${v}"${v === h ? ' selected' : ''}>${v ? v + ' h' : '—'}</option>`).join('')}</select>${c.h ? '' : ' <span class="muted small">no está en la tabla</span>'}</td>
      <td style="text-align:right">${c.tags}</td><td style="text-align:right">${c.walls.length}${c.miss ? ` <span class="muted small">(${c.miss} sin leer)</span>` : ''}</td></tr>`;
  }).join('');
  const html = `<p class="muted small" style="margin:0">Códigos de pared encontrados en la planta, con la resistencia que da la tabla de ensambles de la lámina. Marque los que son cortafuego: la app toma cada pared etiquetada siguiendo la línea de su etiqueta, mide su grosor y la sigue hasta donde termina. Revise el resultado en el plano; lo que falte se completa con "Afinar paredes a mano".</p>
    <div class="mantbl" style="max-height:52vh;overflow:auto"><table class="fst"><tr><th></th><th>Código</th><th>Resistencia</th><th>Etiquetas</th><th>Paredes</th></tr>${rows}</table></div>`;
  const v = await ask({title:'Paredes cortafuego por etiqueta', html, wide:true, buttons:[{label:'Cancelar', value:null}, {label:'Usar estas paredes', value:'ok', primary:true}],
    read: r => [...r.querySelectorAll('tr[data-i]')].map(tr => ({c: withTags[+tr.dataset.i], on: tr.querySelector('[data-f=on]').checked, h: +tr.querySelector('[data-f=h]').value}))});
  if (!v) return;
  const sel = v.filter(x => x.on);
  const fx = fxCreate('A'); if (!fx) return toast('Primero suba el plano A.');
  fx.tagw = sel.map(x => ({code:x.c.code, h:x.h, walls:x.c.walls}));
  fx.v = (fx.v || 0) + 1;
  // reglas: una por código elegido (se conservan nombre y visibilidad de las que ya estaban)
  const keep = S.auto.fire.filter(r => !isTagRule(r));
  for (const r of S.auto.fire.filter(isTagRule)) pathCache.delete(r.id);
  const tagRules = sel.map(x => {
    const old = prev.get(x.c.code), conc = /^CO/i.test(x.c.code);
    const name = old ? old.name : `${x.c.code} · ${conc ? 'concreto ' : ''}${x.h ? x.h + ' h' : 'sin resistencia'}`;
    return {id: old ? old.id : 'r' + uid(), plan:'A', key:TAG_PREFIX + x.c.code, kind:'f', color:'#C81E2B', w:0, name, on: old ? old.on : true, noDots:false, tag:true};
  });
  S.auto.fire = keep.concat(tagRules);
  S.auto.show = true; RT.A.hl = null; save(); renderAuto(); dirty();
  const nW = sel.reduce((a, x) => a + x.c.walls.length, 0);
  toast(`${sel.length} ${sel.length === 1 ? 'tipo de pared' : 'tipos de pared'} cortafuego, ${nW} ${nW === 1 ? 'pared encontrada' : 'paredes encontradas'}. Revíselas en el plano.`);
}

/* panel */
export function ruleHasDots(r) { const v = RT[r.plan].vec; return !!(v && (v.byKey.get(r.key) || []).some(isDot)); }

export function ruleRow(r, isFire) {
  const c = ruleCache(r), n = c ? c.count : '…';
  return `<li data-rule="${r.id}"><span class="ldot" style="--c:${r.color};width:20px;height:20px;border-radius:5px;box-shadow:0 0 0 1px rgba(0,0,0,.2)"></span>
    <input data-act="rname" value="${esc(r.name)}" aria-label="Nombre">
    <span class="cnt" title="Formas encontradas">${n}</span>
    <button class="icon" data-act="ron" aria-pressed="${!r.on}" title="${r.on ? 'Excluir de la búsqueda' : 'Incluir en la búsqueda'}">${r.on ? ICON.eye : ICON.eyeOff}</button>
    <button class="icon" data-act="rdel" title="Quitar">${ICON.trash}</button>
    ${ruleHasDots(r) ? `<label class="chk small" style="grid-column:2 / -1;margin:0"><input type="checkbox" data-act="rdots"${r.noDots === false ? '' : ' checked'}> Ignorar símbolos pequeños (círculos de nivel, flechas, puntos)</label>` : ''}</li>`;
}

export function renderAuto() {
  renderOpBubble();
  const a = S.auto, z = a.zone;
  $('#tab-auto').innerHTML = `
    <h3>Detección automática</h3>
    <p class="help" style="margin-top:4px">Opcional: puede seguir marcando todo a mano. Funciona con PDF exportados desde CAD o Revit, no con escaneos. Usted toca una pared o una tubería y la app toma todas las del mismo estilo.</p>
    <div class="sect"><header><h3>Paredes cortafuego (plano A)</h3></header>
      <ul class="cats rules">${a.fire.map(r => ruleRow(r, true)).join('') || '<li class="muted small" style="display:block">Ninguna todavía.</li>'}</ul>
      <div class="btnrow"><button class="btn" data-act="pickFire">Elegir en el plano</button><button class="btn" data-act="tagFire" title="Para planos con las paredes en negro: se leen los códigos de pared (X4-4C-F2F2, C2C2-3F-C2C2, CO25…) y la tabla de ensambles">Por etiquetas de pared</button>${a.fire.length ? '<button class="btn" data-act="wallFix">Afinar paredes a mano</button>' : ''}</div>
      ${a.fire.length ? `<label class="chk" style="margin-top:6px"><input type="checkbox" data-act="lintels"${a.lintels !== false ? ' checked' : ''}> Agregar cargadores sobre puertas entre paredes cortafuego${a.lintels !== false && RT.A.lint ? ` <span class="muted">(${fireExtras().lint.length} encontrados)</span>` : ''}</label>${a.lintels !== false && fireEdits('A') && fireEdits('A').lint ? `<p class="help" style="margin:2px 0 0 26px">Se buscaron una vez y quedan fijos con sus ajustes: no cambian solos. <button class="linkbtn" data-act="relint">Buscar de nuevo</button></p>` : ''}` : ''}
      ${wallFixSummary() ? `<p class="help" style="margin-top:6px">Ajustes a mano: ${esc(wallFixSummary())}. <button class="linkbtn" data-act="wallFixReset">Restaurar todo</button></p>` : ''}</div>
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
      <div class="field" style="grid-template-columns:150px 1fr auto"><label>Opacidad de la marca de paredes</label><input type="range" min="0" max="1" step="0.05" value="${a.hlOp ?? 0.8}" data-act="hlOp" aria-label="Opacidad de la marca de paredes cortafuego"><output>${Math.round((a.hlOp ?? 0.8)*100)} %</output></div>
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
    if (a === 'relint') {
      ask({title:'Buscar cargadores de nuevo', body:'Se vuelven a buscar los cargadores sobre puertas en este arquitectónico. Los que quitó a mano vuelven a aparecer y tendrá que quitarlos otra vez.', buttons:[{label:'Cancelar', value:false, primary:true}, {label:'Buscar de nuevo', value:true, danger:true}]})
        .then(ok => { if (ok) { redetectLintels(); renderAuto(); } });
      return;
    }
    if (a === 'pickFire' || a === 'pickPipe') {
      const k = a === 'pickFire' ? 'A' : 'B';
      if (!RT[k].bmp) return toast(`Primero suba el plano ${k}.`);
      if (!RT[k].isPdf) return toast(`El plano ${k} es una imagen. La detección automática necesita el PDF original.`);
      S.auto.picking = a === 'pickFire' ? 'fire' : 'pipe';
      S.plans[k].visible = true; closePanel(); setTool('pick');
      ensureVec(k).catch(err => toast(err.message));
    }
    else if (a === 'wallFix') { S.plans.A.visible = true; S.auto.show = true; startWallFix().then(ok => { if (ok) { closePanel(); setTool('wallfix'); dirty(); } }); }
    else if (a === 'wallFixReset') wallFixReset();
    else if (a === 'tagFire') tagDialog();
    else if (a === 'ron') { rule.on = !rule.on; save(); renderAuto(); dirty(); }
    else if (a === 'rdel') { S.auto.fire = S.auto.fire.filter(r => r !== rule); S.auto.pipes = S.auto.pipes.filter(r => r !== rule); pathCache.delete(rule.id); save(); renderAuto(); dirty(); }
    else if (a === 'zone') { closePanel(); setTool('zone'); }
    else if (a === 'zoneClear') { S.auto.zone = null; save(); renderAuto(); dirty(); }
    else if (a === 'run') { closePanel(); runAuto(); }
    else if (a === 'clearAuto') clearAutoSeals();
  });
  ta.addEventListener('input', e => {
    const t = e.target; if (t.dataset.act !== 'hlOp') return;
    S.auto.hlOp = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; save(); dirty();
  });
  ta.addEventListener('change', e => {
    const t = e.target, a = t.dataset.act;
    if (a === 'rname') { const li = t.closest('[data-rule]'); const r = [...S.auto.fire, ...S.auto.pipes].find(x => x.id === li.dataset.rule); if (r) r.name = t.value.trim() || r.name; save(); }
    else if (a === 'rdots') { const li = t.closest('[data-rule]'); const r = [...S.auto.fire, ...S.auto.pipes].find(x => x.id === li.dataset.rule); if (r) { r.noDots = t.checked; pathCache.delete(r.id); RT.A.hl = RT.B.hl = null; save(); renderAuto(); dirty(); } }
    else if (a === 'diam') { S.auto.diam = t.checked; save(); }
    else if (a === 'catMode') { S.auto.catMode = t.value; save(); }
    else if (a === 'showDiam') { S.showDiam = t.checked; save(); dirty(); }
    else if (a === 'show') { S.auto.show = t.checked; save(); dirty(); }
    else if (a === 'lintels') { S.auto.lintels = t.checked; RT.A.hl = null; save(); dirty(); setTimeout(renderAuto, 50); }
  });
}
