"""Assessment passwords: 📋 Copy next to each password (copies it even while covered; never shown in the message);
the Hide button loses the monkey (plain "Hide"). Idempotent."""
import sys
R = [
("""  const btn = el('button', { class: 'btn btn-xs apw-eye', type: 'button', 'data-a': 'reveal' });
  const wrap = el('span', { class: 'apw-secret', 'data-id': id, style: 'display:inline-flex;align-items:center;gap:.35rem' }, code, btn);""",
"""  const btn = el('button', { class: 'btn btn-xs apw-eye', type: 'button', 'data-a': 'reveal' });
  // 📋 Copy: puts the password on the clipboard (to paste into a message to the students) without showing it on screen
  const copy = el('button', { class: 'btn btn-xs apw-copy', type: 'button', 'data-a': 'copy', title: 'Copy this password (it stays covered on screen)', onclick: async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(password); ok = true; }
    catch (e) { try { const t = el('textarea', { style: 'position:fixed;left:-9999px;top:0' }); t.value = password; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e2) { ok = false; } }
    if (ok) { copy.textContent = '✓ Copied'; setTimeout(() => { copy.textContent = '📋 Copy'; }, 1800); toast('Password copied — paste it into your message to the students.', 'ok'); }
    else toast('Could not copy here — press 👁 Show and copy it by hand.', 'warn', 6000);
  } }, '📋 Copy');
  const wrap = el('span', { class: 'apw-secret', 'data-id': id, style: 'display:inline-flex;align-items:center;gap:.35rem' }, code, btn, copy);"""),
("""    btn.textContent = on ? '🙈 Hide' : '👁 Show'; btn.setAttribute('aria-pressed', String(on));""",
"""    btn.textContent = on ? 'Hide' : '👁 Show'; btn.setAttribute('aria-pressed', String(on));"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
