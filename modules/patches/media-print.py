"""Pictures added to a Learning section (＋ Picture / 🖼 Import pictures) print cleanly and show uncropped. Idempotent.
- Print / Print Entire Chapter: each picture fits the page width (and at most ~2/3 of the page height), is never split
  across pages, centred, caption + credit underneath (before: printed at full size, cut off at the right edge).
- Learn page: the whole picture is shown (object-fit: contain, natural height up to 420 px) instead of a 180 px crop;
  a wide multi-panel figure (aspect > 1.6) takes a full row of the grid."""
import sys
R = [
(""".media-item img{display:block;width:100%;height:180px;object-fit:cover;cursor:zoom-in;background:#eef2f6}""",
""".media-item img{display:block;width:100%;height:auto;max-height:420px;object-fit:contain;cursor:zoom-in;background:#fff}
.media-item.wide{grid-column:1/-1}"""),
("""    const img = el('img', { src: item.url, alt: item.caption || 'Figure', loading: 'lazy' });
""",
"""    const img = el('img', { src: item.url, alt: item.caption || 'Figure', loading: 'lazy' });
    img.addEventListener('load', () => { const box = img.closest('.media-item'); if (box && img.naturalWidth > 1.6 * img.naturalHeight) box.classList.add('wide'); }); // wide figure: full row
"""),
("""      figcaption { font-size: .78rem; color: #555; margin-top: .3rem; }
""",
"""      figcaption { font-size: .78rem; color: #555; margin-top: .3rem; }
      /* pictures added to a section: whole, centred, fitted to the page, never split; caption underneath */
      .media-grid { display: block; margin: .4rem 0; }
      .media-item { display: block; margin: .9rem auto; text-align: center; page-break-inside: avoid; break-inside: avoid; }
      .media-item img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: 175mm; object-fit: contain; }
      .media-item .cap { font-size: .78rem; color: #444; margin-top: .3rem; text-align: left; }
      .media-item .cred { font-size: .7rem; color: #777; }
      .media-video-wrap { display: none; }
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
