/**
 * Sheet viewer: pixel-accurate pan / wheel-zoom / fit for the white page.
 * The page element is positioned with CSS `transform: translate(...) scale(...)`
 * at its natural on-screen size (1 mm = 96/25.4 CSS px at 100%).
 */
const MM_TO_PX = 96 / 25.4;

export function createViewer({ canvas, page, onChange }) {
  let sheetWmm = 0;
  let sheetHmm = 0;
  let baseW = 0; // page size in CSS px at 100%
  let baseH = 0;
  let z = 1;
  let tx = 0;
  let ty = 0;
  let fitted = true;
  let dragging = false;
  let dragMoved = false;
  let last = { x: 0, y: 0 };
  let pointerId = null;

  function viewportSize() {
    return {
      w: canvas.clientWidth || canvas.getBoundingClientRect().width || 1,
      h: canvas.clientHeight || canvas.getBoundingClientRect().height || 1,
    };
  }

  function clampZoom(value) {
    return Math.min(8, Math.max(0.04, value));
  }

  function apply() {
    page.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(5)})`;
    if (typeof onChange === 'function') onChange({ z, fitted });
  }

  function setSheet(wmm, hmm) {
    if (!(wmm > 0) || !(hmm > 0)) return;
    sheetWmm = wmm;
    sheetHmm = hmm;
    baseW = wmm * MM_TO_PX;
    baseH = hmm * MM_TO_PX;
    page.style.width = `${baseW.toFixed(3)}px`;
    page.style.height = `${baseH.toFixed(3)}px`;
  }

  function hasSheet() {
    return baseW > 0 && baseH > 0;
  }

  function fit() {
    if (!hasSheet()) return;
    const { w, h } = viewportSize();
    const pad = Math.max(18, Math.min(42, Math.min(w, h) * 0.05));
    const availW = Math.max(20, w - pad * 2);
    const availH = Math.max(20, h - pad * 2);
    z = clampZoom(Math.min(availW / baseW, availH / baseH));
    tx = (w - baseW * z) / 2;
    ty = (h - baseH * z) / 2;
    fitted = true;
    apply();
  }

  function zoomAt(clientX, clientY, factor) {
    if (!hasSheet()) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const next = clampZoom(z * factor);
    if (Math.abs(next - z) < 1e-6) return;
    // keep the sheet point under the cursor pinned
    const px = (cx - tx) / z;
    const py = (cy - ty) / z;
    z = next;
    tx = cx - px * z;
    ty = cy - py * z;
    fitted = false;
    apply();
  }

  function zoomBy(factor) {
    const { w, h } = viewportSize();
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.left + w / 2, rect.top + h / 2, factor);
  }

  /** Zoom so that the page is shown at `pct`% of actual size, centred. */
  function setZoomPercent(pct) {
    if (!hasSheet()) return;
    const { w, h } = viewportSize();
    z = clampZoom(pct / 100);
    tx = (w - baseW * z) / 2;
    ty = (h - baseH * z) / 2;
    fitted = false;
    apply();
  }

  function onWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 0.055 : event.deltaMode === 2 ? 0.9 : 0.0016;
    const factor = Math.exp(-event.deltaY * unit);
    zoomAt(event.clientX, event.clientY, factor);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.canvas-ui')) return;
    dragging = true;
    dragMoved = false;
    last = { x: event.clientX, y: event.clientY };
    pointerId = event.pointerId;
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      /* pointer capture can be unavailable — panning still works via move events */
    }
    canvas.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (!dx && !dy) return;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    last = { x: event.clientX, y: event.clientY };
    tx += dx;
    ty += dy;
    fitted = false;
    apply();
  }

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    if (pointerId != null) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      pointerId = null;
    }
    canvas.classList.remove('is-dragging');
    if (event && event.type === 'pointerup' && !dragMoved) canvas.focus({ preventScroll: true });
  }

  function onDoubleClick(event) {
    if (event.target instanceof Element && event.target.closest('.canvas-ui')) return;
    fit();
  }

  let rafId = 0;
  function onResize() {
    if (!hasSheet()) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (fitted) fit();
    });
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', onDoubleClick);

  const ro = new ResizeObserver(onResize);
  ro.observe(canvas);

  return {
    setSheet,
    hasSheet,
    fit,
    zoomIn: () => zoomBy(1.2),
    zoomOut: () => zoomBy(1 / 1.2),
    setZoomPercent,
    reset100: () => setZoomPercent(100),
    getZoom: () => z,
    isFitted: () => fitted,
    getTransform: () => ({ z, tx, ty, fitted, sheetW: sheetWmm, sheetH: sheetHmm }),
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('dblclick', onDoubleClick);
    },
  };
}
