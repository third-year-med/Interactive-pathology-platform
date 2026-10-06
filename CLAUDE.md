# CLAUDE.md — Interactive Pathology Teaching Platform

Read **`docs/HANDBOOK.md`** first: the decisions, architecture, the checklist for adding a module, the deployment steps
the user follows, the testing workflow and the lessons learned. `docs/REBUILD.md` is the procedure for a new packaged
build of a module; `SETUP.md` is the user-facing setup guide.

Essentials:
- Code.gs belongs to the user — never rewrite it. `backend/Portal.gs` (here) is pasted by the user into the Apps Script
  file "Portal"; after each change give the raw-URL steps, the new line count and the last 3 lines, then
  "Deploy → Manage deployments → Edit → New version → Deploy".
- Never commit or expose content keys, GitHub tokens, admin credentials or the user's full Code.gs. Keys only as env
  variables (`CI_CONTENT_KEY`, `IH_CONTENT_KEY`, `CONTENT_KEY`) in a session.
- `?g=` selects a group but never grants access. Module IDs never contain "-". Storage of a delivery = `<module>-<linkCode>`.
- With versioned content ON, edits inside a module go to that storage's local layer; only "Edit master draft" +
  "Publish draft" change the master.
- Test before every push: `cd test && node --test backend.test.js && node --test e2e.test.js` (real module pages from the
  sibling repos; set the content keys as env variables to unlock them). Reproduce bugs on the real page first.
- Keep the user's plan order, explain in plain language with exact buttons, preserve existing features and data.
