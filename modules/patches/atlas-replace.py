"""Learn → Edit Mode: ⇄ Replace on LIBRARY pictures (user 2026-10-31). Library pictures (PEIR, Commons …) had only 🗑 Remove
in a Learning Block. The platform already replaces a library picture module-wide with the universal editor (UE, kind
'atlas': 🖼 Pictures → ⇄ Replace, saved in contentedits, "↺ Reset to original"), reachable only from Practical → Image
atlas. This patch adds a ⇄ Replace button to each library picture in Learn that opens that same editor on its Pictures tab —
no new data, the existing replacement (same record: id, diagnosis, sections, Spotter links) is used everywhere. Idempotent."""
import sys
R = [
("""  // 3 · image links (WebPath, WebPathology, Pathology Outlines) — matched by address""",
 """  // 2b · ⇄ Replace on the library pictures (patch atlas-replace): opens the universal editor's Pictures tab for that record
  if (typeof ATLAS !== 'undefined' && typeof UE !== 'undefined' && UE.open) {
    const imgs2 = ATLAS.forSection(s.id);
    body.querySelectorAll('.atl-block .atl-fig').forEach((node, k) => {
      const x = imgs2[k], tools = x && node.querySelector(':scope > .em-tools'); if (!tools || tools.querySelector('.em-rep')) return;
      tools.insertBefore(emBtn('⇄ Replace', 'em-edit em-rep', 'Replace this library picture (everywhere in this module; ↺ Reset to original brings it back)', () => UE.open('atlas', x.id, x._ueOrig || x, 'image')), tools.lastChild);
    });
  }
  // 3 · image links (WebPath, WebPathology, Pathology Outlines) — matched by address"""),
("""  if (t) { parts.push(JSON.stringify(t)); (t.sections || []).forEach(s => parts.push(JSON.stringify(sectionMedia(s.id)))); }""",
 """  if (t) { parts.push(JSON.stringify(t)); (t.sections || []).forEach(s => parts.push(JSON.stringify(sectionMedia(s.id)))); parts.push('ue' + (window.__ueVer || 0)); }   // a universal-editor edit (e.g. a replaced library picture) redraws Learn (patch atlas-replace)"""),
("""o[sc.id] = JSON.stringify(sc) + JSON.stringify(sectionMedia(sc.id)); }); return o; };""",
 """o[sc.id] = JSON.stringify(sc) + JSON.stringify(sectionMedia(sc.id)) + 'ue' + (window.__ueVer || 0); }); return o; };"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
