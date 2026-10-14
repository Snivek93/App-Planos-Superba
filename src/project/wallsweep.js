/* Completar el tipo de pared de los sellos de todo el proyecto sin abrir cada plano a mano.
   Desde el inicio se hace solo y por detrás (el inicio sigue a la vista): cada plano con sellos de pared sin tipo
   se abre en silencio leyendo solo su plano A, se busca la pared cortafuego debajo de cada sello (o queda como
   panel de yeso, 2 horas) y se sigue con el siguiente. Si el usuario abre un plano mientras tanto, se detiene. */
import { P } from '../core/state.js';
import { save } from '../core/storage.js';
import { toast } from '../ui/app.js';
import { autoWalls, wallsPending } from '../detect/wall.js';
import { homeHooks, homeOn, scopeSheets, showHome } from './model.js';
import { closeSheet, openSheet } from './sheets.js';
import { renderProject } from '../home/home.js';

let running = null;
const tried = new Set();   // planos que ya se intentaron en esta sesión (si el plano A no carga no se reintenta sin fin)

export function pendingWallSheets(all = false) {
  if (!P) return [];
  return scopeSheets('all').filter(sh => wallsPending(sh.state) && !sh.initB && !sh.state.floors.some(f => f.pending) && (all || !tried.has(sh.id)));
}

/* recorre los planos pendientes; quiet = desde el inicio, sin salir de él */
export function sweepWalls({quiet = false, all = false} = {}) {
  // ya hay un recorrido: el del inicio no se repite; el de exportar espera y completa lo que falte
  if (running) return quiet ? running : running.then(() => sweepWalls({quiet: false, all}));
  const list = pendingWallSheets(all);
  if (!list.length) return Promise.resolve(null);
  running = (async () => {
    const from = P.active, startHome = homeOn;
    let done = 0, stopped = false;
    if (list.length > 1) toast(quiet ? `Completando el tipo de pared de los sellos en ${list.length} planos (del plano A, o panel de yeso 2 h si no hay pared debajo)…` : `Completando el tipo de pared de los sellos: ${list.length} planos…`);
    for (const sh of list) {
      if (quiet && !homeOn) { stopped = true; break; }          // el usuario abrió un plano: se deja para después
      try {
        await openSheet(sh.id, {noB: true, quiet});
        if (P.active !== sh.id) { stopped = true; break; }
        await autoWalls();
        if (P.active !== sh.id) { stopped = true; break; }
        done++;
      } catch (e) { /* ese plano queda con el valor por defecto al exportar */ }
      tried.add(sh.id);
      if (quiet && !homeOn) { stopped = true; break; }
    }
    // volver a donde estaba
    if (!stopped) {
      if (startHome) { if (P.active) closeSheet(); renderProject(); }
      else if (from && P.sheets[from]) await openSheet(from);
      else showHome();
    }
    save();
    if (done && !stopped) toast(`Listo: tipo de pared completado en ${done} ${done === 1 ? 'plano' : 'planos'}.`);
    return {done, stopped};
  })().finally(() => { running = null; });
  return running;
}

/* al llegar al inicio: si hay planos con sellos de pared sin tipo, se completan solos */
export function init() {
  homeHooks.onShow = () => { if (P && pendingWallSheets().length) sweepWalls({quiet: true}); };
}
