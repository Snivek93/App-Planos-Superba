/* Íconos SVG de la interfaz y lista de herramientas. */
/* ---------- íconos ---------- */
export function I(d) { return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`; }

export let ICON;

export const TOOLS = [
  ['select','Seleccionar','V'], ['pan','Mano','H'], '-',
  ['pen','Lápiz','P'], ['hl','Marcador','K'], ['line','Línea','L'], ['poly','Polilínea','Y'], ['rect','Rectángulo','R'], ['text','Texto','T'], '-',
  ['seal','Sello','S'], ['eraser','Borrador','E'], '-',
  ['moveB','Mover B','M']
];

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  ICON = {
    select: I('<path d="M5.5 3.5l12.5 6.3-5.4 1.8-2 5.4z"/><path d="M12.6 11.6l5 5"/>'),
    pan: I('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
    pen: I('<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/><path d="M14 6.5l3.5 3.5"/>'),
    line: I('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.7" fill="currentColor"/><circle cx="19" cy="5" r="1.7" fill="currentColor"/>'),
    poly: I('<path d="M4 18l5-10 6 6 5-9"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/><circle cx="9" cy="8" r="1.5" fill="currentColor"/><circle cx="15" cy="14" r="1.5" fill="currentColor"/><circle cx="20" cy="5" r="1.5" fill="currentColor"/>'),
    rect: I('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
    text: I('<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>'),
    seal: I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
    hl: I('<path d="M9.5 14.5l-3 3 1 1H11l1.5-1.5"/><path d="M8 13l7.5-8.5 4 4L11 16z"/><path d="M4 21h9" stroke-width="3" opacity=".45"/>'),
    eraser: I('<path d="M9 19.5h11"/><path d="M4.5 15l9.5-9.5 5 5-8.5 8.5H8z"/><path d="M9.5 10l5 5"/>'),
    moveB: I('<path d="M12 3.5l8.5 4.3-8.5 4.3-8.5-4.3z"/><path d="M3.5 12.3l8.5 4.3 8.5-4.3"/><path d="M3.5 16.6l8.5 4.3 8.5-4.3"/>'),
    undo: I('<path d="M9 6.5L4.5 11 9 15.5"/><path d="M5 11h9.5a4.5 4.5 0 010 9H12"/>'),
    redo: I('<path d="M15 6.5l4.5 4.5-4.5 4.5"/><path d="M19 11H9.5a4.5 4.5 0 000 9H12"/>'),
    fit: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    minus: I('<path d="M5 12h14"/>'),
    eye: I('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: I('<path d="M3 3l18 18"/><path d="M10.6 6.1c.5-.1.9-.1 1.4-.1 6 0 9.5 6 9.5 6a16 16 0 01-2.9 3.6M6.4 7.4C3.9 9.2 2.5 12 2.5 12S6 18 12 18c1.5 0 2.9-.4 4.1-1"/>'),
    lock: I('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
    unlock: I('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 017.6-1.7"/>'),
    more: I('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
    panel: I('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.5 4.5v15"/>'),
    trash: I('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
    home: I('<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 9.8V20h4.5v-5.5h3V20H18V9.8"/>'),
    edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  grid: I('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  list: I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/>'),
  opacity: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
  swap: I('<path d="M7 4L3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>')
  };
}
