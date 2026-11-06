/**
 * Formatting helpers shared by every renderer.
 * All values are engineering units: metres, degrees, percent grades.
 */

/** 0+000.00 / 1+240.50 / -0+012.30 */
export function station(value, decimals = 2) {
  const neg = value < -1e-9;
  const v = Math.abs(value);
  const km = Math.floor(v / 1000 + 1e-9);
  let metres = v - km * 1000;
  // guard against 999.9999 rounding up past 1000
  if (Number(metres.toFixed(decimals)) >= 1000) {
    return station(neg ? -(km + 1) * 1000 : (km + 1) * 1000, decimals);
  }
  const fixed = metres.toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const intStr = int.padStart(3, '0');
  const body = decimals > 0 ? `${intStr}.${frac}` : intStr;
  return `${neg ? '-' : ''}${km}+${body}`;
}

/** Chainage label: "0+000" (2 decimals dropped when integer). */
export function chainage(value) {
  return station(value, 0);
}

/** Fixed decimal with sign control. */
export function num(value, dp = 3, { sign = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const s = Math.abs(value).toFixed(dp);
  const neg = value < 0 && Number(s) !== 0;
  return `${neg ? '-' : sign ? '+' : ''}${s}`;
}

/** Azimuth (clockwise from north) -> quadrant bearing "N 88°12'34\" E". */
export function bearing(azimuthDeg) {
  const az = ((azimuthDeg % 360) + 360) % 360;
  const round = (v) => Math.round(v * 1e6) / 1e6;
  let quad, angle;
  if (az <= 90) { quad = 'NE'; angle = az; }
  else if (az <= 180) { quad = 'SE'; angle = 180 - az; }
  else if (az <= 270) { quad = 'SW'; angle = az - 180; }
  else { quad = 'NW'; angle = 360 - az; }
  angle = round(angle);
  let d = Math.floor(angle);
  let m = Math.floor((angle - d) * 60);
  let s = Math.round(((angle - d) * 60 - m) * 60);
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  const first = quad[0];
  const last = quad[1];
  return `${first} ${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}" ${last}`;
}

export function wrapText(text, maxChars) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
