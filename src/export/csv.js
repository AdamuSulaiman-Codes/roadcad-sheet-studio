/** CSV of the station table (chainage / levels / cut-fill), Excel friendly. */
import { station } from '../core/format.js';

export function buildCSV(model, scales = null) {
  const p = model.project;
  const lines = [];
  lines.push(`# ${p.meta.projectTitle}`);
  lines.push(`# ${p.meta.drawingTitle} - sheet ${p.meta.sheetNo} - ${p.meta.date}`);
  const sc = scales ?? model.layoutScales ?? null;
  if (sc) lines.push(`# H 1:${sc.hDen}  V 1:${sc.vDen}`);
  lines.push('chainage,station_m,profile_level_m,existing_level_m,ht_diff_m,grade_pct');
  for (const r of model.rows) {
    lines.push([
      station(r.station, 0),
      r.station.toFixed(3),
      r.design.toFixed(3),
      r.ground == null ? '' : r.ground.toFixed(3),
      r.diff == null ? '' : r.diff.toFixed(3),
      r.grade == null ? '' : r.grade.toFixed(3),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}
