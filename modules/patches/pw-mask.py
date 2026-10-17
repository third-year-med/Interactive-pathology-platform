"""Assessment passwords are covered (••••••) on the teacher's screen; 👁 Show reveals ONE at a time (2 min); toasts and the
change dialog never print a password."""
import sys
MARK = "function apwSecret("
def patch(s):
    if MARK in s: return s, 'already'
    if "renderPwStrip(box)" not in s: raise SystemExit('needs the passwords-in-Assessments patch first')
    def rep(a, b, n=1):
        nonlocal s
        c = s.count(a)
        if c != n: raise SystemExit('pattern found %d× (expected %d): %r' % (c, n, a[:90]))
        s = s.replace(a, b)
    rep("""const AssessUI = {""", """/** A covered password with its own 👁 Show: only ONE is ever shown (projector-safe), and it covers itself again after 2 minutes. */
const APW_SHOWN = { id: '', timer: null };
function apwRepaintAll() { document.querySelectorAll('.apw-secret').forEach(w => { if (w._paint) w._paint(); }); }
function apwSecret(id, password) {
  const code = el('code', { class: 'apw-pw', style: 'font-weight:700;letter-spacing:.06em;min-width:4.6em;display:inline-block' });
  const btn = el('button', { class: 'btn btn-xs apw-eye', type: 'button', 'data-a': 'reveal' });
  const wrap = el('span', { class: 'apw-secret', 'data-id': id, style: 'display:inline-flex;align-items:center;gap:.35rem' }, code, btn);
  wrap._paint = () => {
    const on = APW_SHOWN.id === id;
    code.textContent = on ? password : '••••••'; code.classList.toggle('apw-covered', !on);
    btn.textContent = on ? '🙈 Hide' : '👁 Show'; btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Cover the password again' : 'Show this password only (e.g. to give it to the class)';
  };
  btn.onclick = () => {
    clearTimeout(APW_SHOWN.timer);
    APW_SHOWN.id = APW_SHOWN.id === id ? '' : id;
    if (APW_SHOWN.id) APW_SHOWN.timer = setTimeout(() => { APW_SHOWN.id = ''; apwRepaintAll(); }, 120000);
    apwRepaintAll();
  };
  wrap._paint();
  return wrap;
}
const AssessUI = {""")
    # library column
    rep("""this.pw[a.id] ? el('code', { class: 'apw-pw', style: 'font-weight:700;letter-spacing:.04em' }, this.pw[a.id].password) : el('span'""",
        """this.pw[a.id] ? apwSecret(a.id, this.pw[a.id].password) : el('span'""")
    # 🔑 Passwords sub-tab
    rep("""own ? el('code', { class: 'apw-pw', style: 'font-size:1.05rem;font-weight:700;letter-spacing:.05em' }, own.password) : el('span'""",
        """own ? apwSecret(a.id, own.password) : el('span'""")
    # never print a password in a toast; the change dialog opens empty
    rep("""'✓ Password of “' + (a.title || a.id) + '”: ' + r.password, 'ok', 6000);""",
        """'✓ New password saved for “' + (a.title || a.id) + '” — press 👁 Show to see it.', 'ok', 6000);""", 2)
    rep("""value: (this.pw && this.pw[a.id] && this.pw[a.id].password) || '', placeholder: 'at least 4 characters'""",
        """value: '', placeholder: 'at least 4 characters'""")
    rep("""'td.apw-st{min-width:6.6rem}td.apw-st .badge,td.apw-cell code{white-space:nowrap;word-break:keep-all;overflow-wrap:normal}';""",
        """'td.apw-st{min-width:6.6rem}td.apw-st .badge,td.apw-cell code{white-space:nowrap;word-break:keep-all;overflow-wrap:normal}' +
    '.apw-pw.apw-covered{color:#8a96a6;letter-spacing:.12em}';""")
    return s, 'patched'
if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f, encoding='utf-8').read(); s2, st = patch(s)
        if st == 'patched': open(f, 'w', encoding='utf-8').write(s2)
        print(f, st)
