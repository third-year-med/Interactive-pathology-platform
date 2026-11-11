"""📝 My Assessments: an assessment the student never started is not listed when the teacher closed or archived it
(user 2026-11-11). Old Topic 1–2 quizzes (5 questions, closed) showed under "Not available now" next to the current ones
(10 questions) with the same title. A student who took it still sees it (Completed, results, review); one closed only by
its deadline still shows ("The deadline has passed"). The teacher's Assessment Library is unchanged. Idempotent."""
import sys
R = [("""      const lastSub = subs[subs.length - 1];""",
      """      if (!it.attempts.length && !it.inProgressId && !it.canStart && (a.status === 'closed' || a.status === 'archived')) return;   // never started + closed by the teacher: not listed (patch assess-hide-closed-unstarted)
      const lastSub = subs[subs.length - 1];""")]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
