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
const { createBackend, driveFake } = require('./apps-script/harness');

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
  const b = fixtureBackend({ files: FILES, fetch: driveFake() });
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
/** Teacher Dashboard (2026-10-11): open one card's management view (the cards are links to #/teacher/<view>). */
async function dash(p, v) {
  if (await p.isVisible('.dash-view[data-view="' + v + '"]')) return;   // already open
  if (!(await p.isVisible('.dash-grid'))) { await p.evaluate(function () { if (/^#\/teacher\/./.test(location.hash)) location.hash = '#/teacher'; }); }
  await p.waitForSelector('.dash-card[data-view="' + v + '"]', { timeout: 15000 });
  await p.click('.dash-card[data-view="' + v + '"]');
  await p.waitForSelector('.dash-view[data-view="' + v + '"]:not([hidden])');
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
  await dash(p, 'manage');
  await p.waitForSelector('.modrow');
  assert.match(await p.textContent('#t-manage'), /Cell Injury & Cell Death\s*1 active student account/);
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
  await dash(p, 'modules');
  await p.waitForSelector('#t-modules .mod[data-id="cellinjury"] .t-open');
  assert.match(await p.textContent('h1.page-h'), /Teacher Dashboard/);
  assert.match(await p.textContent('.top a.tportal'), /Platform Home/);
  assert.match(await p.textContent('#t-modules'), /Teaching Modules/);
  await dash(p, 'manage');
  await p.waitForSelector('#t-manage .modrow');
  assert.match(await p.textContent('#t-manage'), /Teacher Management/);
  if (process.env.SHOTS) { await p.screenshot({ path: path.join(process.env.SHOTS, 'dashboard.png'), fullPage: true }); await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(process.env.SHOTS, 'dashboard-phone.png') }); assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'dashboard fits a phone'); await p.setViewportSize({ width: 1280, height: 900 }); }
  // open Cell Injury as teacher: the module's own teacher session is created and placed in its slot
  const before = navigations.length;
  await dash(p, 'modules');
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
  await dash(p, 'manage');
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
  await dash(p, 'directory');
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
  await dash(p, 'directory');
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
  await dash(p, 'directory');
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
  await dash(p, 'directory');
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
  await dash(p, 'modules');
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
  await dash(p, 'modules');
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
  await dash(p, 'directory');
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
  await dash(p, 'directory');
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
async function realPage(M, calls, ctxOpts) {
  if (M[3]) main.ctx.CONTENT_KEYS[M[0]] = M[3];
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, ctxOpts || {}));
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
  if (teacher) { await p.waitForURL(HOME + '#/teacher'); await p.waitForSelector('.dash-card[data-view=modules]'); assert.match(await p.textContent('h1.page-h'), /Teacher Dashboard/); }
  else { await p.waitForURL(home); await p.waitForSelector('.hero h1'); assert.strictEqual(await p.$('#t-modules'), null, 'the student front page, not the dashboard'); }
}
REAL.forEach(function (M) {
  test('teacher: Teacher Sign-In → Dashboard → the real ' + M[1] + ' opens in teacher mode (no module password) → Back to Platform Home', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await dash(p, 'modules');
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
    if (M[3]) { await dash(p, 'manage'); await p.waitForSelector('#t-manage .modrow'); }   // Teacher Management still there
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
    await dash(p, 'modules');
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
      await dash(p, 'modules');
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
    await dash(p, 'manage');
    await p.waitForSelector('#t-manage .modrow');
    const row = p.locator('#t-manage .modrow', { hasText: M[0] === 'cellinjury' ? 'Cell Injury & Cell Death' : 'Inflammation & Healing' });
    await p.evaluate(function (k) { document.querySelectorAll('#t-manage details.adv').forEach(function (d) { d.open = true; }); }, M[0]);
    await row.locator('input[data-k=groups]').fill('B');
    await p.click('.save');
    await p.waitForFunction(function () { return /Saved/.test((document.querySelector('.toast') || {}).textContent || ''); });
    const card = '#t-modules .mod[data-id="' + M[0] + '"]';
    await dash(p, 'modules');
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
    await dash(p, 'directory');
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
    await dash(p, 'directory');
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
    await dash(p, 'directory');
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
  await dash(p, 'directory');
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
  assert.match(csv, /Student ID,Name,Active,Last sign-in,Quiz attempts[\s\S]*2026-10-01 Lecture One\r\n[\s\S]*ahmed,Student Ahmed,yes,[^,]*,1,75,75,0,,0,,1,100,0,0,present/);
  await p.context().close();
  // personal teacher: only the assigned group + module
  p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-u', un); await p.fill('#t-p', 'rep-teacher-2'); await p.click('form.card button[type=submit]');
  await dash(p, 'modules');
  await p.waitForSelector('#t-mine .my-group');
  await dash(p, 'attendance');
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
    const toBuild = async function () {
      await p.goto(HOME + '#/teacher');
      if (await p.$('#t-p')) { await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]'); }
      await dash(p, 'directory');
      await p.click('#t-dir .dir-tab[data-t=content]');
      await p.waitForSelector('#t-dir .content-mod[data-module="' + M[0] + '"] [data-a=build]');
      await p.click('#t-dir .content-mod[data-module="' + M[0] + '"] [data-a=build]');
      await p.waitForSelector('#t-dir .rb');
    };
    // without the Admin's draft session the preview does not open (only the sign-in screen + a notice)
    await p.goto('https://third-year-med.github.io/' + M[1] + '/preview/');
    await p.waitForSelector('#neo-boot .pf-prev');
    assert.strictEqual(await p.evaluate(function () { return document.body.classList.contains('neo-locked'); }), true);
    await toBuild();
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
    await toBuild();
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
  await dash(p, 'directory');
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
  await dash(p, 'exams');
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
  await dash(p, 'exams');
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

test('Official Exams: a group\'s empty exam bank is filled from the normal link\'s exam bank, topic by topic; picture filter', { skip: SKIP || (!fs.existsSync(EXAM_HTML) && 'exam app not available') }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const om = main.call({ module: 'portal', action: 'examOpen', token: t, storage: 'cellinjury' });
  const sv = main.call({ module: 'cellinjury', action: 'examBankSave', token: om.token, questions: [
    { type: 'tf', stem: 'Necrosis A', answer: true, topic: '03 · Necrosis' }, { type: 'tf', stem: 'Necrosis B', answer: false, topic: '03 · Necrosis' },
    { type: 'tf', stem: 'Apoptosis A', answer: true, topic: '04 · Apoptosis' },
    { type: 'fillblank', stem: 'What is the diagnosis?', answers: [['fatty change']], topic: 'Practical', image: 'https://drive.google.com/thumbnail?id=p9&sz=w2000' }] });
  assert.strictEqual(sv.saved.length, 4);
  const p = await realPage(REAL[0], []);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'exams');
  await p.waitForSelector('#t-exams .ex-row[data-storage="cellinjury-tr-a"] [data-a=man]');
  await p.click('#t-exams .ex-row[data-storage="cellinjury-tr-a"] [data-a=man]');
  await p.waitForSelector('.tbar');
  await p.click('.tbar .tab:has-text("Exam question bank")');
  await p.waitForSelector('td:has-text("This exam bank is empty")');
  await p.click('button:has-text("Copy from another exam bank")');
  await p.waitForSelector('.modal .qlist .qitem input');
  assert.strictEqual(await p.$eval('.modal label.f select', function (s) { return s.value; }), 'cellinjury', 'the normal link\'s bank first');
  await p.selectOption('.modal .row select >> nth=0', '03 · Necrosis');
  assert.strictEqual((await p.$$('.modal .qlist .qitem input')).length, 2);
  await p.click('.modal button:has-text("Select all shown")');
  await p.click('.modal button:has-text("Copy into this exam bank")');
  await p.waitForSelector('td:has-text("Necrosis A")');
  const tt = JSON.parse(await p.evaluate(function () { return sessionStorage.getItem('xm_cellinjury-tr-a_tt'); }));
  const bank = main.call({ module: 'cellinjury-tr-a', action: 'examBankList', token: tt.token }).questions;
  assert.deepStrictEqual(bank.map(function (q) { return q.stem; }).sort(), ['Necrosis A', 'Necrosis B']);
  assert.ok(bank.every(function (q) { return q.topic === '03 · Necrosis' && q.source.kind === 'exambank' && q.source.course === 'cellinjury'; }));
  // the practical (picture) questions only
  await p.click('button:has-text("Copy from another exam bank")');
  await p.waitForSelector('.modal .qlist .qitem input');
  await p.selectOption('.modal .row select >> nth=1', '_pic');
  assert.strictEqual((await p.$$('.modal .qlist .qitem input')).length, 1);
  await p.click('.modal button:has-text("Select all shown")');
  await p.click('.modal button:has-text("Copy into this exam bank")');
  await p.waitForSelector('td img.qthumb');
  await p.selectOption('.twrap .card select >> nth=1', '_pic');
  assert.strictEqual((await p.$$('.twrap table.t tbody tr:has(button:has-text("Edit"))')).length, 1, 'bank tab: picture filter');
  await p.selectOption('.twrap .card select >> nth=1', '');
  await p.click('button:has-text("Select all shown")');
  assert.match(await p.textContent('button:has-text("To a teaching bank")'), /\(3\)/, 'Select all shown in the bank tab');
  assert.ok(await p.$eval('.twrap table.t thead input[type=checkbox]', function (c) { return c.checked; }), 'header tick-box');
  await p.click('button:has-text("Clear selection")');
  assert.match(await p.textContent('button:has-text("Delete selected")'), /\(0\)/);
  await p.context().close();
});

test('Official Exams: "Copy to a group" gives a normal-link exam to Razi Group A (same times and code); its students see it', { skip: SKIP || (!fs.existsSync(EXAM_HTML) && 'exam app not available') }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token, now = Date.now();
  const om = main.call({ module: 'portal', action: 'examOpen', token: t, storage: 'cellinjury' });
  const bk = main.call({ module: 'cellinjury', action: 'examBankSave', token: om.token, questions: [{ type: 'tf', stem: 'Copy me 1', answer: true }, { type: 'tf', stem: 'Copy me 2', answer: false }] });
  assert.ok(main.call({ module: 'cellinjury', action: 'examUpsert', token: om.token, exam: { title: 'Q1 copy test', code: 'CPY77', opensAt: now - 60000, closesAt: now + 3600000, durationMin: 60, questionIds: bk.saved, status: 'published' } }).ok);
  const p = await realPage(REAL[0], []);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'exams');
  await p.waitForSelector('#t-exams .ex-row[data-storage="cellinjury"] [data-a=man]');
  await p.click('#t-exams .ex-row[data-storage="cellinjury"] [data-a=man]');
  await p.waitForSelector('.card:has-text("Q1 copy test") button:has-text("Copy to a group")');
  await p.click('.card:has-text("Q1 copy test") button:has-text("Copy to a group")');
  await p.waitForSelector('.modal label.f select');
  await p.selectOption('.modal label.f select', 'cellinjury-tr-a');
  await p.click('.modal button:has-text("Copy exam")');
  await p.waitForSelector('.modal .msg.ok');
  assert.match(await p.textContent('.modal'), /copied to[\s\S]*Group A[\s\S]*published with the same times and access code[\s\S]*2 question/);
  await p.click('.modal button:has-text("OK")');
  const og = main.call({ module: 'portal', action: 'examOpen', token: t, storage: 'cellinjury-tr-a' });
  const e = main.call({ module: 'cellinjury-tr-a', action: 'examList', token: og.token }).exams.filter(function (x) { return x.title === 'Q1 copy test'; })[0];
  assert.ok(e && e.status === 'published' && e.code === 'CPY77' && e.questionIds.length === 2);
  assert.ok(main.call({ module: 'cellinjury-tr-a', action: 'examLogin', code: 'CPY77', username: 'ahmed', password: PW }).ok, 'a Razi A student signs in with the usual password');
  await p.goto('https://third-year-med.github.io/pathology-exams/?g=tr-a');
  await p.waitForSelector('.front-ex[data-storage="cellinjury-tr-a"]');
  assert.match(await p.textContent('.front-ex[data-storage="cellinjury-tr-a"]'), /Q1 copy test[\s\S]*Open now/);
  await p.context().close();
  main.call({ module: 'cellinjury-tr-a', action: 'examUpsert', token: og.token, exam: Object.assign({}, e, { status: 'closed' }) });
});

test('Teaching Sessions: Admin schedules a lecture, opens attendance (rotating code on screen), a student checks in, marks, close, history, CSV; a teacher sees only own modules', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  let p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'sessions');
  await p.waitForSelector('#t-sessions .ts-top select');
  const gid = await p.$eval('#t-sessions .ts-top select', function (s) { return Array.prototype.filter.call(s.options, function (o) { return /Test Razi · Group A/.test(o.textContent); })[0].value; });
  await p.selectOption('#t-sessions .ts-top select', gid);
  await p.waitForSelector('#t-sessions .ts-lists .ts-block');
  // the platform time zone: Admin sets it (every date is shown and entered in it)
  await p.click('#t-sessions [data-a=set]');
  await p.fill('#t-sessions .ts-set [data-k=tz]', 'Asia/Aden'); await p.click('#t-sessions .ts-set button[type=submit]');
  await p.waitForFunction(function () { return /Asia\/Aden/.test(document.querySelector('#t-sessions .ts-top').textContent); });
  await p.waitForSelector('#t-sessions .ts-lists .ts-block');
  // schedule a lecture for tomorrow 10:00 Aden time
  await p.click('#t-sessions [data-a=new]');
  await p.fill('#t-sessions .ts-form [data-k=title]', 'Lecture 1 — Cell adaptation');
  await p.fill('#t-sessions .ts-form [data-k=chapter]', 'Chapter 1');
  const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await p.fill('#t-sessions .ts-form [data-k=when]', day + 'T10:00');
  await p.fill('#t-sessions .ts-form [data-k=mat]', 'https://third-year-med.github.io/cell-injury-teaching-platform/');
  assert.strictEqual(await p.isChecked('#t-sessions .ts-form [data-k=rot]'), false, 'a new lecture has ONE fixed code unless the teacher chooses rotation');
  await p.check('#t-sessions .ts-form [data-k=rot]');
  await p.click('#t-sessions .ts-form button[type=submit]');
  await p.waitForFunction(function () { return /Lecture 1 — Cell adaptation/.test(document.querySelector('#t-sessions .ts-lists').textContent); });
  const up = await p.textContent('#t-sessions .ts-block:has(h3:text("Upcoming"))');
  assert.match(up, /Lecture 1 — Cell adaptation[\s\S]*Cell Injury[\s\S]*Chapter 1[\s\S]*10:00[\s\S]*90 min · 🔄 rotating code[\s\S]*Materials/);
  const saved = main.ctx.dirAll_('TeachingSessions').filter(function (x) { return x.title === 'Lecture 1 — Cell adaptation'; })[0];
  assert.strictEqual(new Date(Number(saved.startAt)).toISOString(), day + 'T07:00:00.000Z', '10:00 in Aden = 07:00 UTC');
  // open attendance → live screen with the code
  await p.click('#t-sessions .ts-block:has(h3:text("Upcoming")) [data-a=go]');
  await p.waitForSelector('#t-sessions .ts-code');
  const code = (await p.textContent('#t-sessions .ts-code')).trim();
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.match(await p.textContent('#t-sessions .ts-codebox'), /New code in \d+ s/);
  if (process.env.SHOTS) await (await p.$('#t-sessions')).screenshot({ path: path.join(process.env.SHOTS, 'sessions-live.png') });
  // a student checks in inside the module with the code → appears within 5 s
  const ses = main.call({ module: 'cellinjury-tr-a', action: 'studentLogin', username: 'ahmed', password: PW });
  const sub = main.call({ module: 'cellinjury-tr-a', action: 'submitAttendanceByCode', stoken: ses.token, code: code }); assert.ok(sub.ok, JSON.stringify(sub) + ' code ' + code);
  await p.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#t-sessions .ts-reg tr'), function (x) { return /Student Ahmed/.test(x.textContent); })[0]; return r && /Present/.test(r.textContent); }, null, { timeout: 8000 });
  // close attendance → the register stays open; nobody is "Not yet" any more
  await p.click('#t-sessions [data-a=close]');
  await p.waitForFunction(function () { var s = document.querySelector('#t-sessions .ts-screen'); return s && !document.querySelector('#t-sessions .ts-code') && /Register \(CSV\)/.test(s.textContent); });
  assert.ok(!/Not yet/.test(await p.textContent('#t-sessions .ts-reg')));
  const hist = await p.textContent('#t-sessions .ts-block:has(h3:text("history"))');
  assert.match(hist, /Lecture 1 — Cell adaptation[\s\S]*✅ 1/);
  // students table + CSV
  assert.match(await p.textContent('#t-att .ts-block:has(h3:text("by student"))'), /ahmed[\s\S]*Student Ahmed[\s\S]*100%/);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#t-sessions .ts-block:has(h3:text("history")) [data-a=csv]')]);
  assert.strictEqual(dl.suggestedFilename(), 'teaching-sessions-tr-a.csv');
  assert.match(fs.readFileSync(await dl.path(), 'utf8'), /Date and time \(Asia\/Aden\),Lecture,Module[\s\S]*Lecture 1 — Cell adaptation,Cell Injury & Cell Death,Chapter 1,[^,]*,ended,1,0,0,/);
  // the attendance is the module's own (Results & attendance sees it)
  assert.ok(main.ctx.rpRows_('AttendanceSessions').some(function (r) { return r.module === 'cellinjury-tr-a' && r.sessionTitle === 'Lecture 1 — Cell adaptation' && r.status === 'closed'; }));
  await p.context().close();
  // a personal teacher with only Inflammation of Group A: sees the group, not the Cell Injury lecture
  const dir = main.call({ module: 'portal', action: 'dirGet', token: t });
  const d = dir.deliveries.filter(function (x) { return x.groupId === gid && x.moduleId === 'inflhealing'; })[0];
  const un = 'ts.teacher', cr = main.call({ module: 'portal', action: 'teacherSave', token: t, create: true, record: { username: un, name: 'Dr. Sessions', password: 'ts-teacher-1' } });
  assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(main.call({ module: 'portal', action: 'teacherAssign', token: t, userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'ts-teacher-1' });
  assert.ok(main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'ts-teacher-1', newPassword: 'ts-teacher-2' }).ok);
  p = await page();
  await p.goto(url + '#/teacher');
  await p.fill('#t-u', un); await p.fill('#t-p', 'ts-teacher-2'); await p.click('form.card button[type=submit]');
  await dash(p, 'sessions');
  await p.waitForSelector('#t-sessions .ts-lists .ts-block');
  assert.deepStrictEqual(await p.$$eval('#t-sessions .ts-top select option', function (o) { return o.map(function (x) { return x.textContent; }); }), ['Test Razi · Group A (2026-27)']);
  assert.ok(!/Cell adaptation/.test(await p.textContent('#t-sessions')), 'not the other module\'s lecture');
  assert.strictEqual(await p.$('#t-sessions [data-a=set]'), null, 'no settings for a teacher');
  // start a lecture now (fixed code), then the module list offers only Inflammation
  await p.click('#t-sessions [data-a=now]');
  assert.deepStrictEqual(await p.$$eval('#t-sessions .ts-form [data-k=deliveryId] option', function (o) { return o.map(function (x) { return x.textContent; }); }), ['🔥 Inflammation & Healing']);
  assert.strictEqual(await p.inputValue('#t-sessions .ts-form [data-k=teacher]'), 'Dr. Sessions');
  await p.fill('#t-sessions .ts-form [data-k=title]', 'Lecture 2 — Acute inflammation');
  await p.uncheck('#t-sessions .ts-form [data-k=rot]');
  await p.click('#t-sessions .ts-form button[type=submit]');
  await p.waitForSelector('#t-sessions .ts-code');
  assert.match(await p.textContent('#t-sessions .ts-codebox'), /Fixed code/);
  // excuse the student (not checked in), then close
  await p.click('#t-sessions .ts-reg tr:has-text("Student Ahmed") button:text("Excused")');
  await p.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#t-sessions .ts-reg tr'), function (x) { return /Student Ahmed/.test(x.textContent); })[0]; return r && /Excused/.test(r.textContent); });
  await p.click('#t-sessions [data-a=close]');
  await p.waitForFunction(function () { return /📝 1/.test((document.querySelector('#t-sessions .ts-lists') || {}).textContent || ''); });
  await p.context().close();
  main.call({ module: 'portal', action: 'teacherSetActive', token: t, userId: cr.teacher.userId, active: false });
});

test('Teaching Sessions: the Admin deletes an ENDED lecture from the history (typed DELETE) — its check-ins go with it; a teacher has no Delete on ended lectures', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === 'cellinjury'; })[0];
  const ended = function (title) {
    const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: title, startAt: Date.now() } }); assert.ok(L.ok, JSON.stringify(L));
    const ses = main.call({ module: 'cellinjury-tr-a', action: 'studentLogin', username: 'ahmed', password: PW });
    assert.ok(main.call({ module: 'cellinjury-tr-a', action: 'submitAttendanceByCode', stoken: ses.token, code: L.code }).ok);
    assert.ok(A('tsClose', { tsId: L.session.tsId }).ok);
    return main.ctx.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === L.session.tsId; })[0];
  };
  const del = ended('Trial lecture — delete me'), kept = ended('Real lecture — keep');
  const recs = function (id) { return main.ctx.rpRows_('AttendanceRecords').filter(function (q) { return q.sessionId === id; }).length; };
  assert.strictEqual(recs(del.attSessionId), 1);
  const p = await page();
  p.removeAllListeners('dialog');
  let answer = 'nope', prompts = [];
  p.on('dialog', function (dl) { prompts.push(dl.message()); dl.accept(answer); });
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'sessions');
  await p.waitForSelector('#t-sessions .ts-top select');
  await p.selectOption('#t-sessions .ts-top select', g.groupId);
  const row = '#t-sessions .ts-block:has(h3:text("history")) .dir-row:has-text("Trial lecture — delete me")';
  await p.waitForSelector(row + ' [data-a=delx]');
  await p.waitForSelector('#t-sessions .ts-block:has(h3:text("history")) .dir-row:has-text("Real lecture — keep") [data-a=delx]', { state: 'visible' });
  // wrong word → nothing deleted
  await p.click(row + ' [data-a=delx]');
  await p.waitForSelector('.toast:has-text("Not deleted")');
  assert.match(prompts[0], /Trial lecture — delete me[\s\S]*1 check-in[\s\S]*cannot be undone[\s\S]*Type DELETE/);
  assert.strictEqual(recs(del.attSessionId), 1); assert.ok(await p.$(row));
  // DELETE → gone from the history, with its attendance
  answer = 'DELETE';
  await p.click(row + ' [data-a=delx]');
  await p.waitForFunction(function () { return !/Trial lecture — delete me/.test((document.querySelector('#t-sessions .ts-lists') || {}).textContent || ''); });
  assert.ok(await p.isVisible('#t-sessions .ts-block:has(h3:text("history")) .dir-row:has-text("Real lecture — keep")'));
  assert.strictEqual(main.ctx.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === del.tsId; }).length, 0);
  assert.strictEqual(main.ctx.rpRows_('AttendanceSessions').filter(function (a) { return a.sessionId === del.attSessionId; }).length, 0);
  assert.strictEqual(recs(del.attSessionId), 0);
  assert.strictEqual(recs(kept.attSessionId), 1, 'the other lecture keeps its check-in');
  await p.context().close();
  // a personal teacher of that module sees the ended lecture without a Delete button
  const un = 'del.teacher', cr = A('teacherSave', { create: true, record: { username: un, name: 'Dr. Delete', password: 'del-teacher-1' } }); assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(A('teacherAssign', { userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'del-teacher-1' });
  main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'del-teacher-1', newPassword: 'del-teacher-2' });
  const q = await page();
  await q.goto(url + '#/teacher');
  await q.fill('#t-u', un); await q.fill('#t-p', 'del-teacher-2'); await q.click('form.card button[type=submit]');
  await dash(q, 'sessions');
  await q.waitForSelector('#t-sessions .ts-block:has(h3:text("history")) .dir-row:has-text("Real lecture — keep")');
  assert.ok(!(await q.$('#t-sessions [data-a=delx]')), 'no Delete for a teacher');
  await q.context().close();
  main.call({ module: 'portal', action: 'teacherSetActive', token: t, userId: cr.teacher.userId, active: false });
});

test('Teaching Sessions on the group page: the student sees the live lecture, checks in with the code, sees upcoming lectures and own attendance', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, JSON.stringify(r)); return r; };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === 'cellinjury'; })[0];
  A('tsSave', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Lecture 9 — Necrosis', chapter: 'Chapter 2', startAt: Date.now() + 2 * 864e5, materialsUrl: 'https://example.org/necrosis.pdf' } });
  const live = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Lecture 8 — Apoptosis', startAt: Date.now(), rotate: false } });
  const p = await page({ width: 390, height: 844 });
  await p.goto(url + '?g=tr-a');
  await signIn(p, 'ahmed', PW);
  await p.waitForSelector('#ts-stu .ts-now');
  assert.match(await p.textContent('#ts-stu .ts-now'), /Live now[\s\S]*Lecture 8 — Apoptosis[\s\S]*Cell Injury/);
  assert.match(await p.textContent('#ts-stu'), /Upcoming lectures[\s\S]*Lecture 9 — Necrosis[\s\S]*Chapter 2[\s\S]*Lecture materials/);
  await p.fill('#ts-stu .ts-ci-code', 'WRONG1'); await p.click('#ts-stu .ts-ci-f button');
  await p.waitForFunction(function () { return /not valid/.test(document.querySelector('#ts-stu .ts-ci-f .err').textContent); });
  await p.fill('#ts-stu .ts-ci-code', live.code.toLowerCase()); await p.click('#ts-stu .ts-ci-f button');
  await p.waitForSelector('#ts-stu .ts-ok');
  assert.match(await p.textContent('#ts-stu .ts-ok'), /You are checked in/);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'sessions-student.png'), fullPage: false });
  assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'fits a phone');
  // the teacher's live screen shows the check-in
  const st = A('tsState', { tsId: live.session.tsId });
  assert.strictEqual(st.students.filter(function (x) { return x.studentId === 'ahmed'; })[0].status, 'present');
  // after closing: My attendance
  A('tsClose', { tsId: live.session.tsId });
  await p.click('#ts-stu [data-a=r]');
  await p.waitForFunction(function () { return /My attendance[\s\S]*100%/.test(document.querySelector('#ts-stu').textContent) && !document.querySelector('#ts-stu .ts-now'); });
  await p.context().close();
});

test('Group Live Classroom: a student (group page) and the teacher (dashboard) chat in ONE classroom — message, announcement, reply, reaction, file, picture, lecture banner', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, JSON.stringify(r)); return r; };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === 'inflhealing'; })[0];
  const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Lecture 5 — Chronic inflammation', startAt: Date.now(), rotate: false } });
  // student
  const s = await page({ width: 390, height: 844 });
  await s.goto(url + '?g=tr-a');
  await signIn(s, 'ahmed', PW);
  await s.waitForSelector('#ts-stu [data-a=live]');
  await s.click('#ts-stu [data-a=live]');
  await s.waitForSelector('.lc .lc-form');
  assert.match(await s.textContent('.lc-lect'), /Live lecture: Lecture 5 — Chronic inflammation — 🔥 Inflammation & Healing/);
  await s.waitForFunction(function () { return /Lecture started: Lecture 5/.test(document.querySelector('.lc-msgs').textContent); });
  await s.fill('.lc textarea', 'Hello Doctor, I have a question about granulomas');
  await s.press('.lc textarea', 'Enter');
  await s.waitForFunction(function () { return /question about granulomas/.test(document.querySelector('.lc-msgs').textContent); });
  // a file + a picture from the student
  await s.setInputFiles('.lc input[type=file]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('my notes') },
    { name: 'slide.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4IScHRwzEcQCxYxBBO0tjggAAAABJRU5ErkJggg==', 'base64') }]);
  await s.waitForFunction(function () { var u = document.querySelectorAll('.lc-up i'); return u.length === 2 && Array.prototype.every.call(u, function (x) { return x.textContent === '✓'; }); });
  await s.fill('.lc textarea', 'My notes and the slide');
  await s.click('.lc button[type=submit]');
  await s.waitForSelector('.lc-m .lc-file');
  await s.waitForSelector('.lc-m .lc-img img');
  // teacher (Admin) opens the same classroom from the dashboard
  const tp = await page();
  await tp.goto(url + '#/teacher');
  await tp.fill('#t-p', TPW); await tp.click('form.card button[type=submit]');
  await dash(tp, 'sessions');
  await tp.waitForSelector('#t-sessions .ts-top select');
  await tp.selectOption('#t-sessions .ts-top select', g.groupId);
  await tp.waitForSelector('#t-sessions .ts-lists .ts-block');
  await tp.click('#t-sessions [data-a=live]');
  await tp.waitForSelector('.lc .lc-form');
  await tp.waitForFunction(function () { return /question about granulomas/.test(document.querySelector('.lc-msgs').textContent); });
  assert.ok(await tp.$('.lc [data-k=ann]'), 'teachers can post announcements');
  // the teacher replies (as an announcement) and downloads the student's file
  await tp.click('.lc-m:has-text("question about granulomas") [data-a=reply]');
  await tp.fill('.lc textarea', 'Good question — see the pinned summary.');
  await tp.check('.lc [data-k=ann]');
  await tp.click('.lc button[type=submit]');
  await tp.waitForSelector('.lc-m.ann:has-text("Good question")');
  await tp.click('.lc-m.ann:has-text("Good question") [data-a=pin]');
  await tp.waitForSelector('.lc-pins:not([hidden])');
  const [dl] = await Promise.all([tp.waitForEvent('download'), tp.click('.lc-m .lc-file')]);
  assert.strictEqual(dl.suggestedFilename(), 'notes.txt');
  assert.strictEqual(fs.readFileSync(await dl.path(), 'utf8'), 'my notes');
  if (process.env.SHOTS) await tp.screenshot({ path: path.join(process.env.SHOTS, 'classroom-teacher.png') });
  // the student sees the teacher's reply (pinned announcement, quoted question) and reacts
  await s.waitForSelector('.lc-m.ann:has-text("Good question")', { timeout: 15000 });
  assert.match(await s.textContent('.lc-m.ann:has-text("Good question")'), /Teacher[\s\S]*Announcement[\s\S]*↩ Student Ahmed: Hello Doctor/);
  await s.waitForSelector('.lc-pins:not([hidden])', { timeout: 15000 });
  await s.click('.lc-m.ann:has-text("Good question") [data-a=react]');
  await s.click('.lc-m.ann:has-text("Good question") .lc-pick button:text("👍")');
  await s.waitForSelector('.lc-m.ann:has-text("Good question") .lc-chip.on');
  if (process.env.SHOTS) await s.screenshot({ path: path.join(process.env.SHOTS, 'classroom-student.png') });
  assert.ok(await s.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'fits a phone');
  // closing the lecture posts "Lecture ended"; back returns to the group page
  A('tsClose', { tsId: L.session.tsId });
  await s.waitForFunction(function () { return /Lecture ended: Lecture 5/.test(document.querySelector('.lc-msgs').textContent); }, null, { timeout: 15000 });
  await s.click('.lc [data-a=back]');
  await s.waitForSelector('#ts-stu');
  await s.context().close(); await tp.context().close();
});

test('Teaching Sessions step 4: inside the real module page the Live Classroom and Attendance are hidden (no background classroom checks), old links show a notice, the Admin switch shows them again', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.addStudents('cellinjury', [{ username: 'hide-s', name: 'Hide Student', password: PW, mustChange: false }]);
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: true }).ok);
  const calls = [];
  const p = await realPage(M, calls);
  await p.goto(HOME);
  await p.waitForSelector('.mod[data-id="cellinjury"]');
  await signIn(p, 'hide-s', PW);
  await p.waitForSelector('.mod[data-id="cellinjury"] .go');
  await p.click('.mod[data-id="cellinjury"] .go');
  await p.waitForURL(new RegExp(M[1]));
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
  await p.waitForSelector('.nav-btn[data-view="quiz"]', { state: 'visible' });
  assert.ok(!(await p.isVisible('.nav-btn[data-view="live"]')), 'Live Classroom button hidden');
  assert.ok(!(await p.isVisible('.nav-btn[data-view="attendance"]')), 'Attendance button hidden');
  assert.ok(calls.some(function (c) { return c.module === 'portal' && c.action === 'portalModuleFlags'; }), 'the setting was read from the platform');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'module-hidden.png'), clip: { x: 0, y: 0, width: 1280, height: 260 } });
  // an old link (bookmark / QR) → the start page + a notice pointing to the group page
  await p.evaluate(function () { location.hash = '#/attendance'; });
  await p.waitForSelector('#pf-moved');
  assert.match(await p.textContent('#pf-moved'), /now on your group page/);
  await p.waitForFunction(function () { return !/attendance/.test(location.hash); });
  await p.evaluate(function () { location.hash = '#/live'; });
  await p.waitForFunction(function () { return !/live/.test(location.hash); });
  await p.waitForTimeout(1500);
  assert.strictEqual(calls.filter(function (c) { return /^live/.test(String(c.action || '')); }).length, 0, 'no Live Classroom request reached the server');
  // the Admin shows them again → after the 5-minute memory (cleared here), the buttons are back
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: false }).ok);
  await p.evaluate(function () { localStorage.removeItem('pf_flags_v1'); });
  await p.reload();
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
  await p.waitForSelector('.nav-btn[data-view="live"]', { state: 'visible', timeout: 15000 });
  assert.ok(await p.isVisible('.nav-btn[data-view="attendance"]'));
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: true }).ok);
  await p.context().close();
});

test('Teaching Sessions step 4: the teacher inside the real module — the Teacher Portal has no Attendance tab while hidden', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: true }).ok);
  const calls = [];
  const p = await realPage(M, calls);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'modules');
  await p.waitForSelector('#t-modules .mod[data-id="cellinjury"] .t-admin');
  await p.click('#t-modules .mod[data-id="cellinjury"] .t-admin');
  await p.waitForURL(new RegExp(M[1]));
  await p.waitForSelector('.portal-tabs button.tab', { state: 'attached', timeout: 20000 });
  await p.waitForTimeout(500);
  const tabs = await p.$$eval('.portal-tabs button.tab', function (b) { return b.filter(function (x) { return x.offsetParent !== null; }).map(function (x) { return x.textContent.trim(); }); });
  assert.ok(tabs.length > 3, tabs.join('|'));
  assert.ok(!tabs.some(function (x) { return /Attendance/.test(x); }), 'no Attendance tab: ' + tabs.join('|'));
  await p.evaluate(function () { location.hash = '#/teacher/attendance'; });
  await p.waitForSelector('#pf-moved');
  assert.match(await p.textContent('#pf-moved'), /Teacher Dashboard/);
  await p.context().close();
});

/* Presentation Mode on the real module page: image enlarge control + lightbox (also inside native fullscreen),
   swipe navigation for touch and mouse, and that none of it moves the slide by accident. */
async function presentPage(M, ctxOpts) {
  main.ctx.CONTENT_KEYS[M[0]] = M[3];
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]];
  const p = await realPage(M, [], ctxOpts);
  await p.addInitScript(function (v) { localStorage.setItem('ci_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
  await p.goto('https://third-year-med.github.io/' + M[1] + '/#/present/slide/1');
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  await p.waitForSelector('#pres-stage .slide', { timeout: 15000 });
  return p;
}
async function slideNo(p) { return parseInt((await p.textContent('.pres-toolbar .counter')).split('/')[0], 10); }
async function gotoSlideWith(p, sel) {
  for (let i = 0; i < 150 && !(await p.$(sel)); i++) { await p.click('.pres-toolbar button[aria-label="Next slide"]'); }
  assert.ok(!!(await p.$(sel)), 'a slide with ' + sel);
  await p.waitForTimeout(350);   // the slide-in animation
}
async function stageBox(p) { return p.$eval('.pres-stage-outer', function (e) { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); }

test('Presentation Mode (desktop): enlarge icon opens the viewer without moving the slide; viewer stays visible in fullscreen and closing keeps fullscreen; mouse swipe; keys and buttons', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  await gotoSlideWith(p, '#pres-stage .slide-img:not(.img-broken) .pz-zoom');
  const n0 = await slideNo(p);
  assert.ok(await p.isVisible('#pres-stage .slide-img .pz-zoom'), 'a visible enlarge button');
  assert.match(await p.getAttribute('#pres-stage .slide-img .pz-zoom', 'aria-label'), /^Enlarge image/);
  await p.click('#pres-stage .slide-img .pz-zoom');
  await p.waitForSelector('.lightbox .lb-content img, .lightbox .lb-content .svg-host');
  assert.strictEqual(await p.evaluate(function () { return document.activeElement && document.activeElement.getAttribute('aria-label'); }), 'Close image viewer', 'focus moves to Close');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('PageDown'); await p.keyboard.press('End');
  assert.strictEqual(await slideNo(p), n0, 'keys inside the viewer do not change the slide');
  await p.mouse.move(640, 450); await p.mouse.wheel(0, -300);   // zoom in the viewer
  assert.ok(!!(await p.$('.lightbox')), 'still open');
  await p.click('.lightbox .lb-close');
  assert.ok(!(await p.$('.lightbox')));
  assert.strictEqual(await slideNo(p), n0, 'closing returns to the same slide');
  assert.match(await p.evaluate(function () { return document.activeElement && document.activeElement.className; }), /pz-zoom/, 'focus back on the enlarge button');
  // Space on the focused Close button closes the viewer — it does not advance the slide
  await p.click('#pres-stage .slide-img .pz-zoom'); await p.waitForSelector('.lightbox');
  await p.keyboard.press(' ');
  assert.ok(!(await p.$('.lightbox'))); assert.strictEqual(await slideNo(p), n0);
  // Escape closes the viewer only (and does not leave the presentation)
  await p.click('#pres-stage .slide-img .pz-zoom'); await p.waitForSelector('.lightbox');
  await p.keyboard.press('Escape');
  assert.ok(!(await p.$('.lightbox'))); assert.strictEqual(await slideNo(p), n0);
  assert.match(p.url(), /#\/present/);
  // native fullscreen: the viewer is painted inside the fullscreen element; closing it keeps the presentation fullscreen
  await p.keyboard.press('f');
  await p.waitForFunction(function () { return document.fullscreenElement && document.fullscreenElement.id === 'pres-wrap'; });
  await p.waitForTimeout(300);
  await p.click('#pres-stage .slide-img .pz-zoom'); await p.waitForSelector('.lightbox');
  const inFs = await p.evaluate(function () {
    const lb = document.querySelector('.lightbox'), r = lb.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { inside: document.fullscreenElement.contains(lb), onTop: lb.contains(top), fsButton: !!lb.querySelector('[aria-label="Full screen"]') };
  });
  assert.deepStrictEqual(inFs, { inside: true, onTop: true, fsButton: false });
  await p.click('.lightbox .lb-close');
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(function () { return document.fullscreenElement && document.fullscreenElement.id; }), 'pres-wrap', 'still fullscreen');
  assert.ok(!!(await p.$('#pres-wrap.pres-fullscreen')));
  assert.strictEqual(await slideNo(p), n0);
  await p.keyboard.press('f');
  await p.waitForFunction(function () { return !document.fullscreenElement; });
  // mouse swipe: left = next, right = previous; short or vertical drags and drags that start on a button do nothing
  const b = await stageBox(p), cy = b.y + b.h * 0.25, cx = b.x + b.w / 2;
  const drag = async function (x0, y0, x1, y1) { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await p.mouse.up(); await p.waitForTimeout(250); };
  await drag(cx + 150, cy, cx - 150, cy + 10);
  assert.strictEqual(await slideNo(p), n0 + 1, 'mouse swipe left → next');
  await drag(cx - 150, cy, cx + 150, cy);
  assert.strictEqual(await slideNo(p), n0, 'mouse swipe right → previous');
  await drag(cx, cy, cx - 40, cy);
  assert.strictEqual(await slideNo(p), n0, 'too short');
  await drag(cx, cy - 60, cx + 30, cy + 140);
  assert.strictEqual(await slideNo(p), n0, 'vertical');
  assert.ok(!(await p.$('.lightbox')), 'no drag opened the image viewer');
  const zb = await p.$eval('#pres-stage .slide-img .pz-zoom', function (e) { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(zb.x, zb.y, zb.x - 200, zb.y);
  assert.strictEqual(await slideNo(p), n0, 'a drag that starts on a control is not a swipe');
  // keyboard and toolbar buttons still work
  await p.keyboard.press('ArrowRight'); assert.strictEqual(await slideNo(p), n0 + 1);
  await p.keyboard.press('ArrowLeft'); assert.strictEqual(await slideNo(p), n0);
  await p.click('.pres-toolbar button[aria-label="Next slide"]'); assert.strictEqual(await slideNo(p), n0 + 1);
  await p.click('.pres-toolbar button[aria-label="Previous slide"]'); assert.strictEqual(await slideNo(p), n0);
  // gallery (Images) slides: the existing enlarge button now shows the icon and still opens the viewer
  await gotoSlideWith(p, '#pres-stage .gal-media .pz-zoom');
  const g0 = await slideNo(p);
  await p.click('#pres-stage .gal-media');
  await p.waitForSelector('.lightbox'); await p.click('.lightbox .lb-close');
  assert.strictEqual(await slideNo(p), g0);
  // edit mode: a drag selects/edits, it never changes the slide
  await p.click('.pres-toolbar button:has-text("Edit slides")');
  await p.waitForSelector('.pres-edit:not(.hidden)');
  await drag(cx + 150, cy, cx - 150, cy);
  assert.strictEqual(await slideNo(p), g0, 'no swipe in slide-edit mode');
  await p.click('.pres-toolbar button:has-text("Editing slides")');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'present-desktop.png') });
  await p.context().close();
});

test('Presentation Mode (iPad, touch): tap the enlarge icon → viewer with pinch-zoom and drag, swipes inside it never change the slide, Close returns to the same slide; swipe left/right navigates; short, vertical, two-finger and edge gestures do not', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0], { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const cdp = await p.context().newCDPSession(p);
  const touch = function (type, pts) { return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts.map(function (q, i) { return { x: q[0], y: q[1], id: i + 1 }; }) }); };
  const swipe = async function (x0, y0, x1, y1) {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10]]); await p.waitForTimeout(12); }
    await touch('touchEnd', []); await p.waitForTimeout(300);
  };
  const pinch = async function (cx, cy, d0, d1) {
    await touch('touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
    for (let i = 1; i <= 10; i++) { const d = d0 + (d1 - d0) * i / 10; await touch('touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await p.waitForTimeout(12); }
    await touch('touchEnd', []); await p.waitForTimeout(250);
  };
  await gotoSlideWith(p, '#pres-stage .slide-img:not(.img-broken) .pz-zoom');
  const n0 = await slideNo(p);
  const b = await stageBox(p), cy = b.y + b.h * 0.3, cx = b.x + b.w / 2;
  await swipe(cx + 160, cy, cx - 160, cy + 12);
  assert.strictEqual(await slideNo(p), n0 + 1, 'swipe left → next');
  await swipe(cx - 160, cy, cx + 160, cy);
  assert.strictEqual(await slideNo(p), n0, 'swipe right → previous');
  await swipe(cx, cy, cx - 30, cy);
  assert.strictEqual(await slideNo(p), n0, 'too short to count');
  await swipe(cx, cy - 80, cx + 25, cy + 150);
  assert.strictEqual(await slideNo(p), n0, 'vertical movement (scroll) is not a swipe');
  await pinch(cx, cy, 120, 320);
  assert.strictEqual(await slideNo(p), n0, 'two fingers (pinch) are not a swipe');
  await swipe(8, cy, 300, cy);
  assert.strictEqual(await slideNo(p), n0, 'a gesture from the screen edge is left to the browser');
  assert.ok(!(await p.$('.lightbox')), 'no gesture opened the image viewer');
  assert.strictEqual(await p.evaluate(function () { return window.visualViewport ? window.visualViewport.scale : 1; }), 1, 'the page itself was not zoomed');
  // tap the visible enlarge icon
  await p.tap('#pres-stage .slide-img .pz-zoom');
  await p.waitForSelector('.lightbox .lb-content img, .lightbox .lb-content .svg-host');
  await p.waitForTimeout(200);
  const scaleOf = function () { return p.$eval('.lightbox .lb-content', function (e) { const m = /scale\(([\d.]+)\)/.exec(e.style.transform); return m ? +m[1] : 1; }); };
  const s0 = await scaleOf();
  const lb = await p.$eval('.lightbox .lb-stage', function (e) { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pinch(lb.x, lb.y, 100, 300);
  const s1 = await scaleOf();
  assert.ok(s1 > s0 * 1.8, 'pinch zooms the image (' + s0 + ' → ' + s1 + ')');
  const t0 = await p.$eval('.lightbox .lb-content', function (e) { return e.style.transform; });
  await swipe(lb.x + 150, lb.y, lb.x - 150, lb.y);
  assert.notStrictEqual(await p.$eval('.lightbox .lb-content', function (e) { return e.style.transform; }), t0, 'a one-finger drag pans the image');
  assert.strictEqual(await slideNo(p), n0, 'dragging inside the viewer never changes the slide');
  assert.strictEqual(await p.evaluate(function () { return window.visualViewport ? window.visualViewport.scale : 1; }), 1, 'the page behind was not zoomed');
  await p.tap('.lightbox .lb-close');
  await p.waitForTimeout(450);
  assert.ok(!(await p.$('.lightbox')), 'closed');
  assert.strictEqual(await slideNo(p), n0, 'back on the same slide');
  // tapping the image itself also enlarges it, and a tap is never taken for a swipe
  await p.tap('#pres-stage .slide-img img');
  await p.waitForSelector('.lightbox'); await p.tap('.lightbox .lb-close'); await p.waitForTimeout(450);
  assert.strictEqual(await slideNo(p), n0);
  // a question slide: tapping the show-of-hands chip counts, it does not navigate; a swipe starting on the options is ignored
  await gotoSlideWith(p, '#pres-stage .q-opts .tally');
  const q0 = await slideNo(p);
  await p.tap('#pres-stage .q-opts li:first-child .tally');
  assert.match(await p.textContent('#pres-stage .q-opts li:first-child .tally'), /✋ [1-9]/);
  const o = await p.$eval('#pres-stage .q-opts li:first-child', function (e) { const r = e.getBoundingClientRect(); return { x: r.x + r.width * 0.4, y: r.y + r.height / 2 }; });
  await swipe(o.x + 120, o.y, o.x - 120, o.y);
  assert.strictEqual(await slideNo(p), q0, 'a gesture starting on an answer option is not a swipe');
  const q = await stageBox(p);
  await swipe(q.x + q.w / 2 + 160, q.y + 30, q.x + q.w / 2 - 160, q.y + 30);
  assert.strictEqual(await slideNo(p), q0 + 1, 'elsewhere on the question slide, swipe works');
  // the gesture never left Presentation Mode (no browser back/forward)
  assert.match(p.url(), /#\/present/);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'present-ipad.png') });
  await p.context().close();
});

test('Presentation Mode attendance code: the open code stays in the corner on every slide, in fullscreen and over the image viewer, unchanged, until the teacher closes attendance; students never see it', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === M[0]; })[0];
  const un = 'pres.att', cr = A('teacherSave', { create: true, record: { username: un, name: 'Dr. Present', password: 'pres-att-1' } }); assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(A('teacherAssign', { userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'pres-att-1' });
  main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'pres-att-1', newPassword: 'pres-att-2' });
  // no attendance open yet
  const calls = [];
  const p = await realPage(M, calls);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-u', un); await p.fill('#t-p', 'pres-att-2'); await p.click('form.card button[type=submit]');
  await dash(p, 'modules');
  await p.waitForSelector('#t-mine .mod[data-id="' + M[0] + '"] .t-open');
  await p.click('#t-mine .mod[data-id="' + M[0] + '"] .t-open');
  await p.waitForURL(new RegExp(M[1] + '/\\?g=tr-a'));
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.module; }), M[0] + '-tr-a');
  await p.evaluate(function () { location.hash = '#/present/slide/1'; });
  await p.waitForSelector('#pres-stage .slide');
  await p.waitForFunction(function () { return window.__presAttendance; });
  await p.evaluate(function () { return window.__presAttendance.poll(); });
  assert.ok(!(await p.$('.pres-att')), 'no code while attendance is closed');
  // the lecture starts (Teacher Dashboard → Teaching Sessions → Open attendance) → the code appears on the slide
  const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Lecture 9 — Necrosis', startAt: Date.now(), durationMin: 50 } });
  assert.ok(L.ok, JSON.stringify(L)); assert.strictEqual(L.session.rotate, false, 'one fixed code by default');
  const code = L.code;
  await p.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, code, { timeout: 15000 });
  assert.match(await p.textContent('.pres-att'), new RegExp('^Attendance Code:\\s*' + code + '$'));
  const where = async function () {
    return p.evaluate(function () {
      const b = document.querySelector('.pres-att'); if (!b) return null;
      const r = b.getBoundingClientRect(), o = document.querySelector('.pres-stage-outer').getBoundingClientRect(), cs = getComputedStyle(b);
      b.style.pointerEvents = 'auto'; const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); b.style.pointerEvents = '';
      return { code: b.querySelector('.pa-c').textContent, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 40 && r.height > 15, onTop: b.contains(top),
        bottomRight: r.right <= o.right && r.bottom <= Math.min(o.bottom, innerHeight) && Math.min(o.right, innerWidth) - r.right < 30 && Math.min(o.bottom, innerHeight) - r.bottom < 30, small: r.width < o.width * 0.45 && r.height < o.height * 0.2,
        inFullscreen: document.fullscreenElement ? document.fullscreenElement.contains(b) : null };
    });
  };
  let w = await where();
  assert.deepStrictEqual(w, { code: code, visible: true, onTop: true, bottomRight: true, small: true, inFullscreen: null });
  // move through many slides with keys, buttons and swipes: same code, still there
  for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowRight');
  await p.click('.pres-toolbar button[aria-label="Next slide"]'); await p.click('.pres-toolbar button[aria-label="Previous slide"]');
  const ob = await p.$eval('.pres-stage-outer', function (e) { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.25 }; });
  await p.mouse.move(ob.x + 150, ob.y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(ob.x + 150 - 37 * i, ob.y); await p.mouse.up(); await p.waitForTimeout(300);
  await p.keyboard.press('End'); await p.keyboard.press('Home'); await p.keyboard.press('o'); await p.keyboard.press('o');
  w = await where(); assert.strictEqual(w.code, code); assert.ok(w.visible && w.onTop && w.bottomRight, JSON.stringify(w));
  // fullscreen in and out
  await p.keyboard.press('f');
  await p.waitForFunction(function () { return document.fullscreenElement && document.fullscreenElement.id === 'pres-wrap'; });
  await p.waitForTimeout(300); await p.keyboard.press('ArrowRight');
  w = await where(); assert.deepStrictEqual([w.code, w.visible, w.onTop, w.bottomRight, w.inFullscreen], [code, true, true, true, true], 'shown in fullscreen');
  // an image enlarged in fullscreen: the code stays on top of the viewer
  for (let i = 0; i < 150 && !(await p.$('#pres-stage .slide-img:not(.img-broken) .pz-zoom')); i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(350);
  await p.click('#pres-stage .slide-img .pz-zoom'); await p.waitForSelector('.lightbox');
  w = await where(); assert.deepStrictEqual([w.code, w.visible, w.onTop], [code, true, true], 'over the image viewer');
  await p.click('.lightbox .lb-close');
  await p.keyboard.press('f');
  await p.waitForFunction(function () { return !document.fullscreenElement; });
  await p.waitForTimeout(400);
  w = await where(); assert.deepStrictEqual([w.code, w.visible, w.onTop, w.bottomRight], [code, true, true, true], 'after leaving fullscreen');
  // slide-edit mode and back
  await p.click('.pres-toolbar button:has-text("Edit slides")'); await p.click('.pres-toolbar button:has-text("Editing slides")');
  // time passes (several checks), and the connection drops for a while: the code never disappears or changes
  await p.waitForTimeout(17000);
  const offline = function (r) { return r.abort(); };
  await p.route('https://script.google.com/**', offline);
  await p.evaluate(function () { return window.__presAttendance.poll(); });
  w = await where(); assert.strictEqual(w && w.code, code, 'kept while offline');
  await p.unroute('https://script.google.com/**', offline);   // only the outage, not the test backend
  await p.evaluate(function () { return window.__presAttendance.poll(); });
  assert.strictEqual(A('tsState', { tsId: L.session.tsId }).code, code, 'the server code is unchanged');
  assert.strictEqual(A('tsState', { tsId: L.session.tsId }).session.status, 'live', 'still open');
  // the presentation only ever READ the code: it never started, changed or closed an attendance session
  assert.ok(calls.some(function (c) { return c.action === 'listAttendanceSessions'; }));
  assert.deepStrictEqual(calls.filter(function (c) { return /^(startAttendanceSession|closeAttendanceSession|regenerateAttendanceCode|deleteAttendanceSession|tsStart|tsClose|tsSave|tsCancel|tsDelete|tsMark)$/.test(String(c.action)); }).map(function (c) { return c.action; }), []);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'present-attendance.png') });
  // a student of the group, in the same module's Presentation Mode: no code, no teacher request
  const sp = await realPage(M, []);
  const scalls = [];
  sp.on('request', function (r) { if (/script\.google\.com/.test(r.url())) { try { scalls.push(JSON.parse(r.postData() || '{}').action); } catch (e) { } } });
  await sp.goto(HOME + '?g=tr-a');
  await signIn(sp, 'ahmed', PW);
  await sp.waitForSelector('.mod[data-id="' + M[0] + '"] .go'); await sp.click('.mod[data-id="' + M[0] + '"] .go');
  await sp.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
  await sp.evaluate(function () { location.hash = '#/present/slide/1'; });
  await sp.waitForSelector('#pres-stage .slide'); await sp.waitForTimeout(2500);
  assert.ok(!(await sp.$('.pres-att')), 'students do not see the code on the slides');
  assert.ok(scalls.indexOf('listAttendanceSessions') < 0);
  await sp.context().close();
  // only the teacher closes attendance (Teacher Dashboard → Close attendance) → the code leaves the slide
  const c = A('tsClose', { tsId: L.session.tsId }); assert.ok(c.ok, JSON.stringify(c));
  await p.waitForFunction(function () { return !document.querySelector('.pres-att'); }, null, { timeout: 15000 });
  await p.keyboard.press('ArrowRight');
  assert.ok(!(await p.$('.pres-att')), 'gone after the teacher closed attendance');
  await p.context().close();
});

test('Teacher Dashboard: compact cards first; each card opens its full management view; Back / browser Back / deep links; typed input is kept and unsaved changes are protected; a personal teacher gets four cards', { skip: SKIP }, async function () {
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === 'cellinjury'; })[0];
  const p = await page();
  p.removeAllListeners('dialog');
  let answer = true; const dialogs = [];
  p.on('dialog', function (dl) { dialogs.push(dl.type() + ': ' + dl.message()); if (answer) dl.accept(); else dl.dismiss(); });
  await p.goto(url + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('.dash-grid .dash-card');
  // only the six cards are on screen — no management form or table
  assert.deepStrictEqual(await p.$$eval('.dash-card', function (c) { return c.map(function (x) { return x.dataset.view + '|' + x.querySelector('.dc-t').textContent; }); }),
    ['modules|Teaching Modules', 'sessions|Teaching Sessions', 'attendance|Student Attendance', 'exams|Official Exams', 'manage|Teacher Management', 'directory|Platform Directory']);
  assert.strictEqual(await p.$$eval('.dash-view', function (v) { return v.filter(function (x) { return !x.hidden; }).length; }), 0);
  for (const sel of ['#t-modules', '#t-sessions', '#t-att', '#t-exams', '#t-manage', '#t-dir', 'form.ts-form', '.modrow', 'table']) assert.ok(!(await p.isVisible(sel)), sel + ' hidden on the dashboard');
  // summaries from the data the sections already loaded
  await p.waitForFunction(function () { return /module/.test(document.querySelector('.dash-card[data-view=modules] .dc-sum').textContent) && /module card/.test(document.querySelector('.dash-card[data-view=manage] .dc-sum').textContent) && /exam place|No exam/.test(document.querySelector('.dash-card[data-view=exams] .dc-sum').textContent); });
  assert.match(await p.textContent('.dash-card[data-view=modules] .dc-sum'), /^\d+ modules? · \d+ open to students$/);
  // every card opens its view (address #/teacher/<view>), with Back to Dashboard
  const expect = { modules: '#t-modules .mod .t-open', sessions: '#t-sessions .ts-top select', attendance: '#t-att .ts-top select', exams: '#t-exams .ex-row', manage: '#t-manage .modrow', directory: '#t-dir .dir-tabs' };
  for (const v of Object.keys(expect)) {
    await p.click('.dash-card[data-view=' + v + ']');
    await p.waitForSelector(expect[v], { state: 'visible', timeout: 15000 });
    assert.strictEqual(new URL(p.url()).hash, '#/teacher/' + v);
    assert.deepStrictEqual(await p.$$eval('.dash-view', function (x) { return x.filter(function (e) { return !e.hidden; }).map(function (e) { return e.dataset.view; }); }), [v]);
    assert.ok(!(await p.isVisible('.dash-grid')));
    assert.ok(await p.isVisible('.dash-view[data-view=' + v + '] .dv-back'));
    await p.click('.dash-view[data-view=' + v + '] .dv-back');
    await p.waitForSelector('.dash-grid', { state: 'visible' });
    assert.strictEqual(new URL(p.url()).hash, '#/teacher');
  }
  // the directory keeps every tab
  await dash(p, 'directory');
  assert.deepStrictEqual(await p.$$eval('#t-dir .dir-tab', function (b) { return b.map(function (x) { return x.textContent; }); }), ['Institutions', 'Groups', 'Modules', 'Deliveries', 'Students', 'Teachers', 'Content', 'Results & attendance', 'Existing data']);
  // browser Back returns to the cards; a deep link (reload) opens the view directly
  await p.goBack(); await p.waitForSelector('.dash-grid', { state: 'visible' });
  await p.goto(url + '#/teacher/exams'); await p.waitForSelector('#t-exams .ex-row', { state: 'visible' });
  await p.goto(url + '#/teacher/nonsense'); await p.waitForSelector('.dash-grid', { state: 'visible' });
  // the attendance view: group, the by-student table with its totals and CSV, and the all-modules report
  A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Dash lecture', startAt: Date.now() } });
  const live = main.ctx.dirAll_('TeachingSessions').filter(function (x) { return x.title === 'Dash lecture'; })[0];
  A('tsClose', { tsId: live.tsId });
  await p.reload(); await p.waitForSelector('.dash-grid .dash-card');
  await dash(p, 'attendance');
  await p.selectOption('#t-att .ts-top select', g.groupId);
  await p.waitForSelector('#t-att .ts-block:has(h3:text("by student")) table');
  assert.deepStrictEqual(await p.$$eval('#t-att .ts-block:has(h3:text("by student")) th', function (x) { return x.map(function (e) { return e.textContent; }); }), ['Student ID', 'Name', 'Attended', 'Late', 'Excused', 'Absent', 'Attendance']);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#t-att .ts-block:has(h3:text("by student")) [data-a=csv]')]);
  assert.strictEqual(dl.suggestedFilename(), 'attendance-by-student-tr-a.csv');
  await p.click('#t-att [data-a=rep]'); await p.waitForSelector('#t-report:not([hidden])');
  // the sessions view follows the same group, and the card shows it
  await p.click('.dash-view[data-view=attendance] .dv-back');
  await p.waitForFunction(function () { return /Group A/.test(document.querySelector('.dash-card[data-view=sessions] .dc-sum').textContent); });
  assert.match(await p.textContent('.dash-card[data-view=attendance] .dc-sum'), /student/);
  // unsaved changes: typing in Teacher Management is kept while moving between views, the card warns, leaving asks first
  await dash(p, 'manage');
  await p.fill('#t-manage .modrow:first-child [data-k=title]', 'Cell Injury — renamed (unsaved)');
  await p.click('.dash-view[data-view=manage] .dv-back');
  await p.waitForSelector('.dash-card[data-view=manage].dirty');
  assert.match(await p.textContent('.dash-card[data-view=manage]'), /Unsaved changes/);
  await dash(p, 'sessions'); await p.click('.dash-view[data-view=sessions] .dv-back');
  await dash(p, 'manage');
  assert.strictEqual(await p.inputValue('#t-manage .modrow:first-child [data-k=title]'), 'Cell Injury — renamed (unsaved)', 'still there');
  answer = false;   // "Platform Home" → asked → stay
  await p.click('.top a.tportal');
  await p.waitForFunction(function () { return /^#\/teacher/.test(location.hash); });
  assert.match(dialogs[dialogs.length - 1], /^confirm: You have unsaved changes \(Teacher Management\)/);
  assert.strictEqual(await p.inputValue('#t-manage .modrow:first-child [data-k=title]'), 'Cell Injury — renamed (unsaved)');
  // a typed directory form also counts; saving clears the warning
  await p.click('.dash-view[data-view=manage] .dv-back');
  await dash(p, 'directory');
  await p.fill('#t-dir .dir-pane form [data-k=name]', 'Half-typed university');
  await p.click('.dash-view[data-view=directory] .dv-back');
  await p.waitForSelector('.dash-card[data-view=directory].dirty');
  await dash(p, 'directory'); await p.fill('#t-dir .dir-pane form [data-k=name]', ''); 
  await p.fill('#t-dir .dir-pane form [data-k=name]', 'Dash University'); await p.click('#t-dir .dir-pane form button[type=submit]');
  await p.waitForFunction(function () { return /Dash University/.test(document.querySelector('#t-dir .dir-list').textContent); });
  await p.click('.dash-view[data-view=directory] .dv-back'); await p.waitForSelector('.dash-grid', { state: 'visible' });
  assert.ok(!(await p.$('.dash-card[data-view=directory].dirty')), 'saved → no warning');
  await dash(p, 'manage');
  await p.fill('#t-manage .modrow:first-child [data-k=title]', 'Cell Injury & Cell Death');
  await p.click('#t-manage .save'); await p.waitForSelector('.toast:has-text("Saved")');
  await p.click('.dash-view[data-view=manage] .dv-back'); await p.waitForSelector('.dash-grid', { state: 'visible' });
  assert.ok(!(await p.$('.dash-card.dirty')), 'everything saved');
  // signing out with nothing unsaved asks nothing
  const before = dialogs.length; answer = true;
  await p.click('#who button:has-text("Sign out")'); await p.waitForSelector('.hero h1, #t-p');
  assert.strictEqual(dialogs.length, before);
  // keyboard: the cards are links in tab order
  await p.goto(url + '#/teacher'); await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await p.waitForSelector('.dash-card');
  await p.focus('.dash-card[data-view=exams]'); await p.keyboard.press('Enter');
  await p.waitForSelector('#t-exams .ex-row', { state: 'visible' });
  assert.strictEqual(await p.evaluate(function () { return document.activeElement && document.activeElement.id; }), 'dv-h-exams', 'focus moves to the view title');
  await p.context().close();
  // a personal teacher: four cards (no Teacher Management / Platform Directory)
  const un = 'dash.teacher', cr = A('teacherSave', { create: true, record: { username: un, name: 'Dr. Dash', password: 'dash-teacher-1' } }); assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(A('teacherAssign', { userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'dash-teacher-1' });
  main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'dash-teacher-1', newPassword: 'dash-teacher-2' });
  const q = await page();
  await q.goto(url + '#/teacher');
  await q.fill('#t-u', un); await q.fill('#t-p', 'dash-teacher-2'); await q.click('form.card button[type=submit]');
  await q.waitForSelector('.dash-card');
  assert.deepStrictEqual(await q.$$eval('.dash-card', function (c) { return c.map(function (x) { return x.dataset.view; }); }), ['modules', 'sessions', 'attendance', 'exams']);
  await q.waitForFunction(function () { return /1 module in 1 group/.test(document.querySelector('.dash-card[data-view=modules] .dc-sum').textContent); });
  await dash(q, 'modules'); await q.waitForSelector('#t-mine .mod[data-id="cellinjury"] .t-open', { state: 'visible' });
  await q.click('.dash-view[data-view=modules] .dv-back');
  await dash(q, 'attendance'); await q.waitForSelector('#t-att .ts-top select', { state: 'visible' });
  await q.click('#t-att [data-a=rep]'); await q.waitForSelector('#t-report:not([hidden])');
  await q.click('.dash-view[data-view=attendance] .dv-back');
  await q.click('.dash-tools [data-a=pw]'); await q.waitForSelector('#t-pwbox form #tp-o', { state: 'visible' });
  await q.click('#t-pwbox [data-a=cancel]'); assert.ok(!(await q.$('#t-pwbox form')));
  await q.context().close();
  main.call({ module: 'portal', action: 'teacherSetActive', token: t, userId: cr.teacher.userId, active: false });
});

test('Presentation Mode attendance code — the Admin opens the module from Teaching Modules (no group) and still sees the code of the group lecture opened in Teaching Sessions', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === M[0]; })[0];
  (A('tsList', { groupId: g.groupId }).sessions || []).filter(function (x) { return x.status === 'live'; }).forEach(function (x) { A('tsClose', { tsId: x.tsId }); });
  const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Admin lecture', startAt: Date.now() } }); assert.ok(L.ok, JSON.stringify(L));
  const calls = [];
  const p = await realPage(M, calls);
  await p.goto(HOME + '#/teacher');
  await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'modules');
  await p.click('#t-modules .mod[data-id="' + M[0] + '"] .t-open');   // "All students (no group)"
  await p.waitForURL(new RegExp(M[1]));
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  assert.strictEqual(await p.evaluate(function () { return window.NEO_BOOT.module; }), M[0], 'the main page, not the group storage');
  await p.evaluate(function () { location.hash = '#/present/slide/1'; });
  await p.waitForSelector('#pres-stage .slide');
  await p.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, L.code, { timeout: 15000 });
  assert.match(await p.textContent('.pres-att'), new RegExp('Attendance Code:\\s*' + L.code));
  for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight');
  assert.strictEqual(await p.textContent('.pres-att .pa-c'), L.code);
  assert.ok(calls.some(function (c) { return c.action === 'tsPresentCodes' && c.storage === M[0]; }));
  assert.ok(A('tsClose', { tsId: L.session.tsId }).ok);
  await p.waitForFunction(function () { return !document.querySelector('.pres-att'); }, null, { timeout: 15000 });
  await p.context().close();
});

/* Slide emphasis: the slides use slide-only copies of the key points / must-know items with **key words** (and *scientific names*);
   the learning-mode key points stay unchanged, nothing shows as literal markup, no bullet is bold from end to end. */
test('Presentation Mode: key words in bold (scientific names in italics) on the slides only — learning mode unchanged, no literal markup, no whole-bullet bold', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const i = await p.evaluate(function () { return Views.present.list().findIndex(function (s) { return s.title === 'Wet Gangrene & Gas Gangrene'; }); });
  assert.ok(i >= 0, 'the Wet Gangrene slide');
  await p.evaluate(function (n) { location.hash = '#/present/slide/' + n; }, i + 1);
  await p.waitForFunction(function () { const h = document.querySelector('#pres-stage .slide h2'); return h && h.textContent === 'Wet Gangrene & Gas Gangrene'; });
  const s = await p.evaluate(function () {
    const b = document.querySelector('#pres-stage .slide .body');
    return { strong: [].map.call(b.querySelectorAll('li strong'), function (x) { return x.textContent; }), em: [].map.call(b.querySelectorAll('li em'), function (x) { return x.textContent; }),
      text: b.textContent, html: b.innerHTML, li: [].map.call(b.querySelectorAll('li'), function (li) { return { t: li.textContent, b: [].map.call(li.querySelectorAll('strong'), function (x) { return x.textContent; }).join('') }; }),
      teal: getComputedStyle(b.querySelector('li'), '::marker').color, weight: getComputedStyle(b.querySelector('li strong')).fontWeight };
  });
  assert.deepStrictEqual(s.strong.slice(0, 3), ['Wet gangrene', 'moist organs', 'venous obstruction']);
  assert.deepStrictEqual(s.em, ['Clostridium perfringens'], 'the scientific name in italics, not bold');
  assert.ok(s.li.every(function (l) { return l.b.replace(/\s/g, '') !== l.t.replace(/\s/g, ''); }), 'no bullet is bold from end to end');
  assert.ok(!/\*|<strong>|&lt;/.test(s.text) && !/<strong><strong>|<strong><em>|<em><strong>/.test(s.html), 'no literal markup, no nested bold/italic');
  assert.strictEqual(s.text.replace(/\s+/g, ' ').trim().indexOf('Wet gangrene: moist organs (bowel); commonly venous obstruction'), 0, 'the words themselves are unchanged');
  // learning mode keeps its plain key points; the slide copies only add ** / *
  const d = await p.evaluate(function () {
    let n = 0, bad = 0, plainStars = 0;
    DATA.topics.forEach(function (t) { [[t.mustKnow, t.slideMustKnow]].concat((t.sections || []).map(function (sc) { return [sc.keyPoints, sc.slideKeyPoints]; })).forEach(function (pair) {
      (pair[0] || []).forEach(function (k, j) { if (/\*/.test(k)) plainStars++; const e = pair[1] && pair[1][j]; if (typeof e === 'string') { n++; if (e.replace(/\*/g, '') !== k) bad++; } }); }); });
    return { n: n, bad: bad, plainStars: plainStars };
  });
  assert.ok(d.n > 300, 'slide copies exist (' + d.n + ')'); assert.strictEqual(d.bad, 0); assert.strictEqual(d.plainStars, 0, 'learning-mode key points have no markup');
  // a bullet the teacher edited (no longer identical) is shown as typed, and a teacher's own **bold** still works
  const own = await p.evaluate(function () { return [slideEmph('Wet gangrene: moist organs (bowel).'), mdInline(esc(slideEmph('A **typed** word')))]; });
  assert.deepStrictEqual(own, ['Wet gangrene: moist organs (bowel).', 'A <strong>typed</strong> word']);
  await p.context().close();
});

/* Image insertion in the slide editor (it used to fail: the editor threw before it opened). File types and size are checked,
   a damaged file is refused, the preview shows, size/position are kept, and the picture stays after reopening and a refresh. */
test('Presentation Mode: Edit slide → add an image (file or link) → preview → size/position → save → on the slide → reopen → refresh', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const picker = '.modal-back:last-of-type';
  await p.evaluate(function () { const i = Views.present.list().findIndex(function (s) { return s.type === 'content' && !(s.images || []).length && !s.image; }); location.hash = '#/present/slide/' + (i + 1); });
  await p.waitForTimeout(400);
  const title = await p.textContent('#pres-stage .slide h2');
  async function openEditor() { if (!(await p.$('.pres-edit:not(.hidden)'))) await p.click('.pres-toolbar button:has-text("Edit slides")'); await p.click('.pres-edit button:has-text("Edit this slide")'); await p.waitForSelector('.modal .img-mgr'); }
  await openEditor();
  await p.click('.modal button:has-text("Upload / paste image URL")'); await p.waitForSelector(picker + ' input[type=file]');
  assert.match(await p.getAttribute(picker + ' input[type=file]', 'accept'), /image\/jpeg.*image\/png.*image\/webp/);
  await p.setInputFiles(picker + ' input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await p.waitForFunction(function (s) { const m = document.querySelector(s + ' .msg'); return m && /Unsupported file/.test(m.textContent); }, picker);
  await p.setInputFiles(picker + ' input[type=file]', { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
  await p.waitForFunction(function (s) { const m = document.querySelector(s + ' .msg'); return m && /too large|MB/i.test(m.textContent); }, picker);
  await p.setInputFiles(picker + ' input[type=file]', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
  await p.waitForFunction(function (s) { const m = document.querySelector(s + ' .msg'); return m && /could not be read/.test(m.textContent); }, picker);
  await p.setInputFiles(picker + ' input[type=file]', { name: 'cell.png', mimeType: 'image/png', buffer: Buffer.from(PNG1, 'base64') });
  await p.waitForSelector(picker + ' img[alt="Preview of the chosen image"]');
  assert.strictEqual(await p.$(picker + ' .msg.bad'), null, 'no error once a good file is chosen');
  await p.click(picker + ' button:has-text("Add")');
  await p.waitForFunction(function () { return document.querySelectorAll('.modal .img-mgr .im img').length === 1; }, null, { timeout: 15000 });
  await p.selectOption('.modal .img-mgr .im select[aria-label=Size]', 'l'); await p.selectOption('.modal .img-mgr .im select[aria-label=Position]', 'right');
  await p.click('.modal button:has-text("Upload / paste image URL")'); await p.waitForSelector(picker + ' input[type=url]');
  await p.fill(picker + ' input[type=url]', 'https://drive.google.com/thumbnail?id=e2eUrlImage&sz=w800');
  await p.click(picker + ' button:has-text("Add")');
  await p.waitForFunction(function () { return document.querySelectorAll('.modal .img-mgr .im img').length === 2; });
  await p.click('.modal button:has-text("Save slide")');
  await p.waitForFunction(function () { return !document.querySelector('.modal .img-mgr') && document.querySelectorAll('#pres-stage .slide-img img').length === 2; }, null, { timeout: 15000 });
  async function onSlide() { return p.$$eval('#pres-stage .slide-img', function (x) { return x.map(function (f) { return { cls: f.className, src: f.querySelector('img').getAttribute('src') }; }); }); }
  const saved = await onSlide();
  assert.strictEqual(await p.textContent('#pres-stage .slide h2'), title, 'still the same slide');
  const up = saved.filter(function (x) { return !/e2eUrlImage/.test(x.src); }), byUrl = saved.filter(function (x) { return /e2eUrlImage/.test(x.src); });
  assert.strictEqual(up.length, 1); assert.strictEqual(byUrl.length, 1, 'the image added by link');
  assert.match(up[0].cls, /\bsize-l\b/); assert.match(up[0].cls, /\bfloat-right\b/, 'size and position kept');
  assert.match(up[0].src, /^https:\/\/drive\.google\.com\//, 'the uploaded file is stored on Drive (not inside the deck)');
  await openEditor();
  assert.strictEqual(await p.$$eval('.modal .img-mgr .im img', function (x) { return x.length; }), 2, 'both images in the reopened editor');
  await p.click('.modal button:has-text("Cancel")');
  await p.reload();
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  await p.waitForFunction(function () { return document.querySelectorAll('#pres-stage .slide-img img').length === 2; }, null, { timeout: 15000 });
  assert.deepStrictEqual((await onSlide()).map(function (x) { return x.src; }), saved.map(function (x) { return x.src; }), 'the same pictures after a refresh');
  await p.context().close();
});

/* Flicker: a background sync that only brings back what the page already has (its own saves echoed, or the whole master
   draft re-sent on every check) must not rebuild the page; a real change from elsewhere still appears. */
test('background sync: unchanged content never rebuilds the page (no flicker, scroll/slide kept); a real change still appears', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  await p.evaluate(function () { location.hash = '#/present/slide/4'; });
  await p.waitForTimeout(400);
  // one save from the slide editor's own path, then count every page rebuild from here on
  await p.evaluate(async function () {
    await saveDoc('presentationdeck', 'deck', { slides: getDeckSlides().map(function (x) { return Object.assign({}, x); }) });
    window.__rb = 0; const r0 = window.refreshAllContentViews; window.refreshAllContentViews = function () { window.__rb++; return r0.apply(this, arguments); };
    const st = document.getElementById('pres-stage'); window.__sr = 0;
    new MutationObserver(function (ms) { if (ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n.classList && n.classList.contains('slide'); }); })) window.__sr++; }).observe(st, { childList: true });
  });
  // the next checks bring back the saved deck (incremental), then everything (a full re-download, as after a publish / in a draft session)
  for (const full of [false, false, true, true]) await p.evaluate(function (f) { return Backend.syncFromBackend({ full: f }); }, full);
  assert.deepStrictEqual(await p.evaluate(function () { return [window.__rb, window.__sr]; }), [0, 0], 'no rebuild, the slide stays still');
  assert.match(p.url(), /#\/present\/slide\/4$/);
  // a real change made elsewhere (another device) still reaches the open page
  const tk = await p.evaluate(function () { return Backend.token(); });
  const d = main.call({ module: REAL[0][0], action: 'getAllContent', since: 0, token: tk }).items.filter(function (x) { return x.collection === 'presentationdeck'; })[0];
  const sl = d.data.slides.slice(); sl[3] = Object.assign({}, sl[3], { title: 'Changed on another device' });
  assert.ok(main.call({ module: REAL[0][0], action: 'upsert', token: tk, collection: 'presentationdeck', id: 'deck', data: { slides: sl } }).ok);
  await p.evaluate(function () { return Backend.syncFromBackend(); });
  await p.waitForFunction(function () { const h = document.querySelector('#pres-stage .slide h2'); return h && h.textContent === 'Changed on another device'; });
  assert.strictEqual(await p.evaluate(function () { return window.__rb; }), 1, 'exactly one rebuild, for the real change');
  await p.context().close();
});

test('no JavaScript errors', { skip: SKIP }, function () { assert.deepStrictEqual(errors, []); });
