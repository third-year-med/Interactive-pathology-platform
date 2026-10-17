"""Writes modules/platform-nav.js into a module's <script id="platform-nav"> block (same text as module-release.js refresh)."""
import sys, re
nav = open(sys.argv[1], encoding='utf-8').read().rstrip()
for f in sys.argv[2:]:
    s = open(f, encoding='utf-8').read()
    m = re.search(r'(<script id="platform-nav"[^>]*>)([\s\S]*?)(</script>)', s)
    if not m: raise SystemExit('no platform block in ' + f)
    s2 = s[:m.start()] + m.group(1) + '\n' + nav + '\n' + m.group(3) + s[m.end():]
    open(f, 'w', encoding='utf-8').write(s2); print(f, 'platform block written')
