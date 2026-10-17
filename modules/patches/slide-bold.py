"""Presentation → ✎ Edit slide: a "B" button (and Ctrl+B) bolds / un-bolds the selected words in the bullet points and the
subtitle (stored as **word**), with a live preview; the subtitle now shows bold too. Idempotent."""
import sys
R = [
("""      if (s.subtitle) slide.appendChild(el('div', { class: 'body' }, s.subtitle));""",
"""      if (s.subtitle) slide.appendChild(el('div', { class: 'body', html: mdInline(esc(s.subtitle)) }));"""),
("""    const notes = el('textarea', { style: 'min-height:80px' }); notes.value = s.notes || '';
    const scaleLbl""",
"""    const notes = el('textarea', { style: 'min-height:80px' }); notes.value = s.notes || '';
    // B = bold / unbold the selected words (stored as **word**); Ctrl+B does the same; a live preview shows the result
    const boldTool = (ta, lines) => {
      const prev = el('div', { class: 'sb-prev' });
      const paint = () => { const v = ta.value.trim(); prev.style.display = /\\*\\*/.test(v) ? '' : 'none'; prev.innerHTML = (lines ? v.split('\\n').filter(x => x.trim()).map(x => '• ' + mdInline(esc(x.trim()))) : [mdInline(esc(v))]).join('<br>'); };
      const toggle = () => {
        let a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
        if (a === b) { while (a > 0 && /\\S/.test(v[a - 1]) && v[a - 1] !== '\\n') a--; while (b < v.length && /\\S/.test(v[b])) b++; }   // no selection: the word at the cursor
        while (a < b && /\\s/.test(v[a])) a++; while (b > a && /\\s/.test(v[b - 1])) b--;
        if (a === b) { toast('Select the words to make bold first.', 'warn'); return; }
        let sel = v.slice(a, b), out;
        const lines = sel.split('\\n'), wrapped = l => /^\\*\\*[\\s\\S]+\\*\\*$/.test(l.trim());
        if (lines.every(l => !l.trim() || wrapped(l))) out = lines.map(l => l.trim() ? l.trim().slice(2, -2) : l).join('\\n');      // **words** selected → unbold
        else if (lines.length === 1 && v.slice(a - 2, a) === '**' && v.slice(b, b + 2) === '**') { a -= 2; b += 2; out = sel; }       // words inside ** ** → unbold
        else out = lines.map(l => l.trim() ? '**' + l.trim().replace(/\\*\\*/g, '') + '**' : l).join('\\n');                       // bold (each line on its own)
        const s0 = a, s1 = a + out.length;
        ta.value = v.slice(0, a) + out + v.slice(b); ta.focus(); ta.setSelectionRange(s0, s1); paint();
      };
      ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggle(); } });
      ta.addEventListener('input', paint); paint();
      return el('div', { class: 'sb-wrap' }, el('div', { class: 'sb-bar' }, el('button', { type: 'button', class: 'btn btn-xs sb-b', 'data-a': 'bold', title: 'Bold / unbold the selected words (Ctrl+B)', onmousedown: e => e.preventDefault(), onclick: toggle }, el('b', null, 'B')),
        el('span', { class: 'small muted' }, 'Select words → B (or Ctrl+B) to make them bold; again to remove bold')), ta, prev);
    };
    const scaleLbl"""),
("""        (t === 'title' || t === 'section') ? el('label', { class: 'field' }, 'Subtitle', subtitle) : null,""",
"""        (t === 'title' || t === 'section') ? el('label', { class: 'field' }, 'Subtitle', boldTool(subtitle, false)) : null,"""),
("""        t === 'content' ? el('label', { class: 'field' }, 'Bullet points (one per line; **bold** allowed)', bullets) : null,""",
"""        t === 'content' ? el('label', { class: 'field' }, 'Bullet points (one per line)', boldTool(bullets, true)) : null,"""),
(""".pe-bar{position:absolute;""",
""".sb-bar{display:flex;align-items:center;gap:.5rem;margin:.15rem 0 .3rem}.sb-b{min-width:2rem;font-size:.95rem}
.sb-prev{margin-top:.35rem;padding:.45rem .6rem;border:1px dashed var(--line);border-radius:8px;font-size:.88rem;font-weight:400;background:var(--card);line-height:1.5}.sb-prev strong{font-weight:800}
.sb-prev::before{content:'Preview';display:block;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);margin-bottom:.15rem}
.pe-bar{position:absolute;"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
