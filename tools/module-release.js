#!/usr/bin/env node
'use strict';
/* ==========================================================================
   module-release.js — packaged releases of a platform module (see docs/REBUILD.md)

   The module's content key is read from the environment variable CONTENT_KEY (base64). It is never
   written to disk, printed or committed.

     node tools/module-release.js inspect   <index.html>
         Build label, item counts, and a check for duplicate IDs.
     node tools/module-release.js compare   <old index.html> <new index.html>
         Which topic / section / question / case / image IDs the new build removes, adds or changes.
     node tools/module-release.js preview   <new build.html> <module repo> [--build LABEL]
         Writes <module repo>/preview/index.html: the new build, with the current platform block
         (modules/platform-nav.js), the live file's connection settings, NEO_CONFIG.build and
         NEO_CONFIG.preview = true, encrypted with the PREVIEW key (only the Admin's master-draft
         session receives it from Portal.gs). Refuses a build with duplicate IDs.
     node tools/module-release.js golive    <module repo>
         Turns preview/index.html into the live index.html (encrypted with the live key, preview off)
         and removes preview/ — commit both in ONE commit.
     node tools/module-release.js refresh   <module repo> [--build LABEL]
         Rewrites only the platform block (and marks the build if it has no label yet) of the live index.html;
         the course content is unchanged.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAV = path.join(__dirname, '..', 'modules', 'platform-nav.js');

function die(msg) { console.error('✖ ' + msg); process.exit(1); }
function liveKey() {
  const k = String(process.env.CONTENT_KEY || '').trim();
  if (!k) die('Set CONTENT_KEY (the module\'s content key, base64) in the environment.');
  const b = Buffer.from(k, 'base64'); if (b.length !== 32) die('CONTENT_KEY must be a 256-bit key in base64.');
  return b;
}
/** The preview key — the same derivation as previewKey_ in backend/Portal.gs. */
function previewKey(live, moduleId) { return crypto.createHmac('sha256', live).update('neo-preview:' + moduleId, 'utf8').digest(); }

function block(html, id) {
  const re = new RegExp('(<script id="' + id + '"[^>]*>)([\\s\\S]*?)(</script>)');
  const m = re.exec(html); return m ? { re: re, open: m[1], body: m[2] } : null;
}
function setBlock(html, id, body) {
  const b = block(html, id); if (!b) die('The file has no <script id="' + id + '"> block.');
  return html.replace(b.re, function () { return b.open + body + '</script>'; });
}
function getConfig(html) {
  const b = block(html, 'neo-config'); if (!b) die('The file has no NEO_CONFIG block.');
  const m = /window\.NEO_CONFIG\s*=\s*([\s\S]*?);?\s*$/.exec(b.body.trim()); if (!m) die('NEO_CONFIG could not be read.');
  return JSON.parse(m[1]);
}
function setConfig(html, cfg) { return setBlock(html, 'neo-config', 'window.NEO_CONFIG = ' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';'); }

function decrypt(html, key) {
  const b = block(html, 'neo-enc');
  if (!b || !b.body.trim() || b.body.trim() === 'null') {
    const d = block(html, 'neo-data');   // an unencrypted build straight from the builder
    if (d && d.body.trim() && d.body.trim() !== 'null') return Buffer.from(d.body.trim(), 'utf8');
    die('The file contains no course data.');
  }
  const enc = JSON.parse(b.body), iv = Buffer.from(enc.iv, 'base64'), ct = Buffer.from(enc.ct, 'base64');
  try {
    const dc = crypto.createDecipheriv('aes-256-gcm', key, iv); dc.setAuthTag(ct.subarray(ct.length - 16));
    return Buffer.concat([dc.update(ct.subarray(0, ct.length - 16)), dc.final()]);
  } catch (e) { return null; }
}
function encrypt(plain, key) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return JSON.stringify({ v: 1, alg: 'AES-256-GCM', iv: iv.toString('base64'), ct: ct.toString('base64') });
}
function withData(html, plain, key) {
  html = setBlock(html, 'neo-enc', encrypt(plain, key));
  return block(html, 'neo-data') ? setBlock(html, 'neo-data', 'null') : html;   // never ship the plain copy
}
function readData(file, key) {
  const html = fs.readFileSync(file, 'utf8'), plain = decrypt(html, key);
  if (!plain) die(file + ': cannot be unlocked with this key.');
  return { html: html, plain: plain, data: JSON.parse(plain.toString('utf8')) };
}

/** IDs of a course (as modules/platform-nav.js reports them) + duplicate check. */
function fnv(v) { const s = JSON.stringify(v === undefined ? null : v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
function manifest(D) {
  const m = { topics: {}, sections: {}, questions: {}, cases: {}, images: {} }, dup = [];
  const add = function (kind, id, h) { id = String(id); if (id in m[kind]) dup.push(kind.replace(/s$/, '') + ' ' + id); m[kind][id] = h; };
  (D.topics || []).forEach(function (t) { add('topics', t.id, fnv(t.sections || [])); (t.sections || []).forEach(function (s) { add('sections', s.id, fnv(s)); }); });
  (D.questions || []).forEach(function (q) { add('questions', q.id, fnv(q)); });
  (D.cases || []).forEach(function (c) { add('cases', c.id, fnv(c)); });
  (Array.isArray(D.images) ? D.images : []).forEach(function (x) { add('images', x.id, 1); });
  ['figures', 'diagrams'].forEach(function (k) { Object.keys(D[k] || {}).forEach(function (id) { add('images', id, 1); }); });
  return { m: m, duplicates: dup };
}
function counts(m) { return Object.keys(m).map(function (k) { return Object.keys(m[k]).length + ' ' + k; }).join(', '); }
function compare(a, b) {
  const out = {};
  Object.keys(a).forEach(function (k) {
    const o = a[k], n = b[k];
    out[k] = { removed: Object.keys(o).filter(function (id) { return !(id in n); }), added: Object.keys(n).filter(function (id) { return !(id in o); }),
      changed: Object.keys(n).filter(function (id) { return id in o && o[id] !== n[id]; }) };
  });
  return out;
}
function printCompare(c) {
  Object.keys(c).forEach(function (k) {
    const x = c[k]; if (!x.removed.length && !x.added.length && !x.changed.length) return;
    console.log('  ' + k + ': ' + x.added.length + ' added, ' + x.changed.length + ' changed, ' + x.removed.length + ' removed' + (x.removed.length ? ' → removed: ' + x.removed.join(', ') : ''));
  });
}
function navBody() { return '\n' + fs.readFileSync(NAV, 'utf8').replace(/\s+$/, '') + '\n'; }

function cmdInspect(file) {
  const html = fs.readFileSync(file, 'utf8'), cfg = getConfig(html), key = cfg.preview ? previewKey(liveKey(), cfg.moduleKey) : liveKey();
  const r = readData(file, key), mf = manifest(r.data);
  console.log(cfg.moduleKey + ' · build ' + (cfg.build || '(not marked)') + ' · built ' + (r.data.buildTime || '?') + (cfg.preview ? ' · PREVIEW file' : ''));
  console.log('  ' + counts(mf.m));
  if (mf.duplicates.length) die('Duplicate IDs: ' + mf.duplicates.join(', '));
  console.log('✔ no duplicate IDs');
}
function cmdCompare(oldF, newF) {
  const key = liveKey(), a = manifest(readData(oldF, key).data), b = manifest(readData(newF, key).data);
  printCompare(compare(a.m, b.m));
  if (b.duplicates.length) die('The new build has duplicate IDs: ' + b.duplicates.join(', '));
}
function cmdPreview(newF, repo, label) {
  const key = liveKey(), liveF = path.join(repo, 'index.html');
  const live = readData(liveF, key), liveCfg = getConfig(live.html);
  const html0 = fs.readFileSync(newF, 'utf8'), plain = decrypt(html0, key);
  if (!plain) die(newF + ': cannot be unlocked with this module\'s content key.');
  const data = JSON.parse(plain.toString('utf8')), mf = manifest(data);
  if (mf.duplicates.length) die('The new build has duplicate IDs — fix the build first: ' + mf.duplicates.join(', '));
  const cfg = Object.assign({}, getConfig(html0));
  ['backendUrl', 'studentAuth', 'moduleKey', 'storagePrefix', 'platformHome'].forEach(function (k) { if (liveCfg[k] !== undefined) cfg[k] = liveCfg[k]; });
  if (cfg.moduleKey !== liveCfg.moduleKey) die('The new build is for module "' + cfg.moduleKey + '", the repository is "' + liveCfg.moduleKey + '".');
  cfg.build = String(label || data.buildTime || new Date().toISOString().slice(0, 16)).slice(0, 40); cfg.preview = true;
  if (cfg.build === liveCfg.build) die('The new build has the same label as the live build (' + cfg.build + '). Use --build to give it a new one.');
  let html = setConfig(html0, cfg);
  if (block(html, 'platform-nav')) html = setBlock(html, 'platform-nav', navBody());
  else html = html.replace('<script id="neo-data"', function () { return '<script id="platform-nav">' + navBody() + '</script>\n<script id="neo-data"'; });
  html = withData(html, plain, previewKey(key, cfg.moduleKey));
  fs.mkdirSync(path.join(repo, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'preview', 'index.html'), html);
  console.log('Preview of ' + cfg.moduleKey + ' build ' + cfg.build + ' (live: ' + (liveCfg.build || 'not marked') + ')');
  console.log('  ' + counts(mf.m));
  printCompare(compare(manifest(live.data).m, mf.m));
  console.log('✔ written ' + path.join(repo, 'preview', 'index.html') + ' — commit and push it, then use Platform Home → Content → New build.');
}
function cmdGoLive(repo) {
  const key = liveKey(), pf = path.join(repo, 'preview', 'index.html');
  if (!fs.existsSync(pf)) die('No preview/index.html in ' + repo + '.');
  const html0 = fs.readFileSync(pf, 'utf8'), cfg = getConfig(html0);
  if (!cfg.preview) die('preview/index.html is not marked as a preview.');
  const plain = decrypt(html0, previewKey(key, cfg.moduleKey)); if (!plain) die('The preview cannot be unlocked with this module\'s key.');
  delete cfg.preview;
  const html = withData(setConfig(html0, cfg), plain, key);
  fs.writeFileSync(path.join(repo, 'index.html'), html);
  fs.rmSync(path.join(repo, 'preview'), { recursive: true, force: true });
  console.log('✔ ' + cfg.moduleKey + ' build ' + cfg.build + ' is now index.html; preview/ removed. Commit both in ONE commit, push, then press “Go live” in Platform Home → Content.');
}
function cmdRefresh(repo, label) {
  const key = liveKey(), f = path.join(repo, 'index.html'), r = readData(f, key), cfg = getConfig(r.html);
  if (label || !cfg.build) cfg.build = String(label || r.data.buildTime || 'initial').slice(0, 40);
  let html = setConfig(r.html, cfg);
  html = block(html, 'platform-nav') ? setBlock(html, 'platform-nav', navBody()) : die('No platform block in ' + f + '.');
  fs.writeFileSync(f, html);
  console.log('✔ ' + cfg.moduleKey + ': platform block refreshed, build ' + cfg.build + ' (course content unchanged)');
}

if (require.main === module) {
  const a = process.argv.slice(2), bi = a.indexOf('--build'), label = bi >= 0 ? a.splice(bi, 2)[1] : '';
  const cmd = a[0];
  if (cmd === 'inspect' && a[1]) cmdInspect(a[1]);
  else if (cmd === 'compare' && a[2]) cmdCompare(a[1], a[2]);
  else if (cmd === 'preview' && a[2]) cmdPreview(a[1], a[2], label);
  else if (cmd === 'golive' && a[1]) cmdGoLive(a[1]);
  else if (cmd === 'refresh' && a[1]) cmdRefresh(a[1], label);
  else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 25).join('\n')); process.exit(cmd ? 1 : 0); }
}
module.exports = { previewKey: previewKey, encrypt: encrypt, decrypt: decrypt, manifest: manifest, getConfig: getConfig };
