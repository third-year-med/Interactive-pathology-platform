"""Up to 4 pictures in a Pathology Spotter question and in an OSPE station (user 2026-10-31).
  • Spotter: a question keeps its main picture (key / atlas + section, as before) and may have up to 3 more in `more`
    ([{key, section} | {atlas, section}], the same references). Spotter.pictures(it) = main + more that still exist.
    The question shows the main picture large with small pictures below (click = show it large; the large one opens all
    of them in the viewer); the review shows them too. ✏️ Edit Spotter question: tick 1–4 pictures, numbered — the
    first is the main one. Old questions and old files (one picture) are unchanged; a file may list `more`.
  • OSPE: a station may have 1–4 pictures (before 1–2): editor, exam (2 × 2 grid) and review show all of them.
Idempotent."""
import sys
MP = r"""/* ---------- 🖼 More than one picture per Spotter question (patch spotter-ospe-multipic) ---------- */
Spotter.pictures = function (it) {
  const main = it && this.picture(it); if (!main) return [];
  return [main].concat((it.more || []).map(r => r && this.picture(Object.assign({ section: it.section }, r))).filter(Boolean)).slice(0, 4);
};
(function () {
  const css = () => { if (document.getElementById('spmp-css')) return; document.head.appendChild(el('style', { id: 'spmp-css' },
    '.spot-strip{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.45rem}.spot-strip button{padding:0;border:2px solid transparent;border-radius:7px;background:#0f1c2b;cursor:pointer;width:72px;height:56px;overflow:hidden}' +
    '.spot-strip button.on{border-color:var(--teal,#0e9f9a)}.spot-strip img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.spe-pic{position:relative}.spe-n{position:absolute;top:.2rem;left:.2rem;min-width:1.3rem;height:1.3rem;border-radius:999px;background:var(--teal,#0e9f9a);color:#fff;font-weight:700;font-size:.72rem;display:flex;align-items:center;justify-content:center}')); };
  const views = (pics) => pics.map(p => ({ src: resolveImgUrl(p.url) }));
  const q0 = Spotter.question;
  Spotter.question = function (host) {
    const r = q0.apply(this, arguments);
    try {
      const R = this.run, it = R && this.byId(R.ids[R.i]), pics = it ? this.pictures(it) : [];
      const img0 = host.querySelector('.spot-card .spot-pic img.spot-img');
      if (img0 && pics.length > 1) {
        css(); let cur = 0;
        const img = img0.cloneNode(true); img0.replaceWith(img);   // the clone drops the one-picture viewer
        img.addEventListener('click', () => openLightbox(views(pics), cur));
        const strip = el('div', { class: 'spot-strip', role: 'group', 'aria-label': 'Pictures of this question' });
        const paint = () => [...strip.children].forEach((b, k) => b.classList.toggle('on', k === cur));
        pics.forEach((p, k) => { const t = el('img', { alt: '' }); stImg(t, p.url);
          strip.appendChild(el('button', { type: 'button', 'aria-label': 'Picture ' + (k + 1) + ' of ' + pics.length, onclick: () => { cur = k; stImg(img, p.url); paint(); } }, t)); });
        paint(); img.after(strip);
      }
    } catch (e) { console.warn('spotter pictures', e); }
    return r;
  };
  const r0 = Spotter.results;
  Spotter.results = function (host) {
    const r = r0.apply(this, arguments);
    try {
      const R = this.run; if (!R) return r;
      host.querySelectorAll('.spot-rev img.spot-thumb').forEach(img0 => {
        const m = /question (\d+)$/.exec(img0.alt || ''), it = m && this.byId(R.ids[Number(m[1]) - 1]), pics = it ? this.pictures(it) : [];
        if (pics.length < 2) return;
        css(); const img = img0.cloneNode(true); img0.replaceWith(img);
        img.addEventListener('click', () => openLightbox(views(pics), 0));
        const strip = el('div', { class: 'spot-strip' }); pics.slice(1).forEach((p, k) => { const t = el('img', { alt: '' }); stImg(t, p.url);
          strip.appendChild(el('button', { type: 'button', 'aria-label': 'Picture ' + (k + 2), onclick: () => openLightbox(views(pics), k + 1) }, t)); });
        img.after(strip);
      });
    } catch (e) { console.warn('spotter pictures', e); }
    return r;
  };
})();

const SpotterEdit = {"""
R = [
("""const SpotterEdit = {""", MP),
("""    const pool = this.pool(); let pick = pool.find(p => this.same(p.ref, q)) || null;""",
 """    const pool = this.pool(); let pick = pool.find(p => this.same(p.ref, q)) || null;
    let more = (q.more || []).map(r => pool.find(p => this.same(p.ref, r))).filter(p => p && p !== pick);   // up to 3 more (patch spotter-ospe-multipic)"""),
("""      picBox.appendChild(el('button', { type: 'button', class: 'spe-pic' + (pick === p ? ' sel' : ''), title: p.heading + ' — ' + p.caption, onclick: () => { pick = p; paintPics(); } }, im, el('span', null, seTrunc(p.caption || p.heading, 60)))); }); };""",
 """      const chosen = [pick].concat(more).filter(Boolean), n = chosen.indexOf(p) + 1;
      picBox.appendChild(el('button', { type: 'button', class: 'spe-pic' + (n ? ' sel' : ''), title: p.heading + ' — ' + p.caption, onclick: () => {
        if (n) { const rest = chosen.filter(x => x !== p); pick = rest[0] || null; more = rest.slice(1); }
        else if (chosen.length < 4) { if (!pick) pick = p; else more = more.concat([p]); }
        else { toast('Up to 4 pictures per question — untick one first.', 'warn'); return; }
        paintPics(); } }, n ? el('span', { class: 'spe-n', 'aria-label': 'Picture ' + n }, String(n)) : null, im, el('span', null, seTrunc(p.caption || p.heading, 60)))); }); };"""),
("""el('div', null, el('b', null, 'Picture'), el('span', { class: 'small muted' }, ' — only pictures of Learn → ' + (Spotter.topic() ? Spotter.topic().title : 'Practical') + ' (' + pool.length + ')'), picBox),""",
 """el('div', null, el('b', null, 'Pictures (1–4)'), el('span', { class: 'small muted' }, ' — tick up to 4; picture 1 is the main one · only pictures of Learn → ' + (Spotter.topic() ? Spotter.topic().title : 'Practical') + ' (' + pool.length + ')'), picBox),"""),
("""      if (pick.ref.key) out.key = pick.ref.key; else out.atlas = pick.ref.atlas;""",
 """      if (pick.ref.key) out.key = pick.ref.key; else out.atlas = pick.ref.atlas;
      if (more.length) out.more = more.slice(0, 3).map(p => Object.assign({ section: p.section }, p.ref));   // patch spotter-ospe-multipic"""),
# OSPE: 1–4 pictures
("""onclick: () => { picked = on ? picked.filter(x => x !== p) : picked.concat([p]).slice(-2); paintPics(); } }""",
 """onclick: () => { if (!on && picked.length >= 4) { toast('Up to 4 pictures per station — untick one first.', 'warn'); return; } picked = on ? picked.filter(x => x !== p) : picked.concat([p]); paintPics(); } }"""),
("""'Pictures (1–2)'""", """'Pictures (1–4)'"""),
("""    const gallery = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 2).map((p, k) => {""",
 """    const gallery = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 4).map((p, k) => {"""),
("""      const thumbs = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 2).map(p => { const im = el('img', { class: 'ospe-thumb', alt: '' }); stImg(im, p.url); im.addEventListener('click', () => openLightbox([{ src: resolveImgUrl(p.url) }], 0)); return im; }));""",
 """      const thumbs = el('div', { class: 'ospe-pics n' + Math.min(2, this.pics(st).length) }, this.pics(st).slice(0, 4).map((p, k) => { const im = el('img', { class: 'ospe-thumb', alt: '' }); stImg(im, p.url); im.addEventListener('click', () => openLightbox(this.pics(st).map(x => ({ src: resolveImgUrl(x.url) })), k)); return im; }));"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
