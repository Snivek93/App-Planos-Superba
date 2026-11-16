/* Motor vectorial de cruces (modo automático): a partir de las líneas del plano de instalaciones y de la
   máscara de paredes cortafuego del arquitectónico, encuentra dónde una tubería atraviesa una pared.
   No usa la pantalla ni el DOM: solo geometría, para poder probarlo aparte.

   Unidades: las líneas van en unidades del plano B; tr = {s, x, y, r} las lleva a unidades del plano A,
   donde está la máscara (mask.at(x, y) → número de pared, 0 si no hay). */

const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/* --- trozos de línea de un estilo --- */
/* Mitades de recuadro: dos trazos (de 5 puntos o más) cuyos extremos se unen formando un lazo son un recuadro
   de rótulo dibujado en dos mitades (número de circuito), no una tubería. */
function boxHalves(shapes) {
  const ends = new Map(), drop = new Set();
  shapes.forEach((s, i) => s.sp.forEach((sp, j) => {
    if (sp.length < 10) return;
    const k = Math.round(sp[0]) + ',' + Math.round(sp[1]) + '>' + Math.round(sp[sp.length-2]) + ',' + Math.round(sp[sp.length-1]);
    if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i + ':' + j);
  }));
  for (const [k, lst] of ends) {
    const [a, b] = k.split('>'), back = ends.get(b + '>' + a);
    if (back) { for (const q of lst) drop.add(q); for (const q of back) drop.add(q); }
  }
  return drop;
}
const isClosed = sp => sp.length >= 8 && Math.abs(sp[0] - sp[sp.length-2]) < 3 && Math.abs(sp[1] - sp[sp.length-1]) < 3;
function spBox(sp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < sp.length; i += 2) { if (sp[i] < x0) x0 = sp[i]; if (sp[i] > x1) x1 = sp[i]; if (sp[i+1] < y0) y0 = sp[i+1]; if (sp[i+1] > y1) y1 = sp[i+1]; }
  return [x0, y0, x1, y1];
}
/* recuadro de rótulo: figura cerrada de lados rectos, del tamaño de un texto */
function isLabelBox(sp) {
  if (!isClosed(sp) || sp.length > 12) return false;
  const b = spBox(sp), w = b[2] - b[0], h = b[3] - b[1];
  if (!(w > 25 && w < 300 && h > 10 && h < 120)) return false;
  for (let i = 2; i < sp.length; i += 2) { const dx = Math.abs(sp[i] - sp[i-2]), dy = Math.abs(sp[i+1] - sp[i-1]); if (dx > 1.5 && dy > 1.5) return false; }
  return true;
}
/* Trozos [ax, ay, bx, by] de las formas de un estilo dentro de la zona vp (unidades del plano B).
   Se descartan los símbolos cerrados pequeños, los recuadros de rótulo y sus mitades; las figuras cerradas
   grandes se conservan (tubería gruesa dibujada como polilínea cerrada). Devuelve también los recuadros. */
export function styleSegments(shapes, vp, raw) {
  const segs = [], boxes = [], drop = boxHalves(shapes);
  const inside = (x, y) => x >= vp[0] && x <= vp[2] && y >= vp[1] && y <= vp[3];
  shapes.forEach((s, i) => {
    if (s.bb && (s.bb[2] < vp[0] || s.bb[0] > vp[2] || s.bb[3] < vp[1] || s.bb[1] > vp[3])) return;
    s.sp.forEach((sp, j) => {
      if (!raw && drop.has(i + ':' + j)) { boxes.push(spBox(sp)); return; }
      if (!raw && isClosed(sp)) {
        const b = spBox(sp);
        if (Math.max(b[2] - b[0], b[3] - b[1]) < 30) return;
        if (isLabelBox(sp)) { boxes.push(b); return; }
      }
      for (let q = 0; q + 3 < sp.length; q += 2) {
        const ax = sp[q], ay = sp[q+1], bx = sp[q+2], by = sp[q+3];
        const L = dist(ax, ay, bx, by);
        if (L > 0.3 && L < 2e4 && (inside(ax, ay) || inside(bx, by))) segs.push([ax, ay, bx, by]);   // (un largo absurdo es un dato dañado del PDF)
      }
    });
  });
  // las mitades se juntan en un solo recuadro
  boxes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const b of boxes) {
    const m = merged.find(m => Math.abs(m[0] - b[0]) < 4 && Math.abs(m[2] - b[2]) < 4 && b[1] <= m[3] + 4 && b[3] >= m[1] - 4);
    if (m) { m[1] = Math.min(m[1], b[1]); m[3] = Math.max(m[3], b[3]); } else merged.push(b.slice());
  }
  return {segs, boxes: merged.filter(m => m[2] - m[0] > 25 && m[2] - m[0] < 300 && m[3] - m[1] > 10 && m[3] - m[1] < 120)};
}
/* Canastas o tuberías dibujadas como rellenos delgados (cuadriláteros): se toma su eje. */
export function quadSegments(shapes, vp) {
  const segs = [], inside = (x, y) => x >= vp[0] && x <= vp[2] && y >= vp[1] && y <= vp[3];
  for (const s of shapes) for (const sp of s.sp) {
    let n = sp.length/2;
    if (n >= 2 && sp[0] === sp[sp.length-2] && sp[1] === sp[sp.length-1]) n--;
    if (n !== 4) continue;
    const p = i => [sp[(i % 4)*2], sp[(i % 4)*2 + 1]];
    const e = [0, 1, 2, 3].map(q => dist(...p(q), ...p(q + 1)));
    const q = e[0] + e[2] <= e[1] + e[3] ? 0 : 1;
    const a = [(p(q)[0] + p(q+1)[0])/2, (p(q)[1] + p(q+1)[1])/2], b = [(p(q+2)[0] + p(q+3)[0])/2, (p(q+2)[1] + p(q+3)[1])/2];
    // rellenos de menos de 1,5 unidades de ancho son flechas y líneas de texto, no canastas
    if ((e[q] + e[(q+2) % 4])/2 >= 1.5 && dist(...a, ...b) > 3*(e[q] + e[(q+2) % 4])/2 && inside(...a) && inside(...b)) segs.push([a[0], a[1], b[0], b[1]]);
  }
  return segs;
}

/* --- unir trozos colineales (líneas punteadas, tramos partidos) --- */
const ANG = 0.035, OFF = 0.8;
export function merge(segs, G = 14) {
  const nb = Math.round(Math.PI/ANG), bins = new Map();
  for (const s of segs) {
    const dx = s[2] - s[0], dy = s[3] - s[1];
    let th = Math.atan2(dy, dx) % Math.PI; if (th < 0) th += Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th);
    const off = -uy*s[0] + ux*s[1], t0 = ux*s[0] + uy*s[1], t1 = ux*s[2] + uy*s[3];
    const k = Math.round(th/ANG) % nb;
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push([th, off, Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const out = [];
  for (const lst of bins.values()) {
    // en el casillero 0 caen ángulos cerca de 0 y cerca de π: son la misma dirección, con el desplazamiento al revés
    for (const it of lst) if (it[0] > Math.PI/2 && lst.length && Math.round(it[0]/ANG) % nb === 0) { it[0] -= Math.PI; it[1] = -it[1]; const a = -it[3], b = -it[2]; it[2] = a; it[3] = b; }
    lst.sort((a, b) => a[1] - b[1]);
    let g = [lst[0]];
    const flush = () => {
      let th = 0, off = 0; for (const r of g) { th += r[0]; off += r[1]; } th /= g.length; off /= g.length;
      const ux = Math.cos(th), uy = Math.sin(th);
      g.sort((a, b) => a[2] - b[2]);
      let s0 = g[0][2], s1 = g[0][3];
      const put = () => out.push([ux*s0 - uy*off, uy*s0 + ux*off, ux*s1 - uy*off, uy*s1 + ux*off]);
      for (let i = 1; i < g.length; i++) { if (g[i][2] <= s1 + G) s1 = Math.max(s1, g[i][3]); else { put(); s0 = g[i][2]; s1 = g[i][3]; } }
      put();
    };
    for (let i = 1; i < lst.length; i++) { if (lst[i][1] - g[g.length-1][1] <= OFF) g.push(lst[i]); else { flush(); g = [lst[i]]; } }
    flush();
  }
  return out;
}
/* separación típica entre rayas de una línea punteada: se une lo que esté hasta un poco más lejos que eso */
export function autoGap(segs) {
  const lines = merge(segs, 0), items = new Map();
  for (const l of lines) {
    let th = Math.atan2(l[3] - l[1], l[2] - l[0]) % Math.PI; if (th < 0) th += Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th), off = Math.round((-uy*l[0] + ux*l[1])/0.8), t0 = ux*l[0] + uy*l[1], t1 = ux*l[2] + uy*l[3];
    const k = Math.round(th/ANG) + '/' + off;
    if (!items.has(k)) items.set(k, []); items.get(k).push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const gaps = new Map();
  for (const iv of items.values()) {
    iv.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < iv.length; i++) { const g = iv[i][0] - iv[i-1][1]; if (g > 1 && g < 90) { const k = Math.round(g/2)*2; gaps.set(k, (gaps.get(k) || 0) + 1); } }
  }
  let mode = 0, cnt = 0;
  for (const [k, c] of gaps) if (c > cnt) { cnt = c; mode = k; }
  return cnt >= 10 ? Math.max(14, Math.min(80, mode*1.3 + 2)) : 14;
}

/* --- conexiones entre líneas --- */
function pointGrid(lines) {
  const grid = new Map();
  lines.forEach((l, i) => {
    const L = dist(l[0], l[1], l[2], l[3]), n = Math.max(2, Math.floor(L) + 2);
    for (let k = 0; k < n; k++) {
      const t = k/(n - 1), x = l[0] + (l[2] - l[0])*t, y = l[1] + (l[3] - l[1])*t, key = Math.floor(x/2) + ',' + Math.floor(y/2);
      let c = grid.get(key); if (!c) grid.set(key, c = []); c.push(i, x, y);
    }
  });
  return grid;
}
/* por cada línea: [¿el extremo a toca otra línea?, ¿el extremo b?] */
export function connectivity(lines, tol = 1.5) {
  const grid = pointGrid(lines);
  return lines.map((l, i) => [[l[0], l[1]], [l[2], l[3]]].map(e => {
    const cx = Math.floor(e[0]/2), cy = Math.floor(e[1]/2);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const c = grid.get(gx + ',' + gy); if (!c) continue;
      for (let q = 0; q < c.length; q += 3) if (c[q] !== i && Math.hypot(c[q+1] - e[0], c[q+2] - e[1]) <= tol) return true;
    }
    return false;
  }));
}
function endGrid(lines) {
  const grid = new Map();
  lines.forEach((l, i) => { for (const w of [0, 1]) { const x = l[w*2], y = l[w*2 + 1], key = Math.floor(x/2) + ',' + Math.floor(y/2); let c = grid.get(key); if (!c) grid.set(key, c = []); c.push(i, w); } });
  return grid;
}
function nearEnds(grid, lines, x, y, tol, fn) {
  const cx = Math.floor(x/2), cy = Math.floor(y/2);
  for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
    const c = grid.get(gx + ',' + gy); if (!c) continue;
    for (let q = 0; q < c.length; q += 2) { const j = c[q], w = c[q+1], l = lines[j]; if (Math.hypot(l[w*2] - x, l[w*2 + 1] - y) <= tol) fn(j, w); }
  }
}
/* grupos de líneas unidas por sus extremos */
export function components(lines, tol = 1.5) {
  const par = lines.map((_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const grid = endGrid(lines);
  lines.forEach((l, i) => { for (const w of [0, 1]) nearEnds(grid, lines, l[w*2], l[w*2 + 1], tol, j => { if (j !== i) par[find(i)] = find(j); }); });
  return lines.map((_, i) => find(i));
}
/* Fuera las marcas cortas sueltas (rayitas de cantidad de cables, símbolos de tierra, flechas). */
export function dropSmall(lines) {
  let con = connectivity(lines);
  lines = lines.filter((l, i) => dist(l[0], l[1], l[2], l[3]) >= 22 || con[i][0] || con[i][1]);
  const comp = components(lines), tot = new Map(), mx = new Map();
  lines.forEach((l, i) => { const L = dist(l[0], l[1], l[2], l[3]), c = comp[i]; tot.set(c, (tot.get(c) || 0) + L); mx.set(c, Math.max(mx.get(c) || 0, L)); });
  return lines.filter((l, i) => !(tot.get(comp[i]) < 90 && mx.get(comp[i]) < 40));
}

/* --- máscara de paredes --- */
/* d: un byte por celda (0 = sin pared, n = número de pared); k: celdas por unidad del plano A. */
export function makeMask(d, W, H, k = 1) {
  const m = {d, W, H, k, near: null};
  m.at = (x, y) => { const px = Math.floor(x*k), py = Math.floor(y*k); return px >= 0 && py >= 0 && px < W && py < H ? d[py*W + px] : 0; };
  // distancia (en unidades del plano A, hasta 20) a la pared más cercana
  m.distTo = (x, y) => {
    if (!m.near) m.near = chamfer(d, W, H);
    const px = Math.floor(x*k), py = Math.floor(y*k);
    return px >= 0 && py >= 0 && px < W && py < H ? m.near[py*W + px]/3/k : 99;
  };
  return m;
}
function chamfer(d, W, H) {
  const D = new Uint8Array(W*H), CAP = 255;
  for (let i = 0; i < W*H; i++) D[i] = d[i] ? 0 : CAP;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y*W + x; let v = D[i]; if (!v) continue;
    if (x > 0 && D[i-1] + 3 < v) v = D[i-1] + 3;
    if (y > 0) { if (D[i-W] + 3 < v) v = D[i-W] + 3; if (x > 0 && D[i-W-1] + 4 < v) v = D[i-W-1] + 4; if (x < W - 1 && D[i-W+1] + 4 < v) v = D[i-W+1] + 4; }
    D[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y*W + x; let v = D[i]; if (!v) continue;
    if (x < W - 1 && D[i+1] + 3 < v) v = D[i+1] + 3;
    if (y < H - 1) { if (D[i+W] + 3 < v) v = D[i+W] + 3; if (x < W - 1 && D[i+W+1] + 4 < v) v = D[i+W+1] + 4; if (x > 0 && D[i+W-1] + 4 < v) v = D[i+W-1] + 4; }
    D[i] = v;
  }
  return D;
}

/* --- cruces --- */
export function mapper(tr) {
  const c = Math.cos(tr.r || 0)*tr.s, s = Math.sin(tr.r || 0)*tr.s;
  return (x, y) => [c*x - s*y + tr.x, s*x + c*y + tr.y];
}
const STEP = 0.4;
/* Recorre un camino (puntos en unidades del plano A) y devuelve los tramos que pasan por pared con plano libre
   a ambos lados: eso es un cruce completo. */
function crossPath(P, mask, o) {
  const xs = [], ys = [], seg = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const A = P[i], B = P[i+1], L = dist(A[0], A[1], B[0], B[1]); if (L < 1e-6) continue;
    const n = Math.floor(L/STEP) + 1;
    for (let k = 0; k < n; k++) { const t = k/n; xs.push(A[0] + (B[0] - A[0])*t); ys.push(A[1] + (B[1] - A[1])*t); seg.push(i); }
  }
  const last = P[P.length - 1]; xs.push(last[0]); ys.push(last[1]); seg.push(Math.max(0, P.length - 2));
  const n = xs.length, out = []; if (n < 3) return out;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i-1] + Math.hypot(xs[i] - xs[i-1], ys[i] - ys[i-1]);
  let j = 0;
  while (j < n) {
    const w = mask.at(xs[j], ys[j]);
    if (!w) { j++; continue; }
    const j0 = j, votes = new Map();
    while (j < n) { const v = mask.at(xs[j], ys[j]); if (!v) break; votes.set(v, (votes.get(v) || 0) + 1); j++; }
    const run = cum[j-1] - cum[j0] + STEP;
    if (cum[j0] >= o.minOut && cum[n-1] - cum[j-1] >= o.minOut && run <= o.maxRun) {
      const m = (j0 + j - 1) >> 1, A = P[seg[m]], B = P[seg[m] + 1], L = dist(A[0], A[1], B[0], B[1]) || 1;
      let wall = 0, bc = 0; for (const [v, c] of votes) if (c > bc) { bc = c; wall = v; }
      out.push({x: xs[m], y: ys[m], dx: (B[0] - A[0])/L, dy: (B[1] - A[1])/L, run, wall});
    }
  }
  return out;
}
/* ancho de pared libre a los lados del cruce: si es poco, el cruce está en la punta o esquina de la pared */
function sideRoom(c, mask, maxk = 14) {
  let best = Infinity;
  for (const sg of [1, -1]) {
    let k = 0;
    while (k < maxk && mask.at(c.x - sg*c.dy*(k + 0.5), c.y + sg*c.dx*(k + 0.5))) k += 0.5;
    best = Math.min(best, k);
  }
  return best;
}

/* Cruces de un juego de líneas (unidades del plano B) con las paredes.
   lines: [ax, ay, bx, by, estilo]; opciones: ends (líneas que terminan en la pared), boxes (recuadros de rótulo),
   maxRun (espesor máximo de pared), onWall (quitar líneas que corren sobre la pared). Devuelve los cruces en
   unidades del plano A, con (bx, by) en unidades del plano B para buscar su rótulo de diámetro. */
export function findCrossings(lines, tr, mask, opt = {}) {
  // u: escala del arquitectónico respecto a uno 1:100 (las paredes miden el doble de unidades en uno 1:50)
  const u = opt.u || 1, o = {minOut: 2*u, maxRun: 16*u, ends: true, onWall: true, ...opt};
  const T = mapper(tr), inv = 1/tr.s;
  // líneas que corren sobre la pared cortafuego (la pared resaltada en el plano de instalaciones): no son tubería
  if (o.onWall) lines = lines.filter(l => {
    const A = T(l[0], l[1]), B = T(l[2], l[3]), L = dist(A[0], A[1], B[0], B[1]);
    if (L < 15*u) return true;
    const n = Math.floor(L) + 2; let hits = 0;
    for (let q = 0; q < n; q++) { const t = q/(n - 1); if (mask.distTo(A[0] + (B[0] - A[0])*t, A[1] + (B[1] - A[1])*t) < 6*u) hits++; }
    return hits/n < 0.5;
  });
  if (!o.keepSmall) lines = dropSmall(lines);
  const con = connectivity(lines), cr = [];
  const add = (c, l, kind) => { c.kind = kind; c.key = l[4]; if (l.wd) c.wd = l.wd; cr.push(c); };
  // 1) la línea atraviesa la pared
  lines.forEach(l => {
    const A = T(l[0], l[1]), B = T(l[2], l[3]);
    if (dist(A[0], A[1], B[0], B[1]) < 4) return;
    for (const c of crossPath([A, B], mask, o)) add(c, l, 'full');
  });
  // 2) la tubería dobla justo en la pared: se sigue el camino por la unión de dos tramos
  const eg = endGrid(lines);
  lines.forEach((l, i) => { for (const w of [0, 1]) nearEnds(eg, lines, l[w*2], l[w*2 + 1], 1.5, (j, w2) => {
    if (j <= i) return;
    const m = lines[j], o1 = w ? [l[0], l[1]] : [l[2], l[3]], o2 = w2 ? [m[0], m[1]] : [m[2], m[3]];
    for (const c of crossPath([T(...o1), T(l[w*2], l[w*2 + 1]), T(...o2)], mask, o)) add(c, l, 'bend');
  }); });
  // 3) la línea llega de un lado y termina en la pared o apenas la pasa (equipo en la pared, penetración tipo membrana),
  //    o termina justo antes de la pared apuntando hacia ella
  if (o.ends) lines.forEach((l, i) => {
    for (const w of [0, 1]) {
      if (con[i][w]) continue;
      const E = T(l[w*2], l[w*2 + 1]), O = T(l[(1-w)*2], l[(1-w)*2 + 1]), L = dist(E[0], E[1], O[0], O[1]);
      if (L < o.minOut + 1) continue;
      const ux = (E[0] - O[0])/L, uy = (E[1] - O[1])/L;
      // hacia atrás: el extremo está dentro de la pared o la acaba de pasar
      let k = 0; while (k <= 2.5*u && !mask.at(E[0] - ux*k, E[1] - uy*k)) k += STEP;
      if (k <= 2.5*u) {
        const k0 = k; while (k - k0 < o.maxRun && mask.at(E[0] - ux*k, E[1] - uy*k)) k += STEP;
        if (k - k0 < o.maxRun && L - k >= o.minOut) { const km = (k0 + k)/2; add({x: E[0] - ux*km, y: E[1] - uy*km, dx: ux, dy: uy, run: k - k0, wall: mask.at(E[0] - ux*km, E[1] - uy*km)}, l, 'end'); continue; }
      }
      // hacia adelante: termina a punto de entrar a la pared
      if (mask.at(E[0], E[1])) continue;
      k = 0; while (k <= 3.5*u && !mask.at(E[0] + ux*k, E[1] + uy*k)) k += STEP;
      if (k > 3.5*u) continue;
      const k0 = k; while (k - k0 < o.maxRun && mask.at(E[0] + ux*k, E[1] + uy*k)) k += STEP;
      if (k - k0 >= o.maxRun) continue;
      const km = (k0 + k)/2; add({x: E[0] + ux*km, y: E[1] + uy*km, dx: ux, dy: uy, run: k - k0, wall: mask.at(E[0] + ux*km, E[1] + uy*km)}, l, 'stub');
    }
  });
  // 4) la línea termina en un recuadro de rótulo (circuito) que está sobre la pared: un sello donde el recuadro toca la pared
  if (o.boxes && o.boxes.length) {
    const comp = components(lines), crossed = new Set();
    for (const c of cr) { const qx = ((c.x - tr.x)*Math.cos(-(tr.r || 0)) - (c.y - tr.y)*Math.sin(-(tr.r || 0)))*inv, qy = ((c.x - tr.x)*Math.sin(-(tr.r || 0)) + (c.y - tr.y)*Math.cos(-(tr.r || 0)))*inv; lines.forEach((l, i) => { if (segDist(qx, qy, l) < 3) crossed.add(comp[i]); }); }
    lines.forEach((l, i) => {
      if (crossed.has(comp[i])) return;
      for (const w of [0, 1]) {
        if (con[i][w]) continue;
        const ex = l[w*2], ey = l[w*2 + 1], ox = l[(1-w)*2], oy = l[(1-w)*2 + 1];
        for (const b of o.boxes) {
          if (!(ex >= b[0] - 3 && ex <= b[2] + 3 && ey >= b[1] - 3 && ey <= b[3] + 3) || (ox > b[0] + 2 && ox < b[2] - 2 && oy > b[1] + 2 && oy < b[3] - 2)) continue;
          const E = T(ex, ey); let best = null, bd = Infinity, n = 0;
          const c0 = T(b[0], b[1]), c1 = T(b[2], b[3]);
          for (let y = Math.min(c0[1], c1[1]); y <= Math.max(c0[1], c1[1]); y += 1) for (let x = Math.min(c0[0], c1[0]); x <= Math.max(c0[0], c1[0]); x += 1) {
            const v = mask.at(x, y); if (!v) continue; n++;
            const d = (x - E[0])**2 + (y - E[1])**2; if (d < bd) { bd = d; best = [x, y, v]; }
          }
          if (n >= 4) { const L = dist(l[0], l[1], l[2], l[3]) || 1; add({x: best[0], y: best[1], dx: (l[2] - l[0])/L, dy: (l[3] - l[1])/L, run: 0, wall: best[2]}, l, 'box'); }
          break;
        }
      }
    });
  }
  // un solo sello por cruce
  const out = [];
  for (const c of cr) {
    if (out.some(e => { const d = Math.hypot(c.x - e.x, c.y - e.y); return d < (o.dedupe || 2*u) && (o.dedupe || Math.abs(c.dx*e.dx + c.dy*e.dy) > 0.9 || d < 1.5*u); })) continue;
    c.corner = c.kind !== 'box' && sideRoom(c, mask, 14*u) < 12*u;
    const rr = -(tr.r || 0), qx = c.x - tr.x, qy = c.y - tr.y;
    c.bx = (qx*Math.cos(rr) - qy*Math.sin(rr))*inv; c.by = (qx*Math.sin(rr) + qy*Math.cos(rr))*inv;
    out.push(c);
  }
  return {cross: out, lines};
}
function segDist(px, py, l) {
  const dx = l[2] - l[0], dy = l[3] - l[1], L = dx*dx + dy*dy;
  const t = L ? Math.max(0, Math.min(1, ((px - l[0])*dx + (py - l[1])*dy)/L)) : 0;
  return Math.hypot(l[0] + t*dx - px, l[1] + t*dy - py);
}
export { segDist };

/* Ductos y canastas dibujados con sus dos bordes: se toma el eje entre cada par de líneas paralelas
   (entre 6 y 75 unidades de separación) y el ancho. Devuelve [ax, ay, bx, by, estilo, ancho]. */
export function ductAxes(lines) {
  const info = [];
  for (const l of lines) {
    const L = dist(l[0], l[1], l[2], l[3]); if (L < 25) continue;
    let th = Math.atan2(l[3] - l[1], l[2] - l[0]) % Math.PI; if (th < 0) th += Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th), t0 = ux*l[0] + uy*l[1], t1 = ux*l[2] + uy*l[3];
    info.push([th, -uy*l[0] + ux*l[1], Math.min(t0, t1), Math.max(t0, t1), l[4]]);
  }
  const out = [];
  info.forEach((a, i) => {
    let best = null;
    info.forEach((b, j) => {
      if (j === i) return;
      let dth = Math.abs(a[0] - b[0]); dth = Math.min(dth, Math.PI - dth); if (dth > 0.03) return;
      // cerca de la horizontal un ángulo puede quedar como 0 y el otro como π: el desplazamiento cambia de signo
      const off2 = Math.abs(a[0] - b[0]) > 1 ? -b[1] : b[1], u0 = Math.abs(a[0] - b[0]) > 1 ? -b[3] : b[2], u1 = Math.abs(a[0] - b[0]) > 1 ? -b[2] : b[3];
      const dof = off2 - a[1]; if (!(dof > 6 && dof < 75)) return;
      const lo = Math.max(a[2], u0), hi = Math.min(a[3], u1); if (hi - lo < 25) return;
      if (!best || dof < best[0]) best = [dof, lo, hi];
    });
    if (!best) return;
    const ux = Math.cos(a[0]), uy = Math.sin(a[0]), oc = a[1] + best[0]/2;
    out.push([ux*best[1] - uy*oc, uy*best[1] + ux*oc, ux*best[2] - uy*oc, uy*best[2] + ux*oc, a[4], best[0]]);
  });
  return out;
}

/* espesor típico de las paredes de la máscara (unidades del plano A): la mediana del lado corto de cada tramo */
export function wallThickness(mask) {
  const {d, W, H, k} = mask, v = [];
  const stepY = Math.max(1, Math.floor(H/400)), stepX = Math.max(1, Math.floor(W/600));
  for (let y = 0; y < H; y += stepY) for (let x = 0; x < W; x += stepX) {
    if (!d[y*W + x]) continue;
    let a = x, b = x, c = y, e = y;
    while (a > 0 && d[y*W + a - 1] && x - a < 200) a--; while (b < W - 1 && d[y*W + b + 1] && b - x < 200) b++;
    while (c > 0 && d[(c - 1)*W + x] && y - c < 200) c--; while (e < H - 1 && d[(e + 1)*W + x] && e - y < 200) e++;
    v.push(Math.min(b - a + 1, e - c + 1)/k);
  }
  v.sort((p, q) => p - q);
  return v.length ? v[v.length >> 1] : 0;
}

/* Cierra los cortes pequeños de la máscara (marcas o texto dibujados sobre la pared, uniones entre tramos):
   une píxeles de pared separados por hasta g celdas en la misma fila o columna. */
export function closeGaps(d, W, H, g) {
  for (let y = 0; y < H; y++) {
    let last = -1, o = y*W;
    for (let x = 0; x < W; x++) if (d[o + x]) { if (last >= 0 && x - last > 1 && x - last <= g + 1) d.fill(d[o + last], o + last + 1, o + x); last = x; }
  }
  for (let x = 0; x < W; x++) {
    let last = -1;
    for (let y = 0; y < H; y++) if (d[y*W + x]) { if (last >= 0 && y - last > 1 && y - last <= g + 1) { const v = d[last*W + x]; for (let q = last + 1; q < y; q++) d[q*W + x] = v; } last = y; }
  }
}
