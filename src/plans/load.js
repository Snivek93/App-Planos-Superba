/* Carga de PDF e imágenes, renderizado del plano y coloreado. */
import { $, MAXAREA, MAXDIM, PDF_UNIT, pdfjsLib, pdfReady } from '../core/constants.js';
import { newPlan, P, RT, S } from '../core/state.js';
import { dirty, stage } from '../canvas/render.js';
import { fit } from '../canvas/view.js';
import { pushUndo } from '../core/undo.js';
import { renderPlans } from '../panels/planos.js';
import { DB, save } from '../core/storage.js';
import { ask, changed, toast } from '../ui/app.js';
import { pathCache } from '../detect/vector.js';
import { RT_BLANK } from '../project/model.js';
import { gcFiles, rtRemember, storeFile } from '../project/files.js';
import { addArqFiles } from '../project/sheets.js';
import { renderProject } from '../home/home.js';
import { filesFromDrop } from '../home/dragdrop.js';
import { openProject } from '../project/archive.js';
import { handleFiles, renderEmpty } from '../home/empty.js';
import { hasVec, prepareVec } from '../detect/vector.js';
import { thumbReady } from '../project/warm.js';

/* ---------- carga de planos ---------- */
export function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

export function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/* Color del plano: se hace con la tarjeta de video (modo "pantalla"), sin recorrer píxel por píxel.
   Negro → color elegido, blanco → blanco. Al dibujarse en modo multiplicar, el blanco no tapa el plano A. */
export function makeTint(k) {
  const p = S.plans[k], rt = RT[k];
  if (rt.bmp && rt.tintKey === (p.tint || '') && (rt.tinted || !p.tint)) return;
  rt.tinted = null; rt.tintKey = p.tint || '';
  if (!p.tint || !rt.bmp) return;
  const c = document.createElement('canvas'); c.width = rt.bmp.width; c.height = rt.bmp.height;
  const x = c.getContext('2d');
  x.drawImage(rt.bmp, 0, 0);
  x.globalCompositeOperation = 'screen'; x.fillStyle = p.tint; x.fillRect(0, 0, c.width, c.height);
  rt.tinted = c;
}

/* --- caché de planos ya dibujados ---
   Leer y dibujar un PDF de CAD tarda segundos; abrir la imagen guardada del plano tarda décimas.
   La primera vez que se dibuja un plano se guarda como PNG (sin pérdida) en el navegador. */
const RENDER_V = 1;
export function renderKey(fileId, page) { return `render:${fileId}#${page || 1}#${MAXDIM}-${MAXAREA}-v${RENDER_V}`; }
function renderScale(v1) { return Math.min(MAXDIM/Math.max(v1.width, v1.height), Math.sqrt(MAXAREA/(v1.width*v1.height)), 10); }
async function renderPage(pdf, page) {
  const pg = await pdf.getPage(page), v1 = pg.getViewport({scale:1});
  const vp = pg.getViewport({scale:renderScale(v1)});
  const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await pg.render({canvasContext:x, viewport:vp}).promise;
  return {c, lw: v1.width*PDF_UNIT, lh: v1.height*PDF_UNIT};
}
function cacheRender(fileId, page, c, lw, lh, pages) {
  if (!fileId || !c.toBlob) return;
  c.toBlob(b => { if (b) DB.put(renderKey(fileId, page), {blob:b, lw, lh, pages}); }, 'image/png');
  makeThumb(c, fileId, page);
}
/* Vista previa pequeña para la galería del inicio. */
export function thumbKey(fileId, page) { return `thumb:${fileId}#${page || 1}`; }
export function makeThumb(src, fileId, page) {
  const W = 560, sc = Math.min(1, W/src.width);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width*sc)); c.height = Math.max(1, Math.round(src.height*sc));
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => { if (b) DB.put(thumbKey(fileId, page), {blob:b}).then(() => { thumbReady(fileId, page); res(true); }); else res(false); }, 'image/jpeg', 0.82));
}
export async function openPdf(blob) {
  await pdfReady().catch(() => null);
  if (!pdfjsLib) throw new Error('No se pudo cargar el lector de PDF. Recargue la página.');
  return pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
}
/* El PDF se abre solo cuando hace falta (detección, alineación por ejes, exportar),
   porque el plano en pantalla puede venir de la imagen guardada. */
export async function ensurePdf(rt) {
  if (rt.pdf) return rt.pdf;
  if (!rt.isPdf) return null;
  if (!rt.pdfLoading) rt.pdfLoading = (async () => {
    let blob = rt.file;
    if (!blob && rt.fileId) blob = (await DB.get('file:' + rt.fileId))?.blob;
    if (!blob) throw new Error('No se encontró el archivo PDF del plano.');
    rt.file = blob; rt.pdf = await openPdf(blob); return rt.pdf;
  })().finally(() => { rt.pdfLoading = null; });
  return rt.pdfLoading;
}
/* Prepara en segundo plano un plano que todavía no se ha abierto: imagen del plano, vista previa
   y, si hace falta, la lectura vectorial para la detección. Así después abre al instante. */
export async function prepareFile(fileId, page, opt = {}) {
  page = page || 1;
  const needRender = !(await DB.has(renderKey(fileId, page))), needThumb = !(await DB.has(thumbKey(fileId, page)));
  const needVec = !!opt.vec && !(await hasVec(fileId, page));
  if (!needRender && !needThumb && !needVec) return false;
  const rec = await DB.get('file:' + fileId);
  if (!rec || !rec.blob) return false;
  const isPdf = rec.blob.type === 'application/pdf' || /\.pdf$/i.test(rec.name || '');
  if (!isPdf) {
    if (needThumb) { const img = await loadImage(rec.blob); await makeThumb(img.naturalWidth ? Object.assign(img, {width:img.naturalWidth, height:img.naturalHeight}) : img, fileId, page); }
    return true;
  }
  if (!needRender && !needVec) {
    const cached = await DB.get(renderKey(fileId, page));
    if (cached && cached.blob) { const bm = await createImageBitmap(cached.blob); await makeThumb(bm, fileId, page); bm.close(); }
    return true;
  }
  const pdf = await openPdf(rec.blob);
  try {
    const pg = Math.min(Math.max(1, page), pdf.numPages);
    if (needRender || needThumb) {
      const {c, lw, lh} = await renderPage(pdf, pg);
      if (needRender) await new Promise(res => c.toBlob(b => { if (b) DB.put(renderKey(fileId, page), {blob:b, lw, lh, pages:pdf.numPages}).then(res); else res(); }, 'image/png'));
      await makeThumb(c, fileId, page);
      c.width = c.height = 0;
    }
    if (needVec) await prepareVec(fileId, pg, pdf);
    return true;
  } finally { pdf.destroy && pdf.destroy(); }
}

export async function loadFile(k, blob, name, opt = {}) {
  const p = S.plans[k], rt = RT[k];
  rt.loading = true; renderPlans(); renderEmpty();
  let toCache = false;
  try {
    const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(name || '');
    let lw, lh, c = null;
    rt.isPdf = isPdf;
    if (isPdf) {
      const page = Math.max(1, opt.page || 1);
      const cached = opt.fileId && !opt.noCache ? await DB.get(renderKey(opt.fileId, page)) : null;
      if (cached && cached.blob) {
        try {
          c = await createImageBitmap(cached.blob); lw = cached.lw; lh = cached.lh; p.pages = rt.pages = cached.pages || 1; p.page = page;
          const bm = c, fid = opt.fileId; DB.has(thumbKey(fid, page)).then(h => { if (!h && bm.width) makeThumb(bm, fid, page); });
        }
        catch (e) { c = null; }
      }
      if (!c) {
        const pdf = (opt.samePdf && rt.pdf) ? rt.pdf : await openPdf(blob);
        rt.pdf = pdf;
        const pg = Math.min(page, pdf.numPages);
        ({c, lw, lh} = await renderPage(pdf, pg));
        p.pages = rt.pages = pdf.numPages; p.page = pg; toCache = true;
      }
    } else {
      const img = await loadImage(blob);
      const nw = img.naturalWidth, nh = img.naturalHeight;
      lw = nw; lh = nh;
      const sc = Math.min(1, MAXDIM/Math.max(nw, nh), Math.sqrt(MAXAREA/(nw*nh)));
      c = document.createElement('canvas'); c.width = Math.max(1, Math.round(nw*sc)); c.height = Math.max(1, Math.round(nh*sc));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      p.pages = 1; p.page = 1; rt.pdf = null;
    }
    const fresh = !opt.restore && !opt.samePdf;
    const hadOther = !!RT[k === 'A' ? 'B' : 'A'].bmp;
    p.w = lw; p.h = lh; p.name = name;
    if (rt.bmp && rt.bmp !== c && rt.bmp.close) rt.bmp.close();
    rt.bmp = c; rt.file = blob; rt.name = name; rt.vec = null; rt.labels = null; rt.text = null; rt.tintKey = undefined; rt.hl = null;
    makeTint(k);
    if ((fresh || opt.initB) && k === 'B') { const A = S.plans.A; p.r = 0; p.x = 0; p.y = 0; p.s = A.w ? (A.w*A.s)/lw : 1; }
    if (fresh && P) { p.fileId = await storeFile(blob, name); rtRemember(rt, p.fileId, p.page); await gcFiles(); renderProject(); }
    if (toCache) cacheRender(p.fileId || opt.fileId, p.page, c, lw, lh, p.pages);
    if (fresh && !hadOther) fit();
    if (fresh && k === 'B' && hadOther) toast('Plano B cargado. Si no coincide con el A, use "Alinear con 2 puntos" en la pestaña Planos.');
  } catch (err) {
    console.error(err);
    toast(err && err.message ? err.message : 'No se pudo abrir el archivo. Use un PDF, PNG o JPG.');
  } finally {
    rt.loading = false; renderPlans(); renderEmpty(); save(); dirty();
  }
}

export let uploadTarget = 'A';

export function swapPlans() {
  if (S.floors.length) return toast('Quite las plantas definidas antes de intercambiar A y B.');
  pushUndo();
  [S.plans.A, S.plans.B] = [S.plans.B, S.plans.A];
  const ra = RT.A; RT.A = RT.B; RT.B = ra;
  for (const l of S.layers) l.plan = l.plan === 'A' ? 'B' : 'A';
  for (const r of [...S.auto.fire, ...S.auto.pipes]) r.plan = r.plan === 'A' ? 'B' : 'A';
  pathCache.clear();
  changed(); renderPlans(); fit(); toast('Planos intercambiados. Cada capa sigue pegada a su plano.');
}

export async function removePlan(k) {
  const ok = await ask({title:`Quitar plano ${k}`, body:'Se quita solo el archivo. Las marcas y capas se conservan.', buttons:[{label:'Cancelar', value:false}, {label:'Quitar', value:true, danger:true}]});
  if (!ok) return;
  RT[k] = RT_BLANK();
  const keep = S.plans[k]; S.plans[k] = Object.assign(newPlan(), {opacity:keep.opacity, blend:keep.blend, tint:keep.tint, x:keep.x, y:keep.y, s:keep.s, r:keep.r});
  await gcFiles(); save(); renderPlans(); renderEmpty(); dirty();
}

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const loadVars = {
  get uploadTarget() { return uploadTarget; }, set uploadTarget(v) { uploadTarget = v; },
};

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#fileOne').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(uploadTarget, f, f.name); });
  $('#fileMulti').addEventListener('change', e => { const fs = e.target.files; if (fs.length) handleFiles(fs); e.target.value = ''; });
  $('#fileArq').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addArqFiles(fs); });
  $('#fileProject').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); });
  stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragover'); });
  stage.addEventListener('dragleave', e => { if (e.target === stage || !stage.contains(e.relatedTarget)) stage.classList.remove('dragover'); });
  stage.addEventListener('drop', async e => { e.preventDefault(); stage.classList.remove('dragover'); const fs = await filesFromDrop(e.dataTransfer); if (fs.length) handleFiles(fs); });
}
