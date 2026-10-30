"""Practical settings start ticked (user, 2026-10-30, Settings → 👩‍🎓 Student access): students may download and print the
Complete Practical Set, and every handout option for new practicals is on — printing, PDF, real images, diagrams, questions,
viva, teaching points, answers, answers on the page, answer key. "Tell students which diagrams were AI-generated" stays off.
Changes only the built-in defaults: settings a teacher has saved, and the options each existing practical keeps, are
unchanged (Settings → "📄 Apply to all existing practicals" copies them). Idempotent."""
import sys
R = [
("""  includeTeachingPoints: true, includeAnswers: false, showAnswersOnline: false, allowAnswerKey: false, answerSpace: false, fileName: ''""",
 """  includeTeachingPoints: true, includeAnswers: true, showAnswersOnline: true, allowAnswerKey: true, answerSpace: false, fileName: ''   // all on (patch prac-defaults-on)"""),
("""  allowSetDownload: false, allowSetPrint: false, showAIDisclosure: false,""",
 """  allowSetDownload: true, allowSetPrint: true, showAIDisclosure: false,   // students may download / print the Complete Practical Set (patch prac-defaults-on)"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
