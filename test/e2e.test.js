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
  // opening again ALWAYS asks for a fresh pass (2026-10-17): a saved pass the server had ended showed the student sign-in
  await p.goto(url + '#/teacher'); await dash(p, 'modules'); await p.waitForSelector('#t-mine .mod[data-id="cellinjury"] .t-open');
  // an OLD server address saved in this browser (an earlier deployment) is dropped, so the module uses its own server
  await p.evaluate(function () { localStorage.setItem('ci_tr-a_backend_url_v1', JSON.stringify('https://script.google.com/macros/s/OLD-DEPLOYMENT/exec')); });
  await p.click('#t-mine .mod[data-id="cellinjury"] .t-open'); await p.waitForTimeout(400);
  assert.strictEqual(await p.evaluate(function () { return localStorage.getItem('ci_tr-a_backend_url_v1'); }), null, 'old saved address removed');
  const tok2 = JSON.parse(await p.evaluate(function () { return localStorage.getItem('ci_tr-a_backend_token_v1'); })).token;
  assert.notStrictEqual(tok2, tok, 'a new pass, not the saved one');
  assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'studentSession', token: tok2 }).role, 'teacher');
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
// Inflammation & Healing — Condensed (2026-10-18): its own repository, module key and content key (IC_CONTENT_KEY, env only).
const IC = ['inflcondensed', 'third-year-med-inflammation-condensed', process.env.IC_MODULE_HTML || '/home/user/third-year-med-inflammation-condensed/index.html', process.env.IC_CONTENT_KEY];
// Cell Injury & Cell Death — Condensed (2026-10-18): its own repository, module key and content key (CC_CONTENT_KEY, env only).
const CC = ['cellcondensed', 'cell-injury-condensed', process.env.CC_MODULE_HTML || '/home/user/cell-injury-condensed/index.html', process.env.CC_CONTENT_KEY];
// Neoplasia (2026-10-19): a NEW module built condensed from the start (module key neoplasm, prefix nm_, NM_CONTENT_KEY, env only).
const NM = ['neoplasm', 'neoplasia', process.env.NM_MODULE_HTML || '/home/user/neoplasia/index.html', process.env.NM_CONTENT_KEY];
// Genetics and Pediatric Diseases (2026-10-23): a NEW condensed module (module key genetics, prefix gen_, GEN_CONTENT_KEY, env only).
const GEN = ['genetics', 'genetics', process.env.GEN_MODULE_HTML || '/home/user/genetics/index.html', process.env.GEN_CONTENT_KEY];
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
    const own = REAL.concat([IC, CC, NM, GEN]).filter(function (R) { return u.pathname.indexOf('/' + R[1] + '/') === 0; })[0];
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
    assert.match(await p.textContent(card + ' .loc-g tr:has-text("loc-add")'), /Copied to the master draft — removed automatically when you publish/);
    assert.match(await p.textContent(card + ' .loc-g tr:has-text("draft-test") button[data-op=rm]'), /Show it again/);
    await p.click(card + ' .loc-g tr:has-text("draft-test") button[data-op=rm]');
    await p.waitForFunction(function () { return /gets the master version/.test((document.querySelector('.toast') || {}).textContent || ''); });
    assert.ok(has('draft-test'), 'the group sees the master topic again');
    // publishing the draft removes the group's copied item: the group now follows the master
    const pubR = main.call({ module: 'portal', action: 'contentPublish', token: t, moduleId: M[0], notes: 'e2e copy' });
    assert.ok(pubR.ok, JSON.stringify(pubR)); assert.strictEqual(pubR.localRemoved.length, 1);
    await p.waitForSelector(card + ' [data-a=loc]'); await p.click(card + ' [data-a=loc]');
    await p.waitForFunction(function (c) { const r = document.querySelector(c + ' .report'); return r && !/Loading/.test(r.textContent); }, card);
    assert.strictEqual(await p.$(card + ' .loc-g tr:has-text("loc-add")'), null, 'no longer a local copy');
    assert.ok(has('loc-add'), 'the group still has it — now from the master');
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
  await dash(p, 'overall');
  await p.click('#t-overall ~ .rep-block [data-a=rep]');
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
    // 👁 Review in the picker opens a second dialog with the whole question (the tick box is untouched)
    await p.click('.modal .qlist .qitem button.qrev-btn');
    await p.waitForSelector('.modal h2:has-text("Review question")');
    assert.match(await p.textContent('.modal-bg:last-child .modal'), /‹ Previous[\s\S]*Next ›/);
    await p.click('.modal-bg:last-child .modal button[aria-label=Close]');
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
  // 👁 Review (beside Edit): the whole question with its accepted answers; "Select this question" ticks the row's box
  await p.waitForSelector('table.t tbody tr button.qrev-btn');
  const rowRev = p.locator('table.t tbody tr', { hasText: 'What is the diagnosis?' }).first();
  assert.deepStrictEqual(await rowRev.locator('td:last-child button').allTextContents(), ['👁 Review', 'Edit'], 'Review sits beside Edit');
  await rowRev.locator('button.qrev-btn').click();
  await p.waitForSelector('.modal h2:has-text("Review question")');
  const revTxt = await p.textContent('.modal');
  assert.match(revTxt, /What is the diagnosis\?[\s\S]*Accepted answers[\s\S]*granuloma  \|  granulomatous inflammation/);
  assert.ok(await p.$('.modal img.qrev-img'), 'the picture is shown in full');
  await p.click('.modal button:has-text("Select this question")');
  assert.ok(await rowRev.locator('input[type=checkbox]').isChecked(), 'selected from the review');
  assert.match(await p.textContent('.modal'), /Selected — click to unselect/);
  await p.click('.modal button:has-text("Selected — click to unselect")');
  assert.ok(!(await rowRev.locator('input[type=checkbox]').isChecked()));
  await p.click('.modal button[aria-label=Close]');
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
  // the platform does not answer for a moment → the saved register stays with a "retrying" note; then live again
  let tsDown = true;
  await p.route('https://script.google.com/**', function (route) { return tsDown ? route.abort() : route.fallback(); });
  await p.waitForSelector('#t-sessions .ts-net', { timeout: 15000 });
  assert.match(await p.textContent('#t-sessions .ts-reg'), /Student Ahmed[\s\S]*Present/);
  assert.ok(await p.$('#t-sessions .ts-code'), 'the live screen stays open');
  tsDown = false;
  await p.waitForFunction(function () { return !document.querySelector('#t-sessions .ts-net') && document.querySelector('#t-sessions .ts-code'); }, null, { timeout: 15000 });
  // close attendance → the register stays open; nobody is "Not yet" any more
  await p.click('#t-sessions [data-a=close]');
  await p.waitForFunction(function () { var s = document.querySelector('#t-sessions .ts-screen'); return s && !document.querySelector('#t-sessions .ts-code') && /Register \(CSV\)/.test(s.textContent); });
  assert.ok(!/Not yet/.test(await p.textContent('#t-sessions .ts-reg')));
  const hist = await p.textContent('#t-sessions .ts-block:has(h3:text("history"))');
  assert.match(hist, /Lecture 1 — Cell adaptation[\s\S]*✅ 1/);
  // 2.15: no by-student table under Teaching Sessions any more (it is the Overall Pathology Attendance view)
  assert.ok(!(await p.$('#t-sessions .ts-block:has(h3:text("by student"))')));
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
  await p.waitForSelector('#t-sessions .ts-block:has(h3:text("history")) .dir-row:has-text("Real lecture — keep")', { state: 'visible', timeout: 10000 });   // the history is redrawn after the delete
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
  assert.strictEqual(await p.$('#ts-stu [data-a=r]'), null, 'no Refresh button');
  await p.waitForTimeout(3200);
  await p.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); });   // the student comes back to the tab → it updates itself
  await p.waitForFunction(function () { return /My attendance[\s\S]*100%/.test(document.querySelector('#ts-stu').textContent) && !document.querySelector('#ts-stu .ts-now'); });
  await p.context().close();
});

test('group Live Classroom switched off (2026-10-15): no button for students or teachers; an old #/live link opens the group page', { skip: SKIP }, async function () {
  groupFixture();
  const s = await page({ width: 390, height: 844 });
  await s.goto(url + '?g=tr-a');
  await signIn(s, 'ahmed', PW);
  await s.waitForSelector('#ts-stu:not([hidden]) .ts-att-card');
  assert.strictEqual(await s.$('#ts-stu [data-a=live]'), null, 'no Live Classroom button on the group page');
  assert.ok(!/Live Classroom/.test(await s.textContent('main')));
  await s.evaluate(function () { location.hash = '#/live'; });
  await s.waitForFunction(function () { return location.hash === '#/' && document.querySelector('.grid.compact'); });
  assert.strictEqual(await s.$('.lc'), null, 'the classroom is not opened');
  await s.context().close();
  const tp = await page();
  await tp.goto(url + '#/teacher'); await tp.fill('#t-p', TPW); await tp.click('form.card button[type=submit]');
  await dash(tp, 'sessions');
  await tp.waitForSelector('#t-sessions [data-a=now]');
  assert.strictEqual(await tp.$('#t-sessions [data-a=live]'), null, 'no Group Live Classroom button for the teacher');
  await tp.context().close();
});

test('Group Live Classroom: a student (group page) and the teacher (dashboard) chat in ONE classroom — message, announcement, reply, reaction, file, picture, lecture banner', { skip: SKIP || 'group Live Classroom switched off on the front page (GROUP_CLASSROOM = false in portal.js)' }, async function () {
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
  assert.doesNotMatch(await s.textContent('.lc-msgs'), /Lecture started/, 'no "Lecture started" announcement (2.14) — the banner above shows the live lecture');
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
  // closing the lecture posts no announcement either (2.14); back returns to the group page
  A('tsClose', { tsId: L.session.tsId });
  await s.waitForTimeout(7000);   // several classroom checks
  assert.doesNotMatch(await s.textContent('.lc-msgs'), /Lecture ended|Lecture started/);
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

test('Teacher Dashboard: compact cards first; each card opens its full management view; Back / browser Back / deep links; typed input is kept and unsaved changes are protected; a personal teacher gets six cards', { skip: SKIP }, async function () {
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
    ['modules|Teaching Modules', 'sessions|Teaching Sessions', 'overall|Overall Pathology Attendance', 'results|Pathology Overall Results & Analytics', 'annual|Annual Assessment (30)', 'exams|Official Exams', 'manage|Teacher Management', 'directory|Platform Directory']);
  assert.strictEqual(await p.$$eval('.dash-view', function (v) { return v.filter(function (x) { return !x.hidden; }).length; }), 0);
  for (const sel of ['#t-modules', '#t-sessions', '#t-overall', '#t-exams', '#t-manage', '#t-dir', 'form.ts-form', '.modrow', 'table']) assert.ok(!(await p.isVisible(sel)), sel + ' hidden on the dashboard');
  // summaries from the data the sections already loaded
  await p.waitForFunction(function () { return /module/.test(document.querySelector('.dash-card[data-view=modules] .dc-sum').textContent) && /module card/.test(document.querySelector('.dash-card[data-view=manage] .dc-sum').textContent) && /exam place|No exam/.test(document.querySelector('.dash-card[data-view=exams] .dc-sum').textContent); });
  assert.match(await p.textContent('.dash-card[data-view=modules] .dc-sum'), /^\d+ modules? · \d+ open to students$/);
  // every card opens its view (address #/teacher/<view>), with Back to Dashboard
  const expect = { modules: '#t-modules .mod .t-open', sessions: '#t-sessions .ts-top select', overall: '#t-overall .ts-top select', exams: '#t-exams .ex-row', manage: '#t-manage .modrow', directory: '#t-dir .dir-tabs' };
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
  // 2.15: Student Attendance is replaced by Overall Pathology Attendance; an old bookmark opens it; Results & attendance moved there
  A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Dash lecture', startAt: Date.now() } });
  const live = main.ctx.dirAll_('TeachingSessions').filter(function (x) { return x.title === 'Dash lecture'; })[0];
  A('tsClose', { tsId: live.tsId });
  await p.goto(url + '#/teacher/attendance'); await p.reload();
  await p.waitForSelector('#t-overall .ts-top select', { state: 'visible' });
  assert.strictEqual(new URL(p.url()).hash, '#/teacher/overall');
  await p.selectOption('#t-overall .ts-top select', g.groupId);
  await p.waitForSelector('#t-overall .ov-tbl tbody tr[data-student]');
  await p.click('.dash-view[data-view=overall] [data-a=rep]'); await p.waitForSelector('#t-report:not([hidden])');
  await p.click('.dash-view[data-view=overall] .dv-back');
  await p.waitForFunction(function () { return /Group A/.test(document.querySelector('.dash-card[data-view=sessions] .dc-sum').textContent); });
  assert.match(await p.textContent('.dash-card[data-view=overall] .dc-sum'), /student/);
  await dash(p, 'sessions');
  await p.waitForSelector('#t-sessions .ts-block:has(h3:text("history"))');
  assert.ok(!(await p.$('#t-sessions .ts-block:has(h3:text("by student"))')), 'no Teaching-Sessions-only table any more');
  await p.click('.dash-view[data-view=sessions] .dv-back');
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
  // a personal teacher: five cards (no Teacher Management / Platform Directory)
  const un = 'dash.teacher', cr = A('teacherSave', { create: true, record: { username: un, name: 'Dr. Dash', password: 'dash-teacher-1' } }); assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok(A('teacherAssign', { userId: cr.teacher.userId, deliveryIds: [d.deliveryId] }).ok);
  const lg = main.call({ module: 'portal', action: 'teacherLogin', username: un, password: 'dash-teacher-1' });
  main.call({ module: 'portal', action: 'teacherChangePassword', ttoken: lg.ttoken, oldPassword: 'dash-teacher-1', newPassword: 'dash-teacher-2' });
  const q = await page();
  await q.goto(url + '#/teacher');
  await q.fill('#t-u', un); await q.fill('#t-p', 'dash-teacher-2'); await q.click('form.card button[type=submit]');
  await q.waitForSelector('.dash-card');
  assert.deepStrictEqual(await q.$$eval('.dash-card', function (c) { return c.map(function (x) { return x.dataset.view; }); }), ['modules', 'sessions', 'overall', 'results', 'annual', 'exams']);
  await q.waitForFunction(function () { return /1 module in 1 group/.test(document.querySelector('.dash-card[data-view=modules] .dc-sum').textContent); });
  await dash(q, 'modules'); await q.waitForSelector('#t-mine .mod[data-id="cellinjury"] .t-open', { state: 'visible' });
  await q.click('.dash-view[data-view=modules] .dv-back');
  await dash(q, 'overall'); await q.waitForSelector('#t-overall .ts-top select', { state: 'visible' });
  await q.click('.dash-view[data-view=overall] [data-a=rep]'); await q.waitForSelector('#t-report:not([hidden])');
  await q.click('.dash-view[data-view=overall] .dv-back');
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

/* The master draft (✏ Edit master draft) is a teacher session of the module's main storage: its Presentation Mode shows the
   codes of the live lectures of the module's groups, like the main page. */
test('Presentation Mode attendance code — inside ✏ Edit master draft (versioned content on) the code of the live group lecture is shown', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.ctx.CONTENT_KEYS[M[0]] = M[3];
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const mig = A('contentMigrate', { moduleId: M[0], decisions: {} }); assert.ok(mig.ok || /already/i.test(mig.error || ''), JSON.stringify(mig));
  assert.ok(A('contentSetMode', { moduleId: M[0], mode: 'on' }).ok);
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === M[0]; })[0];
  (A('tsList', { groupId: g.groupId }).sessions || []).filter(function (x) { return x.status === 'live'; }).forEach(function (x) { A('tsClose', { tsId: x.tsId }); });
  const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Draft lecture', startAt: Date.now() } }); assert.ok(L.ok, JSON.stringify(L));
  try {
    const dr = A('contentEditDraft', { moduleId: M[0] }); assert.ok(dr.ok, JSON.stringify(dr));
    const calls = [], answers = [];
    const p = await realPage(M, calls);
    p.on('response', async function (res) { if (/script\.google\.com/.test(res.url())) { try { const j = await res.json(); answers.push(j); } catch (e) { } } });
    await p.addInitScript(function (a) { localStorage.setItem(a.k, a.v); sessionStorage.setItem('pf_draft:' + a.m, '1'); }, { k: dr.storagePrefix + 'backend_token_v1', v: JSON.stringify({ token: dr.token, expiresAt: dr.expiresAt }), m: M[0] });
    await p.goto('https://third-year-med.github.io/' + M[1] + '/#/present/slide/1');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await p.waitForSelector('#pres-stage .slide');
    try { await p.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, L.code, { timeout: 15000 }); }
    catch (e) {
      const tc = calls.filter(function (c) { return c.action === 'tsPresentCodes' || c.action === 'listAttendanceSessions'; }).map(function (c) { return c.action + ' ' + c.module + ' ' + (c.storage || ''); });
      throw new Error('no attendance code in the draft. requests: ' + JSON.stringify(tc.slice(0, 4)) + ' answers: ' + JSON.stringify(answers.filter(function (a) { return a && ('live' in a || 'sessions' in a || a.code === 'auth' || a.ok === false); }).slice(0, 4)).slice(0, 900));
    }
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
    assert.strictEqual(await p.textContent('.pres-att .pa-c'), L.code, 'stays while changing slides');
    await p.context().close();
  } finally {
    A('tsClose', { tsId: L.session.tsId });
    A('contentDiscardDraft', { moduleId: M[0] });
    A('contentSetMode', { moduleId: M[0], mode: 'off' });
    if (mig.ok) A('contentUndoMigration', { moduleId: M[0] });
  }
});

/* The attendance code must not vanish when one of the two checks behind it fails (a slow or busy Apps Script): each source
   counts on its own; with no answer at all the teacher sees a short "retrying" notice instead of nothing. */
test('Presentation Mode attendance code — still shown when one server check fails; a "retrying" notice when none answers; back when the server answers', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { return main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); };
  const dir = A('dirGet'), g = dir.groups.filter(function (x) { return x.linkCode === 'tr-a'; })[0];
  const d = dir.deliveries.filter(function (x) { return x.groupId === g.groupId && x.moduleId === M[0]; })[0];
  (A('tsList', { groupId: g.groupId }).sessions || []).filter(function (x) { return x.status === 'live'; }).forEach(function (x) { A('tsClose', { tsId: x.tsId }); });
  const L = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: 'Busy-server lecture', startAt: Date.now() } }); assert.ok(L.ok, JSON.stringify(L));
  try {
    const p = await presentPage(M);   // the module's main page as teacher: the group lecture comes from the platform check
    const fail = { own: true, platform: false };
    await p.route('https://script.google.com/**', async function (route) {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) { }
      if ((fail.own && b.action === 'listAttendanceSessions') || (fail.platform && b.action === 'tsPresentCodes')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Service invoked too many times for one day: urlfetch.' }) });
      return route.fallback();
    });
    await p.evaluate(function () { return window.__presAttendance.poll(); });
    await p.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, L.code, { timeout: 20000 });
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
    assert.strictEqual(await p.textContent('.pres-att .pa-c'), L.code, 'shown although the module\'s own check failed');
    // nothing answers: the last code stays (it is still open on the server)
    fail.platform = true;
    await p.evaluate(function () { return window.__presAttendance.poll(); });
    assert.strictEqual(await p.textContent('.pres-att .pa-c'), L.code, 'the last code stays while the server does not answer');
    await p.context().close();
    // a page that never got an answer: a short "retrying" notice instead of nothing, then the code when the server answers
    main.ctx.CONTENT_KEYS[M[0]] = M[3];
    const open = async function (fails) {   // a page whose checks fail from the very first one
      const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]];
      const pg = await realPage(M, []);
      await pg.route('https://script.google.com/**', async function (route) {
        let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) { }
        if (fails[b.action]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'timeout' }) });
        return route.fallback();
      });
      await pg.addInitScript(function (v) { localStorage.setItem('ci_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
      await pg.goto('https://third-year-med.github.io/' + M[1] + '/#/present/slide/2');
      await pg.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
      return pg;
    };
    // the module's own check fails from the start, the Teaching Sessions check answers → the code is shown (before: never)
    const p1 = await open({ listAttendanceSessions: true });
    await p1.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, L.code, { timeout: 20000 });
    await p1.context().close();
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]];
    const p2 = await realPage(M, []);
    const f2 = { on: true };
    await p2.route('https://script.google.com/**', async function (route) {   // failing from the very first check
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) { }
      if (f2.on && (b.action === 'listAttendanceSessions' || b.action === 'tsPresentCodes')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'timeout' }) });
      return route.fallback();
    });
    await p2.addInitScript(function (v) { localStorage.setItem('ci_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await p2.goto('https://third-year-med.github.io/' + M[1] + '/#/present/slide/2');
    await p2.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await p2.waitForFunction(function () { const e = document.querySelector('.pres-att'); return e && /can.t reach the class server/.test(e.textContent); }, null, { timeout: 30000 });
    f2.on = false;
    await p2.waitForFunction(function (c) { const e = document.querySelector('.pres-att .pa-c'); return e && e.textContent === c; }, L.code, { timeout: 20000 });
    await p2.context().close();
  } finally { A('tsClose', { tsId: L.session.tsId }); }
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

/* A picture a teacher adds to a slide in Group A (versioned content on) reaches the students of Group A. */
test('Group A: a teacher adds a picture to a slide (versioned content on) → a Group A student sees it on the same slide', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.ctx.CONTENT_KEYS[M[0]] = M[3];
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const mig = main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} });   // an earlier test may already have made the master copy
  assert.ok(mig.ok || /already/i.test(mig.error || ''), JSON.stringify(mig));
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
  try {
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [{ module: M[0], group: 'tr-a' }] }).modules[M[0] + '-tr-a'];
    const tp = await realPage(M, []);
    await tp.addInitScript(function (v) { localStorage.setItem('ci_tr-a_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await tp.goto('https://third-year-med.github.io/' + M[1] + '/?g=tr-a#/present/slide/1');
    await tp.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    assert.strictEqual(await tp.evaluate(function () { return window.NEO_BOOT.module; }), M[0] + '-tr-a');
    const n = await tp.evaluate(function () { return Views.present.list().findIndex(function (s) { return s.type === 'content' && !(s.images || []).length; }) + 1; });
    await tp.evaluate(function (k) { location.hash = '#/present/slide/' + k; }, n); await tp.waitForTimeout(400);
    const title = await tp.textContent('#pres-stage .slide h2');
    if (!(await tp.$('.pres-edit:not(.hidden)'))) await tp.click('.pres-toolbar button:has-text("Edit slides")');
    await tp.click('.pres-edit button:has-text("Edit this slide")'); await tp.waitForSelector('.modal .img-mgr');
    await tp.click('.modal button:has-text("Upload / paste image URL")');
    await tp.setInputFiles('.modal-back:last-of-type input[type=file]', { name: 'incubation.png', mimeType: 'image/png', buffer: Buffer.from(PNG1, 'base64') });
    await tp.waitForSelector('.modal-back:last-of-type img[alt="Preview of the chosen image"]');
    await tp.click('.modal-back:last-of-type button:has-text("Add")');
    await tp.waitForFunction(function () { return document.querySelectorAll('.modal .img-mgr .im img').length === 1; }, null, { timeout: 15000 });
    await tp.click('.modal button:has-text("Save slide")');
    await tp.waitForFunction(function () { return document.querySelectorAll('#pres-stage .slide-img img').length === 1; }, null, { timeout: 15000 });
    const src = await tp.getAttribute('#pres-stage .slide-img img', 'src');
    assert.match(src, /^https:\/\/drive\.google\.com\//, 'uploaded to Drive');
    assert.strictEqual(await tp.evaluate(function () { return Backend.pending().length; }), 0, 'nothing left waiting on the teacher\'s device');
    await tp.context().close();
    // the Group A student
    const sp = await realPage(M, []);
    await sp.goto(HOME + '?g=tr-a');
    await sp.waitForSelector('.mod[data-id="' + M[0] + '"]');
    await signIn(sp, 'ahmed', PW);
    await sp.waitForSelector('.mod[data-id="' + M[0] + '"] .go'); await sp.click('.mod[data-id="' + M[0] + '"] .go');
    await sp.waitForURL(new RegExp(M[1]));
    await sp.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    await sp.waitForFunction(function () { return State.deck && State.deck.slides && State.deck.slides.some(function (s) { return (s.images || []).length; }); }, null, { timeout: 15000 });
    await sp.evaluate(function (k) { location.hash = '#/present/slide/' + k; }, n);
    await sp.waitForFunction(function (tl) { const h = document.querySelector('#pres-stage .slide h2'); return h && h.textContent === tl; }, title);
    assert.strictEqual(await sp.getAttribute('#pres-stage .slide-img img', 'src'), src, 'the student sees the same picture on the same slide');
    await sp.context().close();
  } finally {
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
    if (mig.ok) main.call({ module: 'portal', action: 'contentUndoMigration', token: t, moduleId: M[0] });
  }
});

/* Pictures that do not load at the first try: retried without the referrer and through Google's other addresses for a Drive
   file before the slide gives up; a pasted link is checked (and a Drive share link converted) before it is added. */
test('pictures: a refused Drive address falls back to Google\'s other address; a site that blocks embedding loads without the referrer; a pasted web page is refused with a clear message', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const png = Buffer.from(PNG1, 'base64'), seen = [];
  await p.route('https://drive.google.com/thumbnail?id=REFUSED1234*', function (r) { seen.push('thumb'); return r.fulfill({ status: 403, body: '' }); });
  await p.route('https://lh3.googleusercontent.com/**', function (r) { seen.push('lh3'); return r.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  await p.route('https://pics.example.org/**', function (r) {
    const u = r.request().url(), ref = r.request().headers().referer;
    if (/page\.html/.test(u)) return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>a web page</html>' });
    seen.push('pics ' + (ref ? 'with referrer' : 'no referrer'));
    return ref ? r.fulfill({ status: 403, body: '' }) : r.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  // a slide that already holds such pictures (as saved earlier) shows them
  await p.evaluate(async function () {
    await Views.present.mutate(function (sl) { const i = sl.findIndex(function (s) { return s.type === 'content'; }); sl[i] = Object.assign({}, sl[i], { images: [{ url: 'https://drive.google.com/thumbnail?id=REFUSED1234567&sz=w2000', size: 'm' }, { url: 'https://pics.example.org/heart.jpg', size: 'm' }] }); window.__ci = i; }, 'test');
    location.hash = '#/present/slide/' + (window.__ci + 1);
  });
  await p.waitForFunction(function () { const im = document.querySelectorAll('#pres-stage .slide-img img'); return im.length === 2 && [].every.call(im, function (i) { return i.complete && i.naturalWidth > 0; }); }, null, { timeout: 15000 });
  assert.strictEqual(await p.$('#pres-stage .img-broken'), null, 'no "could not be loaded" notice');
  assert.ok(seen.indexOf('thumb') >= 0 && seen.indexOf('lh3') >= 0, 'Drive: refused address, then Google\'s other address');
  assert.ok(seen.indexOf('pics with referrer') >= 0 && seen.indexOf('pics no referrer') >= 0, 'site: refused with the referrer, shown without');
  // the picture box: a web page is refused with a clear message; a Drive share link is converted and added
  if (!(await p.$('.pres-edit:not(.hidden)'))) await p.click('.pres-toolbar button:has-text("Edit slides")');
  await p.click('.pres-edit button:has-text("Edit this slide")'); await p.waitForSelector('.modal .img-mgr');
  const picker = '.modal-back:last-of-type';
  await p.click('.modal button:has-text("Upload / paste image URL")'); await p.waitForSelector(picker + ' input[type=url]');
  await p.fill(picker + ' input[type=url]', 'https://pics.example.org/page.html');
  await p.click(picker + ' button:has-text("Add")');
  await p.waitForFunction(function (s) { const m = document.querySelector(s + ' .msg.bad'); return m && /does not open as a picture/.test(m.textContent); }, picker, { timeout: 20000 });
  await p.fill(picker + ' input[type=url]', 'https://drive.google.com/file/d/SHARELINK123456/view?usp=sharing');
  await p.click(picker + ' button:has-text("Add")');
  await p.waitForFunction(function () { return document.querySelectorAll('.modal .img-mgr .im img').length === 3; }, null, { timeout: 20000 });
  assert.match(await p.getAttribute('.modal .img-mgr .im:last-child img', 'src'), /^https:\/\/drive\.google\.com\/thumbnail\?id=SHARELINK123456&sz=w2000$/, 'share link → picture address');
  await p.click('.modal button:has-text("Cancel")');
  await p.context().close();
});

/* A picture added in Learn mode after the deck was saved reaches that section's saved Images slide (a new Images slide when it is
   full); a picture the teacher removed from an Images slide stays removed. */
test('Presentation Mode: a Learn picture added after the deck was saved gets its own Images slide (one picture per slide); a removed picture stays removed', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const png = Buffer.from(PNG1, 'base64');
  await p.route('https://lh3.googleusercontent.com/**', function (r) { return r.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  // save the deck (any slide edit does this) — the Images slides are now part of the saved deck
  const sid = await p.evaluate(async function () {
    await Views.present.mutate(function () { }, 'save');
    const g = State.deck.slides.filter(function (x) { return x.type === 'gallery' && x.sectionId && !x.pracId; })
      .find(function (x) { return (x.items || []).length > 0 && (x.items || []).length < 4 && !State.deck.slides.some(function (y) { return y !== x && y.type === 'gallery' && y.sectionId === x.sectionId; }); });
    return g && g.sectionId;
  });
  assert.ok(sid, 'a section with one saved Images slide that has room');
  const addMedia = function (n, cap) { return p.evaluate(async function (a) {
    const items = (State.customMedia[a.sid] || []).slice();
    for (let k = 0; k < a.n; k++) items.push({ id: 'm_e2e_' + a.cap + k, type: 'image', url: 'https://drive.google.com/thumbnail?id=E2E' + a.cap + k + 'xxxxxx&sz=w2000', caption: a.cap + ' ' + k });
    await saveDoc('custommedia', a.sid, { items: items });
  }, { sid: sid, n: n, cap: cap }); };
  const gal = function () { return p.evaluate(function (id) { return Views.present.list().filter(function (x) { return x.type === 'gallery' && x.sectionId === id; }).map(function (x) {
    return { id: x.id, caps: (x.items || []).map(function (r) { const o = pmResolve(r, id); return (o && (o.caption || (o.m && o.m.caption) || o.title)) || ''; }) }; }); }, sid); };
  // one new Learn picture → on the existing Images slide
  await addMedia(1, 'NewPic');
  let g = await gal();
  assert.strictEqual(g.length, 2, 'its own Images slide after the saved one: ' + JSON.stringify(g)); assert.deepStrictEqual(g[1].caps, ['NewPic 0']);
  assert.ok(g[0].caps.indexOf('NewPic 0') < 0, 'not squeezed onto the saved slide');
  await p.evaluate(function (id) { location.hash = '#/present/slide/' + (Views.present.list().findIndex(function (x) { return x.id === id; }) + 1); }, g[1].id);
  await p.waitForFunction(function () { return /NewPic 0/.test((document.querySelector('#pres-stage .slide') || {}).textContent || ''); }, null, { timeout: 15000 });
  // four more → the slide fills up and a new Images slide follows it
  await addMedia(4, 'More');
  g = await gal();
  assert.strictEqual(g.length, 6, 'one Images slide per new picture'); g.slice(1).forEach(function (x) { assert.strictEqual(x.caps.length, 1, 'one picture per slide'); });
  const all = [].concat.apply([], g.map(function (x) { return x.caps; }));
  ['NewPic 0', 'More 0', 'More 1', 'More 2', 'More 3'].forEach(function (c) { assert.strictEqual(all.filter(function (x) { return x === c; }).length, 1, c + ' exactly once'); });
  // the teacher removes "NewPic 0" from the Images slide (Edit slides → select → Delete) → it stays removed, even after a refresh
  await p.evaluate(function (id) { location.hash = '#/present/slide/' + (Views.present.list().findIndex(function (x) { return x.id === id; }) + 1); }, g[1].id);
  await p.waitForFunction(function () { return /NewPic 0/.test((document.querySelector('#pres-stage .slide') || {}).textContent || ''); });
  await p.evaluate(function () { const f = [].find.call(document.querySelectorAll('#pres-stage [data-item]'), function (n) { return /NewPic 0/.test(n.textContent); }); PE.select(f); });
  await p.click('.pe-bar .btn-danger');
  await p.click('.modal button:has-text("Delete")');
  await p.waitForFunction(function () { return !/NewPic 0/.test((document.querySelector('#pres-stage .slide') || {}).textContent || ''); }, null, { timeout: 15000 });
  await p.reload();
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  await p.waitForSelector('#pres-stage .slide');
  const after = [].concat.apply([], (await gal()).map(function (x) { return x.caps; }));
  assert.strictEqual(after.indexOf('NewPic 0'), -1, 'the removed picture is not added back');
  ['More 0', 'More 1', 'More 2', 'More 3'].forEach(function (c) { assert.ok(after.indexOf(c) >= 0, c + ' kept'); });
  assert.ok(await p.evaluate(function (id) { return (State.customMedia[id] || []).some(function (m) { return m.caption === 'NewPic 0'; }); }, sid), 'Learn mode still has it');
  await p.context().close();
});

/* Pictures in the slide editor: one picture per slide with its own caption; Cut / Copy / Paste between slides (shortcuts and
   toolbar); pictures from the computer by Insert, clipboard paste and drag-and-drop; no teacher label; all persists. */
test('Slide editor pictures: no "Teacher" label; Insert (one slide each) → caption → Ctrl+C / Ctrl+V (same stored picture) → Ctrl+X / Paste (one save) → clipboard paste and drop from the computer → refused file → Delete → refresh keeps everything', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const ups = [], deckSaves = [];
  p.on('request', function (r) { if (!/script\.google\.com/.test(r.url())) return; try { const b = JSON.parse(r.postData() || '{}'); if (b.action === 'uploadImage') ups.push(1); if (b.action === 'upsert' && b.collection === 'presentationdeck') deckSaves.push(1); } catch (e) { } });
  const png = Buffer.from(PNG1, 'base64');
  const slideIds = function () { return p.evaluate(function () { return Views.present.list().map(function (x) { return x.id; }); }); };
  const go = function (id) { return p.evaluate(function (i) { location.hash = '#/present/slide/' + (Views.present.list().findIndex(function (x) { return x.id === i; }) + 1); }, id); };
  const cur = function () { return p.evaluate(function () { const s = Views.present.cur(); return { id: s.id, type: s.type, images: (s.images || []).map(function (im) { return { url: im.url, caption: im.caption || '', size: im.size, align: im.align }; }) }; }); };
  // Task 3 in Learn: two pictures added to one section → two separate Images slides, one picture each, no label
  const sec = await p.evaluate(async function () {
    const t = getTopics()[2], s = t.sections[1];
    await saveDoc('custommedia', s.id, { items: [{ id: 'm_a', type: 'image', url: 'https://drive.google.com/thumbnail?id=LEARNPICA123&sz=w2000', caption: 'Learn picture A' }, { id: 'm_b', type: 'image', url: 'https://drive.google.com/thumbnail?id=LEARNPICB123&sz=w2000', caption: 'Learn picture B' }] });
    return s.id;
  });
  const lg = await p.evaluate(function (sid) { return Views.present.list().filter(function (x) { return x.type === 'gallery' && x.sectionId === sid; }).map(function (x) { return (x.items || []).filter(function (r) { return r.t === 'media'; }).length; }); }, sec);
  assert.deepStrictEqual(lg.filter(function (n) { return n > 0; }), [1, 1], 'each Learn picture on its own Images slide');
  await p.evaluate(function (sid) { location.hash = '#/present/slide/' + (Views.present.list().findIndex(function (x) { return x.type === 'gallery' && x.sectionId === sid && (x.items || []).some(function (r) { return r.t === 'media'; }); }) + 1); }, sec);
  await p.waitForFunction(function () { return /Learn picture A/.test(document.querySelector('#pres-stage .slide').textContent); });
  assert.doesNotMatch(await p.textContent('#pres-stage .slide'), /teacher/i, 'no "Teacher’s image" label');
  // open the editor on a text slide
  const textSlide = await p.evaluate(function () { const l = Views.present.list(); return l.filter(function (x) { return x.type === 'content' && (x.bullets || []).length && !(x.images || []).length; }).map(function (x) { return x.id; }); });
  await go(textSlide[0]); await p.waitForTimeout(300);
  await p.click('.pres-toolbar button:has-text("Edit slides")'); await p.waitForSelector('.pres-edit .pe-tools');
  // 🖼 Insert pictures: three files → three new slides right after this one, one picture each
  const before = await slideIds();
  await p.setInputFiles('body > input[type=file][multiple]', [1, 2, 3].map(function (k) { return { name: 'pic' + k + '.png', mimeType: 'image/png', buffer: png }; }));
  await p.waitForFunction(function (n) { return Views.present.list().length === n + 3; }, before.length, { timeout: 20000 });
  const after = await slideIds(); const at = after.indexOf(textSlide[0]);
  const ins = after.slice(at + 1, at + 4);
  assert.ok(ins.every(function (id) { return /^img_/.test(id); }), 'three new picture slides after the current one');
  const insImgs = await p.evaluate(function (ids) { return ids.map(function (id) { const s = Views.present.list().find(function (x) { return x.id === id; }); return (s.images || []).length; }); }, ins);
  assert.deepStrictEqual(insImgs, [1, 1, 1], 'one picture per slide'); assert.strictEqual(ups.length, 3, 'each uploaded once');
  // caption: select the picture, type, Enter
  await go(ins[0]); await p.waitForTimeout(400);
  await p.click('#pres-stage .slide-img'); await p.waitForSelector('.pe-bar .pe-cap');
  await p.fill('.pe-bar .pe-cap', 'Acute appendicitis — neutrophils in the muscularis');
  await p.press('.pe-bar .pe-cap', 'Enter');
  await p.waitForFunction(function () { const c = document.querySelector('#pres-stage .slide-img figcaption'); return c && /Acute appendicitis/.test(c.textContent); });
  const orig = (await cur()).images[0];
  // Ctrl+C → a text slide → Ctrl+V: the same stored picture (no new upload) with its caption, beside the text
  await p.click('#pres-stage .slide-img'); await p.waitForSelector('.pe-bar');
  await p.keyboard.press('Control+c');
  await go(textSlide[1]); await p.waitForTimeout(400);
  await p.locator('body').press('Control+v');
  await p.waitForFunction(function () { return (Views.present.cur().images || []).length === 1; }, null, { timeout: 15000 });
  let c = await cur();
  assert.strictEqual(c.images[0].url, orig.url, 'the same stored picture'); assert.strictEqual(c.images[0].caption, orig.caption, 'its caption came along');
  assert.strictEqual(c.images[0].align, 'right', 'beside the text'); assert.strictEqual(ups.length, 3, 'nothing uploaded again');
  // the copy's caption is edited on its own
  await p.click('#pres-stage .slide-img'); await p.fill('.pe-bar .pe-cap', 'My own caption for the copy'); await p.press('.pe-bar .pe-cap', 'Enter');
  await p.waitForFunction(function () { return /My own caption/.test(document.querySelector('#pres-stage .slide-img figcaption').textContent); });
  assert.strictEqual((await p.evaluate(function (id) { return Views.present.list().find(function (x) { return x.id === id; }).images[0].caption; }, ins[0])), orig.caption, 'the original keeps its caption');
  // Ctrl+X on the second inserted picture → another slide → 📋 Paste: moved, in ONE deck save; the emptied picture slide goes
  await go(ins[1]); await p.waitForTimeout(400);
  await p.click('#pres-stage .slide-img'); await p.keyboard.press('Control+x');
  assert.ok(await p.$('#pres-stage .slide-img.pe-cut'), 'marked as cut; still on its slide until pasted');
  const cutUrl = (await cur()).images[0].url;
  await go(textSlide[2]); await p.waitForTimeout(400);
  const saves0 = deckSaves.length;
  await p.click('.pe-tools button:has-text("Paste")');
  await p.waitForFunction(function (id) { return !Views.present.list().some(function (x) { return x.id === id; }); }, ins[1], { timeout: 15000 });
  c = await cur(); assert.strictEqual(c.images[0].url, cutUrl, 'the cut picture is here');
  await p.waitForTimeout(500); assert.strictEqual(deckSaves.length - saves0, 1, 'added and removed in one save');
  // a picture from the computer: clipboard paste, then drag and drop
  const n0 = (await slideIds()).length;
  await p.evaluate(function (b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'clip.png', { type: 'image/png' })); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG1);
  await p.waitForFunction(function (n) { return Views.present.list().length === n + 1; }, n0, { timeout: 20000 });
  assert.strictEqual(ups.length, 4, 'the pasted picture was uploaded');
  await p.evaluate(function (b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'drop.png', { type: 'image/png' })); const o = document.querySelector('.pres-stage-outer');
    o.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); o.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, PNG1);
  await p.waitForFunction(function (n) { return Views.present.list().length === n + 2; }, n0, { timeout: 20000 });
  assert.strictEqual(ups.length, 5, 'the dropped picture was uploaded');
  // a file that is not a picture is refused with a message, nothing added
  const n1 = (await slideIds()).length;
  await p.setInputFiles('body > input[type=file][multiple]', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await p.waitForFunction(function () { return [].some.call(document.querySelectorAll('.toast'), function (t) { return /Not added: notes\.txt: not a JPEG/.test(t.textContent); }); });
  assert.strictEqual((await slideIds()).length, n1);
  // Delete removes only the selected picture (the copy on the text slide); the slide text stays
  await go(textSlide[1]); await p.waitForTimeout(400);
  await p.click('#pres-stage .slide-img'); await p.keyboard.press('Delete');
  await p.click('.modal button:has-text("Delete")');
  await p.waitForFunction(function () { return !(Views.present.cur().images || []).length; }, null, { timeout: 15000 });
  assert.ok(await p.$('#pres-stage .slide .body li'), 'the text is still there');
  // refresh: everything as left
  const keep = await p.evaluate(function () { return Views.present.list().filter(function (x) { return (x.images || []).length; }).map(function (x) { return x.id + '=' + x.images.map(function (i) { return i.url + '|' + (i.caption || ''); }).join(','); }).sort(); });
  await p.reload();
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
  await p.waitForSelector('#pres-stage .slide');
  assert.deepStrictEqual(await p.evaluate(function () { return Views.present.list().filter(function (x) { return (x.images || []).length; }).map(function (x) { return x.id + '=' + x.images.map(function (i) { return i.url + '|' + (i.caption || ''); }).join(','); }).sort(); }), keep, 'same pictures and captions after a refresh');
  assert.ok(keep.some(function (k) { return /Acute appendicitis — neutrophils/.test(k); }));
  await p.context().close();
});

/* 🖼 Import pictures (module patch picture-import.py, 2026-10-17): in ✏️ Edit master draft a picture-import file adds each
   picture with caption + credit to its Learning section (uploaded like "+ Picture", appended — nothing replaced), each one on
   its own Images slide; a second import adds nothing; groups get the pictures only after publishing. */
test('🖼 Import pictures: master draft → file → pictures in their sections (uploaded once each, nothing replaced) and on their own Images slides → importing again adds nothing → after publishing a group receives them', { skip: SKIP || ((!fs.existsSync(REAL[1][2]) || !REAL[1][3]) && 'module page or key not available') }, async function () {
  const M = REAL[1];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const tok = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [{ module: M[0], group: 'tr-a' }] }).modules;
  // the master already has a teacher picture in s1003: it must stay
  main.call({ module: M[0], action: 'upsert', token: main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]].token,
    collection: 'custommedia', id: 's1003', data: { items: [{ id: 'm_old', type: 'image', url: 'https://drive.google.com/thumbnail?id=OLDPIC12345&sz=w2000', caption: 'Existing picture' }] } });
  assert.ok(main.call({ module: 'portal', action: 'contentMigrate', token: t, moduleId: M[0], decisions: {} }).ok);
  assert.ok(main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'on' }).ok);
  const groupMedia = function (sid) { const r = main.call({ module: M[0] + '-tr-a', action: 'getAllContent', token: tok[M[0] + '-tr-a'].token, since: 0 }); const it = r.items.filter(function (i) { return i.collection === 'custommedia' && i.id === sid && !i.deleted; })[0]; return it ? it.data.items.map(function (m) { return m.caption; }) : []; };
  const img = 'data:image/png;base64,' + PNG1, credit = 'Kumar V. Robbins & Kumar Basic Pathology. © 2023 Elsevier Inc.';
  const file = { name: 'pictures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'neo-picture-import', version: 1, module: M[0], items: [
    { key: 'tst-01', section: 's1003', caption: 'Monocyte and activated macrophage. Two views.', credit: credit, filename: 'p1.png', image: img },
    { key: 'tst-02', section: 's1003', caption: 'Classical and alternative macrophage activation.', credit: credit, filename: 'p2.png', image: img },
    { key: 'tst-03', section: 's0105', caption: 'Sequence of events in an inflammatory reaction.', credit: credit, filename: 'p3.png', image: img },
    { key: 'tst-04', section: 'zz999', caption: 'Nowhere picture.', credit: credit, filename: 'p4.png', image: img }] })) };
  try {
    const calls = [];
    const p = await realPage(M, calls);
    await p.goto(HOME + '#/teacher');
    await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
    await dash(p, 'directory');
    await p.click('#t-dir .dir-tab[data-t=content]');
    const card = '#t-dir .content-mod[data-module="' + M[0] + '"]';
    await p.waitForSelector(card + ' [data-a=edit]');
    await p.click(card + ' [data-a=edit]');
    await p.waitForURL(new RegExp(M[1] + '/$'));
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await p.waitForSelector('#pf-draft', { timeout: 10000 });
    await p.evaluate(function () { location.hash = '#/teacher/backup'; });
    await p.waitForSelector('.pic-import input[type=file]');
    assert.match(await p.textContent('.pic-import'), /editing the MASTER DRAFT/);
    await p.setInputFiles('.pic-import input[type=file]', file);
    await p.waitForFunction(function () { return /3 of 4 pictures will be added · 1 cannot be added/.test(document.querySelector('.pic-import').textContent); });
    const listTxt = await p.textContent('.pic-import .pic-import-list');
    assert.match(listTxt, /Monocyte and activated macrophage → Topic 10 · Macrophages — the Dominant Cell/);
    assert.match(listTxt, /Nowhere picture — not possible: section zz999 is not in this course/);
    if (process.env.SHOTS) await (await p.$('.pic-import')).screenshot({ path: path.join(process.env.SHOTS, 'picture-import-plan.png') });
    await p.click('.pic-import button:has-text("Add the pictures")');
    await p.click('.modal button:has-text("Add pictures")');
    await p.waitForFunction(function () { return /✓ Added 3 pictures/.test(document.querySelector('.pic-import').textContent); }, null, { timeout: 30000 });
    assert.match(await p.textContent('.pic-import .pic-import-run'), /^✓ Added 3 pictures\. Now publish the draft: Platform Home → Content → ⬆ Publish draft\.$/);
    if (process.env.SHOTS) await (await p.$('.pic-import')).screenshot({ path: path.join(process.env.SHOTS, 'picture-import-done.png') });
    assert.strictEqual(calls.filter(function (c) { return c.action === 'uploadImage'; }).length, 3, 'each picture uploaded once');
    const media = await p.evaluate(function () { return ['s1003', 's0105'].map(function (s) { return (State.customMedia[s] || []).map(function (m) { return [m.caption, m.credit || '', m.importKey || '', /^https:\/\/drive\.google\.com\//.test(m.url)]; }); }); });
    assert.deepStrictEqual(media[0].map(function (m) { return m[0]; }), ['Existing picture', 'Monocyte and activated macrophage. Two views.', 'Classical and alternative macrophage activation.'], 'appended in file order; the existing picture is kept');
    assert.deepStrictEqual(media[0].slice(1).map(function (m) { return [m[1], m[2], m[3]]; }), [[credit, 'tst-01', true], [credit, 'tst-02', true]], 'credit, import key, Drive address');
    assert.deepStrictEqual(media[1].map(function (m) { return m[2]; }), ['tst-03']);
    // Presentation: every imported picture on its own Images slide after its section's slide
    const gal = await p.evaluate(function () { const l = Views.present.list(); return l.filter(function (x) { return x.type === 'gallery' && (x.sectionId === 's1003' || x.sectionId === 's0105'); }).map(function (x) { return [x.sectionId, (x.items || []).filter(function (r) { return r.t === 'media'; }).length, l.findIndex(function (y) { return y === x; }) > l.findIndex(function (y) { return y.id === 'c_' + x.sectionId; })]; }); });
    assert.deepStrictEqual(gal.filter(function (g) { return g[1] > 0; }).map(function (g) { return g.join(); }).sort(), ['s0105,1,true', 's1003,1,true', 's1003,1,true', 's1003,1,true'].sort());
    // Learn: the section shows the picture with its caption
    await p.evaluate(function () { location.hash = '#/explain/t10/s1003'; });
    await p.waitForFunction(function () { return /Classical and alternative macrophage activation/.test(document.querySelector('#view-explain').textContent); }, null, { timeout: 15000 });
    // the same file again: nothing to add
    await p.evaluate(function () { location.hash = '#/teacher/backup'; });
    await p.waitForSelector('.pic-import input[type=file]');
    await p.setInputFiles('.pic-import input[type=file]', file);
    await p.waitForFunction(function () { return /Nothing to add/.test(document.querySelector('.pic-import').textContent); });
    assert.match(await p.textContent('.pic-import'), /Nothing to add — 3 pictures are already in the course · 1 cannot be added\./);
    assert.match(await p.textContent('.pic-import .pic-import-list'), /Monocyte and activated macrophage → Topic 10 · Macrophages — the Dominant Cell — already there/);
    assert.ok(await p.$eval('.pic-import button.btn-primary', function (b) { return b.disabled; }), 'nothing to add → button off');
    // a file for another module is refused
    await p.setInputFiles('.pic-import input[type=file]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'neo-picture-import', module: 'cellinjury', items: [] })) });
    await p.waitForFunction(function () { return /for another module \(cellinjury\)/.test(document.querySelector('.pic-import').textContent); });
    // groups: only after publishing
    assert.deepStrictEqual(groupMedia('s1003'), ['Existing picture'], 'not before publishing');
    assert.ok(main.call({ module: 'portal', action: 'contentPublish', token: t, moduleId: M[0] }).ok);
    assert.deepStrictEqual(groupMedia('s1003'), ['Existing picture', 'Monocyte and activated macrophage. Two views.', 'Classical and alternative macrophage activation.'], 'every group after publishing');
    assert.deepStrictEqual(groupMedia('s0105'), ['Sequence of events in an inflammatory reaction.']);
    await p.context().close();
  } finally {
    main.call({ module: 'portal', action: 'contentSetMode', token: t, moduleId: M[0], mode: 'off' });
  }
});

/* Learning Mode: "Print Entire Chapter" prints every topic and section exactly once (collapsed ones too) in a clean document;
   the per-topic Print keeps printing one topic; a blocked pop-up falls back to a hidden frame. */
test('Learning Mode: 🖨️ Print Entire Chapter — every topic and section exactly once, chapter title, contents, page numbers, no interface; per-topic Print unchanged; works when pop-ups are blocked', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  const info = await p.evaluate(function () { return { title: COURSE.title, topics: getTopics().filter(function (t) { return (t.sections || []).length; }).map(function (t) { return { id: t.id, n: t.sections.length, secs: t.sections.map(function (s) { return s.id; }), mk: (t.mustKnow || []).length }; }), first: getTopics()[1].id }; });
  await p.evaluate(function (id) { location.hash = '#/explain/' + id; }, info.first);
  await p.waitForSelector('.topic-hero .print-chapter-btn');
  assert.match(await p.textContent('.topic-hero .print-chapter-btn'), /Print Entire Chapter/);
  assert.ok(await p.isVisible('.topic-hero .print-chapter-btn'), 'visible at the top of the topic page');
  assert.ok(await p.$('.topic-hero button:text("🖨 Print")'), 'the per-topic Print button is still there');
  const read = async function (pg) { return pg.evaluate(function () {
    const d = document, vis = function (n) { return getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden'; };
    return { title: (d.querySelector('header.print-head h1') || {}).textContent, meta: (d.querySelector('header.print-head .meta') || {}).textContent,
      topics: [].map.call(d.querySelectorAll('.print-topic'), function (t) { return t.dataset.topic; }),
      sections: [].map.call(d.querySelectorAll('.print-section'), function (s) { return s.dataset.section || s.querySelector('h2').textContent; }),
      toc: d.querySelectorAll('.print-toc li').length, mk: d.querySelectorAll('.mustknow-card').length, tables: d.querySelectorAll('table').length,
      visibleUi: [].filter.call(d.querySelectorAll('button:not(.atl-imgbtn), input, textarea, select, .notes-box, .edit-bar, .sec-actions, nav.app-nav, #app-nav'), vis).length,   // the atlas picture frame is a button that holds the picture (print-clean)
      css: [].map.call(d.querySelectorAll('style'), function (x) { return x.textContent; }).join(''), lazy: d.querySelectorAll('img[loading="lazy"]').length };
  }); };
  // 🖨️ Print Entire Chapter → the print window
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('.topic-hero .print-chapter-btn')]);
  await pop.waitForLoadState('load');
  let r = await read(pop);
  const allSecs = [].concat.apply([], info.topics.map(function (t) { return t.secs; }));
  assert.strictEqual(r.title, info.title, 'chapter title first');
  assert.match(r.meta, new RegExp('Entire chapter · ' + info.topics.length + ' topics · ' + allSecs.length + ' sections'));
  assert.deepStrictEqual(r.topics, info.topics.map(function (t) { return t.id; }), 'every topic once, in course order');
  assert.deepStrictEqual(r.sections, allSecs, 'every section exactly once, in order');
  assert.strictEqual(r.toc, info.topics.length, 'a contents list');
  assert.strictEqual(r.mk, info.topics.filter(function (t) { return t.mk; }).length, 'the Must-know lists');
  assert.ok(r.tables > 0, 'syllabus tables included');
  assert.strictEqual(r.visibleUi, 0, 'no buttons, notes, teacher tools or navigation on paper');
  assert.ok(/@bottom-center\s*\{\s*content:\s*"Page " counter\(page\)/.test(r.css) && /\.print-topic\{break-before:page/.test(r.css), 'page numbers and a new page per topic');
  assert.strictEqual(r.lazy, 0, 'pictures load before printing');
  await pop.close();
  // the per-topic Print still prints just its topic
  const [pop2] = await Promise.all([p.waitForEvent('popup'), p.click('.topic-hero button:text("🖨 Print")')]);
  await pop2.waitForLoadState('load');
  r = await read(pop2);
  assert.strictEqual(r.topics.length, 0); assert.strictEqual(r.sections.length, info.topics[1].n, 'one topic only');
  await pop2.close();
  // the overview has the button too
  await p.evaluate(function () { location.hash = '#/explain/overview'; });
  await p.waitForSelector('.topic-hero .print-chapter-btn');
  // pop-ups blocked → the same document prints from a hidden frame in the page
  await p.evaluate(function () { window.__printed = 0; window.open = function () { return null; }; });
  await p.click('.topic-hero .print-chapter-btn');
  await p.waitForFunction(function () { const f = document.querySelector('iframe[aria-hidden="true"]'); return f && f.contentDocument && f.contentDocument.querySelectorAll('.print-section').length > 0 && f.contentDocument.readyState === 'complete'; }, null, { timeout: 15000 });
  const n = await p.evaluate(function () { const d = document.querySelector('iframe[aria-hidden="true"]').contentDocument; return { secs: d.querySelectorAll('.print-section').length, auto: /window\.print\(\)/.test(d.documentElement.innerHTML) }; });
  assert.strictEqual(n.secs, allSecs.length, 'the whole chapter in the fallback frame'); assert.strictEqual(n.auto, false, 'printed once, by the page');
  await p.context().close();
});

/* Last-Minute Review → High-Yield Facts → Print: a clean handout of unit headings and bulleted facts — every fact, whatever filter
   is on screen, no Learning Block references; the references stay on screen. */
test('High-Yield Facts print: every fact (even with a filter on), unit headings, bullets, no Learning Block tags on paper; the tags stay on screen', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  await p.evaluate(function () { location.hash = '#/review/facts'; });
  await p.waitForSelector('.lmr-fact');
  const screen = await p.evaluate(function () {
    return { facts: [].map.call(document.querySelectorAll('.lmr-fact .lmr-ftext'), function (n) { return n.textContent.replace(/\s+/g, ' ').trim(); }),
      tags: document.querySelectorAll('.lmr-fact .lmr-lb').length, units: [].map.call(document.querySelectorAll('.lmr-list h3, .lmr-list .lmr-unit, .lmr-list h4'), function (n) { return n.textContent.trim(); }) };
  });
  assert.ok(screen.facts.length > 10, 'facts on screen'); assert.ok(screen.tags >= screen.facts.length, 'each fact has its Learning Block tag on screen');
  // flag one fact and show only "⚑ Review again": the printout must still contain every fact
  await p.click('.lmr-fact .lmr-flag');
  await p.click('.lmr-tabs button:has-text("Review again")');
  await p.waitForTimeout(300);
  const shown = await p.$$eval('.lmr-fact', function (x) { return x.length; });
  assert.ok(shown < screen.facts.length, 'the filter shows fewer facts (' + shown + ')');
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('.lmr-part-head button:has-text("Print"), button:has-text("🖨 Print")')]);
  await pop.waitForLoadState('load');
  const pr = await pop.evaluate(function () {
    return { facts: [].map.call(document.querySelectorAll('.lmr-p li'), function (n) { return n.textContent.replace(/\s+/g, ' ').trim(); }),
      units: [].map.call(document.querySelectorAll('.lmr-p h2'), function (n) { return n.textContent.trim(); }),
      text: document.querySelector('.print-body').textContent, refs: document.querySelectorAll('.lmr-p .ref, .lmr-p a').length,
      bullet: getComputedStyle(document.querySelector('.lmr-p ul')).listStyleType, unsplit: getComputedStyle(document.querySelector('.lmr-p li')).breakInside,
      std: !!document.querySelector('.hy-std'), bold: document.querySelectorAll('.lmr-p li strong').length,
      boldWeight: document.querySelector('.lmr-p li strong') ? getComputedStyle(document.querySelector('.lmr-p li strong')).fontWeight : '' };
  });
  assert.ok(pr.std, 'the shared platform standard (platform block) printed it');
  assert.strictEqual(await p.evaluate(function () { return window.lmrPrintFacts.__platform === true; }), true);
  const boldOnScreen = await p.$$eval('.lmr-fact .lmr-ftext strong', function (x) { return x.length; });
  assert.ok(pr.bold > 0 && pr.bold >= boldOnScreen, 'key words in bold (' + pr.bold + ')'); assert.ok(+pr.boldWeight >= 700);
  assert.deepStrictEqual(pr.facts, screen.facts, 'every fact, same wording and order');
  assert.ok(pr.units.length >= 1, 'unit headings'); assert.strictEqual(new Set(pr.units).size, pr.units.length, 'each unit once');
  assert.doesNotMatch(pr.text, /Learning Block/, 'no source tags on paper'); assert.doesNotMatch(pr.text, /→\s*Learning/, 'no source arrows'); assert.strictEqual(pr.refs, 0);
  assert.strictEqual(pr.facts.filter(function (f) { return /→/.test(f); }).length, screen.facts.filter(function (f) { return /→/.test(f); }).length, 'arrows only where the fact itself has them');
  assert.strictEqual(pr.bullet, 'disc'); assert.strictEqual(pr.unsplit, 'avoid', 'a fact is not split across pages');
  await pop.close();
  // on screen the tags are still there
  await p.click('.lmr-tabs button:has-text("All")');
  assert.strictEqual(await p.$$eval('.lmr-fact .lmr-lb', function (x) { return x.length; }), screen.tags, 'the Learning Block tags stay on screen');
  await p.context().close();
});

/* A future module that does not share the current modules' code still gets the same High-Yield handout from the platform block. */
test('High-Yield Facts print standard in the platform block: a new module without its own print code gets the same clean handout (headings, bullets, bold, no tags)', { skip: SKIP }, async function () {
  const p = await page();
  const nav = fs.readFileSync(path.join(ROOT, 'modules', 'platform-nav.js'), 'utf8');
  await p.setContent('<!DOCTYPE html><html><head><title>New Module</title></head><body><h1>New module</h1><script id="platform-nav">' + nav.replace(/<\/script>/g, '<\\/script>') + '</script></body></html>');
  assert.strictEqual(await p.evaluate(function () { return typeof window.PlatformHY.print; }), 'function');
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.evaluate(function () {
    window.PlatformHY.print([
      { md: 'Hypoxia is the **commonest cause** of cell injury.', unit: 'Unit 1 · Cell injury', blocks: [{ section: 's1' }] },
      { md: 'Ischaemia is worse than hypoxia: *nutrients* are also lost.', unit: 'Unit 1 · Cell injury' },
      { md: 'Granuloma = **epithelioid macrophages** + lymphocyte cuff.', unit: 'Unit 2 · Inflammation' }]);
  })]);
  await pop.waitForLoadState('load');
  const r = await pop.evaluate(function () { return { h2: [].map.call(document.querySelectorAll('.hy-std h2'), function (n) { return n.textContent; }), li: document.querySelectorAll('.hy-std li').length,
    strong: [].map.call(document.querySelectorAll('.hy-std li strong'), function (n) { return n.textContent; }), em: document.querySelectorAll('.hy-std li em').length, text: document.body.textContent,
    bullet: getComputedStyle(document.querySelector('.hy-std ul')).listStyleType }; });
  assert.deepStrictEqual(r.h2, ['Unit 1 · Cell injury', 'Unit 2 · Inflammation']); assert.strictEqual(r.li, 3);
  assert.deepStrictEqual(r.strong, ['commonest cause', 'epithelioid macrophages']); assert.strictEqual(r.em, 1);
  assert.doesNotMatch(r.text, /Learning Block|\*\*/); assert.strictEqual(r.bullet, 'disc');
  await p.close();
});

/* Last-Minute Review → 15-minute review → 🖨 Print: the whole list (every item once, in order, with its label and content), no
   checkboxes, timer, buttons or Learning Block links; the screen keeps its progress and links. */
test('15-minute review: 🖨 Print gives the whole list (every item once, labels, tables) without checkboxes, timer or Learning Block links; the screen is unchanged', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const p = await presentPage(REAL[0]);
  await p.evaluate(function () { location.hash = '#/review/quick'; });
  await p.waitForSelector('.lmr-quick .lmr-q');
  await p.click('.lmr-quick .lmr-q input[type=checkbox]');   // one item done: the printout still has every item
  const screen = await p.evaluate(function () { return { n: document.querySelectorAll('.lmr-quick .lmr-q').length, kinds: [].map.call(document.querySelectorAll('.lmr-quick .lmr-q .lmr-q-k'), function (k) { return k.textContent; }), links: document.querySelectorAll('.lmr-quick .lmr-lb').length, done: document.querySelectorAll('.lmr-quick .lmr-q.done').length }; });
  assert.ok(screen.n > 5 && screen.done === 1);
  const [pop] = await Promise.all([p.waitForEvent('popup'), p.click('.lmr-head button:has-text("🖨 Print")')]);
  await pop.waitForLoadState('load');
  const pr = await pop.evaluate(function () { const b = document.querySelector('.print-body');
    return { title: document.querySelector('header.print-head h1').textContent, meta: document.querySelector('header.print-head .meta').textContent,
      n: b.querySelectorAll('.lmr-q').length, kinds: [].map.call(b.querySelectorAll('.lmr-q .lmr-q-k'), function (k) { return k.textContent; }),
      ui: b.querySelectorAll('input, button, .lmr-actions, .lmr-timer').length, text: b.textContent, tables: b.querySelectorAll('table').length }; });
  assert.strictEqual(pr.title, '15-Minute Review'); assert.match(pr.meta, new RegExp(screen.n + ' items'));
  assert.strictEqual(pr.n, screen.n, 'every item once'); assert.deepStrictEqual(pr.kinds, screen.kinds, 'same order, with their labels');
  assert.strictEqual(pr.ui, 0, 'no checkboxes, buttons or timer'); assert.doesNotMatch(pr.text, /Learning Block/, 'no block links on paper');
  if (screen.kinds.indexOf('COMPARISON') >= 0) assert.ok(pr.tables > 0, 'comparison tables printed');
  await pop.close();
  assert.deepStrictEqual(await p.evaluate(function () { return [document.querySelectorAll('.lmr-quick .lmr-q.done').length, document.querySelectorAll('.lmr-quick .lmr-lb').length, !!document.querySelector('.lmr-timer')]; }), [1, screen.links, true], 'progress, links and timer stay on screen');
  await p.context().close();
});

test('Module attendance report: every registered student of the group, Present / Absent (Absent only after closing), totals and percentages — on screen, printed and in the CSV; other groups and deactivated students kept apart', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: false }).ok);
  main.addStudents(M[0], [{ username: 'reg-a1', name: 'Amal Present', password: PW, mustChange: false }, { username: 'reg-b2', name: 'Basma ByName', password: PW, mustChange: false },
    { username: 'reg-c3', name: 'Camal Absent', password: PW, mustChange: false }, { username: 'reg-d4', name: 'Dalia Typo', password: PW, mustChange: false }]);
  main.addStudents(M[0] + '-tr-a', [{ username: 'reg-x9', name: 'Other Group Student', password: PW, mustChange: false }]);
  const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [M[0]] }).modules[M[0]];
  const st = main.call({ module: M[0], action: 'startAttendanceSession', token: tt.token, sessionTitle: 'L9: Register test', course: 'Cell Injury', academicYear: '2026-2027', teacher: 'Dr. Test' });
  assert.ok(st.ok, JSON.stringify(st));
  // check-in needs a signed-in student; the server records that account's name and ID
  const sub = function (user) {
    const stoken = main.call({ module: M[0], action: 'studentLogin', username: user, password: PW }).token;
    const r = main.call({ module: M[0], action: 'submitAttendanceByCode', stoken: stoken, code: st.code, name: 'typed', studentId: '', participantId: 'p-' + user }); assert.ok(r.ok, JSON.stringify(r));
  };
  sub('reg-a1'); sub('reg-b2'); sub('reg-d4');
  // reg-d4 is deactivated after checking in → no longer on the list: shown apart, not counted
  assert.ok(main.call({ module: M[0], action: 'setStudentActive', token: tt.token, username: 'reg-d4', active: false }).ok);
  const roster = main.call({ module: M[0], action: 'listStudents', token: tt.token }).students.filter(function (s) { return s.active !== false; });
  const N = roster.length;
  assert.ok(N >= 3 && !roster.some(function (s) { return s.username === 'reg-x9' || s.username === 'reg-d4'; }), 'group roster');
  const p = await realPage(M, []);
  await p.addInitScript(function (v) { localStorage.setItem('ci_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
  const openReport = async function () {
    await p.goto('https://third-year-med.github.io/' + M[1] + '/#/teacher/attendance');
    await p.reload();   // a fresh page each time (history and report read again)
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    const view = 'tr:has-text("L9: Register test") button:has-text("View")';
    await p.waitForSelector(view, { timeout: 20000 });
    await p.click(view);
    await p.waitForSelector('.modal .att-register tbody tr', { timeout: 15000 });
    await p.waitForFunction(function () { return !/Loading the registered student list/.test(document.querySelector('.modal').textContent); }, null, { timeout: 15000 });
    return p.evaluate(function () {
      const m = document.querySelector('.modal');
      const stats = {}; m.querySelectorAll('.stat').forEach(function (s) { stats[s.querySelector('.k').textContent] = s.querySelector('.v').textContent; });
      const rows = Array.from(m.querySelectorAll('.att-register tbody tr')).map(function (tr) { const td = tr.querySelectorAll('td'); return td.length < 7 ? { note: tr.textContent } : { name: td[1].textContent, id: td[2].textContent, status: td[5].textContent, absent: tr.classList.contains('att-absent'), del: !!td[6].querySelector('button') }; });
      return { stats: stats, rows: rows, text: m.textContent };
    });
  };
  // 1) still open: nobody is called absent yet
  let r = await openReport();
  assert.strictEqual(r.stats['Registered'], String(N));
  assert.strictEqual(r.stats['Present'], '2', JSON.stringify(r.rows));
  assert.strictEqual(r.stats['Not checked in yet'], String(N - 2));
  assert.strictEqual(r.stats['Absence'], '—');
  assert.ok(!r.rows.some(function (x) { return x.status === 'Absent'; }), 'no Absent while open');
  assert.match(r.text, /Absences are finalised when attendance is closed/);
  // 2) close → Absent, totals, percentages
  assert.ok(main.call({ module: M[0], action: 'closeAttendanceSession', token: tt.token, sessionId: st.sessionId }).ok);
  r = await openReport();
  const pct = Math.round(2 / N * 100);
  assert.deepStrictEqual([r.stats['Registered'], r.stats['Present'], r.stats['Absent'], r.stats['Attendance'], r.stats['Absence']], [String(N), '2', String(N - 2), pct + '%', (100 - pct) + '%']);
  const people = r.rows.filter(function (x) { return !x.note; });
  assert.strictEqual(people.length, N + 1, 'every registered student once + the deactivated one');
  roster.forEach(function (s) { assert.strictEqual(people.filter(function (x) { return x.id === s.username; }).length, 1, s.username); });
  const by = function (id) { return people.filter(function (x) { return x.id === id; })[0]; };
  assert.ok(/Present/.test(by('reg-a1').status) && !by('reg-a1').absent && by('reg-a1').del);
  assert.ok(/Present/.test(by('reg-b2').status));
  assert.ok(by('reg-c3').status === 'Absent' && by('reg-c3').absent && !by('reg-c3').del);
  assert.strictEqual(people.filter(function (x) { return x.status === 'Absent'; }).length, N - 2);
  assert.ok(/not on the list/.test(by('reg-d4').status), 'a deactivated student\'s check-in is listed apart');
  assert.ok(!/Other Group Student/.test(r.text), 'another group\'s student never appears');
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'att-register.png'), fullPage: true });
  // 3) printed report
  await p.evaluate(function () { window.open = function () { return { document: { write: function (h) { window.__att = h; }, close: function () { } } }; }; });
  await p.click('.modal button:has-text("Print attendance report")');
  const html = await p.evaluate(function () { return window.__att || ''; });
  assert.match(html, /Registered students/);
  assert.ok(html.indexOf('Registered: ' + N + ' · Present: 2 (' + pct + '%) · Absent: ' + (N - 2) + ' (' + (100 - pct) + '%)') > 0, 'printed totals');
  assert.strictEqual((html.match(/<b>Absent<\/b>/g) || []).length, N - 2);
  roster.forEach(function (s) { assert.ok(html.indexOf('>' + s.username + '<') > 0, 'printed ' + s.username); });
  if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, 'att-register-print.html'), html);
  // 4) CSV
  const dl = p.waitForEvent('download');
  await p.click('.modal button:has-text("Export to Excel")');
  const csv = fs.readFileSync(await (await dl).path(), 'utf8');
  assert.match(csv, /Registered students,"?\d+/);
  assert.match(csv, new RegExp('Attendance %,"?' + pct + '%'));
  assert.strictEqual((csv.match(/,"?Absent"?\r?\n/g) || []).length, N - 2);
  assert.match(csv, /Present \(not on the student list\)/);
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: true }).ok);
  await p.context().close();
});

test('module Live Classroom: a signed-in registered student goes straight in (no class code, own name); an older server still gets the code form', { skip: SKIP || ((!fs.existsSync(REAL[0][2]) || !REAL[0][3]) && 'module page or key not available') }, async function () {
  const M = REAL[0];
  groupFixture();
  main.addStudents(M[0], [{ username: 'live-s1', name: 'Live Student', password: PW, mustChange: false }]);
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: false }).ok);
  const calls = [];
  const p = await realPage(M, calls);
  await p.goto(HOME);
  await p.waitForSelector('.mod[data-id="' + M[0] + '"]');
  await signIn(p, 'live-s1', PW);
  await p.waitForSelector('.mod[data-id="' + M[0] + '"] .go');
  await p.click('.mod[data-id="' + M[0] + '"] .go');
  await p.waitForURL(new RegExp(M[1]));
  await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
  await p.waitForSelector('.nav-btn[data-view="live"]', { state: 'visible', timeout: 15000 });
  await p.click('.nav-btn[data-view="live"]');
  await p.waitForSelector('.lv-head', { timeout: 15000 });
  assert.ok(!(await p.$('.lv-join input')), 'no class-code form');
  const join = calls.filter(function (c) { return c.action === 'liveJoin'; });
  assert.strictEqual(join.length, 1);
  assert.ok(join[0].stoken && !join[0].classCode, 'joined with the sign-in session, no code typed');
  const me = await p.evaluate(function () { return Live.me; });
  assert.ok(me && me.role === 'student' && me.name === 'Live Student', JSON.stringify(me));
  // an older Code.gs (still asks for the code) → the usual form appears, nothing breaks
  main.eval('var __gate0 = gateRequest_; gateRequest_ = function (m, q) { var r = __gate0(m, q); if (q.action === "liveJoin") q.classCode = ""; return r; };');
  try {
    await p.evaluate(function () { Live.leave(); });
    await p.reload();
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    await p.evaluate(function () { location.hash = '#/live'; });
    await p.waitForSelector('.lv-join input[placeholder^="e.g. CLASS"]', { timeout: 15000 });
  } finally { main.eval('gateRequest_ = __gate0;'); }
  assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: t, hideModuleLive: true }).ok);
  await p.context().close();
});

test('no JavaScript errors', { skip: SKIP }, function () { assert.deepStrictEqual(errors, []); });

/* ---------------- Overall Pathology Attendance (2.15) ---------------- */
test('🏅 Annual Assessment (2.31/2.32): quizzes /20 from the modules\' attempts (missed = 0), auto-assign + mark two presentations of 0–5 (rubric), excuse, exclude, total /30, CSV / Excel / print', { skip: SKIP }, async function () {
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, action + ' ' + JSON.stringify(r)); return r; };
  const sv = function (kind, record) { return A('dirSave', { kind: kind, record: record }).record; };
  A('dirGet');
  const inst = sv('institution', { name: 'Annual Test University', shortName: 'ATU' });
  const g = sv('group', { institutionId: inst.institutionId, name: 'Group N', academicYear: '2026-27', linkCode: 'an-a' });
  sv('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' }); sv('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  A('rosterAdd', { groupId: g.groupId, mustChange: false, students: [{ studentId: '28010001', name: 'Huda First', password: 'pass-n1-xyz' }, { studentId: '28010002', name: 'Imad Second', password: 'pass-n2-xyz' }] });
  const CI = 'cellinjury-an-a', IH = 'inflhealing-an-a'; let n = 0;
  const att = function (st, id, ref, pct) { n++; main.ctx.assessStore_(st).put('attempt', 'an' + n, { id: 'an' + n, assessmentId: ref, assessmentTitle: ref === 'tq1' ? 'Topic 1 quiz — Adaptations' : 'Topic 1 quiz — Acute inflammation', email: id + '@student.local', status: 'submitted', percent: pct, submittedAt: Date.now() - 864e5 * (3 - n) }); };
  att(CI, '28010001', 'tq1', 80); att(IH, '28010001', 'tq2', 60); att(IH, '28010002', 'tq2', 100);   // Huda 140/200 → 14; Imad missed tq1 → 100/200 → 10
  // the topic quizzes themselves (the presentation topics come from their titles)
  main.call({ module: CI, action: 'setup', password: 'mod-teacher-an-1' });
  const mt = main.call({ module: CI, action: 'login', password: 'mod-teacher-an-1' }).token;
  ['Topic 1 quiz — Adaptations', 'Topic 2 quiz — Necrosis', 'Topic 3 quiz — Apoptosis'].forEach(function (title, i) { assert.ok(main.call({ module: CI, action: 'upsert', token: mt, collection: 'assessments', id: 'tq' + (i ? 'c' + i : '1'), data: { id: 'tq' + (i ? 'c' + i : '1'), title: title, status: 'published' } }).ok); });
  const p = await page();
  p.removeAllListeners('dialog'); p.on('dialog', function (dl) { dl.accept(); });
  await p.goto(url + '#/teacher'); await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'annual');
  await p.waitForSelector('#t-annual .an-g');
  await p.selectOption('#t-annual .an-g', g.groupId);
  await p.waitForFunction(function () { return document.querySelectorAll('#t-annual .an-tbl tbody tr[data-student]').length === 2; }, null, { timeout: 15000 });
  const cells = function (id) { return p.$eval('#t-annual .an-tbl tr[data-student="' + id + '"]', function (tr) { return Array.prototype.map.call(tr.cells, function (c) { return c.textContent.trim(); }); }); };
  assert.deepStrictEqual((await cells('28010001')).slice(0, 7), ['28010001', 'Huda First', '2 / 2', '14', '0 / 2', '0', '14']);
  assert.deepStrictEqual((await cells('28010002')).slice(0, 7), ['28010002', 'Imad Second', '1 / 2 · 1 missed', '10', '0 / 2', '0', '10'], 'missed quiz counts 0');
  assert.match((await cells('28010002'))[7], /1 quiz missed[\s\S]*2 presentations not assigned/);
  assert.match(await p.textContent('#t-annual .ov-kpis'), /Students2[\s\S]*Quizzes counted2[\s\S]*Presentations marked0 \/ 4[\s\S]*Behind⚠ 2/);
  // 🎤 Presentations → ⚙ Auto-assign (topics from the topic quizzes) → mark one with the rubric
  await p.click('#t-annual .an-tab[data-t=pres]');
  await p.click('#t-annual [data-a=auto]');
  await p.waitForSelector('.an-modal .an-tpi');
  assert.match(await p.textContent('.an-modal'), /Fills the 4 empty slot[\s\S]*Topic 1 — Adaptations[\s\S]*Topic 3 — Apoptosis/);
  await p.fill('.an-modal .an-more', 'Hyperplasia\nMetaplasia');
  await p.click('.an-modal button[type=submit]');
  await p.waitForFunction(function () { return !document.querySelector('.an-modal') && document.querySelectorAll('#t-annual .an-ptbl tbody tr[data-slot]').length === 4 && !/Not assigned yet/.test(document.querySelector('#t-annual .an-ptbl').textContent); }, null, { timeout: 15000 });
  const topics = await p.$$eval('#t-annual .an-ptbl tr[data-student="28010001"] td:nth-child(3)', function (c) { return c.map(function (x) { return x.textContent; }); });
  assert.strictEqual(new Set(topics).size, 2, 'two different topics: ' + topics);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'annual-presentations.png'), fullPage: true });
  await p.click('#t-annual .an-ptbl tr[data-student="28010001"][data-slot="1"] button');
  await p.waitForSelector('.an-modal form');
  assert.ok(await p.isHidden('.an-modal .an-mark'), 'no mark while assigned');
  await p.selectOption('.an-modal select[name=status]', 'completed');
  await p.click('.an-modal button[type=submit]');
  assert.match(await p.textContent('.an-modal .an-err'), /Choose the mark/, 'never a mark without the teacher choosing it');
  await p.click('.an-modal .an-rub summary');
  assert.strictEqual(await p.$$eval('.an-modal input[name=mark]', function (x) { return x.map(function (i) { return i.value; }).join(' '); }), '0 0.5 1 1.5 2 2.5 3 3.5 4 4.5 5', 'a presentation is marked 0–5');
  for (const k of ['accuracy', 'understanding', 'questions']) await p.selectOption('.an-modal select[data-r=' + k + ']', '1');
  await p.selectOption('.an-modal select[data-r=organisation]', '0.5');
  assert.strictEqual(await p.$eval('.an-modal input[name=mark]:checked', function (i) { return i.value; }), '3.5', 'the rubric sets the mark');
  await p.selectOption('.an-modal select[data-r=delivery]', '0.5');
  await p.fill('.an-modal textarea[name=comment]', 'Clear and accurate');
  if (process.env.SHOTS) await (await p.$('.an-modal form')).screenshot({ path: path.join(process.env.SHOTS, 'annual-mark.png') });
  await p.click('.an-modal button[type=submit]');
  await p.waitForFunction(function () { var r = document.querySelector('#t-annual .an-ptbl tr[data-student="28010001"][data-slot="1"]'); return !document.querySelector('.an-modal') && r && /Completed/.test(r.textContent) && /Clear and accurate/.test(r.textContent); });
  // 📋 Class: Huda 14 + 4 = 18; Imad excused from tq1 → 100 % of 1 quiz → 20
  await p.click('#t-annual .an-tab[data-t=class]');
  await p.waitForSelector('#t-annual .an-tbl');
  assert.deepStrictEqual((await cells('28010001')).slice(2, 7), ['2 / 2', '14', '1 / 2', '4', '18']);
  await p.click('#t-annual .an-tbl tr[data-student="28010002"] button');
  await p.waitForSelector('#t-annual .an-stu [data-ex="1"]');
  await p.click('#t-annual .an-stu [data-ex="1"]');
  await p.waitForFunction(function () { var r = document.querySelector('#t-annual .an-tbl tr[data-student="28010002"]'); return r && /20/.test(r.cells[3].textContent) && document.querySelector('#t-annual .an-stu'); }, null, { timeout: 15000 });
  assert.match(await p.textContent('#t-annual .an-stu'), /Excused/);
  // 📝 Quizzes: exclude tq2 → Huda 80 % → 16 + 4 = 20
  await p.click('#t-annual .an-tab[data-t=quiz]');
  await p.uncheck('#t-annual .an-quiz tr[data-q="' + IH + '|tq2"] input');
  await p.waitForFunction(function () { return /Quizzes counted1[\s\S]*1 excluded/.test(document.querySelector('#t-annual .ov-kpis').textContent); }, null, { timeout: 15000 });
  await p.click('#t-annual .an-tab[data-t=class]');
  assert.deepStrictEqual((await cells('28010001')).slice(2, 7), ['1 / 1', '16', '1 / 2', '4', '20']);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'annual-class.png'), fullPage: true });
  // exports: CSV = the table; Excel has the four sheets; the printed class sheet
  const dl = function (sel) { return Promise.all([p.waitForEvent('download'), p.click(sel)]).then(function (x) { return x[0].path(); }); };
  const csv = fs.readFileSync(await dl('#t-annual [data-a=csv]'), 'utf8').replace(/^﻿/, '').split(/\r\n/);
  assert.match(csv[0], /^Student ID,Name,Status,Quizzes counted,Quizzes taken,Missed,Excused,Quizzes \/20,Presentations completed,Presentations \/10,Total \/30,Outstanding$/);
  assert.match(csv[1], /^28010001,Huda First,active,1,1,0,0,16,1,4,20,/);
  assert.match(csv[2], /^28010002,Imad Second,active,0,0,0,1,,0,0,,/, 'excused from the only counted quiz → no quiz mark yet');
  const xp = await dl('#t-annual [data-a=xlsx]');
  const wb = require('child_process').execFileSync('unzip', ['-p', xp, 'xl/workbook.xml']).toString();
  assert.match(wb, /name="Annual register"[\s\S]*name="Quizzes"[\s\S]*name="Presentations"[\s\S]*name="Report info"/);
  await p.click('#t-annual [data-a=print]');
  await p.waitForFunction(function () { var f = document.querySelector('iframe.ov-print'); return f && f.contentDocument && /Annual Pathology Assessment — Class Sheet/.test(f.contentDocument.body.textContent); });
  assert.match(await p.evaluate(function () { return document.querySelector('iframe.ov-print').contentDocument.body.textContent; }), /Huda First[\s\S]*16[\s\S]*20/);
  // the marks persist on the server (a fresh read), with the correction history
  const srv = A('annOverall', { groupId: g.groupId }), hu = srv.students.filter(function (x) { return x.studentId === '28010001'; })[0];
  assert.deepStrictEqual([hu.quiz, hu.pres.mark, hu.total, hu.presentations[0].mark, hu.presentations[0].rubric.delivery], [16, 4, 20, 4, 0.5]);
  assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
  await p.context().close();
});

test('Pathology Overall Results & Analytics (2.22, rule 2.34): one row per student, module assessment % (missed assessment = 0) and overall % (equal / weighted), filters, sort, details, CSV = table', { skip: SKIP }, async function () {
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, action + ' ' + JSON.stringify(r)); return r; };
  const sv = function (kind, record) { return A('dirSave', { kind: kind, record: record }).record; };
  A('dirGet');
  const inst = sv('institution', { name: 'Results Test University', shortName: 'RTU' });
  const g = sv('group', { institutionId: inst.institutionId, name: 'Group R', academicYear: '2026-27', linkCode: 'rs-a' });
  sv('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' }); sv('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  A('rosterAdd', { groupId: g.groupId, mustChange: false, students: [{ studentId: '27010001', name: 'Amina Full', password: 'pass-r1-xyz' }, { studentId: '27010002', name: 'Basel Half', password: 'pass-r2-xyz' }, { studentId: '27010003', name: 'Carim None', password: 'pass-r3-xyz' }] });
  const CI = 'cellinjury-rs-a', IH = 'inflhealing-rs-a'; let n = 0;
  const att = function (st, id, pct, ref) { n++; main.ctx.assessStore_(st).put('attempt', 'rs' + n, { id: 'rs' + n, assessmentId: ref || 'q1', assessmentTitle: 'Topic ' + (ref || 'q1'), email: id + '@student.local', status: 'submitted', percent: pct, submittedAt: Date.now() }); };
  att(CI, '27010001', 80); att(IH, '27010001', 60, 'q1'); att(IH, '27010001', 80, 'q2');   // CI 80, IH 70 → 75
  att(CI, '27010002', 50);                                                                 // only CI q1; missed IH q1 + q2 → IH 0, overall 25
  const p = await page();
  await p.goto(url + '#/teacher'); await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'results');
  await p.waitForSelector('#t-results .rs-g');
  await p.selectOption('#t-results .rs-g', g.groupId);
  await p.waitForFunction(function () { return document.querySelectorAll('#t-results .rs-tbl tbody tr[data-student]').length === 3; }, null, { timeout: 15000 });
  const cells = function (id) { return p.$eval('#t-results tr[data-student="' + id + '"]', function (tr) { return Array.prototype.map.call(tr.cells, function (c) { return c.textContent.trim(); }); }); };
  const r1 = await cells('27010001'), r2 = await cells('27010002'), r3 = await cells('27010003');
  assert.deepStrictEqual(r1.slice(0, 9), ['27010001', 'Amina Full', 'active', '2 / 2', '2', '80%', '70%', '75%', '✓ All modules']);
  assert.deepStrictEqual(r2.slice(3, 9), ['2 / 2', '2', '50%', '0%', '25%', 'Partial'], '2.34: the missed assessments count 0');
  assert.deepStrictEqual(r3.slice(3, 9), ['2 / 2', '2', '0%', '0%', '0%', 'Nothing submitted'], 'absent from every assessment the group took → 0 %');
  const kpi = await p.textContent('#t-results .ov-kpis');
  assert.match(kpi, /Enrolled students3[\s\S]*With an overall result3[\s\S]*Incomplete \(missed some\)1[\s\S]*1 submitted nothing[\s\S]*Cohort mean33\.3%[\s\S]*Highest · lowest75% · 0%[\s\S]*Modules contributing2 \/ 2/);
  assert.match(await p.textContent('#t-results .ov-method'), /Equal weighting[\s\S]*a missed assessment = 0 %/);
  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'overall-results.png'), fullPage: true });
  // filters, search, sort
  await p.selectOption('#t-results .rs-show', 'partial');
  assert.deepStrictEqual(await p.$$eval('#t-results .rs-tbl tbody tr[data-student]', function (r) { return r.map(function (x) { return x.dataset.student; }); }), ['27010002']);
  await p.selectOption('#t-results .rs-show', 'all');
  await p.fill('#t-results .rs-q', 'carim');
  assert.deepStrictEqual(await p.$$eval('#t-results .rs-tbl tbody tr[data-student]', function (r) { return r.map(function (x) { return x.dataset.student; }); }), ['27010003']);
  await p.fill('#t-results .rs-q', '');
  await p.click('#t-results .rs-tbl th[data-k=overall]');
  assert.deepStrictEqual(await p.$$eval('#t-results .rs-tbl tbody tr[data-student]', function (r) { return r.map(function (x) { return x.dataset.student; }); }), ['27010001', '27010002', '27010003'], 'highest first');
  const ihId = await p.$eval('#t-results .rs-mod option:nth-child(3)', function (o) { return o.value; });
  await p.selectOption('#t-results .rs-mod', ihId);
  assert.match(await p.textContent('#t-results .rs-tbl thead'), /Inflammation/); assert.ok(!/Cell Injury/.test(await p.textContent('#t-results .rs-tbl thead')));
  await p.selectOption('#t-results .rs-mod', '');
  // drill-down
  await p.click('#t-results tr[data-student="27010001"] button');
  await p.waitForSelector('#t-results .rs-stu');
  assert.match(await p.textContent('#t-results .rs-stu'), /Overall assessment75%[\s\S]*Topic q1 \(60%\)[\s\S]*Topic q2 \(80%\)[\s\S]*70%/);
  // CSV = table
  const dl = function (sel) { return Promise.all([p.waitForEvent('download'), p.click(sel)]).then(function (x) { return x[0].path(); }).then(function (f) { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); }); };
  const all = (await dl('#t-results [data-a=csv]')).split(/\r\n/);
  assert.match(all[0], /^Student ID,Name,Status,Completion,Modules with results,Modules included,Modules with assessments,Calculation method,.*Overall assessment %$/);
  assert.strictEqual(all[1], '27010001,Amina Full,active,complete,2,2,2,equal,80,70,75');
  assert.strictEqual(all[2], '27010002,Basel Half,active,partial,2,2,2,equal,50,0,25', 'missed = 0');
  assert.strictEqual(all[3], '27010003,Carim None,active,none,2,2,2,equal,0,0,0');
  const one = await dl('#t-results .rs-stu [data-a=c]');
  assert.match(one, /27010001,Amina Full,OVERALL,,equal,75,/);
  const basel = await (async function () { await p.click('#t-results tr[data-student="27010002"] button'); await p.waitForFunction(function () { return /Basel/.test((document.querySelector('#t-results .rs-stu') || {}).textContent || ''); }); return p.textContent('#t-results .rs-stu'); })();
  assert.match(basel, /Missed assessments2[\s\S]*Topic q1 \(missed · 0%\)[\s\S]*Topic q2 \(missed · 0%\)/);
  // weighted: Cell Injury ×3 → (240 + 70) / 4 = 77.5
  await p.click('#t-results .rs-set summary');
  await p.check('#t-results input[name=rs-m][value=weighted]');
  await p.fill('#t-results input[data-m=cellinjury]', '3');
  await p.click('#t-results .rs-set [data-a=s]');
  await p.waitForFunction(function () { var r = document.querySelector('#t-results tr[data-student="27010001"]'); return r && /77\.5%/.test(r.textContent); }, null, { timeout: 15000 });
  assert.match(await p.textContent('#t-results .ov-method'), /Weighted average/);
  assert.match(await p.textContent('#t-results .ov-mods'), /weight 3[\s\S]*weight 1 \(default\)/);
  A('resSettings', { method: 'equal', weights: {} });
  assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
  await p.context().close();
});

test('Overall Pathology Attendance: every module together, all registered students, % and absence %, 75% warning, report, Excel / CSV / print, student card', { skip: SKIP }, async function () {
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, action + ' ' + JSON.stringify(r)); return r; };
  const sv = function (kind, record) { return A('dirSave', { kind: kind, record: record }).record; };
  A('dirGet');
  const inst = sv('institution', { name: 'Overall Test University', shortName: 'OTU' });
  const g = sv('group', { institutionId: inst.institutionId, name: 'Group O', academicYear: '2026-27', linkCode: 'ov-a' });
  sv('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' }); sv('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  const SP = { o1: 'pass-o1-xyz', o2: 'pass-o2-xyz', o3: 'pass-o3-xyz', o4: 'pass-o4-xyz' };
  A('rosterAdd', { groupId: g.groupId, mustChange: false, students: [
    { studentId: '26010001', name: 'وصال سليمان عوين', password: SP.o1 }, { studentId: '26010002', name: 'جبريل محمود حسين', password: SP.o2 },
    { studentId: '26010003', name: 'Rand Murad', password: SP.o3 }, { studentId: '26010004', name: 'Nader Kleib', password: SP.o4 }] });
  const pw = { '26010001': SP.o1, '26010002': SP.o2, '26010003': SP.o3, '26010004': SP.o4 };
  const dl = A('dirGet').deliveries.filter(function (d) { return d.groupId === g.groupId; });
  const ci = dl.filter(function (d) { return d.moduleId === 'cellinjury'; })[0], ih = dl.filter(function (d) { return d.moduleId === 'inflhealing'; })[0];

  const p = await page();
  await p.goto(url + '#/teacher'); await p.fill('#t-p', TPW); await p.click('form.card button[type=submit]');
  await dash(p, 'overall');
  await p.waitForSelector('#t-overall .ts-top select');
  await p.selectOption('#t-overall .ts-top select', g.groupId);
  // no class yet: the whole register is listed, nobody is "absent", nobody is warned
  await p.waitForFunction(function () { return document.querySelectorAll('#t-overall .ov-tbl tbody tr[data-student]').length === 4; });
  assert.deepStrictEqual(await p.$$eval('#t-overall .ov-tbl tbody tr', function (r) { return r.map(function (x) { return x.cells[9].textContent; }); }), ['No sessions counted yet', 'No sessions counted yet', 'No sessions counted yet', 'No sessions counted yet']);
  assert.strictEqual(await p.$$eval('#t-overall .ov-tbl tr.ts-warn', function (r) { return r.length; }), 0);

  // classes: two Teaching Sessions + two classes whose attendance was taken INSIDE the modules
  const ts = function (title, d, marks) {
    const s = A('tsStart', { session: { groupId: g.groupId, deliveryId: d.deliveryId, title: title, startAt: Date.now() } });
    Object.keys(marks).forEach(function (id) { A('tsMark', { tsId: s.session.tsId, studentId: id, mark: marks[id] }); });
    A('tsClose', { tsId: s.session.tsId });
  };
  const inModule = function (storage, title, ids) {
    main.call({ module: storage, action: 'setup', password: 'teacher-' + storage + '-1' });
    const tok = main.call({ module: storage, action: 'login', password: 'teacher-' + storage + '-1' }).token;
    const s = main.call({ module: storage, action: 'startAttendanceSession', token: tok, sessionTitle: title }); assert.ok(s.ok, JSON.stringify(s));
    ids.forEach(function (id) {
      const st = main.call({ module: storage, action: 'studentLogin', username: id, password: pw[id] }).token;
      assert.ok(main.call({ module: storage, action: 'submitAttendanceByCode', stoken: st, code: s.code }).ok);
    });
    assert.ok(main.call({ module: storage, action: 'closeAttendanceSession', token: tok, sessionId: s.sessionId }).ok);
  };
  ts('L1 Cell injury', ci, { 26010001: 'present', 26010002: 'present', 26010003: 'present' });
  inModule(ci.backendModule, 'M1 inside Cell Injury', ['26010001']);
  inModule(ih.backendModule, 'M2 inside Inflammation', ['26010001', '26010002', '26010003']);
  ts('L2 Inflammation', ih, { 26010001: 'present', 26010003: 'late' });
  await p.click('#t-overall [data-a=r]');
  await p.waitForFunction(function () { var c = document.querySelector('#t-overall .ov-kpi b'); return c && /Sessions counted/.test(document.querySelector('#t-overall .ov-kpis').textContent) && document.querySelectorAll('#t-overall .ov-kpi')[1].textContent.indexOf('4') >= 0; });
  // sorted as the previous report: lowest % first; columns attended · late · excused · absent · counted · attendance · absence
  const rows = await p.$$eval('#t-overall .ov-tbl tbody tr', function (r) { return r.map(function (x) { return [x.dataset.student].concat([2, 3, 4, 5, 6, 7, 8].map(function (i) { return x.cells[i].textContent; })).concat([x.classList.contains('ts-warn') ? 'warn' : '', x.cells[9].textContent]); }); });
  assert.deepStrictEqual(rows, [
    ['26010004', '0', '0', '0', '4', '4', '0%', '100%', 'warn', '⚠ Below 75%'],
    ['26010002', '2', '0', '0', '2', '4', '50%', '50%', 'warn', '⚠ Below 75%'],
    ['26010003', '3', '1', '0', '1', '4', '75%', '25%', '', '✓ 75% or above'],
    ['26010001', '4', '0', '0', '0', '4', '100%', '0%', '', '✓ Full attendance']]);
  assert.match(await p.textContent('#t-overall .ov-kpis'), /Class attendance56%[\s\S]*Class absence44%[\s\S]*Below 75%⚠ 2/);
  assert.match(await p.textContent('#t-overall .ov-mods'), /Cell Injury[^·]*· 2 sessions[\s\S]*Inflammation[^·]*· 2 sessions/);
  // module-by-module: 26010002 → Cell Injury 1/2 (50 %), Inflammation 1/2 (50 %)
  assert.match(await p.textContent('#t-overall .ov-modtbl'), /جبريل محمود حسين 26010002\s*1\/2 · 50%\s*1\/2 · 50%\s*50% ⚠/);
  // the dashboard card shows the warning count
  await p.click('.dash-view[data-view=overall] .dv-back');
  await p.waitForSelector('.dash-grid', { state: 'visible' });
  await p.waitForFunction(function () { return /⚠ 2 below 75%/.test(document.querySelector('.dash-card[data-view=overall]').textContent); });
  assert.match(await p.textContent('.dash-card[data-view=overall] .dc-sum'), /Group O[\s\S]*4 students · 4 sessions in 2 modules/);
  await dash(p, 'overall');
  // filter: only the students below 75 %
  await p.selectOption('#t-overall .ov-show', 'warn');
  assert.deepStrictEqual(await p.$$eval('#t-overall .ov-tbl tbody tr', function (r) { return r.map(function (x) { return x.dataset.student; }); }), ['26010004', '26010002']);
  await p.fill('#t-overall .ov-q', 'جبريل');
  assert.deepStrictEqual(await p.$$eval('#t-overall .ov-tbl tbody tr', function (r) { return r.map(function (x) { return x.dataset.student; }); }), ['26010002']);
  // the individual report
  await p.click('#t-overall tr[data-student="26010002"] button');
  await p.waitForSelector('#t-overall .ov-stu');
  const det = await p.textContent('#t-overall .ov-stu');
  assert.match(det, /⚠ Attendance is below 75% \(50%\)/);
  assert.match(det, /All modules\s*2\s*0\s*0\s*2\s*4\s*50%\s*50%/);
  assert.match(det, /M1 inside Cell Injury❌ Absent/); assert.match(det, /L1 Cell injury \(Teaching Session\)✅ Present/);
  await p.fill('#t-overall .ov-q', ''); await p.selectOption('#t-overall .ov-show', 'all');

  // CSV: the reference columns of the previous report first, then Absence % and Status
  const [dc] = await Promise.all([p.waitForEvent('download'), p.click('#t-overall [data-a=csv]')]);
  assert.match(dc.suggestedFilename(), /^overall-attendance-ov-a-\d{4}-\d\d-\d\d\.csv$/);
  const csvTxt = fs.readFileSync(await dc.path(), 'utf8');
  const lines = csvTxt.replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(lines[0], 'Student ID,Name,Attended,Late,Excused,Absent,Lectures counted,Attendance %,Below 75%,Absence %,Status');
  assert.strictEqual(lines[1], '26010004,Nader Kleib,0,0,0,4,4,0,yes,100,Below 75% — attendance warning');
  assert.strictEqual(lines[3], '26010003,Rand Murad,3,1,0,1,4,75,,25,Attended some');
  // Excel: a real .xlsx (opened with unzip; the Overall sheet has the same rows, the warning rows are shaded)
  const [dx] = await Promise.all([p.waitForEvent('download'), p.click('#t-overall [data-a=xlsx]')]);
  assert.match(dx.suggestedFilename(), /\.xlsx$/);
  const xp = await dx.path(), cp = require('child_process');
  const list = cp.execFileSync('unzip', ['-Z1', xp]).toString().trim().split('\n').sort();
  assert.deepStrictEqual(list, ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml', 'xl/worksheets/sheet5.xml']);
  assert.ok(cp.spawnSync('unzip', ['-tq', xp]).status === 0, 'archive CRCs are valid');
  const wb = cp.execFileSync('unzip', ['-p', xp, 'xl/workbook.xml']).toString();
  assert.match(wb, /name="Overall"[\s\S]*name="By module"[\s\S]*name="Sessions"[\s\S]*name="Register"[\s\S]*name="Report info"/);
  const s1 = cp.execFileSync('unzip', ['-p', xp, 'xl/worksheets/sheet1.xml']).toString();
  assert.match(s1, /<row r="2"><c r="A2" s="2" t="inlineStr"><is><t xml:space="preserve">26010004<\/t><\/is><\/c>/);
  assert.match(s1, /<c r="H5"><v>100<\/v><\/c>/, 'percentages are numbers');
  assert.ok(s1.indexOf('وصال سليمان عوين') > 0, 'Arabic names kept');
  if (process.env.XLSX_OUT) fs.copyFileSync(xp, process.env.XLSX_OUT);
  // print-friendly report (hidden frame)
  await p.click('#t-overall [data-a=print]');
  await p.waitForFunction(function () { var f = document.querySelector('iframe.ov-print'); return f && f.contentDocument && /Overall Pathology Attendance Report/.test(f.contentDocument.body.textContent); });
  const pr = await p.evaluate(function () { var d = document.querySelector('iframe.ov-print').contentDocument; return { text: d.body.textContent, warn: d.querySelectorAll('tr.warn').length, html: d.documentElement.outerHTML }; });
  assert.match(pr.text, /OTU · Group O \(2026-27\)/); assert.match(pr.text, /Students below 75% \(2\)/); assert.match(pr.text, /Head of Department/);
  assert.strictEqual(pr.warn, 4, '2 students × (class table + module table)');
  if (process.env.SHOTS) {
    fs.writeFileSync(path.join(process.env.SHOTS, 'overall-print.html'), pr.html);
    await p.screenshot({ path: path.join(process.env.SHOTS, 'overall.png'), fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: path.join(process.env.SHOTS, 'overall-phone.png'), fullPage: true });
    await p.setViewportSize({ width: 1280, height: 900 });
  }
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'fits a phone');
  await p.context().close();

  // the student's group page: the overall figure with the same warning (shown, never sent)
  const q = await page();
  await q.goto(url + '?g=ov-a'); await signIn(q, '26010002', SP.o2);
  await q.waitForFunction(function () { var e = document.querySelector('#ts-stu .ts-att-card'); return e && /50%/.test(e.textContent); }, null, { timeout: 15000 });
  const mine = await q.textContent('#ts-stu .ts-att-card');
  assert.match(mine, /My attendance — all pathology modules/);
  assert.match(mine, /50%attended50% absent/);
  assert.match(mine, /2 of 4 session\(s\) attended · 2 absent · ⚠ below 75% — please talk to your teacher/);
  assert.match(mine, /Cell Injury[^1]*1\/2 · 50%/);
  assert.ok(await q.$eval('#ts-stu .ts-mine', function (e) { return e.classList.contains('warn-t'); }));
  // redesign: slim welcome strip with the attendance chip; compact modules BEFORE the sessions panel; history folded away
  assert.ok(await q.$eval('.hero', function (e) { return e.classList.contains('slim'); }));
  assert.match(await q.textContent('.hero .att-chip'), /Attendance 50% · ⚠ below 75%/);
  assert.ok(await q.evaluate(function () { var g = document.querySelector('.grid.compact'), t = document.querySelector('#ts-stu'); return !!(g && t && (g.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)); }), 'modules first');
  assert.strictEqual(await q.$eval('#ts-stu details.ts-hist', function (d) { return d.open; }), false, 'history collapsed');
  assert.match(await q.textContent('#ts-stu details.ts-hist summary'), /Session history — 4 sessions[\s\S]*✅ 2 · ❌ 2/);
  assert.ok(!(await q.isVisible('#ts-stu .ts-hl')));
  await q.click('#ts-stu details.ts-hist summary');
  assert.strictEqual(await q.$$eval('#ts-stu .ts-h', function (x) { return x.length; }), 4);
  await q.click('.hero .att-chip');
  if (process.env.SHOTS) {
    await q.click('#ts-stu details.ts-hist summary');
    await q.evaluate(function () { window.scrollTo({ top: 0, behavior: 'instant' }); });
    await q.screenshot({ path: path.join(process.env.SHOTS, 'student-home.png'), fullPage: true });
    await q.setViewportSize({ width: 390, height: 844 }); await q.screenshot({ path: path.join(process.env.SHOTS, 'student-home-phone.png'), fullPage: true });
    assert.ok(await q.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'student page fits a phone');
  }
  await q.context().close();
  const q2 = await page();
  await q2.goto(url + '?g=ov-a'); await signIn(q2, '26010003', SP.o3);
  await q2.waitForFunction(function () { var e = document.querySelector('#ts-stu .ts-att-card'); return e && /75%/.test(e.textContent); }, null, { timeout: 15000 });
  assert.ok(!/below/.test(await q2.textContent('#ts-stu .ts-mine')), '75 % is not below 75 %');
  await q2.context().close();
  main.call({ module: 'portal', action: 'logout', token: t });
});

/* ---------------- Student homepage: curricular module order + Exams & Assessments (2.17) ---------------- */
test('student homepage: modules in curricular order (front-page list), Official Exams in its own section below them — also after a new module is added', { skip: SKIP }, async function () {
  groupFixture();   // the Al-Razi test group (tr-a) — to check that other groups are untouched
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const A = function (action, o) { const r = main.call(Object.assign({ module: 'portal', action: action, token: t }, o || {})); assert.ok(r.ok, action + ' ' + JSON.stringify(r)); return r; };
  const sv = function (kind, record, extra) { return A('dirSave', Object.assign({ kind: kind, record: record }, extra || {})).record; };
  const have = A('dirGet').modules.map(function (m) { return m.moduleId; });
  const mod = function (r) { if (have.indexOf(r.moduleId) < 0) { sv('module', r, { create: true }); have.push(r.moduleId); } };
  mod({ moduleId: 'intropath', title: 'Introduction to Pathology', url: 'https://third-year-med.github.io/introduction-to-pathology/', storagePrefix: 'ip_' });
  mod({ moduleId: 'exams', title: 'Official Exams', url: 'https://third-year-med.github.io/pathology-exams/', storagePrefix: 'xm_', icon: '📝' });
  // as in the real Code.gs (HANDBOOK §5): these modules have student accounts
  main.ctx.STUDENT_AUTH_MODULES.intropath = true; main.ctx.STUDENT_AUTH_MODULES.neotest = true;
  const inst = sv('institution', { name: 'Order Test University', shortName: 'OTU2' });
  const g = sv('group', { institutionId: inst.institutionId, name: 'Group R', academicYear: '2026-27', linkCode: 'ord-a' });
  // delivered in the "wrong" order, as on the live platform: Introduction only after Official Exams
  ['cellinjury', 'inflhealing', 'exams', 'intropath'].forEach(function (m) { sv('delivery', { groupId: g.groupId, moduleId: m, status: 'available' }); });
  A('rosterAdd', { groupId: g.groupId, mustChange: false, students: [{ studentId: 'ord1', name: 'Order Student', password: 'order-pass-1' }] });
  const teachIds = function (p) { return p.$$eval('main > .grid:not(.exams-grid) .mod', function (x) { return x.map(function (e) { return e.dataset.id; }); }); };

  // before sign-in: the same order, the exams in their own section
  const p = await page();
  await p.goto(url + '?g=ord-a');
  await p.waitForSelector('main > .grid .mod');
  assert.deepStrictEqual(await teachIds(p), ['intropath', 'cellinjury', 'inflhealing']);
  assert.deepStrictEqual(await p.$$eval('.exams-sec .mod', function (x) { return x.map(function (e) { return e.dataset.id; }); }), ['exams']);
  assert.match(await p.textContent('.hero .facts'), /3 chapters/);
  // signed in
  await signIn(p, 'ord1', 'order-pass-1');
  await p.waitForSelector('.card.welcome');
  await p.waitForSelector('#ts-stu:not([hidden])');
  assert.deepStrictEqual(await teachIds(p), ['intropath', 'cellinjury', 'inflhealing']);
  assert.match(await p.textContent('.mods-head h2'), /My learning modules/);
  assert.match(await p.textContent('.exams-sec h2'), /Exams & Assessments/);
  assert.match(await p.textContent('.card.welcome'), /You can open 3 of the 3 available modules/, 'the exam card is not counted as a module');
  // page order: welcome → modules → exams → teaching sessions
  const order = await p.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('main > .hero, main > .mods-head, main > .grid, main > .exams-sec, main > #ts-stu'), function (e) { return e.id || e.className.split(' ')[0]; }); });
  assert.deepStrictEqual(order, ['hero', 'sec-head', 'grid', 'exams-sec', 'ts-stu']);
  // links and access unchanged: a module opens in the group's storage; the exam card links to the exam page
  const before = navigations.length;
  await p.click('main > .grid .mod[data-id="intropath"] .go');
  await p.waitForTimeout(300);
  assert.ok(navigations.slice(before).some(function (u) { return /introduction-to-pathology\/\?g=ord-a$/.test(u); }), navigations.slice(before).join(' '));
  await p.goto(url + '?g=ord-a'); await p.waitForSelector('.exams-sec .mod.exam a.btn');
  assert.match(await p.getAttribute('.exams-sec .mod.exam a.btn', 'href'), /pathology-exams\//);

  // a teaching module added LATER (after Official Exams): it joins the module grid; Official Exams stays apart
  mod({ moduleId: 'neotest', title: 'Neoplasia (test)', url: 'https://third-year-med.github.io/neo-test/', storagePrefix: 'nt_', icon: '🧬' });
  sv('delivery', { groupId: g.groupId, moduleId: 'neotest', status: 'available' });
  A('rosterSync', { groupId: g.groupId });
  await p.reload(); await p.waitForSelector('#ts-stu:not([hidden])');
  assert.deepStrictEqual(await teachIds(p), ['intropath', 'cellinjury', 'inflhealing', 'neotest']);
  assert.deepStrictEqual(await p.$$eval('.exams-sec .mod', function (x) { return x.map(function (e) { return e.dataset.id; }); }), ['exams']);
  assert.strictEqual(await p.$('main > .grid:not(.exams-grid) .mod.exam'), null, 'never inside the module grid');
  // its place comes from the front-page list (Teacher Management): moved after Cell Injury there → the page follows
  const reg = main.call({ module: 'portal', action: 'portalInfo' }).modules;
  const list = reg.slice(); list.splice(list.findIndex(function (m) { return m.id === 'cellinjury'; }) + 1, 0, { id: 'neotest', title: 'Neoplasia (test)', status: 'available', url: 'https://third-year-med.github.io/neo-test/', moduleKey: 'neotest', handoff: 'neo', storagePrefix: 'nt_' });
  A('portalAdminSave', { modules: list });
  await p.reload(); await p.waitForSelector('#ts-stu:not([hidden])');
  assert.deepStrictEqual(await teachIds(p), ['intropath', 'cellinjury', 'neotest', 'inflhealing']);
  // group separation: another group's page is unchanged
  const other = main.call({ module: 'portal', action: 'portalGroupInfo', g: 'tr-a' }); assert.ok(other.ok, JSON.stringify(other));
  assert.ok(!other.modules.some(function (m) { return m.id === 'neotest'; }));
  assert.deepStrictEqual(other.modules.filter(function (m) { return m.id !== 'exams'; }).map(function (m) { return m.id; }), ['cellinjury', 'inflhealing']);
  // desktop, tablet and phone: no sideways scrolling
  for (const vp of [[1280, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone']]) {
    await p.setViewportSize({ width: vp[0], height: vp[1] });
    await p.waitForTimeout(150);
    assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, vp[2] + ' fits');
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'student-order-' + vp[2] + '.png'), fullPage: true });
  }
  // restore the front-page list for the other tests
  A('portalAdminSave', { modules: reg });
  await p.context().close();
  main.call({ module: 'portal', action: 'logout', token: t });
});

/* ---------------- Assessments sign-in + Learning lock (2.18) on the REAL module page ----------------
   The real cell-injury index.html (app code, sign-in gate, platform block) with a small synthetic course encrypted with a
   throwaway key — so these tests run without the real content keys. Code.gs's student assessment routes are not in the
   test copy of Code.gs, so getMyAssessments is answered by a stub that records what the page sent. */
const CI_PAGE = [process.env.CI_MODULE_HTML, '/home/user/repos/cell-injury-teaching-platform/index.html', '/home/user/cell-injury-teaching-platform/index.html'].filter(function (f) { return f && fs.existsSync(f); })[0];
function syntheticModule(file, extra) {
  const crypto = require('crypto');
  const data = Object.assign({ course: { title: 'Cell Injury (test course)', chapter: 'Chapter T', author: 'Test Author', subtitle: 'Test', storagePrefix: 'ci_', moduleKey: 'cellinjury', fileStem: 'test', defaultQuizPassword: 'QUIZ-1', localTeacherPassword: 'x' },
    topics: [], questions: [], glossary: [], images: {}, imageProviders: {}, diagrams: {}, figures: {}, comparisons: [], sequences: [], cases: [], caseLevels: [], quizIds: [] }, extra || {});
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final(), c.getAuthTag()]);
  const html = fs.readFileSync(file, 'utf8').replace(/(<script id="neo-enc"[^>]*>)([\s\S]*?)(<\/script>)/, function (m, a, b, z) { return a + JSON.stringify({ iv: iv.toString('base64'), ct: ct.toString('base64') }) + z; });
  return { html: html, key: key.toString('base64') };
}
async function openSyntheticModule(p, mod, assessCalls, opts) {
  opts = opts || {};
  await p.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
  await p.route('https://script.google.com/**', async function (route) {   // registered last → asked first
    const q = JSON.parse(route.request().postData() || '{}');
    if (q.action === 'getMyAssessments' && opts.stubAssess !== false) {   // an OLDER class server: the class password for the list
      assessCalls.push(q);
      const body = q.password ? { ok: true, items: [] } : { ok: false, code: 'badpw', error: 'Incorrect quiz password.' };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    }
    return route.fallback();
  });
  await p.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a');
  await p.waitForSelector('#nb-user');
  await p.fill('#nb-user', 'ahmed'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]');
  await p.waitForSelector('.nav-btn[data-view="quiz"]', { timeout: 20000 });
}

test('module Assessments (2.18, older server): if the server still wants the class password, a signed-in student enters only that password; identity from the account', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    const p = await page(), calls = [];
    await openSyntheticModule(p, mod, calls);
    await p.evaluate(function () { location.hash = '#/quiz'; });
    await p.waitForSelector('#view-quiz #quiz-pw');
    const gate = await p.textContent('#view-quiz');
    assert.strictEqual(await p.$$eval('#view-quiz input', function (x) { return x.length; }), 1, 'only the password field');
    assert.ok(!/Full name|Email address/.test(gate), gate);
    assert.match(gate, /My Assessments — Cell Injury \(test course\)/);
    assert.match(gate, /Enter the assessment password provided by your teacher\./);
    assert.match(gate, /Assessment password/);
    assert.match(gate, /Signed in as Student Ahmed \(Student ID ahmed\)/);
    await p.click('#view-quiz button.btn-primary');
    await p.waitForFunction(function () { return /password/.test(document.querySelector('#view-quiz [role=status]').textContent); });   // empty password is refused
    await p.fill('#quiz-pw', 'QUIZ-1'); await p.press('#quiz-pw', 'Enter');
    await p.waitForFunction(function () { return /Student ID ahmed/.test(document.querySelector('#view-quiz').textContent) && !document.querySelector('#quiz-pw'); });
    const withPw = calls.filter(function (c) { return c.password; });
    assert.strictEqual(withPw.length, 1);
    assert.deepStrictEqual([withPw[0].email, withPw[0].password, !!withPw[0].stoken], ['ahmed@student.local', 'QUIZ-1', true], 'the account identity + the signed-in session');
    const dashTxt = await p.textContent('#view-quiz');
    assert.match(dashTxt, /Student Ahmed · Student ID ahmed/); assert.ok(!/Not you\? Switch/.test(dashTxt));
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'module-assess-dashboard.png') });
    // the gate again (password forgotten in this tab): still only the password
    await p.evaluate(function () { sessionStorage.clear(); });
    await p.reload(); await p.waitForSelector('#nb-user, .nav-btn[data-view="quiz"]');
    if (await p.$('#nb-user')) { await p.fill('#nb-user', 'ahmed'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]'); await p.waitForSelector('.nav-btn[data-view="quiz"]'); }
    await p.evaluate(function () { location.hash = '#/quiz'; }); await p.waitForSelector('#view-quiz #quiz-pw');
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'module-assess-gate.png') });
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await p.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('Attendance (signed-in student): the page asks ONLY for the code — name, ID and email come from the account; the record carries them; no Teacher / Class server buttons in the header', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    main.call({ module: 'portal', action: 'setup', password: TPW });   // the module's own Attendance tab is shown (as in the user's set-up)
    assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: main.call({ module: 'portal', action: 'login', password: TPW }).token, hideModuleLive: false }).ok);
    const ses = main.call({ module: ST, action: 'startAttendanceSession', token: tok, sessionTitle: 'L3: Code only', course: 'Cell Injury', academicYear: '2026-2027', teacher: 'Dr. Test' });
    assert.ok(ses.ok, JSON.stringify(ses));
    const s = await page(), none = [];
    await openSyntheticModule(s, mod, none, { stubAssess: false });
    // the header of a signed-in student: no Teacher sign-in link and no "Class server" chip (both open teacher pages); the student menu stays
    assert.strictEqual(await s.$('#hdr-right .ux-teacher-link'), null, 'no Teacher link');
    assert.ok(!/Class server|Teacher/.test(await s.textContent('#hdr-right')), await s.textContent('#hdr-right'));
    assert.match(await s.textContent('#hdr-right'), /🎓 Student/);
    await s.evaluate(function () { location.hash = '#/attendance'; });
    await s.waitForSelector('#view-attendance input[aria-label="Attendance code"]', { timeout: 15000 });
    const card = await s.textContent('#view-attendance .card');
    assert.ok(!/Your full name|Student ID \(optional\)|Email \(optional\)/.test(card), card);
    assert.strictEqual(await s.$$eval('#view-attendance .card input', function (x) { return x.length; }), 1, 'one field: the code');
    assert.match(card, /👤 Student Ahmed · Student ID ahmed/);
    assert.ok(!/@student\.local/.test(card));
    if (process.env.SHOTS) await (await s.$('#view-attendance .card')).screenshot({ path: path.join(process.env.SHOTS, 'student-attendance-code.png') });
    await s.fill('#view-attendance input[aria-label="Attendance code"]', ses.code.toLowerCase());
    await s.press('#view-attendance input[aria-label="Attendance code"]', 'Enter');
    await s.waitForFunction(function () { return /Attendance recorded/.test(document.querySelector('#view-attendance').textContent); }, null, { timeout: 15000 });
    const rec = main.ctx.rpRows_('AttendanceRecords').filter(function (q) { return q.sessionId === ses.sessionId; });
    assert.strictEqual(rec.length, 1);
    assert.deepStrictEqual([rec[0].studentName, rec[0].studentId], ['Student Ahmed', 'ahmed']);
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await s.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('Two tabs of one module (shared browser copy): an item one tab received is never lost when the other tab saves — each tab syncs from its own cursor', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });   // ONE browser profile, several tabs
    await ctx.route('https://script.google.com/**', async function (route) {
      const out = main.ctx.doPost({ postData: { contents: route.request().postData() || '' } }).getContent();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
    });
    ctx.on('page', function (pg) { pg.on('pageerror', function (e) { errors.push(e.message); }); pg.on('dialog', function (d) { d.accept(); }); });
    const a = await ctx.newPage();
    await ctx.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await ctx.addInitScript(function (o) { try { if (!localStorage.getItem('ci_tr-a_backend_token_v1')) localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    const URL = 'https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/assessments';
    const ready = function (p) { return p.waitForFunction(function () { return typeof Backend !== 'undefined' && Backend.syncedThisSession; }, null, { timeout: 20000 }); };
    await a.goto(URL); await ready(a);
    const b = await ctx.newPage(); await b.goto(URL); await ready(b);
    const has = function (p) { return p.evaluate(function () { return (State.assessments || []).some(function (x) { return x.id === 'tabtest'; }); }); };
    await a.waitForLoadState('networkidle'); await b.waitForLoadState('networkidle'); await b.waitForTimeout(1500);   // both tabs quiet (no check of their own in between)
    // an assessment arrives on the server (created on another device / in another tab)
    assert.ok(main.call({ module: ST, action: 'upsert', token: tok, collection: 'assessments', id: 'tabtest', data: { id: 'tabtest', title: 'Tab test', status: 'draft', questionIds: [] } }).ok);
    await a.evaluate(function () { return Backend.syncFromBackend(); });          // tab A receives it (and moves the saved time on)
    assert.ok(await has(a));
    await b.evaluate(function () { return Backend.syncFromBackend(); });          // tab B must still receive it…
    assert.ok(await has(b), 'the other tab receives it too (its own cursor)');
    await b.evaluate(function () { State.hiddenTopics = State.hiddenTopics; saveStateField('hiddenTopics'); });   // …and B saving never drops it
    await a.reload(); await ready(a);
    assert.ok(await has(a), 'still in the teacher library after a reload');
    // a tab whose copy is older than the saved time: its partial save lowers the saved time, so the next load fetches the gap
    assert.ok(main.call({ module: ST, action: 'upsert', token: tok, collection: 'assessments', id: 'tabtest2', data: { id: 'tabtest2', title: 'Tab test 2', status: 'draft', questionIds: [] } }).ok);
    await a.evaluate(function () { return Backend.syncFromBackend(); });
    await b.evaluate(function () { saveStateField('hiddenTopics'); });         // B has not synced since: its saved field is older
    const c = await ctx.newPage(); await c.goto(URL); await ready(c);
    assert.ok(await c.evaluate(function () { return (State.assessments || []).some(function (x) { return x.id === 'tabtest2'; }); }), 'a new tab gets the item');
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await ctx.close();
    ['tabtest', 'tabtest2'].forEach(function (id) { main.call({ module: ST, action: 'delete', token: tok, collection: 'assessments', id: id }); });   // leave the shared test storage as found
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('📤 Copy to groups (2.21): the teacher copies an assessment from Al-Razi A to Misrata A — published, assigned, same password; the other group\'s student can take it', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', MS = 'cellinjury-tm-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const up = function (c, id, data) { const r = main.call({ module: ST, action: 'upsert', token: tok, collection: c, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); };
    const q = { id: 'x1', type: 'tf', stem: 'Apoptosis needs energy.', answer: true, explanation: 'ATP-dependent.' };
    up('assessments', 'cg1', { id: 'cg1', title: 'Group copy quiz', status: 'published', publishedVersion: 1, mode: 'fixed', questionIds: ['x1'] });
    up('assessmentversions', 'cg1@1', { assessmentId: 'cg1', version: 1, title: 'Group copy quiz', mode: 'fixed', questionIds: ['x1'], settings: { showScore: true }, questions: { x1: q } });
    main.ctx.assessStore_(ST).put('assignment', 'asg-cg1', { id: 'asg-cg1', assessmentId: 'cg1', assessmentTitle: 'Group copy quiz', targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
    assert.ok(main.call({ module: ST, action: 'aePwSet', token: tok, assessmentId: 'cg1', password: 'Apop-77' }).ok);
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/assessments');
    const row = '.data-table tr:has(a:has-text("Group copy quiz"))';
    await t.waitForSelector(row + ' [data-a=copy-groups]', { timeout: 20000 });
    await t.click(row + ' [data-a=copy-groups]');
    await t.waitForSelector('.modal .cg-row');
    const dlg = await t.textContent('.modal');
    assert.match(dlg, /Copy “Group copy quiz” from Test Razi · Group A[\s\S]*Test Misrata · Group A[\s\S]*new[\s\S]*Publish it in each group[\s\S]*Assign it to everyone[\s\S]*same dates[\s\S]*the same as here/);
    assert.ok(!/Test Razi · Group A \(2026-27\)new/.test(dlg), 'not offered to copy into itself');
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'copy-to-groups.png') });
    // only Misrata A (other tests may have added more groups with this module)
    await t.$$eval('.modal .cg-row', function (rows) { rows.forEach(function (r) { var i = r.querySelector('input'); if (!i.disabled) i.checked = /Test Misrata · Group A/.test(r.textContent); }); });
    await t.click('.modal .modal-foot .btn-primary');
    await t.waitForFunction(function () { var m = document.querySelector('.modal'); return m && /Copied to 1 of 1 group/.test(m.textContent); }, null, { timeout: 20000 });
    assert.match(await t.textContent('.modal'), /✓ Test Misrata · Group A[\s\S]*published · assigned to everyone · same password/);
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'copy-to-groups-done.png') });
    // the Misrata student sees it and starts it with the same password
    main.addStudents(MS, [{ username: 'cgstu', name: 'Copy Student', password: PW, mustChange: false }]);   // its own student (other tests change Sara's password)
    const ss = main.call({ module: MS, action: 'studentLogin', username: 'cgstu', password: PW }).token;
    const my = main.call({ module: MS, action: 'getMyAssessments', stoken: ss });
    assert.ok(my.items.some(function (i) { return i.assessment.id === 'cg1' && i.passwordSet; }), JSON.stringify(my).slice(0, 400));
    const asg = my.items.filter(function (i) { return i.assessment.id === 'cg1'; })[0].assignment.id;
    assert.ok(main.call({ module: MS, action: 'startAttempt', stoken: ss, assignmentId: asg, password: 'apop-77' }).ok);
    // copy again: Misrata is now "kept" (a student has started it) and cannot be ticked
    await t.click('.modal .modal-foot .btn-primary');
    await t.click(row + ' [data-a=copy-groups]');
    await t.waitForSelector('.modal .cg-row');
    const ms = '.modal .cg-row:has-text("Test Misrata · Group A")';
    assert.match(await t.textContent(ms), /students have started it there — kept as it is/);
    assert.strictEqual(await t.$eval(ms + ' input', function (i) { return i.disabled; }), true);
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await t.context().close();
  } finally {
    main.ctx.CONTENT_KEYS.cellinjury = keep;
    [ST, MS].forEach(function (st) {   // leave the shared test storages as found (other tests count assessments / passwords)
      ['assessments', 'assessmentversions'].forEach(function (c) { main.ctx.rpRows_('Content').forEach(function (r) { if (r.module === st && /^cg1/.test(String(r.id)) && r.collection === c) main.ctx.actionDelete_(st, { collection: c, id: r.id }); }); });
      main.ctx.setSetting_('apw:' + st, JSON.stringify(Object.fromEntries(Object.entries(main.ctx.apwMap_(st)).filter(function (e) { return e[0] !== 'cg1'; }))));
      main.ctx.assessStore_(st).list('assignment').forEach(function (a) { if (a.assessmentId === 'cg1') main.ctx.assessStore_(st).del('assignment', a.id); });
    });
  }
});

test('⚡ Topic quizzes: one quiz per topic (pool of its practice questions, 5 random per student, 5 min, 1 attempt, answers shown, random password), assigned, copied to the other groups; small topics skipped; a second run keeps them', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const qs = [], tf = function (topic, i) { return { id: topic + '-q' + i, type: 'tf', topic: topic, stem: 'Statement ' + i + ' of ' + topic + '.', answer: i % 2 === 0, explanation: 'Because.' }; };
  for (let i = 1; i <= 7; i++) qs.push(tf('tA', i));
  for (let i = 1; i <= 3; i++) qs.push(tf('tB', i));
  for (let i = 1; i <= 5; i++) qs.push(tf('tC', i));
  qs.push({ id: 'tA-short', type: 'short', topic: 'tA', stem: 'Explain.', model: 'x' });   // short answer: never in a quiz
  const topics = [{ id: 'tA', title: 'Cell adaptations', sections: [] }, { id: 'tB', title: 'Tiny topic', sections: [] }, { id: 'tC', title: 'Cell death', sections: [] }];
  const ST = 'cellinjury-tr-a', MS = 'cellinjury-tm-a', mod = syntheticModule(CI_PAGE, { topics: topics, questions: qs }), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  const autos = function (st) { return main.ctx.rpRows_('Content').filter(function (r) { return r.module === st && r.collection === 'assessments' && !main.ctx.isTrue_(r.deleted); }).map(function (r) { return main.ctx.unpackJson_(r); }).filter(function (a) { return a && a.autoTopic; }); };
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/assessments');
    await t.waitForSelector('[data-a=topic-quizzes]', { timeout: 20000 });
    await t.click('[data-a=topic-quizzes]');
    await t.waitForSelector('.modal .tq');
    const plan = await t.textContent('.modal');
    assert.match(plan, /5 random questions[\s\S]*5 minutes[\s\S]*1 attempt[\s\S]*1Cell adaptations7✓ new quiz[\s\S]*2Tiny topic3⏭ skipped — fewer than 5 questions[\s\S]*3Cell death5✓ new quiz/);
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'topic-quizzes.png') });
    await t.click('.modal .modal-foot .btn-primary');
    await t.waitForFunction(function () { var m = document.querySelector('.modal'); return m && /Topic quizzes — done/.test(m.textContent); }, null, { timeout: 60000 });
    const rep = await t.textContent('.modal');
    assert.match(rep, /✓ Created 2: Topic 1, Topic 3[\s\S]*Skipped \(fewer than 5 questions\): Topic 2 — Tiny topic \(3\)[\s\S]*Test Misrata · Group A \(2026-27\) — 2 copied/);
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'topic-quizzes-done.png') });
    // on the server: two pool quizzes with the requested settings, assigned to everyone, each with its own random password
    const a = autos(ST).sort(function (x, y) { return x.title.localeCompare(y.title); });
    assert.deepStrictEqual(a.map(function (x) { return x.title; }), ['Topic 1 quiz — Cell adaptations', 'Topic 3 quiz — Cell death']);
    a.forEach(function (x) {
      assert.deepStrictEqual([x.status, x.mode, x.poolCount, x.settings.timeLimitMin, x.settings.attemptsAllowed, x.settings.showScore, x.settings.showAnswers, x.settings.shuffleQuestions], ['published', 'pool', 5, 5, 1, true, true, true], x.title);
      assert.ok(x.questionIds.indexOf('tA-short') < 0, 'no short-answer question');
      assert.ok(main.ctx.assessStore_(ST).list('assignment').some(function (g) { return g.assessmentId === x.id && g.targetType === 'all' && g.status === 'active'; }), 'assigned');
      assert.match(main.ctx.apwMap_(ST)[x.id].pw, /^[A-Z2-9]{6}$/);
      assert.match(main.ctx.apwMap_(MS)[x.id].pw, /^[A-Z2-9]{6}$/);
    });
    assert.strictEqual(a[0].questionIds.length, 7);
    assert.notStrictEqual(main.ctx.apwMap_(ST)[a[0].id].pw, main.ctx.apwMap_(ST)[a[1].id].pw, 'a password per quiz');
    assert.strictEqual(autos(MS).length, 2, 'copied to Misrata A');
    // the student's list: topic quizzes in topic order (Topic 1 first), after any other assessment
    const sp = await page();
    await openSyntheticModule(sp, mod, [], { stubAssess: false });
    await sp.evaluate(function () { location.hash = '#/quiz'; });
    await sp.waitForSelector('#view-quiz details[data-group=todo] .assess-card', { timeout: 15000 });
    const order = (await sp.$$eval('#view-quiz details[data-group=todo] .assess-card h3', function (x) { return x.map(function (h) { return h.textContent; }); }));
    assert.deepStrictEqual(order.filter(function (t) { return /^Topic \d+ quiz/.test(t); }), ['Topic 1 quiz — Cell adaptations', 'Topic 3 quiz — Cell death']);
    assert.ok(/^Topic 3 quiz/.test(order[order.length - 1]), 'the last topic is last: ' + order.join(' | '));
    await sp.context().close();
    // a Misrata student starts Topic 1: exactly 5 questions out of the 7, timed 5 minutes
    main.addStudents(MS, [{ username: 'tqstu', name: 'Topic Student', password: PW, mustChange: false }]);
    const ss = main.call({ module: MS, action: 'studentLogin', username: 'tqstu', password: PW }).token;
    const it = main.call({ module: MS, action: 'getMyAssessments', stoken: ss }).items.filter(function (i) { return i.assessment.id === a[0].id; })[0];
    const st = main.call({ module: MS, action: 'startAttempt', stoken: ss, assignmentId: it.assignment.id, password: main.ctx.apwMap_(MS)[a[0].id].pw });
    assert.ok(st.ok, JSON.stringify(st));
    assert.strictEqual(st.attempt.questions.length, 5);
    assert.ok(st.attempt.questions.every(function (q) { return /^tA-q\d$/.test(q.id); }));
    assert.ok(st.attempt.deadlineAt && st.attempt.deadlineAt - Date.now() <= 5 * 60000 + 5000, 'timed: 5 minutes');
    // a second run: both exist (kept), nothing duplicated
    await t.click('.modal .modal-foot .btn-primary');
    await t.click('[data-a=topic-quizzes]'); await t.waitForSelector('.modal .tq');
    assert.match(await t.textContent('.modal'), /1Cell adaptations7• exists[\s\S]*3Cell death5• exists/);
    await t.click('.modal .modal-foot .btn-primary');
    await t.waitForFunction(function () { var m = document.querySelector('.modal'); return m && /Topic quizzes — done/.test(m.textContent); }, null, { timeout: 60000 });
    assert.match(await t.textContent('.modal'), /Already there, kept: Topic 1, Topic 3[\s\S]*1 copied, 1 kept \(students started\)/);
    assert.strictEqual(autos(ST).length, 2); assert.strictEqual(autos(MS).length, 2);
    assert.strictEqual(main.ctx.assessStore_(ST).list('assignment').filter(function (g) { return a.some(function (x) { return x.id === g.assessmentId; }); }).length, 2, 'no second assignment');
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await t.context().close();
  } finally {
    main.ctx.CONTENT_KEYS.cellinjury = keep;
    main.ctx.rpRows_('Content').forEach(function (r) {   // leave the shared test storages as found
      if (r.collection !== 'assessments' && r.collection !== 'assessmentversions') return;
      const d = main.ctx.unpackJson_(r) || {}, id = String(r.id).split('@')[0];
      const isAuto = d.autoTopic || autos(r.module).some(function (x) { return x.id === id; });
      if (isAuto && !main.ctx.isTrue_(r.deleted)) {
        main.ctx.assessStore_(r.module).list('assignment').forEach(function (g) { if (g.assessmentId === id) main.ctx.assessStore_(r.module).del('assignment', g.id); });
        main.ctx.assessStore_(r.module).list('attempt').forEach(function (g) { if (g.assessmentId === id) main.ctx.assessStore_(r.module).del('attempt', g.id); });   // a timed attempt would switch on the automatic learning lock
        main.ctx.llForget_(r.module);
        const m = main.ctx.apwMap_(r.module); if (m[id]) { delete m[id]; main.ctx.setSetting_('apw:' + r.module, JSON.stringify(m)); }
      }
    });
    main.ctx.rpRows_('Content').forEach(function (r) { if ((r.collection === 'assessmentversions' || r.collection === 'assessments') && !main.ctx.isTrue_(r.deleted)) { const id = String(r.id).split('@')[0]; const row = main.ctx.findContentRow_(r.module, 'assessments', id), d = row && main.ctx.unpackJson_(row); if (d && d.autoTopic) main.ctx.actionDelete_(r.module, { collection: r.collection, id: r.id }); } });
    main.ctx.rpRows_('Content').forEach(function (r) { if (r.collection === 'quizextra' && r.module === ST) main.ctx.actionDelete_(ST, { collection: 'quizextra', id: r.id }); });
  }
});

/* 🔒 Assessment-only question bank (Portal.gs 2.33, patch assess-bank): imported in the main copy, hidden from Practice,
   never sent to a student's browser, used by ⚡ Topic quizzes (bank first, ≥ 5 per topic) and by the server-built attempts. */
test('🔒 Assessment bank: import in the main copy → never in Practice / Revision, never in a student browser (content, sync, storage); ⚡ Topic quizzes take a topic with ≥ 5 bank questions from the bank; a student attempt gets bank questions from the server', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const qs = [], tf = function (topic, i) { return { id: topic + '-q' + i, type: 'tf', topic: topic, stem: 'Practice statement ' + i + ' of ' + topic + '.', answer: i % 2 === 0, explanation: 'Because.' }; };
  for (let i = 1; i <= 7; i++) qs.push(tf('tA', i));
  for (let i = 1; i <= 5; i++) qs.push(tf('tC', i));
  const topics = [{ id: 'tA', title: 'Cell adaptations', sections: [] }, { id: 'tC', title: 'Cell death', sections: [] }];
  const bq = []; for (let i = 1; i <= 6; i++) bq.push({ id: 'aqb_t_' + i, type: 'mcq', topic: 'tA', stem: 'BANKSTEM ' + i + ': which one?', options: ['One', 'Two', 'Three', 'Four'], answer: i % 4, explanation: 'BANKEXPL ' + i, difficulty: 2 });
  bq.push({ id: 'aqb_t_7', type: 'selectall', topic: 'tA', stem: 'BANKSTEM 7: select all.', options: ['A', 'B', 'C'], answers: [0, 2] });
  bq.push({ id: 'aqb_t_8', type: 'mcq', topic: 'tC', stem: 'BANKSTEM 8.', options: ['x', 'y'], answer: 0 }, { id: 'aqb_t_9', type: 'mcq', topic: 'tC', stem: 'BANKSTEM 9.', options: ['x', 'y'], answer: 1 });
  const bad = { id: 'tA-q1', type: 'mcq', topic: 'tA', stem: 'Clashes with a practice id.', options: ['x', 'y'], answer: 0 };
  const file = { name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'neo-assessment-bank', version: 1, module: 'cellinjury', title: 'Test bank', items: bq.concat([bad]) })) };
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE, { topics: topics, questions: qs }), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  const autos = function (st) { return main.ctx.rpRows_('Content').filter(function (r) { return r.module === st && r.collection === 'assessments' && !main.ctx.isTrue_(r.deleted); }).map(function (r) { return main.ctx.unpackJson_(r); }).filter(function (a) { return a && a.autoTopic; }); };
  const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
  const teacherPage = async function (storage, hash) {
    main.call({ module: storage, action: 'setup', password: 'teacher-' + storage + '-1' });
    const tok = main.call({ module: storage, action: 'login', password: 'teacher-' + storage + '-1' }).token;
    const t = await page(), g = storage.indexOf('-') > 0 ? storage.slice(storage.indexOf('-') + 1) : '';
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    await t.addInitScript(function (o) { try { localStorage.setItem(o.k, JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl, k: 'ci_' + (g ? g + '_' : '') + 'backend_token_v1' });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/' + (g ? '?g=' + g : '') + hash);
    return t;
  };
  try {
    // 1. the Admin imports the bank in the main copy (Teacher Portal → 📝 Assessments → 🔒 Assessment bank)
    const m = await teacherPage('cellinjury', '#/teacher/assessments');
    await m.waitForSelector('[data-a=abank]', { timeout: 20000 });
    await m.click('[data-a=abank]');
    await m.waitForSelector('.abank-import input[type=file]');
    assert.match(await m.textContent('.abank-intro'), /assessments only[\s\S]*never appear in Practice/);
    await m.setInputFiles('.abank-import input[type=file]', file);
    await m.waitForFunction(function () { return /9 new · 0 changed · 0 already in the bank · 1 cannot be added/.test(document.querySelector('.abank-import').textContent); });
    assert.match(await m.textContent('.abank-plan'), /tA-q1 — Clashes with a practice id\. — not possible: a practice question already has this id/);
    if (process.env.SHOTS) await (await m.$('.abank-import')).screenshot({ path: path.join(process.env.SHOTS, 'abank-plan.png') });
    await m.click('.abank-import button.btn-primary'); await m.click('.modal button:has-text("Add to the bank")');
    await m.waitForFunction(function () { return /✓ 9 questions saved · the bank now holds 9/.test(document.querySelector('.abank-import').textContent); }, null, { timeout: 30000 });
    assert.strictEqual(main.ctx.rpRows_('Content').filter(function (r) { return r.module === 'cellinjury' && r.collection === 'priv:assessbank' && !main.ctx.isTrue_(r.deleted); }).length, 9, 'stored privately in the main copy');
    assert.match(await m.textContent('.abank-topics'), /1Cell adaptations7🔒 the bank[\s\S]*2Cell death2practice questions/);
    assert.match(await m.textContent('.abank-list'), /aqb_t_7[\s\S]*A, C/);
    if (process.env.SHOTS) await m.screenshot({ path: path.join(process.env.SHOTS, 'abank-tab.png'), fullPage: true });
    // the teacher's own Practice: no bank question anywhere (QUESTIONS, Revision, the Question Bank manager)
    const tv = await m.evaluate(function () { return { q: QUESTIONS.length, bankInQ: QUESTIONS.some(function (q) { return q.bank; }), known: !!Q_BY_ID.aqb_t_1, rev: Views.revision.filtered().some(function (q) { return q.bank; }),
      mgr: bankFiltered(bankFilterDefaults()).some(function (q) { return q.bank; }), builder: bankFiltered(bankFilterDefaults({ withBank: true, source: 'bank' })).length }; });
    assert.deepStrictEqual(tv, { q: 12, bankInQ: false, known: true, rev: false, mgr: false, builder: 9 });
    await m.evaluate(function () { location.hash = '#/revision'; });
    await m.waitForFunction(function () { var v = document.querySelector('#view-revision'); return v && /Practice statement/.test(v.textContent); }, null, { timeout: 15000 });
    assert.ok(!/BANKSTEM/.test(await m.textContent('#view-revision')), 'Revision shows no bank question');
    await m.context().close();
    // 2. a group's teacher: the bank is read-only there; ⚡ Topic quizzes: Topic 1 from the bank (7), Topic 2 from practice (only 2 in the bank)
    const t = await teacherPage(ST, '#/teacher/assessments');
    await t.waitForSelector('[data-a=abank]', { timeout: 20000 });
    await t.click('[data-a=abank]');
    await t.waitForFunction(function () { return /Edit master draft/.test((document.querySelector('.abank-import') || {}).textContent || ''); });
    assert.ok(!(await t.$('.abank-import input[type=file]')), 'no import from a group copy');
    await t.click('.sub-tabs .chip');   // back to the library
    await t.waitForSelector('[data-a=topic-quizzes]');
    await t.click('[data-a=topic-quizzes]'); await t.waitForSelector('.modal .tq');
    const plan = await t.textContent('.modal');
    assert.match(plan, /assessment-bank questions when it has at least 5[\s\S]*1Cell adaptations7 🔒✓ new quiz[\s\S]*2Cell death5✓ new quiz/);
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'abank-topic-quizzes.png') });
    await t.click('.modal .modal-foot .btn-primary');
    await t.waitForFunction(function () { var x = document.querySelector('.modal'); return x && /Topic quizzes — done/.test(x.textContent); }, null, { timeout: 60000 });
    const a = autos(ST).sort(function (x, y) { return x.title.localeCompare(y.title); });
    assert.deepStrictEqual(a.map(function (x) { return [x.title, x.questionIds.length, x.questionIds.every(function (id) { return /^aqb_t_/.test(id); })]; }), [['Topic 1 quiz — Cell adaptations', 7, true], ['Topic 2 quiz — Cell death', 5, false]]);
    assert.match(a[0].description, /5 random questions from the 7 🔒 assessment-bank questions/);
    const ver = main.ctx.unpackJson_(main.ctx.findContentRow_(ST, 'assessmentversions', a[0].id + '@' + a[0].publishedVersion));
    assert.strictEqual(ver.questions.aqb_t_1.stem, 'BANKSTEM 1: which one?', 'the published version froze the bank questions');
    await t.context().close();
    // 3. the student: nothing of the bank in the page, in any server answer or in the browser's storage
    const sp = await page(), bodies = [];
    sp.on('response', async function (r) { if (/script\.google\.com/.test(r.url())) { try { bodies.push(await r.text()); } catch (e) { } } });
    await openSyntheticModule(sp, mod, [], { stubAssess: false });
    await sp.evaluate(function () { location.hash = '#/quiz'; });
    await sp.waitForSelector('#view-quiz details[data-group=todo] .assess-card', { timeout: 15000 });
    assert.ok((await sp.textContent('#view-quiz')).indexOf('Topic 1 quiz — Cell adaptations') >= 0, 'the student has the quiz to do');
    await sp.evaluate(function () { location.hash = '#/revision'; }); await sp.waitForFunction(function () { var v = document.querySelector('#view-revision'); return v && /Practice statement/.test(v.textContent); }, null, { timeout: 15000 });
    const sv = await sp.evaluate(function () { return { q: QUESTIONS.length, bank: Object.keys(Q_BY_ID).some(function (k) { return /^aqb_/.test(k); }), versions: (State.assessmentVersions || []).length,
      stored: JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)), page: document.body.innerText }; });
    assert.deepStrictEqual([sv.q, sv.bank, sv.versions], [12, false, 0]);
    assert.ok(!/BANKSTEM|BANKEXPL/.test(sv.stored), 'not in the student browser\'s storage');
    assert.ok(!/BANKSTEM|BANKEXPL/.test(sv.page), 'not on the page');
    assert.ok(bodies.length > 0 && !bodies.some(function (b) { return /BANKSTEM|BANKEXPL/.test(b); }), 'no server answer to the student carried a bank question (' + bodies.length + ' answers)');
    await sp.context().close();
    // 4. the assessment engine draws from the bank: a student attempt of Topic 1 = 5 bank questions, built on the server
    const ss = main.call({ module: ST, action: 'studentLogin', username: 'ahmed', password: PW }).token;
    const it = main.call({ module: ST, action: 'getMyAssessments', stoken: ss }).items.filter(function (i) { return i.assessment.id === a[0].id; })[0];
    const st = main.call({ module: ST, action: 'startAttempt', stoken: ss, assignmentId: it.assignment.id, password: main.ctx.apwMap_(ST)[a[0].id].pw });
    assert.ok(st.ok, JSON.stringify(st));
    assert.strictEqual(st.attempt.questions.length, 5);
    assert.ok(st.attempt.questions.every(function (q) { return /^BANKSTEM/.test(q.stem) && q.answer === undefined && !(q.answers || []).length && q.explanation === undefined; }), 'bank questions, no answer key or explanation sent');
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
  } finally {
    main.ctx.CONTENT_KEYS.cellinjury = keep;
    main.ctx.rpRows_('Content').forEach(function (r) { if (r.collection === 'priv:assessbank' && !main.ctx.isTrue_(r.deleted)) main.ctx.actionDelete_(r.module, { collection: r.collection, id: r.id }); });
    main.ctx.rpRows_('Content').forEach(function (r) {
      if (r.collection !== 'assessments' && r.collection !== 'assessmentversions') return;
      const id = String(r.id).split('@')[0], row = main.ctx.findContentRow_(r.module, 'assessments', id), d = row && main.ctx.unpackJson_(row);
      if (!(d && d.autoTopic) || main.ctx.isTrue_(r.deleted)) return;
      main.ctx.assessStore_(r.module).list('assignment').forEach(function (g) { if (g.assessmentId === id) main.ctx.assessStore_(r.module).del('assignment', g.id); });
      main.ctx.assessStore_(r.module).list('attempt').forEach(function (g) { if (g.assessmentId === id) main.ctx.assessStore_(r.module).del('attempt', g.id); });
      main.ctx.llForget_(r.module);
      const pw = main.ctx.apwMap_(r.module); if (pw[id]) { delete pw[id]; main.ctx.setSetting_('apw:' + r.module, JSON.stringify(pw)); }
    });
    main.ctx.rpRows_('Content').forEach(function (r) { if ((r.collection === 'assessmentversions' || r.collection === 'assessments') && !main.ctx.isTrue_(r.deleted)) { const id = String(r.id).split('@')[0]; const row = main.ctx.findContentRow_(r.module, 'assessments', id), d = row && main.ctx.unpackJson_(row); if (d && d.autoTopic) main.ctx.actionDelete_(r.module, { collection: r.collection, id: r.id }); } });
  }
});

test('Presentation slide editor: B (and Ctrl+B) bolds / un-bolds the selected words in bullets and subtitle, with a live preview; the slide shows bold', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/present');
    await t.waitForFunction(function () { return typeof Views !== 'undefined' && Views.present && typeof Views.present.openSlideForm === 'function' && typeof Backend !== 'undefined' && Backend.syncedThisSession; }, null, { timeout: 20000 });
    await t.evaluate(function () { Views.present.openSlideForm(); });
    await t.waitForSelector('.modal .sb-b');
    const ta = '.modal .sb-wrap textarea';
    await t.fill(ta, 'Necrosis is irreversible\nApoptosis needs energy');
    // select "irreversible" → B
    await t.evaluate(function (sel) { var e = document.querySelector(sel), i = e.value.indexOf('irreversible'); e.focus(); e.setSelectionRange(i, i + 'irreversible'.length); }, ta);
    await t.click('.modal .sb-b');
    assert.strictEqual(await t.inputValue(ta), 'Necrosis is **irreversible**\nApoptosis needs energy');
    assert.strictEqual(await t.$eval('.modal .sb-prev strong', function (b) { return b.textContent; }), 'irreversible', 'live preview shows bold');
    // the selection stays on the word: B again → unbold
    await t.click('.modal .sb-b');
    assert.strictEqual(await t.inputValue(ta), 'Necrosis is irreversible\nApoptosis needs energy');
    // Ctrl+B on the word at the cursor (no selection); both lines selected → each line bold, then unbold
    await t.evaluate(function (sel) { var e = document.querySelector(sel), i = e.value.indexOf('energy') + 2; e.focus(); e.setSelectionRange(i, i); }, ta);
    await t.keyboard.press('Control+b');
    assert.strictEqual(await t.inputValue(ta), 'Necrosis is irreversible\nApoptosis needs **energy**');
    await t.evaluate(function (sel) { var e = document.querySelector(sel); e.focus(); e.setSelectionRange(0, e.value.length); }, ta);
    await t.click('.modal .sb-b');
    assert.strictEqual(await t.inputValue(ta), '**Necrosis is irreversible**\n**Apoptosis needs energy**');
    await t.click('.modal .sb-b');
    assert.strictEqual(await t.inputValue(ta), 'Necrosis is irreversible\nApoptosis needs energy');
    await t.evaluate(function (sel) { var e = document.querySelector(sel), i = e.value.indexOf('Apoptosis'); e.focus(); e.setSelectionRange(i, i + 9); }, ta);
    await t.click('.modal .sb-b');
    if (process.env.SHOTS) await (await t.$('.modal')).screenshot({ path: path.join(process.env.SHOTS, 'slide-bold.png') });
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await t.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('Assessment tab for a teacher: the published quizzes with covered passwords (Show / Copy / 🔑), in the students\' order (others first, then Topic 1 … N); the library uses the same order', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  const ids = ['tb2', 'tb1', 'tbm', 'tbd', 'tb10'];
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const up = function (c, id, data) { assert.ok(main.call({ module: ST, action: 'upsert', token: tok, collection: c, id: id, data: data }).ok); };
    const now = Date.now();
    up('assessments', 'tb2', { id: 'tb2', title: 'Topic 2 quiz — Necrosis', status: 'published', publishedVersion: 1, publishedAt: now - 1000, updatedAt: now - 1000, mode: 'pool', poolCount: 5, questionIds: ['a', 'b', 'c', 'd', 'e', 'f'], settings: { timeLimitMin: 5, attemptsAllowed: 1 } });
    up('assessments', 'tb1', { id: 'tb1', title: 'Topic 1 quiz — Adaptations', status: 'published', publishedVersion: 1, publishedAt: now - 3000, updatedAt: now - 3000, mode: 'pool', poolCount: 5, questionIds: ['a', 'b', 'c', 'd', 'e'], settings: { timeLimitMin: 5, attemptsAllowed: 1 } });
    up('assessments', 'tbm', { id: 'tbm', title: 'Midterm practice', status: 'published', publishedVersion: 1, publishedAt: now - 5000, updatedAt: now - 5000, mode: 'fixed', questionIds: ['a', 'b'], settings: {} });
    up('assessments', 'tb10', { id: 'tb10', title: 'Topic 10 quiz — Ageing', status: 'published', publishedVersion: 1, publishedAt: now - 500, updatedAt: now - 500, mode: 'fixed', questionIds: ['a'], settings: {} });
    up('assessments', 'tbd', { id: 'tbd', title: 'A draft', status: 'draft', publishedVersion: 0, updatedAt: now, questionIds: [], settings: {} });
    assert.ok(main.call({ module: ST, action: 'aePwSet', token: tok, assessmentId: 'tb1', password: 'ADAPT1' }).ok);
    assert.ok(main.call({ module: ST, action: 'aePwSet', token: tok, assessmentId: 'tb2', password: 'NECRO2' }).ok);
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/quiz');
    await t.waitForSelector('#view-quiz .tb-row', { timeout: 20000 });
    assert.strictEqual(await t.$('#view-quiz #quiz-pw, #view-quiz input[type=email]'), null, 'no student sign-in box for the teacher');
    const titles = await t.$$eval('#view-quiz .tb-row h3', function (x) { return x.map(function (h) { return h.textContent; }); });
    assert.deepStrictEqual(titles.filter(function (x) { return ids.length && /Midterm practice|Topic [12] quiz|A draft/.test(x); }), ['Midterm practice', 'Topic 1 quiz — Adaptations', 'Topic 2 quiz — Necrosis'], 'drafts not shown; topic order');
    const row = function (id) { return '#view-quiz .tb-row[data-assessment="' + id + '"]'; };
    assert.match(await t.textContent(row('tb1')), /5 of 5 questions \(random\) · 5 min · 1 attempt[\s\S]*••••••[\s\S]*Show[\s\S]*Copy/);
    assert.match(await t.textContent(row('tbm')), /⚠ no password/);
    assert.match(await t.textContent('#view-quiz'), /⚠ \d+ published assessments? ha(s|ve) no password/);
    assert.ok(!/ADAPT1|NECRO2/.test(await t.textContent('#view-quiz')), 'covered');
    await t.click(row('tb1') + ' [data-a=reveal]');
    assert.strictEqual(await t.textContent(row('tb1') + ' .apw-pw'), 'ADAPT1');
    await t.click(row('tb2') + ' [data-a=reveal]');
    assert.strictEqual(await t.textContent(row('tb1') + ' .apw-pw'), '••••••', 'one at a time');
    await t.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://third-year-med.github.io' });
    await t.click(row('tb1') + ' [data-a=copy]');
    await t.waitForSelector(row('tb1') + ' [data-a=copy]:has-text("✓ Copied")');
    assert.strictEqual(await t.evaluate(function () { return navigator.clipboard.readText(); }), 'ADAPT1');
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'teacher-assessment-tab.png'), fullPage: true });
    // the Teacher Portal library: the same order (drafts are listed there too)
    await t.click('#view-quiz button:has-text("Teacher Portal")');
    await t.waitForSelector('.data-table tr:has(a:has-text("Topic 1 quiz"))', { timeout: 15000 });
    const lib = await t.$$eval('.data-table tbody tr a b', function (x) { return x.map(function (b) { return b.textContent; }); });
    const pos = function (s) { return lib.indexOf(s); };
    assert.ok(pos('Midterm practice') < pos('Topic 1 quiz — Adaptations') && pos('Topic 1 quiz — Adaptations') < pos('Topic 2 quiz — Necrosis'), lib.join(' | '));
    assert.ok(pos('Topic 2 quiz — Necrosis') < pos('Topic 10 quiz — Ageing'), 'Topic 10 after Topic 2: ' + lib.join(' | '));
    // 🔑 Passwords: the same order (was alphabetical: Topic 1, Topic 10, Topic 2)
    await t.click('.sub-tabs .chip:has-text("Passwords")');
    await t.waitForSelector('.apw-tbl tr[data-assessment="tb10"]', { timeout: 15000 });
    const pw = await t.$$eval('.apw-tbl tbody tr', function (x) { return x.map(function (r) { return r.getAttribute('data-assessment'); }); });
    assert.deepStrictEqual(pw.filter(function (id) { return /^tb[m12]|^tb10$/.test(id); }), ['tbm', 'tb1', 'tb2', 'tb10'], pw.join(' | '));
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await t.context().close();
  } finally {
    main.ctx.CONTENT_KEYS.cellinjury = keep;
    ids.forEach(function (id) { main.ctx.actionDelete_(ST, { collection: 'assessments', id: id }); });
    const m = main.ctx.apwMap_(ST); delete m.tb1; delete m.tb2; main.ctx.setSetting_('apw:' + ST, JSON.stringify(m));
  }
});

test('Attendance tab for a teacher: the short Teacher Portal version — start a session, live code / QR / close, report; no student code box', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: 'portal', action: 'setup', password: TPW });
    assert.ok(main.call({ module: 'portal', action: 'tsSettings', token: main.call({ module: 'portal', action: 'login', password: TPW }).token, hideModuleLive: false }).ok);
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/attendance');
    await t.waitForSelector('#view-attendance h3:has-text("Start attendance for a new teaching session")', { timeout: 20000 });
    assert.strictEqual(await t.$('#view-attendance input[aria-label="Attendance code"]'), null, 'no student code box');
    assert.match(await t.textContent('#view-attendance'), /History, reports & settings/);
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'teacher-attendance-tab.png'), fullPage: true });
    await t.fill('#view-attendance input[placeholder^="e.g. Session 2"]', 'Short-view lecture');
    await t.click('#view-attendance button:has-text("Start attendance")');
    await t.waitForSelector('#view-attendance button:has-text("Close attendance")', { timeout: 15000 });
    const sess = main.ctx.rpRows_('AttendanceSessions').filter(function (r) { return r.module === ST && r.sessionTitle === 'Short-view lecture'; })[0];
    assert.ok(sess && sess.status === 'active', 'started on the server');
    await t.waitForFunction(function (c) { return document.querySelector('#view-attendance').textContent.indexOf(c) >= 0; }, sess.code, { timeout: 15000 });
    // only the code: no QR code, no link; projector-sized; ⛶ Full screen shows the code alone
    assert.strictEqual(await t.$('#view-attendance .qr-box'), null, 'no QR');
    assert.strictEqual(await t.$('#view-attendance input[aria-label="Attendance check-in link"]'), null, 'no link');
    assert.ok(!/Copy check-in link|Show QR|Hide QR/.test(await t.textContent('#view-attendance')));
    assert.strictEqual(await t.textContent('#view-attendance .att-code-big'), sess.code);
    assert.strictEqual((await t.textContent('#view-attendance')).match(/Present: \d+ student/g).length, 1, 'the present count only once');
    const fs = await t.$eval('#view-attendance .att-code-big', function (e) { return parseFloat(getComputedStyle(e).fontSize); });
    assert.ok(fs >= 64, 'projector size: ' + fs + 'px');
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'attendance-code-big.png'), fullPage: true });
    await t.click('#view-attendance [data-a=att-full]');
    await t.waitForSelector('.att-fs .att-fs-code');
    assert.strictEqual((await t.textContent('.att-fs')).replace('✕', '').trim(), sess.code, 'full screen: the code only');
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'attendance-code-fullscreen.png') });
    await t.keyboard.press('Escape');
    await t.waitForFunction(function () { return !document.querySelector('.att-fs'); });
    // LIVE: students who check in appear in the list (with the count) while the session is still open — no closing, no reload
    const ses1 = main.call({ module: ST, action: 'studentLogin', username: 'ahmed', password: PW });
    assert.ok(main.call({ module: ST, action: 'submitAttendanceByCode', stoken: ses1.token, code: sess.code }).ok);
    await t.waitForFunction(function () { var x = document.querySelector('#view-attendance').textContent; return /Student Ahmed/.test(x) && /Present: 1 student\b/.test(x); }, null, { timeout: 12000 });
    assert.ok(await t.$('#view-attendance button:has-text("Close attendance")'), 'still open');
    assert.match(await t.textContent('#view-attendance .att-live-note'), /Live — new check-ins appear automatically/);
    // a second student → the list and the count keep growing; a duplicate check-in adds nobody
    main.addStudents(ST, [{ username: 'b1', name: 'Student Basma', password: PW, mustChange: false }, { username: 'c1', name: 'Student Carim', password: PW, mustChange: false }, { username: 'd1', name: 'Student Dina', password: PW, mustChange: false }]);
    const ses2 = main.call({ module: ST, action: 'studentLogin', username: 'b1', password: PW });
    assert.ok(main.call({ module: ST, action: 'submitAttendanceByCode', stoken: ses2.token, code: sess.code }).ok);
    assert.strictEqual(main.call({ module: ST, action: 'submitAttendanceByCode', stoken: ses1.token, code: sess.code }).alreadyRecorded, true);
    await t.waitForFunction(function () { var x = document.querySelector('#view-attendance').textContent; return /Student Ahmed/.test(x) && /Basma/.test(x) && /Present: 2 students/.test(x); }, null, { timeout: 12000 });
    assert.strictEqual(await t.$$eval('#view-attendance .data-table tbody tr', function (r) { return r.length; }), 2, 'no duplicate row');
    // the class server does not answer → the saved list stays, a "retrying" note; back → live again
    await t.route('**/macros/**', function (route) { return route.abort(); });
    await t.waitForFunction(function () { var n = document.querySelector('#view-attendance .att-live-note'); return n && /did not answer/.test(n.textContent); }, null, { timeout: 15000 });
    assert.match(await t.textContent('#view-attendance'), /Present: 2 students[\s\S]*Student Ahmed/);
    await t.unroute('**/macros/**');
    await t.waitForFunction(function () { var n = document.querySelector('#view-attendance .att-live-note'); return n && /Live — new check-ins/.test(n.textContent); }, null, { timeout: 15000 });
    await t.click('#view-attendance button:has-text("Close attendance")');
    await t.click('.modal button:has-text("Close attendance")');
    await t.waitForFunction(function () { return /Start attendance for a new teaching session/.test(document.querySelector('#view-attendance').textContent) && /Short-view lecture/.test(document.querySelector('#view-attendance').textContent); }, null, { timeout: 15000 });
    assert.strictEqual(main.ctx.rpRows_('AttendanceSessions').filter(function (r) { return r.sessionId === sess.sessionId; })[0].status, 'closed');
    // 2.25: in the report AFTER closing, the teacher marks ✓ Present / Late / Excused and can undo (saved on the server)
    const row = function (name) { return '#view-attendance .att-register tr:has-text("' + name + '")'; };
    await t.waitForSelector(row('Student Carim') + ' button[data-mark=present]', { timeout: 20000 });
    assert.match(await t.textContent(row('Student Carim')), /Absent/);
    await t.click(row('Student Carim') + ' button[data-mark=present]');
    await t.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#view-attendance .att-register tr'), function (x) { return /Student Carim/.test(x.textContent); })[0]; return r && /Present · teacher/.test(r.textContent); }, null, { timeout: 15000 });
    const recC = main.ctx.rpRows_('AttendanceRecords').filter(function (r) { return r.sessionId === sess.sessionId && r.studentId === 'c1'; });
    assert.deepStrictEqual(recC.map(function (r) { return [r.participantId, r.status]; }), [['teacher:c1', 'present']], 'a real record, made by the teacher');
    await t.click(row('Student Ahmed') + ' button[data-mark=late]');
    await t.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#view-attendance .att-register tr'), function (x) { return /Student Ahmed/.test(x.textContent); })[0]; return r && /Late/.test(r.textContent); }, null, { timeout: 15000 });
    await t.click(row('Student Dina') + ' button[data-mark=excused]');
    await t.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#view-attendance .att-register tr'), function (x) { return /Student Dina/.test(x.textContent); })[0]; var b = r && r.querySelector('.badge'); return b && b.textContent === 'Excused'; }, null, { timeout: 15000 });
    const stats = await t.evaluate(function () { var o = {}; document.querySelectorAll('#view-attendance .stat').forEach(function (x) { o[x.querySelector('.k').textContent] = x.querySelector('.v').textContent; }); return o; });
    const NR = main.call({ module: ST, action: 'listStudents', token: tok }).students.filter(function (x) { return x.active !== false; }).length;   // other tests may add students here
    assert.deepStrictEqual([stats['Registered'], stats['Present'], stats['of them late'], stats['Excused'], stats['Absent'], stats['Attendance']],
      [String(NR), '3', '1', '1', String(NR - 4), Math.round(3 / (NR - 1) * 100) + '%'], 'excused not counted: ' + JSON.stringify(stats));
    assert.deepStrictEqual(main.call({ module: ST, action: 'attMarks', token: tok, sessionId: sess.sessionId }).marks, { c1: 'present', ahmed: 'late', d1: 'excused' });
    // undo Carim's mark → the teacher-made record goes, Absent again
    await t.click(row('Student Carim') + ' button[data-mark=clear]');
    await t.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('#view-attendance .att-register tr'), function (x) { return /Student Carim/.test(x.textContent); })[0]; return r && /Absent/.test(r.textContent); }, null, { timeout: 15000 });
    assert.strictEqual(main.ctx.rpRows_('AttendanceRecords').filter(function (r) { return r.sessionId === sess.sessionId && r.studentId === 'c1'; }).length, 0);
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'att-marks.png'), fullPage: true });
    // a FRESH page opens View from the history: the student list and the marks load at the same time — the marks answer
    // comes LAST (held back 1.5 s), which is how the user saw a report without any mark buttons (fixed 2026-10-21)
    await t.route('https://script.google.com/**', async function (route) {
      let q = {}; try { q = JSON.parse(route.request().postData() || '{}'); } catch (e) { }
      if (q.action === 'attMarks') await new Promise(function (r) { setTimeout(r, 1500); });
      return route.fallback();
    });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/attendance');
    await t.reload();
    const view = 'tr:has-text("Short-view lecture") button:has-text("View")';
    await t.waitForSelector(view, { timeout: 20000 }); await t.click(view);
    await t.waitForSelector('.modal ' + row('Student Dina').replace('#view-attendance ', '') + ' button[data-mark=clear]', { timeout: 20000 });
    const mt = await t.textContent('.modal');
    assert.ok(!/Loading the registered student list|Loading the Present/.test(mt), 'both loaded and drawn');
    assert.match(mt, /You can mark a student/);
    assert.ok(await t.$('.modal ' + row('Student Carim').replace('#view-attendance ', '') + ' button[data-mark=present]'), 'mark buttons for an absent student');
    assert.ok(await t.$('.modal ' + row('Student Ahmed').replace('#view-attendance ', '') + ' button[data-mark=clear]'), 'Undo for the late mark');
    // and marking works from this View too
    await t.click('.modal ' + row('Student Carim').replace('#view-attendance ', '') + ' button[data-mark=excused]');
    await t.waitForFunction(function () { var r = Array.prototype.filter.call(document.querySelectorAll('.modal .att-register tr'), function (x) { return /Student Carim/.test(x.textContent); })[0]; var b = r && r.querySelector('.badge'); return b && b.textContent === 'Excused'; }, null, { timeout: 15000 });
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await t.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('Learning lock (2.18): Teacher Dashboard 🔒 Lock → the student sees only Assessments, every other address is blocked, the server refuses learning data; 🔓 Unlock opens it again', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    // the teacher's control
    const t = await page();
    await t.goto(url + '#/teacher'); await t.fill('#t-p', TPW); await t.click('form.card button[type=submit]');
    await dash(t, 'modules');
    const row = '#t-lock .ll-row[data-storage="cellinjury-tr-a"]';
    // a small card first: closed, status in one line; a click opens the whole panel
    await t.waitForFunction(function () { return /All unlocked · \d+ modules?/.test(document.querySelector('#t-lock .ll-sum').textContent); });
    assert.ok(!(await t.isVisible('#t-lock .ll-box')), 'panel closed');
    assert.strictEqual(await t.getAttribute('#t-lock .ll-card', 'aria-expanded'), 'false');
    const cardBox = await (await t.$('#t-lock .ll-card')).boundingBox(); assert.ok(cardBox.height < 70 && cardBox.width <= 470, JSON.stringify(cardBox));
    if (process.env.SHOTS) await (await t.$('.dash-view[data-view=modules]')).screenshot({ path: path.join(process.env.SHOTS, 'lock-card-closed.png'), clip: undefined });
    await t.click('#t-lock .ll-card');
    // one collapsible list per group: closed while there are several; the header counts the modules
    const grp = '#t-lock .ll-group:has(.ll-row[data-storage="cellinjury-tr-a"])';
    await t.waitForSelector(grp + ' .ll-gh', { state: 'visible' });
    assert.ok(await t.$$eval('#t-lock .ll-group', function (x) { return x.length; }) > 1);
    assert.ok(!(await t.isVisible(row)), 'group closed');
    assert.match(await t.textContent(grp + ' .ll-gh'), /Test Razi · Group A[\s\S]*\d+ modules?/);
    await t.click(grp + ' .ll-gh');
    await t.waitForSelector(row, { state: 'visible' });
    assert.strictEqual(await t.getAttribute(grp + ' .ll-gh', 'aria-expanded'), 'true');
    assert.strictEqual(await t.getAttribute('#t-lock .ll-card', 'aria-expanded'), 'true');
    assert.match(await t.textContent(row), /Learning Module: UNLOCKED[\s\S]*🔒 Lock Learning Module/);
    // the student is in the module, Learning open
    const s = await page(), calls = [];
    await openSyntheticModule(s, mod, calls);
    assert.ok(await s.isVisible('.nav-btn[data-view="learn"]'));
    await t.click(row + ' [data-a=lock]');
    await t.waitForFunction(function (sel) { return /Learning Module: LOCKED/.test(document.querySelector(sel).textContent); }, row);
    assert.match(await t.textContent(row), /🔓 Unlock Learning Module[\s\S]*/); assert.match(await t.textContent(row), /Locked by/);
    assert.match(await t.textContent('#t-lock .ll-sum'), /^1 LOCKED · Cell Injury & Cell Death · Group A$/);
    assert.ok(await t.$eval('#t-lock .ll-card', function (c) { return c.classList.contains('on'); }));
    assert.match(await t.textContent(grp + ' .ll-gh'), /🔒 1 LOCKED/);
    // closing the group keeps the lock visible on its header
    await t.click(grp + ' .ll-gh'); assert.ok(!(await t.isVisible(row)));
    assert.match(await t.textContent(grp + ' .ll-gh'), /🔒 1 LOCKED/);
    if (process.env.SHOTS) await (await t.$('#t-lock')).screenshot({ path: path.join(process.env.SHOTS, 'lock-groups-closed.png') });
    await t.click(grp + ' .ll-gh'); await t.waitForSelector(row, { state: 'visible' });
    // the server: learning data refused to the student (assessments untouched)
    const stok = main.call({ module: 'cellinjury-tr-a', action: 'studentLogin', username: 'ahmed', password: PW }).token;
    assert.strictEqual(main.call({ module: 'cellinjury-tr-a', action: 'getAllContent', stoken: stok }).code, 'learnlock');
    // the page picks it up (polls; here: the student comes back to the tab)
    await s.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); });
    await s.waitForFunction(function () { return document.body.classList.contains('pf-ll') && location.hash === '#/quiz'; }, null, { timeout: 15000 });
    assert.match(await s.textContent('#pf-ll-bar'), /Learning Module: LOCKED[\s\S]*locked the Learning module/);
    const visibleNav = await s.$$eval('.nav-btn', function (b) { return b.filter(function (x) { return x.offsetParent !== null; }).map(function (x) { return x.dataset.view; }); });
    assert.deepStrictEqual(visibleNav, ['quiz']);
    assert.ok(!(await s.isVisible('.ux-quick')), 'quick links (All topics, Glossary, Presentation) hidden');
    for (const addr of ['#/learn', '#/explain/overview', '#/revision', '#/study/glossary', '#/present', '#/cases', '#/']) {
      await s.evaluate(function (a) { location.hash = a; }, addr);
      await s.waitForFunction(function () { return location.hash === '#/quiz'; });
      assert.ok(await s.isVisible('#view-quiz'), addr + ' → Assessments');
      assert.ok(!(await s.isVisible('#view-explain')) && !(await s.isVisible('#view-learn')), addr + ': no Learning page shown');
    }
    // a reload stays locked from the first moment
    await s.reload(); await s.waitForSelector('.nav-btn[data-view="quiz"]', { timeout: 20000 });
    await s.waitForFunction(function () { return document.body.classList.contains('pf-ll') && location.hash === '#/quiz'; });
    if (process.env.SHOTS) { await s.screenshot({ path: path.join(process.env.SHOTS, 'module-locked.png') }); await t.screenshot({ path: path.join(process.env.SHOTS, 'dashboard-lock.png'), fullPage: true }); }
    // the dashboard card shows the lock
    await t.click('.dash-view[data-view=modules] .dv-back'); await t.waitForSelector('.dash-grid', { state: 'visible' });
    assert.match(await t.textContent('.dash-card[data-view=modules] .dc-badges'), /🔒 1 locked/);
    // 🔓 Unlock → open again
    await dash(t, 'modules'); await t.click(row + ' [data-a=lock]');
    await t.waitForFunction(function (sel) { return /Learning Module: UNLOCKED/.test(document.querySelector(sel).textContent); }, row);
    assert.ok(main.call({ module: 'cellinjury-tr-a', action: 'getAllContent', stoken: stok }).ok);
    await s.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); });
    await s.waitForFunction(function () { return !document.body.classList.contains('pf-ll') && !document.getElementById('pf-ll-bar'); }, null, { timeout: 15000 });
    await s.evaluate(function () { location.hash = '#/learn'; }); await s.waitForTimeout(300);
    assert.strictEqual(await s.evaluate(function () { return location.hash; }), '#/learn');
    assert.ok(await s.isVisible('.nav-btn[data-view="learn"]'));
    if (process.env.SHOTS) { await t.setViewportSize({ width: 390, height: 844 }); await t.screenshot({ path: path.join(process.env.SHOTS, 'dashboard-lock-phone.png'), fullPage: true }); }
    await t.setViewportSize({ width: 390, height: 844 });
    assert.ok(await t.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1, 'dashboard fits a phone');
    await s.context().close(); await t.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});


test('Assessment passwords (2.19/2.20): Assessments open without a password; each quiz asks for ITS password to start; completed attempts reviewed without one; teacher sets / changes / removes per assessment; no class password', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    // two published assessments for the group (one question each), assigned to everyone
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const up = function (c, id, data) { const r = main.call({ module: ST, action: 'upsert', token: tok, collection: c, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); };
    const q = { id: 'x1', type: 'tf', stem: 'Necrosis is always irreversible.', answer: true, explanation: 'Necrosis is the end point of irreversible injury.' };
    [['q1', 'Quiz 1 — Necrosis', true], ['q2', 'Quiz 2 — Apoptosis', false]].forEach(function (x) {
      up('assessments', x[0], { id: x[0], title: x[1], status: 'published', publishedVersion: 1 });
      up('assessmentversions', x[0] + '@1', { assessmentId: x[0], version: 1, title: x[1], mode: 'fixed', questionIds: ['x1'], settings: { showScore: true, showAnswers: x[2] }, questions: { x1: q } });
      main.ctx.assessStore_(ST).put('assignment', 'asg-' + x[0], { id: 'asg-' + x[0], assessmentId: x[0], assessmentTitle: x[1], targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
    });
    // ---- the teacher: Teacher Portal → 🔑 Assessment passwords (one row per assessment) ----
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const cfgUrl = /window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html); const backendUrl = JSON.parse(cfgUrl[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/password');
    await t.waitForSelector('.apw-tbl tr[data-assessment="q1"]', { timeout: 20000 });
    // passwords live INSIDE 📝 Assessments now: the old address opens its 🔑 Passwords sub-tab; no separate tab
    assert.ok(!/Assessment passwords/.test(await t.textContent('.portal-tabs')), 'no separate tab');
    assert.match(await t.textContent('.portal-tabs .tab.active'), /Assessments/);
    assert.match(await t.textContent('.sub-tabs .chip.active'), /🔑 Passwords/);
    assert.match(await t.textContent('.apw-strip'), /🔑 Assessment passwords: 0 of 3 set[\s\S]*⚠ 2 published assessments have no password/);
    assert.match(await t.textContent('.apw-tbl tr[data-assessment="q1"]'), /Quiz 1 — Necrosis[\s\S]*⚠ none yet — students cannot start it/);
    assert.ok(!/Class quiz password/.test(await t.textContent('#view-teacher')), 'the class (default) password is retired');
    t.once('dialog', function (d) { d.accept(); });
    await t.click('.apw-tbl tr[data-assessment="q1"] [data-a=set]');
    await t.waitForSelector('.modal input');
    await t.fill('.modal input', 'Necro-26'); await t.press('.modal input', 'Enter');
    await t.waitForFunction(function () { return !document.querySelector('.modal-back'); });   // Enter closes it for good (does not reopen it)
    // covered on the teacher's screen (projector-safe); 👁 Show reveals it
    await t.waitForFunction(function () { var c = document.querySelector('.apw-tbl tr[data-assessment="q1"] .apw-pw'); return c && c.textContent === '••••••'; });
    assert.ok(!/Necro-26/.test(await t.textContent('#view-teacher')), 'no password visible anywhere (also not in a message)');
    assert.ok(!/Necro-26/.test(await t.evaluate(function () { return document.body.innerText; })), 'nor in a toast');
    await t.click('.apw-tbl tr[data-assessment="q1"] [data-a=reveal]');
    assert.strictEqual(await t.textContent('.apw-tbl tr[data-assessment="q1"] .apw-pw'), 'Necro-26');
    await t.click('.apw-tbl tr[data-assessment="q2"] [data-a=random]');
    await t.waitForSelector('.apw-tbl tr[data-assessment="q2"] [data-a=reveal]');
    // only ONE password is shown at a time: showing Quiz 2's covers Quiz 1's again
    await t.click('.apw-tbl tr[data-assessment="q2"] [data-a=reveal]');
    const q2pw = await t.textContent('.apw-tbl tr[data-assessment="q2"] .apw-pw');
    assert.match(q2pw, /^[A-Z2-9]{6}$/);
    assert.strictEqual(await t.textContent('.apw-tbl tr[data-assessment="q1"] .apw-pw'), '••••••');
    assert.strictEqual(await t.$$eval('.apw-pw:not(.apw-covered)', function (x) { return x.length; }), 1);
    await t.click('.apw-tbl tr[data-assessment="q2"] [data-a=reveal]');   // Hide
    assert.strictEqual(await t.$$eval('.apw-pw:not(.apw-covered)', function (x) { return x.length; }), 0);
    // the remaining assessment without a password (the migrated Formal Quiz 1) gets one with one click
    assert.match(await t.textContent('.apw-card'), /⚠ 1 assessment has no password yet/);
    await t.click('.apw-card [data-a=all]');
    await t.waitForFunction(function () { return !document.querySelector('.apw-card .apw-none') && !document.querySelector('.apw-card [data-a=all]'); });
    // the Assessment Library shows each assessment's password in its own row (🔑 to change it); the strip says all are set
    await t.click('.sub-tabs .chip:has-text("Assessment Library")');
    await t.waitForSelector('.data-table th:text-is("Password")');
    const libRow = '.data-table tr:has(a:has-text("Quiz 1 — Necrosis"))';
    assert.match(await t.textContent(libRow + ' .apw-cell'), /••••••[\s\S]*👁 Show[\s\S]*📋 Copy/);
    // 📋 Copy puts the password on the clipboard while it stays covered on screen (and never appears in the message)
    await t.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://third-year-med.github.io' });
    await t.click(libRow + ' [data-a=copy]');
    await t.waitForSelector(libRow + ' [data-a=copy]:has-text("✓ Copied")');
    assert.strictEqual(await t.evaluate(function () { return navigator.clipboard.readText(); }), 'Necro-26');
    assert.strictEqual(await t.textContent(libRow + ' .apw-pw'), '••••••', 'still covered');
    assert.ok(!/Necro-26/.test(await t.evaluate(function () { return document.body.innerText; })), 'not in the message either');
    if (process.env.SHOTS) await (await t.$(libRow)).screenshot({ path: path.join(process.env.SHOTS, 'library-pw-copy.png') });
    await t.click(libRow + ' [data-a=reveal]');
    assert.match(await t.textContent(libRow + ' .apw-cell'), /Necro-26[\s\S]*Hide/);
    assert.ok(!/🙈/.test(await t.textContent('#view-teacher')), 'no monkey on the Hide button');
    await t.click(libRow + ' [data-a=reveal]');
    assert.match(await t.textContent('.apw-strip'), /3 of 3 set/);
    t.once('dialog', function (d) { d.accept(); });
    await t.click(libRow + ' [data-a=pw]');
    await t.waitForSelector('.modal input');
    assert.strictEqual(await t.inputValue('.modal input'), '', 'opens empty (the current password is not shown)');
    await t.fill('.modal input', 'Necro-27'); await t.press('.modal input', 'Enter');
    await t.waitForFunction(function () { return !document.querySelector('.modal-back'); });
    assert.strictEqual(main.call({ module: ST, action: 'aePwList', token: tok }).passwords.q1.password, 'Necro-27');
    await t.waitForSelector(libRow + ' [data-a=reveal]'); await t.click(libRow + ' [data-a=reveal]');
    assert.match(await t.textContent(libRow + ' .apw-cell'), /Necro-27/);
    if (process.env.SHOTS) await t.screenshot({ path: path.join(process.env.SHOTS, 'assessments-library-passwords.png'), fullPage: true });
    await t.click(libRow + ' [data-a=pw]'); await t.waitForSelector('.modal input');
    await t.fill('.modal input', 'Necro-26'); await t.press('.modal input', 'Enter');
    await t.waitForFunction(function () { return !document.querySelector('.modal-back'); });
    await t.click('.apw-strip [data-a=pw-manage]');
    await t.waitForSelector('.apw-tbl tr[data-assessment="q1"]');
    if (process.env.SHOTS) await (await t.$('.apw-card')).screenshot({ path: path.join(process.env.SHOTS, 'teacher-assessment-passwords.png') });
    // ---- the student: no password to open; THIS quiz's password to start ----
    const s = await page(), none = [];
    await openSyntheticModule(s, mod, none, { stubAssess: false });
    await s.evaluate(function () { location.hash = '#/quiz'; });
    await s.waitForSelector('#view-quiz .assess-card', { timeout: 15000 });
    assert.strictEqual(await s.$('#quiz-pw'), null, 'no password page');
    assert.match(await s.textContent('#view-quiz'), /Each assessment asks for its own password[\s\S]*Quiz 1 — Necrosis[\s\S]*Quiz 2 — Apoptosis|Each assessment asks for its own password[\s\S]*Quiz 2 — Apoptosis[\s\S]*Quiz 1 — Necrosis/);
    const card = function (title) { return '#view-quiz .assess-card:has(h3:text-is("' + title + '"))'; };
    card.in = function (title) { return card(title).replace('#view-quiz ', ''); };
    // compact list: one slim row each, grouped (▶ To do open), newest assignment first
    assert.ok(await s.$('#view-quiz details[data-group=todo][open] ' + card.in('Quiz 1 — Necrosis')) && await s.$('#view-quiz details[data-group=todo] ' + card.in('Quiz 2 — Apoptosis')));
    const rowH = await s.$eval(card('Quiz 2 — Apoptosis'), function (e) { return e.getBoundingClientRect().height; });
    assert.ok(rowH < 90, 'a compact row (' + rowH + 'px)');
    assert.deepStrictEqual(await s.$$eval('#view-quiz details[data-group=todo] .assess-card h3', function (x) { return x.map(function (h) { return h.textContent; }); }).then(function (t) { return t.filter(function (x) { return /^Quiz/.test(x); }); }), ['Quiz 2 — Apoptosis', 'Quiz 1 — Necrosis']);
    if (process.env.SHOTS) await s.screenshot({ path: path.join(process.env.SHOTS, 'student-assessments-compact.png'), fullPage: true });
    await s.click(card('Quiz 1 — Necrosis') + ' button.btn-primary');
    await s.click('.modal button:has-text("Start")');                     // the instructions / time-limit confirmation
    await s.waitForSelector('.modal input[type=password]');
    assert.match(await s.textContent('.modal'), /Quiz 1 — Necrosis[\s\S]*Each assessment has its own password/);
    await s.fill('.modal input[type=password]', q2pw); await s.press('.modal input[type=password]', 'Enter');   // Quiz 2's password does not open Quiz 1
    await s.waitForFunction(function () { var m = document.querySelector('.modal'); return m && /not the password of “Quiz 1 — Necrosis”/.test(m.textContent); });
    await s.fill('.modal input[type=password]', 'necro-26'); await s.press('.modal input[type=password]', 'Enter');
    await s.waitForSelector('.quiz-run', { timeout: 15000 });
    await s.click('.quiz-run label.opt:has-text("True")');
    await s.click('.quiz-run button.btn-navy:has-text("Review & submit")');
    await s.click('.modal button:text-is("Submit")');
    await s.waitForFunction(function () { return /Submitted/.test(document.querySelector('#view-quiz').textContent) && /Review/.test(document.querySelector('#view-quiz').textContent); }, null, { timeout: 15000 });
    assert.match(await s.textContent('#view-quiz'), /100%[\s\S]*Correct answer/);
    // ---- back to My Assessments: the completed attempt is reviewed WITHOUT a password ----
    await s.click('#view-quiz button:has-text("My Assessments")');
    await s.waitForSelector(card('Quiz 1 — Necrosis') + ' .assess-hist button');
    assert.match(await s.textContent(card('Quiz 1 — Necrosis') + ' .assess-hist'), /Attempt 1 · 100% — review/);
    await s.click(card('Quiz 1 — Necrosis') + ' .assess-hist button');
    await s.waitForFunction(function () { return /Your answer:[\s\S]*Correct answer:/.test(document.querySelector('#view-quiz').textContent); });
    assert.strictEqual(await s.$('.modal input[type=password]'), null, 'no password for a review');
    if (process.env.SHOTS) await s.screenshot({ path: path.join(process.env.SHOTS, 'student-review.png'), fullPage: true });
    // ---- an attempt in progress: the tab opens on the LIST (not the runner); ▶ Resume continues it with the answers kept ----
    await s.click('#view-quiz button:has-text("My Assessments")');
    await s.click(card('Quiz 2 — Apoptosis') + ' button.btn-primary');
    await s.click('.modal button:has-text("Start")');
    await s.waitForSelector('.modal input[type=password]');
    await s.fill('.modal input[type=password]', q2pw); await s.press('.modal input[type=password]', 'Enter');
    await s.waitForSelector('.quiz-run', { timeout: 15000 });
    assert.match(await s.textContent('#view-quiz'), /Student Ahmed · Student ID ahmed/); assert.ok(!/@student\.local/.test(await s.textContent('#view-quiz')), 'no synthetic e-mail in the runner');
    await s.click('.quiz-run label.opt:has-text("False")');
    await s.evaluate(function () { location.hash = '#/home'; });
    await s.waitForFunction(function () { return !document.querySelector('#view-quiz.active'); });
    await s.evaluate(function () { location.hash = '#/quiz'; });
    await s.waitForSelector(card('Quiz 2 — Apoptosis'), { timeout: 15000 });
    assert.strictEqual(await s.$('.quiz-run'), null, 'the list, not the runner');
    assert.match(await s.textContent(card('Quiz 2 — Apoptosis')), /In progress[\s\S]*Resume/);
    await s.reload();                                                       // also after closing / reloading the page
    await s.waitForSelector('#app-nav', { timeout: 20000 });
    await s.evaluate(function () { if (location.hash !== '#/quiz') location.hash = '#/quiz'; });
    await s.waitForSelector(card('Quiz 2 — Apoptosis'), { timeout: 15000 });
    assert.strictEqual(await s.$('.quiz-run'), null, 'the list after a reload too');
    await s.click(card('Quiz 2 — Apoptosis') + ' button:has-text("Resume")');
    await s.waitForSelector('.quiz-run', { timeout: 15000 });
    assert.strictEqual(await s.$('.modal input[type=password]'), null, 'resuming needs no password');
    assert.ok(await s.$('.quiz-run label.opt:has-text("False") input:checked'), 'the answer given before leaving is kept');
    // the attempt is stored under the account (grading + teacher reports unchanged)
    const att = main.ctx.assessStore_(ST).list('attempt').filter(function (x) { return x.assessmentId === 'q1'; })[0];
    assert.deepStrictEqual([att.email, att.name, att.status, att.percent], ['ahmed@student.local', 'Student Ahmed', 'submitted', 100]);
    // the teacher resets Quiz 1 to the class password
    await t.click('.apw-tbl tr[data-assessment="q1"] [data-a=clear]');
    await t.waitForFunction(function () { return /none yet/.test(document.querySelector('.apw-tbl tr[data-assessment="q1"]').textContent); });
    assert.ok(Object.keys(main.call({ module: ST, action: 'aePwList', token: tok }).passwords).indexOf('q1') < 0);
    // the student: Quiz 1 is "not open yet" (no Start), the completed attempt stays reviewable
    await s.evaluate(function () { location.hash = '#/home'; }); await s.evaluate(function () { location.hash = '#/quiz'; });   // leave the runner: back on the list
    await s.click('#view-quiz button:has-text("Refresh")');
    await s.waitForFunction(function () { var c = Array.prototype.filter.call(document.querySelectorAll('#view-quiz .assess-card'), function (x) { return /Quiz 1 — Necrosis/.test(x.textContent); })[0]; return c && /Not open yet/.test(c.textContent); });
    assert.strictEqual(await s.$(card('Quiz 1 — Necrosis') + ' .assess-side button.btn-primary'), null, 'no Start button');
    assert.ok(await s.$('#view-quiz details[data-group=done] ' + card.in('Quiz 1 — Necrosis')), 'completed and no longer startable → ✓ Completed');
    assert.ok(await s.$(card('Quiz 1 — Necrosis') + ' .assess-hist button'), 'the review stays available');
    if (process.env.SHOTS) { await s.setViewportSize({ width: 390, height: 844 }); await s.screenshot({ path: path.join(process.env.SHOTS, 'student-assessments-phone.png'), fullPage: true }); await (await t.$('.apw-card')).screenshot({ path: path.join(process.env.SHOTS, 'teacher-assessment-passwords.png') }); }
    assert.strictEqual(errors.filter(function (e) { return !/ERR_TUNNEL|net::/.test(e); }).length, 0, errors.join('\n'));
    await s.context().close(); await t.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

/* ---------------- Inflammation & Healing — Condensed: the REAL page with its REAL course ----------------
   Registered as the four Code.gs additions and the front-page card register it (HANDBOOK §5), then every learning view
   is opened as a student and every slide of the generated deck as the teacher. Needs IC_CONTENT_KEY (env only). */
test('🧑‍🎓 Checked-in only (2.29): the teacher switches it on in 🔑 Passwords; a student not checked in to today\'s lecture is refused with the reason, after checking in the quiz starts', { skip: SKIP || (!CI_PAGE && 'module page not available') }, async function () {
  groupFixture();
  const ST = 'cellinjury-tr-a', mod = syntheticModule(CI_PAGE), keep = main.ctx.CONTENT_KEYS.cellinjury; main.ctx.CONTENT_KEYS.cellinjury = mod.key;
  try {
    main.call({ module: ST, action: 'setup', password: 'teacher-' + ST + '-1' });
    const tok = main.call({ module: ST, action: 'login', password: 'teacher-' + ST + '-1' }).token;
    const up = function (c, id, data) { const r = main.call({ module: ST, action: 'upsert', token: tok, collection: c, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); };
    const q = { id: 'x1', type: 'tf', stem: 'Necrosis is always irreversible.', answer: true, explanation: 'x' };
    up('assessments', 'aq1', { id: 'aq1', title: 'Lecture quiz — Necrosis', status: 'published', publishedVersion: 1 });
    up('assessmentversions', 'aq1@1', { assessmentId: 'aq1', version: 1, title: 'Lecture quiz — Necrosis', mode: 'fixed', questionIds: ['x1'], settings: { showScore: true }, questions: { x1: q } });
    main.ctx.assessStore_(ST).put('assignment', 'asg-aq1', { id: 'asg-aq1', assessmentId: 'aq1', assessmentTitle: 'Lecture quiz — Necrosis', targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
    assert.ok(main.call({ module: ST, action: 'aePwSet', token: tok, assessmentId: 'aq1', password: 'Necro-26' }).ok);
    // earlier tests ran attendance in this group today: move those sessions to yesterday (they must not count)
    main.ctx.readAll_(main.ctx.SHEETS.ATT_SESSIONS).forEach(function (r) { if (r.module === ST) { r.createdAt = Date.now() - 20 * 3600000; main.ctx.saveAttSession_(r); } });
    // ---- teacher: 🔑 Passwords → 🧑‍🎓 Checked-in only ----
    const t = await page();
    await t.route('https://third-year-med.github.io/cell-injury-teaching-platform/**', function (route) { return route.fulfill({ status: 200, contentType: 'text/html', body: mod.html }); });
    const backendUrl = JSON.parse(/window\.NEO_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(mod.html)[1]).backendUrl;
    await t.addInitScript(function (o) { try { localStorage.setItem('ci_tr-a_backend_token_v1', JSON.stringify({ token: o.tok, expiresAt: Date.now() + 3600e3, url: o.url })); } catch (e) { } }, { tok: tok, url: backendUrl });
    await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/password');
    const row = '.apw-tbl tr[data-assessment="aq1"]';
    await t.waitForSelector(row + ' [data-a=attonly]', { state: 'attached', timeout: 20000 });
    assert.match(await t.textContent('.apw-card'), /Checked-in only: for a quiz given in the lecture/);
    assert.strictEqual(await t.isChecked(row + ' [data-a=attonly]'), false);
    await t.click(row + ' .apw-att');
    await t.waitForFunction(function () { return /only students checked in to today’s lecture attendance can start it/.test(document.body.innerText); });
    assert.deepStrictEqual(Object.keys(main.call({ module: ST, action: 'aePwList', token: tok }).attOnly), ['aq1']);
    if (process.env.SHOTS) await (await t.$('.apw-card')).screenshot({ path: path.join(process.env.SHOTS, 'checked-in-only.png') });
    await t.goto('about:blank'); await t.goto('https://third-year-med.github.io/cell-injury-teaching-platform/?g=tr-a#/teacher/password'); await t.waitForSelector(row + ' [data-a=attonly]', { state: 'attached', timeout: 20000 });
    assert.strictEqual(await t.isChecked(row + ' [data-a=attonly]'), true, 'stays on after reload');
    // ☑ Select all beside "Who can start": every assessment on in one click (one request), then ☐ Clear all
    const boxes = function () { return t.$$eval('.apw-tbl [data-a=attonly]', function (x) { return x.map(function (c) { return c.checked; }); }); };
    assert.match(await t.textContent('.apw-tbl th [data-a=attonly-all]'), /☑ Select all/);
    await t.click('.apw-tbl th [data-a=attonly-all]');
    await t.waitForFunction(function () { var b = document.querySelector('.apw-tbl th [data-a=attonly-all]'); return b && /Clear all/.test(b.textContent); });
    assert.ok((await boxes()).every(Boolean) && (await boxes()).length >= 2, 'all ticked');
    assert.strictEqual(Object.keys(main.call({ module: ST, action: 'aePwList', token: tok }).attOnly).length, (await boxes()).length);
    if (process.env.SHOTS) await (await t.$('.apw-card')).screenshot({ path: path.join(process.env.SHOTS, 'checked-in-only-all.png') });
    await t.click('.apw-tbl th [data-a=attonly-all]');
    await t.waitForFunction(function () { var b = document.querySelector('.apw-tbl th [data-a=attonly-all]'); return b && /Select all/.test(b.textContent); });
    assert.ok((await boxes()).every(function (x) { return !x; }), 'all cleared');
    assert.deepStrictEqual(main.call({ module: ST, action: 'aePwList', token: tok }).attOnly, {});
    await t.click(row + ' .apw-att');
    await t.waitForFunction(function () { return Object.keys(window).length && document.querySelector('.apw-tbl tr[data-assessment="aq1"] [data-a=attonly]').checked; });
    assert.deepStrictEqual(Object.keys(main.call({ module: ST, action: 'aePwList', token: tok }).attOnly), ['aq1']);
    // ---- student (not checked in): the list says so; the right password is refused with the reason ----
    const s = await page(), none = [];
    await openSyntheticModule(s, mod, none, { stubAssess: false });
    await s.evaluate(function () { location.hash = '#/quiz'; });
    const card = '#view-quiz .assess-card:has(h3:text-is("Lecture quiz — Necrosis"))';
    await s.waitForSelector(card, { timeout: 15000 });
    assert.match(await s.textContent(card), /🧑‍🎓 Only for students checked in to today’s lecture/);
    const start = async function () {
      await s.click(card + ' button.btn-primary');
      await s.click('.modal button:has-text("Start")');
      await s.waitForSelector('.modal input[type=password]');
      await s.fill('.modal input[type=password]', 'Necro-26'); await s.press('.modal input[type=password]', 'Enter');
    };
    await start();
    await s.waitForFunction(function () { return /only for students checked in to today’s lecture, and the lecture’s attendance has not started yet/.test(document.body.innerText); }, null, { timeout: 15000 });
    assert.strictEqual(await s.$('.quiz-run'), null);
    // ---- today's lecture attendance: ahmed checks in → the quiz starts ----
    const at = main.call({ module: ST, action: 'startAttendanceSession', token: tok, sessionTitle: 'L3: Necrosis', course: 'Cell Injury', academicYear: '2026-2027', teacher: 'Dr. Test' }); assert.ok(at.ok, JSON.stringify(at));
    await s.waitForSelector(card + ' button.btn-primary', { timeout: 15000 });
    await start();
    await s.waitForFunction(function () { return /you are not on its attendance/.test(document.body.innerText) && /L3: Necrosis/.test(document.body.innerText); }, null, { timeout: 15000 });
    const ses = main.call({ module: ST, action: 'studentLogin', username: 'ahmed', password: PW });
    assert.ok(main.call({ module: ST, action: 'submitAttendanceByCode', stoken: ses.token, code: at.code || (at.session && at.session.code) }).ok);
    await s.waitForSelector(card + ' button.btn-primary', { timeout: 15000 });
    await start();
    await s.waitForSelector('.quiz-run', { timeout: 15000 });
    await s.context().close(); await t.context().close();
  } finally { main.ctx.CONTENT_KEYS.cellinjury = keep; }
});

test('condensed Inflammation module (inflcondensed): every topic, section, view and slide renders with the real course; student and teacher', { skip: SKIP || ((!fs.existsSync(IC[2]) || !IC[3]) && 'condensed module page or IC_CONTENT_KEY not available') }, async function () {
  main.ctx.STUDENT_AUTH_MODULES.inflcondensed = true; main.ctx.CONTENT_KEYS.inflcondensed = IC[3];
  main.ctx.DEFAULT_QUIZ_PW.inflcondensed = 'INFLCONDENSED-2026'; main.ctx.DEFAULT_LIVE_PW.inflcondensed = 'CLASSROOM-2026';
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const reg = main.call({ module: 'portal', action: 'portalInfo' }).modules;
  assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg.concat([{ id: 'inflcondensed', title: 'Inflammation & Healing — Condensed', icon: '🔥', status: 'available',
    url: 'https://third-year-med.github.io/' + IC[1] + '/', moduleKey: 'inflcondensed', handoff: 'neo', storagePrefix: 'ic_' }]) }).ok);
  main.addStudents('inflcondensed', [{ username: 'ic1', name: 'Condensed Student', password: PW, mustChange: false }]);
  const start = errors.length;
  try {
    // ---- student: sign in on the module page, then every topic, section and view ----
    const p = await realPage(IC, []);
    await p.goto('https://third-year-med.github.io/' + IC[1] + '/');
    await p.waitForSelector('#nb-user'); await p.fill('#nb-user', 'ic1'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    const info = await p.evaluate(function () { return { cfg: window.NEO_CONFIG, course: COURSE.title, topics: DATA.topics.map(function (t) { return { id: t.id, title: t.title, sections: t.sections.map(function (s) { return { id: s.id, heading: s.heading, tables: s.tables.length, figures: s.figures.length }; }) }; }) }; });
    assert.strictEqual(info.cfg.moduleKey, 'inflcondensed'); assert.strictEqual(info.cfg.storagePrefix, 'ic_');
    assert.strictEqual(info.course, 'Inflammation & Healing', 'plain name — no "Condensed" (user, 2026-10-19)');
    assert.strictEqual(info.topics.length, 18);
    assert.ok(await p.evaluate(function () { return !!sessionStorage.getItem('ic_stu_session_v1') || !!localStorage.getItem('ic_stu_session_v1'); }), 'its own storage prefix');
    for (const tp of info.topics) {
      for (const sc of tp.sections) {
        await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + tp.id + '/' + sc.id);
        await p.waitForFunction(function (h) { const v = document.querySelector('#view-explain'); return v && v.offsetParent !== null && v.textContent.indexOf(h) >= 0; }, sc.heading, { timeout: 10000 });
        const txt = await p.textContent('#view-explain');
        assert.ok(!/undefined|\[object Object\]|\[!(DEF|FLOW|EXAM|RECALL|CONFUSION|HIGHYIELD|PRACTICAL|CLINICAL|REMEMBER|DX|MUSTKNOW)\]/.test(txt), sc.id + ': raw markup or undefined on the page');
      }
    }
    const check = await p.evaluate(function () { return uxValidatePathway(); });
    assert.deepStrictEqual(check.errors, [], 'the learning-unit links (UX_UNITS, UX_FLOW) all point at existing, matching topics and sections');
    const views = ['#/learn', '#/practise', '#/apply', '#/progress', '#/revision', '#/review', '#/review/facts', '#/review/compare', '#/review/morph', '#/review/traps', '#/review/quick',
      '#/cases', '#/practical', '#/study/recall', '#/study/sequence', '#/study/compare', '#/study/glossary', '#/study/challenge', '#/study/connect', '#/quiz'];
    for (const h of views) {
      await p.evaluate(function (x) { location.hash = x; }, h);
      await p.waitForTimeout(350);
      const shown = await p.evaluate(function () { const v = Array.prototype.filter.call(document.querySelectorAll('[id^="view-"]'), function (e) { return e.offsetParent !== null; })[0]; return v ? { id: v.id, n: v.textContent.trim().length, t: v.textContent } : null; });
      assert.ok(shown && shown.n > 40, h + ' shows a view with content');
      assert.ok(!/undefined|\[object Object\]/.test(shown.t), h + ': no undefined');
    }
    const lmr = await p.evaluate(function () { const d = LMR.data(); return { facts: d.facts.length, comparisons: d.comparisons.length, traps: d.traps.length, morph: d.morphology.length }; });
    assert.ok(lmr.facts > 50 && lmr.comparisons >= 10 && lmr.traps >= 5 && lmr.morph >= 5, 'Last-Minute Review is built from the condensed course: ' + JSON.stringify(lmr));
    await p.context().close();

    // ---- teacher: a fresh teacher pass as the dashboard gives it → every slide of the deck ----
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['inflcondensed'] }).modules.inflcondensed;
    assert.ok(tt && tt.token, 'the front-page card makes the module openable from the dashboard');
    const q = await realPage(IC, []);
    await q.addInitScript(function (v) { localStorage.setItem('ic_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await q.goto('https://third-year-med.github.io/' + IC[1] + '/#/present/slide/1');
    await q.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await q.waitForSelector('#pres-stage .slide', { timeout: 15000 });
    const n = await q.evaluate(function () { return Views.present.list().length; });
    assert.ok(n > 120 && n < 230, 'the condensed deck is clearly shorter than the original (248 slides): ' + n);
    const bad = await q.evaluate(function () {
      const out = [], V = Views.present;
      for (let i = 0; i < V.list().length; i++) {
        V.go(i); const s = V.cur(), st = document.querySelector('#pres-stage .slide'), tx = st ? st.textContent : '';
        if (!st) out.push(i + ' no slide');
        else if (/no longer in the course content|Flowchart not found|Question unavailable|undefined/.test(tx)) out.push(i + ' ' + s.type + ': ' + tx.slice(0, 80));
        else if (s.type === 'table' && !st.querySelector('table')) out.push(i + ' table missing');
        else if (s.type === 'content' && !(s.bullets || []).length) out.push(i + ' content without bullets');
      }
      return out;
    });
    assert.deepStrictEqual(bad, [], 'every slide renders');
    await q.evaluate(function () { location.hash = '#/teacher'; });
    await q.waitForSelector('#view-teacher', { state: 'visible', timeout: 10000 });
    const plan = await q.evaluate(function () { return AssessUI.topicQuizPlan().topics.filter(function (x) { return x.ok; }).length; });
    assert.ok(plan >= 15, '⚡ Topic quizzes: most topics still have ≥ 5 practice questions (' + plan + ')');
    await q.context().close();
    assert.deepStrictEqual(errors.slice(start), [], 'no page errors');
  } finally {
    assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg }).ok);   // other tests keep their module list
  }
});

/* ---------------- Cell Injury & Cell Death — Condensed: the REAL page with its REAL course ----------------
   Registered as the four Code.gs additions and the front-page card register it (HANDBOOK §5), then every learning view
   is opened as a student and every slide of the generated deck as the teacher. Needs CC_CONTENT_KEY (env only). */
test('condensed Cell Injury module (cellcondensed): every topic, section, view and slide renders with the real course; student and teacher', { skip: SKIP || ((!fs.existsSync(CC[2]) || !CC[3]) && 'condensed module page or CC_CONTENT_KEY not available') }, async function () {
  main.ctx.STUDENT_AUTH_MODULES.cellcondensed = true; main.ctx.CONTENT_KEYS.cellcondensed = CC[3];
  main.ctx.DEFAULT_QUIZ_PW.cellcondensed = 'CELLCONDENSED-2026'; main.ctx.DEFAULT_LIVE_PW.cellcondensed = 'CLASSROOM-2026';
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const reg = main.call({ module: 'portal', action: 'portalInfo' }).modules;
  assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg.concat([{ id: 'cellcondensed', title: 'Cell Injury & Cell Death — Condensed', icon: '🧫', status: 'available',
    url: 'https://third-year-med.github.io/' + CC[1] + '/', moduleKey: 'cellcondensed', handoff: 'neo', storagePrefix: 'cc_' }]) }).ok);
  main.addStudents('cellcondensed', [{ username: 'cc1', name: 'Condensed Student', password: PW, mustChange: false }]);
  const start = errors.length;
  try {
    // ---- student: sign in on the module page, then every topic, section and view ----
    const p = await realPage(CC, []);
    await p.goto('https://third-year-med.github.io/' + CC[1] + '/');
    await p.waitForSelector('#nb-user'); await p.fill('#nb-user', 'cc1'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    const info = await p.evaluate(function () { return { cfg: window.NEO_CONFIG, course: COURSE.title, topics: DATA.topics.map(function (t) { return { id: t.id, title: t.title, sections: t.sections.map(function (s) { return { id: s.id, heading: s.heading, tables: s.tables.length, figures: s.figures.length }; }) }; }) }; });
    assert.strictEqual(info.cfg.moduleKey, 'cellcondensed'); assert.strictEqual(info.cfg.storagePrefix, 'cc_');
    assert.strictEqual(info.course, 'Cell Injury & Cell Death', 'plain name — no "Condensed" (user, 2026-10-19)');
    assert.strictEqual(info.topics.length, 17);
    assert.ok(await p.evaluate(function () { return !!sessionStorage.getItem('cc_stu_session_v1') || !!localStorage.getItem('cc_stu_session_v1'); }), 'its own storage prefix');
    for (const tp of info.topics) {
      for (const sc of tp.sections) {
        await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + tp.id + '/' + sc.id);
        await p.waitForFunction(function (h) { const v = document.querySelector('#view-explain'); return v && v.offsetParent !== null && v.textContent.indexOf(h) >= 0; }, sc.heading, { timeout: 10000 });
        const txt = await p.textContent('#view-explain');
        assert.ok(!/undefined|\[object Object\]|\[!(DEF|FLOW|EXAM|RECALL|CONFUSION|HIGHYIELD|PRACTICAL|CLINICAL|REMEMBER|DX|MUSTKNOW)\]/.test(txt), sc.id + ': raw markup or undefined on the page');
      }
    }
    const check = await p.evaluate(function () { return uxValidatePathway(); });
    assert.deepStrictEqual(check.errors, [], 'the learning-unit links (UX_UNITS, UX_FLOW) all point at existing, matching topics and sections');
    const views = ['#/learn', '#/practise', '#/apply', '#/progress', '#/revision', '#/review', '#/review/facts', '#/review/compare', '#/review/morph', '#/review/traps', '#/review/quick',
      '#/cases', '#/practical', '#/study/recall', '#/study/sequence', '#/study/compare', '#/study/glossary', '#/study/challenge', '#/study/connect', '#/quiz'];
    for (const h of views) {
      await p.evaluate(function (x) { location.hash = x; }, h);
      await p.waitForTimeout(350);
      const shown = await p.evaluate(function () { const v = Array.prototype.filter.call(document.querySelectorAll('[id^="view-"]'), function (e) { return e.offsetParent !== null; })[0]; return v ? { id: v.id, n: v.textContent.trim().length, t: v.textContent } : null; });
      assert.ok(shown && shown.n > 40, h + ' shows a view with content');
      assert.ok(!/undefined|\[object Object\]/.test(shown.t), h + ': no undefined');
    }
    // media-print patch: a wide 3000-px picture added to a section prints fitted to the page (no overflow, nothing shrunk)
    const pr = await p.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 700);
      State.customMedia.s0703 = [{ id: 'mp1', type: 'image', url: c.toDataURL('image/jpeg', .5), caption: 'Wide test picture', credit: 'test' }];
      let html = ''; const o = window.open; window.open = function () { return { document: { write: function (x) { html += x; }, close: function () {} } }; };
      try { Views.explain.printChapter(); } finally { window.open = o; delete State.customMedia.s0703; }
      return html.replace(/<script>window\.onload[\s\S]*?<\/script>/, '');
    });
    const pp = await p.context().newPage(); await pp.setViewportSize({ width: 794, height: 1123 }); await pp.setContent(pr, { waitUntil: 'load' });
    const fit = await pp.evaluate(function () { const im = document.querySelector('.media-item img'), b = document.querySelector('.print-body'); return { img: im ? im.getBoundingClientRect().width : -1, body: b.getBoundingClientRect().width, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, fs: getComputedStyle(document.documentElement).fontSize, links: document.querySelectorAll('.links-card').length, linksShown: Array.prototype.filter.call(document.querySelectorAll('.links-card'), function (x) { return x.offsetParent !== null; }).length, atlasBtn: Array.prototype.filter.call(document.querySelectorAll('button.atl-imgbtn'), function (x) { return getComputedStyle(x).display !== 'none'; }).length, mirror: (function () { const c = document.querySelector('.callout'); return !!c && getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'; })() }; });
    assert.strictEqual(fit.fs, '17px', 'print-mirror patch: larger print text');
    assert.ok(fit.mirror, 'print-mirror patch: the printed page carries the screen look (callout colours)');
    assert.ok(fit.links > 0 && fit.linksShown === 0 && fit.atlasBtn > 0, 'print-clean patch: picture link cards left out, atlas pictures printed: ' + JSON.stringify(fit));
    assert.ok(fit.img > 100 && fit.img <= fit.body + 1 && fit.over <= 0, 'an added picture prints within the page width: ' + JSON.stringify(fit));
    await pp.close();
    const lmr = await p.evaluate(function () { const d = LMR.data(); return { facts: d.facts.length, comparisons: d.comparisons.length, traps: d.traps.length, morph: d.morphology.length }; });
    assert.ok(lmr.facts > 50 && lmr.comparisons >= 8 && lmr.traps >= 5 && lmr.morph >= 5, 'Last-Minute Review is built from the condensed course (original: 101 facts, 8 comparisons): ' + JSON.stringify(lmr));
    await p.context().close();

    // ---- teacher: a fresh teacher pass as the dashboard gives it → every slide of the deck ----
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['cellcondensed'] }).modules.cellcondensed;
    assert.ok(tt && tt.token, 'the front-page card makes the module openable from the dashboard');
    const q = await realPage(CC, []);
    await q.addInitScript(function (v) { localStorage.setItem('cc_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await q.goto('https://third-year-med.github.io/' + CC[1] + '/#/present/slide/1');
    await q.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await q.waitForSelector('#pres-stage .slide', { timeout: 15000 });
    const n = await q.evaluate(function () { return Views.present.list().length; });
    assert.ok(n > 120 && n < 225, 'the condensed deck is clearly shorter than the original (241 slides): ' + n);
    const bad = await q.evaluate(function () {
      const out = [], V = Views.present;
      for (let i = 0; i < V.list().length; i++) {
        V.go(i); const s = V.cur(), st = document.querySelector('#pres-stage .slide'), tx = st ? st.textContent : '';
        if (!st) out.push(i + ' no slide');
        else if (/no longer in the course content|Flowchart not found|Question unavailable|undefined/.test(tx)) out.push(i + ' ' + s.type + ': ' + tx.slice(0, 80));
        else if (s.type === 'table' && !st.querySelector('table')) out.push(i + ' table missing');
        else if (s.type === 'content' && !(s.bullets || []).length) out.push(i + ' content without bullets');
      }
      return out;
    });
    assert.deepStrictEqual(bad, [], 'every slide renders');
    await q.evaluate(function () { location.hash = '#/teacher'; });
    await q.waitForSelector('#view-teacher', { state: 'visible', timeout: 10000 });
    const plan = await q.evaluate(function () { return AssessUI.topicQuizPlan().topics.filter(function (x) { return x.ok; }).length; });
    assert.ok(plan >= 15, '⚡ Topic quizzes: most topics still have ≥ 5 practice questions (' + plan + ')');
    await q.context().close();
    assert.deepStrictEqual(errors.slice(start), [], 'no page errors');
  } finally {
    assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg }).ok);   // other tests keep their module list
  }
});

/* ---------------- Neoplasia (neoplasm): the REAL page with its REAL course ----------------
   Registered as the four Code.gs additions and the front-page card register it (HANDBOOK §5), then every learning view
   is opened as a student and every slide of the generated deck as the teacher. Needs NM_CONTENT_KEY (env only). */
test('Neoplasia module (neoplasm): every topic, section, view and slide renders with the real course; student and teacher', { skip: SKIP || ((!fs.existsSync(NM[2]) || !NM[3]) && 'neoplasia module page or NM_CONTENT_KEY not available') }, async function () {
  main.ctx.STUDENT_AUTH_MODULES.neoplasm = true; main.ctx.CONTENT_KEYS.neoplasm = NM[3];
  main.ctx.DEFAULT_QUIZ_PW.neoplasm = 'NEOPLASM-2026'; main.ctx.DEFAULT_LIVE_PW.neoplasm = 'CLASSROOM-2026';
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const reg = main.call({ module: 'portal', action: 'portalInfo' }).modules;
  assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg.concat([{ id: 'neoplasm', title: 'Neoplasia', icon: '🧬', status: 'available',
    url: 'https://third-year-med.github.io/' + NM[1] + '/', moduleKey: 'neoplasm', handoff: 'neo', storagePrefix: 'nm_' }]) }).ok);
  main.addStudents('neoplasm', [{ username: 'nm1', name: 'Neoplasia Student', password: PW, mustChange: false }]);
  const start = errors.length;
  try {
    // ---- student: sign in on the module page, then every topic, section and view ----
    const p = await realPage(NM, []);
    await p.goto('https://third-year-med.github.io/' + NM[1] + '/');
    await p.waitForSelector('#nb-user'); await p.fill('#nb-user', 'nm1'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    const info = await p.evaluate(function () { return { cfg: window.NEO_CONFIG, course: COURSE.title, topics: DATA.topics.map(function (t) { return { id: t.id, title: t.title, sections: t.sections.map(function (s) { return { id: s.id, heading: s.heading, tables: s.tables.length, figures: s.figures.length }; }) }; }) }; });
    assert.strictEqual(info.cfg.moduleKey, 'neoplasm'); assert.strictEqual(info.cfg.storagePrefix, 'nm_'); assert.strictEqual(info.cfg.platformHome, 'https://third-year-med.github.io/Interactive-pathology-platform/');
    assert.strictEqual(info.course, 'Neoplasia', 'plain name (user, 2026-10-19)');
    assert.ok(!/condensed|high-yield/i.test(await p.title() + ' ' + await p.textContent('header')), 'no "Condensed" in the name');
    assert.strictEqual(info.topics.length, 16);
    assert.ok(await p.evaluate(function () { return !!sessionStorage.getItem('nm_stu_session_v1') || !!localStorage.getItem('nm_stu_session_v1'); }), 'its own storage prefix');
    for (const tp of info.topics) {
      for (const sc of tp.sections) {
        await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + tp.id + '/' + sc.id);
        await p.waitForFunction(function (h) { const v = document.querySelector('#view-explain'); return v && v.offsetParent !== null && v.textContent.indexOf(h) >= 0; }, sc.heading, { timeout: 10000 });
        const txt = await p.textContent('#view-explain');
        assert.ok(!/undefined|\[object Object\]|\[!(DEF|FLOW|EXAM|RECALL|CONFUSION|HIGHYIELD|PRACTICAL|CLINICAL|REMEMBER|DX|MUSTKNOW)\]/.test(txt), sc.id + ': raw markup or undefined on the page');
      }
    }
    // ⛶ Full-screen reading (patch learn-fs): only the topic, a centred column, A− / A+, ◀ ▶ keep it, ✕ / Esc / leaving Learn end it
    const t2 = info.topics[1];
    await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + t2.id);
    await p.waitForSelector('#view-explain [data-a=learn-fs]');
    assert.strictEqual(await p.textContent('#view-explain [data-a=learn-fs]'), '⛶ Full screen');
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'learn-normal.png') });
    await p.click('#view-explain [data-a=learn-fs]');
    await p.waitForSelector('#lfs-bar');
    const vis = function (sel) { return p.evaluate(function (q) { const e = document.querySelector(q); return !!(e && e.offsetParent !== null); }, sel); };
    assert.deepStrictEqual([await vis('#app-header'), await vis('.ex-sidebar'), await vis('.footer'), await vis('.ex-main')], [false, false, false, true], 'only the topic');
    assert.strictEqual(await p.textContent('#view-explain [data-a=learn-fs]'), '✕ Exit full screen');
    const z0 = await p.textContent('#lfs-bar .lfs-z');
    await p.click('#lfs-bar button[aria-label="Larger text"]');
    assert.notStrictEqual(await p.textContent('#lfs-bar .lfs-z'), z0, 'A+ makes the text larger');
    const fsz = function () { return p.evaluate(function () { return parseFloat(getComputedStyle(document.querySelector('#view-explain .sec-title, #view-explain h3, #view-explain .ex-main p') || document.querySelector('.ex-main')).fontSize); }); };
    const before = await fsz(); await p.click('#lfs-bar button[aria-label="Larger text"]'); assert.ok(await fsz() > before, 'the reading text grows (' + before + ' → ' + await fsz() + ')');
    await p.click('#lfs-bar button[aria-label="Smaller text"]');
    await p.waitForTimeout(800);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'learn-fullscreen.png') });
    await p.click('#lfs-bar button[aria-label="Smaller text"]');
    await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + info.topics[2].id);   // the next topic: still full screen
    await p.waitForFunction(function (h) { return document.querySelector('#view-explain').textContent.indexOf(h) >= 0; }, info.topics[2].title);
    await p.waitForTimeout(100);
    assert.ok(!!(await p.$('#lfs-bar')) && !(await vis('#app-header')) && !(await vis('.ex-sidebar')), 'stays on for the next topic');
    await p.click('#lfs-bar .lfs-x');
    assert.ok(!(await p.$('#lfs-bar')) && await vis('#app-header') && await vis('.ex-sidebar'), '✕ leaves');
    // learn-fs-key patch: F turns full-screen reading on and off; F typed in a text box does nothing
    await p.evaluate(function () { if (document.activeElement) document.activeElement.blur(); });
    await p.keyboard.press('f'); await p.waitForSelector('#lfs-bar');
    assert.ok(!(await vis('#app-header')), 'F turns full-screen reading on');
    await p.keyboard.press('F'); await p.waitForFunction(function () { return !document.getElementById('lfs-bar'); });
    const note = await p.$('#view-explain textarea');
    if (note) { await note.focus(); await p.keyboard.press('f'); await p.waitForTimeout(150); assert.ok(!(await p.$('#lfs-bar')), 'F in a text box types, no full screen'); await note.fill(''); await p.evaluate(function () { document.activeElement.blur(); }); }
    await p.click('#view-explain [data-a=learn-fs]'); await p.waitForSelector('#lfs-bar');
    await p.keyboard.press('Escape');
    await p.waitForFunction(function () { return !document.getElementById('lfs-bar') && !document.body.classList.contains('learn-fs'); });
    await p.click('#view-explain [data-a=learn-fs]'); await p.waitForSelector('#lfs-bar');
    await p.evaluate(function () { location.hash = '#/practise'; });
    await p.waitForFunction(function () { return !document.getElementById('lfs-bar') && !document.body.classList.contains('learn-fs'); });
    // prac-guide (+ prac-guide-photo) patches: 🧭 before / during / after the practical session — only on the practical topic (t15) and on Apply → Practical, with working links
    await p.evaluate(function () { location.hash = '#/explain/t02'; });
    await p.waitForFunction(function () { return /Topic 2 of/.test(document.querySelector('#view-explain .topic-hero').textContent); });
    assert.strictEqual(await p.$('#view-explain [data-a=prac-guide]'), null, 'no guide on an ordinary topic');
    await p.evaluate(function () { location.hash = '#/explain/t15'; });
    await p.waitForSelector('#view-explain [data-a=prac-guide][open]');
    assert.match(await p.textContent('#view-explain [data-a=prac-guide]'), /Before the session — read this topic.*During the session — open the session’s practical.*describe each gross and microscopic picture.*After the session — open the Image Bank.*Before the exam/);
    await p.click('#view-explain [data-a=prac-guide] >> text=🔬 Open the Practicals');
    await p.waitForSelector('#view-practical [data-a=prac-guide]');
    assert.match(await p.textContent('#view-practical [data-a=prac-guide]'), /read “Practical Pathology — Specimens & Slides” in Learn/);
    await p.click('#view-practical [data-a=prac-guide] >> text=📖 Read the topic in Learn');
    await p.waitForFunction(function () { return location.hash.indexOf('#/explain/t15') === 0; });
    await p.click('#view-explain [data-a=prac-guide] summary');   // folding is remembered
    await p.evaluate(function () { location.hash = '#/practical'; });
    await p.waitForSelector('#view-practical [data-a=prac-guide]:not([open])');
    await p.click('#view-practical [data-a=prac-guide] summary');
    await p.evaluate(function () { location.hash = '#/explain/t15'; });
    await p.waitForSelector('#view-explain [data-a=prac-guide][open]');
    await p.click('#view-explain [data-a=prac-guide] >> text=🖼 Image Bank');
    await p.waitForFunction(function () { return location.hash.indexOf('#/practical/bank') === 0; });
    await p.evaluate(function () { location.hash = '#/explain/t15'; });
    await p.waitForSelector('#view-explain [data-a=prac-guide][open]');
    await p.click('#view-explain [data-a=prac-guide] >> text=🧠 Topic quiz');
    await p.waitForFunction(function () { return location.hash.indexOf('#/revision/topic/t15') === 0; });
    const check = await p.evaluate(function () { return uxValidatePathway(); });
    assert.deepStrictEqual(check.errors, [], 'the learning-unit links (UX_UNITS, UX_FLOW) all point at existing, matching topics and sections');
    const views = ['#/learn', '#/practise', '#/apply', '#/progress', '#/revision', '#/review', '#/review/facts', '#/review/compare', '#/review/morph', '#/review/traps', '#/review/quick',
      '#/cases', '#/practical', '#/study/recall', '#/study/sequence', '#/study/compare', '#/study/glossary', '#/study/challenge', '#/study/connect', '#/quiz'];
    for (const h of views) {
      await p.evaluate(function (x) { location.hash = x; }, h);
      await p.waitForTimeout(350);
      const shown = await p.evaluate(function () { const v = Array.prototype.filter.call(document.querySelectorAll('[id^="view-"]'), function (e) { return e.offsetParent !== null; })[0]; return v ? { id: v.id, n: v.textContent.trim().length, t: v.textContent } : null; });
      assert.ok(shown && shown.n > 40, h + ' shows a view with content');
      assert.ok(!/undefined|\[object Object\]/.test(shown.t), h + ': no undefined');
    }
    // media-print patch: a wide 3000-px picture added to a section prints fitted to the page (no overflow, nothing shrunk)
    const pr = await p.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 700);
      State.customMedia.s0703 = [{ id: 'mp1', type: 'image', url: c.toDataURL('image/jpeg', .5), caption: 'Wide test picture', credit: 'test' }];
      let html = ''; const o = window.open; window.open = function () { return { document: { write: function (x) { html += x; }, close: function () {} } }; };
      try { Views.explain.printChapter(); } finally { window.open = o; delete State.customMedia.s0703; }
      return html.replace(/<script>window\.onload[\s\S]*?<\/script>/, '');
    });
    const pp = await p.context().newPage(); await pp.setViewportSize({ width: 794, height: 1123 }); await pp.setContent(pr, { waitUntil: 'load' });
    const fit = await pp.evaluate(function () { const im = document.querySelector('.media-item img'), b = document.querySelector('.print-body'); return { img: im ? im.getBoundingClientRect().width : -1, body: b.getBoundingClientRect().width, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, fs: getComputedStyle(document.documentElement).fontSize, links: document.querySelectorAll('.links-card').length, linksShown: Array.prototype.filter.call(document.querySelectorAll('.links-card'), function (x) { return x.offsetParent !== null; }).length, atlasBtn: Array.prototype.filter.call(document.querySelectorAll('button.atl-imgbtn'), function (x) { return getComputedStyle(x).display !== 'none'; }).length, mirror: (function () { const c = document.querySelector('.callout'); return !!c && getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'; })() }; });
    assert.strictEqual(fit.fs, '17px', 'print-mirror patch: larger print text');
    assert.ok(fit.mirror, 'print-mirror patch: the printed page carries the screen look (callout colours)');
    assert.ok(fit.linksShown === 0, 'print-clean patch: picture link cards left out: ' + JSON.stringify(fit));
    assert.ok(fit.img > 100 && fit.img <= fit.body + 1 && fit.over <= 0, 'an added picture prints within the page width: ' + JSON.stringify(fit));
    await pp.close();
    const lmr = await p.evaluate(function () { const d = LMR.data(); return { facts: d.facts.length, comparisons: d.comparisons.length, traps: d.traps.length, morph: d.morphology.length, images: (DATA.images || []).length }; });
    assert.ok(lmr.facts > 50 && lmr.comparisons >= 8 && lmr.traps >= 5 && (lmr.morph >= 5 || lmr.images === 0), 'Last-Minute Review is built from the course (morphology needs atlas pictures): ' + JSON.stringify(lmr));
    console.log('# neoplasm Last-Minute Review: ' + JSON.stringify(lmr));
    const hy = await p.evaluate(function () { return typeof lmrPrintFacts === 'function' && typeof lmrUnitOf === 'function' && !!window.PlatformHY; });
    assert.ok(hy, 'High-Yield print: the platform standard takes over lmrPrintFacts (LMR, lmrPrintFacts, lmrUnitOf kept)');
    await p.context().close();

    // ---- teacher: a fresh teacher pass as the dashboard gives it → every slide of the deck ----
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['neoplasm'] }).modules.neoplasm;
    assert.ok(tt && tt.token, 'the front-page card makes the module openable from the dashboard');
    const q = await realPage(NM, []);
    await q.addInitScript(function (v) { localStorage.setItem('nm_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await q.goto('https://third-year-med.github.io/' + NM[1] + '/#/present/slide/1');
    await q.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await q.waitForSelector('#pres-stage .slide', { timeout: 15000 });
    const n = await q.evaluate(function () { return Views.present.list().length; });
    assert.ok(n > 100 && n < 260, 'deck size of a condensed module: ' + n);
    console.log('# neoplasm deck: ' + n + ' slides');
    const bad = await q.evaluate(function () {
      const out = [], V = Views.present;
      for (let i = 0; i < V.list().length; i++) {
        V.go(i); const s = V.cur(), st = document.querySelector('#pres-stage .slide'), tx = st ? st.textContent : '';
        if (!st) out.push(i + ' no slide');
        else if (/no longer in the course content|Flowchart not found|Question unavailable|undefined/.test(tx)) out.push(i + ' ' + s.type + ': ' + tx.slice(0, 80));
        else if (s.type === 'table' && !st.querySelector('table')) out.push(i + ' table missing');
        else if (s.type === 'content' && !(s.bullets || []).length) out.push(i + ' content without bullets');
      }
      return out;
    });
    assert.deepStrictEqual(bad, [], 'every slide renders');
    await q.evaluate(function () { location.hash = '#/teacher'; });
    await q.waitForSelector('#view-teacher', { state: 'visible', timeout: 10000 });
    const plan = await q.evaluate(function () { return AssessUI.topicQuizPlan().topics.filter(function (x) { return x.ok; }).length; });
    assert.ok(plan >= 15, '⚡ Topic quizzes: every topic has ≥ 5 practice questions (' + plan + ')');
    await q.context().close();
    assert.deepStrictEqual(errors.slice(start), [], 'no page errors');
  } finally {
    assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg }).ok);   // other tests keep their module list
  }
});

/* ---------------- Genetics and Pediatric Diseases (genetics): the REAL page with its REAL course ----------------
   Registered as the four Code.gs additions and the front-page card register it (HANDBOOK §5), then every learning view
   is opened as a student and every slide of the generated deck as the teacher. Needs GEN_CONTENT_KEY (env only). */
test('Genetics and Pediatric Diseases module (genetics): every topic, section, view and slide renders with the real course; student and teacher', { skip: SKIP || ((!fs.existsSync(GEN[2]) || !GEN[3]) && 'genetics module page or GEN_CONTENT_KEY not available') }, async function () {
  main.ctx.STUDENT_AUTH_MODULES.genetics = true; main.ctx.CONTENT_KEYS.genetics = GEN[3];
  main.ctx.DEFAULT_QUIZ_PW.genetics = 'GENETICS-2026'; main.ctx.DEFAULT_LIVE_PW.genetics = 'CLASSROOM-2026';
  main.call({ module: 'portal', action: 'setup', password: TPW });
  const t = main.call({ module: 'portal', action: 'login', password: TPW }).token;
  const reg = main.call({ module: 'portal', action: 'portalInfo' }).modules;
  assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg.concat([{ id: 'genetics', title: 'Genetics and Pediatric Diseases', icon: '🧬', status: 'available',
    url: 'https://third-year-med.github.io/' + GEN[1] + '/', moduleKey: 'genetics', handoff: 'neo', storagePrefix: 'gen_' }]) }).ok);
  main.addStudents('genetics', [{ username: 'gen1', name: 'Genetics Student', password: PW, mustChange: false }]);
  const start = errors.length;
  try {
    // ---- student: sign in on the module page, then every topic, section and view ----
    const p = await realPage(GEN, []);
    await p.goto('https://third-year-med.github.io/' + GEN[1] + '/');
    await p.waitForSelector('#nb-user'); await p.fill('#nb-user', 'gen1'); await p.fill('#nb-pass', PW); await p.click('#neo-boot button[type=submit]');
    await p.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'student'; }, null, { timeout: 20000 });
    const info = await p.evaluate(function () { return { cfg: window.NEO_CONFIG, course: COURSE.title, topics: DATA.topics.map(function (t) { return { id: t.id, title: t.title, sections: t.sections.map(function (s) { return { id: s.id, heading: s.heading, tables: s.tables.length, figures: s.figures.length }; }) }; }) }; });
    assert.strictEqual(info.cfg.moduleKey, 'genetics'); assert.strictEqual(info.cfg.storagePrefix, 'gen_'); assert.strictEqual(info.cfg.platformHome, 'https://third-year-med.github.io/Interactive-pathology-platform/');
    assert.strictEqual(info.course, 'Genetics and Pediatric Diseases', 'exact title (user, 2026-10-23)');
    assert.ok(!/condensed|high-yield/i.test(await p.title() + ' ' + await p.textContent('header')), 'no "Condensed" in the name');
    assert.ok(!/condensed|high-yield|review|teaching module/i.test(await p.title() + ' ' + await p.textContent('header .t1')), 'the exact title only (user, 2026-10-23)');
    assert.strictEqual(info.topics.length, 15);
    assert.ok(await p.evaluate(function () { return !!sessionStorage.getItem('gen_stu_session_v1') || !!localStorage.getItem('gen_stu_session_v1'); }), 'its own storage prefix');
    for (const tp of info.topics) {
      for (const sc of tp.sections) {
        await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + tp.id + '/' + sc.id);
        await p.waitForFunction(function (h) { const v = document.querySelector('#view-explain'); return v && v.offsetParent !== null && v.textContent.indexOf(h) >= 0; }, sc.heading, { timeout: 10000 });
        const txt = await p.textContent('#view-explain');
        assert.ok(!/undefined|\[object Object\]|\[!(DEF|FLOW|EXAM|RECALL|CONFUSION|HIGHYIELD|PRACTICAL|CLINICAL|REMEMBER|DX|MUSTKNOW)\]/.test(txt), sc.id + ': raw markup or undefined on the page');
      }
    }
    // ⛶ Full-screen reading (patch learn-fs): only the topic, a centred column, A− / A+, ◀ ▶ keep it, ✕ / Esc / leaving Learn end it
    const t2 = info.topics[1];
    await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + t2.id);
    await p.waitForSelector('#view-explain [data-a=learn-fs]');
    assert.strictEqual(await p.textContent('#view-explain [data-a=learn-fs]'), '⛶ Full screen');
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'learn-normal.png') });
    await p.click('#view-explain [data-a=learn-fs]');
    await p.waitForSelector('#lfs-bar');
    const vis = function (sel) { return p.evaluate(function (q) { const e = document.querySelector(q); return !!(e && e.offsetParent !== null); }, sel); };
    assert.deepStrictEqual([await vis('#app-header'), await vis('.ex-sidebar'), await vis('.footer'), await vis('.ex-main')], [false, false, false, true], 'only the topic');
    assert.strictEqual(await p.textContent('#view-explain [data-a=learn-fs]'), '✕ Exit full screen');
    const z0 = await p.textContent('#lfs-bar .lfs-z');
    await p.click('#lfs-bar button[aria-label="Larger text"]');
    assert.notStrictEqual(await p.textContent('#lfs-bar .lfs-z'), z0, 'A+ makes the text larger');
    const fsz = function () { return p.evaluate(function () { return parseFloat(getComputedStyle(document.querySelector('#view-explain .sec-title, #view-explain h3, #view-explain .ex-main p') || document.querySelector('.ex-main')).fontSize); }); };
    const before = await fsz(); await p.click('#lfs-bar button[aria-label="Larger text"]'); assert.ok(await fsz() > before, 'the reading text grows (' + before + ' → ' + await fsz() + ')');
    await p.click('#lfs-bar button[aria-label="Smaller text"]');
    await p.waitForTimeout(800);
    if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'learn-fullscreen.png') });
    await p.click('#lfs-bar button[aria-label="Smaller text"]');
    await p.evaluate(function (h) { location.hash = h; }, '#/explain/' + info.topics[2].id);   // the next topic: still full screen
    await p.waitForFunction(function (h) { return document.querySelector('#view-explain').textContent.indexOf(h) >= 0; }, info.topics[2].title);
    await p.waitForTimeout(100);
    assert.ok(!!(await p.$('#lfs-bar')) && !(await vis('#app-header')) && !(await vis('.ex-sidebar')), 'stays on for the next topic');
    await p.click('#lfs-bar .lfs-x');
    assert.ok(!(await p.$('#lfs-bar')) && await vis('#app-header') && await vis('.ex-sidebar'), '✕ leaves');
    // learn-fs-key patch: F turns full-screen reading on and off; F typed in a text box does nothing
    await p.evaluate(function () { if (document.activeElement) document.activeElement.blur(); });
    await p.keyboard.press('f'); await p.waitForSelector('#lfs-bar');
    assert.ok(!(await vis('#app-header')), 'F turns full-screen reading on');
    await p.keyboard.press('F'); await p.waitForFunction(function () { return !document.getElementById('lfs-bar'); });
    const note = await p.$('#view-explain textarea');
    if (note) { await note.focus(); await p.keyboard.press('f'); await p.waitForTimeout(150); assert.ok(!(await p.$('#lfs-bar')), 'F in a text box types, no full screen'); await note.fill(''); await p.evaluate(function () { document.activeElement.blur(); }); }
    await p.click('#view-explain [data-a=learn-fs]'); await p.waitForSelector('#lfs-bar');
    await p.keyboard.press('Escape');
    await p.waitForFunction(function () { return !document.getElementById('lfs-bar') && !document.body.classList.contains('learn-fs'); });
    await p.click('#view-explain [data-a=learn-fs]'); await p.waitForSelector('#lfs-bar');
    await p.evaluate(function () { location.hash = '#/practise'; });
    await p.waitForFunction(function () { return !document.getElementById('lfs-bar') && !document.body.classList.contains('learn-fs'); });
    const check = await p.evaluate(function () { return uxValidatePathway(); });
    assert.deepStrictEqual(check.errors, [], 'the learning-unit links (UX_UNITS, UX_FLOW) all point at existing, matching topics and sections');
    const views = ['#/learn', '#/practise', '#/apply', '#/progress', '#/revision', '#/review', '#/review/facts', '#/review/compare', '#/review/morph', '#/review/traps', '#/review/quick',
      '#/cases', '#/practical', '#/study/recall', '#/study/sequence', '#/study/compare', '#/study/glossary', '#/study/challenge', '#/study/connect', '#/quiz'];
    for (const h of views) {
      await p.evaluate(function (x) { location.hash = x; }, h);
      await p.waitForTimeout(350);
      const shown = await p.evaluate(function () { const v = Array.prototype.filter.call(document.querySelectorAll('[id^="view-"]'), function (e) { return e.offsetParent !== null; })[0]; return v ? { id: v.id, n: v.textContent.trim().length, t: v.textContent } : null; });
      assert.ok(shown && shown.n > 40, h + ' shows a view with content');
      assert.ok(!/undefined|\[object Object\]/.test(shown.t), h + ': no undefined');
    }
    // media-print patch: a wide 3000-px picture added to a section prints fitted to the page (no overflow, nothing shrunk)
    const pr = await p.evaluate(function () {
      const c = document.createElement('canvas'); c.width = 3000; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 700);
      State.customMedia.s0703 = [{ id: 'mp1', type: 'image', url: c.toDataURL('image/jpeg', .5), caption: 'Wide test picture', credit: 'test' }];
      let html = ''; const o = window.open; window.open = function () { return { document: { write: function (x) { html += x; }, close: function () {} } }; };
      try { Views.explain.printChapter(); } finally { window.open = o; delete State.customMedia.s0703; }
      return html.replace(/<script>window\.onload[\s\S]*?<\/script>/, '');
    });
    const pp = await p.context().newPage(); await pp.setViewportSize({ width: 794, height: 1123 }); await pp.setContent(pr, { waitUntil: 'load' });
    const fit = await pp.evaluate(function () { const im = document.querySelector('.media-item img'), b = document.querySelector('.print-body'); return { img: im ? im.getBoundingClientRect().width : -1, body: b.getBoundingClientRect().width, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, fs: getComputedStyle(document.documentElement).fontSize, links: document.querySelectorAll('.links-card').length, linksShown: Array.prototype.filter.call(document.querySelectorAll('.links-card'), function (x) { return x.offsetParent !== null; }).length, atlasBtn: Array.prototype.filter.call(document.querySelectorAll('button.atl-imgbtn'), function (x) { return getComputedStyle(x).display !== 'none'; }).length, mirror: (function () { const c = document.querySelector('.callout'); return !!c && getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'; })() }; });
    assert.strictEqual(fit.fs, '17px', 'print-mirror patch: larger print text');
    assert.ok(fit.mirror, 'print-mirror patch: the printed page carries the screen look (callout colours)');
    assert.ok(fit.linksShown === 0, 'print-clean patch: picture link cards left out: ' + JSON.stringify(fit));
    assert.ok(fit.img > 100 && fit.img <= fit.body + 1 && fit.over <= 0, 'an added picture prints within the page width: ' + JSON.stringify(fit));
    await pp.close();
    const lmr = await p.evaluate(function () { const d = LMR.data(); return { facts: d.facts.length, comparisons: d.comparisons.length, traps: d.traps.length, morph: d.morphology.length, images: (DATA.images || []).length }; });
    assert.ok(lmr.facts > 50 && lmr.comparisons >= 8 && lmr.traps >= 5 && (lmr.morph >= 5 || lmr.images === 0), 'Last-Minute Review is built from the course (morphology needs atlas pictures): ' + JSON.stringify(lmr));
    console.log('# genetics Last-Minute Review: ' + JSON.stringify(lmr));
    const hy = await p.evaluate(function () { return typeof lmrPrintFacts === 'function' && typeof lmrUnitOf === 'function' && !!window.PlatformHY; });
    assert.ok(hy, 'High-Yield print: the platform standard takes over lmrPrintFacts (LMR, lmrPrintFacts, lmrUnitOf kept)');
    await p.context().close();

    // ---- teacher: a fresh teacher pass as the dashboard gives it → every slide of the deck ----
    const tt = main.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['genetics'] }).modules.genetics;
    assert.ok(tt && tt.token, 'the front-page card makes the module openable from the dashboard');
    const q = await realPage(GEN, []);
    await q.addInitScript(function (v) { localStorage.setItem('gen_backend_token_v1', v); }, JSON.stringify({ token: tt.token, expiresAt: tt.expiresAt }));
    await q.goto('https://third-year-med.github.io/' + GEN[1] + '/#/present/slide/1');
    await q.waitForFunction(function () { return window.NEO_BOOT && window.NEO_BOOT.role === 'teacher'; }, null, { timeout: 20000 });
    await q.waitForSelector('#pres-stage .slide', { timeout: 15000 });
    const n = await q.evaluate(function () { return Views.present.list().length; });
    assert.ok(n > 100 && n < 260, 'deck size of a condensed module: ' + n);
    console.log('# genetics deck: ' + n + ' slides');
    const bad = await q.evaluate(function () {
      const out = [], V = Views.present;
      for (let i = 0; i < V.list().length; i++) {
        V.go(i); const s = V.cur(), st = document.querySelector('#pres-stage .slide'), tx = st ? st.textContent : '';
        if (!st) out.push(i + ' no slide');
        else if (/no longer in the course content|Flowchart not found|Question unavailable|undefined/.test(tx)) out.push(i + ' ' + s.type + ': ' + tx.slice(0, 80));
        else if (s.type === 'table' && !st.querySelector('table')) out.push(i + ' table missing');
        else if (s.type === 'content' && !(s.bullets || []).length) out.push(i + ' content without bullets');
      }
      return out;
    });
    assert.deepStrictEqual(bad, [], 'every slide renders');
    await q.evaluate(function () { location.hash = '#/teacher'; });
    await q.waitForSelector('#view-teacher', { state: 'visible', timeout: 10000 });
    const plan = await q.evaluate(function () { return AssessUI.topicQuizPlan().topics.filter(function (x) { return x.ok; }).length; });
    assert.ok(plan >= 14, '⚡ Topic quizzes: every topic has ≥ 5 practice questions (' + plan + ')');
    await q.context().close();
    assert.deepStrictEqual(errors.slice(start), [], 'no page errors');
  } finally {
    assert.ok(main.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: reg }).ok);   // other tests keep their module list
  }
});
