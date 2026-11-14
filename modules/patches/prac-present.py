"""▶ Present all practical cases (user, 2026-11-14: "one presentation presents all the cases … a smooth transition"; the
diagnosis starts hidden until revealed). Practical → Practical cases gets "▶ Present all cases": a full-screen slide show of
every PUBLISHED practical — per case a title slide (case number, organ, specimen type, clinical information), then each picture
on its own slide in the case's order (gross/clinical → microscopic → additional), then "What is your diagnosis?". The caption of
a picture, the case title and the diagnosis (with key features, differential, clinical point) are hidden until R / 👁 Reveal —
the titles name the diagnosis, so only "Case N" and the organ show first. Keys ← → Space PageUp/PageDown Home End, R, F (full
screen, desktop only — never on touch devices, see HANDBOOK learn-fs lesson), Esc; swipe on a touch screen; a case menu jumps to
any case. A practical's own page gets "▶ Present from this case" and "‹ Previous case · Next case ›". Teachers and students
alike (published cases only). Wraps Views.practical.render; no other patch's text is edited. Idempotent."""
import sys
R = [
("""Bus.on('prac-changed', () => { if (Router.current === 'practical' && !['edit', 'import'].includes(Views.practical.params[0])) Views.practical.render(); });""",
 """Bus.on('prac-changed', () => { if (Router.current === 'practical' && !['edit', 'import'].includes(Views.practical.params[0])) Views.practical.render(); });
/* ---------- ▶ Present all practical cases (patch prac-present) ---------- */
function pcpPut(n, ...kids) { appendKids(n, kids); return n; }   // DOM append() would write "null"
const PracPresent = {
  slides: [], i: 0, shown: new Set(), root: null, keyFn: null,
  touch() { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1; },
  pics(p) {
    const rank = { gross: 0, micro: 1, additional: 2 };
    return (p.images || []).map((im, k) => ({ im, k })).filter(x => x.im && x.im.url && x.im.active !== false)
      .sort((a, b) => ((rank[a.im.slot] ?? 3) - (rank[b.im.slot] ?? 3)) || (a.k - b.k)).map(x => x.im);
  },
  cases() { return PracData.published().filter(p => this.pics(p).length || p.diagnosis); },
  build() {
    const out = [], list = this.cases();
    list.forEach((p, ci) => {
      const pics = this.pics(p);
      ci = p.number || ci + 1;
      out.push({ t: 'title', p, ci, n: pics.length });
      pics.forEach((im, j) => out.push({ t: 'pic', p, ci, im, j, n: pics.length }));
      out.push({ t: 'dx', p, ci });
    });
    this.total = list.length; return out;
  },
  start(caseId) {
    this.slides = this.build(); if (!this.slides.length) { toast('No published practicals to present yet.', 'info'); return; }
    const at = caseId ? this.slides.findIndex(s => s.p.id === caseId) : 0;
    this.i = at < 0 ? 0 : at; this.shown = new Set(); this.mount(); this.paint();
  },
  close() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
    if (this.root) this.root.remove(); this.root = null;
    document.body.classList.remove('pcp-open');
    if (this.keyFn) document.removeEventListener('keydown', this.keyFn, true); this.keyFn = null;
  },
  go(k) { const n = Math.max(0, Math.min(this.slides.length - 1, k)); if (n !== this.i) { this.i = n; this.paint(); } },
  reveal() { const s = this.slides[this.i]; if (!s || s.t === 'title') return; if (this.shown.has(this.i)) this.shown.delete(this.i); else this.shown.add(this.i); this.paint(); },
  fullscreen() { if (this.touch() || !this.root) return; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else if (this.root.requestFullscreen) this.root.requestFullscreen().catch(() => { }); },
  style() {
    if (document.getElementById('pcp-style')) return;
    document.head.appendChild(el('style', { id: 'pcp-style' }, `
body.pcp-open{overflow:hidden}
.pcp-root{position:fixed;inset:0;z-index:9000;background:#eef3f7;color:#14293d;display:flex;flex-direction:column;font-size:16px}
.pcp-top{display:flex;align-items:center;gap:.6rem;padding:.6rem 1rem;background:#fff;border-bottom:1px solid #d8e2ea;box-shadow:0 1px 6px rgba(20,41,61,.06)}
.pcp-root .pcp-where{font-weight:800;color:#0f2a43;margin-right:auto;white-space:nowrap}
.pcp-root .pcp-top select{width:auto;max-width:22rem;min-width:0}
.pcp-top select,.pcp-top button,.pcp-nav button{font:inherit;font-size:.92rem;border-radius:999px;border:1px solid #cfdbe5;background:#fff;color:#14293d;padding:.45rem .9rem;cursor:pointer}
.pcp-top button:hover,.pcp-nav button:hover:not([disabled]){border-color:#0e9f9a;color:#0b7d78}
.pcp-root button.pcp-rev{background:#0e9f9a;border-color:#0e9f9a;color:#fff;font-weight:700}
.pcp-root button.pcp-rev:hover{background:#0b8b86;color:#fff}
.pcp-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:1.2rem;overflow:auto;touch-action:pan-y}
.pcp-slide{width:min(1200px,100%);max-height:100%;display:flex;flex-direction:column;align-items:center;gap:.9rem;text-align:center}
.pcp-root .pcp-kicker{color:#0b8b86;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:.85rem}
.pcp-root .pcp-case{font-size:clamp(2.2rem,6vw,4rem);font-weight:800;margin:0;color:#0f2a43;line-height:1.1}
.pcp-root .pcp-meta{font-size:clamp(1rem,2.2vw,1.3rem);color:#4a6377}
.pcp-clin{max-width:900px;font-size:clamp(1rem,2.2vw,1.35rem);line-height:1.55;background:#fff;border:1px solid #dbe5ed;border-left:5px solid #0e9f9a;border-radius:14px;padding:1rem 1.3rem;text-align:left;box-shadow:0 6px 20px rgba(20,41,61,.07)}
.pcp-clin b{color:#0f2a43}
.pcp-img{max-width:100%;max-height:calc(100vh - 15rem);object-fit:contain;border-radius:12px;background:#fff;border:1px solid #dbe5ed;box-shadow:0 10px 28px rgba(20,41,61,.14)}
.pcp-stage.pcp-stage-pic{padding:.6rem 1rem;align-items:stretch}
.pcp-slide.pcp-picslide{width:100%;max-width:none;height:100%;max-height:none;gap:.55rem}
.pcp-picslide .pcp-img{flex:1 1 0;min-height:0;width:100%;height:auto;max-height:none;object-fit:contain;border:0;border-radius:0;background:transparent;box-shadow:none;filter:drop-shadow(0 8px 22px rgba(20,41,61,.2))}
.pcp-picslide .pcp-cap,.pcp-picslide .pcp-hidden{flex:0 0 auto;max-height:30vh;overflow:auto}
.pcp-root .pcp-label{font-weight:700;color:#0f2a43;background:#fff;border:1px solid #dbe5ed;border-radius:999px;padding:.3rem .9rem;font-size:.92rem}
.pcp-hidden{color:#5b7083;font-style:italic;background:#f8fbfd;border:1.5px dashed #b9cad7;border-radius:12px;padding:.7rem 1.1rem}
.pcp-cap{max-width:1000px;font-size:clamp(.95rem,2vw,1.15rem);line-height:1.5;background:#fff;border:1px solid #dbe5ed;border-left:5px solid #0e9f9a;border-radius:12px;padding:.75rem 1.1rem;text-align:left;box-shadow:0 6px 20px rgba(20,41,61,.07)}
.pcp-root .pcp-dx{font-size:clamp(1.6rem,4.5vw,2.7rem);font-weight:800;color:#0b7d78;margin:.2rem 0}
.pcp-box{max-width:960px;width:100%;text-align:left;background:#fff;border:1px solid #dbe5ed;border-radius:14px;padding:.9rem 1.3rem;font-size:clamp(.95rem,2vw,1.12rem);line-height:1.55;box-shadow:0 6px 20px rgba(20,41,61,.07)}
.pcp-root .pcp-box h4{margin:.5rem 0 .2rem;color:#0b7d78;font-size:.95em}
.pcp-box ul{margin:.2rem 0 .4rem 1.2rem;padding:0}
.pcp-nav{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.6rem 1rem;background:#fff;border-top:1px solid #d8e2ea}
.pcp-nav button{font-size:1.02rem;padding:.6rem 1.3rem}
.pcp-root .pcp-nav button[data-a=pcp-next]{background:#0e9f9a;border-color:#0e9f9a;color:#fff;font-weight:700}
.pcp-nav button[disabled]{opacity:.4;cursor:default}
.pcp-nav .pcp-count{color:#5b7083;font-size:.88rem}
.pcp-root .pcp-hint{color:#6c8395;font-size:.82rem}
@media (max-width:720px){.pcp-top{flex-wrap:wrap}.pcp-root .pcp-where{width:100%}.pcp-img{max-height:calc(100vh - 17rem)}.pcp-picslide .pcp-img{max-height:none}}
`));
  },
  mount() {
    this.style(); this.close();
    const root = el('div', { class: 'pcp-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Practical cases — presentation' });
    const top = el('div', { class: 'pcp-top' }), stage = el('div', { class: 'pcp-stage' }), nav = el('div', { class: 'pcp-nav' });
    pcpPut(root, top, stage, nav); document.body.appendChild(root); document.body.classList.add('pcp-open');
    this.root = root; this.top = top; this.stage = stage; this.nav = nav;
    let x0 = null, y0 = null;
    stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
    stage.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 80) this.go(this.i + (dx < 0 ? 1 : -1)); });
    this.keyFn = e => {
      if (!this.root) return; const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const k = e.key; let used = true;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') this.go(this.i + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') this.go(this.i - 1);
      else if (k === 'Home') this.go(0); else if (k === 'End') this.go(this.slides.length - 1);
      else if (k === 'r' || k === 'R') this.reveal(); else if (k === 'f' || k === 'F') this.fullscreen();
      else if (k === 'Escape') { if (!document.fullscreenElement) this.close(); else used = false; }
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', this.keyFn, true);
  },
  paint() {
    const s = this.slides[this.i]; if (!s || !this.root) return; const p = s.p, open = this.shown.has(this.i);
    const sp = p.specimen || {}, organ = [sp.organ, sp.tissue].filter(Boolean).join(' — ');
    clear(this.top);
    const cases = this.cases(), sel = el('select', { 'aria-label': 'Go to case', class: 'pcp-sel' },
      cases.map((c, k) => el('option', { value: c.id, selected: c.id === p.id }, 'Case ' + (c.number || k + 1) + (c.specimen && c.specimen.organ ? ' — ' + c.specimen.organ : ''))));
    sel.addEventListener('change', () => { const k = this.slides.findIndex(x => x.p.id === sel.value); if (k >= 0) this.go(k); sel.blur(); });
    pcpPut(this.top, el('span', { class: 'pcp-where' }, 'Practical cases · ' + (cases.findIndex(c => c.id === p.id) + 1) + ' of ' + this.total), sel,
      s.t !== 'title' ? el('button', { class: 'pcp-rev', 'data-a': 'pcp-reveal', onclick: () => this.reveal() }, open ? '🙈 Hide' : '👁 Reveal (R)') : null,
      this.touch() ? null : el('button', { onclick: () => this.fullscreen(), title: 'Full screen (F)' }, '⛶'),
      el('button', { 'data-a': 'pcp-close', onclick: () => this.close(), title: 'Close (Esc)' }, '✕ Close'));
    const slide = el('div', { class: 'pcp-slide' + (s.t === 'pic' ? ' pcp-picslide' : '') });
    const hidden = t => el('div', { class: 'pcp-hidden' }, t);
    if (s.t === 'title') {
      pcpPut(slide, el('div', { class: 'pcp-kicker' }, 'Practical case'), el('h1', { class: 'pcp-case' }, 'Case ' + s.ci),
        el('div', { class: 'pcp-meta' }, [organ, sp.type].filter(Boolean).join(' · ')),
        sp.text ? el('div', { class: 'pcp-clin' }, el('b', null, 'Clinical information: '), sp.text) : null,
        el('div', { class: 'pcp-hint' }, plural(s.n, 'picture') + ' · → next · R reveals the description and the diagnosis'));
    } else if (s.t === 'pic') {
      const im = el('img', { class: 'pcp-img', alt: 'Case ' + s.ci + ', picture ' + (s.j + 1) });
      PracImages.setSrc(im, s.im.url);
      const kind = PE_IMAGE_KINDS[s.im.kind] || PE_IMAGE_SLOTS[s.im.slot] || 'Picture';
      pcpPut(slide, el('div', { class: 'pcp-label' }, 'Case ' + s.ci + ' · Picture ' + (s.j + 1) + ' of ' + s.n + ' · ' + kind + (s.im.stain ? ' (' + s.im.stain + ')' : '')), im,
        open ? el('div', { class: 'pcp-cap' }, PE_figCaption(s.im)) : hidden('Describe what you see — then press R (👁 Reveal) for the description.'));
    } else {
      pcpPut(slide, el('div', { class: 'pcp-kicker' }, 'Case ' + s.ci + (organ ? ' · ' + organ : '')), el('h2', { class: 'pcp-case', style: 'font-size:clamp(1.6rem,4vw,2.6rem)' }, 'What is your diagnosis?'));
      if (!open) pcpPut(slide, hidden('Give the diagnosis, two features you can see and one clinical point — then press R (👁 Reveal).'));
      else {
        const box = el('div', { class: 'pcp-box' });
        const add = (h, v) => { if (!v || (Array.isArray(v) && !v.length)) return; pcpPut(box, el('h4', null, h), Array.isArray(v) ? el('ul', null, v.map(x => el('li', null, x))) : el('div', null, v)); };
        add('Key features', p.keyFeatures); add('Gross / clinical', p.gross); add('Microscopic', p.microscopic); add('Differential diagnosis', p.differential); add('Clinical point', p.clinical);
        pcpPut(slide, el('div', { class: 'pcp-dx' }, p.diagnosis || p.title), el('div', { class: 'pcp-meta' }, p.title), box);
      }
    }
    this.stage.classList.toggle('pcp-stage-pic', s.t === 'pic');
    clear(this.stage).appendChild(slide); this.stage.scrollTop = 0;
    pcpPut(clear(this.nav), el('button', { 'data-a': 'pcp-prev', disabled: this.i === 0, onclick: () => this.go(this.i - 1) }, '‹ Back'),
      el('span', { class: 'pcp-count' }, 'Slide ' + (this.i + 1) + ' of ' + this.slides.length + (this.touch() ? ' · swipe ← →' : ' · ← → · R · Esc')),
      el('button', { 'data-a': 'pcp-next', disabled: this.i === this.slides.length - 1, onclick: () => this.go(this.i + 1) }, 'Next ›'));
  },
  /** Practical cases list: the ▶ Present all cases card; a practical's page: ▶ Present from this case + Previous / Next case. */
  decorate(params) {
    const v = document.getElementById('view-practical'); if (!v) return;
    const page = v.querySelector('.page'); if (!page || page.querySelector('.pcp-entry')) return;
    const cases = this.cases(); if (!cases.length) return;
    const [p0, p1] = params || [];
    if (!p0) {
      const card = el('div', { class: 'card mt1 pcp-entry', style: 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap' },
        el('button', { class: 'btn btn-primary', 'data-a': 'pcp-start', onclick: () => this.start() }, '▶ Present all cases'),
        el('span', { class: 'small muted', style: 'flex:1;min-width:16rem' }, 'Full-screen slides of all ' + plural(cases.length, 'case') + ': the clinical information, each picture in turn, then the diagnosis — hidden until you press R (👁 Reveal). ← → or swipe to move on.'));
      const anchor = [...page.querySelectorAll('.prac-h2')].map(h => h.closest('.row') || h).find(n => n.parentNode === page);
      if (anchor) page.insertBefore(card, anchor); else page.appendChild(card);
    } else if (p0 === 'p') {
      const k = cases.findIndex(c => c.id === p1); if (k < 0) return;
      const first = page.firstElementChild;
      if (first) first.appendChild(el('button', { class: 'btn btn-sm btn-primary pcp-entry', 'data-a': 'pcp-start-here', onclick: () => this.start(p1) }, '▶ Present from this case'));
      const prev = cases[k - 1], next = cases[k + 1];
      page.appendChild(el('div', { class: 'card mt2 pcp-entry pcp-casenav', style: 'display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap' },
        prev ? el('button', { class: 'btn', 'data-a': 'pcp-prev-case', onclick: () => Router.go('practical', ['p', prev.id]) }, '‹ Previous case: ' + prev.title) : el('span'),
        next ? el('button', { class: 'btn btn-primary', 'data-a': 'pcp-next-case', onclick: () => Router.go('practical', ['p', next.id]) }, 'Next case: ' + next.title + ' ›') : el('span')));
    }
  }
};
const PRAC_PRESENT_RENDER0 = Views.practical.render;
Views.practical.render = function () { const r = PRAC_PRESENT_RENDER0.apply(this, arguments); try { PracPresent.decorate(this.params); } catch (e) { } return r; };"""),
]
HEAD = '/* ---------- ▶ Present all practical cases (patch prac-present) ---------- */'
END = 'Views.practical.render = function () { const r = PRAC_PRESENT_RENDER0.apply(this, arguments); try { PracPresent.decorate(this.params); } catch (e) { } return r; };'
def upgrade(s, b):
    """An earlier version of this block (2026-11-14 dark design) is replaced in place by the current one."""
    i = s.find(HEAD)
    if i < 0 or b in s: return s, 0
    j = s.find(END, i); assert j > i, 'prac-present block end not found'
    new = b[b.index(HEAD):]
    return s[:i] + new + s[j + len(END):], 1
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        s, u = upgrade(s, b); n += u
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
