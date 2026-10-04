/**
 * ==========================================================================
 * Portal.gs — shared front page & module access for the Pathology Teaching Platform
 * Add to the SAME Apps Script project as Code.gs (Files → + → Script → "Portal") and add ONE line to route_ in
 * Code.gs (see SETUP.md). Nothing else in Code.gs, and no existing sheet, account or module, is changed.
 * ==========================================================================
 * Module key "portal" (every request carries {module:"portal"}):
 *
 *   portalInfo        public   the list of chapters/modules and their status (what the front page shows)
 *   portalCheck       public   Student ID + password → for each requested module: may this student enter?
 *                              A module is unlocked ONLY where an ACTIVE student account with that Student ID AND
 *                              that password exists in that module (the module's own account — nothing is copied or
 *                              created). For an unlocked module a normal student session of THAT module is opened,
 *                              exactly as if the student had signed in on the module itself.
 *   portalAdminGet    teacher  the list + how many active student accounts each module has (on this backend)
 *   portalAdminSave   teacher  change the list (status, title, link, icon, order, add/remove modules)
 *   portalTeacherOpen teacher  open modules as the teacher: for each requested module of the list, a normal TEACHER
 *                              session of that module is created (the same kind of session as the module's own teacher
 *                              sign-in creates), so the module opens in teacher mode with no second password. It does
 *                              not depend on student accounts. It ends when the front-page teacher session ends.
 *                              Group links (?g=TAG): ask for {module:"cellinjury", group:"B"} → a teacher session of the
 *                              group module "cellinjury-B" (the module's own name for that group), so the teacher can
 *                              open any group of a listed module.
 *   portalTeacherClose public  sign-out: ends the module teacher sessions whose tokens are sent (holding the token is
 *                              the proof, as for logout) and also clears their cached check, so they stop at once.
 *
 *
 * Platform directory (1.3, Admin only — stored, not yet used for any access decision):
 *   dirGet            the institutions, groups, modules and deliveries
 *   dirSave           create or edit one record   {kind: institution|group|module|delivery, record:{…}}
 *   dirSetActive      activate / deactivate one record (records are never deleted)
 *   dirScan           READ-ONLY list of the storage names already present in the data (e.g. cellinjury,
 *                     cellinjury-B) with row counts, so existing data can be registered as deliveries
 *   Sheets (created on first use; no existing sheet is touched): Institutions, Groups, Modules, Deliveries,
 *   TeacherAssignments, ModuleContentRoles (the last two are prepared for later steps and stay empty for now).
 *
 * Group front pages (1.4, Step 2 — …/?g=<link code>):
 *   portalGroupInfo   public   the group's institution, name and its modules (from the directory: active deliveries of
 *                              an active group of an active institution). Contains no student data. An unknown or
 *                              inactive code answers code "nogroup".
 *   portalGroupCheck  public   Student ID + password for that group: checked against the account in EACH of the group's
 *                              open deliveries (its own storage, e.g. cellinjury-razi-a-26) exactly like portalCheck.
 *                              The link code only selects the group — a session is opened only where an active account
 *                              with this Student ID AND password exists in that delivery's storage.
 *
 * Group rosters (1.5, Step 3 — Admin):
 *   rosterGet / rosterAdd / rosterSave / rosterSetActive / rosterResetPassword / rosterSync / rosterImport
 *   rosterResetMany   new temporary passwords for many members in one go (those still on a temporary password, or all
 *                     active members): a different generated one each, or one password typed by the Admin for all
 *   A student is a MEMBER of a group (sheet StudentMemberships) and has a normal account in EACH delivery of that group
 *   (the existing Students rows, e.g. cellinjury-razi-a-26), all with the same password. The group page requires an
 *   active membership; deactivating a membership also deactivates the accounts. A password changed by the student (on the
 *   group page, or inside a module of the group) is applied to all of the group's modules.
 *   portalGroupSetPassword  public   the student's own password change on the group page (current password required)
 *   portalGroupRefresh      public   a signed-in student (proved by a valid session of one of the group's modules) gets
 *                                    sessions for modules delivered/opened AFTER they signed in — no password needed
 *
 * Personal teacher accounts (1.6, Step 4):
 *   teacherLogin      public   username + password → a TEACHER session (sheet PortalSessions, hash only). It is never a
 *                              session of the module "portal", so it can never use any Admin action.
 *   teacherMe / teacherOpen / teacherLogout / teacherChangePassword   (teacher session, field "ttoken")
 *                              teacherOpen opens ONE assigned delivery: only if the teacher is active, has an assignment for
 *                              exactly that delivery (= group + module), and the delivery, group, institution and module are
 *                              active. It creates a normal teacher session of that delivery's storage (recorded in
 *                              PortalGrants, so it can be ended at once).
 *   teacherList / teacherSave / teacherSetActive / teacherResetPassword / teacherAssign   (Admin)
 *   Removing an assignment, deactivating a teacher, or deactivating a delivery/group/institution/module ends the teacher
 *   module sessions concerned immediately.
 *
 * Teacher = a valid teacher session of the "portal" module (Code.gs login/setup with module:"portal").
 * Admin   = the same account (the only platform teacher account until personal teacher accounts exist).
 *
 * Status of a module (shown to everyone; it never grants access by itself):
 *   available  — released; students whose account is registered for it can enter
 *   ready      — completed but not yet released (visible, cannot be entered from the front page)
 *   soon       — not yet developed / coming soon
 * Access is decided only by the student's account in that module (server-side, in portalCheck). A completed or even
 * "available" module stays closed to a student who has no account (or a deactivated one) in it.
 *
 * Several backends: a module may live on another Apps Script deployment (field "backend"). Install this same file
 * on that project too; the front page asks each backend about its own modules. The list itself is kept on the
 * backend the front page is configured with (config.js → backendUrl).
 * ========================================================================== */
var PORTAL_MODULE = 'portal';
var PORTAL_VERSION = '1.6';
var PORTAL_GROUP_RE = /^[A-Za-z0-9_-]{1,24}$/;   // the same rule the modules use for ?g=
var PORTAL_STATUSES = { available: 1, ready: 1, soon: 1 };
var PORTAL_HANDOFF = { neo: 1, vp: 1, link: 1 };
var PORTAL_MAX_FAILS = 10, PORTAL_FAIL_WINDOW_S = 900;   // per Student ID: 10 failed front-page sign-ins → wait 15 min
var PORTAL_SETTING = 'portal:registry';

/** The list shown on a fresh install — the teacher changes everything in the front page's teacher panel. */
var PORTAL_DEFAULT = [
  { id: 'cellinjury', title: 'Cell Injury & Cell Death', subtitle: 'General pathology', icon: '🧫', color: '#0e7c7b', status: 'available',
    url: 'https://third-year-med.github.io/cell-injury-teaching-platform/', moduleKey: 'cellinjury', handoff: 'neo', storagePrefix: 'ci_', backend: '' },
  { id: 'inflhealing', title: 'Inflammation & Healing', subtitle: 'General pathology', icon: '🔥', color: '#c2410c', status: 'available',
    url: 'https://third-year-med.github.io/inflammation-healing/', moduleKey: 'inflhealing', handoff: 'neo', storagePrefix: 'ih_', backend: '' }
];

/* ---------------------------------------------------------------------- *
 * Hook called by Code.gs route_ (one added line). Returns a response for module "portal", otherwise null.
 * ---------------------------------------------------------------------- */
function portalHook_(module, p) {
  if (String(module) !== PORTAL_MODULE) {
    // a student changing the password inside a module of a group: apply it to all of the group's modules
    if (String(p.action || '') === 'studentChangePassword') return rosterModulePassword_(String(module), p);
    return null;
  }
  var a = String(p.action || '');
  switch (a) {
    case 'ping': case 'setup': case 'login': case 'logout': case 'changePassword': return null;   // Code.gs teacher sign-in for the portal
    case 'portalInfo': return portalInfo_();
    case 'portalCheck': return portalCheck_(p);
    case 'portalGroupInfo': return portalGroupInfo_(p);
    case 'portalGroupCheck': return portalGroupCheck_(p);
    case 'portalAdminGet': return authed_(PORTAL_MODULE, p, function () { return portalAdminGet_(); });
    case 'portalAdminSave': return authed_(PORTAL_MODULE, p, function () { return portalAdminSave_(p); });
    case 'portalTeacherClose': return portalTeacherClose_(p);
    case 'dirGet': return authed_(PORTAL_MODULE, p, function () { return dirGet_(); });
    case 'dirSave': return authed_(PORTAL_MODULE, p, function () { return dirSave_(p); });
    case 'dirSetActive': return authed_(PORTAL_MODULE, p, function () { return dirSetActive_(p); });
    case 'dirScan': return authed_(PORTAL_MODULE, p, function () { return dirScan_(); });
    case 'rosterGet': return authed_(PORTAL_MODULE, p, function () { return rosterGet_(p); });
    case 'rosterAdd': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterAdd_(p); }); });
    case 'rosterSave': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterSave_(p); }); });
    case 'rosterSetActive': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterSetActive_(p); }); });
    case 'rosterResetPassword': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterResetPassword_(p); }); });
    case 'rosterResetMany': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterResetMany_(p); }); });
    case 'rosterSync': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterSync_(p.groupId); }); });
    case 'rosterImport': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return rosterImport_(p); }); });
    case 'portalGroupSetPassword': return portalGroupSetPassword_(p);
    case 'portalGroupRefresh': return portalGroupRefresh_(p);
    case 'teacherLogin': return teacherLogin_(p);
    case 'teacherMe': return tAuthed_(p, function (u) { return teacherMe_(u); });
    case 'teacherOpen': return tAuthed_(p, function (u, ses) { return teacherOpen_(u, ses, p); });
    case 'teacherLogout': return teacherLogout_(p);
    case 'teacherChangePassword': return tAuthed_(p, function (u, ses) { return teacherChangePassword_(u, ses, p); });
    case 'teacherList': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return teacherList_(); }); });
    case 'teacherSave': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return teacherSave_(p); }); });
    case 'teacherSetActive': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return teacherSetActive_(p); }); });
    case 'teacherResetPassword': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return teacherResetPassword_(p); }); });
    case 'teacherAssign': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return teacherAssign_(p); }); });
    case 'portalTeacherOpen': return authed_(PORTAL_MODULE, p, function (tok) { return portalTeacherOpen_(p, tok); });
    default: return { ok: false, code: 'badaction', error: 'This action is not available on the front page.' };
  }
}

/* ---------------- the module list ---------------- */
function portalClean_(m, i) {
  m = m || {};
  var s = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); };
  var url = s(m.url, 400), backend = s(m.backend, 400);
  return {
    id: s(m.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || ('module' + (i + 1)),
    title: s(m.title, 80) || 'Untitled module', subtitle: s(m.subtitle, 120), icon: s(m.icon, 8) || '📘',
    color: /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? String(m.color) : '#0f2a4a',
    status: PORTAL_STATUSES[m.status] ? m.status : 'soon',
    url: /^https:\/\//.test(url) ? url : '',
    moduleKey: s(m.moduleKey, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    handoff: PORTAL_HANDOFF[m.handoff] ? m.handoff : 'link',
    storagePrefix: s(m.storagePrefix, 20).replace(/[^A-Za-z0-9_]/g, ''),
    backend: /^https:\/\/script\.google(usercontent)?\.com\//.test(backend) ? backend : '',
    note: s(m.note, 240),
    groups: (Array.isArray(m.groups) ? m.groups : String(m.groups || '').split(/[\s,;]+/)).map(function (g) { return String(g || '').trim(); })
      .filter(function (g, i, arr) { return PORTAL_GROUP_RE.test(g) && arr.indexOf(g) === i; }).slice(0, 30)
  };
}
function portalRegistry_() {
  var raw = getSetting_(PORTAL_SETTING), list = null;
  if (raw) { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  return (Array.isArray(list) ? list : PORTAL_DEFAULT).map(portalClean_);
}
function portalInfo_() {
  return { ok: true, version: PORTAL_VERSION, serverTime: Date.now(), modules: portalRegistry_(), hasTeacher: !!getTeacherCreds_(PORTAL_MODULE).hash };
}

/* ---------------- student: which modules may this Student ID + password enter? ---------------- */
function portalCheck_(p) {
  var keys = (Array.isArray(p.modules) ? p.modules : []).map(function (k) { return String(k || '').toLowerCase().replace(/[^a-z0-9_-]/g, ''); })
    .filter(function (k, i, arr) { return k && k !== PORTAL_MODULE && arr.indexOf(k) === i; }).slice(0, 40);
  var res = portalAccountCheck_(p, keys.map(function (k) { return { key: k, module: k }; }));
  if (!res.ok && res.code === 'badlogin' && p.username && p.password) {
    // not an account of the main page — but perhaps a group student who opened the main page: only with the RIGHT password
    // for an active group membership, the student is told which group page is theirs (nothing else is revealed)
    var gm = portalMemberGroups_(normUser_(p.username), String(p.password));
    if (gm.length) { CacheService.getScriptCache().remove('portalfail:' + sha256Hex_(normUser_(p.username))); return { ok: false, code: 'groupmember', groups: gm, error: 'Please sign in on your group\'s page.' }; }
  }
  return res;
}
/** The active groups (of active institutions) where this Student ID is an active member AND this is the member's password. */
function portalMemberGroups_(username, pw) {
  try { if (!username || !pw || !dirReadable_()) return []; } catch (e) { return []; }
  var sh = getSS_().getSheetByName(DIR.MEMB); if (!sh || sh.getLastRow() < 2) return [];
  var groups = {}; dirAll_(DIR.GROUP).forEach(function (g) { groups[g.groupId] = g; });
  var insts = {}; dirAll_(DIR.INST).forEach(function (i) { insts[i.institutionId] = i; });
  var idx = null, out = [];
  dirAll_(DIR.MEMB).forEach(function (m) {
    if (m.studentId !== username || !m.active) return;
    var g = groups[m.groupId], inst = g && insts[g.institutionId];
    if (!g || !g.active || !inst || !inst.active) return;
    var ok = m.pwHash && safeEq_(hashIter_(pw, m.pwSalt, Number(m.pwIter) || PW_ITER), m.pwHash);
    if (!ok) {   // older memberships without a stored hash: the member's accounts in the group
      idx = idx || rosterAccounts_();
      ok = rosterStorages_(g.groupId).some(function (x) { var a = idx[x.storage + '|' + username]; return a && isTrue_(a.active) && safeEq_(hashIter_(pw, a.pwSalt, Number(a.pwIter) || PW_ITER), a.pwHash); });
    }
    if (ok) out.push({ g: g.linkCode, group: g.name, academicYear: g.academicYear, institution: inst.name });
  });
  return out;
}
/** Student ID + password → for each target {key, module (= the storage name)}: may this student enter? Opens a normal
 *  student session of that storage where an active account with this ID and password exists (nothing else is touched). */
function portalAccountCheck_(p, targets) {
  var username = normUser_(p.username), pw = String(p.password || ''), now = Date.now();
  if (!username || !pw) return { ok: false, code: 'badlogin', error: 'Enter your Student ID and password.' };
  var c = CacheService.getScriptCache(), fk = 'portalfail:' + sha256Hex_(username), fails = Number(c.get(fk) || 0);
  if (fails >= PORTAL_MAX_FAILS) return { ok: false, code: 'locked', error: 'Too many unsuccessful sign-ins. Please wait 15 minutes and try again.' };
  var remember = !!p.remember, exp = now + (remember ? STU_REMEMBER_TTL_MS : STU_TTL_MS), out = {}, student = null, any = false;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    targets.forEach(function (t) {
      var key = t.key, mod = t.module;
      if (!studentAuthOn_(mod)) { out[key] = { access: false, reason: 'noaccounts' }; return; }
      var acct = typeof acctModule_ === 'function' ? acctModule_(mod) : mod;
      var s = findStudent_(acct, username);
      if (!s) { out[key] = { access: false, reason: 'notregistered' }; return; }
      if (Number(s.lockedUntil) > now) { out[key] = { access: false, reason: 'locked' }; return; }
      if (!safeEq_(hashIter_(pw, s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) { out[key] = { access: false, reason: 'otherpassword' }; return; }
      // the Student ID + password are right for this storage from here on
      any = true; student = student || studentPublic_(s);
      if (!isTrue_(s.active)) { out[key] = { access: false, reason: 'inactive' }; return; }
      var xl = typeof exTeachingLock_ === 'function' ? exTeachingLock_(mod, s.username) : null;
      if (xl) { out[key] = { access: false, reason: 'examlock', message: xl.error }; return; }
      var token = randomHex_(32);
      appendRow_(SHEETS.STU_SESSIONS, { module: mod, tokenHash: stuTokenHash_(token), username: s.username, createdAt: now, expiresAt: exp, remember: remember });
      s.lastLogin = now; s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
      out[key] = { access: true, token: token, expiresAt: exp, mustChange: isTrue_(s.mustChange), student: studentPublic_(s) };
    });
  } finally { lock.releaseLock(); }
  if (!any) {
    c.put(fk, String(fails + 1), PORTAL_FAIL_WINDOW_S);
    Utilities.sleep(300);
    // the same answer whether the Student ID exists or not; per-module details only after a correct password
    return { ok: false, code: 'badlogin', error: 'Incorrect Student ID or password.' };
  }
  c.remove(fk);
  Object.keys(out).forEach(function (k) { if (out[k].reason === 'notregistered' || out[k].reason === 'noaccounts') out[k] = { access: false, reason: 'notregistered' }; });
  return { ok: true, student: student, modules: out, serverTime: now };
}

/* ---------------- teacher ---------------- */
function portalAdminGet_() {
  var counts = {};
  readAll_(SHEETS.STUDENTS).forEach(function (r) { if (isTrue_(r.active)) counts[r.module] = (counts[r.module] || 0) + 1; });
  return { ok: true, modules: portalRegistry_(), counts: counts, studentAuthModules: Object.keys(STUDENT_AUTH_MODULES || {}), version: PORTAL_VERSION };
}
function portalAdminSave_(p) {
  var list = Array.isArray(p.modules) ? p.modules.slice(0, 60).map(portalClean_) : null;
  if (!list) return { ok: false, error: 'Nothing to save.' };
  var ids = {};
  for (var i = 0; i < list.length; i++) { if (ids[list[i].id]) return { ok: false, error: 'Two modules have the same id “' + list[i].id + '”.' }; ids[list[i].id] = 1; }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { setSetting_(PORTAL_SETTING, JSON.stringify(list)); } finally { lock.releaseLock(); }
  return { ok: true, modules: list };
}

/* ---------------- teacher: one sign-in → every module ---------------- */
function portalTeacherOpen_(p, portalToken) {
  var listed = {};
  portalRegistry_().forEach(function (m) { if (m.moduleKey && m.handoff === 'neo') listed[m.moduleKey] = 1; });
  // each request: "cellinjury" (the module) or {module:"cellinjury", group:"B"} (its ?g=B group → module "cellinjury-B")
  var keys = [];
  (Array.isArray(p.modules) ? p.modules : []).slice(0, 40).forEach(function (x) {
    var base = String((x && typeof x === 'object' ? x.module : x) || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    var group = x && typeof x === 'object' && x.group != null && x.group !== '' ? String(x.group) : '';
    if (!base || base === PORTAL_MODULE || !listed[base]) return;
    if (group && !PORTAL_GROUP_RE.test(group)) return;
    var key = base + (group ? '-' + group : '');
    if (keys.indexOf(key) < 0) keys.push(key);
  });
  var now = Date.now(), exp = now + SESSION_TTL_MS;
  readAll_(SHEETS.SESSIONS).forEach(function (r) { if (r.token === portalToken && Number(r.expiresAt) > now) exp = Math.min(exp, Number(r.expiresAt)); });
  var out = {};
  keys.forEach(function (key) {
    var token = Utilities.getUuid() + '-' + randomHex_(16);
    appendRow_(SHEETS.SESSIONS, { module: key, token: token, createdAt: now, expiresAt: exp });
    out[key] = { token: token, expiresAt: exp };
  });
  return { ok: true, modules: out };
}
function portalTeacherClose_(p) {
  var want = {};
  (Array.isArray(p.sessions) ? p.sessions : []).slice(0, 40).forEach(function (x) {
    var m = String((x && x.module) || '').replace(/[^A-Za-z0-9_-]/g, ''), t = String((x && x.token) || '');   // group names keep their case
    if (m && t && m !== PORTAL_MODULE) want[t] = m;
  });
  if (!Object.keys(want).length) return { ok: true, closed: 0 };
  var c = CacheService.getScriptCache(), rows = readAll_(SHEETS.SESSIONS), n = 0;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    for (var i = rows.length - 1; i >= 0; i--) {
      var m = want[rows[i].token];
      if (m && rows[i].module === m) { deleteRow_(SHEETS.SESSIONS, rows[i]._row); n++; }
    }
  } finally { lock.releaseLock(); }
  Object.keys(want).forEach(function (t) { c.remove('tok:' + want[t] + ':' + t); });
  return { ok: true, closed: n };
}

/* ======================================================================
 * Platform directory (Step 1) — institutions, groups, modules, deliveries.
 * Every record has a generated, never-changing id; records reference each other ONLY by id.
 *   Group.linkCode   unique routing code (?g=…), chosen by the Admin, fixed once the group has a delivery
 *   Delivery         one module given to one group; backendModule = the existing storage name used for that
 *                    delivery's student data ("<moduleId>-<linkCode>", or the plain "<moduleId>" to adopt the
 *                    storage used without a group link). Fixed once created, so data is never moved.
 * Nothing here is read by sign-in or module access yet.
 * ====================================================================== */
var DIR = {
  INST: 'Institutions', GROUP: 'Groups', MOD: 'Modules', DELIV: 'Deliveries',
  ASSIGN: 'TeacherAssignments', ROLES: 'ModuleContentRoles', MEMB: 'StudentMemberships',
  USERS: 'PortalUsers', PSES: 'PortalSessions', GRANTS: 'PortalGrants'
};
var DIR_HEADERS = {
  Institutions: ['institutionId', 'name', 'shortName', 'active', 'sortOrder', 'createdAt', 'updatedAt'],
  Groups: ['groupId', 'institutionId', 'name', 'academicYear', 'linkCode', 'active', 'createdAt', 'updatedAt'],
  Modules: ['moduleId', 'title', 'subtitle', 'url', 'storagePrefix', 'icon', 'color', 'publishedVersion', 'active', 'createdAt', 'updatedAt'],
  Deliveries: ['deliveryId', 'groupId', 'moduleId', 'backendModule', 'status', 'openFrom', 'openUntil', 'active', 'createdAt', 'updatedAt'],
  TeacherAssignments: ['assignmentId', 'userId', 'deliveryId', 'grantedBy', 'grantedAt'],
  ModuleContentRoles: ['userId', 'moduleId', 'role', 'grantedBy', 'grantedAt'],
  // pwSalt/pwHash/pwIter/mustChange: the member's current password HASH (never the password, never returned), so accounts can be
  // created in modules delivered to the group later
  StudentMemberships: ['membershipId', 'groupId', 'studentId', 'name', 'email', 'active', 'createdAt', 'updatedAt', 'pwSalt', 'pwHash', 'pwIter', 'mustChange'],
  PortalUsers: ['userId', 'role', 'username', 'name', 'email', 'pwSalt', 'pwHash', 'pwIter', 'active', 'mustChange', 'failed', 'lockedUntil', 'createdAt', 'updatedAt', 'lastLogin'],
  PortalSessions: ['tokenHash', 'userId', 'role', 'createdAt', 'expiresAt'],
  PortalGrants: ['userId', 'deliveryId', 'backendModule', 'tokenHash', 'sessionHash', 'createdAt', 'expiresAt']
};
var DIR_TEXT = {
  Institutions: ['institutionId', 'name', 'shortName'],
  Groups: ['groupId', 'institutionId', 'name', 'academicYear', 'linkCode'],
  Modules: ['moduleId', 'title', 'subtitle', 'url', 'storagePrefix', 'icon', 'color', 'publishedVersion'],
  Deliveries: ['deliveryId', 'groupId', 'moduleId', 'backendModule', 'status'],
  TeacherAssignments: ['assignmentId', 'userId', 'deliveryId', 'grantedBy'],
  ModuleContentRoles: ['userId', 'moduleId', 'role', 'grantedBy'],
  StudentMemberships: ['membershipId', 'groupId', 'studentId', 'name', 'email', 'pwSalt', 'pwHash'],
  PortalUsers: ['userId', 'role', 'username', 'name', 'email', 'pwSalt', 'pwHash'],
  PortalSessions: ['tokenHash', 'userId', 'role'],
  PortalGrants: ['userId', 'deliveryId', 'backendModule', 'tokenHash', 'sessionHash']
};
var DIR_KINDS = {
  institution: { sheet: 'Institutions', key: 'institutionId', prefix: 'INS' },
  group: { sheet: 'Groups', key: 'groupId', prefix: 'GRP' },
  module: { sheet: 'Modules', key: 'moduleId', prefix: '' },
  delivery: { sheet: 'Deliveries', key: 'deliveryId', prefix: 'DLV' }
};
var DIR_MODULE_ID_RE = /^[a-z0-9]{2,30}$/;   // no "-": the backend reads "<module>-<group>" by splitting at the first "-"

/** Registers the directory sheets with the shared helpers (readAll_/appendRow_/updateRow_) and creates any missing
 *  sheet with its header row. Existing sheets are never modified (a short header row is only extended). */
function dirInit_() {
  var ss = getSS_(), created = {};
  Object.keys(DIR_HEADERS).forEach(function (name) {
    HEADERS[name] = DIR_HEADERS[name]; TEXT_COLS[name] = DIR_TEXT[name];
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); created[name] = true; }
    if (sh.getLastRow() === 0) { sh.appendRow(DIR_HEADERS[name]); sh.setFrozenRows(1); }
    else if (sh.getLastColumn() < DIR_HEADERS[name].length) sh.getRange(1, 1, 1, DIR_HEADERS[name].length).setValues([DIR_HEADERS[name]]);
  });
  // first run: the module list starts as a copy of the current front-page list (which stays the front page's source)
  if (created[DIR.MOD] || !readAll_(DIR.MOD).length) {
    var now = Date.now();
    portalRegistry_().forEach(function (m) {
      if (!DIR_MODULE_ID_RE.test(m.moduleKey) || dirFind_(DIR.MOD, 'moduleId', m.moduleKey)) return;
      appendRow_(DIR.MOD, { moduleId: m.moduleKey, title: m.title, subtitle: m.subtitle, url: m.url, storagePrefix: m.storagePrefix, icon: m.icon,
        color: m.color, publishedVersion: '', active: true, createdAt: now, updatedAt: now });
    });
  }
}
function dirAll_(sheet) {
  return readAll_(sheet).filter(function (r) { return String(r[DIR_HEADERS[sheet][0]] || '') !== ''; }).map(function (r) {
    var o = {}; DIR_HEADERS[sheet].forEach(function (h) { o[h] = r[h]; }); o._row = r._row;
    if ('active' in o) o.active = isTrue_(o.active);
    return o;
  });
}
function dirFind_(sheet, key, val) { var rows = dirAll_(sheet); for (var i = 0; i < rows.length; i++) if (String(rows[i][key]) === String(val)) return rows[i]; return null; }
function dirPublic_(r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; }); return o; }
function dirNewId_(prefix, sheet, key) {
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (var t = 0; t < 20; t++) {
    var h = randomHex_(8), id = prefix + '-';
    for (var i = 0; i < 6; i++) id += A.charAt(parseInt(h.substr(i * 2, 2), 16) % A.length);
    if (!dirFind_(sheet, key, id)) return id;
  }
  throw new Error('Could not create a unique id.');
}
function dirStr_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
function dirTime_(v) { if (v === '' || v == null) return ''; var n = Number(v); if (!isFinite(n) || n <= 0) { n = Date.parse(String(v)); } return isFinite(n) && n > 0 ? n : null; }
function dirErr_(msg) { return { ok: false, code: 'invalid', error: msg }; }

function dirGet_() {
  dirInit_();
  var out = { ok: true, version: PORTAL_VERSION };
  out.institutions = dirAll_(DIR.INST).map(dirPublic_);
  out.groups = dirAll_(DIR.GROUP).map(dirPublic_);
  out.modules = dirAll_(DIR.MOD).map(dirPublic_);
  out.deliveries = dirAll_(DIR.DELIV).map(dirPublic_);
  return out;
}

function dirSave_(p) {
  var kind = String(p.kind || ''), K = DIR_KINDS[kind], rec = p.record || {};
  if (!K) return dirErr_('Unknown record type.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    dirInit_();
    var id = dirStr_(rec[K.key], 40), cur = id ? dirFind_(K.sheet, K.key, id) : null, now = Date.now();
    if (id && !cur && kind !== 'module') return dirErr_('This record no longer exists — reload the directory.');
    if (kind === 'module' && p.create && cur) return dirErr_('A module with the id “' + id + '” already exists.');
    if (kind === 'module' && !p.create && !cur) return dirErr_('This module no longer exists — reload the directory.');
    var r = cur ? dirPublic_(cur) : {}, err = null;
    if (kind === 'institution') err = dirInst_(r, rec, cur);
    else if (kind === 'group') err = dirGroup_(r, rec, cur);
    else if (kind === 'module') err = dirModule_(r, rec, cur, id);
    else err = dirDelivery_(r, rec, cur);
    if (err) return dirErr_(err);
    r.updatedAt = now;
    if (cur) updateRow_(K.sheet, cur._row, r);
    else {
      if (kind !== 'module') r[K.key] = dirNewId_(K.prefix, K.sheet, K.key);
      r.createdAt = now; if (!('active' in rec)) r.active = true; else r.active = !!rec.active;
      appendRow_(K.sheet, r);
      if (kind === 'delivery') rosterSyncLocked_(r.groupId);   // the group's members get their account in the new delivery
    }
    return { ok: true, kind: kind, record: dirPublic_(dirFind_(K.sheet, K.key, r[K.key])) };
  } finally { lock.releaseLock(); }
}
function dirInst_(r, rec, cur) {
  var name = dirStr_(rec.name, 120); if (!name) return 'Enter the institution name.';
  var clash = dirAll_(DIR.INST).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!cur || x.institutionId !== cur.institutionId); });
  if (clash.length) return 'An institution with this name already exists.';
  r.name = name; r.shortName = dirStr_(rec.shortName, 40);
  var so = Number(rec.sortOrder); r.sortOrder = isFinite(so) ? Math.round(so) : 0;
  if (!cur) r.active = true;
  return null;
}
function dirGroup_(r, rec, cur) {
  var instId = cur ? r.institutionId : dirStr_(rec.institutionId, 40);
  if (!cur && !dirFind_(DIR.INST, 'institutionId', instId)) return 'Choose the institution this group belongs to.';
  if (cur && rec.institutionId != null && dirStr_(rec.institutionId, 40) !== r.institutionId) return 'A group cannot be moved to another institution — create a new group instead.';
  var name = dirStr_(rec.name, 80); if (!name) return 'Enter the group name (e.g. Group A).';
  var year = dirStr_(rec.academicYear, 20);
  var code = cur ? r.linkCode : dirStr_(rec.linkCode, 24);
  if (cur && rec.linkCode != null && dirStr_(rec.linkCode, 24) !== r.linkCode) {
    if (dirAll_(DIR.DELIV).some(function (d) { return d.groupId === cur.groupId; })) return 'The link code cannot change once the group has a delivery (its data is stored under it).';
    code = dirStr_(rec.linkCode, 24);
  }
  if (!PORTAL_GROUP_RE.test(code)) return 'The link code may use only letters, digits, "-" and "_" (at most 24 characters), e.g. razi-a-26.';
  var groups = dirAll_(DIR.GROUP).filter(function (g) { return !cur || g.groupId !== cur.groupId; });
  if (groups.some(function (g) { return String(g.linkCode).toLowerCase() === code.toLowerCase(); })) return 'This link code is already used by another group.';
  if (groups.some(function (g) { return g.institutionId === instId && g.name.toLowerCase() === name.toLowerCase() && String(g.academicYear) === year; }))
    return 'This institution already has a group with this name for this academic year.';
  r.institutionId = instId; r.name = name; r.academicYear = year; r.linkCode = code;
  return null;
}
function dirModule_(r, rec, cur, id) {
  if (!cur) {
    if (!DIR_MODULE_ID_RE.test(id)) return 'The module id must be 2–30 lowercase letters/digits, no spaces or "-" (e.g. cellinjury). It is the module\'s key on the backend and cannot change later.';
    r.moduleId = id;
  }
  var title = dirStr_(rec.title, 80); if (!title) return 'Enter the module title.';
  var url = dirStr_(rec.url, 400); if (url && !/^https:\/\//.test(url)) return 'The link must start with https://';
  var color = String(rec.color || '');
  r.title = title; r.subtitle = dirStr_(rec.subtitle, 120); r.url = url;
  r.storagePrefix = dirStr_(rec.storagePrefix, 20).replace(/[^A-Za-z0-9_]/g, '');
  r.icon = dirStr_(rec.icon, 8); r.color = /^#[0-9a-fA-F]{6}$/.test(color) ? color : (r.color || '#0f2a4a');
  if (!cur) r.publishedVersion = '';
  return null;
}
var DIR_STATUSES = { available: 1, ready: 1, soon: 1 };
function dirDelivery_(r, rec, cur) {
  if (!cur) {
    var g = dirFind_(DIR.GROUP, 'groupId', dirStr_(rec.groupId, 40)), m = dirFind_(DIR.MOD, 'moduleId', dirStr_(rec.moduleId, 40));
    if (!g) return 'Choose the group.';
    if (!m) return 'Choose the module.';
    var all = dirAll_(DIR.DELIV);
    if (all.some(function (d) { return d.groupId === g.groupId && d.moduleId === m.moduleId; })) return 'This module is already delivered to this group.';
    // the storage name: normally "<module>-<link code>"; the plain "<module>" adopts the storage used without a group link
    var bm = rec.adoptPlain ? m.moduleId : m.moduleId + '-' + g.linkCode;
    if (all.some(function (d) { return d.backendModule === bm; })) return 'The storage “' + bm + '” is already used by another delivery.';
    r.groupId = g.groupId; r.moduleId = m.moduleId; r.backendModule = bm;
  } else {
    var fixed = ['groupId', 'moduleId', 'backendModule'].some(function (k) { return rec[k] != null && dirStr_(rec[k], 80) !== String(r[k]); });
    if (fixed) return 'The group, module and storage of a delivery cannot change (its data is stored there). Create a new delivery instead.';
  }
  var st = String(rec.status || r.status || 'soon'); if (!DIR_STATUSES[st]) return 'Unknown status.';
  var from = dirTime_(rec.openFrom != null ? rec.openFrom : r.openFrom), until = dirTime_(rec.openUntil != null ? rec.openUntil : r.openUntil);
  if (from === null || until === null) return 'The dates are not valid.';
  if (from && until && until <= from) return 'The closing date must be after the opening date.';
  r.status = st; r.openFrom = from; r.openUntil = until;
  return null;
}

function dirSetActive_(p) {
  var K = DIR_KINDS[String(p.kind || '')]; if (!K) return dirErr_('Unknown record type.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    dirInit_();
    var cur = dirFind_(K.sheet, K.key, dirStr_(p.id, 40)); if (!cur) return dirErr_('This record no longer exists — reload the directory.');
    var r = dirPublic_(cur); r.active = !!p.active; r.updatedAt = Date.now();
    updateRow_(K.sheet, cur._row, r);
    if (!p.active) {   // teachers lose their open module sessions for everything under this record at once
      var key = String(cur[K.key]), kind = String(p.kind), groups = {};
      if (kind === 'institution') dirAll_(DIR.GROUP).forEach(function (g) { if (g.institutionId === key) groups[g.groupId] = 1; });
      var dls = {}; dirAll_(DIR.DELIV).forEach(function (d) {
        if ((kind === 'delivery' && d.deliveryId === key) || (kind === 'group' && d.groupId === key) || (kind === 'module' && d.moduleId === key) || (kind === 'institution' && groups[d.groupId])) dls[d.deliveryId] = 1;
      });
      revokeGrants_(function (gr) { return dls[gr.deliveryId]; });
    }
    return { ok: true, record: dirPublic_(dirFind_(K.sheet, K.key, cur[K.key])) };
  } finally { lock.releaseLock(); }
}

/** READ-ONLY: which storage names exist in the data, with counts. Reads only the "module" column of each sheet. */
function dirScan_() {
  dirInit_();
  var out = {}, ss = getSS_();
  var count = function (sheetName, field) {
    var sh = ss.getSheetByName(sheetName); if (!sh || !HEADERS[sheetName]) return;
    var col = HEADERS[sheetName].indexOf('module') + 1, last = sh.getLastRow(); if (col < 1 || last < 2) return;
    sh.getRange(2, col, last - 1, 1).getValues().forEach(function (v) {
      var name = String(v[0] == null ? '' : v[0]).trim(); if (!name || name === PORTAL_MODULE) return;
      var o = out[name] = out[name] || { backendModule: name, students: 0, results: 0, assessRecords: 0, attendanceSessions: 0, contentRows: 0 };
      o[field]++;
    });
  };
  count(SHEETS.STUDENTS, 'students'); count(SHEETS.RESULTS, 'results'); count(SHEETS.ASSESS, 'assessRecords');
  count(SHEETS.ATT_SESSIONS, 'attendanceSessions'); count(SHEETS.CONTENT, 'contentRows');
  var byBm = {}; dirAll_(DIR.DELIV).forEach(function (d) { byBm[d.backendModule] = d.deliveryId; });
  var list = Object.keys(out).sort().map(function (k) {
    var o = out[k], i = k.indexOf('-');
    o.moduleId = i < 0 ? k : k.slice(0, i); o.linkCode = i < 0 ? '' : k.slice(i + 1); o.deliveryId = byBm[k] || '';
    return o;
  });
  return { ok: true, storages: list };
}

/* ======================================================================
 * Group front pages (Step 2). The link code only SELECTS the group; it never grants anything.
 * ====================================================================== */
/** Registers the directory sheets without creating any (public requests never create sheets). */
function dirReadable_() {
  var ss = getSS_();
  Object.keys(DIR_HEADERS).forEach(function (name) { HEADERS[name] = DIR_HEADERS[name]; TEXT_COLS[name] = DIR_TEXT[name]; });
  return [DIR.INST, DIR.GROUP, DIR.MOD, DIR.DELIV].every(function (n) { var sh = ss.getSheetByName(n); return sh && sh.getLastRow() > 0; });
}
var PORTAL_NOGROUP = { ok: false, code: 'nogroup', error: 'This group link is not valid. Please check the link your teacher gave you.' };
/** The group behind a link code + its deliveries as front-page cards, or null if the code is unknown or inactive. */
function portalGroup_(code) {
  code = String(code || '').trim();
  if (!PORTAL_GROUP_RE.test(code) || !dirReadable_()) return null;
  var groups = dirAll_(DIR.GROUP), g = null;
  for (var i = 0; i < groups.length; i++) if (groups[i].linkCode === code) { g = groups[i]; break; }
  if (!g) for (var j = 0; j < groups.length; j++) if (String(groups[j].linkCode).toLowerCase() === code.toLowerCase()) { g = groups[j]; break; }
  if (!g || !g.active) return null;
  var inst = dirFind_(DIR.INST, 'institutionId', g.institutionId);
  if (!inst || !inst.active) return null;
  var mods = {}; dirAll_(DIR.MOD).forEach(function (m) { mods[m.moduleId] = m; });
  var now = Date.now(), order = dirAll_(DIR.MOD).map(function (m) { return m.moduleId; });
  var list = dirAll_(DIR.DELIV).filter(function (d) { return d.groupId === g.groupId && d.active && mods[d.moduleId] && mods[d.moduleId].active; })
    .sort(function (a, b) { return order.indexOf(a.moduleId) - order.indexOf(b.moduleId); })
    .map(function (d) {
      var m = mods[d.moduleId], st = d.status, note = '';
      if (st === 'available' && d.openFrom && now < Number(d.openFrom)) { st = 'ready'; note = 'opens'; }
      else if (st === 'available' && d.openUntil && now > Number(d.openUntil)) { st = 'closed'; }
      return {
        id: m.moduleId, title: m.title, subtitle: m.subtitle, icon: m.icon || '📘', color: m.color || '#0f2a4a', url: m.url,
        moduleKey: m.moduleId, handoff: 'neo', storagePrefix: m.storagePrefix, backend: '',
        group: d.backendModule === m.moduleId ? '' : String(d.backendModule).slice(m.moduleId.length + 1),
        status: st, opensAt: note === 'opens' ? Number(d.openFrom) : 0, closesAt: d.openUntil ? Number(d.openUntil) : 0,
        _storage: d.backendModule
      };
    });
  return { group: g, institution: inst, modules: list };
}
function portalGroupInfo_(p) {
  var G = portalGroup_(p.g);
  if (!G) return PORTAL_NOGROUP;
  return { ok: true, version: PORTAL_VERSION, serverTime: Date.now(),
    group: { name: G.group.name, academicYear: G.group.academicYear, linkCode: G.group.linkCode },
    institution: { name: G.institution.name, shortName: G.institution.shortName },
    modules: G.modules.map(function (m) { var o = {}; Object.keys(m).forEach(function (k) { if (k !== '_storage') o[k] = m[k]; }); return o; }) };
}
function portalGroupCheck_(p) {
  var G = portalGroup_(p.g);
  if (!G) return PORTAL_NOGROUP;
  // only this group's open deliveries, each checked in its OWN storage
  var targets = G.modules.filter(function (m) { return m.status === 'available'; }).map(function (m) { return { key: m.moduleKey, module: m._storage }; });
  if (!targets.length) return { ok: false, code: 'noopen', error: 'No module is open for this group yet.' };
  // only an active MEMBER of this group is checked at all (otherwise: the same generic refusal as a wrong password)
  if (!rosterMember_(G.group.groupId, normUser_(p.username), true)) targets = [];
  return portalAccountCheck_(p, targets);
}

/* ======================================================================
 * Group rosters (Step 3).
 * ====================================================================== */
function rosterWrite_(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { dirInit_(); return fn(); } finally { lock.releaseLock(); }
}
function rosterMember_(groupId, studentId, activeOnly) {
  if (!dirReadable_()) return null;
  var sh = getSS_().getSheetByName(DIR.MEMB); if (!sh || sh.getLastRow() < 1) return null;
  var rows = dirAll_(DIR.MEMB);
  for (var i = 0; i < rows.length; i++) if (rows[i].groupId === groupId && rows[i].studentId === studentId) return activeOnly && !rows[i].active ? null : rows[i];
  return null;
}
/** The storages (backendModule) of a group's deliveries that use student accounts. */
function rosterStorages_(groupId) {
  return dirAll_(DIR.DELIV).filter(function (d) { return d.groupId === groupId && studentAuthOn_(d.backendModule); })
    .map(function (d) { return { storage: d.backendModule, moduleId: d.moduleId, active: d.active }; });
}
/** Index of the Students sheet: "<storage>|<username>" → row. */
function rosterAccounts_() { var idx = {}; readAll_(SHEETS.STUDENTS).forEach(function (r) { idx[r.module + '|' + r.username] = r; }); return idx; }
function rosterNewAccount_(storage, m, pw, now) {
  appendRow_(SHEETS.STUDENTS, { module: storage, username: m.studentId, name: m.name, email: m.email || '', pwSalt: pw.salt, pwHash: pw.hash, pwIter: pw.iter,
    active: !!m.active, mustChange: !!pw.mustChange, failed: 0, lockedUntil: '', createdAt: now, updatedAt: now, lastLogin: '' });
}
function rosterPw_(plain, mustChange) { var salt = randomHex_(16); return { salt: salt, hash: hashIter_(plain, salt, PW_ITER), iter: PW_ITER, mustChange: mustChange }; }
function rosterCleanStudent_(it) {
  var id = normUser_(it.studentId != null ? it.studentId : it.username), name = String(it.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(it.email || '').trim().toLowerCase().slice(0, 120);
  if (!validUser_(id)) return { error: 'Student ID “' + (it.studentId || it.username || '') + '” is not valid — use 2–64 letters, digits, dot, dash, underscore or @.' };
  if (name.length < 2) return { error: 'Enter the student’s name (' + id + ').' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'The email for ' + id + ' is not valid.' };
  return { studentId: id, name: name, email: email };
}
function rosterGroupOr_(groupId) { var g = dirFind_(DIR.GROUP, 'groupId', String(groupId || '')); return g; }

function rosterGet_(p) {
  dirInit_();
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var st = rosterStorages_(g.groupId), idx = rosterAccounts_(), now = Date.now();
  var members = dirAll_(DIR.MEMB).filter(function (m) { return m.groupId === g.groupId; }).map(function (m) {
    var acc = {}, hashes = {};
    st.forEach(function (x) {
      var a = idx[x.storage + '|' + m.studentId];
      if (!a) { acc[x.moduleId] = 'missing'; return; }
      hashes[a.pwSalt + ':' + a.pwHash] = 1;
      acc[x.moduleId] = !isTrue_(a.active) ? 'inactive' : Number(a.lockedUntil) > now ? 'locked' : isTrue_(a.mustChange) ? 'mustchange' : 'ok';
    });
    var none = st.length && st.every(function (x) { return acc[x.moduleId] === 'missing'; });
    return { studentId: m.studentId, name: m.name, email: m.email, active: m.active, accounts: acc, samePassword: Object.keys(hashes).length <= 1,
      needsPassword: !!(none && !m.pwHash) };
  }).sort(function (a, b) { return a.studentId.localeCompare(b.studentId); });
  var known = {}; members.forEach(function (m) { known[m.studentId] = 1; });
  var unlisted = {};
  st.forEach(function (x) { Object.keys(idx).forEach(function (k) { var a = idx[k]; if (a.module === x.storage && !known[a.username]) unlisted[a.username] = 1; }); });
  return { ok: true, group: dirPublic_(g), modules: st.map(function (x) { return { moduleId: x.moduleId, storage: x.storage, active: x.active }; }), members: members, unlistedAccounts: Object.keys(unlisted).length };
}

function rosterAdd_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var list = (Array.isArray(p.students) ? p.students : []).slice(0, 500), st = rosterStorages_(g.groupId), idx = rosterAccounts_(), now = Date.now();
  var mustChange = p.mustChange !== false, out = [];
  list.forEach(function (it) {
    var c = rosterCleanStudent_(it || {}); if (c.error) { out.push({ ok: false, input: String((it && (it.studentId || it.username)) || ''), error: c.error }); return; }
    if (rosterMember_(g.groupId, c.studentId)) { out.push({ ok: false, studentId: c.studentId, error: c.studentId + ' is already in this group.' }); return; }
    var given = String(it.password || '');
    if (given && given.length < STU_MIN_PW) { out.push({ ok: false, studentId: c.studentId, error: 'The password for ' + c.studentId + ' must be at least ' + STU_MIN_PW + ' characters.' }); return; }
    var plain = given || genTempPassword_(), pw = rosterPw_(plain, given ? mustChange : true);
    var m = { membershipId: dirNewId_('MEM', DIR.MEMB, 'membershipId'), groupId: g.groupId, studentId: c.studentId, name: c.name, email: c.email, active: true, createdAt: now, updatedAt: now,
      pwSalt: pw.salt, pwHash: pw.hash, pwIter: pw.iter, mustChange: !!pw.mustChange };
    appendRow_(DIR.MEMB, m);
    // the password given here is THE password for all of the group's modules — also for an account that already existed
    var updated = st.filter(function (x) { return idx[x.storage + '|' + c.studentId]; }).map(function (x) { return x.moduleId; });
    rosterApplyPw_(g.groupId, dirFind_(DIR.MEMB, 'membershipId', m.membershipId), pw, null, null);
    out.push({ ok: true, studentId: c.studentId, name: c.name, tempPassword: given ? '' : plain, updatedExisting: updated });
  });
  return { ok: true, added: out.filter(function (r) { return r.ok; }).length, results: out };
}

function rosterSave_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var cur = rosterMember_(g.groupId, normUser_(p.studentId)); if (!cur) return dirErr_('This student is not in the group.');
  var c = rosterCleanStudent_({ studentId: cur.studentId, name: p.name, email: p.email }); if (c.error) return dirErr_(c.error);
  var now = Date.now(), m = dirPublic_(cur); m.name = c.name; m.email = c.email; m.updatedAt = now;
  updateRow_(DIR.MEMB, cur._row, m);
  var idx = rosterAccounts_();
  rosterStorages_(g.groupId).forEach(function (x) {
    var a = idx[x.storage + '|' + cur.studentId]; if (!a) return;
    a.name = c.name; a.email = c.email; a.updatedAt = now; updateRow_(SHEETS.STUDENTS, a._row, a);
    revokeStudentSessions_(x.storage, a.username, '__none__');   // name/email are cached in sessions (as Code.gs does)
  });
  return { ok: true };
}

function rosterSetActive_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var cur = rosterMember_(g.groupId, normUser_(p.studentId)); if (!cur) return dirErr_('This student is not in the group.');
  var on = !!p.active, now = Date.now(), m = dirPublic_(cur); m.active = on; m.updatedAt = now;
  updateRow_(DIR.MEMB, cur._row, m);
  var idx = rosterAccounts_();
  rosterStorages_(g.groupId).forEach(function (x) {
    var a = idx[x.storage + '|' + cur.studentId]; if (!a) return;
    a.active = on; a.updatedAt = now; updateRow_(SHEETS.STUDENTS, a._row, a);
    if (!on) revokeStudentSessions_(x.storage, a.username, '__none__');   // loses access immediately, in every module of the group
  });
  return { ok: true };
}

function rosterResetPassword_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var cur = rosterMember_(g.groupId, normUser_(p.studentId)); if (!cur) return dirErr_('This student is not in the group.');
  var given = String(p.password || '');
  if (given && given.length < STU_MIN_PW) return dirErr_('The password must be at least ' + STU_MIN_PW + ' characters.');
  var plain = given || genTempPassword_();
  rosterApplyPw_(g.groupId, cur, rosterPw_(plain, true), null, null);
  return { ok: true, studentId: cur.studentId, tempPassword: given ? '' : plain };
}
/** Sets one password (salt+hash) on the member's account in EVERY delivery of the group (creating missing accounts) and
 *  ends their sessions there — except keep.th in keep.storage (the session that made the change). */
function rosterApplyPw_(groupId, member, pw, keepStorage, keepHash) {
  var idx = rosterAccounts_(), now = Date.now();
  if (member && member._row) {
    var mr = dirPublic_(member); mr.pwSalt = pw.salt; mr.pwHash = pw.hash; mr.pwIter = pw.iter; mr.mustChange = !!pw.mustChange; mr.updatedAt = now;
    updateRow_(DIR.MEMB, member._row, mr);
  }
  rosterStorages_(groupId).forEach(function (x) {
    var a = idx[x.storage + '|' + member.studentId];
    if (!a) { rosterNewAccount_(x.storage, member, pw, now); return; }
    a.pwSalt = pw.salt; a.pwHash = pw.hash; a.pwIter = pw.iter; a.mustChange = !!pw.mustChange; a.failed = 0; a.lockedUntil = ''; a.updatedAt = now;
    updateRow_(SHEETS.STUDENTS, a._row, a);
    revokeStudentSessions_(x.storage, a.username, x.storage === keepStorage ? keepHash : '__none__');
  });
}

/** Creates each active member's missing accounts, copying the password from their most recently updated account in the group. */
function rosterSyncLocked_(groupId) { return rosterSync_(groupId, true); }
function rosterSync_(groupId, quiet) {
  var g = rosterGroupOr_(groupId); if (!g) return dirErr_('Choose a group.');
  var st = rosterStorages_(g.groupId), idx = rosterAccounts_(), now = Date.now(), created = 0, needReset = [];
  dirAll_(DIR.MEMB).filter(function (m) { return m.groupId === g.groupId; }).forEach(function (m) {
    var have = st.map(function (x) { return idx[x.storage + '|' + m.studentId]; }).filter(Boolean)
      .sort(function (a, b) { return Number(b.updatedAt || 0) - Number(a.updatedAt || 0); });
    var missing = st.filter(function (x) { return !idx[x.storage + '|' + m.studentId]; });
    if (!missing.length) return;
    var pw;
    if (m.pwHash) pw = { salt: m.pwSalt, hash: m.pwHash, iter: Number(m.pwIter) || PW_ITER, mustChange: isTrue_(m.mustChange) };
    else if (have.length) { var src = have[0]; pw = { salt: src.pwSalt, hash: src.pwHash, iter: Number(src.pwIter) || PW_ITER, mustChange: isTrue_(src.mustChange) }; }
    else { needReset.push(m.studentId); return; }
    missing.forEach(function (x) { rosterNewAccount_(x.storage, m, pw, now); created++; });
  });
  return { ok: true, created: created, needPasswordReset: needReset };
}

/** Adds the existing accounts of the group's deliveries (made in a module's Teacher Portal) to the roster. Nothing else changes. */
function rosterImport_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var st = rosterStorages_(g.groupId), names = {}, now = Date.now(), added = 0;
  st.forEach(function (x) { readAll_(SHEETS.STUDENTS).forEach(function (a) {
    if (a.module !== x.storage) return;
    var o = names[a.username] = names[a.username] || { name: a.name, email: a.email, active: false, src: null };
    if (isTrue_(a.active)) o.active = true;
    if (!o.src || Number(a.updatedAt || 0) > Number(o.src.updatedAt || 0)) o.src = a;
  }); });
  Object.keys(names).sort().forEach(function (id) {
    if (rosterMember_(g.groupId, id)) return;
    var src = names[id].src;
    appendRow_(DIR.MEMB, { membershipId: dirNewId_('MEM', DIR.MEMB, 'membershipId'), groupId: g.groupId, studentId: id, name: names[id].name || id, email: names[id].email || '', active: names[id].active, createdAt: now, updatedAt: now,
      pwSalt: src.pwSalt, pwHash: src.pwHash, pwIter: Number(src.pwIter) || PW_ITER, mustChange: isTrue_(src.mustChange) });
    added++;
  });
  return { ok: true, added: added };
}

/* ---------------- one password across the group's modules ---------------- */
function rosterPwRules_(np, username, old) {
  if (np.length < STU_MIN_PW) return 'The new password must be at least ' + STU_MIN_PW + ' characters.';
  if (normUser_(np) === username) return 'The new password must not be your student ID.';
  if (np === old) return 'Choose a password different from the current one.';
  return null;
}
/** The student's own change on the group page: current password (correct in one of the group's modules) → new password everywhere. */
function portalGroupSetPassword_(p) {
  var G = portalGroup_(p.g); if (!G) return PORTAL_NOGROUP;
  var username = normUser_(p.username), old = String(p.password || ''), np = String(p.newPassword || '');
  var c = CacheService.getScriptCache(), fk = 'portalfail:' + sha256Hex_(username), fails = Number(c.get(fk) || 0);
  if (fails >= PORTAL_MAX_FAILS) return { ok: false, code: 'locked', error: 'Too many unsuccessful sign-ins. Please wait 15 minutes and try again.' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var m = rosterMember_(G.group.groupId, username, true), idx = rosterAccounts_(), now = Date.now();
    var okOld = m && rosterStorages_(G.group.groupId).some(function (x) {
      var a = idx[x.storage + '|' + username];
      return a && isTrue_(a.active) && !(Number(a.lockedUntil) > now) && safeEq_(hashIter_(old, a.pwSalt, Number(a.pwIter) || PW_ITER), a.pwHash);
    });
    if (!okOld) { c.put(fk, String(fails + 1), PORTAL_FAIL_WINDOW_S); return { ok: false, code: 'badlogin', error: 'Your current password is incorrect.' }; }
    var rule = rosterPwRules_(np, username, old); if (rule) return { ok: false, error: rule };
    rosterApplyPw_(G.group.groupId, m, rosterPw_(np, false), null, null);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
/** studentChangePassword inside a module whose storage belongs to a group delivery of a member: the same checks and messages as
 *  Code.gs, then the new password is set in all of the group's modules. Anything else → null (Code.gs handles it unchanged). */
function rosterModulePassword_(module, p) {
  try { if (!dirReadable_()) return null; } catch (e) { return null; }
  var d = null; dirAll_(DIR.DELIV).some(function (x) { if (x.backendModule === module) { d = x; return true; } return false; });
  if (!d) return null;
  var st = studentFromSession_(module, p.stoken); if (!st) return null;   // Code.gs answers "please sign in"
  var m = rosterMember_(d.groupId, st.username, true); if (!m) return null;
  var xl = typeof exTeachingLock_ === 'function' ? exTeachingLock_(module, st.username) : null; if (xl) return xl;
  var np = String(p.newPassword || '');
  if (np.length < STU_MIN_PW) return { ok: false, error: 'The new password must be at least ' + STU_MIN_PW + ' characters.' };
  if (normUser_(np) === st.username) return { ok: false, error: 'The new password must not be your student ID.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, st.username); if (!s || !isTrue_(s.active)) return { ok: false, code: 'studentauth', error: 'Please sign in again.' };
    if (!safeEq_(hashIter_(String(p.oldPassword || ''), s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) return { ok: false, error: 'Your current password is incorrect.' };
    if (np === String(p.oldPassword || '')) return { ok: false, error: 'Choose a password different from the current one.' };
    rosterApplyPw_(d.groupId, m, rosterPw_(np, false), module, st.th);
    stuCache_().remove('stok:' + st.th);
    return { ok: true, contentKey: contentKey_(module) };
  } finally { lock.releaseLock(); }
}

/** Bulk reset (one pass over the sheets, so a whole class takes seconds). Every member in scope gets a temporary password
 *  (must choose their own at the next sign-in) in all of the group's modules; their open sessions end. */
function rosterResetMany_(p) {
  var g = rosterGroupOr_(p.groupId); if (!g) return dirErr_('Choose a group.');
  var scope = p.scope === 'all' ? 'all' : 'temp', shared = String(p.password || '');
  if (shared && shared.length < STU_MIN_PW) return dirErr_('The password must be at least ' + STU_MIN_PW + ' characters.');
  var st = rosterStorages_(g.groupId), idx = rosterAccounts_(), now = Date.now();
  var members = dirAll_(DIR.MEMB).filter(function (m) {
    if (m.groupId !== g.groupId || !m.active) return false;
    if (scope === 'all') return true;
    // still on a temporary password: the roster says so, or one of the accounts does, or there is no account/password yet
    var accs = st.map(function (x) { return idx[x.storage + '|' + m.studentId]; }).filter(Boolean);
    return isTrue_(m.mustChange) || !m.pwHash || !accs.length || accs.some(function (a) { return isTrue_(a.mustChange); });
  }).slice(0, 1000);
  var touched = {}, out = [];
  members.forEach(function (m) {
    var plain = shared || genTempPassword_(), pw = rosterPw_(plain, true);
    var mr = dirPublic_(m); mr.pwSalt = pw.salt; mr.pwHash = pw.hash; mr.pwIter = pw.iter; mr.mustChange = true; mr.updatedAt = now;
    updateRow_(DIR.MEMB, m._row, mr);
    st.forEach(function (x) {
      var a = idx[x.storage + '|' + m.studentId];
      if (!a) { rosterNewAccount_(x.storage, m, pw, now); return; }
      a.pwSalt = pw.salt; a.pwHash = pw.hash; a.pwIter = pw.iter; a.mustChange = true; a.failed = 0; a.lockedUntil = ''; a.updatedAt = now;
      updateRow_(SHEETS.STUDENTS, a._row, a);
      touched[x.storage + '|' + m.studentId] = 1;
    });
    out.push({ ok: true, studentId: m.studentId, name: m.name, tempPassword: shared ? '' : plain });
  });
  // end their sessions: one read of the sessions sheet, deleting from the bottom
  var rows = readAll_(SHEETS.STU_SESSIONS), c = stuCache_();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (touched[r.module + '|' + r.username]) { c.remove('stok:' + r.tokenHash); deleteRow_(SHEETS.STU_SESSIONS, r._row); }
  }
  return { ok: true, scope: scope, shared: !!shared, count: out.length, results: out };
}

/** Modules that became available after the student signed in: the student proves who they are with a valid session of one
 *  of this group's modules; sessions are then opened in the group's other open modules where they have an active account. */
function portalGroupRefresh_(p) {
  var G = portalGroup_(p.g); if (!G) return PORTAL_NOGROUP;
  var have = p.sessions && typeof p.sessions === 'object' ? p.sessions : {}, st = null, now = Date.now();
  G.modules.some(function (m) { var t = have[m.moduleKey]; if (t && !st) st = studentFromSession_(m._storage, String(t)); return !!st; });
  if (!st || !rosterMember_(G.group.groupId, st.username, true)) return { ok: false, code: 'studentauth', error: 'Please sign in again.' };
  var remember = !!p.remember, exp = Math.min(Number(st.exp) || now + STU_TTL_MS, now + (remember ? STU_REMEMBER_TTL_MS : STU_TTL_MS)), out = {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    G.modules.filter(function (m) { return m.status === 'available' && !have[m.moduleKey]; }).forEach(function (m) {
      var s = findStudent_(m._storage, st.username);
      if (!s) { out[m.moduleKey] = { access: false, reason: 'notregistered' }; return; }
      if (!isTrue_(s.active)) { out[m.moduleKey] = { access: false, reason: 'inactive' }; return; }
      if (Number(s.lockedUntil) > now) { out[m.moduleKey] = { access: false, reason: 'locked' }; return; }
      var xl = typeof exTeachingLock_ === 'function' ? exTeachingLock_(m._storage, s.username) : null;
      if (xl) { out[m.moduleKey] = { access: false, reason: 'examlock', message: xl.error }; return; }
      var token = randomHex_(32);
      appendRow_(SHEETS.STU_SESSIONS, { module: m._storage, tokenHash: stuTokenHash_(token), username: s.username, createdAt: now, expiresAt: exp, remember: remember });
      out[m.moduleKey] = { access: true, token: token, expiresAt: exp, mustChange: isTrue_(s.mustChange), student: studentPublic_(s) };
    });
  } finally { lock.releaseLock(); }
  return { ok: true, modules: out };
}

/* ======================================================================
 * Personal teacher accounts (Step 4).
 * ====================================================================== */
var T_FAIL_MAX = 8, T_FAIL_WINDOW_S = 900;
function tHash_(kind, token) { return sha256Hex_(kind + '|' + token); }
function tUsers_() { return dirAll_(DIR.USERS); }
function tUserPublic_(u) { return { userId: u.userId, role: u.role, username: u.username, name: u.name, email: u.email || '', active: !!u.active, mustChange: isTrue_(u.mustChange), lastLogin: Number(u.lastLogin) || 0 }; }
function tSheetsReady_() {
  if (!dirReadable_()) return false;
  var ss = getSS_();
  return [DIR.USERS, DIR.PSES, DIR.GRANTS, DIR.ASSIGN].every(function (n) { var sh = ss.getSheetByName(n); return sh && sh.getLastRow() > 0; });
}
/** The teacher behind a session token (field ttoken), or null. */
function tSession_(token) {
  if (!token || String(token).length < 20 || !tSheetsReady_()) return null;
  var h = tHash_('pt', String(token)), now = Date.now(), row = null;
  dirAll_(DIR.PSES).some(function (r) { if (r.tokenHash === h) { row = r; return true; } return false; });
  if (!row) return null;
  if (Number(row.expiresAt) < now) { deleteRow_(DIR.PSES, row._row); return null; }
  var u = dirFind_(DIR.USERS, 'userId', row.userId);
  if (!u || !u.active) return null;
  return { user: u, row: row, hash: h };
}
function tAuthed_(p, fn) {
  var s = tSession_(p.ttoken);
  if (!s) return { ok: false, code: 'auth', error: 'Your teacher session has ended — please sign in again.' };
  return fn(s.user, s);
}
function teacherLogin_(p) {
  var username = normUser_(p.username), pw = String(p.password || ''), now = Date.now();
  var generic = { ok: false, code: 'badlogin', error: 'Incorrect username or password.' };
  if (!username || !pw) return { ok: false, code: 'badlogin', error: 'Enter your username and password.' };
  var c = CacheService.getScriptCache(), fk = 'tlfail:' + sha256Hex_(username), fails = Number(c.get(fk) || 0);
  if (fails >= T_FAIL_MAX) return { ok: false, code: 'locked', error: 'Too many unsuccessful sign-ins. Please wait 15 minutes and try again.' };
  if (!tSheetsReady_()) { Utilities.sleep(300); return generic; }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var u = null; tUsers_().some(function (x) { if (x.username === username) { u = x; return true; } return false; });
    if (!u || !safeEq_(hashIter_(pw, u.pwSalt, Number(u.pwIter) || PW_ITER), u.pwHash)) { c.put(fk, String(fails + 1), T_FAIL_WINDOW_S); Utilities.sleep(300); return generic; }
    if (!u.active) return { ok: false, code: 'inactive', error: 'This teacher account has been deactivated. Please contact the platform administrator.' };
    c.remove(fk);
    var token = randomHex_(32), exp = now + SESSION_TTL_MS;
    appendRow_(DIR.PSES, { tokenHash: tHash_('pt', token), userId: u.userId, role: 'teacher', createdAt: now, expiresAt: exp });
    var r = dirPublic_(u); r.lastLogin = now; r.updatedAt = now; updateRow_(DIR.USERS, u._row, r);
    return { ok: true, ttoken: token, expiresAt: exp, user: tUserPublic_(u) };
  } finally { lock.releaseLock(); }
}
/** The teacher's assigned deliveries, with everything the dashboard needs to show and open them. */
function teacherDeliveries_(userId) {
  var dl = {}; dirAll_(DIR.DELIV).forEach(function (d) { dl[d.deliveryId] = d; });
  var gr = {}; dirAll_(DIR.GROUP).forEach(function (g) { gr[g.groupId] = g; });
  var ins = {}; dirAll_(DIR.INST).forEach(function (i) { ins[i.institutionId] = i; });
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  var out = [];
  dirAll_(DIR.ASSIGN).forEach(function (a) {
    if (a.userId !== userId) return;
    var d = dl[a.deliveryId], g = d && gr[d.groupId], i = g && ins[g.institutionId], m = d && md[d.moduleId];
    if (!d || !g || !i || !m) return;
    out.push({ deliveryId: d.deliveryId, moduleId: m.moduleId, title: m.title, subtitle: m.subtitle, icon: m.icon || '📘', color: m.color || '#0f2a4a', url: m.url,
      storagePrefix: m.storagePrefix, group: d.backendModule === m.moduleId ? '' : String(d.backendModule).slice(m.moduleId.length + 1),
      groupId: g.groupId, groupName: g.name, academicYear: g.academicYear, linkCode: g.linkCode, institution: i.name, institutionShort: i.shortName,
      status: d.status, open: !!(d.active && g.active && i.active && m.active && m.url) });
  });
  return out.sort(function (a, b) { return (a.institution + a.groupName + a.title).localeCompare(b.institution + b.groupName + b.title); });
}
function teacherMe_(u) { return { ok: true, user: tUserPublic_(u), deliveries: teacherDeliveries_(u.userId) }; }
function teacherOpen_(u, ses, p) {
  if (isTrue_(u.mustChange)) return { ok: false, code: 'mustchange', error: 'Please choose your own password first.' };
  var id = String(p.deliveryId || '');
  var mine = teacherDeliveries_(u.userId).filter(function (x) { return x.deliveryId === id; })[0];
  if (!mine) return { ok: false, code: 'forbidden', error: 'This module is not assigned to you for this group.' };
  if (!mine.open) return { ok: false, code: 'closed', error: 'This module or group is not active at the moment.' };
  var d = dirFind_(DIR.DELIV, 'deliveryId', id), now = Date.now();
  var exp = Math.min(now + SESSION_TTL_MS, Number(ses.row.expiresAt) || now + SESSION_TTL_MS);
  var token = Utilities.getUuid() + '-' + randomHex_(16);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    appendRow_(SHEETS.SESSIONS, { module: d.backendModule, token: token, createdAt: now, expiresAt: exp });
    appendRow_(DIR.GRANTS, { userId: u.userId, deliveryId: id, backendModule: d.backendModule, tokenHash: tHash_('pg', token), sessionHash: ses.hash, createdAt: now, expiresAt: exp });
  } finally { lock.releaseLock(); }
  return { ok: true, token: token, expiresAt: exp, backendModule: d.backendModule, storagePrefix: mine.storagePrefix, group: mine.group, url: mine.url };
}
/** Ends teacher module sessions (and their records) for every grant matching pred — at once, including cached checks. */
function revokeGrants_(pred) {
  if (!tSheetsReady_()) return 0;
  var gs = dirAll_(DIR.GRANTS).filter(pred); if (!gs.length) return 0;
  var hashes = {}; gs.forEach(function (g) { hashes[g.tokenHash] = 1; });
  var rows = readAll_(SHEETS.SESSIONS), c = CacheService.getScriptCache();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (r.token && hashes[tHash_('pg', String(r.token))]) { c.remove('tok:' + r.module + ':' + r.token); deleteRow_(SHEETS.SESSIONS, r._row); }
  }
  gs.map(function (g) { return g._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.GRANTS, row); });
  return gs.length;
}
function tEndSessions_(userId, onlyHash) {
  var rows = dirAll_(DIR.PSES).filter(function (r) { return r.userId === userId && (!onlyHash || r.tokenHash === onlyHash); });
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.PSES, row); });
  revokeGrants_(function (g) { return g.userId === userId && (!onlyHash || g.sessionHash === onlyHash); });
}
function teacherLogout_(p) {
  var s = tSession_(p.ttoken); if (!s) return { ok: true };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { tEndSessions_(s.user.userId, s.hash); } finally { lock.releaseLock(); }
  return { ok: true };
}
function tPwRule_(np, username, old) {
  if (np.length < 8) return 'The new password must be at least 8 characters.';
  if (normUser_(np) === username) return 'The new password must not be your username.';
  if (old != null && np === old) return 'Choose a password different from the current one.';
  return null;
}
function teacherChangePassword_(u, ses, p) {
  var old = String(p.oldPassword || ''), np = String(p.newPassword || '');
  if (!safeEq_(hashIter_(old, u.pwSalt, Number(u.pwIter) || PW_ITER), u.pwHash)) return { ok: false, error: 'Your current password is incorrect.' };
  var rule = tPwRule_(np, u.username, old); if (rule) return { ok: false, error: rule };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var r = dirPublic_(u), salt = randomHex_(16); r.pwSalt = salt; r.pwIter = PW_ITER; r.pwHash = hashIter_(np, salt, PW_ITER); r.mustChange = false; r.updatedAt = Date.now();
    updateRow_(DIR.USERS, u._row, r);
    // other devices are signed out; this one stays
    dirAll_(DIR.PSES).filter(function (x) { return x.userId === u.userId && x.tokenHash !== ses.hash; }).map(function (x) { return x._row; })
      .sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.PSES, row); });
    revokeGrants_(function (g) { return g.userId === u.userId && g.sessionHash !== ses.hash; });
  } finally { lock.releaseLock(); }
  return { ok: true };
}

/* ---- Admin: teacher accounts and their assignments ---- */
function teacherList_() {
  var counts = {}, byUser = {};
  dirAll_(DIR.ASSIGN).forEach(function (a) { (byUser[a.userId] = byUser[a.userId] || []).push(a.deliveryId); });
  return { ok: true, teachers: tUsers_().filter(function (u) { return u.role === 'teacher'; }).map(function (u) { var o = tUserPublic_(u); o.deliveryIds = byUser[u.userId] || []; return o; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); }) };
}
function teacherSave_(p) {
  var rec = p.record || {}, now = Date.now();
  var name = String(rec.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(rec.email || '').trim().toLowerCase().slice(0, 120);
  if (name.length < 2) return dirErr_('Enter the teacher’s name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return dirErr_('That email address is not valid.');
  if (p.create) {
    var username = normUser_(rec.username);
    if (!validUser_(username) || username === 'admin') return dirErr_('Choose a username of 2–64 letters, digits, dot, dash or underscore (not “admin”), e.g. dr.ahmed');
    if (tUsers_().some(function (u) { return u.username === username; })) return dirErr_('This username is already taken.');
    var given = String(rec.password || ''); if (given && given.length < 8) return dirErr_('The password must be at least 8 characters.');
    var plain = given || genTempPassword_(), salt = randomHex_(16);
    var u = { userId: dirNewId_('USR', DIR.USERS, 'userId'), role: 'teacher', username: username, name: name, email: email, pwSalt: salt, pwHash: hashIter_(plain, salt, PW_ITER), pwIter: PW_ITER,
      active: true, mustChange: true, failed: 0, lockedUntil: '', createdAt: now, updatedAt: now, lastLogin: '' };
    appendRow_(DIR.USERS, u);
    var o = tUserPublic_(u); o.deliveryIds = [];
    return { ok: true, teacher: o, tempPassword: plain };
  }
  var cur = dirFind_(DIR.USERS, 'userId', String(rec.userId || '')); if (!cur || cur.role !== 'teacher') return dirErr_('This teacher no longer exists — reload.');
  var r = dirPublic_(cur); r.name = name; r.email = email; r.updatedAt = now; updateRow_(DIR.USERS, cur._row, r);
  return { ok: true };
}
function teacherSetActive_(p) {
  var cur = dirFind_(DIR.USERS, 'userId', String(p.userId || '')); if (!cur || cur.role !== 'teacher') return dirErr_('This teacher no longer exists — reload.');
  var r = dirPublic_(cur); r.active = !!p.active; r.updatedAt = Date.now(); updateRow_(DIR.USERS, cur._row, r);
  if (!p.active) tEndSessions_(cur.userId);   // signed out everywhere, module sessions ended
  return { ok: true };
}
function teacherResetPassword_(p) {
  var cur = dirFind_(DIR.USERS, 'userId', String(p.userId || '')); if (!cur || cur.role !== 'teacher') return dirErr_('This teacher no longer exists — reload.');
  var given = String(p.password || ''); if (given && given.length < 8) return dirErr_('The password must be at least 8 characters.');
  var plain = given || genTempPassword_(), salt = randomHex_(16), r = dirPublic_(cur);
  r.pwSalt = salt; r.pwIter = PW_ITER; r.pwHash = hashIter_(plain, salt, PW_ITER); r.mustChange = true; r.failed = 0; r.lockedUntil = ''; r.updatedAt = Date.now();
  updateRow_(DIR.USERS, cur._row, r);
  CacheService.getScriptCache().remove('tlfail:' + sha256Hex_(cur.username));
  tEndSessions_(cur.userId);
  return { ok: true, tempPassword: plain };
}
/** Replaces a teacher's assignments with exactly this list of deliveries (each = one group + one module). */
function teacherAssign_(p) {
  var cur = dirFind_(DIR.USERS, 'userId', String(p.userId || '')); if (!cur || cur.role !== 'teacher') return dirErr_('This teacher no longer exists — reload.');
  var valid = {}; dirAll_(DIR.DELIV).forEach(function (d) { valid[d.deliveryId] = 1; });
  var want = {}; (Array.isArray(p.deliveryIds) ? p.deliveryIds : []).slice(0, 500).forEach(function (id) { id = String(id || ''); if (valid[id]) want[id] = 1; });
  var now = Date.now(), have = dirAll_(DIR.ASSIGN).filter(function (a) { return a.userId === cur.userId; }), haveIds = {}, removed = {};
  have.forEach(function (a) { haveIds[a.deliveryId] = 1; if (!want[a.deliveryId]) removed[a.deliveryId] = a._row; });
  Object.keys(removed).map(function (k) { return removed[k]; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.ASSIGN, row); });
  Object.keys(want).forEach(function (id) { if (!haveIds[id]) appendRow_(DIR.ASSIGN, { assignmentId: dirNewId_('ASG', DIR.ASSIGN, 'assignmentId'), userId: cur.userId, deliveryId: id, grantedBy: 'admin', grantedAt: now }); });
  revokeGrants_(function (g) { return g.userId === cur.userId && removed[g.deliveryId]; });   // access withdrawn at once
  return { ok: true, deliveryIds: Object.keys(want) };
}
