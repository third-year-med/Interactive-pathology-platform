"""Apply page and practical guide after the Pathology Spotter (user, 2026-10-29): Apply groups the PRACTICAL activities
together — Practical pathology, 🔬 Pathology Spotter, How to answer a practical — and keeps CLINICAL CASES separate in their
own section (with the "Try a case" suggestion and Cases by unit). The Apply sub-navigation follows the same order
(Practical pathology · Pathology Spotter · Clinical cases). The Spotter shows its number of ready questions. The
"🧭 How to use the practical" guide (patch prac-guide) now uses the Spotter after the session (Practice mode) and before the
exam (Exam mode), with a 🔬 Pathology Spotter button. Modules without the guide (no practical topic) get only the Apply
changes. Idempotent."""
import sys
R = [
("""    if (next) page.appendChild(uxRecommend('Try a case: ' + next.title, 'Each step reveals the next part of the story — trigger, mechanism, tissue change, outcome.', 'Try a case', () => Router.go('cases', [next.id])));
    page.appendChild(el('h2', { class: 'ux-h2' }, 'Or choose an activity'));
    page.appendChild(uxList([
      { g: '◉', title: 'Practical pathology', sub: 'Specimens and slides: what you see, the pattern, the diagnosis and why.', href: '#/practical' },
      { g: '✚', title: 'Clinical cases', sub: 'Reason through a case one step at a time.', href: '#/cases', meta: tried + ' of ' + CASES.length + ' done' },
      { g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology.', href: '#/study/challenge', meta: ch ? plural(ch, 'image') : '' },
""",
 """    let spq = 0; try { spq = typeof Spotter !== 'undefined' && Spotter.ready().length >= SPOTTER_MIN ? Spotter.ready().length : 0; } catch (e) { spq = 0; }
    page.appendChild(el('h2', { class: 'ux-h2' }, '🔬 Practical: specimens, slides and Spotter'));
    page.appendChild(el('p', { class: 'small muted' }, 'Specimens and slides: learn them in the practical, then test yourself in the Spotter.'));
    page.appendChild(uxList([
      { g: '◉', title: 'Practical pathology', sub: 'Specimens and slides: what you see, the pattern, the diagnosis and why.', href: '#/practical' },
      { g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology — practice or a 20-picture exam.', href: '#/study/challenge', meta: spq ? plural(spq, 'question') : ch ? plural(ch, 'image') : '' },
"""),
("""    ]));
    const box = el('details', { class: 'ux-about' }, el('summary', null, 'Cases by unit'));""",
 """    ]));
    page.appendChild(el('h2', { class: 'ux-h2 mt1' }, '✚ Clinical reasoning'));
    if (next) page.appendChild(uxRecommend('Try a case: ' + next.title, 'Each step reveals the next part of the story — trigger, mechanism, tissue change, outcome.', 'Try a case', () => Router.go('cases', [next.id])));
    page.appendChild(uxList([{ g: '✚', title: 'Clinical cases', sub: 'Reason through a case one step at a time.', href: '#/cases', meta: tried + ' of ' + CASES.length + ' done' }]));
    const box = el('details', { class: 'ux-about' }, el('summary', null, 'Cases by unit'));"""),
("""items: [['Practical pathology', '◉', 'practical', []], ['Clinical cases', '✚', 'cases', []], ['Pathology Spotter', '◆', 'study', ['challenge']]] }""",
 """items: [['Practical pathology', '◉', 'practical', []], ['Pathology Spotter', '◆', 'study', ['challenge']], ['Clinical cases', '✚', 'cases', []]] }"""),
]
GUIDE = [   # only where the practical guide exists (patch prac-guide)
("""      el('li', null, el('b', null, 'After the session — '), 'open the Image Bank: name each picture yourself, then reveal the diagnosis.'),
      el('li', null, el('b', null, 'Before the exam — '), (inLearn ? 'revise this topic’s key points' : 'revise the topic’s key points') + ' and test yourself again in the Image Bank.')),""",
 """      el('li', null, el('b', null, 'After the session — '), 'practise in the 🔬 Pathology Spotter (Practice mode): look at each picture, choose the best answer, then read the explanation. The Image Bank lets you name the pictures freely.'),
      el('li', null, el('b', null, 'Before the exam — '), 'take a Spotter exam (Exam mode: 20 pictures, score and review at the end), then ' + (inLearn ? 'revise this topic’s key points' : 'revise the topic’s key points') + ' for the questions you missed.')),"""),
("""      quiz,
      el('button', { class: 'btn btn-sm', onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank')));""",
 """      el('button', { class: 'btn btn-sm', 'data-a': 'prac-guide-spotter', onclick: () => Router.go('study', ['challenge']) }, '🔬 Pathology Spotter'),
      quiz,
      el('button', { class: 'btn btn-sm', onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank')));"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    if 'function pracGuideCard(' in s:
        for a, b in GUIDE:
            if b in s: continue
            assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
