/* Elegir un estilo de pared o tubería tocando el plano. */
import { esc, PDF_UNIT } from '../core/constants.js';
import { S, uid, view } from '../core/state.js';
import { distSeg, toLocal } from '../core/geometry.js';
import { dirty } from '../canvas/render.js';
import { renderOpts, setTool } from '../editor/tools.js';
import { save } from '../core/storage.js';
import { ask, toast } from '../ui/app.js';
import { aFrameAt } from '../plans/floors.js';
import { ensureVec, isDot, ruleCache } from './vector.js';
import { renderAuto } from '../panels/deteccion.js';

/* elegir un estilo tocando el plano */
export function pointInPoly(x, y, sp) {
  let inside = false;
  for (let i = 0, j = sp.length - 2; i < sp.length; j = i, i += 2) {
    const xi = sp[i], yi = sp[i+1], xj = sp[j], yj = sp[j+1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi)*(y - yi)/((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

export async function pickAt(w) {
  const target = S.auto.picking, k = target === 'fire' ? 'A' : 'B';
  let vec;
  try { toast('Leyendo el PDF…'); vec = await ensureVec(k); }
  catch (err) { toast(err.message); setTool('select'); return; }
  let p = S.plans[k];
  if (k === 'A' && S.floors.length) {
    const af = aFrameAt(w);
    if (af.k !== 'A') { toast('Ese nivel viene de otra lámina: sus paredes se eligen en ese arquitectónico.'); return; }
    p = af.fr;
  }
  const lp = toLocal(p, w), tol = 9/(view.z*p.s);
  const hits = [];
  for (let i = vec.shapes.length - 1; i >= 0; i--) {
    const s = vec.shapes[i], t = tol + (s.w || 0)/2;
    if (lp[0] < s.bb[0]-t || lp[0] > s.bb[2]+t || lp[1] < s.bb[1]-t || lp[1] > s.bb[3]+t) continue;
    let hit = false;
    for (const sp of s.sp) {
      if (s.k === 'f' && sp.length >= 6 && pointInPoly(lp[0], lp[1], sp)) { hit = true; break; }
      for (let j = 0; j + 3 < sp.length; j += 2) if (distSeg(lp, [sp[j], sp[j+1]], [sp[j+2], sp[j+3]]) <= t) { hit = true; break; }
      if (hit) break;
    }
    if (hit && !hits.some(h => h.key === s.key) && s.c !== '#ffffff') hits.push(s);
    if (hits.length >= 8) break;
  }
  if (!hits.length) { toast(`No encontré líneas ni rellenos ahí en el plano ${k}. Acerque más el zoom y toque justo sobre ${target === 'fire' ? 'la pared' : 'la tubería'}.`); return; }
  const sat = c => { const n = parseInt(c.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  const rank = h => (sat(h.c) > 40 ? 2 : 0) + (target === 'fire' && h.k === 'f' ? 1 : 0);
  hits.sort((a, b) => rank(b) - rank(a));
  const list = target === 'fire' ? S.auto.fire : S.auto.pipes;
  const defName = target === 'fire' ? `Pared cortafuego ${list.length + 1}` : `Tubería ${list.length + 1}`;
  const grpInfo = s => { const g = vec.byKey.get(s.key), d = g.filter(isDot).length; return d ? `${g.length - d} formas y ${d} ${d === 1 ? 'símbolo pequeño' : 'símbolos pequeños'}` : `${g.length} en el plano`; };
  const desc = s => s.k === 'f' ? 'Relleno' : `Línea de ${(s.w/PDF_UNIT*0.3528).toFixed(2).replace('.', ',')} mm`;
  const html = `<div class="checks">${hits.map((s, i) => `<label><input type="radio" name="pk" value="${i}"${i === 0 ? ' checked' : ''}><span class="ldot" style="--c:${s.c};width:18px;height:18px;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>${desc(s)} <span class="muted">(${grpInfo(s)})</span></label>`).join('')}</div>
    <label class="chk"><input type="checkbox" id="pkDots"${isDot(hits[0]) ? '' : ' checked'}> Ignorar símbolos pequeños: puntos de etiqueta, círculos de nivel (N.L.T.), flechas y triángulos</label>
    <label class="row"><span>Nombre</span><input type="text" id="pkName" value="${esc(defName)}"></label>`;
  const v = await ask({title: target === 'fire' ? '¿Cuál es la pared cortafuego?' : '¿Cuál es la tubería?', body:'Elija el estilo que corresponde. Se tomarán todas las formas del plano con ese mismo estilo.', html,
    buttons:[{label:'Cancelar', value:null}, {label:'Agregar', value:'ok', primary:true}],
    read: r => ({i: +(r.querySelector('input[name=pk]:checked')?.value || 0), name: r.querySelector('#pkName').value.trim(), dots: r.querySelector('#pkDots').checked})});
  if (!v) return;
  const s = hits[v.i];
  if (list.some(r => r.key === s.key && r.plan === k)) { toast('Ese estilo ya está en la lista.'); return; }
  const rule = {id:'r' + uid(), plan:k, key:s.key, kind:s.k, color:s.c, w:s.w, name:v.name || defName, on:true, noDots:v.dots};
  list.push(rule);
  S.auto.show = true; save(); renderAuto(); renderOpts(); dirty();
  toast(`Agregado: ${ruleCache(rule)?.count ?? vec.byKey.get(s.key).length} formas. Toque otro estilo o presione Terminar.`);
}
