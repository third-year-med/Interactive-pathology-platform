"""🔑 Passwords → "Who can start": a ☑ Select all / ☐ Clear all button beside the column heading switches 🧑‍🎓 Checked-in only
on (or off) for every assessment in the list with one click (user, 2026-10-21) — one request with Portal.gs 2.30
(assessmentIds); with 2.29 it switches them one by one. Needs patch att-only-quiz. Idempotent."""
import sys
R = [
("""el('th', null, 'Who can start'), el('th', null, ''))), tb));""",
"""el('th', null, el('div', { class: 'row', style: 'gap:.5rem;align-items:center;flex-wrap:wrap' }, el('span', null, 'Who can start'),
        el('button', { class: 'btn btn-xs', 'data-a': 'attonly-all', title: allOn ? 'Switch 🧑‍🎓 Checked-in only OFF for every assessment' : 'Switch 🧑‍🎓 Checked-in only ON for every assessment', onclick: (ev) => attOnlyAll(asm, !allOn, ev.currentTarget) }, allOn ? '☐ Clear all' : '☑ Select all'))), el('th', null, ''))), tb));"""),
("""      list.appendChild(el('p', { class: 'small muted apw-att-note' }, '🧑‍🎓 ',""",
"""      const allOn = asm.every(a => aon[a.id]);
      list.appendChild(el('p', { class: 'small muted apw-att-note' }, '🧑‍🎓 ',"""),
("""    const attOnly = async (a, cb) => {""",
"""    const attOnlyAll = async (asm, want, b) => {
      const ids = asm.filter(a => !!aon[a.id] !== want).map(a => a.id);
      if (!ids.length) return;
      b.disabled = true; b.textContent = want ? 'Selecting…' : 'Clearing…';
      let r = await Backend.authedPost({ action: 'aeAttOnly', assessmentIds: ids, on: want }, { timeout: 60000 });
      if (r && !r.ok && /Choose an assessment/.test(r.error || '')) {   // Portal.gs 2.29 takes one at a time
        for (const id of ids) { r = await Backend.authedPost({ action: 'aeAttOnly', assessmentId: id, on: want }); if (!r || !r.ok) break; aon = r.attOnly || aon; }
      }
      if (!r || !r.ok) { draw(); toast('✗ ' + (/Unknown action/i.test((r && r.error) || '') ? 'Update Portal.gs (2.29) on the class server first.' : ((r && r.error) || 'Could not save.')), 'bad', 7000); return; }
      aon = r.attOnly || {}; draw();
      toast(want ? '🧑‍🎓 All ' + asm.length + ' assessments: only students checked in to today’s lecture attendance can start them (with their passwords).' : 'Checked-in only is off for all assessments — anyone with the password can start them.', 'ok', 7000);
    };
    const attOnly = async (a, cb) => {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
