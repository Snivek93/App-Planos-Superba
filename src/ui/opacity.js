/* Burbuja de opacidades en la barra superior: paredes cortafuego, plano A y plano B,
   a mano en cualquier plano sin ir a las pestañas Planos o Detección. */
import { $ } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { dirty } from '../canvas/render.js';
import { save } from '../core/storage.js';
import { ICON } from './icons.js';
import { curSheet } from '../project/model.js';

function rows() {
  const sh = curSheet(); if (!sh) return [];
  const out = [];
  if ((S.auto.fire || []).some(r => r.on)) out.push(['fire', 'Paredes cortafuego', S.auto.hlOp ?? 0.8, 0]);
  if (RT.A.bmp || S.plans.A.fileId) out.push(['A', sh.kind === 'arq' ? 'Plano arquitectónico' : 'Plano A (arquitectónico)', S.plans.A.opacity ?? 1, 0.05]);
  if (sh.kind === 'pair' && (RT.B.bmp || S.plans.B.fileId)) out.push(['B', 'Plano B (instalaciones)', S.plans.B.opacity ?? 1, 0.05]);
  return out;
}
const pct = v => Math.round(v*100) + ' %';

export function renderOpBubble() {
  const wrap = $('#opWrap'); if (!wrap) return;
  const r = rows();
  wrap.hidden = !r.length;
  if (!r.length) { closeOp(); return; }
  const pop = $('#opPop'); if (pop.hidden) return;
  const h = r.map(([k, label, v, min]) => `<div class="oprow"><label for="op_${k}">${label}</label><input id="op_${k}" type="range" min="${min}" max="1" step="0.05" value="${v}" data-op="${k}"><output>${pct(v)}</output></div>`).join('');
  if (pop._h !== h || !pop.querySelector('input:active')) { pop.innerHTML = h; pop._h = h; }
}
function openOp() { const pop = $('#opPop'); pop.hidden = false; $('#btnOp').setAttribute('aria-expanded', 'true'); $('#btnOp').classList.add('on'); renderOpBubble(); place(); }
/* la burbuja se ubica bajo el botón, sin salirse de la pantalla (en el celular el botón queda a la izquierda) */
function place() {
  const pop = $('#opPop'), b = $('#btnOp').getBoundingClientRect(), w = pop.offsetWidth, vw = document.documentElement.clientWidth;
  const cx = b.left + b.width/2, left = Math.max(12, Math.min(vw - w - 12, cx - w + 70));
  pop.style.left = left + 'px'; pop.style.top = (b.bottom + 10) + 'px';
  pop.style.setProperty('--tip', Math.max(16, Math.min(w - 16, cx - left)) + 'px');
}
function closeOp() { const pop = $('#opPop'); if (!pop) return; pop.hidden = true; $('#btnOp').setAttribute('aria-expanded', 'false'); $('#btnOp').classList.remove('on'); }

/* lleva el valor a los controles equivalentes del panel lateral, si están a la vista */
function syncPanel(k, v) {
  const el = k === 'fire' ? document.querySelector('#panel [data-act="hlOp"]') : document.querySelector(`#panel [data-act="opacity"][data-k="${k}"]`);
  if (el) { el.value = v; if (el.nextElementSibling) el.nextElementSibling.textContent = pct(v); }
}

export function init() {
  $('#btnOp').innerHTML = ICON.opacity;
  $('#btnOp').onclick = e => { e.stopPropagation(); $('#opPop').hidden ? openOp() : closeOp(); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#opWrap')) closeOp(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOp(); });
  addEventListener('resize', () => { if (!$('#opPop').hidden) place(); });
  $('#opPop').addEventListener('input', e => {
    const t = e.target, k = t.dataset.op; if (!k) return;
    const v = +t.value;
    if (k === 'fire') S.auto.hlOp = v; else S.plans[k].opacity = v;
    t.nextElementSibling.textContent = pct(v); syncPanel(k, v); dirty();
  });
  $('#opPop').addEventListener('change', () => save());
}
