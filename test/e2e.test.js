'use strict';
/* Browser test of the front page with TWO backends (the main platform and the Gyn one), each running the real
   Code.gs core + Portal.gs in the harness. Requests to script.google.com are answered by those backends, and module
   sites (github.io) answer "204 No Content" so the browser stays on the front page and we can inspect the hand-over.
   Run: npm run test:e2e   (PW_CHROMIUM=/path/to/chrome to override the browser) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createBackend } = require('./apps-script/harness');

/* Step 5 closes module-level teacher sign-in. Test FIXTURES still create module teacher sessions that way (to add students
   quickly): this wrapper turns on the emergency switch (ALLOW_MODULE_LOGIN) for exactly those calls. Calls marked __real
   — and everything the browser sends — see the real, closed behaviour. */
function fixtureBackend(opts) {
  const b = createBackend(opts), raw = b.doPost;
  b.doPost = function (o) {
    if (o && o.module !== 'portal' && (o.action === 'setup' || o.action === 'login') && !o.__real) {
      b.props.set('ALLOW_MODULE_LOGIN', 'true');
      try { return raw(o); } finally { b.props.delete('ALLOW_MODULE_LOGIN'); }
    }
    return raw(o);
  };
  return b;
}

let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const SKIP = !chromium || !fs.existsSync(EXE) ? 'Playwright/Chromium not available' : false;
const ROOT = path.join(__dirname, '..');
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(__dirname, 'apps-script', 'Code.exam.gs'), path.join(ROOT, 'backend', 'Portal.gs')];
const MAIN = 'https://script.google.com/macros/s/MAINTEST/exec', GYN = 'https://script.google.com/macros/s/GYNTEST/exec';
const PW = 'student-pass-1', TPW = 'portal-teacher-1';

let server, url, browser, main, gyn;
const errors = [];
function backend() {
  const b = fixtureBackend({ files: FILES });
  b.teacher = {};
  b.call = function (o) { return b.doPost(o); };
  b.addStudents = function (m, list) {
    if (!b.teacher[m]) { b.call({ module: m, action: 'setup', password: 'teacher-' + m + '-1' }); b.teacher[m] = b.call({ module: m, action: 'login', password: 'teacher-' + m + '-1' }).token; }
    let r = b.call({ module: m, action: 'bulkAddStudents', token: b.teacher[m], students: list });
    if (!r.ok && r.code === 'auth') {   // its module session was ended (e.g. "End all module teacher sessions") → sign in again
      b.teacher[m] = b.call({ module: m, action: 'login', password: 'teacher-' + m + '-1' }).token;
      r = b.call({ module: m, action: 'bulkAddStudents', token: b.teacher[m], students: list });
    }
    assert.ok(r.ok, JSON.stringify(r));
  };
  return b;
}
test.before(async function () {
  if (SKIP) return;
  main = backend(); gyn = backend();
  main.addStudents('cellinjury', [{ username: 's1', name: 'Student One', password: PW, mustChange: false }]);
  main.addStudents('inflhealing', [{ username: 's1', name: 'Student One', password: 'other-pass-22', mustChange: false }]);
  gyn.addStudents('vulva', [{ username: 's1', name: 'Student One', password: PW, mustChange: false }]);
  // backend 2 plays the role of a module on another Apps Script deployment
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  // test list: the two real modules + test-only entries for the other states and a second backend
  const mods = main.call({ module: 'portal', action: 'portalInfo' }).modules.concat([
    { id: 'gyntest', title: 'Second-backend test module', icon: '🌸', status: 'available', url: 'https://third-year-med.github.io/test-gyn/', moduleKey: 'vulva', handoff: 'vp', backend: GYN },
    { id: 'readytest', title: 'Ready test module', icon: '🧬', status: 'ready', moduleKey: 'readytest' },
    { id: 'soontest', title: 'Soon test module', icon: '❤️', status: 'soon' }
  ]);
  assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: mods }).ok);
  main.call({ module: 'portal', action: 'logout', token: t });
  server = http.createServer(function (req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.PORTAL_CONFIG = ' + JSON.stringify({ backendUrl: MAIN }) + ';'); return; }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (rel.indexOf('..') >= 0 || !/^(index\.html|assets\/)/.test(rel) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  url = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ executablePath: EXE });
});
test.after(async function () { if (SKIP) return; await browser.close(); server.close(); });

const navigations = [];
async function page(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', function (e) { errors.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  await p.route('https://script.google.com/**', async function (route) {
    const b = route.request().url().indexOf('GYNTEST') >= 0 ? gyn : main;
    const out = b.ctx.doPost({ postData: { contents: route.request().postData() || '' } }).getContent();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
  });
  await p.route('https://third-year-med.github.io/**', function (route) { navigations.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); });
  return p;
}
async function signIn(p, id, pw) {
  await p.fill('#p-u', id); await p.fill('#p-p', pw); await p.click('form.signin button[type=submit]');
}
function cardText(p, id) { return p.textContent('.mod[data-id="' + id + '"]'); }

test('before sign-in: every module is shown with its status, none can be entered', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('.mod[data-id="cellinjury"]');
  assert.match(await cardText(p, 'cellinjury'), /Available/);
  assert.match(await cardText(p, 'readytest'), /Completed – not yet released/);
  assert.match(await cardText(p, 'soontest'), /Coming soon/);
  assert.strictEqual(await p.$('.mod .go'), null, 'no module can be opened before signing in');
  await p.context().close();
});

test('sign-in: wrong password refused; right one unlocks only the modules registered for this ID + password', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await signIn(p, 's1', 'wrong-password');
  await p.waitForFunction(function () { return /Incorrect Student ID or password/.test(document.querySelector('form.signin .err').textContent); });
  assert.match(await p.textContent('form.signin .err'), /group link/, 'the main page points students with a group link to it');
  await signIn(p, 'S1', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  assert.match(await cardText(p, 'cellinjury'), /Available to you/);
  assert.match(await cardText(p, 'gyntest'), /Available to you/, 'module on the second backend');
  assert.match(await cardText(p, 'inflhealing'), /different password/);
  assert.strictEqual(await p.$('.mod[data-id="inflhealing"] .go'), null);
  assert.match(await cardText(p, 'readytest'), /not yet released/);
  assert.strictEqual(await p.$('.mod[data-id="readytest"] .go'), null, 'a completed module is not opened by its status');
  assert.match(await p.textContent('#who'), /Student One/);
  // Open → the module's own session is handed over, then the module page is opened
  await p.click('.mod[data-id="cellinjury"] .go');
  await p.waitForTimeout(300);
  assert.ok(navigations.some(function (u) { return /cell-injury-teaching-platform/.test(u); }));
  const ci = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('ci_stu_session_v1'); }));
  assert.ok(ci && ci.token && !ci.url && ci.student.username === 's1', JSON.stringify(ci));
  assert.strictEqual(main.call({ module: 'cellinjury', action: 'studentSession', stoken: ci.token }).ok, true, 'the module accepts the handed-over session');
  await p.click('.mod[data-id="gyntest"] .go');
  await p.waitForTimeout(300);
  const vp = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('vp_vulva_session'); }));
  assert.strictEqual(gyn.call({ module: 'vulva', action: 'studentSession', stoken: vp.stoken }).ok, true);
  // sign out ends the sessions and removes the hand-over
  await p.click('#who button');
  await p.waitForSelector('form.signin');
  assert.strictEqual(await p.evaluate(function () { return sessionStorage.getItem('ci_stu_session_v1'); }), null);
  await p.waitForTimeout(300);
  assert.strictEqual(main.call({ module: 'cellinjury', action: 'studentSession', stoken: ci.token }).ok, false, 'session ended on sign-out');
  await p.context().close();
});

test('teacher panel: status changes are shown at once, but never open a module without an account', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', 'wrong-pass-1'); await p.click('form.card button[type=submit]');
  await p.waitForFunction(function () { return /Incorrect/.test(document.querySelector('form.card .err').textContent); });
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('.modrow');
  assert.match(await p.textContent('.modrow'), /1 active student account/);
  const row = p.locator('.modrow', { hasText: 'Ready test module' });
  await row.locator('select[data-k=status]').selectOption('available');
  await p.click('.save');
  await p.waitForFunction(function () { return /Saved/.test((document.querySelector('.toast') || {}).textContent || ''); });
  await p.goto(url); await p.reload();
  await p.waitForSelector('.mod[data-id="readytest"]');
  assert.match(await cardText(p, 'readytest'), /Available/);
  await signIn(p, 's1', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  assert.match(await cardText(p, 'readytest'), /Not registered for your account/);
  assert.strictEqual(await p.$('.mod[data-id="readytest"] .go'), null);
  await p.context().close();
});

test('teacher: one sign-in → Teacher Dashboard → open any module directly as teacher; management still works', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('.mod');
  await p.click('.top a.tportal');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-modules .mod[data-id="cellinjury"] .t-open');
  assert.match(await p.textContent('h1.page-h'), /Teacher Dashboard/);
  assert.match(await p.textContent('.top a.tportal'), /Platform Home/);
  assert.match(await p.textContent('#t-modules'), /Teaching Modules/);
  await p.waitForSelector('#t-manage .modrow');
  assert.match(await p.textContent('#t-manage'), /Teacher Management/);
  if (process.env.SHOTS) { await p.screenshot({ path: path.join(process.env.SHOTS, 'dashboard.png'), fullPage: true }); await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(process.env.SHOTS, 'dashboard-phone.png') }); assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'dashboard fits a phone'); await p.setViewportSize({ width: 1280, height: 900 }); }
  // open Cell Injury as teacher: the module's own teacher session is created and placed in its slot
  const before = navigations.length;
  await p.click('#t-modules .mod[data-id="cellinjury"] .t-open');
  await p.waitForTimeout(400);
  assert.ok(navigations.slice(before).some(function (u) { return /cell-injury-teaching-platform\/$/.test(u); }), 'module opened');
  const ci = JSON.parse(await p.evaluate(function () { return localStorage.getItem('ci_backend_token_v1'); }));
  assert.ok(ci && ci.token && !ci.url, JSON.stringify(ci));
  const ses = main.call({ module: 'cellinjury', action: 'studentSession', token: ci.token });
  assert.ok(ses.ok && ses.role === 'teacher', 'the module recognises a TEACHER session');
  assert.strictEqual(main.call({ module: 'inflhealing', action: 'studentSession', token: ci.token }).ok, false, 'only for that module');
  // the module's Teacher Portal (students, content, results…) is reached the same way
  await p.click('#t-modules .mod[data-id="inflhealing"] .t-admin');
  await p.waitForTimeout(400);
  assert.ok(navigations.slice(before).some(function (u) { return /inflammation-healing\/$/.test(u); }), "module opened (the #/teacher part is not sent in the request)");
  const ih = JSON.parse(await p.evaluate(function () { return localStorage.getItem('ih_backend_token_v1'); }));
  assert.ok(main.call({ module: 'inflhealing', action: 'listStudents', token: ih.token }).ok, 'module management works with it');
  // a module that is not released yet can still be reviewed by the teacher, never by students
  assert.ok(await p.$('#t-modules .mod[data-id="readytest"]'));
  // front-page management is unchanged
  await p.locator('.modrow', { hasText: 'Soon test module' }).locator('input[data-k=subtitle]').fill('Edited by teacher');
  await p.click('.save');
  await p.waitForFunction(function () { return /Saved/.test((document.querySelector('.toast') || {}).textContent || ''); });
  assert.strictEqual(main.call({ module: 'portal', action: 'portalInfo' }).modules.filter(function (m) { return m.id === 'soontest'; })[0].subtitle, 'Edited by teacher');
  // sign out ends the dashboard AND the module teacher sessions it opened
  await p.click('#who button');
  await p.waitForSelector('form.signin');
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(function () { return localStorage.getItem('ci_backend_token_v1'); }), null);
  assert.strictEqual(main.call({ module: 'cellinjury', action: 'studentSession', token: ci.token }).ok, false, 'module teacher session ended');
  assert.strictEqual(main.call({ module: 'inflhealing', action: 'listStudents', token: ih.token }).ok, false);
  assert.match(await p.textContent('.top a.tportal'), /Teacher Sign-In/);
  await p.context().close();
});

test('Admin: platform directory — add institutions, groups (same name at two universities), deliveries; scan existing data; nothing else changes', { skip: SKIP }, async function () {
  const p = await page();
  const infoBefore = JSON.stringify(main.call({ module: 'portal', action: 'portalInfo' }).modules);
  const studentsBefore = JSON.stringify(main.sheets.Students._rows);
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir');
  await p.click('#t-dir summary');
  await p.waitForSelector('#t-dir .dir-tabs');
  const pane = '#t-dir .dir-pane';
  async function saved() { await p.waitForFunction(function () { return /Saved/.test((document.querySelector('.toast') || {}).textContent || ''); }); await p.waitForTimeout(150); await p.evaluate(function () { document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); }); }
  // institutions
  for (const n of [['Al-Razi University', 'Al-Razi'], ['Misrata University', 'Misrata']]) {
    await p.fill(pane + ' form [data-k=name]', n[0]); await p.fill(pane + ' form [data-k=shortName]', n[1]);
    await p.click(pane + ' form button[type=submit]'); await saved();
    await p.waitForFunction(function (t) { return document.querySelector('#t-dir .dir-list').textContent.indexOf(t) >= 0; }, n[0]);
  }
  // groups: "Group A" at both institutions
  await p.click('#t-dir .dir-tab[data-t=groups]');
  for (const g of [['Al-Razi University', 'razi-a-26'], ['Misrata University', 'misrata-a-26']]) {
    await p.selectOption(pane + ' form [data-k=institutionId]', { label: g[0] });
    await p.fill(pane + ' form [data-k=name]', 'Group A'); await p.fill(pane + ' form [data-k=academicYear]', '2026-27'); await p.fill(pane + ' form [data-k=linkCode]', g[1]);
    await p.click(pane + ' form button[type=submit]'); await saved();
    await p.waitForFunction(function (c) { return document.querySelector('#t-dir .dir-list').textContent.indexOf(c) >= 0; }, g[1]);
  }
  assert.match(await p.textContent('#t-dir .dir-list'), /Al-Razi · Group A \(2026-27\)[\s\S]*Misrata · Group A \(2026-27\)/);
  // each group shows its full student link, ready to copy
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'directory-groups.png') });
  assert.strictEqual(await p.inputValue('#t-dir .dir-row:first-child .grp-url'), url + '?g=razi-a-26');
  assert.strictEqual(await p.getAttribute('#t-dir .dir-row:first-child .grp-link a', 'href'), url + '?g=razi-a-26');
  await p.click('#t-dir .dir-row:first-child [data-a=copy]');
  await p.waitForFunction(function () { return /Link copied/.test((document.querySelector('.toast') || {}).textContent || ''); });
  await p.evaluate(function () { document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); });
  // a duplicate link code is refused with a clear message
  await p.selectOption(pane + ' form [data-k=institutionId]', { label: 'Misrata University' });
  await p.fill(pane + ' form [data-k=name]', 'Group B'); await p.fill(pane + ' form [data-k=linkCode]', 'RAZI-A-26');
  await p.click(pane + ' form button[type=submit]');
  await p.waitForFunction(function () { return /already used/.test((document.querySelector('.toast') || {}).textContent || ''); });
  // deliveries: Cell Injury to both groups
  await p.click('#t-dir .dir-tab[data-t=deliveries]');
  for (const g of ['Al-Razi · Group A (2026-27)', 'Misrata · Group A (2026-27)']) {
    await p.selectOption(pane + ' form [data-k=groupId]', { label: g });
    await p.selectOption(pane + ' form [data-k=moduleId]', { label: 'Cell Injury & Cell Death' });
    await p.selectOption(pane + ' form [data-k=status]', 'available');
    await p.click(pane + ' form button[type=submit]'); await saved();
  }
  await p.waitForFunction(function () { return document.querySelectorAll('#t-dir .dir-row').length === 2; });
  const txt = await p.textContent('#t-dir .dir-list');
  assert.match(txt, /cellinjury-razi-a-26/); assert.match(txt, /cellinjury-misrata-a-26/);
  // edit a delivery (status) and deactivate a group
  await p.click('#t-dir .dir-row:first-child [data-a=edit]');
  await p.selectOption('#t-dir .dir-row:first-child .dir-edit [data-k=status]', 'ready');
  await p.click('#t-dir .dir-row:first-child .dir-edit button[type=submit]'); await saved();
  await p.waitForFunction(function () { return /Completed – not yet released/.test(document.querySelector('#t-dir .dir-list').textContent); });
  await p.click('#t-dir .dir-tab[data-t=groups]');
  await p.click('#t-dir .dir-row:first-child [data-a=act]');
  await p.waitForSelector('#t-dir .dir-row.off');
  // existing data scan (read-only)
  await p.click('#t-dir .dir-tab[data-t=existing]');
  await p.click(pane + ' > button');
  await p.waitForSelector('#t-dir .dir-tbl');
  assert.match(await p.textContent('#t-dir .dir-tbl'), /cellinjury[\s\S]*normal link/);
  if (process.env.SHOTS) { await p.click('#t-dir .dir-tab[data-t=deliveries]'); await p.screenshot({ path: path.join(process.env.SHOTS, 'directory.png'), fullPage: true }); }
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'directory fits a phone');
  // the directory changed nothing the students or modules use
  assert.strictEqual(JSON.stringify(main.call({ module: 'portal', action: 'portalInfo' }).modules), infoBefore);
  assert.strictEqual(JSON.stringify(main.sheets.Students._rows), studentsBefore);
  await p.context().close();
});

/* ---------------- Step 2: group front pages ---------------- */
let GRP = null;
function groupFixture() {
  if (GRP) return GRP;
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const sv = function (kind, record, extra) { const r = main.call(Object.assign({ module: 'portal', action: 'dirSave', token: t, kind: kind, record: record }, extra || {})); assert.ok(r.ok, JSON.stringify(r)); return r.record; };
  main.call({ module: 'portal', action: 'dirGet', token: t });
  const ri = sv('institution', { name: 'Test Razi University', shortName: 'Test Razi' }), mi = sv('institution', { name: 'Test Misrata University', shortName: 'Test Misrata' });
  const ra = sv('group', { institutionId: ri.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'tr-a' });
  const ma = sv('group', { institutionId: mi.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'tm-a' });
  sv('delivery', { groupId: ra.groupId, moduleId: 'cellinjury', status: 'available' }); sv('delivery', { groupId: ra.groupId, moduleId: 'inflhealing', status: 'available' });
  sv('delivery', { groupId: ma.groupId, moduleId: 'cellinjury', status: 'available' });
  main.addStudents('cellinjury-tr-a', [{ username: 'ahmed', name: 'Student Ahmed', password: PW, mustChange: false }]);
  main.addStudents('inflhealing-tr-a', [{ username: 'ahmed', name: 'Student Ahmed', password: PW, mustChange: false }]);
  main.addStudents('cellinjury-tm-a', [{ username: 'sara', name: 'Student Sara', password: PW, mustChange: false }]);
  main.call({ module: 'portal', action: 'rosterImport', token: t, groupId: ra.groupId }); main.call({ module: 'portal', action: 'rosterImport', token: t, groupId: ma.groupId });
  main.call({ module: 'portal', action: 'logout', token: t });
  GRP = true; return GRP;
}

test('group page: Al-Razi A link shows Al-Razi A and its modules; sign-in opens the module in the group\'s own storage', { skip: SKIP }, async function () {
  groupFixture();
  const p = await page();
  await p.goto(url + '?g=tr-a');
  await p.waitForSelector('.hero .grp');
  assert.match(await p.textContent('.hero .grp'), /Test Razi University[\s\S]*Group A · 2026-27/);
  assert.deepStrictEqual(await p.$$eval('.mod', function (els) { return els.map(function (e) { return e.dataset.id; }); }), ['cellinjury', 'inflhealing']);
  assert.ok(!/Misrata/.test(await p.textContent('main')), 'nothing of the other university');
  assert.match(await p.title(), /Group A — Test Razi University/);
  if (process.env.SHOTS) { await p.screenshot({ path: path.join(process.env.SHOTS, 'group-page.png') }); await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(process.env.SHOTS, 'group-page-phone.png') }); assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1); await p.setViewportSize({ width: 1280, height: 900 }); }
  await signIn(p, 'ahmed', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  assert.match(await p.textContent('.card.welcome'), /Student Ahmed/);
  const before = navigations.length;
  await p.click('.mod[data-id="cellinjury"] .go');
  await p.waitForTimeout(400);
  assert.ok(navigations.slice(before).some(function (u) { return /cell-injury-teaching-platform\/\?g=tr-a$/.test(u); }), 'module opened with the group link');
  const ci = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('ci_tr-a_stu_session_v1'); }));
  assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'studentSession', stoken: ci.token }).role, 'student');
  assert.strictEqual(main.call({ module: 'cellinjury-tm-a', action: 'studentSession', stoken: ci.token }).ok, false);
  assert.strictEqual(main.call({ module: 'cellinjury', action: 'studentSession', stoken: ci.token }).ok, false);
  // the main front page keeps its own, separate sign-in
  await p.goto(url); await p.waitForSelector('form.signin');
  // sign-out on the group page ends the group sessions
  await p.goto(url + '?g=tr-a'); await p.waitForSelector('.card.welcome');
  await p.click('#who button'); await p.waitForSelector('form.signin'); await p.waitForTimeout(300);
  assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'studentSession', stoken: ci.token }).ok, false, 'ended on sign-out');
  await p.context().close();
});

test('group page: changing ?g= to another university gives no access; an unknown link falls back to the main page with a notice', { skip: SKIP }, async function () {
  groupFixture();
  const p = await page();
  await p.goto(url + '?g=tm-a');
  await p.waitForSelector('.hero .grp');
  assert.match(await p.textContent('.hero .grp'), /Test Misrata University/);
  assert.deepStrictEqual(await p.$$eval('.mod', function (els) { return els.map(function (e) { return e.dataset.id; }); }), ['cellinjury']);
  await signIn(p, 'ahmed', PW);   // Al-Razi student on the Misrata link
  await p.waitForFunction(function () { return /Incorrect Student ID or password/.test(document.querySelector('form.signin .err').textContent); });
  assert.strictEqual(await p.$('.mod .go'), null);
  await signIn(p, 'sara', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  await p.goto(url + '?g=no-such-group');
  await p.waitForSelector('.grp-notice');
  assert.match(await p.textContent('.grp-notice'), /not valid/);
  assert.strictEqual(await p.$('.hero .grp'), null);
  await p.waitForSelector('.mod[data-id="cellinjury"]');
  // the Teacher Sign-In button leaves the group page for the platform's single teacher sign-in
  await p.goto(url + '?g=tr-a'); await p.waitForSelector('.hero .grp');
  assert.strictEqual(await p.getAttribute('.top a.tportal', 'href'), '/#/teacher');
  await p.context().close();
});

test('roster: Admin adds a student → temporary password → the student signs in on the group page, chooses a password, opens the modules', { skip: SKIP }, async function () {
  groupFixture();
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir');
  await p.click('#t-dir summary');
  await p.waitForSelector('#t-dir .dir-tab[data-t=students]');
  await p.click('#t-dir .dir-tab[data-t=students]');
  await p.selectOption('#t-dir [data-k=rg]', { label: 'Test Razi · Group A (2026-27)' });
  await p.waitForSelector('#t-dir .roster-add');
  assert.match(await p.textContent('#t-dir .roster'), /Cell Injury & Cell Death[\s\S]*Inflammation & Healing/);
  await p.fill('#t-dir .roster-add textarea', 'R100, Laila Hassan\nbad id!, Nope');
  await p.click('#t-dir .roster-add button[type=submit]');
  await p.waitForSelector('#t-dir .roster-res code.pw');
  const temp = (await p.textContent('#t-dir .roster-res code.pw')).trim();
  assert.ok(temp.length >= 8);
  assert.match(await p.textContent('#t-dir .roster-res'), /not valid/);
  const row = p.locator('#t-dir .roster-tbl tr', { hasText: 'r100' });
  assert.match(await row.textContent(), /Laila Hassan[\s\S]*✓ temp[\s\S]*✓ temp/);
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'roster.png') });
  // the student, on the group page
  const q = await page();
  await q.goto(url + '?g=tr-a');
  await q.waitForSelector('form.signin');
  await signIn(q, 'R100', temp);
  await q.waitForSelector('#p-n1'); await q.waitForTimeout(300);   // let the new form settle (focus) before typing
  assert.match(await q.textContent('form.signin'), /Choose your own password/);
  await q.fill('#p-n1', 'laila-own-pass'); await q.fill('#p-n2', 'laila-own-pass');
  await q.click('form.signin button[type=submit]');
  await q.waitForSelector('.mod[data-id="inflhealing"] .go');
  assert.match(await q.textContent('.card.welcome'), /Laila Hassan/);
  ['cellinjury-tr-a', 'inflhealing-tr-a'].forEach(function (st) {
    const r = main.call({ module: st, action: 'studentLogin', username: 'r100', password: 'laila-own-pass' });
    assert.ok(r.ok && !r.mustChange, st + ' has the new password');
    assert.strictEqual(main.call({ module: st, action: 'studentLogin', username: 'r100', password: temp }).ok, false);
  });
  assert.strictEqual(main.call({ module: 'cellinjury-tm-a', action: 'studentLogin', username: 'r100', password: 'laila-own-pass' }).ok, false, 'not at the other university');
  // Admin deactivates her: the group page refuses her
  await row.locator('[data-a=act]').click();
  await p.waitForFunction(function () { return /Deactivated/.test((document.querySelector('.toast') || {}).textContent || ''); });
  const q2 = await page();
  await q2.goto(url + '?g=tr-a'); await q2.waitForSelector('form.signin');
  await signIn(q2, 'r100', 'laila-own-pass');
  await q2.waitForFunction(function () { return /Incorrect Student ID or password/.test(document.querySelector('form.signin .err').textContent); });
  await p.context().close(); await q.context().close(); await q2.context().close();
});

test('a group student who signs in on the MAIN page is taken to their group page, signed in', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const grp = main.call({ module: 'portal', action: 'dirGet', token: t }).groups.filter(function (g) { return g.linkCode === 'tr-a'; })[0];
  assert.ok(main.call({ module: 'portal', action: 'rosterAdd', token: t, groupId: grp.groupId, students: [{ studentId: '11223344', name: 'Main Page Student', password: 'his-pass-123' }] }).results[0].ok);
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('form.signin');
  await signIn(p, '11223344', 'his-pass-123');
  // added with "must choose own password": the main page asks for it first, then opens the group page signed in
  await p.waitForSelector('#p-n1'); await p.waitForTimeout(300);
  await p.fill('#p-n1', 'his-own-pass-9'); await p.fill('#p-n2', 'his-own-pass-9'); await p.click('form.signin button[type=submit]');
  await p.waitForURL(/\?g=tr-a/);
  await p.waitForSelector('.card.welcome');
  assert.match(await p.textContent('.hero .grp'), /Test Razi University/);
  assert.match(await p.textContent('.card.welcome'), /Main Page Student/);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  // a wrong password on the main page stays the generic message (with the group-link hint)
  await p.goto(url); await p.waitForSelector('form.signin');
  await signIn(p, '11223344', 'his-pass-123');   // the old password no longer works
  await p.waitForFunction(function () { return /Incorrect Student ID or password[\s\S]*group link/.test(document.querySelector('form.signin .err').textContent); });
  await p.context().close();
});

test('roster: temporary passwords for a whole group in one click (different each, or one shared), with a downloadable list', { skip: SKIP }, async function () {
  groupFixture();
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=students]');
  await p.selectOption('#t-dir [data-k=rg]', { label: 'Test Misrata · Group A (2026-27)' });
  await p.waitForSelector('#t-dir .roster-add');
  await p.fill('#t-dir .roster-add textarea', 'm201, Many One\nm202, Many Two\nm203, Many Three');
  await p.click('#t-dir .roster-add button[type=submit]');
  await p.waitForSelector('#t-dir .roster-bulk');
  // different passwords for those still on a temporary one (the three new; sara has her own)
  assert.match(await p.textContent('#t-dir .roster-bulk'), /not chosen their own password yet \(3\)/);
  assert.ok(await p.isChecked('#t-dir .roster-bulk input[name=bs][value=temp]') && await p.isChecked('#t-dir .roster-bulk input[name=bp][value=same]'), 'defaults: not-yet-chosen students, one shared password');
  await p.check('#t-dir .roster-bulk input[name=bp][value=each]');
  await p.click('#t-dir .roster-bulk button[type=submit]');
  await p.waitForFunction(function () { return /New temporary passwords for 3 students/.test((document.querySelector('#t-dir .roster-res') || {}).textContent || ''); });
  const pws = await p.$$eval('#t-dir .roster-res code.pw', function (els) { return els.map(function (e) { return e.textContent.trim(); }); });
  assert.strictEqual(pws.length, 3); assert.strictEqual(new Set(pws).size, 3);
  const ids = await p.$$eval('#t-dir .roster-res tbody tr td:first-child', function (els) { return els.map(function (e) { return e.textContent.trim(); }); });
  ids.forEach(function (id, i) { assert.ok(main.call({ module: 'cellinjury-tm-a', action: 'studentLogin', username: id, password: pws[i] }).ok, id); });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#t-dir .roster-res [data-a=dl]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /Student ID,Name,Temporary password,Group link/); assert.ok(csv.indexOf(pws[0]) > 0 && /\?g=tm-a/.test(csv));
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'bulk.png') });
  // one shared password for everyone
  await p.check('#t-dir .roster-bulk input[name=bs][value=all]');
  await p.check('#t-dir .roster-bulk input[name=bp][value=each]');
  await p.fill('#t-dir .roster-bulk [data-k=shared]', 'Misrata-2026');   // typing in the box selects "the same password"
  assert.ok(await p.isChecked('#t-dir .roster-bulk input[name=bp][value=same]'));
  await p.click('#t-dir .roster-bulk button[type=submit]');
  await p.waitForFunction(function () { return /New temporary passwords for 4 students/.test((document.querySelector('#t-dir .roster-res') || {}).textContent || ''); });
  ['m201', 'm202', 'm203', 'sara'].forEach(function (id) { const r = main.call({ module: 'cellinjury-tm-a', action: 'studentLogin', username: id, password: 'Misrata-2026' }); assert.ok(r.ok && r.mustChange, id); });
  await p.context().close();
});

test('a module delivered AFTER the student signed in opens without signing out (reported case)', { skip: SKIP }, async function () {
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const sv = function (kind, record) { const r = main.call({ module: 'portal', action: 'dirSave', token: t, kind: kind, record: record }); assert.ok(r.ok, JSON.stringify(r)); return r.record; };
  main.call({ module: 'portal', action: 'dirGet', token: t });
  const inst = sv('institution', { name: 'Late Delivery University' });
  const g = sv('group', { institutionId: inst.institutionId, name: 'Group A', academicYear: '2026-2027', linkCode: 'late-a' });
  sv('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' });
  main.call({ module: 'portal', action: 'rosterAdd', token: t, groupId: g.groupId, mustChange: false, students: [{ studentId: '11223344', name: 'Alzwawy wesam', password: 'own-pass-123' }] });
  const p = await page();
  await p.goto(url + '?g=late-a');
  await signIn(p, '11223344', 'own-pass-123');
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  // the Admin now delivers Inflammation to the group
  sv('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  await p.reload();
  await p.waitForSelector('.mod[data-id="inflhealing"] .go', { timeout: 10000 });
  assert.match(await p.textContent('.mod[data-id="inflhealing"]'), /Available to you/);
  assert.match(await p.textContent('.card.welcome'), /You can open 2 of the 2/);
  const ih = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('pp_session_v1:late-a'); })).modules.inflhealing;
  assert.strictEqual(main.call({ module: 'inflhealing-late-a', action: 'studentSession', stoken: ih.token }).role, 'student');
  await p.context().close();
});

/* ---------------- Step 4: personal teacher accounts ---------------- */
let TCH = null;
async function adminCreatesTeacher(username, name, groupLabelText, moduleTitle) {
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=teachers]');
  await p.waitForSelector('#t-dir .teachers form');
  await p.fill('#t-dir .teachers form [data-k=username]', username); await p.fill('#t-dir .teachers form [data-k=name]', name);
  await p.click('#t-dir .teachers form button[type=submit]');
  await p.waitForSelector('#t-dir .roster-res code.pw');
  const temp = (await p.textContent('#t-dir .roster-res code.pw')).trim();
  // the assignment editor opens for the new teacher: tick exactly one group + module
  const fs_ = p.locator('#t-dir .asg-edit fieldset', { hasText: groupLabelText });
  await fs_.locator('label', { hasText: moduleTitle }).locator('input').check();
  await p.click('#t-dir .asg-edit .dir-act button');
  await p.waitForFunction(function () { return /Assignments saved \(1\)/.test((document.querySelector('.toast') || {}).textContent || ''); });
  assert.match(await p.textContent('#t-dir .teachers'), new RegExp(name + '[\\s\\S]*1 group/module assignment'));
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'teachers-admin.png') });
  await p.click('#t-dir [data-a=endall]');
  await p.waitForFunction(function () { return /module teacher session\(s\) ended/.test((document.querySelector('.toast') || {}).textContent || ''); });
  await p.context().close();
  return temp;
}
async function teacherSignsIn(p, username, temp, own) {
  await p.fill('#t-u', username); await p.fill('#t-p', temp); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#tp-n1'); await p.waitForTimeout(300);
  await p.fill('#tp-o', temp); await p.fill('#tp-n1', own); await p.fill('#tp-n2', own); await p.click('form.t-login button[type=submit]');
  await p.waitForSelector('#t-mine .my-group');
}

test('personal teacher: Admin creates Dr. Ahmed with ONE group + module; he signs in, sees only that, opens it; no Admin areas', { skip: SKIP }, async function () {
  groupFixture();
  const temp = await adminCreatesTeacher('dr.ahmed', 'Dr. Ahmed', 'Test Razi · Group A (2026-27)', 'Cell Injury');
  const p = await page();
  await p.goto(url + '#/teacher');
  await teacherSignsIn(p, 'dr.ahmed', temp, 'ahmed-own-pass-1');
  TCH = { username: 'dr.ahmed', pw: 'ahmed-own-pass-1' };
  assert.match(await p.textContent('h1.page-h'), /Teacher Dashboard/);
  assert.match(await p.textContent('#t-mine'), /Test Razi University · Group A/);
  assert.deepStrictEqual(await p.$$eval('#t-mine .mod', function (els) { return els.map(function (e) { return e.dataset.id; }); }), ['cellinjury'], 'only the assigned module');
  assert.ok(!/Misrata|Inflammation/.test(await p.textContent('#t-mine')), 'nothing else');
  assert.strictEqual(await p.$('#t-dir'), null, 'no platform directory'); assert.strictEqual(await p.$('#t-manage'), null, 'no Teacher Management'); assert.strictEqual(await p.$('#t-modules'), null);
  assert.strictEqual(await p.inputValue('#t-mine .grp-url'), url + '?g=tr-a');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'teacher-personal.png') });
  const before = navigations.length;
  await p.click('#t-mine .mod[data-id="cellinjury"] .t-open');
  await p.waitForTimeout(400);
  assert.ok(navigations.slice(before).some(function (u) { return /cell-injury-teaching-platform\/\?g=tr-a$/.test(u); }));
  const tok = JSON.parse(await p.evaluate(function () { return localStorage.getItem('ci_tr-a_backend_token_v1'); })).token;
  assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'studentSession', token: tok }).role, 'teacher');
  ['cellinjury', 'cellinjury-tm-a', 'inflhealing-tr-a'].forEach(function (m) { assert.strictEqual(main.call({ module: m, action: 'listStudents', token: tok }).ok, false, m); });
  // sign out: the teacher session and the module session end
  await p.click('#who button'); await p.waitForSelector('form.signin'); await p.waitForTimeout(300);
  assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'studentSession', token: tok }).ok, false);
  // wrong password → generic
  await p.goto(url + '#/teacher'); await p.fill('#t-u', 'dr.ahmed'); await p.fill('#t-p', 'wrong-pass'); await p.click('form.card button[type=submit]');
  await p.waitForFunction(function () { return /Incorrect username or password/.test(document.querySelector('form.card .err').textContent); });
  await p.context().close();
});

test('Admin: Content tab shows each module (versioning off) and a read-only migration report', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['cellinjury', { module: 'cellinjury', group: 'tr-a' }] }).modules;
  main.call({ module: 'cellinjury', action: 'upsert', token: tok.cellinjury.token, collection: 'topicsections', id: 'T1', data: { sections: ['A'] } });
  main.call({ module: 'cellinjury-tr-a', action: 'upsert', token: tok['cellinjury-tr-a'].token, collection: 'topicsections', id: 'T1', data: { sections: ['B'] } });
  const before = JSON.stringify(main.sheets.Content._rows);
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=content]');
  await p.waitForSelector('#t-dir .content-mod[data-module="cellinjury"]');
  assert.match(await p.textContent('#t-dir .content-mod[data-module="cellinjury"]'), /Versioned content: off[\s\S]*cellinjury-tr-a/);
  await p.click('#t-dir .content-mod[data-module="cellinjury"] [data-a=rep]');
  await p.waitForSelector('#t-dir .content-mod[data-module="cellinjury"] .report .roster-res');
  assert.match(await p.textContent('#t-dir .content-mod[data-module="cellinjury"] .report'), /read-only[\s\S]*different from the main copy/);
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'content-tab.png') });
  assert.strictEqual(JSON.stringify(main.sheets.Content._rows), before, 'nothing changed');
  await p.context().close();
});

test('Admin: Content tab — decide, create master v1.0, switch ON (every group gets it), switch OFF, undo', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['cellinjury', { module: 'cellinjury', group: 'tr-a' }, { module: 'cellinjury', group: 'tm-a' }] }).modules;
  main.call({ module: 'cellinjury', action: 'upsert', token: tok.cellinjury.token, collection: 'topicsections', id: 'T1', data: { sections: ['A'] } });
  main.call({ module: 'cellinjury-tr-a', action: 'upsert', token: tok['cellinjury-tr-a'].token, collection: 'topicsections', id: 'T1', data: { sections: ['B'] } });
  const original = JSON.stringify(main.sheets.Content._rows);
  const viewOf = function (storage) { const r = main.call({ module: storage, action: 'getAllContent', token: tok[storage].token, since: 0 }); const o = {}; r.items.forEach(function (i) { if (i.deleted) delete o[i.collection + '|' + i.id]; else o[i.collection + '|' + i.id] = i.data; }); return o; };
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=content]');
  const card = '#t-dir .content-mod[data-module="cellinjury"]';
  await p.waitForSelector(card + ' [data-a=rep]');
  await p.click(card + ' [data-a=rep]');
  await p.waitForSelector(card + ' select[data-key="cellinjury-tr-a|topicsections|T1"]');
  await p.selectOption(card + ' select[data-key="cellinjury-tr-a|topicsections|T1"]', 'group');
  if (process.env.SHOTS) await (await p.$(card)).screenshot({ path: path.join(process.env.SHOTS, 'content-migrate.png') });
  await p.click(card + ' [data-a=mig]');
  await p.waitForSelector(card + ' [data-a=on]');
  assert.match(await p.textContent(card), /Master copy: v1\.0[\s\S]*not used yet/);
  assert.deepStrictEqual(viewOf('cellinjury-tm-a'), {}, 'nothing changes before switching on');
  await p.click(card + ' [data-a=on]');
  await p.waitForSelector(card + ' [data-a=off]');
  assert.match(await p.textContent(card), /Versioned content: on/);
  assert.deepStrictEqual(viewOf('cellinjury-tm-a'), { 'topicsections|T1': { sections: ['B'] } }, 'Misrata receives the master (the chosen group version)');
  assert.deepStrictEqual(viewOf('cellinjury'), { 'topicsections|T1': { sections: ['B'] } });
  await p.click(card + ' [data-a=off]');
  await p.waitForSelector(card + ' [data-a=undo]');
  assert.deepStrictEqual(viewOf('cellinjury'), { 'topicsections|T1': { sections: ['A'] } }, 'off → exactly as before');
  await p.click(card + ' [data-a=undo]');
  await p.waitForSelector(card + ' [data-a=rep]');
  assert.strictEqual(JSON.stringify(main.sheets.Content._rows), original, 'undo → the exact original rows');
  await p.context().close();
});

test('the front page fits a phone screen', { skip: SKIP }, async function () {
  const p = await page({ width: 390, height: 844 });
  await p.goto(url);
  await p.waitForSelector('.mod');
  assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1);
  await p.context().close();
});

test('branding: heading, "Created by", no department line; Teacher Sign-In at the top', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('.mod');
  assert.strictEqual((await p.textContent('.hero h1')).trim(), 'Interactive Pathology Teaching Platform');
  assert.strictEqual((await p.textContent('.hero .by')).trim(), 'Created by Dr. Wesam Alzwawy');
  assert.match(await p.textContent('.top'), /Created by Dr\. Wesam Alzwawy/);
  const all = await p.textContent('body');
  assert.ok(!/Misurata|Pathology Department|College of Medicine/.test(all), 'department line removed');
  const tp = await p.$('.top a.tportal');
  assert.ok(tp, 'Teacher Sign-In button in the top bar');
  assert.match(await tp.textContent(), /Teacher Sign-In/);
  await tp.click();
  await p.waitForSelector('#t-p');
  assert.match(await p.textContent('h1.page-h'), /Teacher Sign-In/);
  await p.context().close();
});

test('an Available card works before sign-in: "Sign in to open" → sign in → the module opens', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('.mod[data-id="cellinjury"] .signfirst');
  assert.ok(await p.$('.mod[data-id="cellinjury"] a.alt[href^="https://third-year-med.github.io/cell-injury-teaching-platform/"]'), 'the module\'s own sign-in page stays reachable');
  await p.click('.mod[data-id="cellinjury"] .signfirst');
  assert.strictEqual(await p.evaluate(function () { return document.activeElement && document.activeElement.id; }), 'p-u', 'sign-in form gets the focus');
  assert.match(await p.textContent('form.signin .pending'), /Cell Injury/);
  const before = navigations.length;
  await signIn(p, 's1', PW);
  await p.waitForFunction(function (n) { return true; }, before);
  await p.waitForTimeout(600);
  assert.ok(navigations.slice(before).some(function (u) { return /cell-injury-teaching-platform/.test(u); }), 'opened right after signing in');
  const ci = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('ci_stu_session_v1'); }));
  assert.strictEqual(main.call({ module: 'cellinjury', action: 'studentSession', stoken: ci.token }).ok, true);
  await p.context().close();
});

// Uses the REAL module pages (CI_MODULE_HTML / IH_MODULE_HTML → their index.html; skipped when absent): the front page and
// the module are served on the same https://third-year-med.github.io origin, exactly as on GitHub Pages.
// CI_CONTENT_KEY / IH_CONTENT_KEY (optional, never committed): the modules' real content keys, so the course itself opens
// and the in-module header can be tested too.
const REAL = [['cellinjury', 'cell-injury-teaching-platform', process.env.CI_MODULE_HTML || '/home/user/cell-injury-teaching-platform/index.html', process.env.CI_CONTENT_KEY],
 ['inflhealing', 'inflammation-healing', process.env.IH_MODULE_HTML || '/home/user/inflammation-healing/index.html', process.env.IH_CONTENT_KEY]];
const HOME = 'https://third-year-med.github.io/Interactive-pathology-platform/';
const SERVE = {};
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const EXAM_HTML = process.env.EXAM_HTML || '/home/user/pathology-exams/index.html';   // the real Official Exams app   // packaged-release test: '<repo>/preview/' or '<repo>/' → another file
async function realPage(M, calls) {
  if (M[3]) main.ctx.CONTENT_KEYS[M[0]] = M[3];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', function (e) { if (!/content key|decrypt/i.test(e.message)) errors.push(M[1] + ': ' + e.message); });
  p.on('dialog', function (d) { d.accept(); });
  await p.route('https://drive.google.com/**', function (route) { return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG1, 'base64') }); });
  await p.route('https://script.google.com/**', async function (route) {
    const body = route.request().postData() || '';
    calls.push(JSON.parse(body));
    await route.fulfill({ status: 200, contentType: 'application/json', body: main.ctx.doPost({ postData: { contents: body } }).getContent() });
  });
  await p.route('https://third-year-med.github.io/**', function (route) {
    const u = new URL(route.request().url());
    if (u.pathname.indexOf('/pathology-exams/') === 0) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(EXAM_HTML) });
    const own = REAL.filter(function (R) { return u.pathname.indexOf('/' + R[1] + '/') === 0; })[0];
    if (own) {
      const sub = /\/preview\/(index\.html)?$/.test(u.pathname) ? own[1] + '/preview/' : own[1] + '/';
      if (SERVE[sub] === null || (sub !== own[1] + '/' && !SERVE[sub])) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(SERVE[sub] || own[2]) });
    }
    const rel = u.pathname.replace(/^\/Interactive-pathology-platform\/?/, '') || 'index.html';
    if (rel === 'config.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.PORTAL_CONFIG = ' + JSON.stringify({ backendUrl: MAIN }) + ';' });
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f) || rel.indexOf('..') >= 0) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)], body: fs.readFileSync(f) });
  });
  return p;
}
/** In the module: the return link is visible (header once the course is open, else the sign-in card) and goes, by the
 *  role the server confirmed, to the student front page or (teacher) to the Teacher Dashboard. Without the content key
 *  the course cannot open, so no role is confirmed and the link stays the plain Platform Home one. */
async function backHome(p, M, role, group) {
  const home = HOME + (group ? '?g=' + group : '');   // students return to their group's page
  const sel = M[3] ? '#app-header #pf-bar a.pf-home' : '#neo-boot a.pf-home';
  const teacher = role === 'teacher' && !!M[3];
  await p.waitForSelector(sel, { state: 'visible', timeout: 15000 });
  if (teacher) await p.waitForFunction(function (s) { return document.querySelector(s).dataset.role === 'teacher'; }, sel);
  assert.match(await p.textContent(sel), teacher ? /Back to Teacher Dashboard/ : /Back to Platform Home/);
  assert.strictEqual(await p.getAttribute(sel, 'href'), teacher ? HOME + '#/teacher' : home);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, M[0] + '-' + role + '-back.png'), clip: { x: 0, y: 0, width: 1280, height: 200 } });
  await p.click(sel);
  if (teacher) { await p.waitForURL(HOME + '#/teacher'); await p.waitForSelector('#t-modules .t-open'); assert.match(await p.textContent('h1.page-h'), /Teacher Dashboard/); }
  else { await p.waitForURL(home); await p.waitForSelector('.hero h1'); assert.strictEqual(await p.$('#t-modules'), null, 'the student front page, not the dashboard'); }
}
REAL.forEach(function (M) {
  test('teacher: Teacher Sign-In → Dashboard → the real ' + M[1] + ' opens in teacher mode (no module password) → Back to Platform Home', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await p.waitForSelector('#t-modules .mod[data-id="' + M[0] + '"] .t-open');
    await p.click('#t-modules .mod[data-id="' + M[0] + '"] .t-open');
    await p.waitForURL(new RegExp(M[1]));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    const sess = calls.filter(function (c) { return c.module === M[0] && c.action === 'studentSession' && c.token; });
    assert.ok(sess.length, 'the module checked the teacher session with its backend');
    assert.strictEqual(calls.filter(function (c) { return c.module === M[0] && (c.action === 'login' || c.action === 'studentLogin'); }).length, 0, 'no module sign-in');
    assert.strictEqual(await p.$('#nb-tpass'), null); assert.strictEqual(await p.$('#nb-user'), null);
    if (M[3]) assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'teacher');
    if (process.env.SHOTS) { await p.waitForTimeout(800); await p.screenshot({ path: path.join(process.env.SHOTS, M[0] + '-teacher.png') }); }
    await backHome(p, M, 'teacher');
    assert.match(await p.textContent('.top a.tportal'), M[3] ? /Platform Home/ : /Teacher Dashboard/, 'still signed in as teacher (on the dashboard when the course opened as teacher)');
    if (M[3]) await p.waitForSelector('#t-manage .modrow');   // Teacher Management still there
    await p.context().close();
  });
  test('student: front page → the real ' + M[1] + ' → Back to Platform Home → front page (still signed in)', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    main.addStudents('cellinjury', [{ username: 'home-' + M[0], name: 'Home Student', password: PW, mustChange: false }]);
    main.addStudents('inflhealing', [{ username: 'home-' + M[0], name: 'Home Student', password: PW, mustChange: false }]);
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME);
    await p.waitForSelector('.mod[data-id="' + M[0] + '"]');
    await signIn(p, 'home-' + M[0], PW);
    await p.waitForSelector('.mod[data-id="' + M[0] + '"] .go');
    await p.click('.mod[data-id="' + M[0] + '"] .go');
    await p.waitForURL(new RegExp(M[1]));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    if (M[3]) {
      assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'student');
      // the module's Teacher Portal page has no password box of its own any more: it points to the single Teacher Sign-In
      await p.evaluate(function () { location.hash = '#/teacher'; });
      await p.waitForSelector('#view-teacher .portal-gate a[href="' + HOME + '#/teacher"]');
      assert.strictEqual(await p.$('#view-teacher input[type=password]'), null);
      if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, M[0] + '-student-teacherpage.png') });
    }
    assert.strictEqual(calls.filter(function (c) { return c.action === 'studentLogin'; }).length, 0, 'no second sign-in');
    await backHome(p, M, 'student');
    await p.waitForSelector('.card.welcome');
    assert.match(await p.textContent('.card.welcome'), /Home Student/, 'back on the front page, still signed in');
    await p.context().close();
  });
  test('the real ' + M[1] + ' sign-in page: Back to Platform Home, and the Teacher tab points to the single Teacher Sign-In', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto('https://third-year-med.github.io/' + M[1] + '/');
    await p.waitForSelector('#neo-boot #nb-user');
    assert.ok(await p.$('#neo-boot a.pf-home[href="' + HOME + '"]'), 'Back to Platform Home on the sign-in screen');
    await p.click('#neo-boot .nb-tab:nth-child(2)');
    await p.waitForSelector('#nb-tgo');
    assert.strictEqual(await p.$('#nb-tpass'), null, 'no module teacher password field');
    assert.strictEqual(await p.getAttribute('#nb-tgo', 'href'), HOME + '#/teacher');
    assert.ok(await p.$('#neo-boot a.pf-home'), 'still there after switching tabs');
    await p.click('#nb-tgo');
    await p.waitForURL(HOME + '#/teacher');
    await p.waitForSelector('#t-p');
    assert.strictEqual(calls.filter(function (c) { return c.module === M[0] && c.action === 'login'; }).length, 0);
    await p.context().close();
  });
});

REAL.forEach(function (M) {
  test('versioned content ON: the real ' + M[1] + ' opens normally for a group student and receives the master copy', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    groupFixture();
    main.call({ module: 'portal', action: 'setup', password: TPW });
    const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
    const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]].token;
    main.call({ module: M[0], action: 'upsert', token: tok, collection: 'customtopics', id: 'zz-master-' + M[0], data: { title: 'Master topic', units: [] } });
    assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
    assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
    try {
      const calls = [], answers = [];
      const p = await realPage(M, calls);
      p.on('response', async function (res) { if (/script\.google\.com/.test(res.url())) { try { answers.push(await res.json()); } catch (e) { } } });
      await p.goto(HOME + '?g=tr-a');
      await p.waitForSelector('.mod[data-id="' + M[0] + '"]');
      await signIn(p, 'ahmed', PW);
      await p.waitForSelector('.mod[data-id="' + M[0] + '"] .go');
      await p.click('.mod[data-id="' + M[0] + '"] .go');
      await p.waitForURL(new RegExp(M[1]));
      await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
      if (M[3]) {
        assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'student');
        await p.waitForTimeout(2500);
        assert.ok(calls.some(function (c) { return c.action === 'getAllContent' && c.module === M[0] + '-tr-a'; }), 'the module synced its content');
        assert.ok(answers.some(function (a) { return a && a.ok && Array.isArray(a.items) && a.items.some(function (i) { return i.id === 'zz-master-' + M[0] && !i.deleted; }); }), 'and received the master copy');
      }
      await p.context().close();
    } finally {
      main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
      main.call({ module: 'portal', action: 'contentUndoMigration', token: t, moduleId: M[0] });
    }
  });

  test('personal teacher: opens the real ' + M[1] + ' for his group in teacher mode → Back to Teacher Dashboard → his own dashboard', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    groupFixture();
    main.call({ module: 'portal', action: 'setup', password: TPW });
    const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
    const dir = main.call({ module: 'portal', action: 'dirGet', token: t });
    const g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
    const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === M[0]; })[0];
    const un = 'real.' + M[0], cr = main.call({ module: 'portal', action: 'teacherSave', token: t, create: true, record: { username: un, name: 'Real ' + M[0], password: 'real-teacher-1' } });
    assert.ok(cr.ok, JSON.stringify(cr));
    assert.ok(main.call({ module: 'portal', action: 'teacherAssign', token: t, userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
    const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'real-teacher-1' });
    main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'real-teacher-1', newPassword: 'real-teacher-2' });
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-u', un); await p.fill('#t-p', 'real-teacher-2'); await p.click('form.card button[type=submit]');
    await p.waitForSelector('#t-mine .mod[data-id="' + M[0] + '"] .t-open');
    await p.click('#t-mine .mod[data-id="' + M[0] + '"] .t-open');
    await p.waitForURL(new RegExp(M[1] + '/\\?g=tr-a'));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.module; }), M[0] + '-tr-a');
    if (M[3]) assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'teacher');
    assert.strictEqual(calls.filter(function (c) { return c.action === 'login' && c.module !== 'portal'; }).length, 0, 'no module password');
    if (M[3]) {
      const sel = '#app-header #pf-bar a.pf-home';
      await p.waitForFunction(function (s) { return document.querySelector(s) && document.querySelector(s).dataset.role === 'teacher'; }, sel);
      assert.match(await p.textContent(sel), /Back to Teacher Dashboard/);
      await p.click(sel);
      await p.waitForURL(HOME + '#/teacher');
      await p.waitForSelector('#t-mine .my-group');
      assert.strictEqual(await p.$('#t-dir'), null, 'his own dashboard, not the Admin one');
    }
    await p.context().close();
  });

  test('student + group page: Al-Razi A front page → the real ' + M[1] + ' (?g=tr-a) → Back to Platform Home → back on the Al-Razi A page', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    groupFixture();
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME + '?g=tr-a');
    await p.waitForSelector('.mod[data-id="' + M[0] + '"]');
    await signIn(p, 'ahmed', PW);
    await p.waitForSelector('.mod[data-id="' + M[0] + '"] .go');
    await p.click('.mod[data-id="' + M[0] + '"] .go');
    await p.waitForURL(new RegExp(M[1] + '/\\?g=tr-a'));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.module; }), M[0] + '-tr-a');
    if (M[3]) assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'student');
    assert.ok(calls.some(function (c) { return c.module === M[0] + '-tr-a' && c.action === 'studentSession'; }), 'checked in the group\'s own storage');
    assert.strictEqual(calls.filter(function (c) { return c.action === 'studentLogin'; }).length, 0, 'no second sign-in');
    const sel = M[3] ? '#app-header #pf-bar a.pf-home' : '#neo-boot a.pf-home';
    await p.waitForSelector(sel, { state: 'visible' });
    assert.strictEqual(await p.getAttribute(sel, 'href'), HOME + '?g=tr-a');
    await p.click(sel);
    await p.waitForURL(HOME + '?g=tr-a');
    await p.waitForSelector('.card.welcome');
    assert.match(await p.textContent('.hero .grp'), /Test Razi University/);
    assert.match(await p.textContent('.card.welcome'), /Student Ahmed/, 'still signed in on the group page');
    await p.context().close();
  });

  test('teacher + group link: Teacher Management → Groups "B" → open the real ' + M[1] + ' as ?g=B in teacher mode → back to the dashboard → sign out ends it', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    const calls = [];
    const p = await realPage(M, calls);
    const pfx = M[0] === 'cellinjury' ? 'ci_' : 'ih_';
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await p.waitForSelector('#t-manage .modrow');
    const row = p.locator('#t-manage .modrow', { hasText: M[0] === 'cellinjury' ? 'Cell Injury & Cell Death' : 'Inflammation & Healing' });
    await p.evaluate(function (k) { document.querySelectorAll('#t-manage details.adv').forEach(function (d) { d.open = true; }); }, M[0]);
    await row.locator('input[data-k=groups]').fill('B');
    await p.click('.save');
    await p.waitForFunction(function () { return /Saved/.test((document.querySelector('.toast') || {}).textContent || ''); });
    const card = '#t-modules .mod[data-id="' + M[0] + '"]';
    await p.waitForSelector(card + ' select.t-g');
    await p.selectOption(card + ' select.t-g', 'B');
    await p.click(card + ' .t-open');
    await p.waitForURL(new RegExp(M[1] + '/\\?g=B'));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.module; }), M[0] + '-B', 'the module runs as its group B');
    const tok = JSON.parse(await p.evaluate(function (k) { return localStorage.getItem(k); }, pfx + 'B_backend_token_v1'));
    assert.ok(tok && tok.token, 'teacher session in the group\'s own slot');
    assert.ok(calls.some(function (c) { return c.module === M[0] + '-B' && c.action === 'studentSession' && c.token === tok.token; }), 'checked with the backend as group B');
    assert.strictEqual(calls.filter(function (c) { return c.action === 'login' && c.module !== 'portal'; }).length, 0, 'no module password');
    assert.strictEqual(await p.$('#nb-tpass'), null); assert.strictEqual(await p.$('#nb-user'), null);
    if (M[3]) assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'teacher');
    await backHome(p, M, 'teacher', 'B');
    if (!/#\/teacher$/.test(p.url())) await p.goto(HOME + '#/teacher');   // without the content key the course (and its role) cannot open
    await p.click('#who button');
    await p.waitForSelector('form.signin');
    await p.waitForTimeout(400);
    assert.strictEqual(await p.evaluate(function (k) { return localStorage.getItem(k); }, pfx + 'B_backend_token_v1'), null);
    assert.strictEqual(main.call({ module: M[0] + '-B', action: 'studentSession', token: tok.token }).ok, false, 'group teacher session ended');
    await p.context().close();
  });

  test('the real ' + M[1] + ' module accepts the hand-over (no second sign-in)', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    main.addStudents('cellinjury', [{ username: 'both-' + M[0], name: 'Both Modules', password: PW, mustChange: false }]);
    main.addStudents('inflhealing', [{ username: 'both-' + M[0], name: 'Both Modules', password: PW, mustChange: false }]);
    const calls = [];
    const p = await realPage(M, calls), ctx = p.context();
    await p.goto('https://third-year-med.github.io/Interactive-pathology-platform/');
    await p.waitForSelector('.mod[data-id="' + M[0] + '"]');
    await signIn(p, 'both-' + M[0], PW);
    await p.waitForSelector('.mod[data-id="' + M[0] + '"] .go');
    await p.click('.mod[data-id="' + M[0] + '"] .go');
    await p.waitForURL(new RegExp(M[1]));
    await p.waitForTimeout(2500);
    const sess = calls.filter(function (c) { return c.module === M[0] && c.action === 'studentSession'; });
    assert.ok(sess.length, 'the module checked the handed-over session with its backend');
    assert.strictEqual(calls.filter(function (c) { return c.action === 'studentLogin'; }).length, 0, 'no second sign-in');
    assert.strictEqual(await p.$('#nb-user'), null, 'the module did not show its sign-in form');
    await ctx.close();
  });
});

test('Draft → Preview → Publish: Edit master draft opens the real module on the draft (banner); publish, history, restore', { skip: SKIP || (!fs.existsSync(REAL[0][2]) && 'module page not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0], { module: M[0], group: 'tm-a' }] }).modules;
  main.call({ module: M[0], action: 'upsert', token: tok[M[0]].token, collection: 'customtopics', id: 'draft-test', data: { title: 'Published title', units: [] } });
  assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
  const groupView = function () { const r = main.call({ module: M[0] + '-tm-a', action: 'getAllContent', token: tok[M[0] + '-tm-a'].token, since: 0 }); const it = r.items.filter(function (i) { return i.id === 'draft-test'; })[0]; return it && !it.deleted ? it.data.title : null; };
  try {
    const calls = [], answers = [];
    const p = await realPage(M, calls);
    p.on('response', async function (res) { if (/script\.google\.com/.test(res.url())) { try { answers.push(await res.json()); } catch (e) { } } });
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
    await p.click('#t-dir .dir-tab[data-t=content]');
    const card = '#t-dir .content-mod[data-module="' + M[0] + '"]';
    await p.waitForSelector(card + ' [data-a=edit]');
    if (process.env.SHOTS) await (await p.$(card)).screenshot({ path: path.join(process.env.SHOTS, 'content-draft.png') });
    await p.click(card + ' [data-a=edit]');
    await p.waitForURL(new RegExp(M[1] + '/$'));
    await p.waitForFunction(function () { return window.NEO_BOOT && (window.NEO_BOOT.role || document.querySelector('#neo-boot .nb-msg.bad')); }, null, { timeout: 15000 });
    const dtok = JSON.parse(await p.evaluate(function (k) { return localStorage.getItem(k); }, 'ci_backend_token_v1')).token;
    if (M[3]) {
      assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'teacher');
      await p.waitForSelector('#pf-draft', { timeout: 10000 });
      assert.match(await p.textContent('#pf-draft'), /MASTER DRAFT/);
      await p.waitForTimeout(1500);
      assert.ok(answers.some(function (a) { return a && a.draft === true; }), 'the module received the draft');
      if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'module-draft-banner.png'), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    }
    // an edit in the draft session (as the module's editor would send it) changes only the draft
    assert.ok(main.call({ module: M[0], action: 'upsert', token: dtok, collection: 'customtopics', id: 'draft-test', data: { title: 'Draft title', units: [] } }).ok);
    assert.strictEqual(groupView(), 'Published title', 'groups still see the published version');
    // back on the dashboard: changes, publish, history, restore
    await p.goto(HOME + '#/teacher');
    await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
    await p.click('#t-dir .dir-tab[data-t=content]');
    await p.waitForSelector(card + ' [data-a=chg]');
    assert.match(await p.textContent(card + ' [data-a=chg]'), /Changes in draft \(1\)/);
    await p.click(card + ' [data-a=chg]');
    await p.waitForFunction(function (c) { return /Changed \(1\)[\s\S]*draft-test/.test(document.querySelector(c + ' .report').textContent); }, card);
    await p.click(card + ' [data-a=pub]');
    await p.waitForFunction(function () { return /Version 1\.1 published/.test((document.querySelector('.toast') || {}).textContent || ''); });
    assert.strictEqual(groupView(), 'Draft title', 'after publishing every group receives it');
    await p.waitForSelector(card + ' [data-a=hist]');
    await p.click(card + ' [data-a=hist]');
    await p.waitForSelector(card + ' .report button[data-v="1"]');
    assert.match(await p.textContent(card + ' .report'), /1\.1[\s\S]*current[\s\S]*1\.0/);
    await p.click(card + ' .report button[data-v="1"]');
    await p.waitForFunction(function () { return /restored as version 1\.2/.test((document.querySelector('.toast') || {}).textContent || ''); });
    assert.strictEqual(groupView(), 'Published title', 'restore brings the old content back for every group');
    await p.context().close();
  } finally {
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
  }
});

test('Step 9: Group local changes — hidden / local addition listed; "Show it again" and "Copy to master draft"', { skip: SKIP || (!fs.existsSync(REAL[0][2]) && 'module page not available') }, async function () {
  const M = REAL[0];
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [{ module: M[0], group: 'tm-a' }] }).modules;
  const G = M[0] + '-tm-a', gt = tok[G].token;
  if (!main.call({ module: 'portal', action: 'contentStatus', token: t }).modules.filter(function (m) { return m.moduleId === M[0]; })[0].migrated) {
    main.call({ module: M[0], action: 'upsert', token: main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]].token, collection: 'customtopics', id: 'draft-test', data: { title: 'Published title', units: [] } });
    assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
  }
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
  const has = function (id) { const it = main.call({ module: G, action: 'getAllContent', token: gt, since: 0 }).items.filter(function (i) { return i.id === id; })[0]; return !!(it && !it.deleted); };
  try {
    // the group's teacher hides a master topic and adds its own topic
    assert.ok(main.call({ module: G, action: 'delete', token: gt, collection: 'customtopics', id: 'draft-test' }).ok);
    assert.ok(main.call({ module: G, action: 'upsert', token: gt, collection: 'customtopics', id: 'loc-add', data: { title: 'Group A only', units: [] } }).ok);
    assert.ok(!has('draft-test') && has('loc-add'));
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    assert.ok(main.call({ module: G, action: 'upsert', token: gt, collection: 'custommedia', id: 's0202', data: { items: [{ id: 'm1', type: 'image', url: PNG, caption: 'Hypertrophied heart, gross', credit: 'Dept. collection' }, { id: 'm2', type: 'video', url: 'https://www.youtube.com/watch?v=abc', caption: 'Hypertrophy lecture' }] } }).ok);
    assert.ok(main.call({ module: G, action: 'upsert', token: gt, collection: 'practicalpub', id: 'prac_e2e1', data: { id: 'prac_e2e1', number: 3, title: 'Myocardial hypertrophy', version: 1, objectives: ['Recognise LVH'], specimen: { organ: 'Heart' },
      gross: 'Thick left ventricular wall.', microscopic: 'Enlarged myocytes with boxcar nuclei.', keyFeatures: ['Boxcar nuclei'], diagnosis: 'Left ventricular hypertrophy', teachingPoints: [], images: [{ id: 'i1', url: PNG, caption: 'Low power', stain: 'H&E' }], diagrams: [], questions: [{ q: 'What causes LVH?', a: 'Pressure overload' }], viva: [], resources: [] } }).ok);
    const sheetsBefore = JSON.stringify(main.sheets.Content._rows);
    const p = await realPage(M, []);
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
    await p.click('#t-dir .dir-tab[data-t=content]');
    const card = '#t-dir .content-mod[data-module="' + M[0] + '"]';
    await p.waitForSelector(card + ' [data-a=loc]');
    await p.click(card + ' [data-a=loc]');
    await p.waitForSelector(card + ' .loc-g');
    const txt = await p.textContent(card + ' .report');
    assert.match(txt, new RegExp(G)); assert.match(txt, /Hidden for this group[\s\S]*draft-test|draft-test[\s\S]*Hidden for this group/); assert.match(txt, /Local addition/);
    if (process.env.SHOTS) await (await p.$(card)).screenshot({ path: path.join(process.env.SHOTS, 'content-local.png') });
    // 👁 Preview: the media with its picture and captions, and the practical's text — nothing is copied or published
    await p.click(card + ' .loc-g tr:has-text("s0202") button[data-pv]');
    await p.waitForSelector(card + ' .pv-row .pv-fig img');
    let pv = await p.textContent(card + ' .pv-row');
    assert.match(pv, /Media added to a Learn section[\s\S]*Topic 2, section 2[\s\S]*Not in the master — only this group has it[\s\S]*Hypertrophied heart, gross[\s\S]*Dept\. collection[\s\S]*Video: Hypertrophy lecture/);
    assert.ok(await p.$eval(card + ' .pv-row .pv-fig img', function (i) { return i.complete && i.naturalWidth > 0; }), 'the picture is shown');
    await p.click(card + ' .loc-g tr:has-text("prac_e2e1") button[data-pv]');
    await p.waitForFunction(function (c) { return /Myocardial hypertrophy/.test(document.querySelector(c).textContent); }, card + ' .loc-g');
    pv = await p.textContent(card + ' .loc-g tr:has-text("prac_e2e1") + tr.pv-row');
    assert.match(pv, /Practical 3 — Myocardial hypertrophy[\s\S]*Recognise LVH[\s\S]*Heart[\s\S]*Thick left ventricular wall[\s\S]*boxcar nuclei[\s\S]*Left ventricular hypertrophy[\s\S]*Low power · H&E[\s\S]*What causes LVH\?[\s\S]*Pressure overload/);
    await p.click(card + ' .loc-g tr:has-text("draft-test") button[data-pv]');
    await p.waitForFunction(function (c) { return /hidden\/removed for this group/.test(document.querySelector(c).textContent); }, card + ' .loc-g');
    if (process.env.SHOTS) await (await p.$(card + ' .report')).screenshot({ path: path.join(process.env.SHOTS, 'content-local-preview.png') });
    await p.click(card + ' .loc-g tr:has-text("s0202") button[data-pv]');   // closes again
    assert.strictEqual(await p.$(card + ' .loc-g tr:has-text("s0202") + tr.pv-row'), null);
    assert.strictEqual(JSON.stringify(main.sheets.Content._rows), sheetsBefore, 'previewing changes nothing');
    // copy the group's addition into the master draft
    await p.click(card + ' .loc-g tr:has-text("loc-add") button[data-op=pr]');
    await p.waitForFunction(function () { return /Copied to the master draft/.test((document.querySelector('.toast') || {}).textContent || ''); });
    assert.ok(main.call({ module: 'portal', action: 'contentDraft', token: t, moduleId: M[0] }).added.indexOf('customtopics|loc-add') >= 0);
    // show the hidden master topic again
    await p.waitForSelector(card + ' [data-a=loc]'); await p.click(card + ' [data-a=loc]');
    await p.waitForSelector(card + ' .loc-g tr:has-text("draft-test") button[data-op=rm]');
    assert.match(await p.textContent(card + ' .loc-g tr:has-text("draft-test") button[data-op=rm]'), /Show it again/);
    await p.click(card + ' .loc-g tr:has-text("draft-test") button[data-op=rm]');
    await p.waitForFunction(function () { return /gets the master version/.test((document.querySelector('.toast') || {}).textContent || ''); });
    assert.ok(has('draft-test'), 'the group sees the master topic again');
    await p.context().close();
  } finally {
    main.call({ module: 'portal', action: 'contentDiscardDraft', token: t, moduleId: M[0] });
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
  }
});

test('Step 10: Results & attendance — Admin tab (all groups) and a personal teacher (own group only); student table, register, CSV', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const dir = main.call({ module: 'portal', action: 'dirGet', token: t });
  const g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === 'cellinjury'; })[0];
  const X = main.ctx, ins = function (sh, o) { X.sheet_(sh); X.appendRow_(sh, o); };
  ins('Results', { module: 'cellinjury-tr-a', id: 'rq1', name: 'Student Ahmed', email: 'ahmed@student.local', percent: 75, submittedAt: Date.now() });
  ins('AttendanceSessions', { module: 'cellinjury-tr-a', sessionId: 'RS1', sessionTitle: 'Lecture One', status: 'closed', createdAt: Date.UTC(2026, 9, 1) });
  ins('AttendanceRecords', { sessionId: 'RS1', recordId: 'rr1', studentName: 'Student Ahmed', studentId: 'ahmed', status: 'present' });
  const un = 'rep.teacher', cr = main.call({ module: 'portal', action: 'teacherSave', token: t, create: true, record: { username: un, name: 'Dr. Report', password: 'rep-teacher-1' } });
  assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(main.call({ module: 'portal', action: 'teacherAssign', token: t, userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'rep-teacher-1' });
  assert.ok(main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'rep-teacher-1', newPassword: 'rep-teacher-2' }).ok);
  // Admin
  let p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=results]');
  const row = '#t-dir .rep-tbl tr[data-delivery="' + d.deliveryId + '"]';
  await p.waitForSelector(row);
  assert.ok(await p.$$eval('#t-dir .rep-tbl tbody tr', function (r) { return r.length; }) >= 3, 'every delivery');
  assert.match(await p.textContent(row), /Test Razi · Group A[\s\S]*1 attempt\(s\)[\s\S]*average 75%[\s\S]*1 session\(s\)/);
  await p.click(row + ' [data-a=det]');
  await p.waitForSelector('#t-dir .rep-stu tr[data-student="ahmed"]');
  assert.match(await p.textContent('#t-dir .rep-stu tr[data-student="ahmed"]'), /Student Ahmed[\s\S]*1 · 75% · 75%[\s\S]*1 \(100%\)/);
  await p.click('#t-dir .rep-reg summary');
  assert.match(await p.textContent('#t-dir .rep-reg'), /2026-10-01[\s\S]*Lecture One[\s\S]*Student Ahmed\s*✓/);
  if (process.env.SHOTS) await (await p.$('#t-dir')).screenshot({ path: path.join(process.env.SHOTS, 'results-admin.png') });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#t-dir .rep-detail [data-a=csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert.strictEqual(dl.suggestedFilename(), 'results-attendance-cellinjury-tr-a.csv');
  assert.match(csv, /Student ID,Name,Active,Last sign-in,Quiz attempts[\s\S]*2026-10-01 Lecture One\r\n[\s\S]*ahmed,Student Ahmed,yes,[^,]*,1,75,75,0,,0,,1,100,present/);
  await p.context().close();
  // personal teacher: only the assigned group + module
  p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-u', un); await p.fill('#t-p', 'rep-teacher-2'); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-mine .my-group');
  await p.click('.roster-tools [data-a=rep]');
  await p.waitForSelector('#t-report .rep-tbl tbody tr');
  assert.deepStrictEqual(await p.$$eval('#t-report .rep-tbl tbody tr', function (r) { return r.map(function (x) { return x.dataset.delivery; }); }), [d.deliveryId]);
  assert.ok(!/Misrata/.test(await p.textContent('#t-report')));
  await p.click('#t-report [data-a=det]');
  await p.waitForSelector('#t-report .rep-stu tr[data-student="ahmed"]');
  if (process.env.SHOTS) await (await p.$('#t-report')).screenshot({ path: path.join(process.env.SHOTS, 'results-teacher.png') });
  await p.context().close();
  main.call({ module: 'portal', action: 'teacherSetActive', token: t, userId: cr.teacher.userId, active: false });
});

test('new build: release tool → preview (Admin only, banner) → compatibility check → decision → go live after the new file is live', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0], rel = require('../tools/module-release.js'), crypto = require('crypto'), cp = require('child_process'), os = require('os');
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  main.ctx.CONTENT_KEYS[M[0]] = M[3];
  const st0 = main.call({ module: 'portal', action: 'contentStatus', token: t }).modules.filter(function (m) { return m.moduleId === M[0]; })[0];
  if (!st0.migrated) assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
  // the master draft corrects question q203 — the new build will drop q203
  const dt = main.call({ module: 'portal', action: 'contentEditDraft', token: t, moduleId: M[0] }).token;
  assert.ok(main.call({ module: M[0], action: 'upsert', token: dt, collection: 'contentedits', id: 'question:q203', data: { kind: 'question', key: 'q203', fields: { stem: 'corrected' } } }).ok);
  // build 2 = the live course without q203, made into a preview file by the release tool
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-')), repo = path.join(tmp, M[1]), key = Buffer.from(M[3], 'base64');
  fs.mkdirSync(repo); fs.copyFileSync(M[2], path.join(repo, 'index.html'));
  const html = fs.readFileSync(M[2], 'utf8'), data = JSON.parse(rel.decrypt(html, key).toString('utf8'));
  data.questions = data.questions.filter(function (q) { return q.id !== 'q203'; });
  const nb = path.join(tmp, 'new-build.html');
  fs.writeFileSync(nb, html.replace(/(<script id="neo-enc"[^>]*>)[\s\S]*?(<\/script>)/, function (m0, a1, a2) { return a1 + rel.encrypt(Buffer.from(JSON.stringify(data)), key) + a2; }));
  const env = Object.assign({}, process.env, { CONTENT_KEY: M[3] }), tool = path.join(__dirname, '..', 'tools', 'module-release.js');
  const outp = cp.execFileSync('node', [tool, 'preview', nb, repo, '--build', 'e2e-build-2'], { env: env }).toString();
  assert.match(outp, /questions: 0 added, 0 changed, 1 removed → removed: q203/);
  SERVE[M[1] + '/preview/'] = path.join(repo, 'preview', 'index.html');
  try {
    const calls = [], p = await realPage(M, calls);
    const dash = async function () {
      await p.goto(HOME + '#/teacher');
      if (await p.$('#t-p')) { await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]'); }
      await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
      await p.click('#t-dir .dir-tab[data-t=content]');
      await p.waitForSelector('#t-dir .content-mod[data-module="' + M[0] + '"] [data-a=build]');
      await p.click('#t-dir .content-mod[data-module="' + M[0] + '"] [data-a=build]');
      await p.waitForSelector('#t-dir .rb');
    };
    // without the Admin's draft session the preview does not open (only the sign-in screen + a notice)
    await p.goto('https://third-year-med.github.io/' + M[1] + '/preview/');
    await p.waitForSelector('#neo-boot .pf-prev');
    assert.strictEqual(await p.evaluate(function () { return document.body.classList.contains('neo-locked'); }), true);
    await dash();
    const card = '#t-dir .content-mod[data-module="' + M[0] + '"]';
    assert.match(await p.textContent(card + ' .rb'), /Live page on GitHub\s*build 2026-09-24 11:46 UTC[\s\S]*Preview page \(…\/preview\/\)\s*build e2e-build-2[\s\S]*not yet/);
    await p.click(card + ' [data-b=open]');
    await p.waitForURL(/\/preview\/$/);
    await p.waitForSelector('#pf-draft', { timeout: 15000 });
    assert.match(await p.textContent('#pf-draft'), /PREVIEW of the new build \(e2e-build-2\)/);
    assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.role; }), 'teacher');
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'module-preview-banner.png'), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    await p.waitForFunction(function () { return true; }); await p.waitForTimeout(1500);
    assert.ok(calls.some(function (c) { return c.action === 'contentBuildManifest' && c.preview === true && c.build === 'e2e-build-2'; }), 'the preview reported its build');
    assert.ok(calls.some(function (c) { return c.action === 'studentSession' && c.preview === 1; }));
    // back on the dashboard: check, decide, go live
    await dash();
    assert.match(await p.textContent(card + ' .rb'), /Preview checked in\s*build e2e-build-2/);
    await p.click(card + ' [data-b=check]');
    await p.waitForSelector(card + ' tr[data-key="master|contentedits|question:q203"] select');
    assert.match(await p.textContent(card + ' tr[data-key="master|contentedits|question:q203"]'), /its target is not in the new build: q203/);
    if (process.env.SHOTS) await (await p.$(card)).screenshot({ path: path.join(process.env.SHOTS, 'content-newbuild.png') });
    await p.selectOption(card + ' tr[data-key="master|contentedits|question:q203"] select', 'remove');
    for (const sel of await p.$$(card + ' tr[data-key]:not([data-key="master|contentedits|question:q203"]) select')) await sel.selectOption('keep');   // left over from earlier tests
    // the new file is not live yet → refused
    await p.click(card + ' [data-b=live]');
    await p.waitForFunction(function () { return /Put the new file live on GitHub first/.test((document.querySelector('.toast') || {}).textContent || ''); });
    // the release tool turns the preview into the live file (one commit on GitHub)
    cp.execFileSync('node', [tool, 'golive', repo], { env: env });
    assert.ok(!fs.existsSync(path.join(repo, 'preview')));
    SERVE[M[1] + '/'] = path.join(repo, 'index.html'); SERVE[M[1] + '/preview/'] = null;
    await p.click(card + ' [data-b=live]');
    await p.waitForFunction(function () { return /Build e2e-build-2 is live — version/.test((document.querySelector('.toast') || {}).textContent || ''); });
    const v = main.call({ module: 'portal', action: 'contentStatus', token: t }).modules.filter(function (m) { return m.moduleId === M[0]; })[0];
    assert.strictEqual(v.builds.live.build, 'e2e-build-2'); assert.strictEqual(v.versionList[0].build, 'e2e-build-2');
    const gr = main.call({ module: M[0], action: 'getAllContent', token: main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]].token, since: 0 });
    assert.ok(!gr.items.some(function (i) { return i.id === 'question:q203' && !i.deleted; }), 'the decision was applied');
    // the live file made by the tool opens normally with the live key
    await p.goto('https://third-year-med.github.io/' + M[1] + '/');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 15000 });
    await p.context().close();
  } finally {
    delete SERVE[M[1] + '/']; delete SERVE[M[1] + '/preview/'];
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Practical: images by link (preview, caption, special characters, blocked sites), resource links, save/reload, edit, delete, student view, older records', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  main.ctx.CONTENT_KEYS[M[0]] = M[3];
  const st0 = main.call({ module: 'portal', action: 'contentStatus', token: t }).modules.filter(function (m) { return m.moduleId === M[0]; })[0];
  if (!st0.migrated) assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);   // as on the real backend
  const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const IMG = 'https://img.example.org/path/lvh%20gross.png?size=large&crop=1&x=50%25#view';
  const BLOCKED = 'https://blocked.example.org/slides/fatty-liver.jpg?token=a&b=c';
  const PAGE = 'https://webpath.med.utah.edu/CINJHTML/CINJ014.html?q=1&r=2#top';
  const RES1 = 'https://www.pathologyoutlines.com/topic/cellinjurynecrosis.html?a=1&b=%2F#coag';
  const routes = async function (p) {
    await p.route('https://img.example.org/**', function (r) { return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
    await p.route('https://blocked.example.org/**', function (r) { return r.fulfill({ status: 403, contentType: 'text/plain', body: 'hotlinking not allowed' }); });
    await p.route('https://webpath.med.utah.edu/**', function (r) { return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>page</html>' }); });
  };
  const stored = function (id) { const rows = main.sheets.Content._rows.filter(function (r) { return r[1] === 'priv:pracdrafts' && r[2] === id; }); return rows.length ? JSON.parse(rows[rows.length - 1].slice(6).join('')) : null; };
  const teacherPage = async function () {
    const p = await realPage(M, []); await routes(p);
    await p.addInitScript(function (v) { localStorage.setItem('ci_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    return p;
  };
  const openEditor = async function (p, id) {
    await p.evaluate(function () { Object.keys(localStorage).filter(function (k) { return /prac_drafts/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); });   // reload from the backend, not this browser
    await p.goto('https://third-year-med.github.io/' + M[1] + '/#/practical/edit/' + id);
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await p.waitForSelector('#pe-images', { timeout: 15000 }); await p.waitForTimeout(600);
  };
  const addByLink = async function (p, url, caption, button) {
    await p.click('#pe-images .prac-slot:first-child button:has-text("Add by link")');
    await p.fill('.modal input[aria-label="Image address"]', url);
    await p.waitForTimeout(900);
    const msg = await p.textContent('.modal .stack > div:nth-child(3)');
    if (caption) await p.fill('.modal input[aria-label="Caption"]', caption);
    await p.click('.modal-foot button:has-text("' + (button || 'Add image') + '")');
    await p.waitForSelector('.modal', { state: 'detached' });
    return msg;
  };
  const save = async function (p) { await p.waitForTimeout(2600); assert.match(await p.textContent('.prac-edit-top'), /saved ✓/); };
  try {
    // ---- TEST 1 + 3: new practical → image by link (preview) + caption + several links ----
    let p = await teacherPage();
    await p.goto('https://third-year-med.github.io/' + M[1] + '/#/practical');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await p.click('text=+ Blank practical'); await p.waitForSelector('#pe-images');
    const id = decodeURIComponent(p.url().split('/edit/')[1]);
    assert.match(await addByLink(p, 'not a url', null, 'Add image').catch(function () { return 'kept open'; }), /Invalid URL|kept open/);
    if (await p.$('.modal')) { assert.match(await p.textContent('.modal'), /Invalid URL — please enter a valid HTTPS address/); await p.fill('.modal input[aria-label="Image address"]', IMG); await p.waitForTimeout(900);
      assert.match(await p.textContent('.modal'), /✓ Picture found/); await p.fill('.modal input[aria-label="Caption"]', 'LVH — gross'); await p.click('.modal-foot button:has-text("Add image")'); }
    assert.match(await addByLink(p, BLOCKED, 'Fatty liver'), /could not be shown/);
    assert.match(await addByLink(p, PAGE, 'WebPath — coagulative necrosis', 'Add as resource link'), /is a web page, not a picture/);
    await p.waitForSelector('#pe-images .prac-img-missing');
    assert.match(await p.textContent('#pe-images .prac-img-missing'), /Image failed to load[\s\S]*address is saved/);
    assert.strictEqual(await p.getAttribute('#pe-images .prac-img-missing a', 'href'), BLOCKED);
    await p.click('#pe-resources button:has-text("+ Add resource")');
    const rows = await p.$$('#pe-resources .prac-res-row'), last = rows[rows.length - 1];
    await (await last.$('input.ttl')).fill('Pathology Outlines — necrosis');
    await (await last.$('input.url')).fill(RES1.replace('https://', ''));   // typed without https:// ("www.…")
    await (await last.$('input.ttl')).click();                               // leaving the field adds https://
    assert.strictEqual(await (await last.$('input.url')).inputValue(), RES1);
    await p.fill('#pe-keyFeatures textarea', 'Preserved outlines\nLoss of nuclei'); await p.fill('#pe-microscopic textarea', 'Ghost cells.');
    await p.fill('#pe-diagnosis input:not([type=checkbox])', 'Coagulative necrosis'); await p.check('#pe-diagnosis input[type=checkbox]');
    await save(p);
    let d = stored(id);
    assert.deepStrictEqual(d.images.map(function (i) { return [i.url, i.caption]; }), [[IMG, 'LVH — gross'], [BLOCKED, 'Fatty liver']]);
    assert.deepStrictEqual(d.resources.map(function (r) { return [r.title, r.url]; }), [['WebPath — coagulative necrosis', PAGE], ['Pathology Outlines — necrosis', RES1]]);
    // ---- reload: everything is still there ----
    await openEditor(p, id);
    assert.deepStrictEqual(await p.$$eval('#pe-images .prac-img-card img', function (x) { return x.map(function (i) { return i.getAttribute('src'); }); }), [IMG]);
    assert.strictEqual(await p.$$eval('#pe-images .prac-img-missing', function (x) { return x.length; }), 1, 'the blocked picture is shown as a message + link, not lost');
    assert.deepStrictEqual(await p.$$eval('#pe-resources .prac-res-row', function (x) { return x.map(function (r) { return r.querySelector('input.url').value; }); }), [PAGE, RES1]);
    if (process.env.SHOTS) await (await p.$('#pe-images')).screenshot({ path: path.join(process.env.SHOTS, 'prac-editor-images.png') });
    // approve + publish
    await p.click('.prac-edit-actions button:has-text("Approve")'); await p.waitForTimeout(800);
    await p.click('.prac-edit-actions button:has-text("Publish")'); await p.click('.modal-foot button.btn-primary'); await p.waitForTimeout(1500);
    assert.ok(main.sheets.Content._rows.some(function (r) { return r[1] === 'practicalpub' && r[2] === id; }), 'published');
    // ---- race: a background sync while typing a link on the published practical must not lose the typing ----
    await p.click('#pe-resources button:has-text("+ Add resource")');
    const r3 = (await p.$$('#pe-resources .prac-res-row')).pop();
    await (await r3.$('input.ttl')).fill('Library');
    await (await r3.$('input.url')).click(); await p.keyboard.type('https://library.med.utah.edu/', { delay: 15 });
    await p.waitForTimeout(900); await p.evaluate(function () { return Backend.syncFromBackend(); }); await p.waitForTimeout(500);
    await p.keyboard.type('WebPath/webpath.html', { delay: 15 });
    await p.waitForTimeout(1500);
    assert.strictEqual(stored(id).resources[2].url, 'https://library.med.utah.edu/WebPath/webpath.html', 'nothing typed was lost');
    // ---- TEST 4: edit an existing item (caption + link) ----
    await openEditor(p, id);
    await p.fill('#pe-images .prac-img-card input[placeholder="e.g. Lipoma — cut surface"]', 'LVH — gross, edited');
    const first = (await p.$$('#pe-resources .prac-res-row'))[1];
    await (await first.$('input.url')).fill(RES1 + '&edited=1');
    await save(p);
    await openEditor(p, id);
    assert.strictEqual(await p.inputValue('#pe-images .prac-img-card input[placeholder="e.g. Lipoma — cut surface"]'), 'LVH — gross, edited');
    assert.strictEqual(await (await (await p.$$('#pe-resources .prac-res-row'))[1].$('input.url')).inputValue(), RES1 + '&edited=1');
    // ---- TEST 5: delete an image and a link ----
    await (await (await p.$$('#pe-resources .prac-res-row'))[2].$('button[title="Delete resource"]')).click();   // the "Library" link
    await p.click('.modal-foot button.btn-danger'); await p.waitForTimeout(400);
    const cards = await p.$$('#pe-images .prac-img-card'); await (await cards[1].$('button:has-text("Remove")')).click(); await p.click('.modal-foot button.btn-danger');
    await save(p);
    await openEditor(p, id);
    assert.strictEqual((await p.$$('#pe-resources .prac-res-row')).length, 2);
    assert.strictEqual((await p.$$('#pe-images .prac-img-card')).length, 1);
    d = stored(id); assert.deepStrictEqual(d.images.map(function (i) { return i.url; }), [IMG]); assert.deepStrictEqual(d.resources.map(function (r) { return r.title; }), ['WebPath — coagulative necrosis', 'Pathology Outlines — necrosis']);
    // publish the edits for students
    await p.click('.prac-edit-actions button:has-text("Approve")'); await p.waitForTimeout(800);
    await p.click('.prac-edit-actions button:has-text("Publish update")'); await p.click('.modal-foot button.btn-primary'); await p.waitForTimeout(1500);
    await p.context().close();
    // ---- TEST 7: an older published record (image under "src", link under "link"/"name") ----
    const D = 'prac_legacy1';
    assert.ok(main.call({ module: M[0], action: 'upsert', token: tt.token, collection: 'practicalpub', id: D, data: { id: D, number: 90, title: 'Older practical', version: 1, objectives: [], specimen: {}, gross: 'Old text', microscopic: '', keyFeatures: ['k'], diagnosis: 'Old dx', differential: '', clinical: '', stain: '', magnification: '', teachingPoints: [],
      images: [{ id: 'o1', slot: 'gross', src: IMG, caption: 'Old picture' }], diagrams: [], questions: [], viva: [], resources: [{ id: 'r1', type: 'resource', name: 'Old link', link: RES1 }], settings: {} } }).ok);
    // ---- TEST 6 + 8: student view ----
    main.addStudents(M[0], [{ username: 'pracstudent', name: 'Prac Student', password: 'prac-pass-123', mustChange: false }]);
    const sl = main.call({ module: M[0], action: 'studentLogin', username: 'pracstudent', password: 'prac-pass-123' }); assert.ok(sl.ok, JSON.stringify(sl));
    p = await realPage(M, []); await routes(p);
    await p.addInitScript(function (v) { localStorage.setItem('ci_stu_session_v1', v); }, JSON.stringify({ token: sl.stoken || sl.token, expiresAt: Date.now() + 3600000 }));
    for (const pid of [id, D]) {
      await p.goto('https://third-year-med.github.io/' + M[1] + '/#/practical/p/' + pid);
      await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
      await p.waitForSelector('.prac-figs img', { timeout: 15000 });
      await p.waitForTimeout(500);
      assert.strictEqual(await p.getAttribute('.prac-figs img', 'src'), IMG, 'the address with ? & = % # is intact');
      assert.ok(await p.$eval('.prac-figs img', function (i) { return i.complete && i.naturalWidth > 0; }), 'the picture is shown');
      const links = await p.$$eval('.prac-res a', function (x) { return x.map(function (a) { return [a.closest('.prac-res-item').querySelector('.t').textContent, a.getAttribute('href'), a.target, a.rel]; }); });
      if (pid === id) {
        assert.match(await p.textContent('.prac-figs'), /LVH — gross, edited/);
        assert.deepStrictEqual(links.slice().sort(), [['Pathology Outlines — necrosis', RES1 + '&edited=1', '_blank', 'noopener noreferrer'], ['WebPath — coagulative necrosis', PAGE, '_blank', 'noopener noreferrer']]);   // grouped by type for students
        if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'prac-student.png'), fullPage: true });
      } else {
        assert.match(await p.textContent('.prac-figs'), /Old picture/);
        assert.deepStrictEqual(links, [['Old link', RES1, '_blank', 'noopener noreferrer']]);
      }
    }
    // a picture the website refuses → message + the original address as a link (students)
    assert.ok(main.call({ module: M[0], action: 'upsert', token: tt.token, collection: 'practicalpub', id: 'prac_blk', data: { id: 'prac_blk', number: 91, title: 'Blocked picture', version: 1, objectives: [], specimen: {}, gross: '', microscopic: 'm', keyFeatures: ['k'], diagnosis: 'd', differential: '', clinical: '', stain: '', magnification: '', teachingPoints: [], images: [{ id: 'b1', slot: 'micro', url: BLOCKED, caption: 'Blocked' }], diagrams: [], questions: [], viva: [], resources: [], settings: {} } }).ok);
    await p.goto('https://third-year-med.github.io/' + M[1] + '/#/practical/p/prac_blk'); await p.waitForTimeout(400); await p.reload();
    await p.waitForSelector('.prac-figs .prac-img-missing', { timeout: 15000 });
    assert.match(await p.textContent('.prac-figs'), /Image failed to load[\s\S]*does not allow/);
    assert.strictEqual(await p.getAttribute('.prac-figs .prac-img-missing a', 'href'), BLOCKED);
    assert.ok(!/TypeError|undefined|null/.test(await p.textContent('.prac-figs')), 'no raw errors for students');
    await p.context().close();
  } finally {
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
  }
});

test('Tidy up (Content tab): shows what can be tidied, then removes it', { skip: SKIP }, async function () {
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const X = main.ctx;
  X.appendRow_(X.SHEETS.SESSIONS, { module: 'cellinjury', token: 'expired-e2e', createdAt: 1, expiresAt: 2 });
  const p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-dir details.dir'); await p.click('#t-dir summary');
  await p.click('#t-dir .dir-tab[data-t=content]');
  await p.click('#t-dir [data-a=tidy]');
  await p.waitForSelector('#t-dir .tidy-out [data-a=tidygo]');
  assert.match(await p.textContent('#t-dir .tidy-out'), /expired sessions: \d+/);
  await p.click('#t-dir .tidy-out [data-a=tidygo]');
  await p.waitForFunction(function () { return /Tidied: \d+ row/.test((document.querySelector('.toast') || {}).textContent || ''); });
  assert.ok(!main.sheets.Sessions._rows.some(function (r) { return r[1] === 'expired-e2e'; }));
  await p.context().close();
});

test('Official Exams: Admin adds the module → combined exam bank from two modules + a picture question → copy to a teaching bank → student front page → exam → lock → results per module', { skip: SKIP || (!fs.existsSync(EXAM_HTML) && 'exam app not available') }, async function () {
  groupFixture();
  const KEYS = !!(REAL[0][3] && REAL[1][3] && fs.existsSync(REAL[0][2]) && fs.existsSync(REAL[1][2]));
  if (REAL[1][3]) main.ctx.CONTENT_KEYS[REAL[1][0]] = REAL[1][3];
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const calls = [];
  let p = await realPage(REAL[0], calls);
  p.on('pageerror', function (e) { errors.push('exams: ' + e.message); });
  // 1. Admin: Teacher Dashboard → Official Exams → "Add the Official Exams module"
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-exams .ex-row');
  await p.click('#t-exams button:has-text("Add the Official Exams module")');
  await p.waitForTimeout(500);
  let dir = main.call({ module: 'portal', action: 'dirGet', token: t });
  assert.ok(dir.modules.some(function (m) { return m.moduleId === 'exams'; }), 'the module was created');
  const g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const dv = main.call({ module: 'portal', action: 'dirSave', token: t, kind: 'delivery', record: { groupId: g.groupId, moduleId: 'exams', status: 'available' } });
  assert.ok(dv.ok, JSON.stringify(dv));
  assert.ok(main.call({ module: 'portal', action: 'rosterSync', token: t, groupId: g.groupId }).ok);
  // 2. Manage exams of the group's combined exams → the real exam app opens as examiner (no password)
  await p.reload();
  await p.waitForSelector('#t-exams .ex-row[data-storage="exams-tr-a"] [data-a=man]');
  await p.click('#t-exams .ex-row[data-storage="exams-tr-a"] [data-a=man]');
  await p.waitForURL(/pathology-exams\/\?m=exams-tr-a/);
  await p.waitForSelector('.tbar');
  assert.match(await p.textContent('.tbar'), /Teacher Dashboard[\s\S]*Official Exams · Combined exams · tr-a/);
  const tt = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('xm_exams-tr-a_tt'); }));
  await p.click('.tbar .tab:has-text("Exam question bank")');
  await p.waitForSelector('button:has-text("Copy from another exam bank")');
  // 3. from two modules' teaching banks (needs the real content keys)
  const pickFrom = async function (storage, n) {
    await p.click('button:has-text("+ Add from a module’s teaching question bank")');
    await p.waitForSelector('.modal select');
    await p.selectOption('.modal label.f select', storage);
    await p.waitForSelector('.modal .qlist .qitem input[type=checkbox]:not([disabled])', { timeout: 20000 });
    const boxes = await p.$$('.modal .qlist .qitem input[type=checkbox]:not([disabled])');
    for (let i = 0; i < n; i++) await boxes[i].check();
    await p.click('.modal button:has-text("Add to exam bank")');
    await p.waitForSelector('.modal h2:has-text("Added to the exam bank")');
    await p.click('.modal button[aria-label=Close]');
  };
  if (KEYS) { await pickFrom('cellinjury-tr-a', 2); await pickFrom('inflhealing-tr-a', 1); }
  // 4. picture questions (practical): my own picture → uploaded (smaller, Drive) → one question
  await p.click('button:has-text("Picture questions (practical)")');
  await p.setInputFiles('.modal input[type=file][multiple]', { name: 'slide1.png', mimeType: 'image/png', buffer: Buffer.from(PNG1, 'base64') });
  await p.waitForSelector('.modal .picrow textarea');
  await p.fill('.modal .picrow textarea', 'granuloma; granulomatous inflammation');
  await p.fill('.modal input[placeholder^="e.g. Practical"]', 'Practical — slides');
  await p.click('.modal button:has-text("Upload and add to exam bank")');
  await p.waitForFunction(function () { return !document.querySelector('.modal-bg'); }, null, { timeout: 15000 });
  assert.strictEqual(main.drive.length, 1, 'stored in Drive, not in the sheet');
  let bank = main.call({ module: 'exams-tr-a', action: 'examBankList', token: tt.token }).questions;
  const pic = bank.filter(function (q) { return q.image; })[0];
  assert.ok(pic && /^https:\/\/drive\.google\.com\/thumbnail\?id=drv1/.test(pic.image), JSON.stringify(bank));
  assert.deepStrictEqual([pic.type, pic.answers, pic.topic], ['fillblank', [['granuloma', 'granulomatous inflammation']], 'Practical — slides']);
  if (KEYS) {
    assert.strictEqual(bank.length, 4);
    assert.deepStrictEqual(bank.map(function (q) { return q.source.course || ''; }).sort(), ['', 'cellinjury', 'cellinjury', 'inflhealing']);
    assert.ok(bank.filter(function (q) { return q.source.course === 'cellinjury'; }).every(function (q) { return /^Cell Injury/.test(q.topic); }), 'module name in the topic');
    const ex = main.call({ module: 'cellinjury-tr-a', action: 'getAllContent', token: main.call({ module: 'portal', action: 'examOpen', token: t, storage: 'cellinjury-tr-a' }).token, since: 0 });
    const excl = ex.items.filter(function (i) { return i.collection === 'revexclude'; })[0];
    assert.strictEqual(excl.data.ids.length, 2, 'hidden from Revision in that group');
    await p.waitForSelector('tr td img.qthumb');
    // 5. the picture question → the group's Cell Injury teaching bank
    await p.check('tr:has(img.qthumb) input[type=checkbox]');
    await p.click('button:has-text("To a teaching bank (1)")');
    await p.waitForSelector('.modal label.f select');
    await p.selectOption('.modal label.f select', 'cellinjury-tr-a');
    await p.waitForSelector('.modal .qlist select');
    const opt = await p.$$eval('.modal .qlist select option', function (o) { return o.map(function (x) { return x.value; }).filter(Boolean)[0]; });
    await p.selectOption('.modal .qlist select', opt);
    await p.click('.modal button:has-text("Copy")');
    await p.waitForSelector('.modal h2:has-text("Copied to the teaching bank")');
    const rows = main.sheets.Content._rows.filter(function (r) { return r[0] === 'cellinjury-tr-a' && r[1] === 'importedquestions'; });
    assert.strictEqual(rows.length, 1);
    const tq = main.call({ module: 'exams-tr-a', action: 'examCourseExtras', token: tt.token, from: 'cellinjury-tr-a' }).questions[0];
    assert.deepStrictEqual([tq.type, tq.topic, tq.images[0].url, / ___$/.test(tq.stem)], ['fillblank', opt, pic.image, true]);
    await p.click('.modal button[aria-label=Close]');
  }
  // 6. a combined exam (published), teaching lock on by default
  const now = Date.now();
  bank = main.call({ module: 'exams-tr-a', action: 'examBankList', token: tt.token }).questions;
  const exm = main.call({ module: 'exams-tr-a', action: 'examUpsert', token: tt.token, exam: { title: 'Combined final', code: 'FIN26', opensAt: now - 60000, closesAt: now + 3600000, durationMin: 30,
    questionIds: bank.map(function (q) { return q.id; }), status: 'published', lockTeaching: true, shuffleQuestions: false, shuffleOptions: false, candidates: 'all' } });
  assert.ok(exm.ok, JSON.stringify(exm));
  await p.context().close();
  // 7. student: group page → Official exams card → the group's exam page → sign in with the code → picture → submit
  p = await realPage(REAL[0], calls);
  p.on('pageerror', function (e) { errors.push('exams-student: ' + e.message); });
  await p.goto(HOME + '?g=tr-a');
  await p.waitForSelector('.mod[data-id="exams"]');
  assert.match(await p.textContent('.mod[data-id="exams"]'), /Official exams/);
  await signIn(p, 'ahmed', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .pill.locked');
  assert.match(await p.textContent('.mod[data-id="cellinjury"]'), /Closed during an exam[\s\S]*Combined final/);
  assert.match(await p.textContent('.mod[data-id="inflhealing"]'), /Closed during an exam/);
  await p.click('.mod[data-id="exams"] a.btn');
  await p.waitForURL(/pathology-exams\/\?g=tr-a/);
  await p.waitForSelector('.front-ex[data-storage="exams-tr-a"] a.btn', { timeout: 15000 });
  const front = await p.textContent('body');
  assert.match(front, /Combined final/);
  assert.ok(!/FIN26/.test(front), 'never the access code');
  assert.match(await p.textContent('.front-ex[data-storage="exams-tr-a"]'), /Combined exam[\s\S]*Combined final[\s\S]*Open now/);
  await p.click('.front-ex[data-storage="exams-tr-a"] a.btn');
  await p.waitForURL(/m=exams-tr-a/);
  await p.fill('#x-code', 'fin26'); await p.fill('#x-user', 'ahmed'); await p.fill('#x-pw', PW);
  await p.click('form button[type=submit]');
  await p.click('button:has-text("Start the exam")');
  const conf = await p.$('.modal button.btn-primary'); if (conf) await conf.click();
  const n = bank.length;
  for (let i = 0; i < n; i++) {
    await p.waitForSelector('.stem, .qimg');
    if (await p.$('img.qimg')) {
      assert.strictEqual(await p.getAttribute('img.qimg', 'referrerpolicy'), 'no-referrer');
      await p.fill('input.blank', 'Granuloma');
    }
    if (i < n - 1) await p.click('button:has-text("Next →")');
  }
  await p.click('button:has-text("Review & submit")');
  await p.click('button:has-text("Submit my exam")');
  await p.waitForSelector('button:has-text("Finish")', { timeout: 15000 });
  await p.context().close();
  // 8. results per module in the exam manager
  p = await realPage(REAL[0], calls);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('#t-exams .ex-row[data-storage="exams-tr-a"] [data-a=man]');
  await p.click('#t-exams .ex-row[data-storage="exams-tr-a"] [data-a=man]');
  await p.waitForSelector('.tbar');
  await p.click('.tbar .tab:has-text("Results")');
  await p.waitForSelector('td:has-text("ahmed")');
  if (KEYS) {
    await p.waitForSelector('h2:has-text("Results per module")');
    const txt = await p.textContent('.twrap');
    assert.match(txt, /Results per module[\s\S]*Cell Injury[\s\S]*Inflammation[\s\S]*Exam-only questions/);
    assert.match(txt, /Exam-only questions1100%/, 'the picture question: typed answer accepted');
  }
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'exam-results.png'), fullPage: true });
  await p.context().close();
  main.call({ module: 'exams-tr-a', action: 'examUpsert', token: tt.token, exam: Object.assign({}, exm.exam, { status: 'closed' }) });
});

test('no JavaScript errors', { skip: SKIP }, function () { assert.deepStrictEqual(errors, []); });
