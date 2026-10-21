"""Attendance report (Teacher Portal → Attendance → View, and the report shown after closing): the teacher marks each
registered student ✓ Present, Late or Excused — also after the session is closed — and can undo it (Portal.gs 2.25,
action attMark). Present / Late add a real check-in for a student who had none; Excused is for a student without a
check-in and is not counted as absent. Status, totals, percentages, the CSV and the printed report show the marks.
A lecture run as a Teaching Session keeps its marks in Teacher Dashboard → Teaching Sessions (a note says so). Idempotent."""
import sys
R = [
# the register knows each student's status
("""    const rows = roster.map(st => ({ name: st.name, studentId: st.username, email: st.email || '', rec: hit.get(st) || null }));
    const present = rows.filter(x => x.rec).sort((a, b) => Number(a.rec.scannedAt) - Number(b.rec.scannedAt));
    const absent = rows.filter(x => !x.rec).sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
    const n = rows.length, p = present.length, attPct = Math.round(p / n * 100);
    return { final, n, p, a: n - p, attPct, absPct: 100 - attPct, rows: absent.concat(present), extra };""",
"""    const mk = s.marks || {};   // Portal.gs 2.25: the teacher's marks {studentId: present | late | excused}
    const rows = roster.map(st => {
      const rec = hit.get(st) || null, m = mk[st.username] || mk[idN(st.username)] || '';
      const status = rec ? (m === 'late' || rec.status === 'late' ? 'late' : 'present') : m === 'excused' ? 'excused' : final ? 'absent' : 'waiting';
      return { name: st.name, studentId: st.username, email: st.email || '', rec, mark: m, status };
    });
    const present = rows.filter(x => x.rec).sort((a, b) => Number(a.rec.scannedAt) - Number(b.rec.scannedAt));
    const excused = rows.filter(x => x.status === 'excused').sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
    const absent = rows.filter(x => !x.rec && x.status !== 'excused').sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
    // attended = present + late; excused students are not counted (as in Overall Pathology Attendance)
    const n = rows.length, p = present.length, e = excused.length, late = rows.filter(x => x.status === 'late').length, counted = n - e;
    const attPct = counted ? Math.round(p / counted * 100) : 0;
    return { final, n, p, late, e, a: n - p - e, attPct, absPct: counted ? 100 - attPct : 0, rows: absent.concat(excused, present), extra };"""),
# badge, stats and the action buttons in the report card
("""    const statusBadge = (row) => row.rec ? el('span', { class: 'badge ok' }, row.rec.status === 'present' || !row.rec.status ? 'Present' : row.rec.status)
      : reg.final ? el('span', { class: 'badge bad' }, 'Absent') : el('span', { class: 'badge' }, 'Not checked in yet');
    const stats = reg
      ? [['Registered', reg.n], ['Present', reg.p], [reg.final ? 'Absent' : 'Not checked in yet', reg.a], ['Attendance', reg.attPct + '%'], ['Absence', reg.final ? reg.absPct + '%' : '—']]""",
"""    const statusBadge = (row) => row.status === 'late' ? el('span', { class: 'badge warn' }, 'Late' + (row.mark ? ' · teacher' : ''))
      : row.rec ? el('span', { class: 'badge ok' }, 'Present' + (row.mark === 'present' ? ' · teacher' : ''))
      : row.status === 'excused' ? el('span', { class: 'badge' }, 'Excused')
      : reg.final ? el('span', { class: 'badge bad' }, 'Absent') : el('span', { class: 'badge' }, 'Not checked in yet');
    // Portal.gs 2.25: ✓ Present / Late / Excused / Undo — saved on the server, then the report is redrawn from its answer
    const canMark = !!reg && !s.tsSession;
    const markBtn = (row, mk, label, cls) => el('button', { class: 'btn btn-xs' + (cls ? ' ' + cls : ''), 'data-mark': mk, title: { present: 'Mark this student present', late: 'Mark this student late', excused: 'Excused — not counted as absent', clear: 'Remove the teacher’s mark' }[mk], onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const r = await Backend.authedPost({ action: 'attMark', sessionId: s.sessionId, studentId: row.studentId, mark: mk, by: (Auth.teacherName && Auth.teacherName()) || '' }, { timeout: 30000 });
      if (!(r && r.ok)) { toast((r && r.code === 'badaction') || /unknown action/i.test((r && r.error) || '') ? 'Update Portal.gs on the backend (version 2.25) to mark attendance here.' : 'Could not save: ' + ((r && r.error) || 'no answer from the server.'), 'bad', 7000); if (document.body.contains(b)) b.disabled = false; return; }
      Object.assign(s, r.session); records.splice(0, records.length, ...(r.records || []));
      if (AttT.sessionId === s.sessionId) AttT.poll(true);
      this.hist = null;
      if (document.body.contains(card)) card.replaceWith(this.reportCard(s, records, dismissable, closeModal));
      toast({ present: '✓ Marked present', late: 'Marked late', excused: 'Marked excused', clear: 'Mark removed' }[mk] + ' — ' + row.name + '.', 'ok');
    } }, label);
    const actions = (row) => el('div', { class: 'row att-mark-btns', style: 'gap:.3rem;flex-wrap:wrap' },
      canMark ? (row.rec
        ? [row.status === 'late' ? markBtn(row, 'present', 'Mark present') : markBtn(row, 'late', 'Mark late'), row.mark ? markBtn(row, 'clear', 'Undo mark') : null]
        : [markBtn(row, 'present', '✓ Present', 'btn-primary'), markBtn(row, 'late', 'Late'), row.status === 'excused' ? markBtn(row, 'clear', 'Not excused') : markBtn(row, 'excused', 'Excused')]) : null,
      row.rec ? delBtn(row.rec) : null);
    const stats = reg
      ? [['Registered', reg.n], ['Present', reg.p]].concat(reg.late ? [['of them late', reg.late]] : [], reg.e ? [['Excused', reg.e]] : [],
        [[reg.final ? 'Absent' : 'Not checked in yet', reg.a], ['Attendance', reg.attPct + '%'], ['Absence', reg.final ? reg.absPct + '%' : '—']])"""),
("""      ? reg.rows.map((row, i) => el('tr', { class: row.rec ? '' : 'att-absent' }, el('td', null, String(i + 1)), el('td', { dir: 'auto' }, row.name), el('td', null, row.studentId || '—'), el('td', null, row.email || '—'),
          el('td', null, row.rec ? fmtDate(row.rec.scannedAt) : '—'), el('td', null, statusBadge(row)), el('td', null, row.rec ? delBtn(row.rec) : null)))""",
"""      ? reg.rows.map((row, i) => el('tr', { class: row.rec || row.status === 'excused' ? '' : 'att-absent' }, el('td', null, String(i + 1)), el('td', { dir: 'auto' }, row.name), el('td', null, row.studentId || '—'), el('td', null, row.email || '—'),
          el('td', null, row.rec ? fmtDate(row.rec.scannedAt) : '—'), el('td', null, statusBadge(row)), el('td', null, actions(row))))"""),
("""      dismissable ? el('button', { class: 'btn btn-sm', onclick: () => { this.report = null; this.render(); } }, 'Dismiss') : null),""",
"""      dismissable ? el('button', { class: 'btn btn-sm', onclick: () => { this.report = null; this.render(); } }, 'Dismiss') : null),
      s.tsSession ? el('div', { class: 'msg info mt1' }, 'This lecture was run as a Teaching Session — mark Present / Late / Excused in Teacher Dashboard → 🎓 Teaching Sessions.')
        : reg ? el('p', { class: 'small muted', style: 'margin:.4rem 0 0' }, 'You can mark a student ✓ Present, Late or Excused here — also after attendance is closed. Excused students are not counted as absent.') : null,"""),
# CSV
("""      rows.push(['Registered students', String(reg.n)], ['Present', String(reg.p)], [reg.final ? 'Absent' : 'Not checked in yet', String(reg.a)],""",
"""      rows.push(['Registered students', String(reg.n)], ['Present', String(reg.p)].concat(reg.late ? ['of them late: ' + reg.late] : []), ['Excused', String(reg.e || 0)], [reg.final ? 'Absent' : 'Not checked in yet', String(reg.a)],"""),
("""      reg.rows.forEach((x, i) => rows.push([i + 1, x.name, x.studentId || '', x.email || ''].concat(x.rec ? tm(x.rec.scannedAt) : ['', ''], [x.rec ? 'Present' : reg.final ? 'Absent' : 'Not checked in yet'])));""",
"""      reg.rows.forEach((x, i) => rows.push([i + 1, x.name, x.studentId || '', x.email || ''].concat(x.rec ? tm(x.rec.scannedAt) : ['', ''], [attStatusText(x)])));"""),
# print
("""      rows = reg.rows.map((x, i) => x.rec ? tr(i + 1, x.name, x.studentId, fmtDate(x.rec.scannedAt), 'Present', '')
        : tr(i + 1, x.name, x.studentId, '—', reg.final ? '<b>Absent</b>' : 'Not checked in yet', 'abs')).join('')""",
"""      rows = reg.rows.map((x, i) => x.rec ? tr(i + 1, x.name, x.studentId, fmtDate(x.rec.scannedAt), escHtml(attStatusText(x)), '')
        : tr(i + 1, x.name, x.studentId, '—', x.status === 'absent' ? '<b>Absent</b>' : escHtml(attStatusText(x)), x.status === 'excused' ? '' : 'abs')).join('')"""),
("""      summary = `<table class="sum"><tr><th>Registered students</th><th>Present</th><th>${reg.final ? 'Absent' : 'Not checked in yet'}</th><th>Attendance</th><th>Absence</th></tr>
        <tr><td>${reg.n}</td><td>${reg.p}</td><td>${reg.a}</td><td>${reg.attPct}%</td><td>${reg.final ? reg.absPct + '%' : '—'}</td></tr></table>""",
"""      summary = `<table class="sum"><tr><th>Registered students</th><th>Present${reg.late ? ' (of them late)' : ''}</th><th>Excused</th><th>${reg.final ? 'Absent' : 'Not checked in yet'}</th><th>Attendance</th><th>Absence</th></tr>
        <tr><td>${reg.n}</td><td>${reg.p}${reg.late ? ' (' + reg.late + ')' : ''}</td><td>${reg.e || 0}</td><td>${reg.a}</td><td>${reg.attPct}%</td><td>${reg.final ? reg.absPct + '%' : '—'}</td></tr></table>"""),
# helper
("""function attTeacherVisible() {""",
"""/** Status words of one register row (report, CSV, print) — Portal.gs 2.25 marks included. */
function attStatusText(x) {
  const t = { present: 'Present', late: 'Late', excused: 'Excused', absent: 'Absent', waiting: 'Not checked in yet' }[x.status] || (x.rec ? 'Present' : 'Absent');
  return t + (x.mark && (x.status === 'present' || x.status === 'late') ? ' (marked by teacher)' : '');
}
function attTeacherVisible() {"""),
# --- 2026-10-21 (Portal.gs 2.26): marks come from attMarks after Code.gs's own report; attMark answers {marks, tsSession, records} ---
("""    const reg = this.attRegister(s, records, roster);
    const drive = s.driveStatus""",
"""    if (s.marks === undefined && !s._mkLoading && Backend.isConfigured()) {   // the teacher's marks (Portal.gs 2.26), then redraw
      s._mkLoading = true;
      Backend.authedPost({ action: 'attMarks', sessionId: s.sessionId }, { timeout: 30000 }).then(r => {
        s._mkLoading = false; s.marks = r && r.ok ? (r.marks || {}) : {}; s.tsSession = !!(r && r.ok && r.tsSession); s._mkOff = !(r && r.ok);
        if (document.body.contains(card)) card.replaceWith(this.reportCard(s, records, dismissable, closeModal));
      }, () => { s._mkLoading = false; s.marks = {}; s._mkOff = true; });
    }
    const reg = this.attRegister(s, records, roster);
    const drive = s.driveStatus"""),
("""    const canMark = !!reg && !s.tsSession;""",
"""    const canMark = !!reg && !s.tsSession && s.marks !== undefined && !s._mkOff;"""),
("""      Object.assign(s, r.session); records.splice(0, records.length, ...(r.records || []));""",
"""      s.marks = r.marks || {}; s.tsSession = !!r.tsSession; if (r.driveStatus) { s.driveStatus = r.driveStatus; s.driveError = r.driveError || ''; }
      records.splice(0, records.length, ...(r.records || []));"""),
("""'Update Portal.gs on the backend (version 2.25) to mark attendance here.'""", """'Update Portal.gs on the backend (version 2.26) to mark attendance here.'"""),
]
# The 2.26 rules rewrite some 2.25 replacement texts, so an earlier rule may find neither its anchor nor its 2.25 text: that is
# fine when the page carries the final 2.26 code (checked below); any other page from an unknown template stops.
FINAL = ["action: 'attMarks'", "const canMark = !!reg && !s.tsSession && s.marks !== undefined && !s._mkOff;", "s.marks = r.marks || {}; s.tsSession = !!r.tsSession;", 'function attStatusText(x) {']
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        if a not in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    missing = [f for f in FINAL if f not in s]
    assert not missing, (path, 'att-mark: page from an unknown template', missing)
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
