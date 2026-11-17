"""▶ Present the viva in class (user, 2026-11-17: "a presentation mode for Viva so that the teacher can present the questions in
the class"). Teachers only: a ▶ Present button next to the start button of the Viva setup (the questions of the current
selection — topic, type, difficulty — in the chosen order) and on every 📌 Official viva (that paper's questions). Full-screen
slides in the light presentation style of ▶ Present all cases (patch prac-present): one question per slide (topic, level,
question in large text, its picture); R (👁 Reveal) shows the model answer and the marking points with their marks; then each
follow-up question on its own R and its answer on the next R (user, 2026-11-17: "first reveal a follow-up question without the
answer, then I can reveal the answer"); a question without follow-ups stops at the answer. ← → / swipe, a menu
to jump to any question, Esc closes, F full screen (computer). Nothing is recorded. Modules without the viva are untouched
(runtime check). Inserted just before the picture-remove block (shared anchors would break the other patches' idempotency
checks); wraps Views.viva.setupPanel and Views.viva.papersBox. Idempotent."""
import sys
HEAD_RM = '/* ---------- 🗑 Remove pictures (patch picture-remove): a picture-remove file → those imported pictures leave their sections ---------- */'
R = [
(HEAD_RM,
 r"""/* ---------- ▶ Present the viva in class (patch viva-present) ---------- */
(function () {
  if (!Views.viva || typeof PracPresent === 'undefined') return;
  const V = Views.viva;
  const VivaPresent = Object.assign({}, PracPresent, {
    slides: [], i: 0, shown: new Set(), lvl: {}, root: null, keyFn: null, label: '',
    cases() { return []; }, withQ() { return false; }, setWithQ() { },
    start(qs, label) {
      this.slides = (qs || []).map((q, k) => ({ t: 'q', q, n: k + 1 })); this.total = this.slides.length; this.label = label || 'Viva';
      if (!this.slides.length) { toast('No viva questions to present for this selection.', 'info'); return; }
      this.i = 0; this.lvl = {}; this.shown = new Set(); this.mount();
      if (this.root) { this.root.setAttribute('aria-label', 'Viva — presentation'); this.root.classList.add('vvp-root'); }
      if (!document.getElementById('vvp-style')) document.head.appendChild(el('style', { id: 'vvp-style' },
        '.vvp-root .pcp-slide{max-width:1100px;align-items:stretch;text-align:left}.vvp-root .pcp-qtext{text-align:left;max-width:none}' +
        '.vvp-root .vv-pic{margin:.2rem 0;text-align:center}.vvp-root .vv-pic img{max-height:min(46vh,520px);max-width:100%;object-fit:contain;border-radius:10px;background:#fff}' +
        '.vvp-model{white-space:pre-wrap;line-height:1.55}.vvp-root .vv-rub{width:100%;border-collapse:collapse;margin-top:.3rem}.vvp-root .vv-rub td{border-top:1px solid #e3e9f0;padding:.35rem .5rem;vertical-align:top}' +
        '.vvp-root .vv-rub td.m{width:3.2rem;font-weight:800;color:#0b7d78;text-align:center}.vvp-fq{margin:.45rem 0 .7rem}.vvp-fa{margin-top:.3rem;padding:.45rem .7rem;background:#f3faf9;border-left:4px solid #0e9f9a;border-radius:8px;white-space:pre-wrap}.vvp-fa-hidden{margin-top:.3rem;padding:.4rem .7rem;font-size:.92em}' +
        '.vvp-root .pcp-box h4:first-child{margin-top:0}.vvp-meta{display:flex;flex-wrap:wrap;gap:.4rem}.vvp-meta span{background:#fff;border:1px solid #dbe5ed;border-radius:999px;padding:.15rem .7rem;font-size:.85rem;color:#4a6377}'));
      this.paint();
    },
    // levels: 0 question · 1 model answer + marking points · then per follow-up k: its question (2 + 2k), its answer (3 + 2k)
    maxLvl(s) { return 1 + 2 * ((s && s.q.follow) || []).length; },
    reveal() { const s = this.slides[this.i]; if (!s) return; const l = this.lvl[this.i] || 0; this.lvl[this.i] = l >= this.maxLvl(s) ? 0 : l + 1; this.paint(); },
    paint() {
      const s = this.slides[this.i]; if (!s || !this.root) return; const q = s.q, l = this.lvl[this.i] || 0, mx = this.maxLvl(s);
      clear(this.top);
      const sel = el('select', { 'aria-label': 'Go to question', class: 'pcp-sel' }, this.slides.map((x, k) => el('option', { value: String(k), selected: k === this.i }, 'Question ' + (k + 1) + (topicNum(x.q.topic) ? ' · Topic ' + topicNum(x.q.topic) : ''))));
      sel.addEventListener('change', () => { this.go(Number(sel.value)); sel.blur(); });
      const nf = (q.follow || []).length, fNext = Math.floor((l - 1) / 2) + 1;
      const btnTxt = l === 0 ? '👁 Reveal (R)' : l >= mx ? '🙈 Hide (R)' : (l % 2 === 1 ? '↪ Follow-up ' + (nf > 1 ? fNext + ' ' : '') + '(R)' : '👁 Its answer (R)');
      pcpPut(this.top, el('span', { class: 'pcp-where' }, '🎓 ' + this.label + ' · ' + s.n + ' of ' + this.total), sel,
        el('button', { class: 'pcp-rev', 'data-a': 'vvp-reveal', onclick: () => this.reveal() }, btnTxt),
        this.touch() ? null : el('button', { onclick: () => this.fullscreen(), title: 'Full screen (F)' }, '⛶'),
        el('button', { 'data-a': 'pcp-close', onclick: () => this.close(), title: 'Close (Esc)' }, '✕ Close'));
      const slide = el('div', { class: 'pcp-slide' });
      pcpPut(slide, el('div', { class: 'vvp-meta' }, el('span', null, vivaTopicLabel(q.topic)), q.level && VIVA_LEVEL[q.level] ? el('span', null, VIVA_LEVEL[q.level][0]) : null,
          q.type && VIVA_TYPE[q.type] ? el('span', null, VIVA_TYPE[q.type]) : null, q.max ? el('span', null, vivaNum(q.max) + ' marks') : null),
        el('div', { class: 'pcp-qtext' }, s.n + '. ' + q.q), vivaPicture(q));
      if (l === 0) pcpPut(slide, el('div', { class: 'pcp-hidden' }, 'Students answer aloud — then press R (👁 Reveal) for the model answer and the marking points.'));
      if (l >= 1) {
        const box = el('div', { class: 'pcp-box', 'data-a': 'vvp-answer' }, el('h4', null, '✅ Model answer'), el('div', { class: 'vvp-model' }, q.model || ''));
        if ((q.points || []).length) pcpPut(box, el('h4', null, '📏 Marking points'), V.rubric(q, null, null, true));
        pcpPut(slide, box);
        if (l === 1 && nf) pcpPut(slide, el('div', { class: 'pcp-hidden' }, 'R again for the ' + (nf > 1 ? 'first of ' + nf + ' follow-up questions' : 'follow-up question') + '.'));
      }
      if (l >= 2) {   // follow-up questions one by one: the question first, its answer on the next R
        const shownQ = Math.floor((l - 2) / 2) + 1, box = el('div', { class: 'pcp-box', 'data-a': 'vvp-follow' }, el('h4', null, '↪ Follow-up questions'));
        q.follow.slice(0, shownQ).forEach((f, k) => {
          const ansOpen = l >= 3 + 2 * k;
          pcpPut(box, el('div', { class: 'vvp-fq', 'data-a': 'vvp-fq' }, el('b', null, (k + 1) + '. ' + f.q),
            ansOpen ? el('div', { class: 'vvp-fa', 'data-a': 'vvp-fa' }, f.a || '') : el('div', { class: 'pcp-hidden vvp-fa-hidden' }, 'Answer — then R for the answer.')));
        });
        pcpPut(slide, box);
      }
      this.stage.classList.remove('pcp-stage-pic');
      clear(this.stage).appendChild(slide); this.stage.scrollTop = 0;
      pcpPut(clear(this.nav), el('button', { 'data-a': 'pcp-prev', disabled: this.i === 0, onclick: () => this.go(this.i - 1) }, '‹ Back'),
        el('span', { class: 'pcp-count' }, 'Question ' + (this.i + 1) + ' of ' + this.slides.length + (this.touch() ? ' · swipe ← →' : ' · ← → · R · Esc')),
        el('button', { 'data-a': 'pcp-next', disabled: this.i === this.slides.length - 1, onclick: () => this.go(this.i + 1) }, 'Next ›'));
    }
  });
  window.VivaPresent = VivaPresent;
  const shuffled = a => { const b = a.slice(); for (let k = b.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [b[k], b[j]] = [b[j], b[k]]; } return b; };
  // ▶ Present next to the setup's start button (teachers): the current selection, in the chosen order
  const sp0 = V.setupPanel;
  if (sp0) V.setupPanel = function (panel) {
    const r = sp0.apply(this, arguments);
    try {
      if (!this.isTeacher()) return r;
      const row = (panel || document).querySelector('.vv-startrow'); if (!row || row.querySelector('[data-a=vvp-start]')) return r;
      const pool = this.pool(), S = this.setup || {}, ord = (this.mode === 'mock' ? S.morder : S.order) || 'ordered';
      row.style.gap = '.6rem'; row.style.flexWrap = 'wrap';
      row.insertBefore(el('button', { class: 'btn btn-lg', type: 'button', 'data-a': 'vvp-start', disabled: !pool.length, title: 'Show the selected questions full screen in class — nothing is recorded',
        onclick: () => VivaPresent.start(ord === 'shuffle' ? shuffled(this.pool()) : this.pool(), this.selLabel()) }, '▶ Present (' + plural(pool.length, 'question') + ')'), row.firstChild);
    } catch (e) { }
    return r;
  };
  // ▶ Present on every official viva (teachers): that paper's questions in its order
  const pb0 = V.papersBox;
  if (pb0) V.papersBox = function () {
    const box = pb0.apply(this, arguments);
    try {
      if (!box || !this.isTeacher()) return box;
      (this.papers || []).forEach(x => {
        const row = box.querySelector('[data-paper="' + x.id + '"]'); if (!row || row.querySelector('[data-a=vvp-paper]')) return;
        const qs = (x.qids || []).map(id => (this.items || []).find(q => q.id === id)).filter(Boolean);
        const b = el('button', { class: 'btn btn-xs', type: 'button', 'data-a': 'vvp-paper', disabled: !qs.length, title: 'Show this paper\'s questions full screen in class', onclick: () => VivaPresent.start(qs, x.title) }, '▶ Present');
        const tools = row.querySelector('.row'); if (tools) tools.insertBefore(b, tools.firstChild); else row.appendChild(b);
      });
    } catch (e) { }
    return box;
  };
})();

""" + HEAD_RM),
]
HEAD = R[0][1].split('\n', 1)[0]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if R[0][1] not in s and HEAD in s and s.count(HEAD_RM) == 1:   # an older copy of this block: replace it
        i = s.index(HEAD); j = s.index(HEAD_RM); assert i < j, path; s = s[:i] + s[j:]; n += 1
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
