/* Niveles, plantas típicas (multiplicador), pared/losa y tuberías bajo losa. */
import { esc, ST } from './constants.js';
import { P, S } from './state.js';
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
  const bp = !!(f ? (f.below ?? S.below) : S.below), below = bp && locOf(m) === 'pared';
  if (bp) {
    // tuberías bajo losa: las paredes que cruzan son del nivel inferior y la losa es la del nivel del plano B.
    // Si la planta viene de un nivel del arquitectónico, sus niveles son los de las paredes (el nivel del A):
    // las losas van un nivel arriba. Si no, sus niveles son los del plano B: las paredes van un nivel abajo.
    if (f ? f.src : S.levelsAuto) { if (locOf(m) === 'losa') lv = lv.map(x => shiftLv(x, 1)); }
    else if (below) lv = lv.map(x => shiftLv(x, -1));
  }
  return {lv, f, below};
}
function shiftLv(x, d) {
  if (!/^-?\d+$/.test(x)) return x ? x + (d < 0 ? ' (inferior)' : ' (superior)') : x;
  let v = +x + d;
  if (v === 0 && !hasLevel0()) v += d; // de sótano -1 se pasa al nivel 1 (no hay nivel 0)
  return String(v);
}
/* ¿el proyecto usa un nivel 0? (si no, el nivel de arriba del -1 es el 1) */
function hasLevel0() {
  if (!P || !P.sheets) return false;
  for (const sh of Object.values(P.sheets)) {
    const st = sh.state;
    for (const l of st.lvls || []) if (parseLevels(l.levels || '').includes('0')) return true;
    for (const f of st.floors || []) if (parseLevels(f.levels || '').includes('0')) return true;
    if (parseLevels(st.levels || '').includes('0')) return true;
  }
  return false;
}
/* para mostrar en la planta: a qué niveles van los sellos de pared y de losa */
export function floorLocHint(f) {
  if (!(f.below ?? S.below)) return '';
  const lv = floorLevels(f), up = f.src ? lv.map(x => shiftLv(x, 1)) : lv, wall = f.src ? lv : lv.map(x => shiftLv(x, -1));
  return `Tubería bajo losa: sellos de pared en ${wall.length > 1 ? 'niveles' : 'nivel'} ${joinY(wall)} · sellos de losa en ${up.length > 1 ? 'niveles' : 'nivel'} ${joinY(up)}.`;
}

export function levelsHtml() {
  return `<section class="plan"><header><span class="badge" style="background:#12866B">N</span><div><h3>Niveles de este plano</h3><p class="muted">Para tablas y exportación</p></div></header>
    ${S.floors.length ? '<p class="help" style="margin:0 0 8px">Hay plantas definidas: los niveles se indican en cada planta, más abajo.</p>' :
      `<div class="field" style="grid-template-columns:86px 1fr"><label>Nivel(es)</label><input data-act="plevels" value="${esc(S.levels || '')}" placeholder="Ej.: 5, o 7-10 si es planta típica"></div>${S.levelsAuto ? '<p class="help" style="margin:-4px 0 8px">Tomado del nivel elegido en el arquitectónico.</p>' : ''}`}
    <label class="chk"><input type="checkbox" data-act="pbelow"${S.below ? ' checked' : ''}> Tuberías bajo losa: las paredes que cruzan son del nivel inferior (típico en sanitario y pluvial)</label>
    <p class="help" style="margin:4px 0 0">Con esta opción, los sellos de pared van al nivel de las paredes (el de abajo) y los de losa al nivel del plano. Si las plantas vienen de niveles del arquitectónico, esos niveles son los de las paredes y las losas van un nivel arriba.</p></section>`;
}
