"""Teacher Portal → 💾 Backup: "🖼 Import pictures" — a picture-import file (format neo-picture-import, made in a work
session from the user's approved list) adds each picture with its caption and credit to its Learning section, exactly as
"+ Picture" does: uploaded to the Drive picture folder through the class server, appended to the section's pictures
(nothing existing is replaced), so Presentation mode gives each one its own Images slide. A picture already imported
(same key in that section) is skipped, so running the file twice adds nothing. Inside ✏️ Edit master draft the pictures
go to the master draft (all groups after ⬆ Publish draft). Idempotent."""
import sys
R = [
("""      el('p', { class: 'small muted' }, 'Browser storage used by this platform: ~' + Store.usageKB() + ' KB.')));
  },""",
"""      el('p', { class: 'small muted' }, 'Browser storage used by this platform: ~' + Store.usageKB() + ' KB.')));
    box.appendChild(pictureImportCard());
  },"""),
("""function exportCourseBackup() {""",
"""/* ---------- 🖼 Import pictures (picture-import file → pictures in their Learning sections) ---------- */
const PIC_IMPORT_FORMAT = 'neo-picture-import';
function picImportDraftOn() { const B = window.NEO_BOOT || {}; try { return B.role === 'teacher' && sessionStorage.getItem('pf_draft:' + (B.module || '')) === '1'; } catch (e) { return false; } }
/** Checks a picture-import file against this course: which pictures can be added, which are already there, which cannot. */
function picImportPlan(data) {
  if (!data || data.format !== PIC_IMPORT_FORMAT || !Array.isArray(data.items)) return { error: 'This is not a picture-import file.' };
  if (data.module && data.module !== (COURSE.moduleKey || '')) return { error: 'This file is for another module (' + data.module + '), not ' + COURSE.title + '.' };
  const add = [], have = [], bad = [];
  data.items.forEach((it, i) => {
    const label = (it && it.caption ? String(it.caption).split('. ')[0].replace(/\\.$/, '') : 'Picture ' + (i + 1)).slice(0, 80);
    const f = it && findSection(String(it.section || ''));
    if (!it || !it.key || !/^data:image\\/(jpeg|png|webp);base64,/.test(String(it.image || ''))) bad.push({ label, why: 'no picture in the file' });
    else if (!f) bad.push({ label, why: 'section ' + it.section + ' is not in this course' });
    else if (sectionMedia(f.section.id).some(m => m.importKey === it.key)) have.push({ label, it, f });
    else add.push({ label, it, f });
  });
  return { add, have, bad, total: data.items.length };
}
/** Adds the planned pictures one by one (upload → append to the section's pictures); progress(text) is called as it goes. */
async function picImportRun(plan, progress) {
  const done = [], failed = [];
  for (let k = 0; k < plan.add.length; k++) {
    const { it, f, label } = plan.add[k], sid = f.section.id;
    progress('Adding picture ' + (k + 1) + ' of ' + plan.add.length + ' — ' + label + '…');
    if (sectionMedia(sid).some(m => m.importKey === it.key)) continue;   // added meanwhile (e.g. another tab)
    let url = String(it.image);
    if (Backend.isConfigured()) {
      const r = await Backend.uploadImage(url, it.filename || ('picture-' + (k + 1) + '.jpg'));
      if (!(r && r.ok && r.url)) { failed.push({ label, why: describeUploadError(r && r.error).replace(/^Upload failed — stored locally instead: /, 'upload failed — ') }); continue; }
      const chk = await testImageUrl(r.url, 12000);
      url = chk.ok ? chk.url : r.url;
    }
    const item = { id: uid('m'), type: 'image', addedAt: Date.now(), url, caption: String(it.caption || ''), credit: String(it.credit || ''), importKey: String(it.key) };
    await saveDoc('custommedia', sid, { items: sectionMedia(sid).concat([item]) }, { label: 'Before importing pictures', silent: true });
    done.push({ label, sid });
  }
  return { done, failed, have: plan.have.length };
}
/* The Teacher Portal may redraw while pictures are being added (background sync, refreshed views): the progress and the
   result live here, so a redrawn card shows them too, and the buttons stay off until the import has finished. */
const PIC_IMPORT = { busy: false, cls: '', text: '' };
function picImportSay(cls, text) {
  PIC_IMPORT.cls = cls; PIC_IMPORT.text = text;
  document.querySelectorAll('.pic-import-run').forEach(n => { n.className = 'pic-import-run ' + cls; n.textContent = text; });
}
function pictureImportCard() {
  const file = el('input', { type: 'file', accept: '.json,application/json', disabled: PIC_IMPORT.busy });
  const msg = el('div'), list = el('div'), run = el('div', { class: 'pic-import-run ' + PIC_IMPORT.cls }, PIC_IMPORT.text);
  const where = picImportDraftOn() ? el('p', { class: 'msg ok' }, '✏️ You are editing the MASTER DRAFT — the pictures go to the master draft; every group gets them after ⬆ Publish draft (Platform Home → Content).')
    : el('p', { class: 'msg info' }, 'The pictures go to this copy of the module only. To give them to every group, open it with ✏️ Edit master draft (Platform Home → Content) and import there.');
  let plan = null;
  const go = el('button', { class: 'btn btn-primary mt1', disabled: true, onclick: async () => {
    if (!plan || !plan.add.length || PIC_IMPORT.busy) return;
    if (!(await Auth.ensure())) return;
    if (!(await confirmDialog('Add ' + plan.add.length + ' picture' + (plan.add.length === 1 ? '' : 's') + ' to ' + new Set(plan.add.map(x => x.f.section.id)).size + ' Learning section(s)? Nothing already in the course is changed.', { okLabel: 'Add pictures' }))) return;
    PIC_IMPORT.busy = true; document.querySelectorAll('.pic-import input[type=file], .pic-import button.btn-primary').forEach(n => { n.disabled = true; });
    clear(msg); msg.className = '';
    let r;
    try { r = await picImportRun(plan, t => picImportSay('msg info', t)); }
    finally { PIC_IMPORT.busy = false; }
    plan = null;
    picImportSay(r.failed.length ? 'msg bad' : 'msg ok', '✓ Added ' + r.done.length + ' picture' + (r.done.length === 1 ? '' : 's') + (r.have ? ' · ' + r.have + ' already there (skipped)' : '') +
      (r.failed.length ? ' · NOT added: ' + r.failed.map(x => x.label + ' (' + x.why + ')').join(' · ') + ' — fix the cause and import the same file again; the added ones are skipped.' : '.') +
      (picImportDraftOn() && r.done.length ? ' Now publish the draft: Platform Home → Content → ⬆ Publish draft.' : ''));
    clear(list);
    document.querySelectorAll('.pic-import input[type=file]').forEach(n => { n.disabled = false; n.value = ''; });
    refreshAllContentViews();
  } }, '🖼 Add the pictures');
  file.addEventListener('change', async () => {
    plan = null; go.disabled = true; clear(list); msg.className = ''; msg.textContent = ''; picImportSay('', '');
    const f = file.files[0]; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (e) { msg.className = 'msg bad'; msg.textContent = 'This file is not a picture-import file (not valid JSON).'; return; }
    const p = picImportPlan(data);
    if (p.error) { msg.className = 'msg bad'; msg.textContent = p.error; return; }
    plan = p;
    const row = (x, state) => el('li', null, el('b', null, x.label), ' → ' + (x.f ? 'Topic ' + ((getTopics().indexOf(x.f.topic) + 1) || '') + ' · ' + x.f.section.heading : '') + (state ? ' — ' + state : ''));
    list.appendChild(el('ul', { class: 'small pic-import-list' }, p.add.map(x => row(x, '')), p.have.map(x => row(x, 'already there')), p.bad.map(x => el('li', null, el('b', null, x.label), ' — not possible: ' + x.why))));
    msg.className = p.add.length ? 'msg info' : 'msg ok';
    msg.textContent = p.add.length ? p.add.length + ' of ' + p.total + ' pictures will be added' + (p.have.length ? ' (' + p.have.length + ' already there)' : '') + (p.bad.length ? ' · ' + p.bad.length + ' cannot be added' : '') + '.'
      : 'Nothing to add — ' + p.have.length + ' picture' + (p.have.length === 1 ? ' is' : 's are') + ' already in the course' + (p.bad.length ? ' · ' + p.bad.length + ' cannot be added' : '') + '.';
    go.disabled = !p.add.length || PIC_IMPORT.busy;
  });
  return el('div', { class: 'card mt1 pic-import' }, el('h3', null, '🖼 Import pictures'),
    el('p', { class: 'small' }, 'Adds pictures with their captions to their Learning sections from a picture-import file — the same as “+ Picture” in each section, all at once. Each picture also gets its own Images slide in Presentation mode. Pictures already imported are skipped; nothing is replaced.'),
    where, file, list, msg, go, run);
}
function exportCourseBackup() {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
