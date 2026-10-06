/* Tablas de leyenda que se insertan en el plano (cálculo, dibujo y edición). */
import { esc } from '../core/constants.js';
import { RT, S, sel, uid, view } from '../core/state.js';
import { baseW, toLocal, toWorld } from '../core/geometry.js';
import { ctx, measureCtx } from './render.js';
import { setTool } from '../editor/tools.js';
import { pushUndo } from '../core/undo.js';
import { ask, changed, toast } from '../ui/app.js';
import { allLevels, floorLevels, floorMult, joinY, LOC_NAME, locOf, parseLevels, sealWeight } from '../core/levels.js';
import { anLabel, catProps, geomLabel, penShort } from '../export/penetrante.js';
import { floorAtWorld, floorById, frameAt, frameOf } from '../plans/floors.js';

/* ---------- tablas de leyenda ---------- */
export function sealFloor(m) { return S.floors.length ? floorAtWorld(toWorld(frameOf(m), m.pts[0])) : null; }

export function tableModel(m) {
  let seals = S.marks.filter(x => x.type === 'seal');
  const single = m.floor ? floorById(m.floor) : null;
  if (single) seals = seals.filter(x => sealFloor(x) === single);
  const wfn = single ? () => 1 : sealWeight;
  const cats = m.cats ? S.sealTypes.filter(t => m.cats.includes(t.id)) : S.sealTypes.filter(t => seals.some(x => x.st === t.id));
  const show = Object.assign({pen:true, geom:true, an:true, bar:true}, m.cols || {});
  const rows = [];
  for (const t of cats) {
    const mine = seals.filter(x => x.st === t.id);
    const locs = show.bar ? ['pared', 'losa'].filter(l => mine.some(x => locOf(x) === l)) : [null];
    if (!locs.length) locs.push(show.bar ? 'pared' : null);
    for (const loc of locs) {
      const list = loc ? mine.filter(x => locOf(x) === loc) : mine;
      rows.push({t, loc, n: list.reduce((a, x) => a + wfn(x), 0), c: catProps(t.id), sample: list.find(x => x.diam)});
    }
  }
  const mult = single ? floorMult(single) : 1;
  const tcols = [];
  if (show.pen) tcols.push(['Tipo de penetrante', r => r.c && r.c.L ? penShort(r.c.L) : '—']);
  if (show.geom) tcols.push(['Geometría', r => geomLabel(r.t, r.c, r.sample) || '—']);
  if (show.an) tcols.push(['Esp. anular', r => r.c ? anLabel(r.c) : '—']);
  if (show.bar) tcols.push(['Barrera', r => LOC_NAME[r.loc]]);
  const cols = single && mult > 1 ? [['Por nivel', r => r.n], [`Total ×${mult}`, r => r.n*mult]] : [['Cantidad', r => r.n]];
  let sub = '';
  if (single) { const lv = floorLevels(single); sub = `${lv.length === 1 ? 'Nivel' : 'Niveles'} ${joinY(lv)}` + (mult > 1 ? ` (planta típica, ×${mult})` : ''); }
  else if (S.floors.length) sub = `Todos los niveles: ${joinY(allLevels())}`;
  else { const lv = parseLevels(S.levels || ''); if (lv.length) sub = `${lv.length === 1 ? 'Nivel' : 'Niveles'} ${joinY(lv)}` + (lv.length > 1 ? ` (planta típica, ×${lv.length})` : ''); }
  if (single ? (single.below ?? S.below) : (S.below || S.floors.some(f => f.below))) sub += (sub ? ' · ' : '') + 'Tuberías bajo losa: paredes del nivel inferior';
  return {rows, cols, tcols, sub};
}

export function tableLayout(m) {
  const fs = m.size, mc = measureCtx, mod = tableModel(m), {rows, cols, tcols, sub} = mod;
  mc.font = `600 ${fs}px Barlow, sans-serif`;
  const tw = t => mc.measureText(String(t)).width;
  const nameW = Math.max(tw('Tipo de sello'), tw('Total'), ...rows.map(r => tw(r.t.name)));
  mc.font = `500 ${fs*0.95}px Barlow, sans-serif`;
  const twS = t => mc.measureText(String(t)).width;
  mc.font = `600 ${fs}px Barlow, sans-serif`;
  const tcolW = tcols.map(([h, fn]) => Math.max(tw(h), ...rows.map(r => twS(fn(r)))));
  const colW = cols.map(([h, fn]) => Math.max(tw(h), tw(String(rows.reduce((a, r) => a + fn(r), 0))), ...rows.map(r => tw(String(fn(r))))));
  mc.font = `700 ${fs*1.25}px Barlow, sans-serif`;
  const titleW = m.title ? mc.measureText(m.title).width : 0;
  mc.font = `500 ${fs*0.9}px Barlow, sans-serif`;
  const subW = sub ? mc.measureText(sub).width : 0;
  const pad = fs*0.75, sw = fs*1.15, rowH = fs*1.95, c1 = pad + sw + pad, gap = pad*1.6;
  const titleH = m.title ? fs*2.5 : 0, subH = sub ? fs*1.7 : 0;
  const tLeft = []; { let x = c1 + nameW + gap; tcolW.forEach((w, i) => { tLeft[i] = x; x += w + gap; }); }
  const afterText = tLeft.length ? tLeft[tLeft.length - 1] + tcolW[tcolW.length - 1] + gap : c1 + nameW + gap;
  const colsW = colW.reduce((a, w) => a + w + gap, 0);
  const W = Math.max(afterText + colsW - gap + pad, titleW + pad*2, subW + pad*2);
  const H = titleH + subH + rowH*(Math.max(1, rows.length) + 2);
  return {fs, pad, sw, rowH, c1, W, H, titleH, subH, colW, tLeft, gap, ...mod};
}

export function drawTable(m, p, isSel) {
  const {fs, pad, sw, rowH, c1, W, H, titleH, subH, rows, cols, colW, tcols, tLeft, gap, sub} = tableLayout(m), [x, y] = m.pts[0];
  ctx.save(); ctx.translate(x, y);
  if (isSel) { const g = 8/(view.z*p.s); ctx.fillStyle = 'rgba(242,183,5,.55)'; ctx.fillRect(-g, -g, W + g*2, H + g*2); }
  const lw = fs*0.07, ink = '#21272C', soft = '#3E464D';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle'; ctx.lineCap = 'butt';
  const hline = (yy, w, col) => { ctx.strokeStyle = col || ink; ctx.lineWidth = w || lw; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); };
  const rights = []; { let r = W - pad; for (let i = cols.length - 1; i >= 0; i--) { rights[i] = r; r -= colW[i] + gap; } }
  let yy = 0;
  if (titleH) { ctx.fillStyle = ink; ctx.font = `700 ${fs*1.25}px Barlow, sans-serif`; ctx.fillText(m.title, pad, titleH/2 + (subH ? fs*0.15 : 0)); yy = titleH; }
  if (subH) { ctx.fillStyle = '#5A6268'; ctx.font = `500 ${fs*0.9}px Barlow, sans-serif`; ctx.fillText(sub, pad, yy + subH/2 - fs*0.2); yy += subH; }
  if (yy) hline(yy);
  ctx.fillStyle = '#EFF0EB'; ctx.fillRect(0, yy, W, rowH);
  ctx.fillStyle = ink; ctx.font = `600 ${fs}px Barlow, sans-serif`;
  ctx.fillText('Tipo de sello', c1, yy + rowH/2);
  tcols.forEach(([h], i) => ctx.fillText(h, tLeft[i], yy + rowH/2));
  ctx.textAlign = 'right'; cols.forEach(([h], i) => ctx.fillText(h, rights[i], yy + rowH/2)); ctx.textAlign = 'left';
  yy += rowH; hline(yy);
  if (!rows.length) { ctx.fillStyle = '#5A6268'; ctx.font = `italic 500 ${fs}px Barlow, sans-serif`; ctx.fillText('Sin sellos todavía', c1, yy + rowH/2); yy += rowH; }
  rows.forEach((r, i) => {
    const cy = yy + rowH/2;
    ctx.beginPath();
    if (r.loc === 'losa') { const q = sw/2*0.9; ctx.rect(pad + sw/2 - q, cy - q, q*2, q*2); } else ctx.arc(pad + sw/2, cy, sw/2, 0, Math.PI*2);
    ctx.fillStyle = r.t.color; ctx.fill(); ctx.lineWidth = lw*0.8; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.fillStyle = ink; ctx.font = `500 ${fs}px Barlow, sans-serif`; ctx.fillText(r.t.name, c1, cy);
    ctx.fillStyle = soft; ctx.font = `500 ${fs*0.95}px Barlow, sans-serif`;
    tcols.forEach(([, fn], k) => ctx.fillText(String(fn(r)), tLeft[k], cy));
    ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.font = `600 ${fs}px Barlow, sans-serif`;
    cols.forEach(([, fn], k) => ctx.fillText(String(fn(r)), rights[k], cy)); ctx.textAlign = 'left';
    yy += rowH;
    if (i < rows.length - 1) hline(yy, lw*0.6, '#C9CDC5');
  });
  hline(yy, lw*1.6);
  ctx.fillStyle = ink; ctx.font = `700 ${fs}px Barlow, sans-serif`; ctx.fillText('Total', c1, yy + rowH/2);
  ctx.textAlign = 'right'; cols.forEach(([, fn], k) => ctx.fillText(String(rows.reduce((a, r) => a + fn(r), 0)), rights[k], yy + rowH/2)); ctx.textAlign = 'left';
  ctx.lineWidth = lw*1.6; ctx.strokeStyle = ink; ctx.strokeRect(0, 0, W, H);
  ctx.restore();
}

export function tablesLayer() {
  let l = S.layers.find(x => x.kind === 'tablas' && !x.locked);
  if (!l) { l = {id:'L' + uid(), name:'Tablas y leyendas', plan: RT.B.bmp ? 'B' : 'A', color:'#21272C', visible:true, locked:false, kind:'tablas', st:'pend'}; S.layers.push(l); }
  if (!l.visible) l.visible = true;
  return l;
}

export const TABLE_SIZES = [['Pequeña', 3], ['Mediana', 5], ['Grande', 7], ['Muy grande', 10], ['Enorme', 14]];

export function placeTable(w) {
  const l = tablesLayer(), [pl, fl] = frameAt(l, w);
  pushUndo();
  const fw = S.floors.length ? floorAtWorld(w) : null;
  const m = {id:uid(), type:'table', layer:l.id, fl, pts:[toLocal(pl, w)], size: baseW()*7/pl.s, title: fw ? `Sellos cortafuego, ${fw.name}` : 'Sellos cortafuego', cats:null, floor: fw ? fw.id : null, w:0};
  S.marks.push(m);
  setTool('select'); sel.add(m.id); changed();
  toast('Tabla agregada. Arrástrela para moverla o use "Editar tabla" para elegir qué categorías muestra.');
}

export async function editTable(m) {
  const pl = frameOf(m), rel = m.size*pl.s/baseW();
  let si = 0; TABLE_SIZES.forEach(([, v], i) => { if (Math.abs(v - rel) < Math.abs(TABLE_SIZES[si][1] - rel)) si = i; });
  const html = `<label class="row"><span>Título</span><input type="text" id="tTitle" value="${esc(m.title)}"></label>
    <label class="row"><span>Tamaño en el plano</span><select id="tSize">${TABLE_SIZES.map(([n], i) => `<option value="${i}"${i === si ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    ${S.floors.length ? `<label class="row"><span>Contar sellos de</span><select id="tFloor"><option value="">Todas las plantas (todos los niveles)</option>${S.floors.map(f => `<option value="${f.id}"${m.floor === f.id ? ' selected' : ''}>${esc(f.name)} (${esc(joinY(floorLevels(f)))})</option>`).join('')}</select></label>` : ''}
    <div class="row"><span class="muted small">Columnas</span><div class="checks">${[['pen', 'Tipo de penetrante'], ['geom', 'Geometría (diámetro o A×B)'], ['an', 'Espacio anular'], ['bar', 'Barrera (pared o losa)']].map(([k, n]) => `<label><input type="checkbox" data-col="${k}"${(m.cols || {})[k] === false ? '' : ' checked'}> ${n}</label>`).join('')}</div></div>
    <label class="chk"><input type="checkbox" id="tAuto"${m.cats ? '' : ' checked'}> Mostrar automáticamente las categorías que tengan sellos</label>
    <div class="checks" id="tCats"${m.cats ? '' : ' hidden'}>${S.sealTypes.map(t => `<label><input type="checkbox" value="${t.id}"${!m.cats || m.cats.includes(t.id) ? ' checked' : ''}><span class="ldot" style="--c:${t.color}"></span>${esc(t.name)}</label>`).join('')}</div>`;
  const v = await ask({title:'Editar tabla', html, buttons:[{label:'Cancelar', value:null}, {label:'Guardar', value:'ok', primary:true}],
    setup: root => { root.querySelector('#tAuto').onchange = e => { root.querySelector('#tCats').hidden = e.target.checked; }; },
    read: root => ({title: root.querySelector('#tTitle').value.trim(), size: +root.querySelector('#tSize').value, auto: root.querySelector('#tAuto').checked,
      cats: [...root.querySelectorAll('#tCats input:checked')].map(i => i.value), floor: root.querySelector('#tFloor')?.value || '',
      cols: Object.fromEntries([...root.querySelectorAll('[data-col]')].map(i => [i.dataset.col, i.checked]))})});
  if (!v) return;
  pushUndo();
  m.title = v.title; m.size = baseW()*TABLE_SIZES[v.size][1]/pl.s; m.cats = v.auto ? null : v.cats; m.floor = v.floor || null; m.cols = v.cols;
  changed();
}
