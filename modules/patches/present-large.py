"""🔠 Larger text in the Practical and Viva presentations (user, 2026-11-18: "Do the same for Practical and Viva presentations",
after patch cases-present-large enlarged the Clinical Cases presentation). CSS only, scoped to the practical presenter
(`.pcp-root[aria-label^="Practical"]`, patch prac-present) and the viva presenter (`.pcp-root.vvp-root`, patch viva-present):
clinical history, questions, answers, captions, model answers, marking points and follow-ups ≈ 40 % larger, boxes wider;
pictures keep their space (the caption under a picture grows less). Inserted just before the cases-present-large block (shared
anchors would break the other patches' idempotency checks). Idempotent."""
import sys
HEAD_CPL = '/* ---------- 🔠 Larger text in the clinical-cases presentation (patch cases-present-large) ---------- */'
R = [
(HEAD_CPL,
 r"""/* ---------- 🔠 Larger text in the Practical and Viva presentations (patch present-large) ---------- */
(function () {
  if (document.getElementById('pcpl-style')) return;
  const P = '.pcp-root[aria-label^="Practical"] ', V = '.pcp-root.vvp-root ', st = document.createElement('style'); st.id = 'pcpl-style';
  st.textContent = [
    P + '.pcp-slide{width:min(1400px,100%)}', P + '.pcp-kicker{font-size:1.05rem}',
    P + '.pcp-case{font-size:clamp(2.6rem,7vw,4.8rem)}', P + '.pcp-meta{font-size:clamp(1.2rem,2.6vw,1.65rem)}',
    P + '.pcp-clin{max-width:1250px;font-size:clamp(1.3rem,2.8vw,1.9rem);line-height:1.5}',
    P + '.pcp-qtext{max-width:1250px;font-size:clamp(1.5rem,3.6vw,2.5rem)}',
    P + '.pcp-box{max-width:1250px;font-size:clamp(1.3rem,2.8vw,1.85rem);line-height:1.5}', P + '.pcp-box li{margin:.35rem 0}',
    P + '.pcp-cap{max-width:1250px;font-size:clamp(1.25rem,2.6vw,1.75rem)}', P + '.pcp-ans{font-size:clamp(1.3rem,2.8vw,1.8rem)}',
    P + '.pcp-picslide .pcp-cap,' + P + '.pcp-picslide .pcp-hidden{font-size:clamp(1.1rem,2.1vw,1.45rem)}',
    P + '.pcp-dx{font-size:clamp(2rem,5.5vw,3.4rem)}', P + '.pcp-label{font-size:1.1rem}',
    P + '.pcp-hidden{font-size:clamp(1.05rem,2vw,1.35rem)}', P + '.pcp-hint{font-size:1rem}', P + '.pcp-expl{font-size:.92em}',
    V + '.pcp-slide{max-width:1400px}', V + '.pcp-qtext{font-size:clamp(1.5rem,3.6vw,2.5rem)}',
    V + '.pcp-box{max-width:none;font-size:clamp(1.25rem,2.6vw,1.75rem);line-height:1.5}', V + '.pcp-box h4{font-size:.9em}',
    V + '.vv-rub td{padding:.45rem .6rem}', V + '.vv-rub td.m{width:4rem}',
    V + '.vvp-meta span{font-size:1.05rem}', V + '.pcp-hidden{font-size:clamp(1.05rem,2vw,1.35rem)}',
    V + '.vv-pic img{max-height:min(42vh,520px)}'
  ].join('\n');
  document.head.appendChild(st);
})();

""" + HEAD_CPL),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
