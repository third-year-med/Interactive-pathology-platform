"""⚡ Topic quizzes: the teacher chooses the number of questions per student and the minutes (user 2026-11-08; before: always
5 questions, 5 minutes). The ⚡ Topic quizzes window gets "Questions per student" (3–30, default 5) and "Minutes" (1–120,
default 1 per question). They are kept per group page (Store tq_count_v1), so one group can have 5 and another 10 (untick
"Also copy…" to change only this group). New quizzes use them; "Refresh the existing topic quizzes" also switches existing
quizzes to them (republished — submitted results are kept). A topic with fewer questions than chosen uses all it has (at
least 3) instead of being skipped. Wraps AssessUI.topicQuizPlan / topicQuizzesDialog / runTopicQuizzes and tqDescription —
the earlier patches' code is unchanged. Idempotent."""
import sys
CODE = r"""Views.assess = AssessUI;
/* ---------- ⚡ Topic quizzes: questions per student + minutes (patch tq-count) ---------- */
const TQ_MIN_Q = 3;
function tqCount() {
  const c = Store.get('tq_count_v1', null) || {}, n = Math.min(30, Math.max(TQ_MIN_Q, Math.round(Number(c.n) || 5)));
  return { n, min: Math.min(120, Math.max(1, Math.round(Number(c.min) || n))), minSet: !!c.minSet };
}
(function () {
  const d0 = tqDescription;
  tqDescription = function (TQ, x) { return d0({ n: Math.min(TQ.n, (x.pool || []).length || TQ.n), min: TQ.min }, x); };   // "7 random questions" when a topic has only 7
  const plan0 = AssessUI.topicQuizPlan, dlg0 = AssessUI.topicQuizzesDialog, run0 = AssessUI.runTopicQuizzes;
  AssessUI.topicQuizPlan = function () {
    const plan = plan0.apply(this, arguments), c = tqCount();
    plan.TQ.n = c.n; plan.TQ.min = c.min;
    plan.topics.forEach(x => { x.ok = x.pool.length >= TQ_MIN_Q; x.short = x.ok && x.pool.length < c.n; });
    return plan;
  };
  AssessUI.topicQuizzesDialog = async function () {
    const r = await dlg0.apply(this, arguments);
    try {
      const ms = document.querySelectorAll('.modal'), m = ms[ms.length - 1], body = m && m.querySelector('.tq'); if (!body || body.querySelector('[data-a=tq-n]')) return r;
      const c = tqCount(), reopen = () => { const x = m.querySelector('.modal-head .icon-btn'); if (x) x.click(); this.topicQuizzesDialog(); };
      const nIn = el('input', { type: 'number', min: String(TQ_MIN_Q), max: '30', step: '1', value: String(c.n), 'data-a': 'tq-n', style: 'width:5rem', 'aria-label': 'Questions per student' });
      const mIn = el('input', { type: 'number', min: '1', max: '120', step: '1', value: String(c.min), 'data-a': 'tq-min', style: 'width:5rem', 'aria-label': 'Minutes' });
      nIn.addEventListener('change', () => { const n = Math.min(30, Math.max(TQ_MIN_Q, Math.round(Number(nIn.value) || 5))); const cur = tqCount(); Store.set('tq_count_v1', { n, min: cur.minSet ? cur.min : n, minSet: cur.minSet }); reopen(); });
      mIn.addEventListener('change', () => { const cur = tqCount(); Store.set('tq_count_v1', { n: cur.n, min: Math.min(120, Math.max(1, Math.round(Number(mIn.value) || cur.n))), minSet: true }); reopen(); });
      body.insertBefore(el('div', { class: 'row', style: 'gap:1rem;flex-wrap:wrap;align-items:center;margin:0 0 .6rem' },
        el('label', { class: 'row', style: 'gap:.4rem' }, el('b', null, 'Questions per student:'), nIn),
        el('label', { class: 'row', style: 'gap:.4rem' }, el('b', null, 'Minutes:'), mIn),
        el('span', { class: 'small muted' }, 'Saved for this group’s page. For a different number in another group, untick “Also copy…” below and set it on that group’s page.')), body.firstChild);
      body.querySelectorAll('td span').forEach(s => { if (/^⏭ skipped — fewer than \d+ questions$/.test(s.textContent)) s.textContent = '⏭ skipped — fewer than ' + TQ_MIN_Q + ' questions'; });
      const plan = this.topicQuizPlan();
      body.querySelectorAll('tbody tr').forEach((tr, i) => { const x = plan.topics[i]; if (x && x.short && tr.cells[3]) tr.cells[3].appendChild(el('div', { class: 'small muted' }, 'uses all ' + x.pool.length + ' (fewer than ' + plan.TQ.n + ')')); });
      const upd = [...body.querySelectorAll('.cg-opt')].find(l => /Refresh the/.test(l.textContent)); if (upd) upd.appendChild(el('small', { class: 'muted' }, ' — also sets them to ' + c.n + ' questions, ' + c.min + ' minutes'));
    } catch (e) { console.warn('topic quiz numbers', e); }
    return r;
  };
  AssessUI.runTopicQuizzes = async function (plan, opt, say) {
    const TQ = plan.TQ;
    if (opt && opt.update) for (const x of plan.topics) {   // existing quizzes: the chosen numbers (the questions are refreshed by the original code)
      const a = x.ex; if (!a || !x.ok) continue;
      const n = Math.min(TQ.n, x.pool.length);   // a topic with fewer questions: all of them
      if (Number(a.poolCount) === n && Number((a.settings || {}).timeLimitMin) === TQ.min) continue;
      try {
        say('Topic ' + x.num + ': ' + n + ' questions, ' + TQ.min + ' minutes…');
        a.poolCount = n; a.mode = 'pool'; a.settings = Object.assign({}, a.settings || {}, { timeLimitMin: TQ.min }); a.description = tqDescription(TQ, x);
        assessLog(a, 'Updated', 'Topic quiz: ' + TQ.n + ' questions per student, ' + TQ.min + ' minutes');
        const p = await publishAssessment(a); if (!p.ok) throw new Error(p.error);
      } catch (e) { console.warn('topic quiz numbers', e); }
    }
    // the original code uses ONE number (TQ.n) for every topic; its progress line names the topic it works on next, so the
    // number is set to "chosen, or all of that topic's questions" per topic (a quiz may not ask for more than its pool has)
    const chosen = TQ.n, byNum = {}; plan.topics.forEach(x => { byNum[x.num] = x; });
    const say2 = (s) => { const m = /^Topic (\d+) of \d+:/.exec(String(s || '')), x = m && byNum[Number(m[1])]; TQ.n = x ? Math.min(chosen, x.pool.length) : chosen; return say(s); };
    try { return await run0.call(this, plan, opt, say2); } finally { TQ.n = chosen; }
  };
  const rep0 = AssessUI.topicQuizReport;
  if (rep0) AssessUI.topicQuizReport = function () {
    const r = rep0.apply(this, arguments);
    try { document.querySelectorAll('.modal li').forEach(li => { li.childNodes.forEach(n => { if (n.nodeType === 3 && /Skipped \(fewer than 5 questions\)/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace('fewer than 5', 'fewer than ' + TQ_MIN_Q); }); }); } catch (e) { /* ignore */ }
    return r;
  };
})();"""
R = [("""Views.assess = AssessUI;""", CODE)]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
