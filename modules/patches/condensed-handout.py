"""📄 Print Condensed Handout (user 2026-11-11, every active module). A second button beside "🖨️ Print Entire Chapter"
(topic header and chapter overview) builds a compact bullet-point revision handout of the WHOLE module from its current
content (getTopics(): the packaged course + teacher edits) and opens it in the print window (A4, Save as PDF or print).
Kept: section text as short bullets (paragraphs split into sentences), DEF / HIGHYIELD / EXAM / REMEMBER / MUSTKNOW / DX
callout text merged into the ordinary bullets, FLOW lines as one "A → B → C" line, key points and must-know lines only when
they add something, syllabus tables (compact). Removed: practical topics (title contains "Practical" — user 2026-11-11), pictures, figures, diagrams, media, links, CONFUSION / CLINICAL /
RECALL / PRACTICAL callouts, summaries, references, wording notes, every coloured box. Duplicates: a statement is left out
when its normalised text was already printed, or when ≥ 85 % of its words (≥ 60 % for key points and must-know lines, which
restate the text) appear in one earlier statement of the same topic.
Layout (v2, user: "comfortable to read"): ~11 pt, line height 1.5, 15 mm margins, spaced bullets and headings, black and white, page numbers in the footer, Arabic/English (dir=auto).
The existing print buttons are unchanged. Idempotent."""
import sys

BTN_A = """onclick: () => this.printChapter() }, '🖨️ Print Entire Chapter')"""
BTN_B = BTN_A + """, el('button', { class: 'btn btn-sm', 'data-a': 'print-handout', title: 'A compact bullet-point revision handout of the whole module: no pictures or boxes (print or Save as PDF)', onclick: () => printCondensedHandout() }, '📄 Print Condensed Handout')"""
CODE_A = """function printHTML(title, subtitle, bodyHtml, opts) {"""
CODE = r"""/* ---------- 📄 Condensed revision handout (patch condensed-handout) ---------- */
const HANDOUT_DROP = { CONFUSION: 1, CLINICAL: 1, RECALL: 1, PRACTICAL: 1 };
function handoutNorm(s) { return String(s || '').toLowerCase().replace(/\*\*|\*|`/g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim(); }
function handoutSentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(); if (!t) return [];
  const safe = t.replace(/\b(e\.g|i\.e|vs|etc|approx|Fig|Figs|Dr|cf|No)\./gi, '$1\u2024');   // keep abbreviations together
  return safe.split(/(?<=[.!?])\s+(?=[A-Z0-9(“"\u0600-\u06FF*])/).map(x => x.replace(/\u2024/g, '.').trim()).filter(Boolean);
}
/** One section body (markdown) → [{h} | {b, lvl}] — no callout boxes, no pictures. */
function handoutParse(src) {
  const out = [], lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let para = [], quote = null;
  const flushPara = () => { if (para.length) { handoutSentences(para.join(' ')).forEach(x => out.push({ b: x, lvl: 0 })); para = []; } };
  const flushQuote = () => {
    if (!quote) return;
    const m = /^\[!([A-Z]+)\]\s*(.*)$/.exec(quote[0] || ''), type = m ? m[1] : '', rest = m ? quote.slice(1) : quote;
    quote = null;
    if (HANDOUT_DROP[type]) return;
    rest.forEach(l => {
      const x = l.trim(); if (!x) return;
      const bm = x.match(/^([-*•]|\d+[.)])\s+(.*)$/);
      const txt = (bm ? bm[2] : x).trim();
      if (type === 'FLOW' && !bm) out.push({ b: txt.split(/\s*(?:→|->)\s*/).filter(Boolean).join(' → '), lvl: 0 });
      else if (bm) out.push({ b: txt, lvl: 0 });
      else handoutSentences(txt).forEach(y => out.push({ b: y, lvl: 0 }));
    });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); flushQuote(); continue; }
    if (/^>\s?/.test(line)) { flushPara(); (quote = quote || []).push(line.replace(/^>\s?/, '')); continue; }
    flushQuote();
    if (/^#{2,4}\s+/.test(line)) { flushPara(); out.push({ h: line.replace(/^#{2,4}\s+/, '').trim() }); continue; }
    const m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (m) { flushPara(); out.push({ b: m[3].trim(), lvl: m[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0 }); continue; }
    const last = out[out.length - 1];
    if (!para.length && last && last.b !== undefined && /^\s+\S/.test(raw)) { last.b += ' ' + line.trim(); continue; }   // continuation of a bullet
    para.push(line.trim());
  }
  flushPara(); flushQuote();
  return out;
}
function handoutTable(tb) {
  if (!tb || !Array.isArray(tb.rows) || !tb.rows.length) return '';
  const cell = c => mdInline(esc(String(c === null || c === undefined ? '' : (typeof c === 'object' ? (c.text || '') : c))));
  const head = (tb.headers || []).length ? '<thead><tr>' + tb.headers.map(h => '<th dir="auto">' + cell(h) + '</th>').join('') + '</tr></thead>' : '';
  const body = tb.rows.map(r => '<tr>' + (Array.isArray(r) ? r : (r.cells || [])).map(c => '<td dir="auto">' + cell(c) + '</td>').join('') + '</tr>').join('');
  return '<table class="ho-tb">' + (tb.caption ? '<caption dir="auto">' + mdInline(esc(String(tb.caption).replace(/^Table\s+[\d.]+\s*[—–-]\s*/i, ''))) + '</caption>' : '') + head + '<tbody>' + body + '</tbody></table>';
}
/** The whole module → compact handout HTML. Returns { html, items, dropped }. */
function buildCondensedHandout() {
  const all = getTopics();
  const topics = all.filter(t => t && (t.sections || []).length && !/practical/i.test(t.title || ''));   // practical topics are not in the handout (user)
  const seen = new Set(), tables = new Set(); let items = 0, dropped = 0, html = '';
  topics.forEach(t => {
    const tn = all.indexOf(t) + 1;   // the module's own topic number
    const prior = [];   // word sets of this topic's printed statements
    const fresh = (s, thr) => {   // thr: share of words already printed in this topic that makes it a repeat
      const n = handoutNorm(s); if (!n || n.length < 3) return false;
      if (seen.has(n)) return false;
      const w = n.split(' ').filter(x => x.length > 2);
      if (w.length >= 4 && prior.some(p => { let k = 0; w.forEach(x => { if (p.has(x)) k++; }); return k / w.length >= (thr || 0.85); })) return false;
      seen.add(n); prior.push(new Set(w)); return true;
    };
    let th = '';
    t.sections.forEach((s, si) => {
      const parts = handoutParse(s.body).concat((s.keyPoints || []).map(k => ({ b: k, lvl: 0, kp: 1 })));
      const groups = [{ h: null, li: [] }];
      parts.forEach(p => {
        if (p.h !== undefined) { groups.push({ h: p.h, li: [] }); return; }
        if (!fresh(p.b, p.kp ? 0.6 : 0.85)) { dropped++; return; }
        groups[groups.length - 1].li.push('<li dir="auto"' + (p.lvl ? ' class="l2"' : '') + '>' + mdInline(esc(p.b)) + '</li>'); items++;
      });
      let sh = groups.filter(g => g.li.length).map(g => (g.h ? '<h4 dir="auto">' + mdInline(esc(g.h)) + '</h4>' : '') + '<ul>' + g.li.join('') + '</ul>').join('');
      (s.tables || []).forEach(tb => { const sig = JSON.stringify([tb.headers, tb.rows]); if (tables.has(sig)) { dropped++; return; } tables.add(sig); sh += handoutTable(tb); });
      if (sh) th += '<h3 dir="auto">' + tn + '.' + (si + 1) + ' ' + esc(s.heading || '') + '</h3>' + sh;
    });
    const extra = (t.mustKnow || []).filter(k => { if (!fresh(k, 0.6)) { dropped++; return false; } items++; return true; });
    if (extra.length) th += '<ul class="ho-extra">' + extra.map(k => '<li dir="auto">' + mdInline(esc(k)) + '</li>').join('') + '</ul>';
    if (th) html += '<section class="ho-topic"><h2 dir="auto">' + tn + '. ' + esc(t.title) + '</h2>' + th + '</section>';
  });
  return { html, items, dropped, topics: topics.length };
}
function printCondensedHandout() {
  const r = buildCondensedHandout();
  if (!r.items) { toast('There is nothing to put in a handout yet.', 'warn'); return; }
  const title = String(COURSE.title || '').replace(/["\\]/g, '');
  const css = '@page{size:A4;margin:15mm 14mm 16mm;@bottom-center{content:"Page " counter(page) " of " counter(pages);font:9pt Arial,Helvetica,sans-serif;color:#555}@bottom-left{content:"' + title + ' — revision handout";font:9pt Arial,Helvetica,sans-serif;color:#777}}'   /* handout-css v2: comfortable reading (user 2026-11-11) */
    + 'html{font-size:15px!important}body{font-family:Arial,Helvetica,sans-serif!important;line-height:1.5!important;color:#000!important;padding:0!important;max-width:none!important}'
    + 'header.print-head{margin:0 0 .8rem!important;padding:0 0 .4rem!important;border-bottom:1.5px solid #000!important}header.print-head .brand{color:#000!important;font-size:.75rem!important}'
    + 'header.print-head h1{font-size:1.5rem!important;margin:.15rem 0!important;color:#000!important}header.print-head .sub,header.print-head p{font-size:.85rem!important;margin:0!important;color:#333!important}'
    + '.ho *{background:none!important;box-shadow:none!important;color:#000!important}'
    + '.ho-topic h2{font-size:1.25rem!important;margin:1.2rem 0 .4rem!important;padding:0 0 .15rem!important;border-bottom:1.2px solid #000!important;break-after:avoid;page-break-after:avoid}'
    + '.ho h3{font-size:1.08rem!important;margin:.8rem 0 .25rem!important;break-after:avoid;page-break-after:avoid}'
    + '.ho h4{font-size:1rem!important;font-style:italic;margin:.45rem 0 .1rem!important;break-after:avoid;page-break-after:avoid}'
    + '.ho ul{margin:0 0 .35rem!important;padding:0 0 0 1.3rem!important}.ho li{margin:0 0 .22rem!important;padding:0!important;font-size:1rem!important;line-height:1.5!important}.ho li.l2{margin-left:1.2rem!important;list-style:circle}'
    + '.ho-tb{width:100%;border-collapse:collapse;margin:.35rem 0 .7rem!important;font-size:.93rem!important;line-height:1.4!important;table-layout:auto;break-inside:auto}.ho-tb caption{text-align:left;font-weight:700;font-size:.95rem!important;padding:0 0 .2rem}'
    + '.ho-tb th,.ho-tb td{border:.6px solid #555!important;padding:.25rem .45rem!important;vertical-align:top;overflow-wrap:break-word;hyphens:manual}.ho-tb th{font-weight:700}.ho-tb tr{break-inside:avoid;page-break-inside:avoid}';
  printHTML(COURSE.title + ' — Revision handout', [COURSE.chapter, 'Condensed revision handout', plural(r.topics, 'topic')].filter(Boolean).join(' · '), '<div class="ho">' + r.html + '</div>', { css });
}
function printHTML(title, subtitle, bodyHtml, opts) {"""

NEW_CSS = CODE[CODE.index("  const css = '@page{"):CODE.index("  printHTML(COURSE.title + ' — Revision handout'")]
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if "'data-a': 'print-handout'" not in s:
        k = s.count(BTN_A); assert k >= 1, (path, 'Print Entire Chapter button'); s = s.replace(BTN_A, BTN_B); n += k
    if 'function buildCondensedHandout()' not in s:
        assert s.count(CODE_A) == 1, (path, CODE_A); s = s.replace(CODE_A, CODE); n += 1
    if 'handout-css v2' not in s:   # a page with the first, very compact layout (2026-11-11): replace its CSS block
        i = s.index("  const css = '@page{size:A4;margin:9mm 8mm 11mm;"); j = s.index("  printHTML(COURSE.title + ' — Revision handout'", i)
        s = s[:i] + NEW_CSS + s[j:]; n += 1
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
