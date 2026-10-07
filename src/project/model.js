/* Modelo del proyecto: secciones, subsecciones, hojas y utilidades. */
import { $, DEFAULT_SEAL_TYPES, esc } from '../core/constants.js';
import { defaultState, newPlan, P, S, stateVars } from '../core/state.js';
import { sealsSorted } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { closePanel } from '../ui/app.js';
import { closeSheet } from './sheets.js';
import { renderProject } from '../home/home.js';
import { aLevelObjs, levelViewOptions, viewLevel } from '../plans/arqlevels.js';
import { compactSealNumbers } from '../panels/sellos.js';

/* ---------- arranque ---------- */
/* =====================================================================
   PROYECTO: varias hojas (arquitectónicos + planos de instalaciones),
   secciones y subsecciones, archivos guardados en el navegador.
   ===================================================================== */
export function RT_BLANK() { return ({file:null, name:'', bmp:null, tinted:null, pdf:null, loading:false}); }

export function pid(p) { return p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

export function clone(o) { return JSON.parse(JSON.stringify(o)); }

export function stripExt(n) { return String(n || '').replace(/\.[^.]+$/, ''); }

export function isPlanFile(f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || (f.type || '').startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name); }

export function isPdfFile(f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }

export function guessType(n) { return /\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : /\.webp$/i.test(n) ? 'image/webp' : 'application/octet-stream'; }

export let curTab = null;

export let homeOn = false;

export function showHome() {
  if (P.active) closeSheet();
  homeOn = true; $('#home').hidden = false; $('#menu').hidden = true; closePanel();
  renderProject(); save();
}

export function hideHome() { homeOn = false; $('#home').hidden = true; }

export function renderSheetSel() {
  const el = $('#sheetSel'); if (!el || !P) return;
  const opt = sh => `<option value="${sh.id}"${sh.id === P.active ? ' selected' : ''}>${esc(sh.name)}</option>`;
  let h = P.active ? '' : '<option value="" selected>Elija un plano…</option>';
  for (const s of P.sections) {
    const root = sheetsOf(s.id, null);
    if (root.length) h += `<optgroup label="${esc(s.name)}">${root.map(opt).join('')}</optgroup>`;
    for (const u of s.subs) { const it = sheetsOf(s.id, u.id); if (it.length) h += `<optgroup label="${esc(s.name)} › ${esc(u.name)}">${it.map(opt).join('')}</optgroup>`; }
  }
  h += '<optgroup label="──────────"><option value="__new">＋ Nuevo plano de instalaciones…</option><option value="__arq">＋ Agregar arquitectónicos…</option><option value="__home">⌂ Inicio del proyecto</option></optgroup>';
  if (el._h !== h) { el.innerHTML = h; el._h = h; }
  el.value = P.active || '';
  const lv = $('#lvlSel'); if (!lv) return;
  const lh = levelViewOptions();
  if (lv._h !== lh) { lv.innerHTML = lh; lv._h = lh; }
  lv.hidden = !lh;
  if (lh) { lv.value = viewLevel || ''; if (lv.value !== (viewLevel || '')) lv.value = ''; lv.classList.toggle('on', !!viewLevel); }
}

export function newProjectData() {
  return {app:'superposicion-cortafuego', v:2, name:'Proyecto nuevo', uid:1000, active:null, lastA:null,
    sealTypes: DEFAULT_SEAL_TYPES.map(t => ({...t})), fsx:null,
    sections:[
      {id:'arq', name:'Arquitectónicos', kind:'arq', subs:[]},
      {id:pid('s'), name:'Eléctrico', subs:[]},
      {id:pid('s'), name:'Mecánico', subs:[{id:pid('u'), name:'Agua potable'}, {id:pid('u'), name:'Pluvial', below:true}, {id:pid('u'), name:'Sanitario', below:true}]},
      {id:pid('s'), name:'Supresión de incendios', subs:[]}
    ],
    sheets:{}, files:{}};
}

export function bindShared(st) {
  for (const k of ['sealTypes', 'fsx']) {
    const d = Object.getOwnPropertyDescriptor(st, k);
    if (d && !d.get) delete st[k];
    if (!d || !d.get) Object.defineProperty(st, k, {get() { return P[k]; }, set(v) { P[k] = v; }, enumerable:false, configurable:true});
  }
  return st;
}

export function normState(o) {
  const base = defaultState();
  const st = Object.assign(base, o || {});
  st.plans = {A:Object.assign(newPlan(), o?.plans?.A), B:Object.assign(defaultState().plans.B, o?.plans?.B)};
  if (o && o.wv !== 2 && o.width != null) { st.width = Math.min(4, (o.width ?? 1) + 1); st.hlWidth = Math.min(4, (o.hlWidth ?? 1) + 1); }
  st.wv = 2;
  if (st.drawAlpha == null) st.drawAlpha = 1;
  if (!st.auto) st.auto = {fire:[], pipes:[], zone:null, diam:true, catMode:'diam', show:true, last:''};
  if (st.showDiam == null) st.showDiam = true;
  if (!Array.isArray(st.floors)) st.floors = [];
  if (!Array.isArray(st.layers) || !st.layers.length) st.layers = base.layers;
  if (!Array.isArray(st.marks)) st.marks = [];
  delete st.sealTypes; delete st.fsx;
  bindShared(st);
  if (!st.layers.find(l => l.id === st.active)) st.active = st.layers[0]?.id;
  return st;
}

export function blankState() { return normState(null); }

export function arqState(fileId, page) {
  const st = normState(null);
  st.layers = [{id:'L1', name:'Paredes cortafuego', plan:'A', color:'#C81E2B', visible:true, locked:false, kind:'cortafuego', st:'pend'}];
  st.active = 'L1'; st.plans.A.fileId = fileId; st.plans.A.page = page || 1;
  return st;
}

export function hydrate(o) {
  stateVars.P = o;
  if (!Array.isArray(P.sealTypes) || !P.sealTypes.length) P.sealTypes = DEFAULT_SEAL_TYPES.map(t => ({...t}));
  if (!P.sections || !P.sections.length) P.sections = newProjectData().sections;
  if (!P.sections.find(s => s.id === 'arq')) P.sections.unshift({id:'arq', name:'Arquitectónicos', kind:'arq', subs:[]});
  P.sheets = P.sheets || {}; P.files = P.files || {}; P.uid = P.uid || 1000;
  for (const sh of Object.values(P.sheets)) sh.state = normState(sh.state);
  // numeración sin huecos también en planos marcados con versiones anteriores
  for (const sh of Object.values(P.sheets)) withState(sh.state, compactSealNumbers);
  if (P.active && !P.sheets[P.active]) P.active = null;
  return P;
}

/* " › Nivel 6, Nivel 7" cuando el plano usa solo algunos niveles del arquitectónico */
export function aLevelsLabel(sh) {
  const arq = P.sheets[sh.aSheet], ids = sh.aLevels || [];
  if (!arq || !ids.length) return '';
  const names = aLevelObjs(sh).map(l => l.name);
  return names.length ? ' › ' + names.join(', ') : '';
}

export function curSheet() { return P && P.active ? P.sheets[P.active] || null : null; }

export function secById(id) { return P.sections.find(s => s.id === id); }

export function subById(sec, id) { return (secById(sec)?.subs || []).find(u => u.id === id); }

export function secLabel(sh) { const s = secById(sh.sec), u = sh.sub ? subById(sh.sec, sh.sub) : null; return (s ? s.name : '') + (u ? ' › ' + u.name : ''); }

export function sheetsOf(sec, sub) {
  return Object.values(P.sheets).filter(s => s.sec === sec && (sub === undefined || (s.sub || null) === (sub || null)))
    .sort(sheetCmp);
}

export function byName(a, b) { return a.name.localeCompare(b.name, 'es', {numeric:true, sensitivity:'base'}); }

export function sheetCmp(a, b) {
  const m = P.sort || 'az';
  if (m === 'za') return byName(b, a);
  if (m === 'fecha') return (a.order ?? 0) - (b.order ?? 0) || byName(a, b);
  return byName(a, b);
}

export function orderedSheets() {
  const out = [], seen = new Set();
  for (const s of P.sections) {
    for (const sh of sheetsOf(s.id, null)) { out.push(sh); seen.add(sh.id); }
    for (const u of s.subs) for (const sh of sheetsOf(s.id, u.id)) { out.push(sh); seen.add(sh.id); }
  }
  for (const sh of Object.values(P.sheets)) if (!seen.has(sh.id)) out.push(sh);
  return out;
}

export function scopeSheets(scope) {
  if (scope === 'cur') return curSheet() ? [curSheet()] : [];
  if (scope && scope.startsWith('sec:')) return orderedSheets().filter(s => s.sec === scope.slice(4));
  return orderedSheets();
}

export function withState(st, fn) { const prev = S; stateVars.S = st; try { return fn(); } finally { stateVars.S = prev; } }

export function projectSeals(scope) { const out = []; for (const sh of scopeSheets(scope)) out.push(...withState(sh.state, () => sealsSorted())); return out; }

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const modelVars = {
  get curTab() { return curTab; }, set curTab(v) { curTab = v; },
};
