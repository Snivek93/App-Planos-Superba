/* Pestaña Sellos: resumen, lista, categorías, numeración y cruces. */
import { $, esc, nextCatColor, PEND, ST, txtOn } from '../core/constants.js';
import { ICON } from '../ui/icons.js';
import { L, MK, P, RT, S, sel, tool, uid, undoStack, view } from '../core/state.js';
import { baseW, dist, rectPts, segInter, toLocal, toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { sealFloor } from '../canvas/tables.js';
import { renderOpts, setTool } from '../editor/tools.js';
import { placeSeal } from '../editor/pointer.js';
import { centerOn } from '../canvas/view.js';
import { pushUndo } from '../core/undo.js';
import { renderLayers } from './capas.js';
import { exportCSV } from '../export/files.js';
import { pdfDialog } from '../export/pdf.js';
import { save } from '../core/storage.js';
import { ask, changed, closePanel, renderTop, toast } from '../ui/app.js';
import { exportQuant, floorLevels, floorMult, joinY, LOC_NAME, locOf, sealWeight } from '../core/levels.js';
import { catPropsDialog, catSummary } from '../export/penetrante.js';
import { fsDialog } from '../export/firestop.js';
import { floorById, frameOf } from '../plans/floors.js';
import { diamLabel, ensureLabels } from '../detect/vector.js';
import { catForName } from '../detect/cross.js';
import { catKey, curSheet, secById, subById, withState } from '../project/model.js';
/* nombre del juego de planos (subsección o sección) */
function setName(sh) { if (!sh) return ''; if (sh.kind === 'arq') return 'los arquitectónicos'; const s = secById(sh.sec), u = sh.sub ? subById(sh.sec, sh.sub) : null; return (s ? s.name : '') + (u ? ' › ' + u.name : ''); }

/* ---------- panel: sellos ---------- */
export function sealsSorted() { return S.marks.filter(m => m.type === 'seal').sort((a, b) => a.n - b.n); }

export function updateCounts() {
  const n = S.marks.filter(m => m.type === 'seal').length;
  $('#countNum').textContent = n; $('#countTxt').textContent = n === 1 ? 'sello' : 'sellos'; $('#tabN').textContent = n;
}

export function sealGroups(seals) {
  // devuelve [[clave, nombre, sellos]] en el orden de las plantas
  const g = new Map(S.floors.map(f => [f.id, []])); g.set('_none', []);
  for (const m of seals) { const f = sealFloor(m); g.get(f ? f.id : '_none').push(m); }
  const out = S.floors.map(f => [f.id, f.name, g.get(f.id)]);
  if (g.get('_none').length) out.push(['_none', 'Fuera de las plantas', g.get('_none')]);
  return out;
}

export function typeChips(list, wfn) {
  const w = wfn || (() => 1);
  const byType = S.sealTypes.map(t => [t, list.filter(x => x.st === t.id).reduce((a, x) => a + w(x), 0)]).filter(([, c]) => c > 0);
  return byType.length ? byType.map(([t, c]) => `<span><i class="ldot" style="--c:${t.color}"></i>${esc(t.name)} <b>${c}</b></span>`).join('') : '<span class="muted">Sin sellos.</span>';
}

/* El diámetro del sello (etiqueta junto al círculo, Excel, CSV) sigue a su categoría cuando la categoría
   es un diámetro: si se cambia de "ø13 mm" a "ø19 mm", la etiqueta también. */
const isDiamName = n => /^[øØ⌀]\s*\d/.test(String(n || '').trim());
export function setSealDiam(m, v) {
  const old = m.diam; m.diam = v;
  if (m.note && old && m.note.startsWith(old)) m.note = v + m.note.slice(old.length);
  else if (m.note && m.note.startsWith('ø sin rótulo')) m.note = v + m.note.slice('ø sin rótulo'.length);
}
export function setSealCat(m, st) {
  m.st = st;
  const n = ST[st]?.name;
  if (isDiamName(n) && m.diam !== n.trim()) setSealDiam(m, n.trim());
  m.review = m.review && !isDiamName(n) ? m.review : false;
}
/* Sello puesto a mano (o por cruces de capas): si no tiene diámetro, se toma del rótulo de la tubería más
   cercano en el plano B (ø13 mm, Ø 100…), igual que en la detección automática. */
export async function autoDiam(m, w, quiet) {
  try {
    if (!m || m.diam || !RT.B || !RT.B.isPdf || !RT.B.bmp || S.auto.diam === false) return;
    const labels = await ensureLabels('B'), lp = toLocal(S.plans.B, w);
    let best = 110, d = null;
    for (const lb of labels) { const dd = Math.hypot(lb.x - lp[0], lb.y - lp[1]); if (dd < best) { best = dd; d = lb.d; } }
    if (!d || m.diam || !S.marks.includes(m)) return;
    setSealDiam(m, d);
    if (S.auto.catMode === 'diam' && m.st === 'pend') m.st = catForName(d);
    if (!quiet) { save(); renderSeals(); renderOpts(); dirty(); }
    return true;
  } catch (e) { /* sin texto legible en el PDF: queda sin diámetro */ }
}
/* Al abrir un plano: solo se completa la etiqueta de los sellos que NO tienen diámetro y cuya categoría
   es un diámetro. Nunca se cambia una etiqueta ni una categoría ya puestas (pueden ser correcciones a mano). */
export async function syncSealDiams() {
  let ch = 0;
  for (const m of S.marks) {
    if (m.type !== 'seal' || m.diam) continue;
    const n = (ST[m.st]?.name || '').trim();
    if (isDiamName(n)) { setSealDiam(m, n); ch++; }
  }
  if (ch) { save(); renderSeals(); dirty(); }
}
/* Botón: a los sellos sin diámetro se les busca el rótulo de la tubería más cercano (no toca los que ya tienen). */
export async function fillMissingDiams() {
  const sin = S.marks.filter(m => m.type === 'seal' && !m.diam);
  if (!sin.length) return toast('Todos los sellos ya tienen diámetro.');
  if (!RT.B || !RT.B.isPdf) return toast('El plano B no tiene texto legible para buscar diámetros.');
  pushUndo();
  const S0 = S; let n = 0;
  for (const m of sin) if (await autoDiam(m, toWorld(frameOf(m), m.pts[0]), true)) n++;
  if (S !== S0) return;
  if (n) { save(); renderSeals(); renderOpts(); dirty(); }
  toast(n ? `${n} ${n === 1 ? 'sello' : 'sellos'} con diámetro agregado.` : 'No se encontraron rótulos cerca de los sellos sin diámetro.');
}
/* al renombrar una categoría de diámetro, los sellos que llevaban ese diámetro se actualizan en todo el proyecto */
function renameDiamCat(id, oldName, newName) {
  if (!isDiamName(oldName) || !isDiamName(newName) || oldName.trim() === newName.trim()) return;
  for (const sh of Object.values(P.sheets)) for (const m of sh.state.marks) if (m.type === 'seal' && m.st === id && (!m.diam || m.diam === oldName.trim())) setSealDiam(m, newName.trim());
}

export function sealRow(m) {
  const t = ST[m.st] || ST.otro;
  return `<li data-id="${m.id}" class="${sel.has(m.id) ? 'on' : ''}"><button class="sn" style="--c:${t.color};color:${txtOn(t.color)}" data-act="goto" title="Ver en el plano">${m.n}</button>
      <select data-act="st" aria-label="Tipo del sello ${m.n}">${S.sealTypes.map(x => `<option value="${x.id}"${x.id === m.st ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <input data-act="diam" value="${esc(m.diam || '')}" placeholder="ø" aria-label="Diámetro del sello ${m.n}" title="Diámetro">
      ${m.auto ? '<span class="auto" title="Detectado automáticamente">auto</span>' : ''}
      <input data-act="note" value="${esc(m.note)}" placeholder="Nota: material, observaciones…" aria-label="Nota del sello ${m.n}">
      <select data-act="loc" aria-label="Ubicación del sello ${m.n}">${['pared', 'losa'].map(v => `<option value="${v}"${locOf(m) === v ? ' selected' : ''}>${LOC_NAME[v]}</option>`).join('')}</select>
      <label class="chk small mem" title="Penetración de membrana: la tubería atraviesa una sola cara"><input type="checkbox" data-act="mem"${m.mem ? ' checked' : ''}> Membrana</label></li>`;
}

export function renderSeals() {
  const all = sealsSorted();
  const hasF = S.floors.length > 0;
  const groups = hasF ? sealGroups(all) : null;
  if (!hasF || (S.sealFilter && !groups.some(g => g[0] === S.sealFilter))) S.sealFilter = '';
  const filt = S.sealFilter;
  const seals = filt ? groups.find(g => g[0] === filt)[2] : all;
  const scopeName = filt ? groups.find(g => g[0] === filt)[1] : '';
  let h = '';
  if (hasF) h += `<div class="field" style="grid-template-columns:70px 1fr;margin-top:0"><label>Planta</label><select data-act="sfilter">
      <option value="">Todas las plantas (${all.length})</option>
      ${groups.map(([id, name, l]) => `<option value="${id}"${filt === id ? ' selected' : ''}>${esc(name)} (${l.length})</option>`).join('')}</select></div>`;
  const tot = seals.reduce((a, m) => a + sealWeight(m), 0);
  const fSel = filt && filt !== '_none' ? floorById(filt) : null, fm = fSel ? floorMult(fSel) : 1;
  const nP = seals.filter(m => locOf(m) === 'pared').reduce((a, m) => a + sealWeight(m), 0), nL = tot - nP;
  h += `<div class="sum"><div class="big">${tot}</div><div><h3>${tot === 1 ? 'Sello' : 'Sellos'} para cuantificar${scopeName ? ` en ${esc(scopeName)}` : ''}</h3>
      <div class="small muted">${tot !== seals.length ? `${seals.length} marcados en el plano${fSel && fm > 1 ? ` × ${fm} niveles (${esc(joinY(floorLevels(fSel)))})` : ', con plantas típicas multiplicadas'} · ` : ''}Pared ${nP} · Losa ${nL}</div></div>
    <div class="typesum">${seals.length ? typeChips(seals, sealWeight) : '<span class="muted">Aún no hay sellos.</span>'}</div></div>`;
  if (hasF && !filt && all.length) h += `<div class="floorsum">${groups.map(([id, name, l]) => { const fl = floorById(id), mu = floorMult(fl);
    return `<button class="fsum" data-act="sfilterSet" data-v="${id}"><span class="fname">${esc(name)}</span><b>${mu > 1 ? `${l.length} × ${mu} = ${l.length*mu}` : l.length}</b>${fl ? `<span class="lv">${mu === 1 ? 'Nivel' : 'Niveles'} ${esc(joinY(floorLevels(fl)))}</span>` : ''}<span class="typesum">${typeChips(l)}</span></button>`; }).join('')}</div>`;
  const pendD = S.marks.filter(m => m.type === 'seal' && m.st === 'pend' && m.diam).length;
  if (pendD) h += `<p class="help" style="margin:8px 0 0">${pendD} ${pendD === 1 ? 'sello está' : 'sellos están'} en "Por definir" aunque ${pendD === 1 ? 'tiene' : 'tienen'} diámetro (por ejemplo porque se borró su categoría). <button class="linkbtn" data-act="pendDiam">Asignar categoría por diámetro</button></p>`;
  const sinD = S.marks.filter(m => m.type === 'seal' && !m.diam).length;
  if (sinD && RT.B && RT.B.isPdf) h += `<p class="help" style="margin:8px 0 0">${sinD} ${sinD === 1 ? 'sello no tiene' : 'sellos no tienen'} diámetro. <button class="linkbtn" data-act="fillDiam">Buscar diámetro en el plano B</button> (no cambia los que ya tienen).</p>`;
  h += `<div class="btnrow"><button class="btn red" data-act="detect">Detectar cruces</button><button class="btn" data-act="renum">Renumerar</button><button class="btn" data-act="csv">Exportar CSV</button><button class="btn primary" data-act="fss">Excel para Firestop Suite</button></div>
    <p class="help">Detectar cruces busca dónde un trazo de una capa de Instalaciones cruza una línea de una capa de Pared cortafuego, y pone ahí un sello del tipo configurado en esa capa.</p>
    <div class="field" style="grid-template-columns:150px 1fr auto;margin-top:12px"><label>Opacidad de los sellos</label><input type="range" min="0.2" max="1" step="0.05" value="${S.sealAlpha ?? 0.7}" data-act="sealAlpha" aria-label="Opacidad de los sellos"><output>${Math.round((S.sealAlpha ?? 0.7)*100)} %</output></div>
    <div class="sect"><header><h3>Tabla en el plano</h3></header>
      <p class="help" style="margin-top:4px">Agrega al plano una tabla con la leyenda de colores y la cantidad de sellos por categoría. Se actualiza sola.${hasF ? ' Si la pone dentro de una planta, cuenta solo los sellos de esa planta.' : ''}</p>
      <div class="btnrow"><button class="btn primary" data-act="table">Insertar tabla</button><button class="btn" data-act="pdf">Descargar PDF</button></div></div>
    <div class="sect"><header><h3>Categorías</h3><button class="btn" data-act="addCat">Nueva</button></header>
      <p class="help" style="margin-top:4px">Por ejemplo PVC 150 mm, PVC 100 mm, EMT 25 mm. Cada una con su color. ${curSheet() ? `Son de <b>${esc(setName(curSheet()))}</b>: las comparten los planos de ese juego; los otros juegos tienen las suyas.` : ''}${filt ? ' Las cantidades son de la planta elegida.' : ''}</p>
      <ul class="cats">${S.sealTypes.map(t => {
        const c = seals.filter(x => x.st === t.id).length;
        return `<li data-cat="${t.id}"><input type="color" data-act="catColor" value="${t.color}" aria-label="Color de ${esc(t.name)}">
          <input data-act="catName" value="${esc(t.name)}" aria-label="Nombre de la categoría">
          <span class="cnt" title="Sellos">${c}</span>
          <button class="icon" data-act="catProps" title="Tipo de penetrante, geometría y espacio anular" aria-label="Datos de ${esc(t.name)}">${ICON.more}</button>
          ${t.id === 'pend' ? '<span></span>' : `<button class="icon" data-act="catDel" title="Eliminar categoría" aria-label="Eliminar ${esc(t.name)}">${ICON.trash}</button>`}
          <button class="catsum${catSummary(t) ? '' : ' empty'}" data-act="catProps">${esc(catSummary(t) || 'Definir tipo de penetrante, geometría y espacio anular')}</button></li>`;
      }).join('')}</ul></div>`;
  if (seals.length) {
    h += `<div class="sect"><header><h3>Lista de sellos</h3></header></div>`;
    if (hasF && !filt) h += groups.filter(g => g[2].length).map(([id, name, l]) => `<h4 class="grph">${esc(name)} <span>${l.length}</span></h4><ul class="sealList">${l.map(sealRow).join('')}</ul>`).join('');
    else h += `<ul class="sealList">${seals.map(sealRow).join('')}</ul>`;
  }
  $('#tab-sellos').innerHTML = h;
  updateCounts();
}

export function highlightSealRow() {
  document.querySelectorAll('.sealList li').forEach(li => li.classList.toggle('on', sel.has(li.dataset.id)));
}

export let ts;

export async function addCategory(selectIt) {
  const name = await ask({title:'Nueva categoría de sello', input:'', placeholder:'Por ejemplo: PVC 150 mm', ok:'Crear'});
  if (!name) return;
  pushUndo();
  const t = {id:'c' + uid(), name, color: nextCatColor()};
  const pi = S.sealTypes.findIndex(x => x.id === 'pend');
  pi >= 0 ? S.sealTypes.splice(pi, 0, t) : S.sealTypes.push(t);
  if (selectIt || tool === 'seal') S.sealType = t.id;
  changed(); toast(`Categoría "${name}" creada. Puede cambiarle el color en la pestaña Sellos.`);
}

export async function deleteCategory(id) {
  const t = S.sealTypes.find(x => x.id === id); if (!t || id === 'pend') return;
  // las categorías son del juego de planos (por ejemplo Mecánico › Agua potable): se cuentan los sellos de todos sus planos
  const cur = curSheet(), ck = catKey(cur);
  const uses = [];
  if (P) for (const sh of Object.values(P.sheets).filter(x => catKey(x) === ck)) {
    const st = sh === cur ? S : sh.state;
    const k = st.marks.filter(m => m.type === 'seal' && m.st === id).length;
    if (k) uses.push([sh === cur ? 'este plano' : sh.name, k]);
  } else { const k = S.marks.filter(m => m.type === 'seal' && m.st === id).length; if (k) uses.push(['este plano', k]); }
  const n = uses.reduce((a, [, k]) => a + k, 0);
  if (n) {
    const others = uses.filter(([nm]) => nm !== 'este plano');
    const list = uses.slice(0, 8).map(([nm, k]) => `<li>${esc(nm)}: <b>${k}</b></li>`).join('') + (uses.length > 8 ? `<li>y ${uses.length - 8} planos más</li>` : '');
    const ok = await ask({title:'Eliminar categoría', html:`<p>"${esc(t.name)}" es una categoría de ${esc(setName(cur))} y la usan <b>${n}</b> ${n === 1 ? 'sello' : 'sellos'}${others.length ? ', también en otros planos' : ''}:</p><ul>${list}</ul><p>Si la elimina, todos esos sellos pasan a "Por definir".</p>`, buttons:[{label:'Cancelar', value:false, primary:true}, {label:others.length ? 'Eliminar en todos esos planos' : 'Eliminar', value:true, danger:true}]});
    if (!ok) return;
  }
  pushUndo();
  if (!S.sealTypes.some(x => x.id === 'pend')) S.sealTypes.push({...PEND});
  const states = P ? [...new Set([S, ...Object.values(P.sheets).filter(x => catKey(x) === ck).map(x => x.state)])] : [S];
  for (const st of states) {
    st.marks.forEach(m => { if (m.type === 'seal' && m.st === id) m.st = 'pend'; if (m.type === 'table' && m.cats) m.cats = m.cats.filter(c => c !== id); });
    st.layers.forEach(l => { if (l.st === id) l.st = 'pend'; });
  }
  S.sealTypes = S.sealTypes.filter(x => x.id !== id);
  if (S.sealType === id) S.sealType = S.sealTypes[0].id;
  changed();
}

export function markSegsWorld(m, p) {
  if (m.type === 'text' || m.type === 'seal' || m.type === 'table') return [];
  const pts = (m.type === 'rect' ? rectPts(m) : m.pts).map(q => toWorld(p, q)), out = [];
  for (let i = 0; i < pts.length-1; i++) {
    const a = pts[i], b = pts[i+1];
    out.push({a, b, x0:Math.min(a[0], b[0]), x1:Math.max(a[0], b[0]), y0:Math.min(a[1], b[1]), y1:Math.max(a[1], b[1])});
  }
  return out;
}

export function detectCrossings() {
  const fire = [], other = [];
  for (const l of S.layers) {
    if (!l.visible) continue;
    for (const m of S.marks) {
      if (m.layer !== l.id) continue;
      const p = frameOf(m);
      if (l.kind === 'cortafuego') fire.push(...markSegsWorld(m, p));
      else if (l.kind === 'instalaciones' || l.kind === 'general') other.push(...markSegsWorld(m, p).map(s => (s.st = l.st || 'pend', s)));
    }
  }
  if (!fire.length) return toast('No hay paredes dibujadas. Trace las paredes cortafuego en una capa de uso "Pared cortafuego".');
  if (!other.length) return toast('No hay recorridos trazados. Trace los ductos o tuberías en una capa de uso "Instalaciones".');
  const existing = S.marks.filter(m => m.type === 'seal').map(m => toWorld(frameOf(m), m.pts[0]));
  const tol = Math.max(baseW()*5, 12/view.z);
  const before = undoStack.length; pushUndo();
  let n = 0;
  for (const f of fire) for (const o of other) {
    if (o.x1 < f.x0 || o.x0 > f.x1 || o.y1 < f.y0 || o.y0 > f.y1) continue;
    const q = segInter(f.a, f.b, o.a, o.b); if (!q) continue;
    if (existing.some(e => dist(e, q) < tol)) continue;
    autoDiam(placeSeal(q, o.st, true), q); existing.push(q); n++;
  }
  if (!n) { undoStack.length = before; renderTop(); toast('No se encontraron cruces nuevos.'); return; }
  changed(); toast(`Se agregaron ${n} ${n === 1 ? 'sello' : 'sellos'} en los cruces.`);
}

/* Numeración sin huecos: al borrar sellos, los que siguen se corren (por lámina o por planta). */
export function compactSealNumbers() {
  const seals = sealsSorted();
  if (!seals.length) { S.seq = 0; return false; }
  let moved = false;
  const fix = list => list.forEach((m, i) => { if (m.n !== i + 1) { m.n = i + 1; moved = true; } });
  if (S.numPerFloor && S.floors.length) for (const [, , l] of sealGroups(seals)) fix(l); else fix(seals);
  S.seq = Math.max(...seals.map(m => m.n));
  return moved;
}

export async function renumber() {
  const seals = sealsSorted(); if (!seals.length) return;
  let mode = 'all';
  if (S.floors.length) {
    mode = await ask({title:'Renumerar sellos', body:'¿Cómo quiere numerar?', buttons:[{label:'Cancelar', value:null}, {label:'Continuo en toda la lámina', value:'all'}, {label:'Desde 1 en cada planta', value:'floor', primary:true}]});
    if (!mode) return;
  }
  pushUndo();
  S.numPerFloor = mode === 'floor';
  if (mode === 'floor') { for (const [, , l] of sealGroups(seals)) l.forEach((m, i) => m.n = i + 1); S.seq = Math.max(...seals.map(m => m.n)); }
  else { seals.forEach((m, i) => m.n = i + 1); S.seq = seals.length; }
  changed(); toast(mode === 'floor' ? 'Sellos renumerados desde 1 en cada planta.' : 'Sellos renumerados del 1 al ' + seals.length + '.');
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  ts = $('#tab-sellos');
  ts.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const a = b.dataset.act;
    if (a === 'sfilterSet') { S.sealFilter = b.dataset.v; save(); renderSeals(); return; }
    if (a === 'pendDiam') {
      pushUndo(); let n = 0, np = 0;
      const cur = curSheet(), states = P ? [...new Set([S, ...Object.values(P.sheets).filter(sh => sh !== cur).map(sh => sh.state)])] : [S];
      for (const st of states) withState(st, () => { let k = 0; for (const m of st.marks) if (m.type === 'seal' && m.st === 'pend' && m.diam) { setSealCat(m, catForName(m.diam)); k++; } if (k) { n += k; np++; } });
      changed(); renderSeals(); toast(`${n} ${n === 1 ? 'sello asignado' : 'sellos asignados'} a la categoría de su diámetro${np > 1 ? ` en ${np} planos` : ''}.`); return;
    }
    if (a === 'fillDiam') { fillMissingDiams(); return; }
    if (a === 'detect') detectCrossings();
    else if (a === 'renum') renumber();
    else if (a === 'csv') exportCSV();
    else if (a === 'quant') exportQuant();
    else if (a === 'fss') fsDialog();
    else if (a === 'table') { closePanel(); setTool('table'); }
    else if (a === 'pdf') pdfDialog();
    else if (a === 'addCat') addCategory(false);
    else if (a === 'catDel') deleteCategory(b.closest('li').dataset.cat);
    else if (a === 'catProps') catPropsDialog(b.closest('li').dataset.cat);
    else if (a === 'goto') {
      const m = MK(b.closest('li').dataset.id); if (!m) return;
      const l = L(m.layer); if (!l.visible) { l.visible = true; renderLayers(); }
      setTool('select'); sel.clear(); sel.add(m.id); centerOn(toWorld(frameOf(m), m.pts[0])); renderOpts(); highlightSealRow(); closePanel();
    }
  });
  ts.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'sealAlpha') { S.sealAlpha = +t.value; t.nextElementSibling.textContent = Math.round(t.value*100) + ' %'; save(); dirty(); return; } if (t.dataset.act !== 'catColor') return;
    const c = S.sealTypes.find(x => x.id === t.closest('li').dataset.cat); if (c) { c.color = t.value; dirty(); }
  });
  ts.addEventListener('change', e => {
    if (e.target.dataset.act === 'sfilter') { S.sealFilter = e.target.value; save(); renderSeals(); return; }
    const t = e.target, li = t.closest('li'); if (!li) return;
    if (li.dataset.cat) {
      const c = S.sealTypes.find(x => x.id === li.dataset.cat); if (!c) return;
      if (t.dataset.act === 'catColor') c.color = t.value;
      if (t.dataset.act === 'catName') { const old = c.name; c.name = t.value.trim() || 'Sin nombre'; renameDiamCat(c.id, old, c.name); }
      save(); renderSeals(); renderOpts(); renderLayers(); dirty(); return;
    }
    const m = MK(li.dataset.id); if (!m) return;
    if (t.dataset.act === 'st') { pushUndo(); setSealCat(m, t.value); changed(); }
    else if (t.dataset.act === 'loc') { pushUndo(); m.loc = t.value; changed(); }
    else if (t.dataset.act === 'mem') { pushUndo(); if (t.checked) m.mem = true; else delete m.mem; changed(); }
    else if (t.dataset.act === 'note') { m.note = t.value; save(); }
    else if (t.dataset.act === 'diam') {
      let v = t.value.trim();
      if (v && !/^[øØ⌀]/.test(v)) v = 'ø' + v;
      const mt = v.match(/^[øØ⌀]\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(mm|"|”|pulg|in)?$/);
      if (mt) v = diamLabel(mt[1], mt[2]);
      pushUndo();
      setSealDiam(m, v);
      const cur = ST[m.st];
      if (v && (S.auto.catMode === 'diam') && (m.auto || /^ø/.test(cur.name) || m.st === 'pend')) m.st = catForName(v);
      m.review = false; changed();
    }
  });
}
