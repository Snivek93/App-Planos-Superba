/* Modo automático: leer una lámina PDF guardada sin dibujarla (formas, textos, rótulos de diámetro). */
import { PDF_UNIT } from '../core/constants.js';
import { DB } from '../core/storage.js';
import { destroyPdf, openPdf } from '../plans/load.js';
import { extractVec, vecKey } from '../detect/vector.js';
import { annotationShapes, defaultDiam, diamLabels, textRuns } from './text.js';

export async function readPage(fileId, page = 1, step = () => {}) {
  const rec = await DB.get('file:' + fileId);
  if (!rec || !rec.blob) throw new Error('No se encontró el archivo del plano.');
  if (!(rec.blob.type === 'application/pdf' || /\.pdf$/i.test(rec.name || ''))) throw new Error('No es un PDF: el cálculo automático necesita planos PDF exportados desde CAD o Revit.');
  step('abriendo el PDF');
  const pdf = await openPdf(rec.blob, true);
  try {
    page = Math.min(Math.max(1, page), pdf.numPages);
    const pg = await pdf.getPage(page), vp = pg.getViewport({scale: PDF_UNIT});
    // la lectura vectorial no se guarda aquí: son decenas de MB por lámina y un juego completo llenaría el disco;
    // el editor la guarda cuando se abre cada plano
    step('leyendo las líneas');
    let shapes = (await DB.get(vecKey(fileId, page)))?.shapes;
    if (!shapes) shapes = await extractVec(pdf, page);
    step('leyendo los textos');
    const t = textRuns(await pg.getTextContent(), vp.transform, PDF_UNIT);
    let anns = [];
    try { anns = annotationShapes(await pg.getAnnotations(), vp.transform); } catch (e) {}
    const byKey = new Map();
    for (const s of shapes) { s.key = s.k === 'f' ? 'f' + s.c : 's' + s.c + '/' + s.w.toFixed(1); let l = byKey.get(s.key); if (!l) byKey.set(s.key, l = []); l.push(s); }
    if (anns.length) byKey.set('ann', anns);
    return {w: vp.width, h: vp.height, pages: pdf.numPages, shapes, byKey, items: t.items, lines: t.lines, labels: diamLabels(t.lines), defDiam: defaultDiam(t.lines), vectorial: shapes.length > 200};
  } finally { try { await pdf.cleanup(); } catch (e) {} destroyPdf(pdf); }
}
