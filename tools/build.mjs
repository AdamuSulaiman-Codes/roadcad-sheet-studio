#!/usr/bin/env node
/** CLI: project JSON -> DXF / PDF / SVG / CSV sheets. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deriveProject } from '../src/core/project.js';
import { buildSheet } from '../src/draw/sheet.js';
import { buildDXF } from '../src/export/dxf.js';
import { renderSVG } from '../src/export/svg.js';
import { renderPDF } from '../src/export/pdf.js';
import { buildCSV } from '../src/export/csv.js';
import { slug } from '../src/export/util.js';

const args = process.argv.slice(2);
const get = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (flag) => args.includes(flag);

const outDir = get('--out', 'out');
const formats = (get('--formats', 'dxf,pdf,svg,csv')).split(',').map((s) => s.trim()).filter(Boolean);

const files = [];
if (has('--all')) {
  for (const f of readdirSync('presets').filter((f) => f.endsWith('.json')).sort()) files.push(join('presets', f));
} else if (get('--project')) {
  files.push(get('--project'));
} else {
  const preset = get('--preset', 'lifidi-pp1');
  files.push(preset.endsWith('.json') ? preset : join('presets', `${preset}.json`));
}

mkdirSync(outDir, { recursive: true });
let total = 0;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const t0 = performance.now();
  const model = deriveProject(raw);
  const { layout, dl } = buildSheet(model);
  const tBuild = performance.now() - t0;
  const contract = raw.id ?? basename(file, '.json');
  const base = slug(contract);
  const meta = {
    title: `${raw.meta?.projectTitle ?? ''} - ${raw.meta?.drawingTitle ?? ''}`,
    subject: `Sheet ${raw.meta?.sheetNo ?? ''} ${raw.meta?.date ?? ''}`,
    author: raw.meta?.consultant ?? 'RoadCAD Sheet Studio',
    creator: 'RoadCAD Sheet Studio',
  };
  const written = [];
  const time = (fn, ext, writer) => {
    const t = performance.now();
    const data = writer();
    const ms = performance.now() - t;
    const path = join(outDir, `${base}.${ext}`);
    writeFileSync(path, data);
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    total += bytes;
    written.push(`${ext} ${(bytes / 1024).toFixed(0)} kB (${ms.toFixed(0)} ms)`);
  };
  if (formats.includes('dxf')) time('dxf', 'dxf', () => buildDXF(dl, layout, meta));
  if (formats.includes('pdf')) time('pdf', 'pdf', () => renderPDF(dl, layout, meta));
  if (formats.includes('svg')) time('svg', 'svg', () => renderSVG(dl, layout));
  if (formats.includes('csv')) time('csv', 'csv', () => buildCSV(model, layout.scales));

  console.log(`${file}`);
  console.log(`  sheet ${layout.sheet.w}x${layout.sheet.h} mm  scales H 1:${layout.scales.hDen} V 1:${layout.scales.vDen}`);
  console.log(`  length ${model.alignment.totalLength.toFixed(2)} m, ${model.alignment.curves.length} H curves, ${model.profile.curves.length} V curves, ${model.stations.length} stations`);
  console.log(`  ${dl.entities.length} entities built in ${tBuild.toFixed(0)} ms`);
  console.log(`  -> ${written.join(', ')}`);
}
console.log(`${files.length} sheet(s), ${(total / 1024).toFixed(0)} kB written to ${outDir}/`);
