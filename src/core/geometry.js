/* Geometría: transformaciones de plano, conversiones pantalla/mundo, distancias e intersecciones. */
import { S, view } from './state.js';

/* ---------- geometría ---------- */
export function M(p) { const c = Math.cos(p.r) * p.s, s = Math.sin(p.r) * p.s; return [c, s, -s, c, p.x, p.y]; }

export function toWorld(p, q) { const m = M(p); return [m[0]*q[0] + m[2]*q[1] + m[4], m[1]*q[0] + m[3]*q[1] + m[5]]; }

export function toLocal(p, w) { const dx = w[0]-p.x, dy = w[1]-p.y, c = Math.cos(-p.r)/p.s, s = Math.sin(-p.r)/p.s; return [c*dx - s*dy, s*dx + c*dy]; }

export function s2w(sx, sy) { return [(sx - view.x)/view.z, (sy - view.y)/view.z]; }

export function w2s(wx, wy) { return [wx*view.z + view.x, wy*view.z + view.y]; }

export function dist(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1]); }

export function mid(a, b) { return [(a[0]+b[0])/2, (a[1]+b[1])/2]; }

export function clampZ(z) { return Math.min(60, Math.max(0.005, z)); }

export function normAng(a) { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; }

export function distSeg(p, a, b) {
  const dx = b[0]-a[0], dy = b[1]-a[1], l2 = dx*dx + dy*dy;
  let t = l2 ? ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t*dx - p[0], a[1] + t*dy - p[1]);
}

export function segInter(a, b, c, d) {
  const r = [b[0]-a[0], b[1]-a[1]], s = [d[0]-c[0], d[1]-c[1]];
  const den = r[0]*s[1] - r[1]*s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0]-a[0])*s[1] - (c[1]-a[1])*s[0]) / den;
  const u = ((c[0]-a[0])*r[1] - (c[1]-a[1])*r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t*r[0], a[1] + t*r[1]];
}

export function snapAngle(a, b) {
  const ang = Math.atan2(b[1]-a[1], b[0]-a[0]), step = Math.PI/12, sa = Math.round(ang/step)*step, len = dist(a, b);
  return [a[0] + Math.cos(sa)*len, a[1] + Math.sin(sa)*len];
}

export function rectPts(m) { const [a, b] = m.pts; return [a, [b[0], a[1]], b, [a[0], b[1]], a]; }

export function baseW() {
  const p = S.plans.A.w ? S.plans.A : (S.plans.B.w ? S.plans.B : null);
  return p ? Math.max(1, Math.max(p.w*p.s, p.h*p.s) / 1100) : 2;
}
