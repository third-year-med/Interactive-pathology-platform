"""👥 Teacher Portal → Students: remove many students at once (user 2026-11-08). Each student gets a checkbox (and "select
all shown", which follows the search box); "🗑 Remove selected (N)" and "Remove all students" (the word DELETE must be typed)
remove the accounts one by one with the existing deleteStudent action — no Code.gs or Portal.gs change — with a progress
window (Stop is possible). As with the single 🗑: the student loses access at once; past results and attendance records are
kept. Idempotent."""
import sys
R = [
("""  list: null, loading: false, q: '', lastIssued: [],""",
 """  list: null, loading: false, q: '', lastIssued: [], sel: new Set(),   // sel: students ticked for removal (patch students-bulk-remove)"""),
("""el('td', { colspan: '6', class: 'center muted' }, L.length ? 'No match.'""",
 """el('td', { colspan: '7', class: 'center muted' }, L.length ? 'No match.'"""),
("""      const rows = L.filter(x => !s || (x.username + ' ' + x.name + ' ' + x.email).toLowerCase().includes(s));""",
 """      const rows = L.filter(x => !s || (x.username + ' ' + x.name + ' ' + x.email).toLowerCase().includes(s)); this._shown = rows;"""),
("""        tb.appendChild(el('tr', null, el('td', { class: 'nowrap' }, el('b', null, x.username)), el('td', null, x.name), el('td', null, x.email || '—'),""",
 """        const ck = el('input', { type: 'checkbox', checked: this.sel.has(x.username), 'aria-label': 'Select ' + x.username, 'data-a': 'stu-ck' });
        ck.addEventListener('change', () => { if (ck.checked) this.sel.add(x.username); else this.sel.delete(x.username); if (this.updBar) this.updBar(); });
        tb.appendChild(el('tr', null, el('td', null, ck), el('td', { class: 'nowrap' }, el('b', null, x.username)), el('td', null, x.name), el('td', null, x.email || '—'),"""),
("""    card.appendChild(el('div', { class: 'table-scroll mt1' }, el('table', { class: 'data-table' },
      el('thead', null, el('tr', null, ['Student ID', 'Name', 'Email', 'Status', 'Last sign-in', 'Actions'].map(h => el('th', null, h)))), tb)));
    paint();""",
 """    // ☑ select + 🗑 Remove selected / Remove all (patch students-bulk-remove)
    const all = el('input', { type: 'checkbox', 'aria-label': 'Select all shown students', 'data-a': 'stu-all' });
    all.addEventListener('change', () => { (this._shown || []).forEach(x => { if (all.checked) this.sel.add(x.username); else this.sel.delete(x.username); }); paint(); this.updBar(); });
    const cnt = el('span', { class: 'small muted' });
    const rmSel = el('button', { class: 'btn btn-sm btn-danger', 'data-a': 'stu-rm-sel', onclick: () => this.removeMany(L.filter(x => this.sel.has(x.username)), false) }, '🗑 Remove selected');
    const rmAll = el('button', { class: 'btn btn-sm btn-danger', 'data-a': 'stu-rm-all', disabled: !L.length, onclick: () => this.removeMany(L.slice(), true) }, 'Remove all students');
    this.updBar = () => {
      const n = L.filter(x => this.sel.has(x.username)).length, sh = this._shown || [];
      cnt.textContent = n ? n + ' selected' : ''; rmSel.textContent = '🗑 Remove selected (' + n + ')'; rmSel.disabled = !n;
      all.checked = !!sh.length && sh.every(x => this.sel.has(x.username)); all.indeterminate = !all.checked && sh.some(x => this.sel.has(x.username));
    };
    card.appendChild(el('div', { class: 'row', style: 'gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.6rem' }, rmSel, rmAll, cnt,
      el('span', { class: 'small muted' }, 'Tick students, or use the box in the table heading to tick all shown. Their results and attendance are kept.')));
    card.appendChild(el('div', { class: 'table-scroll mt1' }, el('table', { class: 'data-table' },
      el('thead', null, el('tr', null, [el('th', null, all)].concat(['Student ID', 'Name', 'Email', 'Status', 'Last sign-in', 'Actions'].map(h => el('th', null, h))))), tb)));
    paint(); this.updBar();"""),
("""  async remove(x) {""",
 """  /** Removes the given accounts one by one (deleteStudent), with progress; Stop ends it after the current student. */
  async removeMany(list, everyone) {
    if (!list.length) return;
    if (everyone) {
      const w = await promptDialog('Remove ALL ' + list.length + ' students?', 'This removes every account listed here — ' + (GROUP_TAG ? 'group ' + GROUP_TAG + ' — ' : '') + 'they lose access at once; their past results and attendance records are kept. Type DELETE to confirm.', { placeholder: 'DELETE', okLabel: 'Remove all' });
      if (w === null) return; if (String(w).trim() !== 'DELETE') { toast('Nothing was removed — the word DELETE was not typed.', 'warn', 5000); return; }
    } else if (!(await confirmDialog('Remove the accounts of ' + plural(list.length, 'selected student') + '? They lose access immediately. Their past results and attendance records are kept.', { title: 'Remove students?', danger: true, okLabel: 'Remove ' + list.length }))) return;
    let stop = false, done = 0; const failed = [];
    const line = el('div', { class: 'msg info', role: 'status' }, 'Removing 0 of ' + list.length + '…');
    const m = openModal({ title: '🗑 Removing students', body: line, dismissable: false, actions: [{ label: 'Stop', keepOpen: true, onClick: () => { stop = true; line.textContent = 'Stopping after the current student…'; return false; } }] });
    for (let i = 0; i < list.length && !stop; i++) {
      const x = list[i]; line.textContent = 'Removing ' + (i + 1) + ' of ' + list.length + ' — ' + x.username + '…';
      const r = await Backend.authedPost({ action: 'deleteStudent', username: x.username }, { timeout: 60000 });
      if (r && r.ok) { done++; this.sel.delete(x.username); } else failed.push(x.username + (r && r.error ? ' (' + r.error + ')' : ''));
      if (failed.length >= 5 && done === 0) { stop = true; break; }   // nothing works (signed out, no network): stop early
    }
    m.close();
    await this.load(true);
    toast(plural(done, 'student') + ' removed' + (failed.length ? ', ' + failed.length + ' failed' : '') + (stop && done + failed.length < list.length ? ' — stopped, ' + (list.length - done - failed.length) + ' left' : '') + '.', failed.length ? 'warn' : 'ok', 8000);
    if (failed.length) openModal({ title: 'Not removed', body: el('div', null, el('p', null, 'These could not be removed (try again, or remove them one by one):'), el('p', { class: 'small' }, failed.join(', '))), actions: [{ label: 'Close', primary: true }] });
  },
  async remove(x) {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
