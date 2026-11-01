"""🎬 Video Lectures — an independent main tab (user 2026-11-01): Learn · Review · Practical · Video Lectures · My Progress.
One platform-wide library (Portal.gs 2.38: videoList / videoSave / videoRemove / videoOrder — Content sheet "videolib"),
the same in every module; videos are hosted on Google Drive, YouTube, Vimeo, a direct video file or any site with an embed
link (only the link is stored). Students: search, Module and Chapter / subject filters, ▶ Watch (player window; other
sites open in a new tab), ⬇ Download where the teacher allowed it (Drive / direct files). Teachers of the module and the
Admin: + Add video, ✎ Edit, 🗑 Remove, Position / drag (⠿) order, Draft → ▶ Preview → Published. A video is stored once;
it may carry several modules — it is listed once and every module filter finds it. Learn / Review / Practical / My
Progress are unchanged. Needs pic-arrange (picSortable). Idempotent."""
import sys
CODE = r"""/* ==========================================================================
   🎬 Video Lectures (patch video-library) — one platform-wide library, its own main tab (#/videos)
   ========================================================================== */
const VL_MODULES = [['intropath', 'Introduction to Pathology'], ['cellcondensed', 'Cell Injury & Cell Death'], ['inflnew', 'Inflammation'], ['neonew', 'Neoplasia'], ['general', 'General / integrated pathology']];
function vlModName(k) { const m = VL_MODULES.find(x => x[0] === k); return m ? m[1] : k; }
function vlHere() { return String(COURSE.moduleKey || MODULE_KEY || '').split('-')[0]; }
/** What a video link is: Google Drive, YouTube, Vimeo, a video file, an embed link or another web page. */
function vlParse(url) {
  let u = String(url || '').trim();
  const ifr = /<iframe[^>]+src=["']([^"']+)/i.exec(u); if (ifr) u = ifr[1];
  let m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/);
  if (m) return { kind: 'drive', host: 'Google Drive', embed: 'https://drive.google.com/file/d/' + m[1] + '/preview', thumb: 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w640',
    download: 'https://drive.google.com/uc?export=download&id=' + m[1], open: 'https://drive.google.com/file/d/' + m[1] + '/view' };
  m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return { kind: 'youtube', host: 'YouTube', embed: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0', thumb: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg', open: 'https://www.youtube.com/watch?v=' + m[1] };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  if (m) return { kind: 'vimeo', host: 'Vimeo', embed: 'https://player.vimeo.com/video/' + m[1], open: 'https://vimeo.com/' + m[1] };
  if (!/^https:\/\//i.test(u)) return null;
  if (/\.(mp4|webm|ogv|ogg|m4v|mov)(\?|#|$)/i.test(u)) return { kind: 'file', host: 'Video file', file: u, download: u, open: u };
  let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { host = 'website'; }
  if (/\/embed\b|\/player\b|player\./i.test(u)) return { kind: 'embed', host, embed: u, open: u };
  return { kind: 'link', host, open: u };
}
function vlWatch(v) {
  const p = vlParse(v.url); if (!p) { toast('This video link cannot be opened.', 'bad'); return; }
  if (p.kind === 'link') { window.open(p.open, '_blank', 'noopener'); return; }
  const box = el('div', { class: 'vl-player' });
  if (p.kind === 'file') box.appendChild(el('video', { src: p.file, controls: true, playsinline: true, preload: 'metadata' }));
  else box.appendChild(el('iframe', { src: p.embed, title: v.title || 'Video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin' }));
  const links = el('div', { class: 'row small mt1', style: 'gap:.8rem;flex-wrap:wrap' },
    el('a', { href: p.open, target: '_blank', rel: 'noopener' }, 'Open on ' + p.host + ' ↗'),
    v.download && p.download ? el('a', { href: p.download, target: '_blank', rel: 'noopener' }, '⬇ Download') : null,
    p.kind === 'drive' ? el('span', { class: 'muted' }, 'If the video does not play, it may still be processing on Google Drive, or it is not shared “Anyone with the link”.') : null);
  openModal({ title: '🎬 ' + (v.title || 'Video'), wide: true, body: el('div', null, box, v.description ? el('p', { class: 'small', style: 'white-space:pre-wrap;margin:.6rem 0 0' }, v.description) : null, links) });
}
Views.videos = {
  items: null, canEdit: false, loading: false, err: '', f: { q: '', mod: null, ch: '' },
  show() { this.render(); if (!this.items && !this.loading) this.load(); },
  refresh() { this.render(); },
  async load() {
    this.loading = true; this.err = ''; this.render();
    const r = Backend.isConfigured() ? await Backend.rawPost({ action: 'videoList' }, { timeout: 30000 }) : { ok: false, code: 'config' };
    this.loading = false;
    if (r && r.ok) { this.items = r.items || []; this.canEdit = !!r.canEdit; }
    else this.err = !r || r.code === 'config' ? 'The video library is on the class server — it is not available in this offline copy.'
      : /unknown action/i.test(r.error || '') || r.code === 'outdated' ? 'The class server needs updating (Portal.gs 2.38) before the video library can open — tell your teacher.' : (r.error || 'The video library could not be loaded.');
    this.render();
  },
  editable() { return this.canEdit && Auth.isTeacher(); },
  list() {
    const f = this.f, q = normText(f.q || ''), all = this.items || [];
    return all.filter(v => (!f.mod || (v.modules || []).includes(f.mod)) && (!f.ch || v.chapter === f.ch)
      && (!q || normText([v.title, v.description, v.chapter].join(' ')).includes(q)));
  },
  css() {
    if (document.getElementById('vl-css')) return;
    document.head.appendChild(el('style', { id: 'vl-css' },
      '.vl-tools{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.6rem 0 .8rem}.vl-tools input[type=search]{flex:1 1 220px;min-width:0}.vl-tools select{flex:0 1 230px;min-width:0}' +
      '.vl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.9rem}@media(max-width:560px){.vl-grid{grid-template-columns:1fr}}' +
      '.vl-card{position:relative;display:flex;flex-direction:column;border:1px solid var(--line,#d5dde7);border-radius:12px;background:#fff;overflow:hidden}' +
      '.vl-thumb{position:relative;aspect-ratio:16/9;background:#0f1c2b;cursor:pointer;display:flex;align-items:center;justify-content:center;border:0;padding:0;width:100%}' +
      '.vl-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.vl-ph{font-size:2.6rem;color:#9fb3c8}' +
      '.vl-play{position:absolute;inset:auto auto 50% 50%;transform:translate(-50%,50%);width:3.2rem;height:3.2rem;border-radius:999px;background:rgba(11,35,64,.78);color:#fff;font-size:1.3rem;display:flex;align-items:center;justify-content:center}' +
      '.vl-dur{position:absolute;right:.4rem;bottom:.4rem;background:rgba(0,0,0,.75);color:#fff;font-size:.75rem;font-weight:700;padding:.1rem .35rem;border-radius:5px}' +
      '.vl-draft{position:absolute;left:.4rem;top:.4rem;background:#b45309;color:#fff;font-size:.72rem;font-weight:700;padding:.1rem .4rem;border-radius:5px}' +
      '.vl-body{padding:.65rem .75rem .75rem;display:flex;flex-direction:column;gap:.3rem;flex:1}.vl-body h3{margin:0;font-size:1rem;line-height:1.3;color:var(--navy,#0b2340)}' +
      '.vl-meta{display:flex;flex-wrap:wrap;gap:.3rem;font-size:.75rem}.vl-chip{background:#eef3f9;color:var(--navy,#0b2340);border-radius:999px;padding:.05rem .5rem}.vl-chip.ch{background:#e6f5f4}' +
      '.vl-desc{font-size:.85rem;color:var(--muted,#64748b);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:0}' +
      '.vl-acts{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:auto;padding-top:.3rem}' +
      '.vl-card .pa-handle{position:absolute;top:.4rem;right:.4rem;z-index:2}' +
      '.vl-player{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}.vl-player iframe,.vl-player video{position:absolute;inset:0;width:100%;height:100%;border:0}' +
      '.vl-form .vl-mods{display:flex;flex-wrap:wrap;gap:.3rem .9rem}.vl-form .vl-prev{margin-top:.5rem}'));
  },
  render() {
    const v = document.getElementById('view-videos'); if (!v) return; clear(v); this.css();
    const page = el('div', { class: 'page ux-page' }); v.appendChild(page);
    page.appendChild(uxPageHead('videos', 'Video Lectures', 'Recorded lectures of the pathology course — watch them in any order, alone or alongside Learn.'));
    if (this.loading && !this.items) { page.appendChild(el('p', { class: 'muted' }, 'Loading the video library…')); return; }
    if (this.err) { page.appendChild(el('div', { class: 'msg warn' }, this.err, ' ', el('button', { class: 'btn btn-sm', onclick: () => this.load() }, '↻ Try again'))); return; }
    const all = this.items || [], ed = this.editable(), f = this.f;
    if (f.mod === null) f.mod = all.some(x => (x.modules || []).includes(vlHere())) ? vlHere() : '';
    const mods = VL_MODULES.map(m => m[0]).concat([...new Set(all.flatMap(x => x.modules || []))].filter(k => !VL_MODULES.some(m => m[0] === k)));
    const chapters = [...new Set(all.filter(x => !f.mod || (x.modules || []).includes(f.mod)).map(x => x.chapter).filter(Boolean))].sort();
    if (f.ch && !chapters.includes(f.ch)) f.ch = '';
    const search = el('input', { type: 'search', placeholder: 'Search lectures…', 'aria-label': 'Search lectures', value: f.q });
    search.addEventListener('input', debounce(() => { f.q = search.value; this.paintGrid(grid, count); }, 200));
    const modSel = el('select', { 'aria-label': 'Module', onchange: e => { f.mod = e.target.value; f.ch = ''; this.render(); } },
      el('option', { value: '', selected: !f.mod }, 'All modules'), mods.map(k => el('option', { value: k, selected: f.mod === k }, vlModName(k))));
    const chSel = el('select', { 'aria-label': 'Chapter or subject', onchange: e => { f.ch = e.target.value; this.paintGrid(grid, count); } },
      el('option', { value: '' }, 'All chapters / subjects'), chapters.map(c => el('option', { value: c, selected: f.ch === c }, c)));
    const count = el('span', { class: 'small muted' });
    page.appendChild(el('div', { class: 'vl-tools' }, search, modSel, chSel, count,
      ed ? el('button', { class: 'btn btn-primary btn-sm', 'data-a': 'vl-add', onclick: () => this.form(null) }, '+ Add video') : null));
    if (ed) page.appendChild(el('p', { class: 'small muted', style: 'margin:-.3rem 0 .6rem' }, '🧑‍🏫 One library for all modules and groups. New videos are drafts (only teachers see them, marked DRAFT) until you publish them. Drag ⠿ to change the order (with no search or filter), or set the position in ✎ Edit.'));
    const grid = el('div', { class: 'vl-grid' }); page.appendChild(grid);
    this.paintGrid(grid, count);
  },
  paintGrid(grid, count) {
    clear(grid); const list = this.list(), ed = this.editable(), f = this.f;
    count.textContent = plural(list.length, 'video');
    if (!list.length) { grid.appendChild(el('p', { class: 'muted' }, (this.items || []).length ? 'No video matches this search or filter.' : ed ? 'No videos yet — click “+ Add video”.' : 'No video lectures yet.')); return; }
    list.forEach(v => grid.appendChild(this.card(v, ed && !f.q && !f.mod && !f.ch)));
    if (ed && !f.q && !f.mod && !f.ch && list.length > 1 && typeof picSortable === 'function') picSortable(grid, ids => this.saveOrder(ids));
  },
  card(v, drag) {
    const p = vlParse(v.url) || {}, thumbUrl = v.thumb || p.thumb, ed = this.editable();
    const th = el('button', { type: 'button', class: 'vl-thumb', 'aria-label': 'Watch: ' + v.title, onclick: () => vlWatch(v) });
    if (thumbUrl) { const im = el('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: thumbUrl }); im.addEventListener('error', () => im.replaceWith(el('span', { class: 'vl-ph', 'aria-hidden': 'true' }, '🎬'))); th.appendChild(im); }
    else th.appendChild(el('span', { class: 'vl-ph', 'aria-hidden': 'true' }, '🎬'));
    th.appendChild(el('span', { class: 'vl-play', 'aria-hidden': 'true' }, '▶'));
    if (v.duration) th.appendChild(el('span', { class: 'vl-dur' }, v.duration));
    if (v.status !== 'published') th.appendChild(el('span', { class: 'vl-draft' }, 'DRAFT'));
    return el('article', { class: 'vl-card' + (drag ? ' pa-card' : ''), dataset: { key: v.id } },
      drag ? el('span', { class: 'pa-handle', title: 'Drag to move', 'aria-hidden': 'true' }, '⠿') : null, th,
      el('div', { class: 'vl-body' }, el('h3', null, v.title),
        el('div', { class: 'vl-meta' }, (v.modules || []).map(k => el('span', { class: 'vl-chip' }, vlModName(k))), v.chapter ? el('span', { class: 'vl-chip ch' }, v.chapter) : null),
        v.description ? el('p', { class: 'vl-desc', title: v.description }, v.description) : null,
        el('div', { class: 'vl-acts' },
          el('button', { class: 'btn btn-sm btn-primary', 'data-a': 'vl-watch', onclick: () => vlWatch(v) }, p.kind === 'link' ? '↗ Watch on ' + p.host : '▶ Watch'),
          v.download && p.download ? el('a', { class: 'btn btn-sm', href: p.download, target: '_blank', rel: 'noopener', 'data-a': 'vl-download' }, '⬇ Download') : null,
          ed ? el('button', { class: 'btn btn-sm', 'data-a': 'vl-edit', onclick: () => this.form(v) }, '✎ Edit') : null,
          ed ? el('button', { class: 'btn btn-sm btn-danger', 'data-a': 'vl-remove', title: 'Remove from the library', onclick: () => this.remove(v) }, '🗑') : null)));
  },
  async saveOrder(ids) {
    const by = new Map((this.items || []).map(v => [v.id, v])); this.items = ids.map(id => by.get(id)).filter(Boolean).concat((this.items || []).filter(v => !ids.includes(v.id)));
    this.render();
    const r = await Backend.authedPost({ action: 'videoOrder', ids: this.items.map(v => v.id) }, { timeout: 30000 });
    if (r && r.ok) toast('Order saved.', 'ok'); else { toast('The order could not be saved: ' + ((r && r.error) || 'network'), 'bad', 6000); this.load(); }
  },
  async remove(v) {
    if (!(await confirmDialog('Remove “' + v.title + '” from the video library? It disappears for every module and group. (The video itself stays on ' + ((vlParse(v.url) || {}).host || 'its website') + '.)', { danger: true, okLabel: 'Remove' }))) return;
    const r = await Backend.authedPost({ action: 'videoRemove', id: v.id }, { timeout: 30000 });
    if (r && r.ok) { this.items = (this.items || []).filter(x => x.id !== v.id); this.render(); toast('Removed.', 'ok'); } else toast((r && r.error) || 'Could not remove it.', 'bad', 6000);
  },
  form(v) {
    const isNew = !v, all = this.items || [], d = Object.assign({ title: '', url: '', description: '', chapter: '', duration: '', thumb: '', modules: [vlHere()], download: false, status: 'draft' }, v || {});
    const inp = (val, ph, type) => el('input', { type: type || 'text', value: val || '', placeholder: ph || '' });
    const title = inp(d.title, 'e.g. Acute inflammation — vascular events'), url = inp(d.url, 'https://…  (Google Drive, YouTube, Vimeo, a video file or an embed link)', 'url');
    const chapter = inp(d.chapter, 'e.g. Chapter 2 · Acute inflammation'), duration = inp(d.duration, 'e.g. 42:10'), thumb = inp(d.thumb, 'optional — https://… picture', 'url');
    chapter.setAttribute('list', 'vl-chapters');
    const chList = el('datalist', { id: 'vl-chapters' }, [...new Set(all.map(x => x.chapter).filter(Boolean))].map(c => el('option', { value: c })));
    const desc = el('textarea', { rows: 3, placeholder: 'What the lecture covers' }, d.description);
    const mods = VL_MODULES.map(m => m[0]).concat((d.modules || []).filter(k => !VL_MODULES.some(m => m[0] === k)));
    const modBox = el('div', { class: 'vl-mods' }, mods.map(k => el('label', null, el('input', { type: 'checkbox', value: k, checked: (d.modules || []).includes(k) }), ' ' + vlModName(k))));
    const dl = el('input', { type: 'checkbox', checked: !!d.download });
    const status = el('select', null, el('option', { value: 'draft', selected: d.status !== 'published' }, 'Draft — only teachers see it'), el('option', { value: 'published', selected: d.status === 'published' }, 'Published — students see it'));
    const others = all.filter(x => !v || x.id !== v.id), cur = v ? all.findIndex(x => x.id === v.id) : others.length;
    const pos = el('select', null, Array.from({ length: others.length + 1 }, (_, i) => el('option', { value: i, selected: i === cur }, 'Position ' + (i + 1) + (i === others.length ? ' (last)' : ''))));
    const kind = el('div', { class: 'small muted' }), prev = el('div', { class: 'vl-prev' }), msg = el('div', { class: 'small' });
    const showKind = () => { const p = vlParse(url.value); kind.textContent = !url.value.trim() ? '' : !p ? '⚠ Paste a link that starts with https://' : p.kind === 'link' ? '↗ ' + p.host + ': students open it in a new tab (this site cannot be shown inside the platform).' : '✓ ' + p.host + (p.kind === 'drive' ? ' — share the file “Anyone with the link · Viewer”.' : '') + (p.download ? '' : ' · download is not offered for this kind of link.'); };
    url.addEventListener('input', showKind); showKind();
    const preview = el('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
      clear(prev); const p = vlParse(url.value); if (!p) { showKind(); return; }
      if (p.kind === 'link') { prev.appendChild(el('a', { href: p.open, target: '_blank', rel: 'noopener' }, 'Open ' + p.host + ' ↗')); return; }
      const box = el('div', { class: 'vl-player' }); box.appendChild(p.kind === 'file' ? el('video', { src: p.file, controls: true, playsinline: true }) : el('iframe', { src: p.embed, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true' }));
      prev.appendChild(box);
    } }, '▶ Preview');
    const F = (label, x, hint) => el('label', { class: 'field' }, label, x, hint ? el('span', { class: 'hint' }, hint) : null);
    const body = el('div', { class: 'stack vl-form' }, F('Lecture title *', title), F('Video link *', url), kind, el('div', null, preview, prev),
      el('div', null, el('b', null, 'Module(s)'), el('span', { class: 'small muted' }, ' — the video is listed once; each ticked module’s filter finds it'), modBox),
      F('Chapter / subject', chapter), chList, F('Short description', desc),
      el('div', { class: 'field-row' }, F('Duration', duration), F('Display order', pos)),
      F('Thumbnail picture', thumb, 'Leave empty: Google Drive and YouTube give one automatically.'),
      el('label', { class: 'row', style: 'gap:.4rem' }, dl, 'Allow students to download it (Google Drive / video files)'),
      F('Status', status), msg);
    openModal({ title: isNew ? '🎬 Add video' : '✎ Edit video', wide: true, body, actions: [{ label: 'Cancel' }, { label: isNew ? 'Add video' : 'Save', primary: true, keepOpen: true, onClick: async (close) => {
      const modules = [...modBox.querySelectorAll('input:checked')].map(x => x.value);
      const err = !title.value.trim() ? 'Give the video a title.' : !vlParse(url.value) ? 'Paste the video link (it must start with https://).' : !modules.length ? 'Tick at least one module.' : '';
      if (err) { msg.className = 'msg bad'; msg.textContent = err; return false; }
      const p = vlParse(url.value), clean = (/<iframe/i.test(url.value) ? (/<iframe[^>]+src=["']([^"']+)/i.exec(url.value) || [])[1] : url.value).trim();
      const video = Object.assign({}, v ? { id: v.id, order: v.order } : {}, { title: title.value.trim(), url: clean, description: desc.value.trim(), chapter: chapter.value.trim(), duration: duration.value.trim(),
        thumb: thumb.value.trim(), modules, download: dl.checked && !!p.download, status: status.value });
      msg.className = 'small'; msg.textContent = 'Saving…';
      const r = await Backend.authedPost({ action: 'videoSave', video }, { timeout: 30000 });
      if (!(r && r.ok)) { msg.className = 'msg bad'; msg.textContent = (r && r.error) || 'Could not save.'; return false; }
      const rest = (this.items || []).filter(x => x.id !== r.video.id); rest.splice(Math.min(+pos.value, rest.length), 0, r.video); this.items = rest;
      close(true); this.render(); toast(isNew ? 'Video added' + (r.video.status === 'published' ? ' and published.' : ' as a draft.') : 'Saved.', 'ok');
      if (rest.findIndex(x => x.id === r.video.id) !== (v ? cur : -1)) {
        const o = await Backend.authedPost({ action: 'videoOrder', ids: rest.map(x => x.id) }, { timeout: 30000 }); if (!(o && o.ok)) toast('The position could not be saved.', 'warn');
      }
    } }] });
  }
};

/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */"""
R = [
("""  <section class="view" id="view-progress" aria-label="My progress"></section>""",
 """  <section class="view" id="view-videos" aria-label="Video lectures"></section>
  <section class="view" id="view-progress" aria-label="My progress"></section>"""),
("""  { id: 'progress', label: 'My Progress', icon: '📈' },  // Stage 2 hub""",
 """  { id: 'videos', label: 'Video Lectures', icon: '🎬' },  // 🎬 independent video library (patch video-library)
  { id: 'progress', label: 'My Progress', icon: '📈' },  // Stage 2 hub"""),
("""  { id: 'progress', label: 'My Progress', short: 'Progress', hint: 'Topic progress, mistakes and notes',""",
 """  { id: 'videos', label: 'Video Lectures', short: 'Videos', hint: 'Recorded video lectures of the course', items: [['Video library', '▶', 'videos', []]] },   // patch video-library
  { id: 'progress', label: 'My Progress', short: 'Progress', hint: 'Topic progress, mistakes and notes',"""),
("""  if (view === 'progress') return 'progress';""",
 """  if (view === 'progress') return 'progress';
  if (view === 'videos') return 'videos';   // patch video-library"""),
("""  progress: '<path d="M4 20h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16V4"/>',""",
 """  progress: '<path d="M4 20h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16V4"/>',
  videos: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.2v5.6l4.8-2.8z"/>',"""),
("""/* ---------- Review and Practical hub pages (patch nav-review-practical) ---------- */""", CODE),
]
DONE = '   🎬 Video Lectures (patch video-library) — one platform-wide library'
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s or (DONE in b and DONE in s): continue   # the block is edited by video-own-module
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
