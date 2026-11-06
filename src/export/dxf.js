/**
 * DXF writer: AutoCAD R12 (AC1009) ASCII. R12 is chosen deliberately: the
 * simplest, most interoperable DXF flavour, opened by AutoCAD, Civil 3D,
 * BricsCAD, ZWCAD, LibreCAD and QCAD. Units are millimetres.
 */
import { boundsOf, entityCounts } from './util.js';
import { LAYERS, LINETYPES } from '../draw/layers.js';

// AutoCAD text control codes keep the file pure ASCII (safe for R12 / cp1252
// readers) while still printing the proper symbols in AutoCAD.
const ASCII_MAP = {
  '\u0394': 'D', '\u03b4': 'd', '\u2014': '-', '\u2013': '-', '\u2019': "'", '\u2018': "'",
  '\u201c': '"', '\u201d': '"', '\u00b1': '%%p', '\u00b0': '%%d', '\u00d8': '%%c',
  '\u2265': '>=', '\u2264': '<=', '\u00d7': 'x', '\u00b7': '.',
};

/** ASCII-only text for DXF (control codes for degree/plus-minus/diameter). */
export function sanitizeText(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const code = ch.charCodeAt(0);
    if (code < 128) { out += ch; continue; }
    if (ASCII_MAP[ch]) out += ASCII_MAP[ch];
    else if (ch === '\u00b5') out += 'u';
    else out += '?';
  }
  return out;
}

class Dxf {
  constructor() { this.lines = []; }
  g(code, value) { this.lines.push(String(code), String(value)); }
  toString() { return this.lines.join('\n') + '\n'; }
}

const round = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0);

function header(dxf, bounds, sheet) {
  dxf.g(0, 'SECTION'); dxf.g(2, 'HEADER');
  dxf.g(9, '$ACADVER'); dxf.g(1, 'AC1009');
  dxf.g(9, '$DWGCODEPAGE'); dxf.g(3, 'ANSI_1252');
  dxf.g(9, '$INSBASE'); dxf.g(10, 0.0); dxf.g(20, 0.0); dxf.g(30, 0.0);
  dxf.g(9, '$EXTMIN'); dxf.g(10, round(bounds.x0)); dxf.g(20, round(bounds.y0)); dxf.g(30, 0.0);
  dxf.g(9, '$EXTMAX'); dxf.g(10, round(bounds.x1)); dxf.g(20, round(bounds.y1)); dxf.g(30, 0.0);
  dxf.g(9, '$LIMMIN'); dxf.g(10, 0.0); dxf.g(20, 0.0);
  dxf.g(9, '$LIMMAX'); dxf.g(10, sheet.w); dxf.g(20, sheet.h);
  dxf.g(9, '$LTSCALE'); dxf.g(40, 1.0);
  dxf.g(9, '$TEXTSIZE'); dxf.g(40, 2.5);
  dxf.g(9, '$TEXTSTYLE'); dxf.g(7, 'STANDARD');
  dxf.g(9, '$CLAYER'); dxf.g(8, '0');
  dxf.g(9, '$PDMODE'); dxf.g(70, 0);
  dxf.g(9, '$PDSIZE'); dxf.g(40, 0.0);
  dxf.g(9, '$PLINEWID'); dxf.g(40, 0.0);
  dxf.g(9, '$FILLMODE'); dxf.g(70, 1);
  dxf.g(9, '$MEASUREMENT'); dxf.g(70, 1);
  dxf.g(0, 'ENDSEC');
}

function tables(dxf) {
  dxf.g(0, 'SECTION'); dxf.g(2, 'TABLES');

  const lts = Object.entries(LINETYPES);
  dxf.g(0, 'TABLE'); dxf.g(2, 'LTYPE'); dxf.g(70, lts.length);
  for (const [name, pattern] of lts) {
    dxf.g(0, 'LTYPE');
    dxf.g(2, name);
    dxf.g(70, 0);
    dxf.g(3, pattern.length ? name.toLowerCase() : 'Solid line');
    dxf.g(72, 65);
    dxf.g(73, pattern.length / 2);
    dxf.g(40, pattern.reduce((a, b) => a + Math.abs(b), 0));
    for (const d of pattern) { dxf.g(49, d); dxf.g(74, 0); }
  }
  dxf.g(0, 'ENDTAB');

  const names = Object.keys(LAYERS);
  dxf.g(0, 'TABLE'); dxf.g(2, 'LAYER'); dxf.g(70, names.length + 1);
  dxf.g(0, 'LAYER'); dxf.g(2, '0'); dxf.g(70, 0); dxf.g(62, 7); dxf.g(6, 'CONTINUOUS');
  for (const name of names) {
    const l = LAYERS[name];
    dxf.g(0, 'LAYER'); dxf.g(2, name); dxf.g(70, 0); dxf.g(62, l.aci); dxf.g(6, l.ltype);
  }
  dxf.g(0, 'ENDTAB');

  dxf.g(0, 'TABLE'); dxf.g(2, 'STYLE'); dxf.g(70, 1);
  dxf.g(0, 'STYLE'); dxf.g(2, 'STANDARD'); dxf.g(70, 0);
  dxf.g(40, 0.0); dxf.g(41, 1.0); dxf.g(50, 0.0); dxf.g(71, 0); dxf.g(42, 2.5);
  dxf.g(3, 'arial.ttf'); dxf.g(4, '');
  dxf.g(0, 'ENDTAB');

  dxf.g(0, 'ENDSEC');
}

function entity(dxf, e) {
  switch (e.type) {
    case 'line': {
      dxf.g(0, 'LINE'); dxf.g(8, e.layer);
      dxf.g(10, round(e.a[0])); dxf.g(20, round(e.a[1])); dxf.g(30, 0.0);
      dxf.g(11, round(e.b[0])); dxf.g(21, round(e.b[1])); dxf.g(31, 0.0);
      break;
    }
    case 'poly': {
      if (e.pts.length < 2) return;
      dxf.g(0, 'POLYLINE'); dxf.g(8, e.layer); dxf.g(66, 1); dxf.g(70, e.closed ? 1 : 0);
      dxf.g(10, 0.0); dxf.g(20, 0.0); dxf.g(30, 0.0);
      for (const p of e.pts) {
        dxf.g(0, 'VERTEX'); dxf.g(8, e.layer);
        dxf.g(10, round(p[0])); dxf.g(20, round(p[1])); dxf.g(30, 0.0);
      }
      dxf.g(0, 'SEQEND'); dxf.g(8, e.layer);
      break;
    }
    case 'circle': {
      dxf.g(0, 'CIRCLE'); dxf.g(8, e.layer);
      dxf.g(10, round(e.c[0])); dxf.g(20, round(e.c[1])); dxf.g(30, 0.0);
      dxf.g(40, round(e.r));
      break;
    }
    case 'arc': {
      dxf.g(0, 'ARC'); dxf.g(8, e.layer);
      dxf.g(10, round(e.c[0])); dxf.g(20, round(e.c[1])); dxf.g(30, 0.0);
      dxf.g(40, round(e.r));
      dxf.g(50, round(e.start)); dxf.g(51, round(e.end));
      break;
    }
    case 'text': {
      const halign = e.align === 'center' ? 1 : e.align === 'right' ? 2 : 0;
      const valign = e.vAlign === 'bottom' ? 1 : e.vAlign === 'middle' ? 2 : e.vAlign === 'top' ? 3 : 0;
      dxf.g(0, 'TEXT'); dxf.g(8, e.layer);
      dxf.g(10, round(e.x)); dxf.g(20, round(e.y)); dxf.g(30, 0.0);
      dxf.g(40, round(Math.max(0.2, e.h)));
      dxf.g(1, sanitizeText(e.text));
      dxf.g(50, round(e.rot ?? 0));
      dxf.g(41, 1.0);
      dxf.g(7, 'STANDARD');
      dxf.g(72, halign);
      dxf.g(11, round(e.x)); dxf.g(21, round(e.y)); dxf.g(31, 0.0);
      dxf.g(73, valign);
      break;
    }
    case 'triangle': {
      const [p0, p1, p2] = e.pts;
      dxf.g(0, 'SOLID'); dxf.g(8, e.layer);
      dxf.g(10, round(p0[0])); dxf.g(20, round(p0[1])); dxf.g(30, 0.0);
      dxf.g(11, round(p1[0])); dxf.g(21, round(p1[1])); dxf.g(31, 0.0);
      dxf.g(12, round(p2[0])); dxf.g(22, round(p2[1])); dxf.g(32, 0.0);
      dxf.g(13, round(p2[0])); dxf.g(23, round(p2[1])); dxf.g(33, 0.0);
      break;
    }
    default:
      break;
  }
}

export function buildDXF(dl, layout) {
  const dxf = new Dxf();
  const bounds = boundsOf(dl);
  header(dxf, bounds, layout.sheet);
  tables(dxf);
  dxf.g(0, 'SECTION'); dxf.g(2, 'BLOCKS'); dxf.g(0, 'ENDSEC');
  dxf.g(0, 'SECTION'); dxf.g(2, 'ENTITIES');
  for (const e of dl.entities) entity(dxf, e);
  dxf.g(0, 'ENDSEC');
  dxf.g(0, 'EOF');
  return dxf.toString();
}

export function dxfSummary(dl) {
  return { counts: entityCounts(dl), bounds: boundsOf(dl) };
}
