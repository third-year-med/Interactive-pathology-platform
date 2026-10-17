"""2.20 module patch: the class quiz password is retired (with a class server) — every assessment needs its own password."""
import sys
MARK = "apw-none"
def patch(s):
    if MARK in s: return s, 'already'
    if "renderAssessPw(box)" not in s: raise SystemExit('needs the 2.19 patch first')
    def rep(a, b, n=1):
        nonlocal s
        c = s.count(a)
        if c != n: raise SystemExit('pattern found %d× (expected %d): %r' % (c, n, a[:90]))
        s = s.replace(a, b)
    # teacher: no class (default) password card while a class server is connected (local mode keeps it)
    rep("""    clear(box);
    this.renderAssessPw(box);""", """    clear(box);
    this.renderAssessPw(box);
    if (Backend.isConfigured()) return;   // 2.20: the class quiz password is retired — every assessment has its own""")
    rep("""Not case-sensitive. An assessment without its own password uses the class quiz password below.'), list));""",
        """Not case-sensitive. An assessment without a password cannot be started until you give it one.'), list));""")
    rep("""el('span', { class: 'small muted' }, 'class quiz password')),""",
        """el('span', { class: 'small apw-none', style: 'color:var(--bad);font-weight:600' }, '⚠ none yet — students cannot start it')),""")
    rep("""'data-a': 'clear', onclick: () => save(a, { clear: true }) }, '↺ Use class password')""",
        """'data-a': 'clear', onclick: () => save(a, { clear: true }) }, '✕ Remove password')""")
    rep("""toast(o.clear ? '“' + (a.title || a.id) + '” uses the class quiz password again.' : """,
        """toast(o.clear ? '“' + (a.title || a.id) + '” has no password now — students cannot start it.' : """)
    # one click for every assessment still without a password
    rep("""      list.appendChild(el('table', { class: 'data-table apw-tbl' },""",
        """      const missing = asm.filter(a => !map[a.id]);
      if (missing.length) list.appendChild(el('div', { class: 'row', style: 'margin:.2rem 0 .7rem;gap:.6rem;flex-wrap:wrap' },
        el('span', { class: 'small', style: 'color:var(--bad);font-weight:600' }, '⚠ ' + missing.length + ' assessment' + (missing.length === 1 ? ' has' : 's have') + ' no password yet'),
        el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'all', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true;
          for (const a of missing) { const r = await Backend.authedPost({ action: 'aePwSet', assessmentId: a.id, random: true }); if (r && r.ok) map = r.passwords || map; else { toast('✗ ' + ((r && r.error) || 'Could not save.'), 'bad'); break; } }
          draw(); toast('✓ Every assessment has its own password now.', 'ok');
        } }, '🎲 Give each of them a random password')));
      list.appendChild(el('table', { class: 'data-table apw-tbl' },""")
    # student: an assessment without a password is not open yet
    rep("""      const btn = it.canStart ? el('button', { class: 'btn btn-primary', onclick: (ev) => this.start(it, ev.currentTarget) }""",
        """      const noPw = it.canStart && !it.inProgressId && it.passwordSet === false;   // 2.20: no password yet → not open
      const btn = it.canStart && !noPw ? el('button', { class: 'btn btn-primary', onclick: (ev) => this.start(it, ev.currentTarget) }""")
    rep("""        el('div', { class: 'row mt1' }, btn, reason ? el('span', { class: 'small muted' }, reason) : null)));""",
        """        el('div', { class: 'row mt1' }, btn, reason || noPw ? el('span', { class: 'small muted' }, reason || '🔒 Not open yet — your teacher has not given this assessment a password.') : null)));""")
    return s, 'patched'
if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f, encoding='utf-8').read(); s2, st = patch(s)
        if st == 'patched': open(f, 'w', encoding='utf-8').write(s2)
        print(f, st)
