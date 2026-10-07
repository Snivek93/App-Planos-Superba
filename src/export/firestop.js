/* Excel para Firestop Suite (hoja CALCULADORA) y escritor .zip/.xlsx sin librerías. */
import { esc, ST } from '../core/constants.js';
import { P, S } from '../core/state.js';
import { pushUndo } from '../core/undo.js';
import { sealsSorted } from '../panels/sellos.js';
import { baseName, saveFile } from './files.js';
import { save } from '../core/storage.js';
import { ask, changed, toast } from '../ui/app.js';
import { joinY, locOf, sealLevels } from '../core/levels.js';
import { curSheet, projectSeals, scopeSheets, secLabel, sheetsOf, withState } from '../project/model.js';

/* ---------- Excel para Firestop Suite (formato hoja CALCULADORA) ---------- */
export const FS_OPTS_L = ["Tubería Metal","Tubería Metal Aislado","Tubería Cobre Aislado HVAC","Tubería EMT","Tubería Combustible (PVC, CPVC, PEX, PP-R)","Tubería Combustible Aislada (PVC, CPVC, PEX, PP-R)","Bandeja de Cables","Cable Armado","Cables en Paso Repenetrable","Cables Sueltos","Caja Electromecánica UL","Ducto Rectangular","Ducto Rectangular Aislado","Ducto Redondo","Ducto Redondo Aislado","Pasante Múltiple","Vacío","Viga W","Viga Canal","Viga Tubo Rectangular"];

export const FS_OPTS_N = ["Concreto","Panel de Yeso"];

export const FS_OPTS_O = ["1 Hora","2 Horas"];

export const FS_OPTS_P = ["Pasta FS ONE MAX","Cinta con Collar Metálico CP 648-E/ER","Putty Pad CP 617","Espuma CP 620","Almohadilla CFS-BL","Manga CP 653 4\"","Paso de cables MSL M 3\"x4\"","Paso de cables MSL L 6\"x4\"","Cinta sin Collar Metálico CP 648-E","Collarín CP 643N/644","Mortero CP 637","Sellador CP 606","Sellador CFS SIL GG"];

export const FS_K = {"Tubería Metal":"Tubería","Tubería Metal Aislado":"Tubería Aislada","Tubería Cobre Aislado HVAC":"Tubería Aislada","Tubería EMT":"Tubería","Tubería Combustible (PVC, CPVC, PEX, PP-R)":"Tubería","Tubería Combustible Aislada (PVC, CPVC, PEX, PP-R)":"Tubería Aislada","Bandeja de Cables":"Bandeja","Cable Armado":"Cable","Cables en Paso Repenetrable":"Cable","Cables Sueltos":"Cable","Caja Electromecánica UL":"Caja Electromecánica UL","Ducto Rectangular":"Ducto Rectangular","Ducto Rectangular Aislado":"Ducto Rectangular","Ducto Redondo":"Ducto Redondo","Ducto Redondo Aislado":"Ducto Redondo","Pasante Múltiple":"Múltiple","Vacío":"Vacío","Viga W":"Viga","Viga Canal":"Viga","Viga Tubo Rectangular":"Viga"};

export const MM_TO_IN = {13:0.5, 16:0.5, 19:0.75, 20:0.75, 25:1, 32:1.25, 38:1.5, 40:1.5, 50:2, 60:2, 63:2.5, 64:2.5, 75:3, 100:4, 110:4, 125:5, 150:6, 160:6, 200:8, 250:10, 300:12};

export function diamToIn(txt) {
  if (!txt) return '';
  const s = String(txt).replace(',', '.');
  let m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) { const whole = s.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/); return whole ? +whole[1] + whole[2]/whole[3] : m[1]/m[2]; }
  m = s.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (m) { const mm = +m[1]; return MM_TO_IN[Math.round(mm)] ?? Math.round(mm/25.4*100)/100; }
  m = s.match(/(\d+(?:\.\d+)?)\s*("|”|in|pulg)/i);
  if (m) return +m[1];
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) { const v = +m[1]; return v > 8 ? (MM_TO_IN[Math.round(v)] ?? Math.round(v/25.4*100)/100) : v; }
  return '';
}

export function guessL(txt) {
  if (/cobre|hvac|refrig/i.test(txt)) return "Tubería Cobre Aislado HVAC";
  if (/emt|conduit|el[eé]ctr/i.test(txt)) return "Tubería EMT";
  if (/hierro|acero|metal|\bhg\b|galv/i.test(txt)) return "Tubería Metal";
  if (/ducto/i.test(txt)) return "Ducto Redondo";
  if (/bandeja/i.test(txt)) return "Bandeja de Cables";
  if (/cable/i.test(txt)) return "Cables Sueltos";
  return "Tubería Combustible (PVC, CPVC, PEX, PP-R)";
}

export function guessP(L, D) {
  if (/Combustible/.test(L) && +D > 2) return "Collarín CP 643N/644";
  if (/Cobre/.test(L)) return "Cinta con Collar Metálico CP 648-E/ER";
  return "Pasta FS ONE MAX";
}

export function fsSel(name, opts, val) { return `<select data-f="${name}">${opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`; }

export const FS_AISL = /Aislad/;

export function fsGeomKind(L) {
  if (L === 'Caja Electromecánica UL') return 'caja';
  if (L === 'Vacío') return 'vacio';
  if (/Bandeja|Rectangular|Pasante|Viga/.test(L)) return 'rect';
  return 'round';
}

export function fsNeedsJ(L) { return /Bandeja|Pasante/.test(L); }

export function fsGeomCell(c, L) {
  const inp = (f, v, ph, w = 58) => `<label class="gi" data-g="${f}"><span>${ph}</span><input data-f="${f}" value="${v ?? ''}" inputmode="decimal" style="width:${w}px"></label>`;
  return `<div class="geom">${inp('D', c.D, 'Ø (in)')}${inp('F', c.F, 'A (cm)')}${inp('G', c.G, 'B (cm)')}${inp('H', c.H, 'Prof. (cm)')}${inp('E', c.E ?? 0, 'Aislam. (in)')}${inp('J', c.J ?? '', '% ocup.', 50)}</div>`;
}

export function fsSyncGeom(tr) {
  const L = tr.querySelector('[data-f=L]').value, k = fsGeomKind(L);
  const show = {D: k === 'round' || k === 'vacio', F: k !== 'round', G: k !== 'round', H: k === 'caja', E: FS_AISL.test(L), J: fsNeedsJ(L)};
  tr.querySelectorAll('.gi').forEach(el => el.hidden = !show[el.dataset.g]);
}

export async function fsDialog() {
  const seals = projectSeals('all');
  if (!seals.length) return toast('Todavía no hay sellos para exportar.');
  const cfg = S.fsx || (S.fsx = {walls:{}, losa:{N:'Concreto', O:'2 Horas'}, cats:{}});
  const wallNames = [...new Set(seals.filter(m => locOf(m) === 'pared').map(m => m.wall || '(sin tipo de pared)'))];
  const wallRows = wallNames.map(w => {
    const c = cfg.walls[w] || {N: /concreto|estructural|muro/i.test(w) ? 'Concreto' : 'Panel de Yeso', O: /\b1\s*h|1\s*hora/i.test(w) ? '1 Hora' : '2 Horas'};
    return `<tr data-wall="${esc(w)}"><td>${esc(w)}</td><td>${fsSel('N', FS_OPTS_N, c.N)}</td><td>${fsSel('O', FS_OPTS_O, c.O)}</td></tr>`;
  }).join('');
  // una fila por categoría y ubicación (pared / losa)
  const groups = [];
  for (const m of seals) {
    let g = groups.find(x => x.st === m.st && x.loc === locOf(m));
    if (!g) { g = {st:m.st, loc:locOf(m), list:[]}; groups.push(g); }
    g.list.push(m);
  }
  groups.sort((a, b) => S.sealTypes.findIndex(t => t.id === a.st) - S.sealTypes.findIndex(t => t.id === b.st) || a.loc.localeCompare(b.loc));
  const rowsHtml = groups.map((g, gi) => {
    const t = ST[g.st], sysTxt = [...new Set(g.list.map(m => m.sys).filter(Boolean))].join(', ');
    const dTxt = g.list.find(m => m.diam)?.diam || t.name;
    const c = {...(cfg.cats[g.st] || {})};
    if (c.D == null) c.D = diamToIn(dTxt);
    const L = c.L || guessL(t.name + ' ' + sysTxt), P = c.P || guessP(L, c.D);
    return `<tr data-g="${gi}"><td><span class="ldot" style="--c:${t.color}"></span> <b>${esc(t.name)}</b> <span class="muted">(${g.list.length})</span>${sysTxt ? `<div class="small muted">${esc(sysTxt)}</div>` : ''}</td>
      <td>${fsSel('L', FS_OPTS_L, L)}</td>
      <td>${fsGeomCell(c, L)}</td>
      <td><input data-f="I" value="${c.I ?? 0}" inputmode="decimal" style="width:56px"></td>
      <td><select data-f="M"><option value="pared"${g.loc === 'pared' ? ' selected' : ''}>Pared</option><option value="losa"${g.loc === 'losa' ? ' selected' : ''}>Losa</option></select></td>
      <td>${fsSel('P', FS_OPTS_P, P)}</td></tr>`;
  }).join('');
  const cs = curSheet();
  const scopeHtml = `<label class="row"><span>Qué exportar</span><select id="fsScope"><option value="all">Todo el proyecto</option>${cs ? `<option value="cur">Solo este plano: ${esc(cs.name)}</option>` : ''}${P.sections.filter(s => sheetsOf(s.id).length).map(s => `<option value="sec:${s.id}">Solo ${esc(s.name)}</option>`).join('')}</select></label>`;
  const html = scopeHtml + `<p class="muted small" style="margin:0">Excel con el formato de la hoja CALCULADORA (datos desde la fila 23), listo para "Importar Excel" en Firestop Suite. Una fila por nivel, barrera, tipo de sello y tipo de pared. Los valores quedan guardados para la próxima vez.</p>
    <div class="fsbox"><b>Penetrantes</b><table class="fst"><tr><th>Categoría</th><th>Tipo de penetrante</th><th>Geometría</th><th>Espacio anular (in)</th><th>Barrera</th><th>Material Hilti</th></tr>${rowsHtml}</table></div>
    <div class="fsbox"><b>Paredes</b><table class="fst"><tr><th>Tipo de pared</th><th>Material de barrera</th><th>F Rating</th></tr>${wallRows || '<tr><td colspan="3" class="muted">No hay sellos en pared.</td></tr>'}</table></div>
    <div class="fsbox"><b>Losa</b><table class="fst"><tr data-losa="1"><td>Entrepiso</td><td>${fsSel('N', FS_OPTS_N, cfg.losa.N)}</td><td>${fsSel('O', FS_OPTS_O, cfg.losa.O)}</td></tr></table></div>`;
  const num = x => { const t = String(x ?? '').trim().replace(',', '.'); if (!t) return ''; const f = t.match(/^(\d+)\s+(\d+)\/(\d+)$/) || t.match(/^(\d+)\/(\d+)$/); if (f) return f.length === 4 ? +f[1] + f[2]/f[3] : f[1]/f[2]; const n = parseFloat(t); return isNaN(n) ? '' : n; };
  const v = await ask({title:'Excel para Firestop Suite', html, wide:true, buttons:[{label:'Cancelar', value:null}, {label:'Descargar Excel', value:'ok', primary:true}],
    setup: r => {
      r.querySelectorAll('tr[data-g]').forEach(tr => { fsSyncGeom(tr); tr.querySelector('[data-f=L]').onchange = () => fsSyncGeom(tr); });
    },
    read: r => {
      const out = {walls:{}, losa:{...cfg.losa}, cats:{}, moves:[], scope: r.querySelector('#fsScope').value};
      r.querySelectorAll('tr[data-wall]').forEach(tr => out.walls[tr.dataset.wall] = {N: tr.querySelector('[data-f=N]').value, O: tr.querySelector('[data-f=O]').value});
      const lt = r.querySelector('tr[data-losa]'); if (lt) out.losa = {N: lt.querySelector('[data-f=N]').value, O: lt.querySelector('[data-f=O]').value};
      r.querySelectorAll('tr[data-g]').forEach(tr => {
        const g = groups[+tr.dataset.g], q = f => tr.querySelector(`[data-f=${f}]`);
        const L = q('L').value, k = fsGeomKind(L);
        const c = {L, P:q('P').value, I:num(q('I').value) || 0, D:num(q('D').value), F:num(q('F').value), G:num(q('G').value), H:num(q('H').value),
          E: FS_AISL.test(L) ? (num(q('E').value) || 0) : 0, J: fsNeedsJ(L) ? num(q('J').value) : ''};
        if (k === 'round') { c.F = ''; c.G = ''; c.H = ''; }
        if (k === 'rect') { c.D = ''; c.H = ''; }
        if (k === 'caja') c.D = '';
        out.cats[g.st] = {...(out.cats[g.st] || {}), ...c};
        if (q('M').value !== g.loc) out.moves.push([g, q('M').value]);
      });
      return out;
    }});
  if (!v) return;
  if (v.moves.length) { pushUndo(); for (const [g, loc] of v.moves) g.list.forEach(m => m.loc = loc); changed(); }
  S.fsx = {walls:{...cfg.walls, ...v.walls}, losa:v.losa, cats:{...cfg.cats, ...v.cats}}; save();
  exportFS(S.fsx, v.scope);
}

export function fsRows(cfg, sh) {
  const map = new Map();
  for (const m of sealsSorted()) {
    const {lv: levels, f, below} = sealLevels(m);
    const loc = locOf(m), wall = loc === 'pared' ? (m.wall || '(sin tipo de pared)') : '';
    for (const lv of levels) {
      const mem = !!m.mem, key = [lv, loc, m.st, wall, mem].join('\u0001');
      const r = map.get(key) || {lv, loc, st:m.st, wall, mem, n:0, planta: f ? f.name : '', auto:0, below};
      r.n++; if (m.auto) r.auto++; map.set(key, r);
    }
  }
  const rows = [...map.values()].sort((a, b) => String(a.lv).localeCompare(String(b.lv), 'es', {numeric:true}) || a.loc.localeCompare(b.loc) || String(a.wall).localeCompare(String(b.wall)));
  return rows.map(r => {
    const t = ST[r.st], c = cfg.cats[r.st] || {}, w = r.loc === 'losa' ? cfg.losa : (cfg.walls[r.wall] || {N:'Panel de Yeso', O:'2 Horas'});
    const L = c.L || guessL(t.name), D = c.D ?? '';
    const zona = (r.loc === 'losa' ? `${t.name} · Losa` : `${t.name} · ${r.wall}`) + (r.mem ? ' · Membrana' : '');
    const nota = [sh ? `${secLabel(sh)} · ${sh.name}` : '', r.mem ? 'penetración de membrana (atraviesa una sola cara)' : '', r.planta ? `Planta ${r.planta}` : '', r.below ? 'tubería bajo losa (pared del nivel inferior)' : '', r.auto ? `${r.auto} detectado${r.auto === 1 ? '' : 's'} en planos` : ''].filter(Boolean).join(' · ');
    const nivel = /^-?\d+(\.\d+)?$/.test(r.lv) ? +r.lv : r.lv;
    const nb = x => x === '' || x == null ? undefined : +x;
    const J = c.J === '' || c.J == null ? 0 : (+c.J > 1 ? +c.J/100 : +c.J);
    return [zona, nivel, r.n, nb(D), c.E === '' || c.E == null ? 0 : +c.E, nb(c.F), nb(c.G), nb(c.H),
      c.I === '' || c.I == null ? 0 : +c.I, J, FS_K[L] || '', L, r.loc === 'losa' ? 'Entrepiso' : 'Pared', w.N, w.O, c.P || guessP(L, D), undefined, nota];
  });
}

// --- escritor mínimo de .xlsx (sin librerías externas) ---
export let CRC_T;

export function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function zipStore(files, type) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + d.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {type: type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export function xlsxBlob(sheetName, aoa, widths, boldRows) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1)/26); } return s; };
  let rows = '';
  aoa.forEach((row, ri) => {
    if (!row || !row.length) return;
    let cells = '';
    row.forEach((v, ci) => {
      if (v === undefined || v === null || v === '') return;
      const ref = col(ci) + (ri + 1), st = boldRows && boldRows.includes(ri) ? ' s="1"' : '';
      if (typeof v === 'number' && isFinite(v)) cells += `<c r="${ref}"${st}><v>${v}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    });
    rows += `<row r="${ri + 1}">${cells}</row>`;
  });
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet]
  ]);
}

export function exportFS(cfg, scope = 'all') {
  const HEADERS = ["Zona o Descripción", "Nivel", "Cantidad Penetrantes\n(und)", "Diámetro \nTubería o Cable\n(in)", "Espesor del Aislamiento \n(in)",
    "Dimensión A\n(cm)", "Dimensión B\n(cm)", "Profundidad \nCajas Electricas\n(cm)", "Espacio Anular\n(in)", "Porcentaje de Ocupación (%)",
    "Tipo de penetrante", "Tipo de Penetrante", "Tipo de Barrera", "Material de Barrera", "F Rating", "Material Cortafuego Hilti", "NORMATIVA\nSistemas UL 1479", "Nota"];
  const sheets = scopeSheets(scope);
  const rows = [];
  for (const sh of sheets) rows.push(...withState(sh.state, () => fsRows(cfg, sh)));
  const lvKey = v => typeof v === 'number' ? v : (parseFloat(v) || 1e9);
  rows.sort((a, b) => lvKey(a[1]) - lvKey(b[1]) || String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0]), 'es', {numeric:true}));
  if (!rows.length) return toast('No hay sellos en lo que eligió exportar.');
  const levels = [...new Set(rows.map(r => r[1]).filter(v => v !== '' && v != null))];
  const aoa = [];
  for (let i = 0; i < 21; i++) aoa.push([]);
  aoa[0] = ['Exportado desde Superposición de planos (sellos cortafuego)'];
  aoa[0] = [`${P ? P.name : 'Proyecto'} · exportado desde Superposición de planos (sellos cortafuego)`];
  aoa[1] = [`Generado: ${new Date().toLocaleDateString('es-CR')} · ${sheets.length} ${sheets.length === 1 ? 'plano' : 'planos'}${levels.length ? ` · Niveles: ${joinY(levels.map(String))}` : ''}`];
  aoa[2] = [`${rows.length} filas · ${rows.reduce((a, r) => a + r[2], 0)} sellos`];
  aoa.push(HEADERS);
  for (const r of rows) aoa.push(r);
  const blob = xlsxBlob('CALCULADORA', aoa, [26, 9, 10, 10, 10, 10, 10, 10, 10, 10, 18, 40, 12, 16, 10, 34, 18, 34], [21]);
  saveFile(baseName() + '-firestop-suite.xlsx', blob, blob.type);
  toast(`Excel listo: ${rows.length} filas. En Firestop Suite use "Importar Excel".`);
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
}
