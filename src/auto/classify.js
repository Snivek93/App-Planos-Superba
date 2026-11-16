/* Modo automático: a partir de la carpeta y el nombre de cada archivo se propone qué es (arquitectónico,
   plano de instalaciones o algo que no se usa), en qué sección y subsección va y de qué nivel es.
   Es solo una propuesta: el usuario la revisa antes de calcular. Sin pantalla. */
const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/* [patrón sobre carpeta o nombre, sección, subsección, bajo losa, ductos] — de lo más específico a lo general */
const SUBS = [
  [/PLUVIAL/, 'mec', 'Pluvial', true],
  [/RESIDUAL|SANITARI|NEGRAS|SERVIDAS|DRENAJE/, 'mec', 'Sanitario', true],
  [/CALIENTE/, 'mec', 'Agua caliente'],
  [/POTABLE|AGUA FRIA/, 'mec', 'Agua potable'],
  [/GASES? MED|OXIGENO/, 'mec', 'Gases médicos'],
  [/COMBUSTIBLE|GAS LP|\bGLP\b/, 'mec', 'Combustible'],
  [/REFRIGERA/, 'mec', 'Refrigeración'],
  [/EXTRACCION|VENTILACION|INYECCION/, 'mec', 'Extracción', false, true],
  [/SALIDAS? (DE )?AIRE|ALIMENTACION.*AIRE/, 'ele', 'Aire acondicionado'],
  [/AIRES? ACONDICIONADO|CLIMATIZA|\bHVAC\b|DUCTOS?\b/, null, 'Aire acondicionado', false, true],
  [/ROCIADOR|SUPRESION|CONTRA ?INCENDIO|\bSCI\b/, 'inc', ''],
  [/DETECCION|ALARMA/, 'ele', 'Detección de incendio'],
  [/INCENDIO/, null, 'Incendio'],
  [/ILUMINA|LUMINARIA|ALUMBRADO|(?:^|\/ )\d*\.? ?IL\b/, 'ele', 'Iluminación'],
  [/TOMACORRIENTE|\bTOMAS\b/, 'ele', 'Tomacorrientes'],
  [/SALIDAS? ESPECIAL/, 'ele', 'Salidas especiales'],
  [/PUESTA A TIERRA|\bTIERRAS?\b|PARARRAYO/, 'ele', 'Puesta a tierra'],
  [/CANASTA|BANDEJA|ESCALERILLA/, 'ele', 'Canastas'],
  [/ESTRUCTURADO|\bDATOS\b|\bVOZ\b|TELECOM|\bRED\b/, 'ele', 'Cableado estructurado'],
  [/SONIDO|VOCEO|\bAUDIO\b/, 'ele', 'Sonido'],
  [/CAMARA|CCTV/, 'ele', 'CCTV'],
  [/CONTROL.{0,4}ACCESO/, 'ele', 'Control de accesos'],
  [/\bROBO\b|INTRUSION/, 'ele', 'Robo'],
  [/\bTV\b|TELEVISION/, 'ele', 'TV'],
  [/\bBAS\b|\bBMS\b|AUTOMATIZA/, null, 'BAS'],
  [/CANALIZA|ACOMETIDA|ALIMENTADOR/, 'ele', 'Canalización'],
];
const SKIP = /DETALLE|DIAGRAMA|UNIFILAR|TABLERO|TABLA|CUADRO|NOTAS|SIMBOLOG|ISOMETR|ELEVACION|CORTE|SECCION|FACHADA|PORTADA|INDICE|ESPECIFICAC|CORRIDAS|ESQUEMA|[-_ ]D[EI](?:[-_ ]|$)/;

export function levelOf(name) {
  const s = clean(name);
  let m = s.match(/(?:^|[^A-Z0-9])(?:N|NIVEL|PISO|LEVEL|L)[-_ .]?(\d{1,2})(?![0-9A-Z])/);
  if (m) return 'N' + (+m[1]);
  m = s.match(/(?:^|[^A-Z0-9])(?:S|SOTANO)[-_ .]?(\d)(?![0-9A-Z])/);
  if (m) return 'S' + (+m[1]);
  if (/SOTANO/.test(s)) return 'S1';
  if (/PLANTA BAJA|(?:^|[^A-Z])PB(?![A-Z])/.test(s)) return 'N1';
  if (/AZOTEA|TECHO|CUBIERTA/.test(s)) return 'TE';
  return '';
}
/* nombre de carpeta sin el número de orden: "05.TOMACORRIENTES" → "Tomacorrientes" */
function folderTitle(f) {
  const t = String(f || '').replace(/^\s*\d+\s*[.\-_)]\s*/, '').replace(/[_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
}
/* path: "carpeta/subcarpeta/archivo.pdf" (o solo el nombre). Devuelve
   {kind: 'arq' | 'ins' | 'skip', sec: 'ele' | 'mec' | 'inc' | '', sub, below, duct, level, why} */
export function classify(path) {
  const parts = String(path).split('/').filter(Boolean), file = parts.pop() || '', base = file.replace(/\.[^.]+$/, '');
  const F = clean(parts.join(' / ')), N = clean(base), all = F + ' / ' + N;
  const out = {kind: 'ins', sec: '', sub: '', below: false, duct: false, level: levelOf(base) || levelOf(parts[parts.length - 1] || ''), why: ''};
  // disciplina: por la carpeta o por la letra del código de lámina (…-A-…, …-E-…, …-M-…)
  const code = (N.match(/(?:^|[-_ ])([AEMSP])[-_ ]?(?:LA|L|PL)?[-_ ]?\d{2,4}/) || [])[1] || '';
  let disc = /ARQUITECT|\bARQ\b/.test(F) ? 'arq' : /ELECTRIC|\bELEC\b/.test(F) ? 'ele' : /MECANIC|\bMEC\b|PLOMERIA|HIDRAULIC|SANITARI/.test(F) ? 'mec' : /ESTRUCTURA/.test(F) ? 'est' : '';
  if (!disc) disc = {A: 'arq', E: 'ele', M: 'mec', P: 'mec', S: 'est'}[code] || '';
  if (!disc && /ARQUITECT|\bARQ\b|PLANTA ARQ|DISTRIBUCION/.test(N)) disc = 'arq';
  if (disc === 'est') { out.kind = 'skip'; out.why = 'estructural'; return out; }
  if (disc === 'arq') {
    out.kind = SKIP.test(N) ? 'skip' : 'arq'; out.why = out.kind === 'skip' ? 'no es planta' : '';
    return out;
  }
  const hit = SUBS.find(r => r[0].test(F)) || SUBS.find(r => r[0].test(N));
  if (hit) { out.sec = hit[1] || disc; out.sub = hit[2]; out.below = !!hit[3]; out.duct = !!hit[4] && (hit[1] || disc) !== 'ele'; }
  else out.sec = disc;
  // la subsección toma el nombre de la carpeta si la hay (así queda como en los planos)
  const folder = folderTitle(parts[parts.length - 1]);
  if (folder && parts.length >= 1 && !/^(ELECTRIC|MECANIC|ARQUITECT|PLANOS?)\w*([ _]\d+)?$/.test(clean(folder)) && out.sec !== 'inc') out.sub = hit && hit[2] && folder.split(/\s+/).length > 3 ? hit[2] : folder;
  if (out.sec === 'mec' && out.sub === 'Incendio') { out.sec = 'inc'; out.sub = ''; }
  if (out.sec === 'ele' && out.sub === 'Incendio') out.sub = 'Detección de incendio';
  if (!out.sec) out.sec = 'ele';
  if (SKIP.test(N)) { out.kind = 'skip'; out.why = 'no es planta (detalle, diagrama o tabla)'; }
  return out;
}
