/**
 * Generates the demo presets (data only) into presets/*.json.
 * Run: node tools/make-presets.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildAlignment } from '../src/core/alignment.js';
import { buildProfile } from '../src/core/profile.js';

const D2R = Math.PI / 180;
const dir = (az) => ({ e: Math.sin(az * D2R), n: Math.cos(az * D2R) });
const add = (p, d, k) => ({ e: p.e + d.e * k, n: p.n + d.n * k });
const azBetween = (a, b) => (Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI;

function tuneEnd(node0, pi, targetLen, guessAz, guessDist) {
  // search the final node position along a bearing so the alignment length is exact
  let best = null;
  for (let d = guessDist - 80; d <= guessDist + 80; d += 0.01) {
    const end = add(pi, dir(guessAz), d);
    const a = buildAlignment({ nodes: [node0, pi, end] });
    const err = Math.abs(a.totalLength - targetLen);
    if (!best || err < best.err) best = { end, err, len: a.totalLength };
    if (err < 1e-4) break;
  }
  return best;
}

function groundFromDiff(stations, design, diffFn) {
  return stations.map((s) => round(design(s) - diffFn(s), 3));
}

const round = (v, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------- PP1 -----
// Nearly straight 1 km rural road, one 5789 m curve, one 416 m sag curve,
// spur to NWOP branching at 0+400. Mirrors the LIFIDI reference sheet.
function makePP1() {
  // 1 km, one gentle 5789 m curve (T = 41.325, L = 82.649) and one sag curve.
  const node0 = { e: 540000.0, n: 1002860.0 };
  const R = 5789.132;
  const T = 41.325;
  const Lc = 82.649;
  const t1 = 158.0;
  const t2 = 1000.0 - t1 - Lc;
  const b1 = 88;
  const d1 = dir(b1);
  const pc = add(node0, d1, t1);
  const pi1 = add(pc, d1, T);
  const b2 = b1 - 0.818; // right-hand deflection
  const d2 = dir(b2);
  const end = add(pi1, d2, T + t2);

  const nodes = [
    { e: round(node0.e, 3), n: round(node0.n, 3), r: 0 },
    { e: round(pi1.e, 3), n: round(pi1.n, 3), r: R },
    { e: round(end.e, 3), n: round(end.n, 3), r: 0 },
  ];
  // snap the final tangent so the alignment is exactly 1 000.000 m after rounding
  let alignment = buildAlignment({ nodes });
  const snap = 1000 - alignment.totalLength;
  nodes[2] = { e: round(nodes[2].e + d2.e * snap, 6), n: round(nodes[2].n + d2.n * snap, 6), r: 0 };
  alignment = buildAlignment({ nodes });

  const pvis = [
    { station: 0, elev: 297.335, L: 0 },
    { station: 687.31, elev: 293.752, L: 416.177 },
    { station: round(alignment.totalLength, 2), elev: 296.128, L: 0 },
  ];
  const profile = buildProfile({ pvis });

  const stations = [];
  for (let s = 0; s <= alignment.totalLength + 1e-6; s += 25) stations.push(round(s, 3));
  if (Math.abs(stations[stations.length - 1] - alignment.totalLength) > 0.01) stations.push(round(alignment.totalLength, 3));
  const diffFn = (s) => {
    const t = Math.min(1, Math.max(0, s / 1000));
    const base = 0.06 + 0.95 * Math.pow(Math.sin(Math.PI * t), 0.75);
    return Math.max(0.03, base + 0.035 * Math.sin(s / 47.0) + 0.02 * Math.sin(s / 13.0 + 1.2));
  };
  const ground = groundFromDiff(stations, (s) => profile.elevationAt(s), diffFn);

  // spur: starts at the carriageway edge and heads north-east on two curves
  const branchStation = 400;
  const p0 = alignment.pointAt(branchStation, -5.15);
  const n1 = add(p0, dir(30), 85);
  const n2 = add(n1, dir(62), 95);
  const n3 = add(n2, dir(78), 80);

  return {
    id: 'lifidi-pp1',
    name: 'LIFIDI - PIAPUNG (PP1)',
    meta: {
      projectTitle: 'ENGINEERING DESIGN FOR THE CONSTRUCTION OF LIFIDI-PIAPUNG ROAD WITH SPUR TO NWOP',
      drawingTitle: 'HORIZONTAL & VERTICAL ALIGNMENT',
      client: 'PLATEAU STATE GOVERNMENT',
      clientSub: 'PLATEAU STATE MINISTRY OF WORKS',
      consultant: 'MASTODON ENGINEERING SERVICES LTD.',
      consultantLines: ['2nd Floor, Murtala Mohammed House,', 'No.37 Murtala Mohammed Way,', 'Jos, Plateau State.', 'Phone: 08035904133'],
      designed: 'ENGR. D.O.O', drawn: 'ENGR. D.O.O', checked: 'ENGR. S.A.O', approved: 'ENGR. M.S.O',
      date: 'MARCH, 2026', sheetNo: 'PP1', drawingNo: '000', logo: 'crest',
      revision: [
        { no: 'A', date: '12/02/26', name: 'D.O.O', amendments: 'FIRST ISSUE', remarks: '' },
      ],
    },
    settings: {
      sheet: 'A2', hScale: 'auto', vScale: 'auto',
      stationInterval: 25, labelInterval: 50, tickInterval: 10, gridInterval: 0,
      showExisting: true, showSideRoads: true, showLegend: true, showNotes: true,
    },
    alignment: {
      name: 'MAIN LINE',
      startStation: 0,
      nodes,
      width: { carriageway: 7.3, shoulder: 1.5 },
    },
    sideAlignments: [
      {
        name: 'SPUR TO NWOP',
        startStation: 0,
        nodes: [
          { e: round(p0.e, 3), n: round(p0.n, 3), r: 0 },
          { e: round(n1.e, 3), n: round(n1.n, 3), r: 250 },
          { e: round(n2.e, 3), n: round(n2.n, 3), r: 400 },
          { e: round(n3.e, 3), n: round(n3.n, 3), r: 0 },
        ],
        width: { carriageway: 6.0, shoulder: 1.0 },
      },
    ],
    profile: { pvis },
    ground: { stations, levels: ground },
    structures: [
      { type: 'pipe', station: 380, size: '1/900mm', label: 'PROP. 1/900mm Pipe' },
      { type: 'pipe', station: 760, size: '1/600mm', label: 'PROP. 1/600mm Pipe' },
    ],
    notes: [
      'All dimensions in metres unless otherwise stated.',
      'Chainages are measured along the centreline from the project datum.',
      'H.T. DIFF = Proposed level - Existing ground level (+ fill, - cut).',
      'PROFILE LEVEL = top of formation (carriageway) level.',
    ],
  };
}

// ---------------------------------------------------------------- PP3 -----
// 1 km alignment with three curves and a rolling profile with five vertical
// curves (crest + sag + crest), closer to the PP3 reference sheet.
function makePP3() {
  const node0 = { e: 541000.0, n: 1003000.0 };
  const n1 = { e: 541212.132, n: 1003212.132, r: 400 };
  const n2 = { e: 541338.918, n: 1003484.024, r: 500 };
  const n3 = { e: 541584.663, n: 1003656.097, r: 400 };
  const n4 = { e: 541683.144, n: 1003673.462, r: 0 };

  const alignment = buildAlignment({ nodes: [node0, n1, n2, n3, n4] });

  const L = round(alignment.totalLength, 3);
  const pvis = [
    { station: 0, elev: 300.45, L: 0 },
    { station: 210.0, elev: 301.857, L: 160 },
    { station: 430.0, elev: 298.293, L: 220 },
    { station: 650.0, elev: 303.925, L: 200 },
    { station: L, elev: round(303.925 - 0.0215 * (L - 650), 3), L: 0 },
  ];
  const profile = buildProfile({ pvis });

  const stations = [];
  for (let s = 0; s <= alignment.totalLength + 1e-6; s += 25) stations.push(round(s, 3));
  if (Math.abs(stations[stations.length - 1] - alignment.totalLength) > 0.01) stations.push(round(alignment.totalLength, 3));
  const diffFn = (s) => {
    const t = s / L;
    const base = 0.4 + 0.95 * Math.sin(Math.PI * (0.1 + 0.85 * t)) - 0.22 * Math.cos(5 * Math.PI * t);
    return Math.max(0.02, base + 0.07 * Math.sin(s / 27.0));
  };
  const ground = groundFromDiff(stations, (s) => profile.elevationAt(s), diffFn);

  return {
    id: 'lifidi-pp3',
    name: 'LIFIDI - PIAPUNG (PP3)',
    meta: {
      projectTitle: 'ENGINEERING DESIGN FOR THE CONSTRUCTION OF LIFIDI-PIAPUNG ROAD WITH SPUR TO NWOP',
      drawingTitle: 'HORIZONTAL & VERTICAL ALIGNMENT',
      client: 'PLATEAU STATE GOVERNMENT',
      clientSub: 'PLATEAU STATE MINISTRY OF WORKS',
      consultant: 'MASTODON ENGINEERING SERVICES LTD.',
      consultantLines: ['2nd Floor, Murtala Mohammed House,', 'No.37 Murtala Mohammed Way,', 'Jos, Plateau State.', 'Phone: 08035904133'],
      designed: 'ENGR. D.O.O', drawn: 'ENGR. D.O.O', checked: 'ENGR. S.A.O', approved: 'ENGR. M.S.O',
      date: 'MARCH, 2026', sheetNo: 'PP3', drawingNo: '000', logo: 'crest',
      revision: [
        { no: 'A', date: '12/02/26', name: 'D.O.O', amendments: 'FIRST ISSUE', remarks: '' },
        { no: 'B', date: '20/02/26', name: 'S.A.O', amendments: 'PROFILE REVISED', remarks: '' },
      ],
    },
    settings: {
      sheet: 'A2', hScale: 'auto', vScale: 'auto',
      stationInterval: 25, labelInterval: 50, tickInterval: 10, gridInterval: 0,
      showExisting: true, showSideRoads: true, showLegend: true, showNotes: true,
    },
    alignment: {
      name: 'MAIN LINE',
      startStation: 0,
      nodes: [
        { e: node0.e, n: node0.n, r: 0 },
        { e: n1.e, n: n1.n, r: n1.r },
        { e: n2.e, n: n2.n, r: n2.r },
        { e: n3.e, n: n3.n, r: n3.r },
        { e: n4.e, n: n4.n, r: n4.r },
      ],
      width: { carriageway: 7.3, shoulder: 1.5 },
    },
    sideAlignments: [],
    profile: { pvis },
    ground: { stations, levels: ground },
    structures: [
      { type: 'pipe', station: 300, size: '1/900mm', label: 'PROP. 1/900mm Pipe' },
      { type: 'pipe', station: 620, size: '1/1200mm', label: 'PROP. 1/1200mm Pipe' },
    ],
    notes: [
      'All dimensions in metres unless otherwise stated.',
      'Chainages are measured along the centreline from the project datum.',
      'H.T. DIFF = Proposed level - Existing ground level (+ fill, - cut).',
      'PROFILE LEVEL = top of formation (carriageway) level.',
    ],
  };
}

mkdirSync('presets', { recursive: true });
for (const [file, project] of [
  ['presets/lifidi-pp1.json', makePP1()],
  ['presets/lifidi-pp3.json', makePP3()],
]) {
  writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
  const a = buildAlignment(project.alignment);
  const p = buildProfile(project.profile);
  const levels = project.ground.levels;
  const diffs = buildProfile({ pvis: project.profile.pvis, ground: project.ground }).sample(project.ground.stations).map((r) => r.diff);
  console.log(
    `${file}: length ${a.totalLength.toFixed(3)} m, ${a.curves.length} H curves, ` +
    `${p.curves.length} V curves, levels ${Math.min(...p.pvis.map((v) => v.elev)).toFixed(2)}..${Math.max(...p.pvis.map((v) => v.elev)).toFixed(2)}, ` +
    `ground ${Math.min(...levels).toFixed(2)}..${Math.max(...levels).toFixed(2)}, ` +
    `diff ${Math.min(...diffs).toFixed(2)}..${Math.max(...diffs).toFixed(2)}`,
  );
  for (const c of a.curves) {
    console.log(`   curve PI(${c.pi.e.toFixed(3)}, ${c.pi.n.toFixed(3)}) R=${c.radius.toFixed(3)} L=${c.length.toFixed(3)} T=${c.tangentLength.toFixed(3)} PC=${c.startStation.toFixed(2)} PT=${c.endStation.toFixed(2)} Δ=${c.deflection.toFixed(4)}°`);
  }
  for (const c of p.curves) {
    console.log(`   ${c.type} PVC ${c.pvcStation.toFixed(2)} PVT ${c.pvtStation.toFixed(2)} L=${c.L} A=${c.A.toFixed(3)} K=${c.K.toFixed(2)}` +
      (c.extreme ? ` ${c.extreme.type} ${c.extreme.station.toFixed(2)} @ ${c.extreme.elev.toFixed(3)}` : ''));
  }
}
