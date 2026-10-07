/* Official Exams engine + assessment store/engine — copied VERBATIM from the user's Code.gs (no keys or settings).
   Loaded after Code.core.gs in tests that run exams. */
/* ---------------------------------------------------------------------- *
 * Assessment system — storage adapter + wrappers around the shared engine
 * ---------------------------------------------------------------------- */
function assessStore_(module) {
  var cache = null;
  function rows() { if (!cache) cache = readAll_(SHEETS.ASSESS).filter(function (r) { return r.module === module; }); return cache; }
  function find(kind, id) { var rs = rows(); for (var i = 0; i < rs.length; i++) if (rs[i].kind === kind && String(rs[i].id) === String(id)) return rs[i]; return null; }
  return {
    list: function (kind) { return rows().filter(function (r) { return r.kind === kind && r.status !== '__deleted'; }).map(unpackJson_).filter(Boolean); },
    get: function (kind, id) { var r = find(kind, id); return r && r.status !== '__deleted' ? unpackJson_(r) : null; },
    put: function (kind, id, obj) {
      cache = null;
      var existing = find(kind, id);
      var row = { module: module, kind: kind, id: String(id), ref: obj.assessmentId || '', email: obj.email || '', status: obj.status || '', updatedAt: Date.now() };
      Object.assign(row, packJson_(obj));
      if (existing) updateRow_(SHEETS.ASSESS, existing._row, row); else appendRow_(SHEETS.ASSESS, row);
      cache = null;
    },
    del: function (kind, id) { var existing = find(kind, id); if (existing) { existing.status = '__deleted'; updateRow_(SHEETS.ASSESS, existing._row, existing); } cache = null; },
    purge: function (kind, id) { cache = null; var rs = rows(); for (var i = rs.length - 1; i >= 0; i--) if (rs[i].kind === kind && String(rs[i].id) === String(id)) deleteRow_(SHEETS.ASSESS, rs[i]._row); cache = null; },
    getAssessment: function (id) { var r = findContentRow_(module, 'assessments', id); return r && !r.deleted ? unpackJson_(r) : null; },
    getVersion: function (aid, n) { var r = findContentRow_(module, 'assessmentversions', aid + '@' + n); return r && !r.deleted ? unpackJson_(r) : null; },
    now: function () { return Date.now(); },
    rand: Math.random
  };
}
function assessSvc_(module) { return AE_createService(assessStore_(module)); }

/* ====================================================================== *
 * OFFICIAL EXAMS (1.7) — server side of the separate Exam App (exam.html)
 *
 * Security model (everything is enforced HERE, never in the browser):
 *  • Exam questions live in a PRIVATE bank (Content "priv:exambank"), excluded from getAllContent,
 *    so no teaching-platform browser ever receives them.
 *  • A student signs in to ONE exam (access code + student ID + password) and receives an EXAM token.
 *    That token is accepted ONLY by examStart / examSave / examSubmit / examStatus / examLogout — it
 *    cannot read course content, the content key, Live Classroom, Study sync or anything else.
 *  • The paper sent to the browser contains no answers, no explanations, no question ids and no
 *    original option positions (options and matching columns are re-ordered server-side and the
 *    student's replies are mapped back here) — inspecting the page or network reveals nothing useful.
 *  • Timer, one-attempt rule, deadline, auto-submission and grading are all server-side.
 *  • Optional: during an exam window every candidate is refused by the TEACHING platform
 *    (studentLogin / studentSession / every signed-in student request) — see exTeachingLock_.
 *  • Results and answer keys are teacher-only (authed_).
 * Storage: exams + bank in Content (priv:), attempts + exam sessions in the private AssessRecords sheet.
 * ====================================================================== */
var EX_PUBLIC_ACTIONS = { examInfo: 1, examLogin: 1, examStart: 1, examSave: 1, examSubmit: 1, examStatus: 1, examLogout: 1 };
var EX_GRACE_MS = 90 * 1000;              // network grace after the deadline for the final save/submit
var EX_LOCK_BEFORE_MS = 15 * 60 * 1000;   // teaching platform locked for candidates from 15 min before opening
var EX_TYPES = { mcq: 'MCQ', vignette: 'Clinical vignette', tf: 'True / False', selectall: 'Select all that apply', fillblank: 'Fill in the blank', matching: 'Matching' };
var EX_MAX_Q = 300;

/* ---------- storage helpers ---------- */
function exPrivAll_(module, coll) {
  var c = 'priv:' + coll, out = [];
  readAll_(SHEETS.CONTENT).forEach(function (r) { if (r.module === module && r.collection === c && !r.deleted) { var d = unpackJson_(r); if (d) out.push(d); } });
  return out;
}
function exPrivGet_(module, coll, id) { var r = findContentRow_(module, 'priv:' + coll, id); return r && !r.deleted ? unpackJson_(r) : null; }
function exPrivPut_(module, coll, id, data) { return actionUpsert_(module, { collection: 'priv:' + coll, id: id, data: data }); }
function exPrivDel_(module, coll, id) { return actionDelete_(module, { collection: 'priv:' + coll, id: id }); }
/** Bulk write of exam-bank questions: the Content sheet is read ONCE (per-item upserts would re-read it every time and
 *  time out for a whole bank). Existing ids are updated in place (keeping their first addedAt); new ones are appended in one call. */
function exBankBulkPut_(module, items) {
  if (!items.length) return;
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var coll = 'priv:exambank', rows = readAll_(SHEETS.CONTENT), at = {};
    rows.forEach(function (r) { if (r.module === module && r.collection === coll) at[String(r.id)] = r; });
    var fresh = [], now = Date.now();
    items.forEach(function (o) {
      var ex = at[o.id];
      if (ex && !ex.deleted) { var prev = unpackJson_(ex); if (prev && prev.addedAt) o.addedAt = prev.addedAt; }
      var row = { module: module, collection: coll, id: o.id, updatedAt: now, updatedBy: 'teacher', deleted: false };
      Object.assign(row, packJson_(o));
      if (ex) updateRow_(SHEETS.CONTENT, ex._row, row); else fresh.push(rowToArray_(SHEETS.CONTENT, row));
    });
    if (fresh.length) {
      var sh = sheet_(SHEETS.CONTENT), start = sh.getLastRow() + 1, need = start + fresh.length - 1 - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
      sh.getRange(start, 1, fresh.length, HEADERS[SHEETS.CONTENT].length).setValues(fresh);
    }
  } finally { lock.releaseLock(); }
}
function exBankBulkDelete_(module, ids) {
  if (!ids.length) return;
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var want = {}; ids.forEach(function (id) { want[id] = 1; });
    var now = Date.now();
    readAll_(SHEETS.CONTENT).forEach(function (r) {
      if (r.module === module && r.collection === 'priv:exambank' && want[String(r.id)] && !r.deleted) {
        var t = { module: module, collection: r.collection, id: String(r.id), updatedAt: now, updatedBy: 'teacher', deleted: true };
        Object.assign(t, packJson_(null)); updateRow_(SHEETS.CONTENT, r._row, t);
      }
    });
  } finally { lock.releaseLock(); }
}
var EX_TAKEOVER_MS = 2 * 60 * 1000;      // ONE device per student: another device may continue only after this one was silent this long
var EX_BUSY_MSG = 'This exam is already open on another device or browser. Continue there. If that device has stopped working, wait 2 minutes or ask the invigilator to release your exam.';
/** True when ANOTHER exam session owns this attempt and was active recently (heartbeat every 30 s). */
function exOwnerBusy_(att, th, now) { var o = att && att.activeSession; return !!(o && o.th && o.th !== th && now - Number(o.lastSeen || 0) < EX_TAKEOVER_MS); }
/** This session becomes (or stays) the owner. Returns true when the owner changed — that must reach the sheet at once. */
/** Strictly increasing change stamp: the newer of the cache copy and the sheet copy always wins, even within one millisecond. */
function exStamp_(att, now) { att.stamp = Math.max(now, (Number(att.stamp) || 0) + 1); return att.stamp; }
function exClaim_(att, th, now) {
  var o = att.activeSession, changed = !o || o.th !== th;
  if (changed) { att.devices = (att.devices || 0) + 1; if (o && o.th) att.takeovers = (att.takeovers || 0) + 1; }
  att.activeSession = { th: th, lastSeen: now }; exStamp_(att, now);
  return changed;
}
var EX_FLUSH_MS = 60 * 1000;             // autosaves go to CacheService at once and to the sheet at most once a minute per student
/** Exam definition, cached for 5 minutes (every change clears it) — examSave is called often and must stay cheap. */
function exExam_(module, id) {
  var c = CacheService.getScriptCache(), k = 'exdef:' + module + ':' + id, hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var e = exPrivGet_(module, 'exams', id); if (e) c.put(k, JSON.stringify(e), 300);
  return e;
}
function exAttCacheKey_(module, id) { return 'exatt:' + module + ':' + id; }
function exCacheAtt_(module, att) {
  var j = JSON.stringify({ stamp: att.stamp || 0, displayResponses: att.displayResponses || {}, lastSavedAt: att.lastSavedAt || 0, leaves: att.leaves || 0, saveCount: att.saveCount || 0,
    activeSession: att.activeSession || null, devices: att.devices || 0, takeovers: att.takeovers || 0, blocked: att.blocked || 0 });
  if (j.length < 90000) CacheService.getScriptCache().put(exAttCacheKey_(module, att.id), j, 21600);
}
/** The stored attempt, completed with any newer autosave that so far only reached CacheService. */
function exGetAtt_(module, store, id) {
  var att = store.get('exattempt', id); if (!att) return null;
  if (att.status === 'in_progress') {
    var hit = CacheService.getScriptCache().get(exAttCacheKey_(module, id));
    if (hit) { try { var c = JSON.parse(hit); if ((c.stamp || 0) > (att.stamp || 0)) {
      att.displayResponses = c.displayResponses; att.lastSavedAt = c.lastSavedAt; att.leaves = Math.max(att.leaves || 0, c.leaves || 0); att.saveCount = c.saveCount;
      att.activeSession = c.activeSession; att.devices = Math.max(att.devices || 0, c.devices || 0); att.takeovers = Math.max(att.takeovers || 0, c.takeovers || 0); att.blocked = Math.max(att.blocked || 0, c.blocked || 0); att.stamp = c.stamp; } } catch (e) { } }
  }
  return att;
}
function exAttId_(examId, username) { return String(examId) + '|' + String(username); }
function exRand_() { return Math.random(); }
function exClean_(s, n) { return String(s == null ? '' : s).replace(/\s+$/, '').slice(0, n || 4000); }

/* ---------- question validation (exam bank) ---------- */
function exValidateQuestion_(q) {
  if (!q || typeof q !== 'object') return 'Empty question.';
  if (!EX_TYPES[q.type]) return 'Question type “' + q.type + '” cannot be used in an official exam (allowed: ' + Object.keys(EX_TYPES).join(', ') + ').';
  if (!String(q.stem || '').trim()) return 'The question text is empty.';
  var nOpt = (q.options || []).length;
  if (q.type === 'mcq' || q.type === 'vignette') {
    if (nOpt < 2) return 'Give at least two options.';
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= nOpt) return 'Mark the one correct option.';
  }
  if (q.type === 'selectall') {
    if (nOpt < 2) return 'Give at least two options.';
    if (!Array.isArray(q.answers) || !q.answers.length || q.answers.some(function (a) { return typeof a !== 'number' || a < 0 || a >= nOpt; })) return 'Mark at least one correct option.';
  }
  if (q.type === 'tf' && typeof q.answer !== 'boolean') return 'Choose True or False as the correct answer.';
  if (q.type === 'fillblank') {
    var blanks = (String(q.stem).match(/_{3,}/g) || []).length;
    if (!Array.isArray(q.answers) || !q.answers.length || q.answers.some(function (a) { return !Array.isArray(a) || !a.some(function (x) { return String(x || '').trim(); }); })) return 'Give at least one accepted answer for every blank.';
    if (blanks && blanks !== q.answers.length) return 'The text has ' + blanks + ' blank(s) (___) but ' + q.answers.length + ' answer line(s).';
  }
  if (q.type === 'matching') {
    if (!Array.isArray(q.pairs) || q.pairs.length < 2 || q.pairs.some(function (p) { return !p || !String(p.left || '').trim() || !String(p.right || '').trim(); })) return 'Give at least two complete pairs.';
  }
  return '';
}
function exNormQuestion_(q, id) {
  var o = { id: id, type: q.type, stem: exClean_(q.stem, 4000), topic: exClean_(q.topic, 80), difficulty: Number(q.difficulty) || 0,
    explanation: exClean_(q.explanation, 3000), image: /^https:\/\//.test(String(q.image || '')) ? String(q.image).slice(0, 500) : '',
    source: q.source && typeof q.source === 'object' ? { kind: exClean_(q.source.kind, 20), origId: exClean_(q.source.origId, 60), course: exClean_(q.source.course, 60) } : { kind: 'new' } };
  if (q.type === 'vignette') o['case'] = exClean_(q['case'], 3000);
  if (q.type === 'mcq' || q.type === 'vignette' || q.type === 'selectall') o.options = (q.options || []).slice(0, 12).map(function (x) { return exClean_(x, 600); });
  if (q.type === 'mcq' || q.type === 'vignette' || q.type === 'tf') o.answer = q.answer;
  if (q.type === 'selectall') o.answers = q.answers.slice().sort(function (a, b) { return a - b; });
  if (q.type === 'fillblank') o.answers = q.answers.map(function (a) { return a.map(function (x) { return exClean_(x, 200); }).filter(function (x) { return x.trim(); }); });
  if (q.type === 'matching') o.pairs = q.pairs.slice(0, 12).map(function (p) { return { left: exClean_(p.left, 300), right: exClean_(p.right, 300) }; });
  return o;
}

/* ---------- exams ---------- */
function exCandidateOk_(exam, username) {
  if (!exam.candidates || exam.candidates === 'all') return true;
  return (exam.candidates || []).map(normUser_).indexOf(normUser_(username)) >= 0;
}
function exWindowState_(exam, now) {
  if (exam.status !== 'published') return exam.status === 'closed' ? 'closed' : 'draft';
  if (now < Number(exam.opensAt)) return 'notyet';
  if (Number(exam.closesAt) && now > Number(exam.closesAt)) return 'closed';
  return 'open';
}
function exPublicExam_(exam, now) {
  return { title: exam.title, instructions: exam.instructions || '', durationMin: Number(exam.durationMin) || 0, questionCount: exQuestionCount_(exam),
    opensAt: Number(exam.opensAt) || 0, closesAt: Number(exam.closesAt) || 0, state: exWindowState_(exam, now), serverTime: now };
}
function exQuestionCount_(exam) { var n = (exam.questionIds || []).length; return exam.poolCount > 0 ? Math.min(exam.poolCount, n) : n; }
function exFindByCode_(module, code) {
  var c = String(code || '').trim().toUpperCase(); if (!c) return null;
  var all = exPrivAll_(module, 'exams');
  for (var i = 0; i < all.length; i++) if (all[i].status !== 'draft' && safeEq_(String(all[i].code || '').toUpperCase(), c)) return all[i];
  return null;
}

/* ---------- teaching-platform lock during exam windows ---------- */
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
function exClearLocks_(module, examId) { var c = CacheService.getScriptCache(); c.remove('exlocks:' + module); if (examId) c.remove('exdef:' + module + ':' + examId); }
/** Returns an error object when this student is a candidate of an exam whose window is running. */
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

/* ---------- exam sessions (tokens) ---------- */
function exTokHash_(t) { return sha256Hex_('ex|' + t); }
function exSession_(module, etoken) {
  if (!etoken || String(etoken).length < 20) return null;
  var th = exTokHash_(etoken), c = CacheService.getScriptCache(), hit = c.get('ext:' + th);
  var s = null;
  if (hit) { try { s = JSON.parse(hit); } catch (e) { } }
  if (!s) { s = assessStore_(module).get('extoken', th); if (s) c.put('ext:' + th, JSON.stringify(s), 21600); }
  if (!s || s.module !== module || Number(s.exp) < Date.now()) return null;
  s.th = th; return s;
}
function exEndSession_(module, th) { CacheService.getScriptCache().remove('ext:' + th); assessStore_(module).purge('extoken', th); }

/* ---------- papers: what a student's browser may see ---------- */
function exPaper_(att) {
  return att.questions.map(function (q, i) {
    var ord = att.optionOrders[i], v = { n: i + 1, type: q.type, stem: q.stem };
    if (q.type === 'vignette' && q['case']) v['case'] = q['case'];
    if (q.image) v.image = q.image;
    if (q.type === 'mcq' || q.type === 'vignette' || q.type === 'selectall') v.options = ord.map(function (k) { return q.options[k]; });
    if (q.type === 'fillblank') v.blanks = Math.max(1, (q.answers || []).length);
    if (q.type === 'matching') { v.left = ord.left.map(function (k) { return q.pairs[k].left; }); v.right = ord.right.map(function (k) { return q.pairs[k].right; }); }
    return v;
  });
}
/** Keep only well-formed replies, in "display" space (positions as the student saw them). */
function exCleanResponses_(att, raw) {
  var out = {}; raw = raw && typeof raw === 'object' ? raw : {};
  att.questions.forEach(function (q, i) {
    var r = raw[i]; if (r === undefined || r === null) return;
    var ord = att.optionOrders[i];
    if (q.type === 'mcq' || q.type === 'vignette') { if (typeof r === 'number' && r >= 0 && r < ord.length) out[i] = r; }
    else if (q.type === 'tf') { if (typeof r === 'boolean') out[i] = r; }
    else if (q.type === 'selectall') { if (Array.isArray(r)) { var a = r.filter(function (x) { return typeof x === 'number' && x >= 0 && x < ord.length; }); if (a.length) out[i] = a.filter(function (x, k) { return a.indexOf(x) === k; }); } }
    else if (q.type === 'fillblank') { if (Array.isArray(r)) out[i] = r.slice(0, 12).map(function (x) { return String(x == null ? '' : x).slice(0, 200); }); }
    else if (q.type === 'matching') { if (typeof r === 'object') { var m = {}; Object.keys(r).forEach(function (k) { var li = Number(k), rj = Number(r[k]); if (li >= 0 && li < ord.left.length && rj >= 0 && rj < ord.right.length) m[li] = rj; }); out[i] = m; } }
  });
  return out;
}
/** Display-space replies → the engine's original-index replies (keyed by question id). */
function exToOriginal_(att, disp) {
  var out = {};
  att.questions.forEach(function (q, i) {
    var r = disp[i], ord = att.optionOrders[i]; if (r === undefined) return;
    if (q.type === 'mcq' || q.type === 'vignette') out[q.id] = ord[r];
    else if (q.type === 'selectall') out[q.id] = r.map(function (x) { return ord[x]; });
    else if (q.type === 'matching') { var m = {}; Object.keys(r).forEach(function (li) { m[ord.left[Number(li)]] = ord.right[r[li]]; }); out[q.id] = m; }
    else out[q.id] = r;
  });
  return out;
}
function exFinalize_(att, now, how) {
  var g = AE_gradeAttempt(att, exToOriginal_(att, att.displayResponses || {}));
  Object.keys(g).forEach(function (k) { att[k] = g[k]; });
  att.status = 'submitted'; att.submittedAt = now; att.submitMode = how; // 'student' | 'auto'
  att.late = !!(att.deadlineAt && now > att.deadlineAt + EX_GRACE_MS);
  return att;
}
/** Auto-submits an attempt whose time is over (called lazily from every read — no trigger needed). */
function exMaybeExpire_(store, att, now) {
  if (att && att.status === 'in_progress' && att.deadlineAt && now > att.deadlineAt + EX_GRACE_MS) {
    exFinalize_(att, att.deadlineAt, 'auto'); att.finalizedAt = now; store.put('exattempt', att.id, att); return true;
  }
  return false;
}
function exStudentView_(att, exam, now) {
  var o = { status: att.status, startedAt: att.startedAt, deadlineAt: att.deadlineAt, submittedAt: att.submittedAt, submitMode: att.submitMode || '', serverTime: now, total: att.total };
  if (att.status === 'submitted' && exam && exam.showScore) { o.score = att.score; o.percent = att.percent; o.correct = att.correct; o.incorrect = att.incorrect; o.unanswered = att.unanswered; }
  return o;
}

/* ---------- student actions (exam token only) ---------- */
function exRoute_(module, p) {
  var a = p.action, now = Date.now();
  if (a === 'examInfo') return { ok: true, version: VERSION, serverTime: now, studentAuth: studentAuthOn_(module) };
  if (a === 'examLogin') return exLogin_(module, p, now);
  var s = exSession_(module, p.etoken);
  if (!s) return { ok: false, code: 'examauth', error: 'Your exam session has ended. Sign in again with the exam code, your student ID and password.' };
  var exam = exExam_(module, s.examId);
  if (!exam) return { ok: false, code: 'examgone', error: 'This exam is no longer available. Please contact your teacher.' };
  if (a === 'examLogout') { var lo = LockService.getScriptLock(); lo.waitLock(20000); try { exEndSession_(module, s.th); } finally { lo.releaseLock(); } return { ok: true }; }
  var attId = exAttId_(exam.id, s.username);
  if (a === 'examSave') {   // fast path: no script lock unless this save also goes to the sheet
    var st0 = assessStore_(module), cur = exGetAtt_(module, st0, attId);
    if (cur && cur.status === 'in_progress' && !(cur.deadlineAt && now > cur.deadlineAt + EX_GRACE_MS)) {
      if (exOwnerBusy_(cur, s.th, now)) return { ok: false, code: 'examactive', error: EX_BUSY_MSG };
      var owner = exClaim_(cur, s.th, now);
      cur.displayResponses = exCleanResponses_(cur, p.responses); cur.lastSavedAt = now; cur.saveCount = (cur.saveCount || 0) + 1;
      if (typeof p.leaves === 'number') cur.leaves = Math.max(cur.leaves || 0, Math.min(9999, Math.floor(p.leaves)));
      exCacheAtt_(module, cur);
      if (owner || now - (cur.sheetSavedAt || cur.startedAt || 0) >= EX_FLUSH_MS) {
        var lk = LockService.getScriptLock(); lk.waitLock(25000);
        try { var fresh = assessStore_(module).get('exattempt', attId);
          if (fresh && fresh.status === 'in_progress') { ['displayResponses', 'saveCount', 'leaves', 'activeSession', 'devices', 'takeovers', 'blocked', 'stamp'].forEach(function (k) { fresh[k] = cur[k]; }); fresh.lastSavedAt = now; fresh.sheetSavedAt = now; assessStore_(module).put('exattempt', attId, fresh); }
        } finally { lk.releaseLock(); }
      }
      return { ok: true, savedAt: now, serverTime: now, deadlineAt: cur.deadlineAt };
    }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var store = assessStore_(module), att = exGetAtt_(module, store, attId);
    if (att) exMaybeExpire_(store, att, now);
    if (a === 'examStatus') return { ok: true, exam: exPublicExam_(exam, now), attempt: att ? exStudentView_(att, exam, now) : null };
    if (a === 'examStart') {
      if (att && att.status === 'submitted') return { ok: true, attempt: exStudentView_(att, exam, now), exam: exPublicExam_(exam, now) };
      if (!att) {
        var st = exWindowState_(exam, now);
        if (st !== 'open') return { ok: false, code: 'window', error: st === 'notyet' ? 'The exam has not opened yet.' : 'The exam is closed.' };
        att = exBuildAttempt_(module, exam, s, now);
        if (att.error) return { ok: false, error: att.error };
        exClaim_(att, s.th, now); att.sheetSavedAt = now;
        store.put('exattempt', att.id, att);
      } else {
        if (exOwnerBusy_(att, s.th, now)) return { ok: false, code: 'examactive', error: EX_BUSY_MSG };
        if (exClaim_(att, s.th, now)) { att.sheetSavedAt = now; store.put('exattempt', att.id, att); }
        exCacheAtt_(module, att);
      }
      return { ok: true, exam: exPublicExam_(exam, now), attempt: exStudentView_(att, exam, now), paper: exPaper_(att), responses: att.displayResponses || {} };
    }
    if (a === 'examSave' || a === 'examSubmit') {
      if (!att) return { ok: false, error: 'Start the exam first.' };
      if (att.status === 'submitted') { if (a === 'examSubmit') exEndSession_(module, s.th); return { ok: true, already: true, attempt: exStudentView_(att, exam, now) }; }
      if (exOwnerBusy_(att, s.th, now)) return { ok: false, code: 'examactive', error: EX_BUSY_MSG };
      exClaim_(att, s.th, now);
      att.displayResponses = exCleanResponses_(att, p.responses);
      att.lastSavedAt = now; att.saveCount = (att.saveCount || 0) + 1;
      if (typeof p.leaves === 'number') att.leaves = Math.max(att.leaves || 0, Math.min(9999, Math.floor(p.leaves)));
      if (a === 'examSubmit') { exFinalize_(att, now, p.auto ? 'auto' : 'student'); store.put('exattempt', att.id, att); exEndSession_(module, s.th); return { ok: true, attempt: exStudentView_(att, exam, now) }; }
      att.sheetSavedAt = now; store.put('exattempt', att.id, att); exCacheAtt_(module, att);
      return { ok: true, savedAt: now, serverTime: now, deadlineAt: att.deadlineAt };
    }
  } finally { lock.releaseLock(); }
  return { ok: false, code: 'badaction', error: 'Unknown exam action.' };
}
function exLogin_(module, p, now) {
  var generic = { ok: false, code: 'badlogin', error: 'The exam code, student ID or password is incorrect.' };
  var exam = exFindByCode_(module, p.code), username = normUser_(p.username), pw = String(p.password || '');
  if (!username || !pw || !String(p.code || '').trim()) return { ok: false, code: 'badlogin', error: 'Enter the exam code, your student ID and your password.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = findStudent_(module, username);
    if (!exam || !s) { Utilities.sleep(300); return generic; }
    if (Number(s.lockedUntil) > now) return { ok: false, code: 'locked', error: 'Too many failed attempts. Your account is locked for a few minutes — ask the invigilator.' };
    if (!safeEq_(hashIter_(pw, s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) {
      s.failed = (Number(s.failed) || 0) + 1;
      if (s.failed >= STU_MAX_FAILS) { s.lockedUntil = now + STU_LOCK_MS; s.failed = 0; }
      s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s);
      return generic;
    }
    if (!isTrue_(s.active)) return { ok: false, code: 'inactive', error: 'Your account is deactivated. Please contact the invigilator.' };
    if (!exCandidateOk_(exam, s.username)) return { ok: false, code: 'notcandidate', error: 'You are not registered for this exam. Please contact the invigilator.' };
    if (Number(s.failed)) { s.failed = 0; s.updatedAt = now; updateRow_(SHEETS.STUDENTS, s._row, s); }
    var store = assessStore_(module), att = exGetAtt_(module, store, exAttId_(exam.id, s.username));
    if (att) exMaybeExpire_(store, att, now);
    if (att && att.status === 'in_progress' && exOwnerBusy_(att, '', now)) {   // one device per student
      att.blocked = (att.blocked || 0) + 1; exStamp_(att, now); att.sheetSavedAt = now; store.put('exattempt', att.id, att); exCacheAtt_(module, att);
      return { ok: false, code: 'examactive', error: EX_BUSY_MSG };
    }
    var ws = exWindowState_(exam, now);
    if (!att && ws === 'closed') return { ok: false, code: 'window', error: 'This exam is closed.' };
    if (!att && ws === 'draft') return generic;
    var token = randomHex_(32), sess = { module: module, examId: exam.id, username: s.username, name: s.name, exp: (Number(exam.closesAt) || now + 12 * 3600000) + 2 * 3600000 };
    store.put('extoken', exTokHash_(token), sess);
    return { ok: true, etoken: token, student: { username: s.username, name: s.name }, exam: exPublicExam_(exam, now), attempt: att ? exStudentView_(att, exam, now) : null };
  } finally { lock.releaseLock(); }
}
function exBuildAttempt_(module, exam, s, now) {
  var bank = {}; exPrivAll_(module, 'exambank').forEach(function (q) { bank[q.id] = q; });
  var ids = (exam.questionIds || []).filter(function (id) { return bank[id]; });
  if (!ids.length) return { error: 'This exam has no questions yet. Please contact your teacher.' };
  var version = { assessmentId: exam.id, title: exam.title, version: 1, mode: exam.poolCount > 0 ? 'pool' : 'fixed', poolCount: exam.poolCount || 0,
    questionIds: ids, questions: {}, settings: { shuffleQuestions: !!exam.shuffleQuestions, shuffleOptions: !!exam.shuffleOptions, timeLimitMin: Number(exam.durationMin) || 0, attemptsAllowed: 1 } };
  ids.forEach(function (id) { version.questions[id] = bank[id]; });
  var att = AE_buildAttempt(version, { id: exam.id, timeLimitMin: Number(exam.durationMin) || 0, attemptsAllowed: 1 }, s.username, s.name, 1, now, exRand_);
  if (Number(exam.closesAt) && (!att.deadlineAt || att.deadlineAt > Number(exam.closesAt))) att.deadlineAt = Number(exam.closesAt);
  att.id = exAttId_(exam.id, s.username); att.examId = exam.id; att.username = s.username; att.studentName = s.name;
  att.displayResponses = {}; att.leaves = 0; att.saveCount = 0;
  return att;
}

/* ---------- teacher actions (authed_) ---------- */
function exTeacher_(module, p) {
  var a = p.action, now = Date.now();
  if (a === 'examBankList') return { ok: true, questions: exPrivAll_(module, 'exambank').sort(function (x, y) { return (x.addedAt || 0) - (y.addedAt || 0); }) };
  if (a === 'examBankSave') {
    var list = (p.questions || []).slice(0, EX_MAX_Q), saved = [], errors = [];
    var out = [];
    list.forEach(function (q, i) {
      var err = exValidateQuestion_(q); if (err) { errors.push({ index: i, stem: String((q && q.stem) || '').slice(0, 80), error: err }); return; }
      var id = /^xq_[a-z0-9]+$/.test(String(q.id || '')) ? q.id : 'xq_' + now.toString(36) + i.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      var o = exNormQuestion_(q, id); o.addedAt = now + i; o.updatedAt = now; out.push(o); saved.push(id);
    });
    var seen = {}; out = out.filter(function (o, k) { for (var j = k + 1; j < out.length; j++) if (out[j].id === o.id) return false; return true; }); // same id twice in one request: the last one wins
    exBankBulkPut_(module, out);
    return { ok: true, saved: saved, errors: errors };
  }
  if (a === 'examBankDelete') { exBankBulkDelete_(module, (p.ids || []).slice(0, 1000).map(String).filter(function (id) { return /^xq_/.test(id); })); return { ok: true }; }
  if (a === 'examList') {
    var atts = assessStore_(module).list('exattempt');
    return { ok: true, serverTime: now, exams: exPrivAll_(module, 'exams').map(function (e) {
      var mine = atts.filter(function (x) { return x.examId === e.id; });
      e.stats = { attempts: mine.length, submitted: mine.filter(function (x) { return x.status === 'submitted'; }).length }; e.state = exWindowState_(e, now); return e;
    }).sort(function (x, y) { return (y.opensAt || 0) - (x.opensAt || 0); }) };
  }
  if (a === 'examUpsert') {
    var e = p.exam || {}, id = /^ex_[a-z0-9]+$/.test(String(e.id || '')) ? e.id : 'ex_' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var prev = exPrivGet_(module, 'exams', id);
    var o = { id: id, title: exClean_(e.title, 120).trim(), instructions: exClean_(e.instructions, 3000), code: String(e.code || '').trim().toUpperCase().slice(0, 40),
      opensAt: Number(e.opensAt) || 0, closesAt: Number(e.closesAt) || 0, durationMin: Math.max(1, Math.min(600, Number(e.durationMin) || 0)),
      questionIds: (e.questionIds || []).map(String).filter(function (x) { return /^xq_/.test(x); }).slice(0, 500), poolCount: Math.max(0, Number(e.poolCount) || 0),
      shuffleQuestions: !!e.shuffleQuestions, shuffleOptions: !!e.shuffleOptions, showScore: !!e.showScore, lockTeaching: !!e.lockTeaching,
      candidates: e.candidates === 'all' || !e.candidates ? 'all' : (e.candidates || []).map(normUser_).filter(Boolean).slice(0, 2000),
      status: ['draft', 'published', 'closed'].indexOf(e.status) >= 0 ? e.status : 'draft', createdAt: prev ? prev.createdAt : now, updatedAt: now };
    if (!o.title) return { ok: false, error: 'Give the exam a title.' };
    if (o.status === 'published') {
      if (o.code.length < 4) return { ok: false, error: 'Set an exam access code of at least 4 characters.' };
      if (!o.opensAt || !o.closesAt || o.closesAt <= o.opensAt) return { ok: false, error: 'Set an opening time and a later closing time.' };
      if (!o.questionIds.length) return { ok: false, error: 'Choose the exam questions first.' };
      var clash = exPrivAll_(module, 'exams').filter(function (x) { return x.id !== id && x.status !== 'draft' && String(x.code).toUpperCase() === o.code; });
      if (clash.length) return { ok: false, error: 'Another exam already uses the access code ' + o.code + '. Choose a different code.' };
    }
    exPrivPut_(module, 'exams', id, o); exClearLocks_(module, id);
    return { ok: true, exam: o };
  }
  if (a === 'examRemove') {
    var store = assessStore_(module), atts2 = store.list('exattempt').filter(function (x) { return x.examId === String(p.id); });
    if (atts2.length && !p.withResults) return { ok: false, code: 'hasresults', count: atts2.length, error: 'This exam has ' + atts2.length + ' attempt(s). Export the results first, then confirm deletion.' };
    atts2.forEach(function (x) { store.purge('exattempt', x.id); });
    exPrivDel_(module, 'exams', String(p.id)); exClearLocks_(module, String(p.id));
    return { ok: true, deletedAttempts: atts2.length };
  }
  if (a === 'examResults') {
    var exam = exPrivGet_(module, 'exams', String(p.examId)); if (!exam) return { ok: false, error: 'Exam not found.' };
    var rows, lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var st = assessStore_(module);
      rows = st.list('exattempt').filter(function (x) { return x.examId === exam.id; }).map(function (x) { return exGetAtt_(module, st, x.id) || x; });
      rows.forEach(function (x) { exMaybeExpire_(st, x, now); });
    } finally { lock.releaseLock(); }
    var students = readAll_(SHEETS.STUDENTS).filter(function (r) { return r.module === module && (exam.candidates === 'all' ? isTrue_(r.active) : exCandidateOk_(exam, r.username)); });
    var byUser = {}; rows.forEach(function (x) { byUser[x.username] = x; });
    var list = students.map(function (s) { var x = byUser[normUser_(s.username)]; return exResultRow_(x, s.username, s.name); });
    rows.forEach(function (x) { if (!students.some(function (s) { return normUser_(s.username) === x.username; })) list.push(exResultRow_(x, x.username, x.studentName)); });
    // item analysis: % fully correct per bank question
    var items = {};
    rows.filter(function (x) { return x.status === 'submitted'; }).forEach(function (x) {
      (x.answers || []).forEach(function (ans, i) { var q = x.questions[i]; var it = items[q.id] || (items[q.id] = { id: q.id, stem: String(q.stem).slice(0, 160), type: q.type, n: 0, correct: 0, unanswered: 0, marks: 0 });
        it.n++; if (ans.correct) it.correct++; if (!ans.answered) it.unanswered++; it.marks += ans.mark || 0; });
    });
    return { ok: true, serverTime: now, exam: exam, results: list, items: Object.keys(items).map(function (k) { return items[k]; }) };
  }
  if (a === 'examAttemptDetail') {
    var att = exGetAtt_(module, assessStore_(module), exAttId_(String(p.examId), normUser_(p.username)));
    if (!att) return { ok: false, error: 'No attempt found.' };
    return { ok: true, attempt: att, paper: exPaper_(att), original: exToOriginal_(att, att.displayResponses || {}) };
  }
  if (a === 'examReleaseSession') {
    var lr = LockService.getScriptLock(); lr.waitLock(20000);
    try {
      var sr = assessStore_(module), ra = exGetAtt_(module, sr, exAttId_(String(p.examId), normUser_(p.username)));
      if (!ra || ra.status !== 'in_progress') return { ok: false, error: 'This student has no exam in progress.' };
      ra.activeSession = null; ra.releases = (ra.releases || 0) + 1; ra.sheetSavedAt = exStamp_(ra, Date.now());
      sr.put('exattempt', ra.id, ra); exCacheAtt_(module, ra);
    } finally { lr.releaseLock(); }
    return { ok: true };
  }
  if (a === 'examResetAttempt') {
    var lk = LockService.getScriptLock(); lk.waitLock(20000);
    try { var rid = exAttId_(String(p.examId), normUser_(p.username)); assessStore_(module).purge('exattempt', rid); CacheService.getScriptCache().remove(exAttCacheKey_(module, rid)); } finally { lk.releaseLock(); }
    return { ok: true };
  }
  return { ok: false, code: 'badaction', error: 'Unknown action: ' + a };
}
function exResultRow_(x, username, name) {
  if (!x) return { username: String(username), name: name, status: 'not_started' };
  return { username: x.username, name: x.studentName || name, status: x.status, submitMode: x.submitMode || '', score: x.score, total: x.total, percent: x.percent,
    correct: x.correct, incorrect: x.incorrect, unanswered: x.unanswered, startedAt: x.startedAt, submittedAt: x.submittedAt, deadlineAt: x.deadlineAt,
    lastSavedAt: x.lastSavedAt || 0, leaves: x.leaves || 0, late: !!x.late, devices: x.devices || 0, takeovers: x.takeovers || 0, blocked: x.blocked || 0, releases: x.releases || 0,
    active: !!(x.status === 'in_progress' && x.activeSession && Date.now() - Number(x.activeSession.lastSeen || 0) < EX_TAKEOVER_MS) };
}
/* ==== ASSESS ENGINE BEGIN (generated from src/07_assess_engine.js by build.py — edit that file, not this block) ==== */
/* ==========================================================================
   07_assess_engine.js — the ONE assessment engine (grading, assignment rules,
   attempt generation, submission, student-safe views).

   This file is deliberately self-contained (no DOM, no platform globals) so the
   exact same source runs in three places:
     • the browser (local mode — no backend configured),
     • Google Apps Script (build.py copies it verbatim into backend/Code.gs
       between the ASSESS ENGINE markers),
     • the Node test mock (tests/mock_backend.js loads this file directly).
   Storage is injected through a small adapter (see AE_createService), so the
   rules — who may start what, which questions an attempt gets, how it is
   graded — can never drift apart between local mode and the real server.

   Architecture (four separate entities, never merged):
     QUESTION   — canonical, lives in the central Question Bank (not here)
     ASSESSMENT — a definition that REFERENCES question ids; publishing freezes
                  an immutable "version" snapshot of those questions
     ASSIGNMENT — who receives an assessment (everyone / a group / named emails)
     ATTEMPT    — one student's actual sitting, with its own frozen copy of the
                  exact questions, question order, option order and correct
                  answers it was given — so later edits can never rewrite history.
   ========================================================================== */
var AE_GRACE_MS = 2 * 60 * 1000;     // network/clock grace after a time limit before a submission counts as late
var AE_EXPIRE_MS = 15 * 60 * 1000;   // an attempt left unsubmitted this long past its deadline is shown as Expired

/* ---------------- text normalisation & grading (single implementation) ---------------- */
function AE_normText(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―−]/g, '-').replace(/[’‘`´]/g, "'").replace(/[^a-z0-9₀-₉⁰-⁹α-ωβ:+.\-'\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}
function AE_normAnswer(s) { return AE_normText(s).replace(/^the /, '').replace(/\s*%$/, ''); }
function AE_gradeQuestion(q, resp) {
  var r = { answered: false, correct: false, score: 0 };
  if (resp === null || resp === undefined) return r;
  var oks, i;
  switch (q.type) {
    case 'mcq': case 'vignette':
      if (typeof resp !== 'number') return r; r.answered = true; r.correct = resp === q.answer; break;
    case 'tf':
      if (typeof resp !== 'boolean') return r; r.answered = true; r.correct = resp === q.answer; break;
    case 'selectall': {
      if (!Array.isArray(resp) || !resp.length) return r; r.answered = true;
      var a = resp.slice().sort(function (x, y) { return x - y; }).join(','), b = (q.answers || []).slice().sort(function (x, y) { return x - y; }).join(',');
      r.correct = a === b; break;
    }
    case 'fillblank': {
      if (!Array.isArray(resp) || !resp.some(function (x) { return String(x || '').trim(); })) return r; r.answered = true;
      oks = (q.answers || []).map(function (acc, k) { return (acc || []).some(function (x) { return AE_normAnswer(x) === AE_normAnswer(resp[k] || ''); }); });
      r.blanks = oks; r.correct = oks.length > 0 && oks.every(Boolean); r.score = oks.length ? oks.filter(Boolean).length / oks.length : 0; return r;
    }
    case 'matching': {
      if (!resp || typeof resp !== 'object') return r;
      var vals = (q.pairs || []).map(function (_, k) { return resp[k]; });
      if (!vals.some(function (v) { return v !== undefined && v !== null && v !== ''; })) return r; r.answered = true;
      oks = (q.pairs || []).map(function (_, k) { return Number(resp[k]) === k; });
      r.pairs = oks; r.correct = oks.every(Boolean); r.score = oks.filter(Boolean).length / oks.length; return r;
    }
    case 'short': {
      var txt = AE_normText(resp || ''); if (!txt) return r; r.answered = true;
      var groups = q.keywords || [];
      var hit = groups.filter(function (g) { return g.some(function (k) { return txt.indexOf(AE_normText(k)) >= 0; }); }).length;
      r.coverage = groups.length ? hit / groups.length : 0;
      r.correct = r.coverage >= 0.6; r.score = r.coverage; return r;
    }
    default: return r;
  }
  r.score = r.correct ? 1 : 0;
  return r;
}
/** Marks for one question in a formal assessment (1 mark each; matching & multi-blank earn partial marks). */
function AE_markFor(q, g) { return g.answered ? ((q.type === 'matching' || q.type === 'fillblank') ? (g.score || 0) : (g.correct ? 1 : 0)) : 0; }
/** A copy of a question with the answer key removed — what a student's browser receives during an attempt.
 *  (Matching pairs are inherently their own key: the shuffled right-hand column is sent, as it must be.) */
function AE_stripAnswers(q) {
  var s = JSON.parse(JSON.stringify(q));
  delete s.explanation; delete s.ref; delete s.model; delete s.importBatch; delete s.sourceRef;
  if (s.type === 'mcq' || s.type === 'vignette' || s.type === 'tf') delete s.answer;
  if (s.type === 'selectall') s.answers = [];
  if (s.type === 'fillblank') s.answers = (s.answers || []).map(function () { return []; });
  if (s.type === 'short') s.keywords = [];
  return s;
}

/* ---------------- small utilities ---------------- */
function AE_normEmail(e) { return String(e || '').trim().toLowerCase(); }
function AE_validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(AE_normEmail(e)); }
function AE_shuffle(arr, rand) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function AE_range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
function AE_id(prefix, rand) { return prefix + '_' + Date.now().toString(36) + Math.floor(rand() * 1e9).toString(36); }

/* ---------------- assignment rules ---------------- */
function AE_assignmentAppliesTo(a, email, groupsById) {
  if (!a || a.status !== 'active') return false;
  var e = AE_normEmail(email);
  if (a.targetType === 'all') return true;
  if (a.targetType === 'group') {
    var g = groupsById[a.groupId];
    return !!(g && !g.deleted && (g.members || []).some(function (m) { return AE_normEmail(m.email) === e; }));
  }
  if (a.targetType === 'students') return (a.emails || []).some(function (x) { return AE_normEmail(x) === e; });
  return false;
}
/** 'upcoming' | 'open' | 'late' (past due, late work accepted) | 'closed' | 'cancelled' */
function AE_assignmentWindow(a, now) {
  if (a.status !== 'active') return 'cancelled';
  if (a.availableFrom && now < a.availableFrom) return 'upcoming';
  if (a.dueAt && now > a.dueAt) return a.allowLate ? 'late' : 'closed';
  return 'open';
}
/** Assignment-level overrides win over the assessment's own settings. */
function AE_effectiveSettings(a, version) {
  var s = (version && version.settings) || {};
  return {
    attemptsAllowed: (a.attemptsAllowed !== null && a.attemptsAllowed !== undefined && a.attemptsAllowed !== '') ? Number(a.attemptsAllowed) : Number(s.attemptsAllowed || 0),
    timeLimitMin: (a.timeLimitMin !== null && a.timeLimitMin !== undefined && a.timeLimitMin !== '') ? Number(a.timeLimitMin) : Number(s.timeLimitMin || 0),
    shuffleQuestions: !!s.shuffleQuestions, shuffleOptions: !!s.shuffleOptions,
    showScore: s.showScore !== false, showAnswers: !!s.showAnswers, passPct: Number(s.passPct || 0)
  };
}
function AE_recipientCount(a, groupsById) {
  if (a.targetType === 'all') return null; // "everyone with the quiz password"
  if (a.targetType === 'group') { var g = groupsById[a.groupId]; return g ? (g.members || []).length : 0; }
  return (a.emails || []).length;
}
function AE_targetLabel(a, groupsById) {
  if (a.targetType === 'all') return 'Everyone (open to the class)';
  if (a.targetType === 'group') { var g = groupsById[a.groupId]; return 'Group: ' + (g ? g.name : '(deleted group)'); }
  var n = (a.emails || []).length; return n === 1 ? a.emails[0] : n + ' students';
}

/* ---------------- attempts ---------------- */
/** Build a brand-new attempt from a published version: which questions (fixed set, or a random
 *  sample for a Question Pool), in what order, with what option order — all decided ONCE here and
 *  stored, so the exact paper this student sat is reproducible forever. */
function AE_buildAttempt(version, assignment, email, name, attemptNo, now, rand) {
  var eff = AE_effectiveSettings(assignment, version);
  var ids = (version.questionIds || []).filter(function (id) { return version.questions && version.questions[id]; });
  if (version.mode === 'pool') {
    var n = Math.max(1, Math.min(Number(version.poolCount) || ids.length, ids.length));
    ids = AE_shuffle(ids, rand).slice(0, n);
    if (!eff.shuffleQuestions) { var pos = {}; (version.questionIds || []).forEach(function (id, i) { pos[id] = i; }); ids.sort(function (x, y) { return pos[x] - pos[y]; }); }
  } else if (eff.shuffleQuestions) ids = AE_shuffle(ids, rand);
  var questions = ids.map(function (id) { return JSON.parse(JSON.stringify(version.questions[id])); });
  var optionOrders = questions.map(function (q) {
    if (q.type === 'mcq' || q.type === 'vignette' || q.type === 'selectall') return eff.shuffleOptions ? AE_shuffle(AE_range(q.options.length), rand) : AE_range(q.options.length);
    if (q.type === 'matching') return { left: eff.shuffleOptions ? AE_shuffle(AE_range(q.pairs.length), rand) : AE_range(q.pairs.length), right: AE_shuffle(AE_range(q.pairs.length), rand) };
    return null;
  });
  var deadlineAt = eff.timeLimitMin > 0 ? now + eff.timeLimitMin * 60000 : null;
  return {
    id: AE_id('att', rand), assignmentId: assignment.id, assessmentId: version.assessmentId, assessmentTitle: version.title || '',
    version: version.version, mode: version.mode, email: AE_normEmail(email), name: String(name || '').trim(), attemptNo: attemptNo,
    status: 'in_progress', startedAt: now, deadlineAt: deadlineAt, submittedAt: null, late: false,
    questions: questions, optionOrders: optionOrders, settings: eff, responses: null,
    score: null, total: questions.length, percent: null, correct: null, incorrect: null, unanswered: null, answers: null
  };
}
function AE_attemptStatus(att, now) {
  if (att.status === 'in_progress' && att.deadlineAt && now > att.deadlineAt + AE_EXPIRE_MS) return 'expired';
  return att.status;
}
/** Grade an attempt against ITS OWN frozen question copies (never the live bank). */
function AE_gradeAttempt(att, responses) {
  var score = 0, correct = 0, incorrect = 0, unanswered = 0;
  var resp = responses || {};
  var answers = att.questions.map(function (q) {
    var r = resp[q.id]; var g = AE_gradeQuestion(q, r); var mark = AE_markFor(q, g);
    score += mark;
    if (!g.answered) unanswered++; else if (g.correct) correct++; else incorrect++;
    return { qid: q.id, version: q.version || 1, topic: q.topic, type: q.type, answered: g.answered, correct: g.correct, mark: Math.round(mark * 100) / 100, response: r === undefined ? null : r };
  });
  score = Math.round(score * 100) / 100;
  var total = att.questions.length;
  return { score: score, total: total, percent: total ? Math.round((score / total) * 1000) / 10 : 0, correct: correct, incorrect: incorrect, unanswered: unanswered, answers: answers };
}
/** What a student's browser may see of their own attempt. */
function AE_studentAttempt(att, now, includePaper) {
  var st = AE_attemptStatus(att, now);
  var out = { id: att.id, assignmentId: att.assignmentId, assessmentId: att.assessmentId, attemptNo: att.attemptNo, status: st,
    startedAt: att.startedAt, deadlineAt: att.deadlineAt, submittedAt: att.submittedAt, late: !!att.late, total: att.total, serverTime: now };
  var s = att.settings || {};
  if (st === 'submitted' && s.showScore) { out.score = att.score; out.percent = att.percent; out.correct = att.correct; out.incorrect = att.incorrect; out.unanswered = att.unanswered; if (s.passPct) out.passed = att.percent >= s.passPct; }
  if (includePaper && st === 'in_progress') {
    out.questions = att.questions.map(AE_stripAnswers); out.optionOrders = att.optionOrders;
    out.timeLimitMin = s.timeLimitMin || 0;
  }
  if (st === 'submitted' && s.showAnswers) { out.review = { questions: att.questions, optionOrders: att.optionOrders, answers: att.answers }; }
  return out;
}

/* ---------------- validation ---------------- */
function AE_validateAssignment(inp, ctx) {
  var errs = [];
  var asmt = ctx.assessment, ver = ctx.version;
  if (!asmt) errs.push('The assessment no longer exists.');
  else {
    if (asmt.status !== 'published') errs.push('“' + (asmt.title || asmt.id) + '” is not published (status: ' + (asmt.status || 'draft') + ') — publish it before assigning.');
    if (!ver) errs.push('The published version of “' + (asmt.title || asmt.id) + '” could not be found on the server — publish it again.');
    else if (!(ver.questionIds || []).length) errs.push('“' + (asmt.title || asmt.id) + '” has no questions.');
  }
  if (inp.targetType === 'group') {
    var g = ctx.groupsById[inp.groupId];
    if (!g || g.deleted) errs.push('The selected group does not exist.');
    else if (!(g.members || []).length) errs.push('Group “' + g.name + '” has no students in it.');
  } else if (inp.targetType === 'students') {
    var em = (inp.emails || []).map(AE_normEmail).filter(Boolean);
    if (!em.length) errs.push('Choose at least one student.');
    var bad = em.filter(function (e) { return !AE_validEmail(e); });
    if (bad.length) errs.push('Invalid email address' + (bad.length > 1 ? 'es' : '') + ': ' + bad.slice(0, 5).join(', '));
  } else if (inp.targetType !== 'all') errs.push('Choose who receives this assessment.');
  if (inp.availableFrom && isNaN(Number(inp.availableFrom))) errs.push('“Available from” is not a valid date.');
  if (inp.dueAt && isNaN(Number(inp.dueAt))) errs.push('“Due” is not a valid date.');
  if (inp.availableFrom && inp.dueAt && Number(inp.dueAt) <= Number(inp.availableFrom)) errs.push('The due date must be after the “available from” date.');
  if (inp.attemptsAllowed !== null && inp.attemptsAllowed !== undefined && inp.attemptsAllowed !== '' && !(Number(inp.attemptsAllowed) >= 0 && Number(inp.attemptsAllowed) % 1 === 0)) errs.push('Attempts allowed must be a whole number (0 = unlimited).');
  if (inp.timeLimitMin !== null && inp.timeLimitMin !== undefined && inp.timeLimitMin !== '' && !(Number(inp.timeLimitMin) >= 0 && Number(inp.timeLimitMin) <= 600)) errs.push('Time limit must be between 0 (untimed) and 600 minutes.');
  // exact duplicate of an assignment that is already active
  var dup = (ctx.assignments || []).some(function (a) {
    if (a.status !== 'active' || a.assessmentId !== inp.assessmentId || a.targetType !== inp.targetType) return false;
    if (a.targetType === 'all') return true;
    if (a.targetType === 'group') return a.groupId === inp.groupId;
    return (a.emails || []).map(AE_normEmail).sort().join(',') === (inp.emails || []).map(AE_normEmail).sort().join(',');
  });
  if (dup) errs.push('This assessment is already assigned to exactly these recipients.');
  return errs;
}

/* ---------------- the service (storage injected) ----------------
 * store = {
 *   list(kind) -> [obj], get(kind, id) -> obj|null, put(kind, id, obj), del(kind, id),
 *   getAssessment(id) -> assessment doc|null, getVersion(assessmentId, n) -> version doc|null,
 *   now() -> ms, rand() -> [0,1)
 * }   kinds: 'group' | 'assignment' | 'attempt'
 */
function AE_createService(store) {
  function groupsById() { var m = {}; store.list('group').forEach(function (g) { m[g.id] = g; }); return m; }
  function versionFor(assessmentId) {
    var a = store.getAssessment(assessmentId);
    if (!a || !a.publishedVersion) return { assessment: a, version: null };
    return { assessment: a, version: store.getVersion(assessmentId, a.publishedVersion) };
  }
  function attemptsFor(assignmentId, email) {
    var e = AE_normEmail(email);
    return store.list('attempt').filter(function (t) { return t.assignmentId === assignmentId && t.email === e; })
      .sort(function (x, y) { return x.attemptNo - y.attemptNo; });
  }
  var svc = {
    /* ---- teacher: groups ---- */
    listGroups: function () { return { ok: true, groups: store.list('group').filter(function (g) { return !g.deleted; }) }; },
    saveGroup: function (g) {
      var name = String((g && g.name) || '').trim();
      if (!name) return { ok: false, error: 'Give the group a name.' };
      var seen = {}; var bad = [];
      var members = ((g && g.members) || []).map(function (m) { return { name: String(m.name || '').trim(), email: AE_normEmail(m.email) }; })
        .filter(function (m) { if (!m.email) return false; if (!AE_validEmail(m.email)) { bad.push(m.email); return false; } if (seen[m.email]) return false; seen[m.email] = 1; return true; });
      if (bad.length) return { ok: false, error: 'Invalid email address' + (bad.length > 1 ? 'es' : '') + ': ' + bad.slice(0, 5).join(', ') };
      var now = store.now();
      var existing = g.id ? store.get('group', g.id) : null;
      var rec = { id: g.id || AE_id('grp', store.rand), name: name, description: String(g.description || ''), members: members, createdAt: existing ? existing.createdAt : now, updatedAt: now };
      store.put('group', rec.id, rec);
      return { ok: true, group: rec };
    },
    deleteGroup: function (id) {
      var used = store.list('assignment').filter(function (a) { return a.status === 'active' && a.targetType === 'group' && a.groupId === id; });
      if (used.length) return { ok: false, error: 'This group still has ' + used.length + ' active assignment' + (used.length > 1 ? 's' : '') + ' — cancel them first.' };
      var g = store.get('group', id); if (!g) return { ok: true };
      g.deleted = true; g.updatedAt = store.now(); store.put('group', id, g);
      return { ok: true };
    },
    /* ---- teacher: assignments ---- */
    listAssignments: function () {
      var gb = groupsById(); var atts = store.list('attempt'); var now = store.now();
      return { ok: true, assignments: store.list('assignment').map(function (a) {
        var mine = atts.filter(function (t) { return t.assignmentId === a.id; });
        var started = {}, done = {};
        mine.forEach(function (t) { started[t.email] = 1; if (AE_attemptStatus(t, now) === 'submitted') done[t.email] = 1; });
        return Object.assign({}, a, { recipients: AE_recipientCount(a, gb), targetLabel: AE_targetLabel(a, gb), window: AE_assignmentWindow(a, now),
          startedCount: Object.keys(started).length, completedCount: Object.keys(done).length, attemptCount: mine.length });
      }) };
    },
    /** Validates EVERY item first and reports per-item success/failure — never claims all succeeded. */
    createAssignments: function (list) {
      var gb = groupsById(); var existing = store.list('assignment'); var now = store.now();
      var results = []; var created = 0;
      (list || []).forEach(function (inp, i) {
        var ctx = versionFor(inp.assessmentId);
        var errs = AE_validateAssignment(inp, { assessment: ctx.assessment, version: ctx.version, groupsById: gb, assignments: existing });
        if (errs.length) { results.push({ index: i, ok: false, error: errs.join(' ') }); return; }
        var rec = {
          id: AE_id('asg', store.rand), assessmentId: inp.assessmentId, assessmentTitle: ctx.assessment.title || '',
          targetType: inp.targetType, groupId: inp.targetType === 'group' ? inp.groupId : '',
          emails: inp.targetType === 'students' ? (inp.emails || []).map(AE_normEmail).filter(Boolean) : [],
          availableFrom: inp.availableFrom ? Number(inp.availableFrom) : null, dueAt: inp.dueAt ? Number(inp.dueAt) : null,
          allowLate: !!inp.allowLate,
          attemptsAllowed: (inp.attemptsAllowed === '' || inp.attemptsAllowed === null || inp.attemptsAllowed === undefined) ? null : Number(inp.attemptsAllowed),
          timeLimitMin: (inp.timeLimitMin === '' || inp.timeLimitMin === null || inp.timeLimitMin === undefined) ? null : Number(inp.timeLimitMin),
          note: String(inp.note || ''), status: 'active', assignedAt: now, updatedAt: now
        };
        try { store.put('assignment', rec.id, rec); existing.push(rec); created++; results.push({ index: i, ok: true, id: rec.id }); }
        catch (err) { results.push({ index: i, ok: false, error: 'Could not save: ' + (err && err.message || err) }); }
      });
      return { ok: created === (list || []).length && created > 0, created: created, failed: (list || []).length - created, results: results };
    },
    cancelAssignment: function (id) {
      var a = store.get('assignment', id); if (!a) return { ok: false, error: 'Assignment not found.' };
      a.status = 'cancelled'; a.cancelledAt = store.now(); a.updatedAt = a.cancelledAt; store.put('assignment', id, a);
      return { ok: true };
    },
    listAttempts: function (opts) {
      var now = store.now(); var aid = opts && opts.assessmentId;
      return { ok: true, attempts: store.list('attempt').filter(function (t) { return !aid || t.assessmentId === aid; })
        .map(function (t) { return Object.assign({}, t, { status: AE_attemptStatus(t, now) }); }) };
    },
    /* ---- student ---- */
    getMyAssessments: function (email) {
      if (!AE_validEmail(email)) return { ok: false, error: 'Please enter a valid email address.' };
      var gb = groupsById(); var now = store.now(); var items = [];
      store.list('assignment').forEach(function (a) {
        if (!AE_assignmentAppliesTo(a, email, gb)) return;
        var ctx = versionFor(a.assessmentId);
        if (!ctx.assessment || ctx.assessment.status === 'draft') return;
        var ver = ctx.version; var eff = AE_effectiveSettings(a, ver);
        var mine = attemptsFor(a.id, email);
        var used = mine.length;
        var inProgress = mine.filter(function (t) { return AE_attemptStatus(t, now) === 'in_progress'; })[0] || null;
        var win = AE_assignmentWindow(a, now);
        var asmtOpen = ctx.assessment.status === 'published' && !!ver;
        var canStart = asmtOpen && (win === 'open' || win === 'late') && (inProgress || !eff.attemptsAllowed || used < eff.attemptsAllowed);
        items.push({
          assignment: { id: a.id, assessmentId: a.assessmentId, availableFrom: a.availableFrom, dueAt: a.dueAt, allowLate: a.allowLate, window: win },
          assessment: { id: ctx.assessment.id, title: ctx.assessment.title, description: ctx.assessment.description || '', instructions: ctx.assessment.instructions || '', status: ctx.assessment.status,
            questionCount: ver ? (ver.mode === 'pool' ? Math.min(Number(ver.poolCount) || 0, (ver.questionIds || []).length) : (ver.questionIds || []).length) : 0 },
          settings: { attemptsAllowed: eff.attemptsAllowed, timeLimitMin: eff.timeLimitMin, showScore: eff.showScore, showAnswers: eff.showAnswers, passPct: eff.passPct },
          attempts: mine.map(function (t) { return AE_studentAttempt(t, now, false); }),
          attemptsUsed: used, inProgressId: inProgress ? inProgress.id : null, canStart: !!canStart
        });
      });
      items.sort(function (x, y) { return (x.assignment.dueAt || 9e15) - (y.assignment.dueAt || 9e15); });
      return { ok: true, items: items, serverTime: now };
    },
    startAttempt: function (assignmentId, email, name) {
      if (!AE_validEmail(email)) return { ok: false, error: 'Please enter a valid email address.' };
      var gb = groupsById(); var now = store.now();
      var a = store.get('assignment', assignmentId);
      if (!a || !AE_assignmentAppliesTo(a, email, gb)) return { ok: false, error: 'This assessment is not assigned to ' + AE_normEmail(email) + '.', code: 'notassigned' };
      var ctx = versionFor(a.assessmentId);
      if (!ctx.assessment || ctx.assessment.status !== 'published' || !ctx.version) return { ok: false, error: 'This assessment is not open (it may have been closed or archived by your teacher).', code: 'closed' };
      var mine = attemptsFor(a.id, email);
      var open = mine.filter(function (t) { return AE_attemptStatus(t, now) === 'in_progress'; })[0];
      if (open) return { ok: true, resumed: true, attempt: AE_studentAttempt(open, now, true) };
      var win = AE_assignmentWindow(a, now);
      if (win === 'upcoming') return { ok: false, error: 'This assessment opens on ' + new Date(a.availableFrom).toUTCString() + '.', code: 'upcoming' };
      if (win === 'closed' || win === 'cancelled') return { ok: false, error: 'The deadline for this assessment has passed.', code: 'closed' };
      var eff = AE_effectiveSettings(a, ctx.version);
      if (eff.attemptsAllowed && mine.length >= eff.attemptsAllowed) return { ok: false, error: 'You have used all ' + eff.attemptsAllowed + ' allowed attempt' + (eff.attemptsAllowed > 1 ? 's' : '') + '.', code: 'noattempts' };
      var att = AE_buildAttempt(ctx.version, a, email, name, mine.length + 1, now, store.rand);
      if (!att.questions.length) return { ok: false, error: 'This assessment has no questions available.', code: 'empty' };
      if (a.dueAt && !a.allowLate && (!att.deadlineAt || att.deadlineAt > a.dueAt)) att.deadlineAt = a.dueAt; // a timer never runs past a hard deadline
      store.put('attempt', att.id, att);
      return { ok: true, resumed: false, attempt: AE_studentAttempt(att, now, true) };
    },
    submitAttempt: function (attemptId, email, responses) {
      var now = store.now();
      var att = store.get('attempt', attemptId);
      if (!att || att.email !== AE_normEmail(email)) return { ok: false, error: 'Attempt not found for this student.', code: 'notfound' };
      if (att.status === 'submitted') return { ok: true, already: true, attempt: AE_studentAttempt(att, now, false) };
      var g = AE_gradeAttempt(att, responses);
      att.responses = responses || {};
      att.score = g.score; att.total = g.total; att.percent = g.percent; att.correct = g.correct; att.incorrect = g.incorrect; att.unanswered = g.unanswered; att.answers = g.answers;
      att.submittedAt = now; att.status = 'submitted';
      var asg = store.get('assignment', att.assignmentId);
      att.late = !!((att.deadlineAt && now > att.deadlineAt + AE_GRACE_MS) || (asg && asg.dueAt && now > asg.dueAt + AE_GRACE_MS));
      store.put('attempt', att.id, att);
      return { ok: true, attempt: AE_studentAttempt(att, now, false) };
    },
    /* ---- teacher: private feedback emails ----
     * mail = { quota() -> remaining sends today, send(to, subject, html, text) (throws on failure) }.
     * The recipient, score and answers come ONLY from the stored attempt; the browser just names attempt ids.
     * Every attempt is a separate email to that one student (no CC/BCC); per-recipient results are returned. */
    sendFeedback: function (attemptIds, opts, mail, expectAssessmentId) {
      var o = AE_cleanFeedbackOpts(opts); var now = store.now(); var results = []; var sent = 0;
      var ids = (attemptIds || []).map(String).filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });
      if (!ids.length) return { ok: false, error: 'No attempts were selected.' };
      ids.forEach(function (id) {
        var att = store.get('attempt', id);
        if (!att) { results.push({ id: id, ok: false, code: 'notfound', error: 'Attempt not found.' }); return; }
        if (AE_attemptStatus(att, now) !== 'submitted') { results.push({ id: id, ok: false, code: 'notsubmitted', error: 'This attempt has not been submitted.' }); return; }
        if (expectAssessmentId && att.assessmentId !== expectAssessmentId) { results.push({ id: id, ok: false, code: 'mismatch', error: 'This attempt does not belong to the selected assessment.' }); return; }
        var cur = store.getAssessment ? store.getAssessment(att.assessmentId) : null;
        if (store.getAssessment && !cur) { results.push({ id: id, ok: false, code: 'noassessment', error: 'The assessment for this attempt no longer exists.' }); return; }
        if (!att.email) { results.push({ id: id, ok: false, code: 'noemail', error: 'No email address is available for this student.' }); return; }
        if (!AE_validEmail(att.email)) { results.push({ id: id, ok: false, code: 'bademail', error: 'Feedback could not be sent because this student does not have a valid email address.' }); return; }
        if (!(att.questions || []).length) { results.push({ id: id, ok: false, code: 'noquestions', error: 'The question data for this attempt is missing, so feedback cannot be generated.' }); return; }
        var left; try { left = mail.quota(); } catch (e) { left = 0; }
        if (!(left > 0)) { results.push({ id: id, ok: false, code: 'quota', error: 'Daily email quota reached — try again tomorrow.' }); return; }
        // the title the teacher sees now (renamed assessments); everything else comes from the stored attempt
        var f = AE_buildFeedback(cur && cur.title ? Object.assign({}, att, { assessmentTitle: cur.title }) : att, o);
        try { mail.send(att.email, f.subject, f.html, f.text); }
        catch (e) { results.push({ id: id, ok: false, code: 'send', error: 'Feedback could not be sent. Please try again.', detail: String(e && e.message || e) }); return; }
        var log = (att.feedbackLog || []).concat([{ at: store.now(), level: o.level }]).slice(-10);
        att.feedback = { sentAt: store.now(), level: o.level, count: ((att.feedback && att.feedback.count) || 0) + 1 }; att.feedbackLog = log;
        try { store.put('attempt', att.id, att); } catch (e) { /* the email went out; only the status could not be saved */ }
        sent++; results.push({ id: id, ok: true, sentAt: att.feedback.sentAt, count: att.feedback.count });
      });
      var q; try { q = mail.quota(); } catch (e) { q = null; }
      return { ok: sent === ids.length, sent: sent, failed: ids.length - sent, results: results, quota: q };
    },
    /* ---- teacher: delete an assessment's PRIVATE records (every attempt + every assignment of that assessment id).
     * Nothing else is touched: other assessments' records, groups, and the Question Bank are never read or changed.
     * alsoFn() runs inside the same transaction (the caller deletes the assessment definition + its versions there);
     * if anything throws, every removed record is put back and nothing is reported as deleted. */
    deleteAssessmentData: function (assessmentId, alsoFn) {
      var aid = String(assessmentId || ''); if (!aid) return { ok: false, error: 'No assessment id.' };
      var atts = store.list('attempt').filter(function (t) { return t.assessmentId === aid; });
      var asgs = store.list('assignment').filter(function (a) { return a.assessmentId === aid; });
      var removed = []; var rm = store.purge || store.del;
      try {
        atts.forEach(function (t) { rm('attempt', t.id); removed.push(['attempt', t]); });
        asgs.forEach(function (a) { rm('assignment', a.id); removed.push(['assignment', a]); });
        if (alsoFn) alsoFn();
      } catch (e) {
        removed.forEach(function (x) { try { store.put(x[0], x[1].id, x[1]); } catch (e2) { /* best effort */ } });
        return { ok: false, error: 'Assessment could not be deleted. No changes were made.', detail: String(e && e.message || e) };
      }
      var students = {}; atts.forEach(function (t) { students[t.email] = 1; });
      return { ok: true, attempts: atts.length, assignments: asgs.length, students: Object.keys(students).length };
    }
  };
  return svc;
}

/* ==========================================================================
   Student feedback emails (teacher → one student, about ONE attempt)
   Built ONLY from the attempt's own frozen record (its questions, answer key,
   explanations, the student's responses and the option order the student saw),
   so the preview the teacher sees in the browser and the email the server
   sends are produced by the same code from the same data.
   Explanations: the question's stored explanation is used; when none exists
   the email states the official answer only — nothing is invented.
   ========================================================================== */
var AE_FEEDBACK_LEVELS = { summary: 'Summary only', mistakes: 'Summary + incorrect/unanswered questions', detailed: 'Detailed feedback' };
var AE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function AE_esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function AE_pad2(n) { return (n < 10 ? '0' : '') + n; }
/** tzOffsetMin = the teacher's Date#getTimezoneOffset(), so dates read in the teacher's local time on the server too */
function AE_fmtDate(ts, tzOffsetMin) {
  if (!ts) return '';
  var d = new Date(Number(ts) - (Number(tzOffsetMin) || 0) * 60000);
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + AE_pad2(d.getUTCHours()) + ':' + AE_pad2(d.getUTCMinutes());
}
function AE_fmtDuration(ms) {
  if (!(ms > 0)) return '';
  var s = Math.round(ms / 1000); if (s < 1) return '';
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? h + ' h ' + m + ' min' : m ? m + ' min' + (r ? ' ' + r + ' s' : '') : r + ' s';
}
/** the letter the student actually saw for an original option index (options may have been shuffled) */
function AE_letterFor(order, origIdx) { var p = Array.isArray(order) ? order.indexOf(origIdx) : origIdx; return AE_LETTERS[p >= 0 ? p : origIdx] || '?'; }
function AE_optText(q, order, i) { return AE_letterFor(order, i) + '. ' + ((q.options || [])[i] == null ? '?' : q.options[i]); }
function AE_answerLines(q, resp, order) {
  if (resp === null || resp === undefined) return [];
  switch (q.type) {
    case 'mcq': case 'vignette': return typeof resp === 'number' ? [AE_optText(q, order, resp)] : [];
    case 'tf': return typeof resp === 'boolean' ? [resp ? 'True' : 'False'] : [];
    case 'selectall': return Array.isArray(resp) ? resp.slice().sort(function (a, b) { return AE_letterFor(order, a).localeCompare(AE_letterFor(order, b)); }).map(function (i) { return AE_optText(q, order, i); }) : [];
    case 'fillblank': return Array.isArray(resp) ? (q.answers || []).map(function (_, k) { return 'Blank ' + (k + 1) + ': ' + (String(resp[k] || '').trim() || '(empty)'); }) : [];
    case 'matching': return (q.pairs || []).map(function (p, k) { var v = resp && resp[k]; var m = (v !== undefined && v !== null && v !== '' && q.pairs[Number(v)]) ? q.pairs[Number(v)].right : '(not matched)'; return p.left + ' → ' + m; });
    case 'short': return [String(resp)];
    default: return [String(resp)];
  }
}
function AE_correctLines(q, order) {
  switch (q.type) {
    case 'mcq': case 'vignette': return [AE_optText(q, order, q.answer)];
    case 'tf': return [q.answer ? 'True' : 'False'];
    case 'selectall': return (q.answers || []).slice().sort(function (a, b) { return AE_letterFor(order, a).localeCompare(AE_letterFor(order, b)); }).map(function (i) { return AE_optText(q, order, i); });
    case 'fillblank': return (q.answers || []).map(function (acc, k) { return 'Blank ' + (k + 1) + ': ' + ((acc || [])[0] || ''); });
    case 'matching': return (q.pairs || []).map(function (p) { return p.left + ' → ' + p.right; });
    case 'short': return [q.model || ''];
    default: return [];
  }
}
/** Everything the email says, as data. opts: { level, topicTitles{id:title}, courseTitle, tzOffsetMin } */
function AE_feedbackModel(att, opts) {
  var o = opts || {}; var level = AE_FEEDBACK_LEVELS[o.level] ? o.level : 'detailed';
  var titles = o.topicTitles || {};
  var byTopic = {}, topicOrder = [];
  var answers = att.answers || [];
  var items = (att.questions || []).map(function (q, i) {
    var a = answers[i] && answers[i].qid === q.id ? answers[i] : (answers.filter(function (x) { return x.qid === q.id; })[0] || { answered: false, correct: false, mark: 0, response: null });
    var status = !a.answered ? 'unanswered' : a.correct ? 'correct' : (a.mark > 0 ? 'partial' : 'incorrect');
    var t = q.topic || ''; if (!byTopic[t]) { byTopic[t] = { n: 0, c: 0 }; topicOrder.push(t); }
    byTopic[t].n++; if (a.answered && a.correct) byTopic[t].c++; // same rule as the Results page's topic accuracy
    var order = (att.optionOrders || [])[i];
    return { n: i + 1, qid: q.id, type: q.type, topic: t, status: status, mark: Number(a.mark) || 0, stem: q.stem || '', caseText: q.case || '',
      your: AE_answerLines(q, a.response, order), correct: AE_correctLines(q, order), explanation: String(q.explanation || '').trim() };
  });
  var topics = topicOrder.map(function (t) { var x = byTopic[t]; return { id: t, title: String(titles[t] || t || 'Other'), n: x.n, c: x.c, pct: x.n ? Math.round(100 * x.c / x.n) : 0 }; });
  var byPct = topics.slice().sort(function (x, y) { return x.pct - y.pct || y.n - x.n; });
  var passPct = att.settings && att.settings.passPct;
  var shown = level === 'summary' ? [] : level === 'mistakes' ? items.filter(function (x) { return x.status !== 'correct'; }) : items;
  return {
    level: level, studentName: att.name || '', email: att.email, courseTitle: String(o.courseTitle || ''),
    assessmentTitle: att.assessmentTitle || String(o.assessmentTitle || '') || 'Assessment', attemptNo: att.attemptNo || 1,
    date: AE_fmtDate(att.submittedAt, o.tzOffsetMin), duration: AE_fmtDuration((att.submittedAt || 0) - (att.startedAt || 0)),
    score: att.score, total: att.total, percent: att.percent, correct: att.correct, incorrect: att.incorrect, unanswered: att.unanswered,
    passPct: passPct || null, passed: passPct ? att.percent >= passPct : null,
    topics: topics, items: shown, allItems: items.length,
    review: topics.filter(function (t) { return t.pct < 60; }).map(function (t) { return t.title; }),
    strengths: topics.filter(function (t) { return t.pct >= 80; }).map(function (t) { return t.title; }),
    lowest: topics.length > 1 && byPct[0].pct < 100 ? byPct[0] : null,
    signature: (o.signature || []).slice()
  };
}
function AE_feedbackEmail(m) {
  var H = AE_esc;
  var subject = ('Your Results & Feedback — ' + m.assessmentTitle).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 180);
  var hello = m.studentName ? 'Dear ' + m.studentName + ',' : 'Dear student,';
  var intro = 'Here is your personal performance feedback for “' + m.assessmentTitle + '”' + (m.attemptNo > 1 ? ' (attempt ' + m.attemptNo + ')' : '') + '. It has been sent only to you and contains only your own results.';
  var stats = [['Score', m.score + ' / ' + m.total], ['Percentage', m.percent + '%'], ['Correct', m.correct], ['Incorrect', m.incorrect], ['Unanswered', m.unanswered]];
  if (m.duration) stats.push(['Time taken', m.duration]);
  if (m.date) stats.push(['Submitted', m.date]);
  if (m.passPct) stats.push(['Pass mark', m.passPct + '% — ' + (m.passed ? 'reached' : 'not yet reached')]);
  var colour = { correct: '#15803d', partial: '#b45309', incorrect: '#c62828', unanswered: '#5d6d7e' };
  var label = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', unanswered: 'Unanswered' };
  var recs = [];
  if (m.strengths.length) recs.push('Areas of strength: ' + m.strengths.join('; ') + '.');
  if (m.lowest) recs.push('Your lowest-performing topic was: ' + m.lowest.title + ' (' + m.lowest.pct + '%).');
  if (m.review.length) recs.push('Topics to focus your revision on: ' + m.review.join('; ') + '. Re-reading the explanations above and the matching sections of the course is the most effective next step.');
  else recs.push('Keep revising regularly to consolidate what you have learned.');
  var h2 = function (t) { return '<h3 style="font-size:15px;color:#0b2a4a;margin:20px 0 8px;border-bottom:1px solid #dbe3ec;padding-bottom:4px">' + H(t) + '</h3>'; };
  var h = [];
  h.push('<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#172433;max-width:640px;margin:0 auto;line-height:1.5;font-size:14px">');
  h.push('<div style="background:#0b2a4a;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0"><div style="font-size:12px;opacity:.85">Assessment Results &amp; Feedback' + (m.courseTitle ? ' · ' + H(m.courseTitle) : '') + '</div><div style="font-size:19px;font-weight:700">' + H(m.assessmentTitle) + '</div></div>');
  h.push('<div style="border:1px solid #dbe3ec;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">');
  h.push(
  '<p style="margin:16px 0 0">Best regards,' +
  (m.signature.length
    ? '<br>' + m.signature.map(H).join('<br>')
    : '') +
  '</p>'
);
  h.push(h2('Your Result'));
  h.push('<table role="presentation" style="border-collapse:collapse;width:100%">' + stats.map(function (x) { return '<tr><td style="padding:5px 8px;border-bottom:1px solid #eaf0f5;color:#5d6d7e;width:42%">' + H(x[0]) + '</td><td style="padding:5px 8px;border-bottom:1px solid #eaf0f5;font-weight:700">' + H(x[1]) + '</td></tr>'; }).join('') + '</table>');
  if (m.topics.length) {
    h.push(h2('Topic Performance'));
    h.push('<table role="presentation" style="border-collapse:collapse;width:100%">');
    m.topics.forEach(function (t) { h.push('<tr><td style="padding:4px 8px;border-bottom:1px solid #eaf0f5">' + H(t.title) + '</td><td style="padding:4px 8px;border-bottom:1px solid #eaf0f5;text-align:right;white-space:nowrap;font-weight:700">' + t.pct + '%</td><td style="padding:4px 8px;border-bottom:1px solid #eaf0f5;text-align:right;color:#5d6d7e;white-space:nowrap">' + t.c + ' of ' + t.n + ' correct</td></tr>'); });
    h.push('</table>');
  }
  if (m.level !== 'summary') {
    h.push(h2(m.level === 'mistakes' ? 'Questions for Review' : 'Question-by-Question Review'));
    if (!m.items.length) h.push('<p style="margin:0">You answered every question correctly — there are no questions requiring review.</p>');
    m.items.forEach(function (it) {
      h.push('<div style="border:1px solid #dbe3ec;border-left:4px solid ' + colour[it.status] + ';border-radius:8px;padding:10px 12px;margin:0 0 10px">');
      h.push('<div style="font-size:12px;color:' + colour[it.status] + ';font-weight:700;margin-bottom:4px">Question ' + it.n + ' · ' + label[it.status] + '</div>');
      if (it.caseText) h.push('<div style="font-size:13px;color:#2b3a4b;margin-bottom:4px"><i>' + H(it.caseText) + '</i></div>');
      h.push('<div style="font-weight:600;margin-bottom:6px">' + H(it.stem) + '</div>');
      if (it.status === 'correct') { h.push('<div style="font-size:13px">&#10003; Your answer was correct: ' + H(it.correct.join('; ')) + '</div>'); }
      else {
        h.push('<div style="font-size:13px;margin-bottom:3px"><b>Your answer:</b> ' + (it.your.length ? H(it.your.join('; ')) : '<span style="color:#5d6d7e">Unanswered</span>') + '</div>');
        h.push('<div style="font-size:13px;margin-bottom:3px"><b>Correct answer:</b> ' + H(it.correct.join('; ')) + '</div>');
        if (it.explanation) h.push('<div style="font-size:13px;background:#f3f6fa;border-radius:6px;padding:6px 8px;margin-top:5px"><b>Explanation:</b> ' + H(it.explanation) + '</div>');
      }
      h.push('</div>');
    });
  }
  h.push(h2('Recommended Review'));
  recs.forEach(function (r) { h.push('<p style="margin:0 0 6px">' + H(r) + '</p>'); });
  h.push('<p style="margin:16px 0 0">Best regards,' + (m.signature.length ? '<br>' + m.signature.map(H).join('<br>') : '') + '</p>');
  h.push('<p style="margin:14px 0 0;font-size:12px;color:#5d6d7e">This email contains your personal assessment results. Please do not forward it.</p>');
  h.push('</div></div>');
  var t = ['ASSESSMENT RESULTS & FEEDBACK', m.assessmentTitle, '', hello, '', intro, '', 'YOUR RESULT'];
  stats.forEach(function (x) { t.push(x[0] + ': ' + x[1]); });
  if (m.topics.length) { t.push('', 'TOPIC PERFORMANCE'); m.topics.forEach(function (x) { t.push('- ' + x.title + ': ' + x.pct + '% (' + x.c + ' of ' + x.n + ' correct)'); }); }
  if (m.level !== 'summary') {
    t.push('', m.level === 'mistakes' ? 'QUESTIONS FOR REVIEW' : 'QUESTION-BY-QUESTION REVIEW');
    if (!m.items.length) t.push('You answered every question correctly — there are no questions requiring review.');
    m.items.forEach(function (it) {
      t.push('', 'Question ' + it.n + ' — ' + label[it.status]); if (it.caseText) t.push(it.caseText); t.push(it.stem);
      if (it.status === 'correct') t.push('Your answer was correct: ' + it.correct.join('; '));
      else { t.push('Your answer: ' + (it.your.length ? it.your.join('; ') : 'Unanswered')); t.push('Correct answer: ' + it.correct.join('; ')); if (it.explanation) t.push('Explanation: ' + it.explanation); }
    });
  }
  t.push('', 'RECOMMENDED REVIEW'); recs.forEach(function (r) { t.push(r); });
  t.push('', 'Best regards,'); m.signature.forEach(function (x) { t.push(x); });
  t.push('', 'This email contains your personal assessment results. Please do not forward it.');
  return { subject: subject, html: h.join(''), text: t.join('\n') };
}
/** Shared by the teacher's preview (browser) and the real send (server). */
function AE_buildFeedback(att, opts) { var m = AE_feedbackModel(att, opts); var e = AE_feedbackEmail(m); return { to: att.email, subject: e.subject, html: e.html, text: e.text, model: m }; }
/** Only display strings are taken from the teacher's browser; they are type-checked and size-capped here. */
function AE_cleanFeedbackOpts(o) {
  o = o || {}; var titles = {};
  if (o.topicTitles && typeof o.topicTitles === 'object') Object.keys(o.topicTitles).slice(0, 200).forEach(function (k) { if (typeof o.topicTitles[k] === 'string') titles[String(k).slice(0, 40)] = o.topicTitles[k].slice(0, 160); });
  var sig = Array.isArray(o.signature) ? o.signature.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 3).map(function (x) { return x.trim().slice(0, 120); }) : [];
  return { level: AE_FEEDBACK_LEVELS[o.level] ? o.level : 'detailed', topicTitles: titles, courseTitle: String(o.courseTitle || '').slice(0, 160), tzOffsetMin: Math.max(-900, Math.min(900, Number(o.tzOffsetMin) || 0)), signature: sig };
}
/* ==== ASSESS ENGINE END ==== */