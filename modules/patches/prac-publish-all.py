"""Practical → 🧑‍🏫 Teacher workspace — all practicals: a "🚀 Approve & publish all" button (user 2026-10-30). Before, the
one-click publish was offered only straight after 📦 Import practicals; drafts imported earlier had to be approved and
published one by one in their editors. The button approves and publishes every draft / approved practical and every
published one with unpublished changes; a practical with quality-check errors is skipped and named. In ✏️ Edit master
draft the practicals go to the master draft (every group gets them after ⬆ Publish draft). Idempotent."""
import sys
R = [
("""    card.appendChild(el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, el('thead', null, el('tr', null, ['No.', 'Practical', 'Status', 'Quality check', 'Content', ''].map(h => el('th', null, h)))), tb)));
    return card;""",
 """    card.appendChild(el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, el('thead', null, el('tr', null, ['No.', 'Practical', 'Status', 'Quality check', 'Content', ''].map(h => el('th', null, h)))), tb)));
    // 🚀 Approve & publish all (patch prac-publish-all): every practical students do not see yet, or see an old version of
    const todo = list.filter(d => d.status !== 'published' || PracData.hasUnpublishedChanges(d));
    const done = PracTeacher.pubAllMsg; if (done && Date.now() - done.at < 120000) card.appendChild(el('div', { class: 'msg mt1 ' + (done.warn ? 'warn' : 'ok') }, done.text));
    if (todo.length) {
      const msg = el('div', { class: 'small' });
      const draftOn = typeof picImportDraftOn === 'function' && picImportDraftOn();
      card.appendChild(el('div', { class: 'row mt1', style: 'gap:.6rem;align-items:center;flex-wrap:wrap' },
        el('button', { class: 'btn btn-primary', 'data-a': 'prac-publish-all', onclick: async (e) => {
          if (!(await confirmDialog('Approve and publish ' + plural(todo.length, 'practical') + '? Students will see them in Apply → Practical' + (draftOn ? ' after you press ⬆ Publish draft' : '') + '. Practicals with quality-check errors are skipped.', { okLabel: '🚀 Publish all' }))) return;
          e.target.disabled = true;
          try {
            const x = await pracFilePublishAll(todo.map(d => d.id), (t) => { msg.textContent = t; });
            // kept on PracTeacher: saving the practicals re-renders the page, so the panel shows the result on its next render
            PracTeacher.pubAllMsg = { at: Date.now(), warn: !!x.left.length, text: '🚀 ' + plural(x.done.length, 'practical') + ' published' + (draftOn ? ' to the master draft — press ⬆ Publish draft so every group gets them.' : ' — students see them in Apply → Practical.') + (x.left.length ? ' Not published (open them to fix the quality check): ' + x.left.join(', ') : '') };
            const fresh = PracTeacher.draftsPanel(); if (card.isConnected) card.replaceWith(fresh); else { const cur = document.querySelector('.prac-drafts'); if (cur) cur.replaceWith(fresh); }
          } catch (err) { e.target.disabled = false; msg.className = 'msg bad'; msg.textContent = 'Publishing stopped: ' + err.message + ' — what was finished is kept; press the button again for the rest.'; }
        } }, '🚀 Approve & publish all ' + todo.length),
        el('span', { class: 'small muted' }, plural(todo.length, 'practical') + ' not published yet (or with unpublished changes). ⚠ warnings do not block publishing.')));
      card.appendChild(msg);
    }
    return card;"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
