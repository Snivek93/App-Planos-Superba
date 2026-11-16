/* Modo automático: decidir cuáles líneas del plano de instalaciones son la tubería.
   Se descarta el fondo arquitectónico (líneas que coinciden con el arquitectónico o dibujadas en gris), las
   líneas muy finas (cotas, flechas de texto, achurados) y los marcos de la lámina; de lo que queda, se toman
   los estilos que realmente atraviesan alguna pared cortafuego. Sin pantalla. */
import { autoGap, findCrossings, mapper, merge, quadSegments, styleSegments } from './engine.js';

export const MIN_W = 0.55;   // grosor mínimo de una tubería (unidades del plano): por debajo son cotas y flechas
function rgb(c) { const n = parseInt(String(c).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function isGray(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c || '')) return false;
  const [r, g, b] = rgb(c), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn < 28 && mx > 70;
}
/* marco de la lámina o de un sector: casi todo el largo en pocas líneas rectas muy largas, horizontales o verticales */
function isFrame(segs) {
  const lines = merge(segs, 90); let tot = 0, big = 0, nb = 0;
  for (const l of lines) {
    const L = Math.hypot(l[2] - l[0], l[3] - l[1]); tot += L;
    if (L >= 600 && (Math.abs(l[2] - l[0]) < L*0.02 || Math.abs(l[3] - l[1]) < L*0.02)) { big += L; nb++; }
  }
  return tot > 0 && big/tot >= 0.7 && lines.length <= 14;
}
/* líneas ya unidas de un estilo: [ax, ay, bx, by, estilo] */
export function styleLines(shapes, key, vp, quads, raw) {
  const r = quads ? {segs: quadSegments(shapes, vp), boxes: []} : styleSegments(shapes, vp, raw);
  if (!r.segs.length) return {lines: [], boxes: r.boxes, segs: []};
  const lines = merge(r.segs, autoGap(r.segs)); for (const l of lines) l[4] = key;
  return {lines, boxes: r.boxes, segs: r.segs};
}
/* Revisa cada estilo del plano B. byKey: Map estilo → formas; tr: B → A; vp: zona del edificio en B;
   occ: rejilla del arquitectónico; mask: paredes. Devuelve la lista con sus datos y cuáles se eligieron. */
export function pickStyles(byKey, tr, vp, occ, mask, opt = {}) {
  const T = mapper(tr), out = [];
  for (const [key, shapes] of byKey) {
    const fill = key[0] === 'f', color = key === 'ann' ? 'ann' : key.slice(1, 8), w = fill || key === 'ann' ? 0 : +key.split('/')[1];
    if (fill && (isGray(color) || shapes.length < 20)) continue;
    const {lines, segs} = styleLines(shapes, key, vp, fill);
    let L = 0, hit = 0, ns = 0;
    for (const s of segs) {
      const l = Math.hypot(s[2] - s[0], s[3] - s[1]); L += l;
      const m = Math.max(1, Math.ceil(l/4));
      for (let q = 0; q <= m; q++) { ns++; const p = T(s[0] + (s[2] - s[0])*q/m, s[1] + (s[3] - s[1])*q/m); if (occ && occ.at(p[0], p[1])) hit++; }
    }
    if (L < 200) continue;
    const st = {key, color, w, L: Math.round(L), cov: ns ? hit/ns : 0, n: lines.length, full: 0, ends: 0, pick: false, why: ''};
    out.push(st);
    if (key === 'ann') st.why = 'anotación';
    else if (isGray(color)) { st.why = 'gris (fondo)'; continue; }
    else if (!fill && w < MIN_W) { st.why = 'línea fina'; continue; }
    else if (occ && st.cov >= 0.6) { st.why = 'coincide con el arquitectónico'; continue; }
    else if (!fill && isFrame(segs)) { st.why = 'marco'; continue; }
    const r = findCrossings(lines, tr, mask, {u: opt.u});
    for (const c of r.cross) (c.kind === 'full' || c.kind === 'bend') ? st.full++ : st.ends++;
    if (st.full >= 1) { st.pick = true; st.why = st.why || 'atraviesa paredes'; } else st.why = 'no cruza paredes';
  }
  return out;
}
