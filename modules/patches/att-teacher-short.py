"""Module 📋 Attendance tab for a TEACHER (class server): the short teacher version instead of the student code box —
"▶ Start attendance for a new teaching session", the live session panel (QR, link, code, close) while one runs, and the
report of the session just closed; history and settings stay in Teacher Portal → Attendance (one click). Idempotent."""
import sys
R = [
("""      if (this.checkinToken) this.renderCheckin(page); else this.renderCodeEntry(page);""",
"""      if (this.checkinToken) this.renderCheckin(page);
      else if (Auth.isTeacher() && Backend.isConfigured()) this.renderTeacherShort(page);   // teacher: start / run a session right here
      else this.renderCodeEntry(page);"""),
("""  /* ---------------- Student check-in ---------------- */""",
"""  /** The Attendance tab for a teacher: start a session, run it (QR / code / close), see the report — the short version of
   *  Teacher Portal → Attendance (history and settings stay there). */
  renderTeacherShort(page) {
    const box = el('div', { class: 'page', style: 'max-width:980px;margin:0 auto' }); page.appendChild(box);
    this.page = box;
    if (AttT.sessionId && Backend.isAuthed() && !AttT.timer) AttT.startPolling();
    const toPortal = el('button', { class: 'btn btn-sm', onclick: () => Router.go('teacher', ['attendance']) }, '⚙ History, reports & settings');
    if (AttT.active()) { this.renderTeacherSession(box); box.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end' }, toPortal)); return; }
    box.appendChild(this.startCard());
    if (this.report) box.appendChild(this.reportCard(this.report.session, this.report.records, true));
    box.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end' }, el('span', { class: 'small muted' }, 'Earlier sessions, reports and settings:'), toPortal));
  },

  /* ---------------- Student check-in ---------------- */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
