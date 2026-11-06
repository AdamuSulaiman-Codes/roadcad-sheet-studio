# Drawing contract (read this before touching a renderer or UI)

Everything is dependency-free ES modules, runnable in the browser and in Node 20+.
No frameworks, no CDN, no build step.

## Pipeline

```
project JSON  ->  deriveProject(project)   (core/project.js)  ->  model
model         ->  buildSheet(model)        (draw/sheet.js)    ->  { model, layout, dl }
{ dl, layout } -> renderSVG / renderPDF / buildDXF            ->  bytes/string
```

`dl` is a `DrawList` of entities (`src/draw/entities.js`), `layout` holds every
page rectangle and coordinate transform (`src/draw/layout.js`).

## Sheet space

* Millimetres, origin **bottom-left**, **y up**.
* `layout.sheet = { w, h }` is the page size (A2 landscape default: 594 x 420).
* `layout.bands` = `{ border, frame, title, table, profile, plan }` rects `{x0,y0,x1,y1}`.
* `layout.plan.toSheet(e, n)` maps survey easting/northing to sheet mm.
* `layout.profile.xs(station)` maps chainage to sheet x (shared with the table).
* `layout.profile.y(level)` maps elevation to sheet y.
* `layout.scales = { hDen, vDen, planS, profileSV }` (1:2000 etc).

## Entities

```js
{ type:'line',   layer, a:[x,y], b:[x,y] }
{ type:'poly',   layer, pts:[[x,y],...], closed?:bool }
{ type:'text',   layer, x, y, h, text, align, vAlign, rot, bold, italic }
{ type:'circle', layer, c:[x,y], r }
{ type:'arc',    layer, c:[x,y], r, start:deg, end:deg }   // CCW
{ type:'triangle', layer, pts:[[x,y],[x,y],[x,y]] }        // filled
```

* `h` is **cap height in mm**. Renderers convert: `fontSize = h / 0.717` for
  Helvetica (cap height 0.717 em). Do not change this convention.
* `align`: `left` (anchor at start), `center`, `right`.
* `vAlign`: `baseline` (default, anchor = bottom of capitals), `bottom`, `middle`, `top`.
* `rot`: degrees **counter-clockwise** in sheet space (y-up). SVG is y-down, so an
  SVG renderer must emit `rotate(-rot x y)` (or scale y), a PDF renderer uses the
  standard y-up matrix.
* Layers and their colours/line weights/dash patterns live in `src/draw/layers.js`.
  Never hard-code colours in a renderer.

## Required renderer behaviour

* **SVG**: standalone document, `width="594mm" height="420mm"`, `viewBox="0 0 594 420"`,
  white background, `<g>` per layer with `data-layer`, stroke widths from `LAYERS[layer].lw`,
  dash arrays from `LINETYPES[layer.ltype]`, `font-family="Helvetica Neue, Arial, Helvetica, sans-serif"`,
  `font-size` = `h/0.717`, `text-anchor` for align, `dominant-baseline` for vAlign,
  `transform="rotate(-rot x y)"` for rotated text. Escape XML.
* **PDF**: A-series page in points (`mm * 72 / 25.4`), Type1 Helvetica / Helvetica-Bold
  (WinAnsi) so no font embedding is needed, vector line work, dash patterns, text
  matrix with rotation, exact text centring using AFM advance widths, `/Info` with
  title/subject/author, valid xref table + trailer. No compression is fine.
* Both must be deterministic and handle ~10 000 entities quickly.

## API

```js
renderSVG(dl, layout, { background = '#ffffff' }) -> string
renderPDF(dl, layout, { title, subject, author, creator }) -> Uint8Array
buildDXF(dl, layout) -> string                        // AutoCAD R12 ASCII, mm units
buildCSV(model, layout.scales) -> string             // chainage/levels/cut-fill table
```

`buildSheet(project)` accepts a **project definition or a derived model**
(it checks for `.alignment.segments`).
