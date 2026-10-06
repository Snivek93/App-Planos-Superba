/* Niveles, plantas típicas (multiplicador), pared/losa y tuberías bajo losa. */
import { esc, ST } from './constants.js';
import { S } from './state.js';
import { sealFloor } from '../canvas/tables.js';
import { sealsSorted } from '../panels/sellos.js';
import { baseName, saveFile } from '../export/files.js';
import { toast } from '../ui/app.js';
import { scopeSheets, secLabel, withState } from '../project/model.js';

/* ---------- niveles, multiplicador de plantas típicas y ubicación (pared / losa) ---------- */
export function locOf(m) { return m.loc === 'losa' ? 'losa' : 'pared'; }

export const LOC_NAME = {pared:'Pared', losa:'Losa'};

export function parseLevels(txt) {
  const out = [];
  const clean = String(txt || '').replace(/\b(niveles?|nivel|pisos?|plantas?|n\.)\b/gi, ' ');
  for (let tok of clean.split(/\s*(?:,|;|\/|\+|\by\b|\be\b)\s*/i)) {
    tok = tok.trim(); if (!tok) continue;
    const r = tok.match(/^([A-Za-z]*)\s*(-?\d+)\s*(?:-|–|a|al|hasta)\s*([A-Za-z]*)\s*(-?\d+)$/i);
    if (r) { const a = +r[2], b = +r[4]; if (Math.abs(b - a) <= 200) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(r[1] + i); continue; } }
    out.push(tok);
  }
  return [...new Set(out)];
}

export function floorLevels(f) { const l = parseLevels(f.levels != null ? f.levels : f.name); return l.length ? l : [f.name]; }

export function floorMult(f) { return f ? floorLevels(f).length : 1; }

export function joinY(list) { return list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1]; }

export function defaultLevels(name) { const l = parseLevels(name); return l.length && l.every(x => /\d/.test(x)) ? l.join(', ') : ''; }

// peso de cada sello: cuántos niveles representa la planta donde está
export function sealWeight(m) { return S.floors.length ? floorMult(sealFloor(m)) : Math.max(1, parseLevels(S.levels || '').length); }

export function allLevels() {
  const out = [];
  for (const f of S.floors) for (const l of floorLevels(f)) if (!out.includes(l)) out.push(l);
  return out;
}

export function quantRows(scope = 'all') {
  // filas para cuantificar: una por plano y nivel real (las plantas típicas se expanden)
  const out = [];
  for (const sh of scopeSheets(scope)) withState(sh.state, () => {
    const map = new Map();
    for (const m of sealsSorted()) {
      const {lv, f, below} = sealLevels(m), t = ST[m.st];
      for (const l of lv) {
        const key = [l, locOf(m), t.name, m.diam || '', m.sys || '', m.wall || ''].join('\u0001');
        const r = map.get(key) || {sec:secLabel(sh), plano:sh.name, nivel:l || 'Sin nivel', ubic:LOC_NAME[locOf(m)], cat:t.name, diam:m.diam || '', sys:m.sys || '', wall:m.wall || '', planta:f ? f.name : '', below, n:0};
        r.n++; map.set(key, r);
      }
    }
    out.push(...map.values());
  });
  return out;
}

export function exportQuant(scope = 'all') {
  const rows = quantRows(scope);
  if (!rows.length) return toast('Todavía no hay sellos para exportar.');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const out = [['Sección', 'Plano', 'Nivel', 'Ubicación', 'Categoría', 'Diámetro', 'Tubería', 'Tipo de pared', 'Planta de origen', 'Nota', 'Cantidad'].map(q).join(';')];
  for (const r of rows) out.push([r.sec, r.plano, r.nivel, r.ubic, r.cat, r.diam, r.sys, r.wall, r.planta, r.below ? 'Tubería bajo losa: pared del nivel inferior' : '', r.n].map(q).join(';'));
  out.push('', [q('Total'), '', '', '', '', '', '', '', '', '', rows.reduce((t, r) => t + r.n, 0)].join(';'));
  saveFile(baseName() + '-cuantificacion-por-nivel.csv', '﻿' + out.join('\r\n'), 'text/csv');
}

/* --- niveles: tuberías bajo losa --- */
export function sealLevels(m) {
  const f = S.floors.length ? sealFloor(m) : null;
  let lv = f ? floorLevels(f) : (S.floors.length ? [] : parseLevels(S.levels || ''));
  if (!lv.length) lv = [S.floors.length ? 'Fuera de las plantas' : ''];
  const below = !!(f ? (f.below ?? S.below) : S.below) && locOf(m) === 'pared';
  if (below) lv = lv.map(x => /^-?\d+$/.test(x) ? String(+x - 1) : (x ? x + ' (inferior)' : x));
  return {lv, f, below};
}

export function levelsHtml() {
  return `<section class="plan"><header><span class="badge" style="background:#12866B">N</span><div><h3>Niveles de este plano</h3><p class="muted">Para tablas y exportación</p></div></header>
    ${S.floors.length ? '<p class="help" style="margin:0 0 8px">Hay plantas definidas: los niveles se indican en cada planta, más abajo.</p>' :
      `<div class="field" style="grid-template-columns:86px 1fr"><label>Nivel(es)</label><input data-act="plevels" value="${esc(S.levels || '')}" placeholder="Ej.: 5, o 7-10 si es planta típica"></div>`}
    <label class="chk"><input type="checkbox" data-act="pbelow"${S.below ? ' checked' : ''}> Tuberías bajo losa: las paredes que cruzan son del nivel inferior (típico en sanitario y pluvial)</label>
    <p class="help" style="margin:4px 0 0">Con esta opción, en las tablas y en la exportación los sellos en pared van al nivel de abajo y los de losa quedan en el nivel del plano.</p></section>`;
}
