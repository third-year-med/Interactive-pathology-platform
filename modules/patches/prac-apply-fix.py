"""Fix for "📄 Apply to all existing practicals" (user, 2026-10-29: options updated in the teacher account, student print still
without answers; the button said "0 practicals updated"). (1) The practical drafts live in the copy of the module where they
were made — usually ✏️ Edit master draft; on a group page there are none, and the button now says so and where to go instead
of "0 updated". (2) It compared only the teacher's draft: a practical whose draft already had the options but whose PUBLISHED
copy did not was skipped. It now compares with the copy students see, re-publishes when only the options differ (content
identical to the published copy) and lists practicals with other unpublished edits. Edits lines of prac-defaults-apply
(which carries done-markers for them). Idempotent."""
import sys
R = [
("""    const otherEdits = d.status === 'published' && PracData.hasUnpublishedChanges(d);
    const s = Object.assign({}, PE_DEFAULT_SETTINGS, d.settings || {}); keys.forEach(k => { s[k] = !!(defaults || {})[k]; });
    if (JSON.stringify(s) === JSON.stringify(Object.assign({}, PE_DEFAULT_SETTINGS, d.settings || {}))) continue;
    progress('Updating ' + d.title + '…'); d.settings = s; updated++;
    if (d.status === 'published' && !otherEdits) { await PracData.publish(d); republished++; }
    else { await PracData.save(d, { keepStatus: true }); if (otherEdits) pending.push(d.title); }""",
 """    const pub = PracData.pub(d.id);   // the copy students see (patch prac-apply-fix: compare with it, not only with the draft)
    const s = Object.assign({}, PE_DEFAULT_SETTINGS, d.settings || {}); keys.forEach(k => { s[k] = !!(defaults || {})[k]; });
    const same = (a, b) => keys.every(k => !!(a || {})[k] === !!(b || {})[k]);
    const draftOk = same(s, d.settings), pubOk = !pub || same(s, pub.settings);
    if (draftOk && pubOk) continue;
    progress('Updating ' + d.title + '…'); d.settings = s; updated++;
    if (pub && d.status === 'published' && pracSameContent(d, pub)) { await PracData.publish(d); republished++; }   // only the options differ from the students' copy
    else { await PracData.save(d, { keepStatus: true }); if (pub && !pubOk) pending.push(d.title); }"""),
("""async function pracApplyDefaultsAll(defaults, progress) {""",
 """/** True when the draft would publish exactly the students' copy apart from the handout options (and answers they unlock). */
function pracSameContent(d, pub) {
  const strip = x => { const o = Object.assign({}, x); ['version', 'publishedAt', 'hash', 'settings', 'answersIncluded'].forEach(k => delete o[k]); o.questions = (o.questions || []).map(q => [q.id, q.type, q.q]); o.viva = (o.viva || []).map(q => [q.id, q.q]); return JSON.stringify(o); };
  try { return strip(PE_publishSnapshot(d, {})) === strip(pub); } catch (e) { return false; }
}
async function pracApplyDefaultsAll(defaults, progress) {"""),
("""        if (PracSettingsUI.applying) return;
        if (!(await confirmDialog('Apply these handout options to all '""",
 """        if (PracSettingsUI.applying) return;
        if (!PracData.drafts.length) { say('msg warn', PracData.published().length ? 'This copy of the module has no practical drafts — the practicals your students see were made in ✏️ Edit master draft. Open the module with ✏️ Edit master draft (Teacher Dashboard → Platform Home → Content), press this button there, then ⬆ Publish draft: every group then gets the new options.' : 'There are no practicals in this copy of the module yet.'); return; }
        if (!(await confirmDialog('Apply these handout options to all '"""),
("""(r.updated ? '' : ' (They already had these options.)')""",
 """(r.updated ? '' : ' Every practical and the copy students see already have these options.')"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
