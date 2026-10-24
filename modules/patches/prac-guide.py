"""Practical study guide (user, 2026-10-24): students see how the practical Learn topic and Apply → Practical work
together — before the lab (read the topic, do its quiz), in the lab (the session's practical and its handout), after the
lab (Image Bank), before the exam (both). A folding card with direct links is shown on the practical topic in Learn
(the first topic whose title contains "Practical") and at the top of Apply → Practical → Practicals. The open/closed
state is remembered per browser. Idempotent (done-markers: prac-guide-photo later rewrites the card's wording)."""
import sys
R = [
(""".exam-qs ol{margin:.5rem 0 0;padding-left:1.3rem;color:var(--ink-2)}
""",
 """.exam-qs ol{margin:.5rem 0 0;padding-left:1.3rem;color:var(--ink-2)}
.prac-guide{margin-top:1rem;background:var(--teal-soft);border:1px solid #b8e4de;border-radius:var(--radius);padding:.8rem 1rem}
.prac-guide summary{cursor:pointer;font-weight:700;color:var(--teal-ink)}
.prac-guide p{margin:.5rem 0 0;color:var(--ink-2)}
.prac-guide ol{margin:.5rem 0 0;padding-left:1.3rem;color:var(--ink-2)}
.prac-guide li{margin:.25rem 0}
.prac-guide .row{margin-top:.6rem;flex-wrap:wrap}
""", ".prac-guide{"),
("""    if (t.syllabusQuestions && t.syllabusQuestions.length) {
      main.appendChild(el('details', { class: 'exam-qs' },""",
 """    if (pracGuideTopic() === t) main.appendChild(pracGuideCard('learn'));
    if (t.syllabusQuestions && t.syllabusQuestions.length) {
      main.appendChild(el('details', { class: 'exam-qs' },""", "if (pracGuideTopic() === t)"),
("""function pracTabs(active) {""",
 """/* 🧭 Practical study guide (2026-10-24): how the practical Learn topic and Apply → Practical work together.
   Shown on that topic in Learn ('learn') and on Apply → Practical → Practicals ('practical'). */
function pracGuideTopic() { return getTopics().find(t => /practical/i.test(t.title || '')) || null; }
function pracGuideCard(where) {
  const t = pracGuideTopic(); const inLearn = where === 'learn';
  const tName = t ? '“' + t.title + '”' : 'the practical topic';
  const quiz = t ? el('button', { class: 'btn btn-sm', onclick: () => Router.go('revision', ['topic', t.id]) }, '🧠 Topic quiz') : null;
  const d = el('details', { class: 'prac-guide', 'data-a': 'prac-guide', open: Store.get('prac_guide_open_v1', true) !== false },
    el('summary', null, '🧭 How to use the practical — before, in and after the lab'),
    el('p', null, inLearn ? 'This topic gives you the knowledge; Apply → Practical trains the skill at the bench. Use them together:'
      : 'The practical trains the skill at the bench; ' + tName + ' in Learn gives you the knowledge. Use them together:'),
    el('ol', null,
      el('li', null, el('b', null, 'Before the lab — '), inLearn ? 'read this topic (what to look for, gross and microscopic features, the key clue) and do its quiz.'
        : 'read ' + tName + ' in Learn (what to look for, gross and microscopic features, the key clue) and do its quiz.'),
      el('li', null, el('b', null, 'In the lab — '), 'open your session’s practical in Apply → Practical and use its handout at the microscope.'),
      el('li', null, el('b', null, 'After the lab — '), 'open the Image Bank: name each picture yourself, then reveal the diagnosis.'),
      el('li', null, el('b', null, 'Before the exam — '), (inLearn ? 'revise this topic’s key points' : 'revise the topic’s key points') + ' and test yourself again in the Image Bank.')),
    el('p', { class: 'small muted' }, 'The specimens have the same names and diagnoses in both places.'),
    el('div', { class: 'row' },
      inLearn ? el('button', { class: 'btn btn-sm btn-primary', onclick: () => Router.go('practical') }, '🔬 Open the Practicals')
        : t ? el('button', { class: 'btn btn-sm btn-primary', onclick: () => Router.go('explain', [t.id]) }, '📖 Read the topic in Learn') : null,
      quiz,
      el('button', { class: 'btn btn-sm', onclick: () => Router.go('practical', ['bank']) }, '🖼 Image Bank')));
  d.addEventListener('toggle', () => Store.set('prac_guide_open_v1', d.open));
  return d;
}
function pracTabs(active) {""", "function pracGuideTopic()"),
("""    page.appendChild(pracTabs('list'));
    if (teacher) page.appendChild(PracTeacher.draftsPanel());""",
 """    page.appendChild(pracTabs('list'));
    page.appendChild(pracGuideCard('practical'));
    if (teacher) page.appendChild(PracTeacher.draftsPanel());""", "page.appendChild(pracGuideCard('practical'));"),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b, *done in R:   # done = a marker that stays after a later patch (prac-guide-photo) rewrites the text
        if b in s or (done and done[0] in s): continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
