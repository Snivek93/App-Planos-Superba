/* Descarga de archivos, lista de sellos en CSV y captura PNG. */
import { ST } from '../core/constants.js';
import { L, P, RT, S } from '../core/state.js';
import { toWorld } from '../core/geometry.js';
import { cv } from '../canvas/render.js';
import { sealFloor } from '../canvas/tables.js';
import { sealGroups, sealsSorted } from '../panels/sellos.js';
import { toast } from '../ui/app.js';
import { allLevels, floorLevels, floorMult, joinY, LOC_NAME, locOf, sealLevels, sealWeight } from '../core/levels.js';
import { floorById, frameOf } from '../plans/floors.js';

/* ---------- exportar / guardar ---------- */
export async function saveFile(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], {type:mime});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

export function baseName() {
  const n = ((P && P.name) || RT.A.name || 'proyecto').replace(/\.[^.]+$/, '').replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '-').slice(0, 50);
  return 'sellos-' + n;
}

export function exportCSV() {
  const seals = sealsSorted();
  if (!seals.length) return toast('Todavía no hay sellos para exportar.');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['No.', 'Planta', 'Niveles', 'Multiplicador', 'Ubicación', 'Tipo', 'Diámetro', 'Tubería', 'Pared', 'Origen', 'Nota', 'Capa', 'Plano', 'X', 'Y'].map(q).join(';')];
  for (const m of seals) {
    const l = L(m.layer), w = toWorld(frameOf(m), m.pts[0]);
    rows.push([m.n, sealFloor(m)?.name || '', joinY(sealLevels(m).lv), sealWeight(m), LOC_NAME[locOf(m)], ST[m.st]?.name, m.diam || '', m.sys || '', m.wall || '', m.auto ? 'Automático' : 'Manual', m.note, l.name, l.plan, Math.round(w[0]), Math.round(w[1])].map(q).join(';'));
  }
  const sumBlock = (title, list, wfn) => {
    rows.push('', [q(title), q('Pared'), q('Losa'), q('Total')].join(';'));
    for (const t of S.sealTypes) {
      const p = list.filter(x => x.st === t.id && locOf(x) === 'pared').reduce((a, x) => a + wfn(x), 0), lo = list.filter(x => x.st === t.id && locOf(x) === 'losa').reduce((a, x) => a + wfn(x), 0);
      if (p + lo) rows.push([q(t.name), p, lo, p + lo].join(';'));
    }
    const tp = list.filter(x => locOf(x) === 'pared').reduce((a, x) => a + wfn(x), 0), tl = list.filter(x => locOf(x) === 'losa').reduce((a, x) => a + wfn(x), 0);
    rows.push([q('Total'), tp, tl, tp + tl].join(';'));
  };
  sumBlock(S.floors.length ? `Resumen, todos los niveles (${joinY(allLevels())})` : 'Resumen', seals, sealWeight);
  if (S.floors.length) for (const [id, name, l] of sealGroups(seals)) {
    if (!l.length) continue;
    const fl = floorById(id), mu = floorMult(fl);
    sumBlock(fl ? `Resumen ${name}, ${mu === 1 ? 'nivel' : 'niveles'} ${joinY(floorLevels(fl))}${mu > 1 ? `, por nivel (×${mu})` : ''}` : `Resumen ${name}`, l, () => 1);
  }
  saveFile(baseName() + '.csv', '\ufeff' + rows.join('\r\n'), 'text/csv');
}

export function exportPNG() {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(cv, 0, 0);
  c.toBlob(b => { if (b) saveFile(baseName() + '-vista.png', b, 'image/png'); else toast('No se pudo crear la imagen.'); }, 'image/png');
}
