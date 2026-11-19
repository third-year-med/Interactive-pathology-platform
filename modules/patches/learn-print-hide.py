"""🙈 Students no longer see the topic header's 🎞️ Present and 🖨 Print buttons or 🖨️ Print Entire Chapter (topic header and
Course Overview) (user, 2026-11-19: "the students were complaining of too many PDF pages"). Teachers and the Admin keep them.
A small observer removes those buttons from `.topic-hero` / the overview hero when the session is a student's
(`NEO_BOOT.role === 'student'`); 📄 Print Condensed Handout, ⛶ Full screen and the rest stay. The app code's button lines are
NOT changed (patch learn-fs anchors on them). Inserted just before the present-large block. Idempotent."""
import sys
HEAD_PL = '/* ---------- 🔠 Larger text in the Practical and Viva presentations (patch present-large) ---------- */'
R = [
(HEAD_PL,
 r"""/* ---------- 🙈 No Present / Print / Print Entire Chapter for students (patch learn-print-hide) ---------- */
(function () {
  const OFF = { '🎞️ Present': 1, '🖨 Print': 1 };
  let queued = false;
  function sweep() {
    queued = false;
    if ((window.NEO_BOOT || {}).role !== 'student') return;
    document.querySelectorAll('.hero-meta .print-chapter-btn').forEach(b => b.remove());
    document.querySelectorAll('.topic-hero .hero-meta > button').forEach(b => { if (OFF[b.textContent.trim()]) b.remove(); });
  }
  new MutationObserver(() => { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(sweep); } })
    .observe(document.documentElement, { childList: true, subtree: true });
})();

""" + HEAD_PL),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
