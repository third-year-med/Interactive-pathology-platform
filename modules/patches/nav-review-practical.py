"""Main menu = Learn · Review · Practical (user, 2026-10-29). "Practise" becomes REVIEW: 1 · Questions and clinical cases
(the cases move here from Apply, with Cases by unit), 2 · Other ways to revise (guided session, recall, sequencing,
concept maps, comparisons, spaced review), 3 · Before the exam: ⚡ Last-Minute Review (no longer a separate menu button —
its pages show under Review). "Apply" becomes PRACTICAL: practical cases, How to answer a practical, 🔬 Pathology Spotter,
📝 OSPE exam and the Image atlas (+ Image Bank when it has items). My Progress, Assessment, Live and Attendance are
unchanged. Internal ids, routes (#/practise, #/apply, #/review, #/cases …) and saved data are unchanged; the two hub pages
are new renderers assigned after the old ones (no text of earlier patches is edited). Idempotent."""
import sys
R = [
("""  { id: 'practise', label: 'Practise', icon: '🧠' },     // Stage 2 hub
  { id: 'apply', label: 'Apply', icon: '🩺' },           // Stage 2 hub""",
 """  { id: 'practise', label: 'Review', icon: '🧠' },       // Stage 2 hub (menu "Review": questions, cases, revision tools — patch nav-review-practical)
  { id: 'apply', label: 'Practical', icon: '🩺' },       // Stage 2 hub (menu "Practical": cases, Spotter, OSPE)"""),
("""  { id: 'practise', label: 'Practise', short: 'Practise', hint: 'Recall, sequencing, comparisons and questions',
    items: [['Guided session', '▶', 'study', ['today']], ['Recall', '↻', 'study', ['recall']], ['Sequencing', '⇅', 'study', ['sequence']], ['Concept maps', '◎', 'study', ['connect']], ['Comparisons', '⇄', 'study', ['compare']], ['Questions', '?', 'revision', []], ['Spaced review', '◔', 'study', ['review']]] },
  { id: 'apply', label: 'Apply', short: 'Apply', hint: 'Practical pathology and clinical cases',
    items: [['Practical pathology', '◉', 'practical', []], ['Pathology Spotter', '◆', 'study', ['challenge']], ['Clinical cases', '✚', 'cases', []]] },""",
 """  { id: 'practise', label: 'Review', short: 'Review', hint: 'Questions, clinical cases, other ways to revise and the Last-Minute Review',
    items: [['Questions', '?', 'revision', []], ['Clinical cases', '✚', 'cases', []], ['Guided session', '▶', 'study', ['today']], ['Recall', '↻', 'study', ['recall']], ['Sequencing', '⇅', 'study', ['sequence']], ['Concept maps', '◎', 'study', ['connect']], ['Comparisons', '⇄', 'study', ['compare']], ['Spaced review', '◔', 'study', ['review']], ['Last-Minute Review', '⚡', 'review', []]] },
  { id: 'apply', label: 'Practical', short: 'Practical', hint: 'Practical cases, Pathology Spotter, OSPE exam and the image atlas',
    items: [['Practical cases', '◉', 'practical', []], ['Pathology Spotter', '◆', 'study', ['challenge']], ['OSPE exam', '📝', 'practical', ['ospe']], ['Image atlas', '▦', 'practical', ['atlas']]] },"""),
("""  { id: 'review', label: 'Last-Minute Review', short: 'Review',""",
 """  { id: 'review', hidden: true, label: 'Last-Minute Review', short: 'Review',   // shown inside Review (no own menu button)"""),
("""  UX_AREAS.forEach(a => nav.appendChild(""",
 """  UX_AREAS.filter(a => !a.hidden).forEach(a => nav.appendChild("""),
("""  if (view === 'apply' || view === 'practical' || view === 'cases') return 'apply';""",
 """  if (view === 'apply' || view === 'practical') return 'apply';
  if (view === 'cases') return 'practise';   // clinical cases belong to Review"""),
("""  if (view === 'review') return 'review';""",
 """  if (view === 'review') return 'practise';   // the Last-Minute Review lives in Review"""),
("""  if (view === 'review') return (params || [])[0] === ip[0];
  if (view !== 'study') return true;""",
 """  if (view === 'review') return !ip.length || (params || [])[0] === ip[0];
  if (view === 'practical') { const p0 = (params || [])[0]; return ip.length ? p0 === ip[0] : !['ospe', 'atlas'].includes(p0); }
  if (view !== 'study') return true;"""),
("""'After a topic, you can practise it in ', el('a', { href: '#/practise' }, 'Practise'), ' or use it in ', el('a', { href: '#/apply' }, 'Apply'), '. These are optional — the pathway is the main route.'""",
 """'After a topic, you can revise it in ', el('a', { href: '#/practise' }, 'Review'), ' and practise its specimens in ', el('a', { href: '#/apply' }, 'Practical'), '. These are optional — the pathway is the main route.'"""),
("""Views.progress = {""",
 """/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */
function uxPracticalTopic() { return getTopics().find(t => /practical/i.test(t.title || '')) || null; }
Views.practise.render = function () {
  const v = clear(document.getElementById('view-practise'));
  const page = el('div', { class: 'page ux-page' }); v.appendChild(page);
  const a = StudyEngine.analytics(); const cur = StudyEngine.session(); const t = StudyEngine.today();
  const cr = Store.get('cases_v1', {}) || {}; const tried = CASES.filter(c => cr[c.id]).length;
  page.appendChild(uxPageHead('practise', 'Review', 'Check and strengthen what you have learned: questions, clinical cases and other ways to revise — and the Last-Minute Review before the exam.'));
  if (cur && !cur.done) page.appendChild(uxRecommend('Continue your guided session', 'Step ' + Math.min(cur.i + 1, cur.steps.length) + ' of ' + cur.steps.length, 'Continue', () => Router.go('study', ['session'])));
  else page.appendChild(uxRecommend('Start a guided session', 'About ' + t.minutes + ' minutes · mixes what is due, your mistakes and topics you have read', 'Start', () => Router.go('study', ['today'])));
  page.appendChild(el('h2', { class: 'ux-h2' }, '1 · Questions and clinical cases'));
  page.appendChild(uxList([
    { g: '?', title: 'Questions', sub: 'Check your understanding. Every answer is explained.', href: '#/revision' },
    { g: '✚', title: 'Clinical cases', sub: 'Reason through a case one step at a time: trigger, mechanism, tissue change, outcome.', href: '#/cases', meta: CASES.length ? tried + ' of ' + CASES.length + ' done' : '' }
  ]));
  if (CASES.length && typeof UX_UNITS !== 'undefined') {
    const box = el('details', { class: 'ux-about' }, el('summary', null, 'Clinical cases by unit'));
    UX_UNITS.forEach(u => {
      const cs = CASES.filter(c => uxCaseUnit(c) === u); if (!cs.length) return;
      box.appendChild(el('div', { class: 'ux-cases' }, el('b', null, 'Unit ' + u.n + ' · ' + u.title),
        el('div', { class: 'ux-case-list' }, cs.map(c => el('a', { class: 'ux-case' + (cr[c.id] ? ' done' : ''), href: uxHref('cases', [c.id]) }, (cr[c.id] ? '✓ ' : '') + c.title)))));
    });
    const other = CASES.filter(c => !uxCaseUnit(c) || uxCaseUnit(c) === UX_FINALE);
    if (other.length) box.appendChild(el('div', { class: 'ux-cases' }, el('b', null, UX_FINALE.title), el('div', { class: 'ux-case-list' }, other.map(c => el('a', { class: 'ux-case' + (cr[c.id] ? ' done' : ''), href: uxHref('cases', [c.id]) }, (cr[c.id] ? '✓ ' : '') + c.title)))));
    page.appendChild(box);
  }
  page.appendChild(el('h2', { class: 'ux-h2 mt1' }, '2 · Other ways to revise'));
  page.appendChild(uxList([
    { g: '↻', title: 'Recall', sub: 'Answer from memory, then check. Includes Blurting: explain a topic in your own words.', href: '#/study/recall', meta: a.dueR.length ? a.dueR.length + ' due' : '' },
    { g: '⇅', title: 'Sequencing', sub: 'Put the steps of a process in order.', href: '#/study/sequence' },
    { g: '◎', title: 'Concept maps', sub: 'See how the ideas of a topic connect, then complete the map.', href: '#/study/connect' },
    { g: '⇄', title: 'Comparisons', sub: 'Tell look-alikes apart, such as apoptosis and necrosis.', href: '#/study/compare' },
    { g: '◔', title: 'Spaced review', sub: 'Questions that come back just before you would forget them.', href: '#/study/review', meta: a.dueQ.length ? a.dueQ.length + ' due' : '' }
  ]));
  page.appendChild(el('h2', { class: 'ux-h2 mt1' }, '3 · Before the exam'));
  page.appendChild(uxList([{ g: '⚡', title: 'Last-Minute Review', sub: 'High-yield facts, comparisons, morphology, exam traps and a 15-minute review.', href: '#/review' }]));
  page.appendChild(el('details', { class: 'ux-about' }, el('summary', null, 'Revise one topic'),
    el('div', { class: 'row mt1' }, uxTopicPicker('Questions on a topic', tid => Router.go('revision', ['topic', tid])), uxTopicPicker('Recall on a topic', tid => UXP.recall(tid)))));
};
Views.apply.render = function () {
  const v = clear(document.getElementById('view-apply'));
  const page = el('div', { class: 'page ux-page' }); v.appendChild(page);
  let ch = 0; try { ch = StudyEngine.challengeItems().length; } catch (e) { ch = 0; }
  let spq = 0; try { spq = typeof Spotter !== 'undefined' && Spotter.ready().length >= SPOTTER_MIN ? Spotter.ready().length : 0; } catch (e) { spq = 0; }
  let os = 0; try { os = typeof PracOspe !== 'undefined' && PracOspe.ready().length >= OSPE_MIN ? PracOspe.ready().length : 0; } catch (e) { os = 0; }
  const pt = uxPracticalTopic(), pubs = (typeof PracData !== 'undefined' ? PracData.published() : []).length;
  page.appendChild(uxPageHead('apply', 'Practical', 'Specimens and slides as in the practical exam: the practical cases, the Pathology Spotter and the OSPE exam.'));
  page.appendChild(el('h2', { class: 'ux-h2' }, '1 · Practical cases'));
  page.appendChild(uxList([
    { g: '◉', title: 'Practical cases', sub: 'Specimens and slides: what you see, the pattern, the diagnosis and why — with questions and a printable handout.', href: '#/practical', meta: pubs ? plural(pubs, 'case') : '' },
    pt ? { g: '≡', title: 'How to answer a practical', sub: 'Topic ' + topicNum(pt.id) + ': the practical specimens, one by one.', href: uxHref('explain', [pt.id]) } : null
  ]));
  page.appendChild(el('h2', { class: 'ux-h2 mt1' }, '2 · Test yourself and exams'));
  page.appendChild(uxList([
    { g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology — practice or a 20-picture exam.', href: '#/study/challenge', meta: spq ? plural(spq, 'question') : ch ? plural(ch, 'image') : '' },
    { g: '📝', title: 'OSPE exam', sub: 'Timed practical stations: pictures, a clinical scenario and short-answer questions with marks.', href: '#/practical/ospe', meta: os ? plural(os, 'station') : '' }
  ]));
  page.appendChild(el('h2', { class: 'ux-h2 mt1' }, '3 · Pictures'));
  page.appendChild(uxList([
    { g: '▦', title: 'Image atlas', sub: 'Real gross and microscopic pictures of this module, each linked to the topic that teaches it.', href: '#/practical/atlas' },
    Auth.isTeacher() || (State.practical || []).length ? { g: '🖼', title: 'Image Bank', sub: 'Pictures selected by your teacher: study them, then reveal the diagnosis.', href: '#/practical/bank' } : null
  ]));
};
if (typeof pracGuideCard === 'function') {   // the practical guide speaks of the new menu names
  const guide0 = pracGuideCard;
  pracGuideCard = function (where) {
    const n = guide0(where); const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t;
    while ((t = w.nextNode())) t.nodeValue = t.nodeValue.replace('the knowledge; Apply → Practical trains', 'the knowledge; the Practical section trains').replace(/Apply → Practical/g, 'Practical → Practical cases');
    return n;
  };
}
Views.progress = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
