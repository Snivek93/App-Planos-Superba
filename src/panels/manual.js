/* Partidas manuales: sellos que se cuentan sin marcarlos con un punto en el plano (por ejemplo la lista de
   tubos por losa de un PDF). Se guardan en el plano (S.manual) y entran en los resúmenes, el CSV, la
   cuantificación por nivel y el Excel para Firestop Suite. En la tabla del plano solo si se activa. */
import { catMeasure, esc, ST } from '../core/constants.js';
import { S, uid } from '../core/state.js';
import { pushUndo } from '../core/undo.js';
import { joinY, LOC_NAME, parseLevels } from '../core/levels.js';
import { ask, changed, toast } from '../ui/app.js';
import { catForName } from '../detect/cross.js';
import { diamToIn } from '../export/firestop.js';
import { sealsSorted } from './sellos.js';

export function manualList(st) { const s = st || S; return Array.isArray(s.manual) ? s.manual : (s.manual = []); }

/* niveles de la partida: "6", "7-9", "-1, -2"… */
export function manualLevels(e) { const l = parseLevels(e.lv || ''); return l.length ? l : ['Sin nivel']; }

/* cada partida se ve como un "sello" con cantidad (q) para los mismos cálculos que los sellos del plano */
export function manualMarks(st) {
  return manualList(st).filter(e => (+e.q || 0) > 0).map((e, i) => ({
    type:'seal', man:true, src:e, id:'man-' + e.id, n:'M' + (i + 1), st:e.st, loc:e.loc === 'pared' ? 'pared' : 'losa',
    wall:e.loc === 'pared' ? (e.wall || '') : '', mem:!!e.mem, note:e.note || '', sys:'', auto:false, q:+e.q,
    diam: catMeasure(ST[e.st]?.name) || e.diam || '', lvs: manualLevels(e)}));
}

/* sellos del plano + partidas manuales */
export function allSeals() { return sealsSorted().concat(manualMarks()); }

/* ---------- panel ---------- */
export function manualHtml() {
  const list = manualList();
  const opt = (v, cur, txt) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(txt)}</option>`;
  const rows = list.map(e => `<tr data-man="${e.id}">
      <td><input data-mf="lv" value="${esc(e.lv || '')}" placeholder="6 o 7-9" aria-label="Nivel(es)" style="width:72px"></td>
      <td><select data-mf="loc" aria-label="Ubicación">${opt('losa', e.loc === 'pared' ? 'pared' : 'losa', 'Losa')}${opt('pared', e.loc === 'pared' ? 'pared' : 'losa', 'Pared')}</select>
        ${e.loc === 'pared' ? `<input data-mf="wall" value="${esc(e.wall || '')}" placeholder="Tipo de pared" aria-label="Tipo de pared" style="width:120px">` : ''}</td>
      <td><select data-mf="st" aria-label="Categoría">${S.sealTypes.map(t => opt(t.id, e.st, t.name)).join('')}</select></td>
      <td><input data-mf="q" value="${esc(e.q ?? '')}" inputmode="numeric" aria-label="Cantidad por nivel" style="width:56px"></td>
      <td><input data-mf="note" value="${esc(e.note || '')}" placeholder="Origen o nota" aria-label="Nota"></td>
      <td><button class="icon" data-act="manDel" title="Borrar partida" aria-label="Borrar partida">✕</button></td></tr>`).join('');
  const ms = manualMarks(), tot = ms.reduce((a, m) => a + m.q*m.lvs.length, 0);
  return `<div class="sect" id="manSect"><header><h3>Partidas manuales</h3><span class="btnrow" style="margin:0"><button class="btn" data-act="manPaste">Pegar tabla</button><button class="btn" data-act="manAdd">Agregar</button></span></header>
    <p class="help" style="margin-top:4px">Sellos que se cuentan sin marcarlos en el plano, por ejemplo la lista de tubos por losa de un PDF. Entran en el resumen, el CSV y el Excel para Firestop Suite. La cantidad es por nivel: "7-9" con 5 cuenta 15.</p>
    ${list.length ? `<div class="mantbl"><table class="fst"><tr><th>Nivel(es)</th><th>Ubicación</th><th>Categoría</th><th>Cant.</th><th>Nota</th><th></th></tr>${rows}</table></div>
      <p class="small muted" style="margin:6px 0 0">${list.length} ${list.length === 1 ? 'partida' : 'partidas'} · <b>${tot}</b> ${tot === 1 ? 'sello' : 'sellos'} en total${dupWarn(ms)}</p>` : ''}</div>`;
}

/* aviso: hay sellos del plano y partidas manuales de la misma categoría y ubicación (posible doble conteo) */
function dupWarn(ms) {
  const marked = sealsSorted(), seen = [];
  for (const m of ms) {
    if (marked.some(x => x.st === m.st && (x.loc === 'losa' ? 'losa' : 'pared') === m.loc)) { const k = ST[m.st]?.name + ' · ' + LOC_NAME[m.loc]; if (!seen.includes(k)) seen.push(k); }
  }
  return seen.length ? `<br><span style="color:#A66A00">Revise que no se cuente dos veces: también hay sellos marcados en el plano de ${esc(joinY(seen.slice(0, 4)))}${seen.length > 4 ? '…' : ''}.</span>` : '';
}

export function addManual() {
  pushUndo();
  const st = S.sealTypes.some(t => t.id === S.sealType) ? S.sealType : (S.sealTypes[0] || {}).id;
  manualList().push({id: 'm' + uid(), lv:'', loc:'losa', wall:'', st, q:1, note:''});
  changed();
}

export function manualEdit(id, f, v) {
  const e = manualList().find(x => x.id === id); if (!e) return;
  pushUndo();
  if (f === 'q') { const n = Math.round(parseFloat(String(v).replace(',', '.'))); e.q = isNaN(n) || n < 0 ? 0 : n; }
  else e[f] = String(v).trim();
  if (f === 'loc' && v !== 'pared') e.wall = '';
  changed();
}

export function manualDel(id) {
  const l = manualList(), i = l.findIndex(x => x.id === id); if (i < 0) return;
  pushUndo(); l.splice(i, 1); changed();
}

/* ---------- pegar tabla ----------
   1) La de "Tubos eléctricos por losa" (Copiar como tabla): Tabla, Losa, ø19, ø25 … ø100, Total, Nota, Revisado.
   2) Una lista simple: Nivel, Categoría, Cantidad[, Pared o Losa][, Nota]. */
const LV_NAMES = {'sótano':'-2', 'sotano':'-2', 'semisótano':'-1', 'semisotano':'-1', 'semi sótano':'-1', 'semi sotano':'-1'};
function lvFrom(txt) {
  const t = String(txt || '').trim(), low = t.toLowerCase();
  if (LV_NAMES[low]) return LV_NAMES[low];
  const m = t.match(/^n(?:ivel)?\s*(-?\d+(?:\.\d+)?)$/i); if (m) return m[1];
  return t;
}
export function parseManualPaste(txt) {
  const lines = String(txt || '').split(/\r?\n/).map(l => l.split('\t').map(c => c.trim())).filter(r => r.some(Boolean));
  if (!lines.length) return [];
  const head = lines[0], low = head.map(h => h.toLowerCase());
  const out = [];
  const dcol = low.map((h, i) => [i, h.match(/^[øØ⌀]\s*(\d+(?:[.,]\d+)?)/)]).filter(([, m]) => m);
  if (dcol.length) {
    // formato de "Tubos eléctricos por losa"
    const iLosa = low.findIndex(h => /^losa|^nivel/.test(h)), iTab = low.findIndex(h => /^tabla/.test(h)), iNota = low.findIndex(h => /^nota/.test(h));
    for (const r of lines.slice(1)) {
      if (iLosa < 0 || !r[iLosa]) continue;
      for (const [i, m] of dcol) {
        const q = Math.round(parseFloat((r[i] || '').replace(',', '.'))); if (!(q > 0)) continue;
        out.push({lv: lvFrom(r[iLosa]), loc:'losa', wall:'', cat:`ø${m[1].replace(',', '.')} mm`, q, emt:true,
          note: [iTab >= 0 && r[iTab] ? 'Tubos por losa · ' + r[iTab] : 'Tubos por losa', iNota >= 0 ? r[iNota] : ''].filter(Boolean).join(' · ')});
      }
    }
    return out;
  }
  const hasHead = low.some(h => /nivel|categor|cantidad/.test(h));
  for (const r of hasHead ? lines.slice(1) : lines) {
    if (r.length < 3) continue;
    const q = Math.round(parseFloat((r[2] || '').replace(',', '.'))); if (!(q > 0) || !r[1]) continue;
    const loc = /pared/i.test(r[3] || '') ? 'pared' : 'losa';
    out.push({lv: lvFrom(r[0]), loc, wall:'', cat:r[1], q, note: r[4] || ''});
  }
  return out;
}

export async function pasteManual() {
  let parsed = [];
  const v = await ask({title:'Pegar tabla de partidas', wide:true, html:`<p class="muted small" style="margin:0">Pegue aquí la tabla copiada de "Tubos eléctricos por losa" (botón Copiar como tabla), o una lista de Excel con las columnas <b>Nivel · Categoría · Cantidad</b> y, si quiere, <b>Pared o Losa · Nota</b>. Cada diámetro pasa a su categoría (ø50 mm, ø63 mm…); si no existe, se crea. Sótano se toma como nivel -2 y Semisótano como -1; puede corregirlos después.</p>
      <textarea id="manTxt" rows="9" style="width:100%;font:12px ui-monospace,Menlo,monospace" placeholder="Pegue aquí (Ctrl+V)"></textarea>
      <p class="small" id="manPrev" style="margin:4px 0 0"></p>`,
    buttons:[{label:'Cancelar', value:null}, {label:'Agregar partidas', value:'ok', primary:true}],
    setup: r => { const ta = r.querySelector('#manTxt'), pv = r.querySelector('#manPrev');
      ta.oninput = () => { parsed = parseManualPaste(ta.value); const t = parsed.reduce((a, e) => a + e.q*Math.max(1, parseLevels(e.lv).length), 0);
        pv.textContent = ta.value.trim() ? (parsed.length ? `${parsed.length} partidas, ${t} sellos.` : 'No se reconocieron filas. Revise que las columnas estén separadas por tabulación (copiadas de Excel o de la página).') : ''; };
      setTimeout(() => ta.focus(), 30); },
    read: r => parseManualPaste(r.querySelector('#manTxt').value)});
  if (!v) return;
  if (!v.length) return toast('No se reconocieron filas para agregar.');
  pushUndo();
  const list = manualList();
  for (const e of v) {
    const st = catForName(e.cat);
    // tubos eléctricos de la tabla de losas: si la categoría aún no tiene tipo de penetrante, queda como Tubería EMT
    if (e.emt) { if (!S.fsx) S.fsx = {walls:{}, losa:{N:'Concreto', O:'2 Horas'}, cats:{}}; const c = S.fsx.cats[st] || (S.fsx.cats[st] = {}); if (!c.L) { c.L = 'Tubería EMT'; if (c.D == null || c.D === '') c.D = diamToIn(e.cat); } }
    list.push({id: 'm' + uid(), lv:e.lv, loc:e.loc, wall:e.wall, st, q:e.q, note:e.note});
  }
  changed();
  const t = v.reduce((a, e) => a + e.q*Math.max(1, parseLevels(e.lv).length), 0);
  toast(`${v.length} ${v.length === 1 ? 'partida agregada' : 'partidas agregadas'} (${t} sellos).`);
}
