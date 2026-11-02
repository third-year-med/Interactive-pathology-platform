"""🎬 Video Lectures: no "Open on <host> ↗" link under the player (user 2026-11-02). The Drive videos are shared "Anyone
with the link"; the link under the player gave students that sharing link in one click. Students watch only inside the
platform. ⬇ Download stays (only when the teacher allowed it); the Drive hint no longer mentions sharing settings.
Videos of kind 'link' (pages that cannot be embedded) still open in a new tab, and the teacher's ▶ Preview in the
Add / Edit form is unchanged. Needs video-library. Idempotent."""
import sys
R = [
("""  const links = el('div', { class: 'row small mt1', style: 'gap:.8rem;flex-wrap:wrap' },
    el('a', { href: p.open, target: '_blank', rel: 'noopener' }, 'Open on ' + p.host + ' ↗'),
    v.download && p.download ? el('a', { href: p.download, target: '_blank', rel: 'noopener' }, '⬇ Download') : null,
    p.kind === 'drive' ? el('span', { class: 'muted' }, 'If the video does not play, it may still be processing on Google Drive, or it is not shared “Anyone with the link”.') : null);""",
 """  const links = el('div', { class: 'row small mt1', style: 'gap:.8rem;flex-wrap:wrap' },   // no "Open on …" link: students watch inside the platform (patch video-no-open-link)
    v.download && p.download ? el('a', { href: p.download, target: '_blank', rel: 'noopener' }, '⬇ Download') : null,
    p.kind === 'drive' ? el('span', { class: 'muted' }, 'If the video does not play, it may still be processing — please try again in a few minutes.') : null);"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
