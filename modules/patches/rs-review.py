"""📊 Results → Most-missed questions → 🎞️ Review in class (user, 2026-10-30): goes through the questions the students were
tested on, full screen for the projector, hardest first (the card's order and topic filter). Each question is shown first
WITHOUT its answer (stem, case, options) so the class can answer aloud; Reveal (Space) shows the class's answer bars, the
correct answer and the explanation. ◀ ▶ / arrow keys move, A− / A+ change the text size, Esc or ✕ closes. No student names.
Teacher-only (it lives in the teacher's Results). Needs rs-sticky-leave (CSS anchor). Idempotent."""
import sys
R = [
("""body.learn-fs .rs-sticky{display:none!important}
""",
 """.rsr{position:fixed;inset:0;z-index:9500;background:var(--bg);display:flex;flex-direction:column;--rsr-fs:1.35rem}
.rsr-bar{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.6rem 1rem;background:var(--navy);color:#fff}
.rsr-bar .btn{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.25)}
.rsr-bar .rsr-pos{font-weight:700;margin-right:auto}
.rsr-main{flex:1;overflow:auto;padding:1.4rem clamp(1rem,5vw,4rem);font-size:var(--rsr-fs);line-height:1.5;color:var(--ink)}
.rsr-meta{font-size:.7em;color:var(--muted);margin-bottom:.4rem}
.rsr-stem{font-weight:700;margin:.4rem 0 .9rem}
.rsr-case{background:var(--info-soft);border-left:4px solid var(--info);padding:.6rem .9rem;border-radius:8px;margin-bottom:.6rem}
.rsr-opt{display:grid;grid-template-columns:2.2em 1fr auto;gap:.6rem;align-items:center;padding:.45rem .7rem;margin:.35rem 0;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.rsr-opt .l{font-weight:800;color:var(--navy-2)}
.rsr-opt .n{font-size:.75em;color:var(--muted);white-space:nowrap}
.rsr-opt .bar{grid-column:2/4;height:.55em;background:var(--line-2);border-radius:99px;overflow:hidden}
.rsr-opt .bar span{display:block;height:100%;background:var(--faint)}
.rsr-opt.ok{border-color:var(--ok);background:var(--ok-soft)}
.rsr-opt.ok .bar span{background:var(--ok)}
.rsr-key{margin-top:.9rem;padding:.7rem .9rem;border-radius:10px;background:var(--ok-soft);border:1px solid var(--ok)}
.rsr-exp{margin-top:.6rem;font-size:.85em}
.rsr-pct{font-size:.8em;margin-top:.6rem}
@media print{.rsr{display:none}}
body.learn-fs .rs-sticky{display:none!important}
"""),
("""      el('span', { class: 'small muted' }, need.length + ' of ' + rows.length + ' questions below 100% correct')));""",
 """      el('div', { class: 'row', style: 'gap:.6rem;align-items:center' }, el('span', { class: 'small muted' }, need.length + ' of ' + rows.length + ' questions below 100% correct'),
        rows.length ? el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'rs-review', title: 'Go through these questions with the class, full screen, hardest first', onclick: () => this.reviewInClass(rows) }, '🎞️ Review in class') : null)));"""),
("""  showQuestion(s) {""",
 """  /** 🎞️ Review in class (patch rs-review): the tested questions full screen, answer hidden until Reveal. */
  reviewInClass(rows) {
    if (!rows || !rows.length) return;
    document.querySelectorAll('.rsr').forEach(n => n.remove());
    let i = 0, shown = false, fs = (() => { try { return parseFloat(localStorage.getItem('rsr_fs')) || 1.35; } catch (e) { return 1.35; } })();
    const main = el('div', { class: 'rsr-main', 'aria-live': 'polite' });
    const pos = el('span', { class: 'rsr-pos' });
    const prev = el('button', { class: 'btn btn-sm', 'aria-label': 'Previous question', onclick: () => go(i - 1) }, '◀');
    const next = el('button', { class: 'btn btn-sm', 'aria-label': 'Next question', onclick: () => go(i + 1) }, '▶');
    const rev = el('button', { class: 'btn btn-sm', 'data-a': 'rsr-reveal', onclick: () => { shown = !shown; paint(); } });
    const size = d => { fs = Math.min(2.4, Math.max(.9, Math.round((fs + d) * 100) / 100)); root.style.setProperty('--rsr-fs', fs + 'rem'); try { localStorage.setItem('rsr_fs', String(fs)); } catch (e) { /* private mode */ } };
    const root = el('div', { class: 'rsr', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review in class' },
      el('div', { class: 'rsr-bar' }, pos, prev, rev, next,
        el('button', { class: 'btn btn-sm', 'aria-label': 'Smaller text', onclick: () => size(-.15) }, 'A−'),
        el('button', { class: 'btn btn-sm', 'aria-label': 'Larger text', onclick: () => size(.15) }, 'A+'),
        el('button', { class: 'btn btn-sm', 'data-a': 'rsr-close', 'aria-label': 'Close the review', onclick: () => close() }, '✕')), main);
    root.style.setProperty('--rsr-fs', fs + 'rem');
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shown = !shown; paint(); }
    };
    const go = (k) => { if (k < 0 || k >= rows.length) return; i = k; shown = false; paint(); main.scrollTop = 0; };
    const paint = () => {
      const s = rows[i], q = s.q; clear(main);
      pos.textContent = 'Question ' + (i + 1) + ' of ' + rows.length; prev.disabled = i === 0; next.disabled = i === rows.length - 1;
      rev.textContent = shown ? '🙈 Hide answer' : '👁 Reveal answer';
      main.appendChild(el('div', { class: 'rsr-meta' }, (TYPE_LABELS[q.type] || q.type) + (topicNum(s.topic) ? ' · Topic ' + topicNum(s.topic) + ' — ' + topicTitle(s.topic) : '')));
      if (q.case) main.appendChild(el('div', { class: 'rsr-case' }, el('b', null, '🩺 Case: '), q.case));
      main.appendChild(el('div', { class: 'rsr-stem' }, q.stem));
      const opt = (label, txt, n, ok) => el('div', { class: 'rsr-opt' + (shown && ok ? ' ok' : '') }, el('span', { class: 'l' }, label), el('span', null, txt),
        shown ? el('span', { class: 'n' }, (ok ? '✓ ' : '') + n + ' (' + pct(n, s.n) + '%)') : el('span'),
        shown ? el('div', { class: 'bar' }, el('span', { style: { width: Math.max(1, pct(n, s.n)) + '%' } })) : null);
      if (['mcq', 'vignette', 'selectall'].includes(q.type)) {
        const key = q.type === 'selectall' ? (q.answers || []) : [q.answer];
        (q.options || []).forEach((o, k) => main.appendChild(opt(LETTERS[k], o, s.resp.filter(x => q.type === 'selectall' ? Array.isArray(x.r) && x.r.includes(k) : x.r === k).length, key.includes(k))));
      } else if (q.type === 'tf') {
        main.appendChild(opt('T', 'True', s.resp.filter(x => x.r === true).length, q.answer === true));
        main.appendChild(opt('F', 'False', s.resp.filter(x => x.r === false).length, q.answer === false));
      } else if (shown) {
        main.appendChild(opt('✓', 'Fully correct', s.c, true)); main.appendChild(opt('½', 'Partly correct', s.partial || 0, false));
        main.appendChild(opt('✗', 'Incorrect', s.n - s.c - (s.partial || 0) - s.blank, false));
      }
      if (!shown) return;
      main.appendChild(el('div', { class: 'rsr-pct' }, el('b', null, s.p + '% correct'), ' · ' + plural(s.n, 'response') + (s.blank ? ' · ' + s.blank + ' not answered' : '')));
      main.appendChild(el('div', { class: 'rsr-key' }, el('b', null, 'Correct answer: '), correctAnswerText(q)));
      if (q.explanation) main.appendChild(el('div', { class: 'rsr-exp' }, el('b', null, 'Explanation: '), q.explanation));
    };
    document.body.appendChild(root); document.addEventListener('keydown', onKey, true);
    paint(); rev.focus();
  },
  showQuestion(s) {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
