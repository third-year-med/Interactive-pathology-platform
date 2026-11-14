"""🗂 Replaced practicals (user, 2026-11-14: "approve A"): a practical-import file (neo-practical-import) may list in "replaces"
the practicals it supersedes ([{id, title}] or ids). When 📦 Import a practical file runs, the listed practicals still present
(teacher draft and/or students' published copy) are deleted first — after ONE confirmation that names them — so the new
practicals are numbered from 1 instead of after the old ones. Cancelling keeps everything and adds nothing. A file without
"replaces" behaves exactly as before. Wraps pracFileRun (the prac-file-import patch's text is not edited, so both stay
idempotent). Do it in ✏️ Edit master draft (practicals are master content). Idempotent."""
import sys
R = [
("""/* ---------- 📦 Import a practical file (practical-import file → drafts with their real pictures) ---------- */""",
 """/* ---------- 🗂 Replaced practicals (patch prac-file-replace) ---------- */
/** The practicals a practical-import file says it replaces that are still in this course: [{id, title}]. */
function pracFileReplaced(data) {
  const ids = new Set((data && Array.isArray(data.replaces) ? data.replaces : []).map(x => String((x && typeof x === 'object' ? x.id : x) || '')).filter(Boolean));
  const out = new Map();
  (PracData.drafts || []).forEach(d => { if (ids.has(d.id)) out.set(d.id, d.title); });
  (State.practicalPub || []).forEach(p => { if (ids.has(p.id) && !out.has(p.id)) out.set(p.id, p.title); });
  return [...out].map(([id, title]) => ({ id, title: String(title || 'Practical') }));
}
const PRAC_FILE_RUN0 = pracFileRun;
pracFileRun = async function (plan, data, progress) {
  const old = pracFileReplaced(data);
  if (old.length) {
    const names = old.slice(0, 4).map(x => '“' + x.title + '”').join(', ') + (old.length > 4 ? ' and ' + (old.length - 4) + ' more' : '');
    if (!(await confirmDialog('This file replaces ' + plural(old.length, 'earlier practical') + ': ' + names + '. Delete them now — also for the students — before the new practicals are added? (A course backup — Teacher Portal → 💾 Backup → ⤓ Export — keeps a copy.)', { danger: true, okLabel: 'Delete and import' })))
      return { batchId: uid('pbatch'), drafts: [], notes: ['import cancelled — the earlier practicals were kept'] };
    for (let k = 0; k < old.length; k++) { progress('Deleting earlier practical ' + (k + 1) + ' of ' + old.length + ' — ' + old[k].title + '…'); await PracData.remove(old[k].id); }
    toast(plural(old.length, 'earlier practical') + ' deleted.', 'ok');
  }
  return PRAC_FILE_RUN0(plan, data, progress);
};
/* ---------- 📦 Import a practical file (practical-import file → drafts with their real pictures) ---------- */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
