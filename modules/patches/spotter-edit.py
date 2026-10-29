"""✏️ Spotter question editor (user, 2026-10-29: "I want to modify pictures, modify text, add or delete questions"). In the
teacher card of the 🔬 Pathology Spotter: a list of every question (picture, stem, answer, ready / picture missing) with
✎ Edit and 🗑 Delete, and "+ New question". The form chooses the picture from the pictures of the Learn Practical topic
(teacher pictures and atlas pictures — never anything else), and edits the type, level, stem, five options (A–E), the
correct answer and the four explanation parts. A teacher also gets "✎ Edit this question" under the feedback in Practice
mode. Saved to Content practicalcfg/spotter like the import (in ✏️ Edit master draft: every group after ⬆ Publish draft).
Teacher pictures without an import key are referenced as "media:<id>". Added as a separate block that wraps Spotter (the
spotter patch's text is not edited, so both stay idempotent). Idempotent."""
import sys
R = [
("""/* ====================================================================== UTILITIES (kept: Explanation links here) */""",
 """/* ---------- ✏️ Spotter question editor (patch spotter-edit) ---------- */
const SpotterEdit = {
  /** Every picture of the Learn Practical topic that a question may use. */
  pool() {
    const t = Spotter.topic(); if (!t) return []; const out = [];
    (t.sections || []).forEach(s => {
      sectionMedia(s.id).forEach(m => { if (m && m.url && (m.type || 'image') === 'image') out.push({ ref: m.importKey ? { key: m.importKey } : { key: 'media:' + m.id }, url: m.url, caption: m.caption || '', section: s.id, heading: s.heading }); });
      let atlas = []; try { atlas = typeof ATLAS !== 'undefined' ? ATLAS.forSection(s.id) : []; } catch (e) { atlas = []; }   // a course without an atlas
      atlas.filter(x => x.embed).forEach(x => out.push({ ref: { atlas: x.id }, url: x.src, caption: x.dx || x.caption || '', section: s.id, heading: s.heading }));
    });
    return out;
  },
  same(a, b) { return !!(a && b) && ((a.key && a.key === b.key) || (a.atlas && a.atlas === b.atlas)); },
  async save(items, what) {
    this.keepOpen = true;
    const d = Object.assign({ v: 1, title: '' }, (State.practicalCfg && State.practicalCfg.spotter) || {});
    await saveDoc('practicalcfg', 'spotter', Object.assign({}, d, { items, editedAt: Date.now() }), { history: false, label: 'Before editing Spotter questions' });
    toast(what, 'ok'); Views.study.render();
  },
  async remove(it) {
    if (!(await confirmDialog('Delete this Spotter question? “' + seTrunc(it.stem, 90) + '”', { danger: true, okLabel: 'Delete' }))) return;
    await this.save(Spotter.all().filter(x => x.id !== it.id), 'Question deleted.');
  },
  /** The question form (new when it is null). */
  form(it) {
    const isNew = !it, q = JSON.parse(JSON.stringify(it || { id: 'sp-u' + uid('q').slice(2), type: 'diagnosis', level: 'core', stem: '', options: ['', '', '', '', ''], answer: 0, explanation: {} }));
    while (q.options.length < 5) q.options.push('');
    q.explanation = q.explanation || {};
    const pool = this.pool(); let pick = pool.find(p => this.same(p.ref, q)) || null;
    const picBox = el('div', { class: 'spe-pics' });
    const paintPics = () => { clear(picBox); pool.forEach(p => { const im = el('img', { alt: p.caption || 'Practical picture', loading: 'lazy' }); stImg(im, p.url);
      picBox.appendChild(el('button', { type: 'button', class: 'spe-pic' + (pick === p ? ' sel' : ''), title: p.heading + ' — ' + p.caption, onclick: () => { pick = p; paintPics(); } }, im, el('span', null, seTrunc(p.caption || p.heading, 60)))); }); };
    paintPics();
    const sel = (opts, v) => el('select', null, Object.entries(opts).map(([k, l]) => el('option', { value: k, selected: k === v }, l)));
    const type = sel(SPOTTER_TYPES, q.type), level = sel({ core: 'Core', hard: 'Hard', integrative: 'Integrative' }, q.level || 'core');
    const stem = el('textarea', { rows: 3, 'aria-label': 'Question stem' }, q.stem);
    let answer = q.answer;
    const optIn = q.options.map((o, k) => el('input', { type: 'text', value: o, 'aria-label': 'Option ' + LETTERS[k] }));
    const radios = q.options.map((o, k) => { const r = el('input', { type: 'radio', name: 'spe-ans', checked: k === answer, 'aria-label': 'Option ' + LETTERS[k] + ' is correct' }); r.addEventListener('change', () => { answer = k; }); return r; });
    const ex = {}; [['finding', '🔎 Decisive finding'], ['why', '✅ Why this answer'], ['distractor', '⚠ Tempting distractor'], ['fact', '💡 High-yield fact']].forEach(([k]) => { ex[k] = el('textarea', { rows: 2 }, q.explanation[k] || ''); });
    const msg = el('div', { class: 'small' });
    const body = el('div', { class: 'stack spe-form' },
      el('div', null, el('b', null, 'Picture'), el('span', { class: 'small muted' }, ' — only pictures of Learn → ' + (Spotter.topic() ? Spotter.topic().title : 'Practical') + ' (' + pool.length + ')'), picBox),
      el('div', { class: 'field-row' }, el('label', { class: 'field' }, 'Question type', type), el('label', { class: 'field' }, 'Level', level)),
      el('label', { class: 'field' }, 'Question (stem)', stem),
      el('div', null, el('b', null, 'Options — tick the correct one'), el('div', { class: 'stack' }, optIn.map((x, k) => el('label', { class: 'spe-opt' }, radios[k], el('span', { class: 'ol' }, LETTERS[k] + '.'), x)))),
      el('details', { open: true }, el('summary', null, el('b', null, 'Explanation (shown after the answer)')),
        el('div', { class: 'stack' }, el('label', { class: 'field' }, '🔎 Decisive finding', ex.finding), el('label', { class: 'field' }, '✅ Why this answer', ex.why), el('label', { class: 'field' }, '⚠ Tempting distractor', ex.distractor), el('label', { class: 'field' }, '💡 High-yield fact', ex.fact))),
      msg);
    openModal({ title: isNew ? '+ New Spotter question' : '✎ Edit Spotter question', body, wide: true, actions: [{ label: 'Cancel' }, { label: isNew ? 'Add question' : 'Save changes', primary: true, keepOpen: true, onClick: async (close) => {
      const options = optIn.map(x => x.value.trim());
      const err = !pick ? 'Choose the picture.' : !stem.value.trim() ? 'Write the question.' : options.some(o => !o) ? 'Fill in all five options.' : new Set(options.map(o => o.toLowerCase())).size < 5 ? 'Two options are the same.' : '';
      if (err) { msg.className = 'msg bad'; msg.textContent = err; return false; }
      const out = { id: q.id, type: type.value, level: level.value, stem: stem.value.trim(), options, answer, explanation: { finding: ex.finding.value.trim(), why: ex.why.value.trim(), distractor: ex.distractor.value.trim(), fact: ex.fact.value.trim() }, section: pick.section, kind: q.kind || '' };
      if (pick.ref.key) out.key = pick.ref.key; else out.atlas = pick.ref.atlas;
      const items = Spotter.all().slice(); const i = items.findIndex(x => x.id === q.id);
      if (i >= 0) items[i] = out; else items.push(out);
      close(true); await this.save(items, isNew ? 'Question added.' : 'Question saved.');
    } }] });
  },
  /** The list in the teacher card. */
  panel() {
    const all = Spotter.all();
    const rows = all.map((it, k) => { const pic = Spotter.picture(it); const im = el('img', { class: 'spe-thumb', alt: '' }); if (pic) stImg(im, pic.url);
      return el('tr', null, el('td', null, String(k + 1)), el('td', null, pic ? im : el('span', { class: 'badge warn' }, 'picture missing')),
        el('td', null, seTrunc(it.stem || '', 110)), el('td', null, Number.isInteger(it.answer) ? LETTERS[it.answer] : '?'),
        el('td', { class: 'nowrap' }, el('button', { class: 'btn btn-xs', 'data-a': 'spe-edit', onclick: () => this.form(it) }, '✎ Edit'), ' ', el('button', { class: 'btn btn-xs btn-danger', 'data-a': 'spe-del', onclick: () => this.remove(it) }, '🗑'))); });
    return el('div', { class: 'spe-panel mt1' },
      el('div', { class: 'row between' }, el('b', null, '✏️ Questions (' + all.length + ')'), el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'spe-new', onclick: () => this.form(null) }, '+ New question')),
      all.length ? el('div', { class: 'spe-tablewrap' }, el('table', { class: 'spe-table' }, el('thead', null, el('tr', null, ['#', 'Picture', 'Question', 'Answer', ''].map(h => el('th', null, h)))), el('tbody', null, rows)))
        : el('p', { class: 'small muted' }, 'No questions yet — import a file or add them one by one.'));
  },
  css() {
    if (document.getElementById('spe-css')) return;
    document.head.appendChild(el('style', { id: 'spe-css' },
      '.spe-pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.4rem;max-height:300px;overflow:auto;margin-top:.3rem;padding:.2rem}' +
      '.spe-pic{display:flex;flex-direction:column;gap:.2rem;padding:.25rem;border:1px solid var(--line,#d5dde7);border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:.72rem;text-align:left;color:inherit}' +
      '.spe-pic img{width:100%;height:76px;object-fit:cover;border-radius:5px;background:#0f1c2b}.spe-pic.sel{border-color:var(--teal,#0e9f9a);box-shadow:0 0 0 2px var(--teal,#0e9f9a)}' +
      '.spe-opt{display:flex;align-items:center;gap:.4rem}.spe-opt input[type=text]{flex:1}' +
      '.spe-tablewrap{max-height:420px;overflow:auto;margin-top:.4rem}.spe-table{width:100%;border-collapse:collapse;font-size:.85rem}.spe-table td,.spe-table th{padding:.3rem .4rem;border-bottom:1px solid var(--line,#e5e9f0);text-align:left;vertical-align:middle}' +
      '.spe-thumb{width:56px;height:42px;object-fit:cover;border-radius:4px;background:#0f1c2b}.spe-table .nowrap{white-space:nowrap}'));
  }
};
(function () {   // wraps the Spotter (patch spotter) without editing its text
  if (typeof Spotter === 'undefined') return;
  const pic0 = Spotter.picture.bind(Spotter);
  Spotter.picture = function (it) {   // teacher pictures without an import key: "media:<id>"
    if (it && typeof it.key === 'string' && it.key.indexOf('media:') === 0) {
      const t = this.topic(); if (!t) return null; const id = it.key.slice(6);
      for (const s of (t.sections || [])) { const m = sectionMedia(s.id).find(x => x && x.id === id && x.url); if (m) return { url: m.url, section: s.id }; }
      return null;
    }
    return pic0(it);
  };
  const card0 = Spotter.teacherCard.bind(Spotter);
  Spotter.teacherCard = function (ready) {
    SpotterEdit.css(); const c = card0(ready); c.appendChild(SpotterEdit.panel());
    if (SpotterEdit.keepOpen != null) c.open = SpotterEdit.keepOpen;   // stays as the teacher left it across repaints (saving repaints)
    c.addEventListener('toggle', () => { SpotterEdit.keepOpen = c.open; });
    return c;
  };
  const ex0 = Spotter.explain.bind(Spotter);
  Spotter.explain = function (it, pick) { const n = ex0(it, pick); if (Auth.isTeacher() && this.run && this.run.mode === 'practice') n.appendChild(el('div', { class: 'row mt1' }, el('button', { class: 'btn btn-xs', 'data-a': 'spe-edit-here', onclick: () => SpotterEdit.form(it) }, '✎ Edit this question'))); return n; };
})();

/* ====================================================================== UTILITIES (kept: Explanation links here) */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
