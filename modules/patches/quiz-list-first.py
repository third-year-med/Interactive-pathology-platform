"""Assessments tab opens on the list: an attempt in progress is parked (answers kept) and continued from ▶ Resume.
Runner header shows "Student ID …" instead of the synthetic @student.local address. Idempotent."""
import sys
OLD_SHOW = """  show() {
    if (!this.st) { const saved = Store.get(QUIZ_PROGRESS_KEY, null); if (saved && saved.attempt && saved.attempt.questions) this.st = saved; }
    this.render();
  },"""
NEW_SHOW = """  show(params, entering) {
    // Opening the tab always shows the list of assessments first. An attempt in progress is parked — its answers are
    // kept on this device and the server keeps it open — and the student continues it from its ▶ Resume button.
    if (entering !== false) {
      const park = st => { if (st && !st.preview && st.attempt && st.attempt.id) Store.set('assess_resp_' + st.attempt.id, { resp: st.resp || {}, flags: st.flags || {} }); };
      if (this.st && !this.st.preview) { park(this.st); this.st = null; this.list = null; }
      const saved = Store.get(QUIZ_PROGRESS_KEY, null);
      if (saved) { park(saved); Store.del(QUIZ_PROGRESS_KEY); }
      if (!(this.st && this.st.preview)) this.done = null;
    }
    this.render();
  },"""
OLD_HDR = "st.name + (st.email ? ' · ' + st.email : '')"
NEW_HDR = "st.name + (st.email ? ' · ' + (/@student\\.local$/i.test(st.email) ? 'Student ID ' + st.email.replace(/@student\\.local$/i, '') : st.email) : '')"
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if NEW_SHOW not in s:
        assert s.count(OLD_SHOW) == 1, (path, 'show'); s = s.replace(OLD_SHOW, NEW_SHOW); n += 1
    if NEW_HDR not in s:
        assert s.count(OLD_HDR) == 1, (path, 'hdr'); s = s.replace(OLD_HDR, NEW_HDR); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
