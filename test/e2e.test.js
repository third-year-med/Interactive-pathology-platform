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

let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = null; }
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const SKIP = !chromium || !fs.existsSync(EXE) ? 'Playwright/Chromium not available' : false;
const ROOT = path.join(__dirname, '..');
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(ROOT, 'backend', 'Portal.gs')];
const MAIN = 'https://script.google.com/macros/s/MAINTEST/exec', GYN = 'https://script.google.com/macros/s/GYNTEST/exec';
const PW = 'student-pass-1', TPW = 'portal-teacher-1';

let server, url, browser, main, gyn;
const errors = [];
function backend() {
  const b = createBackend({ files: FILES });
  b.teacher = {};
  b.call = function (o) { return b.doPost(o); };
  b.addStudents = function (m, list) {
    if (!b.teacher[m]) { b.call({ module: m, action: 'setup', password: 'teacher-' + m + '-1' }); b.teacher[m] = b.call({ module: m, action: 'login', password: 'teacher-' + m + '-1' }).token; }
    const r = b.call({ module: m, action: 'bulkAddStudents', token: b.teacher[m], students: list }); assert.ok(r.ok);
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
async function realPage(M, calls) {
  if (M[3]) main.ctx.CONTENT_KEYS[M[0]] = M[3];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', function (e) { if (!/content key|decrypt/i.test(e.message)) errors.push(M[1] + ': ' + e.message); });
  p.on('dialog', function (d) { d.accept(); });
  await p.route('https://script.google.com/**', async function (route) {
    const body = route.request().postData() || '';
    calls.push(JSON.parse(body));
    await route.fulfill({ status: 200, contentType: 'application/json', body: main.ctx.doPost({ postData: { contents: body } }).getContent() });
  });
  await p.route('https://third-year-med.github.io/**', function (route) {
    const u = new URL(route.request().url());
    const own = REAL.filter(function (R) { return u.pathname.indexOf('/' + R[1] + '/') === 0; })[0];
    if (own) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(own[2]) });
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

test('no JavaScript errors', { skip: SKIP }, function () { assert.deepStrictEqual(errors, []); });
