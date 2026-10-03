# Interactive Pathology Teaching Platform — front page

The shared entry point for all pathology chapters: one page that shows every module with its status, and one
student sign-in that opens exactly the modules the student's account is registered for.

- **Module status** (set by the teacher, shown to everyone): **Available** · **Completed – not yet released** · **Coming soon**.
- **Access is decided by accounts, not by status.** After signing in, a student can open a module only if an active
  account with that **Student ID and password** exists in that module (created in the module's Teacher portal → Students).
  A completed — or even "Available" — module stays closed to a student without an account there.
- **No second sign-in.** "Open module" hands the module its own normal session (student or teacher), so nobody
  signs in twice. Module content, images, quizzes and student accounts are unchanged.
- **One Teacher Sign-In** (yellow button, top right) → **Teacher Dashboard**: *Teaching Modules* (open any module
  directly in teacher mode, or its Teacher Portal for students/content/results) and *Teacher Management* (status,
  titles, links, icons, order, add/remove modules — no code needed). Modules no longer ask teachers for their own password.
- **Role-aware return button** at the top of every module: students get **← Back to Platform Home** (front page), teachers **← Back to Teacher Dashboard**.

Setting it up: **[SETUP.md](SETUP.md)**.

## Repository layout

| Path | |
|---|---|
| `index.html`, `config.js`, `assets/` | The front page (no secrets; `config.js` holds only the public backend URL) |
| `backend/Portal.gs` | The backend file to add to your Apps Script project(s) |
| `test/` | Backend tests (real Code.gs core + Portal.gs in a Node harness) and browser tests with two simulated backends |

`npm test` runs the backend tests; `npm run test:e2e` runs the browser tests (Playwright + Chromium).
