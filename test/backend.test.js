'use strict';
/* Portal.gs tests: the real Code.gs core excerpt (with the one added route_ line) + Portal.gs in the harness. */
const test = require('node:test');
const assert = require('node:assert');
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
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(__dirname, 'apps-script', 'Code.exam.gs'), path.join(__dirname, '..', 'backend', 'Portal.gs')];
const PW = 'student-pass-1';

function setup() {
  const b = fixtureBackend({ files: FILES });
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
  const b = fixtureBackend({ files: FILES });
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
  const b = fixtureBackend({ files: FILES });
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

/* ---------------- Step 1: platform directory (Admin only; stored, not used for access) ---------------- */
function adminSetup() {
  const S = setup();
  S.call({ module: 'portal', action: 'setup', password: 'portal-teacher-1' });
  S.admin = S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1' }).token;
  S.dir = function (action, o) { return S.call(Object.assign({ module: 'portal', action: action, token: S.admin }, o || {})); };
  S.save = function (kind, record, extra) { return S.dir('dirSave', Object.assign({ kind: kind, record: record }, extra || {})); };
  return S;
}
function fingerprint(b, names) {
  const out = {};
  names.forEach(function (n) { out[n] = b.sheets[n] ? JSON.stringify(b.sheets[n]._rows) : null; });
  return out;
}
const EXISTING = ['Content', 'Results', 'Settings', 'Students', 'StudentSessions', 'AssessRecords', 'AttendanceSessions', 'AttendanceRecords'];

test('directory: Admin only; first use creates its own sheets and copies the current module list', function () {
  const S = adminSetup();
  const stu = S.call({ module: 'cellinjury', action: 'studentLogin', username: 's1', password: PW }).token;
  [{ stoken: stu }, { token: S.tokens.cellinjury }, {}].forEach(function (auth) {
    ['dirGet', 'dirSave', 'dirSetActive', 'dirScan'].forEach(function (a) {
      assert.strictEqual(S.call(Object.assign({ module: 'portal', action: a, kind: 'institution', record: { name: 'X' } }, auth)).ok, false, a + ' ' + JSON.stringify(auth));
    });
  });
  assert.ok(!S.b.sheets.Institutions, 'refused calls create nothing');
  const g = S.dir('dirGet');
  assert.ok(g.ok, JSON.stringify(g));
  ['Institutions', 'Groups', 'Modules', 'Deliveries', 'TeacherAssignments', 'ModuleContentRoles'].forEach(function (n) { assert.ok(S.b.sheets[n], n + ' created'); });
  assert.deepStrictEqual(g.modules.map(function (m) { return m.moduleId; }), ['cellinjury', 'inflhealing']);
  assert.strictEqual(g.modules[0].title, 'Cell Injury & Cell Death');
  assert.strictEqual(S.dir('dirGet').modules.length, 2, 'copied once only');
});

test('directory: the Al-Razi / Misrata example — same visible group name, separate ids, separate deliveries', function () {
  const S = adminSetup();
  const razi = S.save('institution', { name: 'Al-Razi University', shortName: 'Al-Razi' }).record;
  const mis = S.save('institution', { name: 'Misrata University', shortName: 'Misrata' }).record;
  assert.match(razi.institutionId, /^INS-[A-Z2-9]{6}$/); assert.notStrictEqual(razi.institutionId, mis.institutionId);
  assert.strictEqual(S.save('institution', { name: 'al-razi university' }).ok, false, 'no duplicate institution');
  assert.ok(S.save('module', { moduleId: 'cardio', title: 'Cardiovascular Pathology' }, { create: true }).ok);
  const ra = S.save('group', { institutionId: razi.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'razi-a-26' }).record;
  const ma = S.save('group', { institutionId: mis.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'misrata-a-26' }).record;
  assert.ok(ra && ma && ra.groupId !== ma.groupId, 'same visible name at two institutions');
  assert.strictEqual(S.save('group', { institutionId: razi.institutionId, name: 'group a', academicYear: '2026-27', linkCode: 'other' }).ok, false, 'no duplicate group in one institution and year');
  assert.strictEqual(S.save('group', { institutionId: razi.institutionId, name: 'Group B', academicYear: '2026-27', linkCode: 'RAZI-A-26' }).ok, false, 'link codes are unique (any letter case)');
  assert.strictEqual(S.save('group', { institutionId: 'INS-NOPE00', name: 'G', linkCode: 'x1' }).ok, false);
  assert.strictEqual(S.save('group', { institutionId: razi.institutionId, name: 'G', linkCode: 'bad code!' }).ok, false);
  const d = function (g, m) { return S.save('delivery', { groupId: g.groupId, moduleId: m, status: 'available' }); };
  const d1 = d(ra, 'cellinjury').record, d2 = d(ra, 'inflhealing').record, d3 = d(ma, 'cellinjury').record, d4 = d(ma, 'cardio').record;
  assert.deepStrictEqual([d1, d2, d3, d4].map(function (x) { return x.backendModule; }),
    ['cellinjury-razi-a-26', 'inflhealing-razi-a-26', 'cellinjury-misrata-a-26', 'cardio-misrata-a-26']);
  assert.strictEqual(d(ra, 'cellinjury').ok, false, 'a module is delivered to a group once');
  const all = S.dir('dirGet');
  assert.strictEqual(all.institutions.length, 2); assert.strictEqual(all.groups.length, 2); assert.strictEqual(all.deliveries.length, 4);
  assert.strictEqual(all.modules.length, 3, 'Cell Injury exists once, delivered twice');
});

test('directory: ids, link codes and delivery storage cannot change once data could depend on them', function () {
  const S = adminSetup();
  const inst = S.save('institution', { name: 'Al-Razi University' }).record;
  const inst2 = S.save('institution', { name: 'Misrata University' }).record;
  let g = S.save('group', { institutionId: inst.institutionId, name: 'Group A', linkCode: 'ra' }).record;
  g = S.save('group', { groupId: g.groupId, name: 'Group A', linkCode: 'razi-a' }).record;
  assert.strictEqual(g.linkCode, 'razi-a', 'link code can change while the group has no delivery');
  assert.strictEqual(S.save('group', { groupId: g.groupId, institutionId: inst2.institutionId, name: 'Group A' }).ok, false, 'never moved to another institution');
  const dl = S.save('delivery', { groupId: g.groupId, moduleId: 'cellinjury' }).record;
  assert.strictEqual(dl.status, 'soon');
  const r = S.save('group', { groupId: g.groupId, name: 'Group A', linkCode: 'changed' });
  assert.strictEqual(r.ok, false); assert.match(r.error, /cannot change/);
  assert.ok(S.save('group', { groupId: g.groupId, name: 'Group A (morning)', academicYear: '2026-27' }).ok, 'the visible name can change');
  assert.strictEqual(S.save('delivery', { deliveryId: dl.deliveryId, moduleId: 'inflhealing' }).ok, false);
  assert.strictEqual(S.save('delivery', { deliveryId: dl.deliveryId, backendModule: 'cellinjury-x' }).ok, false);
  const up = S.save('delivery', { deliveryId: dl.deliveryId, status: 'available', openFrom: '2026-10-01', openUntil: '2027-06-30' });
  assert.ok(up.ok, JSON.stringify(up)); assert.strictEqual(up.record.status, 'available'); assert.ok(up.record.openUntil > up.record.openFrom);
  assert.strictEqual(S.save('delivery', { deliveryId: dl.deliveryId, openFrom: '2027-01-01', openUntil: '2026-01-01' }).ok, false);
  assert.strictEqual(S.save('module', { moduleId: 'cell-injury', title: 'X' }, { create: true }).ok, false, 'module ids have no "-"');
  assert.strictEqual(S.save('module', { moduleId: 'cellinjury', title: 'X' }, { create: true }).ok, false, 'no duplicate module');
  assert.strictEqual(S.save('module', { moduleId: 'cellinjury', title: 'Cell Injury (renamed)', url: 'javascript:x' }).ok, false);
  // deactivate / activate (nothing is ever deleted)
  assert.strictEqual(S.dir('dirSetActive', { kind: 'group', id: g.groupId, active: false }).record.active, false);
  assert.strictEqual(S.dir('dirSetActive', { kind: 'group', id: g.groupId, active: true }).record.active, true);
  assert.strictEqual(S.dir('dirGet').groups.length, 1);
});

test('directory: existing storage (plain and ?g= groups) can be adopted as deliveries; the scan only reads', function () {
  const S = adminSetup();
  S.call({ module: 'cellinjury-B', action: 'setup', password: 'teacher-group-b-1' });
  const tb = S.call({ module: 'cellinjury-B', action: 'login', password: 'teacher-group-b-1' }).token;
  assert.ok(S.call({ module: 'cellinjury-B', action: 'bulkAddStudents', token: tb, students: [{ username: 'b1', name: 'B One', password: PW, mustChange: false }] }).ok);
  const before = fingerprint(S.b, EXISTING);
  const sc = S.dir('dirScan');
  assert.ok(sc.ok, JSON.stringify(sc));
  const byName = {}; sc.storages.forEach(function (x) { byName[x.backendModule] = x; });
  assert.strictEqual(byName.cellinjury.students, 2); assert.strictEqual(byName['cellinjury-B'].students, 1);
  assert.strictEqual(byName['cellinjury-B'].moduleId, 'cellinjury'); assert.strictEqual(byName['cellinjury-B'].linkCode, 'B');
  assert.ok(!byName.portal, 'the front page itself is not a delivery');
  // adopt: a "Group B" with link code B → delivery storage cellinjury-B; the no-group storage → plain cellinjury
  const inst = S.save('institution', { name: 'Existing classes' }).record;
  const gb = S.save('group', { institutionId: inst.institutionId, name: 'Group B', linkCode: 'B' }).record;
  const g0 = S.save('group', { institutionId: inst.institutionId, name: 'Main link (no group)', linkCode: 'main' }).record;
  assert.strictEqual(S.save('delivery', { groupId: gb.groupId, moduleId: 'cellinjury', status: 'available' }).record.backendModule, 'cellinjury-B');
  assert.strictEqual(S.save('delivery', { groupId: g0.groupId, moduleId: 'cellinjury', status: 'available', adoptPlain: true }).record.backendModule, 'cellinjury');
  const g2 = S.save('group', { institutionId: inst.institutionId, name: 'Other', linkCode: 'other' }).record;
  assert.strictEqual(S.save('delivery', { groupId: g2.groupId, moduleId: 'cellinjury', adoptPlain: true }).ok, false, 'one storage, one delivery');
  const sc2 = S.dir('dirScan'); const reg = {}; sc2.storages.forEach(function (x) { reg[x.backendModule] = x.deliveryId; });
  assert.ok(reg.cellinjury && reg['cellinjury-B'], 'shown as registered');
  assert.deepStrictEqual(fingerprint(S.b, EXISTING), before, 'scanning and registering changed no existing data');
});

test('directory actions leave every existing sheet and behaviour untouched', function () {
  const S = adminSetup();
  const infoBefore = S.call({ module: 'portal', action: 'portalInfo' });
  const before = fingerprint(S.b, EXISTING);
  const inst = S.save('institution', { name: 'Al-Razi University' }).record;
  const g = S.save('group', { institutionId: inst.institutionId, name: 'Group A', linkCode: 'razi-a-26' }).record;
  S.save('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' });
  S.save('module', { moduleId: 'cellinjury', title: 'Renamed in the directory only', url: 'https://example.org/x/' });
  S.dir('dirSetActive', { kind: 'institution', id: inst.institutionId, active: false });
  S.dir('dirScan');
  assert.deepStrictEqual(fingerprint(S.b, EXISTING), before, 'no existing sheet changed');
  const infoAfter = S.call({ module: 'portal', action: 'portalInfo' });
  assert.deepStrictEqual(infoAfter.modules, infoBefore.modules, 'the front page list is unchanged (it does not read the directory yet)');
  const r = S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: PW, modules: ['cellinjury', 'inflhealing'] });
  assert.ok(r.ok && r.modules.cellinjury.access && r.modules.inflhealing.access, 'student front-page sign-in unchanged');
  assert.ok(S.call({ module: 'cellinjury', action: 'studentLogin', username: 's1', password: PW }).ok, 'module sign-in unchanged');
  const op = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury', { module: 'cellinjury', group: 'B' }] });
  assert.ok(op.modules.cellinjury && op.modules['cellinjury-B'], 'teacher module opening unchanged (not limited by the directory yet)');
});

/* ---------------- Step 2: group front pages (the link code selects, the backend decides) ---------------- */
function groupsSetup() {
  const S = adminSetup();
  const razi = S.save('institution', { name: 'Al-Razi University', shortName: 'Al-Razi' }).record;
  const mis = S.save('institution', { name: 'Misrata University', shortName: 'Misrata' }).record;
  S.save('module', { moduleId: 'cardio', title: 'Cardiovascular Pathology' }, { create: true });
  S.ra = S.save('group', { institutionId: razi.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'razi-a-26' }).record;
  S.ma = S.save('group', { institutionId: mis.institutionId, name: 'Group A', academicYear: '2026-27', linkCode: 'misrata-a-26' }).record;
  S.razi = razi; S.mis = mis; S.dl = {};
  [[S.ra, 'cellinjury'], [S.ra, 'inflhealing'], [S.ma, 'cellinjury'], [S.ma, 'cardio']].forEach(function (x) {
    const d = S.save('delivery', { groupId: x[0].groupId, moduleId: x[1], status: 'available' }).record; S.dl[d.backendModule] = d;
  });
  // accounts are created in each delivery's own storage (rosters come in Step 3)
  const acct = function (storage, list) {
    S.call({ module: storage, action: 'setup', password: 'teacher-' + storage });
    const t = S.call({ module: storage, action: 'login', password: 'teacher-' + storage }).token;
    assert.ok(S.call({ module: storage, action: 'bulkAddStudents', token: t, students: list }).ok);
  };
  acct('cellinjury-razi-a-26', [{ username: 'ahmed', name: 'Student Ahmed', password: PW, mustChange: false }]);
  acct('inflhealing-razi-a-26', [{ username: 'ahmed', name: 'Student Ahmed', password: PW, mustChange: false }]);
  acct('cellinjury-misrata-a-26', [{ username: 'sara', name: 'Student Sara', password: PW, mustChange: false }]);
  // Step 3: the group page needs a roster membership — import the accounts made above
  assert.strictEqual(S.dir('rosterImport', { groupId: S.ra.groupId }).added, 1);
  assert.strictEqual(S.dir('rosterImport', { groupId: S.ma.groupId }).added, 1);
  return S;
}

test('group page: each link shows only its own institution, group and modules; no student data', function () {
  const S = groupsSetup();
  const r = S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.institution.name, 'Al-Razi University'); assert.strictEqual(r.group.name, 'Group A'); assert.strictEqual(r.group.academicYear, '2026-27');
  assert.deepStrictEqual(r.modules.map(function (m) { return m.id; }), ['cellinjury', 'inflhealing']);
  assert.strictEqual(r.modules[0].group, 'razi-a-26');
  const m = S.call({ module: 'portal', action: 'portalGroupInfo', g: 'misrata-a-26' });
  assert.strictEqual(m.institution.name, 'Misrata University');
  assert.deepStrictEqual(m.modules.map(function (x) { return x.id; }), ['cellinjury', 'cardio']);
  const txt = JSON.stringify(r) + JSON.stringify(m);
  ['ahmed', 'sara', 'pwHash', 'misrata-a-26"', '_storage'].forEach(function (w) { assert.strictEqual((JSON.stringify(r) + '').indexOf(w), -1, w); });
  assert.strictEqual(txt.indexOf('pwHash'), -1);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: 'RAZI-A-26' }).group.linkCode, 'razi-a-26', 'letter case is forgiven');
});

test('group page: unknown or inactive groups/institutions answer "not valid"; inactive deliveries and modules are hidden', function () {
  const S = groupsSetup();
  ['nope', '', 'bad code!'].forEach(function (g) { assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: g }).code, 'nogroup'); });
  S.dir('dirSetActive', { kind: 'group', id: S.ra.groupId, active: false });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' }).code, 'nogroup');
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).code, 'nogroup', 'no sign-in into an inactive group');
  S.dir('dirSetActive', { kind: 'group', id: S.ra.groupId, active: true });
  S.dir('dirSetActive', { kind: 'institution', id: S.razi.institutionId, active: false });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' }).code, 'nogroup');
  S.dir('dirSetActive', { kind: 'institution', id: S.razi.institutionId, active: true });
  S.dir('dirSetActive', { kind: 'delivery', id: S.dl['inflhealing-razi-a-26'].deliveryId, active: false });
  assert.deepStrictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' }).modules.map(function (m) { return m.id; }), ['cellinjury']);
  S.dir('dirSetActive', { kind: 'module', id: 'cardio', active: false });
  assert.deepStrictEqual(S.call({ module: 'portal', action: 'portalGroupInfo', g: 'misrata-a-26' }).modules.map(function (m) { return m.id; }), ['cellinjury']);
});

test('group sign-in: sessions only in the group\'s own storage; changing ?g= gets nothing', function () {
  const S = groupsSetup();
  const r = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'Ahmed', password: PW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.modules.cellinjury.access, true); assert.strictEqual(r.modules.inflhealing.access, true);
  const tok = r.modules.cellinjury.token;
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', stoken: tok }).role, 'student', 'accepted by the Al-Razi A delivery');
  ['cellinjury', 'cellinjury-misrata-a-26', 'inflhealing-razi-a-26'].forEach(function (other) {
    assert.strictEqual(S.call({ module: other, action: 'studentSession', stoken: tok }).ok, false, 'refused by ' + other);
  });
  // Ahmed changes the link to Misrata: no account there → the same generic refusal, no module details
  const x = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'misrata-a-26', username: 'ahmed', password: PW });
  assert.strictEqual(x.ok, false); assert.strictEqual(x.error, 'Incorrect Student ID or password.'); assert.ok(!x.modules);
  // Sara cannot enter Al-Razi; she enters Misrata Cell Injury only
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'sara', password: PW }).ok, false);
  const s2 = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'misrata-a-26', username: 'sara', password: PW });
  assert.strictEqual(s2.modules.cellinjury.access, true); assert.strictEqual(s2.modules.cardio.access, false);
  // an account on the normal link (s1 in plain cellinjury) does not open a group delivery
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 's1', password: PW }).ok, false);
  // a deactivated account in the delivery does not get in
  const t = S.call({ module: 'inflhealing-razi-a-26', action: 'login', password: 'teacher-inflhealing-razi-a-26' }).token;
  assert.ok(S.call({ module: 'inflhealing-razi-a-26', action: 'setStudentActive', token: t, username: 'ahmed', active: false }).ok);
  const r3 = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW });
  assert.strictEqual(r3.modules.cellinjury.access, true); assert.strictEqual(r3.modules.inflhealing.access, false); assert.strictEqual(r3.modules.inflhealing.reason, 'inactive');
});

test('group page: opening dates — before opening shown as not yet released, after closing as closed; neither can be entered', function () {
  const S = groupsSetup();
  const day = 86400000, now = Date.now();
  S.save('delivery', { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId, openFrom: now + 5 * day, openUntil: '' });
  S.save('delivery', { deliveryId: S.dl['inflhealing-razi-a-26'].deliveryId, openFrom: now - 10 * day, openUntil: now - day });
  const info = S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' });
  assert.strictEqual(info.modules[0].status, 'ready'); assert.ok(info.modules[0].opensAt > now);
  assert.strictEqual(info.modules[1].status, 'closed');
  const r = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'noopen');
});

/* ---------------- Step 3: group rosters ---------------- */
function login(S, storage, id, pw) { return S.call({ module: storage, action: 'studentLogin', username: id, password: pw }); }
const RA = ['cellinjury-razi-a-26', 'inflhealing-razi-a-26'];

test('roster: Admin only', function () {
  const S = groupsSetup();
  const stu = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).modules.cellinjury.token;
  [{ stoken: stu }, { token: S.tokens.cellinjury }, {}].forEach(function (auth) {
    ['rosterGet', 'rosterAdd', 'rosterSave', 'rosterSetActive', 'rosterResetPassword', 'rosterSync', 'rosterImport'].forEach(function (a) {
      assert.strictEqual(S.call(Object.assign({ module: 'portal', action: a, groupId: S.ra.groupId, studentId: 'ahmed', students: [{ studentId: 'x1', name: 'X One' }] }, auth)).ok, false, a);
    });
  });
});

test('roster: adding a student creates one account in every module of the group, with one password', function () {
  const S = groupsSetup();
  const r = S.dir('rosterAdd', { groupId: S.ra.groupId, students: [
    { studentId: 'R001', name: 'Mona Ali', email: 'mona@example.org' },
    { studentId: 'r002', name: 'Omar Saleh', password: 'chosen-pass-1' },
    { studentId: 'ahmed', name: 'Student Ahmed' },
    { studentId: 'bad id!', name: 'Nope' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.added, 2);
  const mona = r.results[0], omar = r.results[1];
  assert.strictEqual(mona.studentId, 'r001'); assert.ok(mona.tempPassword && mona.tempPassword.length >= 8, 'generated password shown once');
  assert.strictEqual(omar.tempPassword, '');
  assert.match(r.results[2].error, /already in this group/); assert.match(r.results[3].error, /not valid/);
  RA.forEach(function (st) {
    const a = login(S, st, 'r001', mona.tempPassword); assert.ok(a.ok && a.mustChange === true, st + ' ' + JSON.stringify(a));
    assert.ok(login(S, st, 'r002', 'chosen-pass-1').ok, st);
  });
  assert.strictEqual(login(S, 'cellinjury-misrata-a-26', 'r001', mona.tempPassword).ok, false, 'not in the other university');
  const g = S.dir('rosterGet', { groupId: S.ra.groupId });
  const m = g.members.filter(function (x) { return x.studentId === 'r001'; })[0];
  assert.deepStrictEqual(m.accounts, { cellinjury: 'mustchange', inflhealing: 'mustchange' }); assert.strictEqual(m.samePassword, true);
  assert.deepStrictEqual(g.modules.map(function (x) { return x.storage; }), RA);
  assert.strictEqual(JSON.stringify(g).indexOf('pwHash'), -1);
});

test('roster: the group page needs an active membership; deactivating it closes every module of the group at once', function () {
  const S = groupsSetup();
  // an account made in a module without being on the roster does not open the group page
  S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' });
  const t = S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' }).token;
  S.call({ module: 'cellinjury-razi-a-26', action: 'bulkAddStudents', token: t, students: [{ username: 'loner', name: 'Not Listed', password: PW, mustChange: false }] });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'loner', password: PW }).error, 'Incorrect Student ID or password.');
  assert.strictEqual(S.dir('rosterGet', { groupId: S.ra.groupId }).unlistedAccounts, 1);
  assert.strictEqual(S.dir('rosterImport', { groupId: S.ra.groupId }).added, 1);
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'loner', password: PW }).ok, 'imported → can use the group page');
  // deactivate Ahmed: group page refused, module sign-in refused, open sessions end
  const ses = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).modules.inflhealing.token;
  assert.ok(S.dir('rosterSetActive', { groupId: S.ra.groupId, studentId: 'ahmed', active: false }).ok);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).ok, false);
  RA.forEach(function (st) { assert.strictEqual(login(S, st, 'ahmed', PW).ok, false, st); });
  assert.strictEqual(S.call({ module: 'inflhealing-razi-a-26', action: 'studentSession', stoken: ses }).ok, false, 'session ended');
  assert.ok(S.dir('rosterSetActive', { groupId: S.ra.groupId, studentId: 'ahmed', active: true }).ok);
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).ok);
});

test('roster: a module delivered later gets the members\' accounts automatically, with their current password', function () {
  const S = groupsSetup();
  S.dir('rosterAdd', { groupId: S.ma.groupId, students: [{ studentId: 'm1', name: 'Misrata One', password: 'misrata-pass-1' }] });
  S.save('module', { moduleId: 'inflhealing', title: 'Inflammation & Healing' });
  const d = S.save('delivery', { groupId: S.ma.groupId, moduleId: 'inflhealing', status: 'available' });
  assert.strictEqual(d.record.backendModule, 'inflhealing-misrata-a-26');
  assert.ok(login(S, 'inflhealing-misrata-a-26', 'm1', 'misrata-pass-1').ok, 'account created with the same password');
  assert.ok(login(S, 'inflhealing-misrata-a-26', 'sara', PW).ok, 'imported members too');
  assert.strictEqual(login(S, 'inflhealing-misrata-a-26', 'ahmed', PW).ok, false, 'never members of another group');
});

test('roster: reset password applies to all of the group\'s modules; the same Student ID in another university stays separate', function () {
  const S = groupsSetup();
  S.dir('rosterAdd', { groupId: S.ma.groupId, students: [{ studentId: 'ahmed', name: 'Another Ahmed', password: 'misrata-own-1' }] });
  const r = S.dir('rosterResetPassword', { groupId: S.ra.groupId, studentId: 'ahmed' });
  assert.ok(r.ok && r.tempPassword);
  RA.forEach(function (st) { assert.strictEqual(login(S, st, 'ahmed', PW).ok, false); assert.ok(login(S, st, 'ahmed', r.tempPassword).mustChange); });
  assert.ok(login(S, 'cellinjury-misrata-a-26', 'ahmed', 'misrata-own-1').ok, 'Misrata\'s Ahmed is untouched');
  assert.ok(S.dir('rosterSave', { groupId: S.ra.groupId, studentId: 'ahmed', name: 'Ahmed Mohamed', email: '' }).ok);
  assert.strictEqual(S.dir('rosterGet', { groupId: S.ra.groupId }).members.filter(function (m) { return m.studentId === 'ahmed'; })[0].name, 'Ahmed Mohamed');
});

test('student password change on the group page: current password required, new one set in every module of the group', function () {
  const S = groupsSetup();
  const call = function (o) { return S.call(Object.assign({ module: 'portal', action: 'portalGroupSetPassword', g: 'razi-a-26', username: 'ahmed' }, o)); };
  assert.strictEqual(call({ password: 'wrong', newPassword: 'new-pass-123' }).ok, false);
  assert.match(call({ password: PW, newPassword: 'short' }).error, /at least/);
  assert.match(call({ password: PW, newPassword: 'ahmed' + '' }).error, /at least|student ID/);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupSetPassword', g: 'misrata-a-26', username: 'ahmed', password: PW, newPassword: 'new-pass-123' }).ok, false, 'not a member there');
  assert.ok(call({ password: PW, newPassword: 'new-pass-123' }).ok);
  RA.forEach(function (st) { assert.strictEqual(login(S, st, 'ahmed', PW).ok, false); const a = login(S, st, 'ahmed', 'new-pass-123'); assert.ok(a.ok && !a.mustChange, st); });
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: 'new-pass-123' }).ok);
});

test('student password change INSIDE a module of the group is applied to the group\'s other modules (Code.gs behaviour otherwise)', function () {
  const S = groupsSetup();
  const a = login(S, 'cellinjury-razi-a-26', 'ahmed', PW), other = login(S, 'inflhealing-razi-a-26', 'ahmed', PW);
  const r = S.call({ module: 'cellinjury-razi-a-26', action: 'studentChangePassword', stoken: a.token, oldPassword: PW, newPassword: 'module-pass-9' });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok('contentKey' in r);
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', stoken: a.token }).role, 'student', 'the session that changed it stays signed in');
  assert.strictEqual(S.call({ module: 'inflhealing-razi-a-26', action: 'studentSession', stoken: other.token }).ok, false, 'other devices/modules are signed out');
  assert.ok(login(S, 'inflhealing-razi-a-26', 'ahmed', 'module-pass-9').ok, 'new password in the other module');
  // same messages as Code.gs
  const b = login(S, 'cellinjury-razi-a-26', 'ahmed', 'module-pass-9');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentChangePassword', stoken: b.token, oldPassword: 'nope', newPassword: 'xxxxxxxx9' }).error, 'Your current password is incorrect.');
  // a module that is not part of a group (or a student not on a roster): Code.gs alone, unchanged
  const c = login(S, 'cellinjury', 's1', PW);
  assert.ok(S.call({ module: 'cellinjury', action: 'studentChangePassword', stoken: c.token, oldPassword: PW, newPassword: 'plain-pass-77' }).ok);
  assert.ok(login(S, 'cellinjury', 's1', 'plain-pass-77').ok); assert.ok(login(S, 'inflhealing', 's1', PW).ok, 'other plain module unchanged');
});

test('fix: a student added BEFORE the group has modules can sign in once modules are delivered (temporary password kept as a hash)', function () {
  const S = adminSetup();
  const inst = S.save('institution', { name: 'Al-Razi University' }).record;
  const g = S.save('group', { institutionId: inst.institutionId, name: 'Group A', linkCode: 'razi-a-26' }).record;
  const add = S.dir('rosterAdd', { groupId: g.groupId, students: [{ studentId: '2026001', name: 'Early Student' }] });
  const temp = add.results[0].tempPassword; assert.ok(temp);
  S.save('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' });
  S.save('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  const r = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: '2026001', password: temp });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.modules.cellinjury.access && r.modules.inflhealing.access && r.modules.cellinjury.mustChange);
  const m = S.dir('rosterGet', { groupId: g.groupId }).members[0];
  assert.strictEqual(m.studentId, '2026001'); assert.strictEqual(m.needsPassword, false);
  assert.strictEqual(JSON.stringify(S.dir('rosterGet', { groupId: g.groupId })).indexOf(m.pwHash || 'pwHash'), -1, 'the hash is never sent');
});

test('fix: adding a student who already had an account in a module sets the new password there too', function () {
  const S = groupsSetup();
  // "early" already has an account in Cell Injury of Al-Razi A (made in that module's Teacher Portal) with another password
  const t = S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' }).token;
  S.call({ module: 'cellinjury-razi-a-26', action: 'bulkAddStudents', token: t, students: [{ username: 'early', name: 'Early', password: 'old-module-pass', mustChange: false }] });
  const add = S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'early', name: 'Early Bird' }] });
  assert.deepStrictEqual(add.results[0].updatedExisting, ['cellinjury']);
  const r = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'early', password: add.results[0].tempPassword });
  assert.ok(r.ok && r.modules.cellinjury.access && r.modules.inflhealing.access, JSON.stringify(r));
  assert.strictEqual(login(S, 'cellinjury-razi-a-26', 'early', 'old-module-pass').ok, false);
});

test('fix: a member left without any account (old version) is flagged, and Reset password repairs it', function () {
  const S = adminSetup();
  const inst = S.save('institution', { name: 'Al-Razi University' }).record;
  const g = S.save('group', { institutionId: inst.institutionId, name: 'Group A', linkCode: 'razi-a-26' }).record;
  S.dir('dirGet');
  // simulate a 1.5 membership: no stored hash, no accounts
  S.b.sheets.StudentMemberships._rows.push(['MEM-OLD001', g.groupId, 'old1', 'Old Member', '', true, 1, 1, '', '', '', '']);
  S.save('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' });
  let m = S.dir('rosterGet', { groupId: g.groupId }).members[0];
  assert.strictEqual(m.needsPassword, true);
  const sync = S.dir('rosterSync', { groupId: g.groupId }); assert.deepStrictEqual(sync.needPasswordReset, ['old1']);
  const rp = S.dir('rosterResetPassword', { groupId: g.groupId, studentId: 'old1' });
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'old1', password: rp.tempPassword }).ok);
  m = S.dir('rosterGet', { groupId: g.groupId }).members[0];
  assert.strictEqual(m.needsPassword, false); assert.strictEqual(m.accounts.cellinjury, 'mustchange');
});

test('main page: a group student with the right password is told their group (only then); a wrong password stays generic', function () {
  const S = groupsSetup();
  const add = S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: '11223344', name: 'Main Page Student', password: 'his-pass-123' }] });
  assert.ok(add.results[0].ok);
  const r = S.call({ module: 'portal', action: 'portalCheck', username: '11223344', password: 'his-pass-123', modules: ['cellinjury', 'inflhealing'] });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'groupmember');
  assert.deepStrictEqual(r.groups, [{ g: 'razi-a-26', group: 'Group A', academicYear: '2026-27', institution: 'Al-Razi University' }]);
  assert.ok(!r.modules, 'no session on the main page');
  const w = S.call({ module: 'portal', action: 'portalCheck', username: '11223344', password: 'wrong-pass', modules: ['cellinjury'] });
  assert.strictEqual(w.code, 'badlogin'); assert.ok(!w.groups, 'nothing revealed without the right password');
  S.dir('rosterSetActive', { groupId: S.ra.groupId, studentId: '11223344', active: false });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalCheck', username: '11223344', password: 'his-pass-123', modules: ['cellinjury'] }).code, 'badlogin', 'not for a deactivated member');
  // a main-page account still signs in normally
  assert.ok(S.call({ module: 'portal', action: 'portalCheck', username: 's1', password: PW, modules: ['cellinjury'] }).ok);
});

test('bulk temporary passwords: only students still on a temporary password, or all; different or one shared; sessions end', function () {
  const S = groupsSetup();
  // ahmed (imported) already uses his own password; three new students get temporary ones
  const add = S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'b1', name: 'Bulk One' }, { studentId: 'b2', name: 'Bulk Two' }, { studentId: 'b3', name: 'Bulk Three' }] });
  assert.strictEqual(add.added, 3);
  S.dir('rosterSetActive', { groupId: S.ra.groupId, studentId: 'b3', active: false });
  const sesAhmed = login(S, 'cellinjury-razi-a-26', 'ahmed', PW).token;
  assert.strictEqual(S.call({ module: 'portal', action: 'rosterResetMany', groupId: S.ra.groupId }).ok, false, 'Admin only');
  // 1) only those still on a temporary password, each a different one
  const r = S.dir('rosterResetMany', { groupId: S.ra.groupId, scope: 'temp' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.results.map(function (x) { return x.studentId; }).sort(), ['b1', 'b2'], 'not ahmed (own password), not b3 (inactive)');
  assert.notStrictEqual(r.results[0].tempPassword, r.results[1].tempPassword);
  r.results.forEach(function (x) { RA.forEach(function (st) { const a = login(S, st, x.studentId, x.tempPassword); assert.ok(a.ok && a.mustChange, st); }); });
  assert.strictEqual(login(S, 'cellinjury-razi-a-26', 'b1', add.results[0].tempPassword).ok, false, 'old temporary password stopped');
  assert.ok(login(S, 'cellinjury-razi-a-26', 'ahmed', PW).ok, 'ahmed untouched');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', stoken: sesAhmed }).role, 'student', 'his session untouched');
  // 2) all active students, one shared password typed by the Admin
  assert.strictEqual(S.dir('rosterResetMany', { groupId: S.ra.groupId, scope: 'all', password: 'short' }).ok, false);
  const all = S.dir('rosterResetMany', { groupId: S.ra.groupId, scope: 'all', password: 'Welcome-2026' });
  assert.strictEqual(all.count, 3); assert.ok(all.shared); assert.ok(all.results.every(function (x) { return x.tempPassword === ''; }), 'the shared password is not sent back');
  ['ahmed', 'b1', 'b2'].forEach(function (id) { assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: id, password: 'Welcome-2026' }).ok, id); });
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', stoken: sesAhmed }).ok, false, 'sessions ended');
  assert.strictEqual(login(S, 'cellinjury-misrata-a-26', 'sara', PW).ok, true, 'the other university untouched');
  // each must choose their own password at the next sign-in
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'b1', password: 'Welcome-2026' }).modules.cellinjury.mustChange);
});

test('fix: a module delivered after the student signed in is unlocked with the existing session (no password, no re-sign-in)', function () {
  const S = adminSetup();
  const inst = S.save('institution', { name: 'Al-Razi University' }).record;
  const g = S.save('group', { institutionId: inst.institutionId, name: 'Group A', linkCode: 'razi-a-26' }).record;
  S.save('delivery', { groupId: g.groupId, moduleId: 'cellinjury', status: 'available' });
  S.dir('rosterAdd', { groupId: g.groupId, students: [{ studentId: '11223344', name: 'Alzwawy Wesam', password: 'own-pass-123' }], mustChange: false });
  const first = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: '11223344', password: 'own-pass-123' });
  assert.deepStrictEqual(Object.keys(first.modules), ['cellinjury']);
  // later: Inflammation is delivered to the group (his account there is created automatically)
  S.save('delivery', { groupId: g.groupId, moduleId: 'inflhealing', status: 'available' });
  const r = S.call({ module: 'portal', action: 'portalGroupRefresh', g: 'razi-a-26', sessions: { cellinjury: first.modules.cellinjury.token } });
  assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(Object.keys(r.modules), ['inflhealing']);
  assert.ok(r.modules.inflhealing.access);
  assert.strictEqual(S.call({ module: 'inflhealing-razi-a-26', action: 'studentSession', stoken: r.modules.inflhealing.token }).role, 'student');
  // no valid session → nothing; a deactivated member → nothing; another group's session → nothing
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupRefresh', g: 'razi-a-26', sessions: { cellinjury: 'x'.repeat(64) } }).ok, false);
  S.dir('rosterSetActive', { groupId: g.groupId, studentId: '11223344', active: false });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupRefresh', g: 'razi-a-26', sessions: { cellinjury: first.modules.cellinjury.token } }).ok, false);
});

/* ---------------- Step 4: personal teacher accounts ---------------- */
function teachersSetup() {
  const S = groupsSetup();
  // deliveries: Al-Razi A → cellinjury, inflhealing; Misrata A → cellinjury, cardio
  const D = S.dl;
  const mk = function (username, name) { const r = S.dir('teacherSave', { create: true, record: { username: username, name: name } }); assert.ok(r.ok, JSON.stringify(r)); return r; };
  S.ahmed = mk('dr.ahmed', 'Dr. Ahmed'); S.sara = mk('dr.sara', 'Dr. Sara');
  assert.ok(S.dir('teacherAssign', { userId: S.ahmed.teacher.userId, deliveryIds: [D['cellinjury-razi-a-26'].deliveryId, D['inflhealing-razi-a-26'].deliveryId] }).ok);
  assert.ok(S.dir('teacherAssign', { userId: S.sara.teacher.userId, deliveryIds: [D['cellinjury-misrata-a-26'].deliveryId] }).ok);
  S.tlogin = function (u, pw) { return S.call({ module: 'portal', action: 'teacherLogin', username: u, password: pw }); };
  S.t = function (action, ttoken, o) { return S.call(Object.assign({ module: 'portal', action: action, ttoken: ttoken }, o || {})); };
  // first sign-in: temporary password → choose own
  ['ahmed', 'sara'].forEach(function (k) {
    const l = S.tlogin('dr.' + k, S[k].tempPassword); assert.ok(l.ok && l.user.mustChange, JSON.stringify(l));
    assert.strictEqual(S.t('teacherOpen', l.ttoken, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).code, 'mustchange');
    assert.ok(S.t('teacherChangePassword', l.ttoken, { oldPassword: S[k].tempPassword, newPassword: k + '-own-pass-1' }).ok);
    S[k].tok = l.ttoken;
  });
  return S;
}

test('teacher accounts: Admin only to manage; a teacher sign-in is never an Admin session', function () {
  const S = teachersSetup();
  ['teacherList', 'teacherSave', 'teacherSetActive', 'teacherResetPassword', 'teacherAssign'].forEach(function (a) {
    assert.strictEqual(S.call({ module: 'portal', action: a, token: S.ahmed.tok, ttoken: S.ahmed.tok, userId: S.ahmed.teacher.userId, create: true, record: { username: 'x1', name: 'X' } }).ok, false, a);
  });
  ['portalAdminGet', 'portalAdminSave', 'dirGet', 'dirScan', 'rosterGet', 'portalTeacherOpen'].forEach(function (a) {
    assert.strictEqual(S.call({ module: 'portal', action: a, token: S.ahmed.tok, ttoken: S.ahmed.tok, modules: ['cellinjury'], groupId: S.ra.groupId }).ok, false, a);
  });
  const list = S.dir('teacherList'); assert.deepStrictEqual(list.teachers.map(function (t) { return t.username; }), ['dr.ahmed', 'dr.sara']);
  assert.strictEqual(JSON.stringify(list).indexOf('pwHash'), -1);
  assert.strictEqual(S.dir('teacherSave', { create: true, record: { username: 'dr.ahmed', name: 'Again' } }).ok, false, 'unique username');
  assert.strictEqual(S.dir('teacherSave', { create: true, record: { username: 'admin', name: 'Nope' } }).ok, false);
  assert.strictEqual(S.tlogin('dr.ahmed', 'wrong').error, 'Incorrect username or password.');
  assert.strictEqual(S.tlogin('nobody', 'wrong').error, 'Incorrect username or password.');
});

test('teacher sees and opens ONLY the assigned group + module combinations (the Dr. Ahmed / Dr. Sara example)', function () {
  const S = teachersSetup(), D = S.dl;
  const me = S.t('teacherMe', S.ahmed.tok);
  assert.deepStrictEqual(me.deliveries.map(function (d) { return d.institution + ' · ' + d.groupName + ' · ' + d.moduleId; }),
    ['Al-Razi University · Group A · cellinjury', 'Al-Razi University · Group A · inflhealing']);
  const o = S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['cellinjury-razi-a-26'].deliveryId });
  assert.ok(o.ok, JSON.stringify(o)); assert.strictEqual(o.backendModule, 'cellinjury-razi-a-26');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: o.token }).role, 'teacher', 'a real teacher session of that delivery');
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'listStudents', token: o.token }).ok, 'module management works');
  // never anywhere else
  ['cellinjury', 'cellinjury-misrata-a-26', 'inflhealing-razi-a-26', 'portal'].forEach(function (m) {
    assert.strictEqual(S.call({ module: m, action: 'listStudents', token: o.token }).ok, false, m);
  });
  // Ahmed cannot open Misrata (same module, other group) — Sara cannot open Al-Razi or Cardio
  assert.strictEqual(S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['cellinjury-misrata-a-26'].deliveryId }).code, 'forbidden');
  assert.strictEqual(S.t('teacherOpen', S.sara.tok, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).code, 'forbidden');
  assert.strictEqual(S.t('teacherOpen', S.sara.tok, { deliveryId: D['cardio-misrata-a-26'].deliveryId }).code, 'forbidden', 'not assigned to that module of her own group');
  assert.ok(S.t('teacherOpen', S.sara.tok, { deliveryId: D['cellinjury-misrata-a-26'].deliveryId }).ok);
  assert.strictEqual(S.t('teacherOpen', 'x'.repeat(64), { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).code, 'auth');
});

test('withdrawing access is immediate: unassign, deactivate teacher, deactivate group; sign-out ends module sessions', function () {
  const S = teachersSetup(), D = S.dl;
  const ci = S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).token;
  const ih = S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['inflhealing-razi-a-26'].deliveryId }).token;
  S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: ci });   // warm the cache
  // remove Inflammation from his assignments → that module session ends, Cell Injury stays
  assert.ok(S.dir('teacherAssign', { userId: S.ahmed.teacher.userId, deliveryIds: [D['cellinjury-razi-a-26'].deliveryId] }).ok);
  assert.strictEqual(S.call({ module: 'inflhealing-razi-a-26', action: 'studentSession', token: ih }).ok, false);
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: ci }).role, 'teacher');
  assert.strictEqual(S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['inflhealing-razi-a-26'].deliveryId }).code, 'forbidden');
  // deactivate the group → closed, sessions end; reactivate → can open again
  S.dir('dirSetActive', { kind: 'group', id: S.ra.groupId, active: false });
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: ci }).ok, false, 'ended even from the cache');
  assert.strictEqual(S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).code, 'closed');
  S.dir('dirSetActive', { kind: 'group', id: S.ra.groupId, active: true });
  const ci2 = S.t('teacherOpen', S.ahmed.tok, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).token;
  // deactivate the teacher → signed out, module session ended
  S.dir('teacherSetActive', { userId: S.ahmed.teacher.userId, active: false });
  assert.strictEqual(S.t('teacherMe', S.ahmed.tok).code, 'auth');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: ci2 }).ok, false);
  assert.strictEqual(S.tlogin('dr.ahmed', 'ahmed-own-pass-1').code, 'inactive');
  S.dir('teacherSetActive', { userId: S.ahmed.teacher.userId, active: true });
  // sign-out ends this session and its module sessions
  const l = S.tlogin('dr.ahmed', 'ahmed-own-pass-1'); const ci3 = S.t('teacherOpen', l.ttoken, { deliveryId: D['cellinjury-razi-a-26'].deliveryId }).token;
  assert.ok(S.t('teacherLogout', l.ttoken).ok);
  assert.strictEqual(S.t('teacherMe', l.ttoken).code, 'auth');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: ci3 }).ok, false);
  // reset password → old one stops, must choose a new one
  const rp = S.dir('teacherResetPassword', { userId: S.sara.teacher.userId });
  assert.strictEqual(S.tlogin('dr.sara', 'sara-own-pass-1').ok, false);
  assert.ok(S.tlogin('dr.sara', rp.tempPassword).user.mustChange);
});

test('the Admin keeps full access exactly as before', function () {
  const S = teachersSetup();
  const op = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury', { module: 'cellinjury', group: 'razi-a-26' }, { module: 'cellinjury', group: 'misrata-a-26' }] });
  assert.deepStrictEqual(Object.keys(op.modules).sort(), ['cellinjury', 'cellinjury-misrata-a-26', 'cellinjury-razi-a-26']);
  assert.ok(S.dir('dirGet').ok); assert.ok(S.dir('rosterGet', { groupId: S.ma.groupId }).ok);
});

/* ---------------- Step 5: back doors closed ---------------- */
test('module teacher sign-in and module first-time setup are refused for every module (incl. group storages)', function () {
  const S = teachersSetup();
  ['cellinjury', 'inflhealing', 'cellinjury-razi-a-26', 'cellinjury-misrata-a-26', 'brand-new-module', 'cellinjury-anything'].forEach(function (m) {
    const l = S.call({ module: m, action: 'login', password: 'teacher-' + m, __real: true });
    assert.strictEqual(l.ok, false, m); assert.strictEqual(l.code, 'disabled'); assert.ok(!l.token);
    const s = S.call({ module: m, action: 'setup', password: 'someone-new-pass', __real: true });
    assert.strictEqual(s.ok, false, m); assert.strictEqual(s.code, 'disabled');
  });
  // the hole that existed: a module without its own password could be "set up" by anyone → now nothing was created
  assert.strictEqual(S.call({ module: 'cellinjury-anything', action: 'login', password: 'someone-new-pass', __real: true }).ok, false);
  // the Admin's own sign-in and every regular path still work
  assert.ok(S.call({ module: 'portal', action: 'login', password: 'portal-teacher-1', __real: true }).ok);
  assert.ok(S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury'] }).ok);
  assert.ok(S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId }).ok);
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'studentLogin', username: 'ahmed', password: PW }).ok, 'students unaffected');
});

test('emergency switch ALLOW_MODULE_LOGIN=true restores the old module sign-in; End all module teacher sessions works', function () {
  const S = teachersSetup();
  S.b.props.set('ALLOW_MODULE_LOGIN', 'true');
  const old = S.call({ module: 'cellinjury', action: 'login', password: 'teacher-cellinjury-1', __real: true });
  assert.ok(old.ok, 'switch on → old sign-in works');
  S.b.props.delete('ALLOW_MODULE_LOGIN');
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'login', password: 'teacher-cellinjury-1', __real: true }).code, 'disabled');
  // a session issued earlier the old way still works until the Admin ends all module teacher sessions
  assert.ok(S.call({ module: 'cellinjury', action: 'listStudents', token: old.token }).ok);
  const t = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId }).token;
  assert.strictEqual(S.call({ module: 'portal', action: 'portalEndModuleSessions', token: S.ahmed.tok, ttoken: S.ahmed.tok }).ok, false, 'Admin only');
  const e = S.dir('portalEndModuleSessions'); assert.ok(e.ok && e.ended >= 2, JSON.stringify(e));
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'listStudents', token: old.token }).ok, false);
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: t }).ok, false);
  assert.ok(S.dir('dirGet').ok, 'the Admin session itself stays');
  assert.ok(S.t('teacherMe', S.ahmed.tok).ok, 'teachers stay signed in on the dashboard and can open modules again');
  assert.ok(S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId }).ok);
});

/* ---------------- Step 6: content versioning foundation (read-only) ---------------- */
test('content report: master vs group activity, and each group copy compared with the main copy — nothing changes', function () {
  const S = teachersSetup();
  const tMain = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury'] }).modules.cellinjury.token;
  const tGrp = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId }).token;
  const up = function (m, tok, coll, id, data) { const r = S.call({ module: m, action: 'upsert', token: tok, collection: coll, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); };
  up('cellinjury', tMain, 'topicsections', 'T1', { sections: ['A'] });
  up('cellinjury', tMain, 'customtopics', 'C1', { title: 'Main title' });
  up('cellinjury', tMain, 'assessments', 'AS1', { title: 'Main quiz' });
  up('cellinjury-razi-a-26', tGrp, 'topicsections', 'T1', { sections: ['A'] });        // identical
  up('cellinjury-razi-a-26', tGrp, 'topicsections', 'T2', { sections: ['local'] });    // only in this group
  up('cellinjury-razi-a-26', tGrp, 'customtopics', 'C1', { title: 'Group title' });    // different
  up('cellinjury-razi-a-26', tGrp, 'assessments', 'AS9', { title: 'Group quiz' });     // group activity (stays)
  up('cellinjury-razi-a-26', tGrp, 'somethingnew', 'X1', { a: 1 });                    // unknown collection
  const contentBefore = JSON.stringify(S.b.sheets.Content._rows);
  const allBefore = S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', token: tGrp, since: 0 });
  assert.ok(allBefore.ok && allBefore.items.length === 5, JSON.stringify(allBefore).slice(0, 200));
  assert.strictEqual(S.call({ module: 'portal', action: 'contentReport', ttoken: S.ahmed.tok, token: S.ahmed.tok, moduleId: 'cellinjury' }).ok, false, 'Admin only');
  const r = S.dir('contentReport', { moduleId: 'cellinjury' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.mode, 'off');
  assert.deepStrictEqual(r.summary, { masterItems: 2, groupStorages: 1, identical: 1, onlyInGroup: 1, conflicts: 1, groupActivity: 2, other: 1 });
  const st = function (id) { return r.details.filter(function (d) { return d.id === id; })[0].status; };
  assert.strictEqual(st('T2'), 'only in this group'); assert.strictEqual(st('C1'), 'different from the main copy'); assert.strictEqual(st('X1'), 'unknown collection');
  assert.ok(!r.details.some(function (d) { return d.id === 'T1' || d.id === 'AS9'; }));
  assert.strictEqual(JSON.stringify(r).indexOf('Group title'), -1, 'the report lists items, not their content');
  const s = S.dir('contentStatus'); assert.ok(s.ok);
  const ci = s.modules.filter(function (m) { return m.moduleId === 'cellinjury'; })[0];
  assert.strictEqual(ci.mode, 'off'); assert.strictEqual(ci.versions, 0);
  assert.deepStrictEqual(ci.storages.map(function (x) { return [x.storage, x.master, x.group, x.other]; }), [['cellinjury', 2, 1, 0], ['cellinjury-razi-a-26', 3, 1, 1]]);
  assert.ok(S.b.sheets.ContentVersions, 'ContentVersions sheet prepared');
  // nothing changed: the Content sheet and what the module receives are identical
  assert.strictEqual(JSON.stringify(S.b.sheets.Content._rows), contentBefore);
  assert.deepStrictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', token: tGrp, since: 0 }).items, allBefore.items);
});

/* ---------------- Step 7: migration into a master copy; on / off per module ---------------- */
function pause() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
function contentSetup() {
  const S = teachersSetup();
  S.tMain = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury'] }).modules.cellinjury.token;
  S.tRa = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.dl['cellinjury-razi-a-26'].deliveryId }).token;
  S.tMa = S.t('teacherOpen', S.sara.tok, { deliveryId: S.dl['cellinjury-misrata-a-26'].deliveryId }).token;
  S.up = function (m, tok, coll, id, data) { const r = S.call({ module: m, action: 'upsert', token: tok, collection: coll, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); return r; };
  S.up('cellinjury', S.tMain, 'topicsections', 'T1', { sections: ['A'] });
  S.up('cellinjury', S.tMain, 'customtopics', 'C1', { title: 'Main title' });
  S.up('cellinjury', S.tMain, 'assessments', 'AS1', { title: 'Main quiz' });
  S.up('cellinjury-razi-a-26', S.tRa, 'topicsections', 'T1', { sections: ['A'] });
  S.up('cellinjury-razi-a-26', S.tRa, 'topicsections', 'T2', { sections: ['razi local'] });
  S.up('cellinjury-razi-a-26', S.tRa, 'customtopics', 'C1', { title: 'Razi title' });
  S.up('cellinjury-razi-a-26', S.tRa, 'assessments', 'AS9', { title: 'Razi quiz' });
  S.get = function (m, tok, since) { const r = S.call({ module: m, action: 'getAllContent', token: tok, since: since || 0 }); assert.ok(r.ok, JSON.stringify(r)); return r; };
  S.view = function (r) { const o = {}; r.items.forEach(function (it) { const k = it.collection + '|' + it.id; if (it.deleted) delete o[k]; else o[k] = it.data; }); return o; };
  S.cdir = function (a, o) { return S.dir(a, Object.assign({ moduleId: 'cellinjury' }, o || {})); };
  return S;
}

test('migration only copies; nothing changes while off; switching on keeps every group\'s current content (defaults)', function () {
  const S = contentSetup();
  const original = JSON.stringify(S.b.sheets.Content._rows);
  const before = { main: S.view(S.get('cellinjury', S.tMain)), ra: S.view(S.get('cellinjury-razi-a-26', S.tRa)), ma: S.view(S.get('cellinjury-misrata-a-26', S.tMa)) };
  assert.strictEqual(S.cdir('contentSetMode', { mode: 'on' }).ok, false, 'not before the master copy exists');
  assert.strictEqual(S.call({ module: 'portal', action: 'contentMigrate', ttoken: S.ahmed.tok, token: S.ahmed.tok, moduleId: 'cellinjury' }).ok, false, 'Admin only');
  const m = S.cdir('contentMigrate', { decisions: {} });
  assert.ok(m.ok, JSON.stringify(m)); assert.strictEqual(m.masterItems, 2); assert.deepStrictEqual(m.decided, { main: 0, group: 0, local: 2 });
  assert.strictEqual(S.cdir('contentMigrate', {}).ok, false, 'only once');
  // the original rows are exactly as before (new rows were only appended)
  assert.strictEqual(JSON.stringify(S.b.sheets.Content._rows.slice(0, JSON.parse(original).length)), original);
  assert.strictEqual(S.dir('contentStatus').modules.filter(function (x) { return x.moduleId === 'cellinjury'; })[0].publishedVersion, '1.0');
  // still off → identical to before
  assert.deepStrictEqual(S.view(S.get('cellinjury-razi-a-26', S.tRa)), before.ra);
  // ON → each group sees what it saw before (its own differing items were kept as its local layer)
  assert.ok(S.cdir('contentSetMode', { mode: 'on' }).ok);
  assert.deepStrictEqual(S.view(S.get('cellinjury', S.tMain)), before.main);
  assert.deepStrictEqual(S.view(S.get('cellinjury-razi-a-26', S.tRa)), before.ra);
  // Misrata had no edits of its own: it now receives the master copy
  assert.deepStrictEqual(S.view(S.get('cellinjury-misrata-a-26', S.tMa)), { 'topicsections|T1': { sections: ['A'] }, 'customtopics|C1': { title: 'Main title' } });
  assert.deepStrictEqual(before.ma, {});
});

test('while on: edits stay with their group; students read only their own group; internal storages are refused; switch-off refreshes browsers', function () {
  const S = contentSetup();
  S.cdir('contentMigrate', { decisions: {} });
  const r0 = S.get('cellinjury-razi-a-26', S.tRa);   // a browser that synced BEFORE the switch
  assert.ok(S.cdir('contentSetMode', { mode: 'on' }).ok);
  pause();   // real browsers sync seconds apart; the test runs within milliseconds
  // that browser's next (incremental) sync becomes a complete refresh
  const r1 = S.get('cellinjury-razi-a-26', S.tRa, r0.serverTime);
  pause();
  assert.ok(r1.items.length >= 4);
  // a teacher edit inside Al-Razi goes to Al-Razi's local layer only
  S.up('cellinjury-razi-a-26', S.tRa, 'topicsections', 'T3', { sections: ['new razi'] });
  const inc = S.get('cellinjury-razi-a-26', S.tRa, r1.serverTime);
  assert.deepStrictEqual(inc.items.map(function (i) { return i.id; }), ['T3'], 'incremental sync brings only the change');
  assert.ok(!('topicsections|T3' in S.view(S.get('cellinjury-misrata-a-26', S.tMa))), 'not in Misrata');
  assert.ok(!S.b.sheets.Content._rows.some(function (r) { return r[0] === 'cellinjury-razi-a-26' && r[2] === 'T3'; }), 'stored in the local layer, not in the original rows');
  // students: their own group with a session; nothing without one; never another group
  const stu = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).modules.cellinjury.token;
  assert.ok('topicsections|T3' in S.view(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', stoken: stu, since: 0 })));
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', since: 0 }).ok, false, 'no session → nothing');
  assert.strictEqual(S.call({ module: 'cellinjury-misrata-a-26', action: 'getAllContent', stoken: stu, since: 0 }).ok, false, 'other group → nothing');
  ['cellinjury@v1', 'cellinjury@draft', 'cellinjury-razi-a-26@local'].forEach(function (m) { assert.strictEqual(S.call({ module: m, action: 'getAllContent', since: 0 }).code, 'badmodule', m); });
  // students cannot write
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'upsert', stoken: stu, collection: 'topicsections', id: 'T9', data: {} }).ok, false);
  // switch OFF: the next sync is a complete refresh of the original content, removing the local-only T3
  const before = S.get('cellinjury-razi-a-26', S.tRa, 0).serverTime;
  pause();
  assert.ok(S.cdir('contentSetMode', { mode: 'off' }).ok);
  pause();
  const off = S.get('cellinjury-razi-a-26', S.tRa, before);
  pause();
  assert.ok(off.items.some(function (i) { return i.id === 'T3' && i.deleted; }), 'removal sent');
  assert.deepStrictEqual(S.view({ items: off.items }), { 'topicsections|T1': { sections: ['A'] }, 'topicsections|T2': { sections: ['razi local'] }, 'customtopics|C1': { title: 'Razi title' }, 'assessments|AS9': { title: 'Razi quiz' } });
  // after that, Code.gs serves as before (incremental, nothing new)
  assert.deepStrictEqual(S.get('cellinjury-razi-a-26', S.tRa, off.serverTime).items, []);
  // switching on again restores the local edit (it was kept)
  S.cdir('contentSetMode', { mode: 'on' });
  assert.ok('topicsections|T3' in S.view(S.get('cellinjury-razi-a-26', S.tRa, 0)));
});

test('decisions: use a group\'s version for everyone, or the main version; undo migration restores the exact original state', function () {
  const S = contentSetup();
  const original = JSON.stringify(S.b.sheets.Content._rows);
  const m = S.cdir('contentMigrate', { decisions: { 'cellinjury-razi-a-26|customtopics|C1': 'group', 'cellinjury-razi-a-26|topicsections|T2': 'main' } });
  assert.deepStrictEqual(m.decided, { main: 1, group: 1, local: 0 });
  S.cdir('contentSetMode', { mode: 'on' });
  assert.deepStrictEqual(S.view(S.get('cellinjury-misrata-a-26', S.tMa)), { 'topicsections|T1': { sections: ['A'] }, 'customtopics|C1': { title: 'Razi title' } }, 'Razi\'s title became the master');
  assert.ok(!('topicsections|T2' in S.view(S.get('cellinjury-razi-a-26', S.tRa))), '"main version" → the group-only item is not carried over');
  assert.strictEqual(S.cdir('contentUndoMigration').ok, false, 'switch off first');
  S.cdir('contentSetMode', { mode: 'off' });
  const u = S.cdir('contentUndoMigration'); assert.ok(u.ok, JSON.stringify(u));
  assert.strictEqual(JSON.stringify(S.b.sheets.Content._rows), original, 'exactly the original rows again');
  assert.strictEqual(S.dir('contentStatus').modules.filter(function (x) { return x.moduleId === 'cellinjury'; })[0].publishedVersion, '');
  assert.ok(S.cdir('contentMigrate', { decisions: {} }).ok, 'can be redone');
});

/* ---------------- Step 8: Draft → Preview → Publish ---------------- */
test('draft editing changes only the draft; publish delivers it to every group; history, discard, restore, freeze', function () {
  const S = contentSetup();
  assert.ok(S.cdir('contentMigrate', { decisions: {} }).ok);
  assert.ok(S.cdir('contentSetMode', { mode: 'on' }).ok);
  assert.strictEqual(S.call({ module: 'portal', action: 'contentEditDraft', ttoken: S.ahmed.tok, token: S.ahmed.tok, moduleId: 'cellinjury' }).ok, false, 'Admin only');
  const ed = S.cdir('contentEditDraft'); assert.ok(ed.ok && ed.token, JSON.stringify(ed));
  const dt = ed.token;
  // the draft session shows the draft (= v1.0 at first)
  assert.deepStrictEqual(S.view(S.get('cellinjury', dt)), { 'topicsections|T1': { sections: ['A'] }, 'customtopics|C1': { title: 'Main title' }, 'assessments|AS1': { title: 'Main quiz' } });
  // edits in the draft session go to the draft only
  S.up('cellinjury', dt, 'topicsections', 'T1', { sections: ['A corrected'] });
  S.up('cellinjury', dt, 'importedquestions', 'Q1', { stem: 'New MCQ' });
  assert.ok(S.call({ module: 'cellinjury', action: 'delete', token: dt, collection: 'customtopics', id: 'C1' }).ok);
  const dv = S.view(S.get('cellinjury', dt));
  assert.deepStrictEqual(dv['topicsections|T1'], { sections: ['A corrected'] }); assert.ok(dv['importedquestions|Q1']); assert.ok(!dv['customtopics|C1']);
  // nobody else sees the draft
  const ma0 = S.view(S.get('cellinjury-misrata-a-26', S.tMa));
  assert.deepStrictEqual(ma0, { 'topicsections|T1': { sections: ['A'] }, 'customtopics|C1': { title: 'Main title' } });
  assert.deepStrictEqual(S.view(S.get('cellinjury', S.tMain))['topicsections|T1'], { sections: ['A'] }, 'a normal session of the main storage still sees the published version');
  // what changed
  const d = S.cdir('contentDraft');
  assert.deepStrictEqual([d.added, d.changed, d.removed], [['importedquestions|Q1'], ['topicsections|T1'], ['customtopics|C1']]);
  // publish → v1.1 for every group (their kept local items stay on top)
  const before = S.get('cellinjury-misrata-a-26', S.tMa).serverTime; pause();
  const pub = S.cdir('contentPublish', { notes: 'Corrected T1, new MCQ' });
  assert.ok(pub.ok, JSON.stringify(pub)); assert.strictEqual(pub.label, '1.1'); assert.deepStrictEqual([pub.added, pub.changed, pub.removed], [1, 1, 1]);
  pause();
  const ma = S.get('cellinjury-misrata-a-26', S.tMa, before);   // the browser's next sync
  assert.deepStrictEqual(S.view({ items: ma.items }), { 'topicsections|T1': { sections: ['A corrected'] }, 'importedquestions|Q1': { stem: 'New MCQ' } });
  assert.ok(ma.items.some(function (i) { return i.id === 'C1' && i.deleted; }), 'the removed item is removed from browsers');
  const ra = S.view(S.get('cellinjury-razi-a-26', S.tRa));
  assert.deepStrictEqual(ra['customtopics|C1'], { title: 'Razi title' }, 'Al-Razi keeps its own kept item on top of the new version');
  assert.deepStrictEqual(ra['topicsections|T1'], { sections: ['A corrected'] });
  assert.strictEqual(S.cdir('contentPublish', {}).ok, false, 'nothing new to publish');
  // history
  let st = S.dir('contentStatus').modules.filter(function (m) { return m.moduleId === 'cellinjury'; })[0];
  assert.deepStrictEqual(st.versionList.map(function (v) { return v.label; }), ['1.1', '1.0']); assert.strictEqual(st.publishedVersion, '1.1'); assert.strictEqual(st.draftChanges, 0);
  // discard: draft changes thrown away
  S.up('cellinjury', dt, 'topicsections', 'T1', { sections: ['oops'] });
  assert.strictEqual(S.cdir('contentDraft').count, 1);
  assert.ok(S.cdir('contentDiscardDraft').ok); assert.strictEqual(S.cdir('contentDraft').count, 0);
  // freeze blocks publishing and restoring
  S.cdir('contentFreeze', { frozen: true });
  S.up('cellinjury', dt, 'topicsections', 'T1', { sections: ['x'] });
  assert.match(S.cdir('contentPublish', {}).error, /frozen/); assert.match(S.cdir('contentRestore', { version: 1 }).error, /frozen/);
  S.cdir('contentFreeze', { frozen: false });
  // restore v1.0 → published as v1.2, every group gets the old content back; the draft follows
  const rs = S.cdir('contentRestore', { version: 1 }); assert.ok(rs.ok, JSON.stringify(rs)); assert.strictEqual(rs.label, '1.2');
  assert.deepStrictEqual(S.view(S.get('cellinjury-misrata-a-26', S.tMa)), { 'topicsections|T1': { sections: ['A'] }, 'customtopics|C1': { title: 'Main title' } });
  assert.strictEqual(S.cdir('contentDraft').count, 0);
  st = S.dir('contentStatus').modules.filter(function (m) { return m.moduleId === 'cellinjury'; })[0];
  assert.deepStrictEqual(st.versionList.map(function (v) { return v.label; }), ['1.2', '1.1', '1.0']);
  assert.match(st.versionList[0].notes, /Restored from version 1\.0/);
});

test('draft sessions: only the Admin\'s draft token writes the draft; normal teachers and students never do', function () {
  const S = contentSetup();
  S.cdir('contentMigrate', { decisions: {} }); S.cdir('contentSetMode', { mode: 'on' });
  // a normal teacher session of the main storage writes its local layer, not the draft
  S.up('cellinjury', S.tMain, 'topicsections', 'T5', { sections: ['main local'] });
  assert.strictEqual(S.cdir('contentDraft').count, 0);
  // a group teacher cannot reach the draft at all
  S.up('cellinjury-razi-a-26', S.tRa, 'topicsections', 'T6', { sections: ['razi local'] });
  assert.strictEqual(S.cdir('contentDraft').count, 0);
  // a student session never writes
  const stu = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'ahmed', password: PW }).modules.cellinjury.token;
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'upsert', stoken: stu, collection: 'topicsections', id: 'T7', data: {} }).ok, false);
  // ending all module teacher sessions also ends draft sessions
  const dt = S.cdir('contentEditDraft').token;
  S.dir('portalEndModuleSessions');
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'upsert', token: dt, collection: 'topicsections', id: 'T8', data: {} }).ok, false);
});

/* ---------------- Step 9: group local changes ---------------- */
test('local changes: listed by kind; draft warns about affected groups; remove → master again; promote → master draft', function () {
  const S = contentSetup();
  S.cdir('contentMigrate', { decisions: {} });   // Al-Razi keeps T2 (addition) and C1 (its own version) locally
  S.cdir('contentSetMode', { mode: 'on' });
  // inside Al-Razi's module: hide master item T1, hide a built-in topic, re-save an item identical to the master
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'delete', token: S.tRa, collection: 'topicsections', id: 'T1' }).ok);
  S.up('cellinjury-razi-a-26', S.tRa, 'hiddentopics', 'packaged-topic-7', { hidden: true });
  assert.strictEqual(S.call({ module: 'portal', action: 'contentLocal', ttoken: S.ahmed.tok, token: S.ahmed.tok, moduleId: 'cellinjury' }).ok, false, 'Admin only');
  const L = S.cdir('contentLocal'); assert.ok(L.ok, JSON.stringify(L));
  const ra = L.groups.filter(function (g) { return g.storage === 'cellinjury-razi-a-26'; })[0];
  assert.match(ra.label, /Al-Razi · Group A \(2026-27\)/);
  const kind = function (id) { return ra.items.filter(function (x) { return x.id === id; })[0].kind; };
  assert.strictEqual(kind('T2'), 'addition'); assert.strictEqual(kind('C1'), 'override'); assert.strictEqual(kind('T1'), 'hidden'); assert.strictEqual(kind('packaged-topic-7'), 'hidden');
  assert.deepStrictEqual(ra.counts, { addition: 1, hidden: 2, override: 1, same: 0 });
  assert.ok(!('topicsections|T1' in S.view(S.get('cellinjury-razi-a-26', S.tRa))), 'hidden for Al-Razi');
  assert.ok('topicsections|T1' in S.view(S.get('cellinjury-misrata-a-26', S.tMa)), 'not for Misrata');
  // the draft changes C1 and T1 → Al-Razi is listed as affected
  const dt = S.cdir('contentEditDraft').token;
  S.up('cellinjury', dt, 'customtopics', 'C1', { title: 'Corrected main title' });
  S.up('cellinjury', dt, 'topicsections', 'T1', { sections: ['A2'] });
  const d = S.cdir('contentDraft');
  assert.deepStrictEqual(d.affectedGroups.map(function (a) { return a.storage + ' ' + a.item + (a.hidden ? ' hidden' : ''); }).sort(),
    ['cellinjury-razi-a-26 customtopics|C1', 'cellinjury-razi-a-26 topicsections|T1 hidden']);
  // "use the master again" for C1 → Al-Razi gets the master version (at its next sync: full refresh)
  const before = S.get('cellinjury-razi-a-26', S.tRa).serverTime; pause();
  assert.ok(S.dir('contentLocalRemove', { storage: 'cellinjury-razi-a-26', collection: 'customtopics', id: 'C1' }).ok);
  pause();
  assert.deepStrictEqual(S.view({ items: S.get('cellinjury-razi-a-26', S.tRa, before).items })['customtopics|C1'], { title: 'Main title' });
  // promote Al-Razi's T2 into the master draft (and drop the local copy) → after publishing every group has it
  assert.ok(S.dir('contentLocalPromote', { storage: 'cellinjury-razi-a-26', collection: 'topicsections', id: 'T2', removeLocal: true }).ok);
  assert.ok(S.cdir('contentDraft').added.indexOf('topicsections|T2') >= 0);
  assert.strictEqual(S.dir('contentLocalPromote', { storage: 'cellinjury-razi-a-26', collection: 'topicsections', id: 'T1' }).ok, false, 'a hidden item cannot be promoted');
  assert.ok(S.cdir('contentPublish', { notes: 'with Al-Razi T2' }).ok);
  assert.deepStrictEqual(S.view(S.get('cellinjury-misrata-a-26', S.tMa))['topicsections|T2'], { sections: ['razi local'] });
  const ra2 = S.view(S.get('cellinjury-razi-a-26', S.tRa));
  assert.deepStrictEqual(ra2['topicsections|T2'], { sections: ['razi local'] }); assert.deepStrictEqual(ra2['customtopics|C1'], { title: 'Corrected main title' }, 'Al-Razi now receives master corrections of C1');
  assert.ok(!('topicsections|T1' in ra2), 'T1 is still hidden for Al-Razi (its choice) even after the master update');
  assert.strictEqual(S.dir('contentLocalRemove', { storage: 'cellinjury@v1', collection: 'x', id: 'y' }).ok, false, 'internal storages refused');
});

/* ---------------- Step 10: results & attendance overviews ---------------- */
test('overviews: per delivery, read-only; teachers see only their own groups; students matched by ID / email / name', function () {
  const S = teachersSetup(), D = S.dl, X = S.b.ctx;
  const st = 'cellinjury-razi-a-26';
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'b1', name: 'Basma One', email: 'basma@uni.ly', password: 'basma-pass-1' }], mustChange: false }).ok);
  assert.ok(login(S, st, 'ahmed', PW).ok);
  const ins = function (sheet, o) { X.sheet_(sheet); X.appendRow_(sheet, o); };
  // practice quizzes (the module stores the session's name + email), one from someone not in the roster
  ins('Results', { module: st, id: 'q1', name: 'Student Ahmed', email: 'ahmed@student.local', percent: 80, submittedAt: 1 });
  ins('Results', { module: st, id: 'q2', name: 'Student Ahmed', email: 'ahmed@student.local', percent: 60, submittedAt: 2 });
  ins('Results', { module: st, id: 'q3', name: 'Visitor', email: 'v@x.ly', percent: 10, submittedAt: 3 });
  ins('Results', { module: 'cellinjury-misrata-a-26', id: 'q9', name: 'Student Sara', email: 'sara@student.local', percent: 99, submittedAt: 3 });
  // an assessment attempt (by email) and an exam attempt (by Student ID)
  ins('AssessRecords', Object.assign({ module: st, kind: 'attempt', id: 'att1', ref: 'A1', email: 'basma@uni.ly', status: 'submitted' }, X.packJson_({ assessmentId: 'A1', assessmentTitle: 'Quiz week 1', email: 'basma@uni.ly', status: 'submitted', percent: 90, submittedAt: 5 })));
  ins('AssessRecords', Object.assign({ module: st, kind: 'attempt', id: 'att2', ref: 'A1', email: 'ahmed@student.local', status: 'in_progress' }, X.packJson_({ assessmentId: 'A1', email: 'ahmed@student.local', status: 'in_progress' })));
  ins('AssessRecords', Object.assign({ module: st, kind: 'exattempt', id: 'ex1', status: 'submitted' }, X.packJson_({ examId: 'E1', username: 'ahmed', studentName: 'Student Ahmed', status: 'submitted', percent: 70 })));
  // attendance: 2 sessions; Ahmed (typed ID) at both, Basma (by name) at one
  ins('AttendanceSessions', { module: st, sessionId: 'S1', sessionTitle: 'Lecture 1', status: 'closed', createdAt: 100 });
  ins('AttendanceSessions', { module: st, sessionId: 'S2', sessionTitle: 'Lecture 2', status: 'closed', createdAt: 200 });
  ins('AttendanceRecords', { sessionId: 'S1', recordId: 'r1', studentName: 'Ahmed', studentId: 'AHMED', status: 'present' });
  ins('AttendanceRecords', { sessionId: 'S2', recordId: 'r2', studentName: 'Ahmed', studentId: 'ahmed', status: 'present' });
  ins('AttendanceRecords', { sessionId: 'S2', recordId: 'r3', studentName: 'basma one', studentId: '', status: 'present' });
  const before = JSON.stringify(Object.keys(S.b.sheets).sort().map(function (n) { return [n, S.b.sheets[n]._rows]; }));
  // Admin: every delivery
  const o = S.dir('reportOverview'); assert.ok(o.ok, JSON.stringify(o));
  assert.strictEqual(o.deliveries.length, 4);
  const ra = o.deliveries.filter(function (d) { return d.storage === st; })[0];
  assert.strictEqual(ra.students, 2); assert.strictEqual(ra.signedIn, 1);
  assert.deepStrictEqual(ra.quiz, { attempts: 3, students: 2, avg: 50 });
  assert.deepStrictEqual(ra.assess, { submitted: 1, avg: 90 }); assert.deepStrictEqual(ra.exams, { submitted: 1, avg: 70 });
  assert.deepStrictEqual(ra.attendance, { sessions: 2, avgPresent: 1.5, last: 200 });
  // detail
  const r = S.dir('reportDelivery', { deliveryId: D[st].deliveryId }); assert.ok(r.ok, JSON.stringify(r));
  const ah = r.students.filter(function (x) { return x.studentId === 'ahmed'; })[0], bs = r.students.filter(function (x) { return x.studentId === 'b1'; })[0];
  assert.deepStrictEqual(ah.quiz, { attempts: 2, best: 80, avg: 70 }); assert.deepStrictEqual(ah.exams, { submitted: 1, avg: 70 });
  assert.strictEqual(ah.attended, 2); assert.strictEqual(ah.attendedPct, 100); assert.ok(ah.lastLogin > 0);
  assert.deepStrictEqual(bs.assess, { submitted: 1, avg: 90 }); assert.deepStrictEqual(bs.sessions, ['S2']); assert.strictEqual(bs.attendedPct, 50);
  assert.deepStrictEqual(r.others, [{ label: 'Visitor', quiz: 1, assess: 0, exams: 0, attendance: 0 }]);
  assert.deepStrictEqual(r.sessions.map(function (s) { return s.title + ':' + s.present; }), ['Lecture 1:1', 'Lecture 2:2']);
  assert.deepStrictEqual(r.assessments, [{ id: 'A1', title: 'Quiz week 1', submitted: 1, avg: 90 }]);
  assert.strictEqual(JSON.stringify(r).indexOf('pwHash'), -1);
  // teacher Ahmed: only his two deliveries; Sara's group is refused
  const to = S.t('reportOverview', S.ahmed.tok); assert.ok(to.ok, JSON.stringify(to));
  assert.deepStrictEqual(to.deliveries.map(function (d) { return d.storage; }).sort(), ['cellinjury-razi-a-26', 'inflhealing-razi-a-26']);
  assert.ok(S.t('reportDelivery', S.ahmed.tok, { deliveryId: D[st].deliveryId }).ok);
  assert.strictEqual(S.t('reportDelivery', S.ahmed.tok, { deliveryId: D['cellinjury-misrata-a-26'].deliveryId }).code, 'forbidden');
  assert.strictEqual(S.t('reportOverview', 'nope').code, 'auth');
  assert.strictEqual(S.call({ module: 'portal', action: 'reportOverview' }).ok, false, 'no session → nothing');
  assert.strictEqual(S.call({ module: 'portal', action: 'reportOverview', token: S.ahmed.tok }).ok, false, 'a teacher token is not an Admin token');
  assert.strictEqual(JSON.stringify(Object.keys(S.b.sheets).sort().map(function (n) { return [n, S.b.sheets[n]._rows]; })), before, 'read-only');
});

/* ---------------- packaged releases (new build of a module) ---------------- */
test('new build: preview key only for the Admin draft session; manifests; compatibility check; decisions; go live', function () {
  const S = contentSetup(), crypto = require('crypto'), rel = require('../tools/module-release.js');
  const KEY = crypto.randomBytes(32).toString('base64'); S.b.ctx.CONTENT_KEYS.cellinjury = KEY;
  S.cdir('contentMigrate', { decisions: {} }); S.cdir('contentSetMode', { mode: 'on' });
  // overlay: master draft edits that point into the packaged course; Al-Razi's local edits
  const dt = S.cdir('contentEditDraft').token;
  S.up('cellinjury', dt, 'contentedits', 'question:q002', { kind: 'question', key: 'q002', fields: { stem: 'fixed' } });
  S.up('cellinjury', dt, 'contentedits', 'question:q003', { kind: 'question', key: 'q003', fields: { stem: 'fixed 3' } });
  S.up('cellinjury', dt, 'custommedia', 's0102', { items: [{ type: 'image', url: 'x' }] });
  S.up('cellinjury', dt, 'quizextra', 'extra', { ids: ['q001', 'q003'] });
  S.up('cellinjury', dt, 'importedquestions', 'q900', { stem: 'imported' });
  S.up('cellinjury', dt, 'contentedits', 'lmr-fact:x1', { kind: 'lmr-fact' });
  assert.ok(S.cdir('contentPublish', { notes: 'edits' }).ok);
  S.up('cellinjury-razi-a-26', S.tRa, 'hiddentopics', 't03', { hidden: true });
  // preview key: the Admin's draft session gets it; a normal teacher session, a group session or a student does not
  const pk = S.call({ module: 'cellinjury', action: 'studentSession', token: dt, preview: 1 });
  assert.ok(pk.ok && pk.role === 'teacher' && pk.preview, JSON.stringify(pk));
  assert.strictEqual(pk.contentKey, rel.previewKey(Buffer.from(KEY, 'base64'), 'cellinjury').toString('base64'), 'same derivation as the release tool');
  assert.notStrictEqual(pk.contentKey, KEY);
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'studentSession', token: S.tMain, preview: 1 }).code, 'nopreview');
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', token: S.tRa, preview: 1 }).code, 'nopreview');
  const st = login(S, 'cellinjury-razi-a-26', 'ahmed', PW);
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentSession', stoken: st.stoken || st.token, preview: 1 }).code, 'nopreview');
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'studentSession', token: dt }).contentKey, KEY, 'the live page still gets the live key');
  // manifests: only from a draft session
  const live = { topics: { t01: 'a', t02: 'b', t03: 'c', T1: 'k', T2: 'k' }, sections: { s0101: 'x', s0102: 'y' }, questions: { q001: '1', q002: '2', q003: '3' }, cases: {}, images: {}, other: {} };
  const next = { topics: { t01: 'a', t02: 'b2', T1: 'k', T2: 'k' }, sections: { s0101: 'x' }, questions: { q001: '1', q002: '2b', q900: 'n' }, cases: {}, images: {}, other: {} };
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'contentBuildManifest', token: S.tMain, build: 'b1', manifest: live }).code, 'forbidden');
  assert.strictEqual(S.cdir('contentRebuildCheck').code, 'nopreview');
  assert.ok(S.call({ module: 'cellinjury', action: 'contentBuildManifest', token: dt, build: 'b1', manifest: live }).ok);
  assert.ok(S.call({ module: 'cellinjury', action: 'contentBuildManifest', token: dt, build: 'b2', preview: true, manifest: next }).ok);
  const c = S.cdir('contentRebuildCheck'); assert.ok(c.ok, JSON.stringify(c));
  const st_ = function (key) { const it = c.items.filter(function (x) { return x.key === key; })[0]; return it ? it.status + (it.missing.length ? ':' + it.missing.join(',') : '') : 'ok'; };
  assert.strictEqual(st_('master|contentedits|question:q002'), 'changed');
  assert.strictEqual(st_('master|contentedits|question:q003'), 'missing:q003');
  assert.strictEqual(st_('master|custommedia|s0102'), 'missing:s0102');
  assert.strictEqual(st_('master|quizextra|extra'), 'partial:q003');
  assert.strictEqual(st_('master|importedquestions|q900'), 'duplicate');
  assert.strictEqual(st_('master|contentedits|lmr-fact:x1'), 'unchecked');
  assert.strictEqual(st_('cellinjury-razi-a-26|hiddentopics|t03'), 'missing:t03');
  assert.strictEqual(st_('master|customtopics|C1'), 'ok', 'overlay-only items are carried forward');
  assert.deepStrictEqual(c.diff.topics, { removed: ['t03'], added: 0, changed: 1 });
  assert.strictEqual(c.undecided, 6);
  assert.strictEqual(S.cdir('contentGoLive', { build: 'b2' }).ok, false, 'blocked until every item is decided');
  assert.ok(S.cdir('contentRebuildDecide', { decisions: { 'master|contentedits|question:q002': 'remove', 'master|contentedits|question:q003': 'remove', 'master|custommedia|s0102': 'keep',
    'master|quizextra|extra': 'clean', 'master|importedquestions|q900': 'remove', 'cellinjury-razi-a-26|hiddentopics|t03': 'remove' } }).ok);
  assert.strictEqual(S.cdir('contentRebuildCheck').undecided, 0);
  assert.strictEqual(S.cdir('contentGoLive', { build: 'b1' }).ok, false, 'must name the checked build');
  const before = S.get('cellinjury-razi-a-26', S.tRa).serverTime;
  const g = S.cdir('contentGoLive', { build: 'b2', notes: 'Build 2' }); assert.ok(g.ok, JSON.stringify(g));
  assert.strictEqual(g.build, 'b2'); assert.strictEqual(g.removedMaster, 4); assert.strictEqual(g.changedLocal, 1);
  const v = S.get('cellinjury-misrata-a-26', S.tMa), view = S.view(v);
  assert.ok(!('contentedits|question:q002' in view) && !('importedquestions|q900' in view));
  assert.deepStrictEqual(view['quizextra|extra'], { ids: ['q001'] }); assert.ok('custommedia|s0102' in view, 'kept');
  assert.ok(!('hiddentopics|t03' in S.view({ items: S.get('cellinjury-razi-a-26', S.tRa, before).items })), 'the group decision applied');
  const stat = S.cdir('contentStatus').modules.filter(function (m) { return m.moduleId === 'cellinjury'; })[0];
  assert.strictEqual(stat.builds.live.build, 'b2'); assert.strictEqual(stat.builds.preview, null); assert.strictEqual(stat.versionList[0].build, 'b2');
  assert.strictEqual(S.cdir('contentRebuildCheck').code, 'nopreview', 'the preview is consumed');
});

test('local changes: Preview of one local item is read-only, Admin only, and includes the master version', function () {
  const S = contentSetup();
  S.cdir('contentMigrate', { decisions: {} }); S.cdir('contentSetMode', { mode: 'on' });
  S.up('cellinjury-razi-a-26', S.tRa, 'custommedia', 's0202', { items: [{ id: 'm1', type: 'image', url: 'https://drive.google.com/thumbnail?id=X&sz=w2000', caption: 'LVH gross' }] });
  const before = JSON.stringify(Object.keys(S.b.sheets).sort().map(function (n) { return [n, S.b.sheets[n]._rows]; }));
  const a = S.dir('contentLocalItem', { storage: 'cellinjury-razi-a-26', collection: 'custommedia', id: 's0202' }); assert.ok(a.ok, JSON.stringify(a));
  assert.deepStrictEqual(a.data.items[0].caption, 'LVH gross'); assert.strictEqual(a.master, null); assert.strictEqual(a.deleted, false);
  const c = S.dir('contentLocalItem', { storage: 'cellinjury-razi-a-26', collection: 'customtopics', id: 'C1' });
  assert.deepStrictEqual([c.data, c.master], [{ title: 'Razi title' }, { title: 'Main title' }], 'its own version next to the master version');
  assert.strictEqual(S.dir('contentLocalItem', { storage: 'cellinjury-razi-a-26', collection: 'custommedia', id: 'nope' }).ok, false);
  assert.strictEqual(S.dir('contentLocalItem', { storage: 'cellinjury@draft', collection: 'custommedia', id: 's0202' }).ok, false, 'internal storages refused');
  assert.strictEqual(S.dir('contentLocalItem', { storage: 'cellinjury-razi-a-26', collection: 'assessments', id: 'AS9' }).ok, false, 'only educational items');
  assert.strictEqual(S.call({ module: 'portal', action: 'contentLocalItem', token: S.ahmed.tok, storage: 'cellinjury-razi-a-26', collection: 'custommedia', id: 's0202' }).ok, false, 'Admin only');
  assert.strictEqual(JSON.stringify(Object.keys(S.b.sheets).sort().map(function (n) { return [n, S.b.sheets[n]._rows]; })), before, 'nothing changed');
});

/* ---------------- 2.5 speed: fast "nothing new" answer, tidy up ---------------- */
function countReads(S) {
  const X = S.b.ctx, orig = X.readAll_, n = {};
  X.readAll_ = function (name) { n[name] = (n[name] || 0) + 1; return orig(name); };
  return { n: n, reset: function () { Object.keys(n).forEach(function (k) { delete n[k]; }); }, done: function () { X.readAll_ = orig; } };
}
test('speed: an unchanged storage is answered without reading the Content sheet — and a change is never hidden', function () {
  const S = contentSetup(), X = S.b.ctx;
  X.CV_WRITE_GRACE_MS = 0;   // (120 s on the real backend)
  S.cdir('contentMigrate', { decisions: {} }); S.cdir('contentSetMode', { mode: 'on' });
  const st = 'cellinjury-razi-a-26', sl = login(S, st, 'ahmed', PW), stok = sl.stoken || sl.token;
  const getS = function (since) { return S.call({ module: st, action: 'getAllContent', stoken: stok, since: since || 0 }); };
  const full = getS(0); assert.ok(full.ok && full.items.length > 0);
  pause(); pause();
  const R = countReads(S);
  let r = getS(full.serverTime); assert.ok(r.ok, JSON.stringify(r));   // first check after a cold cache: normal path (sets the marker)
  pause(); pause(); R.reset();
  r = getS(r.serverTime); assert.deepStrictEqual(r.items, []); assert.ok(!R.n.Content, 'no Content read: ' + JSON.stringify(R.n));
  // a teacher of this group changes something → the next check (with the old cursor) gets it
  const since = r.serverTime; pause();
  S.up(st, S.tRa, 'topicsections', 'T9', { sections: ['new'] });
  r = getS(since); assert.ok(r.items.some(function (i) { return i.id === 'T9'; }), 'the change arrives');
  // another group's change does not slow this storage down
  pause(); pause(); const s2 = getS(r.serverTime).serverTime; pause(); pause();
  S.up('cellinjury-misrata-a-26', S.tMa, 'topicsections', 'TX', { sections: ['m'] });
  R.reset(); r = getS(s2); assert.deepStrictEqual(r.items, []); assert.ok(!R.n.Content);
  // publishing the master → full refresh for everybody
  const dt = S.cdir('contentEditDraft').token;
  S.up('cellinjury', dt, 'customtopics', 'C7', { title: 'Seven' }); assert.ok(S.cdir('contentPublish', { notes: 'x' }).ok);
  r = getS(r.serverTime); assert.ok(r.items.some(function (i) { return i.id === 'C7'; }), 'the new master version arrives');
  // the sign-in check is still made on the fast path
  pause(); pause(); const s3 = getS(r.serverTime).serverTime; pause(); pause();
  assert.strictEqual(S.call({ module: st, action: 'getAllContent', stoken: 'x'.repeat(40), since: s3 }).code, 'studentauth');
  // a master-draft session never takes the fast path
  const d0 = S.call({ module: 'cellinjury', action: 'getAllContent', token: dt, since: 0 }); assert.ok(d0.draft);
  pause(); pause(); const d1 = S.call({ module: 'cellinjury', action: 'getAllContent', token: dt, since: d0.serverTime }); pause(); pause();
  assert.ok(S.call({ module: 'cellinjury', action: 'getAllContent', token: dt, since: d1.serverTime }).draft === true);
  // a module that never used versioned content: same fast path, and writes still arrive
  const tv = S.tokens.vulva, g = function (since) { return S.call({ module: 'vulva', action: 'getAllContent', token: tv, since: since || 0 }); };
  let v = g(0); pause(); pause(); v = g(v.serverTime); pause(); pause(); v = g(v.serverTime); pause(); pause(); R.reset();
  const v2 = g(v.serverTime); assert.deepStrictEqual(v2.items, []); assert.ok(!R.n.Content);
  pause(); S.up('vulva', tv, 'customtopics', 'V1', { title: 'v' });
  assert.ok(g(v2.serverTime).items.some(function (i) { return i.id === 'V1'; }));
  R.done();
});
test('speed: sign-out forgets the cached token check; tidy up removes only history tombstones, old snapshots and expired sessions', function () {
  const S = contentSetup(), X = S.b.ctx, c = S.b.cache;
  // sign-out of a module teacher session clears its cached check
  X.CacheService.getScriptCache().put('tok:cellinjury:' + S.tMain, '1', 600);
  S.call({ module: 'cellinjury', action: 'logout', token: S.tMain });
  assert.strictEqual(X.CacheService.getScriptCache().get('tok:cellinjury:' + S.tMain), null);
  // history: 7 snapshots of one item + 2 removed snapshots; expired sessions
  for (let i = 0; i < 7; i++) S.up('cellinjury-razi-a-26', S.tRa, 'history', 'topicsections::T1::' + i, { collection: 'topicsections', itemId: 'T1', data: { n: i }, savedAt: 1000 + i });
  ['h-x', 'h-y'].forEach(function (id) { S.up('cellinjury-razi-a-26', S.tRa, 'history', id, { collection: 'customtopics', itemId: 'C1', savedAt: 1 }); S.call({ module: 'cellinjury-razi-a-26', action: 'delete', token: S.tRa, collection: 'history', id: id }); });
  X.appendRow_(X.SHEETS.SESSIONS, { module: 'cellinjury', token: 'old-token-1', createdAt: 1, expiresAt: 2 });
  const edu = JSON.stringify(S.b.sheets.Content._rows.filter(function (r) { return r[1] !== 'history'; }));
  const rep = S.dir('portalTidyReport'); assert.ok(rep.ok, JSON.stringify(rep));
  assert.strictEqual(rep.historyTombstones, 2); assert.strictEqual(rep.historyArchived, 2); assert.ok(rep.expiredSessions >= 1);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalTidy', token: S.ahmed.tok }).ok, false, 'Admin only');
  const done = S.dir('portalTidy'); assert.ok(done.ok && done.removed >= 5 && !done.more, JSON.stringify(done));
  const hist = S.b.sheets.Content._rows.filter(function (r) { return r[1] === 'history'; }).map(function (r) { return r[2]; }).sort();
  assert.deepStrictEqual(hist, [2, 3, 4, 5, 6].map(function (i) { return 'topicsections::T1::' + i; }), 'the newest 5 stay');
  assert.deepStrictEqual(S.b.sheets.ContentArchive._rows.slice(1).map(function (r) { return r[2]; }).sort(), ['topicsections::T1::0', 'topicsections::T1::1'], 'older ones are archived, not lost');
  assert.strictEqual(JSON.stringify(S.b.sheets.Content._rows.filter(function (r) { return r[1] !== 'history'; })), edu, 'educational rows untouched');
  assert.ok(!S.b.sheets.Sessions._rows.some(function (r) { return r[1] === 'old-token-1'; }));
  assert.strictEqual(S.dir('portalTidyReport').historyTombstones, 0);
  assert.ok(X.portalWarm());
});


/* ---------------- Official Exams (2.6) ---------------- */
function examsSetup() {
  const S = teachersSetup();
  // the Official Exams module, delivered to Al-Razi A → storage exams-razi-a-26
  assert.ok(S.save('module', { moduleId: 'exams', title: 'Official Exams', url: 'https://third-year-med.github.io/pathology-exams/', storagePrefix: 'xm_', icon: '📝' }, { create: true }).ok);
  S.dl['exams-razi-a-26'] = S.save('delivery', { groupId: S.ra.groupId, moduleId: 'exams', status: 'available' }).record;
  assert.strictEqual(S.dl['exams-razi-a-26'].backendModule, 'exams-razi-a-26');
  assert.ok(S.dir('teacherAssign', { userId: S.ahmed.teacher.userId, deliveryIds: [S.dl['cellinjury-razi-a-26'].deliveryId, S.dl['inflhealing-razi-a-26'].deliveryId, S.dl['exams-razi-a-26'].deliveryId] }).ok);
  S.b.ctx.CONTENT_KEYS.cellinjury = Buffer.alloc(32, 1).toString('base64'); S.b.ctx.CONTENT_KEYS.inflhealing = Buffer.alloc(32, 2).toString('base64');
  return S;
}
test('exams: places + examiner sessions without a module password (Admin: all; teacher: only assigned), keys only for allowed modules', function () {
  const S = examsSetup();
  const pa = S.dir('examPlaces'); assert.ok(pa.ok, JSON.stringify(pa));
  const st = pa.places.map(function (x) { return x.storage; });
  ['cellinjury', 'inflhealing', 'cellinjury-razi-a-26', 'exams-razi-a-26', 'cellinjury-misrata-a-26'].forEach(function (k) { assert.ok(st.indexOf(k) >= 0, k); });
  assert.ok(st.indexOf('exams') < 0, 'the exams module itself is not a place');
  assert.strictEqual(pa.places.filter(function (x) { return x.storage === 'exams-razi-a-26'; })[0].kind, 'combined');
  // Admin opens the combined exams of Al-Razi A: a session for that storage only; keys of all modules
  const oa = S.dir('examOpen', { storage: 'exams-razi-a-26' }); assert.ok(oa.ok, JSON.stringify(oa));
  assert.ok(oa.keys.cellinjury && oa.keys.inflhealing);
  assert.ok(S.call({ module: 'exams-razi-a-26', action: 'examBankList', token: oa.token }).ok, 'works in the exam app');
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'examBankList', token: oa.token }).ok, false, 'not for another storage');
  assert.strictEqual(S.dir('examOpen', { storage: 'nope-x' }).ok, false);
  // personal teacher (Dr. Ahmed: Al-Razi A only)
  const pt = S.t('examPlaces', S.ahmed.tok); assert.ok(pt.ok, JSON.stringify(pt));
  assert.deepStrictEqual(pt.places.map(function (x) { return x.storage; }).sort(), ['cellinjury-razi-a-26', 'exams-razi-a-26', 'inflhealing-razi-a-26']);
  const ot = S.t('examOpen', S.ahmed.tok, { storage: 'exams-razi-a-26' }); assert.ok(ot.ok, JSON.stringify(ot));
  assert.deepStrictEqual(Object.keys(ot.keys).sort(), ['cellinjury', 'inflhealing']);
  assert.ok(S.call({ module: 'exams-razi-a-26', action: 'examList', token: ot.token }).ok);
  assert.strictEqual(S.t('examOpen', S.ahmed.tok, { storage: 'cellinjury-misrata-a-26' }).code, 'forbidden');
  assert.strictEqual(S.t('examOpen', S.ahmed.tok, { storage: 'cellinjury' }).code, 'forbidden', 'the main storage is the Admin\'s');
  // removing the assignment ends the examiner session at once
  assert.ok(S.dir('teacherAssign', { userId: S.ahmed.teacher.userId, deliveryIds: [S.dl['cellinjury-razi-a-26'].deliveryId] }).ok);
  assert.strictEqual(S.call({ module: 'exams-razi-a-26', action: 'examList', token: ot.token }).ok, false);
  assert.strictEqual(S.call({ module: 'portal', action: 'examOpen', token: S.ahmed.tok, storage: 'exams-razi-a-26' }).ok, false, 'a teacher token is not an Admin token');
});
test('exams: delivering Official Exams creates exam accounts with the group password; the group page sign-in is not affected', function () {
  const S = examsSetup();
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'e1', name: 'Exam One', password: 'exam-pass-11' }], mustChange: false }).ok);
  const rows = S.b.sheets.Students._rows.filter(function (r) { return r[1] === 'e1'; }).map(function (r) { return r[0]; }).sort();
  assert.deepStrictEqual(rows, ['cellinjury-razi-a-26', 'exams-razi-a-26', 'inflhealing-razi-a-26']);
  // an exam in the group's exam storage: the student signs in with the access code + the group password
  const oa = S.dir('examOpen', { storage: 'exams-razi-a-26' }), X = 'exams-razi-a-26', now = Date.now();
  const bk = S.call({ module: X, action: 'examBankSave', token: oa.token, questions: [{ type: 'tf', stem: 'Necrosis is irreversible', answer: true }] });
  const ex = S.call({ module: X, action: 'examUpsert', token: oa.token, exam: { title: 'Combined midterm', code: 'MID26', opensAt: now - 1000, closesAt: now + 3600000, durationMin: 20, questionIds: bk.saved, status: 'published' } });
  assert.ok(ex.ok, JSON.stringify(ex));
  const lg = S.call({ module: X, action: 'examLogin', code: 'mid26', username: 'e1', password: 'exam-pass-11' }); assert.ok(lg.ok, JSON.stringify(lg));
  // the group page sign-in does not open the exam storage (exams need the access code)
  const g = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'e1', password: 'exam-pass-11' });
  assert.ok(g.ok, JSON.stringify(g)); assert.ok(!('exams' in g.modules));
  // a password change inside a module of the group also changes the exam password
  const cs = g.modules.cellinjury.token;
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'studentChangePassword', stoken: cs, oldPassword: 'exam-pass-11', newPassword: 'exam-pass-22' }).ok);
  assert.strictEqual(S.call({ module: X, action: 'examLogin', code: 'MID26', username: 'e1', password: 'exam-pass-11' }).ok, false);
  assert.ok(S.call({ module: X, action: 'examLogin', code: 'MID26', username: 'e1', password: 'exam-pass-22' }).ok);
  // the Content tab does not list Official Exams as a teaching module
  assert.ok(!S.dir('contentStatus').modules.some(function (m) { return m.moduleId === 'exams'; }));
});
test('exams: the public exam list shows titles, times and state only — never codes, candidates or questions', function () {
  const S = examsSetup(), X = 'exams-razi-a-26', now = Date.now();
  const oa = S.dir('examOpen', { storage: X });
  const bk = S.call({ module: X, action: 'examBankSave', token: oa.token, questions: [{ type: 'tf', stem: 'Secret stem', answer: true }] });
  S.call({ module: X, action: 'examUpsert', token: oa.token, exam: { title: 'Combined midterm', code: 'SECRET1', opensAt: now + 3600000, closesAt: now + 7200000, durationMin: 45, questionIds: bk.saved, status: 'published', candidates: ['e1'] } });
  S.call({ module: X, action: 'examUpsert', token: oa.token, exam: { title: 'Draft only', code: 'DRAFT1', opensAt: now, closesAt: now + 7200000, durationMin: 45, questionIds: bk.saved, status: 'draft' } });
  const oc = S.dir('examOpen', { storage: 'cellinjury-razi-a-26' });
  const b2 = S.call({ module: 'cellinjury-razi-a-26', action: 'examBankSave', token: oc.token, questions: [{ type: 'tf', stem: 'q', answer: false }] });
  S.call({ module: 'cellinjury-razi-a-26', action: 'examUpsert', token: oc.token, exam: { title: 'Cell injury quiz', code: 'CIQ1', opensAt: now - 60000, closesAt: now + 600000, durationMin: 10, questionIds: b2.saved, status: 'published' } });
  const om = S.dir('examOpen', { storage: 'cellinjury-misrata-a-26' });
  const b3 = S.call({ module: 'cellinjury-misrata-a-26', action: 'examBankSave', token: om.token, questions: [{ type: 'tf', stem: 'q', answer: false }] });
  S.call({ module: 'cellinjury-misrata-a-26', action: 'examUpsert', token: om.token, exam: { title: 'Misrata exam', code: 'MIS1', opensAt: now - 60000, closesAt: now + 600000, durationMin: 10, questionIds: b3.saved, status: 'published' } });
  const l = S.call({ module: 'portal', action: 'portalExamList', g: 'razi-a-26' }); assert.ok(l.ok, JSON.stringify(l));
  assert.strictEqual(l.group.name, 'Group A');
  assert.deepStrictEqual(l.exams.map(function (e) { return [e.title, e.kind, e.state, e.questions]; }), [['Cell injury quiz', 'module', 'open', 1], ['Combined midterm', 'combined', 'notyet', 1]]);
  const txt = JSON.stringify(l);
  ['SECRET1', 'CIQ1', 'Secret stem', 'e1', 'Draft only', 'Misrata'].forEach(function (w) { assert.strictEqual(txt.indexOf(w), -1, w); });
  assert.strictEqual(S.call({ module: 'portal', action: 'portalExamList', g: 'nope' }).code, 'nogroup');
  assert.ok(S.call({ module: 'portal', action: 'portalExamList' }).ok, 'the page without a group lists the modules\' own exams');
});
test('exams: copy questions between exam banks and teaching banks — teachers only within their own groups', function () {
  const S = examsSetup(), X = 'exams-razi-a-26', C = 'cellinjury-razi-a-26';
  const oa = S.dir('examOpen', { storage: X }), ot = S.t('examOpen', S.ahmed.tok, { storage: X });
  const call = function (tok, a, o) { return S.call(Object.assign({ module: X, action: a, token: tok }, o || {})); };
  // sources: Admin → every module + every group; Dr. Ahmed → only Al-Razi A
  const sa = call(oa.token, 'examCopySources'); assert.ok(sa.ok && sa.admin, JSON.stringify(sa));
  assert.ok(sa.courses.some(function (c) { return c.storage === 'cellinjury'; }) && sa.courses.some(function (c) { return c.storage === 'cellinjury-misrata-a-26'; }));
  assert.ok(!sa.banks.some(function (b) { return b.storage === X; }), 'not its own bank');
  const st = call(ot.token, 'examCopySources'); assert.ok(st.ok && !st.admin);
  assert.deepStrictEqual(st.courses.map(function (c) { return c.storage; }).sort(), [C, 'inflhealing-razi-a-26']);
  assert.deepStrictEqual(st.banks.map(function (c) { return c.storage; }).sort(), [C, 'inflhealing-razi-a-26']);
  // copy from another exam bank (the group's Cell Injury exam bank)
  const oc = S.dir('examOpen', { storage: C });
  const b = S.call({ module: C, action: 'examBankSave', token: oc.token, questions: [{ type: 'mcq', stem: 'Pick one', options: ['a', 'b'], answer: 1, topic: '03 · Necrosis', image: 'https://drive.google.com/thumbnail?id=abc&sz=w2000' }] });
  const cf = call(ot.token, 'examCopyFrom', { from: C }); assert.ok(cf.ok, JSON.stringify(cf));
  assert.strictEqual(cf.questions.length, 1); assert.strictEqual(cf.questions[0].image, 'https://drive.google.com/thumbnail?id=abc&sz=w2000');
  assert.strictEqual(call(ot.token, 'examCopyFrom', { from: 'cellinjury-misrata-a-26' }).code, 'forbidden');
  assert.strictEqual(call(ot.token, 'examCopyFrom', { from: 'cellinjury' }).code, 'forbidden', 'the main storage is the Admin\'s');
  assert.ok(call(oa.token, 'examCopyFrom', { from: 'cellinjury-misrata-a-26' }).ok);
  // saved into the combined bank with the module as source → per-module sub-scores later
  const sv = call(ot.token, 'examBankSave', { questions: [Object.assign({}, cf.questions[0], { id: undefined, source: { kind: 'exambank', origId: b.saved[0], course: 'cellinjury' } })] });
  assert.strictEqual(call(ot.token, 'examBankList').questions[0].source.course, 'cellinjury');
  // exam → teaching bank (versioned content OFF: straight into the group's storage)
  const tq = { type: 'mcq', stem: 'Pick one', options: ['a', 'b'], answer: 1, topic: 't03', images: [{ url: 'https://drive.google.com/thumbnail?id=abc&sz=w2000', caption: '' }, { url: 'javascript:alert(1)' }] };
  const w = call(ot.token, 'examTeachWrite', { to: C, add: [tq, { type: 'mcq', stem: '' }], hide: ['q001'] }); assert.ok(w.ok, JSON.stringify(w));
  assert.strictEqual(w.added.length, 1); assert.strictEqual(w.skipped, 1); assert.strictEqual(w.where, 'live');
  const ex = call(ot.token, 'examCourseExtras', { from: C }); assert.ok(ex.ok);
  assert.deepStrictEqual(ex.questions.map(function (q) { return [q.id, q.topic, q.images.length]; }), [[w.added[0], 't03', 1]]);
  assert.deepStrictEqual(ex.exclude, ['q001']);
  assert.ok(S.b.sheets.Content._rows.some(function (r) { return r[0] === C && r[1] === 'importbatches'; }), 'provenance batch');
  // the students of that group see it; Misrata does not
  const g1 = S.call({ module: C, action: 'getAllContent', token: oc.token, since: 0 });
  assert.ok(g1.items.some(function (i) { return i.collection === 'importedquestions' && i.id === w.added[0]; }));
  // move back: remove the imported question and show it in Revision again
  assert.ok(call(ot.token, 'examTeachWrite', { to: C, remove: [w.added[0]], unhide: ['q001'] }).ok);
  const ex2 = call(ot.token, 'examCourseExtras', { from: C }); assert.strictEqual(ex2.questions.length, 0); assert.deepStrictEqual(ex2.exclude, []);
  // refused outside the teacher's groups
  assert.strictEqual(call(ot.token, 'examTeachWrite', { to: 'cellinjury-misrata-a-26', add: [tq] }).code, 'forbidden');
  assert.strictEqual(call(ot.token, 'examCourseExtras', { from: 'cellinjury' }).code, 'forbidden');
  assert.strictEqual(S.call({ module: X, action: 'examCopySources', token: 'nope' }).code, 'auth');
  // versioned content ON: the Admin writes to the master draft; a teacher to the group's local layer
  assert.ok(S.dir('contentMigrate', { moduleId: 'cellinjury', decisions: {} }).ok);
  assert.ok(S.dir('contentSetMode', { moduleId: 'cellinjury', mode: 'on' }).ok);
  const wa = call(oa.token, 'examTeachWrite', { to: 'cellinjury', add: [tq] }); assert.strictEqual(wa.where, 'draft');
  assert.ok(S.b.sheets.Content._rows.some(function (r) { return r[0] === 'cellinjury@draft' && r[2] === wa.added[0]; }));
  const wt = call(ot.token, 'examTeachWrite', { to: C, add: [tq] }); assert.strictEqual(wt.where, 'local');
  assert.ok(S.b.sheets.Content._rows.some(function (r) { return r[0] === C + '@local' && r[2] === wt.added[0]; }));
  assert.ok(call(ot.token, 'examCourseExtras', { from: C }).questions.some(function (q) { return q.id === wt.added[0]; }), 'reads the group\'s effective bank');
  assert.ok(!S.b.sheets.Content._rows.some(function (r) { return r[0] === 'cellinjury' && r[2] === wa.added[0]; }), 'the live master is unchanged until Publish');
});
test('exams: a combined exam closes every teaching module of the group for its candidates only (from 15 min before)', function () {
  const S = examsSetup(), X = 'exams-razi-a-26', now = Date.now();
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'e1', name: 'Exam One', password: 'exam-pass-11' }, { studentId: 'e2', name: 'Exam Two', password: 'exam-pass-22' }], mustChange: false }).ok);
  const g1 = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'e1', password: 'exam-pass-11' }); assert.ok(g1.ok, JSON.stringify(g1));
  const tok = g1.modules.cellinjury.token; assert.ok(tok);
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', stoken: tok, since: 0 }).ok, 'open before the exam');
  const oa = S.dir('examOpen', { storage: X });
  const bk = S.call({ module: X, action: 'examBankSave', token: oa.token, questions: [{ type: 'tf', stem: 'x', answer: true, source: { kind: 'new', course: 'cellinjury' } }] });
  const ex = S.call({ module: X, action: 'examUpsert', token: oa.token, exam: { title: 'Combined final', code: 'FIN26', opensAt: now + 10 * 60000, closesAt: now + 3600000, durationMin: 30, questionIds: bk.saved, status: 'published', lockTeaching: true, candidates: ['e1'] } });
  assert.ok(ex.ok, JSON.stringify(ex));
  // e1 (candidate): every module of the group is closed — open session, new sign-in, group page
  ['cellinjury-razi-a-26', 'inflhealing-razi-a-26'].forEach(function (m, i) {
    if (i === 0) assert.strictEqual(S.call({ module: m, action: 'getAllContent', stoken: tok, since: 0 }).code, 'examlock', m);
    assert.strictEqual(S.call({ module: m, action: 'studentLogin', username: 'e1', password: 'exam-pass-11' }).code, 'examlock', m);
  });
  assert.strictEqual(S.call({ module: 'cellinjury-razi-a-26', action: 'studentLogin', username: 'e1', password: 'wrong-pass' }).code !== 'examlock', true, 'no hint without the right password');
  const g2 = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'e1', password: 'exam-pass-11' });
  assert.strictEqual(g2.modules.cellinjury.reason, 'examlock'); assert.strictEqual(g2.modules.inflhealing.reason, 'examlock');
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'studentLogout', stoken: tok }).ok, 'signing out still works');
  // e2 (not a candidate) and other groups: unaffected
  const g3 = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'e2', password: 'exam-pass-22' });
  assert.ok(g3.modules.cellinjury.access && g3.modules.inflhealing.access, JSON.stringify(g3));
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', stoken: g3.modules.cellinjury.token, since: 0 }).ok);
  // teachers keep working; the candidate can sign in to the exam itself
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'getAllContent', token: S.dir('examOpen', { storage: 'cellinjury-razi-a-26' }).token, since: 0 }).ok);
  // switching the lock off reopens the modules at once
  assert.ok(S.call({ module: X, action: 'examUpsert', token: oa.token, exam: Object.assign({}, ex.exam, { lockTeaching: false }) }).ok);
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'e1', password: 'exam-pass-11' }).modules.cellinjury.access);
});
test('exams: results of a combined exam per module (each question counts in the module it came from)', function () {
  const S = examsSetup(), X = 'exams-razi-a-26', now = Date.now();
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'e1', name: 'Exam One', password: 'exam-pass-11' }], mustChange: false }).ok);
  const oa = S.dir('examOpen', { storage: X });
  const bk = S.call({ module: X, action: 'examBankSave', token: oa.token, questions: [
    { type: 'tf', stem: 'ci 1', answer: true, source: { kind: 'course', origId: 'q1', course: 'cellinjury' } },
    { type: 'tf', stem: 'ci 2', answer: true, source: { kind: 'course', origId: 'q2', course: 'cellinjury' } },
    { type: 'tf', stem: 'ih 1', answer: false, source: { kind: 'course', origId: 'q1', course: 'inflhealing' } },
    { type: 'fillblank', stem: 'What is the diagnosis?', answers: [['granuloma']], image: 'https://drive.google.com/thumbnail?id=pic1&sz=w2000', source: { kind: 'new' } }] });
  assert.strictEqual(bk.saved.length, 4, JSON.stringify(bk));
  const ex = S.call({ module: X, action: 'examUpsert', token: oa.token, exam: { title: 'Combined', code: 'CMB26', opensAt: now - 1000, closesAt: now + 3600000, durationMin: 20, questionIds: bk.saved, status: 'published', shuffleQuestions: false, shuffleOptions: false } });
  const lg = S.call({ module: X, action: 'examLogin', code: 'CMB26', username: 'e1', password: 'exam-pass-11' }); assert.ok(lg.ok, JSON.stringify(lg));
  const stt = S.call({ module: X, action: 'examStart', etoken: lg.etoken }); assert.ok(stt.ok, JSON.stringify(stt));
  assert.strictEqual(stt.paper[3].image, 'https://drive.google.com/thumbnail?id=pic1&sz=w2000', 'the picture reaches the paper');
  assert.ok(!JSON.stringify(stt).includes('granuloma'), 'never the answer');
  const sub = S.call({ module: X, action: 'examSubmit', etoken: lg.etoken, responses: { 0: true, 1: false, 2: false, 3: ['Granuloma'] } }); assert.ok(sub.ok, JSON.stringify(sub));
  const ms = S.call({ module: X, action: 'examModuleScores', token: oa.token, examId: ex.exam.id }); assert.ok(ms.ok, JSON.stringify(ms));
  assert.deepStrictEqual(ms.modules.map(function (m) { return m.id; }), ['cellinjury', 'inflhealing', 'other']);
  const r = ms.results[0].modules;
  assert.deepStrictEqual([r.cellinjury.marks, r.cellinjury.max, r.cellinjury.percent], [1, 2, 50]);
  assert.deepStrictEqual([r.inflhealing.marks, r.inflhealing.max], [1, 1]);
  assert.deepStrictEqual([r.other.marks, r.other.max], [1, 1], 'picture question, typed answer accepted case-insensitively');
  assert.strictEqual(S.call({ module: X, action: 'examModuleScores', token: 'bad', examId: ex.exam.id }).code, 'auth');
});
