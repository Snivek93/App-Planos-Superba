/* Modelo del proyecto: secciones, subsecciones, hojas y utilidades. */
import { $, DEFAULT_SEAL_TYPES, esc } from '../core/constants.js';
import { defaultState, newPlan, P, S, stateVars } from '../core/state.js';
import { sealsSorted } from '../panels/sellos.js';
import { save } from '../core/storage.js';
import { closePanel } from '../ui/app.js';
import { closeSheet } from './sheets.js';
import { renderProject } from '../home/home.js';
import { aLevelObjs, levelViewOptions, moreLevelObjs, viewLevel } from '../plans/arqlevels.js';
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
  const av = $('#aViewSel');
  if (av) { const sh = P.active ? P.sheets[P.active] : null, on = !!(sh && sh.kind === 'pair' && sh.aAlt && sh.aAlt.a && P.sheets[sh.aAlt.a]); av.hidden = !on; if (on) { av.value = S.aView === 'losa' ? 'losa' : 'paredes'; av.classList.toggle('on', av.value === 'losa'); } }
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

/* ---------- categorías de sellos por juego de planos ----------
   Cada juego (subsección, por ejemplo Mecánico › Agua potable o Mecánico › Sanitario; o la sección si el plano
   no está en una subsección) tiene sus propias categorías: borrar o cambiar una no afecta los otros juegos.
   Los datos de Firestop de cada categoría (P.fsx.cats) siguen guardados por id, y los id no se repiten entre juegos. */
export function catKey(sh) { return !sh ? '' : sh.kind === 'arq' ? 'arq' : (sh.sec || '') + '|' + (sh.sub || ''); }
const stSheet = new WeakMap();
function sheetOfState(st) {
  if (!P || !P.sheets) return null;
  const c = stSheet.get(st); if (c && c.state === st && P.sheets[c.id] === c) return c;
  const sh = Object.values(P.sheets).find(x => x.state === st) || null;
  if (sh) stSheet.set(st, sh);
  return sh;
}
function freshDefaults() { return DEFAULT_SEAL_TYPES.map(t => t.id === 'pend' ? {...t} : {...t, id: 'c' + 'm' + (++P.uid)}); }
export function catsForKey(key) {
  if (!P.catSets) P.catSets = {};
  if (!P.catSets[key]) P.catSets[key] = freshDefaults();
  return P.catSets[key];
}
function catsOf(st) {
  if (!P) return st._cats || (st._cats = DEFAULT_SEAL_TYPES.map(t => ({...t})));
  const sh = sheetOfState(st);
  if (!sh) return P.sealTypes || [];
  return catsForKey(catKey(sh));
}
/* plano que pasa a otro juego: sus sellos se quedan con categorías equivalentes (mismo nombre) o se copian */
export function adoptCats(sh, oldKey) {
  if (!P || !P.catSets || catKey(sh) === oldKey) return;
  const from = P.catSets[oldKey] || [], to = catsForKey(catKey(sh)), map = {};
  const need = new Set([...sh.state.marks.filter(m => m.type === 'seal').map(m => m.st), ...sh.state.layers.map(l => l.st).filter(Boolean)]);
  for (const id of need) {
    if (to.some(t => t.id === id)) continue;
    const t = from.find(x => x.id === id); if (!t) continue;
    const same = to.find(x => x.name.trim().toLowerCase() === t.name.trim().toLowerCase());
    if (same) { map[id] = same.id; continue; }
    const nt = {...t, id: 'c' + 'm' + (++P.uid)};
    if (P.fsx && P.fsx.cats && P.fsx.cats[id]) P.fsx.cats[nt.id] = clone(P.fsx.cats[id]);
    const pi = to.findIndex(x => x.id === 'pend'); pi >= 0 ? to.splice(pi, 0, nt) : to.push(nt);
    map[id] = nt.id;
  }
  for (const m of sh.state.marks) if (m.type === 'seal' && map[m.st]) m.st = map[m.st];
  for (const l of sh.state.layers) if (map[l.st]) l.st = map[l.st];
}
/* proyectos guardados con categorías de todo el proyecto: se reparten por juego, con las que usa cada uno */
export function migrateCats(force) {
  if (P.catSets && !force) return;
  P.catSets = {};
  const all = P.sealTypes || [], owner = {};
  const groups = new Map();
  for (const sh of Object.values(P.sheets)) { const k = catKey(sh); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sh); }
  for (const [k, shs] of groups) {
    const used = new Set();
    for (const sh of shs) { for (const m of sh.state.marks) if (m.type === 'seal') used.add(m.st); for (const l of sh.state.layers) if (l.st) used.add(l.st); }
    const list = [], map = {};
    for (const t of all) {
      if (t.id === 'pend' || !used.has(t.id)) continue;
      if (!owner[t.id]) { owner[t.id] = k; list.push({...t}); continue; }
      const nt = {...t, id: 'c' + 'm' + (++P.uid)}; // la usa otro juego también: copia propia
      if (P.fsx && P.fsx.cats && P.fsx.cats[t.id]) P.fsx.cats[nt.id] = clone(P.fsx.cats[t.id]);
      list.push(nt); map[t.id] = nt.id;
    }
    list.push({...(all.find(t => t.id === 'pend') || DEFAULT_SEAL_TYPES.find(t => t.id === 'pend'))});
    for (const sh of shs) { for (const m of sh.state.marks) if (m.type === 'seal' && map[m.st]) m.st = map[m.st]; for (const l of sh.state.layers) if (map[l.st]) l.st = map[l.st]; }
    P.catSets[k] = list;
  }
}

export function bindShared(st) {
  for (const k of ['sealTypes', 'fsx']) {
    const d = Object.getOwnPropertyDescriptor(st, k);
    if (d && !d.get) delete st[k];
  }
  Object.defineProperty(st, 'fsx', {get() { return P ? P.fsx : null; }, set(v) { if (P) P.fsx = v; }, enumerable:false, configurable:true});
  Object.defineProperty(st, 'sealTypes', {
    get() { return catsOf(this); },
    set(v) {
      if (!P) { this._cats = v; return; }
      const sh = sheetOfState(this);
      if (sh) { if (!P.catSets) P.catSets = {}; P.catSets[catKey(sh)] = v; } else P.sealTypes = v;
    },
    enumerable:false, configurable:true});
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
  migrateCats();
  // numeración sin huecos también en planos marcados con versiones anteriores
  for (const sh of Object.values(P.sheets)) withState(sh.state, compactSealNumbers);
  if (P.active && !P.sheets[P.active]) P.active = null;
  return P;
}

/* " › Nivel 6, Nivel 7" cuando el plano usa solo algunos niveles del arquitectónico */
export function aLevelsLabel(sh) {
  const arq = P.sheets[sh.aSheet]; if (!arq) return '';
  const names = (sh.aLevels || []).length ? aLevelObjs(sh).map(l => l.name) : [];
  let out = names.length ? ' › ' + names.join(', ') : '';
  for (const m of sh.aMore || []) {
    const o = P.sheets[m.aSheet]; if (!o) continue;
    const n = moreLevelObjs({aMore:[m], aSheet: sh.aSheet}).map(l => l.id === '*' ? 'hoja completa' : l.name);
    out += ` + ${o.name}${n.length ? ' › ' + n.join(', ') : ''}`;
  }
  return out;
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
