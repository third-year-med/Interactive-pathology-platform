"""🏅 The module tells the platform its topics (user 2026-11-10; Portal.gs 2.44). The Annual Assessment's presentation
topics came only from the group's topic-quiz titles, so a topic without a topic quiz (Inflammation (New) Topics 17–18) was
missing. When a TEACHER opens the module (main page or a group page), it sends the topic list once per session — display
number + title, as the module shows them (getTopics) — with annTopicsReport. Students send nothing. Idempotent."""
import sys
CODE = r"""/* ---------- 🏅 topic list for the Annual Assessment presentations (patch ann-topics-report; Portal.gs 2.44) ---------- */
(function () {
  let tries = 0;
  const go = async () => {
    try {
      if (!(window.NEO_BOOT && NEO_BOOT.role === 'teacher' && typeof getTopics === 'function' && typeof Backend !== 'undefined' && Backend.isConfigured())) { if (++tries < 60) setTimeout(go, 3000); return; }
      const topics = getTopics().map((t, i) => ({ n: i + 1, topic: String(t.title || '').trim() })).filter(t => t.topic);
      if (!topics.length) { if (++tries < 60) setTimeout(go, 3000); return; }
      const key = 'ann_topics_sent_v1:' + ((window.NEO_CONFIG && NEO_CONFIG.storagePrefix) || '') + location.search, sig = JSON.stringify(topics);
      if (sessionStorage.getItem(key) === sig) return;
      const r = await Backend.authedPost({ action: 'annTopicsReport', topics }, { timeout: 30000 });
      if (r && r.ok) sessionStorage.setItem(key, sig);
    } catch (e) { console.warn('topic list for the annual assessment', e); }
  };
  setTimeout(go, 4000);
})();
function openInQuestionBank(qid) {"""
R = [("""function openInQuestionBank(qid) {""", CODE)]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
