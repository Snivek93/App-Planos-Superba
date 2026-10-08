/* Almacenamiento en el navegador (IndexedDB) y guardado automático. */
import { P } from './state.js';
import { commitShared } from '../project/shared.js';

/* ---------- almacenamiento local ---------- */
export const DB = {
  db:null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('superposicion-cortafuego', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(k, v) {
    try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('files', 'readwrite'); const st = t.objectStore('files'); v ? st.put(v, k) : st.delete(k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
    catch (e) { console.warn('No se pudo guardar el plano localmente', e); }
  },
  async clearAll() {
    try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').clear(); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
    catch (e) { console.warn(e); }
  },
  async has(k) {
    try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').getKey(k); r.onsuccess = () => res(r.result !== undefined); r.onerror = () => rej(r.error); }); }
    catch (e) { return false; }
  },
  async delPrefix(prefix) {
    try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').delete(IDBKeyRange.bound(prefix, prefix + '\uffff')); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
    catch (e) { console.warn(e); }
  },
  async get(k) {
    try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    catch (e) { return null; }
  }
};

export let saveTimer = null;

/* Varias ventanas o pestañas con la app abierta comparten el mismo proyecto guardado. Si una guarda, las
   otras quedan con una copia vieja: si siguieran guardando, borrarían lo hecho en la otra ventana (por
   ejemplo los ajustes de Afinar paredes). Por eso, cuando otra ventana guarda, esta deja de guardar y avisa. */
const TAB = Math.random().toString(36).slice(2);
let chan = null, stale = false;
try { chan = new BroadcastChannel('cortafuego-proyecto'); } catch (e) {}
function announce() { try { chan && chan.postMessage({t:'saved', id:TAB}); } catch (e) {} }
function goStale() {
  if (stale) return; stale = true; clearTimeout(saveTimer);
  const d = document.createElement('div');
  d.id = 'staleBar'; d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;max-width:min(560px,calc(100vw - 24px));background:#C81E2B;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:500 14px/1.35 Barlow,system-ui,sans-serif;display:flex;gap:12px;align-items:center';
  d.innerHTML = '<span>El proyecto se abrió o se guardó en otra ventana o pestaña. Esta dejó de guardar para no borrar lo hecho allá: trabaje en la otra, o recargue esta (y cierre la otra).</span><button style="flex:none;border:0;border-radius:8px;padding:7px 12px;background:#fff;color:#C81E2B;font-weight:700;cursor:pointer">Recargar</button>';
  d.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(d);
}
export function isStale() { return stale; }

export function save() { if (stale) return; clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 400); }

export async function persistNow() {
  clearTimeout(saveTimer);
  if (!P || stale) return;
  try { commitShared(); await DB.put('project', JSON.stringify(P)); announce(); } catch (e) { console.warn('No se pudo guardar el proyecto', e); }
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  if (chan) chan.onmessage = e => { if (e.data && e.data.t === 'saved' && e.data.id !== TAB) goStale(); };
  addEventListener('pagehide', () => { if (P && !stale) { try { commitShared(); DB.put('project', JSON.stringify(P)); announce(); } catch (e) {} } });
}
