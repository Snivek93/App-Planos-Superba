/* Guardar y abrir el proyecto como .zip; migración de la versión anterior. */
import { P, RT, sel, stateVars } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { setTool } from '../editor/tools.js';
import { baseName, saveFile } from '../export/files.js';
import { dataURLtoBlob } from '../export/pdf.js';
import { DB, persistNow } from '../core/storage.js';
import { ask, renderAll, toast } from '../ui/app.js';
import { zipStore } from '../export/firestop.js';
import { arqState, blankState, clone, guessType, hydrate, modelVars, newProjectData, normState, pid, RT_BLANK, showHome, stripExt } from './model.js';
import { rtCache, storeFile, usedFiles } from './files.js';
import { commitShared, isSharedLayer } from './shared.js';
import { openSheet } from './sheets.js';

/* --- guardar / abrir el proyecto como .zip --- */
export async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('El archivo .zip está dañado.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = new Map(), dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    let data = u8.subarray(start, start + csize);
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) throw new Error('El .zip usa una compresión que no se puede leer.');
    const m = name.match(/(proyecto\.json|archivos\/[^/]+)$/);
    out.set(m ? m[1] : name, data);
  }
  return out;
}

export async function saveProject() {
  if (!Object.keys(P.sheets).length) return toast('El proyecto está vacío.');
  toast('Preparando el archivo del proyecto…');
  commitShared();
  const files = [], meta = {}; let missing = 0;
  for (const id of usedFiles()) {
    const rec = await DB.get('file:' + id);
    if (!rec || !rec.blob) { missing++; continue; }
    files.push(['archivos/' + id, new Uint8Array(await rec.blob.arrayBuffer())]);
    meta[id] = {name:rec.name, type:rec.blob.type || guessType(rec.name), size:rec.blob.size};
  }
  P.files = meta;
  const o = JSON.parse(JSON.stringify(P)); o.guardado = new Date().toISOString();
  const blob = zipStore([['proyecto.json', JSON.stringify(o)], ...files], 'application/zip');
  await saveFile(baseName() + '.zip', blob, 'application/zip');
  if (missing) toast(`Atención: faltan ${missing} archivos de planos en este navegador; el proyecto se guardó sin ellos.`);
}

export async function migrateLegacy(o, recA, recB) {
  if (Array.isArray(o.sealTypes) && o.sealTypes.length) P.sealTypes = o.sealTypes;
  if (o.fsx) P.fsx = o.fsx;
  P.uid = Math.max(P.uid, (+o.uid || 0) + 1);
  const pairSt = normState(o);
  let arqId = null;
  if (recA && recA.blob) {
    const fa = await storeFile(recA.blob, recA.name);
    const ast = arqState(fa, pairSt.plans.A.page);
    Object.assign(ast.plans.A, clone(pairSt.plans.A), {fileId:fa});
    const shared = pairSt.layers.filter(isSharedLayer), ids = new Set(shared.map(l => l.id));
    if (shared.length) { ast.layers = clone(shared); ast.marks = clone(pairSt.marks.filter(m => ids.has(m.layer))); ast.active = ast.layers[0].id; }
    ast.auto.fire = clone(pairSt.auto.fire || []);
    arqId = pid('h');
    P.sheets[arqId] = {id:arqId, kind:'arq', name:stripExt(recA.name), sec:'arq', sub:null, state:ast, order:1};
    pairSt.plans.A.fileId = fa;
  }
  if (recB && recB.blob && arqId) {
    pairSt.plans.B.fileId = await storeFile(recB.blob, recB.name);
    const sec = P.sections.find(s => s.name === 'Mecánico') || P.sections[1];
    const id = pid('h');
    P.sheets[id] = {id, kind:'pair', name:stripExt(recB.name), sec:sec.id, sub:null, aSheet:arqId, state:pairSt, order:2};
    P.active = id;
  } else if (arqId) P.active = arqId;
}

export async function openProject(file) {
  try {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
    let o = null, entries = null;
    if (isZip) { entries = await unzip(u8); const pj = entries.get('proyecto.json'); if (!pj) throw new Error('Este .zip no es un proyecto de esta app.'); o = JSON.parse(new TextDecoder().decode(pj)); }
    else { o = JSON.parse(new TextDecoder().decode(u8)); if (!o || !(o.sheets || o.state)) throw new Error('Este archivo no es un proyecto de esta app.'); }
    if (Object.keys(P.sheets).length) {
      const ok = await ask({title:'Abrir proyecto', body:'Se reemplaza el proyecto que está abierto en este navegador. Si lo quiere conservar, descárguelo antes.', buttons:[{label:'Cancelar', value:false}, {label:'Abrir', value:true, primary:true}]});
      if (!ok) return;
    }
    toast('Abriendo el proyecto…');
    commitShared(); P.active = null;
    await DB.clearAll(); rtCache.clear();
    stateVars.S = blankState(); RT.A = RT_BLANK(); RT.B = RT_BLANK();
    if (o.sheets) {
      for (const [name, data] of entries || []) if (name.startsWith('archivos/')) {
        const id = name.slice(9), m = (o.files || {})[id] || {};
        await DB.put('file:' + id, {blob:new Blob([data], {type:m.type || guessType(m.name || '')}), name:m.name || id});
      }
      hydrate(o);
    } else {
      stateVars.P = newProjectData();
      const rec = k => o.files && o.files[k] && o.files[k].data ? {blob:dataURLtoBlob(o.files[k].data), name:o.files[k].name} : null;
      await migrateLegacy(o.state, rec('A'), rec('B'));
    }
    await persistNow();
    modelVars.curTab = null; renderAll();
    if (P.active) await openSheet(P.active); else showHome();
    toast('Proyecto abierto.');
  } catch (err) { console.error(err); toast(err.message || 'No se pudo abrir el proyecto.'); }
}

export async function newProject() {
  const ok = await ask({title:'Nuevo proyecto', body:'Se borran del navegador todos los planos, marcas y sellos del proyecto actual. Si lo quiere conservar, descárguelo antes.', buttons:[{label:'Cancelar', value:false}, {label:'Empezar de cero', value:true, danger:true}]});
  if (!ok) return;
  P.active = null; await DB.clearAll(); rtCache.clear();
  stateVars.P = newProjectData(); stateVars.S = blankState(); RT.A = RT_BLANK(); RT.B = RT_BLANK();
  stateVars.undoStack = []; stateVars.redoStack = []; sel.clear(); stateVars.cur = null; stateVars.align = null;
  await persistNow(); renderAll(); setTool('select'); showHome(); dirty();
}
