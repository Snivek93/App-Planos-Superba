/* Arranque: carga el proyecto guardado y abre la última hoja o el inicio. */
import { LS_KEY } from './core/constants.js';
import { P, RT, stateVars } from './core/state.js';
import { dirty, resize } from './canvas/render.js';
import { setTool } from './editor/tools.js';
import { DB, persistNow } from './core/storage.js';
import { renderAll } from './ui/app.js';
import { blankState, hydrate, newProjectData, RT_BLANK, showHome } from './project/model.js';
import { openSheet } from './project/sheets.js';
import { migrateLegacy } from './project/archive.js';

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  /* ---------- arranque ---------- */
  (async function boot() {
    let o = null;
    try { const raw = await DB.get('project'); if (raw) o = JSON.parse(raw); } catch (e) {}
    if (o && o.sheets) hydrate(o);
    else {
      stateVars.P = newProjectData();
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) { await migrateLegacy(JSON.parse(raw), await DB.get('A'), await DB.get('B')); await persistNow(); }
      } catch (e) { console.warn(e); }
    }
    stateVars.S = blankState(); RT.A = RT_BLANK(); RT.B = RT_BLANK();
    renderAll(); setTool('select'); resize();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if (P.active && P.sheets[P.active]) await openSheet(P.active); else showHome();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(dirty);
  })();
}
