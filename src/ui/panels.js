/**
 * Panel renderers: editable PI / PVI tables, side-road cards, grade + K
 * read-outs, the layer checklist and survey statistics.
 *
 * These functions only build markup. All editing is handled by delegated
 * `data-path` bindings in app.js, so tables are re-rendered only when their
 * structure changes (never on every keystroke).
 */
import { LAYERS } from '../draw/layers.js';
import { station, num } from '../core/format.js';
import { inputNumber, roundTo, escapeHtml } from './dom.js';
import { icon } from './icons.js';

export const LAYER_GROUPS = [
  {
    id: 'sheet',
    label: 'Frame & title block',
    keys: ['FRAME', 'FRAME_THIN', 'TITLE_LINE', 'TITLE_TEXT', 'TITLE_TEXT_B', 'LOGO', 'LOGO_TEXT'],
  },
  {
    id: 'plan',
    label: 'Plan',
    keys: ['PLAN_CL', 'PLAN_EDGE', 'PLAN_SOFT', 'PLAN_TICK', 'PLAN_TEXT', 'PLAN_LEADER', 'NORTH'],
  },
  {
    id: 'profile',
    label: 'Profile',
    keys: ['PROF_GRID', 'PROF_AXIS', 'PROF_DESIGN', 'PROF_GROUND', 'PROF_TEXT', 'PROF_CALLOUT'],
  },
  {
    id: 'table',
    label: 'Levels table',
    keys: ['TABLE_LINE', 'TABLE_TEXT', 'TABLE_HEAD'],
  },
  {
    id: 'notes',
    label: 'Notes & dimensions',
    keys: ['NOTE', 'DIM'],
  },
];

export function allLayerKeys() {
  return LAYER_GROUPS.flatMap((g) => g.keys);
}

/* ── horizontal ─────────────────────────────────────────────────────────── */

export function renderPiTable(project) {
  const nodes = project.alignment?.nodes ?? [];
  const canRemove = nodes.length > 2;
  const rows = nodes
    .map(
      (n, i) => `<div class="trow">
        <span class="cell-idx">${i + 1}</span>
        <input class="cell-input" type="number" step="0.001" inputmode="decimal"
               data-path="alignment.nodes.${i}.e" value="${inputNumber(n.e, 3)}"
               aria-label="PI ${i + 1} easting, metres" title="Easting (m)">
        <input class="cell-input" type="number" step="0.001" inputmode="decimal"
               data-path="alignment.nodes.${i}.n" value="${inputNumber(n.n, 3)}"
               aria-label="PI ${i + 1} northing, metres" title="Northing (m)">
        <input class="cell-input" type="number" step="0.001" inputmode="decimal" min="0"
               data-path="alignment.nodes.${i}.r" value="${inputNumber(n.r, 3)}"
               aria-label="PI ${i + 1} curve radius, metres" title="Radius (m), 0 = no curve">
        <button class="icon-btn" type="button" data-remove-node="${i}"
                aria-label="Remove PI ${i + 1}" title="Remove node" ${canRemove ? '' : 'disabled'}>${icon('x', 13)}</button>
      </div>`,
    )
    .join('');
  return `<div class="table table--pi">
    <div class="thead" aria-hidden="true"><span class="cell-idx">#</span><span class="cell-num">E (m)</span><span class="cell-num">N (m)</span><span class="cell-num">R (m)</span><span></span></div>
    ${rows}
  </div>`;
}

export function renderSideRoads(project) {
  const sides = project.sideAlignments ?? [];
  if (!sides.length) {
    return '<div class="side-empty">No side roads in this project.</div>';
  }
  return sides
    .map((side, si) => {
      const nodes = side.nodes ?? [];
      const rows = nodes
        .map(
          (n, i) => `<div class="trow">
            <span class="cell-idx">${i + 1}</span>
            <input class="cell-input" type="number" step="0.001" inputmode="decimal"
                   data-path="sideAlignments.${si}.nodes.${i}.e" value="${inputNumber(n.e, 3)}"
                   aria-label="Side road ${si + 1} node ${i + 1} easting, metres">
            <input class="cell-input" type="number" step="0.001" inputmode="decimal"
                   data-path="sideAlignments.${si}.nodes.${i}.n" value="${inputNumber(n.n, 3)}"
                   aria-label="Side road ${si + 1} node ${i + 1} northing, metres">
            <input class="cell-input" type="number" step="0.001" inputmode="decimal" min="0"
                   data-path="sideAlignments.${si}.nodes.${i}.r" value="${inputNumber(n.r, 3)}"
                   aria-label="Side road ${si + 1} node ${i + 1} curve radius, metres">
            <button class="icon-btn" type="button" data-remove-side-node="${si}:${i}"
                    aria-label="Remove side road ${si + 1} node ${i + 1}" title="Remove node"
                    ${nodes.length > 2 ? '' : 'disabled'}>${icon('x', 13)}</button>
          </div>`,
        )
        .join('');
      return `<div class="side-card">
        <div class="side-head">
          <input class="input" type="text" spellcheck="false"
                 data-path="sideAlignments.${si}.name" value="${escapeHtml(side.name ?? '')}"
                 aria-label="Side road ${si + 1} name">
          <button class="icon-btn" type="button" data-remove-side="${si}"
                  aria-label="Remove side road ${si + 1}" title="Remove side road">${icon('x', 13)}</button>
        </div>
        <div class="table table--pi">
          <div class="thead" aria-hidden="true"><span class="cell-idx">#</span><span class="cell-num">E (m)</span><span class="cell-num">N (m)</span><span class="cell-num">R (m)</span><span></span></div>
          ${rows}
        </div>
        <button class="btn btn-add" type="button" data-add-side-node="${si}">${icon('plus', 13)} Add node</button>
      </div>`;
    })
    .join('');
}

/* ── vertical ───────────────────────────────────────────────────────────── */

export function renderPviTable(project) {
  const pvis = project.profile?.pvis ?? [];
  const canRemove = pvis.length > 2;
  const rows = pvis
    .map(
      (p, i) => `<div class="trow">
        <span class="cell-idx">${i + 1}</span>
        <input class="cell-input" type="number" step="0.001" inputmode="decimal"
               data-path="profile.pvis.${i}.station" value="${inputNumber(p.station, 3)}"
               aria-label="PVI ${i + 1} station, metres" title="Station (m)">
        <input class="cell-input" type="number" step="0.001" inputmode="decimal"
               data-path="profile.pvis.${i}.elev" value="${inputNumber(p.elev, 3)}"
               aria-label="PVI ${i + 1} level, metres" title="Level (m)">
        <input class="cell-input" type="number" step="0.1" inputmode="decimal" min="0"
               data-path="profile.pvis.${i}.L" value="${inputNumber(p.L, 3)}"
               aria-label="PVI ${i + 1} vertical curve length, metres" title="Vertical curve length L (m)">
        <button class="icon-btn" type="button" data-remove-pvi="${i}"
                aria-label="Remove PVI ${i + 1}" title="Remove PVI" ${canRemove ? '' : 'disabled'}>${icon('x', 13)}</button>
      </div>`,
    )
    .join('');
  return `<div class="table table--pvi">
    <div class="thead" aria-hidden="true"><span class="cell-idx">#</span><span class="cell-num">Station (m)</span><span class="cell-num">Level (m)</span><span class="cell-num">L (m)</span><span></span></div>
    ${rows}
  </div>`;
}

/** Grade between each pair of consecutive PVIs. */
export function renderGrades(model) {
  const profile = model?.profile;
  if (!profile || profile.pvis.length < 2) {
    return '<div class="readout-empty">Add at least two PVIs to derive grades.</div>';
  }
  const rows = [];
  for (let i = 0; i < profile.grades.length; i += 1) {
    const a = profile.pvis[i];
    const b = profile.pvis[i + 1];
    const grade = profile.grades[i];
    rows.push(`<div class="readout-row">
      <span class="readout-main">${station(a.station, 0)} → ${station(b.station, 0)}</span>
      <span class="readout-sub">${num(b.station - a.station, 2)} m</span>
      <span class="readout-val">${grade > 0 ? '+' : ''}${num(grade, 3)} %</span>
    </div>`);
  }
  return rows.join('');
}

/** Vertical curve data: type, extent, L and K. */
export function renderVerticalCurves(model) {
  const curves = model?.profile?.curves ?? [];
  if (!curves.length) {
    return '<div class="readout-empty">No vertical curves (all PVI L = 0).</div>';
  }
  return curves
    .map((c) => {
      const k = Number.isFinite(c.K) ? num(c.K, 1) : '—';
      return `<div class="readout-row" title="A = ${num(c.A, 3)} % · K = L / |A|">
        <span class="readout-main">${c.type.toUpperCase()} · ${station(c.pvcStation, 0)} → ${station(c.pvtStation, 0)}</span>
        <span class="readout-sub">L ${num(c.L, 2)}</span>
        <span class="readout-val">K ${k}</span>
      </div>`;
    })
    .join('');
}

/* ── survey ─────────────────────────────────────────────────────────────── */

export function renderSurveyStats(points, { pending = false } = {}) {
  if (!points || points.length === 0) return 'No ground points loaded.';
  const levels = points.map((p) => p.l);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const first = points[0].s;
  const last = points[points.length - 1].s;
  return `<div><b>${points.length}</b> points · chainage <b>${station(first, 0)}</b> → <b>${station(last, 0)}</b></div>
    <div>levels <b>${num(min, 3)}</b> – <b>${num(max, 3)}</b> m · range <b>${num(max - min, 3)}</b> m</div>
    ${pending ? '<div class="warn">Edited — press “Apply points” to update the drawing.</div>' : ''}`;
}

/* ── sheet / layers ─────────────────────────────────────────────────────── */

export function renderLayerList(hidden) {
  return LAYER_GROUPS.map((group) => {
    const hiddenCount = group.keys.filter((k) => hidden.has(k)).length;
    const groupChecked = hiddenCount === 0;
    const rows = group.keys
      .map((key) => {
        const def = LAYERS[key] ?? { color: '#808080' };
        return `<label class="check">
          <input type="checkbox" data-layer="${key}" ${hidden.has(key) ? '' : 'checked'}>
          <span class="layer-swatch" style="--swatch:${def.color}" aria-hidden="true"></span>
          <span>${key}</span>
        </label>`;
      })
      .join('');
    return `<div class="layer-group">
      <label class="check check-group">
        <input type="checkbox" data-layer-group="${group.id}" ${groupChecked ? 'checked' : ''}>
        <span>${group.label}</span>
        <span class="layer-count">${group.keys.length - hiddenCount}/${group.keys.length}</span>
      </label>
      <div class="layer-items">${rows}</div>
    </div>`;
  }).join('');
}

/** Round a number for display in an input without float noise. */
export function displayNumber(value, dp = 3) {
  return inputNumber(roundTo(value, dp), dp);
}
