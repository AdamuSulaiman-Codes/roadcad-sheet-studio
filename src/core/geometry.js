/**
 * Plane geometry for survey coordinates: x = Easting, y = Northing (metres).
 * Azimuth is measured clockwise from +y (north); 0..360 degrees.
 */

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const pt = (e, n) => ({ e, n });
export const add = (a, b) => ({ e: a.e + b.e, n: a.n + b.n });
export const sub = (a, b) => ({ e: a.e - b.e, n: a.n - b.n });
export const mul = (a, k) => ({ e: a.e * k, n: a.n * k });
export const len = (a) => Math.hypot(a.e, a.n);
export const unit = (a) => {
  const l = len(a) || 1;
  return { e: a.e / l, n: a.n / l };
};
export const dist = (a, b) => Math.hypot(a.e - b.e, a.n - b.n);

/** Rotate a vector +90° (to the left of travel). */
export const leftNormal = (d) => ({ e: -d.n, n: d.e });
/** Rotate a vector -90° (to the right of travel). */
export const rightNormal = (d) => ({ e: d.n, n: -d.e });

/** Azimuth of a direction vector, degrees clockwise from north. */
export function azimuthOf(vec) {
  const az = Math.atan2(vec.e, vec.n) * R2D;
  return (az + 360) % 360;
}

/** Unit vector for an azimuth. */
export function directionOf(azimuthDeg) {
  const a = azimuthDeg * D2R;
  return { e: Math.sin(a), n: Math.cos(a) };
}

/** Normalize an angle to (-180, 180]. */
export function signedAngle(deg) {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

export function distancePointToSegment(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const l2 = ab.e * ab.e + ab.n * ab.n || 1;
  const t = Math.max(0, Math.min(1, (ap.e * ab.e + ap.n * ab.n) / l2));
  return dist(p, add(a, mul(ab, t)));
}

export function bbox(points) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e);
    minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n);
  }
  return { minE, maxE, minN, maxN, width: maxE - minE, height: maxN - minN };
}

/** Polyline length. */
export function polylineLength(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

/** Resample a polyline at a uniform spacing (metres). */
export function resamplePolyline(points, spacing) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segLen = dist(a, b);
    if (segLen <= 1e-9) continue;
    const d = unit(sub(b, a));
    let t = spacing - carry;
    while (t < segLen) {
      out.push(add(a, mul(d, t)));
      t += spacing;
    }
    carry = (carry + segLen) % spacing;
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.02) out.push(last);
  return out;
}

/** Intersection of two infinite lines; null when parallel. */
export function lineIntersection(p1, d1, p2, d2) {
  const det = d1.e * -d2.n - d1.n * -d2.e;
  if (Math.abs(det) < 1e-12) return null;
  const dx = p2.e - p1.e, dy = p2.n - p1.n;
  const t = (dx * -d2.n - dy * -d2.e) / det;
  return add(p1, mul(d1, t));
}
