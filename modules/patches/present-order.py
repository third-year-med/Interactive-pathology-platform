"""Presentation Mode follows ⇅ Arrange pictures (user 2026-10-31). The Images slides of a section were made from the Learn
pictures, but a saved (customized) deck kept the order the pictures had when it was saved, and the slide cache noticed only
added / removed pictures, not a new order. Now:
  • the cache signature includes the ORDER of the teacher's pictures and the library imageOrder;
  • pmFollowOrder() puts the pictures on a section's Images slides in the Learn order — library pictures among the library
    places, the teacher's pictures among theirs — so the slide layout (4 library pictures per slide, one teacher picture
    per slide, links, slides the teacher removed or edited) stays as it is. Only the displayed copy is re-ordered; the saved
    deck is not rewritten. Idempotent."""
import sys
R = [
("""  let m = ''; try { m = Object.keys(State.customMedia || {}).map(k => k + ':' + (State.customMedia[k] || []).length).join(','); } catch (e) { }""",
 """  let m = ''; try { m = Object.keys(State.customMedia || {}).map(k => k + ':' + (State.customMedia[k] || []).map(x => x && (x.id || x.url)).join(';')).join(','); } catch (e) { }   // order too (patch present-order)"""),
("""(x.figures || []).length + '.' + (x.links || []).length + '.' + (x.hideImages || []).join(',')""",
 """(x.figures || []).length + '.' + (x.links || []).length + '.' + (x.hideImages || []).join(',') + '.' + (x.imageOrder || []).join(',')"""),
("""  _pmCache.base = base; _pmCache.sig = sig; _pmCache.out = out;""",
 """  pmFollowOrder(out);   // the pictures in the Learn order (patch present-order)
  _pmCache.base = base; _pmCache.sig = sig; _pmCache.out = out;"""),
("""/** Called by mutate(): Images slides the teacher removed stay removed. */""",
 """/** ⇅ Arrange pictures → slides (patch present-order): on each section's Images slides, the library pictures and the teacher's
 *  pictures are put in the order Learn shows them, each kind in its own places (the layout of the slides is kept). The
 *  changed slides are copies — the saved deck itself is not rewritten. */
function pmFollowOrder(out) {
  getTopics().forEach(t => (t.sections || []).forEach(s => {
    const idx = []; out.forEach((x, i) => { if (x && x.type === 'gallery' && x.sectionId === s.id && !x.pracId) idx.push(i); });
    if (!idx.length) return;
    const want = pmSectionRefs(s).imgs.map(pmRefKey);
    const copied = new Set();
    ['atlas', 'media'].forEach(kind => {
      const pos = [];
      idx.forEach(i => (out[i].items || []).forEach((r, j) => { if (r && r.t === kind && want.indexOf(pmRefKey(r)) >= 0) pos.push([i, j]); }));
      if (pos.length < 2) return;
      const refs = pos.map(([i, j]) => out[i].items[j]);
      const sorted = refs.slice().sort((a, b) => want.indexOf(pmRefKey(a)) - want.indexOf(pmRefKey(b)));
      if (sorted.every((r, k) => r === refs[k])) return;
      pos.forEach(([i, j], k) => {
        if (!copied.has(i)) { out[i] = Object.assign({}, out[i], { items: out[i].items.slice() }); copied.add(i); }
        out[i].items[j] = sorted[k];
      });
    });
  }));
}
/** Called by mutate(): Images slides the teacher removed stay removed. */"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
