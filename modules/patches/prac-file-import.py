"""📦 Import a practical file (user, 2026-10-28): Apply → Practical → ✨ Create from PDF gets a card that reads a
practical-import file (format neo-practical-import, made in a work session from the teacher's own picture folder): every
practical in it — objectives, specimen, gross, microscopic, key features, diagnosis, questions, viva — becomes a draft
WITH its real pictures, each uploaded to the class picture folder exactly as "⤒ Upload images" does. A practical already
imported (same key) is skipped, so running the file twice adds nothing; each practical is saved as soon as it is done, so
an interrupted import keeps what was finished. Afterwards "✅ Approve & publish all" publishes the imported practicals that
pass the quality check (or the teacher reviews them one by one as usual). Inside ✏️ Edit master draft the published
practicals go to the master draft (all groups after ⬆ Publish draft). Idempotent."""
import sys
R = [
("""      el('button', { class: 'btn', onclick: () => Router.go('practical') }, '◀ Back')));
    const st = PracAI.status || await PracAI.refreshStatus();""",
 """      el('button', { class: 'btn', onclick: () => Router.go('practical') }, '◀ Back')));
    page.appendChild(pracFileCard());
    const st = PracAI.status || await PracAI.refreshStatus();"""),
("""/* ============================ Create from PDF ============================ */
const PracImportUI = {""",
 """/* ---------- 📦 Import a practical file (practical-import file → drafts with their real pictures) ---------- */
const PRAC_FILE_FORMAT = 'neo-practical-import';
const PRAC_FILE = { busy: false, last: null };
const PRAC_FILE_IMG = /^data:image\\/(jpeg|png|webp);base64,/;
/** Checks a practical-import file against this course: which practicals can be added, which are already there. */
function pracFilePlan(data) {
  if (!data || data.format !== PRAC_FILE_FORMAT || !Array.isArray(data.practicals)) return { error: 'This is not a practical-import file.' };
  if (data.module && data.module !== (COURSE.moduleKey || '')) return { error: 'This file is for another module (' + data.module + '), not ' + COURSE.title + '.' };
  const add = [], have = [];
  data.practicals.forEach((p, i) => {
    const key = String((p && p.key) || ''), title = String((p && p.title) || 'Practical ' + (i + 1)).slice(0, 120);
    const pics = (p && Array.isArray(p.images) ? p.images : []).filter(im => im && PRAC_FILE_IMG.test(String(im.image || ''))).length;
    (key && PracData.drafts.some(d => d.importKey === key) ? have : add).push({ p, key, title, pics });
  });
  return { add, have, total: data.practicals.length };
}
/** Adds the planned practicals one by one: pictures uploaded first, then the draft saved; progress(text) as it goes. */
async function pracFileRun(plan, data, progress) {
  const batchId = uid('pbatch'), notes = [], drafts = [];
  let next = PracData.drafts.length ? Math.max(...PracData.drafts.map(d => d.number || 0)) : 0;
  for (let k = 0; k < plan.add.length; k++) {
    const { p, key, title } = plan.add[k];
    if (key && PracData.drafts.some(d => d.importKey === key)) continue;   // added meanwhile (e.g. another tab)
    const d = PE_buildDraft(Object.assign({}, p, { number: ++next }), { engine: 'file', fileName: data.title || 'Practical file', pages: '', text: '', batchId });
    d.importKey = key;
    const imgs = (Array.isArray(p.images) ? p.images : []).filter(im => im && PRAC_FILE_IMG.test(String(im.image || '')));
    for (let j = 0; j < imgs.length; j++) {
      const im = imgs[j];
      progress('Practical ' + (k + 1) + ' of ' + plan.add.length + ' — ' + title + ': picture ' + (j + 1) + ' of ' + imgs.length + '…');
      try {
        const blob = dataUrlToBlob(im.image);
        const r = await PracImages.upload(new File([blob], im.filename || ((key || 'practical') + '-' + (j + 1) + '.jpg'), { type: blob.type || 'image/jpeg' }));
        const slot = PE_IMAGE_SLOTS[im.slot] ? im.slot : 'additional';
        d.images.push({ id: uid('img'), slot, kind: PE_IMAGE_KINDS[im.kind] ? im.kind : slot === 'additional' ? 'other' : slot, url: r.url, fileId: r.fileId, w: r.w, h: r.h,
          caption: String(im.caption || '') + (im.credit ? ' — ' + im.credit : ''), annotation: '', stain: String(im.stain || (slot === 'micro' ? d.stain || '' : '')), magnification: String(im.magnification || ''), marks: [], active: true });
      } catch (e) { notes.push(title + ', picture ' + (j + 1) + ': ' + e.message); }
    }
    progress('Saving ' + title + '…');
    await PracData.saveMany([d]);   // one by one: an interrupted import keeps what was finished
    drafts.push(d);
  }
  return { drafts, notes, batchId };
}
/** Approves and publishes the given practicals that pass the quality check; returns what was published and what was not. */
async function pracFilePublishAll(ids, progress) {
  const done = [], left = [];
  for (const id of ids) {
    const d = PracData.get(id); if (!d) continue;
    if (PE_qcSummary(PracData.qc(d)).errors) { left.push(d.title); continue; }
    progress('Publishing ' + d.title + '…');
    if (d.status !== 'approved' && d.status !== 'published') await PracData.approve(d);
    if (d.status !== 'published' || PracData.hasUnpublishedChanges(d)) await PracData.publish(d);
    done.push(d.title);
  }
  return { done, left };
}
function pracFileCard() {
  const draft = typeof picImportDraftOn === 'function' && picImportDraftOn();
  const where = el('div', { class: 'msg small ' + (draft ? 'ok' : 'info') }, draft ? 'You are in ✏️ Edit master draft: practicals you publish go to the master draft — every group gets them after ⬆ Publish draft.'
    : 'Tip: with versioned content on, open ✏️ Edit master draft first (Teacher Dashboard) so that every group gets the published practicals.');
  const file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Practical-import file' });
  const list = el('div'), msg = el('div', { class: 'small' }), run = el('div', { class: 'small' }), after = el('div');
  let plan = null, data = null;
  const go = el('button', { class: 'btn btn-primary', disabled: true, 'data-a': 'prac-file-go', onclick: async () => {
    if (!plan || PRAC_FILE.busy) return;
    PRAC_FILE.busy = true; go.disabled = true; file.disabled = true; clear(after);
    try {
      const r = await pracFileRun(plan, data, (t) => { run.textContent = t; });
      PRAC_FILE.last = r;
      Store.set('prac_last_batch', { batchId: r.batchId, summary: pracSummary(r.drafts, null), notes: r.notes, engine: 'file', fileName: data.title || 'Practical file' });
      run.className = 'msg ' + (r.notes.length ? 'warn' : 'ok');
      run.textContent = '✓ ' + plural(r.drafts.length, 'practical') + ' added as drafts with ' + plural(r.drafts.reduce((n, d) => n + d.images.length, 0), 'picture') + '.' + (r.notes.length ? ' Not uploaded: ' + r.notes.join(' · ') : '');
      const pub = el('div', { class: 'small' });
      after.appendChild(el('div', { class: 'row mt1' },
        el('button', { class: 'btn btn-primary', 'data-a': 'prac-file-publish', onclick: async (e) => {
          e.target.disabled = true; const x = await pracFilePublishAll(r.drafts.map(d => d.id), (t) => { pub.textContent = t; });
          pub.className = 'msg ' + (x.left.length ? 'warn' : 'ok'); pub.textContent = '🚀 ' + plural(x.done.length, 'practical') + ' published — students see them in Apply → Practical.' + (x.left.length ? ' Not published (open them to fix the quality check): ' + x.left.join(', ') : '');
        } }, '✅ Approve & publish all ' + r.drafts.length),
        el('button', { class: 'btn', onclick: () => Router.go('practical', ['review', r.batchId]) }, '🔍 Review them one by one')));
      after.appendChild(pub);
    } catch (e) { run.className = 'msg bad'; run.textContent = 'The import stopped: ' + e.message + ' — what was finished is kept; run the file again to add the rest.'; }
    PRAC_FILE.busy = false; file.disabled = false;
  } }, 'Import practicals');
  file.addEventListener('change', async () => {
    clear(list); clear(after); msg.className = 'small'; msg.textContent = ''; run.className = 'small'; run.textContent = ''; go.disabled = true; plan = null;
    const f = file.files[0]; if (!f) return;
    try { data = JSON.parse(await f.text()); } catch (e) { msg.className = 'msg bad'; msg.textContent = 'This file could not be read as a practical-import file.'; return; }
    if (!PracData.loaded) await PracData.load();
    const p = pracFilePlan(data);
    if (p.error) { msg.className = 'msg bad'; msg.textContent = p.error; return; }
    plan = p;
    list.appendChild(el('ul', { class: 'small prac-file-list' }, p.add.map(x => el('li', null, el('b', null, x.title), ' — ' + plural(x.pics, 'picture'))), p.have.map(x => el('li', null, el('b', null, x.title), ' — already imported'))));
    msg.className = p.add.length ? 'msg info' : 'msg ok';
    msg.textContent = p.add.length ? p.add.length + ' of ' + p.total + ' practicals will be added as drafts' + (p.have.length ? ' (' + p.have.length + ' already imported)' : '') + '.' : 'Nothing to add — all ' + p.total + ' practicals are already imported.';
    go.disabled = !p.add.length || PRAC_FILE.busy;
  });
  return el('div', { class: 'card mt1 prac-file' }, el('h3', null, '📦 Import a practical file'),
    el('p', { class: 'small' }, 'Adds ready-made practicals — objectives, gross and microscopic description, key features, diagnosis, questions, viva — together with their real pictures, from a practical-import file prepared for this module. The pictures are uploaded to the class picture folder. A practical already imported is skipped.'),
    where, file, list, msg, el('div', { class: 'row mt1' }, go), run, after);
}

/* ============================ Create from PDF ============================ */
const PracImportUI = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
