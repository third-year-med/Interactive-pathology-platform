"""Module header for a signed-in student: no "Class server" chip (shown only when offline / syncing, not clickable)
and no "Teacher" sign-in link — both led to teacher pages. Teachers and unsigned copies unchanged. Idempotent."""
import sys
R = [
("""  const pend = Backend.pending().length;
  if (Backend.isConfigured()) {
    const on = Backend.online;
    box.appendChild(el('span', {""",
"""  const pend = Backend.pending().length;
  // a signed-in student (platform account) never needs the teacher pages: no Teacher link, no server-settings chip
  const stuOnly = !!(window.NEO_BOOT && window.NEO_BOOT.role === 'student' && window.NEO_BOOT.student && !Auth.isTeacher());
  if (stuOnly) {
    if (Backend.isConfigured() && (!Backend.online || pend)) box.appendChild(el('span', { class: 'status-chip warn', title: Backend.online ? 'Saving your work to the class server' : 'Class server unreachable — your work is kept on this device and sent when you are back online' },
      el('span', { class: 'dot' }), el('span', { class: 'lbl' }, Backend.online ? 'Syncing (' + pend + ')' : 'Offline')));
  } else if (Backend.isConfigured()) {
    const on = Backend.online;
    box.appendChild(el('span', {"""),
("""  if (typeof uxTeacherLink === 'function') box.appendChild(uxTeacherLink()); // Stage 3""",
"""  if (typeof uxTeacherLink === 'function' && !stuOnly) box.appendChild(uxTeacherLink()); // Stage 3"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
