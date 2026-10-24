"""F key for ⛶ Full-screen reading in Learn (user, 2026-10-24): on a topic page, pressing F turns full-screen reading on,
F or Esc turns it off — like F in Presentation mode. Ignored while typing (inputs, text areas, editable text), with
Ctrl / Alt / ⌘, and while a dialog or the picture viewer is open. Needs learn-fs. Idempotent."""
import sys
R = [
("""/** ⛶ Full-screen reading (2026-10-22): body.learn-fs hides everything but the topic; a small bar gives A− / A+ / ✕. */
const LearnFS = {""",
 """/* F = ⛶ Full-screen reading on a Learn topic page (2026-10-24), as F does in Presentation mode. (Kept apart from the
   learn-fs text so that patch stays idempotent; LearnFS is defined just below.) */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || Router.current !== 'explain') return;
  const t = e.target; if (t && t.closest && t.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')) return;
  if (document.querySelector('.modal-back,.lightbox')) return;
  if (!LearnFS.on && !document.querySelector('#view-explain [data-a="learn-fs"]')) return;   // only where the ⛶ button is
  e.preventDefault();
  if (!LearnFS.on) LearnFS.native = !!document.fullscreenElement;   // a late fullscreenchange from the last exit must not end the new one
  LearnFS.toggle();
});
/** ⛶ Full-screen reading (2026-10-22): body.learn-fs hides everything but the topic; a small bar gives A− / A+ / ✕. */
const LearnFS = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
