"""Pathology Spotter, OSPE exam, Image atlas and Image Bank for the Administrator only (user, 2026-11-16 — v2 adds the atlas and
the Image Bank: "hide image atlas and image bank from students and teachers, keep only for admin"; v1: "hide the spotter and OSPE sections in all
active modules. Just keep the clinical cases … it is available only for admin"). Students and teacher accounts no longer see
them: not in the Practical menu, the Practical page, the teacher tabs, the practical guide or the atlas, and their addresses
(#/study/challenge, #/practical/ospe) lead back to Practical cases. The Admin is recognised by Portal.gs teacherWho (admin: true)
or an ✏️ Edit master draft session. Nothing is deleted: the questions, stations and results stay. Wraps uxList,
uxRenderAreaBar, pracTabs, pracGuideCard, Views.apply / study / practical. Inserted just before the prac-student-tidy block (a shared anchor would break that patch's idempotency check). Idempotent."""
import sys
R = [
("""/* ---------- Practical: student-facing tidy + serial numbers (patch prac-student-tidy) ---------- */""",
 """/* ---------- Pathology Spotter, OSPE, Image atlas and Image Bank for the Administrator only (patch prac-admin-only v2) ---------- */
const PRAC_ADMIN = { known: false, admin: false, wait: null };
function pracIsAdmin() {
  const B = window.NEO_BOOT || {}; if (B.role !== 'teacher') return false;
  try { if (sessionStorage.getItem('pf_draft:' + (B.module || '')) === '1') return true; } catch (e) { }
  if (!PRAC_ADMIN.known && !PRAC_ADMIN.wait) {
    if (typeof Backend === 'undefined' || !Backend.isConfigured || !Backend.isConfigured()) { PRAC_ADMIN.known = true; return false; }
    PRAC_ADMIN.wait = Backend.authedPost({ action: 'teacherWho' }, { timeout: 20000 }).then(r => { PRAC_ADMIN.admin = !!(r && r.ok && r.admin); }).catch(() => { })
      .then(() => {
        PRAC_ADMIN.known = true;
        if (typeof Router !== 'undefined' && Router.current) { const V = Views[Router.current]; try { if (V && V.render) V.render(); } catch (e) { } try { uxSetNavActive(Router.current, Router.params || []); } catch (e) { } }
      });
  }
  return PRAC_ADMIN.admin;
}
/** A teacher whose Admin status is not known yet: wait for it (the page re-renders when the answer comes) instead of leaving. */
function pracAdminPending() { const B = window.NEO_BOOT || {}; pracIsAdmin(); return B.role === 'teacher' && !PRAC_ADMIN.known && !PRAC_ADMIN.admin; }
(function () {
  const HIDE_HREF = ['#/study/challenge', '#/practical/ospe', '#/practical/atlas', '#/practical/bank'];
  const HIDE_PAGE = ['ospe', 'atlas', 'bank', 'item', 'test'];   // #/practical/<…>: OSPE, Image atlas, Image Bank (+ its item and test pages)
  const sweep = root => { if (pracIsAdmin() || !root) return;
    root.querySelectorAll('a[href="#/study/challenge"], a[href="#/practical/ospe"], a[href="#/practical/atlas"], a[href="#/practical/bank"], a[href^="#/practical/atlas/"], [data-a=ospe-tab], [data-a=prac-guide-spotter]').forEach(n => (n.closest('li') && n.closest('.ux-list') ? n.closest('li') : n).remove());
    root.querySelectorAll('button.tab, button.btn').forEach(b => { if (/^\\s*(🖼 Image Bank|🔬 Image atlas|▦ Image atlas)\\s*$/.test(b.textContent)) b.remove(); }); };
  if (typeof uxList === 'function') {
    const list0 = uxList;
    uxList = function (rows) { return list0(pracIsAdmin() ? rows : (rows || []).filter(r => !(r && HIDE_HREF.includes(r.href)))); };
  }
  if (typeof uxRenderAreaBar === 'function' && typeof UX_AREAS !== 'undefined') {
    const bar0 = uxRenderAreaBar, A = UX_AREAS.find(a => a.id === 'apply'), all = A ? A.items.slice() : [];
    uxRenderAreaBar = function () {
      if (A) A.items = pracIsAdmin() ? all.slice() : all.filter(it => !((it[2] === 'study' && it[3][0] === 'challenge') || (it[2] === 'practical' && HIDE_PAGE.includes(it[3][0]))));
      return bar0.apply(this, arguments);
    };
  }
  if (typeof uxBuildNav === 'function' && typeof UX_AREAS !== 'undefined') {
    const nav0 = uxBuildNav, A = UX_AREAS.find(a => a.id === 'apply'), h = A ? A.hint : '';
    uxBuildNav = function () { if (A) A.hint = pracIsAdmin() ? h : 'Practical cases'; return nav0.apply(this, arguments); };
  }
  if (typeof pracTabs === 'function') { const t0 = pracTabs; pracTabs = function () { const n = t0.apply(this, arguments); sweep(n); return n; }; }
  if (typeof pracGuideCard === 'function') { const g0 = pracGuideCard; pracGuideCard = function () { const n = g0.apply(this, arguments); sweep(n); return n; }; }
  const away = () => { location.hash = '#/practical'; };
  if (Views.study) {
    const s0 = Views.study.render;
    Views.study.render = function () {
      if (this.tab === 'challenge' && !pracIsAdmin()) { if (pracAdminPending()) return; return away(); }
      if (this.tab === 'spot' && !pracIsAdmin()) { if (pracAdminPending()) return; return away(); }
      const r = s0.apply(this, arguments); if (!pracIsAdmin()) document.querySelectorAll('#view-study .st-challenge').forEach(n => n.remove()); return r;
    };
  }
  if (Views.practical) {
    const sh0 = Views.practical.show;
    if (sh0) Views.practical.show = function (params) {   // the atlas and the Image Bank pages open through show(), not render()
      const q = params || [];
      if (HIDE_PAGE.includes(q[0]) && !pracIsAdmin()) { this.params = q; if (pracAdminPending()) return; return away(); }
      return sh0.apply(this, arguments);
    };
    const p0 = Views.practical.render;
    Views.practical.render = function () {
      if (HIDE_PAGE.includes((this.params || [])[0]) && !pracIsAdmin()) { if (pracAdminPending()) return; return away(); }
      const r = p0.apply(this, arguments); sweep(document.getElementById('view-practical')); return r;
    };
  }
  if (Views.apply) {
    const a0 = Views.apply.render;
    Views.apply.render = function () {
      const r = a0.apply(this, arguments); const v = document.getElementById('view-apply');
      if (v && !pracIsAdmin()) {
        sweep(v);
        v.querySelectorAll('p, .ux-sub, .muted').forEach(n => { if (n.children.length === 0 && /Pathology Spotter|OSPE exam/.test(n.textContent)) n.textContent = n.textContent.replace(/the practical cases, the Pathology Spotter and the OSPE exam/, 'the practical cases'); });
        v.querySelectorAll('h2.ux-h2').forEach(h => { const nx = h.nextElementSibling; if (nx && nx.classList.contains('ux-list') && !nx.querySelector('li')) { nx.remove(); h.remove(); } });
        let k = 0; v.querySelectorAll('h2.ux-h2').forEach(h => { const m = /^\\d+\\s*·\\s*/.exec(h.textContent); if (m) h.textContent = (++k) + ' · ' + h.textContent.slice(m[0].length); });
      }
      return r;
    };
  }
})();

/* ---------- Practical: student-facing tidy + serial numbers (patch prac-student-tidy) ---------- */"""),
]
OLD_HEADS = ['/* ---------- Pathology Spotter and OSPE for the Administrator only (patch prac-admin-only) ---------- */']
TIDY = '/* ---------- Practical: student-facing tidy + serial numbers (patch prac-student-tidy) ---------- */'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for h in OLD_HEADS:   # upgrade an older copy of this block
        if h in s and s.count(TIDY) == 1:
            i = s.index(h); j = s.index(TIDY); assert i < j, path; s = s[:i] + s[j:]; n += 1
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
