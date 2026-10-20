"""Student My Assessments never hangs on "Loading your assessments…": the list may take up to 90 s (was 30 s — a group
with many ⚡ Topic quizzes took longer on the class server), and when it cannot be loaded the page shows the reason with
↻ Try again instead of silently asking the server again and again (a failed load re-rendered "Loading…" and started a
new request at once, for ever). Idempotent."""
import sys
R = [
("""    const r = await Backend.rawPost(Object.assign({ action }, payload), { timeout: 30000 });""",
"""    const r = await Backend.rawPost(Object.assign({ action }, payload), { timeout: action === 'getMyAssessments' ? 90000 : 30000 });"""),
("""    const r = await AssessAPI.getMyAssessments(me.email, this.pw());
    this.loading = false;
    if (r && r.ok) this.list = r;""",
"""    this.loadError = null;
    const r = await AssessAPI.getMyAssessments(me.email, this.pw());
    this.loading = false;
    if (r && r.ok) this.list = r;"""),
("""    else toast((r && r.error) || 'Could not refresh your assessments.', 'bad');""",
"""    else { this.loadError = (r && r.error) || 'Could not load your assessments.'; if (this.list) toast(this.loadError, 'bad'); }"""),
("""    if (!this.list && !this.loading) { page.appendChild(el('div', { class: 'card empty' }, 'Loading your assessments…')); this.reload(); return; }""",
"""    if (!this.list && !this.loading && this.loadError) {   // the list could not be loaded: say why, retry only when asked
      page.appendChild(el('div', { class: 'card empty assess-loaderr' }, el('span', { class: 'big' }, '⚠️'), el('b', null, 'Your assessments could not be loaded.'),
        el('p', { class: 'small muted' }, this.loadError), el('button', { class: 'btn btn-primary', onclick: () => { this.loadError = null; this.render(); } }, '↻ Try again')));
      return;
    }
    if (!this.list) { page.appendChild(el('div', { class: 'card empty' }, 'Loading your assessments…')); if (!this.loading) this.reload(); return; }"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
