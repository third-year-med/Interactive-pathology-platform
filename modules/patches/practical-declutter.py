"""Practical page without repeated links (user, 2026-10-29): on the Practical pages a student no longer sees
(1) the "‹ Back to Module — Topic …" return bar (it stays on the Review pages), (2) the Practicals · Image atlas ·
OSPE exam tab row (the same places are in the Practical sub-menu; teachers keep the row for Handbook and Settings),
(3) the button row under "🧭 How to use the practical" (Read the topic in Learn · Pathology Spotter · Topic quiz ·
Image Bank). The guide in Learn keeps its "🔬 Open the Practicals" button. Wraps the functions; idempotent."""
import sys
A = """  };
})();


/* ==========================================================================
   20_universal_edit.js"""
B = """  };
})();

/* ---------- Practical page without repeated links (patch practical-declutter) ---------- */
(function () {
  const inPractical = () => { try { return typeof uxAreaOf === 'function' && uxAreaOf(Router.current, Router.params) === 'apply'; } catch (e) { return false; } };
  const bar0 = uxrBar;
  uxrBar = function () {
    const r = bar0.apply(this, arguments);
    const bar = document.getElementById('ux-return'); if (bar && inPractical()) bar.classList.add('hidden');
    return r;
  };
  const tabs0 = pracTabs;
  pracTabs = function (active) {
    const n = tabs0.apply(this, arguments);
    if (!Auth.isTeacher()) n.style.display = 'none';   // the Practical sub-menu has the same places
    return n;
  };
  if (typeof pracGuideCard === 'function') {
    const g0 = pracGuideCard;
    pracGuideCard = function (where) {
      const d = g0.apply(this, arguments);
      if (where !== 'learn') { const row = d.querySelector(':scope > .row'); if (row) row.remove(); }
      return d;
    };
  }
})();


/* ==========================================================================
   20_universal_edit.js"""
DONE = '(patch practical-declutter)'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if DONE not in s:
        assert s.count(A) == 1, (path, 'anchor'); s = s.replace(A, B); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
