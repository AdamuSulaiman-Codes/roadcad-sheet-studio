/**
 * Vertical alignment profile: level grid, design vs existing ground, grade
 * labels, vertical curve tags (PVC/PVT), curve callout boxes with K and A.D.,
 * and drainage structures.
 */
import { line, poly, text, circle, textBlock } from './entities.js';
import { bearing, num, station } from '../core/format.js';

const levelFmt = (v, g) => (g < 1 ? v.toFixed(1) : v.toFixed(0));

export function drawProfile(dl, model, layout) {
  const ax = layout.profile;
  const prof = model.profile;
  const showExisting = model.project.settings.showExisting !== false;
  const { x0, y0, x1, y1 } = ax;
  const xs = layout.stations.xs;
  const start = model.alignment.startStation;
  const end = model.alignment.endStation;
  const cols = layout.stations.columns;

  // ---- grid --------------------------------------------------------------
  for (let lv = ax.lo; lv <= ax.hi + 1e-9; lv += ax.gridInterval) {
    const y = ax.y(lv);
    dl.add(line('PROF_GRID', x0, y, x1, y));
  }
  for (const c of cols) dl.add(line('PROF_GRID', c.x, y0, c.x, y1));
  dl.add(poly('PROF_AXIS', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true));

  // ---- level labels both sides ------------------------------------------
  const lh = 1.65;
  for (let lv = ax.lo; lv <= ax.hi + 1e-9; lv += ax.gridInterval) {
    const y = ax.y(lv);
    dl.add(text('PROF_TEXT', x0 - 1.4, y, lh, levelFmt(lv, ax.gridInterval), { align: 'right', vAlign: 'middle' }));
    dl.add(text('PROF_TEXT', x1 + 1.4, y, lh, levelFmt(lv, ax.gridInterval), { align: 'left', vAlign: 'middle' }));
  }
  dl.add(text('PROF_TEXT', x0 - 13.5, (y0 + y1) / 2, 1.6, 'LEVEL (m)', { align: 'center', vAlign: 'middle', rot: 90 }));

  // ---- profile lines -----------------------------------------------------
  const step = Math.max(0.5, Math.min(4, model.alignment.totalLength / 500));
  const designPts = [];
  const groundPts = [];
  for (let st = start; st <= end + 1e-9; st += step) {
    designPts.push([xs(st), ax.y(prof.elevationAt(st))]);
    if (prof.ground && showExisting) groundPts.push([xs(st), ax.y(prof.groundAt(st))]);
  }
  designPts.push([xs(end), ax.y(prof.elevationAt(end))]);
  if (prof.ground && showExisting) {
    groundPts.push([xs(end), ax.y(prof.groundAt(end))]);
    dl.add(poly('PROF_GROUND', groundPts));
  }
  dl.add(poly('PROF_DESIGN', designPts));

  // ---- grade labels ------------------------------------------------------
  for (const seg of prof.gradeSegments) {
    const span = seg.endStation - seg.startStation;
    if (span < 18) continue;
    const st = (seg.startStation + seg.endStation) / 2;
    const x = xs(st);
    const y = ax.y(prof.elevationAt(st));
    const label = `${num(seg.grade, 2, { sign: true })}%`;
    dl.add(text('PROF_TEXT', x, y + 2.4, 1.85, label, { align: 'center', bold: true }));
    const w = String(label).length * 1.05;
    dl.add(line('PROF_CALLOUT', x - w / 2, y + 1.9, x + w / 2, y + 1.9));
  }

  // ---- PVC / PVT tags ----------------------------------------------------
  for (const c of prof.curves) {
    for (const [name, st, elev] of [['PVC', c.pvcStation, c.pvcElev], ['PVT', c.pvtStation, c.pvtElev]]) {
      const x = xs(st);
      const y = ax.y(elev);
      dl.add(line('PROF_CALLOUT', x, y, x, y1 - 1.2));
      dl.add(text('PROF_CALLOUT', x + 0.9, y + 6.5, 1.4, `${name}  ${station(st)}`, { rot: 90, align: 'left' }));
      dl.add(text('PROF_CALLOUT', x + 2.9, y + 6.5, 1.4, `ELEV=${num(elev, 3)}`, { rot: 90, align: 'left' }));
    }
    // callout block above the curve
    const label = c.type === 'crest' ? 'CREST CURVE' : 'SAG CURVE';
    const linesArr = [`L=${num(c.L, 3)}`];
    if (c.extreme) {
      linesArr.push(`${c.extreme.type} POINT STA=${station(c.extreme.station)}`);
      linesArr.push(`${c.extreme.type} POINT ELEV=${num(c.extreme.elev, 3)}`);
    }
    linesArr.push(`PVI STA=${station(c.pviStation)}`);
    linesArr.push(`PVI ELEV=${num(c.pviElev, 3)}`);
    linesArr.push(`A.D.=${num(Math.abs(c.A), 2)}%`);
    linesArr.push(`K=${num(c.K, 2)}`);
    const top = y1 - 2.2;
    const blockH = (linesArr.length + 1) * 2.35;
    let xPvi = xs(c.pviStation);
    const overlapsCurve = ax.y(c.pviElev) > top - blockH - 3;
    if (overlapsCurve) {
      const mid = (x0 + x1) / 2;
      xPvi = xPvi > mid ? xPvi - 34 : xPvi + 34;
      xPvi = Math.min(Math.max(xPvi, x0 + 30), x1 - 30);
    }
    dl.add(text('PROF_CALLOUT', xPvi, top - 0.8, 1.5, label, { align: 'center', bold: true }));
    dl.add(textBlock('PROF_CALLOUT', linesArr, { x: xPvi, y: top - 2.8, h: 1.45, align: 'center' }));
    if (c.extreme) {
      const ex = xs(c.extreme.station), ey = ax.y(c.extreme.elev);
      dl.add(circle('PROF_TEXT', ex, ey, 0.45));
      if (overlapsCurve) {
        dl.add(line('PROF_CALLOUT', ex, ey, xPvi, top - 2.8 - linesArr.length * 2.35 + 1.0));
      } else {
        dl.add(line('PROF_CALLOUT', ex, ey, ex, ey + 4.5));
      }
    }
  }

  // ---- drainage structures ----------------------------------------------
  const dims = model.project.structures ?? [];
  const sorted = [...model.structures].sort((a, b) => a.station - b.station);
  let lastLabelY = -Infinity;
  for (const s of sorted) {
    const x = xs(s.station);
    const y = ax.y(s.design);
    const dia = parsePipeSize(s.size);
    const r = Math.min(Math.max((dia / 2) * ax.sV, 1.0), 2.6);
    dl.add(circle('PROF_TEXT', x, y, r));
    dl.add(line('PROF_TEXT', x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7));
    dl.add(line('PROF_CALLOUT', x, y - r, x, y - 9));
    let ly = Math.max(y - 10.2, y0 + 2.2);
    if (ly > lastLabelY - 3.4) ly = Math.max(y0 + 2.2, lastLabelY - 3.6);
    lastLabelY = ly;
    dl.add(text('PROF_CALLOUT', x, ly, 1.45, s.label || `PROP. ${s.size} Pipe`, { align: 'center' }));
  }

  // ---- band label + scale note ------------------------------------------
  dl.add(text('PROF_TEXT', layout.bands.profile.x0 + 1.2, y1 - 1.4, 2.2, 'PROFILE', { bold: true }));
  dl.add(line('PROF_TEXT', layout.bands.profile.x0 + 1.2, y1 - 2.9, layout.bands.profile.x0 + 17, y1 - 2.9));
  dl.add(text('PROF_CALLOUT', x0 + 1.2, y1 - 4.6, 1.4,
    `H 1:${layout.scales.hDen}   V 1:${layout.scales.vDen}`, { bold: false }));

  return dl;
}

function parsePipeSize(size) {
  const m = /(\d+(?:\.\d+)?)\s*mm/i.exec(String(size ?? ''));
  if (m) return Number(m[1]) / 1000;
  const n = Number(size);
  return Number.isFinite(n) && n > 0 ? n : 0.9;
}

export function drawProfileLegendTests() {
  return [];
}
