"""Printed pages mirror the screen. Idempotent.
The print document (🖨 Print topic, Print Entire Chapter, study sheets, Last-Minute Review) now carries the module's own
screen stylesheet, so callouts, key points, tables, flowcharts, figures and pictures look as they do on screen (colours
printed). A short print layer after it keeps paper rules: white page, ≈ 13 pt text, interactive controls hidden, added
pictures one per row fitted to the page, atlas pictures two per row, nothing split across pages."""
import sys
R = [
("""  const doc = auto => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
""",
"""  // print-mirror: the page's own screen stylesheet, then a short paper layer (see PRINT_MIRROR_CSS)
  const appCss = Array.prototype.map.call(document.querySelectorAll('style'), x => x.textContent).join('\\n').replace(/<\\/style/gi, '<\\\\/style');
  const doc = auto => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
"""),
("""      footer.print-foot { margin-top: 2rem; padding-top: .6rem; border-top: 1px solid #ccc; font-family: Arial, Helvetica, sans-serif; font-size: .72rem; color: #888; }
    </style></head><body>""",
"""      footer.print-foot { margin-top: 2rem; padding-top: .6rem; border-top: 1px solid #ccc; font-family: Arial, Helvetica, sans-serif; font-size: .72rem; color: #888; }
    </style><style>${appCss}</style><style>${PRINT_MIRROR_CSS}${o.css || ''}</style></head><body>"""),
("""function printHTML(title, subtitle, bodyHtml, opts) {
""",
"""/* print-mirror: paper rules applied AFTER the screen stylesheet in every printed page */
const PRINT_MIRROR_CSS = `
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { font-size: 17px; }
  body { display: block; min-height: 0; background: #fff !important; font-size: 17px; line-height: 1.55; max-width: none; margin: 0 auto; padding: 0; }
  @media screen { body { max-width: 820px; padding: 1.2rem; } }
  .print-body .md p, .print-body li { font-size: 1rem; }
  .print-body h2 { font-size: 1.3rem; margin-top: 1.4rem; break-after: avoid; page-break-after: avoid; }
  .print-body h3, .print-body h4 { break-after: avoid; page-break-after: avoid; }
  .callout, .keypoints, .mustknow-card, .diagram, figure, .fig, table, .table-wrap, .atl-fig, .media-item { break-inside: avoid; page-break-inside: avoid; }
  .card, .callout, .keypoints, .mustknow-card, .diagram, .fstep, .atl-fig, .media-item { box-shadow: none !important; }
  .table-wrap, .table-scroll { overflow: visible !important; max-height: none !important; }
  .flow { zoom: 1 !important; } .fstep, .fphase, .fnote, .farrow { opacity: 1 !important; transform: none !important; }
  .dg-controls, .atl-zoom, .links-card, .atl-linkonly, .atl-cap, .wp-open, .fig-zoom { display: none !important; }
  button.atl-imgbtn { display: block !important; border: 0; background: none !important; padding: 0; margin: 0 auto; width: 100%; cursor: default; aspect-ratio: auto !important; max-height: none !important; overflow: visible !important; }
  .atl-grid { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 4mm !important; }
  .atl-fig { max-width: none !important; }
  .atl-img { width: auto !important; height: auto !important; max-width: 100% !important; max-height: 80mm !important; object-fit: contain !important; transform: none !important; margin: 0 auto; }
  .media-grid { display: block !important; }
  .media-item { display: block; margin: .9rem auto; text-align: center; border: 0 !important; background: none !important; }
  .media-item img { width: auto !important; height: auto !important; max-width: 100% !important; max-height: 175mm !important; object-fit: contain !important; margin: 0 auto; }
  .media-item .cap { text-align: left; }
  img, svg { max-width: 100%; }
`;
function printHTML(title, subtitle, bodyHtml, opts) {
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
