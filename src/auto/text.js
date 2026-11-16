/* Textos de una página PDF para el modo automático (sin pantalla): rótulos de ejes, de diámetro y títulos.
   Misma lectura que usa la alineación por ejes del editor, pero sobre una página suelta. */
const apT = (m, x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
function undouble(s) {
  for (const k of [3, 2]) {
    if (s.length < k*2 || s.length % k) continue;
    let ok = true;
    for (let i = 0; i < s.length && ok; i += k) for (let j = 1; j < k; j++) if (s[i+j] !== s[i]) { ok = false; break; }
    if (ok) { let o = ''; for (let i = 0; i < s.length; i += k) o += s[i]; return o; }
  }
  return s;
}
/* tc: resultado de page.getTextContent(); VT: transformación de la página a unidades del plano; U: unidades por punto */
export function textRuns(tc, VT, U = 2) {
  const raw = [], items = []; let cur = null;
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    const t = it.transform, h = Math.hypot(t[2], t[3]) || 4, n = Math.hypot(t[0], t[1]) || 1, dx = t[0]/n, dy = t[1]/n;
    const sx = t[4], sy = t[5], ex = sx + dx*it.width, ey = sy + dy*it.width;
    // cada trozo de texto por separado (los rótulos de eje vienen así): centro del texto
    if (it.str.trim() && it.str.trim().length <= 4) { const q = apT(VT, (sx + ex)/2 - dy*h*0.35, (sy + ey)/2 + dx*h*0.35); items.push({s: undouble(it.str.trim()), x:q[0], y:q[1], h:h*U}); }
    if (cur && Math.hypot(sx - cur.ex, sy - cur.ey) < h*1.3) { cur.str += it.str; cur.ex = ex; cur.ey = ey; }
    else { cur = {str:it.str, sx, sy, ex, ey, h}; raw.push(cur); }
  }
  const words = [], lines = [];
  for (const r of raw) {
    const str = undouble(r.str), L = Math.hypot(r.ex - r.sx, r.ey - r.sy) || 1, ux = (r.ex - r.sx)/L, uy = (r.ey - r.sy)/L;
    // el texto se lee hacia arriba de la línea base: el centro queda a 0,35 de la altura, perpendicular al texto
    const put = (txt, along, to) => { const q = apT(VT, r.sx + ux*along - uy*r.h*0.35, r.sy + uy*along + ux*r.h*0.35), q0 = apT(VT, r.sx, r.sy); to.push({s:txt, x:q[0], y:q[1], h:r.h*U, x0:q0[0], y0:q0[1]}); };
    if (str.trim()) put(str.trim(), L/2, lines);
    const toks = [...str.matchAll(/\S+/g)];
    if (toks.length <= 1) { if (str.trim()) put(str.trim(), L/2, words); continue; }
    toks.forEach((t, i) => {
      const tw = Math.min(L/2, t[0].length*r.h*0.6);
      put(t[0], i === 0 ? tw/2 : i === toks.length - 1 ? L - tw/2 : (t.index + t[0].length/2)/str.length*L, words);
    });
  }
  return {words, lines, items};
}

const DIAM_RE = /[øØ⌀Φφ∅]\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(mm|"|”|''|pulg|in)?/g;
const NOM = new Set([13, 15, 19, 20, 25, 32, 38, 40, 50, 63, 65, 75, 80, 90, 100, 110, 125, 150, 160, 200, 250, 300]);
function diamLabel(v, unit) {
  v = v.replace(/\s+/g, '').replace(',', '.');
  return /\//.test(v) || (unit && unit !== 'mm') ? `ø${v}"` : `ø${v} mm`;
}
/* rótulos de diámetro de la página: [{x, y, d}] */
export function diamLabels(lines) {
  const out = [];
  for (const r of lines) { DIAM_RE.lastIndex = 0; let m; while ((m = DIAM_RE.exec(r.s))) out.push({x:r.x, y:r.y, d:diamLabel(m[1], m[2])}); }
  if (!out.length) {
    const RE = /(?:^|[^\d.,])(\d{2,3})\s*mm\b/gi;
    for (const r of lines) { RE.lastIndex = 0; let m; while ((m = RE.exec(r.s))) if (NOM.has(+m[1])) out.push({x:r.x, y:r.y, d:`ø${m[1]} mm`}); }
  }
  return out;
}
/* diámetro de lo que no trae rótulo, si una nota general lo dice ("tubería no indicada será de 13 mm") */
export function defaultDiam(lines) {
  for (const r of lines) {
    const m = r.s.match(/NO\s+(?:SE\s+)?INDICAD[AO]S?.{0,60}?(\d{2,3})\s*mm/i) || r.s.match(/(\d{2,3})\s*mm.{0,40}?(?:SALVO|EXCEPTO|A\s+MENOS).{0,30}?INDI/i);
    if (m && NOM.has(+m[1])) return `ø${m[1]} mm`;
  }
  return '';
}

/* Anotaciones del PDF dibujadas como líneas (tuberías agregadas a mano sobre el plano): se leen como formas.
   No se toman las flechas ni las cotas. */
export function annotationShapes(anns, VT) {
  const out = [];
  const flat = v => !v ? [] : typeof v[0] === 'number' ? Array.from(v) : v.flatMap(p => [p.x, p.y]);
  const add = pts => {
    if (pts.length < 4) return;
    const sp = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) { const q = apT(VT, pts[i], pts[i+1]); sp[i] = q[0]; sp[i+1] = q[1]; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < sp.length; i += 2) { x0 = Math.min(x0, sp[i]); x1 = Math.max(x1, sp[i]); y0 = Math.min(y0, sp[i+1]); y1 = Math.max(y1, sp[i+1]); }
    out.push({k:'s', c:'ann', w:0, sp:[sp], cv:false, eo:false, bb:[x0, y0, x1, y1], key:'ann'});
  };
  for (const a of anns || []) {
    const t = a.subtype;
    if (t === 'PolyLine' || t === 'Polygon') add(flat(a.vertices));
    else if (t === 'Ink') for (const l of a.inkLists || []) add(flat(l));
    else if (t === 'Line' && a.lineCoordinates && !(a.lineEndings || []).some(e => e && e !== 'None')) add(Array.from(a.lineCoordinates));
  }
  return out;
}
