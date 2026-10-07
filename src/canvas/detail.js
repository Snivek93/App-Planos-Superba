/* Nitidez al acercar: el plano base es una imagen de tamaño fijo (rápida, pero se pixela con mucho zoom).
   Cuando la vista se detiene más cerca de lo que da esa imagen, se vuelve a dibujar desde el PDF original
   solo la zona visible, a la resolución de la pantalla, y se pinta encima. Al moverse se sigue viendo la
   imagen base (y el último detalle); al detenerse se actualiza. Solo para planos PDF. */
import { isMobile, PDF_UNIT } from '../core/constants.js';
import { RT, S, view } from '../core/state.js';
import { toLocal } from '../core/geometry.js';
import { CH, CW, ctx, dirty, dpr, EXPORT, interacting } from './render.js';
import { planFrames, solo } from '../plans/floors.js';
import { ensurePdf } from '../plans/load.js';
import { lookOf, planKeys } from '../plans/extraA.js';

const det = {};                        // detalle listo por plano (A, B y los A adicionales)
const task = {};                       // dibujo en curso (se cancela si la vista cambia)
let timer = null, seq = 0;
const CAP = isMobile ? 6e6 : 12e6;     // píxeles máximos del detalle (memoria)

const native = (rt, p) => rt.bmp ? rt.bmp.width/p.w : 0;

/* zona visible del plano k (coordenadas del plano) y escala necesaria (píxeles de pantalla por unidad) */
function need(k) {
  const p = S.plans[k], rt = RT[k];
  if (!p || !rt || !rt.bmp || !rt.isPdf || !lookOf(k).visible || (solo && solo !== k)) return null;
  let rect = null, scale = 0;
  for (const [fr, clip] of planFrames(k)) {
    const q = [[0, 0], [CW, 0], [CW, CH], [0, CH]].map(([sx, sy]) => toLocal(fr, [(sx - view.x)/view.z, (sy - view.y)/view.z]));
    let r = [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
    r = [Math.max(r[0], 0, clip ? clip[0] : 0), Math.max(r[1], 0, clip ? clip[1] : 0), Math.min(r[2], p.w, clip ? clip[2] : p.w), Math.min(r[3], p.h, clip ? clip[3] : p.h)];
    if (r[2] <= r[0] || r[3] <= r[1]) continue;
    rect = rect ? [Math.min(rect[0], r[0]), Math.min(rect[1], r[1]), Math.max(rect[2], r[2]), Math.max(rect[3], r[3])] : r;
    scale = Math.max(scale, dpr*view.z*fr.s);
  }
  if (!rect || scale <= native(rt, p)*1.15) return null;
  return {rect, scale};
}

function covers(d, n) {
  return d && d.s >= n.scale*0.92 && d.rect[0] <= n.rect[0] + 1e-6 && d.rect[1] <= n.rect[1] + 1e-6 && d.rect[2] >= n.rect[2] - 1e-6 && d.rect[3] >= n.rect[3] - 1e-6;
}

export function scheduleDetail() {
  if (EXPORT) return;
  clearTimeout(timer);
  timer = setTimeout(check, 260);
}

function check() {
  if (interacting()) { scheduleDetail(); return; }
  for (const k of Object.keys(det)) if (!planKeys().includes(k)) { if (det[k]) det[k].c.width = det[k].c.height = 0; delete det[k]; }
  for (const k of planKeys()) {
    const n = need(k), rt = RT[k], p = S.plans[k];
    if (!n) { if (det[k]) { det[k].c.width = det[k].c.height = 0; det[k] = null; } continue; } // con poco zoom se libera la memoria
    const d = det[k];
    if (d && d.rt === rt && d.page === p.page && covers(d, n)) continue;
    // zona un poco más grande que la vista, para que mover un poco no obligue a redibujar
    const w = n.rect[2] - n.rect[0], h = n.rect[3] - n.rect[1];
    let s = n.scale, pad = 0.35;
    let r = [n.rect[0] - w*pad, n.rect[1] - h*pad, n.rect[2] + w*pad, n.rect[3] + h*pad];
    if ((r[2]-r[0])*(r[3]-r[1])*s*s > CAP) { r = n.rect.slice(); if (w*h*s*s > CAP) s = Math.sqrt(CAP/(w*h)); }
    r = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(p.w, r[2]), Math.min(p.h, r[3])];
    render(k, rt, p, r, s);
  }
}

async function render(k, rt, p, r, s) {
  const my = ++seq;
  if (task[k]) { try { task[k].cancel(); } catch (e) {} task[k] = null; }
  try {
    const pdf = await ensurePdf(rt);
    if (!pdf || RT[k] !== rt || my !== seq) return;
    const page = p.page || 1, pg = await pdf.getPage(page);
    const vp = pg.getViewport({scale: s*PDF_UNIT});
    const W = Math.max(1, Math.ceil((r[2] - r[0])*s)), H = Math.max(1, Math.ceil((r[3] - r[1])*s));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const t = pg.render({canvasContext:x, viewport:vp, transform:[1, 0, 0, 1, -r[0]*s, -r[1]*s]});
    task[k] = t;
    await t.promise;
    if (task[k] === t) task[k] = null;
    if (RT[k] !== rt) return;
    const old = det[k]; if (old) { old.c.width = old.c.height = 0; if (old.tinted) old.tinted.width = old.tinted.height = 0; }
    det[k] = {rt, page, rect:[r[0], r[1], r[0] + W/s, r[1] + H/s], s, c, tinted:null, tintKey:''};
    dirty();
  } catch (e) {
    if (!e || e.name !== 'RenderingCancelledException') console.warn('No se pudo dibujar el detalle', e);
  }
}

/* se llama desde drawPlan, con el contexto ya en coordenadas del plano */
export function drawDetail(k, p, fr, clip, tinted) {
  const d = det[k], rt = RT[k];
  if (EXPORT || !d || d.rt !== rt || d.page !== p.page) return;
  if (Math.abs(dpr*view.z*fr.s) <= native(rt, p)*1.1) return; // con poco zoom basta la imagen base
  let img = d.c;
  if (tinted && p.tint) {
    if (d.tintKey !== p.tint) {
      const t = document.createElement('canvas'); t.width = d.c.width; t.height = d.c.height;
      const g = t.getContext('2d'); g.drawImage(d.c, 0, 0); g.globalCompositeOperation = 'screen'; g.fillStyle = p.tint; g.fillRect(0, 0, t.width, t.height);
      d.tinted = t; d.tintKey = p.tint;
    }
    img = d.tinted;
  }
  const [x0, y0, x1, y1] = d.rect;
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.rect(clip[0], clip[1], clip[2]-clip[0], clip[3]-clip[1]); ctx.clip(); }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

export function clearDetail() { for (const k of new Set([...Object.keys(task), ...Object.keys(det)])) { if (task[k]) { try { task[k].cancel(); } catch (e) {} } task[k] = null; det[k] = null; } }
