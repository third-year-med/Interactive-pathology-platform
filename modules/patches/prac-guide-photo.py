"""Practical study guide without a microscope (user, 2026-10-24): the college teaches the practicals from gross and
microscopic PHOTOGRAPHS, so the 🧭 card (patch prac-guide) speaks of the practical session, not the lab bench or the
microscope. Needs prac-guide. Idempotent."""
import sys
R = [
("'🧭 How to use the practical — before, in and after the lab'", "'🧭 How to use the practical — before, during and after the session'"),
("'This topic gives you the knowledge; Apply → Practical trains the skill at the bench. Use them together:'",
 "'This topic gives you the knowledge; Apply → Practical trains you to recognise the specimens in gross and microscopic pictures. Use them together:'"),
("'The practical trains the skill at the bench; ' + tName + ' in Learn gives you the knowledge. Use them together:'",
 "'The practical trains you to recognise the specimens in gross and microscopic pictures; ' + tName + ' in Learn gives you the knowledge. Use them together:'"),
("el('b', null, 'Before the lab — ')", "el('b', null, 'Before the session — ')"),
("el('b', null, 'In the lab — '), 'open your session’s practical in Apply → Practical and use its handout at the microscope.'",
 "el('b', null, 'During the session — '), 'open the session’s practical in Apply → Practical: describe each gross and microscopic picture on the handout before you name it.'"),
("el('b', null, 'After the lab — ')", "el('b', null, 'After the session — ')"),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
