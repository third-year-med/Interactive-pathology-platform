"""Attendance — the teacher's live list updates while the session is open, wherever the teacher runs it: Teacher Portal →
Attendance AND the module's 📋 Attendance tab (patch att-teacher-short). Before, the 4-second poll fetched the check-ins
but redrew the list only in Teacher Portal → Attendance, so on the 📋 Attendance tab the names appeared only after
"Close attendance". Also: no request while nobody is looking (another page, hidden browser tab) and an immediate one
when the screen comes back; never two requests at once; a failed request keeps the last saved list on screen with a
"retrying" note (the list only ever shows check-ins the server has saved). Idempotent."""
import sys
R = [
("""function attTeacherVisible() { return Router.current === 'teacher' && Views.teacher && Views.teacher.tab === 'attendance' && Auth.isTeacher(); }""",
"""function attTeacherVisible() { return Router.current === 'teacher' && Views.teacher && Views.teacher.tab === 'attendance' && Auth.isTeacher(); }
/** The teacher's live attendance panel is on screen: Teacher Portal → Attendance, or the module's 📋 Attendance tab. */
function attTeacherOnScreen() { return attTeacherVisible() || (Router.current === 'attendance' && Auth.isTeacher() && !Views.attendance.checkinToken); }"""),
("""  async poll() {
    if (!this.sessionId || !Backend.isAuthed()) return;
    const r = await Backend.authedPost({ action: 'getAttendanceTeacherState', sessionId: this.sessionId }, { timeout: 12000 });
    if (r && r.ok) {
      const gotToken = !this.token && r.session && r.session.token;
      const firstState = !this.state; // the header (session title, course…) was drawn before any state arrived
      this.state = r;
      if (gotToken) { this.token = r.session.token; this.save(); }
      if (attTeacherVisible()) { if (gotToken || firstState) Views.attendance.render(); else Views.attendance.paintTeacher(); }
    }
    else if (r && r.code === 'notfound') { this.sessionId = null; this.token = null; this.save(); this.stopPolling(); if (attTeacherVisible()) Views.attendance.render(); }
  }""",
"""  async poll(force) {
    if (!this.sessionId || !Backend.isAuthed()) return;
    if (!force && (document.hidden || !attTeacherOnScreen())) return;   // nobody is looking: no request (resumes when the screen is back)
    if (this.busy) return;                                               // never two requests at once (a slow answer + the next tick)
    this.busy = true; let r;
    try { r = await Backend.authedPost({ action: 'getAttendanceTeacherState', sessionId: this.sessionId }, { timeout: 12000 }); } finally { this.busy = false; }
    if (r && r.ok && r.session && r.session.sessionId && r.session.sessionId !== this.sessionId) return;   // an answer for a session already left
    if (r && r.ok) {
      const gotToken = !this.token && r.session && r.session.token;
      const firstState = !this.state; // the header (session title, course…) was drawn before any state arrived
      this.state = r; this.at = Date.now(); this.err = '';
      if (gotToken) { this.token = r.session.token; this.save(); }
      if (attTeacherOnScreen()) { if (gotToken || firstState) Views.attendance.render(); else Views.attendance.paintTeacher(); }
    }
    else if (r && r.code === 'notfound') { this.sessionId = null; this.token = null; this.save(); this.stopPolling(); if (attTeacherOnScreen()) Views.attendance.render(); }
    else { this.err = (r && r.error) || 'no answer'; if (attTeacherOnScreen()) Views.attendance.paintTeacher(); }   // keep the last saved list; the next tick retries
  }"""),
("""    box.appendChild(el('div', { class: 'row between' }, el('b', null, '🧑‍🎓 Present: ' + records.length + ' student' + (records.length === 1 ? '' : 's')), el('button', { class: 'btn btn-xs', title: 'Refresh', onclick: () => AttT.poll() }, '↻')));""",
"""    box.appendChild(el('div', { class: 'row between' }, el('b', null, '🧑‍🎓 Present: ' + records.length + ' student' + (records.length === 1 ? '' : 's')), el('button', { class: 'btn btn-xs', title: 'Refresh', onclick: () => AttT.poll(true) }, '↻')));
    box.appendChild(el('div', { class: 'small att-live-note' + (AttT.err ? '' : ' muted'), style: AttT.err ? 'color:#a15c00;font-weight:600' : '' }, AttT.err
      ? '⚠ The class server did not answer (' + AttT.err + ') — retrying automatically. The list shows the check-ins saved so far.'
      : '● Live — new check-ins appear automatically (every 4 s)' + (AttT.at ? ' · updated ' + fmtTime(AttT.at) : '')));"""),
("""    this.listBox = el('div', { class: 'card mt1' });
    page.appendChild(this.listBox);
    this.paintTeacher();
  },""",
"""    this.listBox = el('div', { class: 'card mt1' });
    page.appendChild(this.listBox);
    this.paintTeacher();
    if (!AttT.at || Date.now() - AttT.at > 3000) setTimeout(() => AttT.poll(), 0);   // back on this screen: the latest check-ins at once
  },"""),
("""Bus.on('auth-changed', () => { if (AttT.sessionId && Backend.isAuthed() && !AttT.timer) AttT.startPolling(); });""",
"""Bus.on('auth-changed', () => { if (AttT.sessionId && Backend.isAuthed() && !AttT.timer) AttT.startPolling(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && AttT.sessionId && attTeacherOnScreen()) AttT.poll(); });   // the browser tab is back"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
