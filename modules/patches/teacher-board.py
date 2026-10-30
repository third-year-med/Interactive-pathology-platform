"""Module Assessment tab for a TEACHER (class server): instead of the student sign-in box, a compact list of the
published assessments with their covered passwords (👁 Show one at a time, 📋 Copy, 🔑 set/change), status and
attempts — no need to open the Teacher Portal to give a password. Order as the students see it: other assessments
newest first, then ⚡ topic quizzes Topic 1 … last. The Teacher Portal's Assessment Library uses the same order. Idempotent."""
import sys
R = [
("""function apwRepaintAll() {""",
"""/** Order used everywhere (students, teacher list, library): other assessments newest first, then the ⚡ topic quizzes
 *  "Topic N quiz — …" by N (Topic 1 first). */
function assessTopicNum(title) { const m = /^Topic (\\d+) quiz\\b/.exec(title || ''); return m ? Number(m[1]) : 0; }
function assessTopicSort(list, timeOf) {
  return list.slice().sort((a, b) => { const x = assessTopicNum(a.title), y = assessTopicNum(b.title);
    if (!x !== !y) return x ? 1 : -1; if (x) return x - y; return (timeOf(b) || 0) - (timeOf(a) || 0); });
}
function apwRepaintAll() {"""),
("""    let list = (State.assessments || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    list = list.filter(a => {""",
"""    let list = assessTopicSort(State.assessments || [], a => a.updatedAt);
    list = list.filter(a => {"""),
("""    if (this.me() && (this.pw() || (this.acct() && !this.needPw))) return this.renderDashboard(page);   // 2.19: no password to open Assessments""",
"""    if (Auth.isTeacher() && AssessAPI.isServer() && !this.acct()) return this.renderTeacherBoard(page);   // teacher: the quizzes and their passwords here
    if (this.me() && (this.pw() || (this.acct() && !this.needPw))) return this.renderDashboard(page);   // 2.19: no password to open Assessments"""),
("""  /* ---------- identification ---------- */""",
"""  /** Teacher view of this tab: what the students see, with each assessment's password (covered) — Show / Copy / 🔑. */
  async renderTeacherBoard(page) {
    page.appendChild(sectionTitleBlock('📝 Assessments — teacher view', 'Give a quiz’s password to the class when it should start: 👁 Show reveals one at a time, 📋 Copy copies it without showing it.',
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-sm', onclick: async () => { await AssessUI.loadPrivate(true); this.render(); } }, '↻ Refresh'),
        el('button', { class: 'btn btn-sm', onclick: () => { Views.teacher.tab = 'assessments'; AssessUI.sub = 'library'; Router.go('teacher', ['assessments']); } }, '⚙ Teacher Portal'))));
    const box = el('div', { class: 'tb-list' }, el('div', { class: 'card empty' }, 'Loading…')); page.appendChild(box);
    if (!AssessUI.assignments || AssessUI.pw == null) await AssessUI.loadPrivate(true);
    clear(box);
    const asg = {}; (AssessUI.assignments || []).filter(g => g.status === 'active').forEach(g => { (asg[g.assessmentId] = asg[g.assessmentId] || []).push(g); });
    const list = assessTopicSort((State.assessments || []).filter(a => a.status === 'published' || a.status === 'closed'), a => a.publishedAt || a.updatedAt);
    if (!list.length) { box.appendChild(el('div', { class: 'card empty' }, 'No published assessments yet. Create them in ⚙ Teacher Portal → 📝 Assessments (e.g. ⚡ Topic quizzes).')); return; }
    const pw = AssessUI.pw || {};
    const missing = list.filter(a => a.status === 'published' && !pw[a.id]).length;
    if (missing) box.appendChild(el('div', { class: 'msg warn' }, '⚠ ' + missing + ' published assessment' + (missing > 1 ? 's have' : ' has') + ' no password — students cannot start ' + (missing > 1 ? 'them' : 'it') + '. Use 🔑 to set one.'));
    list.forEach(a => {
      const s = a.settings || {}, g = asg[a.id] || [];
      const started = g.reduce((n, x) => n + (x.startedCount || 0), 0), done = g.reduce((n, x) => n + (x.completedCount || 0), 0);
      const meta = [a.mode === 'pool' ? (a.poolCount + ' of ' + (a.questionIds || []).length + ' questions (random)') : plural((a.questionIds || []).length, 'question'),
        s.timeLimitMin ? s.timeLimitMin + ' min' : 'untimed', s.attemptsAllowed ? plural(s.attemptsAllowed, 'attempt') : 'unlimited attempts',
        g.length ? (done + ' submitted' + (started > done ? ' · ' + (started - done) + ' in progress' : '')) : 'not assigned'].join(' · ');
      box.appendChild(el('div', { class: 'card assess-card assess-row tb-row', 'data-assessment': a.id },
        el('div', { class: 'assess-main' }, el('h3', { title: a.description || a.title }, a.title), el('div', { class: 'assess-meta' }, meta)),
        el('div', { class: 'assess-side tb-side' },
          a.status === 'closed' ? el('span', { class: 'badge warn' }, 'Closed') : null,
          pw[a.id] ? apwSecret(a.id, pw[a.id].password) : el('span', { class: 'small', style: 'color:var(--bad);font-weight:600' }, '⚠ no password'),
          el('button', { class: 'btn btn-xs', 'data-a': 'pw', title: pw[a.id] ? 'Change the password' : 'Set a password', onclick: async () => { await AssessUI.editPw(a); this.render(); } }, '🔑'),
          el('button', { class: 'btn btn-xs', title: 'Results of this assessment', onclick: () => { Views.teacher.rf.asm = a.id; Views.teacher.tab = 'results'; Router.go('teacher', ['results']); } }, '📊'))));
    });
  },
  /* ---------- identification ---------- */""", "async renderTeacherBoard(page) {"),
(""".cg-res{padding-left:1.1rem;margin:0}.cg-res li{margin:.3rem 0}.cg-res li.bad{color:var(--bad)}
""",
""".cg-res{padding-left:1.1rem;margin:0}.cg-res li{margin:.3rem 0}.cg-res li.bad{color:var(--bad)}
.tb-side{flex-wrap:wrap;justify-content:flex-end}.tb-row .apw-secret{gap:.3rem}
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for r in R:   # r[2] = done-marker: rs-review later adds a 🎞️ button inside this rule's text
        a, b = r[0], r[1]
        if b in s or (len(r) > 2 and r[2] in s): continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
