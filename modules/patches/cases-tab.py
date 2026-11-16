"""Clinical cases: their own main tab between Review and Practical, with ▶ Present all cases and 🖨 Print PDF on the cases page
(user, 2026-11-16: "transfer the clinical cases to the main front page between Review and Practical … add the Present All Cases
button and the Print PDF button, the same as in the practical cases"). The Review hub and its menu pills no longer list them.
Present = full-screen slides (the practical presentation's viewer, patch prac-present): Case N with the clinical presentation
(and the case's pictures), each step with its options — the answer hidden until R (👁 Reveal) — then the case title and the
take-home points. Print PDF = all cases with steps, answers and take-home points (printHTML; "Save as PDF" in the print window).
Inserted just before the prac-hub-actions block (shared anchors would break the other patches' idempotency checks). Idempotent."""
import sys
HEAD_HUB = '/* ---------- Practical front page: Present all cases + Print PDF (patch prac-hub-actions) ---------- */'
R = [
(HEAD_HUB,
 r"""/* ---------- Clinical cases: own main tab + Present all cases + Print PDF (patch cases-tab) ---------- */
(function () {
  if (typeof UX_AREAS === 'undefined' || !Views.cases || typeof CASES === 'undefined' || typeof PracPresent === 'undefined') return;
  // 1 · the main tab "Clinical Cases" between Review and Practical; Review no longer lists them
  UX_SVG.cases = '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M12 9.5v6M9 12.5h6"/>';
  const rv = UX_AREAS.find(a => a.id === 'practise');
  if (rv) { rv.items = rv.items.filter(it => it[2] !== 'cases'); rv.hint = String(rv.hint || '').replace(/clinical cases, /i, ''); }
  if (!UX_AREAS.some(a => a.id === 'cases')) UX_AREAS.splice(UX_AREAS.indexOf(rv) + 1, 0,
    { id: 'cases', label: 'Clinical Cases', short: 'Cases', hint: 'Clinical case simulations — present them in class or print them', items: [['Clinical cases', '✚', 'cases', []]] });
  const area0 = uxAreaOf;
  uxAreaOf = function (view) { return view === 'cases' ? 'cases' : area0.apply(this, arguments); };
  if (Views.practise) {
    const pr0 = Views.practise.render;
    Views.practise.render = function () {
      const r = pr0.apply(this, arguments);
      try {
        const v = document.getElementById('view-practise');
        if (v) {
          v.querySelectorAll('.ux-list a[href="#/cases"]').forEach(a => (a.closest('li') || a).remove());
          v.querySelectorAll('h2.ux-h2').forEach(h => { h.textContent = h.textContent.replace(/Questions and clinical cases/, 'Questions'); });
        }
      } catch (e) { }
      return r;
    };
  }
  // 2 · ▶ Present all cases
  const CasePresent = Object.assign({}, PracPresent, {
    slides: [], i: 0, shown: new Set(), root: null, keyFn: null,
    cases() { return CASES.slice(); },
    withQ() { return false; }, setWithQ() { },
    build() {
      const out = [], list = this.cases();
      list.forEach((c, k) => {
        const ci = k + 1, st = c.stages || [];
        out.push({ t: 'title', c, ci });
        st.forEach((sg, j) => out.push({ t: 'step', c, ci, sg, j, n: st.length }));
        out.push({ t: 'end', c, ci });
      });
      this.total = list.length; return out;
    },
    start(caseId) {
      this.slides = this.build(); if (!this.slides.length) { toast('No clinical cases to present yet.', 'info'); return; }
      const at = caseId ? this.slides.findIndex(s => s.c.id === caseId) : 0;
      this.i = at < 0 ? 0 : at; this.shown = new Set(); this.mount();
      if (this.root) this.root.setAttribute('aria-label', 'Clinical cases — presentation');
      if (!document.getElementById('ccp-style')) document.head.appendChild(el('style', { id: 'ccp-style' },
        '.ccp-opts{padding:.6rem .9rem}.ccp-opt{padding:.4rem .7rem;border-radius:10px;margin:.15rem 0}.ccp-opt.ok{background:#e3f6f1;box-shadow:inset 0 0 0 2px #0e9f9a;font-weight:700}' +
        '.pcp-clin.md p{margin:.3rem 0}.pcp-root .ue-extra{max-width:1000px;width:100%}.pcp-root .ue-extra img{max-height:38vh;width:auto;max-width:100%;object-fit:contain}'));
      this.paint();
    },
    paint() {
      const s = this.slides[this.i]; if (!s || !this.root) return; const c = s.c, open = this.shown.has(this.i);
      clear(this.top);
      const list = this.cases(), sel = el('select', { 'aria-label': 'Go to case', class: 'pcp-sel' }, list.map((x, k) => el('option', { value: x.id, selected: x.id === c.id }, 'Case ' + (k + 1))));
      sel.addEventListener('change', () => { const k = this.slides.findIndex(x => x.c.id === sel.value); if (k >= 0) this.go(k); sel.blur(); });
      pcpPut(this.top, el('span', { class: 'pcp-where' }, 'Clinical cases · ' + s.ci + ' of ' + this.total), sel,
        s.t === 'step' ? el('button', { class: 'pcp-rev', 'data-a': 'pcp-reveal', onclick: () => this.reveal() }, open ? '🙈 Hide' : '👁 Reveal (R)') : null,
        this.touch() ? null : el('button', { onclick: () => this.fullscreen(), title: 'Full screen (F)' }, '⛶'),
        el('button', { 'data-a': 'pcp-close', onclick: () => this.close(), title: 'Close (Esc)' }, '✕ Close'));
      const slide = el('div', { class: 'pcp-slide' });
      if (s.t === 'title') {
        let ex = null; try { ex = UE.extra(c, { noNotes: true }); } catch (e) { ex = null; }
        pcpPut(slide, el('div', { class: 'pcp-kicker' }, 'Clinical case' + (CASE_LEVELS[c.difficulty] ? ' · ' + CASE_LEVELS[c.difficulty] : '')),
          el('h1', { class: 'pcp-case' }, 'Case ' + s.ci), el('div', { class: 'pcp-clin md', html: renderMarkdown(c.presentation || '') }), ex,
          el('div', { class: 'pcp-hint' }, plural((c.stages || []).length, 'step') + ' · → next · R reveals the answer of each step'));
      } else if (s.t === 'step') {
        const sg = s.sg, opts = sg.options || [], k0 = opts.findIndex(o => o.correct), corr = opts[k0];
        pcpPut(slide, el('div', { class: 'pcp-kicker' }, 'Case ' + s.ci + ' · Step ' + (s.j + 1) + ' of ' + s.n), el('div', { class: 'pcp-qtext' }, sg.prompt),
          el('div', { class: 'pcp-box ccp-opts' }, opts.map((o, k) => el('div', { class: 'ccp-opt' + (open && o.correct ? ' ok' : '') }, el('b', null, LETTERS[k] + '. '), o.text))),
          !open ? el('div', { class: 'pcp-hidden' }, 'Choose the best answer — then press R (👁 Reveal).')
            : el('div', { class: 'pcp-cap pcp-ans' }, el('b', null, 'Answer: ' + (k0 >= 0 ? LETTERS[k0] + '. ' : '')), corr ? corr.text : '',
              corr && corr.feedback ? el('div', { class: 'pcp-expl' }, corr.feedback) : null,
              sg.reveal ? el('div', { class: 'pcp-expl md', html: renderMarkdown('**Next:** ' + sg.reveal) }) : null));
      } else {
        pcpPut(slide, el('div', { class: 'pcp-kicker' }, 'Case ' + s.ci + ' · Take-home points'), el('div', { class: 'pcp-dx' }, c.title),
          (c.summary || []).length ? el('div', { class: 'pcp-box' }, el('ul', null, c.summary.map(x => el('li', null, x)))) : null);
      }
      this.stage.classList.remove('pcp-stage-pic');
      clear(this.stage).appendChild(slide); this.stage.scrollTop = 0;
      pcpPut(clear(this.nav), el('button', { 'data-a': 'pcp-prev', disabled: this.i === 0, onclick: () => this.go(this.i - 1) }, '‹ Back'),
        el('span', { class: 'pcp-count' }, 'Slide ' + (this.i + 1) + ' of ' + this.slides.length + (this.touch() ? ' · swipe ← →' : ' · ← → · R · Esc')),
        el('button', { 'data-a': 'pcp-next', disabled: this.i === this.slides.length - 1, onclick: () => this.go(this.i + 1) }, 'Next ›'));
    }
  });
  window.CasePresent = CasePresent;
  // 3 · 🖨 Print PDF: every case with its steps, answers and take-home points
  function casesPrint() {
    const md = t => renderMarkdown(t || '');
    const body = CASES.map((c, k) => {
      let ex = null; try { ex = UE.extra(c, { noNotes: true }); } catch (e) { ex = null; }
      return '<section class="ccp-case"' + (k ? ' style="page-break-before:always"' : '') + '><h2>Case ' + (k + 1) + ' — ' + esc(c.title) + '</h2>' +
        (CASE_LEVELS[c.difficulty] ? '<p class="ccp-lvl">' + esc(CASE_LEVELS[c.difficulty]) + '</p>' : '') + '<div>' + md(c.presentation) + '</div>' + (ex ? ex.outerHTML : '') +
        (c.stages || []).map((sg, j) => {
          const corr = (sg.options || []).find(o => o.correct);
          return '<h3>Step ' + (j + 1) + ' — ' + esc(sg.prompt) + '</h3><ol type="A">' + (sg.options || []).map(o => '<li' + (o.correct ? ' class="ok"' : '') + '>' + esc(o.text) + (o.correct ? ' ✓' : '') + '</li>').join('') + '</ol>' +
            (corr && corr.feedback ? '<p><b>Answer:</b> ' + esc(corr.feedback) + '</p>' : '') + (sg.reveal ? '<div>' + md('**Next:** ' + sg.reveal) + '</div>' : '');
        }).join('') +
        ((c.summary || []).length ? '<div class="keypoints"><h4>Take-home points</h4><ul>' + c.summary.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') + '</section>';
    }).join('');
    printHTML('Clinical cases', COURSE.title, body, { css: '.ccp-case li.ok{font-weight:700}.ccp-lvl{color:#555;font-size:.85rem;margin:.1rem 0 .4rem}' });
  }
  window.casesPrint = casesPrint;
  // 4 · the two buttons on the clinical cases page
  const c0 = Views.cases.render;
  Views.cases.render = function () {
    const r = c0.apply(this, arguments);
    try {
      if (this.cur || !CASES.length) return r;
      const page = document.querySelector('#view-cases .page'); if (!page || page.querySelector('.ccp-acts')) return r;
      const row = el('div', { class: 'row ccp-acts', style: 'gap:.5rem;margin:.2rem 0 .9rem;flex-wrap:wrap' },
        el('button', { class: 'btn btn-primary', type: 'button', 'data-a': 'ccp-present', onclick: () => CasePresent.start() }, '▶ Present all cases'),
        el('button', { class: 'btn', type: 'button', 'data-a': 'ccp-print', title: 'Print the clinical cases or save them as a PDF', onclick: () => casesPrint() }, '🖨 Print PDF'));
      const first = page.firstElementChild; if (first && first.nextSibling) page.insertBefore(row, first.nextSibling); else page.appendChild(row);
    } catch (e) { }
    return r;
  };
})();

""" + HEAD_HUB),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
