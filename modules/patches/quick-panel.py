"""Learn home: the "All topics · Glossary · Presentation mode" links become a prominent yellow Quick access panel
with three tiles (icon, title, one-line hint). Same links and class (.ux-quick, hidden by the learning lock). Idempotent."""
import sys
OLD_JS = """    page.appendChild(el('nav', { class: 'ux-quick', 'aria-label': 'Other ways to learn' },
      el('a', { href: '#/explain/overview' }, uxGlyph('≡'), 'All topics'), el('a', { href: '#/study/glossary' }, uxGlyph('Aa'), 'Glossary'), el('a', { href: '#/present' }, uxGlyph('▭'), 'Presentation mode')));"""
NEW_JS = """    // Quick access: a warm, prominent panel — the three most useful ways into the module besides the path
    const qa = (href, ico, title, hint) => el('a', { class: 'ux-qa', href }, el('span', { class: 'ux-qa-ico', 'aria-hidden': 'true' }, ico),
      el('span', { class: 'ux-qa-txt' }, el('b', null, title), el('small', null, hint)), el('span', { class: 'ux-qa-go', 'aria-hidden': 'true' }, '→'));
    page.appendChild(el('nav', { class: 'ux-quick', 'aria-label': 'Quick access' },
      el('div', { class: 'ux-quick-h' }, '⭐ Quick access'),
      el('div', { class: 'ux-quick-grid' },
        qa('#/explain/overview', '📚', 'All topics', 'Every topic of the module at a glance'),
        qa('#/study/glossary', 'Aa', 'Glossary', 'Key terms explained in plain words'),
        qa('#/present', '🖥️', 'Presentation mode', 'Full-screen slides for class or revision'))));"""
OLD_CSS = """.ux-quick{display:flex;gap:1.2rem;flex-wrap:wrap;margin:.8rem .2rem 0;font-size:.9rem}
.ux-quick a{color:var(--ink-2);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:.35rem}
.ux-quick a:hover{color:var(--teal-ink)}"""
NEW_CSS = """.ux-quick{margin:1rem 0 .4rem;padding:.85rem 1rem 1rem;border-radius:16px;border:1px solid #f1d27a;
  background:linear-gradient(135deg,#fff9e0 0%,#ffefb8 100%);box-shadow:0 6px 18px rgba(180,130,10,.12)}
.ux-quick-h{font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a5a00;margin:0 0 .6rem .15rem}
.ux-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem}
.ux-qa{display:flex;align-items:center;gap:.75rem;padding:.75rem .85rem;border-radius:12px;background:#fffdf5;border:1px solid #f3dc95;
  color:var(--navy);text-decoration:none;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
.ux-qa:hover,.ux-qa:focus-visible{transform:translateY(-2px);box-shadow:0 8px 18px rgba(180,130,10,.2);border-color:#e0b02c;outline:none}
.ux-qa-ico{flex:0 0 auto;width:2.6rem;height:2.6rem;border-radius:50%;display:grid;place-items:center;font-size:1.25rem;font-weight:800;
  background:linear-gradient(135deg,#ffd75e,#f5b301);color:#5b3b00;box-shadow:inset 0 -2px 0 rgba(0,0,0,.08)}
.ux-qa-txt{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.ux-qa-txt b{font-size:1rem}
.ux-qa-txt small{font-size:.8rem;color:#7a6330;margin-top:.1rem}
.ux-qa-go{margin-left:auto;font-weight:800;color:#c08a00;transition:transform .15s ease}
.ux-qa:hover .ux-qa-go{transform:translateX(3px)}
@media (max-width:720px){.ux-quick-grid{grid-template-columns:1fr}}"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in ((OLD_JS, NEW_JS), (OLD_CSS, NEW_CSS)):
        if b in s: continue
        assert s.count(a) == 1, (path, a[:60]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
