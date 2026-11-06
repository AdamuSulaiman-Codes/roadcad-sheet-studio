/**
 * Layer table shared by DXF / SVG / PDF so the CAD file and the preview match.
 * `aci` is the AutoCAD colour index; `color` is the screen/print RGB.
 */
export const LAYERS = {
  FRAME:        { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.50 },
  FRAME_THIN:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.25 },
  TITLE_LINE:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.30 },
  TITLE_TEXT:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  TITLE_TEXT_B: { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  LOGO:         { aci: 3, color: '#1f8b30', ltype: 'CONTINUOUS', lw: 0.35 },
  LOGO_TEXT:    { aci: 3, color: '#1a7a2a', ltype: 'CONTINUOUS', lw: 0.18 },

  PLAN_CL:      { aci: 1, color: '#c62828', ltype: 'CENTER', lw: 0.25 },
  PLAN_EDGE:    { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.35 },
  PLAN_SOFT:    { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.13 },
  PLAN_TICK:    { aci: 1, color: '#c62828', ltype: 'CONTINUOUS', lw: 0.13 },
  PLAN_TEXT:    { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  PLAN_LEADER:  { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.13 },

  PROF_GRID:    { aci: 8, color: '#c2c2c2', ltype: 'CONTINUOUS', lw: 0.10 },
  PROF_AXIS:    { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.25 },
  PROF_DESIGN:  { aci: 1, color: '#c62828', ltype: 'CONTINUOUS', lw: 0.35 },
  PROF_GROUND:  { aci: 7, color: '#101010', ltype: 'DASHED', lw: 0.25 },
  PROF_TEXT:    { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  PROF_CALLOUT: { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.13 },

  TABLE_LINE:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.20 },
  TABLE_TEXT:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  TABLE_HEAD:   { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },

  NORTH:        { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.25 },
  NOTE:         { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.18 },
  DIM:          { aci: 7, color: '#101010', ltype: 'CONTINUOUS', lw: 0.13 },
};

/** DXF linetype definitions: name -> [pattern description, dash pattern in mm]. */
export const LINETYPES = {
  CONTINUOUS: [],
  DASHED: [6, -3],
  HIDDEN: [4, -2],
  CENTER: [18, -3, 3, -3],
  PHANTOM: [18, -3, 3, -3, 3, -3],
  DASHDOT: [12, -3, 0.5, -3],
};

export function layerNames() {
  return Object.keys(LAYERS);
}
