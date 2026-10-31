"""Learn → Edit Mode: ⇄ Replace on the teacher's pictures (user 2026-10-31). Before, a teacher picture had only ✎ Edit and
🗑 Remove, and the edit dialog said "remove it and add a new one" — which gave the new picture a new record, so the
Pathology Spotter questions and OSPE stations that use the picture lost it. ⇄ Replace changes only the picture file /
address of the SAME record (id, importKey and its place are kept), so everything that uses it shows the new picture.
The picture dialog starts with the current caption and credit (pickImageDialog(title, preset)). Idempotent."""
import sys
R = [
("""function pickImageDialog(title) {
  return new Promise(resolve => {""",
 """function pickImageDialog(title, preset) {
  return new Promise(resolve => {"""),
("""    const cred = el('input', { type: 'text', placeholder: 'Source / licence / attribution' });
""",
 """    const cred = el('input', { type: 'text', placeholder: 'Source / licence / attribution' });
    if (preset) { cap.value = preset.caption || ''; cred.value = preset.credit || ''; }   // ⇄ Replace starts with the current caption and credit (patch em-replace)
"""),
("""    emDecorate(node, m.type === 'video' ? 'video' : m.type === 'link' ? 'link' : 'picture', () => emEditMedia(s, m), () => emRemoveMedia(s, m), '', m.type === 'video');""",
 """    emDecorate(node, m.type === 'video' ? 'video' : m.type === 'link' ? 'link' : 'picture', () => emEditMedia(s, m), () => emRemoveMedia(s, m), '', m.type === 'video');
    const tools = node.querySelector(':scope > .em-tools');   // ⇄ Replace (patch em-replace): same record, new picture
    if (m.type === 'image' && tools && !tools.querySelector('.em-rep')) tools.insertBefore(emBtn('⇄ Replace', 'em-edit em-rep', 'Replace this picture (same place, caption and links kept)', () => emReplaceMedia(s, m)), tools.lastChild);"""),
("""'Uploaded picture — to replace the file, remove it and add a new one.'""",
 """'Uploaded picture — to change the picture itself, use ⇄ Replace (the Spotter and OSPE keep using it).'"""),
("""/** Adds the controls to a freshly rendered Learning Block (only in Edit Mode). */""",
 """/** ⇄ Replace (patch em-replace): a new file or address for the SAME picture record — its id, import key and place stay,
 *  so the Pathology Spotter, OSPE stations and slides that use it show the new picture. */
async function emReplaceMedia(s, item) {
  const r = await pickImageDialog('⇄ Replace picture', { caption: item.caption, credit: item.credit }); if (!r) return;
  const items = deepClone(sectionMedia(s.id)); const m = items.find(x => (x.id || x.url) === (item.id || item.url));
  if (!m) { toast('This picture is no longer in this Learning Block.', 'warn'); return; }
  m.url = r.url; m.caption = r.caption || m.caption || ''; m.credit = r.credit; m.replacedAt = Date.now();
  await saveDoc('custommedia', s.id, { items }, { label: 'Before replacing a picture' });
  if (typeof _autoDeck !== 'undefined') _autoDeck = null;
  refreshAllContentViews(); toast('Picture replaced — everything that uses it (Spotter, OSPE, slides) shows the new picture.', 'ok', 5000);
}
/** Adds the controls to a freshly rendered Learning Block (only in Edit Mode). */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
