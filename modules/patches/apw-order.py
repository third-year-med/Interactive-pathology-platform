"""🔑 Passwords list in the same order as the Assessment Library and the students' list: other assessments first (newest
first), then the ⚡ topic quizzes by number — Topic 1, 2, … 10, 11 … (was alphabetical: Topic 1, 10, 11 … 2). User,
2026-10-21. Needs patch teacher-board (assessTopicSort). Idempotent."""
import sys
R = [
("""      const asm = (State.assessments || []).filter(a => a.status !== 'archived').slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));""",
"""      const asm = assessTopicSort((State.assessments || []).filter(a => a.status !== 'archived'), a => a.updatedAt);   // as the library: others, then Topic 1 … N"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
