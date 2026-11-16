"""Practical front page (#/apply): "▶ Present all cases" and "🖨 Print PDF" in the Practical cases box, and no "1 · Practical
cases" heading when that box is the only section (user, 2026-11-16: "add Present all cases and print PDF in these two boxes …
remove the title above, the white box includes this name"). Present = PracPresent.start() (patch prac-present); Print PDF =
the complete-set handout (PracHandout.print, the print window's "Save as PDF"), offered when the teacher allows students to
print the set (Practical → Settings), always for teachers. Wraps Views.apply.render; inserted just before the prac-admin-only
block (shared anchors would break the other patches' idempotency checks). Idempotent."""
import sys
HEAD_AO = '/* ---------- Pathology Spotter, OSPE, Image atlas and Image Bank for the Administrator only (patch prac-admin-only v2) ---------- */'
R = [
(HEAD_AO,
 """/* ---------- Practical front page: Present all cases + Print PDF (patch prac-hub-actions) ---------- */
(function () {
  if (!Views.apply || typeof PracData === 'undefined') return;
  const css = '.pha-row{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem 1rem}.pha-acts{display:inline-flex;gap:.5rem;flex-wrap:wrap}.pha-acts .btn{font-weight:600}' +
    '@media (max-width:640px){.pha-row{margin-bottom:.3rem}}';
  document.head.appendChild(el('style', { id: 'pha-css' }, css));
  const stop = f => e => { e.preventDefault(); e.stopPropagation(); f(); };
  const a0 = Views.apply.render;
  Views.apply.render = function () {
    const r = a0.apply(this, arguments);
    try {
      const v = document.getElementById('view-apply'); if (!v) return r;
      const link = v.querySelector('.ux-list a[href="#/practical"]'), b = link && link.querySelector('.ux-list-b > b');
      const pubs = PracData.published(), teacher = Auth.isTeacher(), cfg = PracData.cfg() || {};
      if (b && pubs.length && !link.querySelector('.pha-acts')) {
        const acts = el('span', { class: 'pha-acts' });
        if (typeof PracPresent !== 'undefined' && PracPresent.cases().length)
          acts.appendChild(el('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-a': 'pha-present', onclick: stop(() => PracPresent.start()) }, '▶ Present all cases'));
        const printable = pubs.filter(p => teacher || pracPerms(p).print);
        if ((teacher || cfg.allowSetPrint) && printable.length && typeof PracHandout !== 'undefined')
          acts.appendChild(el('button', { class: 'btn btn-sm', type: 'button', 'data-a': 'pha-print', title: 'Print the practical cases or save them as a PDF', onclick: stop(() => PracHandout.print(printable, 'set')) }, '🖨 Print PDF'));
        if (acts.children.length) { const row = el('span', { class: 'pha-row' }); b.before(row); row.appendChild(b); row.appendChild(acts); }
      }
      // the "1 · Practical cases" heading goes when its box is the only section (after the other wrappers have removed rows)
      Promise.resolve().then(() => {
        const hs = v.querySelectorAll('h2.ux-h2');
        if (hs.length === 1) { const nx = hs[0].nextElementSibling; if (nx && nx.classList.contains('ux-list') && nx.querySelector('a[href="#/practical"]')) hs[0].remove(); }
      });
    } catch (e) { }
    return r;
  };
})();

""" + HEAD_AO),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
