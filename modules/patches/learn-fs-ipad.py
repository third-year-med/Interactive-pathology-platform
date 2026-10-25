"""⛶ Full-screen reading on iPad (user, 2026-10-25): on a new iPad (Safari, iPadOS 18) full-screen reading kept ending — on
some scroll swipes and after opening a link — and the page jumped back to the top; an older iPad, whose browser never
entered the system full screen, was stable. Cause: learn-fs also asks for the browser's system full screen, Safari on iPad
leaves it by itself, and learn-fs then ended the reading mode (header and menus back → the page jumps).
Now: on touch devices (iPad, iPhone, Android tablets) only the reading mode is used — no system full screen, exactly what
the stable iPad did; if the system full screen ends by itself on a touch device the reading mode stays on; and switching the
reading mode on or off keeps the reader's place (the paragraph at the top of the screen stays at the top). Desktop
browsers keep the system full screen as before (Esc there still ends both). Edits lines of learn-fs (which carries a
done-marker for it). Idempotent."""
import sys
R = [
("""  on: false, native: false,
  zoom() {""", """  on: false, native: false,
  /** iPad / iPhone / touch tablets: reading mode only — Safari on iPad leaves the system full screen by itself (swipes, links). */
  touch() {
    const ua = navigator.userAgent || '', tp = navigator.maxTouchPoints || 0;
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && tp > 1)) return true;
    try { return tp > 0 && matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  },
  /** Runs fn (which changes the layout) and keeps the paragraph that was at the top of the screen at the same place. */
  keepPlace(fn) {
    let a = null, top = 0;
    try {
      const x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight * 0.4);   // below any sticky header
      let n = document.elementFromPoint(x, y);
      while (n && n !== document.body && !(n.matches && n.matches('#view-explain .ex-main > *, #view-explain .ex-main .card, #view-explain .ex-main section, #view-explain .ex-main p, #view-explain .ex-main h2, #view-explain .ex-main h3, #view-explain .ex-main li'))) n = n.parentElement;
      if (n && n !== document.body && n.closest('#view-explain')) { a = n; top = n.getBoundingClientRect().top; }
    } catch (e) { a = null; }
    fn();
    if (a && a.isConnected) { const d = a.getBoundingClientRect().top - top; if (Math.abs(d) > 1) window.scrollTo({ top: window.scrollY + d, behavior: 'instant' }); }
  },
  zoom() {"""),
("""    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.on && this.native) this.exit(); this.native = !!document.fullscreenElement; });""",
 """    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.on && this.native && !this.touch()) this.exit(); this.native = !!document.fullscreenElement; });   // a touch device: the reading mode stays when the system full screen ends by itself"""),
("""  enter() {
    this.css(); this.wire(); this.on = true;
    document.body.classList.add('learn-fs'); document.documentElement.classList.add('lfs-root');""",
 """  enter() {
    this.css(); this.wire(); this.on = true;
    this.keepPlace(() => { document.body.classList.add('learn-fs'); document.documentElement.classList.add('lfs-root'); });"""),
("""    try { if (d.requestFullscreen && !document.fullscreenElement) d.requestFullscreen().catch(() => { }); } catch (e) { }""",
 """    try { if (d.requestFullscreen && !document.fullscreenElement && !this.touch()) d.requestFullscreen().catch(() => { }); } catch (e) { }"""),
("""    this.on = false;
    document.body.classList.remove('learn-fs'); document.documentElement.classList.remove('lfs-root');
    const b = document.getElementById('lfs-bar'); if (b) b.remove();""",
 """    this.on = false;
    const b = document.getElementById('lfs-bar'); if (b) b.remove();
    this.keepPlace(() => { document.body.classList.remove('learn-fs'); document.documentElement.classList.remove('lfs-root'); });"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
