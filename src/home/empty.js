/* Estado vacío del editor y archivos soltados o abiertos. */
import { $, esc } from '../core/constants.js';
import { RT } from '../core/state.js';
import { ask, openPanel, setTab, toast } from '../ui/app.js';
import { curSheet, isPlanFile, sheetsOf, showHome } from '../project/model.js';
import { addArqFiles, addArqPick, addPairFiles, newPairDialog } from '../project/sheets.js';
import { openProject } from '../project/archive.js';

/* --- estado vacío --- */
export function renderEmpty() {
  const e = $('#empty'), sh = curSheet();
  if (!sh || RT.A.bmp || RT.B.bmp || RT.A.loading || RT.B.loading) { e.hidden = true; return; }
  e.hidden = false;
  e.innerHTML = `<div class="card"><h2>No se encontró el archivo</h2><p>El archivo de "${esc(sh.name)}" no está guardado en este navegador. Súbalo de nuevo desde la pestaña Planos; las marcas se conservan.</p>
    <div class="stack"><button class="btn primary" data-e="planos" style="height:40px">Ir a Planos</button><button class="btn" data-e="home" style="height:40px">Inicio del proyecto</button></div></div>`;
}

export async function handleFiles(list) {
  const files = [...list];
  const ok = files.filter(isPlanFile);
  const proj = files.find(f => /\.(zip|json)$/i.test(f.name));
  if (proj && !ok.length) return openProject(proj);
  if (!ok.length) return toast('Use archivos PDF, PNG o JPG, o un proyecto .zip.');
  if (!sheetsOf('arq').length) return addArqFiles(ok);
  const v = await ask({title:'¿Qué son estos archivos?', body: ok.length === 1 ? `"${ok[0].name}"` : `${ok.length} archivos`,
    buttons:[{label:'Cancelar', value:null}, {label:'Arquitectónicos', value:'arq'}, {label: ok.length === 1 ? 'Plano de instalaciones' : 'Planos de instalaciones', value:'pair', primary:true}]});
  if (v === 'arq') addArqFiles(ok);
  else if (v === 'pair') addPairFiles(ok);
}

/* Se ejecuta una vez al arrancar, en el orden original (ver main.js). */
export function init() {
  $('#empty').addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const a = b.dataset.e;
    if (a === 'addArq') addArqPick();
    else if (a === 'open') $('#fileProject').click();
    else if (a === 'home') showHome();
    else if (a === 'newPair') newPairDialog();
    else if (a === 'planos') { setTab('planos'); openPanel(); }
  });
}
