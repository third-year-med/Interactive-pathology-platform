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
| `Vulvar-pathology` | The first module rebuilt on the Apps Script + GitHub Pages model (its own `Gyn.gs` backend, teacher editor) | its own Pages site |

**Backend:** one Google Apps Script project (the "main backend") holds both module data and the platform:
- **`Code.gs`**: written and maintained **by the user**. Never rewrite it; never ask to paste it into the repo. The only
  change ever made was ONE line in `route_` (see SETUP.md 1.3) that calls `portalHook_(module, p)`.
- **`Portal.gs`**: maintained in this repo (`backend/Portal.gs`), pasted by the user into a separate Apps Script file
  named "Portal". Currently **version 2.5**.
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
  **👁 Preview** (read-only), "Use the master again", "Copy to master draft". Copying only affects the draft.
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

**Results & attendance (Step 10):** read-only overviews per delivery — Admin (Results & attendance tab: all deliveries)
and personal teachers (📊 button: own deliveries); per-student table, attendance register, CSV. Students are matched to
the roster by Student ID, then email, then unique name; unmatched records are listed under "Also found".

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

## 5. Adding the next module — checklist

1. **Build** the module with the builder skill. Choose `moduleKey` (lowercase letters/digits, **no "-"**) and a unique
   `storagePrefix` (e.g. `np_`). Use stable IDs (section 3 rules). Set `NEO_CONFIG.platformHome` to the front page.
2. **Content key**: the builder encrypts with a new key. The user adds it to Code.gs `CONTENT_KEYS` and the module to
   `STUDENT_AUTH_MODULES`, then deploys a new version. The key is never committed or shown in files.
3. **Platform block + build label**: `CONTENT_KEY=… node tools/module-release.js refresh <module repo> [--build LABEL]`.
4. Create the module repo, push `index.html`, enable GitHub Pages (`main` / root).
5. Platform directory → **Modules**: add it (title, URL, storage prefix, icon, colour); **Deliveries**: deliver it to
   groups; **Students**: accounts are created automatically for each group's roster; **Teachers**: tick assignments.
6. Content tab → **Migration report** → decisions → migrate → **Switch versioned content ON** (when the module has edits).
7. Test the real page with the key (section 7) before telling the user it is ready.
8. Update `SETUP.md`, this handbook, and give the user the exact deployment steps (section 6).

## 6. How the user deploys (always give these exact steps)

The user is a pathologist, not a developer. They follow steps literally and send screenshots.
- **Portal.gs update:** open `https://raw.githubusercontent.com/third-year-med/Interactive-pathology-platform/main/backend/Portal.gs`,
  Ctrl+A, Ctrl+C → Apps Script → open **Portal** (not Code.gs) → Ctrl+A, Ctrl+V → save → **Deploy → Manage deployments
  → ✏️ Edit → New version → Deploy** (same URL). Always state the **new line count and the last 3 lines** so they can
  check the paste.
- **Front page / modules:** they go live via GitHub Pages after a push (about 1 minute); the user then presses
  **Ctrl+F5** (a normal reload can show the old version for ~10 minutes).
- Code.gs changes are made by the user; give the exact line and where to put it.

## 7. Testing workflow (do this before every push)

- `cd test && node --test backend.test.js` — Portal.gs + the Code.gs core excerpt (`test/apps-script/Code.core.gs`,
  verbatim copies of the needed Code.gs functions) in the Node harness (`test/apps-script/harness.js`).
- `node --test e2e.test.js` — Playwright (Chromium at `/opt/pw-browsers/chromium`) on the front page and on the **real
  module pages** from the sibling repos. With `CI_CONTENT_KEY` / `IH_CONTENT_KEY` set (env only) the real courses are
  unlocked; without keys those tests skip. `SHOTS=<dir>` writes screenshots — look at them.
- Smoke test against the user's **full Code.gs** + Portal.gs (scratchpad only, never committed) for every backend change.
- Reproduce a reported bug on the real page first (harness backend + Playwright), find the cause, then fix the smallest
  thing; keep the reproduction as a permanent test.

## 8. Lessons learned (bugs we hit and what fixed them)

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

## 9. How to work with the user

- Keep the agreed plan order; finish one step, report, and wait for "continue" before the next.
- Explain in plain language, with exact buttons and paths; answer screenshots precisely; never guess — inspect first.
- Preserve existing features and data; no redesigns or rewrites unless asked; smallest reliable fix.
- After each step give: what changed, how it was tested, and the exact deployment steps.

## 10. Current state (2026-10-06)

- Portal.gs **2.5** in the repo (speed); the user had **2.4** deployed before 2026-10-07.
- Modules: Cell Injury (build "2026-09-24 11:46 UTC", master v1.1, versioned content ON) and Inflammation (build
  "initial", master v1.0, ON). Groups include `cellinjury-B`, `cellinjury-C` (not registered), `cellinjury-razi-a-26`.
- The 10-step multi-university plan is complete; the packaged-release procedure and the Practical fixes are done.
- Tests: 52 backend, 40 e2e (with keys).
