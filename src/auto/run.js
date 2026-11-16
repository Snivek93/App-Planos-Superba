/* Modo automático: se entrega un juego de planos (arquitectónicos, eléctricos, mecánicos…) y la app
   los clasifica, los monta, los alinea por ejes, reconoce las tuberías y marca los sellos donde cruzan
   paredes cortafuego. Todo queda como planos normales del proyecto, para revisar y corregir.

   Pasos: 1) elegir archivos, carpeta o .zip  2) revisar la clasificación propuesta  3) cálculo por detrás,
   con avance y posibilidad de detenerlo (se puede continuar después)  4) informe por plano. */
import { $, esc } from '../core/constants.js';
import { P, S, uid } from '../core/state.js';
import { toLocal, toWorld } from '../core/geometry.js';
import { persistNow, save } from '../core/storage.js';
import { ask, toast } from '../ui/app.js';
import { arqState, catKey, homeOn, isPdfFile, normState, pid, secLabel, sheetsOf, showHome, stripExt, withState } from '../project/model.js';
import { storeFile } from '../project/files.js';
import { injectShared } from '../project/shared.js';
import { closeSheet, openSheet } from '../project/sheets.js';
import { unzip } from '../project/archive.js';
import { renderProject } from '../home/home.js';
import { trimInactive } from '../project/files.js';
import { resetPdfWorker } from '../plans/load.js';
import { placeSeal } from '../editor/pointer.js';
import { catForName } from '../detect/cross.js';
import { compactSealNumbers } from '../panels/sellos.js';
import { classify } from './classify.js';
import { readPage } from './page.js';
import { arqContext } from './walls.js';
import { solveSheet } from './solve.js';

const RELOAD_EVERY = 30;      // planos por tanda: después se recarga la página para soltar memoria y se sigue solo
let running = false, ingesting = false, stopAsked = false, doneThisLoad = 0;
let resumeSoon = false;
/* mientras haya un cálculo en marcha o a medias no se preparan vistas previas ni otras tareas por detrás */
export function autoBusy() { return running || ingesting || resumeSoon || !!(P && P.autoJob); }

/* ---------- 1) elegir archivos ---------- */
function pickFiles(dir) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    if (dir) inp.webkitdirectory = true; else inp.accept = '.pdf,.zip,application/pdf,application/zip';
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = () => { const fs = [...inp.files]; inp.remove(); res(fs); };
    inp.addEventListener('cancel', () => { inp.remove(); res([]); });
    inp.click();
  });
}
/* archivos sueltos, carpetas y .zip → [{file, path}] solo con los PDF */
async function expand(files) {
  const out = [];
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      try {
        const map = await unzip(new Uint8Array(await f.arrayBuffer()));
        if (map.has('proyecto.json')) { toast(`"${f.name}" es un proyecto guardado: ábralo con "Abrir proyecto guardado".`); continue; }
        for (const [name, data] of map) {
          if (!/\.pdf$/i.test(name) || /(^|\/)(\.|__MACOSX)/.test(name)) continue;
          out.push({file: new File([data], name.split('/').pop(), {type: 'application/pdf'}), path: stripExt(f.name) + '/' + name});
        }
      } catch (e) { toast(`No se pudo leer "${f.name}": ${e.message || e}`); }
    } else if (isPdfFile(f) && !/^\./.test(f.name)) out.push({file: f, path});
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, 'es', {numeric: true}));
}

export async function autoDialog() {
  if (running) return toast('Ya hay un cálculo automático en marcha.');
  const pend = pendingSheets(), done = Object.values(P.sheets).filter(s => s.kind === 'pair' && s.autoDone);
  const v = await ask({title: 'Calcular automáticamente', wide: true,
    html: `<p>Entregue el juego de planos en PDF (arquitectónicos, eléctricos, mecánicos, supresión) y la app:</p>
      <ol class="autosteps"><li>propone qué es cada archivo, por su carpeta y su nombre (usted lo revisa antes de seguir);</li>
      <li>monta cada plano de instalaciones sobre el arquitectónico de su nivel y lo alinea por los ejes;</li>
      <li>reconoce cuáles líneas son tubería y marca un sello donde cruzan una pared cortafuego;</li>
      <li>le deja un informe por plano con lo que encontró y lo que hay que revisar.</li></ol>
      <p class="muted small">Funciona con PDF vectoriales exportados desde CAD o Revit, donde la tubería está dibujada con líneas. El resultado es un borrador: revise cada plano, sobre todo los sellos con aro naranja punteado (dudosos) y los planos que el informe señale. Las paredes cortafuego se toman de las que ya marcó en el arquitectónico; si no hay, se buscan por la simbología del plano.</p>
      ${pend.length ? `<p class="small">Hay ${pend.length} ${pend.length === 1 ? 'plano de instalaciones ya cargado' : 'planos de instalaciones ya cargados'} sin sellos: también se pueden calcular sin subir nada.</p>` : ''}`,
    buttons: [{label: 'Cancelar', value: null}, ...(P.autoLog ? [{label: 'Ver último informe', value: 'log'}] : []), ...(done.length ? [{label: 'Recalcular', value: 'redo'}] : []), ...(pend.length ? [{label: 'Calcular los ya cargados', value: 'run'}] : []),
      {label: 'Elegir carpeta', value: 'dir'}, {label: 'Elegir PDF o .zip', value: 'files', primary: true}]});
  if (!v) return;
  if (v === 'log') return showReport();
  if (v === 'run') return startJob(pend.map(s => s.id));
  if (v === 'redo') {
    const ok = await ask({title: 'Recalcular', body: `Se vuelven a calcular ${done.length} ${done.length === 1 ? 'plano' : 'planos'} ya calculados automáticamente, con la alineación, las paredes y las líneas de tubería que tengan ahora (pestaña Detección de cada plano). Se quitan sus sellos automáticos y se ponen de nuevo: los sellos puestos a mano se conservan, pero si movió o cambió un sello automático, ese cambio se pierde.`,
      buttons: [{label: 'Cancelar', value: false}, {label: 'Recalcular', value: true, primary: true}]});
    return ok ? startJob(done.map(s => s.id).concat(pend.map(s => s.id))) : null;
  }
  const files = await pickFiles(v === 'dir');
  if (files.length) autoFromFiles(files);
}

/* ---------- 2) clasificar ---------- */
const SEC_RE = {ele: /el[eé]ctric/i, mec: /mec[aá]nic|plomer/i, inc: /incendio|supresi/i};
const SEC_NAME = {ele: 'Eléctrico', mec: 'Mecánico', inc: 'Supresión de incendios'};
function sectionFor(code) {
  let s = P.sections.find(x => x.kind !== 'arq' && SEC_RE[code] && SEC_RE[code].test(x.name));
  if (!s) { s = {id: pid('s'), name: SEC_NAME[code] || 'Instalaciones', subs: []}; P.sections.push(s); }
  return s;
}
function subFor(sec, name, c) {
  name = String(name || '').trim(); if (!name) return null;
  let u = sec.subs.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
  if (!u) { u = {id: pid('u'), name, below: !!c.below}; sec.subs.push(u); }
  if (c.duct) u.duct = true;
  return u;
}

export async function autoFromFiles(files) {
  if (running) return toast('Ya hay un cálculo automático en marcha.');
  toast('Leyendo los archivos…');
  const list = await expand(files);
  if (!list.length) return toast('No encontré archivos PDF. El cálculo automático necesita los planos en PDF.');
  for (const it of list) it.c = classify(it.path);
  const secs = P.sections.filter(s => s.kind !== 'arq');
  const destOf = c => c.kind === 'arq' ? 'arq' : c.kind === 'skip' ? 'skip' : (secs.find(s => SEC_RE[c.sec] && SEC_RE[c.sec].test(s.name))?.id || 'new:' + c.sec);
  const opts = sel => [['arq', 'Arquitectónico'], ...secs.map(s => [s.id, s.name]), ...Object.keys(SEC_NAME).filter(k => !secs.some(s => SEC_RE[k].test(s.name))).map(k => ['new:' + k, SEC_NAME[k]]), ['skip', 'No usar']]
    .map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const folderOf = p => p.split('/').slice(0, -1).join(' / ') || 'Archivos sueltos';
  let html = `<p class="muted small" style="margin:0 0 8px">Revise la propuesta. "Tipo" dice dónde va cada archivo; la subsección agrupa los planos de un mismo sistema (cada una lleva sus propias categorías de sello); el nivel decide sobre cuál arquitectónico se monta. Los detalles, diagramas y tablas van en "No usar". Con la fila gris de cada carpeta se cambia toda la carpeta.</p><div class="autotbl"><table><thead><tr><th>Archivo</th><th>Tipo</th><th>Subsección</th><th>Nivel</th></tr></thead><tbody>`;
  let last = null;
  list.forEach((it, i) => {
    const f = folderOf(it.path);
    if (f !== last) { last = f; html += `<tr class="grp" data-g="${esc(f)}"><td>${esc(f)}</td><td><select data-ga>${'<option value="">(cambiar todos)</option>' + opts('')}</select></td><td><input data-gs placeholder="(cambiar todos)"></td><td></td></tr>`; }
    html += `<tr data-i="${i}" data-g="${esc(f)}"><td title="${esc(it.path)}">${esc(stripExt(it.file.name))}${it.c.why ? `<span class="muted small"> · ${esc(it.c.why)}</span>` : ''}</td><td><select data-a>${opts(destOf(it.c))}</select></td><td><input data-s value="${esc(it.c.kind === 'ins' ? it.c.sub : '')}"></td><td><input data-l value="${esc(it.c.level)}" size="4"></td></tr>`;
  });
  html += '</tbody></table></div>';
  const v = await ask({title: `Juego de planos: ${list.length} ${list.length === 1 ? 'archivo' : 'archivos'}`, html, wide: true,
    setup: r => {
      r.querySelectorAll('tr.grp').forEach(g => {
        const rows = () => [...r.querySelectorAll('tr[data-i]')].filter(x => x.dataset.g === g.dataset.g);
        g.querySelector('[data-ga]').onchange = e => { if (e.target.value) rows().forEach(x => x.querySelector('[data-a]').value = e.target.value); };
        g.querySelector('[data-gs]').oninput = e => rows().forEach(x => x.querySelector('[data-s]').value = e.target.value);
      });
    },
    buttons: [{label: 'Cancelar', value: null}, {label: 'Montar y calcular', value: 'ok', primary: true}],
    read: r => [...r.querySelectorAll('tr[data-i]')].map(x => ({i: +x.dataset.i, a: x.querySelector('[data-a]').value, s: x.querySelector('[data-s]').value.trim(), l: x.querySelector('[data-l]').value.trim().toUpperCase()}))});
  if (!v) return;
  // montar: primero los arquitectónicos, luego los planos de instalaciones
  const ids = []; let nArq = 0, t = Date.now();
  ingesting = true;
  try {
  for (const row of v) {
    const it = list[row.i]; if (row.a !== 'arq') continue;
    toast(`Guardando ${it.file.name}…`);
    const fid = await storeFile(it.file, it.file.name), id = pid('h');
    P.sheets[id] = {id, kind: 'arq', name: stripExt(it.file.name), sec: 'arq', sub: null, state: arqState(fid, 1), order: t++};
    if (row.l) P.sheets[id].lv = row.l;
    nArq++;
  }
  for (const row of v) {
    const it = list[row.i]; if (row.a === 'arq' || row.a === 'skip') continue;
    toast(`Guardando ${it.file.name}…`);
    const sec = row.a.startsWith('new:') ? sectionFor(row.a.slice(4)) : P.sections.find(s => s.id === row.a) || sectionFor(it.c.sec);
    const sub = subFor(sec, row.s, it.c);
    const fid = await storeFile(it.file, it.file.name), id = pid('h'), st = normState(null);
    st.plans.B.fileId = fid; st.plans.B.page = 1; st.below = !!(sub && sub.below);
    P.sheets[id] = {id, kind: 'pair', name: stripExt(it.file.name), sec: sec.id, sub: sub ? sub.id : null, aSheet: null, aLevels: [], state: st, order: t++, initB: true};
    if (row.l) P.sheets[id].lv = row.l;
    ids.push(id);
  }
  } finally { ingesting = false; }
  if (ids.length && sheetsOf('arq').length) ingesting = true;   // sigue el cálculo: que no arranquen las vistas previas
  await persistNow(); renderProject(); ingesting = false;
  if (!ids.length) return toast(nArq ? `${nArq} ${nArq === 1 ? 'arquitectónico agregado' : 'arquitectónicos agregados'}. No había planos de instalaciones para calcular.` : 'No se agregó ningún plano.');
  if (!sheetsOf('arq').length) return toast('Los planos quedaron montados, pero falta el arquitectónico: agréguelo y vuelva a "Automático".');
  startJob(ids);
}

/* planos de instalaciones ya cargados sin ningún sello */
function pendingSheets() {
  return Object.values(P.sheets).filter(s => s.kind === 'pair' && s.state.plans.B.fileId && !s.state.marks.some(m => m.type === 'seal') && !(s.state.manual || []).length);
}

/* ---------- 3) cálculo ---------- */
const lvNum = lv => { const m = String(lv || '').match(/^([NS])(\d+)$/); return m ? (m[1] === 'S' ? -(+m[2]) : +m[2]) : null; };
/* arquitectónico de un plano: el que ya tiene; si no, el de su nivel (o el del nivel de abajo si la tubería va bajo losa) */
function arqFor(sh) {
  if (sh.aSheet && P.sheets[sh.aSheet]) return P.sheets[sh.aSheet];
  const arqs = sheetsOf('arq'); if (!arqs.length) return null;
  if (arqs.length === 1 && !sh.lv) return arqs[0];
  let want = sh.lv || '';
  if (sh.state.below && lvNum(want) != null) { const n = lvNum(want) - 1 || -1; want = n > 0 ? 'N' + n : 'S' + (-n); }
  const hit = arqs.filter(a => (a.lv || '') === want && want);
  if (hit.length) return hit.find(a => (a.state.auto.fire || []).some(r => r.on)) || hit[0];
  return arqs.length === 1 && !sh.state.below ? arqs[0] : null;
}

export function startJob(ids) {
  P.autoJob = {v: 1, ids, total: ids.length, rows: [], at: Date.now()};
  save(); runJob();
}
export function resumeJob() { if (P.autoJob && !P.autoJob.done) runJob(); }
export function discardJob() { if (P.autoJob) { P.autoLog = {at: Date.now(), rows: P.autoJob.rows, partial: true}; delete P.autoJob; save(); renderProject(); hideBar(); } }

async function runJob() {
  if (running) return;
  const job = P.autoJob; if (!job) return;
  running = true; stopAsked = false;
  if (!homeOn) showHome();
  // por arquitectónico, para armar sus paredes una sola vez
  const todo = job.ids.map(id => P.sheets[id]).filter(Boolean);
  const groups = new Map();
  for (const sh of todo) { const a = arqFor(sh); const k = a ? a.id : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sh); }
  const total = job.total || job.ids.length; let n = total - job.ids.length;
  const seen = new Map();   // sellos ya puestos por juego de planos y arquitectónico (láminas por sectores que se traslapan)
  for (const sh of Object.values(P.sheets)) if (sh.kind === 'pair' && job.rows.some(r => r.id === sh.id)) regSeals(seen, sh);
  try {
    for (const [aid, shs] of groups) {
      if (stopAsked) break;
      let ctx = null, ctxErr = '';
      if (!aid) ctxErr = '';   // se explica por plano, abajo
      else {
        bar(n, total, `Leyendo paredes de ${P.sheets[aid].name}…`);
        try { ctx = await arqContext(P.sheets[aid]); if (!ctx) ctxErr = `No encontré paredes cortafuego en "${P.sheets[aid].name}": ábralo, márquelas en Detección y vuelva a "Automático"`; }
        catch (e) { console.warn(e); ctxErr = `No se pudo leer el arquitectónico "${P.sheets[aid].name}": ${e.message || e}`; }
        if (P.active) closeSheet();
        trimInactive();
      }
      for (const sh of shs) {
        if (stopAsked) break;
        bar(n, total, sh.name);
        await new Promise(r => setTimeout(r, 20));
        let row = {id: sh.id, name: sh.name, sec: secLabel(sh), arq: aid ? P.sheets[aid].name : ''};
        if (!aid) row.err = sh.state.below ? `Tubería bajo losa${sh.lv ? ' del nivel ' + sh.lv : ''}: se revisa contra las paredes del nivel de abajo y no hay arquitectónico de ese nivel` : sh.lv ? `No hay arquitectónico del nivel ${sh.lv}: agréguelo o elija el plano A a mano` : 'No pude saber de qué nivel es por el nombre: elija su plano A (opciones del plano) y vuelva a "Automático"';
        else if (ctxErr) row.err = ctxErr;
        else {
          try {
            // si la lectura de un PDF se queda pegada, se salta ese plano y se sigue con los demás
            const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('La lectura del PDF tardó demasiado: se saltó. Vuelva a "Automático" para intentarlo de nuevo')), 120000));
            Object.assign(row, await Promise.race([solveOne(sh, P.sheets[aid], ctx, seen, t => bar(n, total, sh.name + ' · ' + t)), slow]));
          } catch (e) {
            console.warn(e); row.err = e.message || String(e);
            if (/tardó demasiado/.test(row.err)) { try { resetPdfWorker(); } catch (_) {} }   // el lector quedó pegado: se reinicia
          }
        }
        job.rows = job.rows.filter(r => r.id !== sh.id).concat(row);
        // el orden de trabajo es por arquitectónico: se guarda lo que falta, no un índice
        job.ids = job.ids.filter(id => id !== sh.id); n++; doneThisLoad++;
        await persistNow();
        if (doneThisLoad >= RELOAD_EVERY && job.ids.length && !stopAsked) {
          try { sessionStorage.setItem('cf-auto-resume', '1'); } catch (e) {}
          bar(n, total, 'Liberando memoria…'); location.reload(); return;
        }
      }
      ctx = null;
    }
  } finally { running = false; }
  if (job.ids.length && stopAsked) { bar(n, total, 'Detenido', true); renderProject(); return; }
  P.autoLog = {at: Date.now(), rows: job.rows}; delete P.autoJob;
  await persistNow(); hideBar(); renderProject(); showReport();
}

function regSeals(seen, sh) {
  const k = catKey(sh) + '|' + (sh.aSheet || '');
  if (!seen.has(k)) seen.set(k, []);
  for (const m of sh.state.marks) if (m.type === 'seal' && m.auto && m.aj && !m.fl) seen.get(k).push(m.pts[0]);
}

const NOTE = {full: '', bend: 'dobla en la pared', end: 'termina en la pared (equipo en la pared o penetración tipo membrana): verificar', stub: 'llega hasta la pared: verificar si la atraviesa', box: 'el rótulo del circuito está sobre la pared: verificar por dónde sale'};
async function solveOne(sh, arq, ctx, seen, step = () => {}) {
  const st = sh.state, sub = sh.sub ? P.sections.find(s => s.id === sh.sec)?.subs.find(u => u.id === sh.sub) : null;
  if (st.floors.length) return {err: 'Tiene plantas definidas (lámina con varias plantas): se calcula desde el plano, en Detección'};
  const B = await readPage(st.plans.B.fileId, st.plans.B.page || 1, step);
  if (!B.vectorial) return {err: 'El PDF no trae líneas (es una imagen escaneada): se marca a mano'};
  const duct = !!(sub && (sub.duct || /ducto|extracci|ventilaci|inyecci/i.test(sub.name)));
  // alineación hecha antes (a mano o por una corrida anterior): se respeta
  const A = arq.state.plans.A, Bp = st.plans.B, opt = {duct};
  if (!sh.initB && Bp.w && sh.aSheet === arq.id) { const q = toLocal(A, [Bp.x, Bp.y]); opt.tr = {s: Bp.s/A.s, x: q[0], y: q[1], r: (Bp.r || 0) - (A.r || 0)}; }
  // estilos de tubería elegidos a mano en Detección: se usan esos
  // (también al recalcular: valen las que estén activas, sean las que eligió el cálculo anterior o las que cambió usted)
  const rules = (st.auto.pipes || []).filter(r => r.plan === 'B');
  const own = rules.some(r => !r.auto) || (sh.autoDone && rules.length) ? rules.filter(r => r.on).map(r => r.key) : [];
  if (own.length) opt.keys = own;
  step('buscando cruces'); await new Promise(r => setTimeout(r, 0));
  const res = solveSheet(ctx, B, opt);
  if (!res.ok) { sh.aSheet = sh.aSheet || arq.id; return {err: res.why + '. Alinéelo con "2 puntos" en Planos y vuelva a "Automático"'}; }
  const sys = sub ? sub.name : P.sections.find(s => s.id === sh.sec)?.name || 'Tubería';
  const key = catKey(sh) + '|' + arq.id; if (!seen.has(key)) seen.set(key, []);
  const prev = seen.get(key), u = ctx.u;
  let added = 0, review = 0, noD = 0, dups = 0;
  sh.aSheet = arq.id;
  withState(st, () => {
    injectShared(sh);
    const pa = S.plans.A, pb = S.plans.B;
    if (!opt.tr) {
      const w = toWorld(pa, [res.tr.x, res.tr.y]);
      Object.assign(pb, {w: B.w, h: B.h, pages: B.pages, page: pb.page || 1, name: P.files[pb.fileId]?.name || pb.name, x: w[0], y: w[1], s: pa.s*res.tr.s, r: pa.r || 0});
      delete sh.initB;
    }
    S.marks = S.marks.filter(m => !(m.type === 'seal' && m.auto && m.aj));
    const mine = S.marks.filter(m => m.type === 'seal' && !m.fl).map(m => m.pts[0]);
    if (!opt.keys) S.auto.pipes = res.styles.filter(s => s.pick && s.key !== 'ann').map(s => ({id: 'r' + uid(), plan: 'B', key: s.key, kind: s.key[0], color: s.key.slice(1, 8), w: s.key[0] === 's' ? +s.key.split('/')[1] : 0, name: sys, on: true, auto: true}));
    for (const c of res.cross) {
      const near = l => l.some(p => Math.hypot(p[0] - c.x, p[1] - c.y) < 3*u);
      if (near(mine)) continue;
      if (near(prev)) { dups++; continue; }
      let d = '', far = 110;
      for (const lb of B.labels) { const dd = Math.hypot(lb.x - c.bx, lb.y - c.by); if (dd < far) { far = dd; d = lb.d; } }
      const fromNote = !d && !!B.defDiam; if (fromNote) d = B.defDiam;
      const rev = c.kind === 'end' || c.kind === 'stub' || c.kind === 'box' || c.corner;
      const m = placeSeal(toWorld(pa, [c.x, c.y]), duct ? catForName('Ducto (medida por definir)') : d ? catForName(d) : 'pend', true);
      const wall = ctx.wallName(c.wall);
      Object.assign(m, {auto: true, aj: 1, loc: 'pared', diam: duct ? '' : d, sys, wall, review: rev,
        note: [duct ? 'ducto' + (c.wd ? ` (ancho en el plano ≈ ${Math.round(c.wd)})` : '') : d ? (fromNote ? d + ' (nota general del plano)' : d) : 'ø sin rótulo cerca', sys, wall, NOTE[c.kind], c.corner ? 'en la punta o esquina de la pared: verificar' : ''].filter(Boolean).join(' · ')});
      prev.push([c.x, c.y]); mine.push([c.x, c.y]); added++; if (rev) review++; if (!d && !duct) noD++;
    }
    compactSealNumbers();
    S.auto.last = `Cálculo automático: ${added} ${added === 1 ? 'sello' : 'sellos'}${review ? `, ${review} para revisar` : ''}.`;
    if (lvNum(sh.lv) > 0 && !S.levels) S.levels = String(lvNum(sh.lv));
  });
  sh.autoDone = true;
  return {many: added > 150, how: res.how, nx: res.nx, ny: res.ny, match: res.match, seals: added, review, noD, dups, duct,
    styles: res.styles.filter(s => s.pick).map(s => ({key: s.key, full: s.full})), guessed: ctx.guessed, kept: !!opt.tr, own: !!opt.keys};
}

/* ---------- avance ---------- */
function barEl() {
  let b = $('#autoBar');
  if (!b) {
    b = document.createElement('div'); b.id = 'autoBar'; b.setAttribute('role', 'status');
    b.innerHTML = '<div class="abtxt"><b>Cálculo automático</b><span data-t></span></div><div class="abprog"><i></i></div><button class="btn" data-x></button>';
    document.body.appendChild(b);
    b.querySelector('[data-x]').onclick = () => {
      if (running) { stopAsked = true; b.querySelector('[data-t]').textContent = 'Deteniendo al terminar este plano…'; }
      else if (P.autoJob) runJob();
    };
  }
  return b;
}
function bar(n, total, txt, stopped) {
  const b = barEl();
  b.querySelector('[data-t]').textContent = ` · ${Math.min(n + (stopped ? 0 : 1), total)} de ${total} · ${txt}`;
  b.querySelector('i').style.width = Math.round(100*n/Math.max(1, total)) + '%';
  b.querySelector('[data-x]').textContent = stopped ? 'Continuar' : 'Detener';
  let d = b.querySelector('[data-d]');
  if (stopped && !d) { d = document.createElement('button'); d.className = 'btn'; d.dataset.d = '1'; d.textContent = 'Terminar aquí'; d.onclick = () => { discardJob(); showReport(); }; b.appendChild(d); }
  else if (!stopped && d) d.remove();
}
function hideBar() { const b = $('#autoBar'); if (b) b.remove(); }

/* ---------- 4) informe ---------- */
export function showReport() {
  const log = P.autoLog; if (!log) return toast('Todavía no hay un cálculo automático.');
  const rows = log.rows, ok = rows.filter(r => !r.err), bad = rows.filter(r => r.err);
  const tot = ok.reduce((a, r) => a + r.seals, 0), rev = ok.reduce((a, r) => a + r.review, 0), noD = ok.reduce((a, r) => a + r.noD, 0);
  const sty = r => r.styles.map(s => s.key === 'ann' ? 'anotaciones' : s.key[0] === 'f' ? 'relleno ' + s.key.slice(1, 8) : `${s.key.slice(1, 8) === '#000000' ? 'negro' : s.key.slice(1, 8)} ${s.key.split('/')[1]}`).join(', ');
  const html = `<p><b>${tot}</b> ${tot === 1 ? 'sello marcado' : 'sellos marcados'} en ${ok.length} ${ok.length === 1 ? 'plano' : 'planos'}${rev ? ` · <b>${rev}</b> para revisar (aro naranja punteado)` : ''}${noD ? ` · ${noD} sin diámetro (quedan en "Por definir")` : ''}${bad.length ? ` · <b>${bad.length}</b> ${bad.length === 1 ? 'plano sin calcular' : 'planos sin calcular'}` : ''}${log.partial ? ' · cálculo detenido antes de terminar' : ''}.</p>
    ${ok.some(r => r.guessed) ? '<p class="small">Las paredes cortafuego se tomaron de la simbología del arquitectónico: abra el arquitectónico y confirme que lo resaltado en rojo son las paredes correctas. Si no, corríjalas en Detección y vuelva a calcular.</p>' : ''}
    <p class="muted small">Es un borrador. En cada plano compruebe: que esté bien alineado, que las líneas tomadas como tubería sean las correctas (pestaña Detección; si las cambia, vuelva a "Automático" y se recalcula con las suyas) y los sellos dudosos. Los sellos que usted agregue o mueva a mano no se tocan al recalcular.</p>
    ${bad.length ? `<div class="autotbl"><table><thead><tr><th>Sin calcular</th><th>Motivo</th></tr></thead><tbody>${bad.map(r => `<tr><td>${esc(r.name)}<div class="muted small">${esc(r.sec || '')}</div></td><td>${esc(r.err)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="autotbl"><table><thead><tr><th>Plano</th><th>Sellos</th><th>Revisar</th><th>Alineación</th><th>Líneas tomadas como tubería</th></tr></thead><tbody>
    ${ok.map(r => `<tr><td>${esc(r.name)}<div class="muted small">${esc(r.sec || '')} · A: ${esc(r.arq || '')}</div></td><td>${r.seals}${r.many ? '<div><b>demasiados: revise las líneas tomadas como tubería</b></div>' : ''}${r.dups ? `<div class="muted small">${r.dups} ya contados en otra lámina</div>` : ''}</td><td>${r.review || ''}</td>
      <td class="small">${r.kept ? 'la que ya tenía' : r.how === 'ejes' ? `por ejes (${(r.nx || 0) + (r.ny || 0)})` : 'por ejes y dibujo: verificar'}${r.match != null && r.match < 0.25 ? '<div><b>calce bajo: verificar</b></div>' : ''}</td>
      <td class="small">${r.styles.length ? esc(sty(r)) : '<b>ninguna cruza paredes</b>'}${r.own ? ' (elegidas por usted)' : ''}${r.duct ? ' · ductos' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  ask({title: 'Informe del cálculo automático', html, wide: true, buttons: [{label: 'Cerrar', value: null, primary: true}]});
}

/* Al arrancar: si la página se recargó sola para soltar memoria, sigue; si quedó un cálculo a medias, lo ofrece. */
export function init() {
  let auto = false;
  try { auto = !!sessionStorage.getItem('cf-auto-resume'); sessionStorage.removeItem('cf-auto-resume'); } catch (e) {}
  resumeSoon = auto;
  const wait = setInterval(() => {
    if (!P) return;
    clearInterval(wait);
    if (!P.autoJob) { resumeSoon = false; return; }
    if (auto) setTimeout(() => { resumeSoon = false; runJob(); }, 800);
    else bar((P.autoJob.total || P.autoJob.ids.length) - P.autoJob.ids.length, P.autoJob.total || P.autoJob.ids.length, 'Quedó sin terminar', true);
  }, 300);
}
