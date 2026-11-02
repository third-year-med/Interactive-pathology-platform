"""🎬 Video Lectures in categories (folders) (user 2026-11-02; Portal.gs 2.39). Each module has its own categories (free names,
not tied to topics: "Revision sessions", "Integrated cases" …) with a name, description, icon and order. The tab opens on the
folder cards (icon, name, description, number of videos; empty folders hidden for students; a search across all folders);
a folder opens its videos (‹ All categories back button; own address #/videos/<category> so the browser / iPad back works).
A video is stored once; in each module it is ticked for it sits in one folder (video.cats {module: categoryId}); a video
without one is in "Other lectures". Teachers: + New category, ✎ Edit, 🗑 Delete (the videos are kept — they go to "Other
lectures"), drag ⠿ to order folders and the videos inside a folder; the video form's Category menu moves a video;
📁 Make folders from chapter names converts the old "Chapter / subject" labels once. Needs video-library, video-own-module.
Idempotent."""
import sys
CODE = r"""/* ---------- 🎬 Video Lectures: categories / folders (patch video-categories) ---------- */
const VL_ICONS = ['📁', '🔬', '🫀', '🧫', '🔥', '🧬', '🩸', '🫁', '🧠', '🦴', '🩺', '📝', '🎓', '💬', '⭐', '🎥'];
const VL_OTHER = '_other';
/** The folder of a video in this module ('' = Other lectures, also when its folder was deleted). */
function vlCatOf(v) { const id = v && v.cats && v.cats[vlHere()]; return id && (Views.videos.cats || []).some(c => c.id === id) ? id : ''; }
/** The cats map to save: this module's folder set (or cleared), the other modules' folders kept. */
function vlCatsFor(d, catId) { const m = Object.assign({}, (d && d.cats) || {}); if (catId) m[vlHere()] = catId; else delete m[vlHere()]; return m; }
function vlCatSelect(d, isNew) {
  const cur = isNew ? (Views.videos.cat && Views.videos.cat !== VL_OTHER ? Views.videos.cat : '') : vlCatOf(d);
  return el('select', { 'aria-label': 'Category' }, el('option', { value: '', selected: !cur }, '📂 Other lectures (no category)'),
    (Views.videos.cats || []).map(c => el('option', { value: c.id, selected: c.id === cur }, (c.icon || '📁') + ' ' + c.name)));
}
(function () {
  const V = Views.videos; if (!V) return;
  const r0 = V.render;   // the flat list (teachers' "All modules" view; students when there are no folders)
  V.cats = null; V.cat = null;
  V.show = function (params) { this.cat = (params || [])[0] || null; this.render(); if (!this.items && !this.loading) this.load(); };
  V.load = async function () {
    this.loading = true; this.err = ''; this.render();
    const r = Backend.isConfigured() ? await Backend.rawPost({ action: 'videoList' }, { timeout: 30000 }) : { ok: false, code: 'config' };
    this.loading = false;
    if (r && r.ok) { this.items = r.items || []; this.cats = r.cats || []; this.canEdit = !!r.canEdit; }
    else this.err = !r || r.code === 'config' ? 'The video library is on the class server — it is not available in this offline copy.'
      : /unknown action/i.test(r.error || '') || r.code === 'outdated' ? 'The class server needs updating (Portal.gs 2.39) before the video library can open — tell your teacher.' : (r.error || 'The video library could not be loaded.');
    this.render();
  };
  const mineOf = (V2) => (V2.items || []).filter(x => (x.modules || []).includes(vlHere()));
  V.render = function () {
    const ed = this.editable();
    if (this.loading || this.err || !this.items || (ed && this.f.mod === '') || (!ed && !(this.cats || []).length)) return r0.apply(this, arguments);
    const v = document.getElementById('view-videos'); if (!v) return; clear(v); this.css(); this.catCss();
    const page = el('div', { class: 'page ux-page' }); v.appendChild(page);
    page.appendChild(uxPageHead('videos', 'Video Lectures', 'Recorded lectures of the pathology course — watch them in any order, alone or alongside Learn.'));
    if (this.cat) this.folderPage(page); else this.homePage(page);
  };
  V.catCss = function () {
    if (document.getElementById('vlc-css')) return;
    document.head.appendChild(el('style', { id: 'vlc-css' },
      '.vlc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.9rem}@media(max-width:560px){.vlc-grid{grid-template-columns:1fr}}' +
      '.vlc-card{position:relative;display:flex;gap:.8rem;align-items:flex-start;padding:1rem;border:1px solid var(--line,#d5dde7);border-radius:14px;background:#fff;cursor:pointer;transition:box-shadow .12s,border-color .12s;min-height:96px}' +
      '.vlc-card:hover,.vlc-card:focus-visible{border-color:var(--teal,#0e9f9a);box-shadow:0 4px 14px rgba(11,35,64,.08);outline:none}' +
      '.vlc-ico{flex:0 0 auto;width:3.2rem;height:3.2rem;border-radius:12px;background:#eef3f9;display:flex;align-items:center;justify-content:center;font-size:1.7rem}' +
      '.vlc-txt{min-width:0;flex:1;display:flex;flex-direction:column;gap:.2rem}.vlc-txt b{color:var(--navy,#0b2340);font-size:1.02rem;line-height:1.25}' +
      '.vlc-desc{font-size:.84rem;color:var(--muted,#64748b);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.vlc-n{font-size:.8rem;font-weight:700;color:var(--teal,#0e9f9a)}.vlc-other .vlc-ico{background:#f1f5f9}' +
      '.vlc-acts{display:flex;gap:.3rem;margin-top:.35rem;flex-wrap:wrap}.vlc-card .pa-handle{position:absolute;top:.4rem;right:.4rem}.vlc-card.pa-card .vlc-txt{padding-right:1.9rem}' +
      '.vlc-head{display:flex;gap:.8rem;align-items:center;margin:.2rem 0 .3rem}.vlc-head .vlc-ico{width:2.8rem;height:2.8rem;font-size:1.5rem}.vlc-head h2{margin:0;font-size:1.3rem;color:var(--navy,#0b2340)}' +
      '.vlc-back{margin:.2rem 0 .6rem}.vlc-icons{display:flex;flex-wrap:wrap;gap:.3rem}.vlc-icons button{font-size:1.35rem;width:2.6rem;height:2.6rem;border-radius:10px;border:1px solid var(--line,#d5dde7);background:#fff;cursor:pointer}' +
      '.vlc-icons button.on{border-color:var(--teal,#0e9f9a);box-shadow:0 0 0 2px var(--teal,#0e9f9a)}'));
  };
  /** Folder cards (+ a search across all folders). */
  V.homePage = function (page) {
    const ed = this.editable(), f = this.f, mine = mineOf(this), cats = this.cats || [];
    const n = id => mine.filter(x => vlCatOf(x) === id).length, other = n('');
    const search = el('input', { type: 'search', placeholder: 'Search all lectures…', 'aria-label': 'Search lectures', value: f.q || '' });
    const res = el('div');
    const paintRes = () => { clear(res); const q = normText(f.q || ''); if (!q) { res.hidden = true; folders.hidden = false; return; }
      res.hidden = false; folders.hidden = true;
      const hits = mine.filter(x => normText([x.title, x.description, x.chapter].join(' ')).includes(q));
      res.appendChild(el('p', { class: 'small muted' }, plural(hits.length, 'lecture') + ' found'));
      const g = el('div', { class: 'vl-grid' }); hits.forEach(x => g.appendChild(this.card(x, false))); res.appendChild(g); };
    search.addEventListener('input', debounce(() => { f.q = search.value; paintRes(); }, 200));
    const modSel = ed ? el('select', { 'aria-label': 'Which videos', onchange: e => { f.mod = e.target.value; this.render(); } },
      el('option', { value: vlHere(), selected: true }, 'This module: ' + vlModName(vlHere())), el('option', { value: '' }, 'All modules (teachers only)')) : null;
    const canConvert = ed && mine.some(x => !vlCatOf(x) && x.chapter);
    page.appendChild(el('div', { class: 'vl-tools' }, search, modSel,
      ed ? el('button', { class: 'btn btn-primary btn-sm', 'data-a': 'vlc-new', onclick: () => this.catForm(null) }, '+ New category') : null,
      ed ? el('button', { class: 'btn btn-sm', 'data-a': 'vl-add', onclick: () => this.form(null) }, '+ Add video') : null,
      canConvert ? el('button', { class: 'btn btn-sm', 'data-a': 'vlc-convert', onclick: () => this.fromChapters() }, '📁 Make folders from chapter names') : null));
    if (ed) page.appendChild(el('p', { class: 'small muted', style: 'margin:-.3rem 0 .6rem' }, '🧑‍🏫 Categories are this module’s folders. Drag ⠿ to order them; open a folder to add, move or order its videos. Deleting a category keeps its videos (they go to “Other lectures”). New videos are drafts until you publish them.'));
    const folders = el('div', { class: 'vlc-grid' });
    const shown = cats.filter(c => ed || n(c.id));
    shown.forEach(c => folders.appendChild(this.folderCard(c, n(c.id), ed)));
    if (other || ed) folders.appendChild(this.folderCard({ id: VL_OTHER, name: 'Other lectures', icon: '📂', description: ed ? 'Videos of this module that are not in a category yet.' : '' }, other, false));
    if (!shown.length && !other) folders.appendChild(el('p', { class: 'muted' }, ed ? 'No categories yet — click “+ New category”.' : 'No video lectures yet.'));
    page.appendChild(folders); page.appendChild(res);
    if (ed && shown.length > 1 && typeof picSortable === 'function') picSortable(folders, ids => this.saveCatOrder(ids.filter(id => id !== VL_OTHER)));
    paintRes();
  };
  V.folderCard = function (c, count, ed) {
    const open = () => Router.go('videos', [c.id]);
    const card = el('div', { class: 'vlc-card' + (c.id === VL_OTHER ? ' vlc-other' : ' pa-card'), role: 'link', tabindex: '0', 'aria-label': c.name + ' — ' + plural(count, 'video'), dataset: { key: c.id }, onclick: open,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
      ed && c.id !== VL_OTHER ? el('span', { class: 'pa-handle', title: 'Drag to move', 'aria-hidden': 'true' }, '⠿') : null,
      el('span', { class: 'vlc-ico', 'aria-hidden': 'true' }, c.icon || '📁'),
      el('span', { class: 'vlc-txt' }, el('b', null, c.name), c.description ? el('span', { class: 'vlc-desc' }, c.description) : null, el('span', { class: 'vlc-n' }, plural(count, 'video')),
        ed ? el('span', { class: 'vlc-acts' },
          el('button', { class: 'btn btn-xs', 'data-a': 'vlc-edit', onclick: e => { e.stopPropagation(); this.catForm(c); } }, '✎ Edit'),
          el('button', { class: 'btn btn-xs btn-danger', 'data-a': 'vlc-remove', onclick: e => { e.stopPropagation(); this.catRemove(c, count); } }, '🗑')) : null));
    return card;
  };
  /** One folder: back button, its videos (drag ⠿ to order them inside the folder). */
  V.folderPage = function (page) {
    const ed = this.editable(), id = this.cat, c = id === VL_OTHER ? { id, name: 'Other lectures', icon: '📂', description: '' } : (this.cats || []).find(x => x.id === id);
    page.appendChild(el('div', { class: 'vlc-back' }, el('button', { class: 'btn btn-sm', 'data-a': 'vlc-back', onclick: () => Router.go('videos') }, '‹ All categories')));
    if (!c) { page.appendChild(el('p', { class: 'muted' }, 'This category is no longer there.')); return; }
    const list = mineOf(this).filter(x => vlCatOf(x) === (id === VL_OTHER ? '' : id));
    page.appendChild(el('div', { class: 'vlc-head' }, el('span', { class: 'vlc-ico', 'aria-hidden': 'true' }, c.icon || '📁'), el('div', null, el('h2', null, c.name), el('div', { class: 'small muted' }, plural(list.length, 'video')))));
    if (c.description) page.appendChild(el('p', { class: 'small', style: 'margin:.1rem 0 .7rem;white-space:pre-wrap' }, c.description));
    if (ed) page.appendChild(el('div', { class: 'vl-tools' },
      el('button', { class: 'btn btn-primary btn-sm', 'data-a': 'vl-add', onclick: () => this.form(null) }, '+ Add video'),
      id !== VL_OTHER ? el('button', { class: 'btn btn-sm', 'data-a': 'vlc-edit', onclick: () => this.catForm(c) }, '✎ Edit category') : null,
      id !== VL_OTHER ? el('button', { class: 'btn btn-sm btn-danger', 'data-a': 'vlc-remove', onclick: () => this.catRemove(c, list.length) }, '🗑 Delete category') : null,
      list.length > 1 ? el('span', { class: 'small muted' }, 'Drag ⠿ to order the videos; ✎ Edit → Category moves a video to another folder.') : null));
    const grid = el('div', { class: 'vl-grid' }); page.appendChild(grid);
    if (!list.length) grid.appendChild(el('p', { class: 'muted' }, ed ? 'No videos in this category yet — “+ Add video”, or move one here with ✎ Edit → Category.' : 'No videos here yet.'));
    list.forEach(x => grid.appendChild(this.card(x, ed && list.length > 1)));
    if (ed && list.length > 1 && typeof picSortable === 'function') picSortable(grid, ids => this.saveOrder(ids));
  };
  V.catForm = function (c) {
    const isNew = !c, d = Object.assign({ name: '', description: '', icon: '📁' }, c || {});
    const name = el('input', { type: 'text', value: d.name, placeholder: 'e.g. Revision sessions', maxlength: '80' });
    const desc = el('textarea', { rows: 3, placeholder: 'What students find in this folder (optional)' }, d.description || '');
    let icon = d.icon || '📁'; const icons = el('div', { class: 'vlc-icons', role: 'radiogroup', 'aria-label': 'Icon' });
    const paint = () => { clear(icons); VL_ICONS.forEach(i => icons.appendChild(el('button', { type: 'button', class: i === icon ? 'on' : '', 'aria-label': 'Icon ' + i, onclick: () => { icon = i; paint(); } }, i))); };
    paint(); this.catCss();
    const msg = el('div', { class: 'small' });
    openModal({ title: isNew ? '📁 New category' : '✎ Edit category', body: el('div', { class: 'stack vlc-form' }, el('label', { class: 'field' }, 'Name *', name), el('label', { class: 'field' }, 'Description', desc), el('div', null, el('b', null, 'Icon'), icons), msg),
      actions: [{ label: 'Cancel' }, { label: isNew ? 'Create category' : 'Save', primary: true, keepOpen: true, onClick: async (close) => {
        if (!name.value.trim()) { msg.className = 'msg bad'; msg.textContent = 'Give the category a name.'; return false; }
        msg.className = 'small'; msg.textContent = 'Saving…';
        const r = await Backend.authedPost({ action: 'videoCatSave', category: Object.assign(c ? { id: c.id } : {}, { name: name.value.trim(), description: desc.value.trim(), icon }) }, { timeout: 30000 });
        if (!(r && r.ok)) { msg.className = 'msg bad'; msg.textContent = (r && r.error) || 'Could not save.'; return false; }
        const cats = (this.cats || []).filter(x => x.id !== r.category.id); if (c) cats.splice((this.cats || []).findIndex(x => x.id === c.id), 0, r.category); else cats.push(r.category); this.cats = cats;
        close(true); this.render(); toast(isNew ? 'Category created.' : 'Saved.', 'ok');
      } }] });
  };
  V.catRemove = async function (c, count) {
    if (!(await confirmDialog('Delete the category “' + c.name + '”? ' + (count ? 'Its ' + plural(count, 'video') + ' are NOT deleted — they move to “Other lectures”.' : 'It has no videos.'), { danger: true, okLabel: 'Delete category' }))) return;
    const r = await Backend.authedPost({ action: 'videoCatRemove', id: c.id }, { timeout: 30000 });
    if (!(r && r.ok)) { toast((r && r.error) || 'Could not delete it.', 'bad', 6000); return; }
    toast('Category deleted' + (r.moved ? ' — ' + plural(r.moved, 'video') + ' moved to “Other lectures”.' : '.'), 'ok');
    if (this.cat === c.id) Router.go('videos'); await this.load();
  };
  V.saveCatOrder = async function (ids) {
    const by = new Map((this.cats || []).map(c => [c.id, c])); this.cats = ids.map(id => by.get(id)).filter(Boolean).concat((this.cats || []).filter(c => !ids.includes(c.id)));
    this.render();
    const r = await Backend.authedPost({ action: 'videoCatOrder', ids: this.cats.map(c => c.id) }, { timeout: 30000 });
    if (r && r.ok) toast('Order saved.', 'ok'); else { toast('The order could not be saved: ' + ((r && r.error) || 'network'), 'bad', 6000); this.load(); }
  };
  V.fromChapters = async function () {
    if (!(await confirmDialog('Make a category for each “Chapter / subject” label of this module’s videos and file the videos in them? Videos already in a category are not moved. You can rename or delete the categories afterwards.', { okLabel: '📁 Make folders' }))) return;
    const r = await Backend.authedPost({ action: 'videoCatFromChapters' }, { timeout: 60000 });
    if (!(r && r.ok)) { toast((r && r.error) || 'Could not make the folders.', 'bad', 6000); return; }
    toast(plural(r.made, 'category') + ' made, ' + plural(r.filed, 'video') + ' filed.', 'ok'); await this.load();
  };
})();

/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */"""
R = [
("""/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */""", CODE),
# the video form: Category instead of Chapter / subject; position inside the category
("""    chapter.setAttribute('list', 'vl-chapters');""",
 """    chapter.setAttribute('list', 'vl-chapters');
    const catSel = vlCatSelect(d, isNew);   // the folder in this module (patch video-categories)"""),
("""      F('Chapter / subject', chapter), chList, F('Short description', desc),""",
 """      F('Category (folder)', catSel, 'Changing it moves the video to another folder of this module.'), F('Short description', desc),"""),
("""      el('div', { class: 'field-row' }, F('Duration', duration), F('Display order', pos)),""",
 """      el('div', { class: 'field-row' }, F('Duration', duration), F('Position in its category', pos)),"""),
("""    const mineAll = all.filter(x => (x.modules || []).includes(vlHere())),""",
 """    const mineAll = all.filter(x => (x.modules || []).includes(vlHere()) && vlCatOf(x) === (isNew ? catSel.value : vlCatOf(d))),"""),
("""chapter: chapter.value.trim(), duration: duration.value.trim(),""",
 """chapter: chapter.value.trim(), cats: vlCatsFor(d, catSel.value), duration: duration.value.trim(),"""),
("""rest = (this.items || []).filter(x => x.id !== r.video.id), mine = rest.filter(x => (x.modules || []).includes(vlHere()));""",
 """rest = (this.items || []).filter(x => x.id !== r.video.id), mine = rest.filter(x => (x.modules || []).includes(vlHere()) && vlCatOf(x) === vlCatOf(r.video));"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
