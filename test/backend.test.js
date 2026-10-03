'use strict';
/* Portal.gs tests: the real Code.gs core excerpt (with the one added route_ line) + Portal.gs in the harness. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createBackend } = require('./apps-script/harness');
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(__dirname, '..', 'backend', 'Portal.gs')];
const PW = 'student-pass-1';

function setup() {
  const b = createBackend({ files: FILES });
  const call = function (o) { return b.doPost(o); };
  const tokens = {};
  ['cellinjury', 'inflhealing', 'vulva'].forEach(function (m) {
    assert.ok(call({ module: m, action: 'setup', password: 'teacher-' + m + '-1' }).ok);
    tokens[m] = call({ module: m, action: 'login', password: 'teacher-' + m + '-1' }).token;
  });
  const add = function (m, list) { const r = call({ module: m, action: 'bulkAddStudents', token: tokens[m], students: list }); assert.ok(r.ok, JSON.stringify(r)); return r; };
  // s1: same password in cell injury + inflammation; a different one in vulva
  add('cellinjury', [{ username: 's1', name: 'Student One', password: PW, mustChange: false }, { username: 's2', name: 'Student Two', password: PW, mustChange: false }]);
  add('inflhealing', [{ username: 's1', name: 'Student One', password: PW, mustChange: false }]);
  add('vulva', [{ username: 's1', name: 'Student One', password: 'another-pass-9', mustChange: false }]);
  return { b: b, call: call, tokens: tokens };
}
const ALL = ['cellinjury', 'inflhealing', 'vulva', 'neoplasia'];

test('portalInfo is public and lists the modules with a status', function () {
  const S = setup();
  const r = S.call({ module: 'portal', action: 'portalInfo' });
  assert.ok(r.ok);
  assert.ok(r.modules.length >= 2);
  r.modules.forEach(function (m) { assert.ok(['available', 'ready', 'soon'].indexOf(m.status) >= 0); });
  assert.strictEqual(JSON.stringify(r).indexOf('pwHash'), -1);
});

test('a student enters only the modules registered with this Student ID AND password', function () {
  const S = setup();
  const r = S.call({ module: 'portal', action: 'portalCheck', username: 'S1', password: PW, modules: ALL });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.student.name, 'Student One');
  assert.strictEqual(r.modules.cellinjury.access, true);
  assert.strictEqual(r.modules.inflhealing.access, true);
  assert.strictEqual(r.modules.vulva.access, false); assert.strictEqual(r.modules.vulva.reason, 'otherpassword');
  assert.strictEqual(r.modules.neoplasia.access, false); assert.strictEqual(r.modules.neoplasia.reason, 'notregistered');
  // the session opened is a normal session of THAT module, accepted by the module itself
  const ses = S.call({ module: 'cellinjury', action: 'studentSession', stoken: r.modules.cellinjury.token });
  assert.ok(ses.ok && ses.role === 'student' && ses.student.username === 's1');
  // …and never by another module
  const cross = S.call({ module: 'inflhealing', action: 'studentSession', stoken: r.modules.cellinjury.token });
  assert.strictEqual(cross.ok, false);
  // s2 has only a cell injury account
  const r2 = S.call({ module: 'portal', action: 'portalCheck', username: 's2', password: PW, modules: ALL });
  assert.deepStrictEqual(Object.keys(r2.modules).filter(function (k) { return r2.modules[k].access; }), ['cellinjury']);
});

test('wrong password or unknown ID: one generic answer, no module details, rate limited', function () {
  const S = setup();
  const a = S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: 'wrong', modules: ALL });
  const b = S.call({ module: 'portal', action: 'portalCheck', username: 'nobody', password: 'wrong', modules: ALL });
  assert.strictEqual(a.ok, false); assert.strictEqual(b.ok, false);
  assert.strictEqual(a.error, b.error); assert.ok(!a.modules && !b.modules);
  for (let i = 0; i < 9; i++) S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: 'wrong' + i, modules: ALL });
  const locked = S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: PW, modules: ALL });
  assert.strictEqual(locked.code, 'locked');
  // the module accounts themselves were not locked by the front page
  assert.ok(S.call({ module: 'cellinjury', action: 'studentLogin', username: 's1', password: PW }).ok);
});

test('a deactivated account does not get in, even with the right password', function () {
  const S = setup();
  assert.ok(S.call({ module: 'inflhealing', action: 'setStudentActive', token: S.tokens.inflhealing, username: 's1', active: false }).ok);
  const r = S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: PW, modules: ALL });
  assert.strictEqual(r.modules.inflhealing.access, false); assert.strictEqual(r.modules.inflhealing.reason, 'inactive');
  assert.strictEqual(r.modules.cellinjury.access, true);
});

test('module status is display-only: changing it never opens a module without an account', function () {
  const S = setup();
  S.call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  const t = S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const g = S.call({ module: 'portal', action: 'portalAdminGet', token: t });
  assert.ok(g.ok); assert.strictEqual(g.counts.cellinjury, 2);
  const mods = g.modules.map(function (m) { return Object.assign({}, m, { status: 'available' }); });
  assert.ok(S.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: mods }).ok);
  const info = S.call({ module: 'portal', action: 'portalInfo' });
  assert.ok(info.modules.every(function (m) { return m.status === 'available'; }));
  const r = S.call({ module: 'portal', action: 'portalCheck', username: 's2', password: PW, modules: ALL });
  assert.strictEqual(r.modules.inflhealing.access, false);
  assert.strictEqual(r.modules.neoplasia.access, false);
});

test('teacher actions need a portal teacher session (not a student, not another module\'s teacher)', function () {
  const S = setup();
  const stu = S.call({ module: 'cellinjury', action: 'studentLogin', username: 's1', password: PW }).token;
  [{ stoken: stu }, { token: S.tokens.cellinjury }, {}].forEach(function (auth) {
    const r = S.call(Object.assign({ module: 'portal', action: 'portalAdminSave', modules: [] }, auth));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(S.call(Object.assign({ module: 'portal', action: 'portalAdminGet' }, auth)).ok, false);
  });
  assert.strictEqual(S.call({ module: 'portal', action: 'getAllContent' }).ok, false, 'no other actions under module portal');
});

test('input is cleaned: bad links, colours and duplicate ids are refused', function () {
  const S = setup();
  S.call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  const t = S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const r = S.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: [{ id: 'x', title: '<b>x</b>', url: 'javascript:alert(1)', color: 'red', status: 'weird', backend: 'https://evil.example/exec' }] });
  assert.ok(r.ok);
  assert.strictEqual(r.modules[0].url, ''); assert.strictEqual(r.modules[0].color, '#0f2a4a'); assert.strictEqual(r.modules[0].status, 'soon'); assert.strictEqual(r.modules[0].backend, '');
  assert.strictEqual(S.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: [{ id: 'a' }, { id: 'a' }] }).ok, false);
});

test('one teacher sign-in opens every listed module as teacher — no module password, no student accounts needed', function () {
  const b = createBackend({ files: FILES });
  const call = function (o) { return b.doPost(o); };
  // a fresh backend: no module teacher password, no student accounts at all
  assert.ok(call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' }).ok);
  const t = call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const r = call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['cellinjury', 'inflhealing', 'notlisted', 'portal'] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(Object.keys(r.modules).sort(), ['cellinjury', 'inflhealing'], 'only modules on the front-page list');
  // each is a real teacher session of THAT module, recognised by the module's own session check
  const ses = call({ module: 'cellinjury', action: 'studentSession', token: r.modules.cellinjury.token });
  assert.ok(ses.ok && ses.role === 'teacher', JSON.stringify(ses));
  assert.ok(call({ module: 'cellinjury', action: 'listStudents', token: r.modules.cellinjury.token }).ok, 'module teacher functions work');
  // …and not by another module
  const cross = call({ module: 'inflhealing', action: 'listStudents', token: r.modules.cellinjury.token });
  assert.strictEqual(cross.ok, false);
  // signing the teacher out of a module ends that session
  assert.ok(call({ module: 'cellinjury', action: 'logout', token: r.modules.cellinjury.token }).ok);
  assert.strictEqual(call({ module: 'cellinjury', action: 'listStudents', token: r.modules.cellinjury.token }).ok, false);
});

test('portalTeacherOpen is refused without a front-page teacher session', function () {
  const S = setup();
  const stu = S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: PW, modules: ['cellinjury'] }).modules.cellinjury.token;
  [{ stoken: stu }, { token: stu }, { token: S.tokens.cellinjury }, {}].forEach(function (auth) {
    const r = S.call(Object.assign({ module: 'portal', action: 'portalTeacherOpen', modules: ['cellinjury'] }, auth));
    assert.strictEqual(r.ok, false, JSON.stringify(auth));
    assert.ok(!r.modules);
  });
});

test('portalTeacherClose ends module teacher sessions at once (also their cached check), and nothing else', function () {
  const S = setup();
  S.call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  const t = S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const r = S.call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: ['cellinjury', 'inflhealing'] });
  const ci = r.modules.cellinjury.token, ih = r.modules.inflhealing.token;
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'studentSession', token: ci }).role, 'teacher');   // fills the cache
  // a token sent with the wrong module, or the portal session itself, is not touched
  assert.strictEqual(S.call({ module: 'portal', action: 'portalTeacherClose', sessions: [{ module: 'cellinjury', token: ih }, { module: 'portal', token: t }] }).closed, 0);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalTeacherClose', sessions: [{ module: 'cellinjury', token: ci }] }).closed, 1);
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'studentSession', token: ci }).ok, false, 'no longer accepted, even from the cache');
  assert.strictEqual(S.call({ module: 'inflhealing', action: 'studentSession', token: ih }).role, 'teacher');
  assert.ok(S.call({ module: 'portal', action: 'portalAdminGet', token: t }).ok);
  assert.ok(S.call({ module: 'cellinjury', action: 'listStudents', token: S.tokens.cellinjury }).ok, 'the module\'s other teacher sessions are untouched');
});

test('group links (?g=): the teacher opens any group of a listed module as teacher; sign-out ends it', function () {
  const b = createBackend({ files: FILES });
  const call = function (o) { return b.doPost(o); };
  call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  const t = call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const r = call({ module: 'portal', action: 'portalTeacherOpen', token: t, modules: [{ module: 'cellinjury', group: 'B' }, { module: 'cellinjury', group: 'bad tag!' }, { module: 'notlisted', group: 'B' }, 'inflhealing'] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(Object.keys(r.modules).sort(), ['cellinjury-B', 'inflhealing']);
  const g = r.modules['cellinjury-B'].token;
  // the module page opened with ?g=B talks to module "cellinjury-B": the session is a teacher session there…
  const ses = call({ module: 'cellinjury-B', action: 'studentSession', token: g });
  assert.ok(ses.ok && ses.role === 'teacher' && ses.contentKey !== undefined, JSON.stringify(ses));
  assert.ok(call({ module: 'cellinjury-B', action: 'listStudents', token: g }).ok, 'group management works');
  // …and nowhere else (not the plain module, not another group)
  assert.strictEqual(call({ module: 'cellinjury', action: 'listStudents', token: g }).ok, false);
  assert.strictEqual(call({ module: 'cellinjury-A', action: 'listStudents', token: g }).ok, false);
  assert.strictEqual(call({ module: 'portal', action: 'portalTeacherClose', sessions: [{ module: 'cellinjury-B', token: g }] }).closed, 1);
  assert.strictEqual(call({ module: 'cellinjury-B', action: 'studentSession', token: g }).ok, false, 'ended at once');
});

test('the module list keeps a clean list of group tags', function () {
  const S = setup();
  S.call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  const t = S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  const r = S.call({ module: 'portal', action: 'portalAdminSave', token: t, modules: [{ id: 'x', groups: 'A, B;B  <x> Year-3' }] });
  assert.deepStrictEqual(r.modules[0].groups, ['A', 'B', 'Year-3']);
});
