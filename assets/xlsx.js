/* PlatformXlsx — a small Excel (.xlsx) writer for the front page (no library: the page's CSP allows only its own scripts).
   PlatformXlsx.blob(sheets) / PlatformXlsx.download(fileName, sheets)
   sheets: [{ name, rows: [[cell, …], …], widths?: [chars, …], header?: number of top rows in bold (default 1),
              styles?: { rowIndex: 'warn' | 'title' | 'muted' } }]
   A cell is a string, a number, null/'' (empty), or { v, s } with s = 'bold' | 'warn' | 'title' | 'muted'.
   Numbers stay numbers in Excel; text is stored inline (UTF-8, Arabic names included). The archive is "stored"
   (no compression) — valid for Excel, LibreOffice and Google Sheets. */
(function () {
  'use strict';
  var STYLE = { '': 0, bold: 1, warn: 2, title: 3, muted: 4, warnbold: 5 };
  function x(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function col(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(sh) {
    var head = sh.header == null ? 1 : sh.header, rs = sh.styles || {}, out = [];
    var cols = (sh.widths || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
    (sh.rows || []).forEach(function (row, r) {
      var cells = [];
      (row || []).forEach(function (c, ci) {
        var v = c, st = '';
        if (c && typeof c === 'object') { v = c.v; st = c.s || ''; }
        if (!st && r < head) st = 'bold';
        if (rs[r] && !(c && typeof c === 'object' && c.s)) st = rs[r] === 'warn' && st === 'bold' ? 'warnbold' : rs[r];
        var ref = col(ci) + (r + 1), sa = STYLE[st] ? ' s="' + STYLE[st] + '"' : '';
        if (v == null || v === '') { if (sa) cells.push('<c r="' + ref + '"' + sa + '/>'); return; }
        if (typeof v === 'number' && isFinite(v)) cells.push('<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>');
        else cells.push('<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + x(v) + '</t></is></c>');
      });
      out.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
    });
    var freeze = head > 0 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + head + '" topLeftCell="A' + (head + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      freeze + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + out.join('') + '</sheetData></worksheet>';
  }
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0F2A4A"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B6B7F"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EEF6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function files(sheets) {
    var names = {}, list = sheets.map(function (s, i) {
      var n = String(s.name || 'Sheet' + (i + 1)).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1), base = n, k = 2;
      while (names[n.toLowerCase()]) n = base.slice(0, 28) + ' ' + k++;
      names[n.toLowerCase()] = 1; return n;
    });
    var f = [];
    f.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      list.map(function (n, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>']);
    f.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    f.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      list.map(function (n, i) { return '<sheet name="' + x(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>']);
    f.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map(function (n, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (list.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
    f.push(['xl/styles.xml', STYLES]);
    sheets.forEach(function (s, i) { f.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)]); });
    return f;
  }
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) { return new TextEncoder().encode(s); }
  /** A ZIP archive (method 0 = stored) of [name, text] entries → Uint8Array. */
  function zip(entries) {
    var d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    function u16(a, v) { a.push(v & 255, (v >>> 8) & 255); }
    function u32(a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
    entries.forEach(function (e) {
      var name = utf8(e[0]), data = utf8(e[1]), crc = crc32(data), h = [];
      u32(h, 0x04034b50); u16(h, 20); u16(h, 0x0800); u16(h, 0); u16(h, time); u16(h, date); u32(h, crc); u32(h, data.length); u32(h, data.length); u16(h, name.length); u16(h, 0);
      parts.push(new Uint8Array(h), name, data);
      var c = [];
      u32(c, 0x02014b50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, time); u16(c, date); u32(c, crc); u32(c, data.length); u32(c, data.length);
      u16(c, name.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
      central.push(new Uint8Array(c), name);
      offset += h.length + name.length + data.length;
    });
    var size = central.reduce(function (n, p) { return n + p.length; }, 0), end = [];
    u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, entries.length); u16(end, entries.length); u32(end, size); u32(end, offset); u16(end, 0);
    var all = parts.concat(central, [new Uint8Array(end)]), total = all.reduce(function (n, p) { return n + p.length; }, 0), out = new Uint8Array(total), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function blob(sheets) { return new Blob([zip(files(sheets))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
  function download(name, sheets) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob(sheets)); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  window.PlatformXlsx = { blob: blob, download: download, _zip: zip, _files: files };
})();
