"""⚡ Topic quizzes: "Questions from" — 🔒 bank + practice MIXED (default; user, 2026-10-30: "mix it between the assessment
bank and the practice questions … students get some of the practice questions as well"), 🔒 bank first (the 2026-10-22
behaviour: a topic with ≥ 5 bank questions takes only the bank) or practice only. The choice is remembered per module copy
(Store `tq_source_v1`); existing quizzes change only with "Refresh the existing topic quizzes" (republish). Mixed = one pool of
the topic's bank + practice questions; each student still gets 5 random questions from it. Needs assess-bank. Idempotent."""
import sys
R = [
("""      const bank = ABANK.forTopic(t.id), pool = bank.length >= TQ.n ? bank : prac;   // 🔒 the assessment bank first (≥ 5 questions), else practice
""",
 """      const bank = ABANK.forTopic(t.id), how = tqSource();
      // ⚡ tq-mix: mixed = bank + practice in one pool; bank first = the bank when it has ≥ 5, else practice; practice = practice only
      const pool = how === 'practice' ? prac : how === 'bank' ? (bank.length >= TQ.n ? bank : prac) : Array.from(new Set(bank.concat(prac)));
"""),
("""      return { t, num: i + 1, pool, ex, ok: pool.length >= TQ.n, src: pool === bank ? 'bank' : 'practice', change:""",
 """      return { t, num: i + 1, pool, ex, ok: pool.length >= TQ.n, src: pool === bank ? 'bank' : pool === prac || !bank.length ? 'practice' : 'mix', nb: pool.filter(id => bank.includes(id)).length, np: pool.filter(id => prac.includes(id)).length, change:"""),
("""function tqDescription(TQ, x) { return TQ.n + ' random questions from the ' + x.pool.length + (x.src === 'bank' ? ' 🔒 assessment-bank questions of this topic (never shown in Practice)' : ' practice questions of this topic') + ' · ' + TQ.min + ' minutes.'; }""",
 """function tqDescription(TQ, x) { return TQ.n + ' random questions from the ' + x.pool.length + (x.src === 'bank' ? ' 🔒 assessment-bank questions of this topic (never shown in Practice)' : x.src === 'mix' ? ' questions of this topic (' + x.nb + ' 🔒 assessment-bank + ' + x.np + ' practice)' : ' practice questions of this topic') + ' · ' + TQ.min + ' minutes.'; }
/** ⚡ Topic quizzes source (patch tq-mix): 'mix' (default) | 'bank' (bank first) | 'practice'. */
function tqSource() { const v = Store.get('tq_source_v1', 'mix'); return v === 'bank' || v === 'practice' ? v : 'mix'; }"""),
("""String(x.pool.length) + (x.src === 'bank' ? ' 🔒' : '')),""",
 """String(x.pool.length) + (x.src === 'bank' ? ' 🔒' : x.src === 'mix' ? ' (' + x.nb + ' 🔒 + ' + x.np + ')' : '')),"""),
("""' — Refresh gives it these ' + (x.src === 'bank' ? '🔒 bank' : '') + ' questions'""",
 """' — Refresh gives it these ' + (x.src === 'bank' ? '🔒 bank' : x.src === 'mix' ? 'mixed' : '') + ' questions'"""),
("""    const body = el('div', { class: 'tq' },
      el('p', { style: 'margin-top:0' }, 'One quiz per topic, built from that topic’s 🔒 assessment-bank questions when it has at least ' + TQ.n + ' (never shown in Practice; ' + ABANK.items.length + ' in the bank), otherwise from its practice questions: each student gets ',""",
 """    const how = tqSource();
    const srcSel = el('select', { 'data-a': 'tq-source', onchange: (e) => { Store.set('tq_source_v1', e.target.value); const m = e.target.closest('.modal'); const x = m && m.querySelector('.modal-head .icon-btn'); if (x) x.click(); this.topicQuizzesDialog(); } },
      [['mix', '🔒 Assessment bank + practice questions (mixed)'], ['bank', '🔒 Assessment bank first (only the bank when a topic has ≥ ' + TQ.n + ')'], ['practice', 'Practice questions only']].map(([v, l]) => el('option', { value: v, selected: v === how }, l)));
    const body = el('div', { class: 'tq' },
      el('label', { class: 'f', style: 'display:block;margin:0 0 .6rem' }, el('b', null, 'Questions from: '), srcSel),
      el('p', { style: 'margin-top:0' }, how === 'mix' ? 'One quiz per topic, built from ALL that topic’s questions — its 🔒 assessment-bank questions (never shown in Practice; ' + ABANK.items.length + ' in the bank) together with its practice questions: each student gets '
        : how === 'practice' ? 'One quiz per topic, built from its practice questions: each student gets '
        : 'One quiz per topic, built from that topic’s 🔒 assessment-bank questions when it has at least ' + TQ.n + ' (never shown in Practice; ' + ABANK.items.length + ' in the bank), otherwise from its practice questions: each student gets ',"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
