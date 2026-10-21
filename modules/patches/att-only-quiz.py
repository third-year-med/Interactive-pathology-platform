"""Attendance-only assessments (Portal.gs 2.29, user 2026-10-21): Teacher Portal → 📝 Assessments → 🔑 Passwords gets a
"🧑‍🎓 Checked-in only" switch for each assessment — then only students checked in to THIS LECTURE'S attendance (the newest
attendance session of the module in the last 12 h: a scan, or the teacher's ✓ Present / Late) can start it; the password is
still needed, an attempt in progress resumes as before. The student's My Assessments list says so on the quiz. Idempotent."""
import sys
R = [
("""    let map = {};
    const draw = () => {
      clear(list);""",
"""    let map = {}, aon = {};   // aon: attendance-only assessments (2.29)
    const draw = () => {
      clear(list);"""),
("""          el('td', null, el('div', { class: 'row', style: 'gap:.35rem;flex-wrap:wrap' },
            el('button', { class: 'btn btn-sm', 'data-a': 'set', onclick: () => edit(a) }, own ? '✏ Change' : '＋ Set password'),""",
"""          el('td', null, el('label', { class: 'chk apw-att', title: 'On: only students checked in to today’s lecture attendance (scan, or your ✓ Present / Late) can start it — the password is still needed.' },
            el('input', { type: 'checkbox', 'data-a': 'attonly', checked: !!aon[a.id], onchange: (ev) => attOnly(a, ev.currentTarget) }), el('span', { class: 'small' }, '🧑‍🎓 Checked-in only'))),
          el('td', null, el('div', { class: 'row', style: 'gap:.35rem;flex-wrap:wrap' },
            el('button', { class: 'btn btn-sm', 'data-a': 'set', onclick: () => edit(a) }, own ? '✏ Change' : '＋ Set password'),"""),
("""      list.appendChild(el('table', { class: 'data-table apw-tbl' }, el('thead', null, el('tr', null, el('th', null, 'Assessment'), el('th', null, 'Status'), el('th', null, 'Password'), el('th', null, ''))), tb));""",
"""      list.appendChild(el('p', { class: 'small muted apw-att-note' }, '🧑‍🎓 ', el('b', null, 'Checked-in only'), ': for a quiz given in the lecture — only students checked in to today’s lecture attendance (they scanned the code, or you marked them ✓ Present / Late) can start it, even if the password reaches others. Start the lecture’s attendance first.'));
      list.appendChild(el('table', { class: 'data-table apw-tbl' }, el('thead', null, el('tr', null, el('th', null, 'Assessment'), el('th', null, 'Status'), el('th', null, 'Password'), el('th', null, 'Who can start'), el('th', null, ''))), tb));""", "apw-att-note"),   # done-marker: att-only-all changes this heading later
("""    const save = async (a, o) => {
      const r = await Backend.authedPost(Object.assign({ action: 'aePwSet', assessmentId: a.id }, o));""",
"""    const attOnly = async (a, cb) => {
      const want = cb.checked; cb.disabled = true;
      const r = await Backend.authedPost({ action: 'aeAttOnly', assessmentId: a.id, on: want });
      cb.disabled = false;
      if (!r || !r.ok) { cb.checked = !want; toast('✗ ' + (/Unknown action/i.test((r && r.error) || '') ? 'Update Portal.gs (2.29) on the class server first.' : ((r && r.error) || 'Could not save.')) + ' — nothing changed.', 'bad', 7000); return; }
      aon = r.attOnly || {}; draw();
      toast(want ? '🧑‍🎓 “' + (a.title || a.id) + '”: only students checked in to today’s lecture attendance can start it (with its password).' : '“' + (a.title || a.id) + '”: anyone with the password can start it again.', 'ok', 7000);
    };
    const save = async (a, o) => {
      const r = await Backend.authedPost(Object.assign({ action: 'aePwSet', assessmentId: a.id }, o));"""),
("""      map = r.passwords || {}; AssessUI.pw = map; draw();
    });
  },""",
"""      map = r.passwords || {}; aon = r.attOnly || {}; AssessUI.pw = map; draw();
    });
  },"""),
("""        it.assignment.dueAt ? '📅 Due ' + fmtDate(it.assignment.dueAt) : null, w !== 'open' && WIN[w] ? WIN[w][0] : null].filter(Boolean).join(' · ');""",
"""        it.assignment.dueAt ? '📅 Due ' + fmtDate(it.assignment.dueAt) : null, w !== 'open' && WIN[w] ? WIN[w][0] : null,
        it.attendanceOnly && it.canStart && !it.inProgressId ? '🧑‍🎓 Only for students checked in to today’s lecture' : null].filter(Boolean).join(' · ');"""),
("""      toast((r && r.error) || 'Could not start the assessment.', 'bad', 6000); this.reload(); return;""",
"""      toast((r && r.error) || 'Could not start the assessment.', 'bad', r && (r.code === 'notpresent' || r.code === 'noattendance') ? 12000 : 6000); this.reload(); return;"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for r in R:
        a, b = r[0], r[1]
        if b in s or (len(r) > 2 and r[2] in s): continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
