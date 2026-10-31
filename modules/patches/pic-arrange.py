"""⇅ Arrange pictures (user 2026-10-31): put pictures in any order by drag & drop (mouse, pen and touch) or with
◀ / ▶ and a Position menu; the numbers update as you move them, and the order is saved — students see the same order.
  • Learn (Edit Mode): every Learning Block's edit bar gets "⇅ Arrange pictures" (a dialog with the block's pictures).
    – Your pictures (added / imported by the teacher) are re-ordered inside State.customMedia[section] — the same records,
      the same addresses, no copies (links and videos keep their places); saved with saveDoc('custommedia').
    – Library pictures (PEIR, Commons …) get the section field imageOrder (a list of atlas ids, saved with the topic's
      sections like hideImages); ATLAS.forSection follows it, so Learn, slides, print and the Spotter use the same order.
      Pictures not in the list (added later) follow in their usual order.
  • Practical editor: the pictures of each group (Gross / Microscopic / Additional) are numbered and can be dragged
    (⠿); the existing ↑ / ↓ buttons stay. The order is d.images (autosaved); students get it with the next publish.
Idempotent."""
import sys
CODE = r"""/* ---------- ⇅ Arrange pictures (patch pic-arrange, user 2026-10-31) ---------- */
function picArrangeCss() {
  if (document.getElementById('pa-css')) return;
  document.head.appendChild(el('style', { id: 'pa-css' },
    '.pa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem;margin:.4rem 0 1rem}' +
    '.pa-grid>.pa-card{position:relative;border:1px solid var(--line,#d5dde7);border-radius:10px;background:#fff;padding:.4rem;cursor:grab;user-select:none;-webkit-user-select:none;transition:box-shadow .12s,transform .12s,opacity .12s}' +
    '.pa-grid .pa-card img{width:100%;height:110px;object-fit:cover;border-radius:6px;background:#0f1c2b;display:block;pointer-events:none}' +
    '.pa-cap{font-size:.75rem;line-height:1.25;margin:.3rem 0;max-height:2.5em;overflow:hidden;color:var(--muted,#64748b)}' +
    '.pa-num{min-width:1.6rem;height:1.6rem;padding:0 .3rem;border-radius:999px;background:var(--navy,#0b2340);color:#fff;font-weight:700;font-size:.85rem;display:inline-flex;align-items:center;justify-content:center}' +
    '.pa-handle{width:1.9rem;height:1.9rem;border-radius:8px;background:rgba(255,255,255,.92);border:1px solid var(--line,#d5dde7);display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}' +
    '.pa-grid .pa-num{position:absolute;top:.25rem;left:.25rem;z-index:1}.pa-grid .pa-handle{position:absolute;top:.25rem;right:.25rem;z-index:1}' +
    '.pa-btns{display:flex;gap:.25rem;align-items:center}.pa-btns select{flex:1;min-width:0;font-size:.8rem;padding:.15rem}' +
    '.pa-dragging{opacity:.6;transform:scale(.98);box-shadow:0 0 0 3px var(--teal,#0e9f9a)!important;cursor:grabbing}' +
    '.pa-over{box-shadow:0 0 0 3px var(--navy,#0b2340)!important}.pa-active,.pa-active *{cursor:grabbing!important}' +
    '.pa-plist{display:flex;flex-direction:column;gap:.5rem}.pa-plist>.pa-card{transition:box-shadow .12s,transform .12s,opacity .12s}' +
    '.pa-side{display:flex;flex-direction:column;align-items:center;gap:.35rem;flex:0 0 auto}' +
    '.pa-hint{margin:.2rem 0 .5rem}'));
}
function picScrollParent(n) {
  for (let x = n.parentElement; x && x !== document.body && x !== document.documentElement; x = x.parentElement) {
    const st = getComputedStyle(x); if (/(auto|scroll)/.test(st.overflowY) && x.scrollHeight > x.clientHeight) return x;
  }
  return window;
}
/** Drag & drop for the .pa-card children of box (pointer events: mouse, pen and touch). A mouse drags the whole card;
 *  touch drags by the ⠿ handle (so the page still scrolls). Cards move live; onDrop(keys) gets the new order. */
function picSortable(box, onDrop) {
  picArrangeCss();
  let drag = null;
  const cards = () => [...box.children].filter(n => n.classList && n.classList.contains('pa-card'));
  const renumber = () => cards().forEach((n, i) => { const b = n.querySelector('.pa-num'); if (b) b.textContent = String(i + 1); });
  box.addEventListener('pointerdown', e => {
    const card = e.target.closest('.pa-card'); if (!card || card.parentNode !== box || e.button > 0) return;
    const onHandle = !!e.target.closest('.pa-handle');
    if (!onHandle && (e.pointerType !== 'mouse' || e.target.closest('button, select, input, textarea, a, label'))) return;
    drag = { card, x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
    if (onHandle) e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
      drag.on = true; drag.card.classList.add('pa-dragging'); box.classList.add('pa-active');
      try { box.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    }
    e.preventDefault();
    // near the top / bottom edge: scroll (the window, or the dialog body) so a picture can be dragged anywhere
    const edge = 70, sc = drag.sc || (drag.sc = picScrollParent(box)), r = sc === window ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    if (e.clientY < r.top + edge) sc.scrollBy(0, -18); else if (e.clientY > r.bottom - edge) sc.scrollBy(0, 18);
    box.querySelectorAll('.pa-over').forEach(n => n.classList.remove('pa-over'));
    const over = document.elementFromPoint(e.clientX, e.clientY); const tgt = over && over.closest('.pa-card');
    if (!tgt || tgt === drag.card || tgt.parentNode !== box) return;
    tgt.classList.add('pa-over');
    const all = cards(); const a = all.indexOf(drag.card), b = all.indexOf(tgt);
    box.insertBefore(drag.card, a < b ? tgt.nextSibling : tgt);
    renumber();
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    box.classList.remove('pa-active'); box.querySelectorAll('.pa-over').forEach(n => n.classList.remove('pa-over'));
    if (!d.on) return;
    d.card.classList.remove('pa-dragging');
    box.addEventListener('click', x => { x.stopPropagation(); x.preventDefault(); }, { capture: true, once: true });   // no click after a drag
    setTimeout(() => onDrop(cards().map(n => n.dataset.key)), 0);
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
/** Learn → Edit Mode → ⇅ Arrange pictures: the Learning Block's pictures in the order students see them. */
async function arrangeSectionPictures(t, s) {
  if (!(await Auth.ensure())) return;
  picArrangeCss();
  const own = sectionMedia(s.id).filter(m => m && m.type === 'image' && m.url);
  let lib = []; try { lib = typeof ATLAS !== 'undefined' ? ATLAS.forSection(s.id) : []; } catch (e) { lib = []; }
  if (own.length < 2 && lib.length < 2) { toast('This Learning Block has fewer than two pictures in a group — nothing to arrange.', 'info'); return; }
  const keyOf = m => m.id || m.url;
  const order = { own: own.map(keyOf), lib: lib.map(x => x.id) };
  const start = JSON.stringify(order);
  const byOwn = new Map(own.map(m => [keyOf(m), m])), byLib = new Map(lib.map(x => [x.id, x]));
  const body = el('div');
  const group = (k, title, note) => {
    const list = order[k]; if (!list.length) return;
    const grid = el('div', { class: 'pa-grid', 'data-group': k });
    const paint = () => {
      clear(grid);
      list.forEach((key, i) => {
        const im = el('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: false });
        let cap = '';
        if (k === 'own') { const m = byOwn.get(key); stImg(im, m.url); cap = m.caption || 'Picture'; }
        else { const x = byLib.get(key); im.src = x.thumb || x.src; cap = x.dx || x.title || x.caption || x.id; }
        const move = to => { if (to < 0 || to >= list.length || to === i) return; list.splice(to, 0, list.splice(i, 1)[0]); paint(); };
        const pos = el('select', { 'aria-label': 'Position of picture ' + (i + 1), onchange: e => move(+e.target.value) }, list.map((_, j) => el('option', { value: j, selected: j === i }, 'Position ' + (j + 1))));
        grid.appendChild(el('div', { class: 'pa-card', dataset: { key } },
          el('span', { class: 'pa-num' }, String(i + 1)), el('span', { class: 'pa-handle', title: 'Drag to move', 'aria-hidden': 'true' }, '⠿'),
          im, el('div', { class: 'pa-cap', title: cap }, cap),
          el('div', { class: 'pa-btns' },
            el('button', { type: 'button', class: 'btn btn-xs', title: 'Move earlier', 'aria-label': 'Move picture ' + (i + 1) + ' earlier', disabled: i === 0, onclick: () => move(i - 1) }, '◀'),
            pos,
            el('button', { type: 'button', class: 'btn btn-xs', title: 'Move later', 'aria-label': 'Move picture ' + (i + 1) + ' later', disabled: i === list.length - 1, onclick: () => move(i + 1) }, '▶'))));
      });
    };
    picSortable(grid, keys => { list.splice(0, list.length, ...keys); paint(); });
    paint();
    body.appendChild(el('h4', { style: 'margin:.4rem 0 0' }, title + ' (' + list.length + ')'));
    if (note) body.appendChild(el('p', { class: 'small muted', style: 'margin:.1rem 0 0' }, note));
    body.appendChild(grid);
  };
  body.appendChild(el('p', { class: 'small pa-hint' }, 'Drag a picture to its new place (on a phone or tablet drag it by ⠿), or use ◀ / ▶ or the Position menu. Students see the pictures in this order.'));
  group('own', '🖼️ Your pictures', lib.length ? 'Shown first, under “Images”.' : '');
  group('lib', '🔬 Library pictures', own.length ? 'Shown after your pictures, under “Real specimens”. The two groups are arranged separately.' : '');
  const ok = await new Promise(resolve => openModal({ title: '⇅ Arrange pictures — ' + (s.heading || ''), wide: true, body, onClose: r => resolve(!!r),
    actions: [{ label: 'Cancel', value: false }, { label: '💾 Save order', primary: true, value: true }] }));
  if (!ok || JSON.stringify(order) === start) return;
  try {
    if (JSON.stringify(order.own) !== JSON.stringify(own.map(keyOf))) {
      const items = deepClone(sectionMedia(s.id));
      const slots = []; items.forEach((m, i) => { if (m && m.type === 'image' && m.url) slots.push(i); });
      const by = new Map(slots.map(i => [keyOf(items[i]), items[i]]));
      if (order.own.length === slots.length && order.own.every(k => by.has(k))) {
        order.own.forEach((k, j) => { items[slots[j]] = by.get(k); });
        await saveDoc('custommedia', s.id, { items }, { label: 'Before arranging pictures' });
      }
    }
    if (JSON.stringify(order.lib) !== JSON.stringify(lib.map(x => x.id))) await emMutateSection(t, s, y => { y.imageOrder = order.lib.slice(); }, 'arrange pictures');
    toast('Picture order saved.', 'ok');
    refreshAllContentViews();
  } catch (e) { toast('The order could not be saved: ' + e.message, 'bad', 6000); }
}
/* library pictures follow the Learning Block's imageOrder (pictures not in it keep their usual order, after it) */
(function () {
  if (typeof ATLAS === 'undefined' || !ATLAS.forSection || ATLAS.forSection.paOrdered) return;
  const f0 = ATLAS.forSection;
  ATLAS.forSection = function (sid) {
    const r = f0.apply(this, arguments);
    let ord = null; try { const f = findSection(sid); ord = f && f.section && f.section.imageOrder; } catch (e) { ord = null; }
    if (!Array.isArray(ord) || !ord.length || r.length < 2) return r;
    const pos = id => { const i = ord.indexOf(id); return i < 0 ? 1e6 : i; };
    return r.map((x, k) => [x, k]).sort((a, b) => (pos(a[0].id) - pos(b[0].id)) || (a[1] - b[1])).map(a => a[0]);
  };
  ATLAS.forSection.paOrdered = true;
})();

/* ---------- 2 · Practical: Image atlas tab (#/practical/atlas, #/practical/atlas/<id>) ---------- */"""
R = [
("""/* ---------- 2 · Practical: Image atlas tab (#/practical/atlas, #/practical/atlas/<id>) ---------- */""", CODE),
("""      el('button', { class: 'btn btn-sm', onclick: () => addMedia(s.id, 'video') }, '+ Add Video'),
""",
 """      el('button', { class: 'btn btn-sm', onclick: () => addMedia(s.id, 'video') }, '+ Add Video'),
      el('button', { class: 'btn btn-sm', 'data-a': 'pic-arrange', title: 'Change the order of the pictures in this Learning Block', onclick: () => arrangeSectionPictures(t, s) }, '⇅ Arrange pictures'),
"""),
("""      imgs.forEach(im => group.appendChild(this.imageCard(im)));""",
 """      // numbered, drag & drop inside the group (patch pic-arrange); the ↑ / ↓ buttons stay
      const plist = el('div', { class: 'pa-plist' });
      imgs.forEach((im, k) => {
        const c = this.imageCard(im); c.classList.add('pa-card'); c.dataset.key = im.id || String(k);
        c.insertBefore(el('div', { class: 'pa-side' }, el('span', { class: 'pa-num', title: 'Position in this group' }, String(k + 1)),
          imgs.length > 1 ? el('span', { class: 'pa-handle', title: 'Drag to move', 'aria-hidden': 'true' }, '⠿') : null), c.firstChild);
        plist.appendChild(c);
      });
      group.appendChild(plist);
      if (imgs.length > 1) {
        picSortable(plist, keys => {
          const slots = []; d.images.forEach((x, i) => { if (x.slot === slot) slots.push(i); });
          const by = new Map(imgs.map((x, k) => [x.id || String(k), x]));
          if (keys.length !== slots.length || !keys.every(k => by.has(k))) { this.paintImages(); return; }
          keys.forEach((k, j) => { d.images[slots[j]] = by.get(k); });
          this.changed(); this.paintImages();
        });
        group.insertBefore(el('div', { class: 'small muted pa-hint' }, 'Drag ⠿ to change the order (or ↑ / ↓). Students see this order after you publish.'), plist);
      }"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
