"""🔠 Larger text in ▶ Present all cases of the Clinical Cases tab (user, 2026-11-18: "Please enlarge the writing in presentation
mode in clinical cases"). CSS only, scoped to the clinical-cases presenter (`.pcp-root[aria-label^="Clinical cases"]`, set by patch
cases-tab), so the practical presenter and the viva presenter are unchanged: the case presentation, step question, answer options,
answer + explanation and the take-home points are about 40 % larger and the boxes wider. Inserted just before the viva-present
block (shared anchors would break the other patches' idempotency checks). Idempotent."""
import sys
HEAD_VP = '/* ---------- ▶ Present the viva in class (patch viva-present) ---------- */'
R = [
(HEAD_VP,
 r"""/* ---------- 🔠 Larger text in the clinical-cases presentation (patch cases-present-large) ---------- */
(function () {
  if (document.getElementById('ccpl-style')) return;
  const C = '.pcp-root[aria-label^="Clinical cases"] ', st = document.createElement('style'); st.id = 'ccpl-style';
  st.textContent = [
    C + '.pcp-slide{width:min(1400px,100%)}',
    C + '.pcp-kicker{font-size:1.05rem}',
    C + '.pcp-case{font-size:clamp(2.6rem,7vw,4.8rem)}',
    C + '.pcp-clin{max-width:1250px;font-size:clamp(1.3rem,2.8vw,1.9rem);line-height:1.5}',
    C + '.pcp-qtext{max-width:1250px;font-size:clamp(1.5rem,3.6vw,2.5rem)}',
    C + '.pcp-box{max-width:1250px;font-size:clamp(1.3rem,2.8vw,1.85rem);line-height:1.5}',
    C + '.pcp-box li{margin:.35rem 0}',
    C + '.ccp-opt{padding:.5rem .8rem}',
    C + '.pcp-cap{max-width:1250px;font-size:clamp(1.25rem,2.6vw,1.75rem)}',
    C + '.pcp-expl{font-size:.92em}',
    C + '.pcp-dx{font-size:clamp(2rem,5.5vw,3.4rem)}',
    C + '.pcp-hidden{font-size:clamp(1.05rem,2vw,1.35rem)}',
    C + '.pcp-hint{font-size:1rem}'
  ].join('\n');
  document.head.appendChild(st);
})();

""" + HEAD_VP),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
