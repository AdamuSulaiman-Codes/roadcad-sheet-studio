/**
 * Entity model shared by every output backend (SVG, PDF, DXF).
 *
 * Sheet space: millimetres, origin at the bottom-left of the page, y up.
 * Text heights are CAP HEIGHT in mm; renderers convert to font size.
 *
 * Entity types
 *  { type:'line',   layer, a:[x,y], b:[x,y] }
 *  { type:'poly',   layer, pts:[[x,y],...], closed?:boolean }
 *  { type:'text',   layer, x, y, h, text,
 *                    align?:'left'|'center'|'right',       default left
 *                    vAlign?:'baseline'|'bottom'|'middle'|'top', default baseline
 *                    rot?:degrees (CCW), bold?:boolean, italic?:boolean }
 *  { type:'circle', layer, c:[x,y], r }
 *  { type:'arc',    layer, c:[x,y], r, start:deg, end:deg }  // CCW start->end
 *  { type:'triangle', layer, pts:[[x,y],[x,y],[x,y]] }        // filled arrow head
 */

export const line = (layer, ax, ay, bx, by) => ({ type: 'line', layer, a: [ax, ay], b: [bx, by] });
export const poly = (layer, pts, closed = false) => ({ type: 'poly', layer, pts, closed });
export const text = (layer, x, y, h, str, opts = {}) => ({
  type: 'text', layer, x, y, h, text: String(str),
  align: opts.align ?? 'left',
  vAlign: opts.vAlign ?? 'baseline',
  rot: opts.rot ?? 0,
  bold: Boolean(opts.bold),
  italic: Boolean(opts.italic),
});
export const circle = (layer, cx, cy, r) => ({ type: 'circle', layer, c: [cx, cy], r });
export const arc = (layer, cx, cy, r, start, end) => ({ type: 'arc', layer, c: [cx, cy], r, start, end });
export const triangle = (layer, pts) => ({ type: 'triangle', layer, pts });

/** Axis-aligned rectangle as a closed polyline. */
export function rect(layer, x0, y0, x1, y1) {
  return poly(layer, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
}

/** Rough advance width of a string for layout maths (Helvetica-ish). */
export function textWidth(str, capHeight) {
  const em = capHeight / 0.717;
  let units = 0;
  for (const ch of String(str)) {
    if (ch === ' ') units += 0.278;
    else if (/[0-9]/.test(ch)) units += 0.556;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else if (/[.,:;'`|!]/.test(ch)) units += 0.28;
    else if (/[-–—+/\\%()]/.test(ch)) units += 0.45;
    else units += 0.52;
  }
  return units * em;
}

/** Vertical text bounds for a text entity in sheet millimetres. */
export function textBounds(e) {
  const w = textWidth(e.text, e.h);
  const cap = e.h;
  let x0 = e.x;
  if (e.align === 'center') x0 = e.x - w / 2;
  else if (e.align === 'right') x0 = e.x - w;
  let y0;
  if (e.vAlign === 'middle') y0 = e.y - cap / 2;
  else if (e.vAlign === 'top') y0 = e.y - cap;
  else if (e.vAlign === 'bottom') y0 = e.y;
  else y0 = e.y; // baseline ≈ bottom of capitals
  if (!e.rot) return { x0, y0, x1: x0 + w, y1: y0 + cap };
  // rotate the four corners about the anchor
  const a = (e.rot * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const corners = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + cap], [x0, y0 + cap]].map(([x, y]) => [
    e.x + (x - e.x) * cos - (y - e.y) * sin,
    e.y + (x - e.x) * sin + (y - e.y) * cos,
  ]);
  return {
    x0: Math.min(...corners.map((c) => c[0])),
    y0: Math.min(...corners.map((c) => c[1])),
    x1: Math.max(...corners.map((c) => c[0])),
    y1: Math.max(...corners.map((c) => c[1])),
  };
}

export function entityBounds(e) {
  switch (e.type) {
    case 'line': return { x0: Math.min(e.a[0], e.b[0]), y0: Math.min(e.a[1], e.b[1]), x1: Math.max(e.a[0], e.b[0]), y1: Math.max(e.a[1], e.b[1]) };
    case 'poly': {
      const xs = e.pts.map((p) => p[0]), ys = e.pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case 'text': return textBounds(e);
    case 'circle': return { x0: e.c[0] - e.r, y0: e.c[1] - e.r, x1: e.c[0] + e.r, y1: e.c[1] + e.r };
    case 'arc': {
      // conservative: full circle box
      return { x0: e.c[0] - e.r, y0: e.c[1] - e.r, x1: e.c[0] + e.r, y1: e.c[1] + e.r };
    }
    case 'triangle': {
      const xs = e.pts.map((p) => p[0]), ys = e.pts.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    default: return null;
  }
}

export class DrawList {
  constructor() {
    this.entities = [];
    this._bounds = null;
  }
  add(...entities) {
    for (const e of entities.flat()) if (e) this.entities.push(e);
    this._bounds = null;
    return this;
  }
  get bounds() {
    if (this._bounds) return this._bounds;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of this.entities) {
      const b = entityBounds(e);
      if (!b) continue;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    this._bounds = Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
    return this._bounds;
  }
  /** Entities whose bounds fall outside the frame (QA helper). */
  outside(box, tol = 0.01) {
    return this.entities.filter((e) => {
      const b = entityBounds(e);
      if (!b) return false;
      return b.x0 < box.x0 - tol || b.y0 < box.y0 - tol || b.x1 > box.x1 + tol || b.y1 > box.y1 + tol;
    });
  }
  byLayer(layer) {
    return this.entities.filter((e) => e.layer === layer);
  }
}

/** Helper for stacked, optionally rotated text blocks (callout boxes). */
export function textBlock(layer, lines, { x, y, h = 1.5, leading = h * 1.62, rot = 0, align = 'center', bold = false, vAlign = 'baseline' }) {
  const out = [];
  lines.forEach((str, i) => {
    const dy = -i * leading;
    if (!rot) {
      out.push(text(layer, x, y + dy, h, str, { align, bold, vAlign }));
    } else {
      const a = (rot * Math.PI) / 180;
      out.push(text(layer, x - Math.sin(a) * dy, y + Math.cos(a) * dy, h, str, { align, bold, rot, vAlign }));
    }
  });
  return out;
}
