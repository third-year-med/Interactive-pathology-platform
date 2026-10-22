"""⛶ Full-screen reading in Learn (user, 2026-10-22): a "⛶ Full screen" button on every topic page (beside 🖨 Print). The topic
then fills the screen — no header, menus, topic list or footer; one centred reading column; A− / A+ text size (remembered
on this device); ◀ ▶ topic buttons keep it on; Esc or "✕ Exit full screen" leaves; leaving Learn ends it. Uses the browser's
full-screen mode where it can (not on iPhone — there the page still fills the window). Idempotent."""
import sys
R = [
("""        el('button', { class: 'btn btn-sm', onclick: () => this.printTopic(t) }, '🖨 Print'),""",
"""        el('button', { class: 'btn btn-sm', onclick: () => this.printTopic(t) }, '🖨 Print'),
        el('button', { class: 'btn btn-sm lfs-btn', 'data-a': 'learn-fs', title: 'Read this topic full screen (Esc to leave)', onclick: () => LearnFS.toggle() }, LearnFS.on ? '✕ Exit full screen' : '⛶ Full screen'),"""),
("""Views.explain = {""",
r"""/** ⛶ Full-screen reading (2026-10-22): body.learn-fs hides everything but the topic; a small bar gives A− / A+ / ✕. */
const LearnFS = {
  on: false, native: false,
  zoom() { const z = Number(Store.get('learn_fs_zoom', 1.1)); return z >= 0.9 && z <= 1.6 ? Math.round(z * 10) / 10 : 1.1; },
  setZoom(d) { Store.set('learn_fs_zoom', Math.min(1.6, Math.max(0.9, Math.round((this.zoom() + d) * 10) / 10))); this.paint(); },
  css() {
    if (document.getElementById('lfs-css')) return;
    document.head.appendChild(el('style', { id: 'lfs-css' },
      'body.learn-fs #app-header,body.learn-fs #area-bar,body.learn-fs .footer,body.learn-fs .ex-sidebar,body.learn-fs .ue-toggle,body.learn-fs .pf-home,body.learn-fs .pf-bar{display:none!important}' +
      'body.learn-fs{background:var(--bg,#f6f8fb)}body.learn-fs #app-main{padding-top:0}' +
      'body.learn-fs .ex-layout{display:block!important;grid-template-columns:none!important}' +
      'html.lfs-root{font-size:calc(var(--lfs-z,1.1) * 100%)}body.learn-fs .ex-main{max-width:min(100%,60rem);margin:0 auto;padding:3.6rem 1.2rem 3rem;font-size:calc(var(--lfs-z,1.1) * 1em)}' +
      '.lfs-bar{position:fixed;top:10px;right:12px;z-index:450;display:flex;gap:5px;align-items:center;background:rgba(255,255,255,.94);border:1px solid var(--border,#d5dde7);border-radius:999px;padding:4px;box-shadow:0 4px 14px rgba(9,24,40,.14);font-size:14px}' +
      '.lfs-bar button{font:inherit;font-size:14px;font-weight:600;border:0;background:transparent;color:var(--navy,#0b2340);padding:6px 11px;border-radius:999px;cursor:pointer}' +
      '.lfs-bar button:hover{background:rgba(14,159,154,.12)}.lfs-bar .lfs-x{background:var(--navy,#0b2340);color:#fff}.lfs-bar .lfs-x:hover{background:#163a63}' +
      '.lfs-bar .lfs-z{min-width:3.2em;text-align:center;font-size:12px;color:var(--muted,#64748b)}' +
      '@media print{.lfs-bar{display:none!important}}'));
  },
  paint() {
    document.documentElement.style.setProperty('--lfs-z', String(this.zoom()));
    const z = document.querySelector('#lfs-bar .lfs-z'); if (z) z.textContent = Math.round(this.zoom() * 100) + '%';
    document.querySelectorAll('[data-a="learn-fs"]').forEach(b => { b.textContent = this.on ? '✕ Exit full screen' : '⛶ Full screen'; });
  },
  wire() {
    if (this.wired) return; this.wired = true;
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.on && this.native) this.exit(); this.native = !!document.fullscreenElement; });
    window.addEventListener('hashchange', () => setTimeout(() => { if (this.on && Router.current !== 'explain') this.exit(); }, 0));
    document.addEventListener('keydown', (e) => { if (this.on && e.key === 'Escape' && !document.querySelector('.modal-back, .lightbox')) this.exit(); });
  },
  enter() {
    this.css(); this.wire(); this.on = true;
    document.body.classList.add('learn-fs'); document.documentElement.classList.add('lfs-root');
    if (!document.getElementById('lfs-bar')) document.body.appendChild(el('div', { id: 'lfs-bar', class: 'lfs-bar', role: 'toolbar', 'aria-label': 'Full-screen reading' },
      el('button', { type: 'button', title: 'Smaller text', 'aria-label': 'Smaller text', onclick: () => this.setZoom(-0.1) }, 'A−'),
      el('span', { class: 'lfs-z' }, ''),
      el('button', { type: 'button', title: 'Larger text', 'aria-label': 'Larger text', onclick: () => this.setZoom(0.1) }, 'A+'),
      el('button', { type: 'button', class: 'lfs-x', title: 'Leave full screen (Esc)', onclick: () => this.exit() }, '✕ Exit full screen')));
    this.paint();
    const d = document.documentElement;
    try { if (d.requestFullscreen && !document.fullscreenElement) d.requestFullscreen().catch(() => { }); } catch (e) { }
  },
  exit() {
    this.on = false;
    document.body.classList.remove('learn-fs'); document.documentElement.classList.remove('lfs-root');
    const b = document.getElementById('lfs-bar'); if (b) b.remove();
    this.paint();
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); } catch (e) { }
  },
  toggle() { if (this.on) this.exit(); else this.enter(); }
};
Views.explain = {"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
