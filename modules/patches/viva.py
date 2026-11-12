"""🎓 Viva Examination — its own main tab (user 2026-11-11; Portal.gs 2.45): Learn · Review · Practical · Video Lectures ·
Viva · My Progress. Topic-based oral examination with a server-side bank (priv:vivabank, imported by the Admin from a
neo-viva-bank file in ✏️ Edit master draft — never in the page source). Every question: max mark, expected points with
marks, model answer, examiner notes, follow-up questions with answers, level, type, optionally an existing picture
(atlas registry or syllabus figure).
  • Practice — one topic, question by question; the student answers (not recorded), reveals the model answer + rubric
    and can tick the points they had (their own feedback). Nothing is recorded.
  • Mock Viva — one topic, 5 random questions × 5 marks (25): every answer is submitted first, then the model answers
    and rubrics appear and the student marks each expected point (full / half / none) — no keyword "auto-marking".
    Result: score, %, what was right, what was missed, what to revise (Learn links); recorded as SELF-ASSESSED.
  • Examiner Mode (teachers) — one student, one topic or several (the whole module); the examiner picks or draws
    questions, sees model answers, rubric and follow-ups, marks each point or types the mark, comments; recorded as
    EXAMINER-MARKED. 📊 Viva results (teachers): list, summary per topic / student, details, CSV.
Applied only to the modules in VIVA_MODULES (pilot: Inflammation (New)); other modules are skipped. Idempotent."""
import sys, re
VIVA_MODULES = ['inflnew']
CODE = r"""/* ==========================================================================
   🎓 Viva Examination (patch viva; Portal.gs 2.45) — its own main tab (#/viva)
   ========================================================================== */
const VIVA_FORMAT = 'neo-viva-bank', VIVA_MOCK_N = 5;
const VIVA_LEVEL = { basic: ['Basic', 1], intermediate: ['Intermediate', 2], advanced: ['Advanced', 3] };
const VIVA_TYPE = { definition: 'Definition & concept', mechanism: 'Mechanism & pathogenesis', process: 'Pathological process', compare: 'Compare & contrast',
  morphology: 'Morphology', clinical: 'Clinico-pathological correlation', why: 'Why / how', scenario: 'Clinical scenario', image: 'Picture-based' };
function vivaNum(v) { return String(Math.round(Number(v || 0) * 10) / 10); }
function vivaTopicLabel(tid) { const n = topicNum(tid); return (n ? 'Topic ' + n + ' — ' : '') + topicTitle(tid); }
/** the picture of a picture-based question: an atlas registry image or a syllabus figure, with its own credit */
function vivaPicture(q) {
  const im = q && q.image; if (!im) return null;
  if (im.fig && FIGURES[im.fig]) { const f = FIGURES[im.fig];
    return el('figure', { class: 'vv-pic' }, el('img', { src: svgDataUri(f.svg), alt: f.title || 'Figure' }), el('figcaption', { class: 'small muted' }, (im.hideCaption ? '' : (f.title || '') + ' · ') + (f.credit || ''))); }
  const rec = im.atlas && (DATA.images || []).find(x => x.id === im.atlas); if (!rec) return null;
  return el('figure', { class: 'vv-pic' }, atlasImgEl(rec, 'Picture for this question', true), el('figcaption', { class: 'small muted' }, atlasCreditEl(rec)));
}
Views.viva = {
  items: null, teacher: false, canEdit: false, loading: false, err: '', screen: 'home', mode: 'practice', run: null, results: null, mine: null, f: { q: '', mode: '', topic: '' },
  show() { this.render(); if (!this.items && !this.loading) this.load(); },
  refresh() { this.render(); },
  async load() {
    this.loading = true; this.err = ''; this.render();
    const r = Backend.isConfigured() ? await Backend.rawPost({ action: 'vbList' }, { timeout: 60000 }) : { ok: false, code: 'config' };
    this.loading = false;
    if (r && r.ok) { this.items = r.items || []; this.teacher = !!r.teacher; this.canEdit = !!r.canEdit; }
    else this.err = !r || r.code === 'config' ? 'The viva examination is on the class server — it is not available in this offline copy.'
      : /unknown action/i.test(r.error || '') || r.code === 'outdated' ? 'The class server needs updating (Portal.gs 2.45) before the viva can open — tell your teacher.' : (r.error || 'The viva bank could not be loaded.');
    this.render();
  },
  isTeacher() { return this.teacher && Auth.isTeacher(); },
  bank(tids) { const set = new Set(tids); return (this.items || []).filter(q => set.has(q.topic)).sort((a, b) => ((VIVA_LEVEL[a.level] || [0, 2])[1] - (VIVA_LEVEL[b.level] || [0, 2])[1]) || String(a.id).localeCompare(String(b.id))); },
  css() {
    if (document.getElementById('vv-css')) return;
    document.head.appendChild(el('style', { id: 'vv-css' },
      '.vv-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem;margin:.6rem 0 1rem}' +
      '.vv-mode{border:2px solid var(--line,#d5dde7);border-radius:12px;background:#fff;padding:.75rem .85rem;text-align:left;cursor:pointer;font:inherit;color:inherit}' +
      '.vv-mode.on{border-color:var(--teal,#0f766e);box-shadow:0 0 0 3px rgba(15,118,110,.15)}.vv-mode b{display:block;font-size:1.02rem;color:var(--navy,#0b2340)}.vv-mode span{font-size:.82rem;color:var(--muted,#5b6778)}' +
      '.vv-topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.6rem}' +
      '.vv-topic{display:flex;gap:.6rem;align-items:center;border:1px solid var(--line,#d5dde7);border-radius:10px;background:#fff;padding:.6rem .7rem}' +
      '.vv-topic .n{flex:0 0 2.1rem;height:2.1rem;border-radius:999px;background:#e6f5f4;color:#0f766e;font-weight:700;display:flex;align-items:center;justify-content:center}' +
      '.vv-topic .t{flex:1;min-width:0}.vv-topic .t b{display:block;font-size:.93rem;line-height:1.3}.vv-topic .t small{color:var(--muted,#5b6778)}' +
      '.vv-bar{position:sticky;top:0;z-index:5;background:#f7fafc;border:1px solid var(--line,#d5dde7);border-radius:12px;padding:.55rem .75rem;margin:.4rem 0 .8rem;display:flex;flex-wrap:wrap;gap:.35rem .9rem;align-items:center}' +
      '.vv-chip{border-radius:999px;padding:.08rem .6rem;font-size:.78rem;font-weight:700;background:#eef3f9;color:var(--navy,#0b2340)}.vv-chip.practice{background:#e6f5f4;color:#0f766e}.vv-chip.mock{background:#fff4e0;color:#8a5a00}.vv-chip.examiner{background:#f0e9ff;color:#5b21b6}' +
      '.vv-prog{flex:1 1 140px;height:.45rem;background:#e3e9f0;border-radius:999px;overflow:hidden;min-width:100px}.vv-prog i{display:block;height:100%;background:var(--teal,#0f766e)}' +
      '.vv-q{border:1px solid var(--line,#d5dde7);border-radius:12px;background:#fff;padding:.9rem 1rem;margin-bottom:.8rem}.vv-q h3{margin:.1rem 0 .5rem;font-size:1.08rem;line-height:1.45;color:var(--navy,#0b2340)}' +
      '.vv-meta{display:flex;flex-wrap:wrap;gap:.3rem;font-size:.75rem;margin-bottom:.35rem}.vv-meta span{background:#eef3f9;border-radius:999px;padding:.05rem .5rem}' +
      '.vv-q textarea{width:100%;min-height:7rem;font:inherit;padding:.55rem;border:1px solid var(--line,#c9d2dc);border-radius:8px;box-sizing:border-box}' +
      '.vv-model{background:#f3faf9;border-left:4px solid var(--teal,#0f766e);border-radius:8px;padding:.6rem .8rem;margin:.6rem 0;white-space:pre-wrap;line-height:1.55}' +
      '.vv-yours{background:#f7f8fa;border-left:4px solid #9aa7b5;border-radius:8px;padding:.5rem .8rem;margin:.4rem 0;white-space:pre-wrap}' +
      '.vv-rub{width:100%;border-collapse:collapse;margin:.5rem 0}.vv-rub td{border-top:1px solid #e3e9f0;padding:.4rem .3rem;vertical-align:top}.vv-rub td.m{width:3.2rem;text-align:center;font-weight:700;white-space:nowrap}.vv-rub td.s{width:9.5rem;white-space:nowrap}' +
      '.vv-seg{display:inline-flex;border:1px solid #c9d2dc;border-radius:8px;overflow:hidden}.vv-seg button{border:0;background:#fff;padding:.3rem .55rem;font:inherit;font-size:.82rem;cursor:pointer;min-width:2.4rem}.vv-seg button+button{border-left:1px solid #c9d2dc}' +
      '.vv-seg button.on.full{background:#dcf3e6;color:#1b7f3b;font-weight:700}.vv-seg button.on.half{background:#fff4e0;color:#8a5a00;font-weight:700}.vv-seg button.on.none{background:#fde8e8;color:#b42318;font-weight:700}' +
      '.vv-fu{border:1px dashed #c9d2dc;border-radius:8px;padding:.45rem .7rem;margin:.35rem 0}.vv-fu summary{cursor:pointer;font-weight:600}' +
      '.vv-pic{margin:.4rem 0 .7rem;text-align:center}.vv-pic img{max-width:100%;max-height:440px;border-radius:8px;border:1px solid #e3e9f0}' +
      '.vv-score{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center;margin:.4rem 0 1rem}.vv-big{font-size:2rem;font-weight:800;color:var(--navy,#0b2340)}' +
      '.vv-ok{color:#1b7f3b}.vv-miss{color:#b42318}.vv-tbl{width:100%;border-collapse:collapse;font-size:.9rem}.vv-tbl th,.vv-tbl td{border-bottom:1px solid #e3e9f0;padding:.4rem .35rem;text-align:left;vertical-align:top}' +
      '.vv-nav{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:space-between;margin-top:.6rem}' +
      '@media(max-width:600px){.vv-rub td.s{width:auto}.vv-rub tr{display:grid;grid-template-columns:1fr auto}.vv-rub td.s{grid-column:1/-1}.vv-q{padding:.75rem}.vv-big{font-size:1.6rem}}'));
  },
  go(screen) { this.screen = screen; this.render(); try { document.getElementById('view-viva').scrollIntoView({ block: 'start' }); } catch (e) { } },
  render() {
    const v = document.getElementById('view-viva'); if (!v) return; clear(v); this.css();
    const page = el('div', { class: 'page ux-page' }); v.appendChild(page);
    page.appendChild(uxPageHead('viva', 'Viva Examination', 'Oral examination by topic: practise, sit a mock viva, or be examined by your teacher.'));
    if (this.loading && !this.items) { page.appendChild(el('p', { class: 'muted' }, 'Loading the viva bank…')); return; }
    if (this.err) { page.appendChild(el('div', { class: 'msg warn' }, this.err, ' ', el('button', { class: 'btn btn-sm', onclick: () => this.load() }, '↻ Try again'))); return; }
    const S = { home: this.home, practice: this.practice, mock: this.mockRun, mockmark: this.mockMark, mockres: this.mockResult, exsetup: this.exSetup, exam: this.examRun, results: this.resultsPage, mine: this.minePage }[this.screen] || this.home;
    S.call(this, page);
  },
  /** the header bar of a running viva: module · topic(s) · mode · question n of N · max marks · progress */
  bar(mode, topics, i, n, max, extra) {
    const M = { practice: '🗣 Practice — not recorded', mock: '📝 Mock Viva — self-assessed', examiner: '🧑‍⚕️ Examiner Mode' };
    return el('div', { class: 'vv-bar', role: 'status' }, el('b', null, COURSE.title || 'Module'), el('span', { class: 'small' }, topics),
      el('span', { class: 'vv-chip ' + mode }, M[mode]), n ? el('span', { class: 'small' }, el('b', null, 'Question ' + (i + 1) + ' of ' + n)) : null, max ? el('span', { class: 'small' }, 'Max ' + vivaNum(max) + ' marks') : null,
      n ? el('div', { class: 'vv-prog', 'aria-label': 'Progress' }, el('i', { style: { width: Math.round(100 * (i + 1) / n) + '%' } })) : null, extra || null);
  },
  home(page) {
    const T = getTopics(), cnt = {}; (this.items || []).forEach(q => { cnt[q.topic] = (cnt[q.topic] || 0) + 1; });
    const total = (this.items || []).length, mode = this.mode, teacher = this.isTeacher();
    const card = (k, t, d) => el('button', { type: 'button', class: 'vv-mode' + (mode === k ? ' on' : ''), 'aria-pressed': String(mode === k), 'data-mode': k, onclick: () => { this.mode = k; this.render(); } }, el('b', null, t), el('span', null, d));
    page.appendChild(el('div', { class: 'vv-modes' },
      card('practice', '🗣 Practice', 'One topic, question by question. Answer, then reveal the model answer and marking points. Not recorded.'),
      card('mock', '📝 Mock Viva', VIVA_MOCK_N + ' random questions × 5 marks. Submit each answer, then mark yourself against the rubric. Your result is recorded (self-assessed).'),
      teacher ? card('examiner', '🧑‍⚕️ Examiner Mode', 'Examine a student on one or several topics: choose questions, see the expected answers and rubric, enter marks. Recorded.') : null));
    const tools = el('div', { class: 'row', style: 'gap:.5rem;flex-wrap:wrap;margin:-.3rem 0 .8rem' });
    if (teacher) tools.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'vv-results', onclick: () => this.openResults() }, '📊 Viva results'));
    else if (Backend.isConfigured()) tools.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'vv-mine', onclick: () => this.openMine() }, '📋 My viva results'));
    if (this.canEdit) {
      const inp = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => { const f = inp.files[0]; inp.value = ''; if (f) this.importBank(f); } });
      tools.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'vv-import', onclick: () => inp.click() }, '⬆ Import viva bank')); tools.appendChild(inp);
      if (total) tools.appendChild(el('button', { class: 'btn btn-sm btn-danger', onclick: () => this.removeBank() }, '🗑 Remove the viva bank'));
    }
    if (tools.childNodes.length) page.appendChild(tools);
    if (!total) { page.appendChild(el('div', { class: 'msg info' }, this.canEdit ? 'No viva questions yet — ⬆ Import viva bank (the file you were given), from ✏️ Edit master draft.' : 'No viva questions for this module yet.')); return; }
    if (mode === 'examiner') { page.appendChild(el('p', null, el('button', { class: 'btn btn-primary', 'data-a': 'vv-exam-new', onclick: () => this.go('exsetup') }, '🧑‍⚕️ Start a viva with a student…'))); }
    page.appendChild(el('h3', { style: 'margin:.4rem 0 .5rem' }, mode === 'examiner' ? 'Questions per topic' : 'Choose a topic'));
    const grid = el('div', { class: 'vv-topics' });
    T.forEach((t, i) => {
      const n = cnt[t.id] || 0; if (!n) return;
      const lv = this.bank([t.id]).reduce((a, q) => { a[q.level] = (a[q.level] || 0) + 1; return a; }, {});
      grid.appendChild(el('div', { class: 'vv-topic', 'data-topic': t.id }, el('span', { class: 'n' }, String(i + 1)),
        el('div', { class: 't' }, el('b', null, t.title), el('small', null, plural(n, 'question') + ' · ' + Object.keys(VIVA_LEVEL).filter(k => lv[k]).map(k => lv[k] + ' ' + VIVA_LEVEL[k][0].toLowerCase()).join(', '))),
        mode === 'examiner' ? null : el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'vv-start', disabled: mode === 'mock' && n < 1, onclick: () => mode === 'mock' ? this.startMock(t.id) : this.startPractice(t.id) }, mode === 'mock' ? '▶ Mock viva' : '▶ Practise')));
    });
    page.appendChild(grid);
  },
  /* ---------- 🗣 Practice ---------- */
  startPractice(tid) { this.run = { mode: 'practice', tids: [tid], qs: this.bank([tid]), i: 0, ans: {}, shown: {}, got: {} }; this.go('practice'); },
  /** the rubric table: each expected point with its marks; ro = read-only, else full / half / none per point */
  rubric(q, sel, onChange, ro) {
    const t = el('table', { class: 'vv-rub' });
    (q.points || []).forEach((p, k) => {
      const m = Number(p.m), cur = sel ? sel[k] : undefined;
      const seg = ro ? null : el('div', { class: 'vv-seg', role: 'group', 'aria-label': 'Marks for point ' + (k + 1) },
        [['full', '✓ ' + vivaNum(m), m], m >= 1 ? ['half', '½', m / 2] : null, ['none', '✗ 0', 0]].filter(Boolean).map(o => el('button', { type: 'button', class: (cur === o[2] ? 'on ' : '') + o[0], 'aria-pressed': String(cur === o[2]), 'data-v': String(o[2]), onclick: () => onChange(k, o[2]) }, o[1])));
      t.appendChild(el('tr', null, el('td', { class: 'm' }, vivaNum(m)), el('td', null, p.p), ro ? null : el('td', { class: 's' }, seg)));
    });
    return t;
  },
  follow(q, examiner) {
    if (!(q.follow || []).length) return null;
    return el('div', null, el('h4', { style: 'margin:.7rem 0 .3rem' }, '↪ Follow-up questions'),
      q.follow.map((f, k) => el('details', { class: 'vv-fu', open: !!examiner }, el('summary', null, (k + 1) + '. ' + f.q), el('div', { class: 'small', style: 'margin-top:.3rem;white-space:pre-wrap' }, f.a || ''))));
  },
  qHead(q, n) {
    return el('div', null, el('div', { class: 'vv-meta' }, el('span', null, vivaTopicLabel(q.topic)), q.level && VIVA_LEVEL[q.level] ? el('span', null, VIVA_LEVEL[q.level][0]) : null, q.type && VIVA_TYPE[q.type] ? el('span', null, VIVA_TYPE[q.type]) : null, el('span', null, vivaNum(q.max) + ' marks')),
      el('h3', null, (n ? n + '. ' : '') + q.q), vivaPicture(q));
  },
  practice(page) {
    const R = this.run, q = R.qs[R.i]; if (!q) return this.go('home');
    page.appendChild(this.bar('practice', vivaTopicLabel(R.tids[0]), R.i, R.qs.length, q.max));
    const box = el('div', { class: 'vv-q' }); box.appendChild(this.qHead(q));
    const ta = el('textarea', { placeholder: 'Say or type your answer here (not recorded), then reveal the model answer.', 'aria-label': 'Your answer' }); ta.value = R.ans[q.id] || '';
    ta.addEventListener('input', () => { R.ans[q.id] = ta.value; }); box.appendChild(ta);
    if (!R.shown[q.id]) box.appendChild(el('div', { class: 'vv-nav' }, el('span'), el('button', { class: 'btn btn-primary', 'data-a': 'vv-reveal', onclick: () => { R.shown[q.id] = true; this.render(); } }, '👁 Reveal the model answer')));
    else {
      const sel = R.got[q.id] || (R.got[q.id] = {}), sum = Object.values(sel).reduce((a, b) => a + b, 0);
      box.appendChild(el('h4', { style: 'margin:.8rem 0 .2rem' }, '✅ Model answer'));
      box.appendChild(el('div', { class: 'vv-model' }, q.model));
      box.appendChild(el('h4', { style: 'margin:.7rem 0 .1rem' }, '📏 Marking points — tick what your answer had (only for you)'));
      box.appendChild(this.rubric(q, sel, (k, v) => { sel[k] = v; this.render(); }));
      box.appendChild(el('p', { class: 'small' }, 'Your own estimate: ', el('b', null, vivaNum(sum) + ' / ' + vivaNum(q.max))));
      if (q.notes) box.appendChild(el('p', { class: 'small muted' }, '🧑‍⚕️ Examiner’s note: ' + q.notes));
      const fu = this.follow(q); if (fu) box.appendChild(fu);
    }
    page.appendChild(box);
    page.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: () => this.go('home') }, '← Topics'),
      el('div', { class: 'row', style: 'gap:.5rem' }, el('button', { class: 'btn', disabled: !R.i, onclick: () => { R.i--; this.render(); } }, '◀ Previous'),
        R.i < R.qs.length - 1 ? el('button', { class: 'btn btn-primary', 'data-a': 'vv-next', onclick: () => { R.i++; this.render(); } }, 'Next ▶') : el('a', { class: 'btn', href: '#/explain/' + R.tids[0] }, '📖 Learn this topic'))));
  },
  /* ---------- 📝 Mock Viva: answer all → mark against the rubric → result ---------- */
  startMock(tid) {
    const all = this.bank([tid]), pick = shuffle(all.slice()).slice(0, VIVA_MOCK_N);
    pick.sort((a, b) => ((VIVA_LEVEL[a.level] || [0, 2])[1] - (VIVA_LEVEL[b.level] || [0, 2])[1]));
    this.run = { mode: 'mock', tids: [tid], qs: pick, i: 0, ans: {}, sel: {}, at: Date.now() }; this.go('mock');
  },
  mockRun(page) {
    const R = this.run, q = R.qs[R.i]; if (!q) return this.go('home');
    page.appendChild(this.bar('mock', vivaTopicLabel(R.tids[0]), R.i, R.qs.length, q.max, el('span', { class: 'small muted' }, 'Total ' + vivaNum(R.qs.reduce((a, x) => a + Number(x.max), 0)) + ' marks')));
    const box = el('div', { class: 'vv-q' }); box.appendChild(this.qHead(q, R.i + 1));
    const ta = el('textarea', { placeholder: 'Write your answer as you would say it to the examiner. The model answer appears only after you submit all answers.', 'aria-label': 'Your answer' }); ta.value = R.ans[q.id] || '';
    ta.addEventListener('input', () => { R.ans[q.id] = ta.value; }); box.appendChild(ta);
    page.appendChild(box);
    const last = R.i === R.qs.length - 1;
    page.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Leave this mock viva? Your answers are lost.', { title: 'Leave?', okLabel: 'Leave' })) this.go('home'); } }, '✕ Leave'),
      el('div', { class: 'row', style: 'gap:.5rem' }, el('button', { class: 'btn', disabled: !R.i, onclick: () => { R.i--; this.render(); } }, '◀ Previous'),
        el('button', { class: 'btn btn-primary', 'data-a': last ? 'vv-submit' : 'vv-next', onclick: async () => {
          if (!last) { R.i++; this.render(); return; }
          const blank = R.qs.filter(x => !String(R.ans[x.id] || '').trim()).length;
          if (!(await confirmDialog((blank ? plural(blank, 'question') + ' without an answer. ' : '') + 'Submit your answers? Then the model answers and marking points appear and you mark yourself.', { title: 'Submit the mock viva', okLabel: 'Submit answers' }))) return;
          R.i = 0; this.go('mockmark');
        } }, last ? '✔ Submit answers' : 'Next ▶'))));
  },
  mockMark(page) {
    const R = this.run;
    page.appendChild(this.bar('mock', vivaTopicLabel(R.tids[0]), 0, 0, 0, el('span', { class: 'small' }, el('b', null, 'Mark your answers against the rubric'))));
    page.appendChild(el('div', { class: 'msg info' }, 'For each expected point: ✓ you said it correctly, ½ partly, ✗ missing or wrong. Be honest — this is how examiners mark.'));
    R.qs.forEach((q, k) => {
      const sel = R.sel[q.id] || (R.sel[q.id] = {}), sum = Object.values(sel).reduce((a, b) => a + b, 0), done = Object.keys(sel).length === (q.points || []).length;
      const box = el('div', { class: 'vv-q', 'data-q': q.id }); box.appendChild(this.qHead(q, k + 1));
      box.appendChild(el('div', { class: 'small muted' }, 'Your answer'));
      box.appendChild(el('div', { class: 'vv-yours' }, String(R.ans[q.id] || '').trim() || '— no answer —'));
      box.appendChild(el('h4', { style: 'margin:.6rem 0 .1rem' }, '✅ Model answer')); box.appendChild(el('div', { class: 'vv-model' }, q.model));
      box.appendChild(el('h4', { style: 'margin:.6rem 0 .1rem' }, '📏 Your marks')); box.appendChild(this.rubric(q, sel, (i, v) => { sel[i] = v; this.render(); }));
      box.appendChild(el('p', null, el('b', null, 'Question ' + (k + 1) + ': ' + vivaNum(sum) + ' / ' + vivaNum(q.max)), done ? '' : el('span', { class: 'small vv-miss' }, '  — mark every point')));
      page.appendChild(box);
    });
    const left = R.qs.filter(q => Object.keys(R.sel[q.id] || {}).length !== (q.points || []).length).length;
    page.appendChild(el('div', { class: 'vv-nav' }, el('span', { class: 'small muted' }, left ? plural(left, 'question') + ' still to mark' : 'All marked.'),
      el('button', { class: 'btn btn-primary', 'data-a': 'vv-finish', disabled: !!left, onclick: () => this.finishMock() }, '🏁 See my result')));
  },
  async finishMock() {
    const R = this.run;
    R.items = R.qs.map(q => { const sel = R.sel[q.id] || {}; return { id: q.id, topic: q.topic, q: q.q, max: Number(q.max), mark: Object.values(sel).reduce((a, b) => a + b, 0), got: (q.points || []).map((p, k) => (sel[k] || 0) >= Number(p.m)), answer: String(R.ans[q.id] || '').slice(0, 1500) }; });
    R.total = R.items.reduce((a, x) => a + x.mark, 0); R.max = R.items.reduce((a, x) => a + x.max, 0); R.saved = '';
    this.go('mockres');
    if (!this.isTeacher() && Backend.isConfigured()) {
      const r = await Backend.rawPost({ action: 'vbResult', topicIds: R.tids, topics: R.tids.map(vivaTopicLabel).join('; '), items: R.items }, { timeout: 60000 });
      R.saved = r && r.ok ? 'ok' : ((r && r.error) || 'network'); this.render();
    } else { R.saved = 'preview'; this.render(); }
  },
  mockResult(page) {
    const R = this.run, pct = R.max ? Math.round(R.total / R.max * 1000) / 10 : 0;
    page.appendChild(this.bar('mock', vivaTopicLabel(R.tids[0]), 0, 0, 0, el('span', { class: 'small' }, el('b', null, 'Result'))));
    const band = pct >= 85 ? ['Excellent', 'vv-ok'] : pct >= 70 ? ['Very good', 'vv-ok'] : pct >= 60 ? ['Good — a pass', 'vv-ok'] : pct >= 50 ? ['Borderline — revise', 'vv-miss'] : ['Not yet — revise this topic', 'vv-miss'];
    page.appendChild(el('div', { class: 'vv-score' }, el('span', { class: 'vv-big' }, vivaNum(R.total) + ' / ' + vivaNum(R.max)), el('span', { class: 'vv-big' }, pct + '%'), el('b', { class: band[1] }, band[0]),
      el('span', { class: 'small muted' }, R.saved === 'ok' ? '✓ Recorded (self-assessed)' : R.saved === 'preview' ? 'Teacher preview — not recorded' : R.saved ? '⚠ Not recorded: ' + R.saved : 'Recording…')));
    const missed = [];
    R.qs.forEach((q, k) => {
      const it = R.items[k], box = el('div', { class: 'vv-q' }); box.appendChild(this.qHead(q, k + 1));
      box.appendChild(el('p', null, el('b', null, vivaNum(it.mark) + ' / ' + vivaNum(it.max))));
      const ok = (q.points || []).filter((p, i) => it.got[i]), no = (q.points || []).filter((p, i) => !it.got[i]);
      if (ok.length) box.appendChild(el('div', { class: 'small' }, el('b', { class: 'vv-ok' }, '✓ You had: '), ok.map(p => p.p).join(' · ')));
      if (no.length) { box.appendChild(el('div', { class: 'small', style: 'margin-top:.25rem' }, el('b', { class: 'vv-miss' }, '✗ To revise: '), no.map(p => p.p).join(' · '))); missed.push(q); }
      box.appendChild(el('details', { class: 'vv-fu' }, el('summary', null, 'Model answer'), el('div', { class: 'vv-model' }, q.model)));
      const fu = this.follow(q); if (fu) box.appendChild(fu);
      page.appendChild(box);
    });
    page.appendChild(el('div', { class: 'msg ' + (missed.length ? 'warn' : 'ok') }, missed.length ? 'Revise in Learn: ' : 'Well done — every point covered. ',
      missed.length ? el('a', { href: '#/explain/' + R.tids[0] }, '📖 ' + vivaTopicLabel(R.tids[0])) : null));
    page.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: () => this.go('home') }, '← Topics'), el('button', { class: 'btn btn-primary', onclick: () => this.startMock(R.tids[0]) }, '↻ Another mock viva on this topic')));
  },
  /* ---------- 🧑‍⚕️ Examiner Mode ---------- */
  async exSetup(page) {
    const X = this.ex || (this.ex = { tids: new Set(), student: null, roster: null, q: '' });
    page.appendChild(el('h3', null, '🧑‍⚕️ New viva — student and topics'));
    const stuBox = el('div', { class: 'vv-q' });
    stuBox.appendChild(el('label', { class: 'field' }, 'Student', el('input', { type: 'search', 'data-a': 'vv-stu', placeholder: 'Type a name or student ID', value: X.q, oninput: e => { X.q = e.target.value; paint(); } })));
    const list = el('div', { class: 'small', style: 'max-height:14rem;overflow:auto;margin-top:.3rem' }); stuBox.appendChild(list);
    const paint = () => {
      clear(list);
      if (!X.roster) { list.appendChild(el('span', { class: 'muted' }, 'Loading the student list…')); return; }
      const s = normText(X.q || ''); const L = X.roster.filter(x => !s || normText(x.username + ' ' + x.name).includes(s)).slice(0, 40);
      if (X.student) list.appendChild(el('p', null, 'Chosen: ', el('b', null, X.student.name + ' · ' + X.student.username), ' ', el('button', { class: 'btn btn-xs', onclick: () => { X.student = null; paint(); } }, 'Change')));
      else L.forEach(x => list.appendChild(el('button', { type: 'button', class: 'btn btn-xs', style: 'margin:.15rem', 'data-stu': x.username, onclick: () => { X.student = x; paint(); upd(); } }, x.name + ' · ' + x.username)));
      if (!X.student && !L.length) list.appendChild(el('span', { class: 'muted' }, 'No match.'));
    };
    page.appendChild(stuBox);
    const T = getTopics().filter(t => this.bank([t.id]).length), tb = el('div', { class: 'vv-q' });
    const allBox = el('input', { type: 'checkbox', 'data-a': 'vv-all', checked: T.length && T.every(t => X.tids.has(t.id)), onchange: e => { T.forEach(t => e.target.checked ? X.tids.add(t.id) : X.tids.delete(t.id)); this.render(); } });
    tb.appendChild(el('label', { style: 'display:flex;gap:.4rem;align-items:center;font-weight:700' }, allBox, 'The whole module (all topics)'));
    T.forEach(t => tb.appendChild(el('label', { style: 'display:flex;gap:.4rem;align-items:center;margin:.2rem 0' }, el('input', { type: 'checkbox', 'data-t': t.id, checked: X.tids.has(t.id), onchange: e => { e.target.checked ? X.tids.add(t.id) : X.tids.delete(t.id); this.render(); } }), vivaTopicLabel(t.id) + ' (' + this.bank([t.id]).length + ')')));
    page.appendChild(tb);
    const start = el('button', { class: 'btn btn-primary', 'data-a': 'vv-exam-start', onclick: () => { this.run = { mode: 'examiner', tids: [...X.tids], student: X.student, done: [], cur: null, sel: {}, fu: {}, over: '', note: '', comment: '', at: Date.now() }; this.go('exam'); } }, '▶ Start the viva');
    const upd = () => { start.disabled = !(X.student && X.tids.size); }; upd();
    page.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: () => this.go('home') }, '← Back'), start));
    paint();
    if (!X.roster) { const r = await Backend.authedPost({ action: 'listStudents' }, { timeout: 30000 }); X.roster = r && r.ok ? (r.students || []).filter(x => x.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name))) : []; paint(); }
  },
  examRun(page) {
    const R = this.run, pool = this.bank(R.tids), used = new Set(R.done.map(d => d.id)), total = R.done.reduce((a, d) => a + d.mark, 0), max = R.done.reduce((a, d) => a + d.max, 0);
    page.appendChild(this.bar('examiner', R.tids.length === getTopics().filter(t => this.bank([t.id]).length).length ? 'The whole module' : R.tids.map(t => 'T' + topicNum(t)).join(', '), R.done.length + (R.cur ? 0 : -1), 0, 0,
      el('span', { class: 'small' }, el('b', null, R.student.name + ' · ' + R.student.username), ' · asked ' + R.done.length + ' · ', el('b', null, vivaNum(total) + ' / ' + vivaNum(max)))));
    if (!R.cur) {
      const box = el('div', { class: 'vv-q' }); box.appendChild(el('h3', null, 'Choose the next question'));
      box.appendChild(el('button', { class: 'btn btn-primary', 'data-a': 'vv-draw', disabled: pool.every(q => used.has(q.id)), onclick: () => { const c = shuffle(pool.filter(q => !used.has(q.id)))[0]; if (c) { R.cur = c; R.sel = {}; R.fu = {}; R.over = ''; R.note = ''; this.render(); } } }, '🎲 Draw a random question'));
      const sel = el('select', { 'data-a': 'vv-pick', 'aria-label': 'Choose a question', style: 'max-width:100%;margin-top:.5rem;display:block' }, el('option', { value: '' }, '— or choose a question —'),
        pool.filter(q => !used.has(q.id)).map(q => el('option', { value: q.id }, 'T' + topicNum(q.topic) + ' · ' + (VIVA_LEVEL[q.level] || ['?'])[0] + ' · ' + q.q.slice(0, 110))));
      sel.addEventListener('change', () => { const c = pool.find(q => q.id === sel.value); if (c) { R.cur = c; R.sel = {}; R.fu = {}; R.over = ''; R.note = ''; this.render(); } });
      box.appendChild(sel); page.appendChild(box);
    } else {
      const q = R.cur, sum = Object.values(R.sel).reduce((a, b) => a + b, 0), box = el('div', { class: 'vv-q' }); box.appendChild(this.qHead(q, R.done.length + 1));
      box.appendChild(el('h4', { style: 'margin:.5rem 0 .1rem' }, '✅ Expected answer')); box.appendChild(el('div', { class: 'vv-model' }, q.model));
      if (q.notes) box.appendChild(el('p', { class: 'small' }, '🧑‍⚕️ ' + q.notes));
      box.appendChild(el('h4', { style: 'margin:.6rem 0 .1rem' }, '📏 Marking — each expected point')); box.appendChild(this.rubric(q, R.sel, (i, v) => { R.sel[i] = v; this.render(); }));
      if ((q.follow || []).length) {
        box.appendChild(el('h4', { style: 'margin:.6rem 0 .2rem' }, '↪ Follow-up questions (tick the ones you asked)'));
        q.follow.forEach((f, k) => box.appendChild(el('div', { class: 'vv-fu' }, el('label', { style: 'display:flex;gap:.4rem;font-weight:600' }, el('input', { type: 'checkbox', checked: !!R.fu[k], onchange: e => { R.fu[k] = e.target.checked; } }), f.q), el('div', { class: 'small', style: 'margin:.2rem 0 0 1.6rem;white-space:pre-wrap' }, f.a || ''))));
      }
      const over = el('input', { type: 'number', min: '0', max: String(q.max), step: '0.5', value: R.over, 'data-a': 'vv-over', style: 'width:5rem', 'aria-label': 'Mark (override)', oninput: e => { R.over = e.target.value; } });
      box.appendChild(el('div', { class: 'row', style: 'gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.5rem' }, el('b', null, 'Rubric: ' + vivaNum(sum) + ' / ' + vivaNum(q.max)), el('label', { class: 'small' }, 'or type the mark ', over),
        el('input', { placeholder: 'Note (optional)', value: R.note, style: 'flex:1 1 200px;min-width:0', oninput: e => { R.note = e.target.value; } })));
      box.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: () => { R.cur = null; this.render(); } }, 'Skip this question'),
        el('button', { class: 'btn btn-primary', 'data-a': 'vv-save-q', onclick: () => {
          const o = R.over === '' ? null : Math.round(Number(R.over) * 2) / 2;
          if (o !== null && !(o >= 0 && o <= q.max)) { toast('The mark is 0 to ' + q.max + '.', 'warn'); return; }
          if (o === null && Object.keys(R.sel).length !== (q.points || []).length) { toast('Mark every point, or type the mark.', 'warn'); return; }
          R.done.push({ id: q.id, topic: q.topic, q: q.q, max: Number(q.max), mark: o !== null ? o : sum, got: (q.points || []).map((p, k) => (R.sel[k] || 0) >= Number(p.m)), followups: Object.values(R.fu).filter(Boolean).length, note: R.note });
          R.cur = null; this.render();
        } }, '✔ Record the mark — next question')));
      page.appendChild(box);
    }
    if (R.done.length) {
      page.appendChild(el('table', { class: 'vv-tbl' }, el('thead', null, el('tr', null, ['#', 'Question', 'Mark', ''].map(h => el('th', null, h)))),
        el('tbody', null, R.done.map((d, k) => el('tr', null, el('td', null, String(k + 1)), el('td', null, d.q, d.note ? el('div', { class: 'small muted' }, d.note) : null), el('td', null, vivaNum(d.mark) + ' / ' + vivaNum(d.max)),
          el('td', null, el('button', { class: 'btn btn-xs', title: 'Remove', onclick: () => { R.done.splice(k, 1); this.render(); } }, '✕')))))));
      const com = el('textarea', { placeholder: 'Overall comment for the student (optional)', 'data-a': 'vv-comment', style: 'width:100%;min-height:3.5rem;margin-top:.6rem' }); com.value = R.comment; com.addEventListener('input', () => { R.comment = com.value; });
      page.appendChild(com);
    }
    page.appendChild(el('div', { class: 'vv-nav' }, el('button', { class: 'btn', onclick: async () => { if (!R.done.length || await confirmDialog('Leave without saving this viva?', { title: 'Leave?', okLabel: 'Leave' })) this.go('home'); } }, '✕ Leave'),
      el('button', { class: 'btn btn-primary', 'data-a': 'vv-exam-save', disabled: !R.done.length || !!R.cur, onclick: () => this.saveExam() }, '💾 Finish and record (' + vivaNum(total) + ' / ' + vivaNum(max) + ')')));
  },
  async saveExam() {
    const R = this.run, me = (Auth.teacherName && Auth.teacherName()) || 'Teacher';
    const r = await Backend.authedPost({ action: 'vbResult', studentId: R.student.username, name: R.student.name, email: R.student.email || '', examiner: me, topicIds: R.tids, topics: R.tids.map(vivaTopicLabel).join('; '), comment: R.comment, items: R.done }, { timeout: 60000 });
    if (!(r && r.ok)) { toast('Not recorded: ' + ((r && r.error) || 'network'), 'bad', 8000); return; }
    toast('Viva recorded: ' + R.student.name + ' — ' + vivaNum(r.result.total) + ' / ' + vivaNum(r.result.max) + ' (' + r.result.percent + '%).', 'ok', 7000);
    this.ex = null; this.results = null; this.openResults();
  },
  /* ---------- 📊 results ---------- */
  async openResults() { this.go('results'); const r = await Backend.authedPost({ action: 'vbResults' }, { timeout: 60000 }); this.results = r && r.ok ? r.results : { error: (r && r.error) || 'network' }; this.render(); },
  async openMine() { this.go('mine'); const r = await Backend.rawPost({ action: 'vbMine' }, { timeout: 60000 }); this.mine = r && r.ok ? r.results : { error: (r && r.error) || 'network' }; this.render(); },
  detail(x) {
    const rows = (x.items || []).map((d, k) => el('tr', null, el('td', null, String(k + 1)),
      el('td', null, d.q, d.note ? el('div', { class: 'small muted' }, d.note) : null, d.answer ? el('div', { class: 'small vv-yours' }, d.answer) : null,
        d.followups ? el('div', { class: 'small muted' }, d.followups + ' follow-up question(s) asked') : null),
      el('td', null, vivaNum(d.mark) + ' / ' + vivaNum(d.max))));
    const tbl = el('table', { class: 'vv-tbl' }, el('thead', null, el('tr', null, ['#', 'Question', 'Mark'].map(h => el('th', null, h)))), el('tbody', null, rows));
    const head = el('p', null, el('b', null, vivaNum(x.total) + ' / ' + vivaNum(x.max) + ' (' + x.percent + '%)'),
      ' · ' + (x.mode === 'examiner' ? 'examiner-marked by ' + (x.examiner || 'a teacher') : 'mock viva, self-assessed') + ' · ' + new Date(x.at).toLocaleString());
    openModal({ title: (x.mode === 'examiner' ? '🧑‍⚕️ ' : '📝 ') + x.name + ' · ' + x.studentId, wide: true,
      body: el('div', null, head, el('p', { class: 'small' }, x.topics), x.comment ? el('p', null, '💬 ' + x.comment) : null, tbl), actions: [{ label: 'Close', primary: true }] });
  },
  table(list, teacher) {
    return el('div', { class: 'table-scroll' }, el('table', { class: 'vv-tbl', 'data-a': 'vv-res' }, el('thead', null, el('tr', null, ['Date', teacher ? 'Student' : null, 'Mode', 'Topics', 'Score', '%', ''].filter(Boolean).map(h => el('th', null, h)))),
      el('tbody', null, list.map(x => el('tr', { 'data-r': x.resultId }, el('td', { class: 'nowrap' }, new Date(x.at).toLocaleDateString()), teacher ? el('td', null, x.name, el('div', { class: 'small muted' }, x.studentId)) : null,
        el('td', null, x.mode === 'examiner' ? '🧑‍⚕️ Examiner' : '📝 Mock (self)'), el('td', { class: 'small' }, x.topics), el('td', { class: 'nowrap' }, el('b', null, vivaNum(x.total) + ' / ' + vivaNum(x.max))), el('td', { class: x.percent < 50 ? 'vv-miss' : '' }, x.percent + '%'),
        el('td', { class: 'nowrap' }, el('button', { class: 'btn btn-xs', onclick: () => this.detail(x) }, 'Details'), teacher ? el('button', { class: 'btn btn-xs', title: 'Delete this result', onclick: async () => {
          if (!(await confirmDialog('Delete this viva result of ' + x.name + '?', { title: 'Delete result?', danger: true, okLabel: 'Delete' }))) return;
          const r = await Backend.authedPost({ action: 'vbResultDelete', resultId: x.resultId }); if (r && r.ok) { this.results = this.results.filter(y => y.resultId !== x.resultId); this.render(); } else toast((r && r.error) || 'Not deleted.', 'bad'); } }, '🗑') : null))))));
  },
  resultsPage(page) {
    page.appendChild(el('div', { class: 'vv-nav', style: 'margin-top:0' }, el('button', { class: 'btn', onclick: () => this.go('home') }, '← Viva'), el('span')));
    page.appendChild(el('h3', null, '📊 Viva results'));
    const L0 = this.results; if (!L0) { page.appendChild(el('p', { class: 'muted' }, 'Loading…')); return; }
    if (L0.error) { page.appendChild(el('div', { class: 'msg warn' }, L0.error)); return; }
    const f = this.f, s = normText(f.q || ''), L = L0.filter(x => (!f.mode || x.mode === f.mode) && (!f.topic || x.topicIds.includes(f.topic)) && (!s || normText(x.name + ' ' + x.studentId).includes(s)));
    page.appendChild(el('div', { class: 'row', style: 'gap:.5rem;flex-wrap:wrap;margin-bottom:.6rem' },
      el('input', { type: 'search', placeholder: 'Student or ID', value: f.q, style: 'flex:1 1 180px;min-width:0', oninput: e => { f.q = e.target.value; clearTimeout(this._t); this._t = setTimeout(() => this.render(), 250); } }),
      el('select', { 'aria-label': 'Mode', onchange: e => { f.mode = e.target.value; this.render(); } }, [['', 'All modes'], ['examiner', '🧑‍⚕️ Examiner-marked'], ['mock', '📝 Mock (self-assessed)']].map(o => el('option', { value: o[0], selected: f.mode === o[0] }, o[1]))),
      el('select', { 'aria-label': 'Topic', onchange: e => { f.topic = e.target.value; this.render(); } }, el('option', { value: '' }, 'All topics'), getTopics().filter(t => L0.some(x => x.topicIds.includes(t.id))).map(t => el('option', { value: t.id, selected: f.topic === t.id }, vivaTopicLabel(t.id)))),
      el('button', { class: 'btn btn-sm', onclick: () => this.csv(L) }, '⬇ CSV')));
    if (!L.length) { page.appendChild(el('p', { class: 'muted' }, 'No viva results yet.')); return; }
    const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y.percent, 0) / a.length * 10) / 10 : null, ex = L.filter(x => x.mode === 'examiner'), mk = L.filter(x => x.mode === 'mock');
    page.appendChild(el('div', { class: 'vv-score' }, el('span', null, el('b', null, String(L.length)), ' results · ', el('b', null, String(new Set(L.map(x => x.studentId)).size)), ' students'),
      ex.length ? el('span', null, '🧑‍⚕️ examiner mean ', el('b', null, mean(ex) + '%')) : null, mk.length ? el('span', null, '📝 mock mean ', el('b', null, mean(mk) + '%')) : null));
    const per = getTopics().map(t => ({ t, a: L.filter(x => x.topicIds.length === 1 && x.topicIds[0] === t.id) })).filter(x => x.a.length);
    if (per.length) page.appendChild(el('details', { class: 'vv-fu' }, el('summary', null, 'Mean score per topic (single-topic vivas)'),
      el('table', { class: 'vv-tbl' }, el('tbody', null, per.map(x => el('tr', null, el('td', null, vivaTopicLabel(x.t.id)), el('td', null, x.a.length + ' viva(s)'), el('td', null, el('b', null, mean(x.a) + '%'))))))));
    page.appendChild(this.table(L, true));
  },
  csv(L) {
    const q = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['Date', 'Student ID', 'Name', 'Mode', 'Topics', 'Score', 'Max', '%', 'Examiner', 'Comment']].concat(L.map(x => [new Date(x.at).toISOString().slice(0, 16).replace('T', ' '), x.studentId, x.name, x.mode === 'examiner' ? 'examiner-marked' : 'mock (self-assessed)', x.topics, x.total, x.max, x.percent, x.examiner, x.comment]));
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: 'viva-results-' + (MODULE_KEY || 'module') + '.csv' });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  minePage(page) {
    page.appendChild(el('div', { class: 'vv-nav', style: 'margin-top:0' }, el('button', { class: 'btn', onclick: () => this.go('home') }, '← Viva'), el('span')));
    page.appendChild(el('h3', null, '📋 My viva results'));
    const L = this.mine; if (!L) { page.appendChild(el('p', { class: 'muted' }, 'Loading…')); return; }
    if (L.error) { page.appendChild(el('div', { class: 'msg warn' }, L.error)); return; }
    if (!L.length) { page.appendChild(el('p', { class: 'muted' }, 'No viva results yet — try a 📝 Mock Viva.')); return; }
    page.appendChild(this.table(L, false));
  },
  /* ---------- the bank: import (Admin, main copy / master draft) ---------- */
  async importBank(file) {
    let d; try { d = JSON.parse(await file.text()); } catch (e) { toast('This file could not be read.', 'bad'); return; }
    if (!d || d.format !== VIVA_FORMAT || !Array.isArray(d.items)) { toast('This is not a viva bank file.', 'bad'); return; }
    const mine = String(MODULE_KEY || '').split('-')[0]; if (d.module && d.module !== mine) { toast('This viva bank is for module “' + d.module + '”, not this one.', 'bad', 7000); return; }
    const known = new Set(getTopics().map(t => t.id)), off = d.items.filter(q => !known.has(q.topic)).length;
    if (!(await confirmDialog('Import ' + plural(d.items.length, 'viva question') + (off ? ' (' + off + ' for topics not in this course — they will not show)' : '') + '? Questions with the same id are replaced.', { title: '⬆ Import viva bank', okLabel: 'Import' }))) return;
    let saved = 0; const bad = [];
    for (let i = 0; i < d.items.length; i += 40) {
      toast('Importing ' + Math.min(i + 40, d.items.length) + ' of ' + d.items.length + '…', 'info', 2500);
      const r = await Backend.authedPost({ action: 'vbSave', items: d.items.slice(i, i + 40) }, { timeout: 120000 });
      if (!(r && r.ok)) { toast('Import stopped: ' + ((r && r.error) || 'network'), 'bad', 8000); break; }
      saved += r.saved; bad.push(...(r.rejected || []));
    }
    if (bad.length) openModal({ title: 'Not imported (' + bad.length + ')', body: el('div', { class: 'small' }, bad.map(x => el('div', null, x))), actions: [{ label: 'Close', primary: true }] });
    toast(plural(saved, 'question') + ' imported.', bad.length ? 'warn' : 'ok', 6000); this.items = null; this.load();
  },
  async removeBank() {
    const w = await promptDialog('Remove the whole viva bank?', 'Recorded results are kept. Type DELETE to confirm.', { placeholder: 'DELETE', okLabel: 'Remove' });
    if (w === null) return; if (String(w).trim() !== 'DELETE') { toast('Nothing was removed.', 'warn'); return; }
    const r = await Backend.authedPost({ action: 'vbDelete', all: true }, { timeout: 120000 });
    toast(r && r.ok ? plural(r.deleted, 'question') + ' removed.' : ((r && r.error) || 'Not removed.'), r && r.ok ? 'ok' : 'bad'); this.items = null; this.load();
  }
};
/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */"""
R = [
("""  <section class="view" id="view-progress" aria-label="My progress"></section>""",
 """  <section class="view" id="view-viva" aria-label="Viva examination"></section>
  <section class="view" id="view-progress" aria-label="My progress"></section>"""),
("""  { id: 'progress', label: 'My Progress', icon: '📈' },  // Stage 2 hub""",
 """  { id: 'viva', label: 'Viva', icon: '🎓' },  // 🎓 Viva Examination (patch viva)
  { id: 'progress', label: 'My Progress', icon: '📈' },  // Stage 2 hub"""),
("""  { id: 'progress', label: 'My Progress', short: 'Progress', hint: 'Topic progress, mistakes and notes',""",
 """  { id: 'viva', label: 'Viva Examination', short: 'Viva', hint: 'Oral examination by topic: practice, mock viva, examiner', items: [['Viva examination', '🎓', 'viva', []]] },   // patch viva
  { id: 'progress', label: 'My Progress', short: 'Progress', hint: 'Topic progress, mistakes and notes',"""),
("""  if (view === 'progress') return 'progress';""",
 """  if (view === 'progress') return 'progress';
  if (view === 'viva') return 'viva';   // patch viva"""),
("""  progress: '<path d="M4 20h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16V4"/>',""",
 """  progress: '<path d="M4 20h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16V4"/>',
  viva: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M6 9.5V14c0 1.7 2.7 3 6 3s6-1.3 6-3V9.5"/><path d="M21 7.5V13"/>',"""),
("""/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */""", CODE),
]
DONE = '   🎓 Viva Examination (patch viva; Portal.gs 2.45)'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    m = re.search(r'"moduleKey"\s*:\s*"([a-z0-9]+)"', s)
    if not (m and m.group(1) in VIVA_MODULES):
        print(path, 'skipped (viva not enabled for', (m.group(1) if m else '?') + ')'); continue
    for a, b in R:
        if b in s or DONE in s: continue   # applied once = all of it (later patches insert next to this one's text)
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
