# AutoCAD / Autodesk workflow notes

This project deliberately produces **DXF**, not DWG: DXF is the one format every
CAD package reads without a licence server, and it carries everything the sheet
needs (layers, colours, linetypes, text alignment, rotation, polylines).

## 1. Local AutoCAD (no Autodesk account needed)

```bash
npm run build        # -> out/LIFIDI-PP1.dxf (also .pdf .svg .csv)
```

In AutoCAD / Civil 3D / BricsCAD / ZWCAD / LibreCAD / QCAD:

1. `OPEN` → `out/LIFIDI-PP1.dxf`. Accept "ASCII DXF R12".
2. `UNITS` → millimetres (`INSUNITS` is already 4). The sheet is drawn 1:1 at
   A2 (594 × 420 model units).
3. Layers arrive separated and coloured:

| Layer | Colour | Contents |
| --- | --- | --- |
| `FRAME`, `FRAME_THIN` | black | sheet border |
| `PLAN_EDGE`, `PLAN_SOFT` | black | carriageway / shoulder edges |
| `PLAN_CL`, `PLAN_TICK` | red | centre line and chainage ticks |
| `PLAN_TEXT`, `PLAN_LEADER` | black | stations, PC/PT, curve data, bearings |
| `PROF_DESIGN` | red | design profile |
| `PROF_GROUND` | black dashed | existing ground |
| `PROF_GRID` | grey | level grid |
| `PROF_CALLOUT`, `PROF_TEXT` | black | grades, PVC/PVT, K values, culverts |
| `TABLE_*` | black | chainage / levels / H.T. DIFF |
| `TITLE_*`, `LOGO*` | black / green | title block, seal |

4. Plot: `PLOT` → printer `DWG To PDF.pc3` → paper **ISO full bleed A2**
   (594 × 420 mm) → plot area **Extents** → scale **1:1** → `monochrome.ctb` →
   plot lineweights on → `Plot style table` as required by your office.
5. Fine-tune and `SAVEAS` a `.dwg`. Re-export from the app when the design
   changes; keep the DWG for markup only.

`autocad/sheet-plot.scr` is a starting point for scripted plotting — the prompt
sequence changes slightly between AutoCAD releases, so step through it once.

### Civil 3D

* `ATTACH` the DXF as an xref and trace the centreline, or
* `Create Alignment from Objects` on the `PLAN_CL` polyline (it is already the
  exact tangent/arc chain used to compute the sheet), then add the profile from
  the `PROFILE LEVEL` row of the CSV (`out/LIFIDI-PP1.csv`).

## 2. Cloud AutoCAD (Autodesk Platform Services / Design Automation)

Use this when the DWG must be produced server-side (no workstation AutoCAD).
It requires an APS app, a paid Design Automation entitlement, an app bundle
containing `accoreconsole`, and a published Activity.

1. **Token** (`client_credentials`, keep the secret server-side only):
   ```bash
   POST https://developer.api.autodesk.com/authentication/v2/token
   Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
   Content-Type: application/x-www-form-urlencoded
   grant_type=client_credentials&scope=code:all data:read data:write bucket:create bucket:read
   ```
2. **Upload** the DXF to OSS (`POST /oss/v2/buckets`, then the S3 signed upload
   from `GET /oss/v2/buckets/{bucket}/objects/{object}/signeds3upload`).
3. **Run** a work item:
   ```bash
   POST https://developer.api.autodesk.com/da/us-east/v3/workitems
   ```
   ```json
   {
     "activityId": "<yourActivity>",
     "arguments": {
       "inputFile":  { "url": "<signed GET url of the DXF>" },
       "outputFile": { "url": "<signed PUT url for the DWG>", "verb": "put" },
       "script":     { "url": "<signed GET url of the .scr>" }
     }
   }
   ```
   The Activity's `commandLine` runs
   `"$(engine.path)\\accoreconsole.exe /i \"$(args[inputFile].path)\" /s \"$(args[script].path)\""`
   with engine `Autodesk.AutoCAD+24_3`, and the script does `SAVEAS` / `-PLOT`.
4. **Download** the output from the signed PUT url; poll
   `GET /da/us-east/v3/workitems/{id}` for status.

Follow the official walkthrough for the app bundle and Activity JSON — the
minute details (engine version, `PackageContents.xml`, activity parameters) are
version-specific:
<https://aps.autodesk.com/developer/overview/automation-api>

### Viewer (optional)

Upload the output DWF/DWG to the Model Derivative service
(`POST /modelderivative/v2/designdata/job`, input `urn` = base64url of the OSS
object id), then embed the APS Viewer in a web app with the translated
`urn`. The local web app in this repo does not need this: it draws the sheet
itself with the same geometry code that writes the DXF.

## 3. What the DXF cannot express

* Plot style tables and page setups (created in AutoCAD, not in DXF).
* Civil 3D objects (alignments, profiles, corridors) — this is plain 2D
  geometry plus text, which is why every CAD package can read it.
* TrueType font embedding: the style points at `arial.ttf`; swap the text style
  for `isocp.shx` if you need the classic ISO CAD look.
