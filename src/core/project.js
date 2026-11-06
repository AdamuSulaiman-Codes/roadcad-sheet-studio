/**
 * Project model: normalisation, defaults, and the derived drawing model that
 * every renderer consumes. No DOM / Node APIs in here, so it runs in both.
 */
import { buildAlignment } from './alignment.js';
import { buildProfile } from './profile.js';

export const DEFAULT_PROJECT = {
  id: 'new-project',
  meta: {
    projectTitle: 'ENGINEERING DESIGN FOR THE CONSTRUCTION OF A ROAD',
    drawingTitle: 'HORIZONTAL & VERTICAL ALIGNMENT',
    client: 'PLATEAU STATE GOVERNMENT',
    clientSub: 'MINISTRY OF WORKS',
    consultant: 'MASTODON ENGINEERING SERVICES LTD.',
    consultantLines: ['2nd Floor, Murtala Mohammed House,', 'No.37 Murtala Mohammed Way,', 'Jos, Plateau State.', 'Phone: 08035904133'],
    designed: 'ENGR. D.O.O',
    drawn: 'ENGR. D.O.O',
    checked: 'ENGR. S.A.O',
    approved: 'ENGR. M.S.O',
    date: 'MARCH, 2026',
    sheetNo: 'PP1',
    drawingNo: 'DWG. NO. 000',
    scaleNote: '',
    logo: 'crest',
    revision: [
      { no: 'A', date: '', name: '', amendments: 'FIRST ISSUE', remarks: '' },
    ],
  },
  settings: {
    sheet: 'A2',            // A0 | A1 | A2 | A3
    orientation: 'landscape',
    hScale: 'auto',         // number (denominator) or 'auto'
    vScale: 'auto',
    stationInterval: 25,    // table + grid spacing (m)
    labelInterval: 50,      // plan station label spacing (m)
    tickInterval: 10,       // plan centreline tick spacing (m)
    gridInterval: 0,        // profile grid spacing (m of elevation); 0 = auto
    units: 'm',
    showExisting: true,
    showSideRoads: true,
    showLegend: true,
    showNotes: true,
    titleFont: 'tech',
  },
  alignment: {
    name: 'MAIN LINE',
    startStation: 0,
    nodes: [],
    width: { carriageway: 7.3, shoulder: 1.5 },
  },
  sideAlignments: [],
  profile: { pvis: [] },
  ground: { stations: [], levels: [] },
  structures: [],
  notes: [
    'All dimensions in metres unless otherwise stated.',
    'Chainages are measured along the centreline from the project datum.',
    'H.T. DIFF = Proposed level - Existing ground level (+ fill, - cut).',
    'PROFILE LEVEL = top of formation (carriageway) level.',
  ],
};

const SHEET_SIZES = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

export function sheetSize(project) {
  const s = SHEET_SIZES[project.settings.sheet] ?? SHEET_SIZES.A2;
  const landscape = project.settings.orientation !== 'portrait';
  return landscape ? { w: Math.max(s.w, s.h), h: Math.min(s.w, s.h) } : { w: Math.min(s.w, s.h), h: Math.max(s.w, s.h) };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Fill defaults, coerce numbers, and validate. Returns {project, errors}. */
export function normalizeProject(input) {
  const base = clone(DEFAULT_PROJECT);
  const raw = input ?? {};
  const project = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw.meta ?? {}), revision: raw.meta?.revision ?? base.meta.revision },
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    alignment: {
      ...base.alignment,
      ...(raw.alignment ?? {}),
      width: { ...base.alignment.width, ...(raw.alignment?.width ?? {}) },
      nodes: (raw.alignment?.nodes ?? []).map((n) => ({ e: Number(n.e), n: Number(n.n), r: Number(n.r ?? 0) })),
    },
    sideAlignments: (raw.sideAlignments ?? []).map((s) => ({
      name: s.name ?? 'SIDE ROAD',
      startStation: Number(s.startStation ?? 0),
      nodes: (s.nodes ?? []).map((n) => ({ e: Number(n.e), n: Number(n.n), r: Number(n.r ?? 0) })),
      width: { ...base.alignment.width, ...(s.width ?? {}) },
    })),
    profile: { pvis: (raw.profile?.pvis ?? []).map((p) => ({ station: Number(p.station), elev: Number(p.elev), L: Number(p.L ?? 0) })) },
    ground: {
      stations: (raw.ground?.stations ?? []).map(Number),
      levels: (raw.ground?.levels ?? []).map(Number),
    },
    structures: (raw.structures ?? []).map((s) => ({ type: s.type ?? 'pipe', station: Number(s.station), size: s.size ?? '', label: s.label ?? '' })),
    notes: raw.notes ?? base.notes,
  };
  const errors = validate(project);
  return { project, errors };
}

function validate(project) {
  const errors = [];
  if (project.alignment.nodes.length < 2) errors.push('Alignment: add at least two nodes (E, N).');
  if (project.alignment.nodes.length >= 2) {
    const dup = project.alignment.nodes.some((n, i, a) => i > 0 && Math.hypot(n.e - a[i - 1].e, n.n - a[i - 1].n) < 0.01);
    if (dup) errors.push('Alignment: two consecutive nodes are at the same coordinates.');
  }
  if (project.profile.pvis.length < 2) errors.push('Profile: add at least two PVIs (station, level).');
  if (!SHEET_SIZES[project.settings.sheet]) errors.push(`Unknown sheet size "${project.settings.sheet}".`);
  return errors;
}

/**
 * Derive the complete drawing model. Throws on unusable input; callers should
 * validate first and show errors rather than deriving.
 */
export function deriveProject(input) {
  const { project, errors } = normalizeProject(input);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.validation = errors;
    throw err;
  }

  const alignment = buildAlignment(project.alignment);
  const sides = project.sideAlignments
    .map((s) => {
      try {
        return { ...s, alignment: buildAlignment(s) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const profile = buildProfile({ pvis: project.profile.pvis, ground: project.ground });

  const start = alignment.startStation;
  const end = alignment.endStation;
  const interval = Math.max(1, Number(project.settings.stationInterval) || 25);
  const stations = [];
  const first = Math.ceil((start - 1e-9) / interval) * interval;
  for (let s = first; s <= end + 1e-9; s += interval) stations.push(normStation(round(s, 6)));
  if (stations.length === 0 || stations[0] > start + 1e-6) stations.unshift(start);
  if (Math.abs(stations[stations.length - 1] - end) > 1e-6) stations.push(round(end, 6));

  const rows = profile.sample(stations);

  const diffs = rows.map((r) => r.diff).filter((d) => d != null);
  const designLevels = rows.map((r) => r.design);
  const groundLevels = rows.map((r) => r.ground).filter((g) => g != null);
  const allLevels = [...designLevels, ...groundLevels];
  const grades = profile.grades.length ? profile.grades : [0];

  const stats = {
    length: end - start,
    stations,
    rows,
    designMin: Math.min(...designLevels),
    designMax: Math.max(...designLevels),
    groundMin: groundLevels.length ? Math.min(...groundLevels) : null,
    groundMax: groundLevels.length ? Math.max(...groundLevels) : null,
    levelMin: Math.min(...allLevels),
    levelMax: Math.max(...allLevels),
    fillMax: diffs.length ? Math.max(0, ...diffs) : 0,
    cutMax: diffs.length ? Math.max(0, ...diffs.map((d) => -d)) : 0,
    maxGrade: Math.max(...grades),
    minGrade: Math.min(...grades),
    nCurves: alignment.curves.length,
    nVCurves: profile.curves.length,
  };

  const structures = project.structures
    .filter((s) => s.station >= start - 0.01 && s.station <= end + 0.01)
    .map((s) => ({ ...s, design: profile.elevationAt(s.station), ground: profile.groundAt(s.station) }));

  return {
    project,
    errors,
    sheet: sheetSize(project),
    alignment,
    sides,
    profile,
    stations,
    rows,
    stats,
    structures,
    interval,
  };
}

function normStation(v) {
  return v === 0 ? 0 : v;
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export { SHEET_SIZES };
