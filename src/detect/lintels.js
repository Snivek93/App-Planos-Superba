/* Cargadores (dinteles) cortafuego sobre puertas.
   Entre dos paredes cortafuego alineadas suele haber una puerta; encima va un cargador que también
   es cortafuego y por ahí pueden pasar tuberías. Se busca en la capa de paredes ya resaltada:
   un hueco entre dos tramos de pared en línea, con largo de puerta (entre 2,5 y 16 veces el grosor)
   y con el arco de giro de una puerta dibujado en el hueco. Es una ayuda: lo que falte o sobre se
   corrige con "Afinar paredes" (agregar o quitar). */

/* m: 1 donde hay pared (W×H, fila por fila). Devuelve huecos en píxeles {x1, x2, y0, y1}. */
function gapsRows(m, W, H, maxGap) {
  const out = [], open = [];
  for (let y = 0; y < H; y++) {
    const row = y*W, runs = [];
    let x = 0;
    while (x < W) {
      while (x < W && !m[row + x]) x++;
      if (x >= W) break;
      const s = x; while (x < W && m[row + x]) x++;
      runs.push([s, x - 1]);
    }
    const cand = [];
    for (let i = 1; i < runs.length; i++) {
      const g = runs[i][0] - runs[i-1][1] - 1;
      if (g >= 3 && g <= maxGap) cand.push({x1:runs[i-1][1] + 1, x2:runs[i][0] - 1, l1:runs[i-1][1] - runs[i-1][0] + 1, l2:runs[i][1] - runs[i][0] + 1});
    }
    for (const g of open) g.hit = false;
    for (const c of cand) {
      const g = open.find(o => !o.hit && o.y1 === y - 1 && Math.abs(o.x1 - c.x1) <= 2 && Math.abs(o.x2 - c.x2) <= 2);
      if (g) { g.y1 = y; g.hit = true; g.l1 = Math.min(g.l1, c.l1); g.l2 = Math.min(g.l2, c.l2); g.sx1 += c.x1; g.sx2 += c.x2; g.n++; }
      else open.push({y0:y, y1:y, x1:c.x1, x2:c.x2, sx1:c.x1, sx2:c.x2, n:1, l1:c.l1, l2:c.l2, hit:true});
    }
    for (let i = open.length - 1; i >= 0; i--) if (!open[i].hit) { out.push(open[i]); open.splice(i, 1); }
  }
  out.push(...open);
  return out.map(g => ({x1: Math.round(g.sx1/g.n), x2: Math.round(g.sx2/g.n), y0:g.y0, y1:g.y1, l1:g.l1, l2:g.l2}));
}
/* grosor de la pared en la columna x alrededor de la fila y (cuenta hacia arriba y abajo) */
function thickAt(m, W, H, x, y) {
  if (x < 0 || x >= W || !m[y*W + x]) return 0;
  let a = y, b = y;
  while (a > 0 && m[(a-1)*W + x]) a--;
  while (b < H - 1 && m[(b+1)*W + x]) b++;
  return b - a + 1;
}
function accept(m, W, H, g) {
  const h = g.y1 - g.y0 + 1, G = g.x2 - g.x1 + 1, ym = (g.y0 + g.y1) >> 1;
  if (h < 2 || G < 2.5*h || G > 16*h) return false;        // largo de puerta respecto del grosor de pared
  if (g.l1 < 0.6*h || g.l2 < 0.6*h) return false;           // hay pared a ambos lados
  const t1 = thickAt(m, W, H, g.x1 - 1, ym), t2 = thickAt(m, W, H, g.x2 + 1, ym);
  return t1 >= 0.6*h && t2 >= 0.6*h;
}

/* ¿Hay una puerta dibujada en el hueco? Se busca el arco de giro de la hoja en la lectura vectorial:
   trazos cuyos puntos quedan a la distancia del hueco (radio) de uno de sus extremos, cubriendo al menos
   ~35° de giro hacia un lado de la pared (una hoja), o dos arcos de radio la mitad (puerta doble).
   Los arcos suelen venir en el PDF como muchos trazos rectos cortos o como curvas; sirven ambos.
   Coordenadas del plano. */
function arcCover(strokes, hx, hy, ux, uy, sgn, R) {
  const nx = -uy*sgn, ny = ux*sgn, lo = R*0.86, hi = R*1.14;
  const ang = (x, y) => { const dx = x - hx, dy = y - hy, a = dx*ux + dy*uy, b = dx*nx + dy*ny; return Math.atan2(b, a)*180/Math.PI; };
  const segs = [];
  for (const s of strokes) {
    const b = s.bb; if (b[2] < hx - hi || b[0] > hx + hi || b[3] < hy - hi || b[1] > hy + hi) continue;
    if (b[2] - b[0] > 1.25*R || b[3] - b[1] > 1.25*R) continue; // forma más grande que una hoja de puerta (fachadas curvas, ejes)
    if (Math.max(b[2] - b[0], b[3] - b[1]) < 0.07*R) continue; // símbolos pequeños (puntos, rombos, letras)
    for (const sp of s.sp) for (let i = 2; i < sp.length; i += 2) {
      const x0 = sp[i-2], y0 = sp[i-1], x1 = sp[i], y1 = sp[i+1];
      const r0 = Math.hypot(x0 - hx, y0 - hy), r1 = Math.hypot(x1 - hx, y1 - hy);
      if (r0 < lo || r0 > hi || r1 < lo || r1 > hi) continue;
      const sl = Math.hypot(x1 - x0, y1 - y0);
      if (!s.cv && (sl > 0.3*R || sl < 0.04*R)) continue; // ni trazos largos (no es arco) ni migajas (textos, achurados)
      if (!s.cv && sl > 1e-6) { // el trazo debe ir a lo largo del arco (tangente), no hacia el centro
        const mx = (x0 + x1)/2 - hx, my = (y0 + y1)/2 - hy, mr = Math.hypot(mx, my) || 1;
        if (Math.abs(((x1 - x0)*mx + (y1 - y0)*my)/(sl*mr)) > 0.42) continue;
      }
      let a0 = ang(x0, y0), a1 = ang(x1, y1); if (a0 > a1) [a0, a1] = [a1, a0];
      if (a1 < -3 || a0 > 95 || a1 - a0 > 100) continue;
      segs.push({x0, y0, x1, y1, a0, a1, cv: !!s.cv, d: (Math.atan2(y1 - y0, x1 - x0)*180/Math.PI + 360) % 180});
    }
  }
  if (!segs.length) return 0;
  // un arco de verdad es una cadena continua de trazos (se tocan en los extremos); las escaleras y
  // achurados dejan trazos sueltos a la misma distancia, que no forman cadena
  const par = segs.map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const tol = Math.max(0.035*R, 0.5), near = (ax, ay, bx, by) => Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const p = segs[i], q = segs[j];
    if (near(p.x0, p.y0, q.x0, q.y0) || near(p.x0, p.y0, q.x1, q.y1) || near(p.x1, p.y1, q.x0, q.y0) || near(p.x1, p.y1, q.x1, q.y1)) par[find(i)] = find(j);
  }
  const comp = new Map();
  for (let i = 0; i < segs.length; i++) { const r = find(i), c = comp.get(r) || {lo: 999, hi: -999, ds: [], cv: false}; c.lo = Math.min(c.lo, segs[i].a0); c.hi = Math.max(c.hi, segs[i].a1); c.ds.push(segs[i].d); c.cv = c.cv || segs[i].cv; comp.set(r, c); }
  // la cadena tiene que doblar como un arco: una recta partida en tramos no cambia de dirección
  const turn = ds => { if (ds.length < 2) return 0; const v = ds.map(d => d*Math.PI/90); let cx = 0, cy = 0; for (const a of v) { cx += Math.cos(a); cy += Math.sin(a); } const m = Math.atan2(cy, cx); let lo = 0, hi = 0; for (const a of v) { let d = a - m; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; lo = Math.min(lo, d); hi = Math.max(hi, d); } return (hi - lo)*90/Math.PI; };
  for (const [r, c] of comp) if (!c.cv && turn(c.ds) < 0.5*(c.hi - c.lo)) comp.delete(r);
  // giro cubierto por la cadena más larga, contando desde 15° (junto al marco una recta se confunde con el arco)
  let best = 0;
  for (const c of comp.values()) best = Math.max(best, Math.min(c.hi, 92) - Math.max(c.lo, 15));
  return best;
}
function doorArc(strokes, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, G = Math.hypot(dx, dy); if (G <= 0) return false;
  const ux = dx/G, uy = dy/G;
  // la hoja suele ser algo más angosta que el hueco (marcos): se prueban varios radios
  for (const sgn of [1, -1]) for (const f of [1, 0.88, 0.76]) {
    if (arcCover(strokes, ax, ay, ux, uy, sgn, G*f) >= 28 || arcCover(strokes, bx, by, -ux, -uy, -sgn, G*f) >= 28) return true;
    if (f < 0.8) continue;
    if (arcCover(strokes, ax, ay, ux, uy, sgn, G*f/2) >= 25 && arcCover(strokes, bx, by, -ux, -uy, -sgn, G*f/2) >= 25) return true;
  }
  return false;
}

/* data: RGBA de la capa de paredes (W×H, sc píxeles por unidad del plano). vec: lectura vectorial del plano. */
export function detectLintels(data, W, H, sc, vec) {
  const strokes = vec.shapes.filter(q => q.k === 's');
  const m = new Uint8Array(W*H);
  for (let i = 0, n = W*H; i < n; i++) m[i] = data[i*4+3] > 40 ? 1 : 0;
  const t = new Uint8Array(W*H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x*H + y] = m[y*W + x];
  const maxGap = Math.round(Math.max(W, H)*0.06);
  const list = [], hs = [];
  for (const g of gapsRows(m, W, H, maxGap)) {
    if (!accept(m, W, H, g)) continue;
    const h = g.y1 - g.y0 + 1, yc = (g.y0 + g.y1 + 1)/2/sc, x0 = g.x1/sc, x1 = (g.x2 + 1)/sc;
    if (!doorArc(strokes, x0, yc, x1, yc)) continue;
    list.push({a:[x0, yc], b:[x1, yc], w:h/sc}); hs.push(h/sc);
  }
  for (const g of gapsRows(t, H, W, maxGap)) { // vertical: filas de la imagen traspuesta = columnas
    if (!accept(t, H, W, g)) continue;
    const h = g.y1 - g.y0 + 1, xc = (g.y0 + g.y1 + 1)/2/sc, y0 = g.x1/sc, y1 = (g.x2 + 1)/sc;
    if (!doorArc(strokes, xc, y0, xc, y1)) continue;
    list.push({a:[xc, y0], b:[xc, y1], w:h/sc}); hs.push(h/sc);
  }
  hs.sort((a, b) => a - b);
  let tw = hs.length ? hs[hs.length >> 1] : 0;
  if (!tw) { // sin puertas: grosor típico de los tramos verticales
    const rl = [];
    for (let y = 0; y < H; y += 4) { let x = 0; const row = y*W; while (x < W) { while (x < W && !m[row + x]) x++; const s0 = x; while (x < W && m[row + x]) x++; const l = x - s0; if (l >= 2 && l <= maxGap/3) rl.push(l); } }
    rl.sort((a, b) => a - b); tw = rl.length ? rl[rl.length >> 1]/sc : 0;
  }
  return {list, tw};
}
