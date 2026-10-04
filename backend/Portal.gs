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
var PORTAL_VERSION = '1.4';
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
  if (String(module) !== PORTAL_MODULE) return null;
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
  return portalAccountCheck_(p, keys.map(function (k) { return { key: k, module: k }; }));
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
  ASSIGN: 'TeacherAssignments', ROLES: 'ModuleContentRoles'
};
var DIR_HEADERS = {
  Institutions: ['institutionId', 'name', 'shortName', 'active', 'sortOrder', 'createdAt', 'updatedAt'],
  Groups: ['groupId', 'institutionId', 'name', 'academicYear', 'linkCode', 'active', 'createdAt', 'updatedAt'],
  Modules: ['moduleId', 'title', 'subtitle', 'url', 'storagePrefix', 'icon', 'color', 'publishedVersion', 'active', 'createdAt', 'updatedAt'],
  Deliveries: ['deliveryId', 'groupId', 'moduleId', 'backendModule', 'status', 'openFrom', 'openUntil', 'active', 'createdAt', 'updatedAt'],
  TeacherAssignments: ['assignmentId', 'userId', 'deliveryId', 'grantedBy', 'grantedAt'],
  ModuleContentRoles: ['userId', 'moduleId', 'role', 'grantedBy', 'grantedAt']
};
var DIR_TEXT = {
  Institutions: ['institutionId', 'name', 'shortName'],
  Groups: ['groupId', 'institutionId', 'name', 'academicYear', 'linkCode'],
  Modules: ['moduleId', 'title', 'subtitle', 'url', 'storagePrefix', 'icon', 'color', 'publishedVersion'],
  Deliveries: ['deliveryId', 'groupId', 'moduleId', 'backendModule', 'status'],
  TeacherAssignments: ['assignmentId', 'userId', 'deliveryId', 'grantedBy'],
  ModuleContentRoles: ['userId', 'moduleId', 'role', 'grantedBy']
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
  return portalAccountCheck_(p, targets);
}
