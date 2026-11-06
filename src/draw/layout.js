/**
 * Sheet layout: page bands, drawing scales, and the coordinate transforms that
 * place plan, profile and table on the page. Everything is in millimetres.
 *
 *   +--------------------------------------------------------------+
 *   |  PLAN            (rotated alignment, stations, curves)       |
 *   +--------------------------------------------------------------+
 *   |  PROFILE         (grid, levels, design vs existing)          |
 *   +--------------------------------------------------------------+
 *   |  LEVELS TABLE    (profile / existing / chainage / H.T. diff) |
 *   +--------------------------------------------------------------+
 *   |  REVISION | CLIENT | PROJECT / DRAWING TITLE | CONSULTANT     |
 *   +--------------------------------------------------------------+
 */
import { clamp } from '../core/format.js';

const H_SCALES = [100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12500, 15000, 20000];
const V_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];

export function computeBands(sheet) {
  const { w: W, h: H } = sheet;
  const border = { x0: 8, y0: 8, x1: W - 8, y1: H - 8 };
  const frame = { x0: 12.5, y0: 12.5, x1: W - 12.5, y1: H - 12.5 };

  const titleH = clamp(H * 0.158, 40, 160);
  const tableH = clamp(H * 0.112, 28, 120);
  const planH = clamp(H * 0.318, 88, 380);

  const title = { x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y0 + titleH };
  const table = { x0: frame.x0, y0: title.y1, x1: frame.x1, y1: title.y1 + tableH };
  const profile = { x0: frame.x0, y0: table.y1 + 1.5, x1: frame.x1, y1: frame.y1 - planH - 3 };
  const plan = { x0: frame.x0, y0: frame.y1 - planH, x1: frame.x1, y1: frame.y1 };

  return { border, frame, title, table, profile, plan };
}

/** Rotated plan geometry: fit the alignment into the plan band. */
export function planTransform(model, bands, opts = {}) {
  const plan = bands.plan;
  const padX = Math.max(5, (plan.x1 - plan.x0) * 0.012);
  const padTop = Math.max(6, (plan.y1 - plan.y0) * 0.04);
  const padBottom = Math.max(12, (plan.y1 - plan.y0) * 0.16);
  const availW = plan.x1 - plan.x0 - 2 * padX;
  const availH = plan.y1 - plan.y0 - padTop - padBottom;

  const segments = model.alignment.segments;
  const startAz = segments[0]?.startAzimuth ?? 90;
  const rot = startAz - 90; // rotate so the first tangent runs +x
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const rotate = (e, n) => [e * cos - n * sin, e * sin + n * cos];

  // sample every alignment for the fit box
  const pts = [];
  for (const al of [model.alignment, ...model.sides.map((s) => s.alignment)]) {
    const step = Math.max(1, al.totalLength / 400);
    for (let s = 0; s <= al.totalLength; s += step) {
      const p = al.pointAt(s);
      pts.push(rotate(p.e, p.n));
      // include carriageway edges so labels/edges never clip
      const half = (al.def.width?.carriageway ?? 7.3) / 2 + (al.def.width?.shoulder ?? 1.5) + 2;
      const q1 = al.pointAt(s, half), q2 = al.pointAt(s, -half);
      pts.push(rotate(q1.e, q1.n), rotate(q2.e, q2.n));
    }
  }
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [x, y] of pts) {
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
  const bw = Math.max(bx1 - bx0, 1e-6);
  const bh = Math.max(by1 - by0, 1e-6);

  const length = model.alignment.totalLength;
  const plotW = opts.plotW ?? (bands.profile.x1 - bands.profile.x0 - 34);
  const required = Math.min(
    availW / bw,
    availH / Math.max(bh, 6),        // straight roads keep a usable scale
    plotW / Math.max(length, 1),
  );
  const fitDen = required > 0 ? 1000 / required : 2000;
  const hDen = opts.hDen && opts.hDen !== 'auto'
    ? Number(opts.hDen)
    : (H_SCALES.find((d) => d >= fitDen * 0.999) ?? H_SCALES[H_SCALES.length - 1]);
  const s = 1000 / hDen;

  const w = bw * s, h = bh * s;
  const x0 = plan.x0 + padX + (availW - w) / 2 - bx0 * s;
  const yBias = clamp((availH - h) * 0.5, 0, 1e9);
  const y0 = plan.y0 + padBottom + yBias - by0 * s;

  return {
    rot, s, hDen, box: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    // origin of the rotated coordinate system (not the band rectangle)
    ox: x0, oy: y0,
    // band rectangle on the sheet
    x0: plan.x0, y0: plan.y0, x1: plan.x1, y1: plan.y1,
    toSheet(e, n) {
      const [x, y] = rotate(e, n);
      return [x0 + x * s, y0 + y * s];
    },
  };
}

/** Profile vertical scale and level axis. */
export function profileAxis(model, bands, opts = {}) {
  const profile = bands.profile;
  const marginL = clamp((bands.frame.x1 - bands.frame.x0) * 0.053, 26, 46);
  const marginR = clamp((bands.frame.x1 - bands.frame.x0) * 0.025, 12, 22);
  const plot = {
    x0: profile.x0 + marginL,
    x1: profile.x1 - marginR,
    y0: profile.y0 + 3,
    y1: profile.y1 - 3,
  };
  const design = model.profile.pvis.map((p) => p.elev);
  const ground = model.profile.ground ? model.profile.ground.levels : [];
  const structs = model.structures.flatMap((st) => [st.design, st.ground].filter((v) => v != null));
  const all = [...design, ...ground, ...structs];
  const dataLo = Math.min(...all), dataHi = Math.max(...all);
  const dataRange = Math.max(dataHi - dataLo, 0.8);
  const plotH = plot.y1 - plot.y0;

  // choose the smallest denominator that still contains the data with 5% air
  const fitDen = (dataRange * 1.06 * 1000) / plotH;
  const vDen = opts.vDen && opts.vDen !== 'auto'
    ? Number(opts.vDen)
    : (V_SCALES.find((d) => d >= fitDen * 0.999) ?? V_SCALES[V_SCALES.length - 1]);
  const sV = 1000 / vDen;
  const targetRange = plotH / sV;

  // grid spacing: 6..14 intervals, ~10 mm apart, snapping to round levels
  let gridInterval = Number(opts.gridInterval ?? 0);
  if (!gridInterval) {
    gridInterval = [0.2, 0.25, 0.5, 1, 2, 5, 10, 20].find((g) => targetRange / g <= 10) ?? 20;
    if (dataRange / gridInterval < 3) gridInterval = Math.max(0.2, gridInterval / 2);
  }
  const nIntervals = Math.max(2, Math.floor(targetRange / gridInterval + 1e-9));
  const lo = Math.floor(((dataLo + dataHi) / 2 - (nIntervals * gridInterval) / 2) / gridInterval) * gridInterval;
  const hi = lo + nIntervals * gridInterval;
  const levelH = (hi - lo) * sV;
  const yBase = plot.y0 + (plotH - levelH) / 2;

  return {
    ...plot,
    lo, hi, gridInterval, vDen, sV, dataLo, dataHi,
    y(level) { return yBase + (level - lo) * sV; },
  };
}

/** Station axis shared by the profile grid and the levels table. */
export function stationAxis(model, bands, plan, axis) {
  const plot = axis;
  const length = model.alignment.totalLength;
  const start = model.alignment.startStation;
  const s = plan.s;
  const width = length * s;
  const x0 = plot.x0 + (plot.x1 - plot.x0 - width) / 2;
  const xs = (st) => x0 + (st - start) * s;

  // thin the columns until the numbers fit their cells
  const interval = model.interval;
  const targetSpacing = 7.6;
  const step = Math.max(1, Math.ceil(targetSpacing / Math.max(interval * s, 0.01)));
  const columns = [];
  for (let i = 0; i < model.stations.length; i += step) {
    const st = model.stations[i];
    if (st > start + length + 1e-6) break;
    columns.push({ station: st, x: xs(st), index: i });
  }
  // drop the second-to-last column when a partial final interval would collide
  if (columns.length > 2) {
    const n = columns.length;
    const gap = columns[n - 1].x - columns[n - 2].x;
    const typical = columns[n - 2].x - columns[n - 3].x;
    if (gap < typical * 0.66) columns.splice(n - 2, 1);
  }
  // make sure the final station is present
  const lastStation = model.stations[model.stations.length - 1];
  if (!columns.length || Math.abs(columns[columns.length - 1].station - lastStation) > 1e-6) {
    columns.push({ station: lastStation, x: xs(lastStation), index: model.stations.length - 1 });
  }
  const spacing = (columns.length > 1 ? (columns[columns.length - 1].x - columns[0].x) / (columns.length - 1) : width);

  return {
    x0, x1: x0 + width, xs, columns, step, spacing,
    start, end: start + length, width,
  };
}

/**
 * Full layout for a derived model.
 * Returns bands, scales and the transform helpers the drawing modules use.
 */
export function layoutSheet(model) {
  const sheet = model.sheet;
  const bands = computeBands(sheet);
  const settings = model.project.settings;

  // two-pass: the first plan fit needs the profile width, which is fixed by the bands
  const plan0 = planTransform(model, bands, { hDen: settings.hScale });
  const axis = profileAxis(model, bands, { vDen: settings.vScale, gridInterval: settings.gridInterval });
  const stations = stationAxis(model, bands, plan0, axis);
  const plan = planTransform(model, bands, { hDen: settings.hScale, plotW: axis.x1 - axis.x0 });

  const table = {
    x0: bands.table.x0, y0: bands.table.y0, x1: bands.table.x1, y1: bands.table.y1,
    rowH: (bands.table.y1 - bands.table.y0) / 4,
    labelW: axis.x0 - bands.table.x0,
    columns: stations.columns,
    step: stations.step,
    halfSpacing: stations.spacing / 2,
  };

  return {
    sheet, bands,
    frame: bands.frame, border: bands.border,
    plan, profile: axis, stations, table,
    scales: { hDen: plan.hDen, vDen: axis.vDen, planS: plan.s, profileSV: axis.sV },
    sheetLabel: `${sheet.w} x ${sheet.h} mm`,
    issue: { date: model.project.meta.date, sheetNo: model.project.meta.sheetNo },
  };
}

export { H_SCALES, V_SCALES };
