"""Teacher Portal → 📝 Assessments → Assessment Library: 📤 Copy to groups — copies one assessment to other groups
(deliveries) of the same module that this teacher teaches: optionally published, assigned to everyone, and with the
same / a random / no password. Needs Portal.gs 2.21 (aeCopyTargets / aeCopyTo). Idempotent."""
import sys
R = [
("""          el('button', { class: 'btn btn-xs', onclick: async () => { const c = await duplicateAssessment(a); toast('Duplicated as “' + c.title + '”.', 'ok'); this.openBuilder(c.id); } }, 'Duplicate'),
""",
"""          el('button', { class: 'btn btn-xs', onclick: async () => { const c = await duplicateAssessment(a); toast('Duplicated as “' + c.title + '”.', 'ok'); this.openBuilder(c.id); } }, 'Duplicate'),
          this.pw ? el('button', { class: 'btn btn-xs', 'data-a': 'copy-groups', title: 'Copy this assessment to other groups that have this module', onclick: () => this.copyToGroups(a) }, '📤 Copy to groups') : null,
"""),
("""  async openAssignDialog(assessmentIds) {""",
"""  /** 📤 Copy to groups (Portal.gs 2.21): the same assessment in other groups of this module — each keeps its own results. */
  async copyToGroups(a) {
    await Backend.flushPending();   // the class server must hold the latest version of this assessment first
    const r = await Backend.authedPost({ action: 'aeCopyTargets', assessmentId: a.id }, { timeout: 60000 });
    if (!r || !r.ok) { toast(r && /unknown action/i.test(r.error || '') ? '📤 Copy to groups needs Portal.gs 2.21 on the class server.' : (r && r.error) || 'Could not load the groups.', 'bad', 8000); return; }
    if (!r.targets.length) { openModal({ title: '📤 Copy to groups', body: el('p', null, 'There is no other group with this module that you teach.'), actions: [{ label: 'OK', primary: true }] }); return; }
    const boxes = r.targets.map(t => {
      const kept = t.attempts > 0;
      const cb = el('input', { type: 'checkbox', value: t.storage, disabled: kept, checked: !kept });
      const note = kept ? '⚠ students have started it there — kept as it is' : t.has ? 'already there — will be updated' : 'new';
      return { cb, row: el('label', { class: 'cg-row' + (kept ? ' muted' : '') }, cb, el('span', null, el('b', null, t.label), el('small', null, note + (t.active ? '' : ' · group inactive')))) };
    });
    const all = el('input', { type: 'checkbox', checked: boxes.every(b => b.cb.checked || b.cb.disabled) });
    all.addEventListener('change', () => boxes.forEach(b => { if (!b.cb.disabled) b.cb.checked = all.checked; }));
    const pub = el('input', { type: 'checkbox', checked: r.published, disabled: !r.published });
    const asg = el('input', { type: 'checkbox', checked: r.published, disabled: !r.published });
    pub.addEventListener('change', () => { asg.disabled = !pub.checked; if (!pub.checked) asg.checked = false; });
    const pw = (v, label, dis) => el('label', { class: 'cg-opt' }, el('input', { type: 'radio', name: 'cg-pw', value: v, checked: v === (r.hasPassword ? 'same' : 'random'), disabled: !!dis }), ' ' + label);
    const body = el('div', { class: 'cg' },
      el('p', { style: 'margin-top:0' }, 'Copy ', el('b', null, '“' + r.title + '”'), ' from ', el('b', null, r.here), ' to:'),
      el('label', { class: 'cg-all' }, all, ' Select all'),
      el('div', { class: 'cg-list' }, boxes.map(b => b.row)),
      el('div', { class: 'cg-opts' },
        el('label', { class: 'cg-opt' }, pub, ' Publish it in each group'),
        r.published ? null : el('div', { class: 'small muted' }, 'This assessment is not published yet — it arrives as a draft; publish it in each group later.'),
        el('label', { class: 'cg-opt' }, asg, ' Assign it to everyone in each group', el('small', { class: 'muted' }, r.hasAssignment ? ' (same dates, attempts and time limit as here)' : ' (open now, no deadline)')),
        el('div', { class: 'cg-pw' }, el('b', null, '🔑 Password: '), pw('same', 'the same as here', !r.hasPassword), pw('random', 'a new random one for each group'), pw('none', 'none for now'))),
      el('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Each group keeps its own results. Later changes here do not change the copies — copy again to update a group (only where no student has started it).'));
    openModal({ title: '📤 Copy to groups', body, wide: true, actions: [{ label: 'Cancel' }, { label: '📤 Copy', primary: true, keepOpen: true, onClick: async (close) => {
      const targets = boxes.filter(b => b.cb.checked && !b.cb.disabled).map(b => b.cb.value);
      if (!targets.length) { toast('Tick at least one group.', 'warn'); return false; }
      const mode = (body.querySelector('input[name=cg-pw]:checked') || {}).value || 'none';
      const go = body.closest('.modal').querySelector('.modal-foot .btn-primary'); if (go) { go.disabled = true; go.textContent = 'Copying…'; }
      const res = await Backend.authedPost({ action: 'aeCopyTo', assessmentId: a.id, targets, publish: pub.checked, assign: asg.checked, password: mode }, { timeout: 120000 });
      close();
      if (!res || !res.ok) { toast((res && res.error) || 'Could not copy.', 'bad', 8000); return; }
      const okN = res.results.filter(x => x.ok).length;
      openModal({ title: '📤 Copied to ' + okN + ' of ' + res.results.length + ' group' + (res.results.length > 1 ? 's' : ''), body: el('ul', { class: 'cg-res' }, res.results.map(x => el('li', { class: x.ok ? 'ok' : 'bad' },
        (x.ok ? '✓ ' : x.kept ? '⏸ ' : '✗ '), el('b', null, x.label), ' — ',
        x.ok ? [x.published ? 'published' : 'draft', x.assigned === 'yes' ? 'assigned to everyone' : x.assigned === 'already' ? 'was already assigned' : x.assignError ? 'not assigned (' + x.assignError + ')' : null,
          x.password === 'same' ? 'same password' : x.password === 'random' ? 'new random password (see 🔑 Passwords there)' : null].filter(Boolean).join(' · ') : (x.error || 'not copied')))),
        actions: [{ label: 'OK', primary: true }] });
    } }] });
  },
  async openAssignDialog(assessmentIds) {"""),
(""".assess-card h3{font-size:1.1rem}
""",
""".assess-card h3{font-size:1.1rem}
.cg-all{display:flex;gap:.45rem;align-items:center;font-weight:600;margin:.2rem 0 .4rem}
.cg-list{display:grid;gap:.35rem;max-height:16rem;overflow:auto;padding:.2rem}
.cg-row{display:flex;gap:.6rem;align-items:flex-start;padding:.5rem .65rem;border:1px solid var(--line);border-radius:10px;cursor:pointer}
.cg-row span{display:flex;flex-direction:column}.cg-row small{color:var(--ink-2)}
.cg-opts{margin-top:.8rem;padding-top:.7rem;border-top:1px solid var(--line);display:grid;gap:.4rem}
.cg-opt{display:flex;gap:.35rem;align-items:center}
.cg-pw{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:center}
.cg-res{padding-left:1.1rem;margin:0}.cg-res li{margin:.3rem 0}.cg-res li.bad{color:var(--bad)}
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
