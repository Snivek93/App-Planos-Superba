/* Archivos de planos guardados una sola vez y caché de planos en memoria. */
import { P, RT, S } from '../core/state.js';
import { isMobile, LITE } from '../core/constants.js';
import { dirty } from '../canvas/render.js';
import { closeOrphanPdfs, destroyPdf, loadFile, makeTint } from '../plans/load.js';
import { renderPlans } from '../panels/planos.js';
import { DB } from '../core/storage.js';
import { guessType, pid, RT_BLANK } from './model.js';
import { renderEmpty } from '../home/empty.js';

/* --- archivos --- */
export async function storeFile(blob, name) {
  const id = pid('f');
  await DB.put('file:' + id, {blob, name});
  P.files[id] = {name, size:blob.size, type:blob.type || guessType(name)};
  return id;
}

export function usedFiles() {
  const s = new Set();
  for (const sh of Object.values(P.sheets)) {
    if (sh.kind === 'arq' && sh.state.plans.A.fileId) s.add(sh.state.plans.A.fileId);
    if (sh.kind === 'pair' && sh.state.plans.B.fileId) s.add(sh.state.plans.B.fileId);
  }
  return s;
}

export async function gcFiles() {
  const used = usedFiles();
  for (const id of Object.keys(P.files)) if (!used.has(id)) {
    delete P.files[id]; await DB.put('file:' + id, null);
    await DB.delPrefix('render:' + id + '#'); await DB.delPrefix('vec:' + id + '#'); await DB.delPrefix('thumb:' + id + '#');
    for (const k of [...rtCache.keys()]) if (k.startsWith(id + '#')) rtCache.delete(k);
  }
}

export let rtCache;

export function rtKey(f, p) { return f + '#' + (p || 1); }

export function rtRemember(rt, fileId, page) {
  rt.fileId = fileId; rt.pg = page;
  const key = rtKey(fileId, page); rtCache.delete(key); rtCache.set(key, rt);
  // planos en memoria: pocos, porque cada uno ocupa decenas de MB; los demás se abren rápido desde la caché del navegador
  const max = isMobile ? 3 : LITE ? 2 : 4;
  const active = new Set(Object.values(RT));
  for (const [k, v] of [...rtCache.entries()]) {
    if (rtCache.size <= max) break;
    if (active.has(v)) continue;
    rtCache.delete(k);
    if (v.bmp && v.bmp.close) v.bmp.close();
    freeCanvas(v.bmp); freeCanvas(v.tinted); freeCanvas(v.hl && v.hl.c);
    const pdf = v.pdf;
    v.bmp = v.tinted = v.hl = v.vec = v.pdf = v.text = null;
    releasePdf(pdf);
  }
}
/* suelta la memoria de un lienzo ya sin uso de inmediato (si no, el navegador la libera tarde y al abrir
   muchos planos seguidos la pestaña se puede quedar sin memoria) */
function freeCanvas(c) { if (c && c.getContext && c.width) { c.width = 0; c.height = 0; } }
/* cierra el documento PDF en el lector (worker) si ningún plano en memoria lo sigue usando */
function releasePdf(pdf) {
  if (!pdf || !pdf.destroy) return;
  const inUse = [...rtCache.values(), ...Object.values(RT)].some(r => r && r.pdf === pdf);
  if (!inUse) destroyPdf(pdf);
}
/* Planos guardados en memoria pero que no están abiertos: se sueltan las capas pesadas (resaltado,
   lectura vectorial, documento PDF). Se recalculan rápido desde la caché del navegador si se vuelven a abrir. */
export function trimInactive() {
  const active = new Set(Object.values(RT));
  for (const v of rtCache.values()) if (!active.has(v)) {
    if (v.tinted && v.tinted !== v.bmp) freeCanvas(v.tinted);
    freeCanvas(v.hl && v.hl.c);
    v.hl = null; v.tinted = null; v.tintKey = undefined;
    // el documento PDF abierto en el lector ocupa mucha memoria y no se suelta solo: se cierra y se vuelve a abrir
    // desde el archivo guardado si hace falta (detección, alinear, exportar)
    const pdf = v.pdf; v.pdf = null; releasePdf(pdf);
    if (LITE) { v.vec = null; v.text = null; v.labels = null; }
  }
  closeOrphanPdfs(new Set([...rtCache.values(), ...Object.values(RT)].map(r => r && r.pdf).filter(Boolean)));
}

export async function loadPlanFile(k, fileId, page, opt = {}) {
  const hit = rtCache.get(rtKey(fileId, page));
  if (hit && hit.bmp) { RT[k] = hit; rtRemember(hit, fileId, page); const p = S.plans[k]; p.pages = hit.pages || p.pages; p.name = hit.name; makeTint(k); dirty(); return true; }
  const rec = await DB.get('file:' + fileId);
  RT[k] = RT_BLANK();
  if (!rec || !rec.blob) { RT[k].missing = true; renderPlans(); renderEmpty(); return false; }
  const sib = [...rtCache.values()].find(r => r.fileId === fileId && r.pdf);
  if (sib) RT[k].pdf = sib.pdf;
  const rt = RT[k];
  await loadFile(k, rec.blob, rec.name, {restore:true, page, samePdf:!!sib, initB:opt.initB, fileId});
  if (rt.bmp) rtRemember(rt, fileId, S.plans[k].page);
  return !!rt.bmp;
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  rtCache = new Map();
}
