"""🔬 Assessments keep the picture links of image-based questions (user 2026-11-10). A topic quiz showed "Open the WebPath
blood smear …" with no link: the assessment copy of a question (SNAPSHOT_FIELDS) left out `links`. Now new copies keep
them, and quizzes published before this (copies without `links`) take the links of the module's own question when its
wording is unchanged. In a quiz the links are named neutrally ("Open image 1 (WebPath)") — their titles name the answer.
No server change. Idempotent."""
import sys
R = [
("""'explanation', 'ref', 'images', 'imported', 'importBatch', 'sourceRef'];""",
 """'explanation', 'ref', 'images', 'imported', 'importBatch', 'sourceRef', 'links'];   // links: picture links (patch quiz-image-links)"""),
("""  if (q.links && q.links.length) card.appendChild(el('div', { class: 'q-links' }, q.links.map(l => el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, (l.kind === 'gross' ? '🫀 ' : '🔬 ') + 'Open image: ' + l.title + ' (' + (l.source || 'WebPath') + ') ↗'))));""",
 """  // picture links; an assessment copy made before they were kept takes them from the module's question if unchanged (patch quiz-image-links)
  const qLinks = q.links || (q.links === undefined && typeof Q_BY_ID !== 'undefined' && Q_BY_ID[q.id] && Q_BY_ID[q.id].stem === q.stem ? Q_BY_ID[q.id].links : null);
  if (qLinks && qLinks.length) card.appendChild(el('div', { class: 'q-links' }, qLinks.map((l, i) => el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, (l.kind === 'gross' ? '🫀 ' : '🔬 ') + (quizMode ? 'Open image' + (qLinks.length > 1 ? ' ' + (i + 1) : '') + (l.kind === 'gross' ? ' (gross)' : '') + ' — ' + (l.source || 'WebPath') : 'Open image: ' + l.title + ' (' + (l.source || 'WebPath') + ')') + ' ↗'))));"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
