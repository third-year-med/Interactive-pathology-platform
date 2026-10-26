"""Teacher Portal → Results: the compact sticky "ASSESSMENT … · Change" bar is removed as soon as the teacher leaves
Results (another view or another portal tab). It was attached to the page and stayed on top of Learn and its ⛶ Full
screen after the teacher went from Results to Learn (user, 2026-10-26, screenshot). Idempotent."""
import sys
R = [
("""    document.body.appendChild(sticky);
""",
 """    document.body.appendChild(sticky);
    // leaving Results (another view or portal tab) removes the bar — it never stays on top of Learn / ⛶ Full screen (2026-10-26)
    const rsLeave = () => setTimeout(() => { if (Router.current === 'teacher' && this.T().tab === 'results' && sticky.isConnected) return; sticky.remove(); window.removeEventListener('hashchange', rsLeave); if (this._io) { this._io.disconnect(); this._io = null; } }, 0);
    window.addEventListener('hashchange', rsLeave);
"""),
(""".rs-sticky.show{""", """body.learn-fs .rs-sticky{display:none!important}
.rs-sticky.show{"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
