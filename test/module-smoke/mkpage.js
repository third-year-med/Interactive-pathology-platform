// Builds a test copy of a REAL module page with a small synthetic course encrypted with a throwaway key.
const fs = require('fs'), crypto = require('crypto');
const [src, out, dataFile] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final(), c.getAuthTag()]);
const enc = JSON.stringify({ iv: iv.toString('base64'), ct: ct.toString('base64') });
const re = /(<script id="neo-enc"[^>]*>)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) throw new Error('no neo-enc');
html = html.replace(re, function (m, a, b, z) { return a + enc + z; });
fs.writeFileSync(out, html);
fs.writeFileSync(out + '.key', key.toString('base64'));
