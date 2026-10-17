"""2.19 module patch: Assessments open without a password; each assessment's own password only to START it;
completed attempts can be reviewed; Teacher Portal → 🔑 Assessment passwords (one per assessment)."""
import sys
MARK = "e.preventDefault(); done = true; resolve(inp.value)"
def patch(s):
    if MARK in s: return s, 'already'
    if "acct() {" not in s: raise SystemExit('needs the 2.18 assessment patch first')
    if "openReview(it, t)" in s: raise SystemExit('re-run from the main version of the file')
    def rep(a, b, n=1):
        nonlocal s
        c = s.count(a)
        if c != n: raise SystemExit('pattern found %d× (expected %d): %r' % (c, n, a[:90]))
        s = s.replace(a, b)
    # 1. a signed-in student opens Assessments without any password
    rep("""    if (this.me() && this.pw()) return this.renderDashboard(page);""",
        """    if (this.me() && (this.pw() || (this.acct() && !this.needPw))) return this.renderDashboard(page);   // 2.19: no password to open Assessments""")
    # 2. an older class server still wants the class password for the list → the password page as before
    rep("""    else if (r && r.code === 'badpw') { Store.sdel('quiz_pw_s'); toast('The quiz password has changed — please enter the new one.', 'warn', 6000); }""",
        """    else if (r && r.code === 'badpw') { Store.sdel('quiz_pw_s'); if (this.acct() && !this.needPw) this.needPw = true; else toast('The quiz password has changed — please enter the new one.', 'warn', 6000); }""")
    # 3. one line about passwords on the dashboard
    rep("""    const pend = Store.get('pending_attempt_submits_v1', []).filter(p => p.email === me.email);""",
        """    if (this.acct() && this.list && this.list.perAssessmentPasswords) page.appendChild(el('p', { class: 'small muted assess-pwnote', style: 'margin:-.3rem 0 .9rem' }, '🔑 Each assessment asks for its own password when you start it. Completed assessments can be reviewed at any time — no password needed.'));
    const pend = Store.get('pending_attempt_submits_v1', []).filter(p => p.email === me.email);""")
    # 4. completed attempts: open the result / review without a password
    rep("""        el('div', { class: 'row mt1' }, btn, reason ? el('span', { class: 'small muted' }, reason) : null)));""",
        """        subs.length ? el('div', { class: 'row assess-hist', style: 'margin-top:.5rem;flex-wrap:wrap;gap:.4rem' }, el('span', { class: 'small muted' }, 'Completed:'),
          subs.map(t => el('button', { class: 'btn btn-sm', 'data-attempt': t.id, onclick: () => this.openReview(it, t) }, '📄 Attempt ' + t.attemptNo + (typeof t.percent === 'number' ? ' · ' + t.percent + '%' : '') + (t.review ? ' — review answers' : ' — result')))) : null,
        el('div', { class: 'row mt1' }, btn, reason ? el('span', { class: 'small muted' }, reason) : null)));""")
    rep("""  async start(it, btn) {
    const me = this.me();""", """  /** 2.19: a completed attempt — score, your answers, the correct answers and explanations, as this assessment's settings allow. No password. */
  openReview(it, t) {
    const me = this.me();
    this.done = { attempt: t, title: it.assessment.title, name: me.name, email: me.account ? '' : me.email, saved: 'server', fromHistory: true };
    this.render(); window.scrollTo({ top: 0 });
  },
  async start(it, btn) {
    const me = this.me();""")
    # 5. starting: THIS assessment's password (a resumed attempt needs none)
    rep("""    if (btn) btn.disabled = true;
    const r = await AssessAPI.startAttempt(it.assignment.id, me.email, me.name, this.pw());
    if (btn) btn.disabled = false;
    if (!r || !r.ok) { toast((r && r.error) || 'Could not start the assessment.', 'bad', 6000); this.reload(); return; }""",
        """    // 2.19: each assessment has its own password — asked here, for THIS assessment only (the server checks it)
    const perQuiz = !!(this.acct() && Backend.isConfigured() && this.list && this.list.perAssessmentPasswords && !it.inProgressId);
    let pw = this.pw(), r = null;
    for (let tries = 0; ; tries++) {
      if (perQuiz) {
        pw = await promptDialog('🔑 ' + it.assessment.title, 'Password for this assessment', { type: 'password', okLabel: '▶ Start', placeholder: 'Given to you by your teacher',
          hint: tries ? '✗ ' + ((r && r.error) || 'Please enter the password.') : 'Each assessment has its own password. It unlocks only this assessment.' });
        if (pw == null) return;
        pw = String(pw).trim();
        if (!pw) { r = { error: 'Please enter the password.' }; continue; }
      }
      if (btn) btn.disabled = true;
      r = await AssessAPI.startAttempt(it.assignment.id, me.email, me.name, pw);
      if (btn) btn.disabled = false;
      if (r && r.ok) break;
      if (perQuiz && r && r.code === 'badpw' && tries < 5) continue;
      toast((r && r.error) || 'Could not start the assessment.', 'bad', 6000); this.reload(); return;
    }""")
    # 6. Teacher Portal: one password per assessment, above the class (default) password
    rep("""['password', '🔑 Quiz password']""", """['password', '🔑 Assessment passwords']""")
    rep("""  async tabPassword(box) {
    clear(box);""", """  /** 2.19: one password per assessment (stored on the class server, per group + module; never sent to students). */
  renderAssessPw(box) {
    const list = el('div', { class: 'apw-list' }, el('p', { class: 'small muted' }, 'Loading…'));
    box.appendChild(el('div', { class: 'card apw-card' }, el('h3', null, '🔑 Assessment passwords — one for each assessment'),
      el('p', { class: 'small muted' }, 'Students open Assessments and review their completed assessments WITHOUT a password. The password is asked only when they START an assessment, and it unlocks only that assessment. Not case-sensitive. An assessment without its own password uses the class quiz password below.'), list));
    if (!Backend.isConfigured()) { clear(list); list.appendChild(el('p', { class: 'small muted' }, 'Connect the class server to give each assessment its own password (local mode uses the class quiz password).')); return; }
    let map = {};
    const draw = () => {
      clear(list);
      const asm = (State.assessments || []).filter(a => a.status !== 'archived').slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
      if (!asm.length) { list.appendChild(el('p', { class: 'small muted' }, 'No assessments yet — create them in Teaching → 📝 Assessments.')); return; }
      const tb = el('tbody');
      asm.forEach(a => {
        const own = map[a.id];
        tb.appendChild(el('tr', { 'data-assessment': a.id },
          el('td', null, el('b', null, a.title || a.id)),
          el('td', null, el('span', { class: 'badge ' + (a.status === 'published' ? 'ok' : 'plain') }, ASSESS_STATUS_LABEL[a.status] || a.status || '')),
          el('td', null, own ? el('code', { class: 'apw-pw', style: 'font-size:1.05rem;font-weight:700;letter-spacing:.05em' }, own.password) : el('span', { class: 'small muted' }, 'class quiz password')),
          el('td', null, el('div', { class: 'row', style: 'gap:.35rem;flex-wrap:wrap' },
            el('button', { class: 'btn btn-sm', 'data-a': 'set', onclick: () => edit(a) }, own ? '✏ Change' : '＋ Set password'),
            el('button', { class: 'btn btn-sm', 'data-a': 'random', onclick: () => save(a, { random: true }) }, '🎲 New random'),
            own ? el('button', { class: 'btn btn-sm btn-ghost', 'data-a': 'clear', onclick: () => save(a, { clear: true }) }, '↺ Use class password') : null))));
      });
      list.appendChild(el('table', { class: 'data-table apw-tbl' }, el('thead', null, el('tr', null, el('th', null, 'Assessment'), el('th', null, 'Status'), el('th', null, 'Password'), el('th', null, ''))), tb));
    };
    const save = async (a, o) => {
      const r = await Backend.authedPost(Object.assign({ action: 'aePwSet', assessmentId: a.id }, o));
      if (!r || !r.ok) { toast('✗ ' + ((r && r.error) || 'Could not save the password.') + ' — nothing changed.', 'bad', 6000); return; }
      map = r.passwords || {}; draw();
      toast(o.clear ? '“' + (a.title || a.id) + '” uses the class quiz password again.' : '✓ Password of “' + (a.title || a.id) + '”: ' + r.password, 'ok', 6000);
    };
    const edit = async (a) => {
      const v = await promptDialog('🔑 ' + (a.title || a.id), 'New password for this assessment', { placeholder: 'at least 4 characters', okLabel: 'Save', hint: 'Not case-sensitive. Students need it to START this assessment; reviewing completed attempts needs no password.' });
      if (v == null) return;
      if (String(v).trim().length < 4) { toast('The password must have at least 4 characters.', 'warn'); return; }
      save(a, { password: String(v).trim() });
    };
    Backend.authedPost({ action: 'aePwList' }).then(r => {
      if (!r || !r.ok) { clear(list); list.appendChild(el('div', { class: 'msg ' + (/Unknown action/i.test((r && r.error) || '') || (r && r.code === 'badaction') ? 'warn' : 'bad') }, /Unknown action/i.test((r && r.error) || '') || (r && r.code === 'badaction') ? 'Update Portal.gs on the class server (version 2.19) to give each assessment its own password.' : 'Could not read the passwords: ' + ((r && r.error) || 'error'))); return; }
      map = r.passwords || {}; draw();
    });
  },
  async tabPassword(box) {
    clear(box);
    this.renderAssessPw(box);""")
    rep("""el('h3', null, '🔑 Quiz password (for all formal assessments)'),
      el('p', { class: 'small muted' }, 'Students must enter this password (plus their full name and email) to see and start the assessments assigned to them. It is not case-sensitive.'),""",
        """el('h3', null, '🔑 Class quiz password (default)'),
      el('p', { class: 'small muted' }, 'Used by every assessment that has no password of its own (see above). It is not case-sensitive.'),""")
    # 7. promptDialog: Enter must not also "click" the button that gets the focus back (it reopened the dialog)
    rep("""    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; resolve(inp.value); m.close(true); } });""",
        """    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done = true; resolve(inp.value); m.close(true); } });""")
    return s, 'patched'
if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f, encoding='utf-8').read(); s2, st = patch(s)
        if st == 'patched': open(f, 'w', encoding='utf-8').write(s2)
        print(f, st)
