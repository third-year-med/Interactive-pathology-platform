/* Shared front page of the Interactive Pathology Teaching Platform.
   • Shows every chapter/module with its status (Available · Completed – not yet released · Coming soon).
   • One student sign-in: the backend (Portal.gs) unlocks only the modules where this Student ID AND password belong
     to an active account of that module. Nothing here grants access: every check happens on the server.
   • "Open" hands the module's own student session to the module (same site, same browser), so the student does not
     sign in twice. Modules are not changed in any way; if a hand-over is not possible the module simply shows its
     own sign-in page.
   • Teacher Sign-In (#/teacher): ONE teacher account (module "portal" on the platform backend) → Teacher Dashboard:
       Teaching Modules   — open any module directly in teacher mode (the backend creates that module's own teacher
                            session for the signed-in teacher; no second password, no student account needed);
       Teacher Management — the front-page list (status, titles, links, order, add/remove) and, per module, its
                            Teacher Portal (students, content, results…).
   No secrets are in this file. */
(function () {
  'use strict';
  var CFG = window.PORTAL_CONFIG || {};
  /* Group front page (…/?g=<link code>): the code only SELECTS the group; the backend decides everything. */
  var GROUP = (function () { try { var m = /[?&]g=([A-Za-z0-9_-]{1,24})/.exec(location.search); return m ? m[1] : ''; } catch (e) { return ''; } })();
  var GINFO = null, GROUP_NOTICE = '';
  var KEY = 'pp_session_v1' + (GROUP ? ':' + GROUP : '');   // a group page keeps its own student session
  var TKEY = 'pp_teacher_v1';
  var STATUS = {
    available: { label: 'Available', cls: 'available', icon: '●' },
    ready: { label: 'Completed – not yet released', cls: 'ready', icon: '◆' },
    soon: { label: 'Coming soon', cls: 'soon', icon: '○' },
    closed: { label: 'Closed', cls: 'locked', icon: '■' }
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
  function storageOf(m) { return m.moduleKey + (m.group ? '-' + m.group : ''); }   // the module's backend name for this page
  function mUrl(m) { return withGroup(m.url, m.group); }
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
    if (m.handoff === 'neo' && m.storagePrefix) return m.storagePrefix + (m.group ? m.group + '_' : '') + 'stu_session_v1';
    if (m.handoff === 'vp' && m.moduleKey) return 'vp_' + m.moduleKey + '_session';
    return '';
  }
  function handOver(m, acc, remember) {
    var k = handoffKey(m); if (!k || !acc || !acc.token) return;
    // no "url" field: the module then uses its own backend address (it rejects a session whose recorded address differs
    // from its configuration, which would silently send the student back to the module's sign-in page); the session
    // token itself is still verified by that backend.
    if (m.handoff === 'neo') sset(k, { token: acc.token, expiresAt: acc.expiresAt, student: acc.student }, remember);
    else if (m.handoff === 'vp') sset(k, { role: 'student', stoken: acc.token, username: acc.student.username, name: acc.student.name, remember: !!remember }, remember);
  }

  /* ---------------- rendering ---------------- */
  var CREATED = CFG.createdBy || 'Created by Dr. Wesam Alzwawy';
  var PENDING = null;   // module the student clicked before signing in (opened after a successful sign-in)
  /* pathology-themed icons for the known chapters (other modules use their emoji) */
  var ICONS = {
    cellinjury: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="currentColor" opacity=".14"/><path d="M24 7a17 17 0 1 1-12 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="3 4"/><circle cx="22" cy="23" r="6.5" fill="currentColor" opacity=".85"/><path d="M33 13l-4 5 3 1-4 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34" cy="31" r="2" fill="currentColor"/><circle cx="14" cy="32" r="1.6" fill="currentColor"/></svg>',
    inflhealing: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="currentColor" opacity=".14"/><path d="M24 9c5 6 10 10 10 17a10 10 0 0 1-20 0c0-4 2-7 4-9 0 3 1 5 3 6 0-6 1-10 3-14z" fill="currentColor" opacity=".85"/><path d="M20 30a4 4 0 0 0 8 0c0-2-1-3-2-4 0 1-1 2-2 2 0-2 0-3-1-4-2 2-3 4-3 6z" fill="#fff" opacity=".9"/></svg>'
  };
  function iconHtml(m) { return ICONS[m.id] || ICONS[m.moduleKey] || '<span class="emo">' + esc(m.icon) + '</span>'; }
  function descOf(m) { return m.note || (CFG.descriptions || {})[m.id] || ''; }
  function header() {
    $('.brand-t').textContent = CFG.title || 'Interactive Pathology Teaching Platform';
    $('.brand-s').textContent = CREATED;
    document.getElementById('foot').innerHTML = '<span>' + esc(CFG.title || 'Interactive Pathology Teaching Platform') + '</span><span>' + esc(CREATED) + '</span>';
    var who = document.getElementById('who'), s = session(), teacherView = /^#\/teacher/.test(location.hash);
    who.innerHTML = '';
    var tLabel = teacherView ? 'Platform Home' : (tsess() ? 'Teacher Dashboard' : 'Teacher Sign-In');
    var tp = h('<a class="btn tportal" href="' + (teacherView ? '#/' : (GROUP ? esc(location.pathname) : '') + '#/teacher') + '"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3l9 4-9 4-9-4 9-4z" fill="currentColor"/><path d="M6 9.5V14c0 1.7 2.7 3 6 3s6-1.3 6-3V9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M21 7v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>' + tLabel + '</span></a>');
    who.appendChild(tp);
    if (teacherView && tsess()) { var tb = h('<button class="btn ghost" type="button">Sign out</button>'); tb.onclick = teacherSignOut; who.appendChild(tb); }
    if (s && !teacherView) {
      who.appendChild(h('<span class="nm" title="Signed in">👤 ' + esc(s.student.name || s.student.username) + '</span>'));
      var b = h('<button class="btn ghost" type="button">Sign out</button>'); b.onclick = signOut; who.appendChild(b);
    }
  }
  function card(m, s) {
    var st = STATUS[m.status] || STATUS.soon, acc = s && s.modules ? s.modules[m.moduleKey] : null;
    var state = 'locked', pill = '<span class="pill ' + st.cls + '">' + st.icon + ' ' + esc(st.label) + '</span>', msg = '', cta = '', alt = '';
    if (m.status === 'available') {
      if (!s) {
        state = 'open';
        msg = m.moduleKey ? 'Sign in with your Student ID to open this module.' : 'Open the module and sign in there.';
        cta = m.moduleKey ? '<button class="btn primary signfirst" type="button">Sign in to open</button>' : '<a class="btn primary" href="' + esc(mUrl(m)) + '">Open module →</a>';
        if (m.moduleKey) alt = '<a class="alt" href="' + esc(mUrl(m)) + '">or use the module’s own sign-in page</a>';
      }
      else if (!m.moduleKey) { state = 'open'; cta = '<a class="btn primary" href="' + esc(mUrl(m)) + '">Open module →</a>'; msg = 'You will sign in on the module itself.'; }
      else if (acc && acc.access) { state = 'mine'; pill = '<span class="pill mine">✓ Available to you</span>'; cta = '<button class="btn primary go" type="button">Open module →</button>'; msg = acc.mustChange ? 'You will be asked to choose your own password first.' : 'Your account is registered for this module.'; }
      else if (acc && acc.reason === 'otherpassword') { state = 'open'; pill = '<span class="pill warn">Registered — different password</span>'; msg = 'You have an account here, but with a different password.'; cta = '<a class="btn" href="' + esc(mUrl(m)) + '">Go to the module’s sign-in</a>'; }
      else if (acc && acc.reason === 'inactive') { pill = '<span class="pill locked">🔒 Account deactivated</span>'; msg = 'Your account for this module is deactivated. Please contact your teacher.'; }
      else if (acc && acc.reason === 'locked') { pill = '<span class="pill locked">🔒 Temporarily locked</span>'; msg = 'Too many wrong passwords on this module. Wait 15 minutes or ask your teacher to unlock it.'; }
      else if (acc && acc.reason === 'examlock') { pill = '<span class="pill locked">🔒 Closed during an exam</span>'; msg = acc.message || 'Closed while an official exam is running.'; }
      else if (acc && acc.reason === 'unreachable') { pill = '<span class="pill warn">Could not check</span>'; msg = 'This module’s server could not be reached. Sign out and in again later.'; cta = '<a class="btn" href="' + esc(mUrl(m)) + '">Try the module’s sign-in</a>'; state = 'open'; }
      else { pill = '<span class="pill locked">🔒 Not registered for your account</span>'; msg = 'This module is open, but your account has not been registered for it yet. Please contact your teacher.'; }
      if (!cta) cta = '<button class="btn" type="button" disabled>🔒 Not available for your account</button>';
      if (!m.url && (state === 'mine' || state === 'open')) { state = 'locked'; alt = ''; msg = 'The link to this module has not been set yet (Teacher Dashboard → Teacher Management).'; cta = '<button class="btn" type="button" disabled>Link not set</button>'; }
    } else if (m.status === 'ready') { msg = m.opensAt ? 'Opens on ' + new Date(m.opensAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + '.' : 'This module is complete and will open when teaching starts.'; cta = '<button class="btn" type="button" disabled>Not yet released</button>'; }
    else if (m.status === 'closed') { msg = 'This module is closed for your group.'; cta = '<button class="btn" type="button" disabled>Closed</button>'; }
    else { msg = 'This chapter is in preparation.'; cta = '<button class="btn" type="button" disabled>Coming soon</button>'; }
    var d = descOf(m);
    var el = h('<article class="mod ' + state + ' st-' + esc(m.status) + '" style="--c:' + esc(m.color) + '" data-id="' + esc(m.id) + '">' +
      '<div class="mod-top"><div class="mod-ico">' + iconHtml(m) + '</div>' + pill + '</div>' +
      '<div class="mod-body">' + (m.subtitle ? '<div class="cat">' + esc(m.subtitle) + '</div>' : '') + '<h3>' + esc(m.title) + '</h3>' + (d ? '<p class="desc">' + esc(d) + '</p>' : '') +
      (msg ? '<p class="msg">' + esc(msg) + '</p>' : '') + '<div class="act">' + cta + '</div>' + alt + '</div></article>');
    var go = $('.go', el);
    if (go) {
      var open = function () { openModule(m, acc, s.remember); };
      go.onclick = function (e) { e.stopPropagation(); open(); };
      el.addEventListener('click', function (e) { if (!e.target.closest('a,button')) open(); });
    }
    var sf = $('.signfirst', el);
    if (sf) sf.onclick = function () { PENDING = m.id; var f = $('form.signin'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.classList.add('pulse'); setTimeout(function () { f.classList.remove('pulse'); }, 1200); var i = $('#p-u', f); if (i) i.focus({ preventScroll: true }); var n = $('.pending', f); if (n) n.textContent = 'Sign in to open “' + m.title + '”.'; } };
    return el;
  }
  /** Opens a module the student may enter: hands over the module's own session, then goes to the module. */
  function openModule(m, acc, remember) {
    if (!m.url) { toast('The link to this module has not been set yet.'); return; }
    handOver(m, acc, remember);
    location.href = mUrl(m);
  }
  function viewHome() {
    var s = session();
    main.innerHTML = '';
    var avail = MODULES.filter(function (m) { return m.status === 'available'; }).length;
    var mine = s ? MODULES.filter(function (m) { var a = s.modules && s.modules[m.moduleKey]; return m.status === 'available' && a && a.access; }).length : 0;
    var note = ''; try { note = sessionStorage.getItem('pp_note') || ''; sessionStorage.removeItem('pp_note'); } catch (e) { }
    var shown = GROUP_NOTICE || (GINFO ? note : '');   // the redirect note is shown once
    if (shown) main.appendChild(h('<div class="note grp-notice" role="status">' + esc(shown) + '</div>'));
    var gh = GINFO ? '<p class="grp"><span class="grp-inst">' + esc(GINFO.institution.name) + '</span><span class="grp-name">' + esc(GINFO.group.name) + (GINFO.group.academicYear ? ' · ' + esc(GINFO.group.academicYear) : '') + '</span></p>' : '';
    var hero = h('<section class="hero"><div class="hero-txt"><div class="eyebrow">' + (GINFO ? esc(GINFO.institution.shortName || GINFO.institution.name) + ' · Pathology' : 'Medical education · Pathology') + '</div><h1>' + esc(CFG.title || 'Interactive Pathology Teaching Platform') + '</h1>' + gh + '<p class="by">' + esc(CREATED) + '</p>' +
      '<p class="lead">Interactive lectures, practice questions, case-based learning and assessments for every pathology chapter, in one place.</p>' +
      '<ul class="facts"><li><b>' + MODULES.length + '</b> chapter' + (MODULES.length === 1 ? '' : 's') + '</li><li><b>' + avail + '</b> available now</li><li>🔒 Secure student sign-in</li></ul></div><div class="hero-side"></div></section>');
    var side = $('.hero-side', hero);
    if (s) side.appendChild(h('<div class="card welcome"><div class="small muted">Signed in as</div><div class="wname">' + esc(s.student.name || s.student.username) + '</div><div class="small muted">Student ID ' + esc(s.student.username) + '</div><p>You can open <b>' + mine + '</b> of the ' + avail + ' available module' + (avail === 1 ? '' : 's') + '.</p><p class="small muted">Modules not registered for your account stay locked — ask your teacher if one is missing.</p></div>'));
    else side.appendChild(signInForm());
    main.appendChild(hero);
    main.appendChild(h('<div class="sec-head"><h2>' + (GINFO ? 'Modules for ' + esc(GINFO.group.name) : 'Pathology modules') + '</h2><div class="legend"><span class="pill available">● Available</span><span class="pill ready">◆ Completed – not yet released</span><span class="pill soon">○ Coming soon</span>' + (MODULES.some(function (m) { return m.status === 'closed'; }) ? '<span class="pill locked">■ Closed</span>' : '') + '</div></div>'));
    var grid = h('<div class="grid" aria-label="Pathology modules"></div>');
    MODULES.forEach(function (m) { grid.appendChild(card(m, s)); });
    if (!MODULES.length) grid.appendChild(h('<p class="muted">No modules yet.</p>'));
    main.appendChild(grid);
  }
  function signInForm() {
    var f = h('<form class="card signin" novalidate><h2>Student sign-in</h2><p class="pending small"></p><label>Student ID<input id="p-u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Password<input id="p-p" type="password" autocomplete="current-password" required></label><label class="chk"><input id="p-r" type="checkbox"> Keep me signed in on this device</label><p class="err" role="alert"></p><button class="btn primary full" type="submit">Sign in</button><p class="small muted" style="margin:10px 0 0">Use the Student ID and password your teacher gave you. Forgotten? Ask your teacher to reset it.</p></form>');
    f.onsubmit = function (e) {
      e.preventDefault();
      var u = $('#p-u', f).value.trim(), p = $('#p-p', f).value, r = $('#p-r', f).checked, err = $('.err', f), btn = $('button[type=submit]', f);
      if (!u || !p) { err.textContent = 'Enter your Student ID and password.'; return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
      signIn(u, p, r).then(function (x) {
        btn.disabled = false; btn.textContent = 'Sign in';
        if (!x.ok && x.code === 'groupmember') return toGroupPage(f, x.groups, u, p, r);
        if (!x.ok) { err.textContent = x.error + (GINFO || x.code === 'locked' ? '' : ' If your teacher gave you a group link (ending in ?g=…), please sign in on that page.'); $('#p-p', f).select(); return; }
        if (x.mustChange && GINFO) return choosePassword(f, u, p, r);   // a temporary password: choose your own first (all modules)
        afterSignIn();
      });
    };
    return f;
  }
  /** The main page was used by a group student (right password): sign them in on their group page and go there. */
  function toGroupPage(f, groups, u, p, remember) {
    var label = function (x) { return x.institution + ' · ' + x.group + (x.academicYear ? ' (' + x.academicYear + ')' : ''); };
    if (groups.length > 1) {
      f.innerHTML = '<h2>Choose your group</h2><p class="small muted">Your Student ID belongs to these groups. Open your group\'s page and sign in there:</p>' +
        groups.map(function (x) { return '<a class="btn full grp-pick" href="' + esc(groupUrl(x.g)) + '">' + esc(label(x)) + ' →</a>'; }).join('');
      return;
    }
    var x = groups[0];
    $('.err', f).textContent = ''; $('button[type=submit]', f).disabled = true; $('button[type=submit]', f).textContent = 'Opening ' + label(x) + '…';
    groupSignIn(x.g, u, p, remember).then(function (r) {
      var go = function () { location.href = groupUrl(x.g); };
      if (r.ok && r.mustChange) { sdel('pp_session_v1:' + x.g); return choosePassword(f, u, p, remember, x.g, go); }   // choose a password first
      try { sessionStorage.setItem('pp_note', r.ok ? '' : 'Please sign in here, on your group\'s page.'); } catch (e) { }
      go();
    });
  }
  /** Group page, first sign-in with a temporary password: the student chooses a password, set in all of the group's modules. */
  function choosePassword(f, u, oldPw, remember, code, after) {
    code = code || GINFO.group.linkCode; after = after || afterSignIn;
    f.innerHTML = '<h2>Choose your own password</h2><p class="small muted">For your security, choose a new password before you continue (at least 8 characters, not your Student ID). It will be used for all your modules.</p>' +
      '<label>New password<input id="p-n1" type="password" autocomplete="new-password"></label><label>Repeat new password<input id="p-n2" type="password" autocomplete="new-password"></label><p class="err" role="alert"></p><button class="btn primary full" type="submit">Save and continue</button>';
    var err = $('.err', f), btn = $('button', f);
    setTimeout(function () { var i = $('#p-n1', f); if (i) i.focus(); }, 30);
    f.onsubmit = function (e) {
      e.preventDefault();
      var n1 = $('#p-n1', f).value, n2 = $('#p-n2', f).value;
      if (n1.length < 8) { err.textContent = 'The new password must be at least 8 characters.'; return; }
      if (n1 !== n2) { err.textContent = 'The two passwords are different.'; return; }
      btn.disabled = true; err.textContent = '';
      post(CFG.backendUrl, { module: 'portal', action: 'portalGroupSetPassword', g: code, username: u, password: oldPw, newPassword: n1 }).then(function (r) {
        if (!r.ok) { btn.disabled = false; err.textContent = r.error || 'Could not change the password.'; return; }
        return groupSignIn(code, u, n1, remember).then(function (x) {
          btn.disabled = false;
          if (!x.ok) { err.textContent = x.error; return; }
          toast('Password saved. Use it for all your modules.');
          after();
        });
      });
    };
  }
  /** After a successful sign-in: open the module the student clicked first (if allowed), otherwise show the page. */
  function afterSignIn() {
    var want = PENDING; PENDING = null;
    if (want) {
      var m = MODULES.filter(function (y) { return y.id === want; })[0], s = session(), acc = m && s.modules[m.moduleKey];
      if (m && acc && acc.access) return openModule(m, acc, s.remember);
      if (m) toast('“' + m.title + '” is not registered for your account.');
    }
    header(); viewHome();
  }
  /** Asks each backend about its own released modules (in parallel) and merges the answers. */
  /** Sign-in on a group page (code = link code); the session is kept under that group's own key. */
  function groupSignIn(code, u, p, remember) {
    return post(CFG.backendUrl, { module: 'portal', action: 'portalGroupCheck', g: code, username: u, password: p, remember: remember }).then(function (r) {
      if (!r || !r.ok) return { ok: false, code: r && r.code, error: (r && r.error) || 'Sign-in failed.' };
      var mods = r.modules || {}, exp = 0;
      Object.keys(mods).forEach(function (k) { if (mods[k].expiresAt) exp = Math.max(exp, mods[k].expiresAt); });
      if (GINFO) MODULES.forEach(function (m) { if (m.status === 'available' && !mods[m.moduleKey]) mods[m.moduleKey] = { access: false, reason: 'notregistered' }; });
      sset('pp_session_v1:' + code, { student: r.student, modules: mods, remember: remember, at: Date.now(), expiresAt: exp || Date.now() + 12 * 3600000 }, remember);
      return { ok: true, mustChange: Object.keys(mods).some(function (k) { return mods[k].access && mods[k].mustChange; }) };
    });
  }
  function groupUrl(code) { return location.pathname + '?g=' + encodeURIComponent(code); }
  function signIn(u, p, remember) {
    if (GINFO) return groupSignIn(GINFO.group.linkCode, u, p, remember);
    var byBackend = {};
    MODULES.forEach(function (m) { if (m.status === 'available' && m.moduleKey) (byBackend[backendOf(m)] = byBackend[backendOf(m)] || []).push(m.moduleKey); });
    var urls = Object.keys(byBackend);
    if (!urls.length) return Promise.resolve({ ok: false, error: 'No module is open for students yet.' });
    return Promise.all(urls.map(function (url) { return post(url, { module: 'portal', action: 'portalCheck', username: u, password: p, remember: remember, modules: byBackend[url] }); })).then(function (rs) {
      var mods = {}, student = null, firstErr = null, exp = 0, groups = null;
      rs.forEach(function (r, i) {
        if (r && r.code === 'groupmember') { groups = r.groups || []; return; }
        if (r && r.ok) { student = student || r.student; Object.keys(r.modules || {}).forEach(function (k) { mods[k] = r.modules[k]; if (r.modules[k].expiresAt) exp = Math.max(exp, r.modules[k].expiresAt); }); }
        else {
          if (!firstErr || (r && r.code === 'locked')) firstErr = r;
          if (r && (r.code === 'network' || r.code === 'badjson' || r.code === 'badaction')) byBackend[urls[i]].forEach(function (k) { mods[k] = { access: false, reason: 'unreachable' }; });
          else byBackend[urls[i]].forEach(function (k) { if (!mods[k]) mods[k] = { access: false, reason: 'notregistered' }; });
        }
      });
      if (!student && groups && groups.length) return { ok: false, code: 'groupmember', groups: groups };
      if (!student) return { ok: false, code: firstErr && firstErr.code, error: (firstErr && firstErr.error) || 'Sign-in failed.' };
      sset(KEY, { student: student, modules: mods, remember: remember, at: Date.now(), expiresAt: exp || Date.now() + 12 * 3600000 }, remember);
      return { ok: true };
    });
  }
  function signOut() {
    var s = session();
    if (s) MODULES.forEach(function (m) {
      var acc = s.modules && s.modules[m.moduleKey];
      if (acc && acc.token) { post(backendOf(m), { module: storageOf(m), action: 'studentLogout', stoken: acc.token }, { keepalive: true }); var k = handoffKey(m); if (k) sdel(k); }
    });
    sdel(KEY); header(); viewHome(); toast('You have signed out.');
  }

  /* ---------------- teacher: one sign-in → Teacher Dashboard ---------------- */
  function tget() { var t = sget(TKEY); return t && t.token && (!t.exp || t.exp > Date.now()) ? t : null; }
  function tsess() { var t = tget(); return t ? t.token : null; }
  function lsGet(k) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { } }
  /** Modules the teacher can enter straight from the dashboard: platform modules on this backend. */
  function teacherDirect(m) { return !!(m.url && m.moduleKey && m.handoff === 'neo' && m.storagePrefix && (!m.backend || m.backend === CFG.backendUrl)); }
  /* Group links (?g=TAG): the module then uses module "<key>-TAG" and storage prefix "<prefix>TAG_" (its own rule). */
  function grpOk(g) { return /^[A-Za-z0-9_-]{1,24}$/.test(g || ''); }
  function sessKey(m, g) { return m.moduleKey + (g ? '-' + g : ''); }
  function pfxOf(m, g) { return m.storagePrefix + (g ? g + '_' : ''); }
  function teacherKey(m, g) { return pfxOf(m, g) + 'backend_token_v1'; }   // the module's own teacher-session slot
  function withHash(url, hash) { return hash ? url.replace(/#.*$/, '') + hash : url; }
  function withGroup(url, g) {
    if (!g) return url;
    var hm = /#.*$/.exec(url), hash = hm ? hm[0] : '', base = url.replace(/#.*$/, '').replace(/([?&])g=[^&]*&?/, '$1').replace(/[?&]$/, '');
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'g=' + encodeURIComponent(g) + hash;
  }
  /** Opens a module as the signed-in teacher: the backend creates that module's own teacher session (checked again by
   *  the module on every request), it is placed where the module keeps its teacher session, and the module opens. */
  function teacherOpen(m, hash, btn, group) {
    var g = grpOk(group) ? group : '', dest = withHash(withGroup(m.url, g), hash);
    if (!teacherDirect(m)) { location.href = dest; return; }
    var t = tget(); if (!t) { viewTeacher(); return; }
    var sk = sessKey(m, g), have = (t.mods || {})[sk], cur = lsGet(teacherKey(m, g));
    var ready = have && have.token && have.expiresAt > Date.now() + 60000 && cur && cur.token === have.token
      ? Promise.resolve({ ok: true, modules: (function () { var o = {}; o[sk] = have; return o; })() })
      : post(CFG.backendUrl, { module: 'portal', action: 'portalTeacherOpen', token: t.token, modules: [g ? { module: m.moduleKey, group: g } : m.moduleKey] });
    if (btn) { btn.disabled = true; btn.dataset.l = btn.textContent; btn.textContent = 'Opening…'; }
    ready.then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.l; }
      if (!r.ok) { if (r.code === 'auth') { sdel(TKEY); toast('Your teacher session has ended — please sign in again.'); return route(); } toast(r.code === 'badaction' ? 'Update Portal.gs on the backend (see SETUP.md) to open modules from the dashboard.' : r.error); return; }
      var acc = r.modules && r.modules[sk];
      if (!acc) { toast(g ? 'Group links need the updated Portal.gs on the backend (see SETUP.md).' : 'This module is not on the front-page list.'); return; }
      lsSet(teacherKey(m, g), { token: acc.token, expiresAt: acc.expiresAt });
      sdel(pfxOf(m, g) + 'stu_session_v1');   // this browser opens the module as the teacher, not as a student
      t.mods = t.mods || {}; t.mods[sk] = { token: acc.token, expiresAt: acc.expiresAt, prefix: pfxOf(m, g) };
      sset(TKEY, t, false);
      location.href = dest;
    });
  }
  function teacherSignOut() {
    var t = tget() || sget(TKEY) || {}, list = [];
    Object.keys(t.mods || {}).forEach(function (k) {
      var x = t.mods[k]; list.push({ module: k, token: x.token });
      var cur = x.prefix && lsGet(x.prefix + 'backend_token_v1'); if (cur && cur.token === x.token) lsDel(x.prefix + 'backend_token_v1');
    });
    // first the module teacher sessions it opened, then the dashboard session itself
    (list.length ? post(CFG.backendUrl, { module: 'portal', action: 'portalTeacherClose', sessions: list }, { keepalive: true }) : Promise.resolve())
      .then(function () { if (t.token) post(CFG.backendUrl, { module: 'portal', action: 'logout', token: t.token }, { keepalive: true }); });
    sdel(TKEY); location.hash = '#/'; route(); toast('You have signed out.');
  }
  function viewTeacher() {
    var tok = tsess();
    main.innerHTML = '';
    if (!tok) {
      main.appendChild(h('<div class="t-head"><h1 class="page-h">Teacher Sign-In</h1><p class="muted">One teacher account for the whole platform: the Teacher Dashboard, every teaching module and all management functions.</p></div>'));
      return main.appendChild(teacherLogin());
    }
    main.appendChild(h('<div class="t-head"><h1 class="page-h">Teacher Dashboard</h1><p class="muted">Signed in as teacher. Open any module directly, or manage the platform below.</p></div>'));
    var tm = h('<section class="t-sec" id="t-modules"><div class="sec-head"><h2>Teaching Modules</h2><span class="small muted">Open in teacher mode — no second password</span></div><div class="grid t-grid"></div></section>');
    var grid = $('.t-grid', tm);
    MODULES.forEach(function (m) { grid.appendChild(teacherCard(m)); });
    if (!MODULES.length) grid.appendChild(h('<p class="muted">No modules yet — add one under Teacher Management.</p>'));
    main.appendChild(tm);
    var mg = h('<section class="t-sec" id="t-manage"><div class="sec-head"><h2>Teacher Management</h2><span class="small muted">Front-page modules, statuses and links</span></div><div class="t-box"><p class="muted">Loading…</p></div></section>');
    main.appendChild(mg);
    var box = $('.t-box', mg);
    main.appendChild(directorySection());
    post(CFG.backendUrl, { module: 'portal', action: 'portalAdminGet', token: tok }).then(function (r) {
      if (!r.ok) { if (r.code === 'auth') { sdel(TKEY); return route(); } box.innerHTML = '<p class="err">' + esc(r.error) + '</p>'; return; }
      editor(box, r);
    });
  }
  function teacherCard(m) {
    var st = STATUS[m.status] || STATUS.soon, direct = teacherDirect(m), d = descOf(m);
    var el = h('<article class="mod t-card ' + (m.url ? 'open' : 'locked') + ' st-' + esc(m.status) + '" style="--c:' + esc(m.color) + '" data-id="' + esc(m.id) + '">' +
      '<div class="mod-top"><div class="mod-ico">' + iconHtml(m) + '</div><span class="pill ' + st.cls + '">' + st.icon + ' ' + esc(st.label) + '</span></div>' +
      '<div class="mod-body">' + (m.subtitle ? '<div class="cat">' + esc(m.subtitle) + '</div>' : '') + '<h3>' + esc(m.title) + '</h3>' + (d ? '<p class="desc">' + esc(d) + '</p>' : '') +
      '<p class="msg">' + esc(!m.url ? 'The link to this module has not been set yet (Teacher Management below).' : direct ? 'Opens in teacher mode with your teacher sign-in.' + (m.status !== 'available' ? ' Students cannot open it yet.' : '') : 'This module is not connected for direct teacher access; it opens on its own page.') + '</p>' +
      (m.url && direct && (m.groups || []).length ? '<label class="t-grp">Group link<select class="t-g"><option value="">All students (no group)</option>' + m.groups.map(function (g) { return '<option value="' + esc(g) + '">Group ' + esc(g) + ' (?g=' + esc(g) + ')</option>'; }).join('') + '</select></label>' : '') +
      '<div class="act">' + (m.url ? '<button class="btn primary t-open" type="button">Open module →</button>' + (direct ? '<button class="btn t-admin" type="button">Teacher Portal</button>' : '') : '<button class="btn" type="button" disabled>Link not set</button>') + '</div></div></article>');
    var o = $('.t-open', el), a = $('.t-admin', el), gs = $('.t-g', el);
    var grp = function () { return gs ? gs.value : ''; };
    if (o) o.onclick = function () { teacherOpen(m, '', o, grp()); };
    if (a) { a.title = 'Students, content, results and other management inside this module'; a.onclick = function () { teacherOpen(m, '#/teacher', a, grp()); }; }
    return el;
  }
  function teacherLogin() {
    var setup = INFO && !INFO.hasTeacher;
    var f = h('<form class="card t-login" style="max-width:440px" novalidate><h2 style="margin-top:0;color:var(--navy);font-size:18px">' + (setup ? 'Create the teacher password' : 'Teacher sign-in') + '</h2><p class="small muted">' +
      (setup ? 'No teacher account exists yet. Choose the platform teacher password (at least 8 characters).' : 'Enter the platform teacher password.') + '</p>' +
      '<label>Password<input id="t-p" type="password" autocomplete="' + (setup ? 'new-password' : 'current-password') + '"></label>' + (setup ? '<label>Repeat it<input id="t-p2" type="password" autocomplete="new-password"></label>' : '') +
      '<p class="err" role="alert"></p><button class="btn primary full" type="submit">' + (setup ? 'Create password' : 'Sign in') + '</button>' +
      '<p class="small muted" style="margin:10px 0 0">Students do not sign in here — they use the Student sign-in on the Platform Home.</p></form>');
    f.onsubmit = function (e) {
      e.preventDefault();
      var pw = $('#t-p', f).value, err = $('.err', f), btn = $('button[type=submit]', f);
      if (setup) {
        if (pw.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
        if (pw !== $('#t-p2', f).value) { err.textContent = 'The two passwords are different.'; return; }
        btn.disabled = true;
        return post(CFG.backendUrl, { module: 'portal', action: 'setup', password: pw }).then(function (r) { if (!r.ok) { btn.disabled = false; err.textContent = r.error; return; } INFO.hasTeacher = true; login(); });
      }
      btn.disabled = true; login();
      function login() {
        post(CFG.backendUrl, { module: 'portal', action: 'login', password: pw }).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { err.textContent = r.error || 'Sign-in failed.'; return; }
          sset(TKEY, { token: r.token, exp: r.expiresAt, mods: {} }, false); route();
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
    ['storagePrefix', 'Storage prefix (platform modules, e.g. ci_)'], ['backend', 'Other backend URL (empty = this platform backend)'],
    ['groups', 'Group links (?g=…) the teacher can open, e.g. A, B']
  ];
  function editor(box, r) {
    var list = r.modules.map(function (m) { return JSON.parse(JSON.stringify(m)); }), counts = r.counts || {};
    box.innerHTML = '';
    box.appendChild(h('<div class="note" style="margin-bottom:14px"><b>Status is only what students see.</b> A student can enter a module only if their account is registered for it (Teaching Modules above → that module’s <b>Teacher Portal</b> → Students). “Available” never opens a module to students without an account.</div>'));
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
        $$('[data-k]', el).forEach(function (inp) { var v = m[inp.dataset.k]; inp.value = v == null ? '' : Array.isArray(v) ? v.join(', ') : v; inp.oninput = inp.onchange = function () { m[inp.dataset.k] = inp.value; if (inp.dataset.k === 'color') el.style.setProperty('--c', inp.value); }; });
        el.onclick = function (e) {
          var a = e.target.dataset.a; if (!a) return;
          if (a === 'up' && i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); }
          if (a === 'dn' && i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); }
          if (a === 'rm' && window.confirm('Remove “' + m.title + '” from the front page? (The module itself and its accounts are not touched.)')) { list.splice(i, 1); draw(); }
        };
        rows.appendChild(el);
      });
    }
    $('.add', bar).onclick = function () { list.push({ id: 'module' + (list.length + 1), title: 'New module', subtitle: '', icon: '📘', color: '#0f2a4a', status: 'soon', url: '', moduleKey: '', handoff: 'link', storagePrefix: '', backend: '', note: '', groups: [] }); draw(); rows.lastChild.scrollIntoView({ behavior: 'smooth' }); };
    $('.out', bar).onclick = teacherSignOut;
    $('.save', bar).onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      post(CFG.backendUrl, { module: 'portal', action: 'portalAdminSave', token: tsess(), modules: list }).then(function (x) {
        btn.disabled = false; btn.textContent = '💾 Save changes';
        if (!x.ok) { if (x.code === 'auth') { sdel(TKEY); return viewTeacher(); } toast(x.error); return; }
        list = x.modules; MODULES = x.modules; draw(); var g = $('#t-modules .t-grid'); if (g) { g.innerHTML = ''; MODULES.forEach(function (m) { g.appendChild(teacherCard(m)); }); } toast('Saved. Students see the new list when they open or reload the front page.');
      });
    };
    draw();
  }

  /* ---------------- platform directory (Admin; Step 1 — stored, not yet used for access) ---------------- */
  /** The address students open for a group: this front page + ?g=<link code>. */
  function groupLink(code) { return location.origin + location.pathname + '?g=' + encodeURIComponent(code); }
  function copyText(text, inp) {
    var done = function () { toast('Link copied — paste it into your message to the students.'); };
    var fallback = function () { try { inp.focus(); inp.select(); if (document.execCommand('copy')) return done(); } catch (e) { } toast('Select the link and copy it (Ctrl+C).'); };
    var settled = false, once = function (f) { return function () { if (!settled) { settled = true; f(); } }; };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(once(done), once(fallback));
        setTimeout(once(fallback), 1200);   // a browser that never answers the clipboard request
        return;
      }
    } catch (e) { }
    fallback();
  }
  function dirCall(action, o) { return post(CFG.backendUrl, Object.assign({ module: 'portal', action: action, token: tsess() }, o || {})); }
  function fmtDay(t) { if (!t) return ''; var d = new Date(Number(t)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
  function directorySection() {
    var sec = h('<section class="t-sec" id="t-dir"><details class="dir"><summary><span class="dir-h">Platform directory</span><span class="small muted">Admin · institutions, groups, modules and deliveries</span></summary><div class="dir-body"><p class="muted">Loading…</p></div></details></section>');
    var det = $('details', sec), body = $('.dir-body', sec), D = null, tab = 'institutions', scan = null;
    det.addEventListener('toggle', function () { if (det.open && !D) load(); });
    function load() {
      dirCall('dirGet').then(function (r) {
        if (!r.ok) { if (r.code === 'auth') { sdel(TKEY); return route(); } body.innerHTML = '<p class="err">' + esc(r.code === 'badaction' ? 'Update Portal.gs on the backend (version 1.3, see SETUP.md) to use the platform directory.' : r.error) + '</p>'; return; }
        D = r; draw();
      });
    }
    function byId(list, k, v) { return (D[list] || []).filter(function (x) { return x[k] === v; })[0]; }
    function instName(id) { var i = byId('institutions', 'institutionId', id); return i ? (i.shortName || i.name) : '?'; }
    function groupLabel(g) { return instName(g.institutionId) + ' · ' + g.name + (g.academicYear ? ' (' + g.academicYear + ')' : ''); }
    function activePill(r) { return r.active ? '<span class="pill available">Active</span>' : '<span class="pill locked">Inactive</span>'; }
    function save(kind, record, extra, btn) {
      if (btn) btn.disabled = true;
      return dirCall('dirSave', Object.assign({ kind: kind, record: record }, extra || {})).then(function (r) {
        if (btn) btn.disabled = false;
        if (!r.ok) { if (r.code === 'auth') { sdel(TKEY); return route(); } toast(r.error); return false; }
        toast('Saved.'); scan = null; load(); return true;
      });
    }
    function setActive(kind, id, on) { dirCall('dirSetActive', { kind: kind, id: id, active: on }).then(function (r) { if (!r.ok) return toast(r.error); toast(on ? 'Activated.' : 'Deactivated.'); load(); }); }
    /* a small form from a field list: [key, label, type, options] */
    function form(fields, values, submitLabel, onSubmit) {
      var f = h('<form class="dir-form rowed" novalidate></form>');
      fields.forEach(function (fd) {
        var v = values && values[fd[0]] != null ? values[fd[0]] : '', lab;
        if (fd[2] === 'select') lab = h('<label>' + esc(fd[1]) + '<select data-k="' + fd[0] + '">' + fd[3].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>');
        else if (fd[2] === 'check') lab = h('<label class="chk"><input type="checkbox" data-k="' + fd[0] + '"' + (v ? ' checked' : '') + '> ' + esc(fd[1]) + '</label>');
        else if (fd[2] === 'fixed') lab = h('<label>' + esc(fd[1]) + '<input value="' + esc(v) + '" disabled></label>');
        else lab = h('<label>' + esc(fd[1]) + '<input data-k="' + fd[0] + '" type="' + (fd[2] || 'text') + '" value="' + esc(fd[2] === 'date' ? fmtDay(v) : v) + '"' + (fd[3] ? ' placeholder="' + esc(fd[3]) + '"' : '') + '></label>');
        f.appendChild(lab);
      });
      var b = h('<div class="dir-act"><button class="btn primary" type="submit">' + esc(submitLabel) + '</button></div>'); f.appendChild(b);
      f.onsubmit = function (e) {
        e.preventDefault(); var o = {};
        $$('[data-k]', f).forEach(function (i) { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
        onSubmit(o, $('button', b));
      };
      return f;
    }
    function editRow(host, fields, values, onSave) {
      var cur = $('.dir-edit', host); if (cur) { cur.remove(); return; }
      var w = h('<div class="dir-edit"></div>'); w.appendChild(form(fields, values, 'Save changes', onSave)); host.appendChild(w);
    }
    function list(items, render) { var l = h('<div class="dir-list"></div>'); if (!items.length) l.appendChild(h('<p class="muted small">None yet.</p>')); items.forEach(function (x) { l.appendChild(render(x)); }); return l; }
    function row(html, kind, id, active, onEdit) {
      var r = h('<div class="dir-row' + (active ? '' : ' off') + '"><div class="dir-main">' + html + '</div><div class="dir-btns"><button class="btn" type="button" data-a="edit">Edit</button><button class="btn' + (active ? ' danger' : '') + '" type="button" data-a="act">' + (active ? 'Deactivate' : 'Activate') + '</button></div></div>');
      $('[data-a=edit]', r).onclick = function () { onEdit(r); };
      $('[data-a=act]', r).onclick = function () { if (!active || window.confirm('Deactivate this record? Nothing is deleted, and it can be activated again.')) setActive(kind, id, !active); };
      return r;
    }
    var TABS = [['institutions', 'Institutions'], ['groups', 'Groups'], ['modules', 'Modules'], ['deliveries', 'Deliveries'], ['students', 'Students'], ['existing', 'Existing data']];
    var rosterGroup = '', lastAdded = null;
    function draw() {
      body.innerHTML = '';
      body.appendChild(h('<div class="note small" style="margin-bottom:12px">The directory decides what each <b>group page</b> (…/?g=link code) shows and who can sign in there: a student needs to be in the group (Students) and the module delivered to the group (Deliveries). The main front page and teacher access are not affected yet. Records are never deleted; deactivate them instead.</div>'));
      var nav = h('<div class="dir-tabs" role="tablist"></div>');
      TABS.forEach(function (t) { var b = h('<button type="button" role="tab" class="dir-tab' + (tab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + esc(t[1]) + '</button>'); b.onclick = function () { tab = t[0]; draw(); }; nav.appendChild(b); });
      body.appendChild(nav);
      var pane = h('<div class="dir-pane" data-pane="' + tab + '"></div>'); body.appendChild(pane);
      ({ institutions: paneInst, groups: paneGroups, modules: paneModules, deliveries: paneDeliveries, students: paneStudents, existing: paneExisting })[tab](pane);
    }
    var INST_F = [['name', 'Name', 'text', 'e.g. Al-Razi University'], ['shortName', 'Short name', 'text', 'e.g. Al-Razi'], ['sortOrder', 'Order', 'number']];
    function paneInst(pane) {
      pane.appendChild(h('<h3>Add an institution</h3>'));
      pane.appendChild(form(INST_F, {}, '＋ Add institution', function (o, b) { save('institution', o, null, b); }));
      pane.appendChild(h('<h3>Institutions</h3>'));
      pane.appendChild(list(D.institutions.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name); }), function (i) {
        var n = D.groups.filter(function (g) { return g.institutionId === i.institutionId; }).length;
        return row('<b>' + esc(i.name) + '</b>' + (i.shortName ? ' <span class="muted">(' + esc(i.shortName) + ')</span>' : '') + ' ' + activePill(i) + '<div class="small muted">' + n + ' group(s) · id ' + esc(i.institutionId) + '</div>', 'institution', i.institutionId, i.active,
          function (r) { editRow(r, INST_F, i, function (o, b) { o.institutionId = i.institutionId; save('institution', o, null, b); }); });
      }));
    }
    function paneGroups(pane) {
      var insts = D.institutions.map(function (i) { return [i.institutionId, i.name + (i.active ? '' : ' (inactive)')]; });
      pane.appendChild(h('<h3>Add a group</h3>'));
      if (!insts.length) pane.appendChild(h('<p class="muted small">Add an institution first.</p>'));
      else pane.appendChild(form([['institutionId', 'Institution', 'select', insts], ['name', 'Group name', 'text', 'e.g. Group A'], ['academicYear', 'Academic year', 'text', 'e.g. 2026-27'],
        ['linkCode', 'Link code (?g=…)', 'text', 'e.g. razi-a-26']], {}, '＋ Add group', function (o, b) { save('group', o, null, b); }));
      pane.appendChild(h('<p class="small muted">The link code is the group\'s unique address (…/?g=<i>code</i>). Letters, digits, “-” and “_”. It is fixed once the group has a delivery, because that group\'s data is stored under it.</p>'));
      pane.appendChild(h('<h3>Groups</h3>'));
      pane.appendChild(list(D.groups.slice().sort(function (a, b) { return groupLabel(a).localeCompare(groupLabel(b)); }), function (g) {
        var ds = D.deliveries.filter(function (d) { return d.groupId === g.groupId; });
        var fields = [['institutionId', 'Institution', 'fixed'], ['name', 'Group name'], ['academicYear', 'Academic year'], ds.length ? ['linkCode', 'Link code (fixed)', 'fixed'] : ['linkCode', 'Link code (?g=…)']];
        var link = groupLink(g.linkCode);
        var el = row('<b>' + esc(groupLabel(g)) + '</b> ' + activePill(g) + '<div class="small muted">link code <code>' + esc(g.linkCode) + '</code> · ' + ds.length + ' module(s) · id ' + esc(g.groupId) + '</div>' +
          '<div class="grp-link"><span class="small">Student link:</span> <input class="grp-url" readonly value="' + esc(link) + '" aria-label="Student link for ' + esc(groupLabel(g)) + '"> <button class="btn" type="button" data-a="copy">📋 Copy link</button> <a class="btn" href="' + esc(link) + '" target="_blank" rel="noopener">Open ↗</a></div>' +
          (g.active ? (ds.length ? '' : '<div class="small warn-t">No modules delivered to this group yet — its page will be empty.</div>') : '<div class="small warn-t">Inactive — this link shows the main page until the group is activated.</div>'), 'group', g.groupId, g.active,
          function (r) { editRow(r, fields, Object.assign({}, g, { institutionId: instName(g.institutionId) }), function (o, b) { o.groupId = g.groupId; delete o.institutionId; save('group', o, null, b); }); });
        var inp = $('.grp-url', el); inp.onclick = function () { inp.select(); };
        $('[data-a=copy]', el).onclick = function () { copyText(link, inp); };
        return el;
      }));
    }
    var MOD_F = [['title', 'Title'], ['subtitle', 'Subtitle'], ['url', 'Link (https://…)'], ['storagePrefix', 'Storage prefix (e.g. ci_)'], ['icon', 'Icon (emoji)'], ['color', 'Colour', 'color']];
    function paneModules(pane) {
      pane.appendChild(h('<h3>Add a module</h3>'));
      pane.appendChild(form([['moduleId', 'Module id (fixed, e.g. cardio)', 'text', 'lowercase letters/digits']].concat(MOD_F), { color: '#0f2a4a' }, '＋ Add module', function (o, b) { save('module', o, { create: true }, b); }));
      pane.appendChild(h('<h3>Modules</h3><p class="small muted">One record per subject. The same module can be delivered to many groups; it is never copied.</p>'));
      pane.appendChild(list(D.modules, function (m) {
        var n = D.deliveries.filter(function (d) { return d.moduleId === m.moduleId; }).length;
        return row('<b>' + esc(m.icon || '') + ' ' + esc(m.title) + '</b> ' + activePill(m) + '<div class="small muted">id <code>' + esc(m.moduleId) + '</code> · delivered to ' + n + ' group(s)' + (m.url ? ' · ' + esc(m.url) : '') + '</div>', 'module', m.moduleId, m.active,
          function (r) { editRow(r, [['moduleId', 'Module id', 'fixed']].concat(MOD_F), m, function (o, b) { o.moduleId = m.moduleId; save('module', o, null, b); }); });
      }));
    }
    var ST = [['available', 'Available'], ['ready', 'Completed – not yet released'], ['soon', 'Coming soon']];
    function paneDeliveries(pane) {
      var gs = D.groups.map(function (g) { return [g.groupId, groupLabel(g)]; }), ms = D.modules.map(function (m) { return [m.moduleId, m.title]; });
      pane.appendChild(h('<h3>Deliver a module to a group</h3>'));
      if (!gs.length || !ms.length) pane.appendChild(h('<p class="muted small">Add a group and a module first.</p>'));
      else pane.appendChild(form([['groupId', 'Group', 'select', gs], ['moduleId', 'Module', 'select', ms], ['status', 'Status', 'select', ST], ['openFrom', 'Opens (optional)', 'date'], ['openUntil', 'Closes (optional)', 'date'],
        ['adoptPlain', 'Use the existing storage of the normal link (no ?g=) — only to register existing data', 'check']], { status: 'soon' }, '＋ Add delivery', function (o, b) { save('delivery', o, null, b); }));
      pane.appendChild(h('<p class="small muted">Each delivery keeps its own students, results, attendance and assessments, stored under its storage name (module-linkcode). The storage name never changes.</p>'));
      pane.appendChild(h('<h3>Deliveries</h3>'));
      var items = D.deliveries.slice().sort(function (a, b) { var ga = byId('groups', 'groupId', a.groupId), gb = byId('groups', 'groupId', b.groupId); return (ga ? groupLabel(ga) : '').localeCompare(gb ? groupLabel(gb) : '') || a.moduleId.localeCompare(b.moduleId); });
      pane.appendChild(list(items, function (d) {
        var g = byId('groups', 'groupId', d.groupId), m = byId('modules', 'moduleId', d.moduleId), st = STATUS[d.status] || STATUS.soon;
        var dates = (d.openFrom || d.openUntil) ? ' · ' + (fmtDay(d.openFrom) || '…') + ' → ' + (fmtDay(d.openUntil) || '…') : '';
        return row('<b>' + esc(g ? groupLabel(g) : '?') + '</b> → <b>' + esc(m ? m.title : d.moduleId) + '</b> <span class="pill ' + st.cls + '">' + esc(st.label) + '</span> ' + activePill(d) +
          '<div class="small muted">storage <code>' + esc(d.backendModule) + '</code>' + dates + ' · id ' + esc(d.deliveryId) + '</div>', 'delivery', d.deliveryId, d.active,
          function (r) { editRow(r, [['backendModule', 'Storage (fixed)', 'fixed'], ['status', 'Status', 'select', ST], ['openFrom', 'Opens', 'date'], ['openUntil', 'Closes', 'date']], d, function (o, b) { o.deliveryId = d.deliveryId; save('delivery', o, null, b); }); });
      }));
    }
    /* ---- Students (group rosters) ---- */
    var ACC = { ok: ['✓', 'Account ready'], mustchange: ['✓ temp', 'Temporary password — must choose a new one at first sign-in'], missing: ['—', 'No account yet (press “Create missing accounts”)'], inactive: ['off', 'Account deactivated'], locked: ['🔒', 'Locked after wrong passwords (15 min)'] };
    function rosterCall(action, o) { return dirCall(action, Object.assign({ groupId: rosterGroup }, o || {})); }
    function paneStudents(pane) {
      if (!D.groups.length) { pane.appendChild(h('<p class="muted small">Add a group first.</p>')); return; }
      if (!rosterGroup || !byId('groups', 'groupId', rosterGroup)) rosterGroup = D.groups[0].groupId;
      var sel = h('<label class="dir-gsel">Group<select data-k="rg">' + D.groups.map(function (g) { return '<option value="' + esc(g.groupId) + '"' + (g.groupId === rosterGroup ? ' selected' : '') + '>' + esc(groupLabel(g)) + (g.active ? '' : ' (inactive)') + '</option>'; }).join('') + '</select></label>');
      $('select', sel).onchange = function () { rosterGroup = this.value; lastAdded = null; draw(); };
      pane.appendChild(sel);
      var box = h('<div class="roster"><p class="muted">Loading…</p></div>'); pane.appendChild(box);
      rosterCall('rosterGet').then(function (r) {
        if (!r.ok) { box.innerHTML = '<p class="err">' + esc(r.code === 'badaction' ? 'Update Portal.gs on the backend (version 1.5, see SETUP.md) to manage group students.' : r.error) + '</p>'; return; }
        drawRoster(box, r);
      });
    }
    function drawRoster(box, r) {
      box.innerHTML = '';
      var mods = r.modules || [], title = function (id) { var m = byId('modules', 'moduleId', id); return m ? m.title : id; };
      box.appendChild(h('<p class="small muted">' + (mods.length ? 'Each student gets one account in every module of this group, all with the same password: ' + mods.map(function (m) { return '<b>' + esc(title(m.moduleId)) + '</b>'; }).join(', ') + '.' : 'This group has no modules yet — students can be added now; their accounts are created when you deliver a module to the group (Deliveries).') + ' Students sign in on the group\'s own page (Groups → Student link).</p>'));
      var tools = h('<div class="roster-tools"></div>');
      if (r.unlistedAccounts) { var imp = h('<button class="btn" type="button">⤓ Add ' + r.unlistedAccounts + ' existing account(s) to this group</button>'); imp.title = 'Accounts already made in this group\'s modules (in a module\'s Teacher Portal) that are not on the list yet'; imp.onclick = function () { imp.disabled = true; rosterCall('rosterImport').then(function (x) { if (!x.ok) { imp.disabled = false; return toast(x.error); } toast(x.added + ' student(s) added to the group.'); draw(); }); }; tools.appendChild(imp); }
      var missing = r.members.some(function (m) { return m.active && Object.keys(m.accounts).some(function (k) { return m.accounts[k] === 'missing'; }); });
      if (missing) { var sy = h('<button class="btn" type="button">＋ Create missing accounts</button>'); sy.onclick = function () { sy.disabled = true; rosterCall('rosterSync').then(function (x) { if (!x.ok) { sy.disabled = false; return toast(x.error); } toast(x.created + ' account(s) created.' + (x.needPasswordReset.length ? ' Reset the password of: ' + x.needPasswordReset.join(', ') : '')); draw(); }); }; tools.appendChild(sy); }
      if (tools.children.length) box.appendChild(tools);
      // add students
      var add = h('<form class="roster-add" novalidate><h3>Add students</h3><label>One student per line: <b>Student ID, Name</b>, Email (optional), Password (optional)<textarea data-k="list" rows="4" placeholder="2026001, Mona Ali\n2026002, Omar Saleh, omar@example.org"></textarea></label>' +
        '<label class="chk"><input type="checkbox" data-k="mc" checked> Students choose their own password at first sign-in (always so for generated passwords)</label><div class="dir-act"><button class="btn primary" type="submit">＋ Add to group</button></div></form>');
      add.onsubmit = function (e) {
        e.preventDefault();
        var lines = $('[data-k=list]', add).value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (!lines.length) return toast('Enter at least one student.');
        var list = lines.map(function (l) { var c = l.split(/\s*[,;\t]\s*/); return { studentId: c[0] || '', name: c[1] || '', email: c[2] || '', password: c[3] || '' }; });
        var b = $('button', add); b.disabled = true;
        rosterCall('rosterAdd', { students: list, mustChange: $('[data-k=mc]', add).checked }).then(function (x) {
          b.disabled = false;
          if (!x.ok) return toast(x.error);
          lastAdded = x.results; toast(x.added + ' student(s) added.'); draw();
        });
      };
      box.appendChild(add);
      if (r.members.length) box.appendChild(bulkReset(r));
      if (lastAdded) box.appendChild(addedPanel(lastAdded));
      // the list
      box.appendChild(h('<h3>Students in this group (' + r.members.length + ')</h3>'));
      if (!r.members.length) { box.appendChild(h('<p class="muted small">No students yet.</p>')); return; }
      var tb = h('<div class="tbl-wrap"><table class="dir-tbl roster-tbl"><thead><tr><th>Student ID</th><th>Name</th><th>Status</th>' + mods.map(function (m) { return '<th>' + esc(title(m.moduleId)) + '</th>'; }).join('') + '<th></th></tr></thead><tbody></tbody></table></div>');
      r.members.forEach(function (m) {
        var tr = h('<tr' + (m.active ? '' : ' class="off"') + '><td><code>' + esc(m.studentId) + '</code></td><td>' + esc(m.name) + (m.email ? '<div class="small muted">' + esc(m.email) + '</div>' : '') + '</td><td>' + activePill(m) + (m.needsPassword ? '<div class="small warn-t">Cannot sign in yet — press <b>Reset password</b> to give a password and create the accounts</div>' : '') + (m.samePassword ? '' : '<div class="small warn-t" title="These accounts were created separately, so their passwords may differ. Reset the password to give all of this group\'s modules the same one.">passwords set separately</div>') + '</td>' +
          mods.map(function (x) { var a = ACC[m.accounts[x.moduleId]] || ACC.missing; return '<td title="' + esc(a[1]) + '">' + esc(a[0]) + '</td>'; }).join('') +
          '<td><div class="roster-btns"><button class="btn" type="button" data-a="pw">Reset password</button><button class="btn" type="button" data-a="ed">Edit</button><button class="btn' + (m.active ? ' danger' : '') + '" type="button" data-a="act">' + (m.active ? 'Deactivate' : 'Activate') + '</button></div></td></tr>');
        $('[data-a=pw]', tr).onclick = function () {
          var typed = window.prompt('New temporary password for ' + m.studentId + ' (all of this group\'s modules).\nType one (at least 8 characters), or leave empty to generate one. Their current password stops working.', '');
          if (typed == null) return;
          typed = typed.trim();
          if (typed && typed.length < 8) return toast('The password must be at least 8 characters.');
          rosterCall('rosterResetPassword', { studentId: m.studentId, password: typed }).then(function (x) { if (!x.ok) return toast(x.error); lastAdded = [{ ok: true, studentId: m.studentId, name: m.name, tempPassword: x.tempPassword || typed, reset: true }]; draw(); });
        };
        $('[data-a=ed]', tr).onclick = function () {
          var n = window.prompt('Name of ' + m.studentId, m.name); if (n == null) return;
          var em = window.prompt('Email of ' + m.studentId + ' (optional)', m.email || ''); if (em == null) return;
          rosterCall('rosterSave', { studentId: m.studentId, name: n, email: em }).then(function (x) { if (!x.ok) return toast(x.error); toast('Saved.'); draw(); });
        };
        $('[data-a=act]', tr).onclick = function () {
          if (m.active && !window.confirm('Deactivate ' + m.studentId + '? They lose access to all of this group\'s modules at once (nothing is deleted).')) return;
          rosterCall('rosterSetActive', { studentId: m.studentId, active: !m.active }).then(function (x) { if (!x.ok) return toast(x.error); toast(m.active ? 'Deactivated.' : 'Activated.'); draw(); });
        };
        $('tbody', tb).appendChild(tr);
      });
      box.appendChild(tb);
    }
    function rosterLink() { var g = byId('groups', 'groupId', rosterGroup); return g ? groupLink(g.linkCode) : ''; }
    /** Temporary passwords for many students in one go. */
    function bulkReset(r) {
      var temp = r.members.filter(function (m) { return m.active && (m.needsPassword || Object.keys(m.accounts).some(function (k) { return m.accounts[k] === 'mustchange' || m.accounts[k] === 'missing'; })); }).length;
      var all = r.members.filter(function (m) { return m.active; }).length;
      var f = h('<form class="roster-bulk" novalidate><h3>Temporary passwords for many students</h3>' +
        '<div class="opt"><label class="chk"><input type="radio" name="bs" value="temp" checked> Students who have not chosen their own password yet (<b>' + temp + '</b>)</label>' +
        '<label class="chk"><input type="radio" name="bs" value="all"> All active students in this group (<b>' + all + '</b>) — their current passwords stop working</label></div>' +
        '<div class="opt"><label class="chk"><input type="radio" name="bp" value="same" checked> The same password for all of them: <input type="text" data-k="shared" placeholder="at least 8 characters" autocomplete="off" spellcheck="false"></label>' +
        '<label class="chk"><input type="radio" name="bp" value="each"> A different password for each student</label></div>' +
        '<p class="small muted">Each student must choose their own password at the next sign-in. With one shared password, a student could open a classmate\'s account until that classmate has signed in once — so ask students to sign in and choose their own password soon.</p>' +
        '<div class="dir-act"><button class="btn primary" type="submit">Create temporary passwords</button></div></form>');
      var sharedInp = $('[data-k=shared]', f);
      sharedInp.addEventListener('focus', function () { $('input[name=bp][value=same]', f).checked = true; });
      f.onsubmit = function (e) {
        e.preventDefault();
        var scope = $('input[name=bs]:checked', f).value, same = $('input[name=bp]:checked', f).value === 'same', pw = same ? sharedInp.value.trim() : '';
        var n = scope === 'all' ? all : temp;
        if (!n) return toast('No student to reset.');
        if (same && pw.length < 8) return toast('Type the shared password (at least 8 characters).');
        if (!window.confirm('Create a new temporary password for ' + n + ' student(s)' + (same ? ' (the same for all)' : '') + '? Their current passwords stop working and they choose their own at the next sign-in.')) return;
        var b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Working…';
        rosterCall('rosterResetMany', { scope: scope, password: pw }).then(function (x) {
          b.disabled = false; b.textContent = 'Create temporary passwords';
          if (!x.ok) return toast(x.error);
          lastAdded = x.results.map(function (y) { return Object.assign({}, y, { reset: true, tempPassword: y.tempPassword || pw }); });
          toast(x.count + ' temporary password(s) created.'); draw();
        });
      };
      return f;
    }
    function addedPanel(results) {
      var ok = results.filter(function (x) { return x.ok; }), bad = results.filter(function (x) { return !x.ok; });
      var withPw = ok.filter(function (x) { return x.tempPassword; });
      var title = ok.length && ok[0].reset ? (ok.length > 1 ? 'New temporary passwords for ' + ok.length + ' students' : 'New temporary password') : ok.length + ' student(s) added';
      var p = h('<div class="note roster-res"><b>' + esc(title) + '</b>' +
        (withPw.length ? '<p class="small">Give each student their temporary password <b>now</b> — it is shown only this once. They choose their own password at first sign-in.</p><div class="tbl-wrap"><table class="dir-tbl"><thead><tr><th>Student ID</th><th>Name</th><th>Temporary password</th></tr></thead><tbody>' +
          withPw.map(function (x) { return '<tr><td><code>' + esc(x.studentId) + '</code></td><td>' + esc(x.name || '') + '</td><td><code class="pw">' + esc(x.tempPassword) + '</code></td></tr>'; }).join('') + '</tbody></table></div><div class="roster-tools"><button class="btn" type="button" data-a="cp">📋 Copy the list</button><button class="btn" type="button" data-a="dl">⬇ Download the list (CSV)</button></div>' : '') +
        ok.filter(function (x) { return x.updatedExisting && x.updatedExisting.length; }).map(function (x) { return '<p class="small">' + esc(x.studentId) + ' already had an account in ' + esc(x.updatedExisting.join(', ')) + ' — it now uses this password too.</p>'; }).join('') +
        (bad.length ? '<p class="small err">' + bad.map(function (x) { return esc(x.error); }).join('<br>') + '</p>' : '') + '</div>');
      var dl = $('[data-a=dl]', p);
      if (dl) dl.onclick = function () {
        var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var csv = '\ufeffStudent ID,Name,Temporary password,Group link\r\n' + withPw.map(function (x) { return [x.studentId, x.name || '', x.tempPassword, rosterLink()].map(q).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = 'temporary-passwords-' + (byId('groups', 'groupId', rosterGroup) || { linkCode: 'group' }).linkCode + '.csv';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      };
      var cp = $('[data-a=cp]', p);
      if (cp) cp.onclick = function () { var t = withPw.map(function (x) { return x.studentId + '\t' + (x.name || '') + '\t' + x.tempPassword; }).join('\n'); var ta = h('<textarea style="position:absolute;left:-9999px"></textarea>'); ta.value = t; document.body.appendChild(ta); copyText(t, ta); setTimeout(function () { ta.remove(); }, 2000); };
      return p;
    }
    function paneExisting(pane) {
      pane.appendChild(h('<p class="small muted">Storage names already present in your data (read-only — nothing is changed). Register one by creating a group whose link code matches the part after “-” and delivering the module to it; the storage of the normal link (no “-”) is registered with the “existing storage of the normal link” option.</p>'));
      var b = h('<button class="btn" type="button">' + (scan ? '↻ Scan again' : '🔍 Scan existing data') + '</button>'); pane.appendChild(b);
      var out = h('<div class="dir-scan"></div>'); pane.appendChild(out);
      function show() {
        if (!scan) return;
        if (!scan.length) { out.innerHTML = '<p class="muted small">No module data found yet.</p>'; return; }
        out.innerHTML = '<div class="tbl-wrap"><table class="dir-tbl"><thead><tr><th>Storage</th><th>Module</th><th>Link code</th><th>Students</th><th>Results</th><th>Assessment records</th><th>Attendance sessions</th><th>Content rows</th><th>Registered</th></tr></thead><tbody>' +
          scan.map(function (x) {
            var d = x.deliveryId && byId('deliveries', 'deliveryId', x.deliveryId), g = d && byId('groups', 'groupId', d.groupId);
            return '<tr><td><code>' + esc(x.backendModule) + '</code></td><td>' + esc(x.moduleId) + '</td><td>' + esc(x.linkCode || '— (normal link)') + '</td><td>' + x.students + '</td><td>' + x.results + '</td><td>' + x.assessRecords + '</td><td>' + x.attendanceSessions + '</td><td>' + x.contentRows + '</td><td>' + (g ? '✓ ' + esc(groupLabel(g)) : '<span class="muted">not yet</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      b.onclick = function () { b.disabled = true; dirCall('dirScan').then(function (r) { b.disabled = false; if (!r.ok) return toast(r.error); scan = r.storages; b.textContent = '↻ Scan again'; show(); }); };
      show();
    }
    return sec;
  }

  /* ---------------- start ---------------- */
  function route() { header(); if (/^#\/teacher/.test(location.hash)) viewTeacher(); else viewHome(); window.scrollTo(0, 0); }
  function boot() {
    header();
    if (GROUP && !/^#\/teacher/.test(location.hash)) {
      return post(CFG.backendUrl, { module: 'portal', action: 'portalGroupInfo', g: GROUP }).then(function (r) {
        if (r && r.ok) {
          GINFO = r; INFO = r; MODULES = r.modules || [];
          document.title = r.group.name + ' — ' + r.institution.name + ' · ' + (CFG.title || 'Interactive Pathology Teaching Platform');
          window.addEventListener('hashchange', route); return route();
        }
        if (r && (r.code === 'nogroup' || r.code === 'badaction')) { GROUP_NOTICE = 'This group link is not valid — showing the main platform page. Please check the link your teacher gave you.'; return loadMain(); }
        main.innerHTML = '<div class="card"><p class="err">' + esc((r && r.error) || 'Cannot reach the platform.') + '</p><button class="btn primary" type="button">Try again</button></div>'; $('button', main).onclick = boot;
      });
    }
    loadMain();
  }
  function loadMain() {
    post(CFG.backendUrl, { module: 'portal', action: 'portalInfo' }).then(function (r) {
      if (!r.ok) { main.innerHTML = '<div class="card"><p class="err">' + esc(r.code === 'badaction' || r.code === 'badjson' ? 'The platform backend does not have the front-page file (Portal.gs) yet — see SETUP.md.' : r.error) + '</p><button class="btn primary" type="button">Try again</button></div>'; $('button', main).onclick = loadMain; return; }
      INFO = r; MODULES = r.modules || [];
      window.addEventListener('hashchange', route); route();
    });
  }
  window.__portal = { handoffKey: handoffKey, teacherKey: teacherKey };
  boot();
})();
