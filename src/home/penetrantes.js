/* Tabla de penetrantes de todo el proyecto (resumen y detalle). */
import { $, esc, ST } from '../core/constants.js';
import { L, MK, P, sel } from '../core/state.js';
import { toWorld } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { renderOpts, setTool } from '../editor/tools.js';
import { centerOn } from '../canvas/view.js';
import { renderLayers } from '../panels/capas.js';
import { highlightSealRow, sealsSorted } from '../panels/sellos.js';
import { setTab } from '../ui/app.js';
import { LOC_NAME, locOf, sealLevels } from '../core/levels.js';
import { anLabel, catProps, geomLabel, penShort } from '../export/penetrante.js';
import { frameOf } from '../plans/floors.js';
import { orderedSheets, secLabel, withState } from '../project/model.js';
import { openSheet } from '../project/sheets.js';

/* --- tabla de penetrantes de todo el proyecto --- */
export let homeView = 'plans';
export let penF = {mode:'sum', sec:'', lv:'', loc:'', q:''};
export let penSort = {k:'lv', d:1};

export function natCmp(a, b) { return String(a ?? '').localeCompare(String(b ?? ''), 'es', {numeric:true, sensitivity:'base'}); }

export function lvSort(v) { return v === '' ? 1e9 : (/^-?\d+$/.test(v) ? +v : 1e8); }

export function penSeals() {
  const out = [];
  for (const sh of orderedSheets()) withState(sh.state, () => {
    for (const m of sealsSorted()) {
      const {lv, f, below} = sealLevels(m), t = ST[m.st], c = catProps(m.st), loc = locOf(m);
      out.push({sh, m, n:m.n, lv: lv.filter(x => x !== '').length ? lv : [''], planta: f ? f.name : '', below, loc, st:m.st, cat:t.name, color:t.color, hasProps: !!(c && c.L),
        pen: c && c.L ? penShort(c.L) : '', geom: geomLabel(t, c, m) || '', an: c ? anLabel(c) : '', wall: loc === 'pared' ? (m.wall || '') : '', diam: m.diam || '', note: m.note || '', auto: !!m.auto});
    }
  });
  return out;
}

export function penFiltered(all) {
  const q = penF.q.trim().toLowerCase();
  return all.filter(r => (!penF.sec || r.sh.sec === penF.sec) && (!penF.loc || r.loc === penF.loc) && (!penF.lv || r.lv.includes(penF.lv)) &&
    (!q || [r.cat, r.pen, r.geom, r.wall, r.diam, r.note, r.sh.name, secLabel(r.sh)].join(' ').toLowerCase().includes(q)));
}

export function lvTxt(v) { return v === '' ? 'Sin nivel' : (/^-?\d+$/.test(v) ? 'N' + v : v); }

export function penHtml() {
  const all = penSeals(), lvs = [...new Set(all.flatMap(r => r.lv))].sort((a, b) => lvSort(a) - lvSort(b) || natCmp(a, b));
  const secs = P.sections.filter(s => all.some(r => r.sh.sec === s.id));
  if (penF.lv && !lvs.includes(penF.lv)) penF.lv = '';
  return `<div class="pbar">
      <div class="seg" role="group" aria-label="Vista">${[['sum', 'Resumen'], ['det', 'Detalle por sello']].map(([v, t]) => `<button data-pa="pmode" data-v="${v}" class="${penF.mode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <select data-pf="sec" aria-label="Sección"><option value="">Todas las secciones</option>${secs.map(s => `<option value="${s.id}"${penF.sec === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select data-pf="lv" aria-label="Nivel"><option value="">Todos los niveles</option>${lvs.map(v => `<option value="${esc(v)}"${penF.lv === v ? ' selected' : ''}>${esc(lvTxt(v) === v ? v : 'Nivel ' + v)}</option>`).join('')}</select>
      <select data-pf="loc" aria-label="Barrera"><option value="">Pared y losa</option><option value="pared"${penF.loc === 'pared' ? ' selected' : ''}>Solo pared</option><option value="losa"${penF.loc === 'losa' ? ' selected' : ''}>Solo losa</option></select>
      <input type="search" data-pf="q" value="${esc(penF.q)}" placeholder="Buscar: PVC, 100 mm, plano…" aria-label="Buscar">
    </div><div id="penOut"></div>`;
}

export function renderPenTable() {
  const out = $('#penOut'); if (!out) return;
  const rows0 = penFiltered(penSeals());
  // cantidad por nivel (chips)
  const perLv = new Map();
  for (const r of rows0) for (const v of (penF.lv ? [penF.lv] : r.lv)) perLv.set(v, (perLv.get(v) || 0) + 1);
  const chips = [...perLv].sort((a, b) => lvSort(a[0]) - lvSort(b[0]) || natCmp(a[0], b[0])).map(([v, n]) => `<span class="hchip">${esc(lvTxt(v))} <b>${n}</b></span>`).join('');
  const catCell = r => `<button class="cat" data-pa="pcat" data-st="${r.st}" data-sh="${r.sh.id}" title="Editar tipo de penetrante, geometría y espacio anular de esta categoría"><span class="dot${r.loc === 'losa' ? ' sq' : ''}" style="--c:${r.color}"></span>${esc(r.cat)}</button>`;
  const penCell = r => r.hasProps ? esc(r.pen) : `<button class="linkbtn undef" data-pa="pcat" data-st="${r.st}" data-sh="${r.sh.id}">Definir…</button>`;
  let cols, rows;
  if (penF.mode === 'sum') {
    const map = new Map();
    for (const r of rows0) for (const v of (penF.lv ? [penF.lv] : r.lv)) {
      const key = [v, r.loc, r.st, r.wall].join('\u0001');
      const g = map.get(key) || {...r, lvOne:v, q:0, sheets:new Set(), below:false};
      g.q++; g.sheets.add(r.sh.name); if (r.below) g.below = true; map.set(key, g);
    }
    rows = [...map.values()];
    cols = [
      ['lv', 'Nivel', r => esc(lvTxt(r.lvOne)) + (r.below ? '<div class="sub">bajo losa</div>' : ''), (a, b) => lvSort(a.lvOne) - lvSort(b.lvOne) || natCmp(a.lvOne, b.lvOne) || natCmp(a.loc, b.loc), 'nw'],
      ['loc', 'Barrera', r => LOC_NAME[r.loc], (a, b) => natCmp(a.loc, b.loc), 'nw'],
      ['cat', 'Categoría', catCell, (a, b) => natCmp(a.cat, b.cat)],
      ['pen', 'Tipo de penetrante', penCell, (a, b) => natCmp(a.pen, b.pen)],
      ['geom', 'Geometría', r => esc(r.geom || '—'), (a, b) => natCmp(a.geom, b.geom)],
      ['an', 'Esp. anular', r => esc(r.an || '—'), (a, b) => natCmp(a.an, b.an)],
      ['wall', 'Tipo de pared', r => r.loc === 'losa' ? '<span class="sub">Entrepiso</span>' : esc(r.wall || '(sin tipo)'), (a, b) => natCmp(a.wall, b.wall)],
      ['sheets', 'Planos', r => `<div class="wrap sub">${esc([...r.sheets].join(', '))}</div>`, (a, b) => natCmp([...a.sheets][0], [...b.sheets][0])],
      ['q', 'Cantidad', r => r.q, (a, b) => a.q - b.q, 'num']];
  } else {
    rows = rows0.map(r => ({...r, q: penF.lv ? 1 : r.lv.length}));
    cols = [
      ['sheet', 'Plano', r => `${esc(r.sh.name)}<div class="sub">${esc(secLabel(r.sh))}</div>`, (a, b) => natCmp(a.sh.name, b.sh.name) || a.n - b.n],
      ['n', 'No.', r => r.n, (a, b) => a.n - b.n, 'num'],
      ['lv', 'Nivel(es)', r => esc(r.lv.map(lvTxt).join(', ')) + (r.below ? '<div class="sub">bajo losa</div>' : '') + (r.planta ? `<div class="sub">${esc(r.planta)}</div>` : ''), (a, b) => lvSort(a.lv[0]) - lvSort(b.lv[0]) || natCmp(a.lv[0], b.lv[0]), 'nw'],
      ['loc', 'Barrera', r => LOC_NAME[r.loc], (a, b) => natCmp(a.loc, b.loc), 'nw'],
      ['cat', 'Categoría', catCell, (a, b) => natCmp(a.cat, b.cat)],
      ['pen', 'Tipo de penetrante', penCell, (a, b) => natCmp(a.pen, b.pen)],
      ['geom', 'Geometría', r => esc(r.geom || '—'), (a, b) => natCmp(a.geom, b.geom)],
      ['an', 'Esp. anular', r => esc(r.an || '—'), (a, b) => natCmp(a.an, b.an)],
      ['wall', 'Tipo de pared', r => r.loc === 'losa' ? '<span class="sub">Entrepiso</span>' : esc(r.wall || '(sin tipo)'), (a, b) => natCmp(a.wall, b.wall)],
      ['note', 'Nota', r => `<div class="wrap sub">${esc(r.note)}${r.auto ? ' · auto' : ''}</div>`, (a, b) => natCmp(a.note, b.note)],
      ['q', 'Cant.', r => r.q, (a, b) => a.q - b.q, 'num']];
  }
  const col = cols.find(c => c[0] === penSort.k) || cols[0];
  rows.sort((a, b) => col[3](a, b) * penSort.d || (penF.mode === 'sum' ? lvSort(a.lvOne) - lvSort(b.lvOne) || natCmp(a.lvOne, b.lvOne) || natCmp(a.loc, b.loc) || natCmp(a.cat, b.cat) || natCmp(a.wall, b.wall) : natCmp(a.sh.name, b.sh.name) || a.n - b.n));
  const total = rows.reduce((a, r) => a + r.q, 0);
  const filtered = penF.sec || penF.lv || penF.loc || penF.q.trim();
  if (!rows.length) { out.innerHTML = `<div class="pwrap"><div class="pempty">${filtered ? 'Nada coincide con el filtro. <button class="linkbtn" data-pa="pclear">Quitar filtros</button>' : 'Todavía no hay sellos en el proyecto.'}</div></div>`; return; }
  out.innerHTML = `${chips ? `<div class="plv">${chips}</div>` : ''}<div class="pwrap"><table class="ptab"><thead><tr>${cols.map(c => `<th class="${c[4] || ''}" data-pa="psort" data-k="${c[0]}" title="Ordenar">${c[1]}${penSort.k === c[0] ? `<span class="ar">${penSort.d > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr${penF.mode === 'det' ? ` class="go" data-pa="pgo" data-sh="${r.sh.id}" data-m="${r.m.id}" title="Ver este sello en el plano"` : ''}>${cols.map(c => `<td class="${c[0] === 'q' ? 'q' : c[4] || ''}">${c[2](r)}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="${cols.length - 1}">Total${filtered ? ' (filtrado)' : ''} · ${rows.length} ${rows.length === 1 ? 'fila' : 'filas'}${filtered ? ` · <button class="linkbtn" data-pa="pclear">Quitar filtros</button>` : ''}</td><td class="q">${total}</td></tr></tfoot></table></div>
    <p class="hfoot">${penF.mode === 'sum' ? 'Una fila por nivel, barrera, categoría y tipo de pared, igual que en el Excel. Las plantas típicas cuentan una vez por cada nivel.' : 'Una fila por sello marcado. Toque una fila para ir al sello en su plano. "Cant." es cuántos niveles representa (plantas típicas).'} Toque una categoría para definir su tipo de penetrante, geometría y espacio anular.</p>`;
}

export async function goSeal(shId, mId) {
  await openSheet(shId);
  const m = MK(mId); if (!m) return;
  const l = L(m.layer); if (l && !l.visible) l.visible = true;
  setTool('select'); sel.clear(); sel.add(m.id); centerOn(toWorld(frameOf(m), m.pts[0])); setTab('sellos'); renderOpts(); highlightSealRow(); renderLayers(); dirty();
}

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const penetrantesVars = {
  get homeView() { return homeView; }, set homeView(v) { homeView = v; },
  get penSort() { return penSort; }, set penSort(v) { penSort = v; },
  get penF() { return penF; }, set penF(v) { penF = v; },
};
