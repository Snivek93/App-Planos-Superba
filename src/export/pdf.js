/* PDF del plano con marcas (vectorial con pdf-lib, o imagen como respaldo). */
import { esc, PDF_UNIT } from '../core/constants.js';
import { RT, S } from '../core/state.js';
import { M, toWorld } from '../core/geometry.js';
import { ctx, dirty, drawLayers, drawSeal, EXPORT, measureCtx, renderVars, setWorld, UI, VM } from '../canvas/render.js';
import { baseName, saveFile } from './files.js';
import { save } from '../core/storage.js';
import { ask, toast } from '../ui/app.js';
import { floorAtWorld, planFrames } from '../plans/floors.js';
import { apT, ensureVec, mulT, overlayCanvas } from '../detect/vector.js';
import { ensurePdf } from '../plans/load.js';

/* ---------- PDF vectorial: las marcas se escriben como líneas y texto del PDF, no como imagen ---------- */
/* pdf-lib se carga solo al exportar */
export let PDFLib = null;

export async function loadPdfLib() { if (!PDFLib) PDFLib = await import('pdf-lib'); return PDFLib; }

export function parseColor(c) {
  if (!c || typeof c !== 'string') return [0, 0, 0, 1];
  c = c.trim();
  if (c[0] === '#') { const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7); const n = parseInt(h, 16); return [(n >> 16 & 255)/255, (n >> 8 & 255)/255, (n & 255)/255, 1]; }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const v = m[1].split(',').map(x => parseFloat(x)); return [v[0]/255, v[1]/255, v[2]/255, v.length > 3 ? v[3] : 1]; }
  return [0, 0, 0, 1];
}

export class PdfCtx {
  constructor(doc, page, fonts) {
    this.doc = doc; this.page = page; this.fonts = fonts; this.ops = []; this.gs = new Map();
    this.st = {m:[1,0,0,1,0,0], fillStyle:'#000', strokeStyle:'#000', lineWidth:1, lineCap:'butt', lineJoin:'miter', globalAlpha:1, globalCompositeOperation:'source-over', font:'10px sans-serif', textAlign:'start', textBaseline:'alphabetic', dash:[]};
    this.stack = []; this.path = []; this.imageSmoothingQuality = 'high'; this.imageSmoothingEnabled = true;
  }
  // propiedades al estilo canvas
  get fillStyle() { return this.st.fillStyle; } set fillStyle(v) { this.st.fillStyle = v; }
  get strokeStyle() { return this.st.strokeStyle; } set strokeStyle(v) { this.st.strokeStyle = v; }
  get lineWidth() { return this.st.lineWidth; } set lineWidth(v) { this.st.lineWidth = v; }
  get lineCap() { return this.st.lineCap; } set lineCap(v) { this.st.lineCap = v; }
  get lineJoin() { return this.st.lineJoin; } set lineJoin(v) { this.st.lineJoin = v; }
  get globalAlpha() { return this.st.globalAlpha; } set globalAlpha(v) { this.st.globalAlpha = v; }
  get globalCompositeOperation() { return this.st.globalCompositeOperation; } set globalCompositeOperation(v) { this.st.globalCompositeOperation = v; }
  get font() { return this.st.font; } set font(v) { this.st.font = v; }
  get textAlign() { return this.st.textAlign; } set textAlign(v) { this.st.textAlign = v; }
  get textBaseline() { return this.st.textBaseline; } set textBaseline(v) { this.st.textBaseline = v; }
  save() { this.stack.push({...this.st, m:this.st.m.slice(), dash:this.st.dash.slice()}); this.ops.push(PDFLib.pushGraphicsState()); }
  restore() { if (!this.stack.length) return; this.st = this.stack.pop(); this.ops.push(PDFLib.popGraphicsState()); }
  setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
  transform(a, b, c, d, e, f) { this.st.m = mulT(this.st.m, [a, b, c, d, e, f]); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  setLineDash(d) { this.st.dash = d || []; }
  _p(x, y) { return apT(this.st.m, x, y); }
  _k() { const m = this.st.m; return Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2])) || 1; }
  beginPath() { this.path = []; }
  moveTo(x, y) { const q = this._p(x, y); this.path.push(['m', q[0], q[1]]); this.cur = q; this.start = q; }
  lineTo(x, y) { const q = this._p(x, y); if (!this.path.length) this.path.push(['m', q[0], q[1]]); else this.path.push(['l', q[0], q[1]]); this.cur = q; if (!this.start) this.start = q; }
  closePath() { if (this.path.length) { this.path.push(['h']); if (this.start) this.cur = this.start; } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, r) {
    r = Math.min(typeof r === 'number' ? r : 0, Math.abs(w)/2, Math.abs(h)/2);
    if (!r) return this.rect(x, y, w, h);
    this.moveTo(x + r, y); this.lineTo(x + w - r, y); this.arc(x + w - r, y + r, r, -Math.PI/2, 0);
    this.lineTo(x + w, y + h - r); this.arc(x + w - r, y + h - r, r, 0, Math.PI/2);
    this.lineTo(x + r, y + h); this.arc(x + r, y + h - r, r, Math.PI/2, Math.PI);
    this.lineTo(x, y + r); this.arc(x + r, y + r, r, Math.PI, Math.PI*1.5); this.closePath();
  }
  arc(cx, cy, r, a0, a1, ccw) {
    let sweep = a1 - a0;
    if (ccw) { if (sweep > 0) sweep -= Math.PI*2; } else if (sweep < 0) sweep += Math.PI*2;
    if (Math.abs(sweep) >= Math.PI*2 - 1e-6) sweep = (ccw ? -1 : 1)*Math.PI*2;
    const n = Math.max(1, Math.ceil(Math.abs(sweep)/(Math.PI/2))), da = sweep/n;
    const sx = cx + r*Math.cos(a0), sy = cy + r*Math.sin(a0);
    if (!this.path.length) this.moveTo(sx, sy); else this.lineTo(sx, sy);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + i*da, t1 = t0 + da, k = 4/3*Math.tan(da/4);
      const p1 = this._p(cx + r*(Math.cos(t0) - k*Math.sin(t0)), cy + r*(Math.sin(t0) + k*Math.cos(t0)));
      const p2 = this._p(cx + r*(Math.cos(t1) + k*Math.sin(t1)), cy + r*(Math.sin(t1) - k*Math.cos(t1)));
      const p3 = this._p(cx + r*Math.cos(t1), cy + r*Math.sin(t1));
      this.path.push(['c', p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]); this.cur = p3;
    }
  }
  _gs(alpha) {
    const bm = this.st.globalCompositeOperation === 'multiply' ? 'Multiply' : 'Normal';
    const a = Math.round(Math.max(0, Math.min(1, alpha))*100)/100;
    const key = a + bm;
    if (!this.gs.has(key)) this.gs.set(key, this.page.node.newExtGState('GS', this.doc.context.obj({Type:'ExtGState', ca:a, CA:a, BM:bm})));
    this.ops.push(PDFLib.setGraphicsState(this.gs.get(key)));
  }
  _emitPath() {
    for (const s of this.path) {
      if (s[0] === 'm') this.ops.push(PDFLib.moveTo(s[1], s[2]));
      else if (s[0] === 'l') this.ops.push(PDFLib.lineTo(s[1], s[2]));
      else if (s[0] === 'c') this.ops.push(PDFLib.appendBezierCurve(s[1], s[2], s[3], s[4], s[5], s[6]));
      else this.ops.push(PDFLib.closePath());
    }
  }
  _style(fillOrStroke) {
    const c = parseColor(fillOrStroke === 'f' ? this.st.fillStyle : this.st.strokeStyle);
    this._gs(c[3]*this.st.globalAlpha);
    if (fillOrStroke === 'f') this.ops.push(PDFLib.setFillingRgbColor(c[0], c[1], c[2]));
    else {
      const k = this._k();
      this.ops.push(PDFLib.setStrokingRgbColor(c[0], c[1], c[2]), PDFLib.setLineWidth(this.st.lineWidth*k),
        PDFLib.setLineCap({butt:0, round:1, square:2}[this.st.lineCap] || 0), PDFLib.setLineJoin({miter:0, round:1, bevel:2}[this.st.lineJoin] || 0),
        PDFLib.setDashPattern(this.st.dash.map(v => v*k), 0));
    }
  }
  fill(rule) { if (!this.path.length || typeof rule === 'object') return; this.ops.push(PDFLib.pushGraphicsState()); this._style('f'); this._emitPath(); this.ops.push(rule === 'evenodd' ? PDFLib.PDFOperator.of(PDFLib.PDFOperatorNames.FillEvenOdd) : PDFLib.fill()); this.ops.push(PDFLib.popGraphicsState()); }
  stroke(p) { if (!this.path.length || typeof p === 'object') return; this.ops.push(PDFLib.pushGraphicsState()); this._style('s'); this._emitPath(); this.ops.push(PDFLib.stroke()); this.ops.push(PDFLib.popGraphicsState()); }
  clip(rule) { if (!this.path.length) return; this._emitPath(); this.ops.push(rule === 'evenodd' ? PDFLib.clipEvenOdd() : PDFLib.clip(), PDFLib.endPath()); }
  fillRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = keep; }
  strokeRect(x, y, w, h) { const keep = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = keep; }
  clearRect() {}
  drawImage() {}
  measureText(t) { measureCtx.font = this.st.font; return measureCtx.measureText(t); }
  _text(str, x, y, mode) {
    str = String(str); if (!str) return;
    const fm = this.st.font.match(/(\d+(?:\.\d+)?)px/), size = fm ? parseFloat(fm[1]) : 10;
    const bold = /\b(6|7|8|9)00\b|bold/.test(this.st.font), font = bold ? this.fonts.bold : this.fonts.reg;
    let safe = '';
    for (const ch of str) { try { font.encodeText(ch); safe += ch; } catch (e) { safe += ch === '−' ? '-' : '?'; } }
    measureCtx.font = this.st.font;
    const cw = measureCtx.measureText(str).width, hw = font.widthOfTextAtSize(safe, size) || cw || 1;
    const hs = Math.max(0.5, Math.min(1.5, cw/hw));
    const w = hw*hs;
    if (this.st.textAlign === 'right' || this.st.textAlign === 'end') x -= w; else if (this.st.textAlign === 'center') x -= w/2;
    if (this.st.textBaseline === 'middle') y += size*0.35; else if (this.st.textBaseline === 'top') y += size*0.75;
    const tm = mulT(this.st.m, [hs, 0, 0, -1, x, y]);
    const c = parseColor(mode === 1 ? this.st.strokeStyle : this.st.fillStyle);
    this.ops.push(PDFLib.pushGraphicsState()); this._gs(c[3]*this.st.globalAlpha);
    if (mode === 1) this.ops.push(PDFLib.setStrokingRgbColor(c[0], c[1], c[2]), PDFLib.setLineWidth(this.st.lineWidth*this._k()), PDFLib.setLineJoin(1));
    else this.ops.push(PDFLib.setFillingRgbColor(c[0], c[1], c[2]));
    this.ops.push(PDFLib.beginText(), PDFLib.setFontAndSize(bold ? this.fonts.boldName : this.fonts.regName, size), PDFLib.setTextRenderingMode(mode ? PDFLib.TextRenderingMode.Outline : PDFLib.TextRenderingMode.Fill),
      PDFLib.setTextMatrix(...tm), PDFLib.showText(font.encodeText(safe)), PDFLib.endText(), PDFLib.popGraphicsState());
  }
  fillText(s, x, y) { this._text(s, x, y, 0); }
  strokeText(s, x, y) { this._text(s, x, y, 1); }
}

export function invM(q) { const dt = q[0]*q[3] - q[1]*q[2]; return [q[3]/dt, -q[1]/dt, -q[2]/dt, q[0]/dt, (q[2]*q[5] - q[3]*q[4])/dt, (q[1]*q[4] - q[0]*q[5])/dt]; }

export async function exportPDFVector(k, withOther, opt) {
  const P = PDFLib, p = S.plans[k], rt = RT[k];
  const hlRules = [...(opt.fire ? S.auto.fire.filter(r => r.on).map(r => [r, true]) : []), ...(opt.pipes ? S.auto.pipes.filter(r => r.on).map(r => [r, false]) : [])];
  for (const kk of new Set(hlRules.map(([r]) => r.plan))) { try { await ensureVec(kk); } catch (e) {} }
  const doc = await P.PDFDocument.create();
  let page, base, unitPerPt;
  if (rt.isPdf && await ensurePdf(rt)) {
    const src = await P.PDFDocument.load(await rt.file.arrayBuffer(), {ignoreEncryption:true});
    const [cp] = await doc.copyPages(src, [p.page - 1]); page = doc.addPage(cp);
    const pj = await rt.pdf.getPage(p.page);
    base = invM(pj.getViewport({scale:PDF_UNIT}).transform); unitPerPt = PDF_UNIT;
  } else {
    const pw = p.w*0.75, ph = p.h*0.75;
    page = doc.addPage([pw, ph]);
    const jpg = await new Promise(res => rt.bmp.toBlob(res, 'image/jpeg', 0.92));
    const img = await doc.embedJpg(await jpg.arrayBuffer());
    page.drawImage(img, {x:0, y:0, width:pw, height:ph});
    base = [0.75, 0, 0, -0.75, 0, ph]; unitPerPt = 1/0.75;
  }
  const fonts = {reg: await doc.embedFont(P.StandardFonts.Helvetica), bold: await doc.embedFont(P.StandardFonts.HelveticaBold)};
  fonts.regName = page.node.newFontDictionary('F', fonts.reg.ref); fonts.boldName = page.node.newFontDictionary('F', fonts.bold.ref);
  const g = new PdfCtx(doc, page, fonts);
  const hlImgs = {};
  for (const hk of new Set(hlRules.map(([r]) => r.plan))) {
    const oc = overlayCanvas(hk, hlRules.filter(([r]) => r.plan === hk), 6000); if (!oc) continue;
    const png = await new Promise(res => oc.c.toBlob(res, 'image/png'));
    hlImgs[hk] = page.node.newXObject('Resaltado', (await doc.embedPng(await png.arrayBuffer())).ref);
  }
  g.ops.push(P.pushGraphicsState(), P.concatTransformationMatrix(...base));
  // el otro plano de fondo, también vectorial si es PDF
  const other = k === 'A' ? 'B' : 'A', po = S.plans[other], ro = RT[other];
  let otherDraw = null;
  if (withOther && ro.bmp) {
    if (ro.isPdf && await ensurePdf(ro)) {
      const srcO = await P.PDFDocument.load(await ro.file.arrayBuffer(), {ignoreEncryption:true});
      const pjo = await ro.pdf.getPage(po.page), v = pjo.view;
      const emb = await doc.embedPage(srcO.getPage(po.page - 1), {left:v[0], bottom:v[1], right:v[2], top:v[3]});
      const name = page.node.newXObject('Plano', emb.ref);
      const inner = mulT(pjo.getViewport({scale:PDF_UNIT}).transform, [1, 0, 0, 1, v[0], v[1]]);
      otherDraw = {name, inner};
    } else {
      const jpg = await new Promise(res => ro.bmp.toBlob(res, 'image/jpeg', 0.9));
      const img = await doc.embedJpg(await jpg.arrayBuffer());
      otherDraw = {name: page.node.newXObject('Imagen', img.ref), inner:[po.w, 0, 0, -po.h, 0, po.h]};
    }
  }
  const saved = [ctx, VM, UI, EXPORT];
  try {
    renderVars.ctx = g; renderVars.EXPORT = true;
    const sealMM = (opt.size ?? S.pdfSealMM ?? 4);
    renderVars.UI = (sealMM/2/0.3528)*unitPerPt/13;
    const pieces = (k === 'B' && S.floors.length) ? [{fr:p, clip:null, rest:true}, ...S.floors.map(f => ({fr:f.t, clip:f.b, f}))] : [{fr:p, clip:null}];
    for (const pc of pieces) {
      renderVars.VM = invM(M(pc.fr));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pc.clip) { ctx.beginPath(); ctx.rect(pc.clip[0], pc.clip[1], pc.clip[2]-pc.clip[0], pc.clip[3]-pc.clip[1]); ctx.clip(); }
      else if (pc.rest && S.floors.length) {
        ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5);
        for (const f of S.floors) ctx.rect(f.b[0], f.b[1], f.b[2]-f.b[0], f.b[3]-f.b[1]);
        ctx.clip('evenodd');
      }
      if (otherDraw && !(pc.rest && S.floors.length)) for (const [ofr, oclip] of planFrames(other)) {
        ctx.save(); setWorld(ofr);
        if (oclip) { ctx.beginPath(); ctx.rect(oclip[0], oclip[1], oclip[2]-oclip[0], oclip[3]-oclip[1]); ctx.clip(); }
        ctx.globalCompositeOperation = 'multiply'; g._gs(po.opacity);
        g.ops.push(P.pushGraphicsState(), P.concatTransformationMatrix(...mulT(g.st.m, otherDraw.inner)), P.drawObject(otherDraw.name), P.popGraphicsState());
        ctx.restore();
      }
      // paredes y tuberías detectadas: la misma capa de resaltado que se ve en pantalla
      if (!pc.rest || !S.floors.length) for (const hk of Object.keys(hlImgs)) {
        const hi = hlImgs[hk], hp = S.plans[hk];
        const frames = hk === 'B' && S.floors.length ? (pc.f ? [[pc.f.t, pc.f.b]] : S.floors.map(f => [f.t, f.b])) : [[hp, null]];
        for (const [fr, clip] of frames) {
          ctx.save(); setWorld(fr);
          if (clip) { ctx.beginPath(); ctx.rect(clip[0], clip[1], clip[2]-clip[0], clip[3]-clip[1]); ctx.clip(); }
          g._gs(hk === 'A' ? 0.55 : 0.85);
          g.ops.push(P.pushGraphicsState(), P.concatTransformationMatrix(...mulT(g.st.m, [hp.w, 0, 0, -hp.h, 0, hp.h])), P.drawObject(hi), P.popGraphicsState());
          ctx.restore();
        }
      }
      ctx.restore();
      // marcas, sellos y tablas: sin recorte, para que una tabla no se corte en el borde de la planta
      ctx.save();
      const keep = pc.rest ? (m, fr) => !floorAtWorld(toWorld(fr, m.pts[0])) : pc.f ? (m, fr) => floorAtWorld(toWorld(fr, m.pts[0])) === pc.f : null;
      const seals = drawLayers(false, keep);
      for (const [mm, pp] of seals) drawSeal(mm, pp, false);
      ctx.restore();
    }
  } finally {
    [renderVars.ctx, renderVars.VM, renderVars.UI, renderVars.EXPORT] = saved;
  }
  g.ops.push(P.popGraphicsState());
  page.pushOperators(...g.ops);
  const bytes = await doc.save();
  await saveFile(`${baseName()}-plano-${k}.pdf`, new Blob([bytes], {type:'application/pdf'}), 'application/pdf');
  dirty();
}

export const SEAL_PDF_SIZES = [['Muy pequeño', 2], ['Pequeño', 3], ['Mediano', 4], ['Grande', 5.5], ['Muy grande', 8]];

export async function pdfDialog() {
  const has = k => !!RT[k].bmp;
  if (!has('A') && !has('B')) return toast('Primero suba un plano.');
  const def = has('B') ? 'B' : 'A';
  const html = `<label class="row"><span>Plano</span><select id="pPlan">${['B', 'A'].filter(has).map(k => `<option value="${k}"${k === def ? ' selected' : ''}>Plano ${k}: ${esc(RT[k].name)}</option>`).join('')}</select></label>
    <label class="row"><span>Tamaño de los sellos en la hoja</span><select id="pSize">${SEAL_PDF_SIZES.map(([n, mm]) => `<option value="${mm}"${mm === (S.pdfSealMM ?? 4) ? ' selected' : ''}>${n} (${String(mm).replace('.', ',')} mm de diámetro)</option>`).join('')}</select></label>
    <label class="chk"><input type="checkbox" id="pFire"${S.auto.fire.some(r => r.on) ? ' checked' : ' disabled'}> Paredes cortafuego detectadas (resaltadas)</label>
    <label class="chk"><input type="checkbox" id="pPipes"${S.auto.pipes.some(r => r.on) ? '' : ' disabled'}> Tuberías detectadas (resaltadas)</label>
    <label class="chk"><input type="checkbox" id="pOther"> Incluir el otro plano de fondo</label>
    <p class="muted small" style="margin:0">También salen las capas visibles: trazos, marcador, textos, sellos y tablas. Las capas ocultas no salen.</p>`;
  const v = await ask({title:'Descargar PDF con marcas', html, buttons:[{label:'Cancelar', value:null}, {label:'Descargar PDF', value:'ok', primary:true}],
    read: r => ({k: r.querySelector('#pPlan').value, other: r.querySelector('#pOther').checked, size: +r.querySelector('#pSize').value,
      fire: r.querySelector('#pFire').checked, pipes: r.querySelector('#pPipes').checked})});
  if (v) { S.pdfSealMM = v.size; save(); exportPDF(v.k, v.other, v); }
}

export async function exportPDF(k, withOther, opt = {}) {
  const p = S.plans[k], rt = RT[k];
  if (!rt.bmp) return toast(`Primero suba el plano ${k}.`);
  try { await loadPdfLib(); } catch (e) { console.error(e); }
  if (!PDFLib) return toast('No se pudo cargar el generador de PDF. Recargue la página.');
  {
    toast('Generando el PDF…');
    try { await exportPDFVector(k, withOther, opt); return; }
    catch (err) { console.error(err); toast('No se pudo generar el PDF vectorial; se genera como imagen.'); }
  }
  toast('Generando el PDF…');
  const hlRules = [...(opt.fire ? S.auto.fire.filter(r => r.on).map(r => [r, true]) : []), ...(opt.pipes ? S.auto.pipes.filter(r => r.on).map(r => [r, false]) : [])];
  for (const kk of new Set(hlRules.map(([r]) => r.plan))) { try { await ensureVec(kk); } catch (e) {} }
  await new Promise(r => setTimeout(r, 60));
  const W = rt.bmp.width, H = rt.bmp.height, sc = W/p.w, m = M(p);
  const pw = rt.isPdf ? p.w/PDF_UNIT : p.w*0.75, ph = rt.isPdf ? p.h/PDF_UNIT : p.h*0.75;
  const pxPerPt = W/pw, sealMM = (opt.size ?? S.pdfSealMM ?? 4);
  const det = m[0]*m[3] - m[1]*m[2];
  const inv = [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det, (m[2]*m[5] - m[3]*m[4])/det, (m[1]*m[4] - m[0]*m[5])/det];
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const saved = [ctx, VM, UI, EXPORT];
  try {
    renderVars.ctx = c.getContext('2d'); renderVars.VM = inv.map(v => v*sc); renderVars.UI = (sealMM/2/0.3528)*pxPerPt/13; renderVars.EXPORT = true;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(rt.bmp, 0, 0, p.w, p.h); ctx.restore();
    const other = k === 'A' ? 'B' : 'A', po = S.plans[other];
    const invS = fr => { const q = M(fr), dt = q[0]*q[3] - q[1]*q[2]; return [q[3]/dt, -q[1]/dt, -q[2]/dt, q[0]/dt, (q[2]*q[5] - q[3]*q[4])/dt, (q[1]*q[4] - q[0]*q[5])/dt].map(v => v*sc); };
    // piezas: con plantas, cada planta del plano B tiene su propia transformación
    const pieces = (k === 'B' && S.floors.length) ? [{fr:p, clip:null, rest:true}, ...S.floors.map(f => ({fr:f.t, clip:f.b, f}))] : [{fr:p, clip:null}];
    for (const pc of pieces) {
      renderVars.VM = invS(pc.fr);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pc.clip) { ctx.beginPath(); ctx.rect(pc.clip[0]*sc, pc.clip[1]*sc, (pc.clip[2]-pc.clip[0])*sc, (pc.clip[3]-pc.clip[1])*sc); ctx.clip(); }
      else if (pc.rest) { ctx.beginPath(); ctx.rect(0, 0, W, H); for (const f of S.floors) ctx.rect(f.b[0]*sc, f.b[1]*sc, (f.b[2]-f.b[0])*sc, (f.b[3]-f.b[1])*sc); ctx.clip('evenodd'); }
      if (withOther && RT[other].bmp && !(pc.rest && S.floors.length)) {
        const src = po.tint && RT[other].tinted ? RT[other].tinted : RT[other].bmp;
        for (const [ofr, oclip] of planFrames(other)) {
          ctx.save(); setWorld(ofr);
          if (oclip) { ctx.beginPath(); ctx.rect(oclip[0], oclip[1], oclip[2]-oclip[0], oclip[3]-oclip[1]); ctx.clip(); }
          ctx.globalAlpha = po.opacity; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(src, 0, 0, po.w, po.h); ctx.restore();
        }
      }
      // paredes y tuberías detectadas automáticamente
      if (!pc.rest || !S.floors.length) for (const hk of new Set(hlRules.map(([r]) => r.plan))) {
        const oc = overlayCanvas(hk, hlRules.filter(([r]) => r.plan === hk), 6000); if (!oc) continue;
        const hp = S.plans[hk];
        const frames = hk === 'B' && S.floors.length ? (pc.f ? [[pc.f.t, pc.f.b]] : S.floors.map(f => [f.t, f.b])) : [[hp, null]];
        for (const [fr, clip] of frames) {
          ctx.save(); setWorld(fr);
          if (clip) { ctx.beginPath(); ctx.rect(clip[0], clip[1], clip[2]-clip[0], clip[3]-clip[1]); ctx.clip(); }
          ctx.globalAlpha = hk === 'A' ? 0.55 : 0.85; ctx.drawImage(oc.c, 0, 0, hp.w, hp.h);
          ctx.restore();
        }
      }
      ctx.restore();
      // marcas, sellos y tablas: sin recorte, para que una tabla no se corte en el borde de la planta
      ctx.save();
      const keep = pc.rest ? (m, fr) => !floorAtWorld(toWorld(fr, m.pts[0])) : pc.f ? (m, fr) => floorAtWorld(toWorld(fr, m.pts[0])) === pc.f : null;
      const seals = drawLayers(false, keep);
      for (const [mm, pp] of seals) drawSeal(mm, pp, false);
      ctx.restore();
    }
  } finally {
    [renderVars.ctx, renderVars.VM, renderVars.UI, renderVars.EXPORT] = saved;
  }
  try {
    const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([pw, ph]);
    const jpg = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    page.drawImage(await doc.embedJpg(await jpg.arrayBuffer()), {x:0, y:0, width:pw, height:ph});
    await saveFile(`${baseName()}-plano-${k}.pdf`, new Blob([await doc.save()], {type:'application/pdf'}), 'application/pdf');
  } catch (err) { console.error(err); toast('No se pudo generar el PDF. Si el plano es muy grande, intente desde una computadora.'); }
  dirty();
}

export function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }

export function dataURLtoBlob(u) {
  const [head, b64] = u.split(','); const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type:mime});
}
