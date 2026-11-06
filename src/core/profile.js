/**
 * Vertical alignment: grades, parabolic vertical curves, existing ground and
 * cut/fill (H.T. DIFF = proposed level - existing level).
 *
 * pvis: [{ station, elev, L }] with L = vertical curve length (0 for none).
 * The first and last PVI bracket the drawn profile; extra PVIs are interior.
 */

export function buildProfile(def) {
  const pvis = (def.pvis ?? [])
    .map((p) => ({ station: Number(p.station), elev: Number(p.elev), L: Number(p.L ?? 0) }))
    .sort((a, b) => a.station - b.station);
  if (pvis.length < 2) throw new Error('Profile needs at least two PVIs');
  for (let i = 1; i < pvis.length; i++) {
    if (pvis[i].station - pvis[i - 1].station < 1e-6) throw new Error('Duplicate PVI stations');
  }

  const grades = [];
  for (let i = 1; i < pvis.length; i++) {
    const dx = pvis[i].station - pvis[i - 1].station;
    grades.push(((pvis[i].elev - pvis[i - 1].elev) / dx) * 100);
  }

  const tangentElev = (st) => {
    if (st <= pvis[0].station) return pvis[0].elev + (grades[0] / 100) * (st - pvis[0].station);
    const last = pvis[pvis.length - 1];
    if (st >= last.station) return last.elev + (grades[grades.length - 1] / 100) * (st - last.station);
    let i = 0;
    while (i < pvis.length - 2 && st > pvis[i + 1].station) i++;
    return pvis[i].elev + (grades[i] / 100) * (st - pvis[i].station);
  };

  const curves = [];
  for (let i = 1; i < pvis.length - 1; i++) {
    const L = pvis[i].L;
    if (!(L > 0)) continue;
    const g1 = grades[i - 1];
    const g2 = grades[i];
    const A = g2 - g1;
    const pvcStation = pvis[i].station - L / 2;
    const pvtStation = pvis[i].station + L / 2;
    const firstCurve = curves[curves.length - 1];
    if (firstCurve && pvcStation < firstCurve.pvtStation - 1e-6) {
      throw new Error(`Vertical curves overlap around station ${pvis[i].station.toFixed(2)}`);
    }
    const pvcElev = tangentElev(pvcStation);
    const pvtElev = pvcElev + ((g1 + g2) / 200) * L;
    const curve = {
      pvi: pvis[i],
      pviStation: pvis[i].station,
      pviElev: pvis[i].elev,
      L, A, g1, g2,
      pvcStation, pvtStation, pvcElev, pvtElev,
      K: Math.abs(A) > 1e-9 ? L / Math.abs(A) : Infinity,
      type: A < 0 ? 'crest' : A > 0 ? 'sag' : 'flat',
      // station and elevation of the high/low point when it falls inside the curve
      extreme: null,
    };
    if (Math.abs(A) > 1e-9) {
      const t = (-g1 * L) / A;
      if (t > 0 && t < L) {
        const station = pvcStation + t;
        const elev = pvcElev + (g1 / 100) * t + (A / 100 / (2 * L)) * t * t;
        curve.extreme = { station, elev, type: A < 0 ? 'HIGH' : 'LOW' };
      }
    }
    curves.push(curve);
  }

  const curveAt = (st) => {
    for (const c of curves) if (st >= c.pvcStation - 1e-9 && st <= c.pvtStation + 1e-9) return c;
    return null;
  };

  const elevationAt = (st) => {
    const c = curveAt(st);
    if (c) {
      const t = st - c.pvcStation;
      return c.pvcElev + (c.g1 / 100) * t + (c.A / 100 / (2 * c.L)) * t * t;
    }
    return tangentElev(st);
  };

  const gradeAt = (st) => {
    const c = curveAt(st);
    if (c) {
      const t = st - c.pvcStation;
      return c.g1 + (c.A / c.L) * t;
    }
    return tangentGradeAt(st);
  };

  function tangentGradeAt(st) {
    if (st <= pvis[0].station) return grades[0];
    const last = pvis[pvis.length - 1];
    if (st >= last.station) return grades[grades.length - 1];
    let i = 0;
    while (i < pvis.length - 2 && st > pvis[i + 1].station) i++;
    return grades[i];
  }

  /** Visible grade segments (between vertical curves) used for "%" labels. */
  const gradeSegments = [];
  const boundaries = [];
  for (const c of curves) boundaries.push({ s: c.pvcStation, side: 'start' }, { s: c.pvtStation, side: 'end' });
  let cursor = pvis[0].station;
  const endS = pvis[pvis.length - 1].station;
  for (const c of curves) {
    if (c.pvcStation > cursor + 0.5) gradeSegments.push(makeSeg(cursor, c.pvcStation));
    cursor = Math.max(cursor, c.pvtStation);
  }
  if (endS > cursor + 0.5) gradeSegments.push(makeSeg(cursor, endS));

  function makeSeg(s0, s1) {
    return {
      startStation: s0, endStation: s1,
      startElev: elevationAt(s0), endElev: elevationAt(s1),
      grade: ((elevationAt(s1) - elevationAt(s0)) / (s1 - s0)) * 100,
    };
  }

  // Existing ground support -------------------------------------------------
  const ground = normalizeGround(def.ground);
  const groundAt = (st) => {
    if (!ground) return null;
    const { stations, levels } = ground;
    if (st <= stations[0]) return levels[0];
    if (st >= stations[stations.length - 1]) return levels[levels.length - 1];
    let lo = 0, hi = stations.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (stations[mid] <= st) lo = mid; else hi = mid;
    }
    const t = (st - stations[lo]) / (stations[hi] - stations[lo] || 1);
    return levels[lo] + t * (levels[hi] - levels[lo]);
  };

  const cutFillAt = (st) => {
    const g = groundAt(st);
    return g == null ? null : elevationAt(st) - g;
  };

  return {
    pvis, grades, curves, gradeSegments, ground,
    startStation: pvis[0].station,
    endStation: pvis[pvis.length - 1].station,
    elevationAt, gradeAt, tangentElev, groundAt, cutFillAt, curveAt,
    sample(stations) {
      return stations.map((st) => {
        const design = elevationAt(st);
        const g = groundAt(st);
        return {
          station: st,
          design,
          ground: g,
          diff: g == null ? null : design - g,
          grade: gradeAt(st),
        };
      });
    },
  };
}

export function normalizeGround(ground) {
  if (!ground) return null;
  let stations = ground.stations;
  let levels = ground.levels;
  if (!stations && Array.isArray(ground.points)) {
    stations = ground.points.map((p) => Number(p.station));
    levels = ground.points.map((p) => Number(p.elev ?? p.level));
  }
  if (!Array.isArray(stations) || !Array.isArray(levels) || stations.length !== levels.length || stations.length < 2) {
    return null;
  }
  const pairs = stations
    .map((s, i) => ({ station: Number(s), level: Number(levels[i]) }))
    .filter((p) => Number.isFinite(p.station) && Number.isFinite(p.level))
    .sort((a, b) => a.station - b.station);
  return { stations: pairs.map((p) => p.station), levels: pairs.map((p) => p.level) };
}
