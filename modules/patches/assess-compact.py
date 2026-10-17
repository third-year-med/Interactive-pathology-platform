"""Student My Assessments: one compact row per assessment, grouped To do / Completed / Not available now. Idempotent."""
import sys
START = "    const WIN = { upcoming: ['Opens later', 'navy'], open: ['Open', 'ok'], late: ['Past due — late work accepted', 'warn'], closed: ['Closed', 'bad'], cancelled: ['Cancelled', 'bad'] };\n    items.forEach(it => {"
END = "        el('div', { class: 'row mt1' }, btn, reason || noPw ? el('span', { class: 'small muted' }, reason || '🔒 Not open yet — your teacher has not given this assessment a password.') : null)));\n    });\n"
NEW = r"""    const WIN = { upcoming: ['Opens later', 'navy'], open: ['Open', 'ok'], late: ['Past due — late work accepted', 'warn'], closed: ['Closed', 'bad'], cancelled: ['Cancelled', 'bad'] };
    // Compact list: one slim row per assessment, grouped — To do · Completed · Not available now; newest first in each.
    const todo = [], done = [], other = [];
    // Newest first: when it was assigned (or opens, if later). The assignment id carries its creation time (AE_id:
    // prefix_<Date.now() base 36>…); without one the server's order is kept, later entries counted as newer.
    const assessWhen = (it, idx) => {
      const g = it.assignment || {}, m = /^[a-z]+_([0-9a-z]{8})/.exec(g.id || ''), t = m ? parseInt(m[1], 36) : 0;
      const made = Number(g.assignedAt) || (t > 1.5e12 && t < 4e12 ? t : 0);
      return Math.max(made, Number(g.availableFrom) || 0) || idx;
    };
    items.forEach(it => {
      const a = it.assessment, s = it.settings, w = it.assignment.window;
      const subs = it.attempts.filter(t => t.status === 'submitted');
      const lastSub = subs[subs.length - 1];
      const status = it.inProgressId ? ['In progress', 'warn'] : subs.length ? ['Submitted', 'ok'] : ['Not started', 'plain'];
      const reason = !it.canStart ? (a.status === 'closed' || a.status === 'archived' ? 'Closed by your teacher.' : w === 'upcoming' ? 'Opens ' + fmtDate(it.assignment.availableFrom) + '.' : (w === 'closed' || w === 'cancelled') ? 'The deadline has passed.' : (s.attemptsAllowed && it.attemptsUsed >= s.attemptsAllowed) ? 'All attempts used.' : '') : '';
      const noPw = it.canStart && !it.inProgressId && it.passwordSet === false;   // 2.20: no password yet → not open
      const can = it.canStart && !noPw;
      const btn = can ? el('button', { class: 'btn btn-sm ' + (it.inProgressId || !subs.length ? 'btn-primary' : 'btn-primary btn-ghost'), onclick: (ev) => this.start(it, ev.currentTarget) }, it.inProgressId ? '▶ Resume' : subs.length ? '↻ New attempt' : '▶ Start') : null;
      const meta = [plural(a.questionCount, 'question'), s.timeLimitMin ? s.timeLimitMin + ' min' : 'Untimed',
        s.attemptsAllowed ? it.attemptsUsed + ' of ' + s.attemptsAllowed + ' attempt' + (s.attemptsAllowed > 1 ? 's' : '') + ' used' : 'Unlimited attempts',
        it.assignment.dueAt ? '📅 Due ' + fmtDate(it.assignment.dueAt) : null, w !== 'open' && WIN[w] ? WIN[w][0] : null].filter(Boolean).join(' · ');
      const last = lastSub ? (lastSub.percent !== undefined ? 'Last: ' + lastSub.score + ' / ' + lastSub.total + ' (' + lastSub.percent + '%)' + (lastSub.passed === true ? ' · passed' : lastSub.passed === false ? ' · not passed' : '') : 'Last: result not released yet') + (lastSub.late ? ' · late' : '') + ' · ' + fmtDate(lastSub.submittedAt) : '';
      const why = reason || (noPw ? '🔒 Not open yet — your teacher has not given this assessment a password.' : '');
      const row = el('div', { class: 'card assess-card assess-row' + (it.inProgressId ? ' is-prog' : can ? ' is-open' : ''), 'data-assessment': a.id || '' },
        el('div', { class: 'assess-main' },
          el('h3', { title: a.description || a.title }, a.title),
          el('div', { class: 'assess-meta' }, meta),
          last ? el('div', { class: 'assess-meta assess-last' }, last) : null,
          subs.length ? el('div', { class: 'assess-hist' },
            subs.map(t => el('button', { class: 'btn btn-sm', 'data-attempt': t.id, title: t.review ? 'Review your answers' : 'See the result', onclick: () => this.openReview(it, t) }, '📄 Attempt ' + t.attemptNo + (typeof t.percent === 'number' ? ' · ' + t.percent + '%' : '') + (t.review ? ' — review' : ' — result')))) : null,
          why && (noPw || !(subs.length && !can)) ? el('div', { class: 'assess-why' }, why) : null),
        el('div', { class: 'assess-side' }, el('span', { class: 'badge ' + status[1] }, status[0]), btn));
      (can ? todo : subs.length ? done : other).push([-assessWhen(it, items.indexOf(it)), row]);
    });
    this.grp = this.grp || { todo: true, done: true, other: false };
    const group = (key, label, list, hint) => {
      if (!list.length) return;
      list.sort((x, y) => x[0] - y[0]);
      const d = el('details', { class: 'assess-group', 'data-group': key, open: !!this.grp[key], ontoggle: () => { this.grp[key] = d.open; } },
        el('summary', null, el('b', null, label), el('span', { class: 'assess-count' }, String(list.length)), hint ? el('span', { class: 'small muted' }, hint) : null),
        list.map(x => x[1]));
      page.appendChild(d);
    };
    const prog = items.filter(it => it.inProgressId).length;
    group('todo', '▶ To do', todo, prog ? prog + ' in progress — press ▶ Resume to continue' : 'press ▶ Start and enter the password your teacher gives you');
    group('done', '✓ Completed', done, 'open an attempt to review it — no password needed');
    group('other', '🔒 Not available now', other, 'closed, not open yet or no password set');
"""
CSS_ANCHOR = ".assess-card h3{font-size:1.1rem}\n"
CSS = CSS_ANCHOR + """.assess-group{margin:0 0 .7rem}
.assess-group>summary{display:flex;align-items:center;flex-wrap:wrap;gap:.3rem .55rem;cursor:pointer;padding:.35rem .2rem;list-style:none;color:var(--navy);font-size:.95rem}
.assess-group>summary::-webkit-details-marker{display:none}
.assess-group>summary::before{content:'▸';color:var(--ink-2);transition:transform .15s}
.assess-group[open]>summary::before{transform:rotate(90deg)}
.assess-count{background:var(--line-2);color:var(--ink-2);border-radius:999px;padding:0 .5rem;font-size:.75rem;font-weight:700}
.card.assess-row{display:flex;align-items:center;gap:.5rem 1rem;padding:.55rem .85rem;margin:0 0 .4rem;box-shadow:none}
.assess-row.is-prog{border-left:4px solid var(--warn);background:var(--warn-soft)}
.assess-row.is-open{border-left:4px solid var(--teal, #0f9d8a)}
.assess-main{flex:1;min-width:0}
.assess-card.assess-row h3{font-size:1rem;margin:0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.assess-meta{font-size:.8rem;color:var(--ink-2);margin-top:.1rem}
.assess-last{color:var(--ink)}
.assess-why{font-size:.78rem;color:var(--ink-2);margin-top:.15rem}
.assess-hist{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.3rem}
.assess-hist .btn{padding:.1rem .5rem;font-size:.75rem;min-height:0}
.assess-side{display:flex;align-items:center;gap:.5rem;flex-shrink:0}
@media (max-width:600px){.card.assess-row{flex-wrap:wrap}.assess-side{width:100%;justify-content:space-between}.assess-card.assess-row h3{white-space:normal}}
"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if "Compact list: one slim row per assessment" not in s:
        i = s.index(START); j = s.index(END, i) + len(END); s = s[:i] + NEW + s[j:]; n += 1
    if ".card.assess-row{" not in s:
        assert s.count(CSS_ANCHOR) == 1; s = s.replace(CSS_ANCHOR, CSS); n += 1
    old = "'🔑 Each assessment asks for its own password when you start it. Completed assessments can be reviewed at any time — no password needed.'"
    if old in s: s = s.replace(old, "'🔑 Each assessment asks for its own password when you start it. Reviewing a completed one needs no password.'"); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
