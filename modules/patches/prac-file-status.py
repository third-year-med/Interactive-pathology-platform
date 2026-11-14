"""📦 Practical import status that survives redraws (user, 2026-11-14: "yes, fix it"). While 📦 Import a practical file runs,
the page can be redrawn (deleting replaced practicals, background sync, moving away and back); the progress line, the result
and the "✅ Approve & publish all" button were then drawn into the old, detached card and the teacher saw an empty card. Now
the status lives in PRAC_FILE_UI: a card drawn while an import runs shows the live progress (and its file field is off), a
card drawn after it shows the result and its own ✅ Approve & publish all for the practicals still unpublished. The card that
started the import behaves exactly as before. Wraps pracFileCard and pracFileRun (installed at the first card, so it is the
outermost wrapper and also sees prac-file-replace's deleting step); the other patches' text is not edited. Idempotent."""
import sys
R = [
("""/* ---------- 🗂 Replaced practicals (patch prac-file-replace) ---------- */""",
 """/* ---------- 📦 Practical import status that survives redraws (patch prac-file-status) ---------- */
const PRAC_FILE_UI = { text: '', cls: '', result: null, pub: '', pubCls: '' };
function pracFileLive(cls, text) {
  PRAC_FILE_UI.cls = cls; PRAC_FILE_UI.text = text;
  document.querySelectorAll('.prac-file-live').forEach(n => { n.className = 'prac-file-live ' + cls; n.textContent = text; });
}
/** Wraps pracFileRun once, at the first card — after every patch has loaded, so this wrapper is the outermost. */
function pracFileStatusInstall() {
  if (pracFileRun.__status) return;
  const run0 = pracFileRun;
  pracFileRun = async function (plan, data, progress) {
    PRAC_FILE_UI.result = null; PRAC_FILE_UI.pub = ''; PRAC_FILE_UI.pubCls = '';
    pracFileLive('msg info', 'Starting the import…');
    const say = t => { try { progress(t); } catch (e) { } pracFileLive('msg info', t); };
    const r = await run0(plan, data, say);
    PRAC_FILE_UI.result = r;
    const pics = (r.drafts || []).reduce((n, d) => n + ((d.images || []).length), 0);
    pracFileLive((r.notes || []).length ? 'msg warn' : 'msg ok', '✓ ' + plural((r.drafts || []).length, 'practical') + ' added as drafts with ' + plural(pics, 'picture') + '.' + ((r.notes || []).length ? ' Notes: ' + r.notes.join(' · ') : ''));
    document.querySelectorAll('.prac-file-after').forEach(n => pracFileAfterFill(n));
    document.querySelectorAll('.prac-file-redrawn input[type=file]').forEach(n => { n.disabled = false; });
    return r;
  };
  pracFileRun.__status = true;
}
/** The result part of a redrawn card: ✅ Approve & publish all for the imported practicals not published yet. */
function pracFileAfterFill(box) {
  clear(box); const r = PRAC_FILE_UI.result; if (!r || !(r.drafts || []).length) return;
  const left = r.drafts.map(d => d.id).filter(id => { const d = PracData.get(id); return d && (d.status !== 'published' || PracData.hasUnpublishedChanges(d)); });
  const say = (cls, t) => { PRAC_FILE_UI.pub = t; PRAC_FILE_UI.pubCls = cls; document.querySelectorAll('.prac-file-pub').forEach(n => { n.className = 'prac-file-pub ' + cls; n.textContent = t; }); };
  if (left.length) box.appendChild(el('button', { class: 'btn btn-primary mt1', 'data-a': 'prac-file-publish-live', onclick: async (e) => {
    e.target.disabled = true;
    const x = await pracFilePublishAll(left, t => say('small', t));
    say(x.left.length ? 'msg warn' : 'msg ok', '🚀 ' + plural(x.done.length, 'practical') + ' published — students see them in Apply → Practical.' + (x.left.length ? ' Not published (open them to fix the quality check): ' + x.left.join(', ') : ''));
  } }, '✅ Approve & publish all (' + left.length + ')'));
  box.appendChild(el('div', { class: 'prac-file-pub ' + PRAC_FILE_UI.pubCls }, PRAC_FILE_UI.pub));
}
const PRAC_FILE_CARD0 = pracFileCard;
pracFileCard = function () {
  pracFileStatusInstall();
  const card = PRAC_FILE_CARD0();
  if (PRAC_FILE.busy || PRAC_FILE_UI.result) {   // drawn while an import runs, or after one: show it here
    card.classList.add('prac-file-redrawn');
    card.querySelectorAll('input[type=file]').forEach(n => { n.disabled = PRAC_FILE.busy; });
    card.appendChild(el('div', { class: 'prac-file-live ' + PRAC_FILE_UI.cls }, PRAC_FILE_UI.text));
    const after = el('div', { class: 'prac-file-after' }); if (!PRAC_FILE.busy) pracFileAfterFill(after);
    card.appendChild(after);
  }
  return card;
};
/* ---------- 🗂 Replaced practicals (patch prac-file-replace) ---------- */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
