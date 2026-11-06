/**
 * Horizontal alignment: tangent / circular-curve elements from an E,N polygon.
 *
 * The alignment is defined by nodes (survey coordinates, metres). Interior nodes
 * are points of intersection (PIs); `r` is the circular curve radius in metres,
 * 0 meaning "no curve" (the centreline passes straight through the node).
 *
 * Stations run from 0 at the first node. `stationToPoint` is the single source of
 * truth for plan geometry, station labels, offsets and curve data.
 */
import { D2R, R2D, add, sub, mul, unit, len, dist, leftNormal, azimuthOf, signedAngle } from './geometry.js';

const EPS = 1e-9;

export function buildAlignment(def) {
  const nodes = (def.nodes ?? []).map((n) => ({ e: Number(n.e), n: Number(n.n), r: Number(n.r ?? 0) }));
  if (nodes.length < 2) throw new Error('Alignment needs at least two nodes');

  const segments = [];
  const curves = [];
  let station = Number(def.startStation ?? 0);
  let prev = nodes[0];

  const pushTangent = (to) => {
    const d = unit(sub(to, prev));
    const length = dist(prev, to);
    if (length > EPS) {
      segments.push({
        kind: 'tangent',
        startStation: station,
        endStation: station + length,
        p0: prev, p1: to, d, length,
        startAzimuth: azimuthOf(d),
      });
      station += length;
    }
    prev = to;
  };

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const isEnd = i === nodes.length - 1;
    if (isEnd) {
      pushTangent(node);
      continue;
    }
    const d1 = unit(sub(node, nodes[i - 1]));
    const d2 = unit(sub(nodes[i + 1], node));
    const deflection = signedAngle(azimuthOf(d2) - azimuthOf(d1)); // + = left
    const r = node.r;
    if (r <= 0 || Math.abs(deflection) < 1e-6) {
      pushTangent(node);
      continue;
    }
    if (Math.abs(deflection) > 175) throw new Error(`Node ${i}: deflection too sharp for a circular curve`);
    const tangentLength = r * Math.tan(Math.abs(deflection) * D2R / 2);
    const arcLength = r * Math.abs(deflection) * D2R;
    const pc = add(node, mul(d1, -tangentLength));
    const ptEnd = add(node, mul(d2, tangentLength));
    // Require nodes far enough apart for the curves to fit.
    const inLen = dist(nodes[i - 1], node);
    const outLen = dist(node, nodes[i + 1]);
    if (tangentLength > inLen + EPS || tangentLength > outLen + EPS) {
      throw new Error(`Node ${i}: tangent length ${tangentLength.toFixed(2)} m does not fit between PIs`);
    }
    pushTangent(pc);
    const side = Math.sign(deflection); // +1 left, -1 right
    const center = add(pc, mul(leftNormal(d1), -r * side));
    const theta0 = Math.atan2(sub(pc, center).n, sub(pc, center).e);
    const deltaRad = -deflection * D2R;
    const curve = {
      kind: 'arc',
      startStation: station,
      endStation: station + arcLength,
      center, radius: r, theta0, deltaRad, side,
      pc, pt: ptEnd, pi: node,
      startAzimuth: azimuthOf(d1),
      endAzimuth: azimuthOf(d2),
      length: arcLength,
      tangentLength,
      curveLength: arcLength,
      deflection,
      external: r * (1 / Math.cos(Math.abs(deflection) * D2R / 2) - 1),
      midOrdinate: r * (1 - Math.cos(Math.abs(deflection) * D2R / 2)),
      chord: 2 * r * Math.sin(Math.abs(deflection) * D2R / 2),
    };
    curve.midStation = (curve.startStation + curve.endStation) / 2;
    curve.midPoint = pointOnArc(curve, 0.5);
    segments.push(curve);
    curves.push(curve);
    station += arcLength;
    prev = ptEnd;
  }

  const totalLength = segments.length ? segments[segments.length - 1].endStation : 0;
  const start = nodes[0];

  function segmentAt(st) {
    if (!segments.length) return null;
    const s = Math.max(segments[0].startStation, Math.min(segments[segments.length - 1].endStation, st));
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].endStation < s - 1e-7) lo = mid + 1; else hi = mid;
    }
    return segments[lo];
  }

  function pointAt(st, offset = 0) {
    const seg = segmentAt(st);
    if (!seg) return { ...start, azimuth: azimuthOf(unit(sub(nodes[1], nodes[0]))), curvature: 0 };
    const along = Math.max(0, Math.min(seg.endStation - seg.startStation, st - seg.startStation));
    let p, azimuth, curvature = 0;
    if (seg.kind === 'tangent') {
      p = add(seg.p0, mul(seg.d, along));
      azimuth = seg.startAzimuth;
    } else {
      const theta = seg.theta0 + seg.deltaRad * (along / seg.length);
      p = { e: seg.center.e + seg.radius * Math.cos(theta), n: seg.center.n + seg.radius * Math.sin(theta) };
      azimuth = azimuthOf({ e: Math.sin(theta) * seg.side, n: -Math.cos(theta) * seg.side });
      curvature = 1 / seg.radius;
    }
    if (offset) {
      const d = directionForAzimuth(azimuth);
      p = add(p, mul(leftNormal(d), offset));
    }
    return { ...p, azimuth, curvature };
  }

  /** Offset polyline (left positive) sampled along the element chain. */
  function pointsForRange(st0, st1, offset = 0, spacing = 2) {
    const pts = [];
    const lo = Math.max(st0, 0);
    const hi = Math.min(st1, totalLength);
    if (hi <= lo) return pts;
    const step = Math.max(0.25, spacing);
    for (let s = lo; s < hi; s += step) {
      const p = pointAt(s, offset);
      pts.push({ e: p.e, n: p.n, station: s });
    }
    const pEnd = pointAt(hi, offset);
    pts.push({ e: pEnd.e, n: pEnd.n, station: hi });
    return pts;
  }

  return {
    def,
    nodes,
    start,
    segments,
    curves,
    totalLength,
    startStation: segments[0]?.startStation ?? 0,
    endStation: totalLength,
    pointAt,
    segmentAt,
    pointsForRange,
    curveData: curves.map((c) => ({
      pi: { e: c.pi.e, n: c.pi.n },
      radius: c.radius,
      length: c.length,
      tangent: c.tangentLength,
      chord: c.chord,
      deflection: c.deflection,
      pcStation: c.startStation,
      ptStation: c.endStation,
      external: c.external,
      midOrdinate: c.midOrdinate,
    })),
  };
}

function pointOnArc(curve, t) {
  const theta = curve.theta0 + curve.deltaRad * t;
  return { e: curve.center.e + curve.radius * Math.cos(theta), n: curve.center.n + curve.radius * Math.sin(theta) };
}

function directionForAzimuth(az) {
  const a = az * D2R;
  return { e: Math.sin(a), n: Math.cos(a) };
}

/** Signed offset of a point from the alignment (left positive), plus nearest station. */
export function locateOnAlignment(alignment, point, opts = {}) {
  const spacing = opts.spacing ?? 1;
  let best = { distance: Infinity, station: 0, offset: 0 };
  for (let s = 0; s <= alignment.totalLength; s += spacing) {
    const p = alignment.pointAt(s);
    const d = Math.hypot(p.e - point.e, p.n - point.n);
    if (d < best.distance) {
      const az = p.azimuth * D2R;
      const tangent = { e: Math.sin(az), n: Math.cos(az) };
      const off = (point.e - p.e) * leftNormal(tangent).e + (point.n - p.n) * leftNormal(tangent).n;
      best = { distance: d, station: s, offset: off };
    }
  }
  return best;
}

export function curveStationRange(alignment) {
  return alignment.curves.map((c) => ({ pc: c.startStation, pt: c.endStation, pi: c.pi, radius: c.radius }));
}

export { len as vectorLength, azimuthOf, signedAngle };
