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
