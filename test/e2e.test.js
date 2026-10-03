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

test('the front page fits a phone screen', { skip: SKIP }, async function () {
  const p = await page({ width: 390, height: 844 });
  await p.goto(url);
  await p.waitForSelector('.mod');
  assert.ok(await p.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; }) <= 1);
  await p.context().close();
});

test('branding: heading, "Created by", no department line; Teacher Module Portal at the top', { skip: SKIP }, async function () {
  const p = await page();
  await p.goto(url);
  await p.waitForSelector('.mod');
  assert.strictEqual((await p.textContent('.hero h1')).trim(), 'Interactive Pathology Teaching Platform');
  assert.strictEqual((await p.textContent('.hero .by')).trim(), 'Created by Dr. Wesam Alzwawy');
  assert.match(await p.textContent('.top'), /Created by Dr\. Wesam Alzwawy/);
  const all = await p.textContent('body');
  assert.ok(!/Misurata|Pathology Department|College of Medicine/.test(all), 'department line removed');
  const tp = await p.$('.top a.tportal');
  assert.ok(tp, 'Teacher Module Portal button in the top bar');
  assert.match(await tp.textContent(), /Teacher Module Portal/);
  await tp.click();
  await p.waitForSelector('#t-p');
  assert.match(await p.textContent('h1.page-h'), /Teacher Module Portal/);
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
[['cellinjury', 'cell-injury-teaching-platform', process.env.CI_MODULE_HTML || '/home/user/third-year-med/cell-injury-teaching-platform/index.html'],
 ['inflhealing', 'inflammation-healing', process.env.IH_MODULE_HTML || '/home/user/third-year-med/inflammation-healing/index.html']].forEach(function (M) {
  test('the real ' + M[1] + ' module accepts the hand-over (no second sign-in)', { skip: SKIP || (!fs.existsSync(M[2]) && 'module page not available') }, async function () {
    main.addStudents('cellinjury', [{ username: 'both-' + M[0], name: 'Both Modules', password: PW, mustChange: false }]);
    main.addStudents('inflhealing', [{ username: 'both-' + M[0], name: 'Both Modules', password: PW, mustChange: false }]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', function (e) { if (!/content key|decrypt/i.test(e.message)) errors.push(M[1] + ': ' + e.message); });
    const calls = [];
    // the module talks to ITS configured backend (the real URL); the front page to MAINTEST — both answered by the test backend
    await p.route('https://script.google.com/**', async function (route) {
      const body = route.request().postData() || '';
      calls.push(JSON.parse(body));
      await route.fulfill({ status: 200, contentType: 'application/json', body: main.ctx.doPost({ postData: { contents: body } }).getContent() });
    });
    await p.route('https://third-year-med.github.io/**', function (route) {
      const u = new URL(route.request().url());
      if (u.pathname.indexOf('/' + M[1] + '/') === 0) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(M[2]) });
      const rel = u.pathname.replace(/^\/Interactive-pathology-platform\/?/, '') || 'index.html';
      if (rel === 'config.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.PORTAL_CONFIG = ' + JSON.stringify({ backendUrl: MAIN }) + ';' });
      const f = path.join(ROOT, rel);
      if (!fs.existsSync(f) || rel.indexOf('..') >= 0) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(f)], body: fs.readFileSync(f) });
    });
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
