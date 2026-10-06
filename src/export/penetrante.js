/* Datos de penetrante por categoría (tipo, geometría, espacio anular). */
import { ST } from '../core/constants.js';
import { S } from '../core/state.js';
import { ask, changed } from '../ui/app.js';
import { diamToIn, FS_AISL, FS_OPTS_L, FS_OPTS_P, fsGeomCell, fsGeomKind, fsNeedsJ, fsSel, fsSyncGeom, guessL, guessP } from './firestop.js';

/* ---------- datos de penetrante por categoría (usados por la tabla del plano y por el Excel) ---------- */
export function catProps(id) { return (S.fsx && S.fsx.cats && S.fsx.cats[id]) || null; }

export function fracIn(v) {
  if (v === '' || v == null || isNaN(+v)) return '';
  v = +v; let whole = Math.floor(v + 1e-9); const rest = v - whole;
  let n = Math.round(rest*16), d = 16;
  if (n === 16) { whole++; n = 0; }
  if (n && Math.abs(rest - n/16) > 0.01) return `${Math.round(v*100)/100}"`;
  if (!n) return `${whole}"`;
  const g = gcd(n, d); n /= g; d /= g;
  return `${whole ? whole + ' ' : ''}${n}/${d}"`;
}

export function gcd(a, b) { return b ? gcd(b, a % b) : a; }

export function penShort(L) { return L ? L.replace(/\s*\(.*\)/, '').replace(/^Tubería /, 'Tubería ') : ''; }

export function geomLabel(t, c, sample) {
  if (!c) return sample && sample.diam ? sample.diam : '';
  const k = fsGeomKind(c.L || ''), cm = v => String(Math.round(+v*10)/10).replace('.', ',');
  let s = '';
  if ((k === 'round' || k === 'vacio') && c.D !== '' && c.D != null) s = `Ø ${fracIn(c.D)}`;
  else if (k === 'caja' && c.F && c.G) s = `${cm(c.F)}×${cm(c.G)}${c.H ? '×' + cm(c.H) : ''} cm`;
  else if ((k === 'rect' || k === 'vacio') && c.F && c.G) s = `${cm(c.F)}×${cm(c.G)} cm`;
  if (s && FS_AISL.test(c.L || '') && +c.E) s += ` + aisl. ${fracIn(c.E)}`;
  if (s && fsNeedsJ(c.L || '') && c.J !== '' && c.J != null) s += ` (${Math.round(+c.J > 1 ? +c.J : +c.J*100)} %)`;
  return s || (sample && sample.diam) || '';
}

export function anLabel(c) { return c && c.I !== '' && c.I != null && +c.I > 0 ? fracIn(c.I) : (c ? '0"' : ''); }

export function catSummary(t) {
  const c = catProps(t.id);
  if (!c || !c.L) return '';
  return [penShort(c.L), geomLabel(t, c), c.I != null ? `anular ${anLabel(c)}` : ''].filter(Boolean).join(' · ');
}

export async function catPropsDialog(id) {
  const t = ST[id]; if (!t) return;
  const ms = S.marks.filter(m => m.type === 'seal' && m.st === id);
  const sysTxt = [...new Set(ms.map(m => m.sys).filter(Boolean))].join(' ');
  const cur = {...(catProps(id) || {})};
  if (cur.D == null) cur.D = diamToIn(ms.find(m => m.diam)?.diam || t.name);
  const L = cur.L || guessL(t.name + ' ' + sysTxt), P = cur.P || guessP(L, cur.D);
  const html = `<p class="muted small" style="margin:0">Estos datos salen en la tabla del plano y se usan al exportar a Firestop Suite.</p>
    <div class="cprops" id="cpRow">
      <label class="row"><span>Tipo de penetrante</span>${fsSel('L', FS_OPTS_L, L)}</label>
      <div class="row"><span class="muted small">Geometría</span>${fsGeomCell(cur, L)}</div>
      <label class="row"><span>Espacio anular (in)</span><input data-f="I" value="${cur.I ?? 0}" inputmode="decimal" style="width:90px"></label>
      <label class="row"><span>Material Hilti (para Firestop Suite)</span>${fsSel('P', FS_OPTS_P, P)}</label>
    </div>`;
  const num = x => { const s = String(x ?? '').trim().replace(',', '.'); if (!s) return ''; const f = s.match(/^(\d+)\s+(\d+)\/(\d+)$/) || s.match(/^(\d+)\/(\d+)$/); if (f) return f.length === 4 ? +f[1] + f[2]/f[3] : f[1]/f[2]; const n = parseFloat(s); return isNaN(n) ? '' : n; };
  const v = await ask({title:`Datos de "${t.name}"`, html, buttons:[{label:'Cancelar', value:null}, {label:'Guardar', value:'ok', primary:true}],
    setup: r => { const row = r.querySelector('#cpRow'); fsSyncGeom(row); row.querySelector('[data-f=L]').onchange = () => fsSyncGeom(row); },
    read: r => {
      const q = f => r.querySelector(`#cpRow [data-f=${f}]`), Lv = q('L').value, k = fsGeomKind(Lv);
      const c = {L:Lv, P:q('P').value, I:num(q('I').value) || 0, D:num(q('D').value), F:num(q('F').value), G:num(q('G').value), H:num(q('H').value),
        E: FS_AISL.test(Lv) ? (num(q('E').value) || 0) : 0, J: fsNeedsJ(Lv) ? num(q('J').value) : ''};
      if (k === 'round') { c.F = ''; c.G = ''; c.H = ''; }
      if (k === 'rect') { c.D = ''; c.H = ''; }
      if (k === 'caja') c.D = '';
      return c;
    }});
  if (!v) return;
  if (!S.fsx) S.fsx = {walls:{}, losa:{N:'Concreto', O:'2 Horas'}, cats:{}};
  S.fsx.cats[id] = {...(S.fsx.cats[id] || {}), ...v};
  changed();
}
