# Prompt for a new module

## Where to start (the whole module is built in Claude Code — no need for Claude Home)

1. On GitHub, create an EMPTY repository for the module (e.g. `third-year-med/neoplasia`) — a chat cannot always
   create repositories, but it can attach one that exists.
2. In the Claude app → **Code** → press **＋ next to "Cloud"** (not "This computer"; the old "Vulvar-pathology" folder
   was removed on 2026-10-17) → start with the repository **third-year-med/Interactive-pathology-platform**.
3. Paste the prompt below, fill in the [brackets] and attach the source material (PDFs, notes, images; very large
   files in smaller batches).
4. The chat attaches the new repository, builds the module with the pathology-teaching-platform-builder skill, runs
   `modules/patches/apply.sh --check` and the tests, pushes, and then gives you the steps only you can do: the four
   Code.gs additions, platformCheck, Deploy, the front-page card and the deliveries.
5. The new content key is shown ONCE in the chat — save it in your password manager (it is never written to a file).

## Condensed by default (2026-10-19)

New modules are written **condensed** (high-yield, about half the text and slides of a full write-up) — the prompt
below already says so, and the platform's CLAUDE.md and HANDBOOK §4.2 require it, so a chat follows it even if that
part of the prompt is missed. For a full-length module, delete the "CONTENT STYLE" section from the prompt.

## The prompt

Copy everything inside the box into a new Claude chat, replace the parts in [brackets] and attach the source material.

```
I want to add a new teaching module to my Interactive Pathology Teaching Platform.

MODULE
- Title: [e.g. Neoplasia]
- Chapter number / position on the front page: [e.g. Chapter 4 — after Inflammation & Healing]
- Module key: [e.g. neoplasia]  (lowercase letters/digits only, NO "-")
- Storage prefix: [e.g. np_]  (must be different from ip_, ci_, ih_)
- New GitHub repository: third-year-med/[e.g. neoplasia]
- Source material: [attached files / description]

BEFORE YOU START
1. Read these files in third-year-med/Interactive-pathology-platform and follow them exactly:
   CLAUDE.md, docs/HANDBOOK.md (especially §5 "Adding the next module — checklist", §6 deployment
   steps and §8 lessons learned), SETUP.md and docs/REBUILD.md.
2. Use the existing modules as the model: third-year-med/introduction-to-pathology,
   third-year-med/cell-injury-teaching-platform and third-year-med/inflammation-healing
   (same architecture, same look, same platform block). For the AMOUNT of text, the model is the
   condensed modules: third-year-med/third-year-med-inflammation-condensed and
   third-year-med/cell-injury-condensed.
3. Tell me your plan step by step before changing anything, and keep my plan's order.

CONTENT STYLE — CONDENSED (high-yield) BY DEFAULT
- Write the module condensed from the start, following docs/HANDBOOK.md §4.2: Learn text and slides about
  half of a full write-up, every syllabus point, definition, mechanism, classification and exam fact kept,
  repetition and long introductions cut, thin sections merged (3–6 per topic), 2–3 one-line key points per
  section, 3 must-know lines per topic.
- Keep ALL features and the COMPLETE question bank, cases, glossary, sequences and comparisons; every
  question must be answerable from the condensed text.
- Curate pictures (no duplicates, about 3 per section at most).
- Scientific QA of every topic against my source material.
- In the final report give me: Learn word count, slide count and on-slide words, sections per topic,
  pictures kept, and anything you were unsure about.
[Delete this section only if I want a FULL-length module this time.]

STRICT RULES
- NEVER give me a complete new Code.gs. Give me ONLY the lines to add and exactly where
  (Ctrl+F text). For a new module that is exactly four additions: STUDENT_AUTH_MODULES,
  CONTENT_KEYS, DEFAULT_QUIZ_PW, DEFAULT_LIVE_PW. Never remove or move anything else.
- The page must contain the platform block (<script id="platform-nav">, a copy of
  modules/platform-nav.js) and "platformHome" in NEO_CONFIG, so "← Back to Platform Home" works.
- The High-Yield Facts printout is the platform standard from that block (unit headings, bulleted facts,
  their **bold** key words, no Learning Block tags on paper). Keep the Last-Minute Review code of the model
  modules (LMR, lmrPrintFacts, lmrUnitOf) so the block takes over automatically; a module built differently
  calls window.PlatformHY.print(facts, { unitOf }). Never write a separate High-Yield print layout.
- Keep the model modules' attendance code unchanged: the session report lists every registered student of the
  group as Present / Absent with totals and percentages (HANDBOOK, "Module attendance report").
- The module must have every platform-standard feature (HANDBOOK §4.1): start from the app code of a current
  model module and run `bash modules/patches/apply.sh --check <repo>/index.html` — it must say ✅ before the
  first push (otherwise apply the patches with `apply.sh <page>` and test with `node test/module-smoke/smoke.js`).
- Use stable IDs for topics, sections, questions, cases and images (HANDBOOK §3).
- Never commit or show in any file: content keys, Code.gs, GitHub tokens, unencrypted course
  HTML or seed files. Give me the new content key ONCE in the chat so I can store it in my
  password manager. Scan every diff for keys before committing.
- The front-page card is DATA on my backend, not HTML: tell me the exact Teacher Dashboard
  steps (＋ Add a module, Advanced fields, ↑, 💾 Save) and the Platform directory steps
  (Modules → Add, Deliveries).
- Show me the diff before every commit to my existing repositories. Do not create pull requests.
- Test with the real page before telling me it is ready (HANDBOOK §7).

MY DEPLOYMENT STEPS (write them for me in this order, with exact buttons)
1. Code.gs: the four additions (where, and what to paste).
2. Apps Script → function list → platformCheck → ▶ Run → it must show ✅
   (if ❌, tell me how to fix it before deploying).
3. Deploy → Manage deployments → Edit → New version → Deploy.
4. Ctrl+F5 on the front page.
5. Teacher Dashboard → front-page card for the module.
6. Platform directory → Modules → Add, then Deliveries to my groups.
7. Run platformCheck again (✅).
8. Test in an incognito window: group page → test student → module → "← Back to Platform Home".
9. Platform directory → Content → the module → Migration report → Create master v1.0 →
   Switch versioned content ON.
If any Portal.gs change is needed: give me the raw GitHub link, the new line count and the
last 3 lines, then New version → Deploy.

WHEN YOU FINISH
Report: the repository URLs, the commit links, the live links, what I still have to do
(numbered, with exact buttons), and update docs/HANDBOOK.md (current state) for the next chat.
If something breaks after a deploy, first tell me how to roll back
(Manage deployments → Edit → Version: the previous one → Deploy).
```

## Prompt to condense an EXISTING module

For a module that was built full-length (as done for Inflammation & Healing and Cell Injury on 2026-10-18). Start the
chat the same way (Code → ＋ next to Cloud → Interactive-pathology-platform), after creating an EMPTY repository on
GitHub for the condensed copy.

```
Please make a condensed (high-yield, about 50 % shorter) version of my [MODULE NAME] module, the same way
the Inflammation and Cell Injury condensed modules were made (docs/HANDBOOK.md §4.2 and §10).

- Original module repository: third-year-med/[e.g. neoplasia] — do NOT change it.
- New repository (already created, empty): third-year-med/[e.g. neoplasia-condensed]
- New module key: [e.g. neocondensed]  (no "-")      New storage prefix: [e.g. nc_]
- The original module's content key: I will give it to you in the chat when you ask (never write it to a file).

Keep the architecture, every feature and the complete question bank; condense the Learn text and the
slides; keep the IDs of continuing topics, sections, questions, cases and images; curate the pictures;
scientific QA; test on the real page; then give me the report (word counts, slides, what was merged,
pictures), the NEW content key once, and my deployment steps (four Code.gs additions, platformCheck,
Deploy, front-page card, Platform directory Modules + Deliveries, versioned content ON before publishing,
⚡ Topic quizzes). If the original module has imported Robbins pictures, rebuild the picture-import file
for the condensed module from my Drive folder [folder name].
```
