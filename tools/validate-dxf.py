#!/usr/bin/env python3
"""Third-party DXF validation + rendering with ezdxf (dev only, not shipped).

Usage: <python with ezdxf installed> tools/validate-dxf.py out/LIFIDI-PP1.dxf
"""
import sys, collections
import ezdxf
from ezdxf import recover

path = sys.argv[1] if len(sys.argv) > 1 else 'out/LIFIDI-PP1.dxf'
print(f'== {path}')

# 1. strict load
try:
    doc = ezdxf.readfile(path)
    print('readfile: OK, version', doc.dxfversion, 'encoding', doc.encoding)
except Exception as e:
    print('readfile: FAILED ->', type(e).__name__, e)
    doc, auditor = recover.readfile(path)
    print('recover: version', doc.dxfversion, 'errors', len(auditor.errors), 'fixes', len(auditor.fixes))
    for x in auditor.errors[:10]:
        print('  error:', x.code, x.message)
    for x in auditor.fixes[:10]:
        print('  fix:', x.code, x.message)
    sys.exit(1)

auditor = doc.audit()
print('audit: errors', len(auditor.errors), 'fixes', len(auditor.fixes))
for x in auditor.errors[:20]:
    print('  error:', x.code, x.message)
for x in auditor.fixes[:20]:
    print('  fix:', x.code, x.message)

msp = doc.modelspace()
counts = collections.Counter(e.dxftype() for e in msp)
print('entities:', dict(counts), 'total', sum(counts.values()))
print('layers:', len(list(doc.layers)), 'linetypes:', len(list(doc.linetypes)), 'styles:', [s.dxf.name for s in doc.styles])
missing = [l for l in {e.dxf.layer for e in msp} if l not in [x.dxf.name for x in doc.layers]]
print('entities with missing layer:', missing)
print('extents:', doc.header.get('$EXTMIN'), doc.header.get('$EXTMAX'))
for e in msp.query('TEXT')[0:3]:
    print('  text sample:', repr(e.dxf.text), 'h', e.dxf.height, 'rot', e.dxf.rotation, 'align', e.dxf.halign, e.dxf.valign)
# geometry sanity: every vertex finite, polylines have vertices, texts have content
bad = 0
for e in msp:
    if e.dxftype() in ('LINE', 'TEXT', 'CIRCLE', 'ARC', 'SOLID'):
        if not all(abs(v) < 1e6 for v in tuple(e.dxf.start) + tuple(e.dxf.end)) if e.dxftype() == 'LINE' else False:
            bad += 1
    if e.dxftype() == 'POLYLINE' and len(e.vertices) < 2:
        bad += 1
    if e.dxftype() == 'TEXT' and not e.dxf.text:
        bad += 1
print('geometry sanity:', 'ok' if not bad else f'{bad} bad')
print('text heights range:', min(e.dxf.height for e in msp.query('TEXT')) if msp.query('TEXT') else None, max(e.dxf.height for e in msp.query('TEXT')) if msp.query('TEXT') else None)
print('distinct colours:', sorted({e.dxf.color for e in msp}))

# 2. render with ezdxf's built-in SVG backend for a visual sanity check
try:
    from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
    out = path.replace('.dxf', '-ezdxf.svg')
    ctx = RenderContext(doc)
    backend = svg.SVGBackend()
    Frontend(ctx, backend).draw_layout(msp, finalize=True)
    page = layout.Page(1189, 841, layout.Units.mm, margins=layout.Margins.all(10))
    s = backend.get_string(page)
    with open(out, 'w') as f:
        f.write(s)
    print('rendered:', out, len(s), 'bytes')
except Exception as e:
    print('render skipped:', type(e).__name__, e)
