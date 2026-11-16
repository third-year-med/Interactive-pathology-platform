"""🗑 Remove pictures (user, 2026-11-16: "remove all duplicates from the learning topics … I want one of them"): a card under
🖼 Import pictures in Teacher Portal → 💾 Backup reads a picture-REMOVE file {format: 'neo-picture-remove', module, keys: [importKey…]}
(optionally sections: [sid…] to limit where), lists the pictures it finds (section + caption), and after a confirmation removes
them from their Learning sections (custommedia, like the import adds them — in ✏️ Edit master draft the master draft; groups after
⬆ Publish draft). Pictures that are part of the built course (syllabus figures, atlas) are never touched. Wraps
pictureImportCard; inserted just before the cases-tab block (shared anchors would break the other patches' idempotency checks). Idempotent."""
import sys
CASES_HEAD = '/* ---------- Clinical cases: own main tab + Present all cases + Print PDF (patch cases-tab) ---------- */'
R = [
(CASES_HEAD,
 """/* ---------- 🗑 Remove pictures (patch picture-remove): a picture-remove file → those imported pictures leave their sections ---------- */
const PIC_REMOVE_FORMAT = 'neo-picture-remove';
function picRemovePlan(data) {
  if (!data || data.format !== PIC_REMOVE_FORMAT || !Array.isArray(data.keys)) return { error: 'This is not a picture-remove file.' };
  if (data.module && data.module !== (COURSE.moduleKey || '')) return { error: 'This file is for another module (' + data.module + '), not ' + COURSE.title + '.' };
  const keys = new Set(data.keys.map(String)), only = Array.isArray(data.sections) && data.sections.length ? new Set(data.sections.map(String)) : null;
  const found = [], seen = new Set();
  Object.keys(State.customMedia || {}).forEach(sid => {
    if (only && !only.has(sid)) return;
    sectionMedia(sid).forEach(m => { if (m && m.importKey && keys.has(m.importKey)) { seen.add(m.importKey); const f = findSection(sid);
      found.push({ sid, key: m.importKey, label: String(m.caption || m.importKey).split('. ')[0].slice(0, 80), where: f ? 'Topic ' + topicNum(f.topic.id) + ' · ' + f.section.heading : sid }); } });
  });
  return { found, missing: [...keys].filter(k => !seen.has(k)), total: keys.size };
}
async function picRemoveRun(plan) {
  const by = {}; plan.found.forEach(x => { (by[x.sid] = by[x.sid] || new Set()).add(x.key); });
  let n = 0;
  for (const sid of Object.keys(by)) {
    const before = sectionMedia(sid), after = before.filter(m => !(m && m.importKey && by[sid].has(m.importKey)));
    if (after.length === before.length) continue;
    await saveDoc('custommedia', sid, { items: after }, { label: 'Before removing pictures', silent: true });
    n += before.length - after.length;
  }
  return n;
}
function pictureRemoveCard() {
  const file = el('input', { type: 'file', accept: '.json,application/json', 'data-a': 'pic-remove-file' });
  const msg = el('div'), list = el('div', { class: 'pic-remove-list' }), run = el('div', { class: 'pic-remove-run' });
  let plan = null;
  const go = el('button', { class: 'btn btn-danger mt1', disabled: true, 'data-a': 'pic-remove-go', onclick: async () => {
    if (!plan || !plan.found.length) return;
    if (!(await Auth.ensure())) return;
    if (!(await confirmDialog('Remove ' + plural(plan.found.length, 'picture') + ' from ' + new Set(plan.found.map(x => x.sid)).size + ' Learning section(s)? The other pictures and the course text are not changed.', { danger: true, okLabel: 'Remove pictures' }))) return;
    go.disabled = true; file.disabled = true; run.className = 'pic-remove-run msg info'; run.textContent = 'Removing ' + plural(plan.found.length, 'picture') + '…';
    try {
      const n = await picRemoveRun(plan);
      run.className = 'pic-remove-run msg ok';
      run.textContent = '✓ Removed ' + plural(n, 'picture') + '.' + (picImportDraftOn() ? ' Now publish the draft: Platform Home → Content → ⬆ Publish draft.' : '');
      plan = null; clear(list);
    } catch (e) { run.className = 'pic-remove-run msg bad'; run.textContent = 'Stopped: ' + ((e && e.message) || e); }
    finally { file.disabled = false; }
  } }, '🗑 Remove the pictures');
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; plan = null; go.disabled = true; clear(msg); clear(list); run.textContent = ''; run.className = 'pic-remove-run'; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (e) { msg.appendChild(el('p', { class: 'msg bad' }, 'This file is not valid JSON.')); return; }
    const p = picRemovePlan(data);
    if (p.error) { msg.appendChild(el('p', { class: 'msg bad' }, p.error)); return; }
    plan = p;
    msg.appendChild(el('p', { class: 'msg ' + (p.found.length ? 'info' : 'ok') }, p.found.length
      ? plural(p.found.length, 'picture') + ' will be removed' + (p.missing.length ? ' · ' + p.missing.length + ' not in the course (already removed)' : '') + '.'
      : 'Nothing to remove — ' + plural(p.total, 'picture') + ' already removed or not in the course.'));
    if (p.found.length) list.appendChild(el('ul', { class: 'small' }, p.found.map(x => el('li', null, x.label + ' → ' + x.where))));
    go.disabled = !p.found.length;
  });
  return el('div', { class: 'card mt2 pic-remove' }, el('h3', null, '🗑 Remove pictures'),
    el('p', { class: 'small muted' }, 'Choose a picture-remove file: the pictures it names leave their Learning sections. Pictures that are part of the course itself (syllabus figures, atlas) are never removed.'),
    picImportDraftOn() ? el('p', { class: 'msg ok' }, '✏️ You are editing the MASTER DRAFT — every group loses these pictures after ⬆ Publish draft.') : el('p', { class: 'msg info' }, 'This copy of the module only. To change every group, open it with ✏️ Edit master draft.'),
    file, msg, list, go, run);
}
if (typeof pictureImportCard === 'function') {   // the card sits under 🖼 Import pictures (the import's own code is not edited)
  const PIC_IMPORT_CARD0 = pictureImportCard;
  pictureImportCard = function () { const n = PIC_IMPORT_CARD0.apply(this, arguments); try { return el('div', { class: 'pic-import-wrap' }, n, pictureRemoveCard()); } catch (e) { return n; } };
}

""" + CASES_HEAD),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
