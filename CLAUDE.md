# CLAUDE.md — Interactive Pathology Teaching Platform

Read **`docs/HANDBOOK.md`** first (new module: the user starts with the prompt in `docs/NEW-MODULE-PROMPT.md`): the decisions, architecture, the checklist for adding a module, the deployment steps
the user follows, the testing workflow and the lessons learned. `docs/REBUILD.md` is the procedure for a new packaged
build of a module; `SETUP.md` is the user-facing setup guide.

Essentials:
- **ACTIVE MODULES ONLY (user, 2026-10-31 — applies to every task until the user changes it):** work only on
  `introduction-to-pathology` (`intropath`), `cell-injury-condensed` (`cellcondensed`), `inflammation-new` (`inflnew`),
  `neoplasia-new` (`neonew`), `Granulomatous-and-parasitic-diseases` (`granuloma`, added 2026-11-04), `third-year-med-autonomic-nervous-system` (`autonomic`, added 2026-11-11) and `genetics` (**Genetic Diseases**, renamed 2026-11-19 from "Genetics and Pediatric Diseases"; `genetics`, **re-activated 2026-11-15** at the user's request: brought up to date with all patches + the viva) and `third-year-med-hematology` (`hematology`, added 2026-11-17) and `genetics-new` (`genenew`, added 2026-11-17). All other modules are ARCHIVED (`modules/INACTIVE`: `cellinjury`, `inflhealing`, `inflcondensed`,
  `neoplasm`): never modify, rebuild, patch, refresh or delete them, even to fix an error — `apply.sh` and
  `tools/module-release.js` refuse them. A change to a shared component (patches, Portal.gs, platform-nav, tests) that
  could affect other modules needs the user's explicit approval first. Token policy: inspect only the files the task
  needs, make targeted changes, test only what the change touches, and give a short plan + the files to change before
  a major change. Tests that need the synthetic course use a throw-away patched copy:
  `cp ../cell-injury-teaching-platform/index.html $SCRATCH/ci.html && ALLOW_INACTIVE=1 bash modules/patches/apply.sh $SCRATCH/ci.html`,
  then `CI_MODULE_HTML=$SCRATCH/ci.html` (the archived repository itself is never written).
- **Repositories in use:** `third-year-med/Interactive-pathology-platform` (this one — start every chat here),
  `introduction-to-pathology`, `cell-injury-teaching-platform`, `inflammation-healing`, `pathology-exams`,
  the condensed modules `third-year-med-inflammation-condensed` (`inflcondensed`) and `cell-injury-condensed` (`cellcondensed`);
  `inflammation-new` (**Inflammation (New)**, `inflnew`, `in_` — the user's own inflammation syllabus, NOT condensed, 2026-10-29; Healing topics t14–t19 added 2026-10-30, practical t13 kept last);
  `neoplasia-new` (**Neoplasia (New)**, `neonew`, `nn_` — the user's own neoplasia syllabus "Neoplasia (Ch. 6)", NOT condensed, 2026-10-30; separate from Neoplasia `neoplasm`);
  `Granulomatous-and-parasitic-diseases` (**Granulomatous and Parasitic Diseases**, `granuloma`, `gp_` — the user's syllabus "Chapter 6", NOT condensed, 2026-11-04; page URL has a capital G; HANDBOOK §4.2.4);
  `third-year-med-autonomic-nervous-system` (**Autonomic Nervous System**, `autonomic`, `an_` — the FIRST PHYSIOLOGY module: Medical Physiology for the
  Faculty of Dentistry, from the course lecture "Autonomic N.S. Physiology", VERY condensed, 2026-11-11; HANDBOOK §4.2.5; the user's next physiology module is
  "Physiology of the Nerve");
  `third-year-med-hematology` (**Hematology**, `hematology`, `hm_` — the user's syllabus "Fundamentals of Pathology" Ch. 5–6, RBC and WBC disorders, NOT condensed, 2026-11-17;
  book MCQs mixed into the module bank, out-of-syllabus MCQs left out; practical material to follow; HANDBOOK §4.2.6);
  `genetics-new` (**Genetics and Pediatric Diseases (New)**, `genenew`, `gn_` — a VERY condensed (~28 %) separate version of Genetics, 2026-11-17; Genetics stays unchanged; HANDBOOK §4.2.7);
  `Gyn-pathology` is kept but not part of the platform. **Neoplasia (2026-10-19):** the OLD test module (repository `Neoplasia-platform`,
  DELETED 2026-10-19; key `neoplasia`) is retired — the NEW module is a fresh build in `third-year-med/neoplasia` with module key `neoplasm`,
  prefix `nm_` (never reuse the key `neoplasia`: old test data may sit under it on the backend). Built 2026-10-19 (build 1.0,
  HANDBOOK §10); 101 atlas pictures (PEIR + Commons) and 84 WebPath/WebPathology link cards added the same day. **`Vulvar-pathology` and `vaginal-pathology` were DELETED on
  2026-10-10, and `Neoplasia-platform` (the old Neoplasia test) on 2026-10-19 — never refer to, link to, clone or build on them.**
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
- **Two attendance systems — KEEP BOTH (user, 2026-10-20):** the module's own attendance (Teacher Portal → Attendance and the
  📋 Attendance tab) and the platform's 🎓 Teaching Sessions. Both write the same AttendanceSessions / AttendanceRecords rows
  (Overall Pathology Attendance counts both). Never remove or hide either; a fix for one is checked in the other.
- **Module features shared by all modules** live as idempotent patches in `modules/patches/` (README = list + order).
  A feature for all modules = a new patch there; a new module must pass `bash modules/patches/apply.sh --check`.
- Test before every push: `cd test && node --test backend.test.js && node --test e2e.test.js` (real module pages from the
  sibling repos; set the content keys as env variables to unlock them). Reproduce bugs on the real page first.
- **After every change to `assets/portal.js` or `assets/portal.css`, raise `?v=` on both in `index.html`** (e.g. `?v=2026-11-10b`), or browsers keep the old file (user 2026-11-10: the Module Report still showed the test student).
- **🎓 Viva Examination (2026-11-11, pilot Inflammation (New); Neoplasia (New), Granulomatous, Introduction to Pathology, Cell Injury and Genetics added 2026-11-15):** patch `viva` + Portal.gs 2.45 (`vb*` actions, sheet VivaResults). The viva banks (`<module>-viva-bank.json`, format `neo-viva-bank`) are course material: delivered to the user and imported in ✏️ Edit master draft, never committed. To add a module, put its key in `VIVA_MODULES` in `modules/patches/viva.py` (now: inflnew, neonew, granuloma, intropath, cellcondensed, genetics, hematology, genenew). e2e: "🎓 Viva Examination (<key>)" per module; `<PFX>_VIVA_BANK=<file>` tests the real delivered bank.
- **▶ Viva presentation (user, 2026-11-17, patch `viva-present`):** teachers present viva questions in class (the current selection or an 📌 Official viva) — question → R model answer + marking points → R each follow-up question → R its answer (user, 2026-11-17); nothing recorded. Applied to all active modules (Genetics too, 2026-11-17).
- **🙈 Students do not see 🎞️ Present / 🖨 Print / 🖨️ Print Entire Chapter in Learn (user, 2026-11-19, patch `learn-print-hide`, all active modules)** — too many PDF pages; teachers keep them; 📄 Print Condensed Handout stays. The section row (Mark as read/unread, Practice questions, Show as slide) is hidden from students too (patch `learn-sec-actions-hide`).
- **🔐 Spotter, OSPE, Image atlas, Image Bank and 🎬 Video Lectures are Admin-only (user, 2026-11-16, patch `prac-admin-only` v2, all active modules):** students and teachers see only the practical cases (and presentation); never re-expose them without the user's request.
- **New patches insert before the PREVIOUS new patch's header and never edit another patch's text** (shared anchors made patches re-insert themselves, HANDBOOK §8); run `apply.sh --check` on every module.
- **🩺 Clinical Cases = own main tab between Review and Practical (user, 2026-11-16, patch `cases-tab`)**, with ▶ Present all cases and 🖨 Print PDF; the Practical front page has the same two buttons (patch `prac-hub-actions`). ▶ Present all cases uses LARGE text (user, 2026-11-18, patch `cases-present-large`; Practical and Viva presentations too, patch `present-large`).
- **Practical standard for every new module (2026-11-14): HANDBOOK §4.4** — all uploaded pictures used; **every practical picture also in its Learn topic, ONE picture per finding (2026-11-16, all modules; repeats out with a `neo-picture-remove` file, patch `picture-remove`)**; clinical photos in the
  gross slot (before micro); Spotter Practice = ~38 hardest (one per picture), Exam = all; exam-only questions also as a 🔒
  bank file (`pic:` refs); OSPE pictures from one case; add the key to `PRAC_CLEAN_MODULES`; every import in ✏️ Edit master
  draft. GitHub renamed repos: `Inflammation-New`, `Neoplasia-new`, `Granulomatous-and-parasitic-diseases` (exact case in URLs).
- Keep the user's plan order, explain in plain language with exact buttons, preserve existing features and data.
- **Merging (user's standing instruction, 2026-10-16):** once a change is finished and all tests pass, merge it into
  `main` and push directly (platform and module repos) — do not ask for authorization first. Still tell the user what
  went live and give the Portal.gs deploy steps when the backend changed.
  Confirmed again 2026-10-20: "always commit, don't ask again" — commit and push finished, tested work without asking
  for a "commit" reply (still scan every diff for keys first and summarise what changed).
