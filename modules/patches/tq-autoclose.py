"""⏱ In-class quizzes close by themselves (user 2026-11-10; Portal.gs 2.43). A student took the 3 November class quiz on
9 November. ⚡ Topic quizzes gets "Close … hours after the first student starts" (default 3; 0 = never), kept per group page
with the other numbers (tq_count_v1.close). Running Topic quizzes sets it on this group's topic quizzes (aeAutoClose) BEFORE
they are copied, so 📤 copies to other groups carry it. After the closing time the server refuses new starts and late
submits (Portal.gs 2.43); the Assessment Library shows "⏱ closes N h after the first start" on such a quiz with a
"Reopen for a student" button (aeReopen). Needs tq-count. Idempotent."""
import sys
CODE = r"""/* ---------- ⏱ In-class quizzes close by themselves (patch tq-autoclose; Portal.gs 2.43) ---------- */
function tqCloseHours() { const c = Store.get('tq_count_v1', null) || {}; const h = Number(c.close); return c.close === undefined || c.close === null || isNaN(h) ? 3 : Math.min(720, Math.max(0, h)); }
(function () {
  const dlg0 = AssessUI.topicQuizzesDialog, run0 = AssessUI.runTopicQuizzes, ren0 = AssessUI.render;
  AssessUI.topicQuizzesDialog = async function () {
    const r = await dlg0.apply(this, arguments);
    try {
      const ms = document.querySelectorAll('.modal'), m = ms[ms.length - 1], body = m && m.querySelector('.tq'); if (!body || body.querySelector('[data-a=tq-close]')) return r;
      const h = tqCloseHours();
      const inp = el('input', { type: 'number', min: '0', max: '720', step: '1', value: String(h), 'data-a': 'tq-close', style: 'width:5rem', 'aria-label': 'Close after hours' });
      inp.addEventListener('change', () => { const c = Store.get('tq_count_v1', null) || {}; c.close = Math.min(720, Math.max(0, Math.round(Number(inp.value) || 0))); Store.set('tq_count_v1', c); const x = m.querySelector('.modal-head .icon-btn'); if (x) x.click(); this.topicQuizzesDialog(); });
      const row = body.querySelector('[data-a=tq-n]') ? body.querySelector('[data-a=tq-n]').closest('.row') : null;
      const line = el('div', { class: 'row', style: 'gap:.4rem;flex-wrap:wrap;align-items:center;margin:0 0 .6rem' },
        el('label', { class: 'row', style: 'gap:.4rem' }, el('b', null, '⏱ Close'), inp, el('b', null, 'hours after the first student starts')),
        el('span', { class: 'small muted' }, h ? 'Then nobody else can start or submit it — absent students cannot take it later. 0 = never closes.' : 'Never closes (0).'));
      if (row) row.after(line); else body.insertBefore(line, body.firstChild);
    } catch (e) { console.warn('topic quiz closing', e); }
    return r;
  };
  AssessUI.runTopicQuizzes = async function (plan, opt, say) {
    const h = tqCloseHours(), setAll = async () => {
      const ids = (State.assessments || []).filter(a => a.autoTopic && a.status !== 'archived').map(a => a.id);
      if (!ids.length || !Backend.isConfigured()) return;
      const r = await Backend.authedPost({ action: 'aeAutoClose', assessmentIds: ids, hours: h }, { timeout: 60000 });
      if (!(r && r.ok)) toast(/unknown action/i.test((r && r.error) || '') ? 'The class server needs updating (Portal.gs 2.43) for quizzes to close by themselves.' : 'The closing time could not be saved: ' + ((r && r.error) || 'network'), 'warn', 8000);
    };
    if (!(opt && opt.copy)) { const out = await run0.apply(this, arguments); await setAll(); return out; }
    // 1 · this group (no copies yet) → 2 · its closing time → 3 · copies to the other groups carry it
    const out = await run0.call(this, plan, Object.assign({}, opt, { copy: false }), say);
    say('Setting the closing time…'); await setAll();
    const plan2 = this.topicQuizPlan(), out2 = await run0.call(this, plan2, Object.assign({}, opt, { update: false, copy: true }), say);
    out.copies = out2.copies; return out;
  };
  AssessUI.render = async function (box) {
    const r = await ren0.apply(this, arguments);
    try {
      if (!Backend.isConfigured()) return r;
      const p = await Backend.authedPost({ action: 'aePwList' }, { timeout: 30000 }); const ac = (p && p.ok && p.autoClose) || {};
      if (!Object.keys(ac).length) return r;
      (box || this.box || document).querySelectorAll('tr input[type=checkbox][aria-label^="Select "]').forEach(cb => {
        const title = cb.getAttribute('aria-label').slice(7), a = (State.assessments || []).find(x => x.title === title && ac[x.id]); if (!a) return;
        const tr = cb.closest('tr'), cell = tr && tr.cells[1], last = tr && tr.cells[tr.cells.length - 1]; if (!cell || tr.querySelector('[data-a=ac-reopen]')) return;
        cell.appendChild(el('div', { class: 'small muted' }, '⏱ closes ' + ac[a.id].h + ' h after the first student starts'));
        if (last) last.appendChild(el('button', { class: 'btn btn-xs', 'data-a': 'ac-reopen', title: 'Let one student take it after it closed', onclick: () => this.reopenFor(a) }, '⏱ Reopen for a student'));
      });
    } catch (e) { console.warn('quiz closing badges', e); }
    return r;
  };
  AssessUI.reopenFor = async function (a) {
    const id = await promptDialog('Reopen “' + a.title + '” for one student', 'Student ID', { placeholder: 'e.g. 2240400028', okLabel: 'Next' }); if (!id) return;
    const hrs = await promptDialog('Reopen for ' + id, 'For how many hours?', { type: 'number', value: '2', okLabel: 'Reopen' }); if (hrs === null) return;
    const r = await Backend.authedPost({ action: 'aeReopen', assessmentId: a.id, studentId: id.trim(), hours: Number(hrs) || 2 }, { timeout: 30000 });
    if (r && r.ok) toast('Reopened for ' + id.trim() + ' for ' + (Number(hrs) || 2) + ' h — they can start it with the quiz password.', 'ok', 6000); else toast((r && r.error) || 'Could not reopen it.', 'bad', 6000);
  };
})();
function openInQuestionBank(qid) {"""
R = [("""function openInQuestionBank(qid) {""", CODE)]
MARK = '(patch tq-autoclose; Portal.gs 2.43)'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if MARK in s: print(path, 'changes: 0 (already applied)'); continue   # a later patch may insert next to this one's text
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
