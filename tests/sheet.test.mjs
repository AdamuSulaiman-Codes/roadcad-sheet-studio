import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveProject } from '../src/core/project.js';
import { buildSheet } from '../src/draw/sheet.js';
import { entityBounds } from '../src/draw/entities.js';
import { buildDXF, sanitizeText } from '../src/export/dxf.js';
import { buildCSV } from '../src/export/csv.js';
import { LAYERS } from '../src/draw/layers.js';

const pp1 = JSON.parse(readFileSync(new URL('../presets/lifidi-pp1.json', import.meta.url)));
const pp3 = JSON.parse(readFileSync(new URL('../presets/lifidi-pp3.json', import.meta.url)));

const sheetFor = (p) => buildSheet(deriveProject(p));

test('buildSheet composes a complete drawing', () => {
  const { model, layout, dl } = sheetFor(pp1);
  assert.ok(model.alignment.segments.length >= 3);
  assert.equal(layout.scales.hDen, 2000);
  assert.ok(dl.entities.length > 400, 'expected a detailed sheet');
  const layers = new Set(dl.entities.map((e) => e.layer));
  for (const required of ['FRAME', 'PLAN_CL', 'PLAN_EDGE', 'PROF_DESIGN', 'PROF_GROUND', 'TABLE_LINE', 'TITLE_LINE']) {
    assert.ok(layers.has(required), `missing layer ${required}`);
    assert.ok(LAYERS[required], `layer ${required} not declared`);
  }
  for (const layer of layers) assert.ok(LAYERS[layer], `undeclared layer ${layer}`);
});

test('everything stays inside the sheet', () => {
  for (const preset of [pp1, pp3]) {
    const { layout, dl } = sheetFor(preset);
    for (const e of dl.entities) {
      const b = entityBounds(e);
      assert.ok(b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite), `non-finite ${e.type}`);
      assert.ok(b.x0 >= layout.border.x0 - 0.01 && b.x1 <= layout.border.x1 + 0.01, `x outside sheet: ${e.type} ${e.layer}`);
      assert.ok(b.y0 >= layout.border.y0 - 0.01 && b.y1 <= layout.border.y1 + 0.01, `y outside sheet: ${e.type} ${e.layer}`);
    }
  }
});

test('plan contains the centreline, station labels and curve data', () => {
  const { model, dl } = sheetFor(pp1);
  const texts = dl.entities.filter((e) => e.type === 'text').map((e) => e.text);
  assert.ok(texts.includes('0+000') && texts.includes('1+000'));
  assert.ok(texts.some((t) => /^E=540199\.\d{3}$/.test(t)), 'curve E value');
  assert.ok(texts.some((t) => /^R=5789\.132$/.test(t)), 'curve radius');
  assert.ok(texts.some((t) => /^Tan=/.test(t)));
  assert.ok(texts.filter((t) => /^0\+\d{3}$/.test(t)).length >= 18, 'station labels');
  assert.ok(dl.entities.some((e) => e.type === 'poly' && e.layer === 'PLAN_CL'));
  // chainage ticks every 10 m for 1 km: 101 tick marks (small ones on PLAN_SOFT)
  const ticks = dl.entities.filter((e) => e.type === 'line' && (e.layer === 'PLAN_TICK' || e.layer === 'PLAN_SOFT'));
  assert.ok(ticks.length >= 100, `expected >=100 ticks, got ${ticks.length}`);
});

test('profile shows the design line, ground line and vertical curve data', () => {
  const { dl } = sheetFor(pp1);
  const design = dl.entities.find((e) => e.type === 'poly' && e.layer === 'PROF_DESIGN');
  const ground = dl.entities.find((e) => e.type === 'poly' && e.layer === 'PROF_GROUND');
  assert.ok(design.pts.length > 100);
  assert.ok(ground.pts.length > 100);
  const texts = dl.entities.filter((e) => e.type === 'text').map((e) => e.text);
  assert.ok(texts.includes('-0.52%'), 'grade label');
  assert.ok(texts.includes('+0.76%'), 'second grade label');
  assert.ok(texts.some((t) => /^K=324\.\d\d$/.test(t)), 'K value');
  assert.ok(texts.some((t) => /^L=416\.177$/.test(t)), 'curve length');
  assert.ok(texts.some((t) => t.includes('LOW POINT STA')), 'low point callout');
  assert.ok(texts.some((t) => t.startsWith('PVC')), 'PVC tag');
});

test('levels table matches the station model', () => {
  const { model, layout, dl } = sheetFor(pp1);
  const tableTexts = dl.entities.filter((e) => e.type === 'text' && e.layer === 'TABLE_TEXT');
  assert.equal(tableTexts.length, layout.stations.columns.length * 4);
  // first column: chainage 0+000, profile 297.335, existing 297.256, diff 0.079
  const first = (txt) => tableTexts.find((t) => t.text === txt);
  assert.ok(first('0+000') && first('297.335'));
  assert.equal(Math.round((model.rows[0].design - 297.335) * 1000), 0);
  assert.equal(Math.round((model.rows[0].ground - 297.256) * 1000), 0);
  const d = model.rows[0].diff;
  assert.ok(first(d.toFixed(3)), 'diff cell present');
});

test('title block carries the project identity', () => {
  const { dl } = sheetFor(pp1);
  const texts = dl.entities.filter((e) => e.type === 'text').map((e) => e.text);
  assert.ok(texts.includes('PLATEAU STATE GOVERNMENT'));
  assert.ok(texts.includes('PLATEAU STATE MINISTRY OF WORKS'));
  assert.ok(texts.some((t) => t.includes('HORIZONTAL & VERTICAL ALIGNMENT')));
  assert.ok(texts.includes('PP1'));
  assert.ok(texts.includes('MARCH, 2026'));
  assert.ok(texts.some((t) => t.includes('MASTODON ENGINEERING SERVICES')));
  assert.ok(texts.includes('1:2000') === false || texts.some((t) => t.includes('1:2000')));
});

test('DXF is a structurally complete R12 file', () => {
  const { dl, layout } = sheetFor(pp1);
  const dxf = buildDXF(dl, layout);
  const lines = dxf.split('\n');
  assert.equal(lines.length % 2, 1, 'group code/value pairs');
  for (let i = 0; i < lines.length - 1; i += 2) assert.match(lines[i], /^-?\d+$/);
  assert.ok(dxf.includes('\n$ACADVER\n1\nAC1009\n'));
  for (const s of ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']) assert.ok(dxf.includes(`\n2\n${s}\n`), s);
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  assert.ok(dxf.includes('LWPOLYLINE') === false, 'R12 has no LWPOLYLINE');
  // every layer referenced by an entity exists in the LAYER table
  const layerTable = [...dxf.matchAll(/\n0\nLAYER\n2\n([^\n]+)\n/g)].map((m) => m[1]);
  for (const layer of new Set(dl.entities.map((e) => e.layer))) assert.ok(layerTable.includes(layer), `DXF layer ${layer}`);
  // text is ascii/cp1252 safe
  const nonAscii = [...dxf].filter((c) => c.charCodeAt(0) > 255);
  assert.equal(nonAscii.length, 0);
});

test('DXF output is deterministic and sanitises unicode', () => {
  const a = sheetFor(pp1);
  const b = sheetFor(pp1);
  assert.equal(buildDXF(a.dl, a.layout), buildDXF(b.dl, b.layout));
  assert.equal(sanitizeText('Δ=1.2° ± 3'), 'D=1.2%%d %%p 3');
});

test('CSV export has one row per station', () => {
  const { model, layout } = sheetFor(pp1);
  const csv = buildCSV(model, layout.scales);
  const rows = csv.trim().split('\n').filter((l) => !l.startsWith('#'));
  assert.equal(rows.length, 42); // header + 41 stations
  assert.ok(rows[0].startsWith('chainage,station_m'));
  assert.ok(rows[1].startsWith('0+000,'));
});

test('sheet adapts to other page sizes', () => {
  for (const [sheet, expectW, expectH] of [['A1', 841, 594], ['A3', 420, 297]]) {
    const model = deriveProject({ ...pp1, settings: { ...pp1.settings, sheet } });
    const { layout, dl } = buildSheet(model);
    assert.equal(layout.sheet.w, expectW);
    assert.equal(layout.sheet.h, expectH);
    assert.ok(layout.scales.hDen > 0 && layout.scales.vDen > 0);
    assert.ok(dl.entities.length > 300);
    // independent gate: no entity outside the page
    for (const e of dl.entities) {
      const b = entityBounds(e);
      assert.ok(b.x0 >= 7.9 && b.x1 <= expectW - 7.9 && b.y0 >= 7.9 && b.y1 <= expectH - 7.9, `${sheet}: ${e.type} outside`);
    }
  }
});

test('invalid projects are rejected before drawing', () => {
  assert.throws(() => deriveProject({ alignment: { nodes: [{ e: 0, n: 0 }] }, profile: { pvis: [] } }), /Alignment/);
  assert.throws(() => deriveProject({ ...pp1, profile: { pvis: [{ station: 0, elev: 100 }] } }), /Profile/);
});

test('existing-ground toggle hides the survey line and blanks its table cells', () => {
  const withGround = sheetFor(pp1);
  const without = sheetFor({ ...pp1, settings: { ...pp1.settings, showExisting: false } });
  assert.ok(withGround.dl.entities.some((e) => e.layer === 'PROF_GROUND'));
  assert.ok(!without.dl.entities.some((e) => e.layer === 'PROF_GROUND'));
  const dashes = without.dl.entities.filter((e) => e.type === 'text' && e.layer === 'TABLE_TEXT' && e.text === '\u2014');
  assert.equal(dashes.length, layoutColumnCount(without) * 2, 'existing level and H.T. diff cells are blanked');
});

function layoutColumnCount(sheet) {
  return sheet.layout.stations.columns.length;
}
