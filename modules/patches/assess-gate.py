"""2.18 module patch: the Assessments page identifies a signed-in student by the account (password only)."""
import sys
MARK = "acct() {"
def patch(s):
    if MARK in s: return s, 'already'
    def rep(a, b, n=1):
        nonlocal s
        c = s.count(a)
        if c != n: raise SystemExit('pattern found %d× (expected %d): %r' % (c, n, a[:80]))
        s = s.replace(a, b)
    rep("""  me() { return Store.get('quiz_identity_v1', null); },""",
"""  /** 2.18: a signed-in student is identified by the ACCOUNT — no name/email typing; the class server fills the same
   *  name and email from the account on every assessment request, so records, grading and reports are unchanged. */
  acct() {
    const B = window.NEO_BOOT, s = B && B.role === 'student' && B.student;
    if (!s || !s.username) return null;
    const id = String(s.username).toLowerCase();
    return { name: s.name || id, email: AE_normEmail(s.email || (id.replace(/[^a-z0-9._-]/g, '') + '@student.local')), studentId: id, account: true };
  },
  me() { return this.acct() || Store.get('quiz_identity_v1', null); },""")
    rep("""  renderGate(page) {
    const name = el('input',""", """  /* signed-in student: only the assessment password */
  renderAccountGate(page) {
    const me = this.acct();
    const pw = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Given to you by your teacher', id: 'quiz-pw' });
    const msg = el('div', { role: 'status', 'aria-live': 'polite' });
    const go = el('button', { class: 'btn btn-primary btn-lg btn-block', onclick: async () => {
      if (!pw.value.trim()) { msg.className = 'msg bad'; msg.textContent = 'Please enter the assessment password from your teacher.'; pw.focus(); return; }
      go.disabled = true; msg.className = 'msg info'; msg.textContent = 'Checking…';
      const r = await AssessAPI.getMyAssessments(me.email, pw.value.trim());
      go.disabled = false;
      if (!r || !r.ok) { msg.className = 'msg bad'; msg.textContent = (r && r.error) || 'Could not load your assessments.'; if (r && r.code === 'badpw') pw.select(); return; }
      Store.set('quiz_identity_v1', { name: me.name, email: me.email }); Store.sset('quiz_pw_s', pw.value.trim());
      this.list = r; this.render(); window.scrollTo({ top: 0 });
    } }, 'Show my assessments ▶');
    pw.addEventListener('keydown', ev => { if (ev.key === 'Enter') go.click(); });
    page.appendChild(el('div', { class: 'quiz-gate' }, el('div', { class: 'card' },
      el('div', { class: 'gate-hero' }, el('div', { class: 'ico' }, '📝'), el('h1', { style: 'margin:.2rem 0' }, 'My Assessments — ' + COURSE.title),
        el('p', { class: 'muted', style: 'margin:0' }, 'Enter the assessment password provided by your teacher.')),
      el('div', { class: 'stack mt1' },
        el('label', { class: 'field' }, 'Assessment password', pw),
        msg, go,
        el('p', { class: 'small muted quiz-acct', style: 'margin:0' }, 'Signed in as ' + me.name + ' (Student ID ' + me.studentId + ') — your results are recorded under your account.')),
      el('div', { class: 'quiz-gate-credit' }, 'Created by ' + AUTHOR))));
    setTimeout(() => pw.focus(), 30);
  },
  renderGate(page) {
    if (this.acct()) return this.renderAccountGate(page);
    const name = el('input',""")
    rep("""me.name + ' · ' + me.email,""", """(me.account ? me.name + ' · Student ID ' + me.studentId : me.name + ' · ' + me.email),""", s.count("""me.name + ' · ' + me.email,"""))
    nsw = s.count("""el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { Store.sdel('quiz_pw_s'); this.list = null; this.render(); } }, 'Not you? Switch')""")
    if nsw < 1: raise SystemExit('no Switch button')
    rep("""el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { Store.sdel('quiz_pw_s'); this.list = null; this.render(); } }, 'Not you? Switch')""",
        """me.account ? null : el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { Store.sdel('quiz_pw_s'); this.list = null; this.render(); } }, 'Not you? Switch')""", nsw)
    rep("""'No assessments are assigned to ' + me.email + ' right now.'""", """'No assessments are assigned to ' + (me.account ? 'you' : me.email) + ' right now.'""")
    return s, 'patched'
if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f, encoding='utf-8').read()
        s2, st = patch(s)
        if st == 'patched': open(f, 'w', encoding='utf-8').write(s2)
        print(f, st)
