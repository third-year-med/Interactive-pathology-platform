/* TEST FIXTURE — verbatim excerpts of the platform's shared Code.gs (v1.7): configuration, entry point, routing,
 * sheet plumbing, teacher authentication, student accounts, content CRUD helpers and the exam-window lock that the
 * sign-in gate consults, the attendance engine and the Live Classroom (Teaching Sessions). Engines not needed (study
 * sync, assessments, practicals, exam app) are left out; the router only reaches them for other actions.
 * NOT FOR DEPLOYMENT: deploy your own Code.gs unchanged. Content keys and default passwords here are test values. */

var VERSION = '1.7';
var SESSION_TTL_MS = 12 * 3600 * 1000;
var CONTENT_JSON_COLS = 6;
var CONTENT_CHUNK_SIZE = 45000;
var DEFAULT_QUIZ_PW = {};
var DEFAULT_LIVE_PW = {};
var DRIVE_FOLDER_NAME = 'Pathology Teaching Platform — Images';
var ATTENDANCE_ROOT_FOLDER = 'Medical Education Platform';

var SHEETS = {
  CONTENT: 'Content', RESULTS: 'Results', SETTINGS: 'Settings', SESSIONS: 'Sessions',
  LIVE_CHAT: 'LiveChat', LIVE_MEMBERS: 'LiveMembers', LIVE_FILES: 'LiveFiles',
  ATT_SESSIONS: 'AttendanceSessions', ATT_RECORDS: 'AttendanceRecords',
  ASSESS: 'AssessRecords', STUDY: 'StudySync',
  STUDENTS: 'Students', STU_SESSIONS: 'StudentSessions'
};

var HEADERS = {};
HEADERS[SHEETS.CONTENT] = ['module', 'collection', 'id', 'updatedAt', 'updatedBy', 'deleted']
  .concat(Array.from({ length: CONTENT_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
HEADERS[SHEETS.RESULTS] = ['module', 'id', 'name', 'email', 'score', 'total', 'percent', 'correct', 'incorrect',
  'unanswered', 'startedAt', 'submittedAt', 'durationSec', 'answersJson', 'receivedAt'];
HEADERS[SHEETS.SETTINGS] = ['key', 'value'];
HEADERS[SHEETS.SESSIONS] = ['module', 'token', 'createdAt', 'expiresAt'];
HEADERS[SHEETS.LIVE_CHAT] = ['module', 'id', 'kind', 'authorRole', 'authorName', 'participantId', 'body',
  'imageUrl', 'fileUrl', 'fileName', 'fileMime', 'replyToId', 'pinned', 'edited', 'deleted', 'reactionsJson', 'createdAt', 'updatedAt',
  'seq', 'ord', 'clientId', 'replyToPid', 'mentionsJson', 'mentionAll', 'attachmentsJson'];
HEADERS[SHEETS.LIVE_MEMBERS] = ['module', 'participantId', 'role', 'name', 'email', 'prefsJson', 'readUpTo', 'readIdsJson', 'readVer', 'removed', 'joinedAt', 'updatedAt'];
HEADERS[SHEETS.LIVE_FILES] = ['module', 'id', 'name', 'mime', 'size', 'uploaderPid', 'status', 'storageId', 'messageId', 'preview', 'createdAt', 'readyAt'];
HEADERS[SHEETS.STUDENTS] = ['module', 'username', 'name', 'email', 'pwSalt', 'pwHash', 'pwIter', 'active', 'mustChange', 'failed', 'lockedUntil', 'createdAt', 'updatedAt', 'lastLogin'];
HEADERS[SHEETS.STU_SESSIONS] = ['module', 'tokenHash', 'username', 'createdAt', 'expiresAt', 'remember'];
var TEXT_COLS = {};
TEXT_COLS[SHEETS.STUDENTS] = ['module', 'username', 'name', 'email', 'pwSalt', 'pwHash'];
TEXT_COLS[SHEETS.STU_SESSIONS] = ['module', 'tokenHash', 'username'];
TEXT_COLS[SHEETS.ASSESS] = ['module', 'kind', 'id', 'ref', 'email', 'status'];
HEADERS[SHEETS.ATT_SESSIONS] = ['module', 'sessionId', 'code', 'token', 'academicYear', 'course', 'chapter', 'sessionTitle',
  'teacher', 'status', 'createdAt', 'endedAt', 'driveStatus', 'driveUrl', 'driveError'];
HEADERS[SHEETS.ASSESS] = ['module', 'kind', 'id', 'ref', 'email', 'status', 'updatedAt']
  .concat(Array.from({ length: CONTENT_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
var STUDY_JSON_COLS = 16;
HEADERS[SHEETS.STUDY] = ['module', 'key', 'pinSalt', 'pinHash', 'tokensJson', 'rev', 'share', 'lastActive', 'createdAt', 'updatedAt', 'summaryJson']
  .concat(Array.from({ length: STUDY_JSON_COLS }, function (_, i) { return 'json' + (i + 1); }));
HEADERS[SHEETS.ATT_RECORDS] = ['sessionId', 'recordId', 'participantId', 'studentName', 'studentId', 'email', 'status', 'scannedAt', 'createdAt'];

function doGet(e) {
  return ContentService.createTextOutput(
    'Pathology Teaching Platform backend is running (v' + VERSION + '). POST requests only.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Invalid JSON body.', code: 'badjson' });
  }
  try {
    if (payload && payload.action === 'liveSync') {
      if (studentAuthOn_(String(payload.module || 'default'))) {
        ensureSheets_();
        var gate = gateRequest_(String(payload.module || 'default'), payload);
        if (gate) return jsonOut_(gate);
      }
      var fast = liveSyncFast_(payload); if (fast) return jsonOut_(fast);
    }
    ensureSheets_();
    return jsonOut_(route_(payload));
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Server error: ' + (err && err.message || err), code: 'server' });
  }
}

function route_(p) {
  var module = String(p.module || 'default');
  var action = p.action;
  if (EX_PUBLIC_ACTIONS[action]) return exRoute_(module, p);
  if (typeof portalHook_ === 'function') { var hp = portalHook_(module, p); if (hp) return hp; }  // shared front page (Portal.gs)
  if (!STUDENT_PUBLIC_ACTIONS[action] && studentAuthOn_(module)) {
    var gate = gateRequest_(module, p);
    if (gate) return gate;
  }

  if (typeof gynHook_ === 'function') {
    var hk3 = gynHook_(module, p);
    if (hk3) return hk3;
  }

  switch (action) {
    case 'ping': return { ok: true, version: VERSION, serverTime: Date.now(), needsSetup: !getTeacherCreds_(module).hash, studentAuth: studentAuthOn_(module) };
    case 'setup': return actionSetup_(module, p);
    case 'login': return actionLogin_(module, p);
    case 'logout': return actionLogout_(p);
    case 'changePassword': return authed_(module, p, function (tok) { return actionChangePassword_(module, p); });
    case 'studentLogin': return actionStudentLogin_(module, p);
    case 'studentLogout': return actionStudentLogout_(module, p);
    case 'studentSession': return actionStudentSession_(module, p);
    case 'studentChangePassword': return actionStudentChangePassword_(module, p);
    case 'listStudents': return authed_(module, p, function () { return actionListStudents_(module); });
    case 'saveStudent': return authed_(module, p, function () { return actionSaveStudent_(module, p); });
    case 'bulkAddStudents': return authed_(module, p, function () { return actionBulkAddStudents_(module, p); });
    case 'setStudentActive': return authed_(module, p, function () { return actionSetStudentActive_(module, p); });
    case 'resetStudentPassword': return authed_(module, p, function () { return actionResetStudentPassword_(module, p); });
    case 'deleteStudent': return authed_(module, p, function () { return actionDeleteStudent_(module, p); });
    case 'unlockStudent': return authed_(module, p, function () { return actionUnlockStudent_(module, p); });
    case 'upsert': return authed_(module, p, function () { return actionUpsert_(module, p); });
    case 'uploadImage': return authed_(module, p, function () { return actionUploadImage_(p); });
    case 'delete': return authed_(module, p, function () { return actionDelete_(module, p); });
    case 'getAllContent': return actionGetAllContent_(module, p);
    case 'startAttendanceSession': return authed_(module, p, function () { return actionStartAttendance_(module, p); });
    case 'closeAttendanceSession': return authed_(module, p, function () { return actionCloseAttendance_(module, p); });
    case 'getAttendanceTeacherState': return authed_(module, p, function () { return actionGetAttendanceTeacherState_(module, p); });
    case 'regenerateAttendanceCode': return authed_(module, p, function () { return actionRegenerateAttendanceCode_(module, p); });
    case 'deleteAttendanceRecord': return authed_(module, p, function () { return actionDeleteAttendanceRecord_(module, p); });
    case 'listAttendanceSessions': return authed_(module, p, function () { return actionListAttendanceSessions_(module, p); });
    case 'getAttendanceSessionReport': return authed_(module, p, function () { return actionGetAttendanceSessionReport_(module, p); });
    case 'submitAttendance': return actionSubmitAttendance_(module, p);
    case 'submitAttendanceByCode': return actionSubmitAttendanceByCode_(module, p);
    /* Live Classroom (v1.2) — one shared engine (LE_createService, generated from src/08_live_engine.js).
       Teacher = valid session token; student = joined member of THIS classroom — checked inside every action. */
    case 'liveJoin': return liveSvc_().join(module, p);
    case 'liveSync': return liveSvc_().sync(module, p);
    case 'liveHistory': return liveSvc_().history(module, p);
    case 'liveContext': return liveSvc_().context(module, p);
    case 'livePost': return liveSvc_().post(module, p);
    case 'liveEdit': return liveSvc_().mutate(module, p, 'edit');
    case 'liveDelete': return liveSvc_().mutate(module, p, 'delete');
    case 'livePin': return liveSvc_().mutate(module, p, 'pin');
    case 'liveReact': return liveSvc_().mutate(module, p, 'react');
    case 'liveSearch': return liveSvc_().search(module, p);
    case 'liveMembers': return liveSvc_().members(module, p);
    case 'liveNotifications': return liveSvc_().notifications(module, p);
    case 'liveMarkRead': return liveSvc_().markRead(module, p);
    case 'liveSetPrefs': return liveSvc_().setPrefs(module, p);
    case 'liveTyping': return liveSvc_().typing(module, p);
    case 'liveUploadInit': return liveSvc_().uploadInit(module, p);
    case 'liveUploadChunk': return liveSvc_().uploadChunk(module, p);
    case 'liveUploadStatus': return liveSvc_().uploadStatus(module, p);
    case 'liveFileChunk': return liveSvc_().fileChunk(module, p);
    case 'liveModuleInfo': return authed_(module, p, function () {
      var t = String(p.title || module).slice(0, 80), u = /^https?:\/\//.test(String(p.url || '')) ? String(p.url).slice(0, 300) : '';
      if (getSetting_('modtitle:' + module) !== t) setSetting_('modtitle:' + module, t);
      if (u && getSetting_('modurl:' + module) !== u) setSetting_('modurl:' + module, u);
      CacheService.getScriptCache().removeAll(['modtitle:' + module, 'modurl:' + module]);
      return { ok: true }; });
    case 'getLiveClassroomPassword': return authed_(module, p, function () { return actionGetLiveClassroomPassword_(module); });
    case 'setLiveClassroomPassword': return authed_(module, p, function () { return actionSetLiveClassroomPassword_(module, p); });

    case 'privList': return authed_(module, p, function () { return actionPrivList_(module, p); });
    case 'examBankList': case 'examBankSave': case 'examBankDelete': case 'examList': case 'examUpsert': case 'examRemove':
    case 'examResults': case 'examAttemptDetail': case 'examResetAttempt': case 'examReleaseSession':
      if (typeof exTeacher_ !== 'function') return { ok: false, error: 'Unknown action: ' + action, code: 'badaction' };
      return authed_(module, p, function () { return exTeacher_(module, p); });
    case 'exportCourse': return authed_(module, p, function () { return actionExportCourse_(module); });
    case 'importCourse': return authed_(module, p, function () { return actionImportCourse_(module, p); });
    default: return { ok: false, error: 'Unknown action: ' + action, code: 'badaction' };
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// (platform edit for standalone projects: fall back to the SHEET_ID script property)
function getSS_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('This Apps Script project is not attached to a Google Sheet. Add the script property SHEET_ID (see SETUP.md).');
  return SpreadsheetApp.openById(id);
}

function ensureSheets_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('sheets_ok:' + VERSION)) return;
  var ss = getSS_();
  var allPresent = Object.keys(SHEETS).every(function (k) {
    var sh = ss.getSheetByName(SHEETS[k]);
    return sh && sh.getLastRow() > 0;
  });
  var headersOk = allPresent && Object.keys(SHEETS).every(function (k) { return ss.getSheetByName(SHEETS[k]).getLastColumn() >= HEADERS[SHEETS[k]].length; });
  if (allPresent && headersOk) { cache.put('sheets_ok:' + VERSION, '1', 21600); return; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    Object.keys(SHEETS).forEach(function (k) {
      var name = SHEETS[k];
      var sh = ss.getSheetByName(name);
      if (!sh) {
        sh = ss.insertSheet(name);
        sh.appendRow(HEADERS[name]);
        sh.setFrozenRows(1);
      } else if (sh.getLastRow() === 0) {
        sh.appendRow(HEADERS[name]);
        sh.setFrozenRows(1);
      }
    });
    Object.keys(SHEETS).forEach(function (k) {
      var name = SHEETS[k], sh = ss.getSheetByName(name), want = HEADERS[name];
      if (sh && sh.getLastColumn() < want.length) sh.getRange(1, 1, 1, want.length).setValues([want]);
    });
    var def = ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
    cache.put('sheets_ok:' + VERSION, '1', 21600);
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name) { return getSS_().getSheetByName(name); }

function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = HEADERS[name], tc = TEXT_COLS[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = row[j]; });
    if (tc) tc.forEach(function (h) { o[h] = o[h] == null ? '' : String(o[h]); });
    return o;
  });
}

function rowToArray_(name, obj) {
  return HEADERS[name].map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
}

function textFormats_(name) {
  var tc = TEXT_COLS[name];
  return tc ? [HEADERS[name].map(function (h) { return tc.indexOf(h) >= 0 ? '@' : 'General'; })] : null;
}
function appendRow_(name, obj) {
  var f = textFormats_(name);
  if (!f) { sheet_(name).appendRow(rowToArray_(name, obj)); return; }
  var sh = sheet_(name), r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var rng = sh.getRange(r, 1, 1, HEADERS[name].length);
  rng.setNumberFormats(f); rng.setValues([rowToArray_(name, obj)]);
}

function updateRow_(name, rowIndex, obj) {
  var headers = HEADERS[name], f = textFormats_(name);
  var rng = sheet_(name).getRange(rowIndex, 1, 1, headers.length);
  if (f) rng.setNumberFormats(f);
  rng.setValues([rowToArray_(name, obj)]);
}

function deleteRow_(name, rowIndex) {
  sheet_(name).deleteRow(rowIndex);
}

function packJson_(obj) {
  var s = JSON.stringify(obj === undefined ? null : obj);
  var chunks = {};
  for (var i = 0; i < CONTENT_JSON_COLS; i++) chunks['json' + (i + 1)] = '';
  for (var i = 0, c = 1; i < s.length && c <= CONTENT_JSON_COLS; i += CONTENT_CHUNK_SIZE, c++) {
    chunks['json' + c] = s.slice(i, i + CONTENT_CHUNK_SIZE);
  }
  if (s.length > CONTENT_CHUNK_SIZE * CONTENT_JSON_COLS) {
    throw new Error('This item is too large to store (>' + (CONTENT_CHUNK_SIZE * CONTENT_JSON_COLS) + ' characters). Try removing an embedded image (use image upload instead of pasting a data URL).');
  }
  return chunks;
}
function unpackJson_(row) {
  var s = '';
  for (var i = 1; i <= CONTENT_JSON_COLS; i++) s += (row['json' + i] || '');
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function getSetting_(key) {
  var rows = readAll_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
  return null;
}
function setSetting_(key, value) {
  var sh = sheet_(SHEETS.SETTINGS);
  var rows = readAll_(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) { sh.getRange(rows[i]._row, 2).setValue(value); return; }
  }
  appendRow_(SHEETS.SETTINGS, { key: key, value: value });
}

function randomHex_(nBytes) {
  var out = '';
  while (out.length < nBytes * 2) out += sha256Hex_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + out);
  return out.slice(0, nBytes * 2);
}
function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}
var PW_ITER = 1000;
function hashIter_(password, salt, iter) {
  var h = sha256Hex_(salt + '::' + password);
  for (var i = 0; i < iter; i++) h = sha256Hex_(salt + ':' + h);
  return h;
}
function safeEq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + password, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function teacherHashKey_(module) { return 'teacherHash:' + module; }
function teacherSaltKey_(module) { return 'teacherSalt:' + module; }
function teacherIterKey_(module) { return 'teacherIter:' + module; }
function getTeacherCreds_(module) {
  var hash = getSetting_(teacherHashKey_(module)), salt = getSetting_(teacherSaltKey_(module));
  if (hash) return { hash: hash, salt: salt, iter: Number(getSetting_(teacherIterKey_(module))) || 0, legacy: false };
  hash = getSetting_('teacherHash'); salt = getSetting_('teacherSalt');
  return { hash: hash, salt: salt, iter: 0, legacy: !!hash };
}
function teacherPwOk_(creds, pw) { return !!creds.hash && safeEq_(creds.iter ? hashIter_(pw, creds.salt, creds.iter) : hashPassword_(pw, creds.salt), creds.hash); }
function setTeacherPw_(module, pw) {
  var salt = randomHex_(16);
  setSetting_(teacherSaltKey_(module), salt);
  setSetting_(teacherIterKey_(module), String(PW_ITER));
  setSetting_(teacherHashKey_(module), hashIter_(pw, salt, PW_ITER));
}
var T_MAX_FAILS = 8, T_LOCK_S = 900;

function actionSetup_(module, p) {
  if (getTeacherCreds_(module).hash) return { ok: false, error: 'A teacher password already exists for this module. Sign in, or use Teacher Portal → Account to change it.' };
  var pw = String(p.password || '');
  if (pw.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  setTeacherPw_(module, pw);
  return { ok: true };
}

function actionLogin_(module, p) {
  var creds = getTeacherCreds_(module);
  if (!creds.hash) return { ok: false, error: 'No teacher password has been set up yet for this module.', code: 'needsSetup' };
  var c = CacheService.getScriptCache(), fk = 'tfail:' + module, fails = Number(c.get(fk) || 0);
  if (fails >= T_MAX_FAILS) return { ok: false, code: 'locked', error: 'Too many incorrect teacher passwords. Teacher sign-in for this module is locked for 15 minutes.' };
  var pw = String(p.password || '');
  if (!teacherPwOk_(creds, pw)) { c.put(fk, String(fails + 1), T_LOCK_S); return { ok: false, error: 'Incorrect teacher password.' }; }
  c.remove(fk);
  var token = Utilities.getUuid() + '-' + randomHex_(16);
  var now = Date.now();
  appendRow_(SHEETS.SESSIONS, { module: module, token: token, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return { ok: true, token: token, expiresAt: now + SESSION_TTL_MS, contentKey: contentKey_(module) };
}

function actionLogout_(p) {
  var rows = readAll_(SHEETS.SESSIONS);
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].token === p.token) deleteRow_(SHEETS.SESSIONS, rows[i]._row);
  return { ok: true };
}

function actionChangePassword_(module, p) {
  var creds = getTeacherCreds_(module);
  if (!teacherPwOk_(creds, String(p.oldPassword || ''))) return { ok: false, error: 'Current password is incorrect.' };
  if (String(p.newPassword || '').length < 8) return { ok: false, error: 'New password must be at least 8 characters.' };
  setTeacherPw_(module, String(p.newPassword));
  return { ok: true };
}

function authed_(module, p, fn) {
  var token = p.token;
  if (!token) return { ok: false, error: 'Not signed in.', code: 'auth' };
  var rows = readAll_(SHEETS.SESSIONS);
  var found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].token === token) { found = rows[i]; break; }
  if (!found) return { ok: false, error: 'Your session has expired — please sign in again.', code: 'auth' };
  if (Number(found.expiresAt) < Date.now()) { deleteRow_(SHEETS.SESSIONS, found._row); return { ok: false, error: 'Your session has expired — please sign in again.', code: 'auth' }; }
  if (found.module && found.module !== module) return { ok: false, error: 'This teacher account does not have access to this module — please sign in again here.', code: 'auth' };
  return fn(token);
}

/* ---- Student accounts & sign-in (1.6) — content keys here are TEST values ---- */
var STUDENT_AUTH_MODULES = {
  cellinjury: true,
  inflhealing: true,
  vulva: true,
  vagina: true
};
var CONTENT_KEYS = {
  vulva: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  vagina: '__VAGINA_CONTENT_KEY__'
};
var STU_TTL_MS = 12 * 3600 * 1000;
var STU_REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000;
var STU_MAX_FAILS = 5, STU_LOCK_MS = 15 * 60 * 1000;
var STU_MIN_PW = 8;
var STUDENT_PUBLIC_ACTIONS = { ping: 1, setup: 1, login: 1, logout: 1, studentLogin: 1, studentLogout: 1 };

function baseModule_(module) { return String(module || '').split('-')[0]; }
function studentAuthOn_(module) { return !!STUDENT_AUTH_MODULES[baseModule_(module)]; }
function contentKey_(module) { return CONTENT_KEYS[baseModule_(module)] || ''; }
function normUser_(u) { return String(u == null ? '' : u).trim().toLowerCase(); }
function validUser_(u) { return /^[a-z0-9][a-z0-9._@-]{1,63}$/.test(u); }
function studentEmail_(s) { return s.email || (s.username.replace(/[^a-z0-9._-]/g, '') + '@student.local'); }
function studentPublic_(s) { return { username: s.username, name: s.name, email: s.email || '' }; }
function findStudent_(module, username) {
  var rows = readAll_(SHEETS.STUDENTS);
  for (var i = 0; i < rows.length; i++) if (rows[i].module === module && normUser_(rows[i].username) === username) return rows[i];
  return null;
}
function isTrue_(v) { return v === true || v === 'TRUE' || v === 'true'; }
function stuTokenHash_(t) { return sha256Hex_('st|' + t); }
function stuCache_() { return CacheService.getScriptCache(); }
function revokeStudentSessions_(module, username, keepHash) {
  var rows = readAll_(SHEETS.STU_SESSIONS), c = stuCache_();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (r.module === module && r.username === username && r.tokenHash !== keepHash) { c.remove('stok:' + r.tokenHash); deleteRow_(SHEETS.STU_SESSIONS, r._row); }
  }
}
function studentFromSession_(module, stoken) {
  if (!stoken || String(stoken).length < 20) return null;
  var th = stuTokenHash_(stoken), c = stuCache_(), ck = 'stok:' + th;
  var hit = c.get(ck);
  if (hit) { try { var o = JSON.parse(hit); if (o.module === module && o.exp > Date.now()) return o; } catch (e) { } }
  var rows = readAll_(SHEETS.STU_SESSIONS), found = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].tokenHash === th) { found = rows[i]; break; }
  if (!found || found.module !== module) return null;
  if (Number(found.expiresAt) < Date.now()) { deleteRow_(SHEETS.STU_SESSIONS, found._row); return null; }
  var s = findStudent_(module, found.username);
  if (!s || !isTrue_(s.active)) return null;
  var out = { module: module, username: s.username, name: s.name, email: s.email || '', mustChange: isTrue_(s.mustChange), exp: Number(found.expiresAt), th: th };
  c.put(ck, JSON.stringify(out), 300);
  return out;
}
function gateRequest_(module, p) {
  if (p.token && liveTeacherTokenOk_(module, String(p.token))) { p.__role = 'teacher'; return null; }
  var st = studentFromSession_(module, p.stoken);
  if (!st) return p.token && !p.stoken ? { ok: false, code: 'auth', error: 'Your teacher session has expired — please sign in again.' }
    : { ok: false, code: 'studentauth', error: 'Your session has ended — please sign in again.' };
  if (st.mustChange && p.action !== 'studentChangePassword' && p.action !== 'studentSession' && p.action !== 'studentLogout')
    return { ok: false, code: 'mustchange', error: 'Please set a new password before continuing.' };
  if (p.action !== 'studentLogout') { var xl = exTeachingLock_(module, st.username); if (xl) return xl; }
  p.__role = 'student'; p.__student = st;
  var email = studentEmail_(st), a = p.action;
  if (a === 'liveJoin') { p.name = st.name; p.email = email; }
  if (/^live/.test(a)) p.participantId = LE_pidFor(module, email);
  if (a === 'submitAttendance' || a === 'submitAttendanceByCode') { p.name = st.name; p.studentId = st.username; p.email = st.email || ''; p.participantId = 'acct:' + st.username; }
  if (a === 'getMyAssessments' || a === 'startAttempt' || a === 'submitAttempt' || /^study/.test(a)) { p.email = email; if (a === 'startAttempt') p.name = st.name; }
  if (a === 'submitQuizResult' && p.result) { p.result.name = st.name; p.result.email = email; }
  return null;
}

function actionStudentLogin_(module, p) {
  if (!studentAuthOn_(module)) return { ok: false, code: 'disabled', error: 'Student sign-in is not enabled for this module.' };
  var username = normUser_(p.username), pw = String(p.password || '');
  var generic = { ok: false, code: 'badlogin', error: 'Incorrect student ID or password.' };
  if (!username || !pw) return { ok: false, code: 'badlogin', error: 'Enter your student ID and password.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, username);
    if (!s) { Utilities.sleep(300); return generic; }
    var now = Date.now();
    if (Number(s.lockedUntil) > now) return { ok: false, code: 'locked', error: 'Too many failed attempts. This account is locked for ' + Math.ceil((Number(s.lockedUntil) - now) / 60000) + ' more minute(s), or ask your teacher to unlock it.' };
    if (!safeEq_(hashIter_(pw, s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) {
      s.failed = (Number(s.failed) || 0) + 1;
      if (s.failed >= STU_MAX_FAILS) { s.lockedUntil = now + STU_LOCK_MS; s.failed = 0; }
      s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
      return Number(s.lockedUntil) > now ? { ok: false, code: 'locked', error: 'Too many failed attempts. This account is locked for 15 minutes, or ask your teacher to unlock it.' } : generic;
    }
    if (!isTrue_(s.active)) return { ok: false, code: 'inactive', error: 'This account has been deactivated. Please contact your teacher.' };
    var xlock = exTeachingLock_(module, s.username); if (xlock) return xlock;
    s.failed = 0; s.lockedUntil = ''; s.lastLogin = now; s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
    var token = randomHex_(32), remember = !!p.remember, exp = now + (remember ? STU_REMEMBER_TTL_MS : STU_TTL_MS);
    appendRow_(SHEETS.STU_SESSIONS, { module: module, tokenHash: stuTokenHash_(token), username: s.username, createdAt: now, expiresAt: exp, remember: remember });
    return { ok: true, token: token, expiresAt: exp, student: studentPublic_(s), mustChange: isTrue_(s.mustChange), contentKey: isTrue_(s.mustChange) ? '' : contentKey_(module) };
  } finally { lock.releaseLock(); }
}
function actionStudentLogout_(module, p) {
  if (!p.stoken) return { ok: true };
  var th = stuTokenHash_(p.stoken), rows = readAll_(SHEETS.STU_SESSIONS);
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].tokenHash === th) deleteRow_(SHEETS.STU_SESSIONS, rows[i]._row);
  stuCache_().remove('stok:' + th);
  return { ok: true };
}
function actionStudentSession_(module, p) {
  if (p.__role === 'teacher') return { ok: true, role: 'teacher', contentKey: contentKey_(module) };
  var st = p.__student; if (!st) return { ok: false, code: 'studentauth', error: 'Please sign in.' };
  return { ok: true, role: 'student', student: studentPublic_(st), mustChange: st.mustChange, expiresAt: st.exp, contentKey: st.mustChange ? '' : contentKey_(module) };
}
function actionStudentChangePassword_(module, p) {
  var st = p.__student; if (!st) return { ok: false, code: 'studentauth', error: 'Please sign in.' };
  var np = String(p.newPassword || '');
  if (np.length < STU_MIN_PW) return { ok: false, error: 'The new password must be at least ' + STU_MIN_PW + ' characters.' };
  if (normUser_(np) === st.username) return { ok: false, error: 'The new password must not be your student ID.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, st.username); if (!s || !isTrue_(s.active)) return { ok: false, code: 'studentauth', error: 'Please sign in again.' };
    if (!safeEq_(hashIter_(String(p.oldPassword || ''), s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) return { ok: false, error: 'Your current password is incorrect.' };
    if (np === String(p.oldPassword || '')) return { ok: false, error: 'Choose a password different from the current one.' };
    s.pwSalt = randomHex_(16); s.pwIter = PW_ITER; s.pwHash = hashIter_(np, s.pwSalt, PW_ITER); s.mustChange = false; s.updatedAt = Date.now();
    updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, st.th);
    stuCache_().remove('stok:' + st.th);
    return { ok: true, contentKey: contentKey_(module) };
  } finally { lock.releaseLock(); }
}

function genTempPassword_() {
  var A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', h = randomHex_(24), out = '';
  for (var i = 0; i < 10; i++) out += A.charAt(parseInt(h.substr(i * 4, 4), 16) % A.length);
  return out;
}
function studentRowPublic_(r) {
  return { username: r.username, name: r.name, email: r.email || '', active: isTrue_(r.active), mustChange: isTrue_(r.mustChange),
    locked: Number(r.lockedUntil) > Date.now(), createdAt: Number(r.createdAt) || 0, lastLogin: Number(r.lastLogin) || 0 };
}
function actionListStudents_(module) {
  return { ok: true, students: readAll_(SHEETS.STUDENTS).filter(function (r) { return r.module === module; }).map(studentRowPublic_)
    .sort(function (a, b) { return a.username < b.username ? -1 : 1; }) };
}
function createStudent_(module, it) {
  var username = normUser_(it.username), name = String(it.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(it.email || '').trim().toLowerCase().slice(0, 120);
  if (!validUser_(username)) return { ok: false, error: 'Student ID “' + (it.username || '') + '” is not valid — use 2–64 letters, digits, dot, dash, underscore or @.' };
  if (name.length < 2) return { ok: false, error: 'Enter the student’s name (' + username + ').' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'The email for ' + username + ' is not valid.' };
  if (findStudent_(module, username)) return { ok: false, code: 'exists', error: 'Student ID “' + username + '” already exists.' };
  var given = String(it.password || ''), temp = !given;
  if (given && given.length < STU_MIN_PW) return { ok: false, error: 'The password for ' + username + ' must be at least ' + STU_MIN_PW + ' characters.' };
  var pw = given || genTempPassword_(), salt = randomHex_(16), now = Date.now();
  appendRow_(SHEETS.STUDENTS, { module: module, username: username, name: name, email: email, pwSalt: salt, pwHash: hashIter_(pw, salt, PW_ITER), pwIter: PW_ITER,
    active: true, mustChange: it.mustChange !== false, failed: 0, lockedUntil: '', createdAt: now, updatedAt: now, lastLogin: '' });
  return { ok: true, username: username, tempPassword: temp ? pw : '' };
}
function actionSaveStudent_(module, p) {
  var it = p.student || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (p.create) return createStudent_(module, it);
    var s = findStudent_(module, normUser_(it.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    var name = String(it.name || '').trim().replace(/\s+/g, ' ').slice(0, 80), email = String(it.email || '').trim().toLowerCase().slice(0, 120);
    if (name.length < 2) return { ok: false, error: 'Enter the student’s name.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'That email address is not valid.' };
    s.name = name; s.email = email; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionBulkAddStudents_(module, p) {
  var list = (p.students || []).slice(0, 500), results = [];
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { list.forEach(function (it) { var r = createStudent_(module, it || {}); r.input = String((it && it.username) || ''); results.push(r); }); }
  finally { lock.releaseLock(); }
  return { ok: true, created: results.filter(function (r) { return r.ok; }).length, results: results };
}
function actionSetStudentActive_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    s.active = !!p.active; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
    if (!p.active) revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionResetStudentPassword_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    var given = String(p.password || '');
    if (given && given.length < STU_MIN_PW) return { ok: false, error: 'The password must be at least ' + STU_MIN_PW + ' characters.' };
    var pw = given || genTempPassword_();
    s.pwSalt = randomHex_(16); s.pwIter = PW_ITER; s.pwHash = hashIter_(pw, s.pwSalt, PW_ITER); s.mustChange = true; s.failed = 0; s.lockedUntil = ''; s.updatedAt = Date.now();
    updateRow_(SHEETS.STUDENTS, s._row, s);
    revokeStudentSessions_(module, s.username, '__none__');
    return { ok: true, tempPassword: given ? '' : pw };
  } finally { lock.releaseLock(); }
}
function actionUnlockStudent_(module, p) {
  var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
  s.failed = 0; s.lockedUntil = ''; s.updatedAt = Date.now(); updateRow_(SHEETS.STUDENTS, s._row, s);
  return { ok: true };
}
function actionDeleteStudent_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, normUser_(p.username)); if (!s) return { ok: false, code: 'notfound', error: 'Student not found.' };
    revokeStudentSessions_(module, s.username, '__none__');
    deleteRow_(SHEETS.STUDENTS, s._row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---- image upload (verbatim from Code.gs) ---- */
function getImageFolder_() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function actionUploadImage_(p) {
  try {
    var dataUrl = String(p.dataUrl || '');
    var m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return { ok: false, error: 'Not a valid image data URL.' };
    var mime = m[1];
    var bytes = Utilities.base64Decode(m[2]);
    var blob = Utilities.newBlob(bytes, mime, p.filename || ('image-' + Date.now() + '.jpg'));
    var folder = getImageFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var isImage = /^image\//.test(mime);
    var url = isImage ? ('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w2000') : ('https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400');
    var viewUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    return { ok: true, url: url, viewUrl: viewUrl, fileId: file.getId(), mime: mime, filename: blob.getName(), isImage: isImage };
  } catch (err) {
    var msg = String(err && err.message || err);
    if (/Access denied|DriveApp|permission/i.test(msg)) {
      return { ok: false, error: 'Access denied: DriveApp. Open this project in the Apps Script editor, select "authorizeDriveAccess" in the function dropdown and press ▶ once to grant Drive permission, then try again.' };
    }
    return { ok: false, error: 'Upload failed: ' + msg };
  }
}

function findContentRow_(module, collection, id) {
  var rows = readAll_(SHEETS.CONTENT);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].module === module && rows[i].collection === collection && String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}
function actionUpsert_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var existing = findContentRow_(module, p.collection, p.id);
    var row = { module: module, collection: p.collection, id: String(p.id), updatedAt: Date.now(), updatedBy: 'teacher', deleted: false };
    Object.assign(row, packJson_(p.data));
    if (existing) updateRow_(SHEETS.CONTENT, existing._row, row);
    else appendRow_(SHEETS.CONTENT, row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function actionDelete_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var existing = findContentRow_(module, p.collection, p.id);
    var row = { module: module, collection: p.collection, id: String(p.id), updatedAt: Date.now(), updatedBy: 'teacher', deleted: true };
    Object.assign(row, packJson_(null));
    if (existing) updateRow_(SHEETS.CONTENT, existing._row, row);
    else appendRow_(SHEETS.CONTENT, row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function liveCache_() { return CacheService.getScriptCache(); }
function liveTeacherTokenOk_(module, token) {
  if (!token) return false;
  var c = liveCache_(), k = 'tok:' + module + ':' + token;
  if (c.get(k)) return true;
  var rows = readAll_(SHEETS.SESSIONS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.token === token && Number(r.expiresAt) > Date.now() && (!r.module || r.module === module)) {
      c.put(k, '1', Math.max(60, Math.min(1800, Math.floor((Number(r.expiresAt) - Date.now()) / 1000))));
      return true;
    }
  }
  return false;
}

/* ---- Official Exams (1.7): only the parts the sign-in gate uses ---- */
var EX_PUBLIC_ACTIONS = { examInfo: 1, examLogin: 1, examStart: 1, examSave: 1, examSubmit: 1, examStatus: 1, examLogout: 1 };
var EX_LOCK_BEFORE_MS = 15 * 60 * 1000;
function exPrivAll_(module, coll) {
  var c = 'priv:' + coll, out = [];
  readAll_(SHEETS.CONTENT).forEach(function (r) { if (r.module === module && r.collection === c && !r.deleted) { var d = unpackJson_(r); if (d) out.push(d); } });
  return out;
}
function exLocks_(module) {
  var c = CacheService.getScriptCache(), k = 'exlocks:' + module, hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var now = Date.now(), list = [];
  exPrivAll_(module, 'exams').forEach(function (e) {
    if (e.status === 'published' && e.lockTeaching && Number(e.closesAt) > now)
      list.push({ id: e.id, from: Number(e.opensAt) - EX_LOCK_BEFORE_MS, to: Number(e.closesAt), all: !e.candidates || e.candidates === 'all', users: e.candidates === 'all' ? [] : (e.candidates || []).map(normUser_), title: e.title });
  });
  c.put(k, JSON.stringify(list), 60);
  return list;
}
function exTeachingLock_(module, username) {
  var locks = exLocks_(module); if (!locks.length) return null;
  var now = Date.now(), u = normUser_(username);
  for (var i = 0; i < locks.length; i++) {
    var L = locks[i];
    if (now >= L.from && now <= L.to && (L.all || L.users.indexOf(u) >= 0))
      return { ok: false, code: 'examlock', error: 'The teaching platform is closed for you while the official exam “' + L.title + '” is running. It reopens at ' + Utilities.formatDate(new Date(L.to), Session.getScriptTimeZone(), 'HH:mm') + '.' };
  }
  return null;
}

/* ---- content read/import/export: copied verbatim from Code.gs ---- */
function actionGetAllContent_(module, p) {
  var since = Number(p.since || 0);
  var rows = readAll_(SHEETS.CONTENT).filter(function (r) { return r.module === module && Number(r.updatedAt) > since && r.collection !== 'history' && String(r.collection).indexOf('priv:') !== 0; });
  var items = rows.map(function (r) {
    return { collection: r.collection, id: r.id, data: r.deleted ? null : unpackJson_(r), deleted: !!r.deleted };
  });
  return { ok: true, items: items, serverTime: Date.now() };
}
function actionImportCourse_(module, p) {
  var items = p.items || [];
  items.forEach(function (it) { actionUpsert_(module, { collection: it.collection, id: it.id, data: it.data }); });
  return { ok: true, count: items.length };
}
function actionExportCourse_(module) {
  var rows = readAll_(SHEETS.CONTENT).filter(function (r) { return r.module === module && !r.deleted && r.collection !== 'history'; });
  var items = rows.map(function (r) { return { collection: r.collection, id: r.id, data: unpackJson_(r) }; });
  return { ok: true, items: items, exportedAt: new Date().toISOString() };
}

/* copied verbatim from Code.gs (teacher-only private collections, e.g. practical drafts) */
function actionPrivList_(module, p) {
  var coll = 'priv:' + String(p.collection || '');
  var rows = readAll_(SHEETS.CONTENT).filter(function (r) { return r.module === module && r.collection === coll; });
  return { ok: true, items: rows.map(function (r) { return { id: String(r.id), updatedAt: Number(r.updatedAt), deleted: !!r.deleted, data: r.deleted ? null : unpackJson_(r) }; }) };
}

/* ---- Attendance (verbatim from Code.gs v1.7; only the Drive copy is replaced by the stub at the end) ---- */
/* ---------------------------------------------------------------------- *
 * Session-based QR Attendance
 * ---------------------------------------------------------------------- */
var ATT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genAttendanceCode_() {
  for (var attempt = 0; attempt < 20; attempt++) {
    var code = '';
    for (var i = 0; i < 6; i++) code += ATT_CODE_ALPHABET.charAt(Math.floor(Math.random() * ATT_CODE_ALPHABET.length));
    var clash = readAll_(SHEETS.ATT_SESSIONS).some(function (r) { return r.code === code && r.status === 'active'; });
    if (!clash) return code;
  }
  return Utilities.getUuid().slice(0, 6).toUpperCase();
}
function findAttSessionRow_(sessionId) {
  var rows = readAll_(SHEETS.ATT_SESSIONS);
  for (var i = 0; i < rows.length; i++) if (rows[i].sessionId === sessionId) return rows[i];
  return null;
}
function findAttSessionByToken_(module, token) {
  var rows = readAll_(SHEETS.ATT_SESSIONS);
  for (var i = 0; i < rows.length; i++) if (rows[i].module === module && rows[i].token === token) return rows[i];
  return null;
}
function saveAttSession_(row) { updateRow_(SHEETS.ATT_SESSIONS, row._row, row); }
function attRecordPublic_(r) {
  return { recordId: String(r.recordId || ''), name: r.studentName, studentId: r.studentId, email: r.email, scannedAt: r.scannedAt, status: r.status || 'present' };
}
/** A session row, only if it belongs to THIS module (group) — every teacher action on a session goes through this. */
function findModuleAttSession_(module, sessionId) {
  var row = findAttSessionRow_(String(sessionId || ''));
  return row && row.module === module ? row : null;
}
function attSessionPublic_(row) {
  return {
    sessionId: row.sessionId, code: row.code, academicYear: row.academicYear, course: row.course, chapter: row.chapter,
    sessionTitle: row.sessionTitle, teacher: row.teacher, status: row.status, createdAt: row.createdAt, endedAt: row.endedAt,
    driveStatus: row.driveStatus || '', driveUrl: row.driveUrl || '', driveError: row.driveError || ''
  };
}

function actionStartAttendance_(module, p) {
  var sessionTitle = String(p.sessionTitle || '').trim();
  if (!sessionTitle) return { ok: false, error: 'A session title is required (e.g. "Session 2 — Acute Inflammation").' };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sessionId = Utilities.getUuid();
    var row = {
      module: module, sessionId: sessionId, code: genAttendanceCode_(), token: randomHex_(20),
      academicYear: String(p.academicYear || '').trim(), course: String(p.course || '').trim() || 'Pathology',
      chapter: String(p.chapter || '').trim(), sessionTitle: sessionTitle, teacher: String(p.teacher || '').trim(),
      status: 'active', createdAt: Date.now(), endedAt: '', driveStatus: '', driveUrl: '', driveError: ''
    };
    appendRow_(SHEETS.ATT_SESSIONS, row);
    return { ok: true, sessionId: sessionId, code: row.code, token: row.token };
  } finally { lock.releaseLock(); }
}

function actionCloseAttendance_(module, p) {
  var row = findModuleAttSession_(module, p.sessionId);
  if (!row) return { ok: false, error: 'Session not found.', code: 'notfound' };
  if (row.status !== 'closed') { row.status = 'closed'; row.endedAt = Date.now(); }
  var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === p.sessionId; });
  var sync = trySyncAttendanceToDrive_(row, records);
  row.driveStatus = sync.status; row.driveUrl = sync.url || row.driveUrl || ''; row.driveError = sync.error || '';
  saveAttSession_(row);
  return {
    ok: true,
    report: {
      session: attSessionPublic_(row),
      records: records.map(attRecordPublic_)
    }
  };
}

function actionRetrySyncAttendance_(module, p) {
  var row = findModuleAttSession_(module, p.sessionId);
  if (!row) return { ok: false, error: 'Session not found.', code: 'notfound' };
  var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === p.sessionId; });
  var sync = trySyncAttendanceToDrive_(row, records);
  row.driveStatus = sync.status; row.driveUrl = sync.url || row.driveUrl || ''; row.driveError = sync.error || '';
  saveAttSession_(row);
  return { ok: sync.status === 'synced', driveStatus: row.driveStatus, driveUrl: row.driveUrl, error: sync.error || '' };
}

function actionGetAttendanceTeacherState_(module, p) {
  var row = findModuleAttSession_(module, p.sessionId);
  if (!row) return { ok: false, error: 'Session not found.', code: 'notfound' };
  var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === p.sessionId; })
    .sort(function (a, b) { return Number(a.scannedAt) - Number(b.scannedAt); });
  var session = attSessionPublic_(row);
  session.token = row.token;
  return {
    ok: true, session: session,
    records: records.map(attRecordPublic_)
  };
}

function actionListAttendanceSessions_(module, p) {
  var rows = readAll_(SHEETS.ATT_SESSIONS).filter(function (r) { return r.module === module; })
    .sort(function (a, b) { return Number(b.createdAt) - Number(a.createdAt); });
  var counts = {};
  readAll_(SHEETS.ATT_RECORDS).forEach(function (r) { counts[r.sessionId] = (counts[r.sessionId] || 0) + 1; });
  return { ok: true, sessions: rows.map(function (r) { return Object.assign(attSessionPublic_(r), { present: counts[r.sessionId] || 0 }); }) };
}

/** Teacher-only: permanently deletes ONE closed attendance session of THIS module (group) — its session row and
 *  every check-in record belonging to it. Other sessions/modules are never touched. The Drive report copy, if any,
 *  is moved to the Drive trash (recoverable there for 30 days), never permanently deleted. Active sessions must be
 *  closed first, so a class that is still checking in can never lose its records mid-session. */
function actionDeleteAttendanceSession_(module, p) {
  var sid = String(p.sessionId || '');
  if (!sid) return { ok: false, error: 'No session was specified. Nothing was deleted.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var row = findAttSessionRow_(sid);
    if (!row || row.module !== module) return { ok: false, code: 'notfound', error: 'This session was not found — it may already have been deleted.' };
    if (row.status === 'active') return { ok: false, code: 'active', error: 'This session is still open. Close attendance first, then delete it.' };
    var recs = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === sid; });
    for (var i = recs.length - 1; i >= 0; i--) deleteRow_(SHEETS.ATT_RECORDS, recs[i]._row); // bottom-up keeps row numbers valid
    deleteRow_(SHEETS.ATT_SESSIONS, row._row);
    var driveTrashed = false;
    var m = /\/d\/([A-Za-z0-9_\-]{10,})/.exec(String(row.driveUrl || ''));
    if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); driveTrashed = true; } catch (e) { console.error('attendance delete: could not trash Drive copy: ' + (e && e.message || e)); } }
    console.log('attendance session deleted · module ' + module + ' · ' + sid + ' · “' + row.sessionTitle + '” · ' + recs.length + ' records');
    return { ok: true, deletedRecords: recs.length, driveTrashed: driveTrashed };
  } finally { lock.releaseLock(); }
}

function actionGetAttendanceSessionReport_(module, p) {
  var row = findModuleAttSession_(module, p.sessionId);
  if (!row) return { ok: false, error: 'Session not found.', code: 'notfound' };
  var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === p.sessionId; })
    .sort(function (a, b) { return Number(a.scannedAt) - Number(b.scannedAt); });
  return {
    ok: true, session: attSessionPublic_(row),
    records: records.map(attRecordPublic_)
  };
}

function actionGetAttendanceSettings_() {
  return {
    ok: true,
    settings: { university: getSetting_('att:university') || '', faculty: getSetting_('att:faculty') || '', department: getSetting_('att:department') || '' }
  };
}
function actionSetAttendanceSettings_(p) {
  var s = p.settings || {};
  setSetting_('att:university', String(s.university || ''));
  setSetting_('att:faculty', String(s.faculty || ''));
  setSetting_('att:department', String(s.department || ''));
  return { ok: true };
}

function actionGetAttendanceInfo_(module, p) {
  var row = findAttSessionByToken_(module, String(p.token || ''));
  if (!row) return { ok: false, error: 'This attendance link is not valid. Ask your teacher for the current QR code or code.', code: 'notfound' };
  if (row.status !== 'active') return { ok: false, error: 'This attendance session has been closed. Ask your teacher for the current QR code.', code: 'closed' };
  return { ok: true, session: attSessionPublic_(row) };
}

function actionSubmitAttendance_(module, p) {
  var row = findAttSessionByToken_(module, String(p.token || ''));
  if (!row) return { ok: false, error: 'This attendance link is not valid. Ask your teacher for the current QR code or code.', code: 'notfound' };
  if (row.status !== 'active') return { ok: false, error: 'This attendance session has been closed. Your attendance was not recorded — ask your teacher for the current QR code.', code: 'closed' };
  return recordAttendance_(row, p);
}

/* Attendance code (typed by the student). Codes are generated here on the server, 6 characters from an alphabet
 * without O/0/I/1/L, are unique among open sessions, and are looked up ONLY among this module's (group's) OPEN
 * sessions — so a closed session's code, or a code the teacher has regenerated, can never record attendance. */
function normAttCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function findActiveAttSessionByCode_(module, code) {
  if (!code) return null;
  var rows = readAll_(SHEETS.ATT_SESSIONS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.module === module && r.status === 'active' && normAttCode_(r.code) === code) return r;
  }
  return null;
}
function actionSubmitAttendanceByCode_(module, p) {
  var code = normAttCode_(p.code);
  if (code.length < 4) return { ok: false, code: 'badcode', error: 'Please enter the attendance code shown by your teacher.' };
  var row = findActiveAttSessionByCode_(module, code);
  if (!row) return { ok: false, code: 'badcode', error: 'That attendance code is not valid. It may have been changed or the session may have ended — check the code on the screen and try again.' };
  var r = recordAttendance_(row, p);
  if (r.ok) r.session = attSessionPublic_(row);
  return r;
}
/** Teacher-only: replace an OPEN session's code with a brand-new one. The old code stops working immediately. */
function actionRegenerateAttendanceCode_(module, p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var row = findModuleAttSession_(module, p.sessionId);
    if (!row) return { ok: false, code: 'notfound', error: 'Session not found.' };
    if (row.status !== 'active') return { ok: false, code: 'closed', error: 'This session is closed — start a new session to get a new code.' };
    var old = row.code;
    row.code = genAttendanceCode_(); // unique among open sessions, so it can never equal the code it replaces
    saveAttSession_(row);
    console.log('attendance code regenerated · module ' + module + ' · ' + row.sessionId + ' · ' + old + ' → ' + row.code);
    return { ok: true, code: row.code };
  } finally { lock.releaseLock(); }
}
/** Teacher-only: remove ONE student's check-in from ONE session of THIS module. Open or closed sessions both work;
 *  for a closed session that already has a Drive copy, that copy is re-synced so it matches the database. */
function actionDeleteAttendanceRecord_(module, p) {
  var sid = String(p.sessionId || ''), rid = String(p.recordId || '');
  if (!sid || !rid) return { ok: false, error: 'No attendance record was specified. Nothing was removed.' };
  var row, rec;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    row = findModuleAttSession_(module, sid);
    if (!row) return { ok: false, code: 'notfound', error: 'This attendance session was not found.' };
    rec = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === sid && String(r.recordId) === rid; })[0];
    if (!rec) return { ok: false, code: 'notfound', error: 'This attendance record was not found — it may already have been removed.' };
    deleteRow_(SHEETS.ATT_RECORDS, rec._row);
  } finally { lock.releaseLock(); }
  console.log('attendance record removed · module ' + module + ' · session ' + sid + ' · "' + rec.studentName + '" (' + rid + ')');
  var out = { ok: true, removed: attRecordPublic_(rec) };
  if (row.status !== 'active' && row.driveUrl) {
    var fresh = findModuleAttSession_(module, sid) || row;
    var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === sid; });
    var sync = trySyncAttendanceToDrive_(fresh, records);
    fresh.driveStatus = sync.status; fresh.driveUrl = sync.url || fresh.driveUrl || ''; fresh.driveError = sync.error || '';
    saveAttSession_(fresh);
    out.driveStatus = fresh.driveStatus; out.driveError = fresh.driveError;
  }
  return out;
}

/** Records one student's attendance in an OPEN session (shared by the QR-link and the typed-code check-in). */
function recordAttendance_(row, p) {
  var name = String(p.name || '').trim();
  if (!name) return { ok: false, error: 'Please enter your name.' };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var records = readAll_(SHEETS.ATT_RECORDS).filter(function (r) { return r.sessionId === row.sessionId; });
    var participantId = String(p.participantId || '').trim();
    if (participantId) {
      var mine = records.filter(function (r) { return r.participantId === participantId; })[0];
      if (mine) { mine.studentName = name; mine.studentId = p.studentId || mine.studentId; mine.email = p.email || mine.email; updateRow_(SHEETS.ATT_RECORDS, mine._row, mine); return { ok: true, alreadyRecorded: true, scannedAt: mine.scannedAt }; }
    }
    var norm = function (s) { return String(s || '').trim().toLowerCase(); };
    var dup = records.filter(function (r) {
      return norm(r.studentName) === norm(name) && (!p.studentId || !r.studentId || norm(r.studentId) === norm(p.studentId));
    })[0];
    if (dup) return { ok: true, alreadyRecorded: true, scannedAt: dup.scannedAt };
    var now = Date.now();
    var rec = {
      sessionId: row.sessionId, recordId: Utilities.getUuid(), participantId: participantId || Utilities.getUuid(),
      studentName: name, studentId: String(p.studentId || '').trim(), email: String(p.email || '').trim(),
      status: 'present', scannedAt: now, createdAt: now
    };
    appendRow_(SHEETS.ATT_RECORDS, rec);
    return { ok: true, alreadyRecorded: false, scannedAt: now, participantId: rec.participantId };
  } finally { lock.releaseLock(); }
}


/* TEST STUB (not from Code.gs): the Drive copy of an attendance report — counts calls instead of creating a Google Sheet. */
var ATT_DRIVE_SYNCS = 0;
function trySyncAttendanceToDrive_(row, records) { ATT_DRIVE_SYNCS++; return { status: 'synced', url: 'https://docs.google.com/spreadsheets/d/TESTFILE' + row.sessionId.slice(0, 8) + '/edit' }; }

/* ---- Live Classroom (verbatim from Code.gs v1.7: classroom code, storage adapter, engine) ---- */
function livePwKey_(module) { return 'livepw:' + module; }
function actionGetLiveClassroomPassword_(module) {
  return { ok: true, password: getSetting_(livePwKey_(module)) || DEFAULT_LIVE_PW[module] || 'CLASSROOM-2026' };
}
function actionSetLiveClassroomPassword_(module, p) {
  var pw = String(p.password || '').trim();
  if (pw.length < 4) return { ok: false, error: 'Code must be at least 4 characters.' };
  setSetting_(livePwKey_(module), pw);
  return { ok: true, password: pw };
}

/* ---------------------------------------------------------------------- *
 * Live Classroom v1.2 — storage adapter for the shared engine.
 * The engine (LE_createService) holds every rule; this block only maps its
 * store interface onto Sheets (durable data), CacheService (presence, typing,
 * change-version fast path, auth cache) and Drive (private files uploaded via
 * a server-side resumable session in 2 MB chunks — no whole-file base64).
 * ---------------------------------------------------------------------- */
function liveSvc_() { return LE_createService(liveStore_()); }
function liveCache_() { return CacheService.getScriptCache(); }
function liveTeacherTokenOk_(module, token) {
  if (!token) return false;
  var c = liveCache_(), k = 'tok:' + module + ':' + token;
  if (c.get(k)) return true;
  var rows = readAll_(SHEETS.SESSIONS);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // r.module blank = a pre-upgrade session (grandfathered, see authed_); otherwise it must match this module.
    if (r.token === token && Number(r.expiresAt) > Date.now() && (!r.module || r.module === module)) {
      c.put(k, '1', Math.max(60, Math.min(1800, Math.floor((Number(r.expiresAt) - Date.now()) / 1000))));
      return true;
    }
  }
  return false;
}
/** Answer a liveSync from cache only when nothing changed (see LE sync fast path) — or return null to take the full path. */
function liveSyncFast_(p) {
  var module = String(p.module || 'default'); var since = Number(p.since) || 0;
  if (p.full || !p.readVer) return null;
  var c = liveCache_();
  var verRaw = c.get(p.allModules ? 'ver:*' : 'ver:' + module);
  if (verRaw === null || Number(verRaw) > since) return null;
  var pid;
  if (p.token) { if (!c.get('tok:' + module + ':' + p.token)) return null; pid = LE_TEACHER_PID; }
  else { if (!p.participantId || !c.get('mem:' + module + ':' + p.participantId)) return null; pid = p.participantId; }
  var rv = c.get('rv:' + (p.token ? '*' : module + ':' + pid)); if (!rv || rv !== p.readVer) return null;
  var svc = LE_createService(liveStore_());
  return svc.sync(module, p); // takes the engine's own fast path: CacheService reads only
}
function liveJsonCols_(rec, key, n) { var s = JSON.stringify(rec[key] || (key === 'reactions' ? {} : [])); return s; }
function liveStore_() {
  var memo = {};
  function msgs() {
    if (!memo.msgs) memo.msgs = readAll_(SHEETS.LIVE_CHAT).map(function (r) {
      var j = function (v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
      return { _row: r._row, module: r.module, id: String(r.id), kind: r.kind || 'message', authorRole: r.authorRole, authorName: r.authorName, participantId: r.participantId || '',
        body: String(r.body || ''), imageUrl: r.imageUrl || '', fileUrl: r.fileUrl || '', fileName: r.fileName || '', fileMime: r.fileMime || '', replyToId: r.replyToId || '',
        pinned: r.pinned === true || r.pinned === 'TRUE', edited: r.edited === true || r.edited === 'TRUE', deleted: r.deleted === true || r.deleted === 'TRUE',
        reactions: j(r.reactionsJson, {}), createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0, seq: Number(r.seq) || 0, ord: Number(r.ord) || 0,
        clientId: r.clientId || '', replyToPid: r.replyToPid || '', mentions: j(r.mentionsJson, []), mentionAll: r.mentionAll === true || r.mentionAll === 'TRUE', attachments: j(r.attachmentsJson, []) };
    });
    return memo.msgs;
  }
  function msgRow(m) {
    return { module: m.module, id: m.id, kind: m.kind, authorRole: m.authorRole, authorName: m.authorName, participantId: m.participantId || '', body: m.body || '',
      imageUrl: m.imageUrl || '', fileUrl: m.fileUrl || '', fileName: m.fileName || '', fileMime: m.fileMime || '', replyToId: m.replyToId || '', pinned: !!m.pinned,
      edited: !!m.edited, deleted: !!m.deleted, reactionsJson: JSON.stringify(m.reactions || {}), createdAt: m.createdAt, updatedAt: m.updatedAt, seq: m.seq, ord: m.ord || '',
      clientId: m.clientId || '', replyToPid: m.replyToPid || '', mentionsJson: JSON.stringify(m.mentions || []), mentionAll: !!m.mentionAll, attachmentsJson: JSON.stringify(m.attachments || []) };
  }
  function mems() {
    if (!memo.mems) memo.mems = readAll_(SHEETS.LIVE_MEMBERS).map(function (r) {
      var j = function (v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
      return { _row: r._row, module: r.module, participantId: String(r.participantId), role: r.role, name: r.name, email: r.email || '', prefs: j(r.prefsJson, {}),
        readUpTo: Number(r.readUpTo) || 0, readIds: j(r.readIdsJson, []), readVer: Number(r.readVer) || 0, removed: r.removed === true || r.removed === 'TRUE',
        joinedAt: Number(r.joinedAt) || 0, updatedAt: Number(r.updatedAt) || 0 };
    });
    return memo.mems;
  }
  function files() {
    if (!memo.files) memo.files = readAll_(SHEETS.LIVE_FILES).map(function (r) {
      return { _row: r._row, module: r.module, id: String(r.id), name: r.name, mime: r.mime, size: Number(r.size) || 0, uploaderPid: r.uploaderPid, status: r.status,
        storageId: r.storageId || '', messageId: r.messageId || '', preview: r.preview || '', createdAt: Number(r.createdAt) || 0, readyAt: Number(r.readyAt) || 0 };
    });
    return memo.files;
  }
  var props = PropertiesService.getScriptProperties();
  return {
    now: function () { return Date.now(); },
    uuid: function () { return Utilities.getUuid(); },
    lock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { memo = {}; return fn(); } finally { l.releaseLock(); } },
    cacheGet: function (k) { return liveCache_().get(k); },
    cachePut: function (k, v, ttl) { liveCache_().put(k, v, ttl || 600); },
    nextSeq: function () { var n = Number(props.getProperty('liveSeq') || 0) + 1; props.setProperty('liveSeq', String(n)); return n; },
    currentSeq: function () { return Number(props.getProperty('liveSeq') || 0); },
    messages: msgs,
    insertMessage: function (m) { appendRow_(SHEETS.LIVE_CHAT, msgRow(m)); msgs().push(m); },
    updateMessage: function (m) { if (!m._row) { var all = msgs(); for (var i = 0; i < all.length; i++) if (all[i].id === m.id && all[i].module === m.module) { m._row = all[i]._row; break; } } updateRow_(SHEETS.LIVE_CHAT, m._row, msgRow(m)); },
    members: mems,
    putMember: function (m) {
      var row = { module: m.module, participantId: m.participantId, role: m.role, name: m.name, email: m.email || '', prefsJson: JSON.stringify(m.prefs || {}), readUpTo: m.readUpTo || 0,
        readIdsJson: JSON.stringify(m.readIds || []), readVer: m.readVer || 0, removed: !!m.removed, joinedAt: m.joinedAt || Date.now(), updatedAt: Date.now() };
      var all = mems(); for (var i = 0; i < all.length; i++) if (all[i].module === m.module && all[i].participantId === m.participantId) { updateRow_(SHEETS.LIVE_MEMBERS, all[i]._row, row); m._row = all[i]._row; all[i] = m; return; }
      appendRow_(SHEETS.LIVE_MEMBERS, row); all.push(m);
    },
    fileGet: function (id) { var all = files(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; },
    filePut: function (f) {
      var row = { module: f.module, id: f.id, name: f.name, mime: f.mime, size: f.size, uploaderPid: f.uploaderPid, status: f.status, storageId: f.storageId || '', messageId: f.messageId || '', preview: f.preview || '', createdAt: f.createdAt, readyAt: f.readyAt || '' };
      var all = files(); for (var i = 0; i < all.length; i++) if (all[i].id === f.id) { updateRow_(SHEETS.LIVE_FILES, all[i]._row, row); all[i] = f; f._row = all[i]._row; return; }
      appendRow_(SHEETS.LIVE_FILES, row); all.push(f);
    },
    /* ---- Drive resumable session: created server-side (the OAuth token never leaves the server). Each 2 MB chunk is
     *      forwarded straight into that session; progress, retry and resume all work at chunk granularity. ---- */
    blobInit: function (f) {
      var folder = liveFolder_(f.module);
      var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': f.mime, 'X-Upload-Content-Length': String(f.size) },
        payload: JSON.stringify({ name: f.name, parents: [folder.getId()], mimeType: f.mime })
      });
      var h = res.getAllHeaders(); var loc = h.Location || h.location;
      if (!loc) throw new Error('Drive did not start the upload (' + res.getResponseCode() + '). Run authorizeDriveAccess once in the Apps Script editor.');
      liveCache_().put('upl:' + f.id, loc, 21600);
      return {};
    },
    blobPut: function (f, offset, b64) {
      var loc = liveCache_().get('upl:' + f.id); if (!loc) throw new Error('This upload expired — please upload the file again.');
      var bytes = Utilities.base64Decode(b64);
      var res = UrlFetchApp.fetch(loc, { method: 'put', contentType: f.mime, payload: bytes, muteHttpExceptions: true,
        headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + bytes.length - 1) + '/' + f.size } });
      var code = res.getResponseCode();
      if (code === 200 || code === 201) { var id = JSON.parse(res.getContentText()).id; return { received: f.size, done: true, storageId: id }; }
      if (code === 308) { var rg = res.getAllHeaders().Range || res.getAllHeaders().range; return { received: rg ? Number(String(rg).split('-')[1]) + 1 : 0, done: false }; }
      throw new Error('Storage rejected the chunk (' + code + ').');
    },
    blobStatus: function (f) {
      if (f.status === 'ready') return { received: f.size, done: true, storageId: f.storageId };
      var loc = liveCache_().get('upl:' + f.id); if (!loc) return { received: 0, done: false };
      var res = UrlFetchApp.fetch(loc, { method: 'put', muteHttpExceptions: true, headers: { 'Content-Range': 'bytes */' + f.size } });
      var code = res.getResponseCode();
      if (code === 200 || code === 201) return { received: f.size, done: true, storageId: JSON.parse(res.getContentText()).id };
      var rg = res.getAllHeaders().Range || res.getAllHeaders().range;
      return { received: rg ? Number(String(rg).split('-')[1]) + 1 : 0, done: false };
    },
    blobRead: function (f, offset, length) {
      var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.storageId + '?alt=media', { muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + offset + '-' + (offset + length - 1) } });
      if (res.getResponseCode() !== 206 && res.getResponseCode() !== 200) throw new Error('Storage read failed (' + res.getResponseCode() + ').');
      return Utilities.base64Encode(res.getContent());
    },
    isTeacherToken: liveTeacherTokenOk_,
    classCode: function (module) { return getSetting_(livePwKey_(module)) || DEFAULT_LIVE_PW[module] || 'CLASSROOM-2026'; },
    moduleTitle: function (module) { var k = 'modtitle:' + module, c = liveCache_().get(k); if (c) return c; var t = getSetting_(k) || ''; if (t) liveCache_().put(k, t, 21600); return t; },
    moduleUrl: function (module) { var k = 'modurl:' + module, c = liveCache_().get(k); if (c !== null) return c; var t = getSetting_(k) || ''; liveCache_().put(k, t, 21600); return t; }
  };
}
function liveFolder_(module) {
  var root = getImageFolder_();
  var name = 'Live classroom files — ' + module;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name); // private: nothing inside is link-shared
}


/* ==== LIVE ENGINE BEGIN (generated from src/08_live_engine.js by build.py — edit that file, not this block) ==== */
/* ==========================================================================
   08_live_engine.js — the ONE Live Classroom engine (messages, change feed,
   idempotency, ordering, notification rules, read state, presence, typing,
   file transfer rules). Self-contained (no DOM, no platform globals): build.py
   copies it verbatim into backend/Code.gs (LIVE ENGINE markers) and the test
   mock loads it directly, so server, mock and client share one set of rules.

   Model
   -----
   • Every mutation (create / edit / delete / pin / react) stamps the message
     with a new, globally increasing `seq` (assigned under a lock). Clients keep
     a cursor and ask "what changed since seq N?" — one small delta instead of
     re-downloading the conversation. Deletions travel as tombstones.
   • `ord` = the seq a message received when it was CREATED: an immutable,
     server-assigned ordering key (browser clocks and arrival order never matter).
   • `clientId` = idempotency key generated by the sender's browser. Posting the
     same clientId twice returns the original message — never a duplicate.
   • Notifications are derived per recipient from the message log by explicit
     rules (fan-out on read): nothing extra is written when a message is sent,
     so notification work can never slow sending down. Notification ids are
     deterministic ("<messageId>:<TYPE>") so the same event can never produce
     two notifications. Read state (a watermark + individually-read ids) is
     persisted per member on the server — the source of truth for unread counts
     on every tab and device.
   ========================================================================== */
var LE_PAGE = 40;
var LE_MAX_BODY = 4000;
var LE_MAX_ATTACH = 6;
var LE_MAX_FILE_BYTES = 50 * 1024 * 1024;
var LE_CHUNK_BYTES = 2 * 1024 * 1024;            // multiple of 256 KiB (Drive resumable requirement)
var LE_PREVIEW_MAX_CHARS = 30000;                // inline image preview (data URL) budget per image
var LE_ONLINE_MS = 60 * 1000;
var LE_TYPING_MS = 6000;
var LE_NOTIF_WINDOW_MS = 30 * 24 * 3600 * 1000;  // notifications consider the last 30 days
var LE_MAX_DELTA = 400;                          // larger gaps → client resyncs the latest page
var LE_TYPES = { MESSAGE: 'LIVE_MESSAGE', REPLY: 'LIVE_REPLY', MENTION: 'LIVE_MENTION', ANNOUNCEMENT: 'LIVE_ANNOUNCEMENT', ATTACHMENT: 'LIVE_ATTACHMENT' };
var LE_PREF_KEY = { LIVE_MESSAGE: 'message', LIVE_REPLY: 'reply', LIVE_MENTION: 'mention', LIVE_ANNOUNCEMENT: 'announcement', LIVE_ATTACHMENT: 'attachment' };
var LE_DEFAULT_PREFS = { message: true, reply: true, mention: true, announcement: true, attachment: true, muted: false };
var LE_BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|wsh|ps1|psm1|sh|jar|app|dmg|apk|iso|dll|sys|reg|lnk|hta|cpl)$/i;
var LE_INLINE_MIME = /^(image\/(png|jpe?g|gif|webp|bmp|svg\+xml)|application\/pdf|text\/plain)$/i;
var LE_TEACHER_PID = '__teacher__';

/* ---------------- pure helpers ---------------- */
function LE_norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function LE_normEmail(e) { return String(e || '').trim().toLowerCase(); }
function LE_validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(LE_normEmail(e)); }
function LE_hash(s) { var h = 2166136261 >>> 0; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('00000000' + h.toString(16)).slice(-8); }
/** Stable participant id for a student: same email in the same classroom ⇒ same identity on every device. */
function LE_pidFor(module, email) { var e = LE_normEmail(email); return 'p_' + LE_hash(module + '|' + e) + LE_hash(e + '|' + module); }
function LE_cmp(a, b) { var x = a.ord || 0, y = b.ord || 0; if (x && y) return x - y; if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt; return String(a.id) < String(b.id) ? -1 : 1; }
function LE_prefs(m) { var p = {}; for (var k in LE_DEFAULT_PREFS) p[k] = LE_DEFAULT_PREFS[k]; var s = (m && m.prefs) || {}; for (var k2 in s) if (k2 in LE_DEFAULT_PREFS || k2 === 'browser') p[k2] = s[k2]; return p; }
/** Resolve @mentions against the classroom's members (longest names first, so "@Ahmed Ali" beats "@Ahmed"). */
function LE_parseMentions(body, members, authorRole) {
  var text = ' ' + String(body || '') + ' ';
  var out = { pids: [], all: false };
  if (authorRole === 'teacher' && /(^|\s)@(everyone|all|class)\b/i.test(text)) out.all = true;
  var low = text.toLowerCase();
  var list = (members || []).filter(function (m) { return m.name; }).slice().sort(function (a, b) { return b.name.length - a.name.length; });
  list.forEach(function (m) {
    var tag = '@' + String(m.name).toLowerCase();
    var i = low.indexOf(tag);
    while (i >= 0) {
      var after = low.charAt(i + tag.length);
      if (!/[a-z0-9À-ɏ]/.test(after)) { if (out.pids.indexOf(m.participantId) < 0) out.pids.push(m.participantId); break; }
      i = low.indexOf(tag, i + 1);
    }
  });
  if (/(^|\s)@teacher\b/i.test(text) && out.pids.indexOf(LE_TEACHER_PID) < 0) out.pids.push(LE_TEACHER_PID);
  return out;
}
/** The ONE notification rule set. Returns the single most relevant type for this recipient, or null. */
function LE_notificationType(m, member, prefs) {
  if (!m || m.deleted || !member) return null;
  var pid = member.participantId;
  var authorPid = m.authorRole === 'teacher' ? LE_TEACHER_PID : m.participantId;
  if (authorPid === pid) return null;                         // never notify people about their own messages
  var p = prefs || LE_prefs(member);
  var isTeacherRecipient = member.role === 'teacher';
  var type = null;
  if ((m.mentions || []).indexOf(pid) >= 0 || (m.mentionAll && !isTeacherRecipient)) type = LE_TYPES.MENTION;
  else if (m.replyToPid && m.replyToPid === pid) type = LE_TYPES.REPLY;
  else if (m.kind === 'announcement' && !isTeacherRecipient) type = LE_TYPES.ANNOUNCEMENT;
  else if (m.authorRole === 'teacher' && !isTeacherRecipient && (m.attachments || []).length) type = LE_TYPES.ATTACHMENT;
  else if (isTeacherRecipient ? m.authorRole !== 'teacher' : m.authorRole === 'teacher') type = LE_TYPES.MESSAGE;
  if (!type) return null;
  if (p[LE_PREF_KEY[type]] === false) return null;
  if (p.muted && (type === LE_TYPES.MESSAGE || type === LE_TYPES.ATTACHMENT)) return null; // mute keeps mentions/replies/announcements
  return type;
}
function LE_notifFor(m, member, moduleTitle) {
  var t = LE_notificationType(m, member);
  if (!t) return null;
  var att = (m.attachments || [])[0];
  return { id: m.id + ':' + t, type: t, module: m.module, moduleTitle: moduleTitle || '', messageId: m.id, seq: m.ord || m.seq || 0,
    senderName: m.authorName, senderRole: m.authorRole, preview: String(m.body || '').slice(0, 140),
    fileName: att ? att.name : (m.fileName || ''), attachmentId: att ? att.fileId : '', createdAt: m.createdAt,
    link: { view: 'live', module: m.module, messageId: m.id } };
}
function LE_isRead(n, member) { return (n.seq && n.seq <= (member.readUpTo || 0)) || (member.readIds || []).indexOf(n.id) >= 0; }

/* ---------------- output shapes ---------------- */
function LE_out(m) {
  if (m.deleted) return { id: m.id, deleted: true, seq: m.seq, module: m.module };
  var counts = {}, mine = {};
  var r = m.reactions || {};
  for (var actor in r) { counts[r[actor]] = (counts[r[actor]] || 0) + 1; }
  return { id: m.id, clientId: m.clientId || '', module: m.module, seq: m.seq || 0, ord: m.ord || 0, kind: m.kind || 'message', authorRole: m.authorRole,
    authorName: m.authorName, participantId: m.participantId || '', body: m.body || '', imageUrl: m.imageUrl || '', fileUrl: m.fileUrl || '',
    fileName: m.fileName || '', fileMime: m.fileMime || '', attachments: m.attachments || [], mentions: m.mentions || [], mentionAll: !!m.mentionAll,
    replyToId: m.replyToId || '', pinned: !!m.pinned, edited: !!m.edited, reactions: counts, reactors: r, createdAt: m.createdAt, updatedAt: m.updatedAt || m.createdAt };
}

/* ---------------- the service ----------------
 * store = { now, uuid, lock(fn), cacheGet(k), cachePut(k, str, ttlSec),
 *   nextSeq() (inside lock), currentSeq(), messages() (all modules), insertMessage(rec), updateMessage(rec),
 *   members() (all modules), putMember(rec), fileGet(id), filePut(rec),
 *   blobInit(fileRec) -> {}, blobPut(fileRec, offset, base64) -> {received, done, storageId}, blobStatus(fileRec) -> {received, done, storageId},
 *   blobRead(fileRec, offset, length) -> base64, isTeacherToken(token), classCode(module), moduleTitle(module) }
 */
function LE_createService(store) {
  var T0 = store.now();
  function pres(module) { try { return JSON.parse(store.cacheGet('pres:' + module) || '{}'); } catch (e) { return {}; } }
  function savePres(module, map) { store.cachePut('pres:' + module, JSON.stringify(map), 600); }
  function typingMap(module) { try { return JSON.parse(store.cacheGet('typ:' + module) || '{}'); } catch (e) { return {}; } }
  function memberOf(module, pid) { var all = store.members(); for (var i = 0; i < all.length; i++) if (all[i].module === module && all[i].participantId === pid) return all[i]; return null; }
  function teacherMember(module) {
    var m = memberOf(module, LE_TEACHER_PID);
    if (!m) { m = { module: module, participantId: LE_TEACHER_PID, role: 'teacher', name: 'Teacher', email: '', prefs: {}, readUpTo: store.currentSeq(), readIds: [], readVer: 0, joinedAt: store.now() }; store.putMember(m); }
    return m;
  }
  /** Who is calling? Teacher (valid session token) or a joined member of THIS classroom. */
  function auth(module, p) {
    if (p.token) { if (store.isTeacherToken(module, p.token)) return { role: 'teacher', pid: LE_TEACHER_PID, name: 'Teacher', token: p.token }; return null; }
    if (p.participantId) {
      var cached = store.cacheGet('mem:' + module + ':' + p.participantId);
      if (cached) return { role: 'student', pid: p.participantId, name: cached };
      var m = memberOf(module, p.participantId);
      if (m && m.role === 'student' && !m.removed) { store.cachePut('mem:' + module + ':' + p.participantId, m.name, 1800); return { role: 'student', pid: m.participantId, name: m.name }; }
    }
    return null;
  }
  /** Message output + its image previews (previews live with the file record, not in the message log,
   *  so scanning the log for changes stays cheap no matter how many pictures were shared). */
  function outM(m) {
    var o = LE_out(m);
    if (o.attachments && o.attachments.length) o.attachments = o.attachments.map(function (x) {
      if (x.kind !== 'image' || x.preview) return x;
      var f = store.fileGet(x.fileId); var y = {}; for (var k in x) y[k] = x[k]; y.preview = (f && f.preview) || ''; return y; });
    return o;
  }
  function deny() { return { ok: false, error: 'Please rejoin the classroom.', code: 'auth' }; }
  function roster(module) { return store.members().filter(function (m) { return m.module === module && !m.removed; }); }
  function msgsOf(module) { return store.messages().filter(function (m) { return m.module === module; }); }
  function findMsg(module, id) { var a = store.messages(); for (var i = 0; i < a.length; i++) if (a[i].module === module && a[i].id === id) return a[i]; return null; }
  function bump(module) { store.cachePut('ver:' + module, String(store.currentSeq()), 21600); store.cachePut('ver:*', String(store.currentSeq()), 21600); }
  function touch(module, a, p) {
    var map = pres(module); var now = store.now(); var e = map[a.pid] || {};
    if (!p.hb && e.t && now - e.t < 25000 && e.v === !!p.viewing && (Number(p.since) || 0) <= (e.s || 0)) return; // cache-only; refreshed on heartbeat, view change or new data
    map[a.pid] = { n: a.name, r: a.role, t: now, s: Number(p.since) || e.s || 0, v: !!p.viewing };
    for (var k in map) if (now - map[k].t > 10 * 60000) delete map[k];
    savePres(module, map);
  }
  function online(module, meId) {
    var map = pres(module), now = store.now(), teacher = false, students = [], seen = 0;
    for (var k in map) { var e = map[k]; if (now - e.t > LE_ONLINE_MS) continue; if (e.r === 'teacher') teacher = true; else students.push(e.n); if (k !== meId && e.v) seen = Math.max(seen, e.s || 0); }
    return { teacherOnline: teacher, studentCount: students.length, names: students.slice(0, 12), seenSeq: seen };
  }
  function typingList(module, meId) {
    var map = typingMap(module), now = store.now(), out = [];
    for (var k in map) if (k !== meId && now - map[k].t < LE_TYPING_MS) out.push(map[k].n);
    return out;
  }
  /** Memberships of this identity across every classroom on this backend (teacher: all; student: same email). */
  function memberships(module, a) {
    var all = store.members();
    if (a.role === 'teacher') {
      var mods = {}; store.messages().forEach(function (m) { mods[m.module] = 1; }); mods[module] = 1;
      // per-module teacher accounts: the teacher's bell covers only the modules this teacher session is valid for
      return Object.keys(mods).filter(function (mod) { return mod === module || !a.token || store.isTeacherToken(mod, a.token); }).map(function (mod) { return teacherMember(mod); });
    }
    var me = memberOf(module, a.pid); if (!me) return [];
    return all.filter(function (m) { return m.role === 'student' && !m.removed && (m.participantId === me.participantId || (me.email && m.email === me.email)); });
  }
  function notificationsFor(mems, sinceSeq, limit) {
    var byMod = {}; mems.forEach(function (m) { byMod[m.module] = m; });
    var cutoff = store.now() - LE_NOTIF_WINDOW_MS; var out = [], unread = 0;
    store.messages().forEach(function (m) {
      var mem = byMod[m.module]; if (!mem || m.deleted || m.createdAt < cutoff) return;
      var n = LE_notifFor(m, mem, store.moduleTitle(m.module)); if (!n) return;
      if (store.moduleUrl) n.link.url = store.moduleUrl(m.module) || '';
      n.read = LE_isRead(n, mem); if (!n.read) unread++;
      if (!sinceSeq || n.seq > sinceSeq) out.push(n);
    });
    out.sort(function (x, y) { return y.seq - x.seq; });
    return { list: out.slice(0, limit || 60), unread: unread };
  }
  function readVersion(mems) { return mems.map(function (m) { return m.module + ':' + (m.readVer || 0); }).join('|'); }

  var S = {
    auth: auth,
    /* ---- joining: one classroom code, name + email (email = stable identity across devices) ---- */
    join: function (module, p) {
      var code = String(store.classCode(module) || '');
      if (!p.classCode || String(p.classCode).trim().toUpperCase() !== code.trim().toUpperCase()) return { ok: false, error: 'That classroom code doesn’t match — check with your teacher.', code: 'badcode' };
      var name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (name.length < 2) return { ok: false, error: 'Please enter your name.' };
      var email = LE_normEmail(p.email);
      if (email && !LE_validEmail(email)) return { ok: false, error: 'Please enter a valid email address.' };
      var pid = email ? LE_pidFor(module, email) : (p.participantId && /^[\w-]{6,64}$/.test(p.participantId) ? p.participantId : 'p_' + store.uuid().replace(/-/g, '').slice(0, 16));
      return store.lock(function () {
        var m = memberOf(module, pid);
        if (!m) m = { module: module, participantId: pid, role: 'student', name: name, email: email, prefs: {}, readUpTo: store.currentSeq(), readIds: [], readVer: 0, joinedAt: store.now() };
        m.name = name; if (email) m.email = email; m.removed = false; m.updatedAt = store.now();
        store.putMember(m); store.cachePut('mem:' + module + ':' + pid, name, 1800);
        return { ok: true, participantId: pid, name: name, email: m.email || '' };
      });
    },
    /* ---- the one realtime call: deltas + notifications + presence + typing ---- */
    sync: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      touch(module, a, p);
      var since = Number(p.since) || 0;
      var verRaw = store.cacheGet(p.allModules ? 'ver:*' : 'ver:' + module); var ver = Number(verRaw || 0);
      var rvKey = 'rv:' + (a.role === 'teacher' ? '*' : module + ':' + a.pid);
      var rv = store.cacheGet(rvKey) || '';
      var base = { ok: true, online: online(module, a.pid), typing: typingList(module, a.pid), serverTime: store.now(), nextPollMs: 0 };
      var n = base.online.studentCount;
      base.nextPollMs = Math.min(8000, Math.max(2000, 1500 + n * 45)); // server paces the class: more students ⇒ slightly slower polls
      // FAST PATH — nothing changed since this client's cursor and read state is unchanged: no sheet access at all.
      if (!p.full && verRaw !== null && verRaw !== undefined && ver <= since && rv && rv === p.readVer) { base.noChange = true; base.seq = since; base.readVer = rv; return base; }
      var seq = store.currentSeq();
      if (verRaw === null || verRaw === undefined) { store.cachePut('ver:' + module, String(seq), 21600); store.cachePut('ver:*', String(seq), 21600); } // (re)arm the fast path after a cache eviction
      var mems = memberships(module, a);
      var mine = mems.filter(function (m) { return m.module === module; })[0];
      if (!mine && a.role === 'teacher') mine = teacherMember(module);
      var out = base; out.seq = seq;
      if (p.full) {
        var all = msgsOf(module).filter(function (m) { return !m.deleted; }).sort(LE_cmp);
        out.initial = true; out.messages = all.slice(Math.max(0, all.length - LE_PAGE)).map(outM); out.hasMore = all.length > LE_PAGE;
        out.pinned = all.filter(function (m) { return m.pinned; }).map(outM);
      } else {
        var changed = msgsOf(module).filter(function (m) { return (m.seq || 0) > since; });
        if (changed.length > LE_MAX_DELTA) { out.resync = true; out.changes = []; }
        else out.changes = changed.sort(function (x, y) { return x.seq - y.seq; }).map(outM);
      }
      var scope = p.allModules ? mems : mems.filter(function (m) { return m.module === module; });
      var nf = notificationsFor(scope, p.full ? 0 : since, p.full ? 60 : 100);
      out.notifications = nf.list; out.unread = nf.unread;
      out.readVer = readVersion(scope); store.cachePut(rvKey, out.readVer, 21600);
      if (mine) out.readState = { readUpTo: mine.readUpTo || 0, readIds: mine.readIds || [] };
      out.prefs = mine ? LE_prefs(mine) : LE_prefs(null);
      return out;
    },
    history: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var all = msgsOf(module).filter(function (m) { return !m.deleted; }).sort(LE_cmp);
      var end = all.length;
      if (p.beforeId) { for (var i = 0; i < all.length; i++) if (all[i].id === p.beforeId) { end = i; break; } }
      var lim = Math.min(Number(p.limit) || LE_PAGE, 200);
      var page = all.slice(Math.max(0, end - lim), end);
      return { ok: true, messages: page.map(outM), hasMore: end - page.length > 0 };
    },
    /** Deep link support: one message plus the conversation around it and the message it replies to. */
    context: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var all = msgsOf(module).filter(function (m) { return !m.deleted; }).sort(LE_cmp);
      var i = -1; for (var k = 0; k < all.length; k++) if (all[k].id === p.id) { i = k; break; }
      if (i < 0) return { ok: false, error: 'That message is no longer available (it may have been deleted).', code: 'notfound' };
      var from = Math.max(0, i - 20), to = Math.min(all.length, i + 21);
      var target = all[i];
      var parent = target.replyToId ? findMsg(module, target.replyToId) : null;
      return { ok: true, message: outM(target), around: all.slice(from, to).map(outM), hasMoreBefore: from > 0, reachesLatest: to >= all.length, replyTo: parent ? outM(parent) : null };
    },
    post: function (module, p) {
      var tRecv = store.now();
      var a = auth(module, p); if (!a) return deny();
      var body = String(p.body || '').replace(/\r\n?/g, '\n').trim();
      if (body.length > LE_MAX_BODY) return { ok: false, error: 'That message is too long (max ' + LE_MAX_BODY + ' characters).' };
      var atts = Array.isArray(p.attachments) ? p.attachments.slice(0, LE_MAX_ATTACH) : [];
      var cleanAtts = [];
      for (var i = 0; i < atts.length; i++) {
        var f = store.fileGet(atts[i].fileId);
        if (!f || f.module !== module || f.status !== 'ready') return { ok: false, error: 'An attachment is not ready yet — wait for its upload to finish.', code: 'attachment' };
        if (f.uploaderPid !== a.pid && a.role !== 'teacher') return { ok: false, error: 'You can only attach files you uploaded.', code: 'attachment' };
        var prev = String(atts[i].preview || '');
        if (prev && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(prev) || prev.length > LE_PREVIEW_MAX_CHARS)) prev = '';
        if (prev && /^image\//.test(f.mime) && !f.preview) { f.preview = prev; store.filePut(f); }
        cleanAtts.push({ fileId: f.id, name: f.name, mime: f.mime, size: f.size, kind: /^image\//.test(f.mime) ? 'image' : 'file', w: Number(atts[i].w) || 0, h: Number(atts[i].h) || 0 });
      }
      if (!body && !cleanAtts.length) return { ok: false, error: 'Write a message or attach a file.' };
      var clientId = String(p.clientId || '').slice(0, 64);
      var res = store.lock(function () {
        if (clientId) { var ex = store.messages().filter(function (m) { return m.module === module && m.clientId === clientId; })[0]; if (ex) return { dup: ex }; }
        var parent = p.replyToId ? findMsg(module, p.replyToId) : null;
        var ment = LE_parseMentions(body, roster(module).concat([{ participantId: LE_TEACHER_PID, name: 'Teacher' }]), a.role);
        var s = store.nextSeq(); var now = store.now();
        var rec = { module: module, id: 'm_' + store.uuid().replace(/-/g, '').slice(0, 20), clientId: clientId, seq: s, ord: s,
          kind: (a.role === 'teacher' && p.kind === 'announcement') ? 'announcement' : 'message', authorRole: a.role, authorName: a.name, participantId: a.role === 'teacher' ? '' : a.pid,
          body: body, attachments: cleanAtts, mentions: ment.pids.filter(function (x) { return x !== a.pid; }), mentionAll: ment.all,
          replyToId: parent && !parent.deleted ? parent.id : '', replyToPid: parent && !parent.deleted ? (parent.authorRole === 'teacher' ? LE_TEACHER_PID : parent.participantId) : '',
          pinned: false, edited: false, deleted: false, reactions: {}, createdAt: now, updatedAt: now };
        store.insertMessage(rec);
        cleanAtts.forEach(function (x) { var f = store.fileGet(x.fileId); if (f) { f.messageId = rec.id; store.filePut(f); } });
        return { rec: rec };
      });
      if (res.dup) return { ok: true, duplicate: true, message: outM(res.dup), timing: { recv: tRecv, persisted: res.dup.createdAt } };
      bump(module);
      var t = typingMap(module); if (t[a.pid]) { delete t[a.pid]; store.cachePut('typ:' + module, JSON.stringify(t), 60); }
      return { ok: true, message: outM(res.rec), timing: { recv: tRecv, persisted: store.now() } };
    },
    mutate: function (module, p, op) {
      var a = auth(module, p); if (!a) return deny();
      var r = store.lock(function () {
        var m = findMsg(module, p.id);
        if (!m || m.deleted) return { ok: false, error: 'That message is no longer available.', code: 'notfound' };
        var own = a.role === 'teacher' ? m.authorRole === 'teacher' : m.participantId === a.pid;
        if (op === 'edit') {
          if (!own) return { ok: false, error: 'You can only edit your own messages.', code: 'forbidden' };
          var body = String(p.body || '').trim(); if (!body && !(m.attachments || []).length && !m.imageUrl && !m.fileUrl) return { ok: false, error: 'A message can’t be empty.' };
          if (body.length > LE_MAX_BODY) return { ok: false, error: 'That message is too long.' };
          m.body = body; m.edited = true;
          var ment = LE_parseMentions(body, roster(module).concat([{ participantId: LE_TEACHER_PID, name: 'Teacher' }]), a.role);
          m.mentions = ment.pids.filter(function (x) { return x !== a.pid; }); m.mentionAll = ment.all;
        } else if (op === 'delete') {
          if (!own && a.role !== 'teacher') return { ok: false, error: 'You can only delete your own messages.', code: 'forbidden' };
          m.deleted = true;
        } else if (op === 'pin') {
          if (a.role !== 'teacher') return { ok: false, error: 'Only the teacher can pin messages.', code: 'forbidden' };
          m.pinned = !!p.pinned;
        } else if (op === 'react') {
          var e = String(p.reaction || '').slice(0, 8); m.reactions = m.reactions || {};
          if (!e || m.reactions[a.pid] === e) delete m.reactions[a.pid]; else m.reactions[a.pid] = e;
        }
        m.seq = store.nextSeq(); m.updatedAt = store.now();
        store.updateMessage(m);
        return { ok: true, message: outM(m) };
      });
      if (r.ok) bump(module);
      return r;
    },
    search: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var q = LE_norm(p.query); if (q.length < 2) return { ok: true, messages: [], files: [], people: [] };
      var all = msgsOf(module).filter(function (m) { return !m.deleted; }).sort(LE_cmp).reverse();
      var messages = all.filter(function (m) { return LE_norm(m.body + ' ' + m.authorName).indexOf(q) >= 0; }).slice(0, 30).map(outM);
      var files = []; all.forEach(function (m) { (m.attachments || []).forEach(function (f) { if (files.length < 20 && LE_norm(f.name).indexOf(q) >= 0) files.push({ messageId: m.id, name: f.name, mime: f.mime, size: f.size, fileId: f.fileId, authorName: m.authorName, createdAt: m.createdAt }); }); if (m.fileName && LE_norm(m.fileName).indexOf(q) >= 0 && files.length < 20) files.push({ messageId: m.id, name: m.fileName, authorName: m.authorName, createdAt: m.createdAt }); });
      var people = roster(module).filter(function (m) { return LE_norm(m.name).indexOf(q) >= 0; }).slice(0, 10).map(function (m) { return { name: m.name, role: m.role }; });
      return { ok: true, messages: messages, files: files, people: people };
    },
    /** Names for @mention autocomplete. Emails are returned to the teacher only. */
    members: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var on = pres(module);
      return { ok: true, members: roster(module).filter(function (m) { return m.role === 'student'; }).map(function (m) {
        var o = { participantId: m.participantId, name: m.name, online: !!(on[m.participantId] && store.now() - on[m.participantId].t < LE_ONLINE_MS) };
        if (a.role === 'teacher') o.email = m.email || ''; return o; }) };
    },
    notifications: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var mems = memberships(module, a); var scope = p.allModules ? mems : mems.filter(function (m) { return m.module === module; });
      var nf = notificationsFor(scope, 0, Number(p.limit) || 60);
      return { ok: true, notifications: nf.list, unread: nf.unread, readVer: readVersion(scope) };
    },
    /** Mark read: specific notification ids, or everything up to the current seq. Server-side = synced everywhere. */
    markRead: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var r = store.lock(function () {
        var mems = memberships(module, a); var byMod = {}; mems.forEach(function (m) { byMod[m.module] = m; });
        var ids = Array.isArray(p.ids) ? p.ids.map(String) : [];
        var seq = store.currentSeq(); var touched = {};
        if (p.all) {
          (p.allModules ? mems : mems.filter(function (m) { return m.module === module; })).forEach(function (m) {
            // Messages saved before the delta-sync/notifications rebuild have no seq/ord (blank column), so
            // "n.seq <= readUpTo" can never mark them read on its own — remember their notification ids here
            // explicitly, otherwise "mark all read" would leave a handful of old messages perpetually unread.
            var legacy = msgsOf(m.module).filter(function (x) { return !x.deleted && !(x.ord || x.seq); })
              .map(function (x) { var n = LE_notifFor(x, m, ''); return n ? n.id : null; }).filter(Boolean);
            m.readUpTo = seq; m.readIds = legacy.slice(-400); touched[m.module] = m;
          });
        }
        ids.forEach(function (id) {
          var msgId = id.split(':')[0]; var msg = null, all = store.messages();
          for (var i = 0; i < all.length; i++) if (all[i].id === msgId) { msg = all[i]; break; }
          if (!msg || !byMod[msg.module]) return;                       // cannot mark other classrooms' notifications
          var m = byMod[msg.module]; m.readIds = m.readIds || [];
          if (m.readIds.indexOf(id) < 0 && !((msg.ord || 0) <= (m.readUpTo || 0))) m.readIds.push(id);
          touched[m.module] = m;
        });
        for (var k in touched) { var m = touched[k]; m.readVer = (m.readVer || 0) + 1; if (m.readIds.length > 400) m.readIds = m.readIds.slice(-400); m.updatedAt = store.now(); store.putMember(m); }
        return { ok: true, changed: Object.keys(touched).length };
      });
      store.cachePut('rv:' + (a.role === 'teacher' ? '*' : module + ':' + a.pid), 'x' + store.now(), 21600); // invalidates fast paths
      return r;
    },
    setPrefs: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      return store.lock(function () {
        var m = a.role === 'teacher' ? teacherMember(module) : memberOf(module, a.pid); if (!m) return deny();
        var np = LE_prefs(m); var src = p.prefs || {};
        for (var k in src) if (k in LE_DEFAULT_PREFS || k === 'browser') np[k] = !!src[k];
        m.prefs = np; m.readVer = (m.readVer || 0) + 1; m.updatedAt = store.now(); store.putMember(m);
        store.cachePut('rv:' + (a.role === 'teacher' ? '*' : module + ':' + a.pid), 'x' + store.now(), 21600);
        return { ok: true, prefs: np };
      });
    },
    typing: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var t = typingMap(module); var now = store.now();
      if (p.stop) delete t[a.pid]; else t[a.pid] = { n: a.name, t: now };
      for (var k in t) if (now - t[k].t > LE_TYPING_MS) delete t[k];
      store.cachePut('typ:' + module, JSON.stringify(t), 60);
      return { ok: true };
    },
    /* ---- files: resumable chunked upload, authorised chunked download ---- */
    uploadInit: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var name = String(p.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
      var size = Number(p.size) || 0, mime = String(p.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
      if (!size) return { ok: false, error: 'That file is empty.' };
      if (size > LE_MAX_FILE_BYTES) return { ok: false, error: 'That file is too large (maximum ' + Math.round(LE_MAX_FILE_BYTES / 1048576) + ' MB).', code: 'toolarge' };
      if (LE_BLOCKED_EXT.test(name)) return { ok: false, error: 'This file type isn’t allowed in the classroom (programs and scripts are blocked).', code: 'blocked' };
      if (/^(text\/html|application\/(x-)?javascript|application\/xhtml)/.test(mime) || /\.(html?|xhtml|svg)$/i.test(name) && !/^image\/svg/.test(mime)) mime = 'application/octet-stream'; // never rendered inline
      var key = String(p.uploadKey || '').slice(0, 64);
      if (key) { var prior = store.cacheGet('upk:' + module + ':' + a.pid + ':' + key); if (prior) { var f0 = store.fileGet(prior); if (f0 && f0.status !== 'failed') { var st0 = f0.status === 'ready' ? { received: f0.size, done: true } : store.blobStatus(f0); return { ok: true, fileId: f0.id, chunkSize: LE_CHUNK_BYTES, received: st0.received || 0, done: !!st0.done, resumed: true }; } } }
      var rec = { id: 'f_' + store.uuid().replace(/-/g, '').slice(0, 20), module: module, name: name, mime: mime, size: size, uploaderPid: a.pid, status: 'uploading', createdAt: store.now(), messageId: '' };
      store.blobInit(rec); store.filePut(rec);
      if (key) store.cachePut('upk:' + module + ':' + a.pid + ':' + key, rec.id, 21600);
      return { ok: true, fileId: rec.id, chunkSize: LE_CHUNK_BYTES, received: 0 };
    },
    uploadChunk: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var f = store.fileGet(p.fileId);
      if (!f || f.module !== module || f.uploaderPid !== a.pid) return { ok: false, error: 'Upload not found.', code: 'notfound' };
      if (f.status === 'ready') return { ok: true, received: f.size, done: true, file: { fileId: f.id, name: f.name, mime: f.mime, size: f.size } };
      var off = Number(p.offset) || 0;
      var st = store.blobStatus(f);
      if (off !== st.received) return { ok: true, received: st.received, done: !!st.done, mismatch: true };  // client re-aligns (resume)
      var r = store.blobPut(f, off, String(p.data || ''));
      if (r.done) { f.status = 'ready'; f.storageId = r.storageId; f.readyAt = store.now(); store.filePut(f); return { ok: true, received: f.size, done: true, file: { fileId: f.id, name: f.name, mime: f.mime, size: f.size } }; }
      return { ok: true, received: r.received, done: false };
    },
    uploadStatus: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var f = store.fileGet(p.fileId); if (!f || f.module !== module || f.uploaderPid !== a.pid) return { ok: false, error: 'Upload not found.', code: 'notfound' };
      if (f.status === 'ready') return { ok: true, received: f.size, done: true, file: { fileId: f.id, name: f.name, mime: f.mime, size: f.size } };
      var st = store.blobStatus(f); return { ok: true, received: st.received, done: false };
    },
    /** Download = authorised, chunked reads straight from storage. A file id alone grants nothing: the caller must be a
     *  member of the classroom the file belongs to (and, unless they uploaded it, it must be attached to a live message). */
    fileChunk: function (module, p) {
      var a = auth(module, p); if (!a) return deny();
      var f = store.fileGet(p.fileId);
      if (!f || f.module !== module || f.status !== 'ready') return { ok: false, error: 'File not available.', code: 'notfound' };
      if (f.uploaderPid !== a.pid) { var m = f.messageId ? findMsg(module, f.messageId) : null; if (!m || m.deleted) return { ok: false, error: 'File not available.', code: 'notfound' }; }
      var off = Math.max(0, Number(p.offset) || 0), len = Math.min(Number(p.length) || LE_CHUNK_BYTES, 4 * 1024 * 1024);
      if (off >= f.size) return { ok: true, data: '', offset: off, size: f.size, mime: f.mime, name: f.name, done: true };
      var data = store.blobRead(f, off, Math.min(len, f.size - off));
      return { ok: true, data: data, offset: off, size: f.size, mime: f.mime, name: f.name, inline: LE_INLINE_MIME.test(f.mime), done: off + len >= f.size };
    },
    elapsedMs: function () { return store.now() - T0; }
  };
  return S;
}
/* ==== LIVE ENGINE END ==== */

