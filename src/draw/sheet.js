/**
 * Composes the whole sheet: frame, plan, profile, levels table, title block,
 * general notes and legend. This is the single entry point every renderer uses.
 */
import { DrawList, line, poly, text } from './entities.js';
import { LAYERS } from './layers.js';
import { deriveProject } from '../core/project.js';
import { layoutSheet } from './layout.js';
import { drawPlan } from './plan.js';
import { drawProfile } from './profile.js';
import { drawTable } from './table.js';
import { drawTitleBlock } from './titleblock.js';

export function buildSheet(input) {
  const model = isDerived(input) ? input : deriveProject(input);
  const layout = layoutSheet(model);
  const dl = new DrawList();
  const p = model.project;

  drawFrame(dl, layout);
  drawPlan(dl, model, layout);
  drawProfile(dl, model, layout);
  drawTable(dl, model, layout);
  drawTitleBlock(dl, model, layout);
  if (p.settings.showNotes !== false) drawNotes(dl, model, layout);
  if (p.settings.showLegend !== false) drawLegend(dl, model, layout);
  return { model, layout, dl };
}

function isDerived(x) {
  return Boolean(x && x.alignment && Array.isArray(x.alignment.segments) && x.profile && x.rows);
}

function drawFrame(dl, layout) {
  const { border, frame } = layout;
  dl.add(poly('FRAME', [[border.x0, border.y0], [border.x1, border.y0], [border.x1, border.y1], [border.x0, border.y1]], true));
  dl.add(poly('FRAME_THIN', [[frame.x0, frame.y0], [frame.x1, frame.y0], [frame.x1, frame.y1], [frame.x0, frame.y1]], true));
  const tick = 3;
  for (const [cx, cy] of [[frame.x0, frame.y0], [frame.x1, frame.y0], [frame.x0, frame.y1], [frame.x1, frame.y1]]) {
    dl.add(line('FRAME_THIN', cx - tick, cy, cx + tick, cy));
    dl.add(line('FRAME_THIN', cx, cy - tick, cx, cy + tick));
  }
}

function drawNotes(dl, model, layout) {
  const plan = layout.bands.plan;
  const notes = model.project.notes ?? [];
  if (!notes.length) return;
  const x = plan.x0 + 26;
  let y = plan.y1 - 3.4;
  dl.add(text('NOTE', x, y, 1.8, 'GENERAL NOTES', { bold: true }));
  dl.add(line('NOTE', x, y - 1.0, x + 17, y - 1.0));
  y -= 4.4;
  notes.forEach((n, i) => {
    for (const [j, ln] of wrapNote(n, 92).entries()) {
      dl.add(text('NOTE', x, y, 1.35, j === 0 ? `${i + 1}. ${ln}` : `   ${ln}`));
      y -= 1.9;
    }
  });
}

function wrapNote(str, maxChars) {
  const words = String(str).split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function drawLegend(dl, model, layout) {
  const plan = layout.bands.plan;
  const x = plan.x1 - 54;
  let y = plan.y1 - 30;
  const rows = [['PROF_DESIGN', 'DESIGN PROFILE']];
  if (model.project.settings.showExisting !== false) rows.push(['PROF_GROUND', 'EXISTING GROUND']);
  rows.push(['PLAN_CL', 'ROAD CENTRE LINE'], ['PLAN_EDGE', 'PAVEMENT EDGE']);
  dl.add(text('NOTE', x, y, 1.7, 'LEGEND', { bold: true }));
  dl.add(line('NOTE', x, y - 1.0, x + 10, y - 1.0));
  y -= 4.4;
  for (const [layer, label] of rows) {
    dashSample(dl, layer, x, y + 0.6, 13);
    dl.add(text('NOTE', x + 15.5, y, 1.35, label));
    y -= 4.0;
  }
  y -= 1.2;
  dl.add(text('NOTE', x, y, 1.3, 'H.T. DIFF = PROFILE LEVEL -', {}));
  y -= 1.9;
  dl.add(text('NOTE', x, y, 1.3, 'EXISTING GROUND LEVEL (+ fill)'));
}

function dashSample(dl, layer, x, y, len) {
  const def = LAYERS[layer] ?? LAYERS.PROF_TEXT;
  const pattern = {
    CONTINUOUS: [len],
    DASHED: [2.6, 1.6, 2.6, 1.6, 2.6, 1.6],
    CENTER: [4, 1.2, 2, 1.2],
  }[def.ltype] ?? [len];
  let cx = x;
  let i = 0;
  while (cx < x + len - 1e-9 && i < 40) {
    const seg = Math.max(0.4, Math.min(pattern[i % pattern.length], x + len - cx));
    dl.add(line(layer, cx, y, cx + seg, y));
    cx += seg;
    i++;
  }
}
