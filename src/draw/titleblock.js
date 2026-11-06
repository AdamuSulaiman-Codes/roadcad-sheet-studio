/**
 * Title block: revision log, client seal, project/drawing titles, consultants,
 * design/check signatures and the issue grid (drawing no, sheet no, scale, date).
 */
import { line, poly, text, circle, poly as _poly, arc } from './entities.js';
import { wrapText } from '../core/format.js';

function cellFrame(dl, x0, y0, x1, y1) {
  dl.add(poly('TITLE_LINE', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true));
}

export function drawTitleBlock(dl, model, layout) {
  const meta = model.project.meta;
  const t = layout.bands.title;
  const H = t.y1 - t.y0;
  const W = t.x1 - t.x0;

  const wRev = Math.round(W * 0.215);
  const wClient = Math.round(W * 0.176);
  const wApproved = Math.round(W * 0.086);
  const wProject = Math.round(W * 0.264);
  const wConsult = W - wRev - wClient - wApproved - wProject - Math.round(W * 0.086);
  const wInfo = Math.round(W * 0.086);

  const xRev = t.x0;
  const xClient = xRev + wRev;
  const xApproved = xClient + wClient;
  const xProject = xApproved + wApproved;
  const xConsult = xProject + wProject;
  const xInfo = xConsult + wConsult;

  cellFrame(dl, t.x0, t.y0, t.x1, t.y1);
  for (const x of [xClient, xApproved, xProject, xConsult, xInfo]) {
    dl.add(line('TITLE_LINE', x, t.y0, x, t.y1));
  }

  drawRevision(dl, meta, xRev, t.y0, xClient, t.y1);
  drawClient(dl, meta, xClient, t.y0, xApproved, t.y1);
  drawApproved(dl, meta, xApproved, t.y0, xProject, t.y1);
  drawProjectTitles(dl, meta, xProject, t.y0, xConsult, t.y1);
  drawConsultant(dl, meta, xConsult, t.y0, xInfo, t.y1);
  drawIssue(dl, meta, layout, xInfo, t.y0, t.x1, t.y1);
  return dl;
}

function drawRevision(dl, meta, x0, y0, x1, y1) {
  const cols = [0.11, 0.2, 0.2, 0.34, 0.15];
  const widths = cols.map((c) => (x1 - x0) * c);
  const xs = [x0];
  widths.forEach((w) => xs.push(xs[xs.length - 1] + w));
  const headH = 7.2;
  const rowH = 7.0;
  const nRows = Math.max(1, Math.min(7, Math.floor((y1 - y0 - headH) / rowH)));

  dl.add(line('TITLE_LINE', x0, y1 - headH, x1, y1 - headH));
  for (let i = 1; i < 5; i++) dl.add(line('TITLE_LINE', xs[i], y1 - headH, xs[i], y0));
  for (let i = 1; i <= nRows; i++) {
    const y = y1 - headH - i * rowH;
    if (y > y0 + 2) dl.add(line('TITLE_LINE', x0, y, x1, y));
  }
  const heads = ['REV.', 'DATE', 'NAME', 'AMENDMENTS', 'REMARKS'];
  heads.forEach((h, i) => {
    dl.add(text('TITLE_TEXT', (xs[i] + xs[i + 1]) / 2, y1 - headH / 2, 1.35, h, { align: 'center', vAlign: 'middle' }));
  });
  const revs = meta.revision ?? [];
  for (let i = 0; i < Math.min(revs.length, nRows); i++) {
    const rev = revs[i];
    const yMid = y1 - headH - i * rowH - rowH / 2;
    const vals = [rev.no, rev.date, rev.name, rev.amendments, rev.remarks];
    vals.forEach((v, j) => {
      if (!v) return;
      dl.add(text('TITLE_TEXT', (xs[j] + xs[j + 1]) / 2, yMid, 1.3, v, { align: 'center', vAlign: 'middle' }));
    });
  }
}

function drawClient(dl, meta, x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2;
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 3.2, 1.3, 'CLIENT:'));
  const sealR = Math.min((x1 - x0) * 0.21, 11.5);
  drawSeal(dl, cx, y1 - 8 - sealR, sealR);
  const name = meta.client || '';
  const sub = meta.clientSub || '';
  dl.add(text('LOGO_TEXT', cx, y0 + 9.6, 1.75, name, { align: 'center', bold: true }));
  dl.add(text('LOGO_TEXT', cx, y0 + 5.2, 1.2, sub, { align: 'center' }));
  dl.add(line('TITLE_LINE', x0 + 4, y0 + 3.2, x1 - 4, y0 + 3.2));
}

function drawSeal(dl, cx, cy, r) {
  dl.add(circle('LOGO', cx, cy, r));
  dl.add(circle('LOGO', cx, cy, r * 0.8));
  // five-point star
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = (-90 + i * 36) * (Math.PI / 180);
    const rad = i % 2 === 0 ? r * 0.52 : r * 0.22;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  dl.add(poly('LOGO', pts, true));
  // ribbon arcs
  dl.add(arc('LOGO', cx, cy, r * 0.92, 205, 335));
  dl.add(arc('LOGO', cx, cy, r * 0.92, 25, 155));
}

function drawApproved(dl, meta, x0, y0, x1, y1) {
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 3.2, 1.3, 'APPROVED:'));
  if (meta.approved) {
    dl.add(text('TITLE_TEXT_B', (x0 + x1) / 2, y1 - 7.4, 1.5, meta.approved, { align: 'center', bold: true }));
  }
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 11.4, 1.2, 'SIGN:'));
  dl.add(line('DIM', x0 + 1.4, y1 - 14.0, x1 - 1.6, y1 - 14.0));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 18.4, 1.2, 'DATE:'));
  dl.add(line('DIM', x0 + 1.4, y1 - 21.0, x1 - 1.6, y1 - 21.0));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 25.4, 1.2, 'STAMP:'));
}

function drawProjectTitles(dl, meta, x0, y0, x1, y1) {
  const W = x1 - x0;
  dl.add(text('TITLE_TEXT', x0 + 2, y1 - 3.2, 1.3, 'PROJECT TITLE:'));
  const titleLines = wrapText(meta.projectTitle || '', Math.floor(W / 1.62));
  titleLines.slice(0, 3).forEach((ln, i) => {
    dl.add(text('TITLE_TEXT_B', x0 + 2, y1 - 7.4 - i * 2.9, 1.9, ln, { bold: true }));
  });
  const afterTitle = y1 - 7.4 - Math.min(titleLines.length, 3) * 2.9;
  dl.add(line('DIM', x0 + 2, afterTitle - 1.8, x1 - 2, afterTitle - 1.8));
  dl.add(text('TITLE_TEXT', x0 + 2, y0 + 13.6, 1.3, 'DRAWING TITLE:'));
  dl.add(text('TITLE_TEXT_B', (x0 + x1) / 2, y0 + 9.5, 2.5, meta.drawingTitle || '', { align: 'center', bold: true }));
  dl.add(line('TITLE_LINE', x0 + 6, y0 + 7.4, x1 - 6, y0 + 7.4));
  dl.add(text('TITLE_TEXT', x0 + 2, y0 + 3.6, 1.25,
    `${meta.scaleNote ? meta.scaleNote + '   ' : ''}CHAINAGE IN METRES`, { bold: false }));
}

function drawConsultant(dl, meta, x0, y0, x1, y1) {
  dl.add(text('TITLE_TEXT', x0 + 2, y1 - 3.2, 1.3, 'CONSULTANTS:'));
  const lines = wrapText(meta.consultant || '', Math.floor((x1 - x0) / 1.25));
  lines.slice(0, 2).forEach((ln, i) => {
    dl.add(text('TITLE_TEXT_B', x0 + 2, y1 - 7.4 - i * 2.6, 1.65, ln, { bold: true }));
  });
  const addr = meta.consultantLines ?? [];
  addr.slice(0, 4).forEach((ln, i) => {
    dl.add(text('TITLE_TEXT', x0 + 2, y1 - 13.4 - i * 2.2, 1.2, ln));
  });
  // signature grid
  const gy0 = y0 + 1.2, gy1 = y0 + 15.4;
  dl.add(line('TITLE_LINE', x0, gy1, x1, gy1));
  dl.add(line('TITLE_LINE', x0, gy0, x1, gy0));
  const rows = [['DESIGNED', meta.designed], ['DRAWN', meta.drawn], ['CHECKED', meta.checked]];
  rows.forEach(([label, value], i) => {
    const y = gy1 - ((i + 0.5) * (gy1 - gy0)) / 3;
    dl.add(text('TITLE_TEXT', x0 + 2, y, 1.2, label, { vAlign: 'middle' }));
    dl.add(text('TITLE_TEXT_B', x1 - 2, y, 1.3, value || '', { align: 'right', vAlign: 'middle' }));
    if (i > 0) dl.add(line('DIM', x0 + 1, gy1 - (i * (gy1 - gy0)) / 3, x1 - 1, gy1 - (i * (gy1 - gy0)) / 3));
  });
}

function drawIssue(dl, meta, layout, x0, y0, x1, y1) {
  const m = layout.scales;
  const cx = (x0 + x1) / 2;
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 3.2, 1.15, 'DRAWING NO.'));
  dl.add(text('TITLE_TEXT_B', cx, y1 - 6.6, 1.7, meta.drawingNo || '', { align: 'center', bold: true }));

  dl.add(line('TITLE_LINE', x0, y1 - 9.4, x1, y1 - 9.4));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 12.2, 1.15, 'SHEET NO.'));
  dl.add(text('TITLE_TEXT_B', cx, y1 - 22, 7.2, meta.sheetNo || '', { align: 'center', bold: true }));

  dl.add(line('TITLE_LINE', x0, y1 - 27.4, x1, y1 - 27.4));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 30.2, 1.15, 'SCALE:'));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 33.4, 1.3, `H  1:${m.hDen}`));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 36.4, 1.3, `V  1:${m.vDen}`));

  dl.add(line('TITLE_LINE', x0, y1 - 39.2, x1, y1 - 39.2));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 42, 1.15, 'DATE:'));
  dl.add(text('TITLE_TEXT', x0 + 1.4, y1 - 45, 1.25, meta.date || ''));
  dl.add(line('TITLE_LINE', x0, y0 + 12.8, x1, y0 + 12.8));
  dl.add(text('TITLE_TEXT', cx, y0 + 8.2, 1.15, 'SHEET SIZE', { align: 'center' }));
  dl.add(text('TITLE_TEXT', cx, y0 + 4, 1.4, `${layout.sheet.w} x ${layout.sheet.h}`, { align: 'center' }));
}
