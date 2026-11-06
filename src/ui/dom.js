/** Tiny DOM/state helpers shared by the app shell. No dependencies. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Trailing-edge debounce with cancel()/flush() for immediate actions. */
export function debounce(fn, wait = 180) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  wrapped.pending = () => timer != null;
  return wrapped;
}

/** Read `a.b.0.c` from a plain object / array tree. */
export function getPath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (const key of parts) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Write `a.b.0.c` into a plain object / array tree, creating containers. */
export function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cur[key] == null) cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function roundTo(value, dp = 3) {
  const f = 10 ** dp;
  return Math.round(Number(value) * f) / f;
}

/** Compact numeric text for an <input value>: no float noise, no trailing zeros. */
export function inputNumber(value, dp = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = roundTo(n, dp);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
