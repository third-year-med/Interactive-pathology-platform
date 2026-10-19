"""Printing waits until every picture is fully loaded AND decoded. Idempotent.
Before, the print dialog opened 150 ms after the page's load event; a large picture (e.g. an imported 1600-px Robbins
figure served from Drive) could still be decoding, and Chrome printed the undrawn part as a grey block. Now the print
window (and the hidden-frame fallback when pop-ups are blocked) waits for each image's load + decode() (at most 20 s
per picture), then prints."""
import sys
R = [
("""    ${auto ? '<script>window.onload=()=>{setTimeout(()=>window.print(),150);}<\\/script>' : ''}""",
"""    ${auto ? '<script>window.onload=function(){' + PRINT_READY_JS + 'printReady(document).then(function(){window.print();});};<\\/script>' : ''}"""),
("""  f.addEventListener('load', () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Please allow pop-ups to print.', 'warn'); } setTimeout(() => f.remove(), 120000); }, 150); }, { once: true });""",
"""  f.addEventListener('load', () => { (new Function(PRINT_READY_JS + 'return printReady;'))()(d).then(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Please allow pop-ups to print.', 'warn'); } setTimeout(() => f.remove(), 120000); }); }, { once: true });"""),
("""/* print-mirror: paper rules applied AFTER the screen stylesheet in every printed page */
""",
"""/* print-decode: resolves when every picture of the print document is loaded and decoded (max 20 s each), + 400 ms */
const PRINT_READY_JS = 'function printReady(doc){var im=[].slice.call(doc.images);return Promise.all(im.map(function(i){' +
  'return (i.complete ? Promise.resolve() : new Promise(function(r){i.addEventListener("load",r);i.addEventListener("error",r);setTimeout(r,20000);}))' +
  '.then(function(){return i.naturalWidth && i.decode ? i.decode().catch(function(){}) : null;});}))' +
  '.then(function(){return new Promise(function(r){setTimeout(r,400);});});}';
/* print-mirror: paper rules applied AFTER the screen stylesheet in every printed page */
"""),
]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    for a, b in R:
        if b in s: continue
        assert s.count(a) == 1, (path, a[:70]); s = s.replace(a, b); n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
