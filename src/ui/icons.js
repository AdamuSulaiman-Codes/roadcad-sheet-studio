/** Inline SVG icon set — 16px grid, 1.5px stroke, currentColor. */
const PATHS = {
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
  minus: '<path d="M3.2 8h9.6"/>',
  fit: '<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>',
  alert: '<path d="M8 2.6 14 13H2z"/><path d="M8 6.4v2.7M8 11.4v.1"/>',
  upload: '<path d="M8 10.5v-8"/><path d="M5.2 6.1 8 3.3l2.8 2.8"/><path d="M2.8 11v1.5a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V11"/>',
  reset: '<path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.6v3.2h3.2"/>',
  chevron: '<path d="M4 6.5 8 10.5l4-4"/>',
};

export function icon(name, size = 16) {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
