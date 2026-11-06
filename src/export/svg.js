/**
 * SVG renderer: DrawList -> standalone SVG document (millimetres).
 *
 * Sheet space is y-up with its origin at the bottom-left corner; SVG user space
 * is y-down, so every emitted coordinate is flipped (`y' = sheetH - y`) and a
 * counter-clockwise sheet rotation `rot` becomes `rotate(-rot x y)`.
 *
 * Layer styling (colour, line weight, dash pattern) always comes from
 * `src/draw/layers.js`; nothing is hard-coded here.
 */
import { LAYERS, LINETYPES } from '../draw/layers.js';

/** Helvetica cap height as a fraction of the em. */
const CAP_RATIO = 0.717;
const FONT_FAMILY = 'Helvetica Neue, Arial, Helvetica, sans-serif';
const FALLBACK_STYLE = { color: '#101010', lw: 0.18, ltype: 'CONTINUOUS' };

/** align -> SVG text-anchor */
const ANCHOR = { left: 'start', center: 'middle', right: 'end' };
/** vAlign -> SVG dominant-baseline */
const BASELINE = { baseline: 'alphabetic', bottom: 'baseline', middle: 'middle', top: 'hanging' };

function styleOf(layer) {
  return LAYERS[layer] ?? FALLBACK_STYLE;
}

/** Compact fixed-point number: at most `dp` decimals, no trailing zeros. */
function fmt(v, dp = 4) {
  if (!Number.isFinite(v)) return null;
  const r = Number(v.toFixed(dp));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Escape the five XML metacharacters (and drop illegal control characters). */
export function escapeXML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function isPoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** `M x y L x y ...` (+ `Z` for closed shapes) in flipped SVG coordinates. */
function pathData(pts, sheetH, closed) {
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const x = fmt(pts[i][0]);
    const y = fmt(sheetH - pts[i][1]);
    if (x == null || y == null) return null;
    d += `${i === 0 ? 'M' : 'L'} ${x} ${y} `;
  }
  return closed ? `${d}Z` : d.trimEnd();
}

/** LINETYPES pattern in mm, gaps as positive numbers; '' when continuous. */
function dashArray(layer) {
  const ltype = styleOf(layer).ltype;
  const pattern = LINETYPES[ltype] ?? [];
  if (!pattern.length) return '';
  return pattern.map((v) => fmt(Math.abs(v))).join(' ');
}

const TAU = Math.PI * 2;

/**
 * Normalise an arc to a CCW sweep of (0, 360].
 * Returns null when the arc is degenerate (empty or zero radius).
 */
function arcDelta(startDeg, endDeg) {
  if (!Number.isFinite(startDeg) || !Number.isFinite(endDeg)) return null;
  let delta = endDeg - startDeg;
  if (delta >= 360 - 1e-9) delta = 360;
  else {
    delta = ((delta % 360) + 360) % 360;
    if (delta < 1e-9) return null;
  }
  return delta;
}

function renderText(e, sheetH) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.h) || e.h <= 0) return '';
  const color = styleOf(e.layer).color;
  const fontSize = e.h / CAP_RATIO;
  const x = fmt(e.x);
  const y = fmt(sheetH - e.y);
  const fs = fmt(fontSize);
  if (x == null || y == null || fs == null) return '';
  const anchor = ANCHOR[e.align] ?? ANCHOR.left;
  const baseline = BASELINE[e.vAlign] ?? BASELINE.baseline;
  const parts = [
    `<text x="${x}" y="${y}"`,
    `font-family="${FONT_FAMILY}"`,
    `font-size="${fs}"`,
    `fill="${escapeXML(color)}"`,
    `text-anchor="${anchor}"`,
    `dominant-baseline="${baseline}"`,
  ];
  if (e.bold) parts.push('font-weight="bold"');
  if (e.italic) parts.push('font-style="italic"');
  const rot = Number(e.rot) || 0;
  if (Math.abs(rot) > 1e-9) {
    const r = fmt(-rot);
    parts.push(`transform="rotate(${r} ${x} ${y})"`);
  }
  return `${parts.join(' ')}>${escapeXML(e.text)}</text>`;
}

function renderEntity(e, sheetH, color) {
  switch (e.type) {
    case 'line': {
      if (!isPoint(e.a) || !isPoint(e.b)) return '';
      const d = pathData([e.a, e.b], sheetH, false);
      return d ? `<path d="${d}"/>` : '';
    }
    case 'poly': {
      const pts = e.pts ?? [];
      if (pts.length < 2 || !pts.every(isPoint)) return '';
      const d = pathData(pts, sheetH, Boolean(e.closed));
      return d ? `<path d="${d}"/>` : '';
    }
    case 'circle': {
      if (!isPoint(e.c) || !Number.isFinite(e.r) || e.r <= 0) return '';
      const cx = fmt(e.c[0]);
      const cy = fmt(sheetH - e.c[1]);
      const r = fmt(e.r);
      if (cx == null || cy == null || r == null) return '';
      return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
    }
    case 'arc': {
      if (!isPoint(e.c) || !Number.isFinite(e.r) || e.r <= 0) return '';
      const delta = arcDelta(e.start, e.end);
      if (delta == null) return '';
      const cx = e.c[0];
      const cy = e.c[1];
      const r = e.r;
      if (delta >= 360 - 1e-9) {
        const sx = fmt(cx);
        const sy = fmt(sheetH - cy);
        return `<circle cx="${sx}" cy="${sy}" r="${fmt(r)}"/>`;
      }
      const a0 = (e.start * Math.PI) / 180;
      const a1 = ((e.start + delta) * Math.PI) / 180;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      const x0 = fmt(p0[0]);
      const y0 = fmt(sheetH - p0[1]);
      const x1 = fmt(p1[0]);
      const y1 = fmt(sheetH - p1[1]);
      const rr = fmt(r);
      if (x0 == null || y0 == null || x1 == null || y1 == null || rr == null) return '';
      // CCW in y-up sheet space maps to a negative-angle (sweep 0) arc in y-down SVG space.
      const largeArc = delta > 180 ? 1 : 0;
      return `<path d="M ${x0} ${y0} A ${rr} ${rr} 0 ${largeArc} 0 ${x1} ${y1}"/>`;
    }
    case 'triangle': {
      const pts = e.pts ?? [];
      if (pts.length !== 3 || !pts.every(isPoint)) return '';
      const d = pathData(pts, sheetH, true);
      if (!d) return '';
      return `<path d="${d}" fill="${escapeXML(color)}" stroke="none"/>`;
    }
    case 'text':
      return renderText(e, sheetH);
    default:
      return '';
  }
}

/** Collect entities into first-appearance layer groups. */
function groupByLayer(entities) {
  const groups = new Map();
  for (const e of entities) {
    if (!e || typeof e.type !== 'string') continue;
    const layer = typeof e.layer === 'string' && e.layer ? e.layer : 'NOTE';
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push(e);
  }
  return groups;
}

/**
 * Render a DrawList to a standalone SVG document.
 *
 * @param {{entities: Array}} dl       DrawList from src/draw/entities.js
 * @param {{sheet: {w:number,h:number}}} layout  sheet layout (mm)
 * @param {{background?: string}} [opts]
 * @returns {string} SVG document
 */
export function renderSVG(dl, layout, opts = {}) {
  const sheet = layout?.sheet ?? { w: 594, h: 420 };
  const w = Number(sheet.w);
  const h = Number(sheet.h);
  const background = opts.background ?? '#ffffff';
  const entities = Array.isArray(dl) ? dl : (dl?.entities ?? []);
  const groups = groupByLayer(entities);

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
  );
  out.push(`<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="${escapeXML(background)}"/>`);
  for (const [layer, list] of groups) {
    const style = styleOf(layer);
    const attrs = [
      `data-layer="${escapeXML(layer)}"`,
      'fill="none"',
      `stroke="${escapeXML(style.color)}"`,
      `stroke-width="${fmt(style.lw)}"`,
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    ];
    const dashes = dashArray(layer);
    if (dashes) attrs.push(`stroke-dasharray="${dashes}"`);
    out.push(`<g ${attrs.join(' ')}>`);
    for (const e of list) {
      const markup = renderEntity(e, h, style.color);
      if (markup) out.push(markup);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
