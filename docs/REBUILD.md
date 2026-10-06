# Rebuilding a module (a new packaged build)

A module's course (topics, sections, questions, cases, images) is packaged inside its `index.html` on GitHub. The
edits made on the platform (the master copy and each group's local changes) are stored on the backend as an
**overlay** on top of that package. A rebuild replaces the package, so it follows this procedure, which keeps
every edit that still fits and asks you about each one that does not.

## The ID rules for every build

1. A topic, section, question or case that continues keeps its ID (`t03`, `s0302`, `q117`, `c05`, image IDs).
2. An ID is never reused for different material. A question that is changed substantially gets a new ID; the
   old ID is retired.
3. A build never contains the same ID twice (the release tool refuses it).
4. New material gets new IDs. If you built an imported question or a custom topic into the package, give it the
   ID it already had: the compatibility check then offers "Remove (now part of the new build)".

## The procedure

**1. Make the preview file** (on a computer with the module repository and its content key):

```
CONTENT_KEY=<the module's content key> node tools/module-release.js preview <new-build.html> <module repo> --build <label>
```

- The new build is written to `<module repo>/preview/index.html`.
- The tool adds the current platform block and the live file's connection settings, and labels the build.
- It is encrypted with the **preview key**. Portal.gs derives that key from the content key and gives it only to
  the Admin's master-draft session, so students and teachers cannot open the preview.
- It also prints which IDs the new build adds, changes or removes compared with the live file.
- Commit and push `preview/index.html`. Students still get the live `index.html`; nothing has changed for them.

The content key comes only from the environment variable. It is never written to a file, printed or committed.

**2. Open the preview.** Platform Home → Teacher Dashboard → Platform directory → Content → **🔁 New build** →
**🔍 Open preview**.
- A yellow banner says **PREVIEW**. You see the new build with the master draft on top.
- Opening the preview records which IDs the new build contains. The live module does the same whenever you open
  it with **Edit master draft**.

**3. Check compatibility.** Same panel → **Check compatibility**. Every item of the master draft and of every group's
local changes is compared with the new build:

| Result | Meaning | Decisions |
|---|---|---|
| fits | its target is still there | — (kept) |
| carried forward | lives only in the overlay (practicals, presentation, imported questions, custom topics, media) | — (kept) |
| target missing | the topic/section/question/case/image it changes or hides is no longer in the build | Remove · Keep |
| some IDs missing | a list (topic order, quiz extras, revision exclusions) names IDs that are gone | Remove only the missing IDs · Keep |
| changed | it overrides an item that the new build also changed: keeping it hides the new version | Keep · Remove (use the new build) |
| ID now in the build | an imported question or custom topic whose ID the new build now uses itself | Remove (now part of the new build) |
| not checked | the Last-Minute Review and challenge cards, which are made from the course while it runs | look at them in the preview |

Choose a decision for every listed item, then press **Save decisions**. Nothing changes yet.

**4. Go live.**
1. On the computer: `CONTENT_KEY=… node tools/module-release.js golive <module repo>`. This turns the preview into the
   live `index.html` (live key, preview mark removed) and deletes `preview/`. Commit both changes in **one** commit
   and push. GitHub Pages serves it within about a minute.
2. Platform Home → Content → New build → Check compatibility → **🚀 Go live**.
   - The button checks that the live page on GitHub now shows the new build.
   - It applies your decisions to the master draft and the groups' local copies.
   - It publishes a new version recorded with the new build, and every group receives it at its next sync.

Between the push and pressing Go live, students see the new build with the previous overlay. Press Go live
within a few minutes of the push.

Assessments, exams, results, attendance and student accounts are never touched by a rebuild.

## Going back

- **Same build:** Version history → Restore (as for any version).
- **Older build:** first return the module's `index.html` on GitHub to that build's commit, which is listed in the
  repository history with the build label. Then restore the version recorded with that build. The Restore button
  warns you when a version was made for a different build than the live one.

## Other commands

```
node tools/module-release.js inspect <index.html>        # build label, item counts, duplicate-ID check
node tools/module-release.js compare <old.html> <new.html>  # IDs added / changed / removed
node tools/module-release.js refresh <module repo> [--build LABEL]  # update only the platform block of the live file
```
