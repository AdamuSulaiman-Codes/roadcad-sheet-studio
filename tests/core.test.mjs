import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { station, bearing, num, wrapText } from '../src/core/format.js';
import { buildAlignment, locateOnAlignment } from '../src/core/alignment.js';
import { buildProfile } from '../src/core/profile.js';
import { deriveProject, normalizeProject, sheetSize } from '../src/core/project.js';

const pp1 = JSON.parse(readFileSync(new URL('../presets/lifidi-pp1.json', import.meta.url)));
const pp3 = JSON.parse(readFileSync(new URL('../presets/lifidi-pp3.json', import.meta.url)));

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('station formatting', () => {
  assert.equal(station(0), '0+000.00');
  assert.equal(station(43.19), '0+043.19');
  assert.equal(station(1000), '1+000.00');
  assert.equal(station(1240.5), '1+240.50');
  assert.equal(station(999.999), '1+000.00');
  assert.equal(station(1.4, 0), '0+001');
  assert.equal(station(-12.3), '-0+012.30');
});

test('quadrant bearings', () => {
  assert.equal(bearing(0), `N 0°00'00" E`);
  assert.equal(bearing(135), `S 45°00'00" E`);
  assert.equal(bearing(200), `S 20°00'00" W`);
  assert.equal(bearing(350), `N 10°00'00" W`);
  assert.equal(bearing(88.2075), `N 88°12'27" E`);
});

test('number formatting', () => {
  assert.equal(num(0.3334), '0.333');
  assert.equal(num(-1.2), '-1.200');
  assert.equal(num(1.2, 3, { sign: true }), '+1.200');
  assert.deepEqual(wrapText('ENGINEERING DESIGN FOR THE CONSTRUCTION', 12), ['ENGINEERING', 'DESIGN FOR', 'THE', 'CONSTRUCTION']);
});

test('90 degree left turn: elements and geometry', () => {
  const al = buildAlignment({
    nodes: [
      { e: 0, n: 0, r: 0 },
      { e: 200, n: 0, r: 100 },
      { e: 200, n: 200, r: 0 },
    ],
  });
  const c = al.curves[0];
  near(c.tangentLength, 100, 1e-9);
  near(c.length, (Math.PI / 2) * 100, 1e-9);
  near(c.deflection, -90, 1e-9); // heading 90 -> 180 is a right turn
  near(al.totalLength, (200 - 100) + (Math.PI / 2) * 100 + (200 - 100), 1e-9);
  near(c.startStation, 100, 1e-9);
  near(c.endStation, 257.079632679, 1e-9);
  // PC and PT are tangent to the curve and meet the offset points
  const pPc = al.pointAt(c.startStation);
  near(pPc.e, 100, 1e-6); near(pPc.n, 0, 1e-6);
  const pPt = al.pointAt(c.endStation);
  near(pPt.e, 200, 1e-6); near(pPt.n, 100, 1e-6);
  // left turn from east to north: centre sits at (100,100)
  near(c.center.e, 100, 1e-6);
  near(c.center.n, 100, 1e-6);
  // mid-curve point lies on the radius-100 circle about that centre
  const mid = al.pointAt(c.midStation);
  near(Math.hypot(mid.e - 100, mid.n - 100), 100, 1e-6);
  // continuity of sampled points across segment joins
  for (const s of [c.startStation, c.endStation]) {
    const a = al.pointAt(s - 1e-6);
    const b = al.pointAt(s + 1e-6);
    assert.ok(Math.hypot(a.e - b.e, a.n - b.n) < 1e-4, 'position continuous');
    assert.ok(Math.abs(a.azimuth - b.azimuth) < 1e-3, 'heading continuous');
  }
  // offset 5 m to the left of an eastbound tangent is +north
  const off = al.pointAt(50, 5);
  near(off.n, 5, 1e-9);
});

test('right turn yields a positive deflection and centre on the right side', () => {
  const al = buildAlignment({
    nodes: [
      { e: 0, n: 0, r: 0 },
      { e: 200, n: 0, r: 100 },
      { e: 200, n: -200, r: 0 },
    ],
  });
  const c = al.curves[0];
  near(c.deflection, 90, 1e-9); // heading east -> south is a clockwise (right) turn
  near(c.center.e, 100, 1e-6);
  near(c.center.n, -100, 1e-6);
});

test('curve without radius passes straight through the node', () => {
  const al = buildAlignment({
    nodes: [
      { e: 0, n: 0, r: 0 },
      { e: 100, n: 0, r: 0 },
      { e: 200, n: 100, r: 0 },
    ],
  });
  assert.equal(al.curves.length, 0);
  near(al.totalLength, 100 + Math.hypot(100, 100), 1e-9);
});

test('PP1: 1 km alignment with the reference curve', () => {
  const al = buildAlignment(pp1.alignment);
  near(al.totalLength, 1000, 0.01);
  assert.equal(al.curves.length, 1);
  const c = al.curves[0];
  near(c.radius, 5789.132, 1e-9);
  near(c.tangentLength, 41.325, 0.02);
  near(c.length, 82.649, 0.02);
  near(c.startStation, 158.0, 0.02);
  near(c.endStation, 240.65, 0.02);
  // nominal carriageway half width offset must be 3.65 m
  const p = al.pointAt(500, 3.65);
  assert.ok(Math.abs(Math.hypot(p.e - al.pointAt(500).e, p.n - al.pointAt(500).n) - 3.65) < 1e-9);
});

test('PP1 profile matches the design callout numbers', () => {
  const prof = buildProfile({ pvis: pp1.profile.pvis, ground: pp1.ground });
  const c = prof.curves[0];
  near(c.pvcStation, 479.22, 0.01);
  near(c.pvtStation, 895.40, 0.01);
  near(c.pvcElev, 294.833, 0.01);
  near(c.A, 1.281, 0.01);
  near(c.K, 324.8, 0.2);
  assert.ok(c.extreme, 'sag curve has a low point');
  near(c.extreme.station, 648.2, 0.6);
  near(c.extreme.elev, 294.395, 0.01);
  // continuity at both ends of the curve
  near(prof.elevationAt(c.pvcStation), c.pvcElev, 1e-9);
  near(prof.elevationAt(c.pvtStation), c.pvtElev, 1e-6);
  near(prof.elevationAt(1000), 296.128, 1e-3);
  near(prof.gradeAt(300), -0.5212, 0.001);
  near(prof.gradeAt(950), 0.7599, 0.001);
});

test('vertical curve high point and K value', () => {
  const prof = buildProfile({
    pvis: [
      { station: 0, elev: 100, L: 0 },
      { station: 200, elev: 110, L: 160 },
      { station: 400, elev: 108, L: 0 },
    ],
  });
  const c = prof.curves[0];
  near(c.A, -6, 1e-9);
  near(c.K, 160 / 6, 1e-9);
  // g1 = 5%, g2 = -1%; high point at t = 5*160/6 = 133.33 -> station 253.33
  near(c.extreme.station, 200 - 80 + (5 * 160) / 6, 1e-9);
  near(c.extreme.elev, prof.elevationAt(c.extreme.station), 1e-9);
  assert.equal(c.extreme.type, 'HIGH');
});

test('ground interpolation and cut/fill sign', () => {
  const prof = buildProfile({
    pvis: [
      { station: 0, elev: 50, L: 0 },
      { station: 100, elev: 52, L: 0 },
    ],
    ground: { stations: [0, 50, 100], levels: [49.5, 50.5, 51] },
  });
  near(prof.groundAt(25), 50.0, 1e-9);
  near(prof.groundAt(75), 50.75, 1e-9);
  near(prof.cutFillAt(50), 51 - 50.5, 1e-9); // design above ground -> fill (+)
  near(prof.cutFillAt(0), 0.5, 1e-9);
});

test('project derive produces the station table', () => {
  const d = deriveProject(pp1);
  assert.equal(d.errors.length, 0);
  near(d.alignment.totalLength, 1000, 0.01);
  assert.equal(d.stations[0], 0);
  near(d.stations[d.stations.length - 1], 1000, 0.01);
  assert.equal(d.stations.length, 41);
  assert.equal(d.rows.length, 41);
  near(d.rows[1].design, 297.335 - 0.0052 * 25, 0.002);
  assert.ok(d.rows.every((r) => Number.isFinite(r.diff)));
  assert.ok(d.stats.fillMax > 0.5 && d.stats.fillMax < 1.5);
  near(d.stats.length, 1000, 0.01);
  assert.equal(d.sides.length, 1);
  assert.ok(d.sides[0].alignment.totalLength > 100);
});

test('PP3: three horizontal and three vertical curves', () => {
  const d = deriveProject(pp3);
  assert.equal(d.alignment.curves.length, 3);
  assert.equal(d.profile.curves.length, 3);
  assert.ok(d.stats.maxGrade > 2.5);
  assert.ok(d.stats.minGrade < -2);
  assert.ok(d.alignment.totalLength > 950 && d.alignment.totalLength < 1050);
});

test('validation catches unusable input', () => {
  const { errors } = normalizeProject({ alignment: { nodes: [{ e: 0, n: 0 }] }, profile: { pvis: [] } });
  assert.ok(errors.some((e) => e.includes('Alignment')));
  assert.ok(errors.some((e) => e.includes('Profile')));
});

test('sheet sizes', () => {
  assert.deepEqual(sheetSize({ settings: { sheet: 'A2', orientation: 'landscape' } }), { w: 594, h: 420 });
  assert.deepEqual(sheetSize({ settings: { sheet: 'A1', orientation: 'landscape' } }), { w: 841, h: 594 });
});

test('locateOnAlignment recovers station and offset', () => {
  const al = buildAlignment(pp1.alignment);
  const p = al.pointAt(612.5, -3.65);
  const found = locateOnAlignment(al, { e: p.e, n: p.n }, { spacing: 0.5 });
  near(found.station, 612.5, 1.0);
  near(found.offset, -3.65, 0.1);
});
