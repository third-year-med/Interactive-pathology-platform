"""Passwords: at least 4 characters (was 8) for teachers and students (user, 2026-10-21) — the module page's checks and
hints: ➕ Add a student (initial password), 🔑 Reset a student's password, teacher first-time setup, teacher and student
"change password". The server checks the same minimum (Portal.gs 2.28 + Code.gs: STU_MIN_PW = 4 and the two teacher
checks). No maximum is added. Idempotent."""
import sys
R = [
("""'Initial password (optional, min 8)'""", """'Initial password (optional, min 4)'"""),
("""if (v && v.length < 8) { toast('At least 8 characters.', 'bad'); return; }""",
 """if (v && v.length < 4) { toast('At least 4 characters.', 'bad'); return; }"""),
("""if (p1.value.length < 8) { msg.className = 'msg bad'; msg.textContent = 'At least 8 characters.'; return; }""",
 """if (p1.value.length < 4) { msg.className = 'msg bad'; msg.textContent = 'At least 4 characters.'; return; }"""),
("""placeholder: 'New password (min 8 characters)'""", """placeholder: 'New password (min 4 characters)'"""),
("""if (n1.value.length < 8) { msg.className = 'msg bad'; msg.textContent = 'At least 8 characters.'; return; }""",
 """if (n1.value.length < 4) { msg.className = 'msg bad'; msg.textContent = 'At least 4 characters.'; return; }"""),
("""if (p1.value.length < 8) return setMsg(m2, 'At least 8 characters.');""",
 """if (p1.value.length < 4) return setMsg(m2, 'At least 4 characters.');"""),
("""Create the teacher password (min 8 characters).""", """Create the teacher password (min 4 characters)."""),
("""if (n1.value.length < 8) return setMsg(msg, 'The new password must be at least 8 characters.');""",
 """if (n1.value.length < 4) return setMsg(msg, 'The new password must be at least 4 characters.');"""),
("""(at least 8 characters, not your student ID)""", """(at least 4 characters, not your student ID)"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
