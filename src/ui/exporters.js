/**
 * Export plumbing: filename conventions, Blob assembly and browser download.
 * The actual writers live in src/export/* and are passed in as `modules`
 * (loaded lazily by app.js) so a slow/failed writer never blocks the studio.
 */

const MIME = {
  dxf: 'application/dxf;charset=utf-8',
  svg: 'image/svg+xml;charset=utf-8',
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function slug(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** "LIFIDI-PP1" / "ROADCAD-SHEET" / imported project name. */
export function exportBaseName(preset, project) {
  if (preset === 'blank') return 'ROADCAD-SHEET';
  if (preset && preset !== 'custom') return slug(preset);
  return slug(project?.name || project?.meta?.sheetNo || project?.id || 'project') || 'ROADCAD-PROJECT';
}

function requireFunction(fn, label) {
  if (typeof fn !== 'function') throw new Error(`${label} is not available`);
  return fn;
}

function asString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} returned no output`);
  return value;
}

function asBytes(value, label) {
  if (value instanceof Uint8Array) {
    if (!value.length) throw new Error(`${label} returned no output`);
    return value;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    if (!bytes.length) throw new Error(`${label} returned no output`);
    return bytes;
  }
  throw new Error(`${label} did not return binary data`);
}

/**
 * Build a downloadable artifact.
 * @returns {{ blob: Blob, filename: string }}
 */
export function buildExport(kind, { model, sheet, project, preset, dl, modules }) {
  if (!sheet || !sheet.layout) throw new Error('no rendered sheet is available');
  const layout = sheet.layout;
  const drawList = dl ?? sheet.dl;
  const base = exportBaseName(preset, project);
  const title = project?.meta?.drawingTitle || 'HORIZONTAL & VERTICAL ALIGNMENT';

  switch (kind) {
    case 'dxf': {
      const write = requireFunction(modules?.buildDXF, 'The DXF writer');
      const text = asString(write(drawList, layout, { title }), 'The DXF writer');
      return { blob: new Blob([text], { type: MIME.dxf }), filename: `${base}-horizontal-vertical-alignment.dxf` };
    }
    case 'svg': {
      const write = requireFunction(modules?.renderSVG, 'The SVG renderer');
      const text = asString(write(drawList, layout), 'The SVG renderer');
      return { blob: new Blob([text], { type: MIME.svg }), filename: `${base}-horizontal-vertical-alignment.svg` };
    }
    case 'pdf': {
      const write = requireFunction(modules?.renderPDF, 'The PDF renderer');
      const bytes = asBytes(
        write(drawList, layout, {
          title,
          subject: 'Horizontal & vertical alignment sheet',
          author: project?.meta?.consultant || 'RoadCAD Sheet Studio',
          creator: 'RoadCAD Sheet Studio',
        }),
        'The PDF renderer',
      );
      return {
        blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: MIME.pdf }),
        filename: `${base}-horizontal-vertical-alignment.pdf`,
      };
    }
    case 'csv': {
      const write = requireFunction(modules?.buildCSV, 'The CSV writer');
      // The CSV writer reads model.layoutScales, which lives on the layout, not
      // the derived model — hand it a model view that carries the live scales.
      const csvModel = Object.create(model);
      csvModel.layoutScales = layout.scales;
      const text = asString(write(csvModel), 'The CSV writer');
      return { blob: new Blob([text], { type: MIME.csv }), filename: `${base}-station-table.csv` };
    }
    case 'json': {
      const text = `${JSON.stringify(project, null, 2)}\n`;
      return { blob: new Blob([text], { type: MIME.json }), filename: `${base}-project.json` };
    }
    default:
      throw new Error(`unknown export format "${kind}"`);
  }
}

/** Trigger a browser download for a Blob (revokes the object URL afterwards). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
