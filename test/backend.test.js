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
