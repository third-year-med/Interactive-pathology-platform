"""Practical: student-facing tidy + serial practical numbers (user, 2026-11-16).
1. Students see no counts on the Practical pages ("109 questions", "30 stations", "14 cases") — hub rows and the Spotter home.
2. The Spotter EXAM is one attempt per student: after it, Exam mode is closed ("one attempt only") and the result page has no
   "New exam" (practice stays open). Teachers are not limited. The attempt is remembered in the student's browser
   (spotter_last_exam_v1, as the Spotter has always kept it) — a graded exam belongs in the Assessment tab.
3. Teacher workspace → "🔢 Number 1…N": the practicals get serial numbers — published ones first in their present order, then
   unpublished drafts — and the published ones are republished with the new number (the import numbers new practicals after
   any old drafts, e.g. Neoplasia (New) showed "PRACTICAL 16" for Case 1).
Wraps uxList, Spotter.home / start / results and Views.practical.render; no other patch's text is edited. Idempotent."""
import sys
R = [
("""/* ==========================================================================
   20_universal_edit.js — UNIVERSAL EDITOR for text, pictures, links and videos""",
 """/* ---------- Practical: student-facing tidy + serial numbers (patch prac-student-tidy) ---------- */
(function () {
  const student = () => (window.NEO_BOOT || {}).role === 'student';
  if (typeof uxList === 'function') {   // 1 · no counts for students
    const list0 = uxList;
    uxList = function (rows) { return list0(student() ? (rows || []).map(r => r && r.meta && /\\d+\\s+(question|station|case|image|picture)/i.test(r.meta) ? Object.assign({}, r, { meta: '' }) : r) : rows); };
  }
  if (typeof Spotter !== 'undefined') {   // 1 + 2 · Spotter home without counts; one exam
    const taken = () => student() && !!Store.get('spotter_last_exam_v1', null);
    const home0 = Spotter.home;
    Spotter.home = function (host) {
      const r = home0.apply(this, arguments); if (!student()) return r;
      const sec = host.querySelector('.spot-home'); if (!sec) return r;
      const p = sec.querySelector(':scope > p'); if (p && /\\d+\\s+question/.test(p.textContent)) p.textContent = 'Each question shows one picture and five options (A–E).';
      const pr = sec.querySelector('[data-a=spot-practice] span'); if (pr) pr.textContent = 'Feedback and explanation after each answer.';
      const ex = sec.querySelector('[data-a=spot-exam]');
      if (ex) { const sp = ex.querySelector('span');
        if (taken()) { ex.disabled = true; ex.classList.add('spot-taken'); if (sp) sp.textContent = 'You have taken the exam — one attempt only.'; }
        else if (sp) sp.textContent = 'One attempt only. Answers lock when submitted; score and review at the end.'; }
      return r;
    };
    const start0 = Spotter.start;
    Spotter.start = function (mode) {
      if (mode === 'exam' && taken()) { toast('You have already taken the Spotter exam — one attempt only.', 'info'); return; }
      return start0.apply(this, arguments);
    };
    const res0 = Spotter.results;
    Spotter.results = function (host) {
      const r = res0.apply(this, arguments);
      if (student()) host.querySelectorAll('.spot-result button').forEach(b => { if (/New exam/.test(b.textContent)) b.remove(); });
      return r;
    };
  }
  // 3 · serial practical numbers (teacher)
  async function pracRenumber(btn) {
    const pubIds = new Set((State.practicalPub || []).map(p => p.id));
    const ds = PracData.list(), order = ds.filter(d => pubIds.has(d.id)).concat(ds.filter(d => !pubIds.has(d.id)));
    const changed = []; order.forEach((d, i) => { if (d.number !== i + 1) { d.number = i + 1; changed.push(d); } });
    if (!changed.length) { toast('The practicals are already numbered 1–' + order.length + '.', 'ok'); return; }
    const pubN = changed.filter(d => pubIds.has(d.id)).length;
    if (!(await confirmDialog('Number the practicals 1–' + order.length + ': the published ones first, in their present order, then the unpublished drafts. ' +
      plural(pubN, 'published practical') + ' will be republished with the new number (any unpublished edits in them are published too).', { okLabel: 'Number 1–' + order.length }))) return;
    btn.disabled = true; const txt = btn.textContent;
    try {
      await PracData.saveMany(changed); let k = 0;
      for (const d of changed) if (pubIds.has(d.id)) { btn.textContent = 'Republishing ' + (++k) + ' of ' + pubN + '…'; await PracData.publish(PracData.get(d.id)); }
      toast('Practicals numbered 1–' + order.length + '.', 'ok');
    } finally { btn.disabled = false; btn.textContent = txt; Bus.emit('prac-changed'); }
  }
  const render0 = Views.practical.render;
  Views.practical.render = function () {
    const r = render0.apply(this, arguments);
    try {
      if (!Auth.isTeacher() || (this.params || [])[0]) return r;
      const h = [...document.querySelectorAll('#view-practical .prac-h2')].find(x => /Teacher workspace/.test(x.textContent));
      if (h && !h.parentNode.querySelector('[data-a=prac-renumber]')) { const b = el('button', { class: 'btn btn-sm', 'data-a': 'prac-renumber', title: 'Serial numbers 1…N' }, '🔢 Number 1…N'); b.addEventListener('click', () => pracRenumber(b)); h.parentNode.appendChild(b); }
    } catch (e) { }
    return r;
  };
  window.pracRenumber = pracRenumber;
})();

/* ==========================================================================
   20_universal_edit.js — UNIVERSAL EDITOR for text, pictures, links and videos"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
