"""🧹 Clean Practical pages (user, 2026-11-14: "hide this green bar, which has instructions, because I want a clean page … hide
this bar [How to answer a practical]"). Hides the green "🧭 How to use the practical — before, during and after the session"
box (on Practical → Practical cases and in the Learn practical topic) and the "How to answer a practical" link rows of the
Practical / Apply hub pages, and hides the Learn practical topic from STUDENTS (user's choice: Learn list, pathway and topic
quizzes; the teacher still sees it; its pictures keep feeding the Spotter, OSPE and atlas, which look it up among all topics;
nothing is deleted). Applied only to the
modules in PRAC_CLEAN_MODULES (Inflammation (New)); other modules are skipped. Wraps pracGuideCard and uxList. Idempotent."""
import sys, re
PRAC_CLEAN_MODULES = ['inflnew', 'neonew']   # neonew: user, 2026-11-15
R = [
("""/* ==========================================================================
   20_universal_edit.js — UNIVERSAL EDITOR for text, pictures, links and videos""",
 """/* ---------- 🧹 Clean Practical pages (patch prac-clean) ---------- */
(function () {
  if (typeof pracGuideCard === 'function') pracGuideCard = function () { return el('span', { hidden: true, class: 'prac-guide-off' }); };
  if (typeof uxList === 'function') {
    const list0 = uxList;
    uxList = function (rows) { return list0((rows || []).filter(r => !(r && r.title === 'How to answer a practical'))); };
  }
  // the Learn practical topic is not shown to students (Learn list, pathway, topic quizzes); its pictures still feed the
  // Spotter, the OSPE and the atlas, which now look the topic up among ALL topics
  const PRAC_RE = /practical/i, gt0 = getTopics;
  const studentView = () => (window.NEO_BOOT || {}).role === 'student';
  const dropFinale = () => {   // the practical topic leaves the Learn pathway's last unit; the unit goes only when nothing else is in it
    if (typeof UX_ALL_UNITS === 'undefined' || typeof UX_FINALE === 'undefined') return;   // (Neoplasia (New): t13, t14 stay)
    const prac = gt0(true).filter(t => PRAC_RE.test(t.title || '')).map(t => t.id);
    UX_FINALE.topics = (UX_FINALE.topics || []).filter(id => !prac.includes(id));
    const k = UX_ALL_UNITS.indexOf(UX_FINALE); if (k >= 0 && !UX_FINALE.topics.length) UX_ALL_UNITS.splice(k, 1);
  };
  const inViva = () => typeof Router !== 'undefined' && Router.current === 'viva';   // the 🎓 Viva keeps every topic (its practical questions)
  getTopics = function (includeHidden) {
    const l = gt0.apply(this, arguments); if (!studentView() || inViva()) return l;
    dropFinale(); return includeHidden ? l : l.filter(t => !PRAC_RE.test(t.title || ''));
  };
  const pracTopic = () => gt0().find(t => PRAC_RE.test(t.title || '')) || null;
  if (typeof Spotter !== 'undefined') Spotter.topic = pracTopic;
  if (typeof pracGuideTopic === 'function') pracGuideTopic = pracTopic;
  if (typeof uxPracticalTopic === 'function') uxPracticalTopic = pracTopic;
  if (typeof pmPracticalTopic === 'function') pmPracticalTopic = pracTopic;
})();

/* ==========================================================================
   20_universal_edit.js — UNIVERSAL EDITOR for text, pictures, links and videos"""),
]
HEAD = '/* ---------- 🧹 Clean Practical pages (patch prac-clean) ---------- */'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    m = re.search(r'"moduleKey"\s*:\s*"([a-z0-9]+)"', s)
    if not (m and m.group(1) in PRAC_CLEAN_MODULES):
        print(path, 'skipped (prac-clean not enabled for', (m.group(1) if m else '?') + ')'); continue
    for a, b in R:
        i = s.find(HEAD)
        if i >= 0 and b not in s:   # an earlier version of this block: replace it in place
            j = s.find(a, i); assert j > i, 'prac-clean block end not found'
            s = s[:i] + b + s[j + len(a):]; n += 1
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
