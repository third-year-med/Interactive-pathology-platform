"""A course figure may carry its own credit line (figures[id].credit), e.g. a figure taken from the course syllabus.
Without it nothing changes ("Original schematic drawn for this platform…"). Learn, lightbox and Presentation Images
slides use it. Idempotent."""
import sys
R = [
("""  const open = () => openLightbox({ svg: figureSvg(id), caption: f.title + ' — ' + f.caption, credit: 'Original schematic illustration drawn for this platform from the syllabus text.' });""",
"""  const open = () => openLightbox({ svg: figureSvg(id), caption: f.title + ' — ' + f.caption, credit: f.credit || 'Original schematic illustration drawn for this platform from the syllabus text.' });"""),
("""      el('span', { class: 'fig-credit' }, '🎨 Original schematic drawn for this platform from the syllabus text — not a reproduction of any textbook figure. Click to zoom.')));""",
"""      el('span', { class: 'fig-credit' }, f.credit ? '📄 ' + f.credit + ' Click to zoom.' : '🎨 Original schematic drawn for this platform from the syllabus text — not a reproduction of any textbook figure. Click to zoom.')));"""),
("""    cap = o.f.title; meta = 'Schematic'; credit = el('span', null, 'Original schematic (course illustration)');
    lb = () => openLightbox({ svg: figureSvg(o.id), caption: o.f.title + ' — ' + o.f.caption, credit: 'Original schematic illustration drawn for this platform from the syllabus text.' });""",
"""    cap = o.f.title; meta = o.f.credit ? 'Figure' : 'Schematic'; credit = el('span', null, o.f.credit || 'Original schematic (course illustration)');
    lb = () => openLightbox({ svg: figureSvg(o.id), caption: o.f.title + ' — ' + o.f.caption, credit: o.f.credit || 'Original schematic illustration drawn for this platform from the syllabus text.' });"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
