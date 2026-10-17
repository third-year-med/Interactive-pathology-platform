"""Assessment passwords move INTO Teacher Portal → 📝 Assessments: a status strip above the sub-tabs, a 🔑 Passwords sub-tab,
a Password column in the Assessment Library; the separate Administration tab goes (old links open the sub-tab)."""
import sys
MARK = "renderPwStrip(box)"
def patch(s):
    if MARK in s: return s, 'already'
    if "apw-none" not in s: raise SystemExit('needs the 2.20 patch first')
    def rep(a, b, n=1):
        nonlocal s
        c = s.count(a)
        if c != n: raise SystemExit('pattern found %d× (expected %d): %r' % (c, n, a[:90]))
        s = s.replace(a, b)
    # the separate tab goes; an old link (#/teacher/password) opens Assessments → 🔑 Passwords
    rep("""  ['password', '🔑 Assessment passwords'], """, "  ")
    rep("""['Administration', ['students', 'password', 'backend', 'backup', 'account']]""", """['Administration', ['students', 'backend', 'backup', 'account']]""")
    rep("""  show(params) { if (params[0] && PORTAL_TABS.some(t => t[0] === params[0])) this.tab = params[0]; this.render(); },""",
        """  show(params) {
    if (params[0] === 'password') { this.tab = 'assessments'; AssessUI.sub = 'passwords'; Router.setQuiet('teacher', ['assessments']); }   // passwords live inside Assessments now
    else if (params[0] && PORTAL_TABS.some(t => t[0] === params[0])) this.tab = params[0];
    this.render();
  },""")
    # the password list keeps AssessUI's copy current
    rep("""      map = r.passwords || {}; draw();""", """      map = r.passwords || {}; AssessUI.pw = map; draw();""", 2)
    rep("""          draw(); toast('✓ Every assessment has its own password now.', 'ok');""", """          AssessUI.pw = map; draw(); toast('✓ Every assessment has its own password now.', 'ok');""")
    # AssessUI: passwords loaded with the private data; strip + sub-tab + library column
    rep("""  assignments: null, groups: null, attemptsCache: null, migrationMsg: '',""",
        """  assignments: null, groups: null, attemptsCache: null, migrationMsg: '', pw: null,""")
    rep("""    const [a, g] = await Promise.all([AssessAPI.listAssignments(), AssessAPI.listGroups()]);""",
        """    const [a, g, p] = await Promise.all([AssessAPI.listAssignments(), AssessAPI.listGroups(), Backend.isConfigured() ? Backend.authedPost({ action: 'aePwList' }) : Promise.resolve(null)]);
    this.pw = p && p.ok ? (p.passwords || {}) : null;   // null: local mode or an older class server""")
    rep("""    this.renderDashboard(box);
    box.appendChild(el('div', { class: 'row sub-tabs', role: 'tablist' }, [['library', '📚 Assessment Library'], ['assignments', '📤 Assignments'], ['groups', '👥 Student groups']].map(([id, l]) =>""",
        """    this.renderDashboard(box);
    this.renderPwStrip(box);
    box.appendChild(el('div', { class: 'row sub-tabs', role: 'tablist' }, [['library', '📚 Assessment Library'], ['assignments', '📤 Assignments'], ['groups', '👥 Student groups'], ['passwords', '🔑 Passwords']].map(([id, l]) =>""")
    rep("""    if (this.sub === 'groups') return this.renderGroups(inner);
    this.renderLibrary(inner);
  },""", """    if (this.sub === 'groups') return this.renderGroups(inner);
    if (this.sub === 'passwords') return Backend.isConfigured() ? Views.teacher.renderAssessPw(inner) : Views.teacher.tabPassword(inner);   // local mode keeps the class password
    this.renderLibrary(inner);
  },
  /* ---------------- passwords (one per assessment) — part of Assessments ---------------- */
  async setPw(a, o) {
    const r = await Backend.authedPost(Object.assign({ action: 'aePwSet', assessmentId: a.id }, o));
    if (!r || !r.ok) { toast('✗ ' + ((r && r.error) || 'Could not save the password.') + ' — nothing changed.', 'bad', 6000); return false; }
    this.pw = r.passwords || {};
    if (!o.all) toast(o.clear ? '“' + (a.title || a.id) + '” has no password now — students cannot start it.' : '✓ Password of “' + (a.title || a.id) + '”: ' + r.password, 'ok', 6000);
    return true;
  },
  async editPw(a) {
    const v = await promptDialog('🔑 ' + (a.title || a.id), 'Password for this assessment', { value: (this.pw && this.pw[a.id] && this.pw[a.id].password) || '', placeholder: 'at least 4 characters', okLabel: 'Save', hint: 'Not case-sensitive. Students need it to START this assessment; reviewing completed attempts needs no password.' });
    if (v == null) return;
    if (String(v).trim().length < 4) { toast('The password must have at least 4 characters.', 'warn'); return; }
    if (await this.setPw(a, { password: String(v).trim() })) this.render(this.box);
  },
  /** The strip above the sub-tabs: how many have a password; published ones without one are flagged. */
  renderPwStrip(box) {
    if (!this.pw) return;
    const live = (State.assessments || []).filter(a => a.status !== 'archived');
    if (!live.length) return;
    const set = live.filter(a => this.pw[a.id]).length;
    const miss = live.filter(a => !this.pw[a.id] && a.status === 'published');
    const allMissing = live.filter(a => !this.pw[a.id]);
    box.appendChild(el('div', { class: 'apw-strip' + (miss.length ? ' warn' : ' ok') },
      el('span', { class: 'apw-strip-t' }, '🔑 Assessment passwords: ', el('b', null, set + ' of ' + live.length + ' set')),
      miss.length ? el('span', { class: 'apw-strip-w' }, '⚠ ' + miss.length + ' published assessment' + (miss.length === 1 ? ' has' : 's have') + ' no password — students cannot start ' + (miss.length === 1 ? 'it' : 'them')) : el('span', { class: 'small muted' }, 'Each password unlocks only its own assessment; reviews need none.'),
      el('span', { class: 'apw-strip-a' },
        allMissing.length ? el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'pw-all', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          for (const a of allMissing) { if (!(await this.setPw(a, { random: true, all: true }))) break; }
          toast('✓ Every assessment has its own password now.', 'ok'); this.render(this.box);
        } }, '🎲 Give each a random password') : null,
        this.sub !== 'passwords' ? el('button', { class: 'btn btn-sm', 'data-a': 'pw-manage', onclick: () => { this.sub = 'passwords'; this.render(this.box); } }, '🔑 Manage passwords') : null)));
  },""")
    # the library: a Password column
    rep("""        el('td', null, statusBadge(ds)),
        el('td', null, nA ? String(nA) : el('span', { class: 'muted' }, '—')),""",
        """        el('td', { class: 'nowrap apw-st' }, statusBadge(ds)),
        this.pw ? el('td', { class: 'nowrap apw-cell' }, this.pw[a.id] ? el('code', { class: 'apw-pw', style: 'font-weight:700;letter-spacing:.04em' }, this.pw[a.id].password) : el('span', { class: 'small', style: 'color:var(--bad);font-weight:600' }, '⚠ none'),
          el('button', { class: 'btn btn-xs', style: 'margin-left:.35rem', 'data-a': 'pw', title: this.pw[a.id] ? 'Change the password' : 'Set a password', 'aria-label': (this.pw[a.id] ? 'Change' : 'Set') + ' the password of ' + a.title, onclick: () => this.editPw(a) }, '🔑')) : null,
        el('td', null, nA ? String(nA) : el('span', { class: 'muted' }, '—')),""")
    rep("""      el('thead', null, el('tr', null, ['', 'Assessment', 'Mode', 'Questions', 'Status', 'Assignments', 'Updated', ''].map(h => el('th', null, h)))),
      el('tbody', null, list.length ? Array.from(tb.childNodes) : el('tr', null, el('td', { colspan: '8',""",
        """      el('thead', null, el('tr', null, ['', 'Assessment', 'Mode', 'Questions', 'Status'].concat(this.pw ? ['Password'] : [], ['Assignments', 'Updated', '']).map(h => el('th', null, h)))),
      el('tbody', null, list.length ? Array.from(tb.childNodes) : el('tr', null, el('td', { colspan: this.pw ? '9' : '8',""")
    # styles (the module's own stylesheet block is not touched: injected once by the app)
    rep("""const AssessUI = {""", """(function () {   // styles of the password strip (Assessments)
  if (document.getElementById('apw-css')) return;
  const st = document.createElement('style'); st.id = 'apw-css';
  st.textContent = '.apw-strip{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem .9rem;margin:.2rem 0 .9rem;padding:.6rem .9rem;border-radius:12px;border:1px solid var(--line,#dde3ea);background:#fff}' +
    '.apw-strip.warn{border-color:#f0b9b4;background:#fdecea}.apw-strip.ok{background:#f3faf6;border-color:#cfe9da}' +
    '.apw-strip-t{font-weight:600}.apw-strip-w{color:#b3261e;font-weight:700}.apw-strip-a{display:flex;gap:.4rem;margin-left:auto;flex-wrap:wrap}' +
    'td.apw-st{min-width:6.6rem}td.apw-st .badge,td.apw-cell code{white-space:nowrap;word-break:keep-all;overflow-wrap:normal}';
  document.head.appendChild(st);
})();
const AssessUI = {""")
    return s, 'patched'
if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f, encoding='utf-8').read(); s2, st = patch(s)
        if st == 'patched': open(f, 'w', encoding='utf-8').write(s2)
        print(f, st)
