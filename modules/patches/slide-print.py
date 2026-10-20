"""Presentation → 🖨 Print / PDF: prints the slides shown (whole deck or the chosen topic, optional slide range), one
slide per landscape 16:9 page, exactly as on screen (same layout, colours, pictures, flowcharts, tables) — with
“Save as PDF” in the print dialog it becomes a PDF of the deck. Each slide is laid out at page size and auto-fitted
like on screen; pictures are loaded and decoded first. Question slides can show their answers. Idempotent."""
import sys
R = [
("""    bar.appendChild(el('button', { class: 'btn btn-sm', onclick: () => this.toggleFullscreen() }, fsOn ? '⤫ Exit fullscreen' : '⛶ Fullscreen'));""",
"""    bar.appendChild(el('button', { class: 'btn btn-sm', onclick: () => this.toggleFullscreen() }, fsOn ? '⤫ Exit fullscreen' : '⛶ Fullscreen'));
    bar.appendChild(el('button', { class: 'btn btn-sm', 'data-a': 'print-slides', title: 'Print the slides or save them as a PDF', onclick: () => this.printDialog() }, '🖨 Print / PDF'));"""),
("""  /** Shrink text only if the slide overflows (the teacher's scale is the maximum). */""",
"""  /** 🖨 Print / PDF: choose the slides (the ones shown: whole deck or the topic picked in the menu), then print. */
  printDialog() {
    const list = this.list(); if (!list.length) { toast('There are no slides to print.', 'warn'); return; }
    const n = list.length, what = this.filter ? 'Topic ' + topicNum(this.filter) + ' · ' + topicTitle(this.filter) : 'the whole deck';
    const from = el('input', { type: 'number', min: 1, max: n, value: 1, style: 'width:5.5em' }), to = el('input', { type: 'number', min: 1, max: n, value: n, style: 'width:5.5em' });
    const ans = el('input', { type: 'checkbox', checked: true });
    openModal({ title: '🖨 Print slides / save as PDF', body: el('div', { class: 'pp-dlg' },
      el('p', { style: 'margin-top:0' }, 'Prints ', el('b', null, what), ' (' + n + ' slides), one slide per landscape page, as they look on screen. To print only one topic, choose it in the slide menu first.'),
      el('div', { class: 'row', style: 'gap:.6rem;align-items:center;flex-wrap:wrap' }, el('label', null, 'From slide ', from), el('label', null, ' to ', to)),
      el('label', { class: 'pp-chk' }, ans, ' Show the answers on question slides'),
      el('p', { class: 'small muted', style: 'margin-bottom:0' }, 'In the print window choose “Save as PDF” as the printer to get a PDF file. Keep “Background graphics” on for the coloured slides.')),
      actions: [{ label: 'Cancel' }, { label: '🖨 Print', primary: true, onClick: () => {
        const a = clamp((+from.value || 1) - 1, 0, n - 1), b = clamp((+to.value || n) - 1, a, n - 1);
        setTimeout(() => this.printSlides(list.slice(a, b + 1), { answers: ans.checked }), 30);
      } }] });
  },
  async printSlides(slides, opt) {
    if (this._printing) return; this._printing = true;
    if (this.els.wrap.classList.contains('pres-fullscreen')) this.toggleFullscreen();
    if (this.overview) this.toggleOverview();
    const keep = { stage: this.els.stage, idx: this.idx, revealed: this.revealed, stepPos: this.stepPos, filter: this.filter };
    const root = document.getElementById('pp-root') || document.body.appendChild(el('div', { id: 'pp-root', 'aria-hidden': 'true' }));
    clear(root);
    const busy = el('div', { class: 'pp-busy', role: 'status' }, '🖨 Preparing ' + slides.length + ' slide' + (slides.length === 1 ? '' : 's') + ' for printing…');
    document.body.appendChild(busy);
    const pageCss = el('style', { id: 'pp-page-css' }, '@page{size:297mm 167mm;margin:0}');
    try {
      const all = this.list();
      this.revealed = {}; if (opt && opt.answers) slides.forEach(s => { this.revealed[s.id] = true; });
      const stages = [];
      for (const s of slides) {
        const st = el('div', { class: 'pres-stage' });
        root.appendChild(el('div', { class: 'pp-page' }, st));
        this.els.stage = st; this.idx = all.indexOf(s); this.stepPos = -1;
        try { this.renderSlide(); } catch (e) { console.warn('print: slide skipped', e); }
        stages.push(st);
      }
      this.els.stage = keep.stage;
      // pictures: load now (not lazily) and decode before fitting and printing
      const imgs = [].slice.call(root.querySelectorAll('img'));
      imgs.forEach(i => { i.loading = 'eager'; });
      await Promise.all(imgs.map(i => new Promise(res => {
        const done = () => { if (i.decode) i.decode().then(res, res); else res(); };
        if (i.complete && i.naturalWidth) done(); else { i.addEventListener('load', done, { once: true }); i.addEventListener('error', res, { once: true }); setTimeout(res, 20000); }
      })));
      // shrink each slide only if it overflows its page — the same rule as on screen
      stages.forEach(st => {
        const sl = st.querySelector('.slide'); if (!sl) return;
        st.style.setProperty('--fit', '1'); let f = 1, g = 0;
        const over = () => sl.scrollHeight > sl.clientHeight + 2 || sl.scrollWidth > sl.clientWidth + 2;
        while (over() && f > 0.3 && g++ < 20) { f *= 0.9; st.style.setProperty('--fit', f.toFixed(3)); }
      });
      busy.remove();
      document.head.appendChild(pageCss);
      document.documentElement.classList.add('pp-on');
      await new Promise(r => setTimeout(r, 60));
      window.print();
    } catch (e) { console.warn(e); toast('Printing the slides failed: ' + e.message, 'bad'); }
    finally {
      await new Promise(r => setTimeout(r, 400)); if (window.__ppHold) await window.__ppHold;   // (tests: keep the print layout while a PDF is made)
      document.documentElement.classList.remove('pp-on'); pageCss.remove(); busy.remove(); clear(root);
      Object.assign(this, { idx: keep.idx, revealed: keep.revealed, stepPos: keep.stepPos, filter: keep.filter }); this.els.stage = keep.stage;
      this._printing = false; this.render();
    }
  },
  /** Shrink text only if the slide overflows (the teacher's scale is the maximum). */"""),
(""".pres-stage{flex:1;width:100%;margin:0;""",
"""#pp-root{position:fixed;left:-30000px;top:0;width:1122px;z-index:-1;pointer-events:none}
#pp-root .pp-page{width:1122px;height:630px;display:flex;overflow:hidden;background:#fff;position:relative}
#pp-root .pres-stage{border:0}#pp-root .slide{animation:none!important}#pp-root .pz-zoom,#pp-root .tally{display:none!important}
.pp-busy{position:fixed;left:50%;top:1rem;transform:translateX(-50%);z-index:9999;background:var(--navy);color:#fff;padding:.6rem 1.1rem;border-radius:10px;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.pp-chk{display:flex;gap:.5rem;align-items:center;margin:.8rem 0 .2rem}.pp-dlg label input[type=number]{margin-left:.3rem}
@media print{
html.pp-on body>*:not(#pp-root){display:none!important}
html.pp-on,html.pp-on body{background:#fff!important;margin:0!important;padding:0!important;overflow:visible!important}
html.pp-on #pp-root{position:static;left:auto;width:auto;z-index:auto}
html.pp-on #pp-root .pp-page{break-after:page;page-break-after:always;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html.pp-on #pp-root .pp-page:last-child{break-after:auto;page-break-after:auto}
}
.pres-stage{flex:1;width:100%;margin:0;"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
