/**
 * Plan view: rotated alignment drawn to sheet coordinates, with centreline,
 * carriageway/shoulder edges, chainage ticks and labels, PC/PT callouts, curve
 * data blocks, bearings, side roads, north arrow and scale bar.
 */
import { line, poly, text, circle, triangle, textBlock } from './entities.js';
import { bearing, station } from '../core/format.js';
import { LAYERS } from './layers.js';

const D2R = Math.PI / 180;

function dirAt(layout, al, st) {
  const a = al.pointAt(Math.max(0, st - 0.5));
  const b = al.pointAt(Math.min(al.totalLength, st + 0.5));
  const pa = layout.plan.toSheet(a.e, a.n);
  const pb = layout.plan.toSheet(b.e, b.n);
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l, rot: (Math.atan2(dy, dx) * 180) / Math.PI };
}

function sheetPoint(layout, al, st, offset = 0) {
  const p = al.pointAt(st, offset);
  return layout.plan.toSheet(p.e, p.n);
}

/** Keeps plan annotations from overprinting each other. */
class LabelSpace {
  constructor() { this.boxes = []; }
  register(box) { if (box) this.boxes.push(box); }
  free(box) {
    for (const b of this.boxes) {
      if (box.x0 < b.x1 - 0.2 && box.x1 > b.x0 + 0.2 && box.y0 < b.y1 - 0.2 && box.y1 > b.y0 + 0.2) return false;
    }
    return true;
  }
  place(x, y, w, h, rot, steps = [0, 2.6, -2.6, 5.2, -5.2, 7.8, -7.8]) {
    for (const dy of steps) {
      const box = rotatedBox(x, y + dy, w, h, rot);
      if (this.free(box)) { this.register(box); return { x, y: y + dy }; }
    }
    return { x, y };
  }
}

function rotatedBox(x, y, w, h, rot) {
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]);
  return {
    x0: Math.min(...corners.map((c) => c[0])), y0: Math.min(...corners.map((c) => c[1])),
    x1: Math.max(...corners.map((c) => c[0])), y1: Math.max(...corners.map((c) => c[1])),
  };
}

export function drawPlan(dl, model, layout) {
  const { plan } = layout;
  const settings = model.project.settings;
  const labels = new LabelSpace();

  const alignments = [{ al: model.alignment, main: true, name: model.alignment.def.name }];
  if (settings.showSideRoads !== false) {
    for (const side of model.sides) alignments.push({ al: side.alignment, main: false, name: side.name });
  }

  // ---- carriageway / shoulders -------------------------------------------
  const mainSamples = samplePolyline(model.alignment, 2);
  for (const { al, main } of alignments) {
    const w = al.def.width ?? { carriageway: 7.3, shoulder: 1.5 };
    const half = w.carriageway / 2;
    const shoulder = half + w.shoulder;
    const step = Math.max(1, al.totalLength / 800);
    const edgeLayer = main ? 'PLAN_EDGE' : 'PLAN_SOFT';
    const clip = main ? 0 : 5.2;
    for (const [off, layer] of [[half, edgeLayer], [-half, edgeLayer], [shoulder, 'PLAN_SOFT'], [-shoulder, 'PLAN_SOFT']]) {
      const pts = al.pointsForRange(0, al.totalLength, off, step)
        .map((p) => layout.plan.toSheet(p.e, p.n));
      for (const run of trimNear(pts, mainSamples, clip)) if (run.length > 1) dl.add(poly(layer, run));
    }
    const cl = al.pointsForRange(0, al.totalLength, 0, Math.max(0.5, step / 3)).map((p) => layout.plan.toSheet(p.e, p.n));
    for (const run of trimNear(cl, mainSamples, clip)) if (run.length > 1) dl.add(poly('PLAN_CL', run));
  }

  // ---- chainage ticks + labels on the main line --------------------------
  const al = model.alignment;
  const tick = Number(settings.tickInterval ?? 10);
  const labelEvery = Number(settings.labelInterval ?? 50);
  const shoulder = (al.def.width?.carriageway ?? 7.3) / 2 + (al.def.width?.shoulder ?? 1.5);
  for (let st = 0; st <= al.totalLength + 1e-6; st += tick) {
    const d = dirAt(layout, al, st);
    const p = sheetPoint(layout, al, st, 0);
    const isLabel = Math.abs(st % labelEvery) < 1e-6 || Math.abs(st % labelEvery - labelEvery) < 1e-6;
    const halfLen = isLabel ? 1.7 : 1.0;
    dl.add(line(isLabel ? 'PLAN_TICK' : 'PLAN_SOFT',
      p[0] - d.y * halfLen, p[1] + d.x * halfLen,
      p[0] + d.y * halfLen, p[1] - d.x * halfLen));
    if (isLabel) {
      const edge = sheetPoint(layout, al, st, shoulder);
      const lx = edge[0] + 0.5, ly = edge[1] + 2.2;
      labels.register(rotatedBox(lx, ly, String(station(st, 0)).length * 0.95, 1.7, 90));
      dl.add(text('PLAN_TEXT', lx, ly, 1.7, station(st, 0), { rot: 90, align: 'left', vAlign: 'bottom' }));
    }
  }

  // ---- start / end witness lines and big chainage labels -----------------
  for (const [st, label, align] of [[0, station(0, 0), 'left'], [al.totalLength, station(al.totalLength, 0), 'right']]) {
    const d = dirAt(layout, al, st);
    const p = sheetPoint(layout, al, st, 0);
    const half = 8.0;
    dl.add(line('PLAN_LEADER', p[0] - d.y * half, p[1] + d.x * half, p[0] + d.y * half, p[1] - d.x * half));
    const edge = sheetPoint(layout, al, st, 0);
    dl.add(text('PLAN_TEXT', edge[0] + (align === 'left' ? -1.2 : 1.2), edge[1] - 9.5, 2.0, label, { bold: true, align }));
  }

  // ---- horizontal curve callouts -----------------------------------------
  if (settings.showCurves !== false) {
    for (const c of al.curves) {
      const midD = dirAt(layout, al, c.midStation);
      let n = { x: -midD.y, y: midD.x };
      if (n.y > 0 || (Math.abs(n.y) < 0.15 && n.x > 0)) n = { x: -n.x, y: -n.y };
      const down = n;
      // PC / PT labels just outside the carriageway on the annotation side
      for (const [tag, st] of [['PC', c.startStation], ['PT', c.endStation]]) {
        const d = dirAt(layout, al, st);
        const p = sheetPoint(layout, al, st, 0);
        const nx = down.x, ny = down.y;
        const ax = p[0] + nx * 3.4, ay = p[1] + ny * 3.4;
        dl.add(line('PLAN_LEADER', p[0] + nx * 1.2, p[1] + ny * 1.2, ax, ay));
        dl.add(text('PLAN_TEXT', ax + d.x * 0.8, ay + d.y * 0.8, 1.55, `${tag}: ${station(st)}`,
          { align: tag === 'PC' ? 'right' : 'left', rot: d.rot, vAlign: 'top' }));
      }
      const mid = layout.plan.toSheet(c.midPoint.e, c.midPoint.n);
      const ax = mid[0] + down.x * 12, ay = mid[1] + down.y * 12;
      dl.add(line('PLAN_LEADER', mid[0] + down.x * 1.4, mid[1] + down.y * 1.4, ax, ay));
      const lines = [
        `E=${c.pi.e.toFixed(3)}`,
        `N=${c.pi.n.toFixed(3)}`,
        `R=${c.radius.toFixed(3)}`,
        `L=${c.length.toFixed(3)}`,
        `Tan=${c.tangentLength.toFixed(3)}`,
        `DEFL=${c.deflection.toFixed(4)}\u00b0`,
      ];
      const bx = Math.min(Math.max(ax, plan.x0 + 3), plan.x1 - 30);
      const by = Math.min(Math.max(ay, plan.y0 + 5), plan.y1 - 18);
      dl.add(textBlock('PLAN_TEXT', lines, { x: bx, y: by, h: 1.4, rot: midD.rot, align: 'left' }));
    }
  }

  // ---- bearings along the tangents --------------------------------------
  if (settings.showBearings !== false) {
    for (const seg of al.segments) {
      if (seg.kind !== 'tangent' || seg.length < 55) continue;
      const st = (seg.startStation + seg.endStation) / 2;
      const d = dirAt(layout, al, st);
      const p = sheetPoint(layout, al, st, shoulder + 14);
      const w = String(bearing(seg.startAzimuth)).length * 0.95;
      const spot = labels.place(p[0] - w / 2, p[1], w, 1.8, d.rot);
      dl.add(text('PLAN_TEXT', spot.x, spot.y, 1.7, bearing(seg.startAzimuth), { rot: d.rot, align: 'left', vAlign: 'bottom' }));
    }
  }

  // ---- side road names ---------------------------------------------------
  for (const side of model.sides) {
    const st = side.alignment.totalLength * 0.62;
    const d = dirAt(layout, side.alignment, st);
    const p = sheetPoint(layout, side.alignment, st, 0);
    const nx = -d.y, ny = d.x;
    dl.add(text('PLAN_TEXT', p[0] + nx * 8, p[1] + ny * 8, 1.7, side.name, { rot: d.rot, align: 'center', bold: true }));
  }

  // ---- PLAN label, scale bar --------------------------------------------
  dl.add(text('PLAN_TEXT', plan.x0 + 1.5, plan.y1 - 3.2, 2.6, 'PLAN', { bold: true }));
  dl.add(line('PLAN_TEXT', plan.x0 + 1.5, plan.y1 - 4.8, plan.x0 + 12.5, plan.y1 - 4.8));
  dl.add(text('PLAN_TEXT', plan.x0 + 1.5, plan.y1 - 8.0, 1.6, `SCALE  1 : ${plan.hDen}`));
  dl.add(drawNorthArrow(plan.x1 - 12, plan.y1 - 13, 11));
  dl.add(drawScaleBar(layout, plan));
  return dl;
}

function samplePolyline(al, step) {
  const pts = [];
  for (let s = 0; s <= al.totalLength; s += step) pts.push(al.pointAt(s));
  return pts;
}

/** Split a sheet-space polyline, dropping points closer than `minDist` to the
 *  main alignment (so a side road stops cleanly at the carriageway edge). */
function trimNear(points, mainPts, minDist) {
  if (!minDist) return [points];
  const runs = [];
  let run = [];
  for (const p of points) {
    let near = false;
    for (let i = 0; i < mainPts.length; i++) {
      const q = mainPts[i];
      if (Math.abs(q.e - p.e) > 60 && Math.abs(q.n - p.n) > 60) continue;
      if (Math.hypot(q.e - p.e, q.n - p.n) < minDist) { near = true; break; }
    }
    if (near) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export function drawNorthArrow(cx, cy, size) {
  const entities = [];
  const h = size, w = size * 0.42;
  entities.push(triangle('NORTH', [[cx, cy + h / 2], [cx - w / 2, cy - h / 2], [cx, cy - h / 2 + 1.2]]));
  entities.push(poly('NORTH', [[cx, cy + h / 2], [cx + w / 2, cy - h / 2], [cx, cy - h / 2 + 1.2]], true));
  entities.push(circle('NORTH', cx, cy, size * 0.3));
  entities.push(text('NORTH', cx, cy + h / 2 + 1.2, 2.6, 'N', { align: 'center', bold: true }));
  return entities;
}

export function drawScaleBar(layout, plan) {
  const s = plan.s;
  const x = plan.x0 + 1.5;
  const y = layout.bands.plan.y0 + 5.5;
  const total = 100 * s;
  const seg = 25 * s;
  const h = 1.3;
  const entities = [];
  for (let i = 0; i < 4; i++) {
    const x0 = x + i * seg;
    entities.push(poly('NOTE', [[x0, y], [x0 + seg, y], [x0 + seg, y + h], [x0, y + h]], true));
    if (i % 2 === 1) entities.push(poly('NOTE', [[x0, y], [x0 + seg, y], [x0 + seg, y + h], [x0, y + h]], true));
  }
  entities.push(text('NOTE', x, y - 0.5, 1.45, '0', { align: 'center', vAlign: 'top' }));
  entities.push(text('NOTE', x + 2 * seg, y - 0.5, 1.45, '50', { align: 'center', vAlign: 'top' }));
  entities.push(text('NOTE', x + 4 * seg, y - 0.5, 1.45, '100 m', { align: 'center', vAlign: 'top' }));
  return entities;
}
