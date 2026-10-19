# CLAUDE.md — Interactive Pathology Teaching Platform

Read **`docs/HANDBOOK.md`** first (new module: the user starts with the prompt in `docs/NEW-MODULE-PROMPT.md`): the decisions, architecture, the checklist for adding a module, the deployment steps
the user follows, the testing workflow and the lessons learned. `docs/REBUILD.md` is the procedure for a new packaged
build of a module; `SETUP.md` is the user-facing setup guide.

Essentials:
- **Repositories in use:** `third-year-med/Interactive-pathology-platform` (this one — start every chat here),
  `introduction-to-pathology`, `cell-injury-teaching-platform`, `inflammation-healing`, `pathology-exams`,
  the condensed modules `third-year-med-inflammation-condensed` (`inflcondensed`) and `cell-injury-condensed` (`cellcondensed`);
  `Gyn-pathology` is kept but not part of the platform. **`Vulvar-pathology` and `vaginal-pathology` were DELETED on
  2026-10-10 — never refer to, link to, clone or build on them.**
- **Links to files:** always give the FULL GitHub address, e.g.
  `https://github.com/third-year-med/Interactive-pathology-platform/blob/main/docs/NEW-MODULE-PROMPT.md` — a bare path
  like `docs/NEW-MODULE-PROMPT.md` opens in whatever repository the chat is attached to.
- **New modules are CONDENSED by default (user, 2026-10-19):** high-yield, ≈ 50 % of a full write-up (Learn text and
  slides), all features and the full question bank kept — HANDBOOK §4.2. Build a full-length module only when asked.
  The NAME never mentions it: no "Condensed" (or similar) in titles, cards, page text, keys or repository names.
- Code.gs belongs to the user — never rewrite it. `backend/Portal.gs` (here) is pasted by the user into the Apps Script
  file "Portal"; after each change give the raw-URL steps, the new line count and the last 3 lines, then
  "Deploy → Manage deployments → Edit → New version → Deploy".
- **Never give the user a whole new Code.gs** — only the lines to add and where (a replaced Code.gs lost the Portal line on
  2026-10-10 and took the front page down). New module: follow HANDBOOK §5; the user runs **platformCheck** (▶ in Apps
  Script) before every deploy and deploys only on ✅.
- Never commit or expose content keys, GitHub tokens, admin credentials or the user's full Code.gs. Keys only as env
  variables (`CI_CONTENT_KEY`, `IH_CONTENT_KEY`, `CONTENT_KEY`) in a session.
- `?g=` selects a group but never grants access. Module IDs never contain "-". Storage of a delivery = `<module>-<linkCode>`.
- With versioned content ON, edits inside a module go to that storage's local layer; only "Edit master draft" +
  "Publish draft" change the master.
- **Module features shared by all modules** live as idempotent patches in `modules/patches/` (README = list + order).
  A feature for all modules = a new patch there; a new module must pass `bash modules/patches/apply.sh --check`.
- Test before every push: `cd test && node --test backend.test.js && node --test e2e.test.js` (real module pages from the
  sibling repos; set the content keys as env variables to unlock them). Reproduce bugs on the real page first.
- Keep the user's plan order, explain in plain language with exact buttons, preserve existing features and data.
- **Merging (user's standing instruction, 2026-10-16):** once a change is finished and all tests pass, merge it into
  `main` and push directly (platform and module repos) — do not ask for authorization first. Still tell the user what
  went live and give the Portal.gs deploy steps when the backend changed.
