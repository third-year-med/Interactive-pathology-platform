"""🖨 Compact practical printout (user, 2026-11-20: "a very compact printout of the practicals all over the modules — remove the extra
wording and phrases like objectives, compact the pictures in parallel rows at a smaller size, fewer pages"). Replaces the HTML print
version of the practical handouts (PH_html: 🖨 Print PDF on the Practical front page, a practical's print / answer key, the set and
the handbook) by a compact layout:
  • one title line per practical (no institution / course header, "PRACTICAL n", "Version"), no "Learning Objectives", no
    "Specimen / Material" table — one line "organ · site" (+ the scenario in italics);
  • no section headings: bold run-in labels (Gross · Microscopy · Key features · Diagnosis · Differential · Clinical · Questions · Viva ·
    Teaching points); key features and teaching points run on in one line; diagnosis one line; answers on the same line as the question;
  • pictures (and schematic diagrams) in rows of four at a small size with a one-line caption (the repeated "Case n — title ·" is dropped);
  • practicals follow each other without a page break; the table of contents is a small two-column list.
The model (PE_handoutModel) and the PDF writer are unchanged. Idempotent; a page that has the patch gets the CURRENT block. All modules."""
import sys
ANCHOR = """/* ==========================================================================
   49_prac_data.js — Practicals: storage, images, the AI pipeline and handout"""
HEAD = '/* ---------- Compact practical printout (patch prac-print-compact) ---------- */'
CODE = HEAD + r"""
function PHC_cap(c) { return String(c == null ? '' : c).replace(/^Cases?\s+[\d–-]+(?:\s*(?:and|&)\s*\d+)?\s+—\s+[^·]*·\s*/i, '').trim(); }
function PHC_join(a, sep) { return (a || []).map(x => String(x == null ? '' : x).trim().replace(/[.;]+$/, '')).filter(Boolean).join(sep || ' · '); }
PH_html = function (model, ctx) {
  const c = ctx || {}; const cfg = Object.assign({}, PE_DEFAULT_CFG, c.cfg || {}); const course = c.courseName || cfg.courseName || '';
  const foot = cfg.footerEnabled ? (cfg.footerText || [cfg.institution, cfg.department].filter(Boolean).join(' — ')) : '';
  const wm = c.preview ? 'DRAFT PREVIEW — NOT PUBLISHED' : (cfg.watermarkEnabled && cfg.watermarkText ? cfg.watermarkText : '');
  const multi = model.practicals.length > 1, E = PH_esc;
  let body = '';
  if (c.kind === 'handbook' || multi) body += '<section class="hd"><h1>' + E(course || c.title || 'Practicals') + (c.kind === 'handbook' ? ' — Practical Handbook' : ' — Practicals') + (cfg.academicYear ? ' <span class="yr">' + E(cfg.academicYear) + '</span>' : '') + '</h1></section>';
  if (multi) body += '<section class="toc"><ol>' + model.practicals.map(p => '<li><a href="#p' + E(p.id) + '"><b>' + p.number + '.</b> ' + E(p.title) + '</a></li>').join('') + '</ol></section>';
  model.practicals.forEach(p => {
    let h = '<article class="prac" id="p' + E(p.id) + '"><h1><span class="no">' + p.number + '</span>' + E(p.title) + (c.kind === 'answerKey' ? ' <span class="ak">ANSWER KEY</span>' : '') + '</h1>';
    let sec = '', grid = [], qopen = false;
    const flushGrid = () => { if (grid.length) { h += '<div class="grid">' + grid.join('') + '</div>'; grid = []; } };
    const closeQ = () => { if (qopen) { h += '</ol>'; qopen = false; } };
    p.blocks.forEach(b => {
      if (b.t === 'h') { flushGrid(); closeQ(); sec = b.text; if (/^(Practical|Viva) Questions/i.test(sec)) { h += '<div class="lb">' + (/^Viva/i.test(sec) ? 'Viva' : 'Questions') + (/Answers/i.test(sec) ? ' — answers' : '') + '</div>'; } return; }
      if (b.t === 'img' || b.t === 'diagram') {
        let inner;
        if (b.t === 'img') { const src = c.imageSrc ? c.imageSrc(b.image) : b.image.url; inner = (src ? '<img src="' + E(src) + '" alt="">' : '<div class="missing">Image unavailable</div>'); }
        else { const svg = c.diagramSvg ? c.diagramSvg(b.diagram) : ''; const src = b.diagram.replaceUrl && c.imageSrc ? c.imageSrc({ url: b.diagram.replaceUrl, fileId: b.diagram.replaceFileId }) : ''; inner = src ? '<img src="' + E(src) + '" alt="">' : (svg || ''); }
        grid.push('<figure' + (b.t === 'diagram' ? ' class="dg"' : '') + '>' + inner + '<figcaption><b>' + b.fig + '.</b> ' + E(PHC_cap(b.t === 'img' ? b.caption : String(b.caption || '').replace(/^Figure\s+\d+\.\s*/, ''))) + '</figcaption></figure>');
        return;
      }
      flushGrid();
      if (b.t !== 'qa') closeQ();
      if (/^Learning Objectives$/i.test(sec)) return;
      if (b.t === 'note') { h += '<div class="note">' + E(b.text) + '</div>'; return; }
      if (/^Specimen/i.test(sec)) {
        if (b.t === 'kv') { const r = b.rows.filter(x => /^(Organ|Anatomical)/i.test(x[0])); if (r.length) h += '<p class="meta">' + E(PHC_join(r.map(x => x[1]))) + '</p>'; }
        else if (b.t === 'p') h += '<p class="scn">' + PH_nl(b.text) + '</p>';
        return;
      }
      if (/^Gross/i.test(sec)) { if (b.t === 'p') h += '<p><b>Gross:</b> ' + PH_nl(b.text) + '</p>'; return; }
      if (/^Microscopic Description/i.test(sec)) {
        if (b.t === 'p') h += '<p><b>Microscopy:</b> ' + PH_nl(b.text) + '</p>';
        else if (b.t === 'small') h = h.replace(/<\/p>$/, ' <span class="st">' + E(b.text.replace(/Stain:\s*/i, '').replace(/\s*Magnification:\s*/i, ' · ')) + '</span></p>');
        return;
      }
      if (/^Key Microscopic Features/i.test(sec)) { if (b.t === 'ul') h += '<p><b>Key features:</b> ' + E(PHC_join(b.items, '; ')) + '.</p>'; return; }
      if (/^Diagnosis$/i.test(sec)) { if (b.t === 'dx') h += '<div class="dx"><b>Diagnosis:</b> ' + E(b.text) + '</div>'; return; }
      if (/^Differential/i.test(sec)) { if (b.t === 'p') h += '<p><b>Differential:</b> ' + PH_nl(b.text) + '</p>'; return; }
      if (/^Clinical/i.test(sec)) { if (b.t === 'p') h += '<p><b>Clinical:</b> ' + PH_nl(b.text) + '</p>'; return; }
      if (/^Teaching Points/i.test(sec)) { if (b.t === 'ul') h += '<p><b>Teaching points:</b> ' + E(PHC_join(b.items, '; ')) + '.</p>'; return; }
      if (b.t === 'qa') {
        if (!qopen) { h += '<ol class="qa">'; qopen = true; }
        h += '<li>' + E(b.q) + (b.answer && b.a !== undefined ? ' <span class="a">→ ' + E(b.a || '—') + '</span>' + (b.explanation ? ' <span class="ex">(' + E(b.explanation) + ')</span>' : '') : '') + (b.space ? '<div class="space"></div>' : '') + '</li>';
        return;
      }
      if (b.t === 'dx') h += '<div class="dx">' + E(b.text) + '</div>';
      else if (b.t === 'p') h += '<p>' + PH_nl(b.text) + '</p>';
      else if (b.t === 'small') h += '<p class="st">' + E(b.text) + '</p>';
      else if (b.t === 'ul') h += '<p>' + E(PHC_join(b.items, '; ')) + '.</p>';
      else if (b.t === 'kv') h += '<p class="meta">' + E(PHC_join(b.rows.map(x => x[1]))) + '</p>';
    });
    flushGrid(); closeQ();
    body += h + '</article>';
  });
  const css = `@page { size: A4; margin: 10mm 11mm 13mm; @bottom-left { content: "${E(foot).replace(/"/g, '\\"')}"; font: 7pt Helvetica, Arial, sans-serif; color: #555; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7pt Helvetica, Arial, sans-serif; color: #555; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 8.6pt/1.3 Helvetica, Arial, sans-serif; color: #000; margin: 0; }
  .screen-bar { position: sticky; top: 0; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; padding: 8px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center; z-index: 5; }
  .screen-bar button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid #94a3b8; background: #fff; cursor: pointer; }
  main { max-width: 188mm; margin: 0 auto; padding: 6mm 0; }
  .hd h1 { font-size: 13pt; margin: 0 0 1.5mm; border-bottom: 1.5px solid #000; padding-bottom: 1mm; } .hd .yr { font-size: 9pt; font-weight: 400; color: #444; }
  .toc ol { list-style: none; margin: 0 0 3mm; padding: 0; columns: 2; column-gap: 8mm; font-size: 8pt; } .toc li { padding: .4mm 0; border-bottom: 1px dotted #bbb; break-inside: avoid; } .toc a { color: #000; text-decoration: none; }
  .prac { margin: 0 0 4.5mm; } .prac + .prac { border-top: 1px solid #999; padding-top: 2.5mm; }
  .prac h1 { font-size: 11pt; line-height: 1.2; margin: 0 0 1.6mm; padding: 1mm 2mm; background: #e6ebf0; border-left: 3px solid #0b2a4a; break-after: avoid; page-break-after: avoid; }
  .prac h1 .no { display: inline-block; min-width: 5mm; margin-right: 2mm; font-weight: 700; color: #0b2a4a; } .prac h1 .ak { font-size: 7.5pt; letter-spacing: .06em; color: #7a1f1f; margin-left: 2mm; }
  p { margin: 0 0 1.1mm; } p.meta { font-size: 7.8pt; color: #333; margin-bottom: .6mm; } p.scn { font-style: italic; color: #222; } .st { font-size: 7.5pt; color: #444; font-style: italic; }
  b { font-weight: 700; } .lb { font-weight: 700; margin: 1.2mm 0 .4mm; break-after: avoid; page-break-after: avoid; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.8mm; margin: .8mm 0 1.6mm; align-items: start; }
  figure { margin: 0; break-inside: avoid; page-break-inside: avoid; } figure img { display: block; width: 100%; height: 34mm; object-fit: contain; border: .4pt solid #999; background: #f4f4f4; }
  figure.dg svg { display: block; width: 100%; height: 34mm; border: .4pt solid #999; } figcaption { font-size: 6.3pt; line-height: 1.18; color: #222; margin-top: .4mm; }
  .dx { border-left: 3px solid #000; background: #ececec; padding: .8mm 2mm; margin: .8mm 0 1.2mm; font-size: 9.3pt; break-inside: avoid; page-break-inside: avoid; }
  .note { font-weight: 700; background: #e6e6e6; border: .5pt solid #000; padding: .6mm 2mm; margin-bottom: 1mm; font-size: 8pt; }
  ol.qa { margin: 0 0 1.2mm; padding-left: 5mm; } ol.qa li { margin: 0 0 .7mm; break-inside: avoid; page-break-inside: avoid; } .a { font-style: italic; font-weight: 600; } .ex { font-size: 7.6pt; color: #333; }
  .space { height: 7mm; border-bottom: .5pt solid #bbb; } .missing { border: 1px dashed #999; padding: 4mm; font-size: 7pt; }
  .wm { position: fixed; top: 45%; left: 0; right: 0; text-align: center; transform: rotate(-35deg); font: 700 40pt Helvetica, Arial, sans-serif; color: rgba(0,0,0,.09); pointer-events: none; z-index: 0; }
  @media print { .screen-bar { display: none; } main { padding: 0; max-width: none; } }`;
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + E(c.title || 'Practical handout') + '</title><style>' + css + '</style></head><body>' +
    '<div class="screen-bar"><b>' + E(c.title || 'Practical handout') + '</b><span style="flex:1"></span><button onclick="window.print()">🖨 Print</button><button onclick="window.close()">Close</button></div>' +
    (wm ? '<div class="wm">' + E(wm) + '</div>' : '') + '<main>' + body + '</main>' +
    '<script>window.addEventListener("load",function(){var imgs=[].slice.call(document.images);Promise.all(imgs.map(function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r;});})).then(function(){setTimeout(function(){window.print();},250);});});<\/script></body></html>';
};

"""
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read(); n = 0
    if HEAD in s:   # a page that has the patch gets the CURRENT block
        a = s.index(HEAD); b = s.index(ANCHOR, a)
        if s[a:b] != CODE: s = s[:a] + CODE + s[b:]; n += 1
    elif 'function PH_html(' in s:
        assert s.count(ANCHOR) == 1, (path, 'anchor')
        s = s.replace(ANCHOR, CODE + ANCHOR); n += 1
    else:
        print(path, 'skipped (no practical handout code)'); continue
    open(path, 'w', encoding='utf-8').write(s); print(path, 'changes:', n)
