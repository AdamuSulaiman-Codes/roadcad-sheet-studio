/**
 * Levels table under the profile: profile level, existing level, chainage and
 * H.T. diff. Columns are locked to the profile station axis so grid lines and
 * table columns line up.
 */
import { line, poly, text } from './entities.js';
import { num, station } from '../core/format.js';

const ROWS = [
  { key: 'design', label: 'PROFILE LEVEL (m)', dp: 3 },
  { key: 'ground', label: 'EXISTING LEVEL (m)', dp: 3 },
  { key: 'chainage', label: 'CHAINAGE (m)', dp: 0 },
  { key: 'diff', label: 'H.T. DIFF (m)', dp: 3 },
];

export function drawTable(dl, model, layout) {
  const t = layout.table;
  const cols = layout.stations.columns;
  const showExisting = model.project.settings.showExisting !== false;
  if (!cols.length) return dl;
  const rowH = t.rowH;
  const x0 = t.x0;
  const x1 = t.x1;
  const sepX = x0 + t.labelW;
  const half = t.halfSpacing;
  const colLeft = Math.max(sepX, cols[0].x - half);
  const colRight = Math.min(x1, cols[cols.length - 1].x + half);

  // frame
  dl.add(poly('TABLE_LINE', [[x0, t.y0], [x1, t.y0], [x1, t.y1], [x0, t.y1]], true));
  for (let i = 1; i < 4; i++) {
    const y = t.y0 + i * rowH;
    dl.add(line('TABLE_LINE', x0, y, x1, y));
  }
  dl.add(line('TABLE_LINE', sepX, t.y0, sepX, t.y1));

  // column separators (mid-way between stations), clipped to the table
  const boundaries = [];
  for (let i = 0; i < cols.length - 1; i++) boundaries.push((cols[i].x + cols[i + 1].x) / 2);
  for (const bx of boundaries) {
    if (bx <= sepX + 0.2 || bx >= x1 - 0.2) continue;
    dl.add(line('TABLE_LINE', bx, t.y0, bx, t.y1));
  }

  // row labels
  const labelH = Math.min(1.55, rowH * 0.19);
  const numH = Math.min(1.62, Math.max(1.05, t.halfSpacing * 0.42));
  ROWS.forEach((row, i) => {
    const yTop = t.y1 - i * rowH;
    const yMid = yTop - rowH / 2;
    dl.add(text('TABLE_HEAD', x0 + 1.6, yMid, labelH, row.label, { vAlign: 'middle' }));
    for (const c of cols) {
      const r = model.rows[c.index];
      if (!r) continue;
      let str;
      if (row.key === 'chainage') str = station(r.station, 0);
      else if (row.key === 'ground') str = !showExisting || r.ground == null ? '—' : num(r.ground, 3);
      else if (row.key === 'diff') str = !showExisting || r.diff == null ? '—' : num(r.diff, 3);
      else str = num(r.design, 3);
      dl.add(text('TABLE_TEXT', c.x, yMid, row.key === 'chainage' ? numH * 0.94 : numH, str, { align: 'center', vAlign: 'middle' }));
    }
  });

  return dl;
}
