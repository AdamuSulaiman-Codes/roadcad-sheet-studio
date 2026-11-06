/** Shared helpers for exporters. */
import { entityBounds } from '../draw/entities.js';

export function boundsOf(dl) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of dl.entities) {
    const b = entityBounds(e);
    if (!b) continue;
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

export function entityCounts(dl) {
  const counts = {};
  for (const e of dl.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return counts;
}

export function slug(str) {
  return String(str ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'SHEET';
}
