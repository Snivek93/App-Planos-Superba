/* Trabajo en segundo plano mientras se ve el inicio del proyecto: hace las vistas previas que faltan, una por una
   y a tamaño pequeño, y deja listo (imagen del plano y lectura vectorial) solo el último plano abierto.
   Antes preparaba la imagen grande de todos los planos, y en proyectos con muchos planos pesados la computadora
   se quedaba pegada. Espera a que el usuario no esté usando la página y se detiene en cuanto se abre un plano.
   También administra las vistas previas. */
import { P } from '../core/state.js';
import { DB } from '../core/storage.js';
import { homeOn } from './model.js';
import { prepareFile, prepareThumb, thumbKey } from '../plans/load.js';

const done = new Set();
let running = false;

let lastInput = 0;
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); }, {passive:true, capture:true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function quiet() { while (Date.now() - lastInput < 1500) await sleep(400); }
function nearView(id) {
  const el = document.querySelector(`[data-sheet="${CSS.escape(id)}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > -innerHeight*0.5 && r.top < innerHeight*1.5;
}
let scrollT = 0;
addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(() => { if (homeOn && P) warmUp(); }, 600); }, {passive:true, capture:true});
function idle() { return new Promise(r => (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => r(), {timeout:1500})); }

function jobs() {
  const out = [];
  for (const sh of Object.values(P.sheets)) {
    const pl = sh.kind === 'arq' ? sh.state.plans.A : sh.state.plans.B;
    if (!pl || !pl.fileId) continue;
    const vec = sh.kind === 'arq' ? (sh.state.auto.fire || []).length > 0 : (sh.state.auto.pipes || []).length > 0;
    const last = P.last === sh.id;
    if (!last && !nearView(sh.id)) continue; // las vistas previas, solo de las fichas que se ven en pantalla
    const key = pl.fileId + '#' + (pl.page || 1) + (last ? (vec ? '+v' : '+r') : '');
    if (!done.has(key)) out.push({key, fileId:pl.fileId, page:pl.page || 1, vec, last});
  }
  // primero el último abierto, después el resto
  return out.sort((a, b) => b.last - a.last);
}

export async function warmUp() {
  if (running || !P) return;
  running = true;
  try {
    await idle();
    while (homeOn && P) {
      const j = jobs()[0]; if (!j) break;
      done.add(j.key);
      await quiet(); if (!homeOn || !P) break;
      try { if (j.last) await prepareFile(j.fileId, j.page, {vec:j.vec}); else await prepareThumb(j.fileId, j.page); } catch (e) { console.warn('No se pudo preparar el plano', e); }
      await idle();
    }
  } finally { running = false; }
}
export function resetWarm() { done.clear(); }

/* --- vistas previas en la galería --- */
const urls = new Map(); // fileId#page → objectURL
export async function thumbURL(fileId, page) {
  const k = fileId + '#' + (page || 1);
  if (urls.has(k)) return urls.get(k);
  const rec = await DB.get(thumbKey(fileId, page));
  if (!rec || !rec.blob) return null;
  const u = URL.createObjectURL(rec.blob); urls.set(k, u); return u;
}
export function fillThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-thumb]:not([src])')) {
    const [f, pg] = img.dataset.thumb.split('#');
    thumbURL(f, +pg).then(u => { if (u) { img.src = u; img.closest('.tthumb')?.classList.add('ok'); } });
  }
}
export function thumbReady(fileId, page) {
  const k = fileId + '#' + (page || 1);
  if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
  for (const img of document.querySelectorAll(`img[data-thumb="${CSS.escape(k)}"]`)) img.removeAttribute('src');
  fillThumbs();
}
