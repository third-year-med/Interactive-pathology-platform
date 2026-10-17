"""Several tabs of one module (teacher + student, two teachers…) share one saved copy of the content and one
"last server time". A tab used to read that time fresh from storage (moved on by ANOTHER tab) while its own copy
lacked what the other tab had received, then saved its copy over the shared one → items (e.g. new assessments)
vanished from the teacher library until a full "Sync now". Now each tab keeps its own cursor that matches its own
copy, and the saved time is never newer than the saved copy. Idempotent."""
import sys
R = [
("""for (const f of Object.keys(STATE_SPEC)) State[f] = Store.get(STATE_SPEC[f].key, STATE_SPEC[f].def());
State.history = []; // version-history docs (loaded on demand from the backend)

function saveStateField(field) { Store.set(STATE_SPEC[field].key, State[field]); }""",
"""for (const f of Object.keys(STATE_SPEC)) State[f] = Store.get(STATE_SPEC[f].key, STATE_SPEC[f].def());
State.history = []; // version-history docs (loaded on demand from the backend)
/* Sync cursor per tab. Every open tab of this module shares the saved copy (localStorage) but has its own copy in
   memory. STATE_SINCE = the server time THIS tab's copy is complete up to; the saved 'last_server_time_v1' is kept no
   newer than the saved copy: a tab writing part of its copy lowers it to its own cursor, and only a tab whose whole
   copy is what is saved (STATE_PURE — no other tab wrote since its last full save) may move it forward. */
let STATE_SINCE = Store.get('last_server_time_v1', 0), STATE_GEN = Store.get('state_gen_v1', ''), STATE_PURE = true;
const STATE_TAB = Math.random().toString(36).slice(2, 10);
function stateForeignCheck() { if (Store.get('state_gen_v1', '') !== STATE_GEN) STATE_PURE = false; }
function stateStamp() { STATE_GEN = STATE_TAB + '.' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 6); Store.set('state_gen_v1', STATE_GEN); }
function saveStateField(field) {
  stateForeignCheck();
  const ok = Store.set(STATE_SPEC[field].key, State[field]);
  if (!ok) Store.del('last_server_time_v1');   // storage full: the next load fetches everything again
  else if (Store.get('last_server_time_v1', 0) > STATE_SINCE) Store.set('last_server_time_v1', STATE_SINCE);
  stateStamp();
  return ok;
}"""),
("""function saveAllState() { Object.keys(STATE_SPEC).forEach(saveStateField); }""",
"""function saveAllState() {
  let ok = true;
  for (const f of Object.keys(STATE_SPEC)) if (!Store.set(STATE_SPEC[f].key, State[f])) ok = false;
  stateStamp(); STATE_PURE = ok;
  if (ok) Store.set('last_server_time_v1', STATE_SINCE); else Store.del('last_server_time_v1');   // the whole saved copy is this tab's now
  return ok;
}"""),
("""      const since = (opts && opts.full) ? 0 : Store.get('last_server_time_v1', 0);
      const r = await this.rawPost({ action: 'getAllContent', since: since || 0 });
      if (!r || !r.ok) return r || { ok: false };
      mergeBackendContent(r.items || [], !since);
      Store.set('last_server_time_v1', r.serverTime || Date.now());""",
"""      const since = (opts && opts.full) ? 0 : STATE_SINCE;   // this tab's own cursor (matches its own copy), not another tab's
      const r = await this.rawPost({ action: 'getAllContent', since: since || 0 });
      if (!r || !r.ok) return r || { ok: false };
      mergeBackendContent(r.items || [], !since);
      STATE_SINCE = r.serverTime || Date.now();
      stateForeignCheck();
      if (STATE_PURE) Store.set('last_server_time_v1', STATE_SINCE); else saveAllState();   // another tab wrote: save this whole copy with it"""),
("    const first = !Store.get('last_server_time_v1', 0);", "    const first = !STATE_SINCE;"),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
# boot: full sync decided from this tab's cursor (applied by hand above as a 4th replacement)
