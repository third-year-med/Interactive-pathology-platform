"""Practical handout defaults that really apply (user, 2026-10-29: "I included the answers but the printed sheet has none").
Cause: the handout options (print, PDF, answers, …) are stored PER PRACTICAL and frozen into its published copy; the
Settings page's "Defaults for new practicals" were used only by "+ Blank practical" — practicals created from a PDF, from
Claude or from a practical-import file started with the built-in defaults (answers off), and existing practicals never
changed. Now (1) every new practical starts with the saved defaults, and (2) Settings → "📄 Apply to all existing
practicals" saves the settings, copies the handout options to every practical and re-publishes the published ones whose
content has no other pending edits (those are listed to approve and publish by hand), so students' print / PDF follow
at once. Idempotent."""
import sys
R = [
("""    settings: Object.assign({}, PE_DEFAULT_SETTINGS, m.settings || {}),""",
 """    settings: Object.assign({}, PE_DEFAULT_SETTINGS, (typeof PracData !== 'undefined' && PracData.cfg().defaults) || {}, m.settings || {}),   // the teacher's saved defaults (patch prac-defaults-apply)"""),
("""      el('h4', { class: 'mt1' }, 'Defaults for new practicals'),""",
 """      el('h4', { class: 'mt1' }, 'Handout options for new practicals'),
      el('p', { class: 'small muted', style: 'margin:.1rem 0 .4rem' }, 'Each practical keeps its own copy of these options. To change practicals that already exist, use “📄 Apply to all existing practicals” below.'),"""),
("""    page.appendChild(el('div', { class: 'card mt1' }, el('h3', null, '🧩 Practical template — required sections'),""",
 """    const note = PracSettingsUI.applyNote || {};   // kept on the object: saving the settings repaints this page
    const say = (cls, text) => { PracSettingsUI.applyNote = { cls, text }; const m = document.querySelector('[data-a=prac-apply-msg]'); if (m) { m.className = cls; m.textContent = text; } };
    page.appendChild(el('div', { class: 'card mt1 prac-apply-all' }, el('h3', null, '📄 Apply the handout options to existing practicals'),
      el('p', { class: 'small', style: 'margin-top:0' }, 'Copies the options above (printing, PDF, images, diagrams, questions, viva, teaching points, answers, answers on the page, answer key) to every practical and updates the copy students see, so their print and PDF follow at once.'),
      el('button', { class: 'btn btn-primary', 'data-a': 'prac-apply-all', disabled: !!PracSettingsUI.applying, onclick: async () => {
        if (PracSettingsUI.applying) return;
        if (!(await confirmDialog('Apply these handout options to all ' + plural(PracData.drafts.length, 'practical') + '? Published practicals are updated for students at once.', { okLabel: 'Apply to all' }))) return;
        PracSettingsUI.applying = true; document.querySelectorAll('[data-a=prac-apply-all]').forEach(b => { b.disabled = true; }); say('small', 'Saving the settings…');
        try {
          v.mandatory = Array.from(new Set(['title', 'number'].concat(Array.from(mand)))); await PracData.saveCfg(v);
          const r = await pracApplyDefaultsAll(v.defaults, (t) => say('small', t));
          say('msg ' + (r.pending.length ? 'warn' : 'ok'), '✓ ' + plural(r.updated, 'practical') + ' updated' + (r.republished ? ', ' + r.republished + ' re-published for students' : '') + '.' + (r.pending.length ? ' Open and approve → publish these (they also have other unpublished edits): ' + r.pending.join(', ') + '.' : '') + (r.updated ? '' : ' (They already had these options.)'));
        } catch (err) { say('msg bad', 'Stopped: ' + err.message); }
        PracSettingsUI.applying = false; document.querySelectorAll('[data-a=prac-apply-all]').forEach(b => { b.disabled = false; });
      } }, '📄 Apply to all existing practicals'), el('div', { class: note.cls || 'small', 'data-a': 'prac-apply-msg' }, note.text || '')));
    page.appendChild(el('div', { class: 'card mt1' }, el('h3', null, '🧩 Practical template — required sections'),"""),
("""const PracSettingsUI = {""",
 """/** Copies the handout options (not the file name) to every practical; a published practical without other pending edits is
 *  re-published so the students' copy follows; one with other pending edits keeps them for the teacher to approve. */
async function pracApplyDefaultsAll(defaults, progress) {
  const keys = Object.keys(PE_DEFAULT_SETTINGS).filter(k => k !== 'fileName'); let updated = 0, republished = 0; const pending = [];
  for (const d0 of PracData.list()) {
    const d = PracData.get(d0.id); if (!d) continue;
    const otherEdits = d.status === 'published' && PracData.hasUnpublishedChanges(d);
    const s = Object.assign({}, PE_DEFAULT_SETTINGS, d.settings || {}); keys.forEach(k => { s[k] = !!(defaults || {})[k]; });
    if (JSON.stringify(s) === JSON.stringify(Object.assign({}, PE_DEFAULT_SETTINGS, d.settings || {}))) continue;
    progress('Updating ' + d.title + '…'); d.settings = s; updated++;
    if (d.status === 'published' && !otherEdits) { await PracData.publish(d); republished++; }
    else { await PracData.save(d, { keepStatus: true }); if (otherEdits) pending.push(d.title); }
  }
  return { updated, republished, pending };
}
const PracSettingsUI = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
