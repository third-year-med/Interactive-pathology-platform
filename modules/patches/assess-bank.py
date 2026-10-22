"""🔒 Assessment-only question bank (Portal.gs 2.33). Questions for assessments ONLY: kept on the class server as private
rows of the module's main copy (priv:assessbank), loaded by teachers only (qbList) and never part of QUESTIONS — so
Practice / Revision / Learn / quick quizzes / progress never show them and no student browser ever receives them.
Q_BY_ID knows them in a teacher's browser, so the assessment builder (source “🔒 Assessment bank”), ⚡ Create from filter
and ⚡ Topic quizzes can use them (a topic with at least 5 bank questions takes its topic quiz from the bank, otherwise its
practice questions as before); publishing freezes the questions an assessment uses and students see a question only
inside their own attempt. Teacher Portal → 📝 Assessments → 🔒 Assessment bank: import a bank file (neo-assessment-bank),
list per topic, preview, delete (Admin, from the main copy or ✏️ Edit master draft). A student's browser drops any
published assessment version it still holds (the server stops sending them in 2.33). Idempotent.
Edits lines inside the topic-quizzes block: topic-quizzes.py carries the done-marker for it."""
import sys
R = [
# the bank store — before rebuildQuestions so Q_BY_ID can always include it
("""let QUESTIONS = [];
const Q_BY_ID = {};
""", """let QUESTIONS = [];
const Q_BY_ID = {};
/* ---------- 🔒 Assessment-only question bank (Portal.gs 2.33, patch assess-bank) ----------
   Questions for assessments ONLY. On the class server they are private rows of the module's main copy, loaded by teachers
   only (qbList) and never part of QUESTIONS — so Practice, Revision, Learn, quick quizzes and progress never show them and
   no student browser ever receives them. Q_BY_ID knows them (teachers), so an assessment can use them: publishing freezes
   the questions it uses, and students meet a question only inside their own attempt. Local mode: this browser only. */
const ABANK_FORMAT = 'neo-assessment-bank', ABANK_LOCAL = 'assess_bank_v1';
const ABANK = {
  items: [], loaded: false, canEdit: false, error: '', _p: null,
  local() { return !Backend.isConfigured(); },
  load(force) {
    if (this._p) return this._p;
    if (this.loaded && !force) return Promise.resolve(this.items);
    this._p = (async () => {
      if (this.local()) { this.set(Store.get(ABANK_LOCAL, []), true); return this.items; }
      const r = await Backend.authedPost({ action: 'qbList' }, { timeout: 60000 });
      if (r && r.ok) { this.error = ''; this.set(r.items || [], !!r.canEdit); }
      else this.error = r && /unknown action/i.test(r.error || '') ? 'The class server needs Portal.gs 2.33 for the assessment bank (Apps Script → Deploy → Manage deployments → New version).' : ((r && r.error) || 'The assessment bank could not be loaded.');
      return this.items;
    })().finally(() => { this._p = null; });
    return this._p;
  },
  set(list, canEdit) {
    this.items.forEach(q => { if (Q_BY_ID[q.id] === q) delete Q_BY_ID[q.id]; });
    this.items = (list || []).filter(q => q && q.id).map(q => Object.assign({}, q, { bank: true, imported: false }));
    this.items.forEach(q => { if (!Q_BY_ID[q.id]) Q_BY_ID[q.id] = q; });
    this.loaded = true; this.canEdit = !!canEdit;
  },
  forTopic(tid) { return this.items.filter(q => q.topic === tid && isFormalEligible(q)).map(q => q.id); },
  /** Adds / replaces questions (by id). progress(text) while it goes; returns {saved, rejected[]}. */
  async save(items, progress) {
    if (this.local()) {
      const by = {}; this.items.forEach(q => { by[q.id] = q; }); items.forEach(q => { by[q.id] = q; });
      const all = Object.values(by).map(q => { const c = Object.assign({}, q); delete c.bank; delete c.imported; return c; });
      if (!Store.set(ABANK_LOCAL, all)) return { saved: 0, rejected: ['This browser’s storage is full.'] };
      this.set(all, true); return { saved: items.length, rejected: [] };
    }
    let saved = 0; const rejected = [];
    for (let i = 0; i < items.length; i += 25) {
      if (progress) progress('Saving questions ' + (i + 1) + '–' + Math.min(i + 25, items.length) + ' of ' + items.length + '…');
      const r = await Backend.authedPost({ action: 'qbSave', items: items.slice(i, i + 25) }, { timeout: 90000 });
      if (!r || !r.ok) { rejected.push((r && r.error) || 'The class server did not answer.'); break; }
      saved += r.saved || 0; (r.rejected || []).forEach(x => rejected.push(x));
    }
    await this.load(true);
    return { saved, rejected };
  },
  async remove(ids, all) {
    if (this.local()) { const keep = all ? [] : this.items.filter(q => !ids.includes(q.id)); Store.set(ABANK_LOCAL, keep); this.set(keep, true); return { ok: true }; }
    const r = await Backend.authedPost(all ? { action: 'qbDelete', all: true } : { action: 'qbDelete', ids }, { timeout: 60000 });
    await this.load(true);
    return r || { ok: false, error: 'The class server did not answer.' };
  }
};
/** What a picked topic quiz says about its questions. */
function tqDescription(TQ, x) { return TQ.n + ' random questions from the ' + x.pool.length + (x.src === 'bank' ? ' 🔒 assessment-bank questions of this topic (never shown in Practice)' : ' practice questions of this topic') + ' · ' + TQ.min + ' minutes.'; }
"""),
("""  QUESTIONS.forEach(q => { Q_BY_ID[q.id] = q; });
""", """  QUESTIONS.forEach(q => { Q_BY_ID[q.id] = q; });
  ABANK.items.forEach(q => { if (!Q_BY_ID[q.id]) Q_BY_ID[q.id] = q; });   // 🔒 assessment bank: usable in assessments, never in QUESTIONS
"""),
# a student's browser never keeps published assessment versions (frozen questions + answer keys)
("""    case 'assessmentversions': State.assessmentVersions = upsertById(""",
"""    case 'assessmentversions': if (!deleted && window.NEO_BOOT && NEO_BOOT.role === 'student') return null;   // 2.33: never kept by students
      State.assessmentVersions = upsertById("""),
("""/** Current value of a document as stored in State (used for version-history snapshots). */""",
"""if (window.NEO_BOOT && NEO_BOOT.role === 'student' && (State.assessmentVersions || []).length) { State.assessmentVersions = []; Store.set(STATE_SPEC.assessmentVersions.key, []); }   // 2.33: drop an older copy
/** Current value of a document as stored in State (used for version-history snapshots). */"""),
# question pickers of the assessment builder can include the bank (source filter + badge); other pickers do not
("""  return QUESTIONS.filter(q => {
    if (st.topic && q.topic !== st.topic) return false;""", """  return (st.withBank ? QUESTIONS.concat(ABANK.items) : QUESTIONS).filter(q => {
    if (st.source === 'bank' ? !q.bank : (q.bank && st.source)) return false;   // 🔒 assessment bank: only "All sources" or its own source
    if (q.bank && st.rev === 'yes') return false;
    if (st.topic && q.topic !== st.topic) return false;"""),
("""['imported', 'Imported (any batch)']].concat(batches""", """['imported', 'Imported (any batch)']].concat(st.withBank ? [['bank', '🔒 Assessment bank (assessment only)']] : []).concat(batches"""),
("""bankFilterDefaults({ elig: opts.defaultElig || '', sel: st.sel })""", """bankFilterDefaults({ elig: opts.defaultElig || '', sel: st.sel, withBank: st.withBank })"""),
("""q.imported ? el('div', null, el('span', { class: 'badge violet' }, 'Imported')) : null),""",
"""q.imported ? el('div', null, el('span', { class: 'badge violet' }, 'Imported')) : null, q.bank ? el('div', null, el('span', { class: 'badge warn', title: 'Assessment only — never shown in Practice' }, '🔒 Bank')) : null),"""),
("""  bank: bankFilterDefaults({ elig: 'yes' }), showBank: false,""", """  bank: bankFilterDefaults({ elig: 'yes', withBank: true }), showBank: false,"""),
("""    this.bank = bankFilterDefaults({ elig: 'yes', usage: '' });""", """    this.bank = bankFilterDefaults({ elig: 'yes', usage: '', withBank: true });"""),
("""    const st = bankFilterDefaults({ elig: 'yes' });
    const body = el('div');""", """    const st = bankFilterDefaults({ elig: 'yes', withBank: true });
    const body = el('div');"""),
# the bank loads with the Assessments' private data
("""  async loadPrivate(force) {
    if (this.assignments && this.groups && !force) return;""", """  async loadPrivate(force) {
    const abl = ABANK.load(force);   // 🔒 assessment bank (teachers), in parallel
    if (this.assignments && this.groups && !force) return abl;"""),
("""    this.groups = g && g.ok ? g.groups : [];
""", """    this.groups = g && g.ok ? g.groups : [];
    await abl;
"""),
# sub-tab 🔒 Assessment bank
("""    const inner = el('div', { class: 'mt1' }); box.appendChild(inner);
    if (this.sub === 'assignments') return this.renderAssignments(inner);""", """    const inner = el('div', { class: 'mt1' }); box.appendChild(inner);
    const tabs = box.querySelector('.sub-tabs'); if (tabs) tabs.appendChild(el('button', { class: 'chip' + (this.sub === 'abank' ? ' active' : ''), role: 'tab', 'data-a': 'abank', 'aria-selected': String(this.sub === 'abank'), onclick: () => { this.sub = 'abank'; this.render(box); } }, '🔒 Assessment bank'));
    if (this.sub === 'abank') return renderAssessBank(inner);
    if (this.sub === 'assignments') return this.renderAssignments(inner);"""),
# ⚡ Topic quizzes: bank first
("""      const pool = QUESTIONS.filter(q => q.topic === t.id && q.type !== 'short' && !rev.has(q.id)).map(q => q.id);
      const ex = (State.assessments || []).find(a => a.autoTopic === t.id && a.status !== 'archived') || null;
      return { t, num: i + 1, pool, ex, ok: pool.length >= TQ.n };""", """      const prac = QUESTIONS.filter(q => q.topic === t.id && q.type !== 'short' && !rev.has(q.id)).map(q => q.id);
      const bank = ABANK.forTopic(t.id), pool = bank.length >= TQ.n ? bank : prac;   // 🔒 the assessment bank first (≥ 5 questions), else practice
      const ex = (State.assessments || []).find(a => a.autoTopic === t.id && a.status !== 'archived') || null;
      return { t, num: i + 1, pool, ex, ok: pool.length >= TQ.n, src: pool === bank ? 'bank' : 'practice', change: !!ex && !(pool.length === (ex.questionIds || []).length && pool.every(id => (ex.questionIds || []).includes(id))) };"""),
("""  async topicQuizzesDialog() {
    const plan = this.topicQuizPlan(), TQ = plan.TQ;""", """  async topicQuizzesDialog() {
    await ABANK.load();
    const plan = this.topicQuizPlan(), TQ = plan.TQ;"""),
("""el('td', { class: 'nowrap' }, String(x.pool.length)),
      el('td', { class: 'small' }, !x.ok ? el('span', { style: 'color:var(--bad)' }, '⏭ skipped — fewer than ' + TQ.n + ' questions') : x.ex ? '• exists (“' + x.ex.title + '”)' : el('b', { style: 'color:var(--ok)' }, '✓ new quiz'))));""",
"""el('td', { class: 'nowrap' }, String(x.pool.length) + (x.src === 'bank' ? ' 🔒' : '')),
      el('td', { class: 'small' }, !x.ok ? el('span', { style: 'color:var(--bad)' }, '⏭ skipped — fewer than ' + TQ.n + ' questions') : x.ex ? '• exists (“' + x.ex.title + '”)' + (x.change ? ' — Refresh gives it these ' + (x.src === 'bank' ? '🔒 bank' : '') + ' questions' : '') : el('b', { style: 'color:var(--ok)' }, '✓ new quiz'))));"""),
("""'One quiz per topic, built from that topic’s practice questions: each student gets '""",
"""'One quiz per topic, built from that topic’s 🔒 assessment-bank questions when it has at least ' + TQ.n + ' (never shown in Practice; ' + ABANK.items.length + ' in the bank), otherwise from its practice questions: each student gets '"""),
("""a.questionIds = x.pool.slice(); a.mode = 'pool';""", """a.questionIds = x.pool.slice(); a.description = tqDescription(TQ, x); a.mode = 'pool';"""),
("""            description: TQ.n + ' random questions from the ' + x.pool.length + ' practice questions of this topic · ' + TQ.min + ' minutes.', settings: settings() });""",
"""            description: tqDescription(TQ, x), settings: settings() });"""),
# the Teacher Portal screen
("""function previewQuestion(q) {""", r"""/* ---------- 📝 Assessments → 🔒 Assessment bank ---------- */
const ABANK_UI = { topic: '', q: '', page: 0, plan: null, busy: false, msg: '', cls: '' };
/** Checks a bank file against this course: new, replacing, unchanged, or not possible (with the reason). */
function abankPlan(data) {
  if (!data || data.format !== ABANK_FORMAT || !Array.isArray(data.items)) return { error: 'This is not an assessment-bank file.' };
  const mods = (Array.isArray(data.modules) ? data.modules : []).concat(data.module ? [data.module] : []);
  if (mods.length && !mods.includes(COURSE.moduleKey || '')) return { error: 'This file is for another module (' + mods.join(', ') + '), not ' + COURSE.title + '.' };
  const topics = new Set(getTopics(true).map(t => t.id)), have = {}; ABANK.items.forEach(q => { have[q.id] = q; });
  const add = [], upd = [], same = [], bad = [];
  const strip = q => { const c = Object.assign({}, q); delete c.bank; delete c.imported; return JSON.stringify(c); };
  data.items.forEach((q, i) => {
    const label = (q && q.id ? q.id + ' — ' : '') + String((q && q.stem) || 'Question ' + (i + 1)).slice(0, 90);
    const n = Array.isArray(q && q.options) ? q.options.length : 0;
    const why = !q || !/^[A-Za-z0-9_.:-]{1,80}$/.test(String(q.id || '')) ? 'no valid id'
      : !(q.type === 'mcq' || q.type === 'vignette' || q.type === 'selectall') ? 'type ' + q.type + ' is not auto-marked here'
      : !String(q.stem || '').trim() || n < 2 ? 'no question text or options'
      : q.type === 'selectall' ? (!(Array.isArray(q.answers) && q.answers.length && q.answers.every(k => k >= 0 && k < n)) ? 'no correct options' : '')
      : !(typeof q.answer === 'number' && q.answer >= 0 && q.answer < n) ? 'no correct option' : '';
    if (why) bad.push({ label, why });
    else if (!topics.has(q.topic)) bad.push({ label, why: 'topic ' + q.topic + ' is not in this course' });
    else if (Q_BY_ID[q.id] && !Q_BY_ID[q.id].bank) bad.push({ label, why: 'a practice question already has this id' });
    else if (have[q.id]) (strip(have[q.id]) === strip(q) ? same : upd).push({ label, q });
    else add.push({ label, q });
  });
  return { add, upd, same, bad, total: data.items.length, title: String(data.title || '') };
}
function renderAssessBank(box) {
  clear(box);
  const U = ABANK_UI, repaint = () => renderAssessBank(box);
  box.appendChild(el('div', { class: 'card abank-intro' }, el('h3', { style: 'margin-top:0' }, '🔒 Assessment question bank — ' + COURSE.title),
    el('p', { class: 'small', style: 'margin-bottom:0' }, 'Questions for ', el('b', null, 'assessments only'), '. They never appear in Practice, Revision, Learn or any student page, and they are never sent to students’ browsers. ',
      'Your assessments can use them (📚 Library → builder or ⚡ Create from filter → source “🔒 Assessment bank”), and ', el('b', null, '⚡ Topic quizzes'),
      ' take a topic’s quiz from the bank when that topic has at least 5 bank questions. A student sees a bank question only inside their own attempt.')));
  if (!ABANK.loaded) { box.appendChild(el('div', { class: 'card empty' }, 'Loading the assessment bank…')); ABANK.load().then(repaint); return; }
  if (ABANK.error) box.appendChild(el('div', { class: 'msg bad' }, ABANK.error));
  // per topic
  const per = {}; ABANK.items.forEach(q => { per[q.topic] = (per[q.topic] || 0) + 1; });
  box.appendChild(el('div', { class: 'card mt1' }, el('b', null, plural(ABANK.items.length, 'question') + ' in the bank'),
    ABANK.items.length ? el('div', { class: 'table-scroll mt1' }, el('table', { class: 'data-table abank-topics' }, el('thead', null, el('tr', null, ['#', 'Topic', 'Bank questions', 'Topic quiz from'].map(h => el('th', null, h)))),
      el('tbody', null, getTopics().map((t, i) => el('tr', null, el('td', null, String(i + 1)), el('td', null, t.title), el('td', null, String(per[t.id] || 0)),
        el('td', { class: 'small' }, (per[t.id] || 0) >= 5 ? '🔒 the bank' : 'practice questions')))))) : null));
  // import
  const imp = el('div', { class: 'card mt1 abank-import' }, el('h3', { style: 'margin-top:0' }, '⬆ Add questions from a bank file'));
  if (!ABANK.canEdit) imp.appendChild(el('p', { class: 'msg info' }, 'The bank is the same for every group of this module. To add or delete questions open the module with ✏️ Edit master draft (Platform Home → Content) and use this tab there. Here you can use the bank in assessments.'));
  else {
    const file = el('input', { type: 'file', accept: '.json,application/json', disabled: U.busy, 'aria-label': 'Assessment bank file' });
    const out = el('div'), run = el('div', { class: 'abank-run ' + U.cls }, U.msg);
    const go = el('button', { class: 'btn btn-primary mt1', disabled: !U.plan || !(U.plan.add.length + U.plan.upd.length) || U.busy, onclick: async () => {
      const p = U.plan; if (!p || U.busy) return;
      const list = p.add.concat(p.upd).map(x => x.q);
      if (!(await confirmDialog('Add ' + p.add.length + ' and update ' + p.upd.length + ' question(s) in the 🔒 assessment bank of ' + COURSE.title + '? They stay hidden from students and from Practice.', { okLabel: 'Add to the bank' }))) return;
      U.busy = true; U.cls = 'msg info'; U.msg = 'Saving…'; repaint();
      let r; try { r = await ABANK.save(list, t => { U.msg = t; const n = box.querySelector('.abank-run'); if (n) n.textContent = t; }); } finally { U.busy = false; }
      U.plan = null; U.cls = r.rejected.length ? 'msg bad' : 'msg ok';
      U.msg = '✓ ' + plural(r.saved, 'question') + ' saved · the bank now holds ' + ABANK.items.length + '.' + (r.rejected.length ? ' NOT saved: ' + r.rejected.join(' · ') : '');
      repaint();
    } }, '🔒 Add to the bank');
    file.addEventListener('change', async () => {
      U.plan = null; U.msg = ''; U.cls = ''; const f = file.files[0]; if (!f) return repaint();
      let data; try { data = JSON.parse(await f.text()); } catch (e) { U.cls = 'msg bad'; U.msg = 'This file is not an assessment-bank file (not valid JSON).'; return repaint(); }
      const p = abankPlan(data); if (p.error) { U.cls = 'msg bad'; U.msg = p.error; return repaint(); }
      U.plan = p; U.cls = 'msg info';
      U.msg = (p.title ? '“' + p.title + '”: ' : '') + p.add.length + ' new · ' + p.upd.length + ' changed · ' + p.same.length + ' already in the bank' + (p.bad.length ? ' · ' + p.bad.length + ' cannot be added' : '') + '.';
      repaint();
    });
    imp.appendChild(el('p', { class: 'small muted' }, 'A bank file (format ' + ABANK_FORMAT + ') adds its questions with their topic, answer and explanation. A question already in the bank (same id) is replaced by the file’s version; nothing else changes. Assessments already published keep the version they froze.'));
    imp.appendChild(file);
    if (U.plan) out.appendChild(el('ul', { class: 'small abank-plan' }, U.plan.bad.map(x => el('li', null, el('b', null, x.label), ' — not possible: ' + x.why)),
      U.plan.upd.map(x => el('li', null, x.label + ' — replaces the bank version')), U.plan.add.length ? el('li', null, plural(U.plan.add.length, 'new question')) : null));
    imp.appendChild(out); imp.appendChild(run); imp.appendChild(go);
  }
  box.appendChild(imp);
  if (!ABANK.items.length) return;
  // list
  const qn = normText(U.q);
  const list = ABANK.items.filter(q => (!U.topic || q.topic === U.topic) && (!qn || normText(q.id + ' ' + q.stem + ' ' + (q.options || []).join(' ') + ' ' + (q.sourceRef || '')).includes(qn)))
    .sort((a, b) => (topicNum(a.topic) || 99) - (topicNum(b.topic) || 99) || String(a.id).localeCompare(String(b.id)));
  const per25 = 25, pages = Math.max(1, Math.ceil(list.length / per25)); U.page = clamp(U.page, 0, pages - 1);
  const topicSel = el('select', { 'aria-label': 'Topic', onchange: e => { U.topic = e.target.value; U.page = 0; repaint(); } }, topicOptions(U.topic));
  const qi = el('input', { type: 'search', placeholder: 'Search the bank…', value: U.q, 'aria-label': 'Search the bank' });
  qi.addEventListener('input', debounce(() => { U.q = qi.value; U.page = 0; repaint(); setTimeout(() => { const n = box.querySelector('.abank-list input[type=search]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); }, 300));
  const key = q => q.type === 'selectall' ? (q.answers || []).map(i => 'ABCDEFGH'[i]).join(', ') : 'ABCDEFGH'[q.answer];
  const del = async (ids, all) => {
    if (!(await confirmDialog(all ? 'Delete ALL ' + ABANK.items.length + ' questions from the assessment bank? Assessments already published keep their frozen copies.' : 'Delete this question from the assessment bank? Assessments already published keep their frozen copy.', { okLabel: 'Delete' }))) return;
    const r = await ABANK.remove(ids, all); toast(r && r.ok ? '✓ Deleted from the bank.' : '✗ ' + ((r && r.error) || 'Could not delete.'), r && r.ok ? 'ok' : 'bad', 5000); repaint();
  };
  box.appendChild(el('div', { class: 'card mt1 abank-list' },
    el('div', { class: 'toolbar' }, qi, topicSel, el('span', { class: 'small muted' }, plural(list.length, 'question')),
      ABANK.canEdit ? el('button', { class: 'btn btn-sm btn-ghost', 'data-a': 'abank-clear', onclick: () => del([], true) }, '🗑 Delete all') : null),
    el('div', { class: 'table-scroll mt1' }, el('table', { class: 'data-table' }, el('thead', null, el('tr', null, ['ID', 'Topic · type', 'Question', 'Key', ''].map(h => el('th', null, h)))),
      el('tbody', null, list.slice(U.page * per25, U.page * per25 + per25).map(q => el('tr', { 'data-id': q.id },
        el('td', null, el('code', { class: 'small' }, q.id)),
        el('td', { class: 'small' }, (topicNum(q.topic) ? 'T' + topicNum(q.topic) + ' · ' : '') + (TYPE_LABELS[q.type] || q.type)),
        el('td', { class: 'bank-stem' }, q.stem.slice(0, 160) + (q.stem.length > 160 ? '…' : ''), q.sourceRef ? el('div', { class: 'small muted' }, q.sourceRef) : null),
        el('td', { class: 'nowrap' }, el('b', null, key(q))),
        el('td', { class: 'nowrap' }, el('button', { class: 'btn btn-xs', onclick: () => previewQuestion(q) }, 'Preview'),
          ABANK.canEdit ? el('button', { class: 'btn btn-xs btn-ghost', title: 'Delete from the bank', onclick: () => del([q.id]) }, '🗑') : null)))))),
    pages > 1 ? el('div', { class: 'row center mt1' },
      el('button', { class: 'btn btn-sm', disabled: U.page === 0, onclick: () => { U.page--; repaint(); } }, '‹ Prev'),
      el('span', { class: 'small muted' }, 'Page ' + (U.page + 1) + ' of ' + pages),
      el('button', { class: 'btn btn-sm', disabled: U.page >= pages - 1, onclick: () => { U.page++; repaint(); } }, 'Next ›')) : null));
}
function previewQuestion(q) {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for r in R:
        a, b = r[0], r[1]
        if b in s or (len(r) > 2 and r[2] in s): continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
