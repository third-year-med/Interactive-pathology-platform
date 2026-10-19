# Platform handbook — decisions, workflow and lessons

Interactive Pathology Teaching Platform, by Dr. Wesam Alzwawy. This is the working memory of the project: why things are
built the way they are, how to add the next modules, how to deploy, and what went wrong before. It is kept up to date
in this repository, so every new session starts from it. State as of **2026-10-06**.

---

## 1. Repositories and what lives where

| Repository (GitHub `third-year-med/…`) | What it is | Served at |
|---|---|---|
| `Interactive-pathology-platform` | Front page (Platform Home, group pages, Teacher Sign-In, Teacher Dashboard, Admin directory), `backend/Portal.gs`, tests, release tool, docs | `https://third-year-med.github.io/Interactive-pathology-platform/` |
| `cell-injury-teaching-platform` | Module **Cell Injury & Cell Death** — one `index.html` (module key `cellinjury`, storage prefix `ci_`) | `…/cell-injury-teaching-platform/` |
| `inflammation-healing` | Module **Inflammation & Healing** — one `index.html` (`inflhealing`, `ih_`) | `…/inflammation-healing/` |
| `third-year-med-inflammation-condensed` | Module **Inflammation & Healing — Condensed** (2026-10-18): an independent ~50 % shorter high-yield version of Inflammation & Healing — one `index.html` (`inflcondensed`, `ic_`, its OWN content key) | `…/third-year-med-inflammation-condensed/` |
| `cell-injury-condensed` | Module **Cell Injury & Cell Death — Condensed** (2026-10-18): an independent ~50 % shorter high-yield version of Cell Injury & Cell Death — one `index.html` (`cellcondensed`, `cc_`, its OWN content key) | `…/cell-injury-condensed/` |
| `introduction-to-pathology` | Module **Introduction to Pathology** (Chapter 1, first card) — one `index.html` (`intropath`, `ip_`) | `…/introduction-to-pathology/` |
| `pathology-exams` | The Official Exams app — one `index.html` (`?m=<storage>`, `?g=<link code>`) | `…/pathology-exams/` |

**Cancelled (2026-10-10):** the Vulva and Vagina modules (`Vulvar-pathology`, `vaginal-pathology`, their separate
`Gyn.gs` Apps Script backend). Both repositories were deleted by the user on 2026-10-10; do not build on them or link to them.
`Gyn-pathology` is **kept for now** (not part of the platform) — do not change or delete it unless the user asks.
The tests still use the name `vulva` for a simulated second backend; that is only a test fixture.

**Backend:** one Google Apps Script project (the "main backend") holds both module data and the platform:
- **`Code.gs`**: written and maintained **by the user**. Never rewrite it; never ask to paste it into the repo. The only
  changes ever made: ONE line in `route_` that calls `portalHook_(module, p)` (SETUP.md 1.3), the two speed lines in
  `authed_` (SETUP.md → Speed) and, per module, the four entries of HANDBOOK §5. `platformCheck` verifies them.
- **`Portal.gs`**: maintained in this repo (`backend/Portal.gs`), pasted by the user into a separate Apps Script file
  named "Portal". Currently **version 2.6**.
- Data: one Google Sheet. Code.gs sheets: Content, Results, Settings, Sessions, LiveChat, LiveMembers, LiveFiles,
  AttendanceSessions, AttendanceRecords, AssessRecords, StudySync, Students, StudentSessions. Portal sheets (created on
  first use): Institutions, Groups, Modules, Deliveries, TeacherAssignments, ModuleContentRoles, StudentMemberships,
  PortalUsers, PortalSessions, PortalGrants, ContentVersions.

## 2. Security rules (non-negotiable, from the user)

- A GitHub token must **stay server-side, never reach the browser, never appear in client JavaScript, never be shown in
  the UI, never be committed**. Never expose GitHub tokens or administrative credentials to the browser.
- **Never commit** content keys, seed files, unencrypted index/offline HTML, or Code.gs keys. Module content keys live
  only in Code.gs (`CONTENT_KEYS`). In a work session, keys are passed only as environment variables
  (`CI_CONTENT_KEY`, `IH_CONTENT_KEY`, `CONTENT_KEY`) and never written to files.
- The user's full Code.gs may be used in a session for testing, but only in the scratchpad, never committed.
- Don't create pull requests unless asked. Commit with clear messages; push to `main` of the platform and module repos
  (that is the established workflow for these repos).
- Before committing, scan the diff for key fragments (`git diff --cached | grep -E '<first chars of each key>'`).

## 3. Architecture (approved by the user — keep it)

**Hierarchy:** Admin → Teachers → Institutions → Groups → Group-module **Deliveries** → Students.
- Teacher permissions are exact *teacher + group + module* combinations (TeacherAssignments).
- Institution and Group are separate records with stable IDs. A group has a `linkCode` (its address `?g=<linkCode>`).
- A delivery's storage name is fixed: `<moduleId>-<linkCode>` (e.g. `cellinjury-razi-a-26`). The plain `cellinjury` is
  the main/normal-link storage. **Module IDs never contain "-"** (the backend splits at the first "-").
- **`?g=` only selects a group; it never grants access.** Access always comes from a session the backend checked.
- Group-specific student data stays in its own storage. Groups never see each other's data.

**Accounts:**
- **Admin**: the single Teacher Sign-In password (Code.gs `portal` module login) → Teacher Dashboard + Platform directory.
- **Personal teachers** (Step 4): PortalUsers, temporary password → must choose their own; they see only their
  assigned group + module combinations. Teacher module sessions are recorded in PortalGrants and are revoked when
  assignments change or "End all module teacher sessions" is used.
- **Students**: roster per group (StudentMemberships). Adding a student creates the account in every module delivered
  to the group, with one shared password hash. Bulk temporary password: **one same password for all, only for students
  who have not chosen their own yet** (user's choice). A module delivered later is unlocked with the existing session
  (`portalGroupRefresh`). Students of a group must sign in on the **group page**; the main page redirects them.
- Module-level teacher passwords are closed (Step 5); emergency switch: script property `ALLOW_MODULE_LOGIN=true`.

**Versioned content (Steps 6–9):**
- One **master copy** per module: Draft → Preview → Publish, automatically delivered to all groups.
- Internal storages: `M@vN` (published version N, immutable), `M@draft` (master draft), `S@local` (a group's local
  layer). Settings keys: `content:mode:M`, `content:pub:M`, `content:changed:M`, `content:freeze:M`.
- Switched on per module (Content tab), with instant switch-back (OFF restores exactly what each group had).
- When ON, any edit made inside a module from a group link — **including the normal link** — goes to that storage's
  local layer, never the master. The master changes only via **✏️ Edit master draft** → **⬆ Publish draft**.
- Group local changes: additions, hidden items, overrides. Content tab → **Group local changes** lists them with
  **👁 Preview** (read-only), "Use the master again", "Copy to master draft". Copying only affects the draft;
  publishing then removes the copied group item automatically (2.13), unless the group changed it after the copy.
- Version history with Restore (publishes a copy as a new version — history is never rewritten) and Freeze.
- Assessments, exams, results, attendance, student accounts are never part of versioned content.
- Only the Admin publishes (for now).

**Packaged releases (rebuilding a module's index.html)** — full procedure in `docs/REBUILD.md`:
- New build → `tools/module-release.js preview` → `…/<module>/preview/` encrypted with the PREVIEW key (HMAC of the
  content key, given only to the Admin's master-draft session) → Admin opens it (Content → 🔁 New build) → the page
  reports its IDs → compatibility check with a decision per item → `golive` (one commit) → **🚀 Go live**.
- **ID rules for every build:** continuing topics/sections/questions/cases/images keep their IDs; IDs are never reused
  for different material; no duplicate IDs; a substantially changed question gets a new ID.
- Module pages carry `NEO_CONFIG.build` (shown in the Content tab) and the shared **platform block**
  (`modules/platform-nav.js`, written into each module with `tools/module-release.js refresh`).
- The platform block also holds the **High-Yield Facts print standard** (2026-10-14): Last-Minute Review → High-Yield
  Facts → 🖨 Print prints every fact of the module (whatever the on-screen filter), grouped under the unit headings, one
  bullet each with its own **bold** key words, and no Learning Block tags (they stay on screen). It takes over the
  module's `lmrPrintFacts` once the app has started; other modules use `window.PlatformHY.print(facts, { unitOf })`.
  Change the layout only there, then `refresh` every module — never per module.
- **Module Live Classroom without a class code (2026-10-15):** a signed-in registered (active) student opens the module's
  🔴 Live Classroom and enters directly under their account name — no code form. Code.gs `gateRequest_` (which already
  verifies the student session and fills name/email for `liveJoin`) also fills `p.classCode`; the module page joins
  automatically and falls back to the old code form if the server still answers `badcode`. Teachers and modules without
  student accounts are unchanged; the class code in Teacher Portal stays as the fallback.
- **Module attendance report (2026-10-15):** Teacher Portal → Attendance → a session's report (screen, 🖨 Print, CSV)
  lists every active student registered for that module/group (`listStudents`, the same Students list the sign-in uses),
  each Present or Absent, with Registered / Present / Absent and Attendance % = round(present ÷ registered × 100),
  Absence % = 100 − Attendance %. Check-ins match accounts by Student ID (the server stores the signed-in username), else
  by a unique full name (older records). "Absent" appears only after the session is closed (before that: "Not checked
  in yet"). A check-in whose student is no longer on the list is shown apart and not counted. Client-side only — no
  Code.gs change; stored records, codes, group separation and the Drive copy are unchanged. New modules keep the model
  modules' attendance code (`reportCard`, `attRegister`, `loadRoster`, `exportCSV`, `printReport`).

**Overall Pathology Attendance (Portal.gs 2.15, 2026-10-15):** Teacher Dashboard view `overall` (`overallSection` in
portal.js, Excel via `assets/xlsx.js` — a hand-written stored-zip .xlsx writer, since the CSP allows only own scripts).
Backend `attOverall {groupId}` (a TS action: Admin all modules of the group; personal teacher only their deliveries →
`partial: true`) → `attOverallCompute_`: every AttendanceSessions row of the group's teaching deliveries, keyed
`storage|sessionId` (a Teaching Session only points at the module's row via attSessionId → never double-counted); a
TS-linked row keeps the TS rules (`tsStatus_`, `tsRegister_`: late, marks, cancelled/scheduled skipped), a module-only row is
present/absent once closed. Per-student figures = `attSummary_` = the tsList_ formula (attended = present + late; counted =
attended + absent; pct = round(attended ÷ counted × 100); absencePct = 100 − pct; warn = pct < ts:threshold) on the summed
counts, never an average of module %. Roster = active StudentMemberships (`tsMembers_`); `state` none / missed / mixed /
full. The student group card (`portalGroupSessions` → `mine`) now shows the same overall figure (`mine.overall`,
`absencePct`, `modules`) and lists module-only classes in `recent`; nothing is sent (no duplicate warnings; a class-chat
post would expose a student's attendance to the class). Exports: CSV = the old "attendance-by-student" columns + Absence %
+ Status; xlsx sheets Overall / By module / Sessions / Register / Report info. Tests: 2 backend (equality with tsList_ on
TS-only data; module + TS mix over two modules, isolation, access, student card), 1 e2e.
Same day, at the user's request: the **Student Attendance** dashboard card was removed — its Teaching-Sessions-only
by-student table is superseded by this view (`sessionsSection(…, { byStudent: false })` no longer draws it on the dashboard;
`tsList_` still returns `students`), its **📊 Results & attendance** block (`reportBlock`) moved under the overall view, and
`#/teacher/attendance` redirects to `#/teacher/overall`. Admin: 6 cards; personal teacher: 4.
**Student front page redesign (2026-10-15, front end only):** signed in → `.hero.slim` (welcome strip: name, ID, "You can open
N of M", attendance chip `.att-chip` → scrolls to #ts-stu; red with ⚠ below the threshold) → **My modules** as
`.grid.compact` cards (icon · status pill · title · Open; description only as the card's tooltip; same `card()` markup,
CSS grid with `.mod-top{display:contents}`) → the Teaching Sessions panel: `.ts-grid2` = My attendance (big %, meter with
the threshold marker, per-module lines) | Upcoming (3 shown, rest in "+ N more"), then `details.ts-hist` (collapsed, one
line per session, tally in the summary). A live lecture moves the panel right under the strip (check-in without
scrolling). The page before sign-in keeps the full hero and the full cards. Element names the tests use are unchanged.
**Portal.gs 2.16:** `portalGroupSessions` returns the student's whole `recent` history (was the last 6) with `recentAll: true`;
the page labels it "N sessions" ("last N" with an older backend) and scrolls the opened list inside the box.
**Group Live Classroom switched off on the front page (2026-10-15, user's request — the modules' own Live Classroom is used):**
`GROUP_CLASSROOM = false` in portal.js hides the student button on the group page and the teacher's "Group Live Classroom"
button; `#/live` on a group page opens the group page. Backend (`liveOpen`, `liveTeacherOpen`, storage `live-<link>`) and
its messages are untouched; `true` brings it back (the old e2e test is skipped with that reason). The modules' Live
Classroom needs the Teaching Sessions setting "module Live/Attendance: shown" (`ts:modulelive` = show).
**No Refresh button on the group page (2026-10-15):** the Teaching Sessions panel polls by itself — 30 s while a lecture is
live, 60 s when one starts within 30 min, otherwise 120 s; no requests while the tab is hidden — and reloads at once on
`visibilitychange` (tab shown again, at most every 3 s). This also catches an unscheduled "Start a lecture now".
**Module order + Exams & Assessments (Portal.gs 2.17):** `portalGroup_` sorts a group's modules by the front-page module list
(Teacher Dashboard → Teacher Management, ↑/↓ — the explicit curricular order, matched by moduleKey or id); modules missing
from that list follow in directory order; Official Exams (`EXAM_MODULE`) always last. The page splits `exams` off into its own
section `.exams-sec` ("📝 Exams & Assessments", card `.mod.exam`) below the teaching grid, then the Teaching Sessions panel;
facts and "You can open N of M" count teaching modules only. **New module:** add its card in Teacher Management at its
chapter position (HANDBOOK §5 step 5) — that position is its place on every group page.
**Assessments sign-in + Learning lock (Portal.gs 2.18, module patch 2026-10-16):**
- Module Assessments page: a signed-in student (`NEO_BOOT.role === 'student'`) sees only the assessment password
  (`Views.quiz.acct()` / `renderAccountGate`); identity = the account (`email` or `<id>@student.local`, as Code.gs
  `studentEmail_`), which Code.gs `gateRequest_` already forces on getMyAssessments/startAttempt/submitAttempt. Teacher
  preview and local mode keep the old name/email form. Patched in all three module index.html (identical code).
- Learning lock: settings `ll:<storage>` (manual, Teacher Dashboard → Teaching Modules → 🔒 Lock Learning Module; Admin
  or the delivery's personal teacher; `llList`/`llSet`) and `llauto:<storage>` ('off' disables the automatic lock).
  Automatic = an active assignment with availableFrom AND dueAt (≤ 24 h) locks its students in its window; a TIMED attempt
  in progress locks that student until submitted or deadline + 2 min (`llAutoData_`, cached 30 s in `lla:<storage>`,
  cleared by start/submit/assignment actions). `learnLockHook_` in portalHook_: `learnLockStatus` for the page; a locked
  student's getAllContent/study* → `learnlock` (cheap `llAny_` check first so the getAllContent fast path stays fast).
  The platform block (modules/platform-nav.js, last section) polls learnLockStatus (20 s locked / 60 s / on tab show,
  last state in sessionStorage `pf_ll:<storage>`), hides every nav button but Assessments, the quick links and every
  `#view-*` but `#view-quiz`, and sends every other address to `#/quiz`. Teachers are never locked.
- Dashboard UI: a small card (`.ll-card`: "All unlocked · N modules" / red "N LOCKED · module · group"); a click opens the
  panel (`#ll-panel`), the open state is remembered for the tab (sessionStorage `pp_ll_open`). Inside, one collapsible list per group
  (`.ll-group` / `.ll-gh`: label, module count, red "🔒 N LOCKED"); closed unless it is the only group or was opened in
  this tab (sessionStorage `pp_ll_groups`).
**Assessment passwords (Portal.gs 2.19, module patch 2026-10-16):** one password per assessment, asked only to START it.
- Teacher: module Teacher Portal → 🔑 Assessment passwords (`Views.teacher.renderAssessPw`: one row per assessment —
  ＋ Set / ✏ Change, 🎲 New random, ↺ Use class password) above the class quiz password (now "default"). Portal actions
  `aePwList` / `aePwSet` (module teacher token, `authed_`), Settings `apw:<storage>` = {assessmentId: {pw, at}}.
- Student (signed in): `assessPwHook_` answers getMyAssessments (no password) / submitAttempt (no password) /
  startAttempt (that assessment's own password, case-insensitive; resume needs none; 10 wrong → 10 min) with the shared
  engine `assessSvc_` (identity from the account; mustChange and the exam teaching lock checked as Code.gs does). An
  assessment WITHOUT its own password falls through to Code.gs (class quiz password, unchanged).
- Module page: Assessments opens straight to the dashboard (`perAssessmentPasswords` from the server; an older server's
  badpw → the 2.18 password page), Start → promptDialog for that assessment, completed attempts → "📄 Attempt n — review
  answers" (`openReview` → renderResult; answers/correct answers as the assessment's "show answers" setting allows).
  Also fixed: promptDialog's Enter no longer re-clicks the button that opened it (it reopened the dialog).
- **2.20 (user's request): the class quiz password is retired.** startAttempt without the assessment's own password →
  `nopw` (no Code.gs fallback); getMyAssessments items carry `passwordSet` (boolean only) → the card shows "🔒 Not open
  yet" instead of Start; Teacher Portal shows no class-password card with a class server (local mode keeps it), rows
  without a password say "⚠ none yet", "✕ Remove password", and "🎲 Give each of them a random password".
- **List first (2026-10-16, module patch only, user's request):** entering `#/quiz` (`Views.quiz.show(params, entering)`)
  never jumps into an attempt in progress: the in-memory `st` / saved `assess_progress_v1` is parked as
  `assess_resp_<attemptId>` and the list shows "In progress · ▶ Resume" (`start()` resumes server-side without a password
  and restores the parked answers). A teacher preview is kept. The runner header shows "Student ID …" instead of the
  synthetic `@student.local` address. Patch: `quiz-list-first.py`.
- **Attendance = code only (2026-10-17, module patch only, user's request):** `renderTeacherSession` (Attendance tab AND
  Teacher Portal) shows no QR code / link any more: session title, the code (`.att-code-big`,
  clamp(3rem,12vw,11rem), one line), ⛶ Full screen (`codeFullScreen`: dark overlay with the code only, follows a
  regenerated code, closes on Esc / click / when the session ends), 🔄 Regenerate, ⏹ Close. Patch `att-code-big.py`.
- **Teacher Attendance tab (2026-10-17, module patch only, user's request):** `Views.attendance.render` → for a teacher
  with a class server `renderTeacherShort` (was the student code box): `startCard()`, `renderTeacherSession()` while
  `AttT.active()` (polling as in renderTeacherInto), `reportCard` after closing; button → `#/teacher/attendance`.
  Patch `att-teacher-short.py`.
- **Teacher Assessment tab (2026-10-17, module patch only, user's request):** `Views.quiz.render` → `renderTeacherBoard`
  when `Auth.isTeacher() && AssessAPI.isServer() && !acct()` (was the student sign-in gate): published/closed assessments,
  `apwSecret` (Show/Copy), 🔑 `AssessUI.editPw`, 📊 → Teacher Portal results; data from `AssessUI.loadPrivate`.
  Shared order helper `assessTopicSort(list, timeOf)` (others newest first, then "Topic N quiz" by N) — also the
  Assessment Library. Patch `teacher-board.py`.
- **Slide bold tool (2026-10-17, module patch only, user's request):** `Views.present.openSlideForm` → `boldTool(textarea,
  lines)` wraps bullets / subtitle: B button + Ctrl+B toggle `**…**` around the selection (each selected line on its own;
  no selection → the word at the cursor; already wrapped → unwrapped), live `.sb-prev` via `mdInline`; slide subtitles
  now render `mdInline(esc(...))` like bullets. Patch `slide-bold.py`.
- **⚡ Topic quizzes (2026-10-17, module patch only, user's request; uses 2.21 aeCopyTo):** `AssessUI.topicQuizPlan()` —
  per `getTopics()` topic: pool = QUESTIONS of that topic, not `short`, not in `revExcludeIds`; existing = assessment with
  `autoTopic === topic.id`. Settings (user's choice): pool mode, `poolCount` 5, `timeLimitMin` 5, `attemptsAllowed` 1,
  shuffle, showScore + showAnswers; random password (`aePwSet random`); "everyone" assignment; then `aeCopyTo` to all the
  caller's other groups (publish, assign, password random). < 5 questions → skipped and reported. Imported pool
  questions are marked formal-eligible (`persistQuizExtra`). Re-run = only missing ones (option: refresh + republish).
  Test harness Code.core.gs got a marked TEST STAND-IN for the assessment teacher actions (listAssignments,
  createAssignments, …) that the user's real Code.gs already has. Patch `topic-quizzes.py`.
  Order for students (user's request): `topic-order.py` — in each group of My Assessments, titles "Topic N quiz" sort by N
  (1 first) after the other assessments, which stay newest first.
  **How the user ran it (2026-10-17):** pressed ⚡ Topic quizzes in Cell Injury → 17 topic quizzes created and copied.
- **Pathology Overall Results & Analytics (Portal.gs 2.22, 2026-10-18, user's request):** TS action `resOverall {groupId}`
  (Admin / personal teacher via `tsPlaces_`; partial flag like attOverall) → `resOverallCompute_(g, members, set)`.
  Rows = the group's StudentMemberships (active AND inactive, keyed by Student ID). Per delivery (ordered by the
  front-page registry): AssessRecords kind "attempt", status "submitted", deduped by record id; matched email →
  <id>@student.local → unique name (reportDelivery_ rule); module % = unrounded mean of the student's submitted attempt
  percentages (= the existing per-module "assessment average" rule; all attempts count). Exams (kind exattempt),
  practice (Results) and attendance never count. Overall: equal mean or weighted Σw·p/Σw over modules WITH a result
  (missing never zero; weight 0 = excluded; unconfigured weight = 1, flagged `weightDefault`); rounded to 0.1 once.
  "Has assessments" = an active assignment or a submission; completion complete / partial / none / inactive.
  Summary stats over ACTIVE students (inactive listed, not counted). Settings `aov:settings` {method, weights,
  savedAt} via `resSettings` (Admin only, validated). Front end: portal.js `resultsSection` (dashboard card
  `results`), CSV all / per student from the same data. Tests: backend "Pathology Overall Results (2.22)…", e2e
  "Pathology Overall Results & Analytics (2.22)…".
- **Copy to groups (Portal.gs 2.21, 2026-10-17, user's request):** `aeCopyHook_` (module teacher token of the source
  storage): `aeCopyTargets {assessmentId}` → other deliveries of the same module the caller teaches (`examCaller_` →
  Admin all / personal teacher `teacherDeliveries_`), each with `has` and `attempts`; `aeCopyTo {assessmentId, targets,
  publish, assign, password:'same'|'random'|'none'}` → per target: attempts there → kept unchanged; else upsert the
  assessment (same id; `copiedFrom`, a "Copied" log entry) and — publish + published source — its published version
  (frozen questions); otherwise a draft (publishedVersion 0); assign = an "everyone" assignment cloned from the source's
  active everyone assignment (skipped if one is active); password into `apw:<T>`; `cvMarkWrite_(T)`, `llForget_(T)`.
  Module: AssessUI.copyToGroups (flushPending first). Patch `copy-groups.py`.
- **Quick access panel (2026-10-17, module patch only, user's request):** the Learn home's "All topics · Glossary ·
  Presentation mode" links are a yellow `.ux-quick` panel with three `.ux-qa` tiles (icon, title, hint; one column on
  phones). Same links; the learning lock still hides `.ux-quick`. Patch: `quick-panel.py`.
- **🖼 Import pictures (2026-10-17, module patch only, user's request):** Teacher Portal → 💾 Backup → 🖼 Import pictures
  reads a picture-import file `{format: 'neo-picture-import', version: 1, module: <moduleKey>, items: [{key, section, caption,
  credit, filename, image: data-URL}]}`. Each picture goes the "+ Picture" way: `Backend.uploadImage` (Drive picture folder)
  → appended to `custommedia/<section>` with `importKey` (nothing replaced; a key already in that section = skipped, so a
  second run adds nothing) → `pmAugment` gives it its own Images slide after the section's slide. Inside ✏️ Edit master draft
  it goes to `<module>@draft` (all groups after ⬆ Publish draft); elsewhere a green/blue note says where it goes. Progress and
  result live in `PIC_IMPORT` (the Teacher Portal redraws during the import). Patch `picture-import.py`.
  **How a picture batch is done:** the user puts JPGs + a captions PDF in a Drive folder → the session downloads them
  (Drive connector; files land in tool-results as base64 JSON), studies each picture against the course outline (decrypted
  in memory with the content key), shows a review page (thumbnails, Learning section, Images slide, caption, alternative,
  flags) and waits for approval → builds the import file (1600 px JPEG, keys `<prefix>-NN`, credit line) → the user
  imports it in Edit master draft and publishes. Never commit the pictures, the review page or the import file (textbook
  figures; the course is encrypted, these are not). First batch: Inflammation & Healing, 28 Robbins Ch. 2 figures
  (keys `ih-robbins2-01…28`) — imported in Edit master draft and published by the user on 2026-10-17, so every group
  has them. A later batch for this module must use new keys (e.g. `ih-<source>-NN`), never reuse these.
  Second batch: Cell Injury & Cell Death, 30 Robbins Ch. 1 figures (keys `ci-robbins1-01…30`, file
  `cellinjury-pictures-robbins1.json`), approved by the user and rehearsed on the real page 2026-10-17; the user imports it in
  Edit master draft and publishes. A later Cell Injury batch must use new keys. Check which page a key opens before
  trusting the variable's name (that session's `IH_CONTENT_KEY` held the Cell Injury key and opened only Cell Injury).
- **Password copy (2026-10-16, module patch only):** `apwSecret` adds 📋 Copy (`data-a=copy`, clipboard API with an
  execCommand fallback; the password stays covered and is never in the toast); the Hide button is plain "Hide" (no 🙈).
  Patch: `pw-copy.py`.
- **Student header (2026-10-16, module patch only, user's request):** `renderHeaderStatus` — `stuOnly` (NEO_BOOT role
  student with a student, not a teacher): no `uxTeacherLink`, no clickable Class server chip (only a non-clickable
  Offline / Syncing chip when relevant). Patch: `stu-header.py`.
- **Attendance code only (2026-10-16, module patch only, user's request):** `Views.attendance.renderCodeEntry` and
  `renderCheckin` use `Views.quiz.acct()`; for an account student the name / ID / email fields are not shown (filled
  from the account; Code.gs overrides them from the stoken anyway) and `quiz_identity_v1` is not overwritten.
  Patch: `att-code-only.py`.
- **Compact My Assessments (2026-10-16, module patch only, user's request):** `renderDashboard` builds one slim
  `.assess-row` per item inside `<details class="assess-group" data-group="todo|done|other">` (todo = can start/resume;
  done = has submissions but cannot start; other = the rest, folded; fold state kept in `Views.quiz.grp`). Newest first
  by `assessWhen`: `assignment.assignedAt` if sent, else the creation time inside the assignment id (`AE_id` =
  `prefix_<Date.now() base 36>…`), or `availableFrom` if later; otherwise server order, later = newer. Row: title
  (description as tooltip), one meta line, last result, attempt review chips (`.assess-hist`), status badge + action in
  `.assess-side`; the "Open" window badge is dropped (other windows appear in the meta line). Patch: `assess-compact.py`.
- **Passwords inside 📝 Assessments (2026-10-16, module patch only):** the separate Administration tab is gone
  (`#/teacher/password` → Assessments with `AssessUI.sub = 'passwords'`). `AssessUI.loadPrivate` also loads `aePwList`
  (`AssessUI.pw`, null in local mode / older server) → `renderPwStrip` above the sub-tabs, a 4th sub-tab 🔑 Passwords
  (`Views.teacher.renderAssessPw`; local mode: `tabPassword` with the class password), and a Password column with 🔑
  (`AssessUI.editPw`) in the library.
- **Covered passwords (2026-10-16):** `apwSecret(id, pw)` shows ••••••; 👁 Show reveals ONE (`APW_SHOWN.id`, every
  `.apw-secret` repaints; auto-cover after 2 min); toasts and the change dialog never contain a password (projector-safe).
- Honest limit: the packaged course is still decrypted in the student's browser (the Assessments page needs the app);
  a student with developer tools could dig it out. For high-stakes exams use Official Exams (separate app, no course
  content) with the teaching lock.
- Tests: a module page is tested WITHOUT the real content keys by encrypting a small synthetic course with a throwaway
  key into the real index.html (`syntheticModule` in e2e.test.js; the harness backend returns that key).

**Results & attendance (Step 10):** read-only overviews per delivery — Admin (Results & attendance tab: all deliveries)
and personal teachers (📊 button: own deliveries); per-student table, attendance register, CSV. Students are matched to
the roster by Student ID, then email, then unique name; unmatched records are listed under "Also found".

**Teaching Sessions (2.7, step 1 of 4 — approved plan 2026-10-10):** "Modules contain learning content; Teaching
Sessions contain teaching events." Sheet `TeachingSessions` (one row per lecture: group, delivery, schedule, lateAfterMin,
rotate, materialsUrl, status scheduled/live/ended/cancelled, attSessionId, marksJson). Opening attendance calls Code.gs's
own `actionStartAttendance_` on the **delivery's storage**, so attendance stays per storage (module page, Drive copy,
Step 10 reports unchanged). Student statuses are COMPUTED (present/late from scannedAt vs max(startAt, startedAt) +
lateAfterMin; absent = active roster member without a check-in after close; excused/present/late overrides in
marksJson; a manual Present writes a real AttendanceRecords row via `recordAttendance_`). Rotating code = Code.gs
`actionRegenerateAttendanceCode_` every 45 s, driven by the teacher screen's `tsState` polling — opt-in since 2026-10-11
(default = one fixed code). Module Presentation Mode shows the open code (teacher only, read-only `listAttendanceSessions`
every 8 s, `.pres-att` badge in `.pres-stage-outer`); nothing ever closes attendance except the teacher's Close. Platform settings:
`ts:tz` (time zone, default the script's) and `ts:threshold` (75). The user is still in a trial period (no students
yet, as of 2026-10-10). Plan: 1 teacher panel (done, 2.7) → 2 group-page card for students (done, 2.8:
`portalGroupSessions` / `portalGroupCheckIn`, identity = a session of one of the group's modules + active membership,
as `portalGroupRefresh`; previous rotating code accepted 20 s via TS columns prevCode/prevCodeUntil; 10 wrong codes →
10 min) → 3 one Live Classroom per group (done, 2.9: storage `live-<linkCode>` run by Code.gs's LE engine
unchanged; Portal `liveGate_` allows only LIVE_ACTIONS there, refuses liveJoin; students via `liveOpen` (group sessions +
membership; identity email = sha256(LIVE_ID_SALT script property|storage|username) so the pid cannot be guessed — the
liveSync cache fast path in doPost bypasses Portal but only answers "no change" for a known pid); every student request
carries `gs` (group sessions) and is re-checked (cache `lvg:` 5 min) + combined-exam lock; teachers via
`liveTeacherOpen` (SESSIONS row for the storage + PortalGrants for personal teachers); `livePostSystem_` posts lecture
started/ended announcements; UI `assets/classroom.js` (CSP: thumbnails via data: URLs, never blob:)) → 4 (done, 2.10) module Live/Attendance hidden by the platform block (`modules/platform-nav.js`: reads public
`portalModuleFlags` → setting `ts:modulelive` (absent = hidden; 'show' = shown), remembered 5 min in localStorage
`pf_flags_v1`; CSS hides `[data-view=live|attendance]` + the Teacher Portal 📋 Attendance tab; `#/live…`, `#/attendance…`,
`#live=`/`#att=` and teacher `#/teacher/attendance` → start page + notice; while hidden it answers the module's `live*`
fetches itself) — refreshed into the 3 module repos with `tools/module-release.js refresh`; Step 10 `reportDelivery_`
gives each student a status per session (late/excused from TeachingSessions; open sessions = waiting, not counted). Later (not started): a repeating schedule (item 9). The combined-exam lock already closes the group classroom (2.9).

**Speed (2.5):** `portalHook_` answers `getAllContent` from memory when nothing changed for that storage (markers
`cvw:<storage>` in CacheService, set by every request that may write Content; unknown requests count as writes; a
60-second grace covers writes in progress; `content:changed` forces full refreshes). Every request is logged as
`req <module> <action>`. Admin tidy-up (history tombstones, archive older snapshots to `ContentArchive`, expired
sessions). Optional Code.gs `authed_` cache (documented in SETUP.md) and the `portalWarm` time trigger. Measured on a
450-row Content sheet: 50 update checks went from 50 full sheet reads (270,000 cells) to 0.

## 4. The module pages (how a module works)

- Single-file `index.html` built with the pathology-teaching-platform builder. Course data is encrypted
  (`<script id="neo-enc">`, AES-256-GCM); the class server returns the content key only to a signed-in session.
- `NEO_CONFIG`: `backendUrl`, `studentAuth`, `moduleKey`, `storagePrefix`, `platformHome`, `build` (+ `preview`).
- Sessions in the browser: teacher token `localStorage[<prefix>backend_token_v1]`, student session
  `<prefix>stu_session_v1`; with `?g=TAG` the prefix becomes `<prefix><TAG>_`.
- The platform block adds "← Back to Platform Home / Back to Teacher Dashboard" (role-aware, group-aware), the
  yellow "MASTER DRAFT" / "PREVIEW" banner, preview mode, and the build report.
- Practical tab = structured practicals (drafts in `priv:pracdrafts`, published copies in `practicalpub`, resources and
  the image Active switch go live on their own) + the Image Bank (`practical` collection).

### 4.1 Platform-standard module features (2026-10-15…17) — every module must have them

Kept as idempotent patches in **`modules/patches/`** (table + order in its README; `apply.sh --check <page>` reports
✅/❌, `apply.sh <page>` applies). In short: account-based Assessments (no name/email; per-assessment passwords asked
only to START; reviews free; class quiz password retired); teacher password management inside 📝 Assessments
(covered ••••••, 👁 Show one at a time, 📋 Copy); student My Assessments opens on a compact grouped list (To do /
Completed / Not available, newest first; ▶ Resume for an attempt in progress); Attendance = code only for signed-in
students; no Teacher / Class server buttons for students; per-tab sync cursor (multi-tab safe); yellow Quick access
panel on the Learn home; learning-lock guard in the platform block; 🖼 Import pictures (Teacher Portal → 💾 Backup).
Backend: **Portal.gs 2.21**.

### 4.2 Content standard: CONDENSED by default (user decision, 2026-10-19)

**The two condensed modules were renamed 2026-10-19** (user hides the original full modules): visible title now
"Inflammation & Healing" / "Cell Injury & Cell Death" (page, header, footer, NEO_CONFIG.title, course title and fileStem,
re-encrypted with the SAME keys); module keys `inflcondensed` / `cellcondensed`, prefixes, repositories, URLs and the build
label `condensed-1.0` unchanged (renaming those would cut the students' accounts and results). The user renames the
front-page card (Teacher Management) and the Platform directory module title.

Every NEW module is written as a high-yield **condensed** module from the start — the density of
`third-year-med-inflammation-condensed` and `cell-injury-condensed` (built 2026-10-18), not of the older full modules.
Only build a full-length version when the user explicitly asks for one. Same architecture, features and look; only the
amount of text changes. **The name never says so (user, 2026-10-19):** no "Condensed", "High-yield", "Short" or similar
in the module title, subtitle, page `<title>`, header, footer, front-page card, Platform directory title, file names
or printouts — the title is the plain subject (e.g. "Neoplasia"). Module key, prefix and repository name are plain too
(e.g. `neoplasia`, `np_`, `third-year-med/neoplasia`). Targets and method (what worked for the two condensed modules):
- **Learn text ≈ 50 % of a full write-up of the same syllabus** (measured on prose + key points + tables): every
  syllabus point, definition, mechanism, classification, example and exam fact stays — cut repetition, long
  introductions, side stories and duplicated explanations. Merge thin sections (≈ 3–6 sections per topic); a merged
  section keeps the first section's ID.
- **Per section:** short paragraphs or bullet lists with **bold** key terms; callouts kept where they teach
  (DEF, FLOW, HIGHYIELD, CONFUSION, PRACTICAL, CLINICAL, RECALL — 1–3 RECALL questions); **2–3 key points** of one
  line each (`slideKeyPoints` = the same text with **bold**); syllabus tables kept but trimmed to the rows that carry
  facts; one table per comparison (no duplicates).
- **Per topic:** a one-line summary, 3 must-know lines.
- **Slides ≈ 50 % of a full deck** follow automatically from the shorter key points, must-know lines and summaries;
  check with the real deck count (Presentation mode) — galleries add slides, so curate pictures.
- **Pictures:** at most ~3 atlas pictures per section, no duplicates of the same view; a WebPath link chip is
  redundant where the section already shows ≥ 2 pictures (keep link chips in the Practical topic).
- **Questions, cases, glossary, sequences, comparisons:** complete (the question bank is NOT halved) — but every
  question must be answerable from the condensed text (check each one; add the missing fact back to the text).
- **Scientific QA** of every topic against the source; teacher-confirmed wording notes kept.
- Report: Learn words and slide words separately, sections per topic, pictures kept/removed, what was merged.

### 4.2.1 Neoplasia — a NEW module, not the old test (user, 2026-10-19)
The earlier Neoplasia (repository `third-year-med/Neoplasia-platform`, module key `neoplasia`, Code.gs
`DEFAULT_QUIZ_PW.neoplasia = 'NEOPL-2026'`) was only a platform test and is retired. The new Neoplasia module is built
from scratch in `third-year-med/neoplasia` (empty, created 2026-10-19) with module key **`neoplasm`** and prefix
**`nm_`** — nothing is reused from the test (no code, content, key or storage). Its four Code.gs additions use `neoplasm`;
the user removes the old `neoplasia` line from DEFAULT_QUIZ_PW and retires any old card / directory record.

### 4.3 Picture sources (user, 2026-10-19): use ALL of them, each under its own rules

A new module searches every source for every section and practical specimen. Pictures are registered in the course's
`images` (atlas) with an `imageProviders` entry (name, long, home, mode, terms, rule) — the model is the provider list of
the existing modules — and appear in Learn, Presentation (Images slides), Practical → Image atlas and the reviews.
| Source | How | Credit / rule |
|---|---|---|
| **PEIR Digital Library** (UAB) | embed (`mode: embed`) | "© UAB Department of Pathology"; non-profit educational use, UAB acknowledged |
| **Wikimedia Commons** | embed per image (`mode: per-image`) | only Public domain, CC0, CC BY, CC BY-SA files (check each file page): author + licence + Commons link; other licences → link only |
| **Libre Pathology** | as Commons (its images are Commons files) | same per-file rule; link to the Libre Pathology page too |
| **Robbins** (user's attached pictures + captions, or a Drive folder) | picture-import file `neo-picture-import` (§8 / patch `picture-import`), imported by the user in ✏️ Edit master draft after go-live | credit line "Kumar V, et al. Robbins & Kumar Basic Pathology … © Elsevier … teaching use within this course only"; never committed |
| **WebPath** (Utah) | link only (`mode: link`, section `links`) | reproduction forbidden without written permission |
| **WebPathology** | link only | personal viewing only; may not be copied, displayed or framed |
| **Pathology Outlines** | link only (add a provider `pathout`, `mode: link`) | © PathologyOutlines.com — images may not be reproduced |
Every entry: the right section, a short "what to look for", source + credit, checked URL, no duplicate views; about
3 embedded pictures per section (condensed standard, §4.2). The final report lists pictures and links per source.

## 5. Adding the next module — checklist (follow in this order; learned the hard way on 2026-10-10)

**Golden rule: never give the user a complete new Code.gs.** Code.gs is the user's file and carries lines added
over time (the Portal line in `route_`, the speed lines in `authed_`). On 2026-10-10 a "fresh" Code.gs from another
chat dropped the Portal line and the whole front page went down ("does not have the front-page file (Portal.gs)").
Give **only the lines to add, and where**.

1. **Build** the module with the builder skill. Choose `moduleKey` (lowercase letters/digits, **no "-"**) and a unique
   `storagePrefix` (e.g. `np_`). Use stable IDs (section 3 rules). Its `NEO_CONFIG` must contain
   `"platformHome":"https://third-year-med.github.io/Interactive-pathology-platform/"` and the page must contain the
   `<script id="platform-nav">` block (copy of `modules/platform-nav.js`), otherwise there is no "← Back to Platform
   Home". With the key: `CONTENT_KEY=… node tools/module-release.js refresh <repo>` refreshes the block; a page without
   any block gets it inserted before `<script id="neo-data"` (done this way for introduction-to-pathology, 9af50d5).
   **Then the platform-standard features (§4.1):** start from the app code of a current model module, and run
   `bash modules/patches/apply.sh --check <repo>/index.html` — it must say ✅ (otherwise `apply.sh <page>`).
2. **Module repo**: create it, push `index.html`, enable GitHub Pages (`main` / root). Only `index.html` (encrypted);
   never Code.gs, keys or unencrypted course files.
3. **Code.gs — exactly four additions** (the user makes them; give them like this, with the real module key):
   | Ctrl+F | add |
   |---|---|
   | `var STUDENT_AUTH_MODULES` | `, newkey: true` |
   | `var CONTENT_KEYS` | `newkey: '<its content key>',` (the user pastes the key; never write it in a file) |
   | `var DEFAULT_QUIZ_PW` | `newkey: 'NEWKEY-2026',` |
   | `var DEFAULT_LIVE_PW` | `newkey: 'CLASSROOM-2026',` |
4. **Self-check, then deploy**: Apps Script → function list → **platformCheck** → ▶ Run → Execution log must start
   with ✅ (it checks the Portal line, the speed lines, every module's key, the front-page list and the directory,
   and opens every module link to confirm it is that module's page; it never prints a key). Then **Deploy → Manage deployments → Edit → New version → Deploy**.
   If anything breaks after a deploy: **Manage deployments → Edit → Version: the previous one → Deploy** first, fix after.
5. **Front-page card** (the cards are DATA on the backend, not HTML; their order is also the module order on every group page): Teacher Dashboard → module list → ＋ Add a module
   (title, subtitle, icon, link, status Available; Advanced: module key, hand-off "Platform modules", storage prefix)
   → ↑ to its chapter position → 💾 Save. (`PORTAL_DEFAULT` in Portal.gs only matters on a fresh install.)
6. **Groups**: Platform directory → **Modules** → Add (id = module key) → **Deliveries** for each group; accounts are
   created from each group's roster; **Teachers**: tick assignments.
7. Content tab → Migration report → decisions → migrate → **Switch versioned content ON** (when the module has edits).
8. **Test** (section 7) and ask the user to check in an incognito window: front page → test student → module →
   "← Back to Platform Home".
9. Update `SETUP.md`, this handbook, and give the user the exact deployment steps (section 6).

**Keys**: the user keeps them in a password manager. If the user pastes Code.gs in a chat, ask them to replace keys
with `XXX` first; never write a key into a repository, file or commit (scan diffs before every commit).

## 6. How the user deploys (always give these exact steps)

The user is a pathologist, not a developer. They follow steps literally and send screenshots.
- **Portal.gs update:** open `https://raw.githubusercontent.com/third-year-med/Interactive-pathology-platform/main/backend/Portal.gs`,
  Ctrl+A, Ctrl+C → Apps Script → open **Portal** (not Code.gs) → Ctrl+A, Ctrl+V → save → **Deploy → Manage deployments
  → ✏️ Edit → New version → Deploy** (same URL). Always state the **new line count and the last 3 lines** so they can
  check the paste.
- **Front page / modules:** they go live via GitHub Pages after a push (about 1 minute); the user then presses
  **Ctrl+F5** (a normal reload can show the old version for ~10 minutes).
- Code.gs changes are made by the user; give the exact line and where to put it — never a whole new Code.gs.
- Before every deploy the user runs **platformCheck** (Apps Script → function list → ▶ Run) and deploys only on ✅.

## 7. Testing workflow (do this before every push)

- `cd test && node --test backend.test.js` — Portal.gs + the Code.gs core excerpt (`test/apps-script/Code.core.gs`,
  verbatim copies of the needed Code.gs functions) in the Node harness (`test/apps-script/harness.js`).
- In a cloud session Playwright is installed globally: run the e2e tests as
  `NODE_PATH=/opt/node-tools/node_modules node --test e2e.test.js` — without it every e2e test is SKIPPED
  ("Playwright/Chromium not available") and the run still says "fail 0".
- `node --test e2e.test.js` — Playwright (Chromium at `/opt/pw-browsers/chromium`) on the front page and on the **real
  module pages** from the sibling repos. With `CI_CONTENT_KEY` / `IH_CONTENT_KEY` set (env only) the real courses are
  unlocked; without keys those tests skip. `SHOTS=<dir>` writes screenshots — look at them.
- Smoke test against the user's **full Code.gs** + Portal.gs (scratchpad only, never committed) for every backend change.
- Reproduce a reported bug on the real page first (harness backend + Playwright), find the cause, then fix the smallest
  thing; keep the reproduction as a permanent test.

Module pages without the content keys: `node test/module-smoke/smoke.js` boots every sibling module repo with a
synthetic course (throwaway key) — student sign-in, Assessments without a password page, learning lock → #/quiz — and
the e2e tests use `syntheticModule(CI_PAGE)` + `openSyntheticModule()` for the same purpose.

## 8. Lessons learned (bugs we hit and what fixed them)

- **"Not registered for your account" on a group page right after delivering a NEW module (2026-10-18, inflcondensed):**
  the group page decides access at sign-in and keeps it for the session; it re-checks a newly delivered module by itself
  (`portalGroupRefresh`) only with a session of ANOTHER module of the group. In a group whose only module is the new one,
  a student who signed in before the accounts existed stays "not registered" → **Sign out and sign in again** fixed it.
  Accounts are created on delivery only if Code.gs (STUDENT_AUTH_MODULES) was already deployed; otherwise Platform
  directory → Students → the group → **＋ Create missing accounts**.
- **Published master pictures not visible in groups A/B (2026-10-18, inflcondensed):** after "Create master v1.0", ✏️ Edit
  master draft and ⬆ Publish draft already work while versioned content is still OFF — but groups read the master only
  when it is ON. → **Switch versioned content ON** (then Ctrl+F5 in the group's module). Check the label first. The module's Teacher Portal → Students shows only the
  copy that was opened (main `inflcondensed` vs the group's `inflcondensed-<link>`).

- **Two chats edited `modules/patches/apply.sh` at the same time (2026-10-17):** the picture chat added `picture-import`
  while this chat added `slide-bold`; the slide-bold entry was lost from ORDER (the checker cannot notice a patch missing
  from the list). → Before committing a new patch: `git pull`, append to ORDER, and verify that an OLD module page
  (`git show HEAD~N:index.html`) patched with `apply.sh` is byte-identical to the current page. Each patch's CSS uses its
  own anchor (never insert right after another patch's anchor line — that made copy-groups look "missing").
- **Teacher sign-in fails in ONE browser only (module shows the student sign-in), 2026-10-17:** a module prefers a server
  address saved in that browser (`<prefix>backend_url_v1`, from Backend & sharing → Connect) over its configuration; an
  old deployment address there made it reject the fresh pass. → portal.js `resetModuleUrl(pfx, backend)` drops a saved
  address that differs from the platform's server whenever a module is opened from the platform (Admin, personal
  teacher, student hand-over). Manual cure for a browser: clear the site data of third-year-med.github.io, Ctrl+Shift+R.
- **Teacher opened a module from the dashboard and got the STUDENT sign-in (Cell Injury · Razi B, 2026-10-17):** the
  dashboard reused a saved teacher pass the server had already ended; the module refused it, dropped it and showed the
  student sign-in (a second click worked). → `teacherOpen` (Admin) and the personal-teacher open in portal.js always
  request a fresh pass (`portalTeacherOpen` / `teacherOpen`); no reuse of `t.mods[...]`.
- **New assessments missing from the Teacher Portal library (students still had them; "↻ Sync now" brought them
  back), 2026-10-16:** several tabs of one module in one browser (teacher + student test tab) share the saved copy
  and `last_server_time_v1`, but each has its own copy in memory. A tab read the time another tab had moved on, got
  "nothing new", then saved its copy (without the new items) over the shared one. → Per-tab cursor `STATE_SINCE`
  (sync from it, not from storage); a partial save lowers the saved time to the tab's cursor; only a tab whose whole
  copy is saved (`STATE_PURE`, generation stamp `state_gen_v1`) moves it forward, otherwise it saves its whole copy
  first; a failed save (storage full) clears the time → full sync next load. Patch `sync-cursor.py`; e2e "Two tabs…".
- **"Incorrect Student ID or password"**: the student signed in on the main page instead of the group page; students
  added before deliveries existed had no accounts. → Membership password hashes, accounts created on add, main page
  redirects group members to their group page.
- **"Not registered" for a newly delivered module** → `portalGroupRefresh` unlocks it with the existing session.
- **Apps Script paste errors** ("Syntax error … line 812", "Unexpected identifier 'module' line 3410 Code.gs"): partial
  paste, or Portal pasted into Code.gs. → Use the raw URL, select all, check line count + last lines; recover Code.gs
  with undo / Project history and delete anything pasted below `/* ==== ASSESS ENGINE END ==== */`.
- **Security holes closed**: module `setup` on unprotected storages (Step 5); `@`-named internal storages reachable from
  outside (refused in `portalHook_`).
- **Front-page CSP**: `connect-src` needed `'self'` to read module pages (New build panel); `img-src` needed `https:`
  for previews of Drive/atlas pictures.
- **GitHub Pages deployment stuck in "Waiting/Queued"** (GitHub side): re-running may stay queued; a new push starts a
  fresh deployment that supersedes the stuck one.
- **Practical section (2026-10-06):** (1) a background sync repainted the editor and dropped typing in resource links
  — the editor must not repaint on sync; (2) an edited published practical had no Approve button (deadlock) → "Approve
  changes"; (3) image links: preview, Drive share-link conversion, web page vs picture, `referrerpolicy=no-referrer`,
  clear "Image failed to load + Open image/resource" fallback that keeps the URL; (4) never store pictures as base64
  in content when a Drive upload fails (items exceed the 270k-character limit). Drive uploads need `authorizeDriveAccess`
  run once in Apps Script.
- **Slowness (2026-10-07)**: Apps Script requests took 1.5–4 s for one tester because every update check read the whole
  Content sheet and every teacher request the whole Sessions sheet. Fix with caching/fast paths first; moving off
  Google is only worth it for very large simultaneous exams (Apps Script runs ~30 requests at once). The Oct 4 burst of
  "Failed" executions was the Code.gs paste error, not load.
- **Dialogs**: never change the layout on `blur/change` of an input — the click on the button then misses.
- **Tests**: millisecond timestamps need `<=` comparisons and small pauses; copy Code.gs functions verbatim into
  `Code.core.gs` when a test needs them; CSS `:nth-of-type` counts other siblings — select rows explicitly.
- **Playwright**: `page.goto()` to the same URL with only a different `#hash` does not reload the page → `page.reload()`.
- **2026-10-10 front page down**: a replaced Code.gs lost `if (typeof portalHook_ …)` in `route_` → every portal request
  fell through to `badaction` → "backend does not have the front-page file". The backend link (GET) still said
  "running (v1.7)", so a running backend proves nothing about the hook. → platformCheck, and never replace Code.gs.
- **2026-10-10 wrong module link**: the Introduction card/directory module linked to the Cell Injury page → the page asked
  for a password and refused the right one (it checked the Cell Injury account of the group). → platformCheck now opens
  every linked page and compares its `moduleKey`, and reports two modules sharing one link.

## 9. How to work with the user

- Keep the agreed plan order; finish one step, report, and wait for "continue" before the next.
- Explain in plain language, with exact buttons and paths; answer screenshots precisely; never guess — inspect first.
- Preserve existing features and data; no redesigns or rewrites unless asked; smallest reliable fix.
- After each step give: what changed, how it was tested, and the exact deployment steps.

## 10. Current state (updated 2026-10-17)

- **Backend: Portal.gs 2.22 in the repo** (2.22 = 📈 Pathology Overall Results; 2.21 deployed by the user 2026-10-17, platformCheck ✅ = 📤 Copy to groups; 2.20 retires the class quiz password). Since 2.15: Overall
  Pathology Attendance (75 % rule, Excel / CSV / print, student card); student homepage redesign (curricular order from
  the Teacher Management list, exams in their own section, Teaching Sessions panel with full history); group Live
  Classroom off (`GROUP_CLASSROOM=false`); Learning Module lock (manual + automatic, server-enforced, compact card with
  per-group lists); per-assessment passwords (`apw:<storage>`, `aePwList` / `aePwSet`).
- **Modules** (intropath, cellinjury, inflhealing, inflcondensed, cellcondensed) carry every patch in `modules/patches/` (all ✅, incl. 🖼 Import pictures
  2026-10-17). Tests: 91 backend; e2e 57 pass with IH_CONTENT_KEY only (23 skip: 22 need CI_CONTENT_KEY, 1 group
  classroom off); module smoke ✅.
- **Inflammation & Healing — Condensed (2026-10-18):** repo `third-year-med/third-year-med-inflammation-condensed` (GitHub kept
  the owner prefix in the name), module key `inflcondensed`, prefix `ic_`, build `condensed-1.0`, own content key (env
  `IC_CONTENT_KEY` in sessions). Made from the inflhealing PACKAGED course with the same app code (all patches ✅): same 18
  topics (t01–t18, IDs kept); 86 → 67 sections (merged sections keep the first ID; UX_UNITS/UX_FLOW targets kept); prose
  19,397 → 9,054 words (−53 %); real deck 248 → 190 slides, on-slide words 14,085 → 7,385 (−48 %); 229 → 226 questions
  (q008, q156, q173 dropped), cases unchanged, 65 → 51 atlas images, 169 → 42 picture links, all 29 schematic figures and 13
  flowcharts kept. NOT carried over (they live in the inflhealing backend overlay, not the package): the 28 imported Robbins
  pictures, master-draft edits, custom slides, practicals. e2e test "condensed Inflammation module (inflcondensed)…" walks
  every section, view and slide with the real course; the module smoke test includes it. State (user, 2026-10-18): Code.gs entries,
  card, directory module, deliveries (Groups A, B) done; master v1.0 created and versioned content ON; the Robbins batch
  rebuilt for this module (27 pictures, keys `ic-robbins2-01…27`, file `inflcondensed-pictures-robbins2.json`, not
  committed; the NETs figure is missing from the Drive folder) imported in Edit master draft and published. A later batch
  must use new keys. User's deployment: the four Code.gs
  additions for `inflcondensed`, platformCheck, Deploy, front-page card, Modules → Add + Deliveries, then versioned content.
- **Cell Injury & Cell Death — Condensed (2026-10-18):** repo `third-year-med/cell-injury-condensed`, module key
  `cellcondensed`, prefix `cc_`, build `condensed-1.0`, own content key (env `CC_CONTENT_KEY` in sessions). Made the same way
  as inflcondensed from the cellinjury PACKAGED course: same 17 topics (IDs kept); 90 → 71 sections (merged sections keep the
  first ID; UX_UNITS/UX_FLOW targets kept); Learn text 19,073 → 8,053 words (−58 %, incl. tables and picture notes); real
  deck 241 → 204 slides, on-slide words 13,747 → 7,876 (−43 %; the 18 flowcharts and 17 quick-check questions are unchanged),
  speaker notes −47 %; all 203 questions, 16 cases, 131 glossary terms, 23 sequences, 16 comparisons, 32 schematic figures
  and 18 flowcharts kept; 78 → 62 atlas images, 118 → 31 picture links (topic sections that already show ≥ 2 pictures lost
  their link chips; the Practical topic keeps them); the low-yield hyper/hypopigmentation table and 8 rarely used stains
  were dropped. NOT carried over: cellinjury master v1.1 edits and the 30 `ci-robbins1` imported pictures. Robbins batch
  rebuilt for this module 2026-10-18: 30 pictures (Robbins Basic Ch. 1, Drive folder "Cell injury pictures"), keys
  `cc-robbins1-01…30`, file `cellcondensed-pictures-robbins1.json` (not committed), all 30 pass `picImportPlan` on the real page. e2e test
  "condensed Cell Injury module (cellcondensed)…" walks every section, view and slide; module smoke includes it.
- **Printing (2026-10-18, user request — students print the chapter):** patches `media-print`, `print-large`,
  `print-clean`, `print-mirror` (all modules). The print document now carries the module's own screen stylesheet plus a
  paper layer (`PRINT_MIRROR_CSS`): it looks like the screen (callouts, flowcharts as charts, colours), ≈ 13 pt text,
  ≈ 1 cm margins, added pictures one per row fitted to the page (before: a 1600-px picture ran off the page and the
  browser shrank the WHOLE chapter), atlas pictures two per row from the full-size file (before: hidden inside the
  print-hidden zoom button), picture-link cards left out. Check print changes by rendering the chapter to PDF
  (Playwright `page.pdf`) and looking at the pages — not only by the DOM.
  Grey block over a picture in the PDF (2026-10-19) = the print dialog opened before that picture was loaded/decoded
  (the print window is written with document.write; its load event does not wait for pictures) → patch `print-decode`.
- **Where new-module chats start (2026-10-17):** Claude Code → ＋ next to **Cloud** → repository
  `Interactive-pathology-platform`; the user first creates the empty module repo on GitHub, the chat attaches it
  (add_repo, push access). Everything is built in Claude Code (builder skill available there) — no Claude Home step.
  See the top of docs/NEW-MODULE-PROMPT.md.
- **Front page (2026-10-17):** opening a module from the Teacher Dashboard (Admin or personal teacher) always requests a
  FRESH teacher pass — never reuse a saved one — and drops an old saved server address of that module (`resetModuleUrl`;
  both showed the module's student sign-in; see §8).
- **Standing instruction (user, 2026-10-16):** finished + tested → merge into `main` and push directly (no asking);
  still report what went live and give Portal.gs deploy steps when the backend changed.
- Older history below.


- **Portal.gs 2.12 (2026-10-11): `tsPresentCodes`** — the presentation code badge failed when the Admin opened a module
  WITHOUT a group (main storage `cellinjury`) while the lecture's attendance lives in the group storage (`cellinjury-<link>`).
  Public action, authed_ by the module page's TEACHER token for `storage`: live TS lectures whose backendModule === storage or
  starts with storage + '-'; read-only (never renews a rotating code). The modules poll it next to listAttendanceSessions.
- **Teacher Dashboard redesign (2026-10-11, front end only):** compact cards → one view at a time (`#/teacher/<view>`:
  modules, sessions, attendance, exams, manage, directory; personal teacher: the first four). `dashShell()` in portal.js wraps the
  EXISTING sections unchanged (built once, kept in the page → typed input survives view switches); `route()` switches views
  without re-rendering (`dashShow()`), asks before leaving with unsaved forms (any typed `<form>` still on the page, or the
  module-card editor's `data-dirty`), `beforeunload` too. Card summaries come from data already loaded (sessionsSection /
  examsSection / directorySection callbacks; the directory loads only when opened). Student Attendance = the sessions
  section's by-student table drawn in its own view (`opts.attHost`) + `reportView`. e2e helper `dash(p, view)`.
- **Portal.gs 2.11 (2026-10-11): Admin can delete an ENDED lecture** (history → 🗑 Delete, typed `DELETE`; `tsDelete` with
  confirm:'DELETE' → Code.gs `actionDeleteAttendanceSession_` removes its AttendanceSessions row + records, Drive copy to trash;
  refused while live and for personal teachers). Same day: fixed attendance code by default (rotation opt-in) and the open
  code shown on the module's Presentation slides (teacher only).
- **Portal.gs 2.10 (2026-10-10): Teaching Sessions steps 1–4 complete** (teacher panel; group-page card with check-in; group Live
  Classroom, see §3). Code.core.gs test fixture includes the verbatim attendance engine and Live Classroom engine of
  Code.gs (attendance Drive copy stubbed; `driveFake()` in the harness fakes Drive uploads). Tests: 76 backend, 46 e2e.
- Portal.gs **2.6** (2275 lines, with platformCheck) deployed by the user on 2026-10-10; in the repo (Official Exams: places/hand-off, public exam list, combined exams, bank transfers,
  picture questions, combined-exam teaching lock, per-module results); the user had **2.5** deployed before this.
- Exam app `third-year-med/pathology-exams` (single `index.html`): `?m=<storage>` manager/student, `?g=<code>` front
  page. Examiner sessions come from the Teacher Dashboard (`examOpen`) in `sessionStorage['xm_<storage>_tt']`
  `{token, ck, keys, home}`; `keys` = content keys of the modules the user may copy from.
- Official Exams = directory module `exams`; delivered → storage `exams-<code>`, exam accounts via `rosterStorages_`.
  Each bank question keeps `source {kind, origId, course}`; `course` decides the per-module sub-score.
- Teaching ↔ exam transfers go through Portal (`examCopySources`, `examCourseExtras`, `examCopyFrom`, `examTeachWrite`);
  the caller is a personal teacher when its module token has a PortalGrants row, otherwise the Admin.
- Modules: Cell Injury (build "2026-09-24 11:46 UTC", master v1.1, versioned content ON) and Inflammation (build
  "initial", master v1.0, ON).
  Introduction to Pathology (`intropath`, prefix `ip_`, repo third-year-med/introduction-to-pathology, Chapter 1 —
  first card) added 2026-10-10: front-page card, directory module + deliveries, Code.gs entries, platform block; tested
  by the user. Versioned content: master v1.0 created and switched ON by the user (2026-10-10). Groups include `cellinjury-B`, `cellinjury-C` (not registered), `cellinjury-razi-a-26`.
- The 10-step multi-university plan is complete; the packaged-release procedure, the Practical fixes and the 7 exam
  steps are done.
- Tests: 60 backend, 43 e2e (with keys). The e2e exam test drives the real exam app; the harness fakes DriveApp
  (uploads in `backend.drive`). `test/apps-script/Code.exam.gs` is a verbatim copy of Code.gs's exam engine (no keys).
