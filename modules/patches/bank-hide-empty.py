"""Image Bank hidden while empty (user, 2026-10-29): the Practical tab's 🖼 Image Bank (the older single-picture tool) is
shown to students only when it has items — Practicals, the Image atlas and the 🔬 Pathology Spotter now do its work. While
it is empty a student sees no Image Bank tab, no Image Bank button or sentence in the 🧭 practical guide, no "Image Bank tab
may have images" hint, and #/practical/bank opens the Practicals list. Teachers always see it (to add items); as soon as it
has an item students see it again. Nothing is deleted. Idempotent."""
import sys
R = [
("""    el('button', { class: 'tab' + (active === 'bank' ? ' active' : ''), onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank'),""",
 """    t || (State.practical || []).length ? el('button', { class: 'tab' + (active === 'bank' ? ' active' : ''), onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank') : null,   // hidden from students while empty"""),
("""    const teacher = Auth.isTeacher();
    page.appendChild(sectionTitleBlock('🖼 Practical — Image Bank',""",
 """    const teacher = Auth.isTeacher();
    if (!teacher && !(State.practical || []).length) { Router.go('practical', [], { replace: true }); return; }   // empty Image Bank: students go to the Practicals
    page.appendChild(sectionTitleBlock('🖼 Practical — Image Bank',"""),
]
OPTIONAL = [   # texts that only some pages have (practical guide; the student hint on an empty Practicals list)
("""then read the explanation. The Image Bank lets you name the pictures freely.'),""",
 """then read the explanation.' + ((State.practical || []).length ? ' The Image Bank lets you name the pictures freely.' : '')),"""),
("""      el('button', { class: 'btn btn-sm', onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank')));""",
 """      (State.practical || []).length || Auth.isTeacher() ? el('button', { class: 'btn btn-sm', onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank') : null));"""),
("""'Your teacher has not published any practicals yet. The Image Bank tab may already have images to study.'""",
 """'Your teacher has not published any practicals yet.' + ((State.practical || []).length ? ' The Image Bank tab may already have images to study.' : '')"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    for a, b in OPTIONAL:
        if b in s or a not in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
