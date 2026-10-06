/* PWA: service worker (funciona sin internet), aviso de versión nueva y apertura de
   archivos desde el sistema (doble clic en un PDF o en el .zip del proyecto). */
import { P } from './core/state.js';
import { persistNow } from './core/storage.js';
import { handleFiles } from './home/empty.js';

export function registerPWA() {
  if (__DEV__ || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offer = worker => showUpdate(async () => { try { await persistNow(); } catch (e) {} worker.postMessage('skipWaiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    // revisar si hay versión nueva cada hora mientras la app está abierta
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(err => console.warn('No se pudo registrar el service worker', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

function showUpdate(apply) {
  if (document.getElementById('updBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updBar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Hay una versión nueva de la app.</span><button class="btn primary" type="button">Actualizar</button><button class="btn" type="button" aria-label="Más tarde">Más tarde</button>';
  const [ok, later] = bar.querySelectorAll('button');
  ok.onclick = () => { ok.disabled = true; ok.textContent = 'Actualizando…'; apply(); };
  later.onclick = () => bar.remove();
  document.body.appendChild(bar);
}

export function handleLaunchFiles() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async params => {
    if (!params.files || !params.files.length) return;
    const files = await Promise.all(params.files.map(h => h.getFile()));
    for (let i = 0; i < 200 && !P; i++) await new Promise(r => setTimeout(r, 50)); // esperar el arranque
    handleFiles(files);
  });
}
