# Setting up the front page

You need: the Apps Script project behind **Cell Injury / Inflammation** (the "main" backend). The front page itself is
this repository on GitHub Pages. Nothing in the existing modules changes. The front page starts with two modules:
**Cell Injury & Cell Death** and **Inflammation & Healing** (both *Available*); more can be added later in the teacher panel.

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
that project too and enter its web-app URL as the module's *Other backend URL* in the teacher panel.

## 3. Turn on GitHub Pages

Repository **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**. The front page is then at
`https://third-year-med.github.io/Interactive-pathology-platform/`.

## 4. First teacher sign-in and the module list

1. Open the front page → **Manage modules** (bottom of the page).
2. The first time, create the **front-page teacher password** (at least 8 characters). It only manages this page.
   *If it says a teacher password already exists:* your main backend still has the old shared teacher password from
   before per-module passwords — sign in with that one.
3. For every module set: **status**, title, subtitle, icon, colour and link. Under **Advanced**:
   - *Backend module key* — the module's key on the backend (`cellinjury`, `inflhealing`, …); student
     access is checked against that module's accounts.
   - *Open students straight in* — **Platform modules** for Cell Injury / Inflammation / later chapters built the same way
     (with their *storage prefix*, e.g. `ci_`, `ih_`); **New-edition sites** for sites that keep a `vp_<key>_session`;
     **No** for any site that should show its own sign-in.
   - *Other backend URL* — only for modules on another Apps Script deployment.
4. **Save changes.** Students see the new list the next time they open or reload the page.

## 5. Give students access

Status never opens a module by itself. A student can enter a module when their account exists there:
**that module's Teacher portal → Students** (same Student ID; for one sign-in to open several modules the student
needs the **same password** in each — otherwise the card says "Registered — different password" and links to the
module's own sign-in).

## Adding a new module later

1. Build/publish the module as usual (its own site and its key in `STUDENT_AUTH_MODULES` on the backend).
2. Front page → Manage modules → **＋ Add a module**, fill in the fields, status **Coming soon** or **Completed – not yet
   released**, Save.
3. When teaching starts: create the student accounts in that module, then set its status to **Available**.
