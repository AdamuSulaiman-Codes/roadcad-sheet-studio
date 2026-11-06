/**
 * RoadCAD Sheet Studio — application shell.
 *
 *   project JSON → deriveProject() → buildSheet() → renderSVG() → <canvas>
 *
 * The left panel edits a plain project object; every change re-derives and
 * re-renders the sheet on a 180 ms debounce. A failed derive/render keeps the
 * last good drawing on screen (dimmed) and reports the reason above the sheet.
 */
import { deriveProject, normalizeProject, DEFAULT_PROJECT } from './core/project.js';
import { station, num } from './core/format.js';
import { DrawList } from './draw/entities.js';
import { $, $$, debounce, getPath, setPath, escapeHtml, inputNumber, formatBytes } from './ui/dom.js';
import { createViewer } from './ui/viewer.js';
import {
  LAYER_GROUPS,
  allLayerKeys,
  renderPiTable,
  renderPviTable,
  renderSideRoads,
  renderGrades,
  renderVerticalCurves,
  renderSurveyStats,
  renderLayerList,
} from './ui/panels.js';
import { downloadBlob, buildExport } from './ui/exporters.js';

/* ── constants ──────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'roadcad.sheet-studio.v1';
const TABS = ['project', 'horizontal', 'vertical', 'survey', 'sheet'];

const PRESETS = {
  'lifidi-pp1': { label: 'PP1 · LIFIDI–PIAPUNG', file: 'presets/lifidi-pp1.json' },
  'lifidi-pp3': { label: 'PP3 · LIFIDI–PP3', file: 'presets/lifidi-pp3.json' },
  blank: { label: 'Blank sheet', file: null },
};

/** Lazily loaded drawing/export modules, resolved relative to this file. */
const MODULE_URLS = {
  buildSheet: './draw/sheet.js',
  renderSVG: './export/svg.js',
  buildDXF: './export/dxf.js',
  renderPDF: './export/pdf.js',
  buildCSV: './export/csv.js',
};
const EXPORT_MODULES = { dxf: 'buildDXF', svg: 'renderSVG', pdf: 'renderPDF', csv: 'buildCSV', json: null };

/* ── state ──────────────────────────────────────────────────────────────── */

const state = {
  preset: 'lifidi-pp1',
  project: null,
  model: null, // last good derived model
  sheet: null, // last good { model, layout, dl }
  dl: null, // last good draw list (after layer filtering)
  errors: [],
  renderMs: 0,
  hiddenLayers: new Set(),
  ready: false,
  tab: 'project',
  surveyPreview: null,
  zoom: 1,
};

const refs = {};
const moduleCache = {};
const moduleAttempts = {};
let viewer = null;
let renderSeq = 0;
let resetArmed = false;
let resetTimer = 0;

const scheduleRender = debounce(() => {
  void recompute();
}, 180);

const persistSoon = debounce(persist, 420);

const previewSurvey = debounce(() => {
  state.surveyPreview = parseSurveyCsv(refs.surveyCsv.value);
  updateSurveyStats();
}, 220);

/* ── boot ───────────────────────────────────────────────────────────────── */

boot().catch((err) => {
  showBanner(`<strong>Studio failed to start.</strong> ${escapeHtml(err?.message ?? err)}`);
});

async function boot() {
  cacheRefs();
  refs.layerList.innerHTML = renderLayerList(state.hiddenLayers);
  viewer = createViewer({ canvas: refs.canvas, page: refs.page, onChange: onViewChange });

  bindTopbar();
  bindPanel();
  bindCanvas();
  bindKeyboard();
  bindWindow();

  const restored = restoreSession();
  if (restored) {
    syncLayerChecks();
    setActiveTab(TABS.includes(restored.tab) ? restored.tab : 'project');
    setPresetSelect(state.preset);
    syncFormValues();
    syncTables();
    updateProjectTitle();
    setValidation('loading');
    await recompute({ fit: true });
    // a persisted project can be left undrawable (bad edit / crashed tab):
    // never boot into a blank canvas — fall back to the preset instead.
    if (state.errors.length) {
      showToast('Saved project could not be drawn — restored the PP1 preset.', { error: true });
      await loadPresetSafe('lifidi-pp1', { fit: true, silent: true });
    }
  } else {
    setValidation('loading');
    await loadPresetSafe('lifidi-pp1', { fit: true, silent: true });
  }

  // First meaningful frame done — keep the page hidden until now.
  document.body.dataset.booted = 'true';
  persistSoon();
}

/* ── DOM refs ───────────────────────────────────────────────────────────── */

function cacheRefs() {
  const ids = [
    'canvas', 'page', 'canvasEmpty', 'canvasChip', 'zoomChip', 'issues', 'issuesList',
    'dropOverlay', 'banner', 'bannerText', 'bannerClose', 'toast', 'panelBody',
    'projectName', 'presetSelect', 'scaleReadout', 'sheetChip', 'zoomValue',
    'zoomInBtn', 'zoomOutBtn', 'fitBtn', 'exportPrimary', 'exportMenuBtn', 'exportMenu',
    'statLength', 'statHCurves', 'statVCurves', 'statFill', 'statCut', 'statRender',
    'statValidation', 'statValidationText',
    'piTable', 'pviTable', 'sideRoads', 'piCount', 'pviCount',
    'gradesReadout', 'curvesReadout', 'surveyCsv', 'surveyStats', 'layerList', 'layerCount',
    'importBtn', 'importFile', 'resetBtn', 'resetBtnText',
    'addPiBtn', 'addPviBtn', 'addSideBtn', 'applySurveyBtn', 'clearSurveyBtn',
  ];
  for (const id of ids) refs[id] = document.getElementById(id);

  refs.scaleH = refs.scaleReadout.querySelector('.scale-h b');
  refs.scaleV = refs.scaleReadout.querySelector('.scale-v b');
  refs.issuesHead = refs.issues.querySelector('.issues-head');
  refs.issuesNote = refs.issues.querySelector('.issues-note');
  refs.issuesHeadStrong = refs.issues.querySelector('.issues-head strong');
  refs.tabs = TABS.map((tab) => ({ id: tab, button: document.getElementById(`tab-${tab}`), panel: document.getElementById(`panel-${tab}`) }));
}

/* ── session persistence ────────────────────────────────────────────────── */

function restoreSession() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object' || !data.project) return null;
  try {
    const { project } = normalizeProject(data.project);
    state.project = project;
    state.preset = data.preset && (PRESETS[data.preset] || data.preset === 'custom') ? data.preset : 'lifidi-pp1';
    const keys = new Set(allLayerKeys());
    state.hiddenLayers = new Set(Array.isArray(data.hidden) ? data.hidden.filter((k) => keys.has(k)) : []);
    return data;
  } catch {
    return null;
  }
}

function persist() {
  if (!state.project) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        preset: state.preset,
        project: state.project,
        tab: state.tab,
        hidden: [...state.hiddenLayers],
      }),
    );
  } catch {
    /* private mode / file:// — persistence is best-effort */
  }
}

/* ── module loading (resilient to concurrent dev edits) ─────────────────── */

async function getModule(name) {
  if (moduleCache[name]) return moduleCache[name];
  const url = MODULE_URLS[name];
  if (!url) throw new Error(`Unknown module "${name}"`);
  const attempt = (moduleAttempts[name] = (moduleAttempts[name] ?? 0) + 1);
  const spec = attempt === 1 ? url : `${url}?retry=${attempt}`;
  const mod = await import(spec);
  const fn = mod[name];
  if (typeof fn !== 'function') throw new Error(`${url} does not export ${name}()`);
  moduleCache[name] = fn;
  return fn;
}

/* ── presets / project lifecycle ────────────────────────────────────────── */

function makeBlankProject() {
  const project = JSON.parse(JSON.stringify(DEFAULT_PROJECT));
  project.id = 'blank';
  project.name = 'Untitled road';
  project.meta.projectTitle = 'NEW ROAD PROJECT';
  project.meta.drawingTitle = 'HORIZONTAL & VERTICAL ALIGNMENT';
  project.meta.sheetNo = '01';
  project.alignment.name = 'MAIN LINE';
  project.alignment.nodes = [
    { e: 500000, n: 1000000, r: 0 },
    { e: 500240, n: 1000000, r: 0 },
  ];
  project.profile.pvis = [
    { station: 0, elev: 300, L: 0 },
    { station: 240, elev: 300, L: 0 },
  ];
  project.ground = { stations: [], levels: [] };
  project.sideAlignments = [];
  project.structures = [];
  return project;
}

async function loadPresetSafe(key, opts = {}) {
  try {
    await loadPreset(key, opts);
    if (!opts.silent) hideBanner();
    return true;
  } catch (err) {
    const label = PRESETS[key]?.label ?? key;
    showBanner(
      `<strong>Could not load “${escapeHtml(label)}”.</strong> ${escapeHtml(err?.message ?? String(err))} — open the app through <code>npm run dev</code> so <code>presets/</code> can be fetched.`,
    );
    if (!state.project) {
      state.project = normalizeProject(makeBlankProject()).project;
      state.preset = 'blank';
      setPresetSelect('blank');
      syncFormValues();
      syncTables();
      await recompute({ fit: true });
    }
    return false;
  }
}

async function loadPreset(key, opts = {}) {
  const preset = PRESETS[key];
  let raw;
  if (!preset || key === 'blank') {
    raw = makeBlankProject();
  } else {
    const res = await fetch(preset.file, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${preset.file}`);
    raw = await res.json();
  }
  if (!raw || typeof raw !== 'object') throw new Error('preset file is not an object');

  state.preset = key;
  state.project = normalizeProject(raw).project;
  state.hiddenLayers = new Set();
  state.surveyPreview = null;
  setPresetSelect(key);
  syncLayerChecks();
  syncFormValues();
  syncTables();
  updateProjectTitle();
  resetResetButton();
  await recompute({ fit: opts.fit !== false });
  if (!opts.silent) showToast(`Loaded ${preset.label}`);
}

async function applyImportedProject(data, label = 'project') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON root must be an object');
  const normalized = normalizeProject(data);
  const project = normalized.project;
  if (!project.alignment || !Array.isArray(project.alignment.nodes)) throw new Error('missing "alignment.nodes"');
  if (!project.profile || !Array.isArray(project.profile.pvis)) throw new Error('missing "profile.pvis"');

  state.project = project;
  state.preset = 'custom';
  state.surveyPreview = null;
  setPresetSelect('custom');
  syncLayerChecks();
  syncFormValues();
  syncTables();
  updateProjectTitle();
  resetResetButton();
  hideBanner();
  await recompute({ fit: true });

  if (normalized.errors.length) {
    showToast(`Imported ${label} — ${normalized.errors.length} validation issue${normalized.errors.length === 1 ? '' : 's'}.`, { error: true });
  } else {
    showToast(`Imported ${label}`);
  }
}

/* ── render pipeline ────────────────────────────────────────────────────── */

async function recompute(opts = {}) {
  try {
    await recomputeInner(opts);
  } catch (err) {
    showError([`Unexpected render error: ${err?.message ?? err}`], 'render');
  }
}

async function recomputeInner({ fit = false } = {}) {
  if (!state.project) return;
  const seq = ++renderSeq;
  const started = performance.now();

  // 1. project → derived model (throws with .validation on bad input)
  let model;
  try {
    model = deriveProject(state.project);
  } catch (err) {
    if (seq !== renderSeq) return;
    const messages = Array.isArray(err?.validation) ? err.validation : [err?.message ?? String(err)];
    showError(messages, 'validation');
    return;
  }

  // 2. load the drawing modules (lazy, retried if a dev edit broke them)
  let buildSheetFn;
  let renderSVGFn;
  try {
    [buildSheetFn, renderSVGFn] = await Promise.all([getModule('buildSheet'), getModule('renderSVG')]);
  } catch (err) {
    if (seq !== renderSeq) return;
    showError([`Drawing modules could not be loaded — ${err.message}`], 'render');
    return;
  }
  if (seq !== renderSeq) return;

  // 3. derived model → sheet + draw list
  let sheet;
  try {
    sheet = buildSheetFn(model);
    if (!sheet || !sheet.layout || !sheet.dl) throw new Error('the sheet builder returned no layout or draw list');
  } catch (err) {
    if (seq !== renderSeq) return;
    showError([`Sheet composition failed — ${err.message}`], 'render');
    return;
  }
  if (seq !== renderSeq) return;

  const layout = sheet.layout;
  const drawList = filterDrawList(sheet.dl, effectiveHiddenLayers());

  // 4. draw list → SVG markup
  let svg;
  try {
    svg = renderSVGFn(drawList, layout);
    if (typeof svg !== 'string' || svg.length < 24) throw new Error('the SVG renderer returned no output');
  } catch (err) {
    if (seq !== renderSeq) return;
    showError([`SVG renderer failed — ${err.message}`], 'render');
    return;
  }
  if (seq !== renderSeq) return;

  // 5. mount
  try {
    mountSVG(svg);
  } catch (err) {
    showError([`Could not display the drawing — ${err.message}`], 'render');
    return;
  }

  const previous = state.sheet?.layout?.sheet;
  const next = layout.sheet;
  const sheetChanged = !previous || previous.w !== next.w || previous.h !== next.h;

  state.model = model;
  state.sheet = sheet;
  state.dl = drawList;
  state.errors = [];
  state.ready = true;
  state.renderMs = performance.now() - started;

  refs.page.classList.add('is-ready');
  refs.page.classList.remove('is-dimmed');
  refs.canvasEmpty.hidden = true;
  hideIssues();
  setStale(false);

  if (!viewer.hasSheet() || sheetChanged) {
    viewer.setSheet(next.w, next.h);
    viewer.fit();
  } else if (fit) {
    viewer.fit();
  }

  updateReadouts();
  setValidation('ready');
  persistSoon();
}

/** Layer visibility plus the project options that hide a whole layer. */
function effectiveHiddenLayers() {
  const hidden = new Set(state.hiddenLayers);
  if (state.project?.settings?.showExisting === false) hidden.add('PROF_GROUND');
  return hidden;
}

function filterDrawList(drawList, hidden) {
  if (!hidden || hidden.size === 0 || !Array.isArray(drawList?.entities)) return drawList;
  const visible = drawList.entities.filter((entity) => !hidden.has(entity.layer));
  if (visible.length === drawList.entities.length) return drawList;
  const copy = new DrawList();
  copy.add(visible);
  return copy;
}

function mountSVG(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('the renderer produced invalid SVG');
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('the renderer did not produce an <svg> root');
  }
  refs.page.replaceChildren(document.importNode(root, true));
}

/* ── error surfaces ─────────────────────────────────────────────────────── */

function showError(messages, kind) {
  const hadErrors = state.errors.length > 0;
  state.errors = messages.slice();
  renderIssues(messages, kind);
  refs.page.classList.add('is-dimmed');
  if (!state.ready) refs.canvasEmpty.hidden = false;
  setStale(state.ready);
  setValidation('error');
  refs.statRender.textContent = '—';
  if (!hadErrors && state.ready) {
    showToast(kind === 'validation' ? 'Project has validation errors — keeping the last good sheet.' : 'The drawing could not be updated.', { error: true });
  }
}

function renderIssues(messages, kind) {
  refs.issues.hidden = false;
  refs.issuesHeadStrong.textContent = kind === 'validation' ? 'Cannot render drawing' : 'Drawing error';
  refs.issuesNote.textContent = state.ready ? 'showing last good sheet' : 'no sheet yet';
  refs.issuesList.replaceChildren(
    ...messages.slice(0, 6).map((message) => {
      const li = document.createElement('li');
      li.textContent = message;
      return li;
    }),
  );
}

function hideIssues() {
  refs.issues.hidden = true;
  refs.issuesList.replaceChildren();
}

function setStale(stale) {
  refs.scaleReadout.dataset.stale = stale ? 'true' : 'false';
}

function setValidation(mode) {
  const el = refs.statValidation;
  el.classList.remove('is-ready', 'is-error', 'is-loading');
  if (mode === 'ready') {
    el.classList.add('is-ready');
    refs.statValidationText.textContent = 'Ready';
    el.title = 'Project validated — drawing up to date';
  } else if (mode === 'error') {
    el.classList.add('is-error');
    refs.statValidationText.textContent = state.errors[0] ?? 'Invalid project';
    el.title = state.errors.join('\n');
  } else {
    el.classList.add('is-loading');
    refs.statValidationText.textContent = 'Loading';
    el.title = '';
  }
}

/* ── read-outs ──────────────────────────────────────────────────────────── */

function updateReadouts() {
  const { model, sheet, project } = state;
  if (!model || !sheet) return;
  const layout = sheet.layout;
  const meta = project.meta ?? {};
  const settings = project.settings ?? {};

  refs.scaleH.textContent = `1:${Number(layout.scales.hDen)}`;
  refs.scaleV.textContent = `1:${Number(layout.scales.vDen)}`;
  refs.sheetChip.textContent = `${String(meta.sheetNo ?? '—').toUpperCase()} · ${settings.sheet ?? 'A2'}`;

  refs.statLength.textContent = `${station(model.stats.length, 0)} m`;
  refs.statHCurves.textContent = String(model.stats.nCurves);
  refs.statVCurves.textContent = String(model.stats.nVCurves);
  refs.statFill.textContent = `${num(model.stats.fillMax, 2)} m`;
  refs.statCut.textContent = `${num(model.stats.cutMax, 2)} m`;
  refs.statRender.textContent = `${state.renderMs.toFixed(1)} ms`;

  refs.canvasChip.innerHTML = `<b>${escapeHtml(settings.sheet ?? 'A2')}</b> · ${layout.sheet.w} × ${layout.sheet.h} mm · ${model.stations.length} stations`;
  updateZoomReadout();
  updateProjectTitle();

  refs.piCount.textContent = `${project.alignment.nodes.length} nodes`;
  refs.pviCount.textContent = `${project.profile.pvis.length} PVIs`;
  refs.gradesReadout.innerHTML = renderGrades(model);
  refs.curvesReadout.innerHTML = renderVerticalCurves(model);

  updateSurveyStats();
  updateLayerSummary();
}

function updateZoomReadout() {
  if (!viewer) return;
  const text = `${Math.round(viewer.getZoom() * 100)}%`;
  refs.zoomValue.textContent = text;
  refs.zoomChip.textContent = text;
}

function onViewChange({ z }) {
  state.zoom = z;
  if (refs.zoomValue) updateZoomReadout();
}

function updateProjectTitle() {
  const name = state.project?.name || 'Untitled project';
  document.title = `${name} — RoadCAD Sheet Studio`;
  if (refs.projectName && document.activeElement !== refs.projectName) refs.projectName.value = name;
}

/* ── panels: values, tables, layers, survey ─────────────────────────────── */

function syncFormValues() {
  const project = state.project;
  if (!project) return;
  refs.projectName.value = project.name ?? '';
  for (const el of $$('[data-path]', refs.panelBody)) {
    const value = getPath(project, el.dataset.path);
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else if (el.dataset.kind === 'lines') el.value = Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);
    else el.value = value == null ? '' : String(value);
    el.classList.remove('is-invalid');
  }
  refs.surveyCsv.value = groundToCsv(project.ground);
  state.surveyPreview = null;
}

function syncTables() {
  const project = state.project;
  if (!project) return;
  refs.piTable.innerHTML = renderPiTable(project);
  refs.pviTable.innerHTML = renderPviTable(project);
  refs.sideRoads.innerHTML = renderSideRoads(project);
  refs.piCount.textContent = `${project.alignment.nodes.length} nodes`;
  refs.pviCount.textContent = `${project.profile.pvis.length} PVIs`;
}

function syncLayerChecks() {
  if (!refs.layerList) return;
  for (const input of $$('input[data-layer]', refs.layerList)) {
    input.checked = !state.hiddenLayers.has(input.dataset.layer);
  }
  for (const group of LAYER_GROUPS) {
    const input = $(`input[data-layer-group="${group.id}"]`, refs.layerList);
    if (!input) continue;
    const hidden = group.keys.filter((key) => state.hiddenLayers.has(key)).length;
    input.checked = hidden === 0;
    input.indeterminate = hidden > 0 && hidden < group.keys.length;
    const count = input.closest('.check')?.querySelector('.layer-count');
    if (count) count.textContent = `${group.keys.length - hidden}/${group.keys.length}`;
  }
  updateLayerSummary();
}

function updateLayerSummary() {
  if (!refs.layerCount) return;
  refs.layerCount.textContent = state.hiddenLayers.size ? `${state.hiddenLayers.size} hidden` : 'all visible';
}

function toggleLayer(input) {
  const key = input.dataset.layer;
  if (input.checked) state.hiddenLayers.delete(key);
  else state.hiddenLayers.add(key);
  syncLayerChecks();
  persistSoon();
  scheduleRender();
}

function toggleLayerGroup(input) {
  const group = LAYER_GROUPS.find((entry) => entry.id === input.dataset.layerGroup);
  if (!group) return;
  for (const key of group.keys) {
    if (input.checked) state.hiddenLayers.delete(key);
    else state.hiddenLayers.add(key);
  }
  syncLayerChecks();
  persistSoon();
  scheduleRender();
}

function groundPoints(ground) {
  const stations = ground?.stations ?? [];
  const levels = ground?.levels ?? [];
  const count = Math.min(stations.length, levels.length);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const s = Number(stations[i]);
    const l = Number(levels[i]);
    if (Number.isFinite(s) && Number.isFinite(l)) points.push({ s, l });
  }
  return points;
}

function groundToCsv(ground) {
  return groundPoints(ground)
    .map((point) => `${inputNumber(point.s, 3)}, ${inputNumber(point.l, 3)}`)
    .join('\n');
}

function updateSurveyStats() {
  if (!refs.surveyStats) return;
  const applied = groundPoints(state.project?.ground);
  const points = state.surveyPreview ?? applied;
  const pending = Boolean(state.surveyPreview) && !samePoints(state.surveyPreview, applied);
  refs.surveyStats.innerHTML = renderSurveyStats(points, { pending });
}

function samePoints(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].s !== b[i].s || a[i].l !== b[i].l) return false;
  }
  return true;
}

function parseStationToken(token) {
  const text = String(token ?? '').trim();
  if (!text || !/\d/.test(text)) return NaN;
  const kmMatch = text.match(/^(\d+)\+(\d+(?:\.\d+)?)$/);
  if (kmMatch) return Number(kmMatch[1]) * 1000 + Number(kmMatch[2]);
  const cleaned = text.replace(/[^0-9.+\-eE]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

function parseSurveyCsv(text) {
  const byStation = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const s = parseStationToken(parts[0]);
    const l = parseStationToken(parts[1]);
    if (!Number.isFinite(s) || !Number.isFinite(l)) continue;
    byStation.set(Math.round(s * 1000) / 1000, Math.round(l * 1000) / 1000);
  }
  return [...byStation.entries()].sort((a, b) => a[0] - b[0]).map(([s, l]) => ({ s, l }));
}

/* ── field editing ──────────────────────────────────────────────────────── */

function applyField(el) {
  const path = el.dataset.path;
  if (!path || !state.project) return;
  let value;

  if (el.type === 'checkbox') {
    value = el.checked;
  } else if (el.type === 'number') {
    const raw = el.value.trim();
    const parsed = Number(raw);
    if (raw === '' || !Number.isFinite(parsed)) {
      el.classList.add('is-invalid');
      return;
    }
    el.classList.remove('is-invalid');
    value = parsed;
  } else if (el.dataset.kind === 'lines') {
    value = el.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } else {
    value = el.value;
  }

  setPath(state.project, path, value);
  persistSoon();
  scheduleRender();
}

function onPanelEdit(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const layerInput = target.closest('input[data-layer]');
  if (layerInput) {
    toggleLayer(layerInput);
    return;
  }
  const groupInput = target.closest('input[data-layer-group]');
  if (groupInput) {
    toggleLayerGroup(groupInput);
    return;
  }
  const field = target.closest('[data-path]');
  if (field) applyField(field);
}

/* ── structural edits (tables) ──────────────────────────────────────────── */

function onPanelClick(event) {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || !refs.panelBody.contains(button)) return;
  const ds = button.dataset;

  if (ds.removeNode != null) return removeNode(Number(ds.removeNode));
  if (ds.removePvi != null) return removePvi(Number(ds.removePvi));
  if (ds.removeSide != null) return removeSide(Number(ds.removeSide));
  if (ds.removeSideNode) {
    const [side, node] = ds.removeSideNode.split(':').map(Number);
    return removeSideNode(side, node);
  }
  if (ds.addSideNode != null) return addSideNode(Number(ds.addSideNode));
  return undefined;
}

function afterStructureChange({ focus } = {}) {
  syncTables();
  persistSoon();
  scheduleRender.cancel();
  void recompute();
  if (focus) {
    const input = $(focus.selector, refs.panelBody);
    input?.focus({ preventScroll: false });
    input?.select?.();
  }
}

function addNode() {
  const nodes = state.project.alignment.nodes;
  const last = nodes[nodes.length - 1] ?? { e: 500000, n: 1000000, r: 0 };
  const prev = nodes[nodes.length - 2] ?? { e: last.e - 120, n: last.n };
  let de = last.e - prev.e;
  let dn = last.n - prev.n;
  if (Math.hypot(de, dn) < 1e-6) {
    de = 120;
    dn = 0;
  }
  nodes.push({ e: Math.round((last.e + de) * 1000) / 1000, n: Math.round((last.n + dn) * 1000) / 1000, r: 0 });
  afterStructureChange({ focus: { selector: `#piTable .trow:nth-child(${nodes.length + 1}) input` } });
}

function removeNode(index) {
  const nodes = state.project.alignment.nodes;
  if (nodes.length <= 2) {
    showToast('An alignment needs at least two nodes.', { error: true });
    return;
  }
  nodes.splice(index, 1);
  afterStructureChange();
}

function addPvi() {
  const pvis = state.project.profile.pvis;
  const last = pvis[pvis.length - 1] ?? { station: 0, elev: 300, L: 0 };
  const totalLength = state.model?.alignment?.totalLength ?? null;
  let nextStation = last.station + 100;
  if (totalLength != null) nextStation = Math.min(nextStation, Math.max(last.station + 10, totalLength));
  pvis.push({ station: Math.round(nextStation * 1000) / 1000, elev: last.elev, L: 0 });
  afterStructureChange({ focus: { selector: `#pviTable .trow:nth-child(${pvis.length + 1}) input` } });
}

function removePvi(index) {
  const pvis = state.project.profile.pvis;
  if (pvis.length <= 2) {
    showToast('A profile needs at least two PVIs.', { error: true });
    return;
  }
  pvis.splice(index, 1);
  afterStructureChange();
}

function addSide() {
  const main = state.project.alignment.nodes;
  const anchor = main[Math.min(1, main.length - 1)] ?? { e: 500000, n: 1000000 };
  state.project.sideAlignments.push({
    name: `SIDE ROAD ${state.project.sideAlignments.length + 1}`,
    startStation: 0,
    nodes: [
      { e: Math.round((anchor.e + 40) * 1000) / 1000, n: Math.round(anchor.n * 1000) / 1000, r: 0 },
      { e: Math.round((anchor.e + 40) * 1000) / 1000, n: Math.round((anchor.n + 80) * 1000) / 1000, r: 0 },
    ],
    width: { carriageway: 6, shoulder: 1 },
  });
  afterStructureChange();
}

function removeSide(index) {
  state.project.sideAlignments.splice(index, 1);
  afterStructureChange();
}

function addSideNode(sideIndex) {
  const side = state.project.sideAlignments[sideIndex];
  if (!side) return;
  const nodes = side.nodes;
  const last = nodes[nodes.length - 1] ?? { e: 500000, n: 1000000, r: 0 };
  const prev = nodes[nodes.length - 2] ?? { e: last.e - 60, n: last.n };
  let de = last.e - prev.e;
  let dn = last.n - prev.n;
  if (Math.hypot(de, dn) < 1e-6) {
    de = 60;
    dn = 0;
  }
  nodes.push({ e: Math.round((last.e + de) * 1000) / 1000, n: Math.round((last.n + dn) * 1000) / 1000, r: 0 });
  afterStructureChange();
}

function removeSideNode(sideIndex, nodeIndex) {
  const side = state.project.sideAlignments[sideIndex];
  if (!side) return;
  if (side.nodes.length <= 2) {
    showToast('A side road needs at least two nodes.', { error: true });
    return;
  }
  side.nodes.splice(nodeIndex, 1);
  afterStructureChange();
}

/* ── survey actions ─────────────────────────────────────────────────────── */

function applySurvey() {
  const points = parseSurveyCsv(refs.surveyCsv.value);
  if (points.length < 2) {
    showToast('Need at least two valid "station, elevation" lines.', { error: true });
    state.surveyPreview = points;
    updateSurveyStats();
    return;
  }
  state.project.ground = { stations: points.map((p) => p.s), levels: points.map((p) => p.l) };
  state.surveyPreview = null;
  updateSurveyStats();
  persistSoon();
  scheduleRender.cancel();
  void recompute();
  showToast(`Applied ${points.length} ground points`);
}

function clearSurvey() {
  state.project.ground = { stations: [], levels: [] };
  state.surveyPreview = [];
  refs.surveyCsv.value = '';
  updateSurveyStats();
  persistSoon();
  scheduleRender.cancel();
  void recompute();
  showToast('Existing ground cleared');
}

/* ── tabs ───────────────────────────────────────────────────────────────── */

function setActiveTab(tab, { focus = false } = {}) {
  if (!TABS.includes(tab)) return;
  state.tab = tab;
  for (const entry of refs.tabs) {
    const active = entry.id === tab;
    entry.button.classList.toggle('is-active', active);
    entry.button.setAttribute('aria-selected', String(active));
    entry.button.tabIndex = active ? 0 : -1;
    entry.panel.hidden = !active;
  }
  if (focus) refs.tabs.find((entry) => entry.id === tab)?.button.focus();
  persistSoon();
}

/* ── top bar ────────────────────────────────────────────────────────────── */

function setPresetSelect(key) {
  const select = refs.presetSelect;
  if (!select) return;
  if (key === 'custom') {
    let option = select.querySelector('option[value="custom"]');
    if (!option) {
      option = document.createElement('option');
      option.value = 'custom';
      option.textContent = 'Imported project';
      select.append(option);
    }
    select.value = 'custom';
    return;
  }
  select.value = PRESETS[key] ? key : 'lifidi-pp1';
}

function bindTopbar() {
  refs.projectName.addEventListener('input', () => {
    if (!state.project) return;
    state.project.name = refs.projectName.value;
    updateProjectTitle();
    persistSoon();
  });

  refs.presetSelect.addEventListener('change', async () => {
    const key = refs.presetSelect.value;
    if (key === 'custom') return;
    await loadPresetSafe(key, { fit: true });
  });

  refs.exportPrimary.addEventListener('click', () => void doExport('dxf'));
  refs.exportMenuBtn.addEventListener('click', () => {
    if (refs.exportMenu.hidden) openMenu();
    else closeMenu({ restoreFocus: true });
  });
  refs.exportMenu.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[data-export]') : null;
    if (!item) return;
    closeMenu();
    void doExport(item.dataset.export);
  });
  refs.exportMenu.addEventListener('keydown', onMenuKeydown);
  document.addEventListener('pointerdown', (event) => {
    if (refs.exportMenu.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (refs.exportMenu.contains(target) || refs.exportMenuBtn.contains(target)) return;
    closeMenu();
  });

  refs.zoomInBtn.addEventListener('click', () => viewer.zoomIn());
  refs.zoomOutBtn.addEventListener('click', () => viewer.zoomOut());
  refs.fitBtn.addEventListener('click', () => viewer.fit());
  refs.zoomValue.addEventListener('click', () => viewer.reset100());
  refs.zoomChip.addEventListener('click', () => {
    viewer.reset100();
    refs.canvas.focus({ preventScroll: true });
  });
  refs.zoomChip.classList.add('is-zoomable');

  refs.bannerClose.addEventListener('click', () => {
    refs.banner.hidden = true;
  });
}

function openMenu() {
  refs.exportMenu.hidden = false;
  refs.exportMenuBtn.setAttribute('aria-expanded', 'true');
  const first = refs.exportMenu.querySelector('[role="menuitem"]');
  first?.focus();
}

function closeMenu({ restoreFocus = false } = {}) {
  if (refs.exportMenu.hidden) return;
  refs.exportMenu.hidden = true;
  refs.exportMenuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) refs.exportMenuBtn.focus();
}

function onMenuKeydown(event) {
  const items = $$('[role="menuitem"]', refs.exportMenu);
  const index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu({ restoreFocus: true });
    return;
  }
  if (event.key === 'Tab') {
    closeMenu();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!items.length) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = (Math.max(0, index) + delta + items.length) % items.length;
    items[next].focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
  }
}

/* ── panel bindings ─────────────────────────────────────────────────────── */

function bindPanel() {
  refs.panelBody.addEventListener('input', onPanelEdit);
  refs.panelBody.addEventListener('change', onPanelEdit);
  refs.panelBody.addEventListener('click', onPanelClick);
  refs.surveyCsv.addEventListener('input', previewSurvey);

  for (const entry of refs.tabs) {
    entry.button.addEventListener('click', () => setActiveTab(entry.id));
    entry.button.addEventListener('keydown', (event) => {
      const index = TABS.indexOf(entry.id);
      let next = null;
      if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
      else if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
      else if (event.key === 'Home') next = TABS[0];
      else if (event.key === 'End') next = TABS[TABS.length - 1];
      if (next) {
        event.preventDefault();
        setActiveTab(next, { focus: true });
      }
    });
  }

  refs.addPiBtn.addEventListener('click', addNode);
  refs.addPviBtn.addEventListener('click', addPvi);
  refs.addSideBtn.addEventListener('click', addSide);
  refs.applySurveyBtn.addEventListener('click', applySurvey);
  refs.clearSurveyBtn.addEventListener('click', clearSurvey);

  refs.importBtn.addEventListener('click', () => refs.importFile.click());
  refs.importFile.addEventListener('change', async () => {
    const file = refs.importFile.files?.[0];
    refs.importFile.value = '';
    if (file) await importFile(file);
  });

  refs.resetBtn.addEventListener('click', onResetClick);
}

async function importFile(file) {
  try {
    const name = file.name || 'project.json';
    if (/\.json$/i.test(name) === false && file.type && !file.type.includes('json')) {
      throw new Error('choose a .json project file');
    }
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('the file is not valid JSON');
    }
    await applyImportedProject(data, name);
  } catch (err) {
    showToast(`Import failed — ${err?.message ?? err}`, { error: true });
  }
}

function onResetClick() {
  if (resetArmed) {
    resetResetButton();
    const key = PRESETS[state.preset] ? state.preset : 'lifidi-pp1';
    void loadPresetSafe(key, { fit: true });
    return;
  }
  resetArmed = true;
  refs.resetBtnText.textContent = 'Click again to reset';
  refs.resetBtn.classList.add('btn-strong');
  clearTimeout(resetTimer);
  resetTimer = setTimeout(resetResetButton, 4000);
}

function resetResetButton() {
  resetArmed = false;
  clearTimeout(resetTimer);
  if (refs.resetBtnText) refs.resetBtnText.textContent = 'Reset to preset';
  refs.resetBtn?.classList.remove('btn-strong');
}

/* ── canvas: import by drag & drop ──────────────────────────────────────── */

function bindCanvas() {
  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  refs.canvas.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    refs.dropOverlay.hidden = false;
  });
  refs.canvas.addEventListener('dragleave', (event) => {
    if (event.target !== refs.canvas) return;
    refs.dropOverlay.hidden = true;
  });
  refs.canvas.addEventListener('drop', async (event) => {
    event.preventDefault();
    refs.dropOverlay.hidden = true;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await importFile(file);
  });
}

/* ── window-level behaviour ─────────────────────────────────────────────── */

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

    if (event.key === 'Escape') {
      if (!refs.exportMenu.hidden) {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
      }
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      viewer.zoomIn();
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      viewer.zoomOut();
    } else if (event.key === '0' || event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      viewer.fit();
    } else if (event.key === '1') {
      event.preventDefault();
      viewer.reset100();
    }
  });
}

function bindWindow() {
  window.addEventListener('beforeunload', () => persist());

  // Keep stray file drops from navigating away from the app.
  window.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files') && !refs.canvas.contains(event.target)) {
      event.preventDefault();
    }
  });
}

/* ── exports ────────────────────────────────────────────────────────────── */

async function prepareExport(kind) {
  if (!state.ready || !state.model || !state.sheet) {
    throw new Error('nothing to export yet — fix the validation errors first');
  }
  const moduleName = EXPORT_MODULES[kind];
  if (moduleName && !moduleCache[moduleName]) await getModule(moduleName);
  return buildExport(kind, {
    kind,
    model: state.model,
    sheet: state.sheet,
    project: state.project,
    preset: state.preset,
    dl: state.dl,
    modules: moduleCache,
  });
}

async function doExport(kind) {
  closeMenu();
  try {
    const { blob, filename } = await prepareExport(kind);
    downloadBlob(blob, filename);
    showToast(`Exported ${filename}`, { detail: formatBytes(blob.size) });
    return { blob, filename };
  } catch (err) {
    showToast(`Export failed — ${err?.message ?? err}`, { error: true });
    return null;
  }
}

/* ── toast / banner ─────────────────────────────────────────────────────── */

let toastTimer = 0;
function showToast(message, { error = false, detail = '' } = {}) {
  refs.toast.textContent = detail ? `${message} · ${detail}` : message;
  refs.toast.classList.toggle('is-error', Boolean(error));
  refs.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    refs.toast.hidden = true;
  }, 3400);
}

function showBanner(html) {
  refs.bannerText.innerHTML = html;
  refs.banner.hidden = false;
}

function hideBanner() {
  refs.banner.hidden = true;
}

/* ── debug handle (used by the verification harness) ────────────────────── */

window.__studio = {
  version: '1.0.0',
  get state() {
    return state;
  },
  get model() {
    return state.model;
  },
  get sheet() {
    return state.sheet;
  },
  get layout() {
    return state.sheet?.layout ?? null;
  },
  get scales() {
    return state.sheet?.layout?.scales ?? null;
  },
  get errors() {
    return state.errors.slice();
  },
  get renderMs() {
    return state.renderMs;
  },
  project: () => state.project,
  hiddenLayers: () => [...state.hiddenLayers],
  render: (opts) => recompute(opts ?? {}),
  fit: () => viewer.fit(),
  zoom: (pct) => viewer.setZoomPercent(pct),
  resetZoom: () => viewer.reset100(),
  getZoom: () => viewer.getZoom(),
  transform: () => viewer.getTransform(),
  setTab: (tab) => setActiveTab(tab),
  loadPreset: (key) => loadPresetSafe(key, { fit: true }),
  importProject: (data, label = 'debug-project.json') => applyImportedProject(data, label),
  exportBlob: async (kind) => {
    try {
      const { blob, filename } = await prepareExport(kind);
      return { filename, size: blob.size, type: blob.type };
    } catch (err) {
      return { error: err?.message ?? String(err) };
    }
  },
  download: (kind) => doExport(kind),
  clearStorage: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};
