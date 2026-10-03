/* Shared front page of the Interactive Pathology Teaching Platform.
   • Shows every chapter/module with its status (Available · Completed – not yet released · Coming soon).
   • One student sign-in: the backend (Portal.gs) unlocks only the modules where this Student ID AND password belong
     to an active account of that module. Nothing here grants access: every check happens on the server.
   • "Open" hands the module's own student session to the module (same site, same browser), so the student does not
     sign in twice. Modules are not changed in any way; if a hand-over is not possible the module simply shows its
     own sign-in page.
   • Teacher panel (#/teacher): change the status, titles, links and order of modules, add new ones.
   No secrets are in this file. */
(function () {
  'use strict';
  var CFG = window.PORTAL_CONFIG || {};
  var KEY = 'pp_session_v1';
  var TKEY = 'pp_teacher_v1';
  var STATUS = {
    available: { label: 'Available', cls: 'available', icon: '●' },
    ready: { label: 'Completed – not yet released', cls: 'ready', icon: '◆' },
    soon: { label: 'Coming soon', cls: 'soon', icon: '○' }
  };
  var main = document.getElementById('main');
  var MODULES = [], INFO = null;

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function toast(t) { var e = h('<div class="toast" role="status">' + esc(t) + '</div>'); document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2800); }
  function store(remember) { try { return remember ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
  function sget(k) { var v = null; [store(false), store(true)].some(function (s) { try { v = s && s.getItem(k); } catch (e) { v = null; } return v; }); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sset(k, v, remember) { sdel(k); try { store(remember).setItem(k, JSON.stringify(v)); } catch (e) { } }
  function sdel(k) { [store(false), store(true)].forEach(function (s) { try { s && s.removeItem(k); } catch (e) { } }); }
  function backendOf(m) { return m.backend || CFG.backendUrl || ''; }
  function post(url, payload, opts) {
    if (!url) return Promise.resolve({ ok: false, code: 'config', error: 'The front page is not connected to the platform yet (config.js → backendUrl).' });
    return fetch(url, { method: 'POST', redirect: 'follow', cache: 'no-store', keepalive: !!(opts && opts.keepalive), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { return { ok: false, code: 'badjson', error: 'The platform did not answer correctly. Please try again later.' }; } })
      .catch(function () { return { ok: false, code: 'network', error: 'Cannot reach the platform. Check your internet connection and try again.' }; });
  }
  function session() { var s = sget(KEY); if (!s || !s.student) return null; if (s.expiresAt && Date.now() > s.expiresAt) { sdel(KEY); return null; } return s; }

  /* ---------------- module hand-over (the module's own session format; same site → same browser storage) ---------------- */
  function handoffKey(m) {
    if (m.handoff === 'neo' && m.storagePrefix) return m.storagePrefix + 'stu_session_v1';
    if (m.handoff === 'vp' && m.moduleKey) return 'vp_' + m.moduleKey + '_session';
    return '';
  }
  function handOver(m, acc, remember) {
    var k = handoffKey(m); if (!k || !acc || !acc.token) return;
    if (m.handoff === 'neo') sset(k, { token: acc.token, expiresAt: acc.expiresAt, url: backendOf(m), student: acc.student }, remember);
    else if (m.handoff === 'vp') sset(k, { role: 'student', stoken: acc.token, username: acc.student.username, name: acc.student.name, remember: !!remember }, remember);
  }

  /* ---------------- rendering ---------------- */
  function header() {
    $('.brand-t').textContent = CFG.title || 'Interactive Pathology Teaching Platform';
    $('.brand-s').textContent = CFG.subtitle || '';
    document.getElementById('foot').textContent = (CFG.title || '') + (CFG.author ? ' · ' + CFG.author : '') + (CFG.subtitle ? ' · ' + CFG.subtitle : '');
    var who = document.getElementById('who'), s = session();
    who.innerHTML = '';
    if (s) {
      who.appendChild(h('<span class="nm">👤 ' + esc(s.student.name || s.student.username) + '</span>'));
      var b = h('<button class="btn" type="button">Sign out</button>'); b.onclick = signOut; who.appendChild(b);
    }
  }
  function card(m, s) {
    var st = STATUS[m.status] || STATUS.soon, acc = s && s.modules ? s.modules[m.moduleKey] : null;
    var pill = '<span class="pill ' + st.cls + '">' + st.icon + ' ' + esc(st.label) + '</span>', msg = '', act = '', off = true;
    if (m.status === 'available') {
      if (!s) { msg = m.moduleKey ? 'Sign in to see whether this module is open for you.' : ''; if (!m.moduleKey && m.url) { act = '<a class="btn" href="' + esc(m.url) + '">Open</a>'; off = false; } }
      else if (!m.moduleKey) { if (m.url) { act = '<a class="btn" href="' + esc(m.url) + '">Open (sign in on the module)</a>'; off = false; } }
      else if (acc && acc.access) { pill = '<span class="pill available">✓ Available to you</span>'; act = '<button class="btn primary go" type="button">Open module →</button>'; off = false; if (acc.mustChange) msg = 'You will be asked to choose your own password first.'; }
      else if (acc && acc.reason === 'otherpassword') { pill = '<span class="pill warn">Registered — different password</span>'; msg = 'You have an account here, but with a different password. Sign in on the module itself.'; if (m.url) act = '<a class="btn" href="' + esc(m.url) + '">Go to its sign-in</a>'; off = false; }
      else if (acc && acc.reason === 'inactive') { pill = '<span class="pill locked">🔒 Account deactivated</span>'; msg = 'Your account for this module is deactivated. Please contact your teacher.'; }
      else if (acc && acc.reason === 'locked') { pill = '<span class="pill locked">🔒 Temporarily locked</span>'; msg = 'Too many wrong passwords on this module. Wait 15 minutes or ask your teacher to unlock it.'; }
      else if (acc && acc.reason === 'examlock') { pill = '<span class="pill locked">🔒 Closed during an exam</span>'; msg = acc.message || 'Closed while an official exam is running.'; }
      else if (acc && acc.reason === 'unreachable') { pill = '<span class="pill warn">Could not check</span>'; msg = 'This module\'s server could not be reached. Sign out and in again later.'; }
      else { pill = '<span class="pill locked">🔒 Not registered for your account</span>'; msg = 'This module is open, but your account has not been registered for it yet. Please contact your teacher.'; }
    } else if (m.status === 'ready') msg = 'This module is complete and will open when teaching starts.';
    else msg = 'In preparation.';
    var el = h('<article class="mod' + (off ? ' off' : '') + '" style="--c:' + esc(m.color) + '" data-id="' + esc(m.id) + '"><div class="ico" aria-hidden="true">' + esc(m.icon) + '</div><h3>' + esc(m.title) + '</h3>' + (m.subtitle ? '<div class="sub">' + esc(m.subtitle) + '</div>' : '') + pill +
      (msg ? '<div class="msg">' + esc(msg) + '</div>' : '') + (m.note ? '<div class="msg">' + esc(m.note) + '</div>' : '') + '<div class="act">' + act + '</div></article>');
    var go = $('.go', el);
    if (go) go.onclick = function () { handOver(m, acc, s.remember); location.href = m.url; };
    return el;
  }
  function viewHome() {
    var s = session();
    main.innerHTML = '';
    var hero = h('<section class="hero"><div class="grow"><h1>' + esc(CFG.title || 'Interactive Pathology Teaching Platform') + '</h1><p>' +
      (s ? 'Welcome, <b>' + esc(s.student.name || s.student.username) + '</b>. Modules marked <b>✓ Available to you</b> are open for your account.' : 'All pathology chapters in one place. Sign in with your Student ID and password to see which modules are open for you.') + '</p></div></section>');
    if (!s) hero.appendChild(signInForm());
    main.appendChild(hero);
    main.appendChild(h('<div class="legend"><span><span class="pill available">● Available</span> released to students</span><span><span class="pill ready">◆ Completed – not yet released</span> ready, teaching not started</span><span><span class="pill soon">○ Coming soon</span> in preparation</span></div>'));
    var grid = h('<div class="grid" aria-label="Modules"></div>');
    MODULES.forEach(function (m) { grid.appendChild(card(m, s)); });
    if (!MODULES.length) grid.appendChild(h('<p class="muted">No modules yet.</p>'));
    main.appendChild(grid);
    main.appendChild(h('<p class="small muted" style="margin-top:22px">Teacher? <a href="#/teacher">Manage modules</a></p>'));
  }
  function signInForm() {
    var f = h('<form class="card signin" novalidate><h2>Student sign-in</h2><label>Student ID<input id="p-u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Password<input id="p-p" type="password" autocomplete="current-password" required></label><label class="chk"><input id="p-r" type="checkbox"> Keep me signed in on this device</label><p class="err" role="alert"></p><button class="btn primary full" type="submit">Sign in</button><p class="small muted" style="margin:8px 0 0">Use the Student ID and password your teacher gave you. Forgotten? Ask your teacher to reset it.</p></form>');
    f.onsubmit = function (e) {
      e.preventDefault();
      var u = $('#p-u', f).value.trim(), p = $('#p-p', f).value, r = $('#p-r', f).checked, err = $('.err', f), btn = $('button[type=submit]', f);
      if (!u || !p) { err.textContent = 'Enter your Student ID and password.'; return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
      signIn(u, p, r).then(function (x) {
        btn.disabled = false; btn.textContent = 'Sign in';
        if (!x.ok) { err.textContent = x.error; $('#p-p', f).select(); return; }
        header(); viewHome();
      });
    };
    setTimeout(function () { var i = $('#p-u', f); if (i && !location.hash.replace(/^#\/?/, '')) i.focus(); }, 0);
    return f;
  }
  /** Asks each backend about its own released modules (in parallel) and merges the answers. */
  function signIn(u, p, remember) {
    var byBackend = {};
    MODULES.forEach(function (m) { if (m.status === 'available' && m.moduleKey) (byBackend[backendOf(m)] = byBackend[backendOf(m)] || []).push(m.moduleKey); });
    var urls = Object.keys(byBackend);
    if (!urls.length) return Promise.resolve({ ok: false, error: 'No module is open for students yet.' });
    return Promise.all(urls.map(function (url) { return post(url, { module: 'portal', action: 'portalCheck', username: u, password: p, remember: remember, modules: byBackend[url] }); })).then(function (rs) {
      var mods = {}, student = null, firstErr = null, exp = 0;
      rs.forEach(function (r, i) {
        if (r && r.ok) { student = student || r.student; Object.keys(r.modules || {}).forEach(function (k) { mods[k] = r.modules[k]; if (r.modules[k].expiresAt) exp = Math.max(exp, r.modules[k].expiresAt); }); }
        else {
          if (!firstErr || (r && r.code === 'locked')) firstErr = r;
          if (r && (r.code === 'network' || r.code === 'badjson' || r.code === 'badaction')) byBackend[urls[i]].forEach(function (k) { mods[k] = { access: false, reason: 'unreachable' }; });
          else byBackend[urls[i]].forEach(function (k) { if (!mods[k]) mods[k] = { access: false, reason: 'notregistered' }; });
        }
      });
      if (!student) return { ok: false, error: (firstErr && firstErr.error) || 'Sign-in failed.' };
      sset(KEY, { student: student, modules: mods, remember: remember, at: Date.now(), expiresAt: exp || Date.now() + 12 * 3600000 }, remember);
      return { ok: true };
    });
  }
  function signOut() {
    var s = session();
    if (s) MODULES.forEach(function (m) {
      var acc = s.modules && s.modules[m.moduleKey];
      if (acc && acc.token) { post(backendOf(m), { module: m.moduleKey, action: 'studentLogout', stoken: acc.token }, { keepalive: true }); var k = handoffKey(m); if (k) sdel(k); }
    });
    sdel(KEY); header(); viewHome(); toast('You have signed out.');
  }

  /* ---------------- teacher panel ---------------- */
  function tsess() { var t = sget(TKEY); return t && t.token && (!t.exp || t.exp > Date.now()) ? t.token : null; }
  function viewTeacher() {
    main.innerHTML = '<p class="small"><a href="#/">← Front page</a></p><h1 style="color:var(--navy);margin:0 0 12px">Manage modules</h1>';
    var tok = tsess();
    if (!tok) return main.appendChild(teacherLogin());
    var box = h('<div><p class="muted">Loading…</p></div>'); main.appendChild(box);
    post(CFG.backendUrl, { module: 'portal', action: 'portalAdminGet', token: tok }).then(function (r) {
      if (!r.ok) { if (r.code === 'auth') { sdel(TKEY); return viewTeacher(); } box.innerHTML = '<p class="err">' + esc(r.error) + '</p>'; return; }
      editor(box, r);
    });
  }
  function teacherLogin() {
    var setup = INFO && !INFO.hasTeacher;
    var f = h('<form class="card" style="max-width:420px" novalidate><h2 style="margin-top:0;color:var(--navy);font-size:18px">' + (setup ? 'Create the front-page teacher password' : 'Teacher sign-in') + '</h2><p class="small muted">' +
      (setup ? 'The front page has its own teacher password (at least 8 characters). It only manages this page — module teacher passwords are unchanged.' : 'The front-page teacher password (module “portal” on the platform backend).') + '</p>' +
      '<label>Password<input id="t-p" type="password" autocomplete="' + (setup ? 'new-password' : 'current-password') + '"></label>' + (setup ? '<label>Repeat it<input id="t-p2" type="password" autocomplete="new-password"></label>' : '') +
      '<p class="err" role="alert"></p><button class="btn primary full" type="submit">' + (setup ? 'Create password' : 'Sign in') + '</button></form>');
    f.onsubmit = function (e) {
      e.preventDefault();
      var pw = $('#t-p', f).value, err = $('.err', f);
      if (setup) {
        if (pw.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
        if (pw !== $('#t-p2', f).value) { err.textContent = 'The two passwords are different.'; return; }
        return post(CFG.backendUrl, { module: 'portal', action: 'setup', password: pw }).then(function (r) { if (!r.ok) { err.textContent = r.error; return; } INFO.hasTeacher = true; login(); });
      }
      login();
      function login() {
        post(CFG.backendUrl, { module: 'portal', action: 'login', password: pw }).then(function (r) {
          if (!r.ok) { err.textContent = r.error || 'Sign-in failed.'; return; }
          sset(TKEY, { token: r.token, exp: r.expiresAt }, false); viewTeacher();
        });
      }
    };
    return f;
  }
  var FIELDS = [
    ['title', 'Title'], ['subtitle', 'Subtitle'], ['icon', 'Icon (emoji)'], ['color', 'Colour', 'color'], ['url', 'Link (https://…)'], ['note', 'Note on the card (optional)']
  ];
  var ADV = [
    ['id', 'Id (unique, letters/digits)'], ['moduleKey', 'Backend module key (student accounts)'], ['handoff', 'Open students straight in', 'select', [['neo', 'Platform modules (Cell Injury, Inflammation…)'], ['vp', 'New-edition sites (vp_<key>_session)'], ['link', 'No — student signs in on the module']]],
    ['storagePrefix', 'Storage prefix (platform modules, e.g. ci_)'], ['backend', 'Other backend URL (empty = this platform backend)']
  ];
  function editor(box, r) {
    var list = r.modules.map(function (m) { return JSON.parse(JSON.stringify(m)); }), counts = r.counts || {};
    box.innerHTML = '';
    box.appendChild(h('<div class="note" style="margin-bottom:14px"><b>Status is only what students see.</b> A student can enter a module only if their account is registered for it (Students in that module\'s Teacher portal). “Available” never opens a module to students without an account.</div>'));
    var rows = h('<div></div>'); box.appendChild(rows);
    var bar = h('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn add" type="button">＋ Add a module</button><span style="flex:1"></span><button class="btn out" type="button">Sign out</button><button class="btn primary save" type="button">💾 Save changes</button></div>');
    box.appendChild(bar);
    function draw() {
      rows.innerHTML = '';
      list.forEach(function (m, i) {
        var n = counts[m.moduleKey];
        var el = h('<section class="modrow" style="--c:' + esc(m.color) + '"><div class="hd"><span style="font-size:22px">' + esc(m.icon) + '</span><b>' + esc(m.title) + '</b>' +
          (m.moduleKey ? '<span class="small muted">' + (n != null ? n + ' active student account(s)' : (m.backend ? 'accounts on another backend' : 'no accounts yet')) + '</span>' : '') + '<span class="sp"></span>' +
          '<label style="margin:0">Status <select data-k="status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (m.status === k ? ' selected' : '') + '>' + esc(STATUS[k].label) + '</option>'; }).join('') + '</select></label>' +
          '<button class="btn" data-a="up" type="button" title="Move up"' + (i ? '' : ' disabled') + '>↑</button><button class="btn" data-a="dn" type="button" title="Move down"' + (i < list.length - 1 ? '' : ' disabled') + '>↓</button><button class="btn danger" data-a="rm" type="button">Remove</button></div>' +
          '<div class="rowed">' + FIELDS.map(function (f) { return '<label>' + esc(f[1]) + '<input data-k="' + f[0] + '"' + (f[2] === 'color' ? ' type="color"' : '') + '></label>'; }).join('') + '</div>' +
          '<details class="adv"><summary>Advanced (connection to the module)</summary><div class="rowed">' + ADV.map(function (f) {
            return '<label>' + esc(f[1]) + (f[2] === 'select' ? '<select data-k="' + f[0] + '">' + f[3].map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>' : '<input data-k="' + f[0] + '">') + '</label>';
          }).join('') + '</div></details></section>');
        $$('[data-k]', el).forEach(function (inp) { inp.value = m[inp.dataset.k] == null ? '' : m[inp.dataset.k]; inp.oninput = inp.onchange = function () { m[inp.dataset.k] = inp.value; if (inp.dataset.k === 'color') el.style.setProperty('--c', inp.value); }; });
        el.onclick = function (e) {
          var a = e.target.dataset.a; if (!a) return;
          if (a === 'up' && i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); }
          if (a === 'dn' && i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); }
          if (a === 'rm' && window.confirm('Remove “' + m.title + '” from the front page? (The module itself and its accounts are not touched.)')) { list.splice(i, 1); draw(); }
        };
        rows.appendChild(el);
      });
    }
    $('.add', bar).onclick = function () { list.push({ id: 'module' + (list.length + 1), title: 'New module', subtitle: '', icon: '📘', color: '#0f2a4a', status: 'soon', url: '', moduleKey: '', handoff: 'link', storagePrefix: '', backend: '', note: '' }); draw(); rows.lastChild.scrollIntoView({ behavior: 'smooth' }); };
    $('.out', bar).onclick = function () { var t = tsess(); if (t) post(CFG.backendUrl, { module: 'portal', action: 'logout', token: t }); sdel(TKEY); location.hash = '#/'; };
    $('.save', bar).onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      post(CFG.backendUrl, { module: 'portal', action: 'portalAdminSave', token: tsess(), modules: list }).then(function (x) {
        btn.disabled = false; btn.textContent = '💾 Save changes';
        if (!x.ok) { if (x.code === 'auth') { sdel(TKEY); return viewTeacher(); } toast(x.error); return; }
        list = x.modules; MODULES = x.modules; draw(); toast('Saved. Students see the new list when they open or reload the front page.');
      });
    };
    draw();
  }

  /* ---------------- start ---------------- */
  function route() { header(); if (/^#\/teacher/.test(location.hash)) viewTeacher(); else viewHome(); window.scrollTo(0, 0); }
  function boot() {
    header();
    post(CFG.backendUrl, { module: 'portal', action: 'portalInfo' }).then(function (r) {
      if (!r.ok) { main.innerHTML = '<div class="card"><p class="err">' + esc(r.code === 'badaction' || r.code === 'badjson' ? 'The platform backend does not have the front-page file (Portal.gs) yet — see SETUP.md.' : r.error) + '</p><button class="btn primary" type="button">Try again</button></div>'; $('button', main).onclick = boot; return; }
      INFO = r; MODULES = r.modules || [];
      window.addEventListener('hashchange', route); route();
    });
  }
  window.__portal = { handoffKey: handoffKey };
  boot();
})();
