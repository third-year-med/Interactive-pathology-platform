"""Image atlas with every picture of the module (user, 2026-10-29): Practical → Image atlas also shows the pictures the
teacher added to the Learning Blocks (Learn → ➕ picture, picture-import files — State.customMedia), next to the built-in
image library, grouped by topic, in Study and Test me, with Gross / Microscopic (guessed from the caption) and a
"Module pictures" source. Diagnosis = the caption up to its first ":" ("Fatty liver (gross): …" → "Fatty liver"), what to
look for = the rest. The Learning Blocks are unchanged (no picture shown twice there). Idempotent."""
import sys
R = [
("""const PracAtlas = {
""",
"""/* ---------- Image atlas: every picture of the module (patch atlas-all-pictures) ---------- */
function atlasMediaKind(t) {
  t = String(t || '');
  return /\\(gross|\\bgross\\b|cut surface/i.test(t) ? 'gross' : /\\(micro|microscop|histolog|\\bH ?& ?E\\b|high power|low power|\\bsmear\\b/i.test(t) ? 'micro' : /clinical|photograph/i.test(t) ? 'clinical' : '';
}
/** The pictures added to the Learning Blocks (not the image library), as atlas records. */
ATLAS.teacherPics = function () {
  const known = new Set(this.all().map(x => x.src).filter(Boolean)), out = [];
  allSections().forEach(({ section: s }) => sectionMedia(s.id).forEach((m, k) => {
    if (!m || !m.url || (m.type || 'image') !== 'image' || known.has(m.url)) return; known.add(m.url);
    const cap = String(m.caption || '').trim(), i = cap.indexOf(':'), split = i > 0 && i < 90;
    const head = (split ? cap.slice(0, i) : cap.split(/[.;—]/)[0]).trim();
    const dx = head.replace(/\\s*\\((?:gross|micro\\w*|histolog\\w*|H ?& ?E|high power|low power|\\w+ stain)[^)]*\\)\\s*/ig, ' ').replace(/\\s+/g, ' ').trim() || s.heading;
    out.push({ id: 'm-' + (m.id || s.id + '-' + k), media: true, provider: 'module', source: 'Module pictures', embed: true, src: m.url,
      kind: atlasMediaKind(cap), dx, title: dx, caption: cap, credit: String(m.credit || ''), look: split && cap.slice(i + 1).trim() ? [cap.slice(i + 1).trim()] : [], sections: [s.id] });
  }));
  return out;
};
/** Everything the Image atlas shows: the image library + the pictures added to the Learning Blocks. */
ATLAS.module = function () { return this.all().concat(this.teacherPics()); };
(function () {
  const credit0 = atlasCreditEl;
  atlasCreditEl = function (rec) { return rec && rec.media ? el('span', { class: 'atl-credit-in' }, rec.credit ? 'Image: ' + rec.credit : 'Picture added to the module') : credit0.apply(this, arguments); };
})();
const PracAtlas = {
"""),
("""    const all = ATLAS.all();
    if (id) return this.detail(page, ATLAS.byId(id));""",
"""    const all = ATLAS.module();
    if (id) return this.detail(page, all.find(x => x.id === String(id)) || ATLAS.byId(id));"""),
]
DONE = '(patch atlas-all-pictures)'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if DONE not in s:
        for a, b in R:
            assert s.count(a) == 1, (path, a[:60]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
