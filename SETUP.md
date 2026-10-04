# Setting up the front page

You need: the Apps Script project behind **Cell Injury / Inflammation** (the "main" backend). The front page itself is
this repository on GitHub Pages. The front page starts with two modules: **Cell Injury & Cell Death** and
**Inflammation & Healing** (both *Available*); more can be added later in the Teacher Dashboard.

> **Updating from an earlier version?** Replace the contents of the `Portal` file in Apps Script with the new
> [`backend/Portal.gs`](backend/Portal.gs) (version 1.5 — group rosters), save, and deploy
> a **new version** (step 1.4). The Code.gs line from step 1.3 stays as it is.

## 1. Main backend (Cell Injury, Inflammation …)

1. Open that Apps Script project (the one whose web-app URL is in `config.js`).
2. **Files → ＋ → Script**, name it `Portal`, paste the whole of [`backend/Portal.gs`](backend/Portal.gs), save.
3. In **Code.gs**, find this line in `route_`:
   ```js
     if (EX_PUBLIC_ACTIONS[action]) return exRoute_(module, p);
   ```
   and add **one line directly below it**:
   ```js
     if (typeof portalHook_ === 'function') { var hp = portalHook_(module, p); if (hp) return hp; }
   ```
   It only handles requests for the front page (module `portal`); every other request continues exactly as before.
4. Save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (same URL).

## 2. (Later, only if needed) a module on another backend

If you later add a module whose student accounts live on a **different** Apps Script deployment, do steps 1.2–1.4 in
that project too and enter its web-app URL as the module's *Other backend URL* in Teacher Management. (Such a module
opens from the Teacher Dashboard on its own page; direct teacher entry works for modules on the main backend.)

## 3. Turn on GitHub Pages

Repository **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**. The front page is then at
`https://third-year-med.github.io/Interactive-pathology-platform/`.

## 4. Teacher Sign-In, Teacher Dashboard and the module list

There is **one teacher account** for the whole platform: Platform Home → **Teacher Sign-In** (yellow button, top right).

1. The first time, create the **teacher password** (at least 8 characters).
   *If it says a teacher password already exists:* your main backend still has the old shared teacher password from
   before per-module passwords — sign in with that one.
2. After signing in you are on the **Teacher Dashboard**:
   - **Teaching Modules** — **Open module →** enters the module directly in teacher mode (no module password; it does
     not depend on student accounts and works for modules that are not yet released). **Teacher Portal** opens that
     module's own Teacher Portal (students, content, results, assessments, attendance …).
   - **Teacher Management** — the front-page list (below).
3. Teachers no longer use a module's own teacher password: on the modules' sign-in page the *Teacher* tab, and the
   module's Teacher Portal page, now point to this Teacher Sign-In.
4. **Sign out** (top right) ends the dashboard and the module teacher sessions opened from it.

The module list (Teacher Management):
1. For every module set: **status**, title, subtitle, icon, colour and link. Under **Advanced**:
   - *Backend module key* — the module's key on the backend (`cellinjury`, `inflhealing`, …); student
     access is checked against that module's accounts.
   - *Open students straight in* — **Platform modules** for Cell Injury / Inflammation / later chapters built the same way
     (with their *storage prefix*, e.g. `ci_`, `ih_`); **New-edition sites** for sites that keep a `vp_<key>_session`;
     **No** for any site that should show its own sign-in.
   - *Other backend URL* — only for modules on another Apps Script deployment.
   - *Group links* — the `?g=` groups of this module the teacher wants to open (e.g. `A, B`). The module's card on the
     Teacher Dashboard then gets a **Group link** chooser: pick a group and press **Open module →** or **Teacher Portal**
     to enter that group (its own students, results and attendance) in teacher mode — no group password.
2. **Save changes.** Students see the new list the next time they open or reload the page.

## Platform directory (Admin)

Teacher Dashboard → **Platform directory** (bottom of the page; opens when you click it). It records the structure of the
platform — nothing in it changes sign-in or module access yet (that comes in later steps):

- **Institutions** (e.g. Al-Razi University, Misrata University).
- **Groups** — each belongs to one institution (two universities can both have a "Group A"). Each group has a unique
  **link code** (e.g. `razi-a-26`): its address `…/?g=razi-a-26`. The code is fixed once the group has a delivery.
- **Modules** — one record per subject (filled from the front-page list the first time). A module is never copied.
- **Deliveries** — a module given to a group. Each delivery keeps its own students, results, attendance and assessments
  under its **storage name** `module-linkcode` (e.g. `cellinjury-razi-a-26`), which never changes.
- **Existing data** — a read-only scan of the storage names already in your data (e.g. `cellinjury`, `cellinjury-B`).
  To register existing data: create a group whose link code matches the part after "-" (e.g. `B`) and deliver the module
  to it; for the normal link (no `?g=`) tick *Use the existing storage of the normal link* when adding the delivery.

### Group front pages

Each active group has its own front page: `https://third-year-med.github.io/Interactive-pathology-platform/?g=<link code>`
(e.g. `?g=razi-a-26`). **To get it:** Teacher Dashboard → Platform directory → **Groups** → the group's *Student link*
→ **📋 Copy link** (or **Open ↗** to check it first). It shows the institution, the group and **only that group's modules** (its active deliveries).
Students sign in there if they are **in the group** (Platform directory → **Students**) and have an account in the
group's modules (created automatically from the roster). The link code only selects the group:
changing it never opens another group's modules — the backend checks the account in each delivery's own storage.
"← Back to Platform Home" inside a module opened from a group page returns to that group's page. An unknown or
inactive link shows the main platform page with a notice. Without `?g=` the front page is exactly as before.

### Group students (rosters)

Platform directory → **Students** → choose the group:
- **Add students** — one per line: `Student ID, Name, Email (optional), Password (optional)`. Each student gets one
  account in **every** module of the group, all with the same password. Without a password a temporary one is generated
  and shown **once** (📋 Copy the list); the student chooses their own at first sign-in on the group page, and that new
  password is applied to all the group's modules. A password changed later inside a module also applies to all of them.
- A module delivered to the group later gets the members' accounts automatically (with their current password).
- **Reset password** gives a new temporary password for all of the group's modules. **Deactivate** closes all of the
  group's modules for that student at once (nothing is deleted).
- **Add N existing account(s) to this group** — accounts made earlier inside a module's Teacher Portal are not on the
  roster; press this once so those students can sign in on the group page.
- The same Student ID at another university is a different student with separate accounts.

Records are never deleted (deactivate them instead). The directory uses its own sheets — Institutions, Groups, Modules,
Deliveries, TeacherAssignments, ModuleContentRoles — created on first use; no existing sheet is changed.

## 5. Give students access

Status never opens a module by itself. A student can enter a module when their account exists there:
**Teacher Dashboard → that module's Teacher Portal → Students** (same Student ID; for one sign-in to open several modules the student
needs the **same password** in each — otherwise the card says "Registered — different password" and links to the
module's own sign-in).

## "← Back to Platform Home" inside the modules

Every module shows a return button at the top of its header (all views) and on its sign-in screen. It follows the role
the class server confirmed for the session: students see **← Back to Platform Home** (the student front page);
teachers who opened the module from the Teacher Dashboard see **← Back to Teacher Dashboard**. It is one small shared component in each module's `index.html`:
- `"platformHome": "https://third-year-med.github.io/Interactive-pathology-platform/"` in the module's `NEO_CONFIG`;
- the `<script id="platform-nav">…</script>` block (just before `<script id="neo-data"`), copied unchanged from
  Cell Injury or Inflammation. It also routes teacher access to the single Teacher Sign-In.

## Adding a new module later

1. Build/publish the module as usual (its own site and its key in `STUDENT_AUTH_MODULES` on the backend), including the
   `platformHome` setting and the `platform-nav` block above.
2. Platform Home → Teacher Sign-In → Teacher Management → **＋ Add a module**, fill in the fields, status **Coming soon** or **Completed – not yet
   released**, Save.
3. When teaching starts: create the student accounts in that module, then set its status to **Available**.
