/* Estado global de la hoja abierta (S), del proyecto (P), planos en memoria (RT), vista y herramienta activa. */
import { DEFAULT_SEAL_TYPES } from './constants.js';

/* ---------- estado ---------- */
export function newPlan() { return ({name:'', page:1, pages:1, w:0, h:0, visible:true, opacity:1, blend:'normal', tint:'', x:0, y:0, s:1, r:0, locked:false}); }

export function defaultState() {
  const B = newPlan(); B.opacity = 0.75; B.blend = 'multiply'; B.tint = '#1E6FB8';
  return {
    plans: {A: newPlan(), B},
    layers: [
      {id:'L1', name:'Paredes cortafuego', plan:'A', color:'#C81E2B', visible:true, locked:false, kind:'cortafuego', st:'pend'},
      {id:'L2', name:'Instalaciones', plan:'B', color:'#1E6FB8', visible:true, locked:false, kind:'instalaciones', st:'pend'},
      {id:'L3', name:'Sellos', plan:'A', color:'#C81E2B', visible:true, locked:false, kind:'sellos', st:'pend'}
    ],
    marks: [], active:'L1', seq:0, uid:20, sealType:'elec', width:2, wv:2, tab:'planos', drawColor:'', hlColor:'#FFD400', hlAlpha:0.4, hlWidth:2, drawAlpha:1, showDiam:true, auto:{fire:[], pipes:[], zone:null, diam:true, catMode:'diam', show:true, last:''}, floors:[], sealTypes: DEFAULT_SEAL_TYPES.map(t => ({...t}))
  };
}

export let S;

export let P = null;

export const RT = {A:{file:null, name:'', bmp:null, tinted:null, pdf:null, loading:false}, B:{file:null, name:'', bmp:null, tinted:null, pdf:null, loading:false}};

export const view = {x:0, y:0, z:1};

export let tool = 'select';

export let sel;

export let cur = null; // marca en construcción

export let gesture = null;

export let hover = null;

export let spaceDown = false;

export let align = null;

export let openLayers;

export let undoStack = [];
export let redoStack = [];

export function uid() { return 'm' + (P ? ++P.uid : ++S.uid); }

export function L(id) { return S.layers.find(l => l.id === id); }

export function MK(id) { return S.marks.find(m => m.id === id); }

export function planOf(l) { return S.plans[l.plan]; }

/* Acceso de escritura para otros módulos (los import de ES son de solo lectura). */
export const stateVars = {
  get align() { return align; }, set align(v) { align = v; },
  get tool() { return tool; }, set tool(v) { tool = v; },
  get cur() { return cur; }, set cur(v) { cur = v; },
  get hover() { return hover; }, set hover(v) { hover = v; },
  get gesture() { return gesture; }, set gesture(v) { gesture = v; },
  get spaceDown() { return spaceDown; }, set spaceDown(v) { spaceDown = v; },
  get redoStack() { return redoStack; }, set redoStack(v) { redoStack = v; },
  get P() { return P; }, set P(v) { P = v; },
  get S() { return S; }, set S(v) { S = v; },
  get undoStack() { return undoStack; }, set undoStack(v) { undoStack = v; },
};

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  S = defaultState();
  sel = new Set();
  openLayers = new Set();
}
