import test from 'node:test';
import assert from 'node:assert/strict';

import { DrawList, line, poly, rect, text, circle, arc, triangle } from '../src/draw/entities.js';
import { LAYERS } from '../src/draw/layers.js';
import { renderSVG } from '../src/export/svg.js';
import { renderPDF } from '../src/export/pdf.js';

const LAYOUT = { sheet: { w: 594, h: 420 } };
const K = 72 / 25.4;
const PT_PER_MM_FONT = 2.83465;

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

/** DrawList fixture covering every entity type, both text alignments and rotation. */
function fixture() {
  const dl = new DrawList();
  dl.add(
    line('PLAN_EDGE', 20, 30, 120, 30),
    poly('PLAN_CL', [[20, 40], [60, 40], [60, 60]], false),
    rect('TABLE_LINE', 20, 80, 80, 100),
    circle('PROF_DESIGN', 200, 120, 10),
    arc('PLAN_CL', 200, 200, 30, 0, 90),
    triangle('NORTH', [[300, 300], [290, 280], [310, 280]]),
    text('TITLE_TEXT', 100, 200, 2.5, 'A&B <tag> "q" \'x\'', { align: 'left' }),
    text('TITLE_TEXT', 300, 250, 2.5, 'CENTERED', { align: 'center', vAlign: 'middle' }),
    text('TITLE_TEXT', 400, 300, 2.5, 'ROT90', { rot: 90 }),
    text('TITLE_TEXT_B', 500, 350, 3.0, '0+000.00', { align: 'center', bold: true }),
    text('TABLE_TEXT', 500, 100, 2.0, 'Δ=12.3456°'),
    text('LOGO_TEXT', 200, 380, 3.0, 'GREEN TEXT', { align: 'left' }),
  );
  return dl;
}

const distinctLayers = (dl) => [...new Set(dl.entities.map((e) => e.layer))];

/**
 * Tiny XML well-formedness check: balanced tags, no raw '&' in text, quoted
 * attribute values. Returns the list of root-level element names.
 */
function assertBalancedXML(src) {
  assert.ok(src.startsWith('<') && src.endsWith('>'), 'starts and ends with markup');
  const stack = [];
  let i = 0;
  let textStart = 0;
  while (i < src.length) {
    if (src[i] !== '<') {
      i++;
      continue;
    }
    const chunk = src.slice(textStart, i);
    assert.ok(
      !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(chunk),
      `unescaped '&' in text content: ${JSON.stringify(chunk.slice(0, 40))}`,
    );
    const close = src.indexOf('>', i);
    assert.ok(close > i, 'every tag is terminated');
    const tag = src.slice(i + 1, close);
    assert.ok(!tag.includes('<'), 'no nested < inside a tag');
    const stripped = tag.replace(/"[^"]*"/g, '');
    assert.ok(!stripped.includes('"'), 'attribute quotes are balanced');
    if (tag.startsWith('/')) {
      assert.equal(stack.pop(), tag.slice(1).trim(), 'closing tag matches');
    } else if (!tag.endsWith('/')) {
      stack.push(tag.split(/\s/)[0]);
    }
    i = close + 1;
    textStart = i;
  }
  assert.deepEqual(stack, [], 'all tags closed');
}

function svgGroups(svg) {
  return [...svg.matchAll(/<g data-layer="([^"]+)"/g)].map((m) => m[1]);
}

function groupTag(svg, layer) {
  const m = svg.match(new RegExp(`<g data-layer="${layer}"[^>]*>`));
  assert.ok(m, `group for layer ${layer}`);
  return m[0];
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

/** Body of the (single) uncompressed content stream. */
function pdfStream(doc) {
  const m = doc.match(/\/Length (\d+)>>\nstream\n([\s\S]*?)\nendstream/);
  assert.ok(m, 'content stream present');
  assert.equal(Number(m[1]), Buffer.byteLength(m[2], 'latin1'), '/Length matches stream bytes');
  return m[2];
}

const opLines = (stream) => stream.split('\n');

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

test('svg: standalone document, sheet size, background and layer groups', () => {
  const dl = fixture();
  const svg = renderSVG(dl, LAYOUT);

  assert.ok(
    svg.startsWith(
      '<svg xmlns="http://www.w3.org/2000/svg" width="594mm" height="420mm" viewBox="0 0 594 420">',
    ),
    'root element carries mm size and viewBox',
  );
  assert.match(svg, /<rect x="0" y="0" width="594" height="420" fill="#ffffff"\/>/, 'white background');
  assert.ok(svg.endsWith('</svg>'));

  // exactly one group per layer used, in first-appearance order
  assert.deepEqual(svgGroups(svg), distinctLayers(dl));
  assert.equal((svg.match(/<g /g) ?? []).length, distinctLayers(dl).length);
});

test('svg: layer stroke colour and width come from LAYERS', () => {
  const svg = renderSVG(fixture(), LAYOUT);
  for (const layer of distinctLayers(fixture())) {
    const tag = groupTag(svg, layer);
    assert.ok(tag.includes(`stroke="${LAYERS[layer].color}"`), `${layer} stroke colour`);
    assert.ok(tag.includes(`stroke-width="${LAYERS[layer].lw}"`), `${layer} stroke width`);
    assert.ok(tag.includes('fill="none"'), `${layer} fill none`);
  }
  // dash array from LINETYPES (mm), no dash attribute for continuous layers
  assert.ok(groupTag(svg, 'PLAN_CL').includes('stroke-dasharray="18 3 3 3"'));
  assert.ok(!groupTag(svg, 'PLAN_EDGE').includes('stroke-dasharray'));
  assert.ok(!groupTag(svg, 'TABLE_LINE').includes('stroke-dasharray'));
});

test('svg: balanced XML, escaped text, every text string present', () => {
  const dl = fixture();
  const svg = renderSVG(dl, LAYOUT);
  assertBalancedXML(svg);

  for (const e of dl.entities.filter((x) => x.type === 'text')) {
    assert.ok(svg.includes(`>${escapeForCheck(e.text)}</text>`), `missing text ${e.text}`);
  }
  assert.ok(svg.includes('A&amp;B &lt;tag&gt; &quot;q&quot; &apos;x&apos;'), 'metacharacters escaped');
  assert.ok(!svg.includes('A&B <tag>'), 'no raw metacharacters');
});

function escapeForCheck(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

test('svg: text anchor, baseline, size and rotation', () => {
  const svg = renderSVG(fixture(), LAYOUT);
  const texts = [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => m[0]);

  const special = texts.find((t) => t.includes('A&amp;B'));
  assert.ok(special.includes('font-family="Helvetica Neue, Arial, Helvetica, sans-serif"'));
  assert.ok(special.includes(`font-size="${Number((2.5 / 0.717).toFixed(4))}"`), 'font size = cap height / 0.717');
  assert.ok(special.includes('text-anchor="start"'));
  assert.ok(special.includes('dominant-baseline="alphabetic"'));
  assert.ok(special.includes('x="100" y="220"'), 'sheet y is flipped to SVG y');
  assert.ok(!special.includes('transform='), 'unrotated text has no transform');

  const centred = texts.find((t) => t.includes('CENTERED'));
  assert.ok(centred.includes('text-anchor="middle"'));
  assert.ok(centred.includes('dominant-baseline="middle"'));

  const rotated = texts.find((t) => t.includes('ROT90'));
  assert.ok(rotated.includes('transform="rotate(-90 400 120)"'), 'CCW sheet rotation is negated for y-down SVG');

  const bold = texts.find((t) => t.includes('0+000.00'));
  assert.ok(bold.includes('font-weight="bold"'));
});

test('svg: text is filled with its layer colour', () => {
  const svg = renderSVG(fixture(), LAYOUT);
  for (const layer of [...new Set(fixture().entities.filter((e) => e.type === 'text').map((e) => e.layer))]) {
    const group = svg.match(new RegExp(`<g data-layer="${layer}"[^>]*>[\\s\\S]*?</g>`));
    assert.ok(group, `group ${layer}`);
    for (const m of group[0].matchAll(/<text [^>]*fill="([^"]+)"/g)) {
      assert.equal(m[1], LAYERS[layer].color, `${layer} text fill`);
    }
  }
});

test('svg: circle, arc (A command, CCW sweep), filled triangle and polyline Z', () => {
  const svg = renderSVG(fixture(), LAYOUT);
  assert.ok(svg.includes('<circle cx="200" cy="300" r="10"/>'), 'circle y flipped');
  // arc 0..90 CCW about (200,200) r=30: start (230,220), end (200,190) in SVG coords
  assert.ok(svg.includes('<path d="M 230 220 A 30 30 0 0 0 200 190"/>'), 'arc sweep flag for y-up CCW');
  assert.ok(
    svg.includes('<path d="M 300 120 L 290 140 L 310 140 Z" fill="#101010" stroke="none"/>'),
    'filled triangle',
  );
  assert.ok(svg.includes('<path d="M 20 380 L 60 380 L 60 360"/>'), 'open polyline has no Z');
  assert.ok(
    svg.includes('<path d="M 20 340 L 80 340 L 80 320 L 20 320 Z"/>'),
    'closed rect polyline ends with Z',
  );
});

test('svg: full-circle arc and degenerate entities are handled', () => {
  const dl = new DrawList();
  dl.add(arc('PLAN_CL', 50, 50, 5, 0, 360), circle('PLAN_CL', NaN, 1, 2), arc('PLAN_CL', 1, 1, 0, 0, 90));
  const svg = renderSVG(dl, LAYOUT);
  assert.ok(svg.includes('<circle cx="50" cy="370" r="5"/>'), '360 degree arc becomes a circle');
  assert.ok(!/NaN|Infinity/.test(svg));
  assertBalancedXML(svg);
});

test('svg: empty DrawList produces a valid blank sheet', () => {
  const svg = renderSVG(new DrawList(), LAYOUT);
  assertBalancedXML(svg);
  assert.ok(!svg.includes('<g '));
  assert.ok(svg.includes('viewBox="0 0 594 420"'));
});

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

test('pdf: header, xref offsets, MediaBox A2 and trailer', () => {
  const bytes = renderPDF(fixture(), LAYOUT, { title: 'TEST TITLE', author: 'TEST AUTHOR' });
  assert.ok(bytes instanceof Uint8Array);
  const doc = pdfText(bytes);

  assert.ok(doc.startsWith('%PDF-1.4'), 'PDF magic');
  assert.ok(doc.endsWith('%%EOF\n'));

  const xrefMatch = doc.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(xrefMatch, 'startxref present');
  const xrefOffset = Number(xrefMatch[1]);
  assert.equal(doc.slice(xrefOffset, xrefOffset + 5), 'xref\n', 'startxref points at the xref table');

  const table = doc.slice(xrefOffset).match(/^xref\n0 (\d+)\n/);
  assert.ok(table, 'xref header');
  const count = Number(table[1]);
  const entries = [...doc.slice(xrefOffset).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  assert.equal(entries.length, count, 'one xref entry per object');
  assert.equal(entries[0][3], 'f', 'object 0 is free');
  for (let i = 1; i < count; i++) {
    const offset = Number(entries[i][1]);
    assert.equal(
      doc.slice(offset, offset + `${i} 0 obj`.length),
      `${i} 0 obj`,
      `xref entry ${i} points at "N 0 obj"`,
    );
  }
  assert.match(doc, /trailer\n<<\/Size \d+\/Root 1 0 R\/Info 7 0 R>>/);

  const box = doc.match(/\/MediaBox\[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(box, 'MediaBox present');
  near(Number(box[1]), 594 * K, 0.02);
  near(Number(box[2]), 420 * K, 0.02);
  near(Number(box[1]), 1683.78, 0.01);
  near(Number(box[2]), 1190.55, 0.01);
});

test('pdf: uncompressed stream has the expected S / Tj / fill ops', () => {
  const dl = fixture();
  const stream = pdfStream(pdfText(renderPDF(dl, LAYOUT)));
  const lines = opLines(stream);

  const strokeOps = lines.filter((l) => l === 'S').length;
  const fillOps = lines.filter((l) => l === 'f').length;
  const showOps = lines.filter((l) => l.endsWith(') Tj')).length;

  const vectorEntities = dl.entities.filter((e) => ['line', 'poly', 'circle', 'arc'].includes(e.type));
  const textEntities = dl.entities.filter((e) => e.type === 'text');
  const triangleEntities = dl.entities.filter((e) => e.type === 'triangle');

  assert.equal(strokeOps, vectorEntities.length, 'one S op per stroked entity');
  assert.equal(fillOps, triangleEntities.length, 'one f op per filled triangle');
  assert.equal(showOps, textEntities.length, 'one Tj op per text entity');

  // layer setup per group: q / RG / w / d / J / j / Q
  assert.equal(lines.filter((l) => l === 'q').length, distinctLayers(dl).length);
  assert.equal(lines.filter((l) => l === 'Q').length, distinctLayers(dl).length);
  assert.equal(lines.filter((l) => l === '1 J').length, distinctLayers(dl).length);
  assert.equal(lines.filter((l) => l === '1 j').length, distinctLayers(dl).length);
  const centrePt = [18, 3, 3, 3].map((v) => Number((v * K).toFixed(4))).join(' ');
  assert.ok(lines.includes(`[${centrePt}] 0 d`), 'CENTER dash converted from mm to points');
  assert.ok(lines.some((l) => l === '[] 0 d'), 'continuous layers have no dash');

  // colours and line widths in points
  // '#101010' -> 16/255 = 0.0627
  assert.ok(lines.includes('0.0627 0.0627 0.0627 RG'), 'layer hex -> RG');
  // text and filled triangles need the non-stroking colour too
  assert.ok(lines.includes('0.0627 0.0627 0.0627 rg'), 'layer hex -> rg for text fill');
  assert.ok(lines.includes('0.102 0.4784 0.1647 rg'), 'green LOGO_TEXT text fill');
  // '#c62828' -> PLAN_CL stroke colour
  assert.ok(lines.includes('0.7765 0.1569 0.1569 RG'), 'red layer hex -> RG');
  assert.ok(lines.includes(`${Number((0.25 * K).toFixed(4))} w`), 'line width mm -> points');

  assert.ok(!/NaN|Infinity/.test(stream));
});

test('pdf: info dictionary, fonts and deterministic output', () => {
  const meta = { title: 'LIFIDI-PIAPUNG (PP1)', subject: 'HORIZONTAL & VERTICAL ALIGNMENT', author: 'MASTODON', creator: 'Sheet Studio' };
  const a = renderPDF(fixture(), LAYOUT, meta);
  const b = renderPDF(fixture(), LAYOUT, meta);
  assert.deepEqual(a, b, 'PDF output is deterministic');

  const doc = pdfText(a);
  assert.match(doc, /\/Title\(LIFIDI-PIAPUNG \\\(PP1\\\)\)/, 'PDF string escaping for metadata');
  assert.match(doc, /\/Subject\(HORIZONTAL & VERTICAL ALIGNMENT\)/);
  assert.match(doc, /\/Author\(MASTODON\)/);
  assert.match(doc, /\/Creator\(Sheet Studio\)/);
  assert.match(doc, /\/Producer\(RoadCAD Sheet Studio\)/);
  assert.match(doc, /\/CreationDate\(D:\d{14}Z\)/);

  assert.match(doc, /\/BaseFont\/Helvetica\/Encoding\/WinAnsiEncoding/);
  assert.match(doc, /\/BaseFont\/Helvetica-Bold\/Encoding\/WinAnsiEncoding/);
  assert.ok(!doc.includes('Helvetica-Oblique'), 'no italic face when unused');
  assert.match(doc, /\/Resources<<\/Font<<\/F1 5 0 R\/F2 6 0 R>>>>/);

  assert.equal(renderSVG(fixture(), LAYOUT), renderSVG(fixture(), LAYOUT), 'SVG output is deterministic');
});

test('pdf: text size, rotation matrix and AFM-accurate centring', () => {
  const stream = pdfStream(pdfText(renderPDF(fixture(), LAYOUT)));
  const lines = opLines(stream);

  // Bold centred "0+000.00" at (500, 350), h = 3.0 mm.
  const idx = lines.findIndex((l) => l === '(0+000.00) Tj');
  assert.ok(idx > 2, 'centred number emitted');
  assert.equal(lines[idx - 3], 'BT');
  const tf = lines[idx - 2].match(/^\/F2 ([\d.]+) Tf$/);
  assert.ok(tf, 'bold text uses /F2');
  const size = Number(tf[1]);
  near(size, (3.0 / 0.717) * PT_PER_MM_FONT, 0.01);
  const m = lines[idx - 1].match(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm$/);
  assert.ok(m, 'Tm matrix present');

  // AFM widths (Helvetica-Bold): digits 556, '+' 584, '.' 278
  const advanceUnits = 6 * 556 + 584 + 278; // "0+000.00"
  const advance = (advanceUnits / 1000) * size;
  near(Number(m[5]), 500 * K - advance / 2, 0.05);
  near(Number(m[6]), 350 * K, 1e-3);
  near(Number(m[1]), 1, 1e-6); // cos 0
  near(Number(m[2]), 0, 1e-6); // sin 0
  near(Number(m[3]), 0, 1e-6);
  near(Number(m[4]), 1, 1e-6);

  // Middle vertical alignment on "CENTERED" at (300, 250), h = 2.5: f = y - 0.28*size
  const mc = lines.findIndex((l) => l === '(CENTERED) Tj');
  const cm = lines[mc - 1].match(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/);
  const centredSize = 2.5 / 0.717 * PT_PER_MM_FONT;
  near(Number(cm[6]), 250 * K - 0.28 * centredSize, 0.05);
  // centre alignment shifts the origin by half the advance
  const centredUnits = [...'CENTERED'].reduce((u, ch) => u + (ch === 'E' ? 667 : ch === 'C' ? 722 : ch === 'N' ? 722 : ch === 'T' ? 611 : ch === 'R' ? 722 : ch === 'D' ? 722 : 556), 0);
  near(Number(cm[5]), 300 * K - (centredUnits / 1000) * centredSize / 2, 0.1);

  // Rotated 90 degree text: matrix [0 1 -1 0 x y]
  const mr = lines.findIndex((l) => l === '(ROT90) Tj');
  const rm = lines[mr - 1].match(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/);
  near(Number(rm[1]), 0, 1e-6);
  near(Number(rm[2]), 1, 1e-6);
  near(Number(rm[3]), -1, 1e-6);
  near(Number(rm[4]), 0, 1e-6);
  near(Number(rm[5]), 400 * K, 1e-3);
  near(Number(rm[6]), 300 * K, 1e-3);
});

test('pdf: WinAnsi text handling (degree, delta, outside-latin1)', () => {
  const dl = new DrawList();
  dl.add(
    text('TABLE_TEXT', 10, 10, 2, 'Δ=12.3456°'),
    text('TABLE_TEXT', 10, 20, 2, '©±®'),
    text('TABLE_TEXT', 10, 30, 2, 'Ω'),
  );
  const doc = pdfText(renderPDF(dl, LAYOUT));
  const stream = pdfStream(doc);
  assert.ok(stream.includes('(DELTA=12.3456\xb0) Tj'), 'delta -> DELTA, degree as WinAnsi 0xB0');
  assert.ok(stream.includes('(\xa9\xb1\xae) Tj'), 'latin1 characters pass through as single bytes');
  assert.ok(stream.includes('(?) Tj'), 'characters outside WinAnsi become ?');
  assert.ok(!/NaN|Infinity/.test(stream));
});

test('pdf: invalid geometry is skipped, never emitted as NaN', () => {
  const dl = new DrawList();
  dl.add(
    line('PLAN_EDGE', NaN, 0, 10, 10),
    text('PLAN_TEXT', Infinity, 0, 2, 'bad'),
    poly('PLAN_EDGE', [[0, 0], [NaN, 1]]),
    circle('PLAN_EDGE', 0, 0, 5),
  );
  const doc = pdfText(renderPDF(dl, LAYOUT));
  const stream = pdfStream(doc);
  assert.ok(!/NaN|Infinity/.test(doc));
  assert.equal(stream.split('\n').filter((l) => l === 'S').length, 1, 'only the valid circle survives');
});

test('pdf: empty DrawList is a valid blank page', () => {
  const doc = pdfText(renderPDF(new DrawList(), LAYOUT));
  assert.ok(doc.startsWith('%PDF-1.4'));
  assert.ok(doc.endsWith('%%EOF\n'));
  const stream = pdfStream(doc);
  // a blank sheet is still an opaque white A2 page
  assert.match(stream, /^q 1 1 1 rg 0 0 [\d.]+ [\d.]+ re f Q\n?$/);
  const xrefOffset = Number(doc.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(doc.slice(xrefOffset, xrefOffset + 5), 'xref\n');
});

/* ------------------------------------------------------------------ */
/* performance                                                         */
/* ------------------------------------------------------------------ */

test('performance: 5000 entities render well under 2 s', () => {
  const dl = new DrawList();
  for (let i = 0; i < 5000; i++) {
    const x = 10 + (i % 500);
    const y = 10 + Math.floor(i / 500) * 35;
    switch (i % 5) {
      case 0: dl.add(line('PLAN_EDGE', x, y, x + 20, y + 5)); break;
      case 1: dl.add(poly('PLAN_CL', [[x, y], [x + 10, y + 3], [x + 20, y]], i % 10 === 1)); break;
      case 2: dl.add(circle('PROF_DESIGN', x, y, 2)); break;
      case 3: dl.add(arc('PLAN_SOFT', x, y, 3, 0, 270)); break;
      default: dl.add(text('PLAN_TEXT', x, y, 1.5, `CH ${i}`)); break;
    }
  }
  assert.equal(dl.entities.length, 5000);

  const t0 = performance.now();
  const svg = renderSVG(dl, LAYOUT);
  const tSvg = performance.now() - t0;
  const t1 = performance.now();
  const pdf = renderPDF(dl, LAYOUT);
  const tPdf = performance.now() - t1;

  assert.ok(svg.length > 100000, 'SVG content actually rendered');
  assert.ok(pdf.length > 100000, 'PDF content actually rendered');
  assert.ok(tSvg < 2000, `SVG ${tSvg.toFixed(1)} ms < 2000 ms`);
  assert.ok(tPdf < 2000, `PDF ${tPdf.toFixed(1)} ms < 2000 ms`);
  assert.ok(!/NaN|Infinity/.test(svg));
});
