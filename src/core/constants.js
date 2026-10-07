/* Utilidades básicas ($, esc), constantes de la app, colores, categorías por defecto y carga diferida de pdf.js. */
import { S } from './state.js';

export function $(s) { return document.querySelector(s); }

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* pdf.js se carga solo cuando hace falta (al abrir el primer plano PDF) */
export let pdfjsLib = null;
export let pdfjsLoading = null;

export async function pdfReady() {
  if (pdfjsLib) return pdfjsLib;
  if (!pdfjsLoading) pdfjsLoading = import('pdfjs-dist/legacy/build/pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
    pdfjsLib = m; return m;
  }).catch(e => { pdfjsLoading = null; throw e; });
  return pdfjsLoading;
}

export let isMobile;

export let MAXDIM;
/* Ahorro de memoria (computadoras con poca RAM): planos base más livianos y menos planos guardados en memoria.
   Se activa en Archivo; si el navegador informa 4 GB o menos, viene activado. */
export let LITE = false;
const LITE_KEY = 'cortafuego-lite';
function liteSetting() {
  try { const v = localStorage.getItem(LITE_KEY); if (v === '1') return true; if (v === '0') return false; } catch (e) {}
  return !!(navigator.deviceMemory && navigator.deviceMemory <= 4);
}
export function setLite(on) { try { localStorage.setItem(LITE_KEY, on ? '1' : '0'); } catch (e) {} }

export let MAXAREA;

export const PDF_UNIT = 2; // unidades de plano por punto PDF (independiente de la resolución)

export const LS_KEY = 'cortafuego-superposicion-v1';

export const WIDTHS = [0.5, 1, 2, 4, 7];

export const WIDTH_NAMES = ['Extra fino', 'Fino', 'Medio', 'Grueso', 'Extra grueso'];

export const WIDTH_DOTS = [2, 4, 7, 11, 16];

export function widthSeg(act, value) {
  return `<div class="seg wseg" role="group" aria-label="Grosor">${WIDTH_NAMES.map((n, i) => `<button data-o="${act}" data-v="${i}" class="${value === i ? 'on' : ''}" title="${n}" aria-label="${n}"><i style="width:${WIDTH_DOTS[i]}px;height:${WIDTH_DOTS[i]}px"></i></button>`).join('')}</div><span class="lbl">${WIDTH_NAMES[value] || ''}</span>`;
}

export const DEFAULT_SEAL_TYPES = [
  {id:'elec', name:'Eléctrico', color:'#D08F00'},
  {id:'mec',  name:'Mecánico',  color:'#1E6FB8'},
  {id:'plom', name:'Plomería',  color:'#12866B'},
  {id:'tel',  name:'Datos y telecom', color:'#7A4CC2'},
  {id:'otro', name:'Otro',      color:'#5A6268'},
  {id:'pend', name:'Por definir', color:'#9AA1A6'}
];

export const PEND = {id:'pend', name:'Por definir', color:'#9AA1A6'};

export function stFind(id) { return S.sealTypes.find(t => t.id === id) || S.sealTypes.find(t => t.id === 'pend') || PEND; }

export let ST;

export const CAT_COLORS = ['#D08F00','#1E6FB8','#12866B','#7A4CC2','#C81E2B','#E05A9B','#0F9AA8','#8C6D1F','#FF7A00','#3949AB','#2E7D32','#5A6268','#B71C8C','#00897B'];

export function nextCatColor() { return CAT_COLORS.find(c => !S.sealTypes.some(t => t.color.toLowerCase() === c.toLowerCase())) || CAT_COLORS[S.sealTypes.length % CAT_COLORS.length]; }

export function txtOn(hex) { const n = parseInt(String(hex).slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (r*0.299 + g*0.587 + b*0.114) > 170 ? '#21272C' : '#ffffff'; }

export const KINDS = {cortafuego:'Pared cortafuego', instalaciones:'Instalaciones', sellos:'Sellos', tablas:'Tablas y leyendas', general:'General'};

export const TINTS = [
  {id:'', name:'Colores originales'},
  {id:'#1E6FB8', name:'Azul'},
  {id:'#C81E2B', name:'Rojo'},
  {id:'#12866B', name:'Verde'},
  {id:'#8A3FC0', name:'Morado'},
  {id:'#D08F00', name:'Ámbar'}
];

export const PEN_COLORS = ['#C81E2B','#1E6FB8','#12866B','#D08F00','#8A3FC0','#E05A9B','#21272C'];

export const HL_COLORS = ['#FFD400','#7CE36B','#FF7EB6','#FFA53D','#5CC8FF','#B98CFF'];

export const HL_WIDTHS = [3, 5, 10, 18, 30];

export const LAYER_COLORS = ['#C81E2B','#1E6FB8','#12866B','#D08F00','#8A3FC0','#E05A9B','#21272C'];

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  isMobile = matchMedia('(pointer:coarse)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);
  LITE = liteSetting();
  // con "ahorro de memoria" la imagen base de cada plano es más chica; al acercar se vuelve a dibujar nítida desde el PDF
  MAXDIM = isMobile ? 4096 : LITE ? 5000 : 7000;
  MAXAREA = isMobile ? 9e6 : LITE ? 9e6 : 22e6;
  ST = new Proxy({}, {get: (_, id) => stFind(String(id))});
}
