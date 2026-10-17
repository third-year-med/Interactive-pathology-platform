"""Teacher Portal → 📝 Assessments → Assessment Library: ⚡ Topic quizzes — one quiz per topic, built from that topic's
practice questions: a pool from which each student gets 5 random questions (random order), 5 minutes, 1 attempt, score +
correct answers after submitting, a random password each; published, assigned to everyone, and copied to the teacher's
other groups (Portal.gs 2.21 aeCopyTo; random passwords there too). Topics with fewer than 5 questions are skipped and
reported; existing topic quizzes are kept (or refreshed with the current questions on request). Idempotent."""
import sys
R = [
("""      el('button', { class: 'btn', onclick: () => this.createFromFilterDialog() }, '⚡ Create from filter'),
""",
"""      el('button', { class: 'btn', onclick: () => this.createFromFilterDialog() }, '⚡ Create from filter'),
      this.pw ? el('button', { class: 'btn', 'data-a': 'topic-quizzes', title: 'One 5-question, 5-minute quiz per topic, for all your groups', onclick: () => this.topicQuizzesDialog() }, '⚡ Topic quizzes') : null,
"""),
("""  /** 📤 Copy to groups (Portal.gs 2.21): the same assessment in other groups of this module — each keeps its own results. */""",
"""  /** ⚡ Topic quizzes: one pool quiz per topic from its practice questions (5 random per student, 5 min, 1 attempt). */
  topicQuizPlan() {
    const TQ = { n: 5, min: 5 };
    const rev = new Set(State.revExcludeIds || []);
    return { TQ, topics: getTopics().map((t, i) => {
      const pool = QUESTIONS.filter(q => q.topic === t.id && q.type !== 'short' && !rev.has(q.id)).map(q => q.id);
      const ex = (State.assessments || []).find(a => a.autoTopic === t.id && a.status !== 'archived') || null;
      return { t, num: i + 1, pool, ex, ok: pool.length >= TQ.n };
    }) };
  },
  async topicQuizzesDialog() {
    const plan = this.topicQuizPlan(), TQ = plan.TQ;
    let targets = [];
    const first = plan.topics.find(x => x.ex);
    if (first) { const r = await Backend.authedPost({ action: 'aeCopyTargets', assessmentId: first.ex.id }, { timeout: 60000 }); if (r && r.ok) targets = r.targets; }
    const upd = el('input', { type: 'checkbox' });
    const cp = el('input', { type: 'checkbox', checked: true });
    const rows = plan.topics.map(x => el('tr', null, el('td', null, String(x.num)), el('td', null, x.t.title), el('td', { class: 'nowrap' }, String(x.pool.length)),
      el('td', { class: 'small' }, !x.ok ? el('span', { style: 'color:var(--bad)' }, '⏭ skipped — fewer than ' + TQ.n + ' questions') : x.ex ? '• exists (“' + x.ex.title + '”)' : el('b', { style: 'color:var(--ok)' }, '✓ new quiz'))));
    const nNew = plan.topics.filter(x => x.ok && !x.ex).length, nEx = plan.topics.filter(x => x.ok && x.ex).length;
    const body = el('div', { class: 'tq' },
      el('p', { style: 'margin-top:0' }, 'One quiz per topic, built from that topic’s practice questions: each student gets ', el('b', null, TQ.n + ' random questions'), ' (in random order) — ', el('b', null, TQ.min + ' minutes'), ', ', el('b', null, '1 attempt'), ', score and correct answers shown after submitting, ', el('b', null, 'a random password'), ' for each quiz. Published and assigned to everyone; students start a quiz only with its password.'),
      el('div', { class: 'table-scroll', style: 'max-height:18rem' }, el('table', { class: 'data-table' }, el('thead', null, el('tr', null, ['#', 'Topic', 'Questions', ''].map(h => el('th', null, h)))), el('tbody', null, rows))),
      el('div', { class: 'cg-opts' },
        el('label', { class: 'cg-opt' }, cp, ' Also copy them to all my other groups with this module', el('small', { class: 'muted' }, ' (each group: its own random passwords and results; a group where students already started a quiz keeps it)')),
        nEx ? el('label', { class: 'cg-opt' }, upd, ' Refresh the ' + nEx + ' existing topic quiz' + (nEx > 1 ? 'zes' : '') + ' with the current questions (republish)') : null),
      el('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Imported questions used here are marked “Formal Assessment eligible” (it adds them to no other assessment). This can take a few minutes — keep the page open.'));
    if (!nNew && !nEx) { openModal({ title: '⚡ Topic quizzes', body, actions: [{ label: 'Close', primary: true }] }); return; }
    openModal({ title: '⚡ Topic quizzes', body, wide: true, actions: [{ label: 'Cancel' }, { label: '⚡ Create ' + (nNew ? nNew + ' quiz' + (nNew > 1 ? 'zes' : '') : 'and update'), primary: true, keepOpen: true, onClick: async (close) => {
      const go = body.closest('.modal').querySelector('.modal-foot .btn-primary'); go.disabled = true;
      const prog = el('div', { class: 'msg info', role: 'status' }); body.appendChild(prog);
      const say = (s) => { prog.textContent = s; };
      const done = await this.runTopicQuizzes(plan, { update: upd.checked, copy: cp.checked, targets }, say);
      close(); this.render(this.box); this.topicQuizReport(done);
      return false;
    } }] });
  },
  async runTopicQuizzes(plan, opt, say) {
    const TQ = plan.TQ, out = { created: [], updated: [], kept: [], skipped: plan.topics.filter(x => !x.ok), failed: [], copies: null };
    const work = plan.topics.filter(x => x.ok);
    // imported questions in these pools become eligible for formal assessment (they are added to no other assessment)
    const extra = new Set(State.quizExtraIds || []), add = [];
    work.forEach(x => x.pool.forEach(id => { const q = Q_BY_ID[id]; if (q && q.imported && !extra.has(id)) add.push(id); }));
    if (add.length) { say('Marking ' + add.length + ' imported question(s) eligible…'); await persistQuizExtra(Array.from(new Set((State.quizExtraIds || []).concat(add)))); }
    await this.loadPrivate(true);
    const asgOf = id => (this.assignments || []).some(g => g.assessmentId === id && g.status === 'active');
    const settings = () => Object.assign(defaultAssessmentSettings(), { timeLimitMin: TQ.min, attemptsAllowed: 1, shuffleQuestions: true, shuffleOptions: true, showScore: true, showAnswers: true });
    const mine = [];
    for (let i = 0; i < work.length; i++) {
      const x = work[i]; say('Topic ' + x.num + ' of ' + plan.topics.length + ': ' + x.t.title + '…');
      try {
        let a = x.ex;
        if (a && !opt.update) { out.kept.push(x); mine.push(a); continue; }
        if (a) {
          const same = (a.questionIds || []).length === x.pool.length && x.pool.every(id => (a.questionIds || []).includes(id));
          if (!same) { a.questionIds = x.pool.slice(); a.mode = 'pool'; a.poolCount = TQ.n; assessLog(a, 'Updated', 'Topic quiz refreshed: ' + x.pool.length + ' questions'); const p = await publishAssessment(a); if (!p.ok) throw new Error(p.error); }
          out.updated.push(x);
        } else {
          a = newAssessment({ title: 'Topic ' + x.num + ' quiz — ' + x.t.title, kind: 'quiz', topic: x.t.id, autoTopic: x.t.id, mode: 'pool', poolCount: TQ.n, questionIds: x.pool.slice(),
            description: TQ.n + ' random questions from the ' + x.pool.length + ' practice questions of this topic · ' + TQ.min + ' minutes.', settings: settings() });
          assessLog(a, 'Created', 'Topic quiz (⚡ automatic) · pool of ' + x.pool.length);
          const p = await publishAssessment(a); if (!p.ok) throw new Error(p.error);
          out.created.push(x);
        }
        await Backend.flushPending();   // the class server needs the published version before the assignment
        if (!asgOf(a.id)) {
          const r = await AssessAPI.createAssignments([{ assessmentId: a.id, targetType: 'all', allowLate: false, note: 'Topic quiz' }]);
          if (!r || !r.created) throw new Error((r && r.results && r.results[0] && r.results[0].error) || (r && r.error) || 'could not assign');
        }
        if (!(this.pw && this.pw[a.id])) await this.setPw(a, { random: true, all: true });
        mine.push(a);
      } catch (e) { out.failed.push({ x, error: String(e && e.message || e) }); }
    }
    await this.loadPrivate(true);
    if (opt.copy && mine.length) {
      let targets = opt.targets;
      if (!targets.length) { const r = await Backend.authedPost({ action: 'aeCopyTargets', assessmentId: mine[0].id }, { timeout: 60000 }); targets = r && r.ok ? r.targets : []; }
      const st = targets.map(t => t.storage);
      out.copies = { groups: targets.map(t => ({ label: t.label, ok: 0, kept: 0, failed: 0 })) };
      for (let i = 0; i < mine.length && st.length; i++) {
        say('Copying to your other groups: ' + (i + 1) + ' of ' + mine.length + ' quizzes…');
        const r = await Backend.authedPost({ action: 'aeCopyTo', assessmentId: mine[i].id, targets: st, publish: true, assign: true, password: 'random' }, { timeout: 180000 });
        (r && r.ok ? r.results : st.map(s => ({ storage: s, ok: false }))).forEach(res => { const g = out.copies.groups[st.indexOf(res.storage)]; if (g) { if (res.ok) g.ok++; else if (res.kept) g.kept++; else g.failed++; } });
      }
    }
    return out;
  },
  topicQuizReport(o) {
    const li = (cls, txt) => el('li', { class: cls }, txt);
    const body = el('div', null,
      el('ul', { class: 'cg-res' },
        o.created.length ? li('ok', '✓ Created ' + o.created.length + ': ' + o.created.map(x => 'Topic ' + x.num).join(', ')) : null,
        o.updated.length ? li('ok', '↻ Refreshed ' + o.updated.length + ': ' + o.updated.map(x => 'Topic ' + x.num).join(', ')) : null,
        o.kept.length ? li('', '• Already there, kept: ' + o.kept.map(x => 'Topic ' + x.num).join(', ')) : null,
        o.skipped.length ? li('bad', '⏭ Skipped (fewer than 5 questions): ' + o.skipped.map(x => 'Topic ' + x.num + ' — ' + x.t.title + ' (' + x.pool.length + ')').join('; ')) : null,
        o.failed.map(f => li('bad', '✗ Topic ' + f.x.num + ': ' + f.error))),
      o.copies ? el('div', null, el('h4', { style: 'margin:.8rem 0 .3rem' }, 'Your other groups'),
        o.copies.groups.length ? el('ul', { class: 'cg-res' }, o.copies.groups.map(g => li(g.failed ? 'bad' : 'ok', (g.failed ? '✗ ' : '✓ ') + g.label + ' — ' + g.ok + ' copied' + (g.kept ? ', ' + g.kept + ' kept (students started)' : '') + (g.failed ? ', ' + g.failed + ' failed' : ''))))
          : el('p', { class: 'small muted' }, 'No other group with this module that you teach.')) : null,
      el('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Each quiz has its own random password (in every group): 🔑 Passwords → 👁 Show or 📋 Copy, then give it to the class when the quiz should start.'));
    openModal({ title: '⚡ Topic quizzes — done', body, wide: true, actions: [{ label: 'OK', primary: true }] });
  },
  /** 📤 Copy to groups (Portal.gs 2.21): the same assessment in other groups of this module — each keeps its own results. */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
