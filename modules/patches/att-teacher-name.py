"""Attendance → ▶ Start attendance: the Teacher field shows the name of the teacher ACCOUNT that opened the module
(user, 2026-10-26: "the name of the account owner, not Dr. Wesam Alzwawy, in every teacher account"). Asks Portal.gs 2.35
(`teacherWho`) once per page; a personal teacher gets their account name, the Admin keeps the last name typed (or the
author). A name the teacher types is never overwritten. Before Portal.gs 2.35 is deployed nothing changes. Idempotent."""
import sys
R = [
("""    const teacher = el('input', { type: 'text', value: last.teacher || AUTHOR });
""",
 """    const teacher = el('input', { type: 'text', value: last.teacher || AUTHOR });
    // the account that opened the module (Portal.gs 2.35 teacherWho): a personal teacher sees their own name, never the author's
    if (!this.whoP) this.whoP = Backend.authedPost({ action: 'teacherWho' }, { timeout: 20000 }).catch(() => null);
    teacher.addEventListener('input', () => { teacher.dataset.typed = '1'; });
    this.whoP.then(r => { if (r && r.ok && !r.admin && r.name && !teacher.dataset.typed) teacher.value = r.name; });
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
