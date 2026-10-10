/* ==========================================================================
   platform-nav — role-aware return link (shared by every platform module).
   Reads NEO_CONFIG.platformHome (https only). Adds the link to the top of the
   module header and to the module's sign-in screen. The destination follows
   the role the class server confirmed for this session (NEO_BOOT.role):
     student / not signed in → "← Back to Platform Home"     → the front page
                               (of the same group when opened with ?g=…)
     teacher                 → "← Back to Teacher Dashboard" → <home>#/teacher
   Also sets window.PLATFORM_HOME, which makes teacher access go through the
   single Teacher Sign-In on the Platform Home.
   Packaged releases (Platform Home → Content → New build):
     NEO_CONFIG.build    the build label, readable without signing in
     NEO_CONFIG.preview  this file is the PREVIEW of a new build (…/preview/): only the Admin's
                         master-draft session receives its key; students cannot open it
     In a master-draft session the page reports the IDs of its packaged course (topics, sections,
     questions, cases, images — with short fingerprints, no content) for the compatibility check.
   Teaching Sessions (Portal.gs 2.10): while the platform setting "Live Classroom and Attendance in the modules" is
   HIDDEN (the default; Teacher Dashboard → 🎓 Teaching Sessions → ⚙ Change), this block hides the module's own Live
   Classroom and Attendance buttons and the Teacher Portal's Attendance tab, sends their addresses to a short notice
   (they are on the group page / Teacher Dashboard now) and answers the module's background Live Classroom checks
   itself, so they cost the server nothing. The setting is read from the platform (portalModuleFlags) and remembered
   for 5 minutes; switching it back shows everything again.
   This block is maintained in the platform repository (modules/platform-nav.js) and written
   into each module by tools/module-release.js.
   ========================================================================== */
(function () {
  'use strict';
  var NC = window.NEO_CONFIG || {}, PREVIEW = NC.preview === true, BUILD = String(NC.build || '');
  var HOME = String(NC.platformHome || '').trim();
  if (PREVIEW) previewMode();
  moveToSessions();
  if (!/^https:\/\/[^\s"'<>]+$/.test(HOME)) return;
  window.PLATFORM_HOME = HOME;
  var GROUP = (function () { try { var m = /[?&]g=([A-Za-z0-9_-]{1,24})/.exec(location.search); return m ? m[1] : ''; } catch (e) { return ''; } })();   // the module's own ?g= rule
  var CSS = '.pf-bar{display:flex;align-items:center;padding:.32rem 1.2rem;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(255,255,255,.12)}' +
    '.pf-home{display:inline-flex;align-items:center;gap:.4rem;font:700 .84rem/1.2 inherit;font-family:inherit;text-decoration:none;color:#fff;padding:.28rem .8rem;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);transition:background .15s,color .15s}' +
    '.pf-home:hover{background:#ffd166;color:#0b2a4a;border-color:#ffd166}.pf-home:focus-visible{outline:3px solid #ffd166;outline-offset:2px}' +
    '.pf-home.pf-boot{color:#0b2a4a;background:#eef4f8;border-color:#cbd5e1;margin:0 0 14px}.pf-home.pf-boot:hover{background:#ffd166}' +
    '.pf-prev{margin:0 0 12px;padding:.5rem .75rem;border-radius:8px;background:#fff3cd;color:#5c4400;font-size:.88rem}' +
    '.pf-draft{margin-left:12px;padding:.25rem .7rem;border-radius:8px;background:#ffd166;color:#0b2a4a;font:700 .8rem/1.3 inherit;font-family:inherit}' +
    '@media print{.pf-bar,.pf-home{display:none!important}}';
  /** Where "back" goes for the signed-in role (set by the sign-in gate only after the server confirmed the session). */
  function dest() {
    var teacher = !!(window.NEO_BOOT && window.NEO_BOOT.role === 'teacher');
    return teacher ? { href: HOME + '#/teacher', text: '\u2190 Back to Teacher Dashboard', label: 'Back to the Teacher Dashboard', role: 'teacher' }
      : { href: HOME + (GROUP ? '?g=' + encodeURIComponent(GROUP) : ''), text: '\u2190 Back to Platform Home', label: 'Back to Platform Home — Interactive Pathology Teaching Platform', role: 'student' };
  }
  function apply(a) {
    var d = dest();
    if (a.getAttribute('href') !== d.href) a.setAttribute('href', d.href);
    if (a.textContent !== d.text) a.textContent = d.text;
    a.setAttribute('aria-label', d.label); a.setAttribute('data-role', d.role);
  }
  function applyAll() { Array.prototype.forEach.call(document.querySelectorAll('a.pf-home'), apply); draftBanner(); reportBuild(); }
  function draftOn() { var B = window.NEO_BOOT || {}; try { return B.role === 'teacher' && sessionStorage.getItem('pf_draft:' + (B.module || '')) === '1'; } catch (e) { return false; } }
  /** Opened from Platform Home → Content → "Edit master draft": a clear reminder that this edits the master draft. */
  function draftBanner() {
    var B = window.NEO_BOOT || {}, key = 'pf_draft:' + (B.module || ''), on = false;
    try { on = sessionStorage.getItem(key) === '1'; if (on && B.role !== 'teacher') { sessionStorage.removeItem(key); on = false; } } catch (e) { }
    var bar = document.getElementById('pf-bar'); if (!bar || !on || document.getElementById('pf-draft')) return;
    var d = document.createElement('span'); d.id = 'pf-draft'; d.className = 'pf-draft';
    d.textContent = PREVIEW ? '\uD83D\uDD0D PREVIEW of the new build' + (BUILD ? ' (' + BUILD + ')' : '') + ' with the master draft \u2014 students cannot open this page; it goes live from Platform Home \u2192 Content \u2192 New build.'
      : '\u270F\uFE0F Editing the MASTER DRAFT \u2014 students see the published version until you publish it (Platform Home \u2192 Content).';
    bar.appendChild(d);
  }
  function link(extra) {
    var a = document.createElement('a');
    a.className = 'pf-home' + (extra ? ' ' + extra : '');
    a.addEventListener('click', function () { apply(a); });   // always the current role, even if it changed meanwhile
    apply(a);
    return a;
  }
  function addHeader() {
    var hd = document.getElementById('app-header');
    if (!hd || document.getElementById('pf-bar')) return;
    var bar = document.createElement('div'); bar.id = 'pf-bar'; bar.className = 'pf-bar';
    bar.appendChild(link('')); hd.insertBefore(bar, hd.firstChild);
  }
  function addBoot() {
    var c = document.querySelector('#neo-boot .nb-card');
    if (c && !c.querySelector('.pf-home')) c.insertBefore(link('pf-boot'), c.firstChild);
    if (c && PREVIEW && !c.querySelector('.pf-prev')) {
      var n = document.createElement('p'); n.className = 'pf-prev';
      n.textContent = 'This is the preview of a new build of this module. It opens only for the platform administrator, from Platform Home \u2192 Content \u2192 New build \u2192 Open preview.';
      c.insertBefore(n, c.firstChild.nextSibling);
    }
  }
  /* ---- packaged releases ---- */
  /** Preview file: the sign-in check asks for the preview key (given only to the Admin's master-draft session);
   *  a student session is not used here at all, so students never reach the course. */
  function previewMode() {
    if (!window.fetch || !window.Response) return;
    var nf = window.fetch.bind(window);
    window.fetch = function (url, opt) {
      var p = null; try { p = opt && typeof opt.body === 'string' ? JSON.parse(opt.body) : null; } catch (e) { p = null; }
      if (p && p.action === 'studentSession') {
        if (p.stoken) return Promise.resolve(new Response(JSON.stringify({ ok: false, code: 'preview', error: 'This preview is only for the platform administrator.' }), { headers: { 'Content-Type': 'application/json' } }));
        p.preview = 1; opt = Object.assign({}, opt, { body: JSON.stringify(p) });
      }
      return nf(url, opt);
    };
  }
  /* ---- Teaching Sessions: the module's own Live Classroom / Attendance are hidden (platform setting) ---- */
  var FKEY = 'pf_flags_v1', HIDE = null;
  function moveToSessions() {
    var url = String(NC.backendUrl || ''), cached = null;
    try { cached = JSON.parse(localStorage.getItem(FKEY) || 'null'); } catch (e) { cached = null; }
    HIDE = cached ? cached.hide !== false : true;   // until the platform answers: the last known setting (default hidden)
    if (window.fetch && window.Response) {
      var nf = window.fetch.bind(window);
      window.fetch = function (u, opt) {   // the module's background Live Classroom checks: answered here while hidden
        if (HIDE) {
          var p = null; try { p = opt && typeof opt.body === 'string' ? JSON.parse(opt.body) : null; } catch (e) { p = null; }
          if (p && /^live/.test(String(p.action || ''))) {
            var body = p.action === 'liveSync' ? { ok: true, noChange: true, seq: Number(p.since) || 0, readVer: p.readVer || '', online: { teacherOnline: false, studentCount: 0, names: [], seenSeq: 0 }, typing: [], serverTime: Date.now(), nextPollMs: 300000, notifications: [], unread: 0 }
              : { ok: false, code: 'moved', error: 'The Live Classroom is now on your group page (Teaching Sessions).' };
            return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
          }
        }
        return nf(u, opt);
      };
    }
    css();
    if (!url || (cached && Date.now() - Number(cached.at || 0) < 300000)) return;
    try {
      fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ module: 'portal', action: 'portalModuleFlags' }) })
        .then(function (r) { return r.json(); }).then(function (r) {
          if (!r || !r.ok) return;
          HIDE = r.hideLiveAttendance !== false;
          try { localStorage.setItem(FKEY, JSON.stringify({ hide: HIDE, at: Date.now() })); } catch (e) { }
          css(); check();
        }).catch(function () { });
    } catch (e) { }
  }
  function css() {
    var st = document.getElementById('pf-hide');
    if (!HIDE) { if (st) st.remove(); var n = document.getElementById('pf-moved'); if (n) n.remove(); return; }
    if (st) return;
    st = document.createElement('style'); st.id = 'pf-hide';
    st.textContent = '[data-view="live"],[data-view="attendance"],a[href^="#/live"],a[href^="#/attendance"],.pf-hidden-tab{display:none!important}' +
      '.pf-moved{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;max-width:min(560px,calc(100% - 24px));background:#0f2a4a;color:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,.25);font:500 .92rem/1.45 system-ui,sans-serif}' +
      '.pf-moved a{color:#ffd166;font-weight:700}.pf-moved button{margin-left:10px;background:none;border:0;color:#fff;font-size:1.1rem;cursor:pointer}';
    (document.head || document.documentElement).appendChild(st);
  }
  /** An address of the hidden pages (old link, QR code, bookmark) → the module's start page + a short notice. */
  function check() {
    if (!HIDE) return;
    var hsh = String(location.hash || ''), teacher = !!(window.NEO_BOOT && window.NEO_BOOT.role === 'teacher');
    Array.prototype.forEach.call(document.querySelectorAll('.portal-tabs button.tab'), function (b) { if (/^\s*📋\s*Attendance\s*$/.test(b.textContent)) b.classList.add('pf-hidden-tab'); });
    var hit = /^#\/?(live|attendance)(\/|$|=)/.test(hsh) || /^#\/?(live|att)=/.test(hsh) || (teacher && /^#\/?teacher\/attendance/.test(hsh));
    if (!hit) return;
    location.replace(teacher ? '#/teacher' : '#/learn');
    if (document.getElementById('pf-moved')) return;
    var g = (function () { try { var m = /[?&]g=([A-Za-z0-9_-]{1,24})/.exec(location.search); return m ? m[1] : ''; } catch (e) { return ''; } })();
    var home = /^https:\/\/[^\s"'<>]+$/.test(HOME) ? HOME + (teacher ? '#/teacher' : (g ? '?g=' + encodeURIComponent(g) : '')) : '';
    var n = document.createElement('div'); n.id = 'pf-moved'; n.className = 'pf-moved'; n.setAttribute('role', 'status');
    n.appendChild(document.createTextNode(teacher ? 'Live Classroom and Attendance are now in the Teacher Dashboard → 🎓 Teaching Sessions. ' : 'Live Classroom and Attendance are now on your group page → 🎓 Teaching Sessions. '));
    if (home) { var a = document.createElement('a'); a.href = home; a.textContent = teacher ? 'Open the Teacher Dashboard' : 'Open my group page'; n.appendChild(a); }
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u2715'; x.onclick = function () { n.remove(); }; n.appendChild(x);
    (document.body || document.documentElement).appendChild(n);
    setTimeout(function () { if (n.parentNode) n.remove(); }, 15000);
  }
  window.addEventListener('hashchange', check);
  function fnv(v) { var s = JSON.stringify(v === undefined ? null : v), h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  /** IDs (+ fingerprints) of the packaged course — never its content. */
  function manifest() {
    var D; try { D = DATA; } catch (e) { return null; }   // the course data the app unlocked (a global of the app script)
    if (!D || !D.topics) return null;
    var m = { topics: {}, sections: {}, questions: {}, cases: {}, images: {}, other: {} };
    var ids = function (list, into, withHash) { (Array.isArray(list) ? list : []).forEach(function (x) { if (x && x.id != null) into[String(x.id)] = withHash ? fnv(x) : 1; }); };
    D.topics.forEach(function (t) { m.topics[String(t.id)] = fnv(t.sections || []); ids(t.sections, m.sections, true); });
    ids(D.questions, m.questions, true); ids(D.cases, m.cases, true);
    if (Array.isArray(D.images)) ids(D.images, m.images); else Object.keys(D.images || {}).forEach(function (k) { m.images[k] = 1; });
    ['figures', 'diagrams'].forEach(function (k) { Object.keys(D[k] || {}).forEach(function (id) { m.images[id] = 1; }); });
    ['glossary', 'comparisons', 'sequences'].forEach(function (k) { ids(D[k], m.other); });
    return { build: BUILD || String(D.buildTime || ''), buildTime: String(D.buildTime || ''), m: m };
  }
  var reported = false;
  function reportBuild() {
    if (reported || !draftOn()) return; reported = true;
    var B = window.NEO_BOOT || {}, mod = String(NC.moduleKey || B.module || ''), pfx = String(NC.storagePrefix || '');
    var x = manifest(); if (!x || !mod) return;
    var tok = null, url = NC.backendUrl;
    try { tok = (JSON.parse(localStorage.getItem(pfx + 'backend_token_v1') || 'null') || {}).token; url = JSON.parse(localStorage.getItem(pfx + 'backend_url_v1') || 'null') || url; } catch (e) { }
    if (!tok || !url) return;
    try { fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ module: mod, action: 'contentBuildManifest', token: tok, preview: PREVIEW, build: x.build, buildTime: x.buildTime, manifest: x.m }) }).catch(function () { }); } catch (e) { }
  }
  function init() {
    if (!document.getElementById('pf-css')) { var st = document.createElement('style'); st.id = 'pf-css'; st.textContent = CSS; document.head.appendChild(st); }
    addHeader(); addBoot();
    var mo = new MutationObserver(function () { if (!document.body.classList.contains('neo-locked')) { mo.disconnect(); applyAll(); check(); return; } addBoot(); });
    mo.observe(document.body, { childList: true, subtree: true });
    new MutationObserver(function () { if (HIDE && document.querySelector('.portal-tabs button.tab:not(.pf-hidden-tab)')) check(); }).observe(document.body, { childList: true, subtree: true });
    check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
