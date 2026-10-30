"""📊 Results: one submitted attempt without a valid start / submit time (e.g. an old or hand-made row) threw "Invalid time
value" and left the whole Results page on "Loading results…" (found 2026-10-30 by the rs-review e2e test). Times are now
converted safely: an invalid time becomes the start of 1970 (shown as an old date, sorted last) and the duration 0. Idempotent."""
import sys
R = [
("""      startedAt: new Date(t.startedAt).toISOString(), submittedAt: new Date(t.submittedAt).toISOString(), durationSec: Math.round((t.submittedAt - t.startedAt) / 1000),""",
 """      startedAt: rsIso(t.startedAt), submittedAt: rsIso(t.submittedAt), durationSec: Math.max(0, Math.round((t.submittedAt - t.startedAt) / 1000) || 0),"""),
("""const RS_ALL = '__all', RS_LEGACY = '__legacy';""",
 """const RS_ALL = '__all', RS_LEGACY = '__legacy';
/** A safe ISO time for Results (patch rs-safe-dates): an invalid or missing time never stops the page. */
function rsIso(v) { const d = new Date(v); return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString(); }"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
