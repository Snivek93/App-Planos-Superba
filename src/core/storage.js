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
  async get(k) {
    try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    catch (e) { return null; }
  }
};

export let saveTimer = null;

export function save() { clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 400); }

export async function persistNow() {
  clearTimeout(saveTimer);
  if (!P) return;
  try { commitShared(); await DB.put('project', JSON.stringify(P)); } catch (e) { console.warn('No se pudo guardar el proyecto', e); }
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  addEventListener('pagehide', () => { if (P) { try { commitShared(); DB.put('project', JSON.stringify(P)); } catch (e) {} } });
}
