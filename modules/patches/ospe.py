"""📝 OSPE exam for the practical cases (user, 2026-10-29, template: "OSPE: Discussion of 100 Cases"). Apply → Practical gets
a tab "📝 OSPE exam" (#/practical/ospe): timed stations like a real OSPE — each station shows one or two pictures, an
optional clinical scenario and 3–4 short-answer parts (A, B, C…) with their marks. Students type their answers; a station
is locked when submitted (or when its time runs out) and the exam moves on, forward only. At the end every answer is
shown beside the model answer and the student marks it (0 / ½ / full) → total and %, kept as "your last OSPE".
Stations are Content practicalcfg/ospe (master content: in ✏️ Edit master draft every group gets them after ⬆ Publish
draft), imported from a file (format neo-ospe-import) or written in the teacher's station editor. Pictures come ONLY from
the Learn Practical topic (the Spotter's picture rules: teacher picture by import key / media:<id>, or atlas id); a station
whose pictures are all missing is left out. Students see the tab once 3 stations are ready. Apply's practical section
lists it. Needs the spotter + spotter-edit patches. Idempotent."""
import sys
R = [
("""/* ---------- 3 · Pathology Challenge: registry images, unlabelled ---------- */""",
 """/* ---------- 📝 OSPE exam on the practical cases (patch ospe; #/practical/ospe) ---------- */
const OSPE_FORMAT = 'neo-ospe-import', OSPE_MIN = 3;
const PracOspe = {
  run: null,   // { ids, i, answers: {sid: [text…]}, locked: {sid: true}, perStation (s), left (s), done, marks: {sid: [n…]} }
  all() { const d = State.practicalCfg && State.practicalCfg.ospe; return d && Array.isArray(d.items) ? d.items : []; },
  byId(id) { return this.all().find(x => x.id === id) || null; },
  pics(st) { return typeof Spotter === 'undefined' ? [] : (st.pics || []).map(r => Spotter.picture(r)).filter(Boolean); },
  valid(st) { return !!(st && st.id && Array.isArray(st.parts) && st.parts.length && st.parts.every(p => p && String(p.q || '').trim() && Number(p.marks) > 0)); },
  ready() { return this.all().filter(st => this.valid(st) && this.pics(st).length); },
  total(st) { return st.parts.reduce((n, p) => n + Number(p.marks || 0), 0); },
  render() {
    const page = pracPage(); this.css();
    page.appendChild(sectionTitleBlock('📝 OSPE exam — practical cases', 'Objective Structured Practical Examination: timed stations with pictures, a short clinical scenario and short-answer questions. Mark your answers against the model answers at the end.'));
    page.appendChild(pracTabs('ospe'));
    const host = el('div', { class: 'ospe' }); page.appendChild(host); this.host = host;
    if (Auth.isTeacher()) page.insertBefore(this.teacherCard(), host);
    this.paint();
  },
  paint() {
    const h = this.host; if (!h || !h.isConnected) return; clear(h);
    const R = this.run;
    if (!R) return this.home(h);
    if (R.done) return this.review(h);
    this.station(h);
  },
  home(h) {
    const ready = this.ready(), last = Store.get('ospe_last_v1', null);
    if (ready.length < OSPE_MIN) { h.appendChild(el('div', { class: 'card empty' }, el('span', { class: 'big' }, '📝'), el('h3', null, 'No OSPE stations yet'), el('p', { class: 'muted' }, 'Your teacher has not added OSPE stations for this module yet.'))); return; }
    const n = el('select', { 'aria-label': 'Number of stations' }, [5, 8, 10, 15, 20].filter(k => k < ready.length).concat([ready.length]).map(k => el('option', { value: k, selected: k === Math.min(10, ready.length) }, k === ready.length ? 'All ' + k + ' stations' : k + ' stations')));
    const tm = el('select', { 'aria-label': 'Time per station' }, [[0, 'No time limit'], [60, '1 minute'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes']].map(([v, l]) => el('option', { value: v, selected: v === 120 }, l)));
    h.appendChild(el('section', { class: 'card ospe-home' },
      el('div', { class: 'st-kicker' }, '📝 OSPE'),
      el('h2', null, plural(ready.length, 'station') + ' ready'),
      el('ul', { class: 'small' }, el('li', null, 'Each station: picture(s), a short clinical scenario and short-answer questions with their marks.'), el('li', null, 'Like the real exam you move forward only: a station is locked when you submit it or when its time is up.'), el('li', null, 'At the end you see each model answer and give yourself the marks you earned.')),
      el('div', { class: 'row', style: 'gap:.6rem;flex-wrap:wrap' }, el('label', { class: 'field' }, 'Stations', n), el('label', { class: 'field' }, 'Time per station', tm)),
      el('div', { class: 'row mt1' }, el('button', { class: 'btn btn-primary', 'data-a': 'ospe-start', onclick: () => this.start(Number(n.value), Number(tm.value)) }, '▶ Start the OSPE')),
      last ? el('p', { class: 'small muted mt1' }, 'Your last OSPE: ' + last.score + ' / ' + last.max + ' marks (' + last.pct + '%) · ' + plural(last.n, 'station') + ' · ' + new Date(last.at).toLocaleDateString()) : null));
  },
  start(n, perStation) {
    const ids = shuffle(this.ready()).slice(0, n).map(s => s.id);
    this.run = { ids, i: 0, answers: {}, locked: {}, marks: {}, perStation: perStation || 0, left: perStation || 0, done: false };
    this.tick(); this.paint(); window.scrollTo({ top: 0 });
  },
  tick() {
    clearInterval(this.timer);
    const R = this.run; if (!R || !R.perStation || R.done) return;
    this.timer = setInterval(() => {
      if (!this.run || this.run !== R || R.done) { clearInterval(this.timer); return; }
      if (Router.current !== 'practical') return;   // paused while away from the exam
      R.left--; const t = document.querySelector('[data-a=ospe-time]'); if (t) { t.textContent = this.fmt(R.left); t.classList.toggle('low', R.left <= 15); }
      if (R.left <= 0) { toast('⏰ Time is up — next station.', 'info'); this.submit(true); }
    }, 1000);
  },
  fmt(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
  submit(timeUp) {
    const R = this.run, id = R.ids[R.i]; if (!id) return;
    document.querySelectorAll('[data-a=ospe-ans]').forEach((ta, k) => { (R.answers[id] = R.answers[id] || [])[k] = ta.value; });
    R.locked[id] = true;
    if (R.i < R.ids.length - 1) { R.i++; R.left = R.perStation; } else { R.done = true; clearInterval(this.timer); }
    this.paint(); window.scrollTo({ top: 0 });
  },
  station(h) {
    const R = this.run, st = this.byId(R.ids[R.i]);
    if (!st || !this.pics(st).length) { R.ids.splice(R.i, 1); if (R.i >= R.ids.length) { R.done = true; clearInterval(this.timer); } return this.paint(); }   // removed meanwhile
    const ans = R.answers[st.id] || [];
    h.appendChild(el('div', { class: 'ospe-top' }, el('b', null, '📝 Station ' + (R.i + 1) + ' of ' + R.ids.length),
      R.perStation ? el('span', { class: 'ospe-time' + (R.left <= 15 ? ' low' : ''), 'data-a': 'ospe-time', 'aria-live': 'off' }, this.fmt(R.left)) : null,
      el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog('Leave the OSPE? Your answers are not marked.', { okLabel: 'Leave' })) { clearInterval(this.timer); this.run = null; this.paint(); } } }, '✕ Leave')));
    const gallery = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 2).map((p, k) => { const im = el('img', { class: 'ospe-img', alt: 'Station picture ' + (k + 1) }); stImg(im, p.url); im.addEventListener('click', () => openLightbox(this.pics(st).map(x => ({ src: resolveImgUrl(x.url) })), k)); return im; }));
    const parts = el('ol', { class: 'ospe-parts', type: 'A' }, st.parts.map((p, k) => el('li', null,
      el('div', { class: 'ospe-q' }, el('span', null, p.q), el('span', { class: 'ospe-m' }, '(' + p.marks + ')')),
      el('textarea', { rows: 2, 'data-a': 'ospe-ans', 'aria-label': 'Answer ' + LETTERS[k], oninput: (e) => { (R.answers[st.id] = R.answers[st.id] || [])[k] = e.target.value; } }, ans[k] || ''))));   // kept while typing: a repaint never loses it
    h.appendChild(el('div', { class: 'card ospe-card' }, gallery, el('div', { class: 'small muted' }, '🔍 Click a picture to enlarge it.'),
      st.scenario ? el('p', { class: 'ospe-scn' }, st.scenario) : el('p', { class: 'ospe-scn' }, 'Examine the picture(s) and answer the following:'),
      parts, el('div', { class: 'row mt1' }, el('button', { class: 'btn btn-primary', 'data-a': 'ospe-submit', onclick: () => this.submit(false) }, R.i < R.ids.length - 1 ? 'Submit station → next' : 'Submit the last station'),
        el('span', { class: 'small muted' }, 'Total ' + this.total(st) + ' marks · you cannot come back to this station'))));
  },
  review(h) {
    const R = this.run; let score = 0, max = 0;
    R.ids.forEach(id => { const st = this.byId(id); if (!st) return; max += this.total(st); (R.marks[id] || []).forEach(m => { score += Number(m) || 0; }); });
    const marked = R.ids.every(id => { const st = this.byId(id); return !st || st.parts.every((p, k) => (R.marks[id] || [])[k] != null); });
    h.appendChild(el('section', { class: 'card ospe-result' }, el('div', { class: 'st-kicker' }, '📝 OSPE — mark your answers'),
      el('div', { class: 'spot-score' }, el('b', { 'data-a': 'ospe-score' }, score + ' / ' + max), el('span', null, Math.round(100 * score / Math.max(1, max)) + '%')),
      el('p', { class: 'small' }, marked ? '✓ All parts marked.' : 'Compare each answer with the model answer and give yourself the marks you earned.'),
      el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', 'data-a': 'ospe-save', disabled: !marked, onclick: () => this.finish(score, max) }, '✓ Save my result'), el('button', { class: 'btn', onclick: () => { this.run = null; this.paint(); } }, '◀ OSPE home'))));
    R.ids.forEach((id, i) => {
      const st = this.byId(id); if (!st) return; const ans = R.answers[id] || [], mk = R.marks[id] = R.marks[id] || [];
      const thumbs = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 2).map(p => { const im = el('img', { class: 'ospe-thumb', alt: '' }); stImg(im, p.url); im.addEventListener('click', () => openLightbox([{ src: resolveImgUrl(p.url) }], 0)); return im; }));
      h.appendChild(el('div', { class: 'card ospe-rev' }, el('b', null, 'Station ' + (i + 1) + (st.title ? ' — ' + st.title : '')), thumbs, st.scenario ? el('p', { class: 'ospe-scn' }, st.scenario) : null,
        el('ol', { class: 'ospe-parts', type: 'A' }, st.parts.map((p, k) => el('li', null,
          el('div', { class: 'ospe-q' }, el('span', null, p.q), el('span', { class: 'ospe-m' }, '(' + p.marks + ')')),
          el('div', { class: 'ospe-cmp' }, el('div', null, el('div', { class: 'small muted' }, 'Your answer'), el('div', { class: 'ospe-yours' }, (ans[k] || '').trim() || '— no answer')),
            el('div', null, el('div', { class: 'small muted' }, 'Model answer'), el('div', { class: 'ospe-model' }, p.answer || '—'))),
          el('div', { class: 'row ospe-mk', role: 'radiogroup', 'aria-label': 'Marks for part ' + LETTERS[k] }, [0, p.marks / 2, p.marks].map(v => el('button', { class: 'btn btn-xs' + (mk[k] === v ? ' btn-primary' : ''), 'data-a': 'ospe-mark', onclick: () => { const y = window.scrollY; mk[k] = v; this.paint(); window.scrollTo({ top: y, behavior: 'instant' }); } }, v === 0 ? '0' : v === p.marks ? '✓ ' + v : '½ (' + v + ')'))))))));
    });
    h.appendChild(el('div', { class: 'row mt1' }, el('b', null, 'Total: ' + score + ' / ' + max + ' (' + Math.round(100 * score / Math.max(1, max)) + '%)'), el('button', { class: 'btn btn-primary', disabled: !marked, onclick: () => this.finish(score, max) }, '✓ Save my result')));   // also at the end of a long review
  },
  finish(score, max) {
    const R = this.run, pct = Math.round(100 * score / Math.max(1, max));
    Store.set('ospe_last_v1', { at: Date.now(), score, max, pct, n: R.ids.length });
    const t = typeof Spotter !== 'undefined' && Spotter.topic();
    R.ids.forEach(id => { const st = this.byId(id); if (!st) return; const got = (R.marks[id] || []).reduce((n, m) => n + (Number(m) || 0), 0); StudyEngine.recordResult({ sourceType: 'ospe', sourceId: id, topic: (t && t.id) || '', mode: 'challenge', result: got >= this.total(st) ? 'correct' : got > 0 ? 'partial' : 'wrong' }); });
    toast('OSPE result saved: ' + score + ' / ' + max + ' (' + pct + '%).', 'ok'); this.run = null; this.paint();
  },
  /* ---- teacher: import / edit stations ---- */
  async save(items, what) {
    const d = Object.assign({ v: 1, title: '' }, (State.practicalCfg && State.practicalCfg.ospe) || {});
    this.keepOpen = true;
    await saveDoc('practicalcfg', 'ospe', Object.assign({}, d, { items, editedAt: Date.now() }), { history: false, label: 'Before editing OSPE stations' });
    toast(what, 'ok'); if (Router.current === 'practical') Views.practical.render();
  },
  teacherCard() {
    const all = this.all(), ready = this.ready(), file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'OSPE station file' }), msg = el('div', { class: 'small' });
    const draft = typeof picImportDraftOn === 'function' && picImportDraftOn();
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return; let d;
      try { d = JSON.parse(await f.text()); } catch (e) { msg.className = 'msg bad'; msg.textContent = 'This file could not be read.'; return; }
      if (!d || d.format !== OSPE_FORMAT || !Array.isArray(d.items)) { msg.className = 'msg bad'; msg.textContent = 'This is not an OSPE station file.'; return; }
      if (d.module && d.module !== (COURSE.moduleKey || '')) { msg.className = 'msg bad'; msg.textContent = 'This file is for another module (' + d.module + '), not ' + COURSE.title + '.'; return; }
      const items = d.items.filter(st => this.valid(st)), ok = items.filter(st => this.pics(st).length).length;
      if (!(await confirmDialog('Save ' + plural(items.length, 'OSPE station') + (all.length ? ' (replacing the ' + all.length + ' current ones)' : '') + '? ' + ok + ' of them have their pictures in the Practical topic now.', { okLabel: 'Save stations' }))) return;
      await this.save(items, 'OSPE stations saved.');
    });
    const rows = all.map((st, k) => { const p = this.pics(st)[0]; const im = el('img', { class: 'spe-thumb', alt: '' }); if (p) stImg(im, p.url);
      return el('tr', null, el('td', null, String(k + 1)), el('td', null, p ? im : el('span', { class: 'badge warn' }, 'picture missing')), el('td', null, (st.title ? st.title + ' — ' : '') + seTrunc(st.scenario || st.parts[0].q, 90)),
        el('td', null, st.parts.length + ' parts · ' + this.total(st) + ' marks'),
        el('td', { class: 'nowrap' }, el('button', { class: 'btn btn-xs', 'data-a': 'ospe-edit', onclick: () => this.form(st) }, '✎ Edit'), ' ', el('button', { class: 'btn btn-xs btn-danger', 'data-a': 'ospe-del', onclick: async () => { if (await confirmDialog('Delete OSPE station ' + (k + 1) + '?', { danger: true, okLabel: 'Delete' })) await this.save(this.all().filter(x => x.id !== st.id), 'Station deleted.'); } }, '🗑'))); });
    const c = el('details', { class: 'card ospe-teacher', open: this.keepOpen != null ? this.keepOpen : !all.length },
      el('summary', null, el('b', null, '👩‍🏫 OSPE stations (teacher)'), ' — ' + (all.length ? ready.length + ' of ' + all.length + ' ready' : 'none yet')),
      el('p', { class: 'small' }, 'Import an OSPE station file prepared for this module, or write stations here. Pictures come only from Learn → Practical. Students see the OSPE once ' + OSPE_MIN + ' stations are ready.'),
      el('div', { class: 'msg small ' + (draft ? 'ok' : 'info') }, draft ? 'You are in ✏️ Edit master draft: every group gets the stations after ⬆ Publish draft.' : 'Tip: work in ✏️ Edit master draft so that every group gets the stations.'),
      file, msg,
      el('div', { class: 'row between mt1' }, el('b', null, '✏️ Stations (' + all.length + ')'), el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'ospe-new', onclick: () => this.form(null) }, '+ New station')),
      all.length ? el('div', { class: 'spe-tablewrap' }, el('table', { class: 'spe-table' }, el('tbody', null, rows))) : null);
    c.addEventListener('toggle', () => { this.keepOpen = c.open; });
    if (typeof SpotterEdit !== 'undefined') SpotterEdit.css();
    return c;
  },
  form(st) {
    const isNew = !st, s = JSON.parse(JSON.stringify(st || { id: 'os-u' + uid('s').slice(2), title: '', pics: [], scenario: '', parts: [{ q: '', marks: 1, answer: '' }, { q: '', marks: 1, answer: '' }, { q: '', marks: 1, answer: '' }] }));
    const pool = typeof SpotterEdit !== 'undefined' ? SpotterEdit.pool() : []; let picked = pool.filter(p => (s.pics || []).some(r => SpotterEdit.same(p.ref, r)));
    const picBox = el('div', { class: 'spe-pics' });
    const paintPics = () => { clear(picBox); pool.forEach(p => { const im = el('img', { alt: p.caption || '', loading: 'lazy' }); stImg(im, p.url); const on = picked.includes(p);
      picBox.appendChild(el('button', { type: 'button', class: 'spe-pic' + (on ? ' sel' : ''), title: p.heading + ' — ' + p.caption, onclick: () => { picked = on ? picked.filter(x => x !== p) : picked.concat([p]).slice(-2); paintPics(); } }, im, el('span', null, seTrunc(p.caption || p.heading, 60)))); }); };
    paintPics();
    const title = el('input', { type: 'text', value: s.title || '', placeholder: 'e.g. Fatty change of the liver (shown to students only in the review)' });
    const scn = el('textarea', { rows: 3, 'aria-label': 'Clinical scenario' }, s.scenario || '');
    const partsBox = el('div', { class: 'stack' }); const rows = [];
    const addPart = (p) => { const q = el('input', { type: 'text', value: p.q || '', 'aria-label': 'Question' }), m = el('input', { type: 'number', min: '0.5', step: '0.5', value: String(p.marks || 1), style: 'width:5rem', 'aria-label': 'Marks' }), a = el('textarea', { rows: 2, 'aria-label': 'Model answer' }, p.answer || '');
      const row = el('div', { class: 'card-soft ospe-prow' }, el('div', { class: 'row', style: 'gap:.4rem' }, el('b', { class: 'ospe-pl' }, ''), q, m, el('button', { type: 'button', class: 'btn btn-xs btn-danger', onclick: () => { rows.splice(rows.indexOf(rec), 1); row.remove(); relabel(); } }, '🗑')), el('label', { class: 'field' }, 'Model answer', a));
      const rec = { q, m, a, row }; rows.push(rec); partsBox.appendChild(row); relabel(); };
    const relabel = () => rows.forEach((r, k) => { r.row.querySelector('.ospe-pl').textContent = LETTERS[k] + '.'; });
    (s.parts || []).forEach(addPart);
    const msg = el('div', { class: 'small' });
    const body = el('div', { class: 'stack spe-form ospe-form' },
      el('div', null, el('b', null, 'Pictures (1–2)'), el('span', { class: 'small muted' }, ' — only pictures of Learn → Practical (' + pool.length + ')'), picBox),
      el('label', { class: 'field' }, 'Station title / diagnosis (teacher; shown in the review)', title),
      el('label', { class: 'field' }, 'Clinical scenario (optional)', scn),
      el('div', null, el('div', { class: 'row between' }, el('b', null, 'Parts (questions with marks and model answers)'), el('button', { type: 'button', class: 'btn btn-xs', 'data-a': 'ospe-addpart', onclick: () => addPart({ q: '', marks: 1, answer: '' }) }, '+ Part')), partsBox),
      msg);
    openModal({ title: isNew ? '+ New OSPE station' : '✎ Edit OSPE station', body, wide: true, actions: [{ label: 'Cancel' }, { label: isNew ? 'Add station' : 'Save changes', primary: true, keepOpen: true, onClick: async (close) => {
      const parts = rows.map(r => ({ q: r.q.value.trim(), marks: Number(r.m.value) || 0, answer: r.a.value.trim() }));
      const err = !picked.length ? 'Choose at least one picture.' : !parts.length ? 'Add at least one part.' : parts.some(p => !p.q) ? 'Every part needs a question.' : parts.some(p => !(p.marks > 0)) ? 'Every part needs marks (more than 0).' : parts.some(p => !p.answer) ? 'Every part needs a model answer.' : '';
      if (err) { msg.className = 'msg bad'; msg.textContent = err; return false; }
      const out = { id: s.id, title: title.value.trim(), pics: picked.map(p => p.ref), scenario: scn.value.trim(), parts };
      const items = this.all().slice(); const i = items.findIndex(x => x.id === s.id); if (i >= 0) items[i] = out; else items.push(out);
      close(true); await this.save(items, isNew ? 'Station added.' : 'Station saved.');
    } }] });
  },
  css() {
    if (document.getElementById('ospe-css')) return;
    document.head.appendChild(el('style', { id: 'ospe-css' },
      '.ospe-top{display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.5rem}' +
      '.ospe-time{font-variant-numeric:tabular-nums;font-weight:700;font-size:1.15rem;color:var(--navy,#0b2340);background:#eef3f9;border-radius:8px;padding:.15rem .6rem}.ospe-time.low{color:#b91c1c;background:#fdecec}' +
      '.ospe-pics{display:grid;gap:.6rem;grid-template-columns:1fr}.ospe-pics.n2{grid-template-columns:1fr 1fr}@media(max-width:700px){.ospe-pics.n2{grid-template-columns:1fr}}' +
      '.ospe-img{width:100%;max-height:52vh;object-fit:contain;background:#0f1c2b;border-radius:10px;cursor:zoom-in}.ospe-thumb{width:100%;max-height:200px;object-fit:contain;background:#0f1c2b;border-radius:8px;cursor:zoom-in}' +
      '.ospe-scn{font-weight:600;color:var(--navy,#0b2340);margin:.7rem 0 .4rem;line-height:1.45}' +
      '.ospe-parts{margin:.2rem 0 0 1.3rem;padding:0}.ospe-parts>li{margin:.55rem 0}.ospe-q{display:flex;justify-content:space-between;gap:.6rem}.ospe-m{color:var(--muted,#64748b);white-space:nowrap}' +
      '.ospe-parts textarea{width:100%;margin-top:.25rem}' +
      '.ospe-cmp{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:.3rem 0}@media(max-width:700px){.ospe-cmp{grid-template-columns:1fr}}' +
      '.ospe-yours,.ospe-model{border:1px solid var(--line,#d5dde7);border-radius:8px;padding:.4rem .55rem;background:#fff;white-space:pre-wrap;min-height:2rem}.ospe-model{background:#eef8f7;border-color:#bfe3e0}' +
      '.ospe-mk{gap:.3rem}.ospe-rev{margin-top:.6rem}.ospe-teacher{margin-bottom:.8rem}.ospe-teacher summary{cursor:pointer}.ospe-prow input[type=text]{flex:1}'));
  }
};
(function () {   // the Practical router and tabs get the OSPE (as the Image atlas does)
  const V = Views.practical; if (!V) return;
  const render0 = V.render;
  V.render = function () { if ((this.params || [])[0] === 'ospe') return PracOspe.render(); return render0.apply(this, arguments); };
  const tabs0 = pracTabs;
  pracTabs = function (active) {
    const n = tabs0(active);
    if (!Auth.isTeacher() && PracOspe.ready().length < OSPE_MIN) return n;   // students: only once stations are ready
    const b = el('button', { class: 'tab' + (active === 'ospe' ? ' active' : ''), 'data-a': 'ospe-tab', onclick: () => Router.go('practical', ['ospe']) }, '📝 OSPE exam');
    n.insertBefore(b, n.children[2] || null);
    if (active === 'ospe') n.querySelectorAll('.tab').forEach(t => { if (t !== b) t.classList.remove('active'); });
    return n;
  };
  if (typeof StudyEngine !== 'undefined') { const res0 = StudyEngine.resolve.bind(StudyEngine); StudyEngine.resolve = function (m) { if (m && m.sourceType === 'ospe') { const st = PracOspe.byId(m.sourceId); return st ? { title: 'OSPE: ' + (st.title || seTrunc(st.scenario || st.parts[0].q, 80)), topic: (Spotter.topic() || {}).id || '' } : null; } return res0(m); }; }
  Bus.on('synced', () => { if (Router.current === 'practical' && (Views.practical.params || [])[0] === 'ospe' && !PracOspe.run) Views.practical.render(); });
})();

/* ---------- 3 · Pathology Challenge: registry images, unlabelled ---------- */"""),
("""      { g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology — practice or a 20-picture exam.'""",
 """      { g: '📝', title: 'OSPE exam', sub: 'Timed practical stations: pictures, a clinical scenario and short-answer questions with marks.', href: '#/practical/ospe', meta: (typeof PracOspe !== 'undefined' && PracOspe.ready().length >= OSPE_MIN) ? plural(PracOspe.ready().length, 'station') : '' },
      { g: '◆', title: 'Pathology Spotter', sub: 'Image-Based Practical Assessment in Pathology — practice or a 20-picture exam.'"""),
]
DONE = '/* ---------- 📝 OSPE exam on the practical cases (patch ospe; #/practical/ospe) ---------- */'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s or (b.startswith(DONE) and DONE in s): continue   # the block may have been edited by a later patch (spotter-ospe-multipic)
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
