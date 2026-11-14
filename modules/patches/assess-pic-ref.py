"""🖼 Picture references in questions (user, 2026-11-14: a 🔒 assessment-bank file made from the exam-only Spotter questions, to
pick practical picture questions for graded exams). A question picture `{ url: 'pic:<importKey>' }` shows the module's own
Learn picture with that import key (as imported by a picture-import file), `{ url: 'atlas:<id>' }` the atlas picture — like
the course figures' `fig:<id>`. So a bank file carries no picture data and no Drive address: the picture is found in the
module when the question is shown (assessment builder, preview, the student's attempt and its review). A reference that
cannot be found shows the usual "⚠ Image could not be loaded". Wraps resolveImgUrl; idempotent."""
import sys
R = [
("""function resolveImgUrl(u) {
  if (typeof u === 'string' && u.startsWith('fig:')) { const f = FIGURES[u.slice(4)]; return f ? svgDataUri(f.svg) : ''; }
  return u;
}""",
 """function resolveImgUrl(u) {
  if (typeof u === 'string' && u.startsWith('fig:')) { const f = FIGURES[u.slice(4)]; return f ? svgDataUri(f.svg) : ''; }
  return u;
}
/* ---------- 🖼 Picture references in questions: pic:<importKey>, atlas:<id> (patch assess-pic-ref) ---------- */
const RESOLVE_IMG_URL0 = resolveImgUrl;
resolveImgUrl = function (u) {
  if (typeof u === 'string' && u.startsWith('pic:')) {
    const key = u.slice(4);
    for (const t of getTopics(true)) for (const s of (t.sections || [])) {
      const m = sectionMedia(s.id).find(x => x && x.importKey === key && x.url && x.type !== 'link'); if (m) return m.url;
    }
    return '';
  }
  if (typeof u === 'string' && u.startsWith('atlas:')) {
    const x = typeof ATLAS !== 'undefined' ? ATLAS.all().find(a => a.id === u.slice(6) && a.src) : null; return x ? x.src : '';
  }
  return RESOLVE_IMG_URL0(u);
};"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
