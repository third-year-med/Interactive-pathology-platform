"""🎬 Video Lectures: shield over Google Drive's pop-out button (user 2026-11-02). Google draws a pop-out ↗ button in the
top-right corner of its embedded player (a frame from another site, which the page cannot change); it opened the video on
Google Drive. An invisible shield now covers that corner, so a click there does nothing. Drive's own full-screen button is
switched off (in Google's full screen the shield would not be there) and the platform's "⛶ Full screen" puts the player
AND the shield on the whole screen (native full screen; where a browser cannot, e.g. iPhone, a full-window view with
✕). Only Google Drive videos; YouTube / Vimeo / files unchanged. This stops the one-click way out — not a determined
user (the file id is in the page). Needs video-library + video-no-open-link. Idempotent."""
import sys
R = [
("""function vlWatch(v) {""",
 """/* Google Drive: shield over the pop-out button + our own full screen (patch video-drive-shield) */
function vlDriveCss() {
  if (document.getElementById('vl-shield-css')) return;
  document.head.appendChild(el('style', { id: 'vl-shield-css' },
    '.vl-shield{position:absolute;top:0;right:0;width:96px;height:80px;z-index:3;background:transparent;cursor:default}' +
    '.vl-player:fullscreen{aspect-ratio:auto;border-radius:0;width:100vw;height:100vh}.vl-player:-webkit-full-screen{aspect-ratio:auto;border-radius:0;width:100vw;height:100vh}' +
    '.vl-player.vl-max{position:fixed!important;inset:0;z-index:10050;width:100vw;height:100vh;aspect-ratio:auto;border-radius:0}' +
    '.vl-exit{display:none;position:absolute;left:.6rem;top:.6rem;z-index:4}.vl-player.vl-max .vl-exit,.vl-player:fullscreen .vl-exit{display:inline-flex}' +
    '.vl-fsbar{display:flex;justify-content:flex-end;margin:0 0 .4rem}'));
}
function vlFullscreen(box) {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (fs === box || box.classList.contains('vl-max')) {
    box.classList.remove('vl-max');
    if (fs) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ } }
    return;
  }
  const rq = box.requestFullscreen || box.webkitRequestFullscreen;
  if (rq) { try { const r = rq.call(box); if (r && r.catch) r.catch(() => box.classList.add('vl-max')); return; } catch (e) { /* fall back */ } }
  box.classList.add('vl-max');
}
function vlWatch(v) {"""),
("""  else box.appendChild(el('iframe', { src: p.embed, title: v.title || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin' }));""",
 """  else if (p.kind === 'drive') {   // the shield covers Drive's pop-out button; Drive's own full screen is off (patch video-drive-shield)
    vlDriveCss();
    box.appendChild(el('iframe', { src: p.embed, title: v.title || 'Video', allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin' }));
    box.appendChild(el('div', { class: 'vl-shield', 'aria-hidden': 'true' }));
    box.appendChild(el('button', { type: 'button', class: 'btn btn-sm vl-exit', onclick: () => vlFullscreen(box) }, '✕ Exit full screen'));
    box._fsBar = el('div', { class: 'vl-fsbar' }, el('button', { type: 'button', class: 'btn btn-sm', 'data-a': 'vl-fs', onclick: () => vlFullscreen(box) }, '⛶ Full screen'));
  }
  else box.appendChild(el('iframe', { src: p.embed, title: v.title || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin' }));"""),
("""  openModal({ title: '🎬 ' + (v.title || 'Video'), wide: true, body: el('div', null, box, v.description""",
 """  openModal({ title: '🎬 ' + (v.title || 'Video'), wide: true, onClose: () => { box.classList.remove('vl-max'); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ } }, body: el('div', null, box._fsBar || null, box, v.description"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
