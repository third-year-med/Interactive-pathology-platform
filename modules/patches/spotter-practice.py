"""🧪 Spotter Practice set vs 📝 exam-only questions (user, 2026-11-14: "too much for students to practice … keep a small set
for practice and use the rest for exams"). A Spotter question marked `practice: true` is in 🧪 Practice; once ANY question of
the set is marked, Practice uses only the marked ones and the others are exam-only. 📝 Exam mode still draws from ALL
questions (one per picture, random). A set without marks (every other module, older files) behaves exactly as before.
The teacher's question list gets a Use column (🧪 Practice / 📝 Exam only, one click to switch); editing a question keeps
its mark; a new question starts in Practice. The import keeps the field. Wraps Spotter.start / home / teacherCard and
SpotterEdit.save / panel; no other patch's text is edited. Idempotent."""
import sys
R = [
("""/* ====================================================================== UTILITIES (kept: Explanation links here) */""",
 """/* ---------- 🧪 Spotter practice set (patch spotter-practice) ---------- */
(function () {
  if (typeof Spotter === 'undefined' || typeof SpotterEdit === 'undefined') return;
  const marked = () => Spotter.all().some(it => it && it.practice === true);
  const inPractice = it => !marked() || (it && it.practice === true);
  Spotter.practiceReady = function () { return this.ready().filter(inPractice); };
  const start0 = Spotter.start;
  Spotter.start = function (mode) {
    if (mode === 'exam' || !marked()) return start0.call(this, mode);
    const r0 = this.ready; this.ready = () => r0.call(this).filter(inPractice);
    try { return start0.call(this, mode); } finally { this.ready = r0; }
  };
  const home0 = Spotter.home;
  Spotter.home = function (host) {
    const r = home0.apply(this, arguments);
    if (marked()) { const b = host.querySelector('[data-a=spot-practice] span'); if (b) b.textContent = plural(this.practiceReady().length, 'practice question') + ' — feedback and explanation after each answer.'; }
    return r;
  };
  const card0 = Spotter.teacherCard;
  Spotter.teacherCard = function (ready) {
    const c = card0.apply(this, arguments); const sum = c.querySelector('summary');
    if (sum && marked()) { const p = ready.filter(inPractice).length; sum.appendChild(el('span', { class: 'spp-sum' }, ' · 🧪 ' + p + ' in Practice · 📝 ' + (ready.length - p) + ' exam-only')); }
    return c;
  };
  const save0 = SpotterEdit.save;
  SpotterEdit.save = function (items, what) {
    const old = new Map(Spotter.all().map(x => [x.id, x])), on = marked();
    items = items.map(x => {
      if (!x || x.practice !== undefined) return x;
      const o = old.get(x.id);
      if (o && o.practice !== undefined) return Object.assign({}, x, { practice: o.practice });   // the editor rebuilds the question: keep its mark
      return o || !on ? x : Object.assign({}, x, { practice: true });                              // a new question starts in Practice
    });
    return save0.call(this, items, what);
  };
  SpotterEdit.setPractice = function (it, val) {
    const on = marked();
    const items = Spotter.all().map(x => x.id === it.id ? Object.assign({}, x, { practice: val }) : (!on && !val ? Object.assign({}, x, { practice: true }) : x));
    return save0.call(this, items, val ? 'In 🧪 Practice now.' : 'Exam-only now (📝 Exam mode only).');
  };
  const panel0 = SpotterEdit.panel;
  SpotterEdit.panel = function () {
    const box = panel0.apply(this, arguments), all = Spotter.all();
    const hr = box.querySelector('.spe-table thead tr'); if (hr) hr.insertBefore(el('th', null, 'Use'), hr.lastElementChild);
    box.querySelectorAll('.spe-table tbody tr').forEach((tr, k) => {
      const it = all[k]; if (!it) return; const p = inPractice(it);
      tr.insertBefore(el('td', null, el('button', { class: 'btn btn-xs' + (p ? ' btn-primary' : ''), 'data-a': 'spe-practice', title: p ? 'Click: exam-only' : 'Click: back in Practice',
        onclick: () => this.setPractice(it, !p) }, p ? '🧪 Practice' : '📝 Exam only')), tr.lastElementChild);
    });
    return box;
  };
})();

/* ====================================================================== UTILITIES (kept: Explanation links here) */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
