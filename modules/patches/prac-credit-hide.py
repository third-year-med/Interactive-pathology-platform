"""Practical picture descriptions without the credit line (user, 2026-11-16: "remove these tags from descriptions of practicals …
it's confusing students"). The practical-import file added each picture's credit to its caption ("… — ExpertPath (Elsevier) —
departmental practical collection, teaching use within this course only"), so it showed as part of the description on the
practical page, in the handouts and in presentation mode. PE_figCaption (the one place those descriptions are made) now drops a
trailing credit; the stored caption is unchanged. Idempotent; wraps PE_figCaption only."""
import sys
R = [
("""/** Asserts that a model built without answers contains none""",
 """/* ---------- Practical picture descriptions without the credit line (patch prac-credit-hide) ---------- */
const PRAC_CREDIT_RE = /\\s+—\\s+(?:ExpertPath|WebPath|WebPathology|PathologyOutlines|PEIR|Kumar V|Aster JC|Robbins|Elsevier|Wikimedia|Course syllabus|Practical inflammation cases|Departmental practical collection)[\\s\\S]*$/i;
function pracCaptionClean(c) { return String(c || '').replace(PRAC_CREDIT_RE, '').trim(); }
const PE_FIGCAPTION0 = PE_figCaption;
PE_figCaption = function (im) { return PE_FIGCAPTION0(Object.assign({}, im, { caption: pracCaptionClean(im && im.caption) })); };

/** Asserts that a model built without answers contains none"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
