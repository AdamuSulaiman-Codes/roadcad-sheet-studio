/**
 * PDF renderer: DrawList -> Uint8Array (single A-series page, vector content).
 *
 * Sheet space is millimetres, origin bottom-left, y up — the same orientation as
 * PDF user space below the MediaBox origin, so a sheet point maps directly to
 * `(x * 72/25.4, y * 72/25.4)` points without a flip.
 *
 * Fonts are the standard Type1 faces Helvetica / Helvetica-Bold (WinAnsiEncoding,
 * not embedded) so centring needs real AFM advance widths, hard-coded below.
 * Content is uncompressed; every xref offset is a real byte offset.
 */
import { LAYERS, LINETYPES } from '../draw/layers.js';

/** millimetres -> PDF points */
const K = 72 / 25.4;
/** font-size conversion stated by the drawing contract (pt per mm of font size) */
const PT_PER_MM_FONT = 2.83465;
/** Helvetica cap height as a fraction of the em */
const CAP_RATIO = 0.717;
/** circular-arc kappa for a quarter circle */
const KAPPA = 0.5522847498307936;
const D2R = Math.PI / 180;

const FALLBACK_STYLE = { color: '#101010', lw: 0.18, ltype: 'CONTINUOUS' };

/* ------------------------------------------------------------------ */
/* Helvetica AFM advance widths for codes 32..126, in 1/1000 em units  */
/* ------------------------------------------------------------------ */

// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// prettier-ignore
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Code-points outside ASCII (WinAnsiEncoding specific bytes). */
const EXTRA_WIDTHS = new Map([
  [0xb0, 400], // degree
  [0xb1, 584], // plus-minus
  [0xb7, 278], // middle dot
  [0xd7, 584], // multiplication sign
]);

/** Unicode characters that are mapped onto WinAnsi bytes (or text). */
const WINANSI_MAP = new Map(Object.entries({
  '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85,
  '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a,
  '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
  '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b, '\u0153': 0x9c,
  '\u017e': 0x9e, '\u0178': 0x9f,
  '\u0394': 'DELTA', // Greek capital delta has no WinAnsi slot
  '\u2212': 0x2d, // minus sign -> hyphen
  '\u2032': 0x27, // prime -> apostrophe
  '\u2033': 0x22, // double prime -> quote
  '\u00a0': 0x20, // no-break space
}));

const PDF_STRING_ESCAPES = new Map([
  [0x5c, '\\\\'],
  [0x28, '\\('],
  [0x29, '\\)'],
  [0x0a, '\\n'],
  [0x0d, '\\r'],
]);

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function styleOf(layer) {
  return LAYERS[layer] ?? FALLBACK_STYLE;
}

/** Compact fixed-point number: at most `dp` decimals, no trailing zeros. */
function fmt(v, dp = 4) {
  if (!Number.isFinite(v)) return null;
  const r = Number(v.toFixed(dp));
  return Object.is(r, -0) ? '0' : String(r);
}

function isPoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** '#rrggbb' -> [r, g, b] in 0..1 (falls back to black). */
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** mm point -> 'x y' in PDF points. */
function xy(p) {
  const x = fmt(p[0] * K);
  const y = fmt(p[1] * K);
  return x == null || y == null ? null : `${x} ${y}`;
}

/** Normalise a CCW arc sweep to (0, 360]; null when degenerate. */
function arcDelta(startDeg, endDeg) {
  if (!Number.isFinite(startDeg) || !Number.isFinite(endDeg)) return null;
  let delta = endDeg - startDeg;
  if (delta >= 360 - 1e-9) return 360;
  delta = ((delta % 360) + 360) % 360;
  return delta < 1e-9 ? null : delta;
}

/** Convert one WinAnsi code -> advance width in 1/1000 em. */
function glyphWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS)[code - 32];
  const extra = EXTRA_WIDTHS.get(code);
  if (extra != null) return extra;
  return 556;
}

/**
 * Convert arbitrary Unicode text to WinAnsi code points.
 * Characters with no WinAnsi representation become '?' (0x3f).
 */
function toWinAnsiCodes(value) {
  const codes = [];
  const str = String(value ?? '');
  for (const ch of str) {
    const mapped = WINANSI_MAP.get(ch);
    if (mapped !== undefined) {
      if (typeof mapped === 'string') {
        for (const c of mapped) codes.push(c.charCodeAt(0) & 0xff);
      } else {
        codes.push(mapped);
      }
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) codes.push(0x20);
    else if (cp >= 0x20 && cp <= 0xff && !(cp >= 0x7f && cp <= 0x9f)) codes.push(cp);
    else codes.push(0x3f);
  }
  return codes;
}

/** WinAnsi codes -> escaped PDF literal string body (all chars <= 0xFF). */
function codesToPDFString(codes) {
  let out = '';
  for (const code of codes) {
    const esc = PDF_STRING_ESCAPES.get(code);
    if (esc !== undefined) out += esc;
    else if (code >= 0x20 && code <= 0xff) out += String.fromCharCode(code);
    else out += '?';
  }
  return out;
}

/** Plain-text metadata -> escaped PDF string. */
function pdfString(value) {
  return codesToPDFString(toWinAnsiCodes(value));
}

/** Advance width of a code sequence in PDF points. */
function advancePt(codes, bold, size) {
  let units = 0;
  for (const code of codes) units += glyphWidth(code, bold);
  return (units / 1000) * size;
}

const V_OFFSETS = { baseline: 0, bottom: 0, middle: -0.28, top: -0.717 };

/**
 * Text placement matrix: [[a, b, c, d, e, f]] positions the baseline with the
 * requested rotation (CCW, y-up), horizontal alignment and vertical alignment.
 */
function textOp(e) {
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.h) || e.h <= 0) return '';
  const codes = toWinAnsiCodes(e.text);
  if (!codes.length) return '';
  const bold = Boolean(e.bold);
  const italic = Boolean(e.italic);
  const font = bold && italic ? 'F4' : bold ? 'F2' : italic ? 'F3' : 'F1';
  const size = (e.h / CAP_RATIO) * PT_PER_MM_FONT;
  const rot = Number(e.rot) || 0;
  const theta = rot * D2R;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const advance = advancePt(codes, bold, size);
  const align = e.align ?? 'left';
  const shift = align === 'center' ? -advance / 2 : align === 'right' ? -advance : 0;
  const voff = (V_OFFSETS[e.vAlign] ?? 0) * size;

  const xPt = e.x * K;
  const yPt = e.y * K;
  // Up direction of the glyphs is (-sin, cos); the baseline is displaced from the
  // anchor by `voff` along it and by `shift` along the reading direction.
  const ex = xPt + shift * cos - voff * sin;
  const ey = yPt + shift * sin + voff * cos;

  const a = fmt(cos);
  const b = fmt(sin);
  const c = fmt(-sin);
  const d = fmt(cos);
  const eX = fmt(ex);
  const eY = fmt(ey);
  const fSize = fmt(size);
  if ([a, b, c, d, eX, eY, fSize].some((v) => v == null)) return '';
  return [
    'BT',
    `/${font} ${fSize} Tf`,
    `${a} ${b} ${c} ${d} ${eX} ${eY} Tm`,
    `(${codesToPDFString(codes)}) Tj`,
    'ET',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* vector entities                                                     */
/* ------------------------------------------------------------------ */

function lineOp(e) {
  if (!isPoint(e.a) || !isPoint(e.b)) return '';
  const a = xy(e.a);
  const b = xy(e.b);
  return a && b ? `${a} m\n${b} l\nS` : '';
}

function polyOp(e) {
  const pts = e.pts ?? [];
  if (pts.length < 2 || !pts.every(isPoint)) return '';
  const parts = [];
  for (let i = 0; i < pts.length; i++) {
    const p = xy(pts[i]);
    if (!p) return '';
    parts.push(`${p} ${i === 0 ? 'm' : 'l'}`);
  }
  if (e.closed) parts.push('h');
  parts.push('S');
  return parts.join('\n');
}

function circleOp(c, r) {
  const [cx, cy] = c;
  const rk = KAPPA * r;
  const start = xy([cx + r, cy]);
  if (!start) return '';
  const seg = (x1, y1, x2, y2, x3, y3) => {
    const c1 = xy([x1, y1]);
    const c2 = xy([x2, y2]);
    const p3 = xy([x3, y3]);
    return c1 && c2 && p3 ? `${c1} ${c2} ${p3} c` : null;
  };
  const parts = [start + ' m'];
  const segs = [
    seg(cx + r, cy + rk, cx + rk, cy + r, cx, cy + r),
    seg(cx - rk, cy + r, cx - r, cy + rk, cx - r, cy),
    seg(cx - r, cy - rk, cx - rk, cy - r, cx, cy - r),
    seg(cx + rk, cy - r, cx + r, cy - rk, cx + r, cy),
  ];
  if (segs.some((s) => s == null)) return '';
  parts.push(...segs, 'S');
  return parts.join('\n');
}

function arcOp(e) {
  if (!isPoint(e.c) || !Number.isFinite(e.r) || e.r <= 0) return '';
  const delta = arcDelta(e.start, e.end);
  if (delta == null) return '';
  if (delta >= 360 - 1e-9) return circleOp(e.c, e.r);
  const [cx, cy] = e.c;
  const r = e.r;
  const n = Math.max(1, Math.ceil(delta / 90));
  const step = delta / n;
  let a0 = e.start * D2R;
  const parts = [];
  const p0 = xy([cx + r * Math.cos(a0), cy + r * Math.sin(a0)]);
  if (!p0) return '';
  parts.push(`${p0} m`);
  for (let i = 0; i < n; i++) {
    const a1 = a0 + step * D2R;
    const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
    const c1 = xy([cx + r * Math.cos(a0) - k * Math.sin(a0), cy + r * Math.sin(a0) + k * Math.cos(a0)]);
    const c2 = xy([cx + r * Math.cos(a1) + k * Math.sin(a1), cy + r * Math.sin(a1) - k * Math.cos(a1)]);
    const p1 = xy([cx + r * Math.cos(a1), cy + r * Math.sin(a1)]);
    if (!c1 || !c2 || !p1) return '';
    parts.push(`${c1} ${c2} ${p1} c`);
    a0 = a1;
  }
  parts.push('S');
  return parts.join('\n');
}

function triangleOp(e, fill) {
  const pts = e.pts ?? [];
  if (pts.length !== 3 || !pts.every(isPoint)) return '';
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const p = xy(pts[i]);
    if (!p) return '';
    parts.push(`${p} ${i === 0 ? 'm' : 'l'}`);
  }
  parts.push('h');
  parts.push(`${fmt(fill[0])} ${fmt(fill[1])} ${fmt(fill[2])} rg`);
  parts.push('f');
  return parts.join('\n');
}

function entityOp(e, fill) {
  switch (e.type) {
    case 'line': return lineOp(e);
    case 'poly': return polyOp(e);
    case 'circle': return !isPoint(e.c) || !Number.isFinite(e.r) || e.r <= 0 ? '' : circleOp(e.c, e.r);
    case 'arc': return arcOp(e);
    case 'triangle': return triangleOp(e, fill);
    case 'text': return textOp(e);
    default: return '';
  }
}

/* ------------------------------------------------------------------ */
/* document assembly                                                   */
/* ------------------------------------------------------------------ */

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

function buildContent(groups, width, height) {
  const lines = [];
  // opaque white page: many viewers render an unpainted PDF page as transparent
  lines.push('q 1 1 1 rg 0 0 ' + fmt(width) + ' ' + fmt(height) + ' re f Q');
  for (const [layer, list] of groups) {
    const style = styleOf(layer);
    const [r, g, b] = rgb(style.color);
    const dash = (LINETYPES[style.ltype] ?? []).map((v) => fmt(Math.abs(v) * K));
    lines.push('q');
    // stroke colour for line work and fill colour for text / filled triangles
    lines.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`);
    lines.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    lines.push(`${fmt(style.lw * K)} w`);
    lines.push(dash.length ? `[${dash.join(' ')}] 0 d` : '[] 0 d');
    lines.push('1 J');
    lines.push('1 j');
    for (const e of list) {
      const op = entityOp(e, [r, g, b]);
      if (op) lines.push(op);
    }
    lines.push('Q');
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function fontObj(baseFont) {
  return `<</Type/Font/Subtype/Type1/BaseFont/${baseFont}/Encoding/WinAnsiEncoding>>`;
}

/**
 * Render a DrawList to a single-page PDF.
 *
 * @param {{entities: Array}} dl       DrawList from src/draw/entities.js
 * @param {{sheet: {w:number,h:number}}} layout  sheet layout (mm)
 * @param {{title?: string, subject?: string, author?: string, creator?: string,
 *          producer?: string, creationDate?: string}} [meta]
 * @returns {Uint8Array}
 */
export function renderPDF(dl, layout, meta = {}) {
  const sheet = layout?.sheet ?? { w: 594, h: 420 };
  const widthPt = Number(sheet.w) * K;
  const heightPt = Number(sheet.h) * K;
  const entities = Array.isArray(dl) ? dl : (dl?.entities ?? []);
  const groups = groupByLayer(entities);
  const content = buildContent(groups, widthPt, heightPt);

  const usesItalic = entities.some((e) => e && e.type === 'text' && e.italic);
  const pageWidth = fmt(widthPt);
  const pageHeight = fmt(heightPt);
  const fontDict = usesItalic
    ? '/Font<</F1 5 0 R/F2 6 0 R/F3 7 0 R/F4 8 0 R>>'
    : '/Font<</F1 5 0 R/F2 6 0 R>>';
  const infoId = usesItalic ? 9 : 7;

  const title = pdfString(meta.title ?? 'ROAD DRAWING');
  const subject = pdfString(meta.subject ?? '');
  const author = pdfString(meta.author ?? '');
  const creator = pdfString(meta.creator ?? 'RoadCAD Sheet Studio');
  const producer = pdfString(meta.producer ?? 'RoadCAD Sheet Studio');
  const creationDate = String(meta.creationDate ?? 'D:20260301000000Z').replace(/[^\x20-\x7e]/g, '');

  // Object ids are assigned in this exact push order (catalog=1 ... info=last).
  const objects = [];
  objects.push('<</Type/Catalog/Pages 2 0 R>>');
  objects.push('<</Type/Pages/Kids[3 0 R]/Count 1>>');
  objects.push(
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pageWidth} ${pageHeight}]/Resources<<${fontDict}>>/Contents 4 0 R>>`,
  );
  objects.push(`<</Length ${content.length}>>\nstream\n${content}\nendstream`);
  objects.push(fontObj('Helvetica'));
  objects.push(fontObj('Helvetica-Bold'));
  if (usesItalic) {
    objects.push(fontObj('Helvetica-Oblique'));
    objects.push(fontObj('Helvetica-BoldOblique'));
  }
  objects.push(
    `<</Title(${title})/Subject(${subject})/Author(${author})/Creator(${creator})/Producer(${producer})/CreationDate(${creationDate})>>`,
  );

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Info ${infoId} 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const code = out.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}
