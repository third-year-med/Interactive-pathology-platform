# Module patches — the platform standard for every module page

The three model modules (`introduction-to-pathology`, `cell-injury-teaching-platform`, `inflammation-healing`) share the
same app code. Features added to them after they were built were applied as small, **idempotent** Python patches —
kept here so every **new** module gets them too.

```bash
bash modules/patches/apply.sh --check ../<module>/index.html   # ✅ up to date / ❌ missing features (changes nothing)
bash modules/patches/apply.sh ../<module>/index.html           # apply everything, in order
```

Best practice for a new module: start from the app code of a current model module (it already has everything), then
run `--check` before the first push. If a patch stops with an AssertionError, the page came from an older template —
copy the model module's app code rather than patching by hand. Verified: a model page from before these patches,
patched with `apply.sh`, is byte-identical to the current one.

| Order | Patch | What it gives the module | Backend needed |
|---|---|---|---|
| 1 | `assess-gate.py` | Assessments: a signed-in student is identified by the account (no name / email typing) | Portal.gs 2.18 |
| 2 | `quiz-pw.py` | Assessments open without a password; each assessment's OWN password only to start it; completed attempts reviewable; teacher sets passwords per assessment; Enter in a prompt no longer reopens it | 2.19 |
| 3 | `retire-class-pw.py` | The class quiz password is retired (an assessment without its own password shows "🔒 Not open yet") | 2.20 |
| 4 | `assess-tab-pw.py` | Passwords live inside Teacher Portal → 📝 Assessments (status strip, 🔑 Passwords sub-tab, Password column) | 2.19+ |
| 5 | `pw-mask.py` | Passwords covered (••••••); 👁 Show reveals one at a time (2 min); never in toasts | — |
| 6 | `quiz-list-first.py` | The Assessments tab always opens on the list; an attempt in progress continues via ▶ Resume; "Student ID …" instead of the @student.local address | — |
| 7 | `assess-compact.py` | Student My Assessments: compact rows in foldable groups To do / Completed / Not available now, newest first | — |
| 8 | `att-code-only.py` | Attendance: a signed-in student types only the code (QR link: only ✓ Check in) | — (Code.gs fills identity) |
| 9 | `stu-header.py` | Module header: no Teacher link / Class server chip for signed-in students (Offline / Syncing chip only) | — |
| 10 | `sync-cursor.py` | Per-tab sync cursor: two open tabs of one module can no longer drop content from the saved copy | — |
| 11 | `pw-copy.py` | 📋 Copy next to each assessment password (stays covered); plain "Hide" (no 🙈) | — |
| 12 | `quick-panel.py` | Learn home: yellow "⭐ Quick access" panel (All topics · Glossary · Presentation mode) | — |
| 13 | `copy-groups.py` | Assessment Library: 📤 Copy to groups — one assessment into other groups of the module (published, assigned to everyone, same / random / no password; groups with attempts kept) | 2.21 |
| 14 | `topic-quizzes.py` | Assessment Library: ⚡ Topic quizzes — one quiz per topic from its practice questions (5 random per student, 5 min, 1 attempt, answers shown, random password), assigned to everyone, copied to the teacher's other groups; topics with < 5 questions skipped | 2.21 |
| 15 | `topic-order.py` | Student My Assessments: topic quizzes listed in topic order (Topic 1 first … last topic last), after the other assessments (newest first) | — |
| 16 | `picture-import.py` | Teacher Portal → 💾 Backup → 🖼 Import pictures: a picture-import file (`neo-picture-import`) adds each picture with caption + credit to its Learning section like “+ Picture” (Drive upload, appended — nothing replaced; own Images slide in Presentation mode); already-imported pictures (same key) are skipped; in ✏️ Edit master draft they go to the master draft | — |
| — | `navblock.py` | Writes `modules/platform-nav.js` into the page's `<script id="platform-nav">` (learning-lock guard, back link, …) | 2.18 for the lock |

Test after applying: `node test/module-smoke/smoke.js` (boots every module with a synthetic course: student sign-in,
Assessments, learning lock) and the e2e suite (`cd test && node --test e2e.test.js`).

A new feature for all modules = a new idempotent patch here (anchor text asserted to occur once; skip when the new
text is already there), appended to `ORDER` in `apply.sh` and to this table.
