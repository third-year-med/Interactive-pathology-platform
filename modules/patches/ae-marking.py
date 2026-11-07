"""✍ Marking corrections (user 2026-11-07; Portal.gs 2.41).
  • Matching questions whose right-hand answers repeat ("Carcinoma" twice) were marked by the POSITION of the chosen answer:
    choosing the other, identical "Carcinoma" counted as wrong. A pair is now correct when the chosen answer has the same
    text as the correct one (practice, local mode; the server side is Portal.gs 2.41 + the one-line Code.gs fix).
  • 📊 Results → ↻ Re-mark: recalculates every submitted attempt of the selected assessment on the server (fixed rule;
    the teacher's adjusted marks are kept) and lists what changed.
  • 📊 Results → a student's attempt → ✎ on each question: give a mark by hand (0, ¼, ½, ¾, 1) with a note, or go back to
    the automatic mark. The score, percentage and feedback email follow. Idempotent."""
import sys
CODE = r"""/* ---------- ✍ Marking corrections: ↻ Re-mark and ✎ adjust a mark (patch ae-marking; Portal.gs 2.41) ---------- */
Object.assign(ResultsUI, {
  remarkBtn(inf) {
    if (!inf || !inf.a || this.sel === RS_ALL || this.sel === RS_LEGACY || !Backend.isConfigured()) return null;
    return el('button', { class: 'btn btn-sm', 'data-a': 'rs-remark', title: 'Recalculate the marks of every submitted attempt of this assessment (your adjusted marks are kept)', onclick: () => this.remark(inf) }, '↻ Re-mark');
  },
  async remark(inf) {
    if (!(await confirmDialog('Re-mark every submitted attempt of “' + inf.title + '”? The marks are recalculated from the students’ saved answers with the current marking rules (for example, matching questions with repeated answers). Marks you adjusted by hand are kept. Students see the corrected score; send the feedback again if you want them to be told.', { okLabel: '↻ Re-mark' }))) return;
    const t = toast('Re-marking…', 'info', 60000);
    const r = await Backend.authedPost({ action: 'aeRemark', assessmentId: inf.a.id }, { timeout: 90000 });
    if (t && t.remove) t.remove();
    if (!(r && r.ok)) { toast(/unknown action/i.test((r && r.error) || '') ? 'The class server needs updating (Portal.gs 2.41).' : ((r && r.error) || 'Re-marking failed.'), 'bad', 7000); return; }
    await this.T().loadResults(true); this.render(this.box);
    const ch = r.changed || [];
    openModal({ title: '↻ Re-mark — ' + inf.title, body: el('div', { class: 'stack' },
      el('p', null, plural(r.checked, 'attempt') + ' checked · ' + (ch.length ? plural(ch.length, 'score') + ' corrected:' : 'no score changed.')),
      ch.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'data-table', 'data-a': 'rs-remark-list' }, el('thead', null, el('tr', null, ['Student', 'Before', 'After'].map(h => el('th', null, h)))),
        el('tbody', null, ch.map(c => el('tr', null, el('td', null, c.name || c.email), el('td', null, c.before + ' / ' + c.total), el('td', null, el('b', null, c.after + ' / ' + c.total))))))) : null,
      ch.length ? el('p', { class: 'small muted' }, 'To tell these students, select them in “Student results” and use ✉ Email selected.') : null),
      actions: [{ label: 'Close', primary: true }] });
  },
  adjustMark(r, a, q) {
    const auto = typeof a.autoMark === 'number' ? a.autoMark : a.mark, cur = a.override ? a.override.mark : null;
    const opts = [[1, 'Full mark (1)'], [0.75, '¾ mark (0.75)'], [0.5, '½ mark (0.5)'], [0.25, '¼ mark (0.25)'], [0, 'No mark (0)']];
    let pick = cur === null ? 'auto' : String(cur);
    const box = el('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Mark' });
    const radio = (v, label) => { const i = el('input', { type: 'radio', name: 'rs-adj', value: v, checked: pick === v }); i.addEventListener('change', () => { pick = v; }); return el('label', { class: 'row', style: 'gap:.4rem' }, i, label); };
    box.appendChild(radio('auto', 'Automatic mark (' + auto + ')'));
    opts.forEach(([v, l]) => box.appendChild(radio(String(v), l)));
    const note = el('input', { type: 'text', maxlength: '300', placeholder: 'Reason (optional) — e.g. answer correct, marking error', value: (a.override && a.override.note) || '' });
    const msg = el('div', { class: 'small' });
    openModal({ title: '✎ Adjust the mark — ' + (r.name || r.email), body: el('div', { class: 'stack rs-adj' },
      el('p', { class: 'small' }, el('b', null, 'Question: '), q ? (q.stem || '').slice(0, 300) : a.qid), box, el('label', { class: 'field' }, 'Note', note), msg),
      actions: [{ label: 'Cancel' }, { label: 'Save mark', primary: true, keepOpen: true, onClick: async (close) => {
        msg.className = 'small'; msg.textContent = 'Saving…';
        const x = await Backend.authedPost({ action: 'aeAdjustMark', attemptId: r.id, qid: a.qid, mark: pick === 'auto' ? null : Number(pick), note: note.value.trim() }, { timeout: 60000 });
        if (!(x && x.ok)) { msg.className = 'msg bad'; msg.textContent = /unknown action/i.test((x && x.error) || '') ? 'The class server needs updating (Portal.gs 2.41).' : ((x && x.error) || 'Could not save.'); return false; }
        close(true); document.querySelectorAll('.modal-back').forEach(m => m.remove());
        await this.T().loadResults(true); this.render(this.box);
        toast('Mark saved — score ' + x.before + ' → ' + x.score + ' / ' + x.total + '.', 'ok', 5000);
        const nr = this.results().find(y => y.id === r.id); if (nr) this.showStudent(nr);
      } }] });
  }
});
(function () {   // ✎ on each question of a student's attempt; adjusted marks shown as ✍
  const s0 = ResultsUI.showStudent;
  ResultsUI.showStudent = function (r) {
    const out = s0.apply(this, arguments);
    try {
      const modals = document.querySelectorAll('.modal'), m = modals[modals.length - 1], table = m && m.querySelector('.table-scroll table.data-table');
      if (!table || !r || !r.attempt) return out;
      const snap = {}; (r.snapshot || []).forEach(q => { snap[q.id] = q; });
      const canEdit = r.source === 'server' && Backend.isConfigured();
      const hr = table.querySelector('thead tr'); if (hr && canEdit) hr.appendChild(el('th', null, 'Mark'));
      table.querySelectorAll('tbody tr').forEach((tr, i) => {
        const a = (r.answers || [])[i]; if (!a) return;
        if (a.override && tr.cells[1]) { tr.cells[1].textContent = '✍ ' + a.mark; tr.cells[1].title = 'Adjusted by the teacher (automatic: ' + a.autoMark + ')' + (a.override.note ? ' — ' + a.override.note : ''); }
        if (canEdit) tr.appendChild(el('td', null, el('button', { class: 'btn btn-xs', 'data-a': 'rs-adjust', title: 'Adjust the mark of this question', onclick: () => this.adjustMark(r, a, snap[a.qid] || Q_BY_ID[a.qid]) }, '✎ ' + a.mark)));
      });
      if (canEdit) table.closest('.table-scroll').after(el('p', { class: 'small muted', style: 'margin:.3rem 0 0' }, '✎ gives a mark by hand (e.g. after a marking error); ✍ marks an adjusted mark. ↻ Re-mark (top of Results) recalculates the whole assessment.'));
    } catch (e) { console.warn('adjust marks', e); }
    return out;
  };
})();

/** remove an assessment definition + its versions from this device's copy of the course content (no server call) */"""
R = [
("""      oks = (q.pairs || []).map(function (_, k) { return Number(resp[k]) === k; });""",
 """      oks = (q.pairs || []).map(function (pr, k) { var v = resp[k]; if (v === undefined || v === null || v === '') return false; var c = q.pairs[Number(v)]; return Number(v) === k || (!!c && AE_normText(c.right) === AE_normText(pr.right)); });   // repeated answers count by text (patch ae-marking)"""),
("""        el('div', { class: 'row rs-actions' },""",
 """        el('div', { class: 'row rs-actions' }, this.remarkBtn ? this.remarkBtn(inf) : null,"""),
("""/** remove an assessment definition + its versions from this device's copy of the course content (no server call) */""", CODE),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
