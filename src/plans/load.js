/* Carga de PDF e imágenes, renderizado del plano y coloreado. */
import { $, MAXAREA, MAXDIM, PDF_UNIT, pdfjsLib, pdfReady } from '../core/constants.js';
import { newPlan, P, RT, S } from '../core/state.js';
import { dirty, stage } from '../canvas/render.js';
import { fit } from '../canvas/view.js';
import { pushUndo } from '../core/undo.js';
import { renderPlans } from '../panels/planos.js';
import { save } from '../core/storage.js';
import { ask, changed, toast } from '../ui/app.js';
import { pathCache } from '../detect/vector.js';
import { RT_BLANK } from '../project/model.js';
import { gcFiles, rtRemember, storeFile } from '../project/files.js';
import { addArqFiles } from '../project/sheets.js';
import { renderProject } from '../home/home.js';
import { filesFromDrop } from '../home/dragdrop.js';
import { openProject } from '../project/archive.js';
import { handleFiles, renderEmpty } from '../home/empty.js';

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

export function makeTint(k) {
  const p = S.plans[k], rt = RT[k];
  if (rt.bmp && rt.tintKey === (p.tint || '') && (rt.tinted || !p.tint)) return;
  rt.tinted = null; rt.tintKey = p.tint || '';
  if (!p.tint || !rt.bmp) return;
  const c = document.createElement('canvas'); c.width = rt.bmp.width; c.height = rt.bmp.height;
  const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(rt.bmp, 0, 0);
  try {
    const d = x.getImageData(0, 0, c.width, c.height), a = d.data, [tr, tg, tb] = hexRGB(p.tint);
    for (let i = 0; i < a.length; i += 4) {
      const lum = (a[i]*0.299 + a[i+1]*0.587 + a[i+2]*0.114)/255;
      const al = Math.min(1, (1 - lum)*1.35) * (a[i+3]/255);
      a[i] = tr; a[i+1] = tg; a[i+2] = tb; a[i+3] = al*255;
    }
    x.putImageData(d, 0, 0); rt.tinted = c;
  } catch (err) { console.warn(err); }
}

export async function loadFile(k, blob, name, opt = {}) {
  const p = S.plans[k], rt = RT[k];
  rt.loading = true; renderPlans(); renderEmpty();
  try {
    const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(name || '');
    let lw, lh, c;
    if (isPdf) {
      await pdfReady().catch(() => null);
      if (!pdfjsLib) throw new Error('No se pudo cargar el lector de PDF. Recargue la página.');
      const pdf = (opt.samePdf && rt.pdf) ? rt.pdf : await pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
      rt.pdf = pdf;
      const page = Math.min(Math.max(1, opt.page || 1), pdf.numPages);
      const pg = await pdf.getPage(page);
      const v1 = pg.getViewport({scale:1});
      lw = v1.width*PDF_UNIT; lh = v1.height*PDF_UNIT;
      const sc = Math.min(MAXDIM/Math.max(v1.width, v1.height), Math.sqrt(MAXAREA/(v1.width*v1.height)), 10);
      const vp = pg.getViewport({scale:sc});
      c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({canvasContext:x, viewport:vp}).promise;
      p.pages = pdf.numPages; p.page = page; rt.pages = pdf.numPages;
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
    rt.bmp = c; rt.file = blob; rt.name = name; rt.vec = null; rt.labels = null; rt.text = null; rt.tintKey = undefined;
    makeTint(k);
    if ((fresh || opt.initB) && k === 'B') { const A = S.plans.A; p.r = 0; p.x = 0; p.y = 0; p.s = A.w ? (A.w*A.s)/lw : 1; }
    if (fresh && P) { p.fileId = await storeFile(blob, name); rtRemember(rt, p.fileId, p.page); await gcFiles(); renderProject(); }
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
