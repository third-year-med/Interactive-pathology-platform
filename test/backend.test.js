'use strict';
/* Portal.gs tests: the real Code.gs core excerpt (with the one added route_ line) + Portal.gs in the harness. */
const test = require('node:test');
const assert = require('node:assert');
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
const FILES = [path.join(__dirname, 'apps-script', 'Code.core.gs'), path.join(__dirname, 'apps-script', 'Code.exam.gs'), path.join(__dirname, '..', 'backend', 'Portal.gs')];
const PW = 'student-pass-1';

function setup() {
  const b = fixtureBackend({ files: FILES, fetch: driveFake() });
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
  assert.deepStrictEqual(g.modules.map(function (m) { return m.moduleId; }), ['intropath', 'cellinjury', 'inflhealing']);
  assert.strictEqual(g.modules[1].title, 'Cell Injury & Cell Death');
  assert.strictEqual(S.dir('dirGet').modules.length, 3, 'copied once only');
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
  assert.strictEqual(all.modules.length, 4, 'Cell Injury exists once, delivered twice');
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
  // Step 3: the group page needs a roster membership — since 2.24 an account made in a group's module joins the list at once
  // (before, the Admin imported them with rosterImport, which now finds nothing left to add)
  assert.strictEqual(S.dir('rosterImport', { groupId: S.ra.groupId }).added, 0);
  assert.strictEqual(S.dir('rosterImport', { groupId: S.ma.groupId }).added, 0);
  assert.ok(S.b.ctx.rosterMember_(S.ra.groupId, 'ahmed') && S.b.ctx.rosterMember_(S.ma.groupId, 'sara'));
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
  // an account made in a module (before 2.24) without being on the roster does not open the group page
  S.b.ctx.rosterNewAccount_('cellinjury-razi-a-26', { studentId: 'loner', name: 'Not Listed', active: true }, S.b.ctx.rosterPw_(PW, false), Date.now());
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
  S.b.ctx.rosterNewAccount_('cellinjury-razi-a-26', { studentId: 'early', name: 'Early', active: true }, S.b.ctx.rosterPw_('old-module-pass', false), Date.now());   // made before 2.24 (not on the list)
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

/* 2.13: "Copy to master draft" → the group's own copy is removed automatically when the draft is published */
test('local changes: a copied group item is removed automatically on publish (the group then follows the master); kept if changed after copying; discard cancels', function () {
  const S = contentSetup();
  S.cdir('contentMigrate', { decisions: {} });   // Al-Razi keeps T2 (addition) and C1 (its own version) locally
  S.cdir('contentSetMode', { mode: 'on' });
  const local = function () { return (S.cdir('contentLocal').groups.filter(function (g) { return g.storage === 'cellinjury-razi-a-26'; })[0] || { items: [] }).items; };
  const item = function (id) { return local().filter(function (x) { return x.id === id; })[0]; };
  // discard cancels: copy T2, discard the draft, publish something else → T2 stays local
  assert.ok(S.dir('contentLocalPromote', { storage: 'cellinjury-razi-a-26', collection: 'topicsections', id: 'T2' }).ok);
  assert.strictEqual(item('T2').promoted, true, 'shown as copied');
  assert.ok(S.cdir('contentDiscardDraft').ok);
  assert.strictEqual(item('T2').promoted, false);
  // copy T2 and C1; Al-Razi then changes C1 again before publishing
  assert.ok(S.dir('contentLocalPromote', { storage: 'cellinjury-razi-a-26', collection: 'topicsections', id: 'T2' }).ok);
  assert.ok(S.dir('contentLocalPromote', { storage: 'cellinjury-razi-a-26', collection: 'customtopics', id: 'C1' }).ok);
  assert.ok(item('T2') && item('C1'), 'still local until the publish');
  assert.deepStrictEqual(S.view(S.get('cellinjury-razi-a-26', S.tRa))['topicsections|T2'], { sections: ['razi local'] }, 'Al-Razi keeps seeing it meanwhile');
  pause(); S.up('cellinjury-razi-a-26', S.tRa, 'customtopics', 'C1', { title: 'Razi changed it again' });
  assert.strictEqual(item('C1').promoted, false, 'changed after copying → no longer marked');
  const pub = S.cdir('contentPublish', { notes: 'with Al-Razi items' }); assert.ok(pub.ok, JSON.stringify(pub));
  assert.deepStrictEqual(pub.localRemoved, [{ storage: 'cellinjury-razi-a-26', collection: 'topicsections', id: 'T2' }]);
  assert.ok(!item('T2'), 'T2 is no longer a local copy'); assert.ok(item('C1'), 'C1 (changed after copying) is kept');
  const ra = S.view(S.get('cellinjury-razi-a-26', S.tRa)), mi = S.view(S.get('cellinjury-misrata-a-26', S.tMa));
  assert.deepStrictEqual(ra['topicsections|T2'], { sections: ['razi local'] }, 'Al-Razi now gets T2 from the master');
  assert.deepStrictEqual(mi['topicsections|T2'], { sections: ['razi local'] }, 'and so does every other group');
  assert.deepStrictEqual(ra['customtopics|C1'], { title: 'Razi changed it again' });
  // a later master correction of T2 now reaches Al-Razi
  const dt = S.cdir('contentEditDraft').token;
  S.up('cellinjury', dt, 'topicsections', 'T2', { sections: ['corrected in master'] });
  const p2 = S.cdir('contentPublish', { notes: 'correction' }); assert.ok(p2.ok); assert.deepStrictEqual(p2.localRemoved, []);
  assert.deepStrictEqual(S.view(S.get('cellinjury-razi-a-26', S.tRa))['topicsections|T2'], { sections: ['corrected in master'] });
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
test('exams: copy an exam from the normal link to a group (questions copied once, for the group\'s own students)', function () {
  const S = examsSetup(), now = Date.now();
  const om = S.dir('examOpen', { storage: 'cellinjury' });
  const bk = S.call({ module: 'cellinjury', action: 'examBankSave', token: om.token, questions: [{ type: 'tf', stem: 'a', answer: true, topic: 'T1' }, { type: 'tf', stem: 'b', answer: false, topic: 'T2' }] });
  const ex = S.call({ module: 'cellinjury', action: 'examUpsert', token: om.token, exam: { title: 'Q1', code: '7T8CRR', opensAt: now - 1000, closesAt: now + 3600000, durationMin: 60, questionIds: bk.saved, status: 'published', lockTeaching: true } });
  const G = 'cellinjury-razi-a-26';
  const c1 = S.call({ module: 'cellinjury', action: 'examCopyExam', token: om.token, examId: ex.exam.id, to: G, publish: true }); assert.ok(c1.ok, JSON.stringify(c1));
  assert.deepStrictEqual([c1.status, c1.copied, c1.reused], ['published', 2, 0]);
  const c2 = S.call({ module: 'cellinjury', action: 'examCopyExam', token: om.token, examId: ex.exam.id, to: G }); assert.deepStrictEqual([c2.status, c2.copied, c2.reused], ['draft', 0, 2], 'no duplicate questions; a second copy stays a draft');
  const og = S.dir('examOpen', { storage: G });
  assert.strictEqual(S.call({ module: G, action: 'examBankList', token: og.token }).questions.length, 2);
  const list = S.call({ module: G, action: 'examList', token: og.token }).exams;
  assert.strictEqual(list.length, 2); assert.ok(list.every(function (e) { return e.title === 'Q1' && e.lockTeaching && e.candidates === 'all'; }));
  // a Razi A student signs in with the group password
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'r1', name: 'Razi One', password: 'razi-pass-11' }], mustChange: false }).ok);
  assert.ok(S.call({ module: G, action: 'examLogin', code: '7t8crr', username: 'r1', password: 'razi-pass-11' }).ok);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalExamList', g: 'razi-a-26' }).exams.filter(function (e) { return e.title === 'Q1'; }).length, 1);
  // a personal teacher cannot copy into a group that is not theirs
  const ot = S.t('examOpen', S.ahmed.tok, { storage: G });
  assert.strictEqual(S.call({ module: G, action: 'examCopyExam', token: ot.token, examId: list[0].id, to: 'cellinjury-misrata-a-26' }).code, 'forbidden');
});
test('platformCheck: reports a missing Portal line, missing/invalid content keys — never prints a key', function () {
  const S = examsSetup();
  S.b.ctx.CONTENT_KEYS.vagina = Buffer.alloc(32, 3).toString('base64');
  const a = S.b.eval('platformCheck()');
  assert.ok(a.ok, a.text);
  assert.match(a.text, /No problems found/);
  assert.match(a.text, /Teaching Sessions: the attendance functions of Code\.gs are present/);
  assert.match(a.text, /Group Live Classroom: the Live Classroom engine of Code\.gs is present/);
  assert.ok(!/AAECAwQFBgcICQoL/.test(a.text), 'no key in the report');
  // a module with student sign-in but no key, and a broken key
  S.b.eval("STUDENT_AUTH_MODULES.cardio = true; CONTENT_KEYS.vulva = 'short'; CONTENT_KEYS.vagina = '__VAGINA_CONTENT_KEY__';");
  const b = S.b.eval('platformCheck()');
  assert.strictEqual(b.ok, false);
  assert.ok(b.errors.some(function (e) { return /"cardio".*NO entry in CONTENT_KEYS/.test(e); }), b.text);
  assert.ok(b.errors.some(function (e) { return /content key of "vulva" is not a valid key/.test(e); }), b.text);
  assert.ok(b.warnings.some(function (e) { return /"vagina" is still a placeholder/.test(e); }), b.text);
  // the Portal line lost from route_ (what happened on 2026-10-10)
  S.b.eval("route_ = function (p) { var module = p.module, action = p.action; if (!STUDENT_PUBLIC_ACTIONS[action] && studentAuthOn_(module)) { var gate = gateRequest_(module, p); if (gate) return gate; } return { ok: false, code: 'badaction' }; };");
  const c = S.b.eval('platformCheck()');
  assert.ok(c.errors.some(function (e) { return /Portal line is MISSING/.test(e); }), c.text);
  // the speed line pasted too early in authed_ (2026-10-10)
  S.b.eval("authed_ = function (module, p, fn) { var token = p.token; var tcache = CacheService.getScriptCache(), tkey = 'tok:' + module + ':' + token; tcache.put(tkey, '1', Math.floor((Number(found.expiresAt) - Date.now()) / 1000)); if (tcache.get(tkey)) return fn(token); var rows = readAll_(SHEETS.SESSIONS); var found = null; for (var i = 0; i < rows.length; i++) if (rows[i].token === token) { found = rows[i]; break; } return fn(token); };");
  const d = S.b.eval('platformCheck()');
  assert.ok(d.errors.some(function (e) { return /tcache\.put.*WRONG place/.test(e); }), d.text);
});
test('platformCheck: a module link that opens another module\'s page, or two modules with the same link, is reported', function () {
  const S = examsSetup();
  S.b.ctx.CONTENT_KEYS.vagina = Buffer.alloc(32, 3).toString('base64');
  const pages = { 'cell-injury-teaching-platform': 'cellinjury', 'inflammation-healing': 'inflhealing', 'introduction-to-pathology': 'intropath' };
  let fetched = 0;
  S.b.ctx.UrlFetchApp = { fetch: function (url) {
    fetched++;
    const repo = String(url).replace(/^https:\/\/[^/]+\//, '').split('/')[0], key = pages[repo];
    return { getResponseCode: function () { return key ? 200 : 404; }, getContentText: function () { return key ? '<script>window.NEO_CONFIG = {"backendUrl":"x","moduleKey":"' + key + '","storagePrefix":"x_"};</script>' : 'Not found'; } };
  } };
  const D = S.dir('dirGet');
  // every directory module must point at its own page for a clean report
  D.modules.filter(function (m) { return m.moduleId !== 'exams' && !pages[(m.url || '').replace(/^https:\/\/[^/]+\//, '').split('/')[0]]; })
    .forEach(function (m) { assert.ok(S.dir('dirSetActive', { kind: 'module', id: m.moduleId, active: false }).ok); });
  const a = S.b.eval('platformCheck()');
  assert.ok(!a.errors.some(function (e) { return /link/i.test(e); }), a.text);
  assert.match(a.text, /Links: no module shares a page with another; \d+ link\(s\) checked against their pages/);
  assert.ok(fetched >= 2);
  // the 2026-10-10 mistake: the Introduction card linked to the Cell Injury page
  assert.ok(S.dir('dirSave', { kind: 'module', record: { moduleId: 'intropath', title: 'Introduction to Pathology', url: 'https://third-year-med.github.io/cell-injury-teaching-platform/', storagePrefix: 'ip_' } }).ok);
  const b = S.b.eval('platformCheck()');
  assert.ok(b.errors.some(function (e) { return /SAME link/.test(e) && /intropath/.test(e) && /cellinjury/.test(e); }), b.text);
  assert.ok(b.errors.some(function (e) { return /opens the page of ANOTHER module \(cellinjury\)/.test(e); }), b.text);
  assert.ok(b.warnings.some(function (e) { return /"intropath" has different links/.test(e); }), b.text);
  // a link that does not open
  assert.ok(S.dir('dirSave', { kind: 'module', record: { moduleId: 'intropath', title: 'Introduction to Pathology', url: 'https://third-year-med.github.io/intro-typo/', storagePrefix: 'ip_' } }).ok);
  const c = S.b.eval('platformCheck()');
  assert.ok(c.errors.some(function (e) { return /does not open \(HTTP 404\)/.test(e); }), c.text);
});

/* ---------------- Teaching Sessions (2.7, step 1) ---------------- */
function tsSetup() {
  const S = teachersSetup(), D = S.dl;
  // Al-Razi Group A: ahmed (imported) + b1, b2 — every member has an account in both modules of the group
  assert.ok(S.dir('rosterAdd', { groupId: S.ra.groupId, students: [{ studentId: 'b1', name: 'Basma One', email: 'basma@uni.ly', password: 'basma-pass-1' }, { studentId: 'b2', name: 'Bilal Two', password: 'bilal-pass-1' }], mustChange: false }).ok);
  S.ci = D['cellinjury-razi-a-26']; S.ih = D['inflhealing-razi-a-26'];
  S.ts = function (action, o) { return S.dir(action, o); };
  S.tt = function (action, tok, o) { return S.t(action, tok, o); };
  S.lect = function (o) { return Object.assign({ groupId: S.ra.groupId, deliveryId: S.ci.deliveryId, title: 'Lecture 1 — Cell injury', chapter: 'Chapter 1', startAt: Date.now() + 3600e3, durationMin: 90, lateAfterMin: 15 }, o || {}); };
  return S;
}
function stuOf(st, id) { return st.students.filter(function (x) { return x.studentId === id; })[0]; }

test('teaching sessions: Admin sees every group; a teacher only the modules assigned to them; Official Exams are not teaching', function () {
  const S = tsSetup();
  const a = S.ts('tsGroups'); assert.ok(a.ok, JSON.stringify(a));
  assert.strictEqual(a.groups.length, 2); assert.strictEqual(a.settings.threshold, 75); assert.ok(a.settings.timeZone);
  const t = S.tt('tsGroups', S.ahmed.tok); assert.ok(t.ok);
  assert.deepStrictEqual(t.groups.map(function (g) { return g.groupId; }), [S.ra.groupId]);
  assert.deepStrictEqual(t.groups[0].modules.map(function (m) { return m.storage; }).sort(), ['cellinjury-razi-a-26', 'inflhealing-razi-a-26']);
  // Dr. Sara has no module of Al-Razi A: cannot list or schedule there
  assert.strictEqual(S.tt('tsList', S.sara.tok, { groupId: S.ra.groupId }).code, 'forbidden');
  assert.strictEqual(S.tt('tsSave', S.sara.tok, { session: S.lect() }).code, 'forbidden');
  // nobody signed in / a student session: refused
  assert.strictEqual(S.call({ module: 'portal', action: 'tsGroups' }).ok, false);
  assert.strictEqual(S.call({ module: 'portal', action: 'tsGroups', ttoken: 'x'.repeat(40) }).code, 'auth');
  // only the Admin changes the settings
  assert.strictEqual(S.tt('tsSettings', S.ahmed.tok, { threshold: 50 }).code, 'forbidden');
  const st = S.ts('tsSettings', { timeZone: 'Asia/Aden', threshold: 80 }); assert.ok(st.ok, JSON.stringify(st));
  assert.deepStrictEqual(st.settings, { timeZone: 'Asia/Aden', threshold: 80, hideModuleLive: true });
  assert.strictEqual(S.ts('tsSettings', { threshold: 0 }).ok, false);
});

test('teaching sessions: schedule, edit, cancel/restore, delete; input is checked', function () {
  const S = tsSetup();
  assert.match(S.ts('tsSave', { session: S.lect({ title: '' }) }).error, /title/);
  assert.match(S.ts('tsSave', { session: S.lect({ deliveryId: S.dl['cellinjury-misrata-a-26'].deliveryId }) }).error, /module/);
  assert.match(S.ts('tsSave', { session: S.lect({ startAt: '' }) }).error, /date/);
  assert.match(S.ts('tsSave', { session: S.lect({ materialsUrl: 'javascript:alert(1)' }) }).error, /https/);
  assert.match(S.ts('tsSave', { session: S.lect({ lateAfterMin: 500 }) }).error, /Late after/);
  const s = S.tt('tsSave', S.ahmed.tok, { session: S.lect({ materialsUrl: 'https://example.org/ch1.pdf', rotate: true }) }); assert.ok(s.ok, JSON.stringify(s));
  assert.strictEqual(s.session.status, 'scheduled'); assert.strictEqual(s.session.teacher, 'Dr. Ahmed'); assert.strictEqual(s.session.academicYear, '2026-27');
  assert.strictEqual(s.session.rotate, true); assert.strictEqual(s.session.storage, 'cellinjury-razi-a-26');
  const e = S.ts('tsSave', { session: Object.assign(S.lect({ title: 'Lecture 1 — Cell injury (room 3)', deliveryId: S.ih.deliveryId }), { tsId: s.session.tsId }) }); assert.ok(e.ok, JSON.stringify(e));
  assert.strictEqual(e.session.moduleId, 'inflhealing'); assert.strictEqual(e.session.title, 'Lecture 1 — Cell injury (room 3)');
  assert.ok(S.ts('tsCancel', { tsId: s.session.tsId }).ok);
  let l = S.ts('tsList', { groupId: S.ra.groupId }); assert.strictEqual(l.sessions[0].status, 'cancelled');
  assert.match(S.ts('tsStart', { tsId: s.session.tsId }).error, /cancelled/);
  assert.ok(S.ts('tsCancel', { tsId: s.session.tsId, undo: true }).ok);
  assert.ok(S.ts('tsDelete', { tsId: s.session.tsId }).ok);
  l = S.ts('tsList', { groupId: S.ra.groupId }); assert.strictEqual(l.sessions.length, 0);
  // nothing was written to attendance by scheduling
  assert.strictEqual(S.b.ctx.rpRows_('AttendanceSessions').length, 0);
});

test('teaching sessions: start opens the module\'s own attendance; students check in; present / late / absent / excused; close', function () {
  const S = tsSetup(), X = S.b.ctx, st = 'cellinjury-razi-a-26';
  // the lecture started 30 min ago, late after 15 min
  const s = S.ts('tsSave', { session: S.lect({ startAt: Date.now() - 30 * 60e3 }) }).session;
  const live = S.tt('tsStart', S.ahmed.tok, { tsId: s.tsId }); assert.ok(live.ok, JSON.stringify(live));
  assert.strictEqual(live.session.status, 'live'); assert.match(live.code, /^[A-Z0-9]{6}$/);
  // the attendance session is a normal Code.gs session of the delivery's storage (module page + reports see it)
  const att = X.rpRows_('AttendanceSessions'); assert.strictEqual(att.length, 1);
  assert.strictEqual(att[0].module, st); assert.strictEqual(att[0].sessionTitle, 'Lecture 1 — Cell injury'); assert.strictEqual(att[0].status, 'active');
  assert.strictEqual(att[0].course, 'Cell Injury & Cell Death'); assert.strictEqual(att[0].academicYear, '2026-27');
  // attendance was opened at the start (lateness counts from the later of the scheduled start and the opening)
  const tr = X.dirAll_('TeachingSessions')[0];
  X.updateRow_('TeachingSessions', tr._row, Object.assign(X.dirPublic_(tr), { startedAt: Date.now() - 30 * 60e3 }));
  // only one live lecture per group
  const s2 = S.ts('tsSave', { session: S.lect({ deliveryId: S.ih.deliveryId, title: 'Lecture 2' }) }).session;
  assert.strictEqual(S.ts('tsStart', { tsId: s2.tsId }).code, 'busy');
  // ahmed checks in on the module page with the code (signed in) → late (more than 15 min after the start)
  const ses = login(S, st, 'ahmed', PW); assert.ok(ses.ok);
  const ci = S.call({ module: st, action: 'submitAttendanceByCode', stoken: ses.token, code: live.code.toLowerCase() }); assert.ok(ci.ok, JSON.stringify(ci));
  // b1 checks in "on time" (record time moved to the start)
  const ses2 = login(S, st, 'b1', 'basma-pass-1'); assert.ok(S.call({ module: st, action: 'submitAttendanceByCode', stoken: ses2.token, code: live.code }).ok);
  const rec = X.rpRows_('AttendanceRecords').filter(function (r) { return r.studentId === 'b1'; })[0];
  X.updateRow_('AttendanceRecords', rec._row, Object.assign({}, rec, { scannedAt: Date.now() - 29 * 60e3 }));
  let v = S.ts('tsState', { tsId: s.tsId }); assert.ok(v.ok);
  assert.strictEqual(stuOf(v, 'ahmed').status, 'late'); assert.strictEqual(stuOf(v, 'b1').status, 'present'); assert.strictEqual(stuOf(v, 'b2').status, 'waiting');
  assert.deepStrictEqual(v.session.counts, { present: 1, late: 1, excused: 0, absent: 0, waiting: 1 });
  // the teacher: ahmed was late because of the teacher → present; b2 excused
  v = S.ts('tsMark', { tsId: s.tsId, studentId: 'ahmed', mark: 'present' }); assert.strictEqual(stuOf(v, 'ahmed').status, 'present');
  v = S.ts('tsMark', { tsId: s.tsId, studentId: 'b2', mark: 'excused' }); assert.strictEqual(stuOf(v, 'b2').status, 'excused');
  v = S.ts('tsMark', { tsId: s.tsId, studentId: 'b2', mark: 'clear' }); assert.strictEqual(stuOf(v, 'b2').status, 'waiting');
  assert.strictEqual(S.ts('tsMark', { tsId: s.tsId, studentId: 'nobody', mark: 'present' }).ok, false);
  // close → b2 absent; the Code.gs session is closed (Drive copy made by Code.gs)
  const c = S.tt('tsClose', S.ahmed.tok, { tsId: s.tsId }); assert.ok(c.ok, JSON.stringify(c));
  assert.strictEqual(c.session.status, 'ended'); assert.strictEqual(stuOf(c, 'b2').status, 'absent');
  assert.strictEqual(X.rpRows_('AttendanceSessions')[0].status, 'closed');
  assert.strictEqual(S.call({ module: st, action: 'submitAttendanceByCode', stoken: login(S, st, 'b2', 'bilal-pass-1').token, code: live.code }).code, 'badcode');
  // after the lecture: b2 forgot the phone → marked present (a real check-in is added, so the module + reports agree)
  v = S.ts('tsMark', { tsId: s.tsId, studentId: 'b2', mark: 'present' }); assert.strictEqual(stuOf(v, 'b2').status, 'present');
  assert.strictEqual(X.rpRows_('AttendanceRecords').length, 3);
  // removing a check-in (e.g. checked in from outside the room)
  v = S.ts('tsMark', { tsId: s.tsId, studentId: 'b2', mark: 'remove', recordId: stuOf(v, 'b2').recordId }); assert.strictEqual(stuOf(v, 'b2').status, 'absent');
  // Results & attendance (Step 10) sees the same attendance
  const rep = S.dir('reportDelivery', { deliveryId: S.ci.deliveryId }); assert.strictEqual(rep.sessions.length, 1); assert.strictEqual(rep.sessions[0].present, 2);
  // a started lecture cannot be deleted or cancelled
  assert.strictEqual(S.ts('tsDelete', { tsId: s.tsId }).ok, false); assert.strictEqual(S.ts('tsCancel', { tsId: s.tsId }).ok, false);
});

test('teaching sessions: a rotating code changes every 45 s (the old code stops working); a fixed code does not', function () {
  const S = tsSetup(), X = S.b.ctx, st = 'cellinjury-razi-a-26';
  const s = S.ts('tsSave', { session: S.lect({ rotate: true, startAt: Date.now() }) }).session;
  const a = S.ts('tsStart', { tsId: s.tsId }); assert.ok(a.ok); assert.ok(a.rotateInMs > 0 && a.rotateInMs <= 45000);
  assert.strictEqual(S.ts('tsState', { tsId: s.tsId }).code, a.code);   // not yet due
  const row = X.dirAll_('TeachingSessions')[0];
  X.updateRow_('TeachingSessions', row._row, Object.assign(X.dirPublic_(row), { codeAt: Date.now() - 46000 }));
  const b = S.ts('tsState', { tsId: s.tsId }); assert.notStrictEqual(b.code, a.code);
  const ses = login(S, st, 'ahmed', PW);
  assert.strictEqual(S.call({ module: st, action: 'submitAttendanceByCode', stoken: ses.token, code: a.code }).code, 'badcode');
  assert.ok(S.call({ module: st, action: 'submitAttendanceByCode', stoken: ses.token, code: b.code }).ok);
  // fixed code
  S.ts('tsClose', { tsId: s.tsId });
  const f = S.ts('tsStart', { session: S.lect({ title: 'Lecture 2', rotate: false }) }); assert.ok(f.ok, JSON.stringify(f));
  assert.strictEqual(f.rotateInMs, 0);
  const r2 = X.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === f.session.tsId; })[0];
  X.updateRow_('TeachingSessions', r2._row, Object.assign(X.dirPublic_(r2), { codeAt: Date.now() - 600000 }));
  assert.strictEqual(S.ts('tsState', { tsId: f.session.tsId }).code, f.code);
});

test('teaching sessions: student attendance % over ended lectures — excused and cancelled do not count; warning below the threshold', function () {
  const S = tsSetup();
  const run = function (title, marks) {
    const s = S.ts('tsStart', { session: S.lect({ title: title, startAt: Date.now() }) }); assert.ok(s.ok, JSON.stringify(s));
    Object.keys(marks).forEach(function (id) { assert.ok(S.ts('tsMark', { tsId: s.session.tsId, studentId: id, mark: marks[id] }).ok); });
    assert.ok(S.ts('tsClose', { tsId: s.session.tsId }).ok);
  };
  run('L1', { ahmed: 'present', b1: 'present' });
  run('L2', { ahmed: 'late', b1: 'excused' });
  run('L3', { ahmed: 'present' });
  run('L4', {});
  const c = S.ts('tsSave', { session: S.lect({ title: 'L5 (cancelled)' }) }).session; S.ts('tsCancel', { tsId: c.tsId });
  S.ts('tsSave', { session: S.lect({ title: 'L6 (upcoming)' }) });
  const l = S.ts('tsList', { groupId: S.ra.groupId }); assert.ok(l.ok);
  assert.strictEqual(l.sessions.length, 6);
  const by = {}; l.students.forEach(function (x) { by[x.studentId] = x; });
  assert.deepStrictEqual([by.ahmed.attended, by.ahmed.late, by.ahmed.counted, by.ahmed.pct, by.ahmed.warn], [3, 1, 4, 75, false]);
  assert.deepStrictEqual([by.b1.attended, by.b1.excused, by.b1.counted, by.b1.pct, by.b1.warn], [1, 1, 3, 33, true]);
  assert.deepStrictEqual([by.b2.attended, by.b2.absent, by.b2.pct, by.b2.warn], [0, 4, 0, true]);
  // a teacher with only one of the group's modules sees only that module's lectures
  assert.ok(S.dir('teacherAssign', { userId: S.sara.teacher.userId, deliveryIds: [S.dl['cellinjury-misrata-a-26'].deliveryId, S.ih.deliveryId] }).ok);
  assert.strictEqual(S.tt('tsList', S.sara.tok, { groupId: S.ra.groupId }).sessions.length, 0);
});

test('teaching sessions: a lecture closed inside the module page counts as ended', function () {
  const S = tsSetup(), X = S.b.ctx;
  const s = S.ts('tsStart', { session: S.lect({ startAt: Date.now() }) }); assert.ok(s.ok);
  const att = X.rpRows_('AttendanceSessions')[0];
  const tok = S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' }).token;
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'closeAttendanceSession', token: tok, sessionId: att.sessionId }).ok);
  const l = S.ts('tsList', { groupId: S.ra.groupId }); assert.strictEqual(l.sessions[0].status, 'ended');
  // a new lecture can start
  assert.ok(S.ts('tsStart', { session: S.lect({ title: 'Lecture 2', startAt: Date.now() }) }).ok);
});

test('teaching sessions: attendance opened late — students checking in at once are not late', function () {
  const S = tsSetup(), st = 'cellinjury-razi-a-26';
  const s = S.ts('tsSave', { session: S.lect({ startAt: Date.now() - 40 * 60e3 }) }).session;
  const live = S.ts('tsStart', { tsId: s.tsId }); assert.ok(live.ok);
  assert.ok(S.call({ module: st, action: 'submitAttendanceByCode', stoken: login(S, st, 'ahmed', PW).token, code: live.code }).ok);
  assert.strictEqual(stuOf(S.ts('tsState', { tsId: s.tsId }), 'ahmed').status, 'present');
  assert.strictEqual(S.ts('tsState', { tsId: s.tsId }).session.startAt, s.startAt, 'scheduled time kept');
  // a lecture scheduled for next week but given today takes today's time
  S.ts('tsClose', { tsId: s.tsId });
  const n = S.ts('tsSave', { session: S.lect({ title: 'Moved lecture', startAt: Date.now() + 7 * 864e5 }) }).session;
  const t0 = Date.now(), m = S.ts('tsStart', { tsId: n.tsId }); assert.ok(m.ok);
  assert.ok(m.session.startAt >= t0 && m.session.startAt <= Date.now());
});

/* ---------------- Teaching Sessions on the group page (2.8, step 2) ---------------- */
function grpSessions(S, id, pw) {
  const r = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: id, password: pw }); assert.ok(r.ok, JSON.stringify(r));
  const o = {}; Object.keys(r.modules).forEach(function (k) { if (r.modules[k].access) o[k] = r.modules[k].token; }); return o;
}
test('group page lectures: only a signed-in member of THIS group; own attendance only; live, upcoming, cancelled', function () {
  const S = tsSetup();
  S.ts('tsSave', { session: S.lect({ title: 'Next week', startAt: Date.now() + 7 * 864e5, materialsUrl: 'https://example.org/n.pdf' }) });
  const c = S.ts('tsSave', { session: S.lect({ title: 'Cancelled one', startAt: Date.now() + 864e5 }) }).session; S.ts('tsCancel', { tsId: c.tsId });
  const L = S.ts('tsStart', { session: S.lect({ title: 'Now', startAt: Date.now() }) }); assert.ok(L.ok);
  const ses = grpSessions(S, 'b1', 'basma-pass-1');
  const r = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: ses }); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.live.length, 1); assert.strictEqual(r.live[0].title, 'Now'); assert.strictEqual(r.live[0].me, 'waiting'); assert.strictEqual(r.live[0].registered, true);
  assert.deepStrictEqual(r.upcoming.map(function (x) { return [x.title, !!x.cancelled]; }), [['Cancelled one', true], ['Next week', false]]);
  assert.strictEqual(r.upcoming[1].materialsUrl, 'https://example.org/n.pdf');
  const txt = JSON.stringify(r);
  assert.ok(!/ahmed|Bilal|"code"|attSessionId|marksJson|prevCode/.test(txt), 'no other student, no code, no internals: ' + txt);
  // no session / a forged token / the other group's link: refused
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: {} }).code, 'studentauth');
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: { cellinjury: 'x'.repeat(64) } }).code, 'studentauth');
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupSessions', g: 'misrata-a-26', sessions: ses }).code, 'studentauth');
  // a deactivated membership: refused at once
  assert.ok(S.dir('rosterSetActive', { groupId: S.ra.groupId, studentId: 'b1', active: false }).ok);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: ses }).code, 'studentauth');
});

test('attendance stays open with the SAME code until the teacher closes it: time, polling and other events never close it; students cannot close it, change the code or reopen it', function () {
  const S = tsSetup(), X = S.b.ctx, st = 'cellinjury-razi-a-26';
  const L = S.ts('tsStart', { session: S.lect({ title: 'Long lecture', startAt: Date.now(), durationMin: 60, rotate: false }) }); assert.ok(L.ok, JSON.stringify(L));
  const tsId = L.session.tsId, code = L.code;
  // hours later (far past the lecture's 60 min) and after many teacher / student / presentation checks: still open, same code
  const row = X.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === tsId; })[0];
  X.updateRow_('TeachingSessions', row._row, Object.assign(X.dirPublic_(row), { startAt: Date.now() - 6 * 3600e3, startedAt: Date.now() - 6 * 3600e3, codeAt: Date.now() - 6 * 3600e3 }));
  const att = X.rpRows_('AttendanceSessions').filter(function (a) { return a.sessionId === row.attSessionId; })[0];
  X.updateRow_('AttendanceSessions', att._row, Object.assign({}, att, { createdAt: Date.now() - 6 * 3600e3 }));
  const mt = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.ci.deliveryId }); assert.ok(mt.ok, JSON.stringify(mt));   // the module page (Presentation Mode) as teacher
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(S.ts('tsState', { tsId: tsId }).code, code);
    const ls = S.call({ module: st, action: 'listAttendanceSessions', token: mt.token }); assert.ok(ls.ok, JSON.stringify(ls));
    const a = ls.sessions.filter(function (x) { return x.status === 'active'; }); assert.strictEqual(a.length, 1); assert.strictEqual(a[0].code, code);
    S.ts('tsList', { groupId: S.ra.groupId });
  }
  assert.strictEqual(S.ts('tsState', { tsId: tsId }).session.status, 'live');
  // a student, with every token they can have, cannot close it, regenerate the code, start another session or read the teacher list
  const stu = login(S, st, 'b1', 'basma-pass-1'); assert.ok(stu.ok);
  [{ stoken: stu.token }, { token: stu.token }, {}].forEach(function (auth) {
    ['closeAttendanceSession', 'regenerateAttendanceCode', 'getAttendanceTeacherState', 'listAttendanceSessions'].forEach(function (action) {
      const r = S.call(Object.assign({ module: st, action: action, sessionId: row.attSessionId }, auth));
      assert.strictEqual(r.ok, false, action + ' ' + JSON.stringify(auth)); assert.match(String(r.code), /^(auth|studentauth)$/, action);
    });
    assert.strictEqual(S.call(Object.assign({ module: st, action: 'startAttendanceSession', sessionTitle: 'x' }, auth)).ok, false);
    ['tsClose', 'tsStart', 'tsCancel', 'tsMark', 'tsDelete'].forEach(function (action) {
      const r = S.call(Object.assign({ module: 'portal', action: action, tsId: tsId, ttoken: auth.stoken || auth.token || '' }, auth));
      assert.strictEqual(r.ok, false, action + ' ' + JSON.stringify(auth));
    });
  });
  const ses = grpSessions(S, 'b1', 'basma-pass-1');
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: ses, code: code }).ok, 'checking in does not change anything either');
  assert.strictEqual(S.ts('tsState', { tsId: tsId }).code, code);
  assert.strictEqual(X.rpRows_('AttendanceSessions').filter(function (a) { return a.sessionId === row.attSessionId; })[0].status, 'active');
  // only the teacher closes it
  const c = S.ts('tsClose', { tsId: tsId }); assert.ok(c.ok, JSON.stringify(c)); assert.strictEqual(c.session.status, 'ended');
  const after = S.call({ module: st, action: 'listAttendanceSessions', token: mt.token });
  assert.strictEqual(after.sessions.filter(function (x) { return x.status === 'active'; }).length, 0);
  assert.strictEqual(stuOf(c, 'b1').status, 'late', 'the record is kept (checked in 6 h after the start → late)');
});

test('deleting an ENDED lecture (2.11): Admin only, typed confirmation, never while attendance is open; its attendance session and check-ins go with it, other lectures untouched', function () {
  const S = tsSetup(), X = S.b.ctx, st = 'cellinjury-razi-a-26';
  const keep = S.ts('tsStart', { session: S.lect({ title: 'Keep me', startAt: Date.now() }) }); assert.ok(keep.ok, JSON.stringify(keep));
  const ses = grpSessions(S, 'b1', 'basma-pass-1'), ci = function (code) { return S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: ses, code: code }); };
  assert.ok(ci(keep.code).ok); S.ts('tsClose', { tsId: keep.session.tsId });
  const L = S.ts('tsStart', { session: S.lect({ title: 'Test lecture', startAt: Date.now() }) }); assert.ok(L.ok, JSON.stringify(L));
  assert.ok(ci(L.code).ok);
  const attId = X.dirAll_('TeachingSessions').filter(function (r) { return r.tsId === L.session.tsId; })[0].attSessionId;
  const recs = function (id) { return X.rpRows_('AttendanceRecords').filter(function (q) { return q.sessionId === id; }).length; };
  assert.strictEqual(recs(attId), 1);
  // still live → refused, even for the Admin
  let r = S.ts('tsDelete', { tsId: L.session.tsId, confirm: 'DELETE' }); assert.strictEqual(r.ok, false); assert.match(r.error, /still open/);
  S.ts('tsClose', { tsId: L.session.tsId });
  // a personal teacher of that module cannot; the Admin must type DELETE
  r = S.tt('tsDelete', S.ahmed.tok, { tsId: L.session.tsId, confirm: 'DELETE' }); assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'forbidden');
  r = S.ts('tsDelete', { tsId: L.session.tsId }); assert.strictEqual(r.code, 'confirm');
  r = S.ts('tsDelete', { tsId: L.session.tsId, confirm: 'delete' }); assert.strictEqual(r.code, 'confirm');
  // a student with any of their tokens cannot
  assert.strictEqual(S.call({ module: 'portal', action: 'tsDelete', tsId: L.session.tsId, confirm: 'DELETE', token: ses[Object.keys(ses)[0]] }).ok, false);
  assert.strictEqual(S.call({ module: st, action: 'deleteAttendanceSession', sessionId: attId, stoken: login(S, st, 'b1', 'basma-pass-1').token }).ok, false);
  assert.strictEqual(recs(attId), 1, 'nothing deleted so far');
  // the Admin, confirmed → lecture, attendance session and its check-ins are gone
  r = S.ts('tsDelete', { tsId: L.session.tsId, confirm: 'DELETE' }); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.deletedRecords, 1);
  assert.strictEqual(X.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === L.session.tsId; }).length, 0);
  assert.strictEqual(X.rpRows_('AttendanceSessions').filter(function (a) { return a.sessionId === attId; }).length, 0);
  assert.strictEqual(recs(attId), 0);
  // the other lecture and its check-in are untouched; the history and the student's own view no longer count the deleted one
  const list = S.ts('tsList', { groupId: S.ra.groupId });
  assert.deepStrictEqual(list.sessions.map(function (x) { return x.title; }), ['Keep me']);
  const keepAtt = X.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === keep.session.tsId; })[0].attSessionId;
  assert.strictEqual(recs(keepAtt), 1);
  const mine = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: ses });
  assert.ok(mine.ok, JSON.stringify(mine));
  assert.ok(!JSON.stringify(mine).includes('Test lecture'));
  // deleting again → not found; scheduled/cancelled lectures are still deleted as before (no confirmation needed)
  assert.strictEqual(S.ts('tsDelete', { tsId: L.session.tsId, confirm: 'DELETE' }).ok, false);
  const sc = S.ts('tsSave', { session: S.lect({ title: 'Planned' }) }).session;
  assert.ok(S.tt('tsDelete', S.ahmed.tok, { tsId: sc.tsId }).ok);
});

test('Presentation Mode codes (2.12): the module main page opened by the Admin sees the live lecture of every group; a group page only its own; students and other tokens nothing; read-only', function () {
  const S = tsSetup(), X = S.b.ctx;
  const L = S.ts('tsStart', { session: S.lect({ title: 'Live A', startAt: Date.now(), rotate: true }) }); assert.ok(L.ok, JSON.stringify(L));
  const pc = function (storage, token) { return S.call({ module: 'portal', action: 'tsPresentCodes', storage: storage, token: token }); };
  // the Admin opens Cell Injury without a group (main storage) → every group's live lecture of that module
  const adm = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['cellinjury'] }).modules.cellinjury;
  let r = pc('cellinjury', adm.token); assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.live.map(function (x) { return [x.code, x.title]; }), [[L.code, 'Live A']]); assert.match(r.live[0].group, /Group A/);
  // the group's own page (personal teacher of that delivery) → its lecture
  const mt = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.ci.deliveryId }); assert.ok(mt.ok, JSON.stringify(mt));
  r = pc('cellinjury-razi-a-26', mt.token); assert.deepStrictEqual(r.live.map(function (x) { return x.code; }), [L.code]);
  // the same token cannot read another storage (another group / the main page / another module), nor can students or nobody
  assert.strictEqual(pc('cellinjury', mt.token).code, 'auth');
  assert.strictEqual(pc('inflhealing-razi-a-26', mt.token).code, 'auth');
  const stu = login(S, 'cellinjury-razi-a-26', 'b1', 'basma-pass-1');
  assert.strictEqual(pc('cellinjury-razi-a-26', stu.token).ok, false);
  assert.strictEqual(S.call({ module: 'portal', action: 'tsPresentCodes', storage: 'cellinjury-razi-a-26', stoken: stu.token }).ok, false);
  assert.strictEqual(pc('cellinjury-razi-a-26', '').ok, false);
  assert.strictEqual(pc('portal', S.admin).ok, false, 'never with the dashboard session itself');
  // inflammation's main page sees nothing of Cell Injury
  const admI = S.call({ module: 'portal', action: 'portalTeacherOpen', token: S.admin, modules: ['inflhealing'] }).modules.inflhealing;
  assert.deepStrictEqual(pc('inflhealing', admI.token).live, []);
  // read-only: even when the rotating code is due, asking never renews it
  const row = X.dirAll_('TeachingSessions').filter(function (x) { return x.tsId === L.session.tsId; })[0];
  X.updateRow_('TeachingSessions', row._row, Object.assign(X.dirPublic_(row), { codeAt: Date.now() - 600000 }));
  for (let i = 0; i < 3; i++) assert.strictEqual(pc('cellinjury', adm.token).live[0].code, L.code);
  // closed by the teacher → gone
  assert.ok(S.ts('tsClose', { tsId: L.session.tsId }).ok);
  assert.deepStrictEqual(pc('cellinjury', adm.token).live, []);
});

test('group page check-in: right code → present (or late); twice → already; wrong codes limited; the rotated code works 20 s more', function () {
  const S = tsSetup(), X = S.b.ctx;
  const L = S.ts('tsStart', { session: S.lect({ title: 'Now', startAt: Date.now(), rotate: true }) }); assert.ok(L.ok);
  const ses = grpSessions(S, 'b1', 'basma-pass-1'), ci = function (code, se) { return S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: se || ses, code: code }); };
  assert.strictEqual(ci('ZZZZZZ').code, 'badcode');
  let r = ci(' ' + L.code.toLowerCase().slice(0, 3) + '-' + L.code.slice(3) + ' '); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.status, 'present'); assert.strictEqual(r.alreadyRecorded, false); assert.strictEqual(r.title, 'Now');
  assert.strictEqual(ci(L.code).alreadyRecorded, true);
  // the teacher sees b1, recorded as the module's own attendance (acct:b1 — a check-in inside the module would not count twice)
  const st = S.ts('tsState', { tsId: L.session.tsId }); assert.strictEqual(stuOf(st, 'b1').status, 'present');
  assert.strictEqual(X.rpRows_('AttendanceRecords').filter(function (q) { return q.participantId === 'acct:b1'; }).length, 1);
  const mod = S.call({ module: 'cellinjury-razi-a-26', action: 'submitAttendanceByCode', stoken: login(S, 'cellinjury-razi-a-26', 'b1', 'basma-pass-1').token, code: L.code });
  assert.ok(mod.ok && mod.alreadyRecorded, JSON.stringify(mod));
  // rotation: the old code still works for 20 s on the group page, then not
  const row = X.dirAll_('TeachingSessions')[0];
  X.updateRow_('TeachingSessions', row._row, Object.assign(X.dirPublic_(row), { codeAt: Date.now() - 46000 }));
  const nc = S.ts('tsState', { tsId: L.session.tsId }).code; assert.notStrictEqual(nc, L.code);
  const s2 = grpSessions(S, 'ahmed', PW);
  r = ci(L.code, s2); assert.ok(r.ok, 'grace: ' + JSON.stringify(r));
  const r2 = X.dirAll_('TeachingSessions')[0];
  X.updateRow_('TeachingSessions', r2._row, Object.assign(X.dirPublic_(r2), { prevCodeUntil: Date.now() - 1 }));
  const s3 = grpSessions(S, 'b2', 'bilal-pass-1');
  assert.strictEqual(ci(L.code, s3).code, 'badcode');
  assert.ok(ci(nc, s3).ok);
  // 10 wrong codes → wait
  const s4 = grpSessions(S, 'ahmed', PW);
  for (let i = 0; i < 10; i++) ci('WRONG' + i, s4);
  assert.strictEqual(ci(nc, s4).code, 'locked');
  // after closing: the code no longer works; the student sees their status and %
  S.ts('tsClose', { tsId: L.session.tsId });
  assert.strictEqual(ci(nc, grpSessions(S, 'b2', 'bilal-pass-1')).code, 'badcode');
  const me = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: ses });
  assert.strictEqual(me.live.length, 0); assert.strictEqual(me.recent[0].me, 'present');
  assert.deepStrictEqual([me.mine.attended, me.mine.counted, me.mine.pct, me.mine.warn], [1, 1, 100, false]);
});

test('group page check-in: late after the limit; a student without an account in that module is told so', function () {
  const S = tsSetup(), X = S.b.ctx;
  const L = S.ts('tsStart', { session: S.lect({ title: 'Now', startAt: Date.now() }) }); assert.ok(L.ok);
  const row = X.dirAll_('TeachingSessions')[0];
  X.updateRow_('TeachingSessions', row._row, Object.assign(X.dirPublic_(row), { startAt: Date.now() - 20 * 60e3, startedAt: Date.now() - 20 * 60e3 }));
  const ses = grpSessions(S, 'b1', 'basma-pass-1');
  const r = S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: ses, code: L.code }); assert.strictEqual(r.status, 'late');
  // b2's Cell Injury account deactivated by the module teacher → cannot check in there
  const tok = S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' }).token;
  const s2 = grpSessions(S, 'b2', 'bilal-pass-1');
  assert.ok(S.call({ module: 'cellinjury-razi-a-26', action: 'setStudentActive', token: tok, username: 'b2', active: false }).ok);
  const x = S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: s2, code: L.code });
  assert.strictEqual(x.code, 'notregistered', JSON.stringify(x));
});

/* ---------------- Group Live Classroom (2.9, step 3) ---------------- */
function liveSetup() {
  const S = tsSetup();
  S.lopen = function (id, pw) { const gs = grpSessions(S, id, pw); const r = S.call({ module: 'portal', action: 'liveOpen', g: 'razi-a-26', sessions: gs }); assert.ok(r.ok, JSON.stringify(r)); r.gs = gs; return r; };
  S.lcall = function (who, action, o) { return S.call(Object.assign({ module: who.storage, action: action }, who.token ? { token: who.token } : { participantId: who.participantId, gs: who.gs }, o || {})); };
  return S;
}
test('group classroom: students of the group and its teachers meet in ONE classroom; messages, reply, react, pin, announcement', function () {
  const S = liveSetup();
  const b1 = S.lopen('b1', 'basma-pass-1'), ah = S.lopen('ahmed', PW);
  assert.strictEqual(b1.storage, 'live-razi-a-26'); assert.strictEqual(b1.name, 'Basma One'); assert.strictEqual(b1.role, 'student');
  assert.notStrictEqual(b1.participantId, ah.participantId);
  // the identity is not derived from anything a student can know (Student ID, email)
  assert.notStrictEqual(b1.participantId, S.b.ctx.LE_pidFor('live-razi-a-26', 'b1@student.local'));
  assert.strictEqual(S.lopen('b1', 'basma-pass-1').participantId, b1.participantId, 'same student → same identity on every device');
  // the Admin and Dr. Ahmed (a module of the group) as teachers; Dr. Sara (no module of the group) refused
  const adm = S.dir('liveTeacherOpen', { groupId: S.ra.groupId }); assert.ok(adm.ok, JSON.stringify(adm));
  const tch = S.tt('liveTeacherOpen', S.ahmed.tok, { groupId: S.ra.groupId }); assert.ok(tch.ok, JSON.stringify(tch));
  assert.strictEqual(S.tt('liveTeacherOpen', S.sara.tok, { groupId: S.ra.groupId }).code, 'forbidden');
  assert.strictEqual(tch.storage, 'live-razi-a-26');
  const m1 = S.lcall(b1, 'livePost', { body: 'Hello class', clientId: 'c1' }); assert.ok(m1.ok, JSON.stringify(m1));
  const m2 = S.lcall(tch, 'livePost', { body: 'Welcome! Read chapter 2.', kind: 'announcement', clientId: 'c2', replyToId: m1.message.id }); assert.ok(m2.ok);
  assert.strictEqual(m2.message.kind, 'announcement'); assert.strictEqual(m2.message.authorRole, 'teacher');
  assert.ok(S.lcall(ah, 'liveReact', { id: m2.message.id, reaction: '👍' }).ok);
  assert.ok(S.lcall(adm, 'livePin', { id: m2.message.id, pinned: true }).ok);
  assert.strictEqual(S.lcall(ah, 'livePin', { id: m1.message.id, pinned: true }).code, 'forbidden');
  const sy = S.lcall(ah, 'liveSync', { full: true }); assert.ok(sy.ok, JSON.stringify(sy));
  assert.deepStrictEqual(sy.messages.map(function (m) { return m.body; }), ['Hello class', 'Welcome! Read chapter 2.']);
  assert.strictEqual(sy.pinned.length, 1); assert.strictEqual(sy.messages[1].reactions['👍'], 1);
  assert.ok(sy.unread >= 1, 'the teacher\'s announcement is unread for Ahmed');
  // nothing reaches a module classroom: the module storages have no messages
  assert.ok(S.b.ctx.rpRows_('LiveChat').every(function (r) { return r.module === 'live-razi-a-26'; }));
});

test('group classroom: the platform guards it — no identity guessing, no other group, no direct join, no other actions', function () {
  const S = liveSetup(), st = 'live-razi-a-26';
  const b1 = S.lopen('b1', 'basma-pass-1'), ah = S.lopen('ahmed', PW);
  // b1's identity with Ahmed's sessions, or with no sessions: refused
  assert.strictEqual(S.call({ module: st, action: 'livePost', participantId: b1.participantId, gs: ah.gs, body: 'x' }).code, 'auth');
  assert.strictEqual(S.call({ module: st, action: 'livePost', participantId: b1.participantId, body: 'x' }).code, 'auth');
  assert.strictEqual(S.call({ module: st, action: 'liveSync', participantId: 'p_guess', gs: b1.gs }).code, 'auth');
  // joining with a classroom code, or any non-classroom action on the storage: refused
  assert.strictEqual(S.call({ module: st, action: 'liveJoin', classCode: 'CLASSROOM-2026', name: 'Intruder', email: 'x@y.zz' }).code, 'badmodule');
  ['getAllContent', 'upsert', 'studentLogin', 'startAttendanceSession', 'getLiveClassroomPassword', 'setLiveClassroomPassword', 'listStudents'].forEach(function (a) {
    assert.strictEqual(S.call({ module: st, action: a, participantId: b1.participantId, gs: b1.gs }).code, 'badmodule', a);
  });
  // a student of another group (Misrata) cannot open or use Al-Razi's classroom
  const sara = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'misrata-a-26', username: 'sara', password: PW });
  const sg = { cellinjury: sara.modules.cellinjury.token };
  assert.strictEqual(S.call({ module: 'portal', action: 'liveOpen', g: 'razi-a-26', sessions: sg }).code, 'studentauth');
  assert.strictEqual(S.call({ module: st, action: 'liveSync', participantId: b1.participantId, gs: sg }).code, 'auth');
  // a teacher session of a module is not a teacher of the classroom
  const mt = S.call({ module: 'cellinjury-razi-a-26', action: 'login', password: 'teacher-cellinjury-razi-a-26' }).token;
  assert.strictEqual(S.call({ module: st, action: 'livePost', token: mt, body: 'x' }).code, 'auth');
  // module id "live" is reserved
  assert.match(S.save('module', { moduleId: 'live', title: 'Live' }, { create: true }).error, /reserved/);
  // removing Dr. Ahmed's assignments ends his classroom session at once
  const tch = S.tt('liveTeacherOpen', S.ahmed.tok, { groupId: S.ra.groupId });
  assert.ok(S.lcall(tch, 'liveSync', { full: true }).ok);
  assert.ok(S.dir('teacherAssign', { userId: S.ahmed.teacher.userId, deliveryIds: [] }).ok);
  assert.strictEqual(S.lcall(tch, 'liveSync', { full: true }).code, 'auth');
});

test('group classroom: no "lecture started / ended" announcements; the live lecture is shown on opening', function () {
  const S = liveSetup();
  const L = S.ts('tsStart', { session: S.lect({ title: 'Lecture 4 — Necrosis', chapter: 'Chapter 2', startAt: Date.now(), teacher: 'Dr. W' }) }); assert.ok(L.ok);
  const b1 = S.lopen('b1', 'basma-pass-1');
  assert.deepStrictEqual([b1.lecture.title, b1.lecture.module], ['Lecture 4 — Necrosis', 'Cell Injury & Cell Death']);
  S.ts('tsClose', { tsId: L.session.tsId });
  const sy = S.lcall(b1, 'liveSync', { full: true });
  assert.deepStrictEqual(sy.messages.map(function (m) { return m.kind + ': ' + m.body; }), [], 'no "Lecture started" / "Lecture ended" announcements (2.14)');
  assert.strictEqual(S.lopen('b1', 'basma-pass-1').lecture, null);
});

test('group classroom: files — a student uploads, the class downloads; others cannot read a file that was never posted', function () {
  const S = liveSetup();
  const b1 = S.lopen('b1', 'basma-pass-1'), ah = S.lopen('ahmed', PW);
  const data = Buffer.from('Slide notes for lecture 4 — ' + 'x'.repeat(300));
  const up = S.lcall(b1, 'liveUploadInit', { name: 'notes.txt', size: data.length, mime: 'text/plain' }); assert.ok(up.ok, JSON.stringify(up));
  // before posting: Ahmed cannot read it
  const ch = S.lcall(b1, 'liveUploadChunk', { fileId: up.fileId, offset: 0, data: data.toString('base64') }); assert.ok(ch.ok && ch.done, JSON.stringify(ch));
  assert.strictEqual(S.lcall(ah, 'liveFileChunk', { fileId: up.fileId }).code, 'notfound');
  const post = S.lcall(b1, 'livePost', { body: 'My notes', attachments: [{ fileId: up.fileId }], clientId: 'f1' }); assert.ok(post.ok, JSON.stringify(post));
  const dl = S.lcall(ah, 'liveFileChunk', { fileId: up.fileId, offset: 0 }); assert.ok(dl.ok, JSON.stringify(dl));
  assert.strictEqual(Buffer.from(dl.data, 'base64').toString(), data.toString()); assert.strictEqual(dl.name, 'notes.txt');
  assert.strictEqual(S.lcall(ah, 'liveUploadInit', { name: 'virus.exe', size: 10, mime: 'application/octet-stream' }).code, 'blocked');
});

test('group classroom: closed for the candidates of a combined exam (close all teaching modules)', function () {
  const S = liveSetup();
  const b1 = S.lopen('b1', 'basma-pass-1');
  // fake a lock for b1 in the group's combined-exam storage
  S.b.eval("exLocks_ = function (X) { return X === 'exams-razi-a-26' ? [1] : []; }; exTeachingLock_ = function (X, u) { return X === 'exams-razi-a-26' && u === 'b1' ? { ok: false, code: 'examlock', error: 'Closed during the exam.' } : null; };");
  assert.strictEqual(S.lcall(b1, 'liveSync', { full: true }).code, 'examlock');
  assert.strictEqual(S.call({ module: 'portal', action: 'liveOpen', g: 'razi-a-26', sessions: b1.gs }).code, 'examlock');
  assert.ok(S.lopen('ahmed', PW).ok);
});

/* ---------------- Teaching Sessions step 4 (2.10) ---------------- */
test('module Live/Attendance switch: hidden by default, public flag for the module pages, Admin switches it back', function () {
  const S = tsSetup();
  assert.deepStrictEqual(S.call({ module: 'portal', action: 'portalModuleFlags' }), { ok: true, hideLiveAttendance: true });
  assert.strictEqual(S.tt('tsSettings', S.ahmed.tok, { hideModuleLive: false }).code, 'forbidden');
  assert.strictEqual(S.ts('tsSettings', { hideModuleLive: false }).settings.hideModuleLive, false);
  assert.strictEqual(S.call({ module: 'portal', action: 'portalModuleFlags' }).hideLiveAttendance, false);
  assert.strictEqual(S.ts('tsSettings', { hideModuleLive: true }).settings.hideModuleLive, true);
  assert.strictEqual(S.ts('tsSettings', { threshold: 70 }).settings.hideModuleLive, true, 'unchanged when not sent');
});

test('Results & attendance use the Teaching Sessions statuses: late, excused (not counted against), absent; open lecture not counted', function () {
  const S = tsSetup(), X = S.b.ctx, st = 'cellinjury-razi-a-26';
  const run = function (title, marks, keepOpen) {
    const s = S.ts('tsStart', { session: S.lect({ title: title, startAt: Date.now() }) }); assert.ok(s.ok, JSON.stringify(s));
    Object.keys(marks).forEach(function (id) { assert.ok(S.ts('tsMark', { tsId: s.session.tsId, studentId: id, mark: marks[id] }).ok); });
    if (!keepOpen) assert.ok(S.ts('tsClose', { tsId: s.session.tsId }).ok);
    return s;
  };
  run('L1', { ahmed: 'present', b1: 'late' });
  run('L2', { ahmed: 'present', b1: 'excused' });
  run('L3 (open)', { ahmed: 'present' }, true);
  const r = S.dir('reportDelivery', { deliveryId: S.ci.deliveryId }); assert.ok(r.ok, JSON.stringify(r));
  const by = {}; r.students.forEach(function (x) { by[x.studentId] = x; });
  assert.deepStrictEqual([by.ahmed.attendedPct, by.ahmed.late, by.ahmed.excused], [100, 0, 0]);
  assert.deepStrictEqual([by.b1.attended, by.b1.attendedPct, by.b1.late, by.b1.excused], [1, 100, 1, 1]);
  assert.deepStrictEqual([by.b2.attendedPct, by.b2.absent], [0, 2]);
  const L3 = r.sessions.filter(function (z) { return z.title === 'L3 (open)'; })[0];
  assert.strictEqual(by.b2.status[L3.sessionId], 'waiting'); assert.strictEqual(by.b1.status[r.sessions[0].sessionId], 'late');
  assert.ok(r.sessions.every(function (z) { return z.teaching; }));
});

test('module Live Classroom: a signed-in registered student joins without the class code (name/email from the account); no session → refused', function () {
  const S = setup();
  const stu = S.call({ module: 'cellinjury', action: 'studentLogin', username: 's1', password: PW }).token;
  // no code, a wrong code, a made-up name: the account decides
  const j = S.call({ module: 'cellinjury', action: 'liveJoin', stoken: stu, classCode: '', name: 'Someone Else', email: 'fake@x.zz' });
  assert.ok(j.ok, JSON.stringify(j));
  assert.strictEqual(j.name, 'Student One');
  const j2 = S.call({ module: 'cellinjury', action: 'liveJoin', stoken: stu, classCode: 'WRONG-1' });
  assert.ok(j2.ok && j2.participantId === j.participantId, 'same person, same participant');
  const sy = S.call({ module: 'cellinjury', action: 'liveSync', stoken: stu, participantId: j.participantId, full: true });
  assert.ok(sy.ok, JSON.stringify(sy));
  // without a student session the module refuses before any code check
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'liveJoin', classCode: 'CLASSROOM-2026', name: 'Intruder', email: 'x@y.zz' }).code, 'studentauth');
  // a deactivated student can no longer get in
  assert.ok(S.call({ module: 'cellinjury', action: 'setStudentActive', token: S.tokens.cellinjury, username: 's2', active: true }).ok);
  const s2 = S.call({ module: 'cellinjury', action: 'studentLogin', username: 's2', password: PW }).token;
  assert.ok(S.call({ module: 'cellinjury', action: 'setStudentActive', token: S.tokens.cellinjury, username: 's2', active: false }).ok);
  assert.strictEqual(S.call({ module: 'cellinjury', action: 'liveJoin', stoken: s2 }).code, 'studentauth');
});

/* ---------------- Overall Pathology Attendance (2.15) ---------------- */
function modSession(S, storage, title) {   // a class whose attendance is taken INSIDE the module (Teacher Portal → Attendance)
  const tok = S.call({ module: storage, action: 'login', password: 'teacher-' + storage }).token;
  const r = S.call({ module: storage, action: 'startAttendanceSession', token: tok, sessionTitle: title, chapter: 'Ch' }); assert.ok(r.ok, JSON.stringify(r));
  return { id: r.sessionId, code: r.code, close: function () { assert.ok(S.call({ module: storage, action: 'closeAttendanceSession', token: tok, sessionId: r.sessionId }).ok); } };
}
function modCheckIn(S, storage, id, pw, code) { const r = S.call({ module: storage, action: 'submitAttendanceByCode', stoken: login(S, storage, id, pw).token, code: code }); assert.ok(r.ok, JSON.stringify(r)); return r; }
const STU_PW = { ahmed: PW, b1: 'basma-pass-1', b2: 'bilal-pass-1' };
function pick(x) { return [x.attended, x.late, x.excused, x.absent, x.counted, x.pct, x.warn]; }

test('overall attendance: on Teaching Sessions alone it gives exactly the previous by-student figures (75% is not below 75%)', function () {
  const S = tsSetup();
  // before any class: every registered student is listed, with nothing counted yet (not "absent")
  let o = S.ts('attOverall', { groupId: S.ra.groupId }); assert.ok(o.ok, JSON.stringify(o));
  assert.deepStrictEqual(o.students.map(function (x) { return [x.studentId, x.state, x.pct, x.absencePct, x.warn]; }),
    [['ahmed', 'none', null, null, false], ['b1', 'none', null, null, false], ['b2', 'none', null, null, false]]);
  const run = function (title, marks, ih) {
    const s = S.ts('tsStart', { session: S.lect({ title: title, startAt: Date.now(), deliveryId: ih ? S.ih.deliveryId : S.ci.deliveryId }) }); assert.ok(s.ok, JSON.stringify(s));
    Object.keys(marks).forEach(function (id) { assert.ok(S.ts('tsMark', { tsId: s.session.tsId, studentId: id, mark: marks[id] }).ok); });
    assert.ok(S.ts('tsClose', { tsId: s.session.tsId }).ok);
  };
  run('L1', { ahmed: 'present', b1: 'present' });
  run('L2', { ahmed: 'late', b1: 'excused' }, true);
  run('L3', { ahmed: 'present' });
  run('L4', {}, true);
  const c = S.ts('tsSave', { session: S.lect({ title: 'L5 (cancelled)' }) }).session; S.ts('tsCancel', { tsId: c.tsId });
  S.ts('tsSave', { session: S.lect({ title: 'L6 (upcoming)' }) });
  const l = S.ts('tsList', { groupId: S.ra.groupId });
  o = S.ts('attOverall', { groupId: S.ra.groupId });
  l.students.forEach(function (x) { assert.deepStrictEqual(pick(stuOf(o, x.studentId)), pick(x), x.studentId + ' same as the previous table'); });
  assert.deepStrictEqual(pick(stuOf(o, 'ahmed')), [3, 1, 0, 1, 4, 75, false]);
  assert.strictEqual(stuOf(o, 'ahmed').absencePct, 25);
  assert.deepStrictEqual(pick(stuOf(o, 'b1')), [1, 0, 1, 2, 3, 33, true]);
  assert.strictEqual(stuOf(o, 'b2').state, 'missed'); assert.strictEqual(stuOf(o, 'b2').absencePct, 100);
  assert.strictEqual(o.summary.ended, 4); assert.strictEqual(o.summary.warn, 2);
  // the threshold is the platform's one: at 80 % ahmed's 75 % is now below it
  assert.ok(S.ts('tsSettings', { threshold: 80 }).ok);
  assert.strictEqual(stuOf(S.ts('attOverall', { groupId: S.ra.groupId }), 'ahmed').warn, true);
  assert.strictEqual(stuOf(S.ts('tsList', { groupId: S.ra.groupId }), 'ahmed').warn, true);
});

test('overall attendance: module-recorded + Teaching Sessions over two modules — each class once, open ones not counted, other groups excluded', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', IH = 'inflhealing-razi-a-26';
  // 1. Teaching Session in Cell Injury: ahmed present, b1 late, b2 absent
  const L1 = S.ts('tsStart', { session: S.lect({ title: 'L1', startAt: Date.now() }) }); assert.ok(L1.ok);
  S.ts('tsMark', { tsId: L1.session.tsId, studentId: 'ahmed', mark: 'present' }); S.ts('tsMark', { tsId: L1.session.tsId, studentId: 'b1', mark: 'late' });
  S.ts('tsClose', { tsId: L1.session.tsId });
  // 2. attendance taken inside the Cell Injury module: ahmed + b1 check in
  const M1 = modSession(S, CI, 'M1 — inside Cell Injury'); modCheckIn(S, CI, 'ahmed', PW, M1.code); modCheckIn(S, CI, 'b1', STU_PW.b1, M1.code); M1.close();
  // 3. inside the Inflammation module: only ahmed
  const M2 = modSession(S, IH, 'M2 — inside Inflammation'); modCheckIn(S, IH, 'ahmed', PW, M2.code); M2.close();
  // 4. Teaching Session in Inflammation: ahmed checks in on the group page AND again inside the module (same class); b1 excused
  const L2 = S.ts('tsStart', { session: S.lect({ title: 'L2', startAt: Date.now(), deliveryId: S.ih.deliveryId }) }); assert.ok(L2.ok);
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheckIn', g: 'razi-a-26', sessions: grpSessions(S, 'ahmed', PW), code: L2.code }).ok);
  assert.ok(modCheckIn(S, IH, 'ahmed', PW, L2.code).alreadyRecorded);
  S.ts('tsMark', { tsId: L2.session.tsId, studentId: 'b1', mark: 'excused' }); S.ts('tsClose', { tsId: L2.session.tsId });
  // 5. a class still open in Inflammation (b2 checked in): not counted until closed
  const M3 = modSession(S, IH, 'M3 — still open'); modCheckIn(S, IH, 'b2', STU_PW.b2, M3.code);
  // 6. another group's class (Misrata, same module) never counts for Al-Razi
  modSession(S, 'cellinjury-misrata-a-26', 'Misrata class').close();

  const o = S.ts('attOverall', { groupId: S.ra.groupId }); assert.ok(o.ok, JSON.stringify(o));
  assert.strictEqual(o.summary.ended, 4); assert.strictEqual(o.summary.open, 1); assert.strictEqual(o.sessions.length, 5);
  assert.ok(!o.sessions.some(function (z) { return /Misrata/.test(z.title); }));
  assert.deepStrictEqual(o.sessions.map(function (z) { return z.source; }).sort(), ['module', 'module', 'module', 'teaching', 'teaching']);
  assert.deepStrictEqual(o.modules.map(function (m) { return [m.storage, m.sessions, m.open]; }).sort(), [[CI, 2, 0], [IH, 2, 1]]);
  const a = stuOf(o, 'ahmed'), b1 = stuOf(o, 'b1'), b2 = stuOf(o, 'b2');
  assert.deepStrictEqual(pick(a), [4, 0, 0, 0, 4, 100, false]); assert.strictEqual(a.state, 'full'); assert.strictEqual(a.absencePct, 0);
  assert.deepStrictEqual(pick(b1), [2, 1, 1, 1, 3, 67, true]); assert.strictEqual(b1.state, 'mixed'); assert.strictEqual(b1.absencePct, 33);
  assert.deepStrictEqual(pick(b2), [0, 0, 0, 4, 4, 0, true]); assert.strictEqual(b2.state, 'missed'); assert.strictEqual(b2.absencePct, 100);
  // module breakdown — and the overall is NOT the average of the module percentages (b1: 100 % and 0 % → 67 %, not 50 %)
  const bm = {}; b1.modules.forEach(function (m) { bm[m.module] = m; });
  assert.deepStrictEqual([bm['Cell Injury & Cell Death'].attended, bm['Cell Injury & Cell Death'].counted, bm['Cell Injury & Cell Death'].pct], [2, 2, 100]);
  const ihm = b1.modules.filter(function (m) { return m.deliveryId === S.ih.deliveryId; })[0];
  assert.deepStrictEqual([ihm.attended, ihm.excused, ihm.counted, ihm.pct], [0, 1, 1, 0]);
  // per-class register of a student
  const M3z = o.sessions.filter(function (z) { return z.status === 'open'; })[0];
  assert.strictEqual(b2.reg[M3z.id], 'present'); assert.strictEqual(b1.reg[M3z.id], 'waiting');
  // pooled class figure: (4 + 2 + 0) ÷ (4 + 3 + 4) = 55 %
  assert.strictEqual(o.summary.classPct, 55); assert.strictEqual(o.summary.warn, 2);
  // read-only: nothing was written
  const before = JSON.stringify([S.b.ctx.rpRows_('AttendanceSessions').length, S.b.ctx.rpRows_('AttendanceRecords').length]);
  S.ts('attOverall', { groupId: S.ra.groupId });
  assert.strictEqual(JSON.stringify([S.b.ctx.rpRows_('AttendanceSessions').length, S.b.ctx.rpRows_('AttendanceRecords').length]), before);

  // the student's own card on the group page shows the same overall figure + warning (computed on opening — nothing sent)
  const me = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: grpSessions(S, 'b1', STU_PW.b1) }); assert.ok(me.ok, JSON.stringify(me));
  assert.deepStrictEqual([me.mine.attended, me.mine.counted, me.mine.pct, me.mine.absencePct, me.mine.warn, me.mine.overall], [2, 3, 67, 33, true, true]);
  assert.strictEqual(me.mine.modules.length, 2);
  assert.ok(me.recent.some(function (x) { return x.title === 'M1 — inside Cell Injury' && x.me === 'present'; }));
  assert.ok(!/ahmed|Bilal|"reg"/.test(JSON.stringify(me)), 'never other students');
  const me2 = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: grpSessions(S, 'ahmed', PW) });
  assert.deepStrictEqual([me2.mine.pct, me2.mine.warn], [100, false]);

  // access: a teacher sees only the modules assigned to them (flagged as partial); another group's teacher nothing; students nothing
  assert.ok(S.dir('teacherAssign', { userId: S.sara.teacher.userId, deliveryIds: [S.dl['cellinjury-misrata-a-26'].deliveryId, S.ih.deliveryId] }).ok);
  const sp = S.tt('attOverall', S.sara.tok, { groupId: S.ra.groupId }); assert.ok(sp.ok, JSON.stringify(sp));
  assert.strictEqual(sp.partial, true); assert.deepStrictEqual(sp.modules.map(function (m) { return m.storage; }), [IH]);
  assert.deepStrictEqual(pick(stuOf(sp, 'b1')), [0, 0, 1, 1, 1, 0, true]);
  assert.strictEqual(S.tt('attOverall', S.ahmed.tok, { groupId: S.ra.groupId }).partial, false);
  assert.strictEqual(S.tt('attOverall', S.ahmed.tok, { groupId: S.dl['cellinjury-misrata-a-26'].groupId }).code, 'forbidden');
  assert.strictEqual(S.call({ module: 'portal', action: 'attOverall', groupId: S.ra.groupId }).ok, false);
  assert.strictEqual(S.call({ module: 'portal', action: 'attOverall', groupId: S.ra.groupId, stoken: login(S, CI, 'b1', STU_PW.b1).token }).ok, false);
});

test('group page history (2.16): the student gets EVERY ended session, newest first — not only the last 6', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26';
  for (let i = 1; i <= 5; i++) { const L = S.ts('tsStart', { session: S.lect({ title: 'L' + i, startAt: Date.now() }) }); assert.ok(L.ok); S.ts('tsClose', { tsId: L.session.tsId }); }
  for (let i = 1; i <= 4; i++) modSession(S, CI, 'M' + i).close();
  const me = S.call({ module: 'portal', action: 'portalGroupSessions', g: 'razi-a-26', sessions: grpSessions(S, 'b1', STU_PW.b1) }); assert.ok(me.ok, JSON.stringify(me));
  assert.strictEqual(me.recentAll, true);
  assert.strictEqual(me.recent.length, 9);
  assert.strictEqual(me.mine.counted, 9);
  assert.ok(me.recent.every(function (x, i, a) { return !i || a[i - 1].startAt >= x.startAt; }), 'newest first');
});

test('group page order (2.17): modules follow the front-page list (Teacher Management); unknown ones after; Official Exams always last', function () {
  const S = examsSetup();   // Al-Razi A: cellinjury, inflhealing, then exams — Introduction delivered LATER (as on the live platform)
  const ids = function () { const r = S.call({ module: 'portal', action: 'portalGroupInfo', g: 'razi-a-26' }); assert.ok(r.ok, JSON.stringify(r)); return r.modules.map(function (m) { return m.id; }); };
  if (!S.dir('dirGet').modules.some(function (m) { return m.moduleId === 'intropath'; })) assert.ok(S.save('module', { moduleId: 'intropath', title: 'Introduction to Pathology', url: 'https://third-year-med.github.io/introduction-to-pathology/', storagePrefix: 'ip_' }, { create: true }).ok);
  assert.ok(S.save('delivery', { groupId: S.ra.groupId, moduleId: 'intropath', status: 'available' }).ok);
  assert.deepStrictEqual(ids(), ['intropath', 'cellinjury', 'inflhealing', 'exams']);
  // a new teaching module added after the exams: it goes before Official Exams, never after it
  assert.ok(S.save('module', { moduleId: 'neoplasia', title: 'Neoplasia', url: 'https://third-year-med.github.io/neoplasia/', storagePrefix: 'np_' }, { create: true }).ok);
  assert.ok(S.save('delivery', { groupId: S.ra.groupId, moduleId: 'neoplasia', status: 'available' }).ok);
  assert.deepStrictEqual(ids(), ['intropath', 'cellinjury', 'inflhealing', 'neoplasia', 'exams']);
  // its curricular place comes from the front-page list: put it after Cell Injury there → the group page follows
  const reg = S.call({ module: 'portal', action: 'portalInfo' }).modules;
  const neo = { id: 'neoplasia', title: 'Neoplasia', status: 'available', url: 'https://third-year-med.github.io/neoplasia/', moduleKey: 'neoplasia', handoff: 'neo', storagePrefix: 'np_' };
  const list = reg.slice(); list.splice(list.findIndex(function (m) { return m.id === 'cellinjury'; }) + 1, 0, neo);
  assert.ok(S.dir('portalAdminSave', { modules: list }).ok);
  assert.deepStrictEqual(ids(), ['intropath', 'cellinjury', 'neoplasia', 'inflhealing', 'exams']);
  // even an "exams" entry placed first on the front-page list cannot move Official Exams between the teaching modules
  assert.ok(S.dir('portalAdminSave', { modules: [{ id: 'exams', title: 'Official Exams', moduleKey: 'exams', status: 'available' }].concat(list) }).ok);
  assert.strictEqual(ids().slice(-1)[0], 'exams');
  // the other group is unaffected (its own deliveries only)
  const mi = S.call({ module: 'portal', action: 'portalGroupInfo', g: 'misrata-a-26' });
  assert.deepStrictEqual(mi.modules.map(function (m) { return m.id; }), ['cellinjury', 'cardio']);
});

/* ---------------- Learning lock (2.18) ---------------- */
test('learning lock: manual lock per group + module; learning data refused to students only; assessments untouched; who may lock', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', IH = 'inflhealing-razi-a-26';
  const stu = login(S, CI, 'b1', 'basma-pass-1').token, stuIH = login(S, IH, 'b1', 'basma-pass-1').token;
  const ask = function (storage, tok, action, extra) { return S.call(Object.assign({ module: storage, action: action, stoken: tok }, extra || {})); };
  assert.strictEqual(ask(CI, stu, 'learnLockStatus').locked, false);
  assert.ok(ask(CI, stu, 'getAllContent').ok);
  // a teacher of another group cannot lock it; the Admin and the group's teacher can
  assert.strictEqual(S.tt('llSet', S.sara.tok, { deliveryId: S.ci.deliveryId, locked: true }).code, 'forbidden');
  const L = S.tt('llSet', S.ahmed.tok, { deliveryId: S.ci.deliveryId, locked: true }); assert.ok(L.ok, JSON.stringify(L));
  const row = L.groups[0].modules.filter(function (m) { return m.storage === CI; })[0];
  assert.deepStrictEqual([row.locked, row.lockedBy, row.auto], [true, 'Dr. Ahmed', true]);
  // the student: status says locked; learning data refused; the same student in the other module is not affected
  const st = ask(CI, stu, 'learnLockStatus');
  assert.deepStrictEqual([st.ok, st.locked, st.reason], [true, true, 'manual']); assert.match(st.message, /locked the Learning module/);
  const g = ask(CI, stu, 'getAllContent'); assert.deepStrictEqual([g.ok, g.code], [false, 'learnlock']);
  assert.strictEqual(ask(CI, stu, 'studySync').code, 'learnlock');
  assert.ok(ask(IH, stuIH, 'getAllContent').ok, 'other module open');
  // assessment, attendance and session actions are never refused by the lock; teachers are never locked
  ['getMyAssessments', 'startAttempt', 'submitAttempt', 'studentSession', 'submitAttendanceByCode'].forEach(function (a) { assert.notStrictEqual(ask(CI, stu, a).code, 'learnlock', a); });
  const tok = S.call({ module: CI, action: 'login', password: 'teacher-' + CI }).token;
  assert.ok(S.call({ module: CI, action: 'getAllContent', token: tok }).ok, 'teacher reads content');
  assert.strictEqual(S.call({ module: CI, action: 'learnLockStatus', token: tok }).locked, false);
  // no session / a forged one: never a lock answer that leaks anything
  assert.strictEqual(ask(CI, 'x'.repeat(64), 'learnLockStatus').code, 'studentauth');
  // unlock → open again at once
  assert.strictEqual(S.ts('llSet', { deliveryId: S.ci.deliveryId, locked: false }).groups[0].modules.filter(function (m) { return m.storage === CI; })[0].locked, false);
  assert.ok(ask(CI, stu, 'getAllContent').ok); assert.strictEqual(ask(CI, stu, 'learnLockStatus').locked, false);
  // nothing else was written: no student, attempt or content rows changed by locking
  assert.strictEqual(S.b.ctx.rpRows_('AssessRecords').length, 0);
});

test('learning lock: automatic during a scheduled assessment (only its students, only in its window) and during a timed attempt; can be switched off', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', X = S.b.ctx, now = Date.now();
  const tb1 = login(S, CI, 'b1', 'basma-pass-1').token, tah = login(S, CI, 'ahmed', PW).token;
  const status = function (tok) { return S.call({ module: CI, action: 'learnLockStatus', stoken: tok }); };
  const store = X.assessStore_(CI);
  // a scheduled assessment for b1 only: from 1 min ago for 1 hour
  store.put('assignment', 'asg1', { id: 'asg1', assessmentId: 'a1', assessmentTitle: 'Midterm quiz', targetType: 'students', emails: ['basma@uni.ly'], availableFrom: now - 60000, dueAt: now + 3600e3, status: 'active' });
  // a week-long homework window for everyone never locks
  store.put('assignment', 'asg2', { id: 'asg2', assessmentId: 'a2', assessmentTitle: 'Homework', targetType: 'all', emails: [], availableFrom: now - 864e5, dueAt: now + 6 * 864e5, status: 'active' });
  X.llForget_(CI);
  let s1 = status(tb1); assert.deepStrictEqual([s1.locked, s1.reason, s1.title], [true, 'assessment', 'Midterm quiz']); assert.ok(s1.until > now);
  assert.strictEqual(status(tah).locked, false, 'not assigned → open');
  assert.strictEqual(S.call({ module: CI, action: 'getAllContent', stoken: tb1 }).code, 'learnlock');
  // the Dashboard list shows it
  const row = S.ts('llList').groups.filter(function (g) { return g.groupId === S.ra.groupId; })[0].modules.filter(function (m) { return m.storage === CI; })[0];
  assert.deepStrictEqual(row.running.map(function (r) { return r.title; }), ['Midterm quiz']);
  // a window that has not started yet does not lock; a cancelled assignment does not lock
  store.put('assignment', 'asg1', { id: 'asg1', assessmentId: 'a1', assessmentTitle: 'Midterm quiz', targetType: 'students', emails: ['basma@uni.ly'], availableFrom: now + 600000, dueAt: now + 3600e3, status: 'active' });
  X.llForget_(CI); assert.strictEqual(status(tb1).locked, false);
  store.put('assignment', 'asg3', { id: 'asg3', assessmentId: 'a1', assessmentTitle: 'Cancelled quiz', targetType: 'all', emails: [], availableFrom: now - 60000, dueAt: now + 3600e3, status: 'cancelled' });
  X.llForget_(CI); assert.strictEqual(status(tb1).locked, false, 'cancelled → open');
  // a TIMED attempt in progress locks that student until it is submitted
  store.put('attempt', 'att1', { id: 'att1', assignmentId: 'asg2', assessmentTitle: 'Homework', email: 'ahmed@student.local', status: 'in_progress', deadlineAt: now + 900000 });
  X.llForget_(CI);
  const s2 = status(tah); assert.deepStrictEqual([s2.locked, s2.reason], [true, 'attempt']);
  store.put('attempt', 'att1', { id: 'att1', assignmentId: 'asg2', assessmentTitle: 'Homework', email: 'ahmed@student.local', status: 'submitted', deadlineAt: now + 900000 });
  S.call({ module: CI, action: 'submitAttempt', stoken: tah });   // any submit clears the cached state at once
  assert.strictEqual(status(tah).locked, false);
  // an untimed attempt never locks
  store.put('attempt', 'att2', { id: 'att2', assignmentId: 'asg2', email: 'ahmed@student.local', status: 'in_progress', deadlineAt: null });
  X.llForget_(CI); assert.strictEqual(status(tah).locked, false);
  // switched off for this group + module → only the manual lock remains
  store.put('assignment', 'asg1', { id: 'asg1', assessmentId: 'a1', assessmentTitle: 'Midterm quiz', targetType: 'students', emails: ['basma@uni.ly'], availableFrom: now - 60000, dueAt: now + 3600e3, status: 'active' });
  X.llForget_(CI); assert.strictEqual(status(tb1).locked, true);
  assert.ok(S.ts('llSet', { deliveryId: S.ci.deliveryId, auto: false }).ok);
  assert.strictEqual(status(tb1).locked, false);
  assert.ok(S.ts('llSet', { deliveryId: S.ci.deliveryId, locked: true }).ok);
  assert.strictEqual(status(tb1).reason, 'manual');
});

/* ---------------- 2.24: a student added inside a group's module joins the group's student list ---------------- */
test('2.24 Teacher Portal → Students in a group module: the new student joins the group list, gets the other modules, signs in on the group page; bulk too; outside a group unchanged', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', IH = 'inflhealing-razi-a-26', X = S.b.ctx;
  const tok = S.call({ module: CI, action: 'login', password: 'teacher-' + CI }).token; assert.ok(tok);
  const accts = function (id) { return X.readAll_(X.SHEETS.STUDENTS).filter(function (r) { return r.username === id; }).map(function (r) { return r.module; }).sort(); };
  // one student, password generated (shown once to the teacher)
  const r = S.call({ module: CI, action: 'saveStudent', token: tok, create: true, student: { username: 'NewOne', name: 'New Student One', email: 'new1@uni.ly', password: '' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.tempPassword); assert.deepStrictEqual(r.group.joined, ['newone']); assert.strictEqual(r.group.otherAccounts, 1);
  assert.deepStrictEqual(accts('newone'), [CI, IH], 'an account in every module of the group');
  const m = X.rosterMember_(S.ra.groupId, 'newone'); assert.ok(m && m.active, 'on the group list');
  // signs in on the GROUP page with the password the teacher was given → both modules open
  const g = S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'newone', password: r.tempPassword });
  assert.ok(g.ok, JSON.stringify(g));
  // bulk: two new, one already on the group list (b1 has accounts already → refused by Code.gs as before, nothing changed)
  const b = S.call({ module: CI, action: 'bulkAddStudents', token: tok, students: [{ username: 'bulk1', name: 'Bulk One' }, { username: 'bulk2', name: 'Bulk Two' }, { username: 'b1', name: 'Basma One' }] });
  assert.ok(b.ok, JSON.stringify(b)); assert.strictEqual(b.created, 2); assert.deepStrictEqual(b.group.joined.sort(), ['bulk1', 'bulk2']);
  assert.deepStrictEqual(accts('bulk2'), [CI, IH]);
  const bp = b.results.filter(function (x) { return x.username === 'bulk1'; })[0].tempPassword;
  assert.ok(S.call({ module: 'portal', action: 'portalGroupCheck', g: 'razi-a-26', username: 'bulk1', password: bp }).ok);
  // errors are unchanged (same message, nothing joined)
  const dupl = S.call({ module: CI, action: 'saveStudent', token: tok, create: true, student: { username: 'newone', name: 'Again' } });
  assert.deepStrictEqual([dupl.ok, dupl.code, dupl.group], [false, 'exists', undefined]);
  // editing a student (not creating) is untouched; no token → refused as before
  assert.ok(S.call({ module: CI, action: 'saveStudent', token: tok, student: { username: 'newone', name: 'New Student 1', email: '' } }).ok);
  assert.strictEqual(S.call({ module: CI, action: 'saveStudent', create: true, student: { username: 'hacker', name: 'No Token' } }).ok, false);
  assert.strictEqual(X.rosterMember_(S.ra.groupId, 'hacker'), null);
  // a module storage that is not a group delivery: Code.gs alone, no group list
  const ntok = S.call({ module: 'cellinjury', action: 'login', password: 'teacher-cellinjury' }).token;
  if (ntok) { const n = S.call({ module: 'cellinjury', action: 'saveStudent', token: ntok, create: true, student: { username: 'solo1', name: 'Solo Student' } }); assert.ok(n.ok, JSON.stringify(n)); assert.strictEqual(n.group, undefined); }
});

/* ---------------- 2.23: a student's assessment list reads the Content sheet ONCE ---------------- */
test('2.23 My Assessments with many assignments (topic quizzes): same list as the engine, the Content sheet read once, nothing written', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', X = S.b.ctx;
  const ttok = assessFixture(S, CI), stu = login(S, CI, 'b1', 'basma-pass-1').token;
  const up = function (collection, id, data) { assert.ok(S.call({ module: CI, action: 'upsert', token: ttok, collection: collection, id: id, data: data }).ok); };
  const q = { id: 'x1', type: 'tf', stem: 'Necrosis is always irreversible.', answer: true };
  const store = X.assessStore_(CI);
  for (let i = 1; i <= 18; i++) {   // ⚡ Topic quizzes: one assessment + assignment per topic
    up('assessments', 't' + i, { id: 't' + i, title: 'Topic ' + i + ' quiz', status: 'published', publishedVersion: 1 });
    up('assessmentversions', 't' + i + '@1', { assessmentId: 't' + i, version: 1, title: 'Topic ' + i + ' quiz', mode: 'pool', poolCount: 5, questionIds: ['x1'], settings: { showScore: true }, questions: { x1: q } });
    store.put('assignment', 'tq' + i, { id: 'tq' + i, assessmentId: 't' + i, assessmentTitle: 'Topic ' + i + ' quiz', targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
  }
  up('assessments', 'd1', { id: 'd1', title: 'Draft', status: 'draft' });   // a draft is never listed
  store.put('assignment', 'asgd', { id: 'asgd', assessmentId: 'd1', status: 'active', targetType: 'all', emails: [] });
  const reads = {}, ra = X.readAll_, rowsBefore = X.readAll_(X.SHEETS.ASSESS).length;
  X.readAll_ = function (name) { reads[name] = (reads[name] || 0) + 1; return ra.apply(this, arguments); };
  let l; try { l = S.call({ module: CI, action: 'getMyAssessments', stoken: stu }); } finally { X.readAll_ = ra; }
  assert.ok(l.ok, JSON.stringify(l)); assert.strictEqual(l.items.length, 20);
  assert.strictEqual(reads[X.SHEETS.CONTENT], 1, 'Content sheet read once (was 2 per assignment): ' + JSON.stringify(reads));
  const ref = X.assessSvc_(CI).getMyAssessments('basma@uni.ly'), strip = function (r) { return r.items.map(function (i) { const o = Object.assign({}, i); delete o.passwordSet; return o; }); };
  assert.deepStrictEqual(strip(l), JSON.parse(JSON.stringify(strip(ref))), 'the same answer as the shared engine');
  assert.strictEqual(X.readAll_(X.SHEETS.ASSESS).length, rowsBefore, 'nothing written');
  assert.throws(function () { X.assessSvcFast_(CI).startAttempt('tq1', 'basma@uni.ly', 'B'); }, /read-only/);
});

/* ---------------- Assessment passwords (2.19) ---------------- */
function assessFixture(S, storage) {
  const tok = S.call({ module: storage, action: 'login', password: 'teacher-' + storage }).token;
  const up = function (collection, id, data) { const r = S.call({ module: storage, action: 'upsert', token: tok, collection: collection, id: id, data: data }); assert.ok(r.ok, JSON.stringify(r)); };
  const q = { id: 'x1', type: 'tf', stem: 'Necrosis is always irreversible.', answer: true, explanation: 'By definition.' };
  up('assessments', 'q1', { id: 'q1', title: 'Quiz 1 — Necrosis', status: 'published', publishedVersion: 1 });
  up('assessmentversions', 'q1@1', { assessmentId: 'q1', version: 1, title: 'Quiz 1 — Necrosis', mode: 'fixed', questionIds: ['x1'], settings: { showScore: true, showAnswers: true }, questions: { x1: q } });
  up('assessments', 'q2', { id: 'q2', title: 'Quiz 2 — Apoptosis', status: 'published', publishedVersion: 1 });
  up('assessmentversions', 'q2@1', { assessmentId: 'q2', version: 1, title: 'Quiz 2 — Apoptosis', mode: 'fixed', questionIds: ['x1'], settings: { showScore: true, showAnswers: false }, questions: { x1: q } });
  const store = S.b.ctx.assessStore_(storage);
  store.put('assignment', 'asg1', { id: 'asg1', assessmentId: 'q1', assessmentTitle: 'Quiz 1 — Necrosis', targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
  store.put('assignment', 'asg2', { id: 'asg2', assessmentId: 'q2', assessmentTitle: 'Quiz 2 — Apoptosis', targetType: 'all', emails: [], status: 'active', availableFrom: null, dueAt: null });
  return tok;
}
test('assessment passwords: no password to open the list or review; THAT assessment\'s password to start it; teacher sets / changes / resets each one', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', X = S.b.ctx;
  const ttok = assessFixture(S, CI), stu = login(S, CI, 'b1', 'basma-pass-1').token, other = login(S, CI, 'ahmed', PW).token;
  const T = function (action, o) { return S.call(Object.assign({ module: CI, action: action, token: ttok }, o || {})); };
  const A = function (tok, action, o) { return S.call(Object.assign({ module: CI, action: action, stoken: tok }, o || {})); };
  // teacher: each assessment its own password (random or typed), clearly per assessment; students cannot read them
  assert.deepStrictEqual(T('aePwList').passwords, {});
  const r1 = T('aePwSet', { assessmentId: 'q1', random: true }); assert.ok(r1.ok, JSON.stringify(r1)); assert.match(r1.password, /^[A-Z2-9]{6}$/);
  assert.strictEqual(T('aePwSet', { assessmentId: 'q1', password: 'ab' }).ok, false, 'too short');
  const r2 = T('aePwSet', { assessmentId: 'q1', password: 'Necro-26' }); assert.strictEqual(r2.passwords.q1.password, 'Necro-26');
  assert.deepStrictEqual(Object.keys(T('aePwList').passwords), ['q1']);
  assert.strictEqual(A(stu, 'aePwList').ok, false); assert.strictEqual(S.call({ module: CI, action: 'aePwList' }).ok, false);
  assert.strictEqual(S.call({ module: 'inflhealing-razi-a-26', action: 'aePwList', token: ttok }).ok, false, 'another module\'s teacher token');
  // student: the list without any password
  const l = A(stu, 'getMyAssessments'); assert.ok(l.ok, JSON.stringify(l)); assert.strictEqual(l.perAssessmentPasswords, true);
  assert.deepStrictEqual(l.items.map(function (i) { return i.assessment.title; }).sort(), ['Quiz 1 — Necrosis', 'Quiz 2 — Apoptosis']);
  assert.ok(!/Necro-26/.test(JSON.stringify(l)), 'the password never reaches a student');
  // start Quiz 1: wrong password refused, its own password accepted (not case-sensitive)
  assert.strictEqual(A(stu, 'startAttempt', { assignmentId: 'asg1', password: 'WRONG' }).code, 'badpw');
  assert.strictEqual(A(stu, 'startAttempt', { assignmentId: 'asg1' }).code, 'badpw');
  const st1 = A(stu, 'startAttempt', { assignmentId: 'asg1', password: 'necro-26' }); assert.ok(st1.ok, JSON.stringify(st1)); assert.strictEqual(st1.resumed, false);
  assert.ok(st1.attempt.questions.length === 1 && st1.attempt.questions[0].answer === undefined, 'paper without answers');
  // resuming the attempt in progress needs no password
  const st2 = A(stu, 'startAttempt', { assignmentId: 'asg1' }); assert.ok(st2.ok); assert.strictEqual(st2.resumed, true);
  // the password of Quiz 1 does not unlock Quiz 2; Quiz 2 has no password yet → it cannot be started (the class quiz password is retired)
  const np = A(stu, 'startAttempt', { assignmentId: 'asg2', password: 'Necro-26' }); assert.deepStrictEqual([np.ok, np.code], [false, 'nopw']); assert.match(np.error, /Quiz 2 — Apoptosis.*not open yet/);
  assert.deepStrictEqual(l.items.map(function (i) { return [i.assessment.id, i.passwordSet]; }).sort(), [['q1', true], ['q2', false]], 'the list says which have a password');
  // another student cannot submit this attempt; the owner submits without a password
  assert.strictEqual(A(other, 'submitAttempt', { attemptId: st1.attempt.id, responses: { x1: true } }).code, 'notfound');
  const sub = A(stu, 'submitAttempt', { attemptId: st1.attempt.id, responses: { x1: true } }); assert.ok(sub.ok, JSON.stringify(sub));
  assert.deepStrictEqual([sub.attempt.score, sub.attempt.total, sub.attempt.percent], [1, 1, 100]);
  // the stored attempt keeps the account identity (grading + reports unchanged)
  const rec = X.assessStore_(CI).get('attempt', st1.attempt.id); assert.deepStrictEqual([rec.email, rec.name, rec.status], ['basma@uni.ly', 'Basma One', 'submitted']);
  // completed: listed with its score and — because this assessment shows answers — the full review; no password
  const l2 = A(stu, 'getMyAssessments'), it1 = l2.items.filter(function (i) { return i.assignment.id === 'asg1'; })[0];
  const done = it1.attempts.filter(function (t) { return t.status === 'submitted'; })[0];
  assert.strictEqual(done.percent, 100); assert.ok(done.review && done.review.questions.length === 1 && done.review.answers.length === 1);
  // teacher removes Quiz 1's password → it can no longer be started; a fresh wrong-password burst is limited
  assert.deepStrictEqual(T('aePwSet', { assessmentId: 'q1', clear: true }).passwords, {});
  assert.strictEqual(A(other, 'startAttempt', { assignmentId: 'asg1', password: 'Necro-26' }).code, 'nopw');
  T('aePwSet', { assessmentId: 'q2', password: 'Apop-26' });
  for (let i = 0; i < 10; i++) A(other, 'startAttempt', { assignmentId: 'asg2', password: 'nope' + i });
  assert.strictEqual(A(other, 'startAttempt', { assignmentId: 'asg2', password: 'Apop-26' }).code, 'locked');
  // a student who must still choose a new password is stopped, as Code.gs does
  const sRow = X.findStudent_(CI, 'b1'); X.updateRow_('Students', sRow._row, Object.assign({}, sRow, { mustChange: true }));
  assert.strictEqual(A(login(S, CI, 'b1', 'basma-pass-1').token, 'getMyAssessments').code, 'mustchange');
});

test('copy an assessment to other groups (2.21): only groups of the same module the caller teaches; published + assigned + password; a group with attempts is kept; drafts; never duplicates', function () {
  const S = tsSetup(), CI = 'cellinjury-razi-a-26', MS = 'cellinjury-misrata-a-26', X = S.b.ctx;
  const ttok = assessFixture(S, CI);
  const T = function (action, o) { return S.call(Object.assign({ module: CI, action: action, token: ttok }, o || {})); };
  const row = function (st, c, id) { const r = X.findContentRow_(st, c, id); return r && !X.isTrue_(r.deleted) ? X.unpackJson_(r) : null; };
  assert.ok(T('aePwSet', { assessmentId: 'q1', password: 'Necro-26' }).ok);
  // targets: the other groups that have Cell Injury (not this one, not other modules)
  const tg = T('aeCopyTargets', { assessmentId: 'q1' }); assert.ok(tg.ok, JSON.stringify(tg));
  assert.deepStrictEqual(tg.targets.map(function (t) { return t.storage; }), [MS]);
  assert.deepStrictEqual([tg.published, tg.hasAssignment, tg.hasPassword, tg.targets[0].has, tg.targets[0].attempts], [true, true, true, false, 0]);
  assert.match(tg.here, /Razi/);
  const srcBefore = JSON.stringify(row(CI, 'assessments', 'q1'));
  // copy: published, assigned to everyone, the same password
  const c1 = T('aeCopyTo', { assessmentId: 'q1', targets: [MS], publish: true, assign: true, password: 'same' }); assert.ok(c1.ok, JSON.stringify(c1));
  assert.deepStrictEqual([c1.results[0].ok, c1.results[0].published, c1.results[0].assigned, c1.results[0].password], [true, true, 'yes', 'same']);
  const a = row(MS, 'assessments', 'q1'); assert.deepStrictEqual([a.status, a.publishedVersion, a.copiedFrom], ['published', 1, CI]);
  assert.deepStrictEqual(row(MS, 'assessmentversions', 'q1@1').questionIds, ['x1'], 'the frozen questions came along');
  assert.strictEqual(X.apwMap_(MS).q1.pw, 'Necro-26');
  const mine = X.assessSvc_(MS).getMyAssessments('someone@uni.ly'); assert.ok(mine.items.some(function (i) { return i.assessment.id === 'q1'; }), 'students of that group get it');
  assert.strictEqual(JSON.stringify(row(CI, 'assessments', 'q1')), srcBefore, 'the source is unchanged');
  // again: updated in place, never a second assignment
  const c2 = T('aeCopyTo', { assessmentId: 'q1', targets: [MS], publish: true, assign: true, password: 'random' });
  assert.strictEqual(c2.results[0].assigned, 'already'); assert.match(X.apwMap_(MS).q1.pw, /^[A-Z2-9]{6}$/);
  assert.strictEqual(X.assessStore_(MS).list('assignment').filter(function (x) { return x.assessmentId === 'q1'; }).length, 1);
  // once students have started it there, that group's copy is kept as it is
  X.assessStore_(MS).put('attempt', 'att1', { id: 'att1', assessmentId: 'q1', email: 'someone@uni.ly', status: 'in_progress' });
  assert.strictEqual(T('aeCopyTargets', { assessmentId: 'q1' }).targets[0].attempts, 1);
  const c3 = T('aeCopyTo', { assessmentId: 'q1', targets: [MS], publish: false, password: 'none' });
  assert.deepStrictEqual([c3.results[0].ok, c3.results[0].kept], [false, true]); assert.strictEqual(row(MS, 'assessments', 'q1').status, 'published', 'kept');
  // without "publish": arrives as a draft (no version, no assignment)
  const c4 = T('aeCopyTo', { assessmentId: 'q2', targets: [MS], publish: false, assign: true, password: 'none' }); assert.ok(c4.results[0].ok);
  assert.deepStrictEqual([row(MS, 'assessments', 'q2').status, row(MS, 'assessments', 'q2').publishedVersion, !!row(MS, 'assessmentversions', 'q2@1')], ['draft', 0, false]);
  assert.ok(!X.assessStore_(MS).list('assignment').some(function (x) { return x.assessmentId === 'q2'; }));
  assert.ok(!X.apwMap_(MS).q2, 'no password asked for');
  // permissions: Dr. Ahmed teaches only Al-Razi A → no other group to copy to; Misrata refused; students / no sign-in refused
  const at = S.t('teacherOpen', S.ahmed.tok, { deliveryId: S.ci.deliveryId }).token;
  const A = function (action, o) { return S.call(Object.assign({ module: CI, action: action, token: at }, o || {})); };
  assert.deepStrictEqual(A('aeCopyTargets', { assessmentId: 'q1' }).targets, []);
  assert.strictEqual(A('aeCopyTo', { assessmentId: 'q1', targets: [MS], publish: true }).code, 'forbidden');
  assert.strictEqual(S.call({ module: CI, action: 'aeCopyTo', assessmentId: 'q1', targets: [MS] }).ok, false);
  const stu = login(S, CI, 'b1', 'basma-pass-1').token;
  assert.strictEqual(S.call({ module: CI, action: 'aeCopyTargets', stoken: stu, assessmentId: 'q1' }).ok, false);
  assert.strictEqual(T('aeCopyTo', { assessmentId: 'nope', targets: [MS] }).code, 'notfound');
  assert.strictEqual(T('aeCopyTo', { assessmentId: 'q1', targets: [] }).ok, false);
});

test('Pathology Overall Results (2.22): module % = mean of submitted assessment attempts; overall equal (75% example) or weighted; missing ≠ zero; inactive / duplicates / exams / practice excluded; settings; permissions', function () {
  const S = tsSetup(), X = S.b.ctx;
  const M = ['ovA', 'ovB', 'ovC', 'ovD'].map(function (k, i) { return { deliveryId: 'd-' + k, moduleId: 'mod' + k, title: ['Cell Injury', 'Inflammation', 'Hemodynamic Disorders', 'Neoplasia'][i], icon: '📘', storage: 'mod' + k + '-tg', active: true }; });
  const g = { groupId: 'g-ov', label: 'Test group', linkCode: 'tg', academicYear: '2026-27', modules: M };
  let n = 0;
  const att = function (st, email, pct, status, ref) { n++; X.assessStore_(st).put('attempt', 'at' + n, { id: 'at' + n, assessmentId: ref || 'q1', assessmentTitle: 'Quiz ' + (ref || 'q1'), email: email, name: '', status: status || 'submitted', percent: pct, submittedAt: n }); return 'at' + n; };
  const members = [{ studentId: 's1', name: 'Student One', active: true, email: '' }, { studentId: 's2', name: 'Student Two', active: true, email: 's2@uni.ly' },
    { studentId: 's3', name: 'Student Three', active: true, email: '' }, { studentId: 's4', name: 'Former Student', active: false, email: '' }];
  // s1: 80 / 70 / 90 / 60 → 75 (the example); module A has two attempts 70 + 90 = 80 (all submitted attempts, the existing rule)
  att(M[0].storage, 's1@student.local', 70, 'submitted', 'q1'); att(M[0].storage, 's1@student.local', 90, 'submitted', 'q2');
  att(M[1].storage, 's1@student.local', 70); att(M[2].storage, 's1@student.local', 90); att(M[3].storage, 's1@student.local', 60);
  att(M[3].storage, 's1@student.local', 0, 'in_progress');                                   // not submitted → never counted
  // s2 (real email): results in 2 modules only → partial; never zero for the missing ones
  att(M[0].storage, 's2@uni.ly', 50); att(M[1].storage, 's2@uni.ly', 100);
  // s4 inactive, with a result; an unknown person's attempt is not merged into anyone
  att(M[0].storage, 's4@student.local', 40); att(M[0].storage, 'stranger@x.y', 99);
  // a duplicated record (same attempt id twice in the sheet) is counted once
  const dupId = att(M[2].storage, 's2@uni.ly', 30); const row = X.rpRows_('AssessRecords').filter(function (r) { return r.id === dupId; })[0];
  X.appendRow_('AssessRecords', Object.assign({}, row)); assert.strictEqual(X.rpRows_('AssessRecords').filter(function (r) { return r.id === dupId; }).length, 2);
  // exams and practice quizzes are other metrics
  X.assessStore_(M[1].storage).put('exattempt', 'ex1', { id: 'ex1', examId: 'e1', username: 's1', status: 'submitted', percent: 5 });
  X.appendRow_('Results', { module: M[1].storage, id: 'r1', name: 'Student One', email: 's1@student.local', percent: 3, submittedAt: 1 });
  // module D has an active assignment → counts as a module with assessments
  X.assessStore_(M[3].storage).put('assignment', 'asgD', { id: 'asgD', assessmentId: 'q1', status: 'active', targetType: 'all' });

  const eq = X.resOverallCompute_(g, members, { method: 'equal', weights: {} });
  const by = function (r, id) { return r.students.filter(function (x) { return x.studentId === id; })[0]; };
  const pcts = function (x) { return M.map(function (m) { return x.modules.filter(function (y) { return y.deliveryId === m.deliveryId; })[0].pct; }); };
  const modOf = function (x, i) { return x.modules.filter(function (y) { return y.deliveryId === M[i].deliveryId; })[0]; };
  const gm = function (r, i) { return r.modules.filter(function (y) { return y.deliveryId === M[i].deliveryId; })[0]; };
  const s1 = by(eq, 's1'), s2 = by(eq, 's2'), s3 = by(eq, 's3'), s4 = by(eq, 's4');
  assert.deepStrictEqual(pcts(s1), [80, 70, 90, 60]);
  assert.deepStrictEqual([s1.overall, s1.withResults, s1.included, s1.completion, s1.remaining], [75, 4, 4, 'complete', 0], 'the 75% example');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(modOf(s1, 0).assessments.map(function (a) { return [a.title, a.attempts, a.avg]; }))), [['Quiz q1', 1, 70], ['Quiz q2', 1, 90]]);
  assert.deepStrictEqual(pcts(s2), [50, 100, 30, null], 'missing stays missing; the duplicate counted once');
  assert.deepStrictEqual([s2.overall, s2.withResults, s2.completion, s2.remaining], [60, 3, 'partial', 1]);
  assert.deepStrictEqual([s3.overall, s3.withResults, s3.completion], [null, 0, 'none'], 'no submissions → no overall (not zero)');
  assert.deepStrictEqual([s4.status, s4.completion, s4.overall], ['inactive', 'inactive', 40], 'inactive listed with history, not dropped');
  assert.strictEqual(gm(eq, 1).submitted, 2, 'exam attempt and practice result are not assessments');
  assert.strictEqual(gm(eq, 3).hasAssessments, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(eq.summary)), { enrolled: 3, inactive: 1, withResults: 2, incomplete: 1, none: 1, complete: 1, mean: 67.5, high: 75, low: 60, modulesWithResults: 4, modulesAssessed: 4, modules: 4 });
  assert.ok(eq.others.some(function (o) { return o.label === 'stranger@x.y'; }), 'unmatched attempts reported apart');
  // weighted: A×2, B×1, C×1, D×0 (excluded) → s1 = (160 + 70 + 90) / 4 = 80; an unconfigured module counts 1 and is flagged
  const w = X.resOverallCompute_(g, members, { method: 'weighted', weights: { modovA: 2, modovB: 1, modovC: 1, modovD: 0 } });
  assert.deepStrictEqual([by(w, 's1').overall, by(w, 's1').included, by(w, 's1').withResults], [80, 3, 4]);
  assert.strictEqual(modOf(by(w, 's1'), 3).included, false);
  const w2 = X.resOverallCompute_(g, members, { method: 'weighted', weights: { modovA: 3 } });
  assert.deepStrictEqual([gm(w2, 1).weight, gm(w2, 1).weightDefault, by(w2, 's1').overall], [1, true, 76.7], '(240+70+90+60)/6');
  // settings: Admin only, validated, not changed silently
  assert.strictEqual(S.tt('resSettings', S.ahmed.tok, { method: 'weighted', weights: {} }).code, 'forbidden');
  assert.strictEqual(S.ts('resSettings', { method: 'nonsense' }).ok, false);
  assert.strictEqual(S.ts('resSettings', { method: 'weighted', weights: { modovA: -1 } }).ok, false);
  assert.strictEqual(S.ts('resSettings', { method: 'weighted', weights: { modovA: 0, modovB: 0 } }).ok, false);
  const sv = S.ts('resSettings', { method: 'weighted', weights: { cellinjury: 2, inflhealing: '' } }); assert.ok(sv.ok, JSON.stringify(sv));
  assert.deepStrictEqual(JSON.parse(JSON.stringify([sv.settings.method, sv.settings.weights])), ['weighted', { cellinjury: 2 }]);
  // the real group through the dashboard action: Admin and the group's teacher; another teacher refused
  const r = S.ts('resOverall', { groupId: S.ra.groupId }); assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
  assert.deepStrictEqual(r.modules.map(function (m) { return m.storage; }).sort(), ['cellinjury-razi-a-26', 'inflhealing-razi-a-26']);
  assert.strictEqual(r.settings.method, 'weighted'); assert.ok(r.students.some(function (x) { return x.studentId === 'b1'; }));
  assert.ok(S.tt('resOverall', S.ahmed.tok, { groupId: S.ra.groupId }).ok);
  assert.strictEqual(S.tt('resOverall', S.sara.tok, { groupId: S.ra.groupId }).code, 'forbidden');
  S.ts('resSettings', { method: 'equal', weights: {} });
});
