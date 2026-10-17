"""Attendance live panel (module Attendance tab and Teacher Portal → Attendance): no QR code and no link any more — only
the attendance code, projector-sized, with ⛶ Full screen (the code fills the screen; Esc / click closes), 🔄 Regenerate,
⏹ Close and the present count; the list of students below as before. Idempotent."""
import sys
OLD_START = "  renderTeacherSession(page) {\n    const S = AttT.state && AttT.state.session;\n    const link = AttT.token ? attendanceJoinUrl(AttT.token) : '';"
OLD_END = "      el('button', { class: 'btn mt1', onclick: () => this.regenerateCode() }, '🔄 Regenerate Code')));\n"
NEW = r"""  renderTeacherSession(page) {
    const S = AttT.state && AttT.state.session;
    // 2026-10-17 (user's request): no QR code and no link — only the code, big enough for the projector
    const curCode = (S && S.code) || AttT.code || '';
    page.appendChild(el('div', { class: 'card att-live', id: 'att-code-card' },
      el('div', { class: 'att-live-head' },
        el('div', null, S ? el('div', { class: 'small muted' }, (S.course || '') + (S.chapter ? ' — ' + S.chapter : '') + (S.academicYear ? ' · ' + S.academicYear : '')) : null,
          el('h2', { style: 'margin:.1rem 0 0' }, (S && S.sessionTitle) || 'Starting…'))),
      el('div', { class: 'att-code-big', id: 'att-code' }, curCode || '······'),
      el('div', { class: 'row att-live-actions' },
        el('button', { class: 'btn btn-primary', 'data-a': 'att-full', onclick: () => this.codeFullScreen() }, '⛶ Full screen'),
        el('button', { class: 'btn', onclick: () => this.regenerateCode() }, '🔄 Regenerate Code'),
        el('button', { class: 'btn btn-danger', onclick: () => this.closeSession() }, '⏹ Close attendance'))));
"""
FULL_ANCHOR = "  paintTeacher() {\n"
FULL = r"""  /** The attendance code over the whole screen (projector): Esc, ✕ or a click closes; follows a regenerated code. */
  codeFullScreen() {
    const S = AttT.state && AttT.state.session;
    const code = el('div', { class: 'att-fs-code' }, (S && S.code) || AttT.code || '······');
    const ov = el('div', { class: 'att-fs', role: 'dialog', 'aria-label': 'Attendance code' },
      el('button', { class: 'att-fs-x', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕'),
      code);   // the code only — a clean screen for the projector
    const close = () => { ov.remove(); document.removeEventListener('keydown', key, true); clearInterval(t); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { } };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const t = setInterval(() => { const c = (AttT.state && AttT.state.session && AttT.state.session.code) || AttT.code; if (c && code.textContent !== c) code.textContent = c; if (!AttT.active()) close(); }, 1500);
    ov.addEventListener('click', close); document.addEventListener('keydown', key, true);
    document.body.appendChild(ov);
    try { if (ov.requestFullscreen) ov.requestFullscreen().catch(() => { }); } catch (e) { }
  },
  paintTeacher() {
"""
CSS_ANCHOR = ".join-panel.big .live-code{font-size:4rem}\n"
CSS = CSS_ANCHOR + """.att-live{text-align:center}
.att-live-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;text-align:left;flex-wrap:wrap}
.att-code-label{margin-top:1rem;font-size:.85rem;font-weight:800;letter-spacing:.2em;color:var(--ink-2)}
.att-code-big{font-family:var(--mono,monospace);font-weight:800;letter-spacing:.12em;color:var(--navy);line-height:1.05;font-size:clamp(3rem,12vw,11rem);margin:.15rem 0 .35rem;white-space:nowrap}
.att-live-actions{justify-content:center;gap:.6rem;margin-top:.8rem;flex-wrap:wrap}
.att-fs{position:fixed;inset:0;z-index:100000;background:#0b2340;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;text-align:center;padding:2rem}
.att-fs-label{font-size:clamp(1rem,2.4vw,2rem);font-weight:800;letter-spacing:.25em;opacity:.8}
.att-fs-code{font-family:var(--mono,monospace);font-weight:800;letter-spacing:.1em;font-size:min(15vw,55vh);line-height:1;color:#ffd166;white-space:nowrap}
.att-fs-sub{font-size:clamp(1rem,2vw,1.8rem);opacity:.85}
.att-fs-x{position:absolute;top:1rem;right:1.2rem;background:none;border:0;color:#fff;font-size:2rem;cursor:pointer;opacity:.7}
"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if "2026-10-17 (user's request): no QR code and no link" not in s:
        i = s.index(OLD_START); j = s.index(OLD_END, i) + len(OLD_END); s = s[:i] + NEW + s[j:]; n += 1
    if "  codeFullScreen() {" not in s:
        assert s.count(FULL_ANCHOR) == 1; s = s.replace(FULL_ANCHOR, FULL, 1); n += 1
    if ".att-code-big{" not in s:
        assert s.count(CSS_ANCHOR) == 1; s = s.replace(CSS_ANCHOR, CSS, 1); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
