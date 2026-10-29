/* Boots every module page (sibling repos) with a synthetic course: student sign-in, Assessments without a password
   page, learning lock → #/quiz. Usage: node test/module-smoke/smoke.js  (MODULE_REPOS=<folder with the module repos>) */
const { chromium } = require(require('path').join(__dirname, '../../node_modules/playwright-core'));
const fs = require('fs'), cp = require('child_process'), path = require('path');
const HERE = __dirname, REPOS = process.env.MODULE_REPOS || path.resolve(HERE, '../../..');   // sibling module repos
process.chdir(HERE);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const [repo, key] of [['inflammation-healing', 'inflhealing'], ['introduction-to-pathology', 'intropath'], ['cell-injury-teaching-platform', 'cellinjury'], ['third-year-med-inflammation-condensed', 'inflcondensed'], ['cell-injury-condensed', 'cellcondensed'], ['neoplasia', 'neoplasm'], ['genetics', 'genetics'], ['inflammation-new', 'inflnew']]) {
    if (!fs.existsSync(path.join(REPOS, repo, 'index.html'))) { console.log(repo, '| skipped: not cloned next to this repository'); continue; }
    const d = JSON.parse(fs.readFileSync('data-min.json', 'utf8')); d.course.moduleKey = key;
    fs.writeFileSync('d.json', JSON.stringify(d));
    cp.execFileSync('node', ['mkpage.js', path.join(REPOS, repo, 'index.html'), 'm.html', 'd.json']);
    const html = fs.readFileSync('m.html', 'utf8'), k = fs.readFileSync('m.html.key', 'utf8');
    const p = await b.newPage(), errs = []; let locked = false, failAssess = false, assessCalls = 0;
    p.on('pageerror', e => errs.push(e.message));
    await p.route('https://third-year-med.github.io/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await p.route('https://script.google.com/**', async r => {
      const q = JSON.parse(r.request().postData() || '{}'); let o = { ok: true };
      if (q.action === 'studentLogin') o = { ok: true, token: 't'.repeat(64), expiresAt: Date.now() + 3600e3, student: { username: 's1', name: 'Student One', email: '' }, contentKey: k };
      if (q.action === 'getMyAssessments') { assessCalls++; o = failAssess ? { ok: false, error: 'Service invoked too many times: test' } : { ok: true, items: [], perAssessmentPasswords: true }; }
      if (q.action === 'learnLockStatus') o = locked ? { ok: true, locked: true, reason: 'manual', message: 'Your teacher has locked the Learning module during the assessment. Only Assessments are open.' } : { ok: true, locked: false };
      await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
    });
    await p.goto('https://third-year-med.github.io/' + repo + '/?g=razi-a-26');
    await p.waitForSelector('#nb-user'); await p.fill('#nb-user', 's1'); await p.fill('#nb-pass', 'pw'); await p.click('#neo-boot button[type=submit]');
    await p.waitForSelector('.nav-btn[data-view="quiz"]', { timeout: 20000 });
    await p.evaluate(() => { location.hash = '#/quiz'; }); await p.waitForSelector('#view-quiz .assess-pwnote, #view-quiz .card.empty', { timeout: 15000 });
    const inputs = await p.$$eval('#view-quiz input', x => x.length), txt = await p.textContent('#view-quiz');
    // My Assessments when the list cannot be loaded: the reason + ↻ Try again, and NO repeated requests (it used to loop)
    failAssess = true; await p.evaluate(() => { Views.quiz.list = null; Views.quiz.render(); });
    await p.waitForSelector('#view-quiz .assess-loaderr', { timeout: 15000 }); const c0 = assessCalls; await p.waitForTimeout(1500);
    const errCard = await p.textContent('#view-quiz .assess-loaderr'), noLoop = assessCalls === c0;
    failAssess = false; await p.click('#view-quiz .assess-loaderr button'); await p.waitForSelector('#view-quiz .assess-pwnote, #view-quiz .card.empty:not(.assess-loaderr)', { timeout: 15000 });
    const retryOk = noLoop && /Service invoked too many times/.test(errCard) && !(await p.$('#view-quiz .assess-loaderr'));
    // Presentation → 🖨 Print / PDF: every slide shown is laid out as one print page, then the screen is restored
    await p.evaluate(() => { location.hash = '#/present'; window.print = () => { window.__ppPrinted = { pages: document.querySelectorAll('#pp-root .pp-page').length, on: document.documentElement.classList.contains('pp-on') }; }; });
    await p.click('[data-a=print-slides]'); await p.click('.modal-foot button:has-text("Print")');
    await p.waitForFunction(() => window.__ppPrinted, null, { timeout: 30000 }); await p.waitForTimeout(700);
    const pp = await p.evaluate(() => ({ n: Views.present.list().length, got: window.__ppPrinted, after: document.querySelectorAll('#pp-root .pp-page').length + (document.documentElement.classList.contains('pp-on') ? 1 : 0) }));
    const printOk = pp.got.pages === pp.n && pp.got.on && pp.after === 0;
    locked = true; await p.evaluate(() => window.PlatformLearnLock.check()); await p.waitForTimeout(800);
    await p.evaluate(() => { location.hash = '#/explain'; }); await p.waitForTimeout(400);
    const hash = await p.evaluate(() => location.hash), cls = await p.evaluate(() => document.body.classList.contains('pf-ll'));
    console.log(repo, '| assess error+retry:', retryOk ? '✓' : 'FAILED', '| print slides:', printOk ? pp.n + '/' + pp.n + ' ✓' : 'FAILED ' + JSON.stringify(pp), '| inputs:', inputs, '| no gate:', !/Assessment password/.test(txt) && /Student One · Student ID s1/.test(txt), '| locked→', hash, cls, '| errors:', errs.length ? errs : 'none');
    await p.close();
  }
  await b.close();
})();
