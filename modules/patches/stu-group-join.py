"""Teacher Portal → 👥 Students in a group's module: after ➕ Add a student / 📥 Create accounts the message says that the
student(s) also joined the group's student list and can sign in on the group page (Portal.gs 2.24 does it on the server).
Text only — the accounts are created exactly as before. Idempotent."""
import sys
R = [
("""      msg.className = 'msg ok'; msg.textContent = '✓ Account created for ' + r.username + (r.tempPassword ? '' : ' (with the password you entered — the student must change it at first sign-in).');""",
"""      msg.className = 'msg ok'; msg.textContent = '✓ Account created for ' + r.username + (r.tempPassword ? '' : ' (with the password you entered — the student must change it at first sign-in).') + stuGroupNote(r);"""),
("""        bmsg.textContent = '✓ ' + r.created + ' created' + (bad.length ? ' · ' + bad.length + ' skipped: ' + bad.map(x => x.error).join(' ') : '');""",
"""        bmsg.textContent = '✓ ' + r.created + ' created' + (bad.length ? ' · ' + bad.length + ' skipped: ' + bad.map(x => x.error).join(' ') : '') + stuGroupNote(r);"""),
("""const StudentAdmin = {""",
"""/** Portal.gs 2.24: what happened on the group's student list (nothing when the module is not a group's). */
function stuGroupNote(r) {
  const g = r && r.group; if (!g) return '';
  const n = (g.joined || []).length, a = (g.already || []).length;
  return (n ? ' Also added to the student list of group ' + (g.name || GROUP_TAG || '') + ' — ' + (n === 1 ? 'the student signs' : 'they sign') + ' in on the group page with the same password' + (g.otherAccounts ? ' (accounts made in the group’s other modules too)' : '') + '.' : '')
    + (a ? ' ' + a + ' already on the group list (unchanged).' : '');
}
const StudentAdmin = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
