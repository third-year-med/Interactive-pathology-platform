"""Presentation Mode → 📖 Learn (user 2026-10-31): a toolbar button that leaves the slides (and fullscreen) and opens Learn
at the place the current slide comes from — its Learning Block (section), else its topic, else the nearest earlier slide
that has one, else the Learn start page. Idempotent."""
import sys
R = [
("""    bar.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'print-slides', title: 'Print the slides or save them as a PDF', onclick: () => this.printDialog() }, '🖨 Print / PDF'));""",
 """    bar.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'print-slides', title: 'Print the slides or save them as a PDF', onclick: () => this.printDialog() }, '🖨 Print / PDF'));
    bar.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'pres-learn', title: 'Open this slide’s topic in Learn', onclick: () => this.openInLearn() }, '📖 Learn'));   // patch present-learn"""),
("""  toggleFullscreen() {
    const on = !this.els.wrap.classList.contains('pres-fullscreen');""",
 """  /** 📖 Learn (patch present-learn): Learn at the current slide's section, else its topic (from this or an earlier slide). */
  openInLearn() {
    if (this.els.wrap.classList.contains('pres-fullscreen')) { this.setFullscreen(false); try { if (document.fullscreenElement) { this._fsNative = false; document.exitFullscreen().catch(() => { }); } } catch (e) { /* ignore */ } }
    if (this.overview) this.toggleOverview();
    const list = this.list(); let sec = null, top = null;
    for (let i = this.idx; i >= 0 && !sec && !top; i--) {
      const x = list[i]; if (!x) continue;
      const f = x.sectionId ? findSection(x.sectionId) : null;
      if (f) sec = f; else if (x.topicId && getTopic(x.topicId)) top = x.topicId;
    }
    if (sec) Router.go('explain', [sec.topic.id, sec.section.id]); else if (top) Router.go('explain', [top]); else Router.go('explain');
  },
  toggleFullscreen() {
    const on = !this.els.wrap.classList.contains('pres-fullscreen');"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
