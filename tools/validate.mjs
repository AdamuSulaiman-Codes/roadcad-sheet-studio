#!/usr/bin/env node
/**
 * Geometry/QA validator for the generated sheets. Prints violations and exits
 * non-zero when the drawing would be wrong (NaN, off-sheet, overlapping table
 * numbers, malformed DXF).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveProject } from '../src/core/project.js';
import { buildSheet } from '../src/draw/sheet.js';
import { entityBounds } from '../src/draw/entities.js';
import { buildDXF } from '../src/export/dxf.js';
import { boundsOf } from '../src/export/util.js';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('presets').filter((f) => f.endsWith('.json')).map((f) => join('presets', f));

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const model = deriveProject(raw);
  const { layout, dl } = buildSheet(model);
  console.log(`\n${file}  (${dl.entities.length} entities)`);

  // 1. finite geometry and sheet containment
  const border = layout.border;
  let nan = 0, outside = 0;
  for (const e of dl.entities) {
    const b = entityBounds(e);
    if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) { nan++; continue; }
    if (b.x0 < border.x0 - 0.01 || b.y0 < border.y0 - 0.01 || b.x1 > border.x1 + 0.01 || b.y1 > border.y1 + 0.01) outside++;
  }
  if (nan) fail(`${nan} entities with non-finite geometry`); else console.log('  ok   geometry finite');
  if (outside) fail(`${outside} entities outside the sheet border`); else console.log('  ok   inside border');

  // 2. bands must not overlap and must be inside the frame
  const bands = ['plan', 'profile', 'table', 'title'].map((k) => [k, layout.bands[k]]);
  for (const [k, b] of bands) {
    if (b.x0 < layout.frame.x0 - 0.01 || b.y0 < layout.frame.y0 - 0.01 || b.x1 > layout.frame.x1 + 0.01 || b.y1 > layout.frame.y1 + 0.01) fail(`${k} band outside frame`);
  }
  const sorted = bands.sort((a, b) => a[1].y0 - b[1].y0);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [k1, b1] = sorted[i], [k2, b2] = sorted[i + 1];
    if (b1.y1 > b2.y0 + 0.01) fail(`${k1} band overlaps ${k2} band`);
  }
  console.log('  ok   bands');

  // 3. table numbers centred on their stations and not overlapping neighbours
  const texts = dl.entities.filter((e) => e.type === 'text' && e.layer === 'TABLE_TEXT');
  const cols = layout.stations.columns;
  let misaligned = 0;
  for (const c of cols) {
    const chain = texts.find((t) => t.x === c.x && /^\d\+\d{3}$/.test(t.text));
    if (!chain) misaligned++;
  }
  if (misaligned) fail(`${misaligned} table columns without a centred chainage label`);
  else console.log('  ok   table columns aligned');
  const rowH = layout.table.rowH;
  for (const t of texts) {
    if (t.h * 1.35 > rowH) fail(`table text ${t.text} taller than its row`);
  }
  // overlap between numbers in the same row
  const rows = new Map();
  for (const t of texts) {
    const key = t.y.toFixed(2);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(t);
  }
  let overlaps = 0;
  for (const [, ts] of rows) {
    ts.sort((a, b) => a.x - b.x);
    for (let i = 1; i < ts.length; i++) {
      const w = (s) => s.text.length * 0.556 * (s.h / 0.717);
      if (ts[i].x - ts[i - 1].x < (w(ts[i]) + w(ts[i - 1])) / 2) overlaps++;
    }
  }
  if (overlaps) fail(`${overlaps} overlapping table numbers`); else console.log('  ok   table numbers fit');

  // 4. profile geometry monotone in x and inside its plot box
  const prof = dl.entities.filter((e) => e.type === 'poly' && e.layer === 'PROF_DESIGN');
  if (prof.length !== 1) fail('missing design profile polyline');
  else {
    const xs = prof[0].pts.map((p) => p[0]);
    if (xs.some((x, i) => i && x < xs[i - 1] - 1e-6)) fail('design profile is not monotone in station');
    const p = layout.profile;
    if (xs[0] < p.x0 - 0.5 || xs[xs.length - 1] > p.x1 + 0.5) fail('profile outside its plot box');
    console.log('  ok   profile');
  }

  // 5. station table rows match the profile sampling
  for (const c of cols.slice(0, 5)) {
    const r = model.rows[c.index];
    if (Math.abs(r.station - c.station) > 1e-9) fail('table column does not map to its station');
  }

  // 6. DXF structural sanity
  const dxf = buildDXF(dl, layout);
  const lines = dxf.split('\n');
  if (lines.length % 2 !== 1) fail('DXF group code/value stream is not an even pair list');
  const codes = [];
  for (let i = 0; i < lines.length - 1; i += 2) codes.push(lines[i].trim());
  if (!codes.every((c) => /^-?\d+$/.test(c))) fail('DXF contains a non-numeric group code');
  for (const section of ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']) {
    if (!dxf.includes(`\n2\n${section}\n`)) fail(`DXF missing ${section} section`);
  }
  if (!dxf.trimEnd().endsWith('EOF')) fail('DXF missing EOF');
  if (/NaN|Infinity/.test(dxf)) fail('DXF contains NaN/Infinity');
  const b = boundsOf(dl);
  console.log(`  ok   dxf (${(dxf.length / 1024).toFixed(0)} kB, extents ${b.x0.toFixed(0)},${b.y0.toFixed(0)}..${b.x1.toFixed(0)},${b.y1.toFixed(0)})`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
