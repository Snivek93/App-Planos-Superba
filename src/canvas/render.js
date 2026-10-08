/* Lienzo principal: tamaño, dibujo de planos, marcas y sellos, y copias reducidas para dibujar rápido. */
import { $, LITE, ST, txtOn } from '../core/constants.js';
import { align, cur, gesture, hover, L, RT, S, sel, tool, view } from '../core/state.js';
import { dist, M, rectPts, s2w, toLocal, toWorld, w2s } from '../core/geometry.js';
import { drawTable } from './tables.js';
import { locOf } from '../core/levels.js';
import { floorRectWorld, frameOf, planFrames, solo } from '../plans/floors.js';
import { altOn } from '../plans/altA.js';
import { drawAutoHighlights, drawKnockout, FIRE_HL, typicalWallW } from '../detect/vector.js';
import { wallFixLintels, wallFixMasks, wallFixPreview, wfDraft, wfMode } from '../detect/wallfix.js';
import { drawLevelRects } from '../plans/arqlevels.js';
import { isAKey, lookOf, planKeys } from '../plans/extraA.js';
import { makeTint } from '../plans/load.js';
import { toast } from '../ui/app.js';
import { drawDetail, scheduleDetail } from './detail.js';

/* ---------- lienzo ---------- */
export let stage;
export let cv;

export let ctx;

export let VM = [1, 0, 0, 1, 0, 0];
export let UI = 1;
export let EXPORT = false;

export function dev(w) { return [VM[0]*w[0] + VM[2]*w[1] + VM[4], VM[1]*w[0] + VM[3]*w[1] + VM[5]]; }

export let dpr = 1;
export let CW = 0;
export let CH = 0;

export function resize() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2.5); CW = r.width; CH = r.height;
  cv.width = Math.max(1, Math.round(CW*dpr)); cv.height = Math.max(1, Math.round(CH*dpr));
  cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
  dirty();
}

export let rafPending = false;

export function dirty() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; const t0 = performance.now(); draw(); watchSpeed(performance.now() - t0); }); } }
/* Si la computadora tarda mucho en dibujar, se sugiere una vez el ahorro de memoria. */
let slowAvg = 0, slowN = 0, slowTold = false;
function watchSpeed(ms) {
  if (LITE || slowTold || EXPORT) return;
  slowAvg = slowN ? slowAvg*0.9 + ms*0.1 : ms; slowN++;
  if (slowN > 40 && slowAvg > 45) {
    slowTold = true;
    toast('La app va lenta en esta computadora. Pruebe Archivo → Ahorro de memoria y revise que Chrome tenga activada la aceleración por hardware.');
  }
}

export function setWorld(p) {
  ctx.setTransform(VM[0], VM[1], VM[2], VM[3], VM[4], VM[5]);
  const m = M(p); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

export let measureCtx;

export function textW(m) { measureCtx.font = `600 ${m.size}px Barlow, sans-serif`; return measureCtx.measureText(m.text).width; }

export function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  VM = [dpr*view.z, 0, 0, dpr*view.z, dpr*view.x, dpr*view.y]; UI = dpr;
  for (const k of planKeys()) drawPlan(k);
  scheduleDetail();
  if (!solo) drawAutoHighlights();
  const seals = solo ? [] : drawLayers(true);
  if (cur) { const l = L(cur.layer); if (l) { const p = frameOf(cur); setWorld(p); drawMark(cur, l, p, false); } }
  for (const [m, p] of seals) drawSeal(m, p, sel.has(m.id));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // línea elástica de la polilínea
  if (cur && cur.type === 'poly' && hover && !(gesture && gesture.kind === 'pan')) {
    const l = L(cur.layer), p = frameOf(cur), last = w2s(...toWorld(p, cur.pts[cur.pts.length-1]));
    ctx.strokeStyle = l.color; ctx.globalAlpha = .6; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(hover[0], hover[1]); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    for (const q of cur.pts) { const s = w2s(...toWorld(p, q)); ctx.fillStyle = '#fff'; ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s[0], s[1], 4, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  if (!solo && S.lvls && S.lvls.length) drawLevelRects(ctx, w2s);
  if (!solo) for (const f of S.floors) {
    const r = floorRectWorld(f), a = w2s(r[0], r[1]), b = w2s(r[2], r[3]);
    ctx.strokeStyle = 'rgba(122,76,194,.75)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
    ctx.strokeRect(a[0], a[1], b[0]-a[0], b[1]-a[1]); ctx.setLineDash([]);
    ctx.font = '600 12px Barlow, sans-serif'; ctx.fillStyle = '#7A4CC2'; ctx.fillText(f.name + (f.alt && altOn() ? `  ·  A de losa: ${f.alt.name}` : ''), a[0] + 6, a[1] + 15);
  }
  if (S.auto.zone && !S.floors.length && !solo && !(gesture && gesture.kind === 'zone')) {
    const z = S.auto.zone, a = w2s(z[0], z[1]), b = w2s(z[2], z[3]);
    ctx.strokeStyle = '#7A4CC2'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    ctx.strokeRect(a[0], a[1], b[0]-a[0], b[1]-a[1]); ctx.setLineDash([]);
    ctx.font = '600 12px Barlow, sans-serif'; ctx.fillStyle = '#7A4CC2'; ctx.fillText('Zona de búsqueda', a[0] + 6, a[1] - 6);
  }
  if (tool === 'wallfix' && !solo) for (const m of wallFixMasks()) {
    // zonas borradas: contorno punteado para poder verlas y restaurarlas
    const A = S.plans.A, q = [[m[0], m[1]], [m[2], m[1]], [m[2], m[3]], [m[0], m[3]]].map(v => w2s(...toWorld(A, v)));
    ctx.strokeStyle = '#C81E2B'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.beginPath(); q.forEach((v, i) => i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }
  if (tool === 'wallfix' && !solo) {
    const A = S.plans.A, toS = q => w2s(...toWorld(A, q));
    // cargadores sobre puertas encontrados: contorno azul; los quitados, en gris
    for (const l of wallFixLintels()) {
      const a = toS(l.a), b = toS(l.b), wpx = Math.max(4, l.w*A.s*view.z), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy/len*wpx/2, ny = dx/len*wpx/2;
      ctx.strokeStyle = l.off ? 'rgba(90,90,90,.8)' : '#1E6FB8'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a[0]+nx, a[1]+ny); ctx.lineTo(b[0]+nx, b[1]+ny); ctx.lineTo(b[0]-nx, b[1]-ny); ctx.lineTo(a[0]-nx, a[1]-ny); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
    // trazo en curso del modo Agregar, y línea del arrastre
    let pv = wallFixPreview(hover ? s2w(...hover) : null);
    if (!pv && wfMode === 'agregar' && gesture && gesture.kind === 'wallfix' && dist(gesture.start, gesture.end) >= 8) pv = {pts:[toLocal(A, s2w(...gesture.start)), toLocal(A, s2w(...gesture.end))], w: typicalWallW()};
    if (pv && pv.pts.length) {
      ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = FIRE_HL; ctx.lineCap = 'square'; ctx.lineJoin = 'miter'; ctx.lineWidth = Math.max(3, pv.w*A.s*view.z);
      ctx.beginPath(); pv.pts.forEach((q, i) => { const v = toS(q); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#C81E2B'; for (const q of pv.pts.slice(0, wfDraft ? wfDraft.pts.length : 0)) { const v = toS(q); ctx.beginPath(); ctx.arc(v[0], v[1], 3.5, 0, 7); ctx.fill(); }
    }
  }
  if (gesture && gesture.kind === 'wallfix' && wfMode !== 'agregar' && dist(gesture.start, gesture.end) >= 8) {
    const [a, b] = [gesture.start, gesture.end];
    ctx.fillStyle = 'rgba(200,30,43,.10)'; ctx.strokeStyle = '#C81E2B'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
    ctx.strokeRect(Math.min(a[0], b[0]) + .5, Math.min(a[1], b[1]) + .5, Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
    ctx.setLineDash([]);
  }
  if (gesture && (gesture.kind === 'marquee' || gesture.kind === 'zone')) {
    const [a, b] = [gesture.start, gesture.end];
    ctx.fillStyle = 'rgba(30,111,184,.08)'; ctx.strokeStyle = '#1E6FB8'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
    ctx.strokeRect(Math.min(a[0], b[0]) + .5, Math.min(a[1], b[1]) + .5, Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
    ctx.setLineDash([]);
  }
  if (align) {
    const labels = ['B1', 'A1', 'B2', 'A2'];
    align.pts.forEach((w, i) => {
      const s = w2s(...w), col = i % 2 === 0 ? '#1E6FB8' : '#C81E2B';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s[0]-11, s[1]); ctx.lineTo(s[0]+11, s[1]); ctx.moveTo(s[0], s[1]-11); ctx.lineTo(s[0], s[1]+11); ctx.stroke();
      ctx.beginPath(); ctx.arc(s[0], s[1], 6, 0, 7); ctx.stroke();
      ctx.font = '700 13px "Barlow Semi Condensed", Barlow, sans-serif'; ctx.fillStyle = col; ctx.fillText(labels[i], s[0]+9, s[1]-9);
    });
  }
}

export function drawLayers(useSel, keep) {
  const seals = [];
  for (const l of S.layers) {
    if (!l.visible) continue;
    for (const m of S.marks) {
      if (m.layer !== l.id) continue;
      const p = frameOf(m);
      if (keep && !keep(m, p)) continue;
      if (m.type === 'seal') { seals.push([m, p]); continue; }
      setWorld(p);
      drawMark(m, l, p, useSel && sel.has(m.id));
    }
  }
  return seals;
}

export function drawPlan(k) {
  const p = S.plans[k], rt = RT[k];
  if (!p || !rt || !rt.bmp) return;
  const look = lookOf(k); // los planos A adicionales se ven igual que el principal
  if (k !== 'A' && isAKey(k) && p.tint !== look.tint) { p.tint = look.tint; makeTint(k); }
  if ((!look.visible && solo !== k) || (solo && solo !== k)) return;
  const src = look.tint && rt.tinted && !solo ? rt.tinted : rt.bmp;
  for (const [fr, clip] of planFrames(k)) {
    ctx.save(); setWorld(fr);
    ctx.globalAlpha = solo ? 1 : look.opacity;
    ctx.globalCompositeOperation = look.blend === 'multiply' || src === rt.tinted ? 'multiply' : 'source-over';
    blitPart(src, p, fr, clip);
    drawDetail(k, p, fr, clip, src === rt.tinted);
    if (!solo && look.visible) drawKnockout(k, p, fr, clip);
    ctx.restore();
  }
}

/* Dibujo rápido: copias reducidas de la imagen para cuando la vista está alejada,
   y solo el trozo de imagen que corresponde a cada planta (sin recortes por máscara). */
export let mipCache;

export let lastWheel = 0;

export function interacting() { return !!gesture || performance.now() - lastWheel < 220; }

/* Copias reducidas del plano para dibujar rápido con la vista alejada. Se generan en segundo plano
   (fuera del hilo principal cuando el navegador lo permite); mientras tanto se usa la imagen completa. */
export function mipLevel(src, level) {
  let arr = mipCache.get(src);
  if (!arr) { arr = [src]; mipCache.set(src, arr); buildMips(src, arr); }
  return arr[Math.min(level, arr.length - 1)];
}
async function buildMips(src, arr) {
  let prev = src;
  try {
    while (prev.width >= 1024 && prev.height >= 512 && arr.length < 6) {
      const w = Math.ceil(prev.width/2), h = Math.ceil(prev.height/2);
      let next;
      try { next = await createImageBitmap(prev, {resizeWidth:w, resizeHeight:h, resizeQuality:'high'}); }
      catch (e) { next = document.createElement('canvas'); next.width = w; next.height = h; const g = next.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(prev, 0, 0, w, h); }
      arr.push(next); prev = next;
      await new Promise(r => setTimeout(r, 0));
    }
  } catch (e) { console.warn(e); }
  dirty();
}

export function blitPart(src, p, fr, clip) {
  let img = src;
  if (!EXPORT) {
    const devPerUnit = Math.abs(VM[0])*fr.s || 1, ratio = (src.width/p.w)/devPerUnit;
    const level = Math.max(0, Math.min(5, Math.floor(Math.log2(Math.max(1, ratio)))));
    img = mipLevel(src, level);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = EXPORT || !interacting() ? 'high' : 'low';
  const kx = img.width/p.w, ky = img.height/p.h;
  if (!clip) { ctx.drawImage(img, 0, 0, p.w, p.h); return; }
  const x0 = Math.max(0, clip[0]), y0 = Math.max(0, clip[1]), x1 = Math.min(p.w, clip[2]), y1 = Math.min(p.h, clip[3]);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(img, x0*kx, y0*ky, (x1-x0)*kx, (y1-y0)*ky, x0, y0, x1-x0, y1-y0);
}

export function drawMark(m, l, p, isSel) {
  if (m.type === 'table') return drawTable(m, p, isSel);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (m.type === 'text') {
    const [x, y] = m.pts[0];
    ctx.font = `600 ${m.size}px Barlow, sans-serif`; ctx.textBaseline = 'top';
    if (isSel) { const pad = m.size*.2; ctx.fillStyle = 'rgba(242,183,5,.45)'; ctx.fillRect(x-pad, y-pad, textW(m)+pad*2, m.size*1.2+pad*2); }
    ctx.lineWidth = m.size*.2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(m.text, x, y);
    ctx.fillStyle = m.color || l.color; ctx.fillText(m.text, x, y);
    return;
  }
  const color = m.color || l.color, isHl = m.type === 'hl';
  const passes = isSel ? [['rgba(242,183,5,.6)', m.w + 12/(view.z*p.s), false], [color, m.w, isHl]] : [[color, m.w, isHl]];
  for (const [col, w, hl] of passes) {
    ctx.save();
    if (hl) { ctx.globalAlpha = m.alpha ?? 0.4; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
    else if (col === color && m.alpha != null) ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    const pts = m.type === 'rect' ? rectPts(m) : m.pts;
    pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    if (pts.length === 1) ctx.lineTo(pts[0][0] + .01, pts[0][1]);
    if (m.type === 'rect') ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

export function drawSeal(m, p, isSel) {
  const d = dev(toWorld(p, m.pts[0]));
  if (!EXPORT && (d[0] < -60 || d[1] < -60 || d[0] > cv.width+60 || d[1] > cv.height+60)) return;
  ctx.setTransform(UI, 0, 0, UI, d[0], d[1]);
  const x = 0, y = 0, t = ST[m.st], r = 13;
  if (isSel) { ctx.beginPath(); ctx.arc(x, y, r+6, 0, 7); ctx.fillStyle = 'rgba(242,183,5,.6)'; ctx.fill(); }
  if (m.review) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#FF7A00'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r+5, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  if (m.st === 'pend' && !m.diam) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#C81E2B'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r+3.5, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  ctx.beginPath(); if (locOf(m) === 'losa') { const q = r*0.9; ctx.roundRect ? ctx.roundRect(x-q, y-q, q*2, q*2, q*0.25) : ctx.rect(x-q, y-q, q*2, q*2); } else ctx.arc(x, y, r, 0, Math.PI*2); const sa = Math.max(0.15, Math.min(1, S.sealAlpha ?? 0.7));
  ctx.save(); ctx.globalAlpha = sa; ctx.fillStyle = t.color; ctx.fill();
  ctx.globalAlpha = Math.min(1, sa + 0.25); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${m.n >= 100 ? 10.5 : 13}px "Barlow Semi Condensed", Barlow, sans-serif`;
  if (sa < 0.95) { ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = txtOn(t.color) === '#ffffff' ? t.color : '#ffffff'; ctx.strokeText(String(m.n), x, y + .5); }
  ctx.fillStyle = txtOn(t.color); ctx.fillText(String(m.n), x, y + .5);
  if (m.mem) { // penetración de membrana: la tubería atraviesa una sola cara
    const bx = -r - 3, by = -r - 3;
    ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fillStyle = '#21272C'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.font = '700 9.5px "Barlow Semi Condensed", Barlow, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('M', bx, by + .5);
  }
  if (S.showDiam && m.diam) {
    const txt = m.diam.replace(' mm', ''); ctx.font = '700 11px "Barlow Semi Condensed", Barlow, sans-serif';
    const tw = ctx.measureText(txt).width, bx = r + 4, bh = 15;
    ctx.save(); ctx.globalAlpha = Math.min(1, sa + 0.2);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = t.color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, -bh/2, tw + 8, bh, 4) : ctx.rect(bx, -bh/2, tw + 8, bh); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#21272C'; ctx.textAlign = 'left'; ctx.fillText(txt, bx + 4, 0.5);
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const renderVars = {
  get lastWheel() { return lastWheel; }, set lastWheel(v) { lastWheel = v; },
  get ctx() { return ctx; }, set ctx(v) { ctx = v; },
  get EXPORT() { return EXPORT; }, set EXPORT(v) { EXPORT = v; },
  get UI() { return UI; }, set UI(v) { UI = v; },
  get VM() { return VM; }, set VM(v) { VM = v; },
};

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  stage = $('#stage');
  cv = $('#cv');
  ctx = cv.getContext('2d');
  new ResizeObserver(resize).observe(stage);
  addEventListener('resize', () => { if (innerWidth > 820) { $('#panel').classList.remove('open'); $('#backdrop').classList.remove('open'); } });
  measureCtx = document.createElement('canvas').getContext('2d');
  mipCache = new WeakMap();
}
