"""⏱ In-class quizzes stay open 5 hours + 🔁 Repeat for the class (user, 2026-11-21; Portal.gs 2.50). Neoplasia (New) Topic 12/13
quizzes disappeared from the students' list 1 hour after the first student started them (the group's ⚡ Topic quizzes setting was 1 h).
  • ⚡ Topic quizzes → "Close … hours after the first student starts": default 5; a smaller saved value (1–4) becomes 5 once
    (0 = never closes stays). Portal.gs 2.50 also counts any smaller server value as 5.
  • 📝 Assessment Library: under the quiz title (with "⏱ Reopen for a student"), "🔁 Repeat for the class" opens the quiz again for everybody — the 5 hours
    start again at the first new start (Portal.gs 2.50 aeAutoClose restart); earlier attempts and results are kept.
  • The Library table fits the screen: action buttons wrap into a compact block, the title column gets room (2026-11-21).
Needs tq-autoclose. Wraps AssessUI.render; no other patch's text is edited. Idempotent (the block is replaced by the current one)."""
import sys
HEAD = '/* ---------- ⏱ 5-hour quiz closing + 🔁 Repeat for the class (patch tq-autoclose-5h; Portal.gs 2.50) ---------- */'
ANCHOR = 'function openInQuestionBank(qid) {'   # right after the tq-autoclose block (which sits before the same line); AssessUI exists there
CODE = HEAD + r"""
(function () {
  if (typeof tqCloseHours !== 'function' || typeof AssessUI === 'undefined') return;
  const MIN = 5;
  try { const c = Store.get('tq_count_v1', null); if (c && c.close !== undefined && c.close !== null && Number(c.close) > 0 && Number(c.close) < MIN && !c.close5) { c.close = MIN; c.close5 = 1; Store.set('tq_count_v1', c); } } catch (e) { }
  const base = tqCloseHours;
  tqCloseHours = function () { const c = Store.get('tq_count_v1', null) || {}; if (c.close === undefined || c.close === null || isNaN(Number(c.close))) return MIN; const h = base(); return h > 0 ? Math.max(h, MIN) : 0; };
  // 2026-11-21 (user: "format the row so all are visible comfortably"): the Assessment Library fits the screen — the action
  // buttons wrap into a compact block instead of one long line off the right edge; the title column gets room.
  if (!document.getElementById('ae-lib-fit-css')) document.head.appendChild(el('style', { id: 'ae-lib-fit-css' }, `
    table.ae-lib-fit { width: 100%; }
    table.ae-lib-fit td { vertical-align: top; }
    table.ae-lib-fit td.ae-lib-title { min-width: 13rem; }
    table.ae-lib-fit td.ae-lib-actions { white-space: normal; min-width: 14rem; max-width: 18rem; }
    table.ae-lib-fit td.ae-lib-actions .btn, table.ae-lib-fit td.ae-lib-title .btn { margin: .12rem .12rem 0 0; }
    table.ae-lib-fit td.ae-lib-date { white-space: normal; min-width: 5.5rem; }
    @media (max-width: 700px) { table.ae-lib-fit td.ae-lib-title { min-width: 10rem; } table.ae-lib-fit td.ae-lib-actions { min-width: 11rem; } }`));
  const fit = root => {
    (root || document).querySelectorAll('.table-scroll table.data-table').forEach(t => {
      const hs = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
      if (hs.indexOf('Assessment') < 0 || hs.indexOf('Assignments') < 0) return;
      t.classList.add('ae-lib-fit');
      const iT = hs.indexOf('Assessment'), iU = hs.indexOf('Updated');
      t.querySelectorAll('tbody tr').forEach(tr => { const c = tr.cells; if (c.length < hs.length) return;
        c[iT].classList.add('ae-lib-title'); if (iU >= 0) c[iU].classList.add('ae-lib-date'); c[c.length - 1].classList.add('ae-lib-actions'); c[c.length - 1].classList.remove('nowrap'); });
    });
  };
  const ren0 = AssessUI.render;
  AssessUI.render = async function (box) {
    const r = await ren0.apply(this, arguments);
    try { fit(box || this.box); } catch (e) { }
    try {
      if (!Backend.isConfigured()) return r;
      const p = await Backend.authedPost({ action: 'aePwList' }, { timeout: 30000 }); const ac = (p && p.ok && p.autoClose) || {};
      (box || this.box || document).querySelectorAll('tr [data-a=ac-reopen]').forEach(btn => {
        const tr = btn.closest('tr'); if (!tr || tr.querySelector('[data-a=ac-repeat]')) return;
        const cb = tr.querySelector('input[type=checkbox][aria-label^="Select "]'); if (!cb) return;
        const title = cb.getAttribute('aria-label').slice(7), a = (State.assessments || []).find(x => x.title === title && ac[x.id]); if (!a) return;
        const h = Math.max(Number(ac[a.id].h) || MIN, MIN);
        tr.querySelectorAll('.small.muted').forEach(d => { if (/^⏱ closes \d+(\.\d+)? h after the first student starts$/.test(d.textContent)) d.textContent = '⏱ closes ' + h + ' h after the first student starts' + (ac[a.id].since ? ' · repeated ' + new Date(Number(ac[a.id].since)).toLocaleString() : ''); });
        // 2026-11-21 (user: "cannot find"): the last cell is off-screen on a wide table → both buttons go under the title, next to the badge
        const rp = el('button', { class: 'btn btn-xs', 'data-a': 'ac-repeat', title: 'Open it again for the whole class', onclick: () => this.repeatForClass(a, h) }, '🔁 Repeat for the class');
        const cell = tr.cells[1], row = el('div', { class: 'row', style: 'gap:.3rem;flex-wrap:wrap;margin-top:.3rem' });
        if (cell) { cell.appendChild(row); row.appendChild(rp); row.appendChild(btn); } else btn.after(rp);
      });
    } catch (e) { console.warn('repeat for the class', e); }
    return r;
  };
  AssessUI.repeatForClass = async function (a, h) {
    if (!(await confirmDialog('Repeat “' + a.title + '” for the whole class? It opens again for every student — also those who already took it — and closes ' + h + ' hours after the first student starts it again. Earlier attempts and results are kept.', { okLabel: '🔁 Repeat' }))) return;
    const r = await Backend.authedPost({ action: 'aeAutoClose', assessmentIds: [a.id], hours: h, restart: true }, { timeout: 30000 });
    if (r && r.ok && r.autoClose && r.autoClose[a.id] && r.autoClose[a.id].since) { toast('“' + a.title + '” is open again for the class (' + h + ' h after the first new start).', 'ok', 7000); this.render(this.box); }
    else if (r && r.ok) toast('The class server needs updating (Portal.gs 2.50) to repeat a quiz.', 'warn', 8000);
    else toast((r && r.error) || 'Could not repeat it.', 'bad', 6000);
  };
})();

"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if 'patch tq-autoclose' not in s or ANCHOR not in s:
        print(path, 'skipped (no tq-autoclose / anchor)'); continue
    if HEAD in s:
        a = s.index(HEAD); b = s.index(ANCHOR, a)
        if s[a:b] != CODE: s = s[:a] + CODE + s[b:]; n += 1
    else:
        assert s.count(ANCHOR) == 1, (path, 'anchor'); s = s.replace(ANCHOR, CODE + ANCHOR); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
