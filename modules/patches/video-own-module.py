"""🎬 Video Lectures: each module shows its OWN videos (user 2026-11-01). Students see only the videos ticked for this
module (no Module filter); teachers have "This module" / "All modules (teachers)" to find a video ticked for the wrong
module. A video ticked for several modules is still stored once and listed in each of them. Display order (drag ⠿ or
✎ Edit → Display order) is set among this module's videos — they keep their places among the other modules' videos.
"General / integrated pathology" is no longer offered (a lecture spanning modules is ticked for each). Needs
video-library. No server change. Idempotent."""
import sys
R = [
(""", ['neonew', 'Neoplasia'], ['general', 'General / integrated pathology']];""",
 """, ['neonew', 'Neoplasia']];   // each module shows its own videos (patch video-own-module)"""),
("""    if (f.mod === null) f.mod = all.some(x => (x.modules || []).includes(vlHere())) ? vlHere() : '';""",
 """    if (f.mod === null || (!ed && f.mod !== vlHere())) f.mod = vlHere();   // this module's videos (patch video-own-module); teachers may look at all"""),
("""    const modSel = el('select', { 'aria-label': 'Module', onchange: e => { f.mod = e.target.value; f.ch = ''; this.render(); } },
      el('option', { value: '', selected: !f.mod }, 'All modules'), mods.map(k => el('option', { value: k, selected: f.mod === k }, vlModName(k))));""",
 """    void mods;
    const modSel = !ed ? null : el('select', { 'aria-label': 'Which videos', onchange: e => { f.mod = e.target.value; f.ch = ''; this.render(); } },
      el('option', { value: vlHere(), selected: f.mod === vlHere() }, 'This module: ' + vlModName(vlHere())), el('option', { value: '', selected: !f.mod }, 'All modules (teachers only)'));"""),
("""Drag ⠿ to change the order (with no search or filter), or set the position in ✎ Edit.'));""",
 """Drag ⠿ to change the order of this module’s videos (with no search or chapter filter), or set the position in ✎ Edit.'));"""),
("""    list.forEach(v => grid.appendChild(this.card(v, ed && !f.q && !f.mod && !f.ch)));
    if (ed && !f.q && !f.mod && !f.ch && list.length > 1 && typeof picSortable === 'function') picSortable(grid, ids => this.saveOrder(ids));""",
 """    const drag = ed && !f.q && !f.ch && f.mod === vlHere();   // order inside this module (patch video-own-module)
    list.forEach(v => grid.appendChild(this.card(v, drag)));
    if (drag && list.length > 1 && typeof picSortable === 'function') picSortable(grid, ids => this.saveOrder(ids));"""),
("""    const by = new Map((this.items || []).map(v => [v.id, v])); this.items = ids.map(id => by.get(id)).filter(Boolean).concat((this.items || []).filter(v => !ids.includes(v.id)));""",
 """    // the moved videos take the places they had among all videos (the other modules' videos keep theirs)
    const all = (this.items || []).slice(), by = new Map(all.map(v => [v.id, v])), slots = [];
    all.forEach((v, i) => { if (ids.includes(v.id)) slots.push(i); });
    ids.forEach((id, k) => { if (k < slots.length && by.get(id)) all[slots[k]] = by.get(id); }); this.items = all;"""),
("""    const others = all.filter(x => !v || x.id !== v.id), cur = v ? all.findIndex(x => x.id === v.id) : others.length;""",
 """    const mineAll = all.filter(x => (x.modules || []).includes(vlHere())), others = mineAll.filter(x => !v || x.id !== v.id), cur0 = v ? mineAll.findIndex(x => x.id === v.id) : -1, cur = cur0 >= 0 ? cur0 : others.length;   // position among this module's videos (patch video-own-module)""", "// position among this module's videos (patch video-own-module)"),
("""      const rest = (this.items || []).filter(x => x.id !== r.video.id); rest.splice(Math.min(+pos.value, rest.length), 0, r.video); this.items = rest;
      close(true); this.render(); toast(isNew ? 'Video added' + (r.video.status === 'published' ? ' and published.' : ' as a draft.') : 'Saved.', 'ok');
      if (rest.findIndex(x => x.id === r.video.id) !== (v ? cur : -1)) {""",
 """      const before = (this.items || []).map(x => x.id).join(), rest = (this.items || []).filter(x => x.id !== r.video.id), mine = rest.filter(x => (x.modules || []).includes(vlHere()));
      const at = mine[+pos.value] ? rest.indexOf(mine[+pos.value]) : mine.length ? rest.indexOf(mine[mine.length - 1]) + 1 : rest.length;   // before this module's video at that position
      rest.splice(at, 0, r.video); this.items = rest;
      close(true); this.render(); toast(isNew ? 'Video added' + (r.video.status === 'published' ? ' and published.' : ' as a draft.') : 'Saved.', 'ok');
      if (isNew || rest.map(x => x.id).join() !== before) {""", "// before this module's video at that position"),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for r in R:
        a, b = r[0], r[1]
        if b in s or (len(r) > 2 and r[2] in s): continue   # later patches (video-categories) edit some of these lines
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
