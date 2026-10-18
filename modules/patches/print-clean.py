"""Printed pages show only what is useful on paper. Idempotent.
- Picture LINKS (WebPath / atlas "Open image ↗" cards and link-only entries) are left out: no picture can appear for
  them on paper, only their titles, "what to look for" lists and credits took space.
- The embedded atlas pictures ("🔬 Real specimens — … from PEIR / Libre Pathology") now really print: they sat inside
  the zoom button, and every button is hidden in print, so only their long captions came out. Now: two per row, each
  whole and never split, the full-size file instead of the 250-px thumbnail, with type, diagnosis and credit (the long
  caption paragraph is left out).
- Step-through flowcharts are never split and print without their step-through buttons; the
  screen-only hint "Click to zoom." is left out of figure captions."""
import sys
R = [
("""  bodyHtml = String(bodyHtml || '').replace(/\\sloading="lazy"/g, '');
""",
"""  bodyHtml = String(bodyHtml || '').replace(/\\sloading="lazy"/g, '');
  // print-clean: atlas pictures print from the full-size file, not the small screen thumbnail
  bodyHtml = bodyHtml.replace(/(src="https:\\/\\/peir\\.path\\.uab\\.edu\\/images)\\/thumb\\/([^"]+?)\\/\\d+px-[^"\\/]+"/g, '$1/$2"')
    .replace(/(src="https:\\/\\/upload\\.wikimedia\\.org\\/[^"]*?\\/thumb\\/[^"]+?\\/)\\d+px-/g, '$11280px-')
    .replace(/\\s*Click to zoom\\./g, '');   // screen-only hint in figure captions
"""),
("""      details > summary { font-weight: 700; margin-bottom: .2rem; }
""",
"""      details > summary { font-weight: 700; margin-bottom: .2rem; }
      /* print-clean: links to pictures elsewhere have nothing to show on paper; atlas pictures print, two per row */
      .links-card, .atl-linkonly, .atl-zoom, .atl-cap { display: none !important; }
      .atl-block { margin: .8rem 0; }
      .atl-block h4 { margin: 0 0 .35rem; }
      .atl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
      .atl-fig { margin: 0; text-align: center; break-inside: avoid; page-break-inside: avoid; }
      button.atl-imgbtn { display: block !important; border: 0; background: none; padding: 0; margin: 0 auto; width: 100%; }
      .atl-img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: 80mm; object-fit: contain; }
      .atl-fig figcaption { font-size: .75rem; color: #444; margin-top: .2rem; }
      .atl-badges { font-size: .68rem; color: #666; } .atl-credit { font-size: .66rem; color: #777; }
"""),
("""      .atl-badges { font-size: .68rem; color: #666; } .atl-credit { font-size: .66rem; color: #777; }
""",
"""      .atl-badges { font-size: .68rem; color: #666; } .atl-credit { font-size: .66rem; color: #777; }
      .dg-controls { display: none !important; } .diagram { page-break-inside: avoid; break-inside: avoid; }
"""),
("""    .replace(/(src="https:\\/\\/upload\\.wikimedia\\.org\\/[^"]*?\\/thumb\\/[^"]+?\\/)\\d+px-/g, '$11280px-');
""",
"""    .replace(/(src="https:\\/\\/upload\\.wikimedia\\.org\\/[^"]*?\\/thumb\\/[^"]+?\\/)\\d+px-/g, '$11280px-')
    .replace(/\\s*Click to zoom\\./g, '');   // screen-only hint in figure captions
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
