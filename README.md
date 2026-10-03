# Interactive Pathology Teaching Platform — front page

The shared entry point for all pathology chapters: one page that shows every module with its status, and one
student sign-in that opens exactly the modules the student's account is registered for.

- **Module status** (set by the teacher, shown to everyone): **Available** · **Completed – not yet released** · **Coming soon**.
- **Access is decided by accounts, not by status.** After signing in, a student can open a module only if an active
  account with that **Student ID and password** exists in that module (created in the module's Teacher portal → Students).
  A completed — or even "Available" — module stays closed to a student without an account there.
- **No change to the modules.** Cell Injury and Inflammation keep working exactly as before (their own
  links, sign-in, content and accounts). "Open module" hands the module its own normal session, so students do not sign
  in twice; if that is not possible, the module just shows its usual sign-in page.
- **Teacher Module Portal** (the **Teacher Module Portal** button at the top right): change status, titles, links, icons and order, and add
  new modules — no code needed.

Setting it up: **[SETUP.md](SETUP.md)**.

## Repository layout

| Path | |
|---|---|
| `index.html`, `config.js`, `assets/` | The front page (no secrets; `config.js` holds only the public backend URL) |
| `backend/Portal.gs` | The backend file to add to your Apps Script project(s) |
| `test/` | Backend tests (real Code.gs core + Portal.gs in a Node harness) and browser tests with two simulated backends |

`npm test` runs the backend tests; `npm run test:e2e` runs the browser tests (Playwright + Chromium).
