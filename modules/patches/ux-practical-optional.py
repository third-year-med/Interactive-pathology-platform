"""Learning-path link check (#/learn/check): topic t17 ("How to answer a practical") is required only when a teaching
unit lists it — a module without a practical topic is valid (the Apply page already hides that link). A page whose check has no
such rule is left unchanged. Idempotent."""
import sys
R = [
("""  if (!all.some(t => t.id === 't17')) errors.push('The Apply page links to topic t17 (practical reading), which does not exist.');""",
"""  if (UX_ALL_UNITS.some(u => (u.topics || []).includes('t17')) && !all.some(t => t.id === 't17')) errors.push('The Apply page links to topic t17 (practical reading), which does not exist.');"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        if a not in s: continue   # this page's link check has no t17 rule (nothing to relax)
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
