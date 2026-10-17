"""Student My Assessments: ⚡ topic quizzes ("Topic N quiz — …") are listed in topic order (1 → last) after the other
assessments of the same group (which stay newest first). Idempotent."""
import sys
OLD = "      (can ? todo : subs.length ? done : other).push([-assessWhen(it, items.indexOf(it)), row]);"
NEW = """      const tq = /^Topic (\\d+) quiz\\b/.exec(a.title || '');   // ⚡ topic quizzes: topic 1 first … the last topic last, after the others
      (can ? todo : subs.length ? done : other).push([tq ? 1e15 + Number(tq[1]) : -assessWhen(it, items.indexOf(it)), row]);"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if NEW not in s:
        assert s.count(OLD) == 1, path; s = s.replace(OLD, NEW); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
