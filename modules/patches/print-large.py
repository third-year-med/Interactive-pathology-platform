"""Printed pages (🖨 Print topic / Print Entire Chapter / every printHTML page) easier to read: narrow margins (about
1 cm instead of 1.6 / 1.4 cm), the text uses the full page width, and all print text is about 17 % larger (html font size
18.7 px instead of the browser's 16 px — every rem size scales with it: body ≈ 13.3 pt, tables ≈ 12 pt, captions ≈ 11 pt).
Screen pages unchanged. Idempotent."""
import sys
R = [
("""      @page { size: A4; margin: 16mm 14mm; }
""",
"""      @page { size: A4; margin: 10mm 9mm 12mm; }
      html { font-size: 18.7px; }
"""),
("""      body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.5; max-width: 800px; margin: 0 auto; padding: 1.2rem; }
""",
"""      body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.5; max-width: 800px; margin: 0 auto; padding: 1.2rem; }
      @media print { body { max-width: none; padding: 0; } }
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
