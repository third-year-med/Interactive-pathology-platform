"""🔬 Pathology Spotter (user, 2026-10-29): "Pathology Challenge" becomes "Pathology Spotter — Image-Based Practical
Assessment in Pathology". A teacher imports a Spotter question file (format neo-spotter-import: verified single-best-answer
questions, five options A–E, explanation = decisive finding / why / tempting distractor / high-yield fact) once; it is
stored as Content practicalcfg/spotter (master content: in ✏️ Edit master draft every group gets it after ⬆ Publish draft).
Every question names its picture by the existing reference — the import key of a teacher picture (custommedia importKey)
or an atlas id — and is shown ONLY when that picture is in a section of the Learn Practical topic; otherwise it is left
out. Practice mode (feedback after each answer) and Exam mode (20 questions, one per picture, answers locked when
submitted, score and % at the end, then a review with explanations). Results go to the study history / My mistakes
(source type "spotter"). Without a usable question set (< 5 questions with pictures) the old automatic challenge stays.
Routes (#/study/challenge), saved progress and internal names are unchanged. Idempotent."""
import sys
RENAME = [
    ("'🔬 Pathology challenge'", "'🔬 Pathology Spotter'"),
    ("challenge: 'Pathology challenge'", "challenge: 'Pathology Spotter'"),
    ("'🔬 Pathology Challenge'", "'🔬 Pathology Spotter'"),
    ("['Pathology challenge', '◆', 'study', ['challenge']]", "['Pathology Spotter', '◆', 'study', ['challenge']]"),
    ("{ g: '◆', title: 'Pathology challenge', sub: 'Identify, diagnose, explain and differentiate from images.'",
     "{ g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology.'"),
    ("challenge: ['Pathology challenge', 'Identify → diagnose → explain → differentiate.']",
     "challenge: ['Pathology Spotter', 'Image-Based Practical Assessment in Pathology.']"),
    ("challenge: ['pathology challenge'] }", "challenge: ['pathology challenge', 'pathology spotter', 'spotter'] }"),
    ("'◆ Pathology challenge'", "'◆ Pathology Spotter'"),
    ("The Pathology Challenge is built from images your teacher adds in Practical.", "The Pathology Spotter is built from images your teacher adds in Practical."),
    ("UE.register('challenge', { label: 'Pathology challenge',", "UE.register('challenge', { label: 'Pathology Spotter',"),
    ("'Start challenge'", "'Start the Spotter'"),
    ("' used in the Pathology Challenge · '", "' used in the Pathology Spotter · '"),
    ("(Practical, Pathology Challenge, Last-Minute Review", "(Practical, Pathology Spotter, Last-Minute Review"),
]
R = [
("""const StudyChallenge = {
  queue: null, i: 0,
  render(box) {
""",
 """const StudyChallenge = {
  queue: null, i: 0,
  render(box) {
    if (typeof Spotter !== 'undefined' && Spotter.take(box)) return;   // verified Spotter questions (patch spotter)
"""),
("""/* ====================================================================== PATHOLOGY CHALLENGE (orchestrates Practical + Question Bank + comparisons) */
""",
 """/* ====================================================================== 🔬 PATHOLOGY SPOTTER (patch spotter)
   Verified image questions (Content practicalcfg/spotter) on the pictures of the Learn Practical topic only. */
const SPOTTER_FORMAT = 'neo-spotter-import', SPOTTER_EXAM_N = 20, SPOTTER_MIN = 5;
const SPOTTER_TYPES = { diagnosis: 'Morphological diagnosis', organ: 'Organ-specific interpretation', mechanism: 'Mechanism', differential: 'Differential diagnosis', aetiology: 'Aetiology & pathogenesis', consequence: 'Complications & consequences', stain: 'Special stains', clinical: 'Clinical–pathological correlation', features: 'Decisive morphological feature', prognosis: 'Diagnostic significance' };
const Spotter = {
  run: null,                                   // { mode: 'practice'|'exam', ids, i, picks: {id: n}, locked: {id: true}, done }
  topic() { return getTopics().find(t => /practical/i.test(t.title || '')) || null; },
  /** The picture of a question — only from a section of the Learn Practical topic (teacher picture by import key, or atlas). */
  picture(it) {
    const t = this.topic(); if (!t || !it) return null;
    const secs = (t.sections || []).map(s => s.id);
    if (it.key) {
      for (const sid of [it.section].concat(secs)) {
        if (!secs.includes(sid)) continue;
        const m = sectionMedia(sid).find(x => x && x.importKey === it.key && x.url && x.type !== 'link');
        if (m) return { url: m.url, section: sid };
      }
      return null;
    }
    if (it.atlas && typeof ATLAS !== 'undefined') {
      const x = ATLAS.all().find(a => a.id === it.atlas && a.embed && (a.sections || []).some(s => secs.includes(s)));
      return x ? { url: x.src, section: (x.sections || []).find(s => secs.includes(s)) } : null;
    }
    return null;
  },
  all() { const d = State.practicalCfg && State.practicalCfg.spotter; return d && Array.isArray(d.items) ? d.items : []; },
  ready() { return this.all().filter(it => this.valid(it) && this.picture(it)); },
  valid(it) { return !!(it && it.id && it.stem && Array.isArray(it.options) && it.options.length >= 4 && Number.isInteger(it.answer) && it.answer >= 0 && it.answer < it.options.length); },
  byId(id) { return this.all().find(x => x.id === id) || null; },
  stats() { return Store.get('spotter_stats_v1', {}); },
  sig() { return this.all().length + ':' + this.ready().length; },
  take(box) {
    this.css();
    const items = this.ready(); this.lastSig = this.sig();
    if (Auth.isTeacher()) box.appendChild(this.teacherCard(items));
    if (items.length < SPOTTER_MIN) return false;      // too few verified questions with pictures: the automatic challenge stays
    const host = el('div', { class: 'spot' }); box.appendChild(host); this.host = host;
    this.paint();
    return true;
  },
  paint() {
    const host = this.host; if (!host || !host.isConnected) return; clear(host);
    const R = this.run;
    if (!R) return this.home(host);
    if (R.done) return this.results(host);
    this.question(host);
  },
  start(mode) {
    const items = this.ready(), st = this.stats();
    let list;
    if (mode === 'exam') {   // one question per picture, random
      const seen = new Set(); list = shuffle(items).filter(it => { const k = it.key || it.atlas; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, SPOTTER_EXAM_N);
    } else {                 // practice: not yet answered and last-wrong first
      const w = it => { const s = st[it.id]; return !s ? 0 : s.last === false ? 1 : 2; };
      list = shuffle(items).sort((a, b) => w(a) - w(b));
    }
    this.run = { mode, ids: list.map(x => x.id), i: 0, picks: {}, locked: {}, done: false, startedAt: Date.now() };
    this.paint(); window.scrollTo({ top: 0 });
  },
  record(it, ok) {
    const st = this.stats(); const s = st[it.id] || { n: 0, c: 0 }; s.n++; if (ok) s.c++; s.last = ok; s.t = Date.now(); st[it.id] = s; Store.set('spotter_stats_v1', st);
    const t = this.topic(); StudyEngine.recordResult({ sourceType: 'spotter', sourceId: it.id, topic: (t && t.id) || '', mode: 'challenge', result: ok ? 'correct' : 'wrong' });
  },
  home(host) {
    const items = this.ready(), last = Store.get('spotter_last_exam_v1', null), pics = new Set(items.map(it => it.key || it.atlas)).size;
    const n = Math.min(SPOTTER_EXAM_N, pics);
    host.appendChild(el('section', { class: 'card spot-home' },
      el('div', { class: 'st-kicker' }, '🔬 Pathology Spotter'),
      el('h2', null, 'Image-Based Practical Assessment in Pathology'),
      el('p', null, plural(items.length, 'question') + ' on ' + plural(pics, 'picture') + ' from Learn → ' + (this.topic() ? this.topic().title : 'Practical') + '. Each question shows one picture and five options (A–E).'),
      el('p', { class: 'small muted' }, '👁 Look at the picture first: name the decisive finding before you read the options.'),
      el('div', { class: 'spot-modes' },
        el('button', { class: 'spot-mode', 'data-a': 'spot-practice', onclick: () => this.start('practice') }, el('b', null, '🧪 Practice mode'), el('span', null, 'Feedback and explanation after each answer.')),
        el('button', { class: 'spot-mode', 'data-a': 'spot-exam', onclick: () => this.start('exam') }, el('b', null, '📝 Exam mode'), el('span', null, n + ' questions, one per picture. Answers lock when submitted; score and review at the end.'))),
      last ? el('p', { class: 'small muted mt1' }, 'Your last exam: ' + last.score + ' / ' + last.n + ' (' + last.pct + '%) · ' + new Date(last.at).toLocaleDateString()) : null));
  },
  question(host) {
    const R = this.run, it = this.byId(R.ids[R.i]), pic = it && this.picture(it);
    if (!it || !pic) { R.ids.splice(R.i, 1); if (R.i >= R.ids.length) { if (R.mode === 'exam') return this.finish(); this.run = null; } return this.paint(); }   // picture removed meanwhile: leave the question out
    const exam = R.mode === 'exam', locked = !!R.locked[it.id], pick = R.picks[it.id];
    const top = el('div', { class: 'spot-top' },
      el('b', null, (exam ? '📝 Exam' : '🧪 Practice') + ' · Question ' + (R.i + 1) + ' of ' + R.ids.length),
      el('div', { class: 'row', style: 'gap:.4rem' },
        exam ? el('span', { class: 'small muted' }, Object.keys(R.locked).length + ' submitted') : null,
        el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (exam && !(await confirmDialog('Leave the exam? Your answers so far are not scored.', { okLabel: 'Leave' }))) return; this.run = null; this.paint(); } }, exam ? '✕ Leave exam' : '✕ End practice')));
    host.appendChild(top);
    if (exam) host.appendChild(el('div', { class: 'spot-nav', role: 'navigation', 'aria-label': 'Questions' }, R.ids.map((id, k) => el('button', { class: 'spot-dot' + (k === R.i ? ' cur' : '') + (R.locked[id] ? ' done' : ''), 'aria-label': 'Question ' + (k + 1) + (R.locked[id] ? ' (submitted)' : ''), onclick: () => { R.i = k; this.paint(); } }, String(k + 1)))));
    const img = el('img', { class: 'spot-img', alt: 'Pathology image for question ' + (R.i + 1) }); stImg(img, pic.url);
    img.addEventListener('click', () => openLightbox([{ src: resolveImgUrl(pic.url) }], 0));
    img.addEventListener('error', () => { if (!img.dataset.failed) { img.dataset.failed = '1'; img.replaceWith(el('div', { class: 'spot-noimg' }, '⚠ This picture could not be loaded. ', el('a', { href: resolveImgUrl(pic.url), target: '_blank', rel: 'noopener' }, 'Open it ↗'))); } });
    const opts = el('div', { class: 'spot-opts', role: 'radiogroup', 'aria-label': 'Options' });
    it.options.forEach((o, k) => {
      const cls = 'opt spot-opt' + (pick === k ? ' sel' : '') + (locked && !exam && k === it.answer ? ' is-correct' : '') + (locked && !exam && pick === k && k !== it.answer ? ' is-wrong' : '');
      opts.appendChild(el('button', { class: cls, role: 'radio', 'aria-checked': String(pick === k), disabled: locked, onclick: () => { R.picks[it.id] = k; this.paint(); } }, el('span', { class: 'ol' }, LETTERS[k] + '.'), el('span', null, o)));
    });
    const submit = el('button', { class: 'btn btn-primary', 'data-a': 'spot-submit', disabled: locked || pick == null, onclick: () => {
      if (R.picks[it.id] == null || R.locked[it.id]) return;
      R.locked[it.id] = true;
      if (!exam) this.record(it, R.picks[it.id] === it.answer);
      if (exam && R.i < R.ids.length - 1) R.i = R.ids.findIndex((id, k) => k > R.i && !R.locked[id]) >= 0 ? R.ids.findIndex((id, k) => k > R.i && !R.locked[id]) : R.i + 1;
      this.paint();
    } }, locked ? (exam ? '✓ Submitted' : 'Answered') : 'Submit answer');
    const actions = el('div', { class: 'row mt1 spot-actions' }, submit);
    if (exam) {
      actions.appendChild(el('button', { class: 'btn', disabled: R.i === 0, onclick: () => { R.i--; this.paint(); } }, '← Previous'));
      actions.appendChild(el('button', { class: 'btn', disabled: R.i >= R.ids.length - 1, onclick: () => { R.i++; this.paint(); } }, 'Next →'));
      const left = R.ids.filter(id => !R.locked[id]).length;
      actions.appendChild(el('button', { class: 'btn btn-primary', 'data-a': 'spot-finish', onclick: async () => {
        if (left && !(await confirmDialog(plural(left, 'question') + ' not submitted yet — they count as wrong. Finish the exam?', { okLabel: 'Finish' }))) return;
        this.finish();
      } }, '🏁 Finish exam'));
    } else if (locked) actions.appendChild(el('button', { class: 'btn btn-primary', 'data-a': 'spot-next', onclick: () => { if (R.i < R.ids.length - 1) { R.i++; this.paint(); } else { this.run = null; this.paint(); toast('Practice complete — every question done.', 'ok'); } } }, R.i < R.ids.length - 1 ? 'Next question →' : 'Finish'));
    const q = el('div', { class: 'spot-q' },
      el('div', { class: 'small muted' }, SPOTTER_TYPES[it.type] || ''),
      el('p', { class: 'spot-stem' }, it.stem), opts, actions);
    if (locked && !exam) q.appendChild(this.explain(it, R.picks[it.id]));
    host.appendChild(el('div', { class: 'card spot-card' }, el('div', { class: 'spot-grid' }, el('div', { class: 'spot-pic' }, img, el('div', { class: 'small muted' }, '🔍 Click the picture to enlarge it.')), q)));
  },
  explain(it, pick) {
    const ok = pick === it.answer, e = it.explanation || {};
    return el('div', { class: 'spot-exp ' + (ok ? 'ok' : 'bad') },
      el('div', { class: 'spot-verdict' }, ok ? '✓ Correct' : pick == null ? 'Not answered' : '✗ Not quite', ' — the answer is ', el('b', null, LETTERS[it.answer] + '. ' + it.options[it.answer])),
      e.finding ? el('p', null, el('b', null, '🔎 Decisive finding: '), e.finding) : null,
      e.why ? el('p', null, el('b', null, '✅ Why this answer: '), e.why) : null,
      e.distractor ? el('p', null, el('b', null, '⚠ Tempting distractor: '), e.distractor) : null,
      e.fact ? el('p', null, el('b', null, '💡 High-yield fact: '), e.fact) : null);
  },
  finish() {
    const R = this.run; let score = 0;
    R.ids.forEach(id => { const it = this.byId(id); if (!it) return; const ok = R.locked[id] && R.picks[id] === it.answer; if (ok) score++; this.record(it, !!ok); });
    R.done = true; R.score = score;
    Store.set('spotter_last_exam_v1', { at: Date.now(), score, n: R.ids.length, pct: Math.round(100 * score / Math.max(1, R.ids.length)) });
    this.paint(); window.scrollTo({ top: 0 });
  },
  results(host) {
    const R = this.run, n = R.ids.length, pct = Math.round(100 * R.score / Math.max(1, n));
    const byType = {}; R.ids.forEach(id => { const it = this.byId(id); if (!it) return; const k = SPOTTER_TYPES[it.type] || 'Other'; const b = byType[k] = byType[k] || { n: 0, c: 0 }; b.n++; if (R.locked[id] && R.picks[id] === it.answer) b.c++; });
    host.appendChild(el('section', { class: 'card spot-result' },
      el('div', { class: 'st-kicker' }, '🔬 Pathology Spotter — exam result'),
      el('div', { class: 'spot-score' }, el('b', null, R.score + ' / ' + n), el('span', null, pct + '%')),
      el('ul', { class: 'small spot-types' }, Object.entries(byType).map(([k, b]) => el('li', null, k + ': ' + b.c + ' / ' + b.n))),
      el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', onclick: () => this.start('exam') }, '📝 New exam'), el('button', { class: 'btn', onclick: () => { this.run = null; this.paint(); } }, '◀ Spotter home'))));
    host.appendChild(el('h3', { class: 'mt1' }, 'Review'));
    R.ids.forEach((id, k) => {
      const it = this.byId(id), pic = it && this.picture(it); if (!it) return;
      const img = el('img', { class: 'spot-thumb', alt: 'Picture of question ' + (k + 1) }); if (pic) { stImg(img, pic.url); img.addEventListener('click', () => openLightbox([{ src: resolveImgUrl(pic.url) }], 0)); }
      host.appendChild(el('div', { class: 'card spot-rev' }, el('div', { class: 'spot-grid' }, el('div', { class: 'spot-pic' }, pic ? img : null),
        el('div', null, el('b', null, 'Question ' + (k + 1)), el('p', { class: 'spot-stem' }, it.stem),
          el('p', { class: 'small' }, 'Your answer: ', R.picks[id] != null && R.locked[id] ? LETTERS[R.picks[id]] + '. ' + it.options[R.picks[id]] : '— not submitted'),
          this.explain(it, R.locked[id] ? R.picks[id] : null)))));
    });
  },
  /** Teacher: import / replace the question set; shows how many questions have their picture in the Practical topic. */
  teacherCard(ready) {
    const all = this.all(), file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Spotter question file' }), msg = el('div', { class: 'small' });
    const draft = typeof picImportDraftOn === 'function' && picImportDraftOn();
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return; msg.className = 'small'; msg.textContent = 'Reading…';
      let d; try { d = JSON.parse(await f.text()); } catch (e) { msg.className = 'msg bad'; msg.textContent = 'This file could not be read.'; return; }
      if (!d || d.format !== SPOTTER_FORMAT || !Array.isArray(d.items)) { msg.className = 'msg bad'; msg.textContent = 'This is not a Spotter question file.'; return; }
      if (d.module && d.module !== (COURSE.moduleKey || '')) { msg.className = 'msg bad'; msg.textContent = 'This file is for another module (' + d.module + '), not ' + COURSE.title + '.'; return; }
      const items = d.items.filter(it => this.valid(it)); const withPic = items.filter(it => this.picture(it)).length;
      if (!(await confirmDialog('Save ' + plural(items.length, 'Spotter question') + (all.length ? ' (replacing the ' + all.length + ' current ones)' : '') + '? ' + withPic + ' of them have their picture in the Practical topic now' + (withPic < items.length ? ' — the others appear as soon as their pictures are imported into Learn' : '') + '.', { okLabel: 'Save questions' }))) { msg.textContent = ''; return; }
      await saveDoc('practicalcfg', 'spotter', { v: 1, title: String(d.title || ''), items, importedAt: Date.now() }, { history: false, label: 'Before importing Spotter questions' });
      toast('Spotter questions saved.', 'ok'); Views.study.render();
    });
    const missing = all.length - ready.length;
    return el('details', { class: 'card spot-teacher', open: !all.length }, el('summary', null, el('b', null, '👩‍🏫 Spotter questions (teacher)'), ' — ' + (all.length ? ready.length + ' of ' + all.length + ' ready' + (missing ? ' · ' + missing + ' waiting for their picture' : '') : 'none yet')),
      el('p', { class: 'small' }, 'Import a Spotter question file prepared for this module. Each question shows a picture from Learn → Practical; a question whose picture is not there is left out. Students see the Spotter as soon as ' + SPOTTER_MIN + ' questions are ready; until then the automatic challenge is shown.'),
      el('div', { class: 'msg small ' + (draft ? 'ok' : 'info') }, draft ? 'You are in ✏️ Edit master draft: every group gets the questions after ⬆ Publish draft.' : 'Tip: import in ✏️ Edit master draft so that every group gets the questions.'),
      file, msg);
  },
  css() {
    if (document.getElementById('spot-css')) return;
    document.head.appendChild(el('style', { id: 'spot-css' },
      '.spot-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem;margin-top:.8rem}' +
      '.spot-mode{display:flex;flex-direction:column;gap:.25rem;text-align:left;padding:1rem;border:1px solid var(--line,#d5dde7);border-radius:12px;background:#fff;cursor:pointer;font:inherit;color:inherit}' +
      '.spot-mode:hover{border-color:var(--teal,#0e9f9a)}.spot-mode b{color:var(--navy,#0b2340);font-size:1.05em}.spot-mode span{font-size:.9em;color:var(--muted,#64748b)}' +
      '.spot-top{display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}' +
      '.spot-nav{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.6rem}.spot-dot{min-width:2.1rem;height:2.1rem;border-radius:8px;border:1px solid var(--line,#d5dde7);background:#fff;font:inherit;font-size:.85rem;cursor:pointer;color:var(--navy,#0b2340)}' +
      '.spot-dot.done{background:#e6f5f4;border-color:var(--teal,#0e9f9a)}.spot-dot.cur{outline:2px solid var(--navy,#0b2340);outline-offset:1px}' +
      '.spot-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:1.1rem;align-items:start}@media(max-width:820px){.spot-grid{grid-template-columns:1fr}}' +
      '.spot-img{width:100%;max-height:70vh;object-fit:contain;background:#0f1c2b;border-radius:10px;cursor:zoom-in;display:block}' +
      '.spot-thumb{width:100%;max-height:260px;object-fit:contain;background:#0f1c2b;border-radius:10px;cursor:zoom-in}' +
      '.spot-noimg{padding:2rem 1rem;border:1px dashed var(--line,#d5dde7);border-radius:10px;text-align:center}' +
      '.spot-stem{font-size:1.05rem;line-height:1.5;margin:.3rem 0 .7rem;color:var(--navy,#0b2340)}' +
      '.spot-opts{display:flex;flex-direction:column;gap:.4rem}.spot-opt{width:100%;text-align:left}.spot-opt.sel{border-color:var(--navy,#0b2340);box-shadow:inset 0 0 0 1px var(--navy,#0b2340);background:#eef3f9}' +
      '.spot-actions{flex-wrap:wrap;gap:.4rem}' +
      '.spot-exp{margin-top:.8rem;padding:.8rem .9rem;border-radius:10px;border:1px solid var(--line,#d5dde7);background:#f8fafc}.spot-exp.ok{border-left:4px solid #15803d}.spot-exp.bad{border-left:4px solid #b91c1c}.spot-exp p{margin:.35rem 0}' +
      '.spot-verdict{font-weight:600;margin-bottom:.3rem}' +
      '.spot-score{display:flex;align-items:baseline;gap:.8rem;margin:.4rem 0}.spot-score b{font-size:2rem;color:var(--navy,#0b2340)}.spot-score span{font-size:1.3rem;color:var(--teal,#0e9f9a);font-weight:700}' +
      '.spot-types{columns:2;margin:.4rem 0 .8rem}@media(max-width:600px){.spot-types{columns:1}}.spot-rev{margin-top:.6rem}.spot-teacher{margin-bottom:.8rem}.spot-teacher summary{cursor:pointer}'));
  }
};
(function () {   // the study history / My mistakes know Spotter questions; the page follows questions/pictures arriving later
  if (typeof StudyEngine === 'undefined') return;
  Bus.on('synced', () => { if (Router.current === 'study' && Views.study.tab === 'challenge' && Spotter.lastSig != null && Spotter.lastSig !== Spotter.sig()) Views.study.render(); });
  const res0 = StudyEngine.resolve.bind(StudyEngine);
  StudyEngine.resolve = function (m) {
    if (m && m.sourceType === 'spotter') { const it = Spotter.byId(m.sourceId), t = Spotter.topic(); return it ? { title: 'Spotter: ' + seTrunc(it.stem, 100), topic: (t && t.id) || '' } : null; }
    return res0(m);
  };
})();

/* ====================================================================== PATHOLOGY CHALLENGE (orchestrates Practical + Question Bank + comparisons) */
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in RENAME:
        if a in s: s = s.replace(a, b); n += 1
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
