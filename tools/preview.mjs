import { readFileSync, writeFileSync } from 'node:fs';
import { deriveProject } from '../src/core/project.js';
import { buildSheet } from '../src/draw/sheet.js';
import { LAYERS, LINETYPES } from '../src/draw/layers.js';

const file = process.argv[2] || 'presets/lifidi-pp1.json';
const out = process.argv[3] || '/tmp/sheet-debug.svg';
const model = deriveProject(JSON.parse(readFileSync(file, 'utf8')));
const { dl, layout } = buildSheet(model);
const { w, h } = layout.sheet;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dash = (l) => (LINETYPES[LAYERS[l]?.ltype] || []).join(' ');
const parts = [];
for (const e of dl.entities) {
  const L = LAYERS[e.layer] || { color: '#000', lw: 0.2, ltype: 'CONTINUOUS' };
  const common = `stroke="${L.color}" stroke-width="${L.lw}" fill="none" ${dash(e.layer) ? `stroke-dasharray="${dash(e.layer)}"` : ''}`;
  if (e.type === 'line') parts.push(`<line x1="${e.a[0]}" y1="${h - e.a[1]}" x2="${e.b[0]}" y2="${h - e.b[1]}" ${common}/>`);
  else if (e.type === 'poly') {
    const d = e.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${h - p[1]}`).join(' ') + (e.closed ? ' Z' : '');
    parts.push(`<path d="${d}" ${common}/>`);
  } else if (e.type === 'circle') parts.push(`<circle cx="${e.c[0]}" cy="${h - e.c[1]}" r="${e.r}" ${common}/>`);
  else if (e.type === 'arc') {
    const a0 = e.start * Math.PI / 180, a1 = e.end * Math.PI / 180;
    const sx = e.c[0] + Math.cos(a0) * e.r, sy = h - (e.c[1] + Math.sin(a0) * e.r);
    const ex = e.c[0] + Math.cos(a1) * e.r, ey = h - (e.c[1] + Math.sin(a1) * e.r);
    const large = (e.end - e.start + 360) % 360 > 180 ? 1 : 0;
    parts.push(`<path d="M${sx} ${sy} A${e.r} ${e.r} 0 ${large} 0 ${ex} ${ey}" ${common}/>`);
  } else if (e.type === 'triangle') {
    parts.push(`<path d="M${e.pts[0][0]} ${h - e.pts[0][1]} L${e.pts[1][0]} ${h - e.pts[1][1]} L${e.pts[2][0]} ${h - e.pts[2][1]} Z" fill="${L.color}" stroke="${L.color}" stroke-width="${L.lw}"/>`);
  } else if (e.type === 'text') {
    const size = e.h / 0.717;
    const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
    const baseline = e.vAlign === 'middle' ? 'central' : e.vAlign === 'top' ? 'hanging' : 'alphabetic';
    const rot = e.rot ? ` transform="rotate(${-e.rot} ${e.x} ${h - e.y})"` : '';
    parts.push(`<text x="${e.x}" y="${h - e.y}" font-size="${size}" font-family="Helvetica Neue, Arial" fill="${L.color}" text-anchor="${anchor}" dominant-baseline="${baseline}"${e.bold ? ' font-weight="bold"' : ''}${rot}>${esc(e.text)}</text>`);
  }
}
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/>${parts.join('\n')}</svg>`);
console.log('wrote', out, dl.entities.length, 'entities');
