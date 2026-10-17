"""Attendance for a signed-in student: only the code (code entry) / only the Check-in button (QR link).
Name, Student ID and email come from the account (the server fills them from the session anyway). Idempotent."""
import sys
R = [
# --- QR check-in ---
("""    const email = el('input', { type: 'email', placeholder: 'Email (optional)', value: saved.email || '', autocomplete: 'email' });
    const msg = el('div');
    const pidKey = 'att_pid_v1::' + s.sessionId;""",
"""    const email = el('input', { type: 'email', placeholder: 'Email (optional)', value: saved.email || '', autocomplete: 'email' });
    // a signed-in student is identified by the account: no name / ID / email to type (the server takes them from the session)
    const acc = Views.quiz && Views.quiz.acct ? Views.quiz.acct() : null;
    if (acc) { name.value = acc.name; sid.value = acc.studentId; email.value = ''; }
    const msg = el('div');
    const pidKey = 'att_pid_v1::' + s.sessionId;"""),
("""      Store.set('quiz_identity_v1', { name: name.value.trim(), email: email.value.trim() });
      this.checkinDone = { session: s, scannedAt: r.scannedAt, alreadyRecorded: !!r.alreadyRecorded };""",
"""      if (!acc) Store.set('quiz_identity_v1', { name: name.value.trim(), email: email.value.trim() });
      this.checkinDone = { session: s, scannedAt: r.scannedAt, alreadyRecorded: !!r.alreadyRecorded };"""),
("""      el('label', { class: 'field mt1' }, 'Your full name', name),
      el('label', { class: 'field' }, 'Student ID (optional)', sid),
      el('label', { class: 'field' }, 'Email (optional)', email), msg,
      el('button', { class: 'btn btn-primary btn-block mt1', onclick: submit }, '✓ Check in')));
    setTimeout(() => name.focus(), 30);""",
"""      acc ? el('div', { class: 'small muted att-me' }, '👤 ' + acc.name + ' · Student ID ' + acc.studentId) : [
      el('label', { class: 'field mt1' }, 'Your full name', name),
      el('label', { class: 'field' }, 'Student ID (optional)', sid),
      el('label', { class: 'field' }, 'Email (optional)', email)], msg,
      el('button', { class: 'btn btn-primary btn-block mt1', onclick: submit }, '✓ Check in')));
    if (!acc) setTimeout(() => name.focus(), 30);"""),
# --- code entry ---
("""    const email = el('input', { type: 'email', placeholder: 'Email (optional)', value: saved.email || '', autocomplete: 'email' });
    const msg = el('div');
    const btn = el('button', { class: 'btn btn-primary btn-block mt1' }, '✓ Submit Attendance');""",
"""    const email = el('input', { type: 'email', placeholder: 'Email (optional)', value: saved.email || '', autocomplete: 'email' });
    // a signed-in student types ONLY the code: name / ID / email come from the account (the server takes them from the session)
    const acc = Views.quiz && Views.quiz.acct ? Views.quiz.acct() : null;
    if (acc) { name.value = acc.name; sid.value = acc.studentId; email.value = ''; }
    const msg = el('div');
    const btn = el('button', { class: 'btn btn-primary btn-block mt1' }, '✓ Submit Attendance');"""),
("""      Store.set('quiz_identity_v1', Object.assign({}, Store.get('quiz_identity_v1', {}) || {}, { name: name.value.trim(), email: email.value.trim(), studentId: sid.value.trim() }));""",
"""      if (!acc) Store.set('quiz_identity_v1', Object.assign({}, Store.get('quiz_identity_v1', {}) || {}, { name: name.value.trim(), email: email.value.trim(), studentId: sid.value.trim() }));"""),
("""      el('p', { class: 'small muted' }, 'Type the code your teacher is showing for this session. Each session has its own code.'),
      el('label', { class: 'field mt1' }, 'Attendance code', code),
      el('label', { class: 'field' }, 'Your full name', name),
      el('label', { class: 'field' }, 'Student ID (optional)', sid),
      el('label', { class: 'field' }, 'Email (optional)', email), msg, btn));""",
"""      el('p', { class: 'small muted' }, 'Type the code your teacher is showing for this session. Each session has its own code.'),
      el('label', { class: 'field mt1' }, 'Attendance code', code),
      acc ? el('div', { class: 'small muted att-me' }, '👤 ' + acc.name + ' · Student ID ' + acc.studentId) : [
      el('label', { class: 'field' }, 'Your full name', name),
      el('label', { class: 'field' }, 'Student ID (optional)', sid),
      el('label', { class: 'field' }, 'Email (optional)', email)], msg, btn));"""),
("      if (name.value.trim().length < 2) { msg.className = 'msg bad'; msg.textContent = 'Please enter your name.'; name.focus(); return; }\n      let pid",
 "      if (!acc && name.value.trim().length < 2) { msg.className = 'msg bad'; msg.textContent = 'Please enter your name.'; name.focus(); return; }\n      let pid"),
("      if (name.value.trim().length < 2) { msg.className = 'msg bad'; msg.textContent = 'Please enter your name.'; return; }\n      const payload = { action: 'submitAttendance'",
 "      if (!acc && name.value.trim().length < 2) { msg.className = 'msg bad'; msg.textContent = 'Please enter your name.'; return; }\n      const payload = { action: 'submitAttendance'"),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
