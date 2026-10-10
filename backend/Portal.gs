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
 * Official Exams (2.6) — the exam app (third-year-med/pathology-exams) on the same backend:
 *   portalExamList {g?} PUBLIC: the exam front page — titles, times, duration, number of questions and state of the
 *                     published exams of a group (or of every module's main storage). Never codes, candidates or questions.
 *   examPlaces        where the signed-in Admin / personal teacher may manage exams (module storages, group deliveries,
 *                     the group's combined-exam storage exams-<linkCode>) + the exam app address
 *   examOpen {storage} a teacher session of that storage for the exam app (no module password) + the content keys of
 *                     the modules this user may copy course questions from
 *   (exam storage, exam-app token; Admin = any token without a personal-teacher grant)
 *   examCopySources   the teaching banks and exam banks this examiner may copy from/to (teacher: own groups only)
 *   examCourseExtras {from}  a teaching bank as its students see it: imported questions + Revision exclusions
 *   examCopyFrom {from}      the questions of another exam bank (copies are independent)
 *   examTeachWrite {to, add, hide, unhide, remove}  exam → teaching bank (versioned ON: Admin → master draft,
 *                     teacher → the group's local layer; OFF → the storage itself) + Revision hide/show + removals
 *   examModuleScores {examId}  per student and module: marks / max / % (each question counts in source.course)
 *   examCopyExam {examId, to, publish?}  copy an exam + its questions to another place (e.g. a group); questions
 *                     already copied there are reused; draft unless publish (same times and code) is asked for
 *   Combined-exam teaching lock: a published exam in exams-<code> with lockTeaching closes every teaching module
 *                     <module>-<code> of that group for its candidates (sign-in, group page and every request)
 *
 * Teaching Sessions (2.7) — the lectures of a group (Admin: any group; personal teacher: the deliveries assigned to them):
 *   tsGroups          the groups and teaching modules the caller may run sessions for + settings (time zone, threshold %)
 *   tsList {groupId}  the group's sessions (scheduled / live / ended / cancelled) with present · late · excused · absent,
 *                     and each student's attendance % over the ended sessions (excused ones do not count)
 *   tsSave {session}  schedule a lecture or correct it: title, module, date/time, duration, late after N min, rotating code,
 *                     lecture-materials link, teacher
 *   tsStart {tsId | session}  opens attendance = a normal Code.gs attendance session of that delivery's storage
 *   tsState {tsId}    live screen: current code (a rotating code is renewed every 45 s), check-ins, not yet checked in
 *   tsClose / tsCancel {undo?} / tsDelete (scheduled or cancelled only)
 *   tsMark {tsId, studentId, mark: present|late|excused|clear|remove, recordId?}   the teacher's corrections
 *   tsSettings        Admin: platform time zone and attendance warning threshold
 *   Sheet TeachingSessions (created on first use). Attendance itself stays in AttendanceSessions/AttendanceRecords.
 *   Group Live Classroom (2.9): storage live-<link code>, Code.gs's Live Classroom engine unchanged.
 *   liveOpen {g, sessions}        student (group sessions + active membership) → joined; secret-derived identity
 *   liveTeacherOpen {groupId}     Admin / personal teacher with a module of the group → teacher session of the classroom
 *   (live-… storage)              only Live Classroom actions; students must send their group sessions (gs) each time
 *   Group page (2.8, PUBLIC actions — the student proves who they are with a session of one of the group's modules):
 *   portalGroupSessions {g, sessions}  the live lecture, upcoming lectures, the student's own attendance (never others')
 *   portalGroupCheckIn {g, sessions, code}  check-in with the code on the screen (a rotating code just replaced still
 *                     works for 20 s); 10 wrong codes → 10 minutes' wait
 *
 * Self-check: platformCheck()  run it in the Apps Script editor (▶) before every Deploy — reports a missing Portal line in
 *                     route_, missing speed lines, missing/invalid content keys, unknown module keys; never prints a key
 *
 * Speed (2.5):
 *   (module) getAllContent  answered at once ("nothing new") when the storage and its master copy did not change
 *                     since the browser's last check (markers in CacheService; anything uncertain → the normal path)
 *   every request is logged with its module and action (Apps Script → Executions → click a row → Logs)
 *   portalTidyReport / portalTidy  Admin: counts / removes history tombstones, archives older history snapshots
 *                     (sheet ContentArchive) and deletes expired sessions — nothing educational is deleted
 *   portalWarm()      for a time-driven trigger (keeps the script warm during teaching hours)
 *
 * Group local changes (2.4): contentLocalItem — READ-ONLY preview of one group's local item (+ the master's version).
 *
 * Packaged releases (2.3 — a rebuilt module goes live without losing edits; see docs/REBUILD.md):
 *   (module) studentSession {preview:1}  the preview file (…/preview/) asks for its key: given ONLY to the Admin's
 *                     master-draft session (derived from the module's content key; students never receive it)
 *   (module) contentBuildManifest  the module page, in a master-draft session, reports the IDs of its packaged course
 *   contentRebuildCheck   compatibility of every master-draft item and every group's local item with the new build
 *   contentRebuildDecide  keep / remove (/ clean a list) for each item that needs a decision
 *   contentGoLive         after the new file is live on GitHub: applies the decisions and publishes a new version
 *                         recorded with the new build
 *
 * Results & attendance overviews (2.2, Step 10 — read-only):
 *   reportOverview    Admin (token) → every delivery; personal teacher (ttoken) → only the deliveries assigned to them.
 *                     Per group + module: students, sign-ins, practice quizzes, assessments, exams, attendance.
 *   reportDelivery    {deliveryId} → per student (matched to the group's roster) + attendance sessions; same access rule.
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
 * Closed back doors (1.7, Step 5): for every module other than "portal", the old module teacher sign-in ("login") and
 *   first-time teacher setup ("setup") are refused here, before Code.gs sees them — teachers use Teacher Sign-In (their
 *   assignments), the Admin opens any module from the dashboard. Emergency switch: script property ALLOW_MODULE_LOGIN=true
 *   restores the old behaviour. portalEndModuleSessions (Admin) ends every module teacher session issued earlier.
 *
 * Content versioning foundation (1.8, Step 6 — nothing is switched on, nothing changes for anyone):
 *   contentStatus     Admin   per module: versioned content on/off (off), published version (none yet), the storages
 *                             holding content rows and how many
 *   contentReport     Admin   READ-ONLY migration report for one module: which rows would become master content, which
 *                             stay with each group, and how each group's copy differs from the main one
 *   Sheet ContentVersions (created, empty until publishing exists).
 * Content migration (1.9, Step 7 — per module, Admin):
 *   contentMigrate    copies the main copy's educational rows (+ chosen group versions) into the master v1.0
 *                     ("<module>@v1", immutable) and a draft ("<module>@draft"); group items marked "keep for this group"
 *                     go to that group's local layer ("<storage>@local"). ONLY COPIES — original rows are never changed.
 *   contentUndoMigration   removes what contentMigrate created (only while switched off, before any other version)
 *   contentSetMode    on / off. ON: modules of this subject receive master (published version) + their group's local layer
 *                     + their own assessments/exams; teacher edits inside a module go to that group's local layer.
 *                     OFF: everything exactly as before (instant switch-back). Each switch sends browsers a complete refresh.
 *   Storage names containing "@" are internal: any request using one is refused.
 * Draft → Preview → Publish (2.0, Step 8 — Admin):
 *   contentEditDraft  a teacher session of the module's main storage that EDITS AND SHOWS the master draft
 *                     ("<module>@draft"); every other session keeps the published version
 *   contentDraft      what changed in the draft compared with the published version
 *   contentPublish    the draft becomes a new immutable version ("<module>@vN"), checked after writing, then made current
 *   contentDiscardDraft    the draft goes back to the published version
 *   contentRestore    publishes a copy of an older version as a new version (history is never rewritten)
 *   contentFreeze     blocks / allows publishing
 * Group local changes (2.1, Step 9 — Admin):
 *   contentLocal      every group's local layer of a module, item by item: local addition / hidden for this group /
 *                     changes a master item (masks future master updates of that item) / same as master
 *   contentLocalRemove     removes one local item → that group gets the master version again
 *   contentLocalPromote    copies one local item into the master DRAFT (published later like any draft change)
 *   contentDraft also lists which groups changed or hid items that the draft changes or removes.
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
var PORTAL_VERSION = '2.9';
var PORTAL_GROUP_RE = /^[A-Za-z0-9_-]{1,24}$/;   // the same rule the modules use for ?g=
var PORTAL_STATUSES = { available: 1, ready: 1, soon: 1 };
var PORTAL_HANDOFF = { neo: 1, vp: 1, link: 1 };
var PORTAL_MAX_FAILS = 10, PORTAL_FAIL_WINDOW_S = 900;   // per Student ID: 10 failed front-page sign-ins → wait 15 min
var PORTAL_SETTING = 'portal:registry';

/** The list shown on a fresh install — the teacher changes everything in the front page's teacher panel. */
var PORTAL_DEFAULT = [
  { id: 'intropath', title: 'Introduction to Pathology', subtitle: 'General pathology', icon: '🔬', color: '#1d4ed8', status: 'available',
    url: 'https://third-year-med.github.io/introduction-to-pathology/', moduleKey: 'intropath', handoff: 'neo', storagePrefix: 'ip_', backend: '' },
  { id: 'cellinjury', title: 'Cell Injury & Cell Death', subtitle: 'General pathology', icon: '🧫', color: '#0e7c7b', status: 'available',
    url: 'https://third-year-med.github.io/cell-injury-teaching-platform/', moduleKey: 'cellinjury', handoff: 'neo', storagePrefix: 'ci_', backend: '' },
  { id: 'inflhealing', title: 'Inflammation & Healing', subtitle: 'General pathology', icon: '🔥', color: '#c2410c', status: 'available',
    url: 'https://third-year-med.github.io/inflammation-healing/', moduleKey: 'inflhealing', handoff: 'neo', storagePrefix: 'ih_', backend: '' }
];

/* ---------------------------------------------------------------------- *
 * Hook called by Code.gs route_ (one added line). Returns a response for module "portal", otherwise null.
 * ---------------------------------------------------------------------- */
function portalHook_(module, p) {
  perfLog_(module, p);
  if (String(module) !== PORTAL_MODULE) {
    var act = String(p.action || '');
    if (String(module).indexOf('@') >= 0) return { ok: false, code: 'badmodule', error: 'Unknown module.' };   // internal storages
    if (liveIsStorage_(String(module))) return liveGate_(String(module), act, p);   // 2.9: a group's Live Classroom — only its own actions, students re-checked
    if (act === 'examUpsert' || act === 'examRemove' || act === 'examCopyExam') { examListForget_(String(module)); if (p.to) examListForget_(String(p.to)); }   // the exam front page shows changes at once
    if (EXAM_BANK_ACTIONS[act]) return examBankHook_(String(module), p);   // 2.6: copy questions between exam banks and teaching banks
    var gl = examGroupLockHook_(String(module), act, p); if (gl) return gl;   // 2.6: a combined exam of the group closes all its modules for candidates
    // 2.5 speed: the frequent "anything new?" check is answered from memory when nothing changed for this storage
    if (act === 'getAllContent') { var fast = cvFastUnchanged_(String(module), p); if (fast) return fast; }
    else if (!CV_NO_CONTENT_WRITE[act]) cvMarkWrite_(String(module));
    if ((act === 'logout' || act === 'changePassword') && p.token) CacheService.getScriptCache().remove('tok:' + module + ':' + p.token);
    if (act === 'studentSession' && p.preview) return cvPreviewSession_(String(module), p);   // the preview file of a new build
    if (act === 'contentBuildManifest') return cvBuildManifest_(String(module), p);
    var cv = contentHook_(String(module), act, p); if (cv) return cv;   // versioned content (only for modules switched on/changed)
    // Step 5: no module-level teacher password any more (teachers → Teacher Sign-In; Admin → dashboard)
    if ((act === 'login' || act === 'setup') && !portalModuleLoginAllowed_()) return PORTAL_MODULE_LOGIN_CLOSED;
    // a student changing the password inside a module of a group: apply it to all of the group's modules
    if (act === 'studentChangePassword') return rosterModulePassword_(String(module), p);
    return null;
  }
  var a = String(p.action || '');
  if (TS_ACTIONS[a]) return tsRoute_(p);   // 2.7: Teaching Sessions (Admin: token; personal teacher: ttoken)
  switch (a) {
    case 'logout': case 'changePassword': if (p.token) CacheService.getScriptCache().remove('tok:' + PORTAL_MODULE + ':' + p.token); return null;
    case 'ping': case 'setup': case 'login': return null;   // Code.gs teacher sign-in for the portal
    case 'portalInfo': return portalInfo_();
    case 'portalCheck': return portalCheck_(p);
    case 'portalGroupInfo': return portalGroupInfo_(p);
    case 'portalExamList': return portalExamList_(p);
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
    case 'portalGroupSessions': return tsStudentSessions_(p);   // 2.8: the group page's 🎓 Teaching Sessions card
    case 'portalGroupCheckIn': return tsStudentCheckIn_(p);
    case 'liveOpen': return liveOpen_(p);   // 2.9: the group's Live Classroom (student)
    case 'liveTeacherOpen':
      if (p.ttoken) return tAuthed_(p, function (u, ses) { return isTrue_(u.mustChange) ? { ok: false, code: 'mustchange', error: 'Please choose your own password first.' } : liveTeacherOpen_(p, null, u, ses); });
      return authed_(PORTAL_MODULE, p, function (tok) { if (!dirReadable_()) return dirErr_('The platform directory is empty.'); return liveTeacherOpen_(p, tok, null, null); });
    case 'teacherLogin': return teacherLogin_(p);
    case 'contentStatus': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentStatus_(); }); });
    case 'contentMigrate': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentMigrate_(p); }); });
    case 'contentUndoMigration': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentUndoMigration_(p); }); });
    case 'contentSetMode': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentSetMode_(p); }); });
    case 'contentEditDraft': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentEditDraft_(p); }); });
    case 'contentDraft': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentDraft_(p); }); });
    case 'contentPublish': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentPublish_(p); }); });
    case 'contentDiscardDraft': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentDiscardDraft_(p); }); });
    case 'contentRestore': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentRestore_(p); }); });
    case 'contentFreeze': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentFreeze_(p); }); });
    case 'contentLocal': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentLocal_(p); }); });
    case 'contentLocalItem': return authed_(PORTAL_MODULE, p, function () { return contentLocalItem_(p); });
    case 'contentLocalRemove': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentLocalRemove_(p); }); });
    case 'contentLocalPromote': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentLocalPromote_(p); }); });
    case 'portalTidyReport': return authed_(PORTAL_MODULE, p, function () { return portalTidy_(false); });
    case 'portalTidy': return authed_(PORTAL_MODULE, p, function () { return portalTidy_(true); });
    case 'contentRebuildCheck': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentRebuildCheck_(p); }); });
    case 'contentRebuildDecide': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentRebuildDecide_(p); }); });
    case 'contentGoLive': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentGoLive_(p); }); });
    case 'contentReport': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return contentReport_(p); }); });
    case 'portalEndModuleSessions': return authed_(PORTAL_MODULE, p, function () { return rosterWrite_(function () { return portalEndModuleSessions_(); }); });
    case 'teacherMe': return tAuthed_(p, function (u) { return teacherMe_(u); });
    case 'examPlaces': case 'examOpen':   // Official Exams (2.6): Admin → every place; personal teacher → only assigned deliveries
      if (p.ttoken) return tAuthed_(p, function (u, ses) {
        if (isTrue_(u.mustChange)) return { ok: false, code: 'mustchange', error: 'Please choose your own password first.' };
        return p.action === 'examPlaces' ? examPlaces_(u) : examOpenTeacher_(u, ses, p);
      });
      return authed_(PORTAL_MODULE, p, function (tok) { if (!dirReadable_()) dirInit_(); return p.action === 'examPlaces' ? examPlaces_(null) : examOpenAdmin_(p, tok); });
    case 'reportOverview': case 'reportDelivery':
      // Step 10 (read-only): a personal teacher sees only the deliveries assigned to them; the Admin sees every delivery
      if (p.ttoken) return tAuthed_(p, function (u) {
        if (isTrue_(u.mustChange)) return { ok: false, code: 'mustchange', error: 'Please choose your own password first.' };
        var mine = teacherDeliveries_(u.userId).map(function (x) { return x.deliveryId; });
        return p.action === 'reportOverview' ? reportOverview_(mine) : mine.indexOf(String(p.deliveryId || '')) < 0 ? { ok: false, code: 'forbidden', error: 'This group and module are not assigned to you.' } : reportDelivery_(p);
      });
      return authed_(PORTAL_MODULE, p, function () { if (!dirReadable_()) return dirErr_('The platform directory is empty.'); return p.action === 'reportOverview' ? reportOverview_(null) : reportDelivery_(p); });
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
      var xl = examLockFor_(mod, s.username);
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
  USERS: 'PortalUsers', PSES: 'PortalSessions', GRANTS: 'PortalGrants', CVER: 'ContentVersions', TSES: 'TeachingSessions'
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
  PortalGrants: ['userId', 'deliveryId', 'backendModule', 'tokenHash', 'sessionHash', 'createdAt', 'expiresAt'],
  ContentVersions: ['moduleId', 'version', 'label', 'build', 'publishedAt', 'publishedBy', 'notes', 'fingerprint', 'itemCount', 'status'],
  TeachingSessions: ['tsId', 'groupId', 'deliveryId', 'moduleId', 'backendModule', 'title', 'chapter', 'academicYear', 'startAt', 'durationMin', 'lateAfterMin', 'rotate',
    'materialsUrl', 'teacher', 'status', 'attSessionId', 'startedAt', 'endedAt', 'marksJson', 'codeAt', 'createdBy', 'createdAt', 'updatedAt',
    'prevCode', 'prevCodeUntil']
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
  PortalGrants: ['userId', 'deliveryId', 'backendModule', 'tokenHash', 'sessionHash'],
  ContentVersions: ['moduleId', 'label', 'build', 'publishedBy', 'notes', 'fingerprint', 'status'],
  TeachingSessions: ['tsId', 'groupId', 'deliveryId', 'moduleId', 'backendModule', 'title', 'chapter', 'academicYear', 'materialsUrl', 'teacher', 'status', 'attSessionId', 'marksJson', 'createdBy', 'prevCode']
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
    if (id === LIVE_MODULE || id === PORTAL_MODULE) return 'The module id “' + id + '” is reserved by the platform — choose another one.';
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
  var targets = G.modules.filter(function (m) { return m.status === 'available' && m.moduleKey !== EXAM_MODULE; }).map(function (m) { return { key: m.moduleKey, module: m._storage }; });   // exams: own sign-in with the access code
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
  return dirAll_(DIR.DELIV).filter(function (d) { return d.groupId === groupId && (studentAuthOn_(d.backendModule) || d.moduleId === EXAM_MODULE); })   // Official Exams: exam accounts too
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
    G.modules.filter(function (m) { return m.status === 'available' && !have[m.moduleKey] && m.moduleKey !== EXAM_MODULE; }).forEach(function (m) {
      var s = findStudent_(m._storage, st.username);
      if (!s) { out[m.moduleKey] = { access: false, reason: 'notregistered' }; return; }
      if (!isTrue_(s.active)) { out[m.moduleKey] = { access: false, reason: 'inactive' }; return; }
      if (Number(s.lockedUntil) > now) { out[m.moduleKey] = { access: false, reason: 'locked' }; return; }
      var xl = examLockFor_(m._storage, s.username);
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

/* ======================================================================
 * Step 5: closed back doors.
 * ====================================================================== */
var PORTAL_MODULE_LOGIN_CLOSED = { ok: false, code: 'disabled', error: 'Teacher sign-in on a module is closed. Teachers sign in on the Platform Home → Teacher Sign-In.' };
function portalModuleLoginAllowed_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('ALLOW_MODULE_LOGIN') || '').toLowerCase() === 'true'; } catch (e) { return false; }
}
/** Ends every module teacher session (Sessions rows of any module but "portal"), including cached checks and grants. */
function portalEndModuleSessions_() {
  var rows = readAll_(SHEETS.SESSIONS), c = CacheService.getScriptCache(), n = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r.module || '') === PORTAL_MODULE) continue;
    c.remove('tok:' + r.module + ':' + r.token); deleteRow_(SHEETS.SESSIONS, r._row); n++;
  }
  if (tSheetsReady_()) dirAll_(DIR.GRANTS).map(function (g) { return g._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.GRANTS, row); });
  return { ok: true, ended: n };
}

/* ======================================================================
 * Step 6: content versioning foundation (read-only; nothing is switched on).
 * ====================================================================== */
/** Educational content (one master copy per module, later versioned) vs. group activity (stays with each delivery). */
var CONTENT_MASTER = { customtopics: 1, topicsections: 1, hiddentopics: 1, courseorder: 1, custommedia: 1, practical: 1, presentationdeck: 1,
  importedquestions: 1, quizextra: 1, revexclude: 1, importbatches: 1, practicalpub: 1, practicalcfg: 1, contentedits: 1, history: 1, 'priv:pracdrafts': 1 };
var CONTENT_GROUP = { assessments: 1, assessmentversions: 1, assessmeta: 1, 'priv:exams': 1, 'priv:exambank': 1 };
function contentKind_(coll) { coll = String(coll || ''); return CONTENT_MASTER[coll] ? 'master' : CONTENT_GROUP[coll] ? 'group' : 'other'; }
function contentMode_(moduleId) { return getSetting_('content:mode:' + moduleId) === 'on' ? 'on' : 'off'; }
function contentRowsByStorage_() {
  var by = {};
  readAll_(SHEETS.CONTENT).forEach(function (r) { var m = String(r.module || ''); if (m) (by[m] = by[m] || []).push(r); });
  return by;
}
function contentStoragesOf_(moduleId, by) {
  return Object.keys(by).filter(function (m) { return m.indexOf('@') < 0 && (m === moduleId || m.indexOf(moduleId + '-') === 0); }).sort(function (a, b) { return a === moduleId ? -1 : b === moduleId ? 1 : a.localeCompare(b); });
}
function contentStatus_() {
  var by = contentRowsByStorage_(), versions = dirAll_(DIR.CVER), bm = {};
  dirAll_(DIR.DELIV).forEach(function (d) { bm[d.backendModule] = d.deliveryId; });
  return { ok: true, modules: dirAll_(DIR.MOD).filter(function (m) { return m.moduleId !== EXAM_MODULE; }).map(function (m) {
    var st = contentStoragesOf_(m.moduleId, by).map(function (k) {
      var rows = by[k].filter(function (r) { return !isTrue_(r.deleted); }), c = { master: 0, group: 0, other: 0 };
      rows.forEach(function (r) { c[contentKind_(r.collection)]++; });
      return { storage: k, registered: !!bm[k] || k === m.moduleId, master: c.master, group: c.group, other: c.other };
    });
    var vlist = versions.filter(function (v) { return v.moduleId === m.moduleId; }).sort(function (a, b) { return Number(b.version) - Number(a.version); })
      .map(function (v) { return { version: Number(v.version), label: v.label, build: v.build || '', publishedAt: Number(v.publishedAt) || 0, publishedBy: v.publishedBy, notes: v.notes, itemCount: Number(v.itemCount) || 0, fingerprint: v.fingerprint }; });
    var migrated = !!getSetting_('content:pub:' + m.moduleId);
    return { moduleId: m.moduleId, title: m.title, mode: contentMode_(m.moduleId), publishedVersion: m.publishedVersion || '', migrated: migrated,
      currentVersion: Number(getSetting_('content:pub:' + m.moduleId) || 0), versionList: vlist, frozen: getSetting_('content:freeze:' + m.moduleId) === '1',
      draftChanges: migrated ? cvDiff_(m.moduleId).count : 0,
      versions: versions.filter(function (v) { return v.moduleId === m.moduleId; }).length, storages: st,
      builds: { live: cvBuildInfo_(cvBuild_(m.moduleId, 'live')), preview: cvBuildInfo_(cvBuild_(m.moduleId, 'preview')) } };
  }) };
}
/** Read-only migration report for one module. The main storage (plain module name, what the normal link shows) is the
 *  proposed starting master; each group storage's master-type rows are compared with it item by item. */
function contentReport_(p) {
  var moduleId = String(p.moduleId || ''); if (!dirFind_(DIR.MOD, 'moduleId', moduleId)) return dirErr_('Choose a module.');
  var by = contentRowsByStorage_(), storages = contentStoragesOf_(moduleId, by), json = function (r) { var s = ''; for (var i = 1; i <= CONTENT_JSON_COLS; i++) s += (r['json' + i] || ''); return s; };
  var live = function (rows) { return (rows || []).filter(function (r) { return !isTrue_(r.deleted); }); };
  var base = {}; live(by[moduleId]).forEach(function (r) { if (contentKind_(r.collection) === 'master') base[r.collection + '|' + r.id] = r; });
  var summary = { masterItems: Object.keys(base).length, groupStorages: 0, identical: 0, onlyInGroup: 0, conflicts: 0, groupActivity: 0, other: 0 }, details = [], perStorage = [];
  var countBase = { master: 0, group: 0, other: 0 }; live(by[moduleId]).forEach(function (r) { countBase[contentKind_(r.collection)]++; });
  summary.groupActivity += countBase.group; summary.other += countBase.other;
  perStorage.push({ storage: moduleId, role: 'main', master: countBase.master, group: countBase.group, other: countBase.other, identical: 0, onlyInGroup: 0, conflicts: 0 });
  storages.filter(function (k) { return k !== moduleId; }).forEach(function (k) {
    summary.groupStorages++;
    var ps = { storage: k, role: 'group', master: 0, group: 0, other: 0, identical: 0, onlyInGroup: 0, conflicts: 0 };
    live(by[k]).forEach(function (r) {
      var kind = contentKind_(r.collection); ps[kind]++;
      if (kind === 'group') { summary.groupActivity++; return; }
      if (kind === 'other') { summary.other++; details.push({ storage: k, collection: r.collection, id: String(r.id), status: 'unknown collection', updatedAt: Number(r.updatedAt) || 0 }); return; }
      var b = base[r.collection + '|' + r.id];
      if (!b) { ps.onlyInGroup++; summary.onlyInGroup++; details.push({ storage: k, collection: r.collection, id: String(r.id), status: 'only in this group', updatedAt: Number(r.updatedAt) || 0 }); }
      else if (json(b) === json(r)) { ps.identical++; summary.identical++; }
      else { ps.conflicts++; summary.conflicts++; details.push({ storage: k, collection: r.collection, id: String(r.id), status: 'different from the main copy', updatedAt: Number(r.updatedAt) || 0, mainUpdatedAt: Number(b.updatedAt) || 0 }); }
    });
    perStorage.push(ps);
  });
  return { ok: true, moduleId: moduleId, mode: contentMode_(moduleId), summary: summary, storages: perStorage, details: details.slice(0, 500), truncated: details.length > 500 };
}

/* ======================================================================
 * Step 7: migration into a master copy, switch on / off per module.
 * ====================================================================== */
/** Educational rows that are versioned (history and private drafts stay where they are). */
function cvKey_(coll) { return contentKind_(coll) === 'master' && coll !== 'history' && String(coll).indexOf('priv:') !== 0; }
function cvJson_(r) { var s = ''; for (var i = 1; i <= CONTENT_JSON_COLS; i++) s += (r['json' + i] || ''); return s; }
function cvCopy_(r, module, now) {
  var o = { module: module, collection: r.collection, id: String(r.id), updatedAt: now, updatedBy: 'migration', deleted: false };
  for (var i = 1; i <= CONTENT_JSON_COLS; i++) o['json' + i] = r['json' + i] || '';
  return o;
}
function cvTouch_(moduleId) { setSetting_('content:changed:' + moduleId, String(Date.now())); cvForget_(moduleId); }
/** {mode, changed, pub} of a module — one read of Settings, cached 60 s (cleared at every change). */
function cvState_(M) {
  var c = CacheService.getScriptCache(), k = 'cvstate:' + M, hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var o = { mode: '', changed: 0, pub: '' };
  readAll_(SHEETS.SETTINGS).forEach(function (r) {
    if (r.key === 'content:mode:' + M) o.mode = String(r.value || '');
    else if (r.key === 'content:changed:' + M) o.changed = Number(r.value || 0);
    else if (r.key === 'content:pub:' + M) o.pub = String(r.value || '');
  });
  c.put(k, JSON.stringify(o), 60);
  return o;
}
function cvForget_(M) { CacheService.getScriptCache().remove('cvstate:' + M); }
function cvBaseOf_(module) { var i = module.indexOf('-'); return i < 0 ? module : module.slice(0, i); }

function contentMigrate_(p) {
  var M = String(p.moduleId || ''), mod = dirFind_(DIR.MOD, 'moduleId', M); if (!mod) return dirErr_('Choose a module.');
  if (contentMode_(M) === 'on') return dirErr_('Switch versioned content off first.');
  if (getSetting_('content:pub:' + M) || dirAll_(DIR.CVER).some(function (v) { return v.moduleId === M; })) return dirErr_('A master copy already exists for this module (use “Undo migration” first to redo it).');
  var dec = p.decisions && typeof p.decisions === 'object' ? p.decisions : {}, rows = readAll_(SHEETS.CONTENT), now = Date.now();
  var live = function (r) { return !isTrue_(r.deleted) && cvKey_(r.collection); };
  var v1 = {}; rows.forEach(function (r) { if (r.module === M && live(r)) v1[r.collection + '|' + r.id] = r; });
  var fromGroup = {}, locals = [], counts = { main: 0, group: 0, local: 0 };
  rows.forEach(function (r) {
    var S = String(r.module || ''); if (S.indexOf(M + '-') !== 0 || S.indexOf('@') >= 0 || !live(r)) return;
    var k = r.collection + '|' + r.id, b = v1[k];
    if (b && !fromGroup[k] && cvJson_(b) === cvJson_(r)) return;   // identical: nothing to do
    var choice = String(dec[S + '|' + k] || 'local');
    if (choice === 'group') {
      if (fromGroup[k] && cvJson_(fromGroup[k]) !== cvJson_(r)) throw new Error('Two different group versions were chosen for the same item (' + k + '). Choose only one.');
      fromGroup[k] = r; counts.group++;
    } else if (choice === 'main') counts.main++;
    else { locals.push({ storage: S, row: r }); counts.local++; }
  });
  Object.keys(fromGroup).forEach(function (k) { v1[k] = fromGroup[k]; });
  var keys = Object.keys(v1).sort();
  var fp = sha256Hex_(JSON.stringify(keys.map(function (k) { return [k, cvJson_(v1[k])]; })));
  keys.forEach(function (k) { appendRow_(SHEETS.CONTENT, cvCopy_(v1[k], M + '@v1', now)); appendRow_(SHEETS.CONTENT, cvCopy_(v1[k], M + '@draft', now)); });
  locals.forEach(function (x) { appendRow_(SHEETS.CONTENT, cvCopy_(x.row, x.storage + '@local', now)); });
  appendRow_(DIR.CVER, { moduleId: M, version: 1, label: '1.0', build: '', publishedAt: now, publishedBy: 'admin', notes: 'Starting master copy (migration)', fingerprint: fp, itemCount: keys.length, status: 'published' });
  var mr = dirPublic_(mod); mr.publishedVersion = '1.0'; mr.updatedAt = now; updateRow_(DIR.MOD, mod._row, mr);
  setSetting_('content:pub:' + M, '1'); cvForget_(M);
  return { ok: true, moduleId: M, version: '1.0', masterItems: keys.length, decided: counts, fingerprint: fp };
}
function contentUndoMigration_(p) {
  var M = String(p.moduleId || ''), mod = dirFind_(DIR.MOD, 'moduleId', M); if (!mod) return dirErr_('Choose a module.');
  if (contentMode_(M) === 'on') return dirErr_('Switch versioned content off first.');
  var vers = dirAll_(DIR.CVER).filter(function (v) { return v.moduleId === M; });
  if (vers.length > 1) return dirErr_('Other versions were published after the migration — it can no longer be undone this way.');
  var rows = readAll_(SHEETS.CONTENT), n = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    var m = String(rows[i].module || '');
    if (m === M + '@v1' || m === M + '@draft' || (m.indexOf(M + '-') === 0 && /@local$/.test(m))) { deleteRow_(SHEETS.CONTENT, rows[i]._row); n++; }
  }
  vers.map(function (v) { return v._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(DIR.CVER, row); });
  var mr = dirPublic_(mod); mr.publishedVersion = ''; mr.updatedAt = Date.now(); updateRow_(DIR.MOD, mod._row, mr);
  setSetting_('content:pub:' + M, ''); cvForget_(M);
  return { ok: true, removedRows: n };
}
function contentSetMode_(p) {
  var M = String(p.moduleId || ''); if (!dirFind_(DIR.MOD, 'moduleId', M)) return dirErr_('Choose a module.');
  var on = p.mode === 'on';
  if (on && !getSetting_('content:pub:' + M)) return dirErr_('Create the master copy first (migration).');
  setSetting_('content:mode:' + M, on ? 'on' : 'off');
  cvTouch_(M);   // every browser gets a complete refresh at its next sync
  return { ok: true, moduleId: M, mode: on ? 'on' : 'off' };
}

/** Intercepts content reads/writes of modules whose versioned content is on (or was just switched off). null = Code.gs as usual. */
function contentHook_(module, act, p) {
  if (act !== 'getAllContent' && act !== 'upsert' && act !== 'delete' && act !== 'importCourse') return null;
  var M = cvBaseOf_(module), st = cvState_(M), mode = st.mode, changed = st.changed;
  if (module === M && p.token && st.pub && cvIsDraftToken_(M, String(p.token))) return contentDraftHook_(M, act, p);   // master draft editing / preview
  if (!mode) return null;                                              // never switched on: untouched
  if (act === 'getAllContent') {
    var since = Number(p.since || 0);
    if (mode !== 'on' && !(since && since <= changed)) return null;      // off and already refreshed: Code.gs as before
    if (typeof studentAuthOn_ === 'function' && studentAuthOn_(module)) { var gate = gateRequest_(module, p); if (gate) return gate; }
    return contentResolve_(module, M, mode === 'on', since, changed);
  }
  if (mode !== 'on') return null;
  // writes while on: educational items of this storage go to its local layer (assessments etc. stay where they are)
  if (act === 'importCourse') return authed_(module, p, function () {
    (p.items || []).forEach(function (it) { actionUpsert_(cvKey_(it.collection) ? module + '@local' : module, { collection: it.collection, id: it.id, data: it.data }); });
    return { ok: true, count: (p.items || []).length };
  });
  if (!cvKey_(p.collection)) return null;
  return authed_(module, p, function () { return act === 'upsert' ? actionUpsert_(module + '@local', p) : actionDelete_(module + '@local', p); });
}
/** What a storage receives. Full refresh (with removals) after a switch or publish; otherwise only what changed. */
function contentResolve_(S, M, on, since, changed) {
  var rows = readAll_(SHEETS.CONTENT), now = Date.now(), full = !since || since <= changed, items = [], present = {};
  var visible = function (r) { return r.collection !== 'history' && String(r.collection).indexOf('priv:') !== 0; };
  var item = function (r) { return { collection: r.collection, id: r.id, data: isTrue_(r.deleted) ? null : unpackJson_(r), deleted: isTrue_(r.deleted) }; };
  var N = cvState_(M).pub || '1', V = M + '@v' + N, L = S + '@local';
  if (!full) {   // incremental: this storage's own non-educational rows + its local layer, changed since
    rows.forEach(function (r) {
      if (Number(r.updatedAt) <= since || !visible(r)) return;
      if ((on && r.module === L && cvKey_(r.collection)) || (r.module === S && (!on || !cvKey_(r.collection)))) items.push(item(r));
    });
    return { ok: true, items: items, serverTime: now };
  }
  var cur = {};
  if (on) {
    rows.forEach(function (r) { if (r.module === V && cvKey_(r.collection) && !isTrue_(r.deleted)) cur[r.collection + '|' + r.id] = r; });
    rows.forEach(function (r) { if (r.module === L && cvKey_(r.collection)) cur[r.collection + '|' + r.id] = r; });   // local layer wins (incl. hiding)
    rows.forEach(function (r) { if (r.module === S && visible(r) && !cvKey_(r.collection)) items.push(item(r)); });   // assessments etc.
  } else {
    rows.forEach(function (r) { if (r.module === S && visible(r)) { if (cvKey_(r.collection)) cur[r.collection + '|' + r.id] = r; else items.push(item(r)); } });
  }
  Object.keys(cur).forEach(function (k) { items.push(item(cur[k])); if (!isTrue_(cur[k].deleted)) present[k] = 1; });
  // removals: every educational item this browser may hold from another state (original rows, local layer, any version)
  var seen = {};
  rows.forEach(function (r) {
    var m = String(r.module || ''); if (!cvKey_(r.collection)) return;
    if (m !== S && m !== L && m.indexOf(M + '@v') !== 0) return;
    var k = r.collection + '|' + r.id; if (present[k] || seen[k] || (cur[k] && isTrue_(cur[k].deleted))) return;
    seen[k] = 1; items.push({ collection: r.collection, id: r.id, data: null, deleted: true });
  });
  return { ok: true, items: items, serverTime: now };
}

/* ======================================================================
 * Step 8: Draft → Preview → Publish, version history, restore, freeze.
 * ====================================================================== */
function cvLive_(rows, module) { var o = {}; rows.forEach(function (r) { if (r.module === module && cvKey_(r.collection) && !isTrue_(r.deleted)) o[r.collection + '|' + r.id] = r; }); return o; }
function cvFingerprint_(map) { var keys = Object.keys(map).sort(); return sha256Hex_(JSON.stringify(keys.map(function (k) { return [k, cvJson_(map[k])]; }))); }
/** Draft vs. published: added / changed / removed items (keys only). */
function cvDiff_(M, rows) {
  rows = rows || readAll_(SHEETS.CONTENT);
  var pub = cvLive_(rows, M + '@v' + (getSetting_('content:pub:' + M) || '1')), dr = cvLive_(rows, M + '@draft'), out = { added: [], changed: [], removed: [] };
  Object.keys(dr).forEach(function (k) { if (!pub[k]) out.added.push(k); else if (cvJson_(pub[k]) !== cvJson_(dr[k])) out.changed.push(k); });
  Object.keys(pub).forEach(function (k) { if (!dr[k]) out.removed.push(k); });
  out.count = out.added.length + out.changed.length + out.removed.length;
  return out;
}
/** A draft-editing session is a teacher session of the main storage whose token is registered as a draft grant. */
function cvIsDraftToken_(M, token) {
  var h = tHash_('pg', token), c = CacheService.getScriptCache(), k = 'cvdraft:' + h, hit = c.get(k);
  if (hit) return hit === M;
  if (!tSheetsReady_()) return false;
  var g = null; dirAll_(DIR.GRANTS).some(function (x) { if (x.tokenHash === h) { g = x; return true; } return false; });
  var res = g && g.deliveryId === 'draft:' + M && Number(g.expiresAt) > Date.now() ? M : '-';
  c.put(k, res, 600);
  return res === M;
}
function contentEditDraft_(p) {
  var M = String(p.moduleId || ''), mod = dirFind_(DIR.MOD, 'moduleId', M); if (!mod) return dirErr_('Choose a module.');
  if (!getSetting_('content:pub:' + M)) return dirErr_('Create the master copy first (migration).');
  var now = Date.now(), exp = now + SESSION_TTL_MS, token = Utilities.getUuid() + '-' + randomHex_(16);
  appendRow_(SHEETS.SESSIONS, { module: M, token: token, createdAt: now, expiresAt: exp });
  appendRow_(DIR.GRANTS, { userId: 'admin', deliveryId: 'draft:' + M, backendModule: M, tokenHash: tHash_('pg', token), sessionHash: '', createdAt: now, expiresAt: exp });
  return { ok: true, token: token, expiresAt: exp, moduleId: M, url: mod.url, storagePrefix: mod.storagePrefix };
}
/** Draft session: writes of educational items go to the draft; reads show the draft (+ the main storage's own assessments etc.). */
function contentDraftHook_(M, act, p) {
  var D = M + '@draft';
  if (act === 'getAllContent') {
    var gate = typeof studentAuthOn_ === 'function' && studentAuthOn_(M) ? gateRequest_(M, p) : null; if (gate) return gate;
    var rows = readAll_(SHEETS.CONTENT), items = [], present = {}, now = Date.now();
    var visible = function (r) { return r.collection !== 'history' && String(r.collection).indexOf('priv:') !== 0; };
    var item = function (r) { return { collection: r.collection, id: r.id, data: isTrue_(r.deleted) ? null : unpackJson_(r), deleted: isTrue_(r.deleted) }; };
    rows.forEach(function (r) {
      if (r.module === D && cvKey_(r.collection)) { items.push(item(r)); if (!isTrue_(r.deleted)) present[r.collection + '|' + r.id] = 1; }
      else if (r.module === M && visible(r) && !cvKey_(r.collection)) items.push(item(r));
    });
    var seen = {};
    rows.forEach(function (r) {   // remove anything else this browser may hold (published version, local layer, original rows)
      var m = String(r.module || ''); if (!cvKey_(r.collection) || (m !== M && m !== M + '@local' && m.indexOf(M + '@v') !== 0)) return;
      var k = r.collection + '|' + r.id; if (present[k] || seen[k]) return; seen[k] = 1; items.push({ collection: r.collection, id: r.id, data: null, deleted: true });
    });
    return { ok: true, items: items, serverTime: now, draft: true };
  }
  if (act === 'importCourse') return authed_(M, p, function () {
    (p.items || []).forEach(function (it) { actionUpsert_(cvKey_(it.collection) ? D : M, { collection: it.collection, id: it.id, data: it.data }); });
    return { ok: true, count: (p.items || []).length };
  });
  if (!cvKey_(p.collection)) return null;
  return authed_(M, p, function () { return act === 'upsert' ? actionUpsert_(D, p) : actionDelete_(D, p); });
}
function contentDraft_(p) {
  var M = String(p.moduleId || ''); if (!getSetting_('content:pub:' + M)) return dirErr_('No master copy yet.');
  var rows = readAll_(SHEETS.CONTENT), d = cvDiff_(M, rows), touched = {}, affected = [];
  d.changed.concat(d.removed).forEach(function (k) { touched[k] = 1; });
  rows.forEach(function (r) {
    var m = String(r.module || ''); if (!/@local$/.test(m) || cvBaseOf_(m.replace(/@local$/, '')) !== M || !cvKey_(r.collection)) return;
    var k = r.collection + '|' + r.id; if (touched[k]) affected.push({ storage: m.replace(/@local$/, ''), item: k, hidden: isTrue_(r.deleted) });
  });
  return { ok: true, moduleId: M, added: d.added, changed: d.changed, removed: d.removed, count: d.count, affectedGroups: affected };
}
/** Writes version N from a map of rows, verifies it, then makes it current. Nothing changes for anyone if verification fails. */
function cvPublishMap_(M, map, notes, label, build) {
  var mod = dirFind_(DIR.MOD, 'moduleId', M), now = Date.now();
  var N = 1 + dirAll_(DIR.CVER).filter(function (v) { return v.moduleId === M; }).reduce(function (mx, v) { return Math.max(mx, Number(v.version) || 0); }, 0);
  var V = M + '@v' + N, fp = cvFingerprint_(map), keys = Object.keys(map).sort();
  keys.forEach(function (k) { appendRow_(SHEETS.CONTENT, cvCopy_(map[k], V, now)); });
  var check = cvLive_(readAll_(SHEETS.CONTENT), V);   // verify before switching
  if (Object.keys(check).length !== keys.length || cvFingerprint_(check) !== fp) {
    var rows = readAll_(SHEETS.CONTENT); for (var i = rows.length - 1; i >= 0; i--) if (rows[i].module === V) deleteRow_(SHEETS.CONTENT, rows[i]._row);
    return dirErr_('Publishing could not be verified — nothing was changed. Please try again.');
  }
  label = String(label || '').trim().slice(0, 20) || ('1.' + (N - 1));
  appendRow_(DIR.CVER, { moduleId: M, version: N, label: label, build: String(build || cvBuildLabel_(M) || ''), publishedAt: now, publishedBy: 'admin', notes: String(notes || '').slice(0, 1000), fingerprint: fp, itemCount: keys.length, status: 'published' });
  setSetting_('content:pub:' + M, String(N));
  var mr = dirPublic_(mod); mr.publishedVersion = label; mr.updatedAt = now; updateRow_(DIR.MOD, mod._row, mr);
  cvTouch_(M);   // every browser gets the new version at its next sync
  return { ok: true, moduleId: M, version: N, label: label, itemCount: keys.length, fingerprint: fp };
}
function contentPublish_(p) {
  var M = String(p.moduleId || ''); if (!getSetting_('content:pub:' + M)) return dirErr_('No master copy yet.');
  if (getSetting_('content:freeze:' + M) === '1') return dirErr_('Publishing is frozen for this module. Unfreeze it first.');
  var rows = readAll_(SHEETS.CONTENT), d = cvDiff_(M, rows);
  if (!d.count) return dirErr_('The draft has no changes compared with the published version.');
  var notes = String(p.notes || '').trim() || (d.added.length + ' added, ' + d.changed.length + ' changed, ' + d.removed.length + ' removed');
  var r = cvPublishMap_(M, cvLive_(rows, M + '@draft'), notes, p.label);
  if (r.ok) { r.added = d.added.length; r.changed = d.changed.length; r.removed = d.removed.length; }
  return r;
}
function cvResetDraftTo_(M, V) {
  var rows = readAll_(SHEETS.CONTENT), now = Date.now();
  for (var i = rows.length - 1; i >= 0; i--) if (rows[i].module === M + '@draft') deleteRow_(SHEETS.CONTENT, rows[i]._row);
  var src = cvLive_(readAll_(SHEETS.CONTENT), V);
  Object.keys(src).sort().forEach(function (k) { appendRow_(SHEETS.CONTENT, cvCopy_(src[k], M + '@draft', now)); });
}
function contentDiscardDraft_(p) {
  var M = String(p.moduleId || ''), N = getSetting_('content:pub:' + M); if (!N) return dirErr_('No master copy yet.');
  cvResetDraftTo_(M, M + '@v' + N);
  return { ok: true };
}
function contentRestore_(p) {
  var M = String(p.moduleId || ''), K = Number(p.version || 0); if (!getSetting_('content:pub:' + M)) return dirErr_('No master copy yet.');
  if (getSetting_('content:freeze:' + M) === '1') return dirErr_('Publishing is frozen for this module. Unfreeze it first.');
  var ver = dirAll_(DIR.CVER).filter(function (v) { return v.moduleId === M && Number(v.version) === K; })[0]; if (!ver) return dirErr_('That version does not exist.');
  var map = cvLive_(readAll_(SHEETS.CONTENT), M + '@v' + K);
  if (cvFingerprint_(map) !== ver.fingerprint) return dirErr_('Version ' + ver.label + ' does not match its fingerprint — it cannot be restored safely.');
  var r = cvPublishMap_(M, map, 'Restored from version ' + ver.label + (p.notes ? ' — ' + String(p.notes) : ''), '');
  if (r.ok) cvResetDraftTo_(M, M + '@v' + r.version);
  return r;
}
function contentFreeze_(p) {
  var M = String(p.moduleId || ''); if (!dirFind_(DIR.MOD, 'moduleId', M)) return dirErr_('Choose a module.');
  setSetting_('content:freeze:' + M, p.frozen ? '1' : '');
  return { ok: true, frozen: !!p.frozen };
}

/* ======================================================================
 * Step 9: group local changes — see them, remove them, promote them to the master draft.
 * ====================================================================== */
function cvLocalKind_(r, pub) {
  var k = r.collection + '|' + r.id, m = pub[k];
  if (isTrue_(r.deleted)) return m ? 'hidden' : 'removed-addition';
  if (r.collection === 'hiddentopics') { var d = unpackJson_(r); return d && d.hidden ? 'hidden' : 'same'; }
  if (!m) return 'addition';
  return cvJson_(m) === cvJson_(r) ? 'same' : 'override';
}
function contentLocal_(p) {
  var M = String(p.moduleId || ''), N = getSetting_('content:pub:' + M); if (!N) return dirErr_('No master copy yet.');
  var rows = readAll_(SHEETS.CONTENT), pub = cvLive_(rows, M + '@v' + N), bm = {}, groups = [];
  dirAll_(DIR.DELIV).forEach(function (d) { bm[d.backendModule] = d; });
  var gname = {}; dirAll_(DIR.GROUP).forEach(function (g) { gname[g.groupId] = g; });
  var inst = {}; dirAll_(DIR.INST).forEach(function (i) { inst[i.institutionId] = i; });
  var by = {};
  rows.forEach(function (r) {
    var m = String(r.module || ''); if (!/@local$/.test(m) || !cvKey_(r.collection)) return;
    var S = m.replace(/@local$/, ''); if (cvBaseOf_(S) !== M) return;
    var kind = cvLocalKind_(r, pub); if (kind === 'removed-addition') return;
    (by[S] = by[S] || []).push({ collection: r.collection, id: String(r.id), kind: kind, updatedAt: Number(r.updatedAt) || 0 });
  });
  Object.keys(by).sort().forEach(function (S) {
    var d = bm[S], g = d && gname[d.groupId], i = g && inst[g.institutionId];
    var label = S === M ? 'Main / normal link' : g ? (i ? (i.shortName || i.name) + ' · ' : '') + g.name + (g.academicYear ? ' (' + g.academicYear + ')' : '') : S;
    var items = by[S].sort(function (a, b) { return a.kind.localeCompare(b.kind) || (a.collection + a.id).localeCompare(b.collection + b.id); });
    var c = { addition: 0, hidden: 0, override: 0, same: 0 }; items.forEach(function (x) { c[x.kind]++; });
    groups.push({ storage: S, label: label, counts: c, items: items });
  });
  return { ok: true, moduleId: M, publishedVersion: N, groups: groups };
}
function cvLocalRow_(S, coll, id) {
  var rows = readAll_(SHEETS.CONTENT), L = S + '@local';
  for (var i = 0; i < rows.length; i++) if (rows[i].module === L && rows[i].collection === coll && String(rows[i].id) === String(id)) return rows[i];
  return null;
}
/** READ-ONLY (2.4): one local item of a group as it is now, and the published master's version of the same item. */
function contentLocalItem_(p) {
  var S = String(p.storage || ''), M = cvBaseOf_(S), coll = String(p.collection || ''), id = String(p.id || '');
  if (S.indexOf('@') >= 0 || !getSetting_('content:pub:' + M)) return dirErr_('Unknown storage.');
  if (!cvKey_(coll)) return dirErr_('Not an educational item.');
  var r = cvLocalRow_(S, coll, id); if (!r) return dirErr_('This local item no longer exists.');
  var V = M + '@v' + getSetting_('content:pub:' + M), mr = findContentRow_(V, coll, id);
  return { ok: true, storage: S, collection: coll, id: id, deleted: isTrue_(r.deleted), updatedAt: Number(r.updatedAt) || 0, updatedBy: String(r.updatedBy || ''),
    data: isTrue_(r.deleted) ? null : unpackJson_(r), master: mr && !isTrue_(mr.deleted) ? unpackJson_(mr) : null };
}
function contentLocalRemove_(p) {
  var S = String(p.storage || ''), M = cvBaseOf_(S); if (S.indexOf('@') >= 0 || !getSetting_('content:pub:' + M)) return dirErr_('Unknown storage.');
  var r = cvLocalRow_(S, String(p.collection || ''), String(p.id || '')); if (!r) return dirErr_('This local item no longer exists — reload.');
  deleteRow_(SHEETS.CONTENT, r._row);
  cvTouch_(M);   // browsers get a complete refresh, so the group sees the master version again
  return { ok: true };
}
function contentLocalPromote_(p) {
  var S = String(p.storage || ''), M = cvBaseOf_(S); if (S.indexOf('@') >= 0 || !getSetting_('content:pub:' + M)) return dirErr_('Unknown storage.');
  var r = cvLocalRow_(S, String(p.collection || ''), String(p.id || '')); if (!r) return dirErr_('This local item no longer exists — reload.');
  if (isTrue_(r.deleted)) return dirErr_('A hidden item cannot be copied to the master — remove it from the master draft instead (Edit master draft).');
  var D = M + '@draft', ex = null, rows = readAll_(SHEETS.CONTENT), now = Date.now();
  for (var i = 0; i < rows.length; i++) if (rows[i].module === D && rows[i].collection === r.collection && String(rows[i].id) === String(r.id)) { ex = rows[i]; break; }
  var row = cvCopy_(r, D, now); row.updatedBy = 'promoted from ' + S;
  if (ex) updateRow_(SHEETS.CONTENT, ex._row, row); else appendRow_(SHEETS.CONTENT, row);
  if (p.removeLocal) { var again = cvLocalRow_(S, r.collection, r.id); if (again) deleteRow_(SHEETS.CONTENT, again._row); cvTouch_(M); }
  return { ok: true };
}

/* ======================================================================
 * Results & attendance overviews (Step 10) — READ-ONLY. Nothing is written and no sheet is created.
 * Sources (all kept per storage = delivery backendModule, so groups never mix): Students (sign-ins), Results (practice
 * quizzes), AssessRecords (assessment attempts: kind "attempt"; exam attempts: kind "exattempt"), AttendanceSessions +
 * AttendanceRecords. Students are matched to the group's roster by Student ID, then email, then (unique) name.
 * ====================================================================== */
function rpRows_(name) { var sh = getSS_().getSheetByName(name); return sh && sh.getLastRow() > 1 && HEADERS[name] ? readAll_(name) : []; }
function rpNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function rpAvg_(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length * 10) / 10 : null; }
/** Everything of the given storages, read once: {storage: {accounts, quiz, assess, exams, sessions, records}}. */
function rpCollect_(storages) {
  var want = {}, out = {};
  storages.forEach(function (st) { want[st] = 1; out[st] = { accounts: [], quiz: [], assess: [], exams: [], sessions: [], records: [] }; });
  rpRows_(SHEETS.STUDENTS).forEach(function (r) { if (want[r.module]) out[r.module].accounts.push(r); });
  rpRows_(SHEETS.RESULTS).forEach(function (r) { if (want[r.module]) out[r.module].quiz.push({ name: String(r.name || ''), email: String(r.email || '').toLowerCase(), percent: rpNum_(r.percent), at: rpNum_(r.submittedAt) || rpNum_(r.receivedAt) }); });
  rpRows_(SHEETS.ASSESS).forEach(function (r) {
    if (!want[r.module] || r.status === '__deleted' || (r.kind !== 'attempt' && r.kind !== 'exattempt')) return;
    var x = unpackJson_(r); if (!x || x.status !== 'submitted') return;
    if (r.kind === 'attempt') out[r.module].assess.push({ ref: String(x.assessmentId || ''), title: String(x.assessmentTitle || x.assessmentId || ''), email: String(x.email || '').toLowerCase(), name: String(x.name || ''), percent: rpNum_(x.percent), at: rpNum_(x.submittedAt) });
    else out[r.module].exams.push({ ref: String(x.examId || ''), title: String(x.examTitle || x.examId || ''), id: normUser_(x.username), name: String(x.studentName || ''), percent: rpNum_(x.percent), at: rpNum_(x.submittedAt) });
  });
  var sid = {};
  rpRows_(SHEETS.ATT_SESSIONS).forEach(function (r) { if (want[r.module]) { sid[r.sessionId] = r.module; out[r.module].sessions.push({ sessionId: String(r.sessionId), title: String(r.sessionTitle || r.chapter || r.course || ''), at: rpNum_(r.createdAt), status: String(r.status || '') }); } });
  rpRows_(SHEETS.ATT_RECORDS).forEach(function (r) { var st = sid[r.sessionId]; if (st) out[st].records.push({ sessionId: String(r.sessionId), id: normUser_(r.studentId), email: String(r.email || '').toLowerCase(), name: String(r.studentName || '') }); });
  return out;
}
function rpDeliveryList_(ids) {
  var gr = {}; dirAll_(DIR.GROUP).forEach(function (g) { gr[g.groupId] = g; });
  var ins = {}; dirAll_(DIR.INST).forEach(function (i) { ins[i.institutionId] = i; });
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  return dirAll_(DIR.DELIV).filter(function (d) { return !ids || ids.indexOf(d.deliveryId) >= 0; }).map(function (d) {
    var g = gr[d.groupId] || {}, i = ins[g.institutionId] || {}, m = md[d.moduleId] || {};
    return { deliveryId: d.deliveryId, storage: d.backendModule, moduleId: d.moduleId, title: m.title || d.moduleId, groupId: d.groupId, groupName: g.name || '?', academicYear: g.academicYear || '',
      institution: i.shortName || i.name || '?', active: !!(d.active && g.active && i.active), status: d.status };
  }).sort(function (a, b) { return (a.institution + a.groupName + a.title).localeCompare(b.institution + b.groupName + b.title); });
}
function rpMembers_() {
  var sh = getSS_().getSheetByName(DIR.MEMB), by = {};
  if (sh && sh.getLastRow() > 1) dirAll_(DIR.MEMB).forEach(function (m) { (by[m.groupId] = by[m.groupId] || []).push(m); });
  return by;
}
function reportOverview_(ids) {
  var list = rpDeliveryList_(ids), data = rpCollect_(list.map(function (d) { return d.storage; })), mem = rpMembers_(), now = Date.now(), WEEK = 7 * 864e5;
  return { ok: true, serverTime: now, deliveries: list.map(function (d) {
    var x = data[d.storage], ppl = {};
    x.quiz.forEach(function (q) { ppl[q.email || q.name] = 1; });
    var present = {}; x.records.forEach(function (r) { present[r.sessionId] = (present[r.sessionId] || 0) + 1; });
    var act = {}; (mem[d.groupId] || []).forEach(function (m) { if (m.active) act[m.studentId] = 1; });
    var accs = x.accounts.filter(function (a) { return act[a.username]; });   // only the group's active students
    return Object.assign(d, {
      students: Object.keys(act).length,
      signedIn: accs.filter(function (a) { return rpNum_(a.lastLogin) > 0; }).length,
      activeWeek: accs.filter(function (a) { return now - rpNum_(a.lastLogin) < WEEK; }).length,
      quiz: { attempts: x.quiz.length, students: Object.keys(ppl).length, avg: rpAvg_(x.quiz.map(function (q) { return q.percent; })) },
      assess: { submitted: x.assess.length, avg: rpAvg_(x.assess.map(function (q) { return q.percent; })) },
      exams: { submitted: x.exams.length, avg: rpAvg_(x.exams.map(function (q) { return q.percent; })) },
      attendance: { sessions: x.sessions.length, avgPresent: rpAvg_(x.sessions.map(function (s) { return present[s.sessionId] || 0; })), last: x.sessions.reduce(function (m, s) { return Math.max(m, s.at); }, 0) }
    });
  }) };
}
function reportDelivery_(p) {
  var d = rpDeliveryList_([String(p.deliveryId || '')])[0]; if (!d) return dirErr_('Delivery not found.');
  var x = rpCollect_([d.storage])[d.storage], members = (rpMembers_()[d.groupId] || []).slice().sort(function (a, b) { return a.studentId.localeCompare(b.studentId); });
  var acc = {}; x.accounts.forEach(function (a) { acc[a.username] = a; });
  var idx = {}, nameCount = {};
  members.forEach(function (m) { var k = String(m.name || '').trim().toLowerCase(); if (k) nameCount[k] = (nameCount[k] || 0) + 1; });
  var rows = members.map(function (m) {
    var a = acc[m.studentId], row = { studentId: m.studentId, name: m.name, active: !!m.active, lastLogin: a ? rpNum_(a.lastLogin) : 0, hasAccount: !!a, quiz: [], assess: [], exams: [], att: {} };
    idx['id:' + m.studentId] = row;
    [m.email, a && a.email, String(m.studentId).replace(/[^a-z0-9._-]/g, '') + '@student.local'].forEach(function (e) { e = String(e || '').trim().toLowerCase(); if (e && !idx['em:' + e]) idx['em:' + e] = row; });
    var nk = String(m.name || '').trim().toLowerCase(); if (nk && nameCount[nk] === 1) idx['nm:' + nk] = row;
    return row;
  });
  var others = {};
  function who(it) {
    return (it.id && idx['id:' + it.id]) || (it.email && idx['em:' + it.email]) || (it.name && idx['nm:' + it.name.trim().toLowerCase()]) || null;
  }
  function other(it, kind) { var k = it.id || it.email || it.name.trim().toLowerCase() || '?'; var o = others[k] || (others[k] = { label: it.name || it.id || it.email || '?', quiz: 0, assess: 0, exams: 0, attendance: 0 }); o[kind]++; }
  x.quiz.forEach(function (q) { var r = who(q); if (r) r.quiz.push(q.percent); else other(q, 'quiz'); });
  x.assess.forEach(function (q) { var r = who(q); if (r) r.assess.push(q.percent); else other(q, 'assess'); });
  x.exams.forEach(function (q) { var r = who(q); if (r) r.exams.push(q.percent); else other(q, 'exams'); });
  x.records.forEach(function (q) { var r = who(q); if (r) r.att[q.sessionId] = 1; else other(q, 'attendance'); });
  var sessions = x.sessions.slice().sort(function (a, b) { return a.at - b.at; });
  var present = {}; x.records.forEach(function (r) { present[r.sessionId] = (present[r.sessionId] || 0) + 1; });
  function byRef(list) {
    var m = {}, order = [];
    list.forEach(function (q) { var o = m[q.ref]; if (!o) { o = m[q.ref] = { id: q.ref, title: q.title, percents: [] }; order.push(q.ref); } o.percents.push(q.percent); });
    return order.map(function (k) { var o = m[k]; return { id: o.id, title: o.title, submitted: o.percents.length, avg: rpAvg_(o.percents) }; });
  }
  return { ok: true, serverTime: Date.now(), delivery: d,
    sessions: sessions.map(function (s) { return { sessionId: s.sessionId, title: s.title, at: s.at, status: s.status, present: present[s.sessionId] || 0 }; }),
    assessments: byRef(x.assess), exams: byRef(x.exams),
    students: rows.map(function (r) {
      var att = Object.keys(r.att);
      return { studentId: r.studentId, name: r.name, active: r.active, hasAccount: r.hasAccount, lastLogin: r.lastLogin,
        quiz: { attempts: r.quiz.length, best: r.quiz.length ? Math.max.apply(null, r.quiz) : null, avg: rpAvg_(r.quiz) },
        assess: { submitted: r.assess.length, avg: rpAvg_(r.assess) }, exams: { submitted: r.exams.length, avg: rpAvg_(r.exams) },
        attended: att.length, attendedPct: sessions.length ? Math.round(att.length / sessions.length * 100) : null, sessions: att };
    }),
    others: Object.keys(others).map(function (k) { return others[k]; }) };
}

/* ======================================================================
 * Packaged releases (2.3). A rebuilt module (a new index.html on GitHub) goes live without losing the edits:
 *  1. tools/module-release.js puts the new build at …/<module>/preview/, encrypted with the PREVIEW key;
 *  2. the Admin opens it from Content → New build (a master-draft session — the only session that gets the key);
 *     the page reports the IDs of its packaged course, the live page does the same;
 *  3. the compatibility check lists every master-draft item and every group's local item whose target is gone
 *     (or changed, or whose ID the new build now uses itself) — each needs a decision;
 *  4. the new file goes live on GitHub (one commit), then Go live applies the decisions and publishes a new
 *     version recorded with the new build.
 * ====================================================================== */
var CV_NOPREVIEW = { ok: false, code: 'nopreview', error: 'This preview of a new build opens only for the platform administrator (Platform Home → Content → New build → Open preview).' };
var CV_MF_KINDS = ['topics', 'sections', 'questions', 'cases', 'images', 'other'];
/** The preview key: HMAC-SHA256(content key, "neo-preview:<module>") — the same derivation as tools/module-release.js. */
function previewKey_(M) {
  var live = typeof contentKey_ === 'function' ? String(contentKey_(M) || '') : '';
  if (!live || /^__/.test(live)) return '';
  return Utilities.base64Encode(Utilities.computeHmacSha256Signature(Utilities.newBlob('neo-preview:' + M).getBytes(), Utilities.base64Decode(live)));
}
function cvPreviewSession_(module, p) {
  var M = cvBaseOf_(module);
  if (module !== M || p.stoken || !p.token) return CV_NOPREVIEW;
  return authed_(M, p, function () {
    if (!getSetting_('content:pub:' + M) || !cvIsDraftToken_(M, String(p.token))) return CV_NOPREVIEW;
    var k = previewKey_(M); if (!k) return { ok: false, code: 'nokey', error: 'This module has no content key on the backend.' };
    return { ok: true, role: 'teacher', contentKey: k, preview: true };
  });
}
function cvBuildManifest_(module, p) {
  var M = cvBaseOf_(module);
  if (module !== M) return { ok: false, code: 'badmodule', error: 'Unknown module.' };
  return authed_(M, p, function () {
    if (!cvIsDraftToken_(M, String(p.token))) return { ok: false, code: 'forbidden', error: 'Only the master-draft session reports its build.' };
    var src = p.manifest && typeof p.manifest === 'object' ? p.manifest : {}, m = {};
    CV_MF_KINDS.forEach(function (k) {
      var o = src[k] && typeof src[k] === 'object' ? src[k] : {}, t = {};
      Object.keys(o).slice(0, 6000).forEach(function (id) { if (/^[A-Za-z0-9_.:\-]{1,80}$/.test(id)) t[id] = String(o[id]).slice(0, 16); });
      m[k] = t;
    });
    var rec = { build: String(p.build || p.buildTime || '').slice(0, 40), buildTime: String(p.buildTime || '').slice(0, 40), reportedAt: Date.now(), m: m };
    var json = JSON.stringify(rec); if (json.length > 48000) return dirErr_('This build has too many items to record.');
    setSetting_('content:build:' + M + ':' + (p.preview ? 'preview' : 'live'), json);
    return { ok: true };
  });
}
function cvBuild_(M, which) { var s = getSetting_('content:build:' + M + ':' + which); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
function cvBuildInfo_(b) { return b ? { build: b.build, buildTime: b.buildTime, reportedAt: b.reportedAt, counts: CV_MF_KINDS.reduce(function (o, k) { o[k] = Object.keys(b.m[k] || {}).length; return o; }, {}) } : null; }
function cvBuildLabel_(M) { var b = cvBuild_(M, 'live'); return b ? b.build : ''; }
/** What an educational item points at in the packaged course. */
function cvRefs_(coll, id, data) {
  var list = function (arr, t) { return (Array.isArray(arr) ? arr : []).map(function (x) { return { t: t, id: String(x) }; }); };
  switch (coll) {
    case 'topicsections': return { refs: [{ t: 'topics', id: id, ov: true }] };   // replaces the topic's sections
    case 'custommedia': return { refs: [{ t: 'sections', id: id }] };
    case 'hiddentopics': return { refs: [{ t: 'topics', id: id }] };
    case 'courseorder': return { refs: list(data && data.order, 'topics'), list: 'order' };
    case 'revexclude': case 'quizextra': return { refs: list(data && data.ids, 'questions'), list: 'ids' };
    case 'contentedits':
      var i = id.indexOf(':'), T = { question: 'questions', 'case': 'cases', atlas: 'images' }[id.slice(0, i)];
      return T ? { refs: [{ t: T, id: id.slice(i + 1), ov: T !== 'images' }] } : { unchecked: true };
    case 'importedquestions': return { own: 'questions' };
    case 'customtopics': return { own: 'topics' };
    default: return { carried: true };   // practicals, presentation, media, … live only in the overlay
  }
}
/** IDs the overlay itself provides (custom topics + their sections, imported questions). */
function cvCustomIds_(maps) {
  var c = { topics: {}, sections: {}, questions: {} };
  maps.forEach(function (map) {
    Object.keys(map).forEach(function (k) {
      var r = map[k], d = unpackJson_(r) || {};
      if (r.collection === 'customtopics') { c.topics[String(r.id)] = 1; (d.sections || []).forEach(function (s) { if (s && s.id) c.sections[String(s.id)] = 1; }); }
      if (r.collection === 'importedquestions') c.questions[String(r.id)] = 1;
    });
  });
  Object.keys(maps[maps.length - 1]).forEach(function (k) { var r = maps[maps.length - 1][k]; if (r.collection === 'topicsections' && c.topics[r.id]) ((unpackJson_(r) || {}).sections || []).forEach(function (s) { if (s && s.id) c.sections[String(s.id)] = 1; }); });
  return c;
}
function cvCheckItem_(r, P, L, custom) {
  var data = unpackJson_(r), x = cvRefs_(r.collection, String(r.id), data);
  if (x.carried) return { status: 'carried' };
  if (x.unchecked) return { status: 'unchecked' };
  if (x.own) return P[x.own][r.id] !== undefined ? { status: 'duplicate' } : { status: 'carried' };
  var missing = [], changed = false;
  x.refs.forEach(function (ref) {
    if (custom[ref.t] && custom[ref.t][ref.id]) return;
    if (P[ref.t][ref.id] === undefined) { missing.push(ref.id); return; }
    if (ref.ov && L && L[ref.t] && L[ref.t][ref.id] !== undefined && L[ref.t][ref.id] !== P[ref.t][ref.id]) changed = true;
  });
  if (missing.length) return { status: x.list && missing.length < x.refs.length ? 'partial' : 'missing', missing: missing, list: x.list || '' };
  return { status: changed ? 'changed' : 'attached' };
}
var CV_CHOICES = { missing: ['remove', 'keep'], partial: ['clean', 'keep'], changed: ['keep', 'remove'], duplicate: ['remove'] };
function contentRebuildCheck_(p) {
  var M = String(p.moduleId || ''); if (!getSetting_('content:pub:' + M)) return dirErr_('No master copy yet.');
  var PV = cvBuild_(M, 'preview'); if (!PV) return { ok: false, code: 'nopreview', error: 'No preview build has reported yet. Open the preview first (New build → Open preview).' };
  var LV = cvBuild_(M, 'live'), P = PV.m, L = LV ? LV.m : null;
  var saved = {}; try { var sd = JSON.parse(getSetting_('content:rebuild:' + M) || 'null'); if (sd && sd.build === PV.build) saved = sd.d || {}; } catch (e) { }
  var rows = readAll_(SHEETS.CONTENT), draft = cvLive_(rows, M + '@draft'), items = [], counts = {};
  var labels = {}; dirAll_(DIR.DELIV).forEach(function (d) { labels[d.backendModule] = d; });
  var layers = [{ storage: '', label: 'Master draft', map: draft, custom: cvCustomIds_([draft]) }];
  var locs = {}; rows.forEach(function (r) { var m = String(r.module || ''); if (/@local$/.test(m) && cvBaseOf_(m.replace(/@local$/, '')) === M && cvKey_(r.collection) && !isTrue_(r.deleted)) (locs[m] = locs[m] || {})[r.collection + '|' + r.id] = r; });
  Object.keys(locs).sort().forEach(function (m) { var S = m.replace(/@local$/, ''); layers.push({ storage: S, label: 'Group ' + S, map: locs[m], custom: cvCustomIds_([draft, locs[m]]) }); });
  layers.forEach(function (ly) {
    Object.keys(ly.map).sort().forEach(function (k) {
      var r = ly.map[k], c = cvCheckItem_(r, P, L, ly.custom), key = (ly.storage || 'master') + '|' + k;
      counts[c.status] = (counts[c.status] || 0) + 1;
      if (c.status === 'carried' || c.status === 'attached') return;
      var dec = saved[key] && CV_CHOICES[c.status] && CV_CHOICES[c.status].indexOf(saved[key]) >= 0 ? saved[key] : '';
      items.push({ key: key, storage: ly.storage, layer: ly.label, collection: r.collection, id: String(r.id), status: c.status, missing: c.missing || [], choices: CV_CHOICES[c.status] || [], decision: dec });
    });
  });
  var diff = {}; if (L) CV_MF_KINDS.forEach(function (k) {
    var o = L[k] || {}, n = P[k] || {};
    diff[k] = { removed: Object.keys(o).filter(function (id) { return !(id in n); }), added: Object.keys(n).filter(function (id) { return !(id in o); }).length,
      changed: Object.keys(n).filter(function (id) { return id in o && o[id] !== n[id]; }).length };
  });
  return { ok: true, moduleId: M, live: cvBuildInfo_(LV), preview: cvBuildInfo_(PV), diff: diff, counts: counts, items: items,
    undecided: items.filter(function (it) { return it.choices.length && !it.decision; }).length };
}
function contentRebuildDecide_(p) {
  var M = String(p.moduleId || ''), PV = cvBuild_(M, 'preview'); if (!PV) return dirErr_('No preview build.');
  var d = {}, src = p.decisions && typeof p.decisions === 'object' ? p.decisions : {};
  Object.keys(src).slice(0, 5000).forEach(function (k) { var v = String(src[k]); if (/^(keep|remove|clean)$/.test(v)) d[String(k).slice(0, 300)] = v; });
  setSetting_('content:rebuild:' + M, JSON.stringify({ build: PV.build, d: d }));
  return { ok: true, saved: Object.keys(d).length };
}
function contentGoLive_(p) {
  var M = String(p.moduleId || '');
  if (getSetting_('content:freeze:' + M) === '1') return dirErr_('Publishing is frozen for this module. Unfreeze it first.');
  var rep = contentRebuildCheck_(p); if (!rep.ok) return rep;
  if (String(p.build || '') !== rep.preview.build) return dirErr_('The preview build has changed since you checked — check again.');
  if (rep.undecided) return dirErr_(rep.undecided + ' item(s) still need a decision.');
  var D = M + '@draft', master = 0, local = [];
  rep.items.forEach(function (it) {
    if (it.decision !== 'remove' && it.decision !== 'clean') return;
    if (!it.storage) {
      if (it.decision === 'remove') actionDelete_(D, { collection: it.collection, id: it.id });
      else { var r0 = findContentRow_(D, it.collection, it.id), d0 = r0 && unpackJson_(r0); if (d0) { var lk = cvRefs_(it.collection, it.id, d0).list; d0[lk] = (d0[lk] || []).filter(function (x) { return it.missing.indexOf(String(x)) < 0; }); actionUpsert_(D, { collection: it.collection, id: it.id, data: d0 }); } }
      master++;
    } else local.push(it);
  });
  var PV = cvBuild_(M, 'preview');
  var r = cvPublishMap_(M, cvLive_(readAll_(SHEETS.CONTENT), D), String(p.notes || '').trim() || ('New build ' + PV.build), p.label, PV.build);
  if (!r.ok) return r;
  local.forEach(function (it) {   // the groups' decisions take effect together with the new version
    var row = cvLocalRow_(it.storage, it.collection, it.id); if (!row) return;
    if (it.decision === 'remove') deleteRow_(SHEETS.CONTENT, row._row);
    else { var d1 = unpackJson_(row); if (d1) { var lk1 = cvRefs_(it.collection, it.id, d1).list; d1[lk1] = (d1[lk1] || []).filter(function (x) { return it.missing.indexOf(String(x)) < 0; }); actionUpsert_(it.storage + '@local', { collection: it.collection, id: it.id, data: d1 }); } }
  });
  setSetting_('content:build:' + M + ':live', JSON.stringify(PV));
  setSetting_('content:build:' + M + ':preview', '');
  setSetting_('content:rebuild:' + M, '');
  cvTouch_(M);
  return { ok: true, moduleId: M, version: r.version, label: r.label, build: PV.build, removedMaster: master, changedLocal: local.length };
}

/* ======================================================================
 * Speed (2.5)
 * ====================================================================== */
/** Each request names its module and action in the execution log (Apps Script → Executions → a row → Logs). */
function perfLog_(module, p) { try { console.log('req ' + String(module) + ' ' + String(p.action || '')); } catch (e) { } }
/* Requests that never change the educational rows a browser downloads with getAllContent (they use other sheets, Drive,
   the cache, or private rows). Every other request — including any unknown one — counts as a possible change, so an
   uncertain case always takes the normal (full) path; the fast path can only skip work, never hide a change. */
var CV_NO_CONTENT_WRITE = {};
['getAllContent', 'ping', 'login', 'logout', 'changePassword', 'setup', 'studentLogin', 'studentLogout', 'studentSession', 'studentChangePassword',
 'listStudents', 'saveStudent', 'bulkAddStudents', 'setStudentActive', 'resetStudentPassword', 'deleteStudent', 'unlockStudent',
 'listHistory', 'exportCourse', 'uploadImage', 'privList', 'aiStatus', 'setAIConfig', 'aiTest', 'practicalAI', 'practicalImage',
 'submitQuizResult', 'getResults', 'deleteResult', 'checkQuizPassword', 'getQuizPassword', 'setQuizPassword',
 'liveJoin', 'liveSync', 'liveHistory', 'liveContext', 'livePost', 'liveEdit', 'liveDelete', 'livePin', 'liveReact', 'liveSearch', 'liveMembers',
 'liveNotifications', 'liveMarkRead', 'liveSetPrefs', 'liveTyping', 'liveUploadInit', 'liveUploadChunk', 'liveUploadStatus', 'liveFileChunk', 'liveModuleInfo',
 'getLiveClassroomPassword', 'setLiveClassroomPassword', 'startAttendanceSession', 'closeAttendanceSession', 'getAttendanceTeacherState',
 'regenerateAttendanceCode', 'deleteAttendanceRecord', 'retrySyncAttendance', 'listAttendanceSessions', 'getAttendanceSessionReport',
 'deleteAttendanceSession', 'getAttendanceSettings', 'setAttendanceSettings', 'getAttendanceInfo', 'submitAttendance', 'submitAttendanceByCode',
 'listAssessGroups', 'saveAssessGroup', 'deleteAssessGroup', 'listAssignments', 'createAssignments', 'cancelAssignment', 'listAttempts',
 'getMyAssessments', 'startAttempt', 'submitAttempt', 'mailQuota', 'sendAssessmentFeedback',
 'studyConnect', 'studyPull', 'studyPush', 'studyDisconnect', 'studyDelete', 'studyClassStats', 'studyResetPin',
 'examList', 'examResults', 'examAttemptDetail', 'examBankList', 'contentBuildManifest'].forEach(function (a) { CV_NO_CONTENT_WRITE[a] = 1; });
var CV_WRITE_GRACE_MS = 60000;    // a write still in progress (a save waits at most ~30 s for the lock) is always covered
function cvMarkWrite_(S) { try { CacheService.getScriptCache().put('cvw:' + S, String(Date.now()), 21600); } catch (e) { } }
/** null = take the normal path. An answer = "nothing new since your last check" (the browser keeps what it has). */
function cvFastUnchanged_(S, p) {
  var since = Number(p.since || 0); if (!since || since > Date.now() + 60000) return null;
  var M = cvBaseOf_(S), st = cvState_(M);
  if (st.changed && since <= Number(st.changed) + CV_WRITE_GRACE_MS) return null;   // a switch / publish → full refresh
  if (p.token && S === M && st.pub && cvIsDraftToken_(M, String(p.token))) return null; // master-draft session: normal path
  var c = CacheService.getScriptCache(), w = c.get('cvw:' + S);
  if (w === null) { c.put('cvw:' + S, String(Date.now()), 21600); return null; }    // unknown (cache evicted): normal path now
  if (since <= Number(w) + CV_WRITE_GRACE_MS) return null;
  if (typeof studentAuthOn_ === 'function' && studentAuthOn_(S)) { var g = gateRequest_(S, p); if (g) return g; }   // same sign-in check as always
  return { ok: true, items: [], serverTime: Date.now() };
}
/** Time-driven trigger target (Triggers → Add trigger → portalWarm → Time-driven → every 10 minutes). */
function portalWarm() { try { getSS_(); CacheService.getScriptCache().get('cvstate:warm'); } catch (e) { } return true; }

/** Tidy up (Admin). report = what would be removed; apply = do it (in portions, so it never times out). */
function portalTidy_(apply) {
  var now = Date.now(), KEEP = 5, LIMIT = 400, out = { ok: true, applied: !!apply };
  var lock = apply ? LockService.getScriptLock() : null; if (lock) lock.waitLock(30000);
  try {
    var rows = readAll_(SHEETS.CONTENT), groups = {}, del = [], arch = [];
    rows.forEach(function (r) {
      if (r.collection !== 'history') return;
      if (isTrue_(r.deleted)) { del.push(r); return; }   // a removed history snapshot: browsers never download history, so nothing needs it
      var d = unpackJson_(r) || {}, k = r.module + '|' + (d.collection || '') + '|' + (d.itemId || '');
      (groups[k] = groups[k] || []).push({ r: r, t: Number(d.savedAt) || Number(r.updatedAt) || 0 });
    });
    Object.keys(groups).forEach(function (k) { groups[k].sort(function (a, b) { return b.t - a.t; }).slice(KEEP).forEach(function (x) { arch.push(x.r); }); });
    var ses = function (name, expCol) {
      var sh = getSS_().getSheetByName(name); if (!sh || sh.getLastRow() < 2 || !HEADERS[name]) return [];
      return readAll_(name).filter(function (r) { var e = Number(r[expCol]); return e && e < now; });
    };
    var exp = { Sessions: ses(SHEETS.SESSIONS, 'expiresAt'), StudentSessions: ses(SHEETS.STU_SESSIONS, 'expiresAt') };
    if (tSheetsReady_()) { exp.PortalSessions = ses(DIR.PSES, 'expiresAt'); exp.PortalGrants = ses(DIR.GRANTS, 'expiresAt'); }
    var KEY = { Sessions: 'token', StudentSessions: 'tokenHash', PortalSessions: 'tokenHash', PortalGrants: 'tokenHash' };
    out.contentRows = rows.length; out.historyTombstones = del.length; out.historyArchived = arch.length;
    out.expiredSessions = Object.keys(exp).reduce(function (n, k) { return n + exp[k].length; }, 0);
    if (!apply) return out;
    var budget = LIMIT, done = 0;
    if (arch.length) {   // copy first, then remove: an archived snapshot is never lost
      HEADERS.ContentArchive = HEADERS[SHEETS.CONTENT];
      var sh = getSS_().getSheetByName('ContentArchive') || getSS_().insertSheet('ContentArchive');
      if (sh.getLastRow() === 0) sh.appendRow(HEADERS[SHEETS.CONTENT]);
      arch.slice(0, budget).forEach(function (r) { appendRow_('ContentArchive', r); });
    }
    var gone = del.concat(arch.slice(0, budget)).slice(0, budget);
    gone.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; }).forEach(function (row) { deleteRow_(SHEETS.CONTENT, row); done++; });
    budget -= done;
    Object.keys(exp).forEach(function (name) {   // session sheets can change without the lock: delete a row only if it is still that session
      var sh = getSS_().getSheetByName(name), col = HEADERS[name].indexOf(KEY[name]) + 1;
      exp[name].sort(function (a, b) { return b._row - a._row; }).slice(0, Math.max(0, budget)).forEach(function (r) {
        if (col > 0 && String(sh.getRange(r._row, col).getValue()) === String(r[KEY[name]])) { deleteRow_(name, r._row); budget--; done++; }
      });
    });
    out.removed = done; out.more = (del.length + arch.length + out.expiredSessions) > done;
    return out;
  } finally { if (lock) lock.releaseLock(); }
}

/* ======================================================================
 * Official Exams (2.6)
 * ====================================================================== */
var EXAM_APP_URL = 'https://third-year-med.github.io/pathology-exams/';
var EXAM_MODULE = 'exams';   // the "Official Exams" module of the directory: delivered to a group → storage exams-<linkCode>
function examAppUrl_() { var m = dirReadable_() ? dirFind_(DIR.MOD, 'moduleId', EXAM_MODULE) : null; return (m && /^https:\/\//.test(m.url || '')) ? m.url : EXAM_APP_URL; }
function examKey_(moduleId) { var k = typeof contentKey_ === 'function' ? String(contentKey_(moduleId) || '') : ''; return k && !/^__/.test(k) ? k : ''; }
function examKeys_(ids) { var o = {}; ids.forEach(function (m) { var k = examKey_(m); if (k) o[m] = k; }); return o; }
/** Every place where exams can be managed, with labels. user = null → Admin (all); otherwise that teacher's deliveries. */
function examPlaces_(u) {
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  var gr = {}; dirAll_(DIR.GROUP).forEach(function (g) { gr[g.groupId] = g; });
  var ins = {}; dirAll_(DIR.INST).forEach(function (i) { ins[i.institutionId] = i; });
  var mine = null; if (u) { mine = {}; teacherDeliveries_(u.userId).forEach(function (d) { mine[d.deliveryId] = 1; }); }
  var places = [];
  if (!u) dirAll_(DIR.MOD).forEach(function (m) {   // each module's own exams (main storage — the module's own student accounts)
    if (m.moduleId === EXAM_MODULE || !m.active) return;
    places.push({ storage: m.moduleId, moduleId: m.moduleId, kind: 'module', title: m.title, group: '', groupLabel: 'All students of the module (normal link)', linkCode: '' });
  });
  dirAll_(DIR.DELIV).forEach(function (d) {
    if (mine && !mine[d.deliveryId]) return;
    var g = gr[d.groupId] || {}, i = ins[g.institutionId] || {}, m = md[d.moduleId] || {};
    places.push({ storage: d.backendModule, moduleId: d.moduleId, kind: d.moduleId === EXAM_MODULE ? 'combined' : 'module', deliveryId: d.deliveryId,
      title: d.moduleId === EXAM_MODULE ? 'Combined exams (several modules)' : (m.title || d.moduleId), group: g.groupId || '', linkCode: g.linkCode || '',
      groupLabel: (i.shortName || i.name || '?') + ' · ' + (g.name || '?') + (g.academicYear ? ' (' + g.academicYear + ')' : ''), active: !!(d.active && g.active && i.active) });
  });
  return { ok: true, examUrl: examAppUrl_(), places: places };
}
function examOpenAdmin_(p, portalToken) {
  var S = String(p.storage || ''), pl = examPlaces_(null).places.filter(function (x) { return x.storage === S; })[0];
  if (!pl) return dirErr_('Unknown exam place.');
  var now = Date.now(), exp = now + SESSION_TTL_MS;
  readAll_(SHEETS.SESSIONS).forEach(function (r) { if (r.token === portalToken && Number(r.expiresAt) > now) exp = Math.min(exp, Number(r.expiresAt)); });
  var token = Utilities.getUuid() + '-' + randomHex_(16);
  appendRow_(SHEETS.SESSIONS, { module: S, token: token, createdAt: now, expiresAt: exp });
  var ids = dirAll_(DIR.MOD).map(function (m) { return m.moduleId; }).filter(function (m) { return m !== EXAM_MODULE; });
  return { ok: true, storage: S, token: token, expiresAt: exp, examUrl: examAppUrl_(), place: pl, keys: examKeys_(ids) };
}
function examOpenTeacher_(u, ses, p) {
  var S = String(p.storage || ''), pl = examPlaces_(u).places.filter(function (x) { return x.storage === S; })[0];
  if (!pl) return { ok: false, code: 'forbidden', error: 'Exams of this group and module are not assigned to you.' };
  var r = teacherOpen_(u, ses, { deliveryId: pl.deliveryId }); if (!r.ok) return r;
  var ids = {}; teacherDeliveries_(u.userId).forEach(function (d) { if (d.moduleId !== EXAM_MODULE) ids[d.moduleId] = 1; });
  return { ok: true, storage: S, token: r.token, expiresAt: r.expiresAt, examUrl: examAppUrl_(), place: pl, keys: examKeys_(Object.keys(ids)) };
}
/** The exam front page (public). With g: the group's deliveries (combined + per module); without: every module's own exams. */
function portalExamList_(p) {
  var code = String(p.g || '').trim(), now = Date.now(), c = CacheService.getScriptCache(), ck = 'exlist:' + (code || '_main');
  var hit = c.get(ck); if (hit) { try { var o = JSON.parse(hit); o.serverTime = now; return o; } catch (e) { } }
  var out = { ok: true, serverTime: now, exams: [] }, places = [];
  if (code) {
    var G = portalGroup_(code); if (!G) return PORTAL_NOGROUP;
    out.group = { name: G.group.name, academicYear: G.group.academicYear, linkCode: G.group.linkCode };
    out.institution = { name: G.institution.name, shortName: G.institution.shortName };
    G.modules.forEach(function (m) { places.push({ storage: m._storage, kind: m.moduleKey === EXAM_MODULE ? 'combined' : 'module', moduleTitle: m.moduleKey === EXAM_MODULE ? 'Combined exam' : m.title }); });
  } else {
    var mods = dirReadable_() ? dirAll_(DIR.MOD).filter(function (m) { return m.active && m.moduleId !== EXAM_MODULE; }).map(function (m) { return { id: m.moduleId, title: m.title }; })
      : portalRegistry_().filter(function (m) { return m.moduleKey; }).map(function (m) { return { id: m.moduleKey, title: m.title }; });
    mods.forEach(function (m) { places.push({ storage: m.id, kind: 'module', moduleTitle: m.title }); });
  }
  var by = {}; places.forEach(function (x) { by[x.storage] = x; });
  readAll_(SHEETS.CONTENT).forEach(function (r) {
    if (r.collection !== 'priv:exams' || isTrue_(r.deleted) || !by[r.module]) return;
    var e = unpackJson_(r); if (!e || e.status !== 'published') return;
    var state = typeof exWindowState_ === 'function' ? exWindowState_(e, now) : (now < Number(e.opensAt) ? 'notyet' : now > Number(e.closesAt) ? 'closed' : 'open');
    if (state === 'closed' && now - Number(e.closesAt) > 24 * 3600000) return;   // finished exams stay listed for one day
    var pl = by[r.module];
    out.exams.push({ storage: r.module, kind: pl.kind, moduleTitle: pl.moduleTitle, title: String(e.title || ''), opensAt: Number(e.opensAt) || 0, closesAt: Number(e.closesAt) || 0,
      durationMin: Number(e.durationMin) || 0, questions: typeof exQuestionCount_ === 'function' ? exQuestionCount_(e) : (e.questionIds || []).length, state: state });
  });
  out.exams.sort(function (a, b) { return (a.state === 'open' ? 0 : a.state === 'notyet' ? 1 : 2) - (b.state === 'open' ? 0 : b.state === 'notyet' ? 1 : 2) || a.opensAt - b.opensAt; });
  c.put(ck, JSON.stringify(out), 30);
  return out;
}

/* ---- Exam banks ↔ teaching banks (2.6): copy questions between modules, groups and the official exam banks ---- */
var EXAM_BANK_ACTIONS = { examCopySources: 1, examCourseExtras: 1, examCopyFrom: 1, examTeachWrite: 1, examModuleScores: 1, examCopyExam: 1 };
var EXAM_TEACH_TYPES = { mcq: 1, vignette: 1, tf: 1, selectall: 1, fillblank: 1, matching: 1, short: 1 };
/** Who holds this module token: a personal teacher (their grant) or the Admin (any other token of the storage). */
function examCaller_(token) {
  if (!tSheetsReady_()) return { admin: true };
  var h = tHash_('pg', String(token)), g = null;
  dirAll_(DIR.GRANTS).some(function (x) { if (x.tokenHash === h) { g = x; return true; } return false; });
  return !g || g.userId === 'admin' ? { admin: true } : { admin: false, userId: g.userId };
}
/** The teaching banks (courses) and exam banks this caller may read from and copy to. */
function examSources_(caller) {
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  var gr = {}; dirAll_(DIR.GROUP).forEach(function (g) { gr[g.groupId] = g; });
  var ins = {}; dirAll_(DIR.INST).forEach(function (i) { ins[i.institutionId] = i; });
  var courses = [], banks = [], mine = null;
  if (!caller.admin) { mine = {}; teacherDeliveries_(caller.userId).forEach(function (d) { mine[d.deliveryId] = 1; }); }
  if (caller.admin) dirAll_(DIR.MOD).forEach(function (m) {
    if (m.moduleId === EXAM_MODULE) return;
    var x = { storage: m.moduleId, moduleId: m.moduleId, title: m.title, url: m.url || '', label: 'Master copy (all groups)' };
    courses.push(x); banks.push({ storage: m.moduleId, moduleId: m.moduleId, title: m.title, label: 'Module’s own exams' });
  });
  dirAll_(DIR.DELIV).forEach(function (d) {
    if (mine && !mine[d.deliveryId]) return;
    var g = gr[d.groupId] || {}, i = ins[g.institutionId] || {}, m = md[d.moduleId] || {};
    var label = (i.shortName || i.name || '?') + ' · ' + (g.name || '?') + (g.academicYear ? ' (' + g.academicYear + ')' : '');
    if (d.moduleId !== EXAM_MODULE) courses.push({ storage: d.backendModule, moduleId: d.moduleId, title: m.title || d.moduleId, url: m.url || '', label: label });
    banks.push({ storage: d.backendModule, moduleId: d.moduleId, title: d.moduleId === EXAM_MODULE ? 'Combined exams' : (m.title || d.moduleId), label: label });
  });
  return { courses: courses, banks: banks };
}
/** The teaching bank as the students of that storage see it: imported questions and the Revision exclusions. */
function examTeachItems_(S) {
  var M = cvBaseOf_(S), st = cvState_(M), rows;
  if (st.mode) rows = contentResolve_(S, M, st.mode === 'on', 0, st.changed).items.filter(function (it) { return !it.deleted; });
  else rows = readAll_(SHEETS.CONTENT).filter(function (r) { return r.module === S && !isTrue_(r.deleted); }).map(function (r) { return { collection: r.collection, id: r.id, data: unpackJson_(r) }; });
  var out = { questions: [], exclude: [] };
  rows.forEach(function (it) {
    if (it.collection === 'importedquestions' && it.data) out.questions.push(Object.assign({}, it.data, { id: String(it.id) }));
    if (it.collection === 'revexclude' && String(it.id) === 'exclude' && it.data) out.exclude = (it.data.ids || []).map(String);
  });
  return out;
}
/** Where a change to a teaching bank goes: the master draft (versioned, main storage), the group's local layer (versioned) or the storage itself. */
function examTeachTarget_(S) {
  var M = cvBaseOf_(S), st = cvState_(M);
  if (st.mode !== 'on') return { module: S, where: 'live' };
  if (S === M) return { module: M + '@draft', where: 'draft' };
  return { module: S + '@local', where: 'local' };
}
function examTeachQuestion_(q, now, i) {
  if (!q || typeof q !== 'object' || !EXAM_TEACH_TYPES[q.type]) return null;
  if (!String(q.stem || '').trim() || !String(q.topic || '').trim()) return null;
  var id = /^imp_[A-Za-z0-9_]{3,40}$/.test(String(q.id || '')) ? String(q.id) : 'imp_x' + now.toString(36) + i.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  var o = {}; ['type', 'stem', 'case', 'options', 'answer', 'answers', 'pairs', 'model', 'keywords', 'topic', 'difficulty', 'explanation', 'ref', 'images', 'sourceRef'].forEach(function (k) { if (q[k] !== undefined) o[k] = q[k]; });
  o.id = id; o.importedAt = now; o.stem = String(o.stem).slice(0, 4000); o.topic = String(o.topic).slice(0, 60);
  if (!Array.isArray(o.images)) o.images = [];
  o.images = o.images.filter(function (x) { return x && /^https:\/\//.test(String(x.url || '')); }).slice(0, 6).map(function (x) { return { url: String(x.url).slice(0, 500), caption: String(x.caption || '').slice(0, 300) }; });
  return o;
}
/** Several Content writes to one storage with ONE read of the sheet (data null = deleted). */
function examBulkWrite_(module, writes, now) {
  if (!writes.length) return;
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var at = {}; readAll_(SHEETS.CONTENT).forEach(function (r) { if (r.module === module) at[r.collection + '|' + r.id] = r; });
    var last = {}; writes.forEach(function (x, i) { last[x.collection + '|' + x.id] = i; });
    var fresh = [];
    writes.forEach(function (x, i) {
      if (last[x.collection + '|' + x.id] !== i) return;   // the same item twice: the last write wins
      var row = { module: module, collection: x.collection, id: String(x.id), updatedAt: now, updatedBy: 'teacher', deleted: x.data == null };
      Object.assign(row, packJson_(x.data == null ? null : x.data));
      var ex = at[x.collection + '|' + x.id];
      if (ex) updateRow_(SHEETS.CONTENT, ex._row, row); else fresh.push(row);
    });
    fresh.forEach(function (row) { appendRow_(SHEETS.CONTENT, row); });
  } finally { lock.releaseLock(); }
}
function examBankHook_(S, p) {
  return authed_(S, p, function (token) {
    if (p.action === 'examModuleScores') return examModuleScores_(S, String(p.examId || ''));
    if (!dirReadable_()) return dirErr_('The platform directory is empty.');
    var caller = examCaller_(token), src = examSources_(caller), a = String(p.action);
    var course = function (x) { return src.courses.filter(function (c) { return c.storage === String(x || ''); })[0]; };
    if (a === 'examCopySources') return { ok: true, admin: !!caller.admin, courses: src.courses, banks: src.banks.filter(function (b) { return b.storage !== S; }) };
    if (a === 'examCourseExtras') {
      if (!course(p.from)) return { ok: false, code: 'forbidden', error: 'You cannot read this teaching bank.' };
      var t = examTeachItems_(String(p.from)); return { ok: true, questions: t.questions, exclude: t.exclude };
    }
    if (a === 'examCopyFrom') {
      var b = src.banks.filter(function (x) { return x.storage === String(p.from || '') && x.storage !== S; })[0];
      if (!b) return { ok: false, code: 'forbidden', error: 'You cannot read this exam bank.' };
      var qs = []; readAll_(SHEETS.CONTENT).forEach(function (r) { if (r.module === b.storage && r.collection === 'priv:exambank' && !isTrue_(r.deleted)) { var q = unpackJson_(r); if (q) qs.push(q); } });
      return { ok: true, questions: qs.sort(function (x, y) { return (x.addedAt || 0) - (y.addedAt || 0); }) };
    }
    if (a === 'examCopyExam') return examCopyExam_(S, src, p);
    if (a === 'examTeachWrite') {   // add questions to a teaching bank; hide ids from Revision; remove imported questions
      var to = course(p.to); if (!to) return { ok: false, code: 'forbidden', error: 'You cannot change this teaching bank.' };
      var tg = examTeachTarget_(to.storage), now = Date.now(), added = [], bad = 0, w = [];
      (Array.isArray(p.add) ? p.add.slice(0, 300) : []).forEach(function (q, i) { var o = examTeachQuestion_(q, now, i); if (!o) { bad++; return; } w.push({ collection: 'importedquestions', id: o.id, data: o }); added.push(o.id); });
      if (added.length) { var bid = 'batch_x' + now.toString(36); w.push({ collection: 'importbatches', id: bid, data: { id: bid, fileName: 'Official exam bank', sourceType: 'exam', importedAt: now, count: added.length, questionIds: added } }); }
      var hide = Array.isArray(p.hide) ? p.hide.map(String).slice(0, 1000) : [], unhide = Array.isArray(p.unhide) ? p.unhide.map(String).slice(0, 1000) : [];
      if (hide.length || unhide.length) {
        var set = {}; examTeachItems_(to.storage).exclude.forEach(function (x) { set[x] = 1; }); hide.forEach(function (x) { set[x] = 1; }); unhide.forEach(function (x) { delete set[x]; });
        w.push({ collection: 'revexclude', id: 'exclude', data: { ids: Object.keys(set) } });
      }
      (Array.isArray(p.remove) ? p.remove.map(String).filter(function (x) { return /^imp_/.test(x); }).slice(0, 300) : []).forEach(function (id) { w.push({ collection: 'importedquestions', id: id, data: null }); });
      examBulkWrite_(tg.module, w, now);
      cvMarkWrite_(to.storage); if (tg.where === 'draft') cvMarkWrite_(cvBaseOf_(to.storage));
      return { ok: true, added: added, skipped: bad, where: tg.where, storage: to.storage };
    }
    return { ok: false, code: 'badaction', error: 'Unknown action.' };
  });
}

/* ---- Teaching lock of a combined exam (2.6): its candidates cannot use ANY teaching module of their group ---- */
/** The combined-exam storage of a group storage <module>-<code> → exams-<code>; '' for main storages and exam storages. */
function examGroupStorage_(S) { var M = cvBaseOf_(S); return M === S || M === EXAM_MODULE ? '' : EXAM_MODULE + '-' + S.slice(M.length + 1); }
/** The lock that applies to this student in this storage: the module's own official exams, or the group's combined exams. */
function examLockFor_(S, username) {
  if (typeof exTeachingLock_ !== 'function') return null;
  var X = examGroupStorage_(S);
  return exTeachingLock_(S, username) || (X ? exTeachingLock_(X, username) : null);
}
/** Student requests to a group's teaching module while a combined exam locks them (Code.gs checks the module's own exams itself). */
function examGroupLockHook_(S, act, p) {
  var X = examGroupStorage_(S); if (!X || typeof exLocks_ !== 'function' || act === 'studentLogout') return null;
  if (!exLocks_(X).length) return null;   // cached; nothing scheduled → nothing to do
  var username = '';
  if (p.stoken) { var st = studentFromSession_(S, p.stoken); if (st) username = st.username; }
  else if (act === 'studentLogin' && p.username && p.password) {   // only after a correct password (no hint about who is a candidate)
    var s = findStudent_(S, normUser_(p.username));
    if (s && safeEq_(hashIter_(String(p.password), s.pwSalt, Number(s.pwIter) || PW_ITER), s.pwHash)) username = s.username;
  }
  return username ? exTeachingLock_(X, username) : null;
}

/* ---- Results per module (2.6): each question of a combined exam remembers its module (source.course) ---- */
function examModuleScores_(S, examId) {
  if (typeof assessStore_ !== 'function') return { ok: false, error: 'Update Code.gs to 1.7 first.' };
  var titles = {}; if (dirReadable_()) dirAll_(DIR.MOD).forEach(function (m) { titles[m.moduleId] = m.title; });
  var st = assessStore_(S), mods = {}, rows = [], base = cvBaseOf_(S);
  st.list('exattempt').filter(function (x) { return x.examId === examId; }).forEach(function (x0) {
    var x = (typeof exGetAtt_ === 'function' ? exGetAtt_(S, st, x0.id) : null) || x0;
    if (x.status !== 'submitted' && x.status !== 'expired') return;
    var by = {};
    (x.questions || []).forEach(function (q, i) {
      var m = (q && q.source && q.source.course) || (base !== EXAM_MODULE ? base : '') || 'other', a = (x.answers || [])[i] || {};
      var o = by[m] || (by[m] = { marks: 0, max: 0, correct: 0 });
      o.max += 1; o.marks += Number(a.mark) || 0; if (a.correct) o.correct++;
      mods[m] = 1;
    });
    Object.keys(by).forEach(function (m) { by[m].marks = Math.round(by[m].marks * 100) / 100; by[m].percent = by[m].max ? Math.round(1000 * by[m].marks / by[m].max) / 10 : 0; });
    rows.push({ username: x.username, name: x.studentName || '', modules: by });
  });
  var list = Object.keys(mods).sort().map(function (m) { return { id: m, title: titles[m] || (m === 'other' ? 'Exam-only questions' : m) }; });
  return { ok: true, examId: examId, modules: list, results: rows };
}

/* ---- Copy an exam to another place (2.6): e.g. the module's normal-link exam → a group (Razi A) ---- */
/** The exam and its questions are copied into the target place (questions already copied there are reused, never
 *  duplicated). The copy is for that place's own students; it starts as a draft unless publish is asked for. */
function examCopyExam_(S, src, p) {
  if (typeof exPrivGet_ !== 'function' || typeof exBankBulkPut_ !== 'function') return { ok: false, error: 'Update Code.gs to 1.7 first.' };
  var to = src.banks.filter(function (b) { return b.storage === String(p.to || '') && b.storage !== S; })[0];
  if (!to) return { ok: false, code: 'forbidden', error: 'You cannot add exams to this place.' };
  var exam = exPrivGet_(S, 'exams', String(p.examId || '')); if (!exam) return { ok: false, error: 'Exam not found.' };
  var T = to.storage, now = Date.now(), base = cvBaseOf_(S), bank = {}, have = {}, items = [], ids = [], reused = 0;
  exPrivAll_(S, 'exambank').forEach(function (q) { bank[q.id] = q; });
  exPrivAll_(T, 'exambank').forEach(function (q) { if (q.source && q.source.kind === 'exambank' && q.source.origId) have[q.source.origId] = q.id; });
  (exam.questionIds || []).forEach(function (id, i) {
    var q = bank[id]; if (!q) return;
    if (have[id]) { ids.push(have[id]); reused++; return; }
    var o = JSON.parse(JSON.stringify(q)), nid = 'xq_' + now.toString(36) + i.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    o.id = nid; o.addedAt = now + i; o.updatedAt = now;
    o.source = { kind: 'exambank', origId: id, course: (q.source && q.source.course) || (base !== EXAM_MODULE ? base : '') };
    items.push(o); ids.push(nid); have[id] = nid;
  });
  if (!ids.length) return { ok: false, error: 'This exam has no questions to copy.' };
  exBankBulkPut_(T, items);
  var e = JSON.parse(JSON.stringify(exam)); delete e.stats; delete e.state;
  e.id = 'ex_' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36); e.questionIds = ids; e.candidates = 'all';
  e.createdAt = now; e.updatedAt = now; e.copiedFrom = { storage: S, examId: exam.id };
  var pub = !!p.publish && exam.status === 'published';
  if (pub && exPrivAll_(T, 'exams').some(function (x) { return x.status !== 'draft' && String(x.code).toUpperCase() === String(e.code).toUpperCase(); })) pub = false;
  e.status = pub ? 'published' : 'draft';
  exPrivPut_(T, 'exams', e.id, e); if (typeof exClearLocks_ === 'function') exClearLocks_(T, e.id);
  return { ok: true, storage: T, label: to.title + ' — ' + to.label, examId: e.id, status: e.status, copied: items.length, reused: reused };
}

/** Forget the cached public exam list of the place's group (or of the main page). */
function examListForget_(S) { var M = cvBaseOf_(S); CacheService.getScriptCache().remove('exlist:' + (S === M ? '_main' : S.slice(M.length + 1))); }

/* ======================================================================
 * Teaching Sessions (2.7, step 1) — the lectures of a group: schedule → live (attendance open) → ended / cancelled.
 * Modules contain learning content; Teaching Sessions contain teaching events. Each session belongs to ONE group and
 * ONE of its modules (delivery). Its attendance is the existing Code.gs attendance of that delivery's storage
 * (AttendanceSessions / AttendanceRecords, started and closed with Code.gs's own functions), so the module page, the
 * Drive copy and Results & attendance keep working unchanged. This sheet only adds what attendance alone does not
 * know: the schedule, the lateness rule, the rotating code, the lecture-materials link and the teacher's marks.
 * Statuses of a student in a session (computed, never stored as rows):
 *   present  checked in on time (or marked present by the teacher)
 *   late     checked in more than lateAfterMin minutes after the start (or marked late)
 *   excused  not checked in, excused by the teacher (does not count against the student)
 *   absent   an active member of the group who did not check in (only once the session has ended)
 * Access: the Admin (any group) or a personal teacher (only the deliveries assigned to them).
 * ====================================================================== */
var TS_ROTATE_MS = 45000;                       // a rotating code changes every 45 seconds while the session is live
var TS_GRACE_MS = 20000;                        // …and the code it replaced is still accepted for 20 s on the group page
var TS_FAIL_MAX = 10, TS_FAIL_WINDOW_S = 600;  // per student and group: 10 wrong codes → wait 10 minutes
var TS_STATUSES = { scheduled: 1, live: 1, ended: 1, cancelled: 1 };
var TS_MARKS = { present: 1, late: 1, excused: 1 };
var TS_ACTIONS = { tsGroups: 1, tsList: 1, tsSave: 1, tsStart: 1, tsState: 1, tsClose: 1, tsCancel: 1, tsDelete: 1, tsMark: 1, tsSettings: 1 };

function tsRoute_(p) {
  if (p.ttoken) return tAuthed_(p, function (u) {
    if (isTrue_(u.mustChange)) return { ok: false, code: 'mustchange', error: 'Please choose your own password first.' };
    var ids = {}; teacherDeliveries_(u.userId).forEach(function (d) { ids[d.deliveryId] = 1; });
    return tsDo_(p, { admin: false, name: String(u.name || u.username || ''), by: 'teacher:' + u.username, ids: ids });
  });
  return authed_(PORTAL_MODULE, p, function () {
    if (!dirReadable_()) return dirErr_('The platform directory is empty — add the institution, group and deliveries first.');
    return tsDo_(p, { admin: true, name: '', by: 'admin', ids: null });
  });
}
function tsDo_(p, who) {
  switch (String(p.action)) {
    case 'tsGroups': return tsGroups_(who);
    case 'tsList': return tsList_(who, p);
    case 'tsSave': return tsSave_(who, p);
    case 'tsStart': return tsStart_(who, p);
    case 'tsState': return tsState_(who, p);
    case 'tsClose': return tsClose_(who, p);
    case 'tsCancel': return tsCancel_(who, p);
    case 'tsDelete': return tsDelete_(who, p);
    case 'tsMark': return tsMark_(who, p);
    case 'tsSettings': return who.admin ? rosterWrite_(function () { return tsSettingsSave_(p); }) : { ok: false, code: 'forbidden', error: 'Only the platform administrator can change these settings.' };
  }
  return { ok: false, code: 'badaction', error: 'Unknown action.' };
}
/** Platform settings: one time zone for every date and time, and the attendance warning threshold (%). */
function tsSettings_() {
  var tz = getSetting_('ts:tz') || ''; if (!tz) { try { tz = Session.getScriptTimeZone(); } catch (e) { tz = 'UTC'; } }
  var th = Number(getSetting_('ts:threshold')); if (!(th >= 1 && th <= 100)) th = 75;
  return { timeZone: tz || 'UTC', threshold: th };
}
function tsSettingsSave_(p) {
  var tz = dirStr_(p.timeZone, 60), th = Number(p.threshold);
  if (tz && !/^[A-Za-z]+(\/[A-Za-z0-9_+\-]+){0,2}$|^UTC$/.test(tz)) return dirErr_('Choose a time zone such as Asia/Aden or UTC.');
  if (p.threshold != null && p.threshold !== '' && !(th >= 1 && th <= 100)) return dirErr_('The attendance warning threshold must be between 1 and 100 %.');
  if (tz) setSetting_('ts:tz', tz);
  if (p.threshold != null && p.threshold !== '') setSetting_('ts:threshold', String(Math.round(th)));
  return { ok: true, settings: tsSettings_() };
}
/** The teaching deliveries this caller may run sessions for, grouped by group (Official Exams are not teaching). */
function tsPlaces_(who) {
  var gr = {}; dirAll_(DIR.GROUP).forEach(function (g) { gr[g.groupId] = g; });
  var ins = {}; dirAll_(DIR.INST).forEach(function (i) { ins[i.institutionId] = i; });
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  var groups = {}, order = [];
  dirAll_(DIR.DELIV).forEach(function (d) {
    if (d.moduleId === EXAM_MODULE || (who.ids && !who.ids[d.deliveryId])) return;
    var g = gr[d.groupId], i = g && ins[g.institutionId], m = md[d.moduleId];
    if (!g || !i || !m) return;
    var x = groups[g.groupId];
    if (!x) { x = groups[g.groupId] = { groupId: g.groupId, label: (i.shortName || i.name) + ' · ' + g.name + (g.academicYear ? ' (' + g.academicYear + ')' : ''), academicYear: g.academicYear || '', linkCode: g.linkCode, active: !!(g.active && i.active), modules: [] }; order.push(g.groupId); }
    x.modules.push({ deliveryId: d.deliveryId, moduleId: m.moduleId, title: m.title || m.moduleId, icon: m.icon || '📘', storage: d.backendModule, active: !!(d.active && m.active) });
  });
  return order.map(function (k) { var x = groups[k]; x.modules.sort(function (a, b) { return a.title.localeCompare(b.title); }); return x; })
    .sort(function (a, b) { return a.label.localeCompare(b.label); });
}
function tsGroups_(who) { return { ok: true, admin: who.admin, teacherName: who.name, settings: tsSettings_(), groups: tsPlaces_(who) }; }
function tsGroupOf_(who, groupId) { return tsPlaces_(who).filter(function (g) { return g.groupId === String(groupId || ''); })[0] || null; }
function tsRows_() { var sh = getSS_().getSheetByName(DIR.TSES); return sh && sh.getLastRow() > 1 ? dirAll_(DIR.TSES) : []; }
function tsJson_(s, def) { try { var v = JSON.parse(String(s || '')); return v && typeof v === 'object' ? v : def; } catch (e) { return def; } }
/** One session the caller may act on (its module must be one of the caller's deliveries), with its place. */
function tsFind_(who, tsId) {
  var r = null; tsRows_().some(function (x) { if (x.tsId === String(tsId || '')) { r = x; return true; } return false; });
  if (!r) return { error: { ok: false, code: 'notfound', error: 'This teaching session was not found — it may have been deleted.' } };
  var g = tsGroupOf_(who, r.groupId), m = g && g.modules.filter(function (x) { return x.deliveryId === r.deliveryId; })[0];
  if (!m) return { error: { ok: false, code: 'forbidden', error: 'This group and module are not assigned to you.' } };
  return { row: r, group: g, mod: m };
}
/** The attendance session row (Code.gs) behind a live/ended teaching session, or null. */
function tsAttRow_(r) { return r.attSessionId ? findModuleAttSession_(r.backendModule, r.attSessionId) : null; }
/** The effective status: a session closed inside the module page counts as ended. */
function tsStatus_(r, att) { return r.status === 'live' && att && att.status !== 'active' ? 'ended' : r.status; }
function tsWrite_(r, patch) {
  var o = dirPublic_(r); Object.keys(patch).forEach(function (k) { o[k] = patch[k]; }); o.updatedAt = Date.now();
  updateRow_(DIR.TSES, r._row, o); Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
  return r;
}
/** Matches check-ins to the group's active members (Student ID, then email, then a unique name) and gives each member a status. */
function tsRegister_(r, members, records, ended) {
  var marks = tsJson_(r.marksJson, {}), ref = Math.max(Number(r.startAt) || 0, Number(r.startedAt) || 0), lateMs = (Number(r.lateAfterMin) || 0) * 60000;
  var idx = {}, nameCount = {}, rows = [], others = [];
  members.forEach(function (m) { var k = String(m.name || '').trim().toLowerCase(); if (k) nameCount[k] = (nameCount[k] || 0) + 1; });
  members.forEach(function (m) {
    var row = { studentId: m.studentId, name: m.name, rec: null };
    idx['id:' + m.studentId] = row;
    [m.email, String(m.studentId).replace(/[^a-z0-9._-]/g, '') + '@student.local'].forEach(function (e) { e = String(e || '').trim().toLowerCase(); if (e && !idx['em:' + e]) idx['em:' + e] = row; });
    var nk = String(m.name || '').trim().toLowerCase(); if (nk && nameCount[nk] === 1) idx['nm:' + nk] = row;
    rows.push(row);
  });
  records.forEach(function (q) {
    var id = normUser_(q.studentId), em = String(q.email || '').trim().toLowerCase(), nm = String(q.studentName || '').trim().toLowerCase();
    var row = (id && idx['id:' + id]) || (em && idx['em:' + em]) || (nm && idx['nm:' + nm]) || null;
    if (row && !row.rec) row.rec = q; else others.push(q);
  });
  function timed(q) { return lateMs > 0 && Number(q.scannedAt) > ref + lateMs ? 'late' : 'present'; }
  var list = rows.map(function (x) {
    var q = x.rec, mk = marks[x.studentId], st;
    if (q) st = mk === 'present' || mk === 'late' ? mk : timed(q);
    else st = mk === 'excused' ? 'excused' : ended ? 'absent' : 'waiting';
    return { studentId: x.studentId, name: x.name, status: st, at: q ? Number(q.scannedAt) || 0 : 0, recordId: q ? String(q.recordId || '') : '', marked: !!mk };
  });
  var extra = others.map(function (q) { return { studentId: String(q.studentId || ''), name: String(q.studentName || ''), status: timed(q), at: Number(q.scannedAt) || 0, recordId: String(q.recordId || ''), unlisted: true }; });
  var c = { present: 0, late: 0, excused: 0, absent: 0, waiting: 0 };
  list.forEach(function (x) { c[x.status]++; }); extra.forEach(function (x) { c[x.status]++; });
  return { students: list, unlisted: extra, counts: c, members: members.length };
}
function tsPublic_(r, att, reg) {
  var st = tsStatus_(r, att);
  return { tsId: r.tsId, groupId: r.groupId, deliveryId: r.deliveryId, moduleId: r.moduleId, storage: r.backendModule, title: r.title, chapter: r.chapter, academicYear: r.academicYear,
    startAt: Number(r.startAt) || 0, durationMin: Number(r.durationMin) || 0, lateAfterMin: Number(r.lateAfterMin) || 0, rotate: isTrue_(r.rotate), materialsUrl: r.materialsUrl || '',
    teacher: r.teacher, status: st, startedAt: Number(r.startedAt) || 0, endedAt: Number(r.endedAt) || (att && st === 'ended' ? Number(att.endedAt) || 0 : 0),
    counts: reg ? reg.counts : null, members: reg ? reg.members : 0 };
}
function tsMembers_(groupId) { return (rpMembers_()[groupId] || []).filter(function (m) { return m.active; }).sort(function (a, b) { return a.studentId.localeCompare(b.studentId); }); }

/** A group's sessions (only the caller's modules) with counts, and each student's attendance over the ended sessions. */
function tsList_(who, p) {
  var g = tsGroupOf_(who, p.groupId); if (!g) return { ok: false, code: 'forbidden', error: 'Choose one of your groups.' };
  var mine = {}; g.modules.forEach(function (m) { mine[m.deliveryId] = m; });
  var rows = tsRows_().filter(function (r) { return r.groupId === g.groupId && mine[r.deliveryId]; });
  var members = tsMembers_(g.groupId), att = {}, recs = {};
  rpRows_(SHEETS.ATT_SESSIONS).forEach(function (a) { att[a.module + '|' + a.sessionId] = a; });
  rpRows_(SHEETS.ATT_RECORDS).forEach(function (q) { (recs[q.sessionId] = recs[q.sessionId] || []).push(q); });
  var per = {}; members.forEach(function (m) { per[m.studentId] = { studentId: m.studentId, name: m.name, present: 0, late: 0, excused: 0, absent: 0, counted: 0 }; });
  var sessions = rows.map(function (r) {
    var a = r.attSessionId ? att[r.backendModule + '|' + r.attSessionId] || null : null, st = tsStatus_(r, a);
    var reg = r.attSessionId ? tsRegister_(r, members, recs[r.attSessionId] || [], st === 'ended') : null;
    if (reg && st === 'ended') reg.students.forEach(function (x) { var s = per[x.studentId]; if (!s) return; s[x.status]++; if (x.status !== 'excused') s.counted++; });
    var o = tsPublic_(r, a, reg); o.module = mine[r.deliveryId].title; o.icon = mine[r.deliveryId].icon; return o;
  }).sort(function (a, b) { return (b.startAt || b.startedAt) - (a.startAt || a.startedAt); });
  var set = tsSettings_();
  var students = Object.keys(per).map(function (k) {
    var s = per[k], att2 = s.present + s.late; s.attended = att2;
    s.pct = s.counted ? Math.round(att2 / s.counted * 100) : null; s.warn = s.pct != null && s.pct < set.threshold; return s;
  });
  return { ok: true, serverTime: Date.now(), settings: set, group: g, sessions: sessions, students: students };
}

function tsClean_(who, g, x, cur) {
  var out = {}, title = dirStr_(x.title, 120);
  if (title.length < 2) return { error: 'Enter the lecture title (e.g. “Lecture 3 — Acute inflammation”).' };
  out.title = title; out.chapter = dirStr_(x.chapter, 120);
  if (!cur || cur.status === 'scheduled') {
    var m = g.modules.filter(function (y) { return y.deliveryId === String(x.deliveryId || ''); })[0];
    if (!m) return { error: 'Choose the module of this lecture.' };
    if (!m.active) return { error: 'This module is not active for the group (Platform directory → Deliveries).' };
    out.deliveryId = m.deliveryId; out.moduleId = m.moduleId; out.backendModule = m.storage;
  }
  var start = dirTime_(x.startAt); if (!start) return { error: 'Choose the date and time of the lecture.' };
  out.startAt = start;
  var dur = x.durationMin === '' || x.durationMin == null ? 90 : Math.round(Number(x.durationMin));
  if (!(dur >= 10 && dur <= 600)) return { error: 'The duration must be between 10 and 600 minutes.' };
  var late = x.lateAfterMin === '' || x.lateAfterMin == null ? 15 : Math.round(Number(x.lateAfterMin));
  if (!(late >= 0 && late <= 180)) return { error: '“Late after” must be between 0 (never late) and 180 minutes.' };
  out.durationMin = dur; out.lateAfterMin = late; out.rotate = !!x.rotate;
  var u = dirStr_(x.materialsUrl, 300);
  if (u && !/^https:\/\/[^\s]+$/.test(u)) return { error: 'The lecture-materials link must start with https://' };
  out.materialsUrl = u; out.teacher = dirStr_(x.teacher, 80) || who.name || '';
  return out;
}
/** Create (status scheduled) or edit a session. A started session keeps its module; its other details can still be corrected. */
function tsSave_(who, p) {
  var x = p.session || {};
  return rosterWrite_(function () {
    if (x.tsId) {
      var f = tsFind_(who, x.tsId); if (f.error) return f.error;
      if (f.row.status === 'cancelled') return dirErr_('This lecture is cancelled — restore it first.');
      var c = tsClean_(who, f.group, x, f.row); if (c.error) return dirErr_(c.error);
      tsWrite_(f.row, c);
      return { ok: true, session: tsPublic_(f.row, tsAttRow_(f.row), null) };
    }
    var g = tsGroupOf_(who, x.groupId); if (!g) return { ok: false, code: 'forbidden', error: 'Choose one of your groups.' };
    var c2 = tsClean_(who, g, x, null); if (c2.error) return dirErr_(c2.error);
    var now = Date.now(), rec = { tsId: dirNewId_('TS', DIR.TSES, 'tsId'), groupId: g.groupId, academicYear: g.academicYear || '', status: 'scheduled', attSessionId: '', startedAt: '', endedAt: '',
      marksJson: '{}', codeAt: '', createdBy: who.by, createdAt: now, updatedAt: now };
    Object.keys(c2).forEach(function (k) { rec[k] = c2[k]; });
    appendRow_(DIR.TSES, rec);
    return { ok: true, session: tsPublic_(rec, null, null) };
  });
}
/** Opens attendance: a normal Code.gs attendance session of the delivery's storage (one live session per group). */
function tsStart_(who, p) {
  var tsId = String(p.tsId || '');
  if (!tsId && p.session) { var s = tsSave_(who, { session: Object.assign({}, p.session, { tsId: '' }) }); if (!s.ok) return s; tsId = s.session.tsId; }
  var f = tsFind_(who, tsId); if (f.error) return f.error;
  if (f.row.status !== 'scheduled') return dirErr_(f.row.status === 'cancelled' ? 'This lecture is cancelled — restore it first.' : 'Attendance for this lecture has already been opened.');
  if (!f.mod.active) return dirErr_('This module is not active for the group (Platform directory → Deliveries).');
  var busy = tsRows_().filter(function (r) { return r.groupId === f.row.groupId && r.status === 'live' && tsStatus_(r, tsAttRow_(r)) === 'live'; })[0];
  if (busy) return { ok: false, code: 'busy', error: 'Another lecture of this group is live (“' + busy.title + '”). Close its attendance first.' };
  var mod = dirFind_(DIR.MOD, 'moduleId', f.row.moduleId) || {};
  var a = actionStartAttendance_(f.row.backendModule, { sessionTitle: f.row.title, academicYear: f.row.academicYear, course: mod.title || f.row.moduleId, chapter: f.row.chapter, teacher: f.row.teacher });
  if (!a || !a.ok) return a || dirErr_('Attendance could not be opened.');
  var now = Date.now();
  rosterWrite_(function () {
    var r = tsFind_(who, tsId).row;
    // the scheduled time is kept when attendance opens around it; a lecture moved to another time (opened more than 1 h early
    // or 12 h late) takes the real start time, so the history shows when it really took place
    var at = Number(r.startAt) || 0, keep = at && at <= now + 3600e3 && at >= now - 12 * 3600e3;
    tsWrite_(r, { status: 'live', attSessionId: a.sessionId, startedAt: now, codeAt: now, startAt: keep ? at : now });
  });
  livePostSystem_(f.row.groupId, '🔴 Lecture started: ' + f.row.title + ' — ' + (mod.title || f.row.moduleId) + (f.row.chapter ? ' · ' + f.row.chapter : '') + (f.row.teacher ? ' (' + f.row.teacher + ')' : '') + '. Check in with the attendance code on your group page.', 'ts-' + tsId + '-start');
  return tsState_(who, { tsId: tsId });
}
/** The live screen: the current code (a rotating code is renewed when due), the check-ins and who has not checked in yet. */
function tsState_(who, p) {
  var f = tsFind_(who, p.tsId); if (f.error) return f.error;
  var r = f.row, att = tsAttRow_(r), st = tsStatus_(r, att), now = Date.now(), code = '', next = 0;
  if (st === 'live' && att) {
    code = String(att.code || '');
    if (isTrue_(r.rotate)) {
      var due = (Number(r.codeAt) || 0) + TS_ROTATE_MS, c = CacheService.getScriptCache();
      if (now >= due && !c.get('tsrot:' + r.tsId)) {
        c.put('tsrot:' + r.tsId, '1', 20);   // two open teacher screens renew the code only once
        var old = code, g2 = actionRegenerateAttendanceCode_(r.backendModule, { sessionId: r.attSessionId });
        // the previous code still works for TS_GRACE_MS on the group page (a student who was typing it)
        if (g2 && g2.ok) { code = g2.code; rosterWrite_(function () { var fr = tsFind_(who, r.tsId).row; tsWrite_(fr, { codeAt: now, prevCode: old, prevCodeUntil: now + TS_GRACE_MS }); }); due = now + TS_ROTATE_MS; }
      }
      next = Math.max(0, due - now);
    }
  }
  var recs = r.attSessionId ? readAll_(SHEETS.ATT_RECORDS).filter(function (q) { return q.sessionId === r.attSessionId; }) : [];
  var reg = r.attSessionId ? tsRegister_(r, tsMembers_(r.groupId), recs, st === 'ended') : null;
  var o = tsPublic_(r, att, reg); o.module = f.mod.title; o.icon = f.mod.icon;
  return { ok: true, serverTime: now, settings: tsSettings_(), session: o, code: code, rotateInMs: next,
    students: reg ? reg.students : [], unlisted: reg ? reg.unlisted : [] };
}
function tsClose_(who, p) {
  var f = tsFind_(who, p.tsId); if (f.error) return f.error;
  if (f.row.status !== 'live') return dirErr_('Attendance for this lecture is not open.');
  var att = tsAttRow_(f.row);
  if (att && att.status === 'active') { var c = actionCloseAttendance_(f.row.backendModule, { sessionId: f.row.attSessionId }); if (!c || !c.ok) return c || dirErr_('Attendance could not be closed.'); }
  var now = Date.now();
  rosterWrite_(function () { var r = tsFind_(who, p.tsId).row; tsWrite_(r, { status: 'ended', endedAt: now }); });
  livePostSystem_(f.row.groupId, '■ Lecture ended: ' + f.row.title + ' — ' + f.mod.title + '. Attendance is closed.', 'ts-' + p.tsId + '-end');
  return tsState_(who, { tsId: p.tsId });
}
/** Cancel a lecture that has not started (it stays in the history but never counts), or restore it (undo). */
function tsCancel_(who, p) {
  return rosterWrite_(function () {
    var f = tsFind_(who, p.tsId); if (f.error) return f.error;
    if (p.undo) { if (f.row.status !== 'cancelled') return dirErr_('This lecture is not cancelled.'); tsWrite_(f.row, { status: 'scheduled' }); }
    else { if (f.row.status !== 'scheduled') return dirErr_(f.row.status === 'cancelled' ? 'This lecture is already cancelled.' : 'Only a lecture that has not started can be cancelled.'); tsWrite_(f.row, { status: 'cancelled' }); }
    return { ok: true, session: tsPublic_(f.row, null, null) };
  });
}
/** Delete a scheduled or cancelled lecture (no attendance exists for it). Started lectures are kept. */
function tsDelete_(who, p) {
  return rosterWrite_(function () {
    var f = tsFind_(who, p.tsId); if (f.error) return f.error;
    if (f.row.status !== 'scheduled' && f.row.status !== 'cancelled') return dirErr_('A lecture whose attendance was opened is kept in the history and cannot be deleted.');
    deleteRow_(DIR.TSES, f.row._row);
    return { ok: true };
  });
}
/** The teacher's marks: present / late (also checks in a student who could not), excused, clear (back to the computed status),
 *  remove (deletes one check-in, e.g. someone who checked in from outside the room). */
function tsMark_(who, p) {
  var f = tsFind_(who, p.tsId); if (f.error) return f.error;
  var r = f.row, mark = String(p.mark || ''), sid = normUser_(p.studentId);
  if (!r.attSessionId || r.status === 'scheduled' || r.status === 'cancelled') return dirErr_('Open the attendance of this lecture first.');
  if (mark === 'remove') {
    var d = actionDeleteAttendanceRecord_(r.backendModule, { sessionId: r.attSessionId, recordId: String(p.recordId || '') });
    if (!d || !d.ok) return d || dirErr_('The check-in could not be removed.');
    if (sid) rosterWrite_(function () { var fr = tsFind_(who, p.tsId).row, mk = tsJson_(fr.marksJson, {}); delete mk[sid]; tsWrite_(fr, { marksJson: JSON.stringify(mk) }); });
    return tsState_(who, { tsId: p.tsId });
  }
  if (!TS_MARKS[mark] && mark !== 'clear') return dirErr_('Unknown mark.');
  var m = tsMembers_(r.groupId).filter(function (x) { return x.studentId === sid; })[0];
  if (!m) return dirErr_('This student is not an active member of the group.');
  if (mark === 'present' || mark === 'late') {
    var st = tsState_(who, { tsId: p.tsId }), me = st.ok ? st.students.filter(function (x) { return x.studentId === sid; })[0] : null;
    if (me && !me.recordId) {
      var att = tsAttRow_(r); if (!att) return dirErr_('The attendance of this lecture was not found.');
      var rec = recordAttendance_(att, { name: m.name, studentId: m.studentId, email: m.email || '', participantId: 'acct:' + m.studentId });
      if (!rec || !rec.ok) return rec || dirErr_('The check-in could not be recorded.');
      if (att.status !== 'active' && att.driveUrl) {   // keep the Drive copy of a closed session in step, as Code.gs does
        var all = readAll_(SHEETS.ATT_RECORDS).filter(function (q) { return q.sessionId === att.sessionId; }), sync = trySyncAttendanceToDrive_(att, all);
        att.driveStatus = sync.status; att.driveUrl = sync.url || att.driveUrl || ''; att.driveError = sync.error || ''; saveAttSession_(att);
      }
    }
  }
  rosterWrite_(function () {
    var fr = tsFind_(who, p.tsId).row, mk = tsJson_(fr.marksJson, {});
    if (mark === 'clear') delete mk[sid]; else mk[sid] = mark;
    tsWrite_(fr, { marksJson: JSON.stringify(mk) });
  });
  return tsState_(who, { tsId: p.tsId });
}

/* ---------------- Teaching Sessions on the group page (2.8, step 2) ----------------
 * The student proves who they are with a session of one of the group's modules (exactly as portalGroupRefresh), and
 * must be an active member of the group. They see the group's live lecture, the upcoming ones and their own attendance —
 * never anyone else's — and check in with the code on the screen (a rotating code that has just changed is still accepted
 * for 20 s). The check-in is the module's own attendance record (participant "acct:<Student ID>", the same as a check-in
 * inside the module, so the two never count twice). */
function tsStudent_(p) {
  var G = portalGroup_(p.g); if (!G) return { error: PORTAL_NOGROUP };
  var have = p.sessions && typeof p.sessions === 'object' ? p.sessions : {}, st = null;
  G.modules.some(function (m) { var t = have[m.moduleKey]; if (t && !st) st = studentFromSession_(m._storage, String(t)); return !!st; });
  var mem = st && rosterMember_(G.group.groupId, st.username, true);
  if (!mem) return { error: { ok: false, code: 'studentauth', error: 'Please sign in again.' } };
  var mods = {}; G.modules.forEach(function (m) { if (m.moduleKey !== EXAM_MODULE) mods[m._storage] = m; });
  return { G: G, st: st, mem: mem, mods: mods };
}
function tsStudentRows_(S) { return tsRows_().filter(function (r) { return r.groupId === S.G.group.groupId && S.mods[r.backendModule]; }); }
function tsStuLecture_(r, m) {
  return { title: r.title, module: m.title, icon: m.icon, chapter: r.chapter, teacher: r.teacher, startAt: Number(r.startAt) || 0, durationMin: Number(r.durationMin) || 0,
    materialsUrl: r.materialsUrl || '', moduleUrl: m.url || '', moduleKey: m.moduleKey };
}
function tsStudentSessions_(p) {
  var S = tsStudent_(p); if (S.error) return S.error;
  var now = Date.now(), rows = tsStudentRows_(S), att = {}, mine = {};
  rpRows_(SHEETS.ATT_SESSIONS).forEach(function (a) { if (S.mods[a.module]) att[a.module + '|' + a.sessionId] = a; });
  var recs = {}; rpRows_(SHEETS.ATT_RECORDS).forEach(function (q) { (recs[q.sessionId] = recs[q.sessionId] || []).push(q); });
  var members = tsMembers_(S.G.group.groupId), live = [], upcoming = [], recent = [], sum = { present: 0, late: 0, excused: 0, absent: 0, counted: 0 };
  rows.forEach(function (r) {
    var a = r.attSessionId ? att[r.backendModule + '|' + r.attSessionId] || null : null, status = tsStatus_(r, a), m = S.mods[r.backendModule];
    if (status === 'scheduled') { if (Number(r.startAt) >= now - 3 * 3600e3) upcoming.push(tsStuLecture_(r, m)); return; }
    if (status === 'cancelled') { if (Number(r.startAt) >= now - 7 * 864e5) upcoming.push(Object.assign(tsStuLecture_(r, m), { cancelled: true })); return; }
    if (!r.attSessionId) return;
    var reg = tsRegister_(r, members, recs[r.attSessionId] || [], status === 'ended');
    var me = reg.students.filter(function (x) { return x.studentId === S.st.username; })[0], my = me ? me.status : (status === 'ended' ? 'absent' : 'waiting');
    var o = Object.assign(tsStuLecture_(r, m), { me: my, at: me ? me.at : 0 });
    if (status === 'live') { o.tsId = r.tsId; o.registered = !!findStudent_(r.backendModule, S.st.username); live.push(o); }
    else { o.endedAt = Number(r.endedAt) || (a ? Number(a.endedAt) || 0 : 0); recent.push(o); sum[my] = (sum[my] || 0) + 1; if (my !== 'excused') sum.counted++; }
  });
  upcoming.sort(function (a, b) { return a.startAt - b.startAt; });
  recent.sort(function (a, b) { return b.startAt - a.startAt; });
  var set = tsSettings_(), attended = sum.present + sum.late, pct = sum.counted ? Math.round(attended / sum.counted * 100) : null;
  return { ok: true, serverTime: now, settings: set, live: live, upcoming: upcoming.slice(0, 8), recent: recent.slice(0, 6),
    mine: { attended: attended, late: sum.late, excused: sum.excused, absent: sum.absent, counted: sum.counted, pct: pct, warn: pct != null && pct < set.threshold } };
}
function tsStudentCheckIn_(p) {
  var S = tsStudent_(p); if (S.error) return S.error;
  var code = normAttCode_(p.code), now = Date.now(), c = CacheService.getScriptCache(), fk = 'tsfail:' + S.G.group.groupId + ':' + S.st.username, fails = Number(c.get(fk) || 0);
  if (fails >= TS_FAIL_MAX) return { ok: false, code: 'locked', error: 'Too many wrong codes. Please wait 10 minutes, or ask your teacher to mark you present.' };
  if (code.length < 4) return { ok: false, code: 'badcode', error: 'Type the attendance code shown on the screen.' };
  var hit = null;
  tsStudentRows_(S).some(function (r) {
    if (r.status !== 'live' || !r.attSessionId) return false;
    var a = findModuleAttSession_(r.backendModule, r.attSessionId); if (!a || a.status !== 'active') return false;
    if (normAttCode_(a.code) === code || (r.prevCode && normAttCode_(r.prevCode) === code && now <= Number(r.prevCodeUntil))) { hit = { r: r, a: a }; return true; }
    return false;
  });
  if (!hit) { c.put(fk, String(fails + 1), TS_FAIL_WINDOW_S); return { ok: false, code: 'badcode', error: 'That code is not valid. Check the code on the screen and try again — it may have just changed.' }; }
  var acc = findStudent_(hit.r.backendModule, S.st.username);
  if (!acc || !isTrue_(acc.active)) return { ok: false, code: 'notregistered', error: 'You are not registered for the module of this lecture (' + S.mods[hit.r.backendModule].title + '). Please tell your teacher.' };
  var rec = recordAttendance_(hit.a, { name: acc.name, studentId: acc.username, email: acc.email || '', participantId: 'acct:' + acc.username });
  if (!rec || !rec.ok) return rec || { ok: false, error: 'Your attendance could not be recorded. Please try again.' };
  c.remove(fk);
  var ref = Math.max(Number(hit.r.startAt) || 0, Number(hit.r.startedAt) || 0), late = (Number(hit.r.lateAfterMin) || 0) * 60000, at = Number(rec.scannedAt) || now;
  var mk = tsJson_(hit.r.marksJson, {})[acc.username];
  return { ok: true, alreadyRecorded: !!rec.alreadyRecorded, at: at, status: mk === 'present' || mk === 'late' ? mk : late > 0 && at > ref + late ? 'late' : 'present', title: hit.r.title, module: S.mods[hit.r.backendModule].title };
}

/* ---------------- Group Live Classroom (2.9, step 3) ----------------
 * ONE Live Classroom per group, in the storage "live-<link code>", run by Code.gs's own Live Classroom engine (chat,
 * replies, reactions, pins, announcements, files, unread counts) — nothing in Code.gs changes. The platform guards it:
 *   • students enter only through liveOpen (a session of one of the group's modules + an active membership); their
 *     classroom identity is derived from a secret (script property LIVE_ID_SALT), so it cannot be guessed, and EVERY later
 *     request must carry the group sessions again (checked here, cached 5 minutes) and that identity;
 *   • teachers: the Admin (any group) or a personal teacher with at least one module of the group (liveTeacherOpen →
 *     a teacher session of that storage, recorded in PortalGrants, so removing the teacher's access ends it);
 *   • only the Live Classroom actions work on a "live-…" storage (no content, accounts, attendance or exams there),
 *     and joining with the classroom code directly is refused.
 * Teaching Sessions post "Lecture started / ended" announcements (with the module) into the group's classroom. */
var LIVE_MODULE = 'live';
var LIVE_ACTIONS = { liveSync: 1, liveHistory: 1, liveContext: 1, livePost: 1, liveEdit: 1, liveDelete: 1, livePin: 1, liveReact: 1, liveSearch: 1, liveMembers: 1,
  liveNotifications: 1, liveMarkRead: 1, liveSetPrefs: 1, liveTyping: 1, liveUploadInit: 1, liveUploadChunk: 1, liveUploadStatus: 1, liveFileChunk: 1 };
function liveStorageOf_(g) { return LIVE_MODULE + '-' + g.linkCode; }
function liveIsStorage_(S) { return String(S).indexOf(LIVE_MODULE + '-') === 0; }
function liveSalt_() {
  var pr = PropertiesService.getScriptProperties(), s = pr.getProperty('LIVE_ID_SALT');
  if (!s) { s = randomHex_(24); pr.setProperty('LIVE_ID_SALT', s); }
  return s;
}
/** The student's classroom identity (an email the engine turns into the participant id) — secret-derived, never shown. */
function liveIdentity_(S, username) { return 's' + sha256Hex_(liveSalt_() + '|' + S + '|' + username).slice(0, 24) + '@classroom.local'; }
/** First use of a group's classroom: a random classroom code (nobody types it) and the title shown in notifications. */
function liveEnsure_(S, label) {
  if (!getSetting_('livepw:' + S)) setSetting_('livepw:' + S, randomHex_(12).toUpperCase());
  var t = ('Live Classroom — ' + label).slice(0, 80);
  if (getSetting_('modtitle:' + S) !== t) { setSetting_('modtitle:' + S, t); CacheService.getScriptCache().remove('modtitle:' + S); }
}
function liveGroupLabel_(g) { var i = dirFind_(DIR.INST, 'institutionId', g.institutionId) || {}; return (i.shortName || i.name || '') + ' · ' + g.name; }
/** The live lecture of a group, if any (shown at the top of the classroom). */
function liveLecture_(groupId) {
  var md = {}; dirAll_(DIR.MOD).forEach(function (m) { md[m.moduleId] = m; });
  var r = tsRows_().filter(function (x) { return x.groupId === groupId && x.status === 'live' && tsStatus_(x, tsAttRow_(x)) === 'live'; })[0];
  return r ? { title: r.title, module: (md[r.moduleId] || {}).title || r.moduleId, icon: (md[r.moduleId] || {}).icon || '📘', teacher: r.teacher, startedAt: Number(r.startedAt) || 0 } : null;
}
function liveOpen_(p) {
  var S0 = tsStudent_(p); if (S0.error) return S0.error;
  var g = S0.G.group, S = liveStorageOf_(g);
  var xl = liveExamLock_(S, S0.st.username); if (xl) return xl;
  liveEnsure_(S, liveGroupLabel_(g));
  var j = liveSvc_().join(S, { classCode: getSetting_('livepw:' + S), name: S0.mem.name || S0.st.name || S0.st.username, email: liveIdentity_(S, S0.st.username) });
  if (!j || !j.ok) return j || { ok: false, error: 'The classroom could not be opened.' };
  return { ok: true, storage: S, participantId: j.participantId, name: j.name, role: 'student', title: 'Live Classroom — ' + g.name, lecture: liveLecture_(g.groupId), timeZone: tsSettings_().timeZone };
}
/** Admin (token) or a personal teacher (ttoken) with a module of the group → a teacher session of the group's classroom. */
function liveTeacherOpen_(p, portalToken, u, ses) {
  var g = dirFind_(DIR.GROUP, 'groupId', String(p.groupId || '')); if (!g) return dirErr_('Choose a group.');
  var mine = null;
  if (u) {
    mine = teacherDeliveries_(u.userId).filter(function (d) { return d.groupId === g.groupId && d.moduleId !== EXAM_MODULE; })[0];
    if (!mine) return { ok: false, code: 'forbidden', error: 'No module of this group is assigned to you.' };
  }
  var S = liveStorageOf_(g), now = Date.now(), exp = now + SESSION_TTL_MS, token = Utilities.getUuid() + '-' + randomHex_(16);
  liveEnsure_(S, liveGroupLabel_(g));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (u) exp = Math.min(exp, Number(ses.row.expiresAt) || exp);
    else readAll_(SHEETS.SESSIONS).forEach(function (r) { if (r.token === portalToken && Number(r.expiresAt) > now) exp = Math.min(exp, Number(r.expiresAt)); });
    appendRow_(SHEETS.SESSIONS, { module: S, token: token, createdAt: now, expiresAt: exp });
    if (u) appendRow_(DIR.GRANTS, { userId: u.userId, deliveryId: mine.deliveryId, backendModule: S, tokenHash: tHash_('pg', token), sessionHash: ses.hash, createdAt: now, expiresAt: exp });
  } finally { lock.releaseLock(); }
  return { ok: true, storage: S, token: token, expiresAt: exp, role: 'teacher', name: 'Teacher', title: 'Live Classroom — ' + g.name, lecture: liveLecture_(g.groupId), timeZone: tsSettings_().timeZone };
}
/** Every request to a "live-…" storage passes here first (portalHook_). null = let the engine handle it. */
function liveGate_(S, act, p) {
  if (!LIVE_ACTIONS[act]) return { ok: false, code: 'badmodule', error: act === 'liveJoin' ? 'Open the Live Classroom from your group page.' : 'Unknown module.' };
  if (p.token) return null;   // teacher: the engine checks the teacher session of this storage
  var pid = String(p.participantId || ''), toks = p.gs && typeof p.gs === 'object' ? p.gs : {};
  if (!pid) return { ok: false, code: 'auth', error: 'Please open the classroom again.' };
  var c = CacheService.getScriptCache(), ck = 'lvg:' + sha256Hex_(S + '|' + pid + '|' + JSON.stringify(Object.keys(toks).sort().map(function (k) { return [k, String(toks[k])]; })));
  var who = c.get(ck);
  if (!who) {
    var code = S.slice(LIVE_MODULE.length + 1), g = null;
    if (dirReadable_()) dirAll_(DIR.GROUP).some(function (x) { if (x.linkCode === code) { g = x; return true; } return false; });
    var st = g && tsStudent_({ g: g.linkCode, sessions: toks });
    if (!st || st.error || LE_pidFor(S, liveIdentity_(S, st.st.username)) !== pid) return { ok: false, code: 'auth', error: 'Please open the classroom again from your group page.' };
    who = st.st.username; c.put(ck, who, 300);
  }
  return liveExamLock_(S, who);
}
/** A combined exam of the group with "close all teaching modules" closes the group's classroom for its candidates too. */
function liveExamLock_(S, username) {
  var X = EXAM_MODULE + '-' + S.slice(LIVE_MODULE.length + 1);
  if (typeof exLocks_ !== 'function' || !exLocks_(X).length) return null;
  return exTeachingLock_(X, username) || null;
}
/** A system announcement in a group's classroom (lecture started / ended). Never stops the caller if it fails. */
function livePostSystem_(groupId, body, clientId) {
  try {
    var g = dirFind_(DIR.GROUP, 'groupId', groupId); if (!g) return;
    var S = liveStorageOf_(g); liveEnsure_(S, liveGroupLabel_(g));
    var st = liveStore_(); st.isTeacherToken = function () { return true; };
    LE_createService(st).post(S, { token: 'platform', body: body, kind: 'announcement', clientId: clientId });
  } catch (e) { console.error('live classroom announcement: ' + (e && e.message || e)); }
}

/* ======================================================================
 * Self-check (2.6) — run it in the Apps Script editor BEFORE every Deploy:
 * choose "platformCheck" in the function list and press ▶ Run, then read the Execution log.
 * It only reads the code and the module lists; it changes nothing and never prints a key.
 * ====================================================================== */
function platformCheck() {
  var errors = [], warnings = [], okLines = [];
  var src = function (f) { try { return typeof f === 'function' ? String(f) : ''; } catch (e) { return ''; } };
  // 1. Code.gs sends requests to Portal.gs (the one line in route_)
  var r = src(typeof route_ === 'function' ? route_ : null);
  if (!r) errors.push('Code.gs has no route_ function — is Code.gs in this project?');
  else if (!/portalHook_\s*\(/.test(r)) errors.push('The Portal line is MISSING in Code.gs → route_. Below the line with EX_PUBLIC_ACTIONS[action] add:\n    if (typeof portalHook_ === \'function\') { var hp = portalHook_(module, p); if (hp) return hp; }');
  else {
    var iHook = r.search(/portalHook_\s*\(/), iGate = r.search(/gateRequest_\s*\(/);
    if (iGate >= 0 && iGate < iHook) errors.push('The Portal line is in route_, but BELOW the student sign-in check (gateRequest_). Move it up, directly below the line with EX_PUBLIC_ACTIONS[action].');
    else okLines.push('Portal line in route_: present, in the right place.');
  }
  // 2. speed lines in authed_ (optional, but they were added once)
  var au = src(typeof authed_ === 'function' ? authed_ : null), iPut = au.search(/tcache\.put\s*\(/), iFound = au.search(/found\s*=\s*rows\s*\[/);
  if (iPut >= 0 && (iFound < 0 || iPut < iFound)) errors.push('In Code.gs → authed_, the speed line "tcache.put(…)" is in the WRONG place (before the session is looked up) — every teacher action fails with "Cannot read properties of undefined (reading \'expiresAt\')". Move it directly above the LAST line "return fn(token);" of authed_.');
  else if (/tcache/.test(au)) okLines.push('Speed lines in authed_: present, in the right place.');
  else warnings.push('The speed lines in authed_ are missing (optional — teacher actions are slower without them). See SETUP.md → Speed → "Faster teacher actions".');
  // 3. every module with student sign-in has a valid content key (and the other way round)
  var sam = typeof STUDENT_AUTH_MODULES === 'object' && STUDENT_AUTH_MODULES ? STUDENT_AUTH_MODULES : {}, ck = typeof CONTENT_KEYS === 'object' && CONTENT_KEYS ? CONTENT_KEYS : {};
  var keyOk = function (k) { k = String(k || ''); if (!k || /^__/.test(k)) return false; try { return Utilities.base64Decode(k).length === 32; } catch (e) { return false; } };
  Object.keys(sam).filter(function (m) { return sam[m]; }).forEach(function (m) {
    if (!(m in ck)) errors.push('Module "' + m + '" is in STUDENT_AUTH_MODULES but has NO entry in CONTENT_KEYS.');
    else if (/^__/.test(String(ck[m]))) warnings.push('The content key of "' + m + '" is still a placeholder — fine only if this module runs on another backend; otherwise paste its real key.');
    else if (!keyOk(ck[m])) errors.push('The content key of "' + m + '" is not a valid key (it must be 44 characters ending in "=", copied whole, in quotes).');
    else okLines.push('Module "' + m + '": student sign-in on, content key valid.');
  });
  Object.keys(ck).forEach(function (m) { if (!sam[m] && keyOk(ck[m])) warnings.push('Module "' + m + '" has a content key but is not in STUDENT_AUTH_MODULES — its students cannot sign in yet.'); });
  // 4. the front-page list and the platform directory only name modules the backend knows
  try {
    portalRegistry_().forEach(function (m) {
      if (m.handoff === 'neo' && m.moduleKey && !m.backend && !sam[m.moduleKey]) warnings.push('Front-page card "' + m.title + '" uses module key "' + m.moduleKey + '", which is not in STUDENT_AUTH_MODULES.');
    });
    if (dirReadable_()) dirAll_(DIR.MOD).forEach(function (m) {
      if (m.moduleId !== EXAM_MODULE && m.active && !sam[m.moduleId]) warnings.push('Directory module "' + m.moduleId + '" (' + m.title + ') is not in STUDENT_AUTH_MODULES — its groups cannot sign in.');
    });
    okLines.push('Front-page list: ' + portalRegistry_().map(function (m) { return m.title + (m.moduleKey ? ' (' + m.moduleKey + ')' : ''); }).join(', ') + '.');
  } catch (e) { warnings.push('Could not read the module lists: ' + (e && e.message || e)); }
  // 5. links: two modules never share a page, and each page really is that module (it names its own moduleKey)
  try {
    var norm = function (u) { return String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/index\.html$/, '').replace(/\/+$/, ''); };
    var links = [];   // {key, title, url, where}
    portalRegistry_().forEach(function (m) { if (m.url && m.moduleKey && m.moduleKey !== EXAM_MODULE && !m.backend) links.push({ key: m.moduleKey, title: m.title, url: m.url, where: 'front-page card' }); });
    if (dirReadable_()) dirAll_(DIR.MOD).forEach(function (m) { if (m.url && m.moduleId !== EXAM_MODULE && m.active) links.push({ key: m.moduleId, title: m.title, url: m.url, where: 'Platform directory module' }); });
    var byUrl = {}, byKey = {};
    links.forEach(function (l) { var u = norm(l.url); (byUrl[u] = byUrl[u] || {})[l.key] = l; (byKey[l.key] = byKey[l.key] || {})[u] = l; });
    Object.keys(byUrl).forEach(function (u) {
      var keys = Object.keys(byUrl[u]); if (keys.length < 2) return;
      errors.push('Two different modules use the SAME link ' + u + '/ : ' + keys.map(function (k) { return '"' + byUrl[u][k].title + '" (' + k + ', ' + byUrl[u][k].where + ')'; }).join(' and ') + '. Correct the wrong one (Teacher Dashboard → module list, or Platform directory → Modules → Edit → Link).');
    });
    Object.keys(byKey).forEach(function (k) {
      var us = Object.keys(byKey[k]); if (us.length < 2) return;
      warnings.push('Module "' + k + '" has different links on the front-page card and in the Platform directory: ' + us.map(function (u) { return u + '/'; }).join(' vs ') + ' — make them the same.');
    });
    var pageKey = {}, checked = 0;   // each page is opened once; every card/module that links to it is compared with it
    links.forEach(function (l) {
      var u = norm(l.url);
      if (!(u in pageKey)) {
        var res = null;
        try { res = UrlFetchApp.fetch(l.url, { muteHttpExceptions: true, followRedirects: true }); }
        catch (e) { pageKey[u] = { err: 'Could not open the link of "' + l.title + '" (' + l.url + ') to check it: ' + (e && e.message || e), warn: true }; }
        if (res) {
          var code = res.getResponseCode();
          if (code !== 200) pageKey[u] = { err: 'The link of "' + l.title + '" (' + l.where + ') does not open (HTTP ' + code + '): ' + l.url + ' — check the address and that GitHub Pages is on for that repository.' };
          else { var mk = /"moduleKey"\s*:\s*"([a-z0-9]+)"/.exec(res.getContentText().slice(0, 400000)); pageKey[u] = { key: mk ? mk[1] : '' }; }
        }
        if (pageKey[u].err) { (pageKey[u].warn ? warnings : errors).push(pageKey[u].err); return; }
      }
      var pk = pageKey[u]; if (pk.err) return;
      if (pk.key && pk.key !== l.key) errors.push('The link of "' + l.title + '" (' + l.where + ', module key ' + l.key + ') opens the page of ANOTHER module (' + pk.key + '): ' + l.url + ' — students will be asked for a password and refused. Correct the link.');
      else checked++;
    });
    if (links.length) okLines.push('Links: no module shares a page with another; ' + checked + ' link(s) checked against their pages.');
  } catch (e) { warnings.push('Could not check the module links: ' + (e && e.message || e)); }
  // 6. the other parts the platform relies on
  if (typeof exRoute_ !== 'function') warnings.push('The Official Exams part of Code.gs (1.7) is missing — the exam app will not work.');
  var attFns = { actionStartAttendance_: typeof actionStartAttendance_, actionCloseAttendance_: typeof actionCloseAttendance_, actionRegenerateAttendanceCode_: typeof actionRegenerateAttendanceCode_,
    actionDeleteAttendanceRecord_: typeof actionDeleteAttendanceRecord_, recordAttendance_: typeof recordAttendance_, findModuleAttSession_: typeof findModuleAttSession_ };
  var attMissing = Object.keys(attFns).filter(function (n) { return attFns[n] !== 'function'; });
  if (attMissing.length) warnings.push('The attendance part of Code.gs is missing (' + attMissing.join(', ') + ') — Teaching Sessions cannot open attendance.');
  else okLines.push('Teaching Sessions: the attendance functions of Code.gs are present.');
  if (typeof LE_createService !== 'function' || typeof liveStore_ !== 'function' || typeof liveSvc_ !== 'function') warnings.push('The Live Classroom part of Code.gs is missing — the group Live Classroom cannot work.');
  else okLines.push('Group Live Classroom: the Live Classroom engine of Code.gs is present.');
  if (typeof VERSION !== 'undefined') okLines.push('Code.gs version ' + VERSION + ', Portal.gs version ' + PORTAL_VERSION + '.');
  var text = (errors.length ? '❌ ' + errors.length + ' PROBLEM(S) — fix before you deploy:\n' + errors.map(function (x) { return '  ❌ ' + x; }).join('\n') + '\n' : '✅ No problems found — safe to deploy (Deploy → Manage deployments → Edit → New version → Deploy).\n')
    + (warnings.length ? warnings.map(function (x) { return '  ⚠️ ' + x; }).join('\n') + '\n' : '') + okLines.map(function (x) { return '  ✓ ' + x; }).join('\n');
  try { Logger.log(text); } catch (e) { }
  try { console.log(text); } catch (e) { }
  return { ok: !errors.length, errors: errors, warnings: warnings, text: text };
}
