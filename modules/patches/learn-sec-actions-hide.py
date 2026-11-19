"""🙈 Students no longer see the row under each Learn section — ✓ Mark as read / ↺ Mark as unread, 🧠 Practice questions and
🎞️ Show as slide (user, 2026-11-19: "Also hide these from students only"). Teachers and the Admin keep it. A section still
counts as read when the student opens it (the app marks it automatically). An observer removes `.sec-actions` for a student
session (`NEO_BOOT.role === 'student'`); the app code is not edited. Inserted just before the learn-print-hide block.
Idempotent."""
import sys
HEAD_LPH = '/* ---------- 🙈 No Present / Print / Print Entire Chapter for students (patch learn-print-hide) ---------- */'
R = [
(HEAD_LPH,
 r"""/* ---------- 🙈 No section action row for students (patch learn-sec-actions-hide) ---------- */
(function () {
  let queued = false;
  function sweep() {
    queued = false;
    if ((window.NEO_BOOT || {}).role !== 'student') return;
    document.querySelectorAll('.sec-actions').forEach(r => r.remove());
  }
  new MutationObserver(() => { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(sweep); } })
    .observe(document.documentElement, { childList: true, subtree: true });
})();

""" + HEAD_LPH),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
