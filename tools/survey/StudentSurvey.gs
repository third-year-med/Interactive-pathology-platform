/**
 * Student evaluation survey of the Interactive Pathology Teaching Platform — English + Arabic (user, 2026-10-22).
 *
 * Paste this file into a NEW, SEPARATE Apps Script project (script.google.com → New project). Do NOT put it into the
 * platform's project (Code.gs / Portal.gs) — it needs nothing from there and must not touch it.
 *
 *   1. ▶ Run createSurvey   → creates the Google Form + a linked results Sheet + the automatic analysis;
 *                             the Execution log prints the student link, the edit link and the Sheet link.
 *   2. Share the student link (or its QR code: Form → Send → 🔗 link → "Shorten URL").
 *   3. The Sheet's "Summary" tab (and "Comments" tab) refresh by themselves after every answer.
 *      ▶ Run buildSummary   → rebuilds them by hand at any time.
 *
 * The survey is ANONYMOUS: no email addresses or names are collected.
 */

var SURVEY = {
  title: 'Interactive Pathology Teaching Platform — Student Evaluation | تقييم الطلاب لمنصة تعليم علم الأمراض التفاعلية',
  description:
    'Thank you for helping us improve the platform. The survey is anonymous and takes about 7 minutes. ' +
    'You may write your answers in English or Arabic.\n\n' +
    'شكراً لمساعدتنا في تطوير المنصة. الاستبيان مجهول الهوية ويستغرق حوالي 7 دقائق. ' +
    'يمكنك كتابة إجاباتك باللغة العربية أو الإنجليزية.',
  confirmation: 'Thank you! Your answers were saved. | شكراً لك! تم حفظ إجاباتك.'
};

/** The 5-point agreement scale used by every statement grid (1 = strongly disagree … 5 = strongly agree). */
var SCALE = [
  'Strongly disagree | لا أوافق بشدة',
  'Disagree | لا أوافق',
  'Neutral | محايد',
  'Agree | أوافق',
  'Strongly agree | أوافق بشدة'
];

/** Platform features — used by "most useful" and "least useful". */
var FEATURES = [
  'Learn: topic explanations | التعلّم: شرح المواضيع',
  'Pictures, diagrams and atlas images | الصور والرسوم التوضيحية وصور الأطلس',
  'Practice questions (MCQs) | أسئلة التدريب (الاختيار من متعدد)',
  'Clinical cases | الحالات السريرية',
  'Presentation slides | شرائح العرض',
  'Topic quizzes and assessments | اختبارات المواضيع والتقييمات',
  'Last-Minute Review | المراجعة السريعة قبل الامتحان',
  'Glossary | قاموس المصطلحات',
  'Progress tracking | متابعة التقدّم',
  'Attendance check-in | تسجيل الحضور',
  'Full-screen reading | القراءة بملء الشاشة'
];

/** The questionnaire, in order. type: section | choice | checkbox | grid | scale | paragraph. */
var QUESTIONS = [
  { type: 'section', title: 'Part 1 — About you | الجزء الأول — معلومات عنك' },
  { type: 'checkbox', key: 'modules', required: true,
    title: 'Which modules did you use on the platform? | ما الوحدات التي استخدمتها على المنصة؟',
    options: ['Introduction to Pathology | مقدمة في علم الأمراض', 'Cell Injury & Cell Death | إصابة الخلية وموتها',
      'Inflammation & Healing | الالتهاب والالتئام', 'Neoplasia | الأورام'] },
  { type: 'choice', key: 'device', required: true,
    title: 'Which device did you use most? | ما الجهاز الذي استخدمته أكثر؟',
    options: ['Mobile phone | الهاتف المحمول', 'Laptop or desktop computer | حاسوب محمول أو مكتبي', 'Tablet | جهاز لوحي'] },
  { type: 'choice', key: 'frequency', required: true,
    title: 'How often did you use the platform? | كم مرة استخدمت المنصة؟',
    options: ['Daily | يومياً', 'Several times a week | عدة مرات في الأسبوع', 'Once a week | مرة في الأسبوع',
      'Only before exams | قبل الامتحانات فقط', 'Rarely | نادراً'] },

  { type: 'section', title: 'Part 2 — Your opinion | الجزء الثاني — رأيك',
    help: 'How much do you agree with each statement? | إلى أي مدى توافق على كل عبارة؟' },
  { type: 'grid', key: 'use', required: true,
    title: 'A. Ease of use | أ. سهولة الاستخدام',
    rows: ['Signing in to the platform is easy. | تسجيل الدخول إلى المنصة سهل.',
      'It is easy to find what I need on the platform. | من السهل إيجاد ما أحتاجه على المنصة.',
      'The platform works well on my phone. | المنصة تعمل بشكل جيد على هاتفي.',
      'The pages load quickly. | الصفحات تُحمَّل بسرعة.'] },
  { type: 'grid', key: 'content', required: true,
    title: 'B. Learning content | ب. المحتوى التعليمي',
    rows: ['The explanations are clear and easy to understand. | الشروحات واضحة وسهلة الفهم.',
      'The content matches the lectures and the syllabus. | المحتوى يتوافق مع المحاضرات والمنهج.',
      'The pictures and diagrams helped me understand. | الصور والرسوم التوضيحية ساعدتني على الفهم.',
      'The key points and "Must know" boxes are helpful. | النقاط الرئيسية ومربعات "يجب أن تعرف" مفيدة.'] },
  { type: 'grid', key: 'practice', required: true,
    title: 'C. Practice and assessment | ج. التدريب والتقييم',
    rows: ['The practice questions and cases improved my understanding. | أسئلة التدريب والحالات حسّنت فهمي.',
      'The quizzes and assessments were fair. | الاختبارات والتقييمات كانت عادلة.',
      'Seeing the correct answers and explanations right away helped me learn. | رؤية الإجابات الصحيحة والشروحات فوراً ساعدتني على التعلّم.',
      'The Last-Minute Review helped me prepare for exams. | المراجعة السريعة ساعدتني في الاستعداد للامتحانات.'] },
  { type: 'grid', key: 'class', required: true,
    title: 'D. In the classroom | د. داخل القاعة الدراسية',
    rows: ['Checking in for attendance is easy. | تسجيل الحضور سهل.',
      'The presentation slides in lectures are clear. | شرائح العرض في المحاضرات واضحة.',
      'Quizzes during the lecture keep me focused. | الاختبارات أثناء المحاضرة تُبقيني منتبهاً.'] },
  { type: 'grid', key: 'impact', required: true,
    title: 'E. Overall impact | هـ. الأثر العام',
    rows: ['The platform improved my understanding of pathology. | المنصة حسّنت فهمي لعلم الأمراض.',
      'The platform made me more motivated to study. | المنصة زادت دافعيتي للدراسة.',
      'The platform saved me time when studying. | المنصة وفّرت عليّ الوقت في الدراسة.',
      'I feel better prepared for exams. | أشعر أنني مستعد للامتحانات بشكل أفضل.',
      'I prefer learning with the platform over lectures and notes alone. | أُفضّل التعلّم بالمنصة على المحاضرات والمذكرات وحدها.'] },

  { type: 'section', title: 'Part 3 — Ratings and choices | الجزء الثالث — التقييم والاختيارات' },
  { type: 'scale', key: 'overall', required: true, min: 1, max: 10,
    title: 'Overall, how would you rate the platform? | بشكل عام، كيف تقيّم المنصة؟',
    low: 'Very poor | ضعيف جداً', high: 'Excellent | ممتاز' },
  { type: 'scale', key: 'recommend', required: true, min: 0, max: 10,
    title: 'How likely are you to recommend the platform to other students? | ما مدى احتمال أن توصي بالمنصة لطلاب آخرين؟',
    low: 'Not at all likely | غير محتمل إطلاقاً', high: 'Extremely likely | محتمل جداً' },
  { type: 'checkbox', key: 'best', required: true, limit: 3,
    title: 'Which features were the MOST useful? (choose up to 3) | ما أكثر الميزات فائدة؟ (اختر حتى 3)',
    options: FEATURES },
  { type: 'checkbox', key: 'least', required: false,
    title: 'Which features were the LEAST useful? | ما أقل الميزات فائدة؟',
    options: FEATURES.concat(['None — all were useful | لا شيء — كلها مفيدة']) },
  { type: 'checkbox', key: 'problems', required: true,
    title: 'Did you face any of these problems? | هل واجهت أياً من هذه المشكلات؟',
    options: ['Problems signing in | مشكلات في تسجيل الدخول', 'Slow loading | بطء التحميل',
      'Assessments did not open | التقييمات لم تفتح', 'Hard to use on the phone | صعوبة الاستخدام على الهاتف',
      'Content too long | المحتوى طويل جداً', 'Content too short | المحتوى قصير جداً',
      'Technical errors | أخطاء تقنية', 'No problems | لا توجد مشكلات'] },
  { type: 'choice', key: 'other', required: true,
    title: 'Should this platform be used for other subjects in the university? | هل يجب استخدام هذه المنصة في مواد أخرى بالجامعة؟',
    options: ['Yes, definitely | نعم، بالتأكيد', 'Probably yes | غالباً نعم', 'Not sure | لست متأكداً',
      'Probably not | غالباً لا', 'No | لا'] },

  { type: 'section', title: 'Part 4 — In your own words | الجزء الرابع — بكلماتك',
    help: 'Write in English or Arabic. | اكتب بالعربية أو الإنجليزية.' },
  { type: 'paragraph', key: 'positives', required: false,
    title: 'What did you like most about the platform? | ما أكثر ما أعجبك في المنصة؟' },
  { type: 'paragraph', key: 'negatives', required: false,
    title: 'What did you NOT like, or what problems did you face? | ما الذي لم يعجبك، أو ما المشكلات التي واجهتها؟' },
  { type: 'paragraph', key: 'suggestions', required: false,
    title: 'What would you add or change? | ما الذي تقترح إضافته أو تغييره؟' },
  { type: 'paragraph', key: 'otherSubjects', required: false,
    title: 'Which other subjects would you like to study with a platform like this? | ما المواد الأخرى التي تود دراستها بمنصة مشابهة؟' }
];

/* ============================== 1. create the form ============================== */
function createSurvey() {
  var form = FormApp.create(SURVEY.title);
  form.setDescription(SURVEY.description)
    .setConfirmationMessage(SURVEY.confirmation)
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
    .setProgressBar(true);
  try { if (typeof form.setPublished === 'function') form.setPublished(true); } catch (e) { }   // newer accounts create forms unpublished
  QUESTIONS.forEach(function (q) {
    var it;
    if (q.type === 'section') { it = form.addPageBreakItem().setTitle(q.title); if (q.help) it.setHelpText(q.help); return; }
    if (q.type === 'choice') it = form.addMultipleChoiceItem().setChoiceValues(q.options);
    else if (q.type === 'checkbox') {
      it = form.addCheckboxItem().setChoiceValues(q.options);
      if (q.limit) it.setValidation(FormApp.createCheckboxValidation().requireSelectAtMost(q.limit).build());
    }
    else if (q.type === 'grid') it = form.addGridItem().setRows(q.rows).setColumns(SCALE);
    else if (q.type === 'scale') it = form.addScaleItem().setBounds(q.min, q.max).setLabels(q.low, q.high);
    else if (q.type === 'paragraph') it = form.addParagraphTextItem();
    it.setTitle(q.title).setRequired(!!q.required);
  });
  var ss = SpreadsheetApp.create('Platform survey — results | نتائج استبيان المنصة');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  PropertiesService.getScriptProperties().setProperties({ formId: form.getId(), sheetId: ss.getId() });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'buildSummary') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('buildSummary').forSpreadsheet(ss).onFormSubmit().create();   // the analysis refreshes after every answer
  SpreadsheetApp.flush();
  buildSummary();
  console.log('✅ Survey created.\n' +
    'STUDENT LINK (share this): ' + form.getPublishedUrl() + '\n' +
    'Edit the form: ' + form.getEditUrl() + '\n' +
    'Results + analysis (Google Sheet): ' + ss.getUrl());
}

/* ============================== 2. the analysis ============================== */
/** Rebuilds the "Summary" and "Comments" tabs of the results Sheet from all answers so far. */
function buildSummary() {
  var id = PropertiesService.getScriptProperties().getProperty('sheetId');
  if (!id) throw new Error('Run createSurvey first.');
  var ss = SpreadsheetApp.openById(id);
  var resp = ss.getSheets().filter(function (s) { return s.getFormUrl(); })[0];
  var values = resp ? resp.getDataRange().getValues() : [[]];
  var R = summarize_(values[0] || [], values.slice(1));
  writeSummary_(ss, R);
  writeComments_(ss, R);
}

/** Pure: header row + answer rows → every number of the report (also used by the tests). */
function summarize_(header, rows) {
  rows = rows.filter(function (r) { return r.some(function (v) { return v !== '' && v !== null; }); });
  var col = function (title) { return header.indexOf(title); };
  var out = { n: rows.length, choice: [], statements: [], scales: [], checks: [], comments: [] };
  var tally = function (c, options, multi) {
    var counts = options.map(function () { return 0; });
    rows.forEach(function (r) {
      var v = String(r[c] == null ? '' : r[c]); if (!v) return;
      options.forEach(function (o, i) { if (multi ? v.indexOf(o) >= 0 : v === o) counts[i]++; });
    });
    return counts;
  };
  QUESTIONS.forEach(function (q) {
    if (q.type === 'choice' || q.type === 'checkbox') {
      var c = col(q.title); if (c < 0) return;
      var answered = rows.filter(function (r) { return String(r[c] || '') !== ''; }).length;
      (q.type === 'choice' ? out.choice : out.checks).push({ key: q.key, title: q.title, options: q.options, counts: tally(c, q.options, q.type === 'checkbox'), answered: answered });
    }
    if (q.type === 'grid') q.rows.forEach(function (row) {
      var c2 = col(q.title + ' [' + row + ']'); if (c2 < 0) return;
      var d = [0, 0, 0, 0, 0];
      rows.forEach(function (r) { var k = SCALE.indexOf(String(r[c2] || '')); if (k >= 0) d[k]++; });
      var n = d.reduce(function (a, b) { return a + b; }, 0);
      var mean = n ? d.reduce(function (a, b, i) { return a + b * (i + 1); }, 0) / n : 0;
      out.statements.push({ group: q.title, text: row, n: n, dist: d, mean: mean, agree: n ? (d[3] + d[4]) / n : 0, disagree: n ? (d[0] + d[1]) / n : 0 });
    });
    if (q.type === 'scale') {
      var c3 = col(q.title); if (c3 < 0) return;
      var nums = rows.filter(function (r) { return r[c3] !== '' && r[c3] != null; }).map(function (r) { return Number(r[c3]); })
        .filter(function (x) { return isFinite(x) && x >= q.min && x <= q.max; });
      var s = { title: q.title, key: q.key, n: nums.length, mean: nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : 0 };
      if (q.key === 'recommend') {   // Net Promoter Score: % 9–10 minus % 0–6
        s.promoters = nums.filter(function (x) { return x >= 9; }).length; s.detractors = nums.filter(function (x) { return x <= 6; }).length;
        s.nps = nums.length ? Math.round((s.promoters - s.detractors) / nums.length * 100) : 0;
      }
      out.scales.push(s);
    }
    if (q.type === 'paragraph') {
      var c4 = col(q.title); if (c4 < 0) return;
      out.comments.push({ title: q.title, answers: rows.map(function (r) { return String(r[c4] || '').trim(); }).filter(Boolean) });
    }
  });
  var all = out.statements.filter(function (s) { return s.n; });
  out.overallAgree = all.length ? all.reduce(function (a, s) { return a + s.agree; }, 0) / all.length : 0;
  return out;
}

function sheetFresh_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) { sh.getCharts().forEach(function (c) { sh.removeChart(c); }); sh.clear(); } else sh = ss.insertSheet(name);
  return sh;
}
function pct_(x) { return Math.round(x * 1000) / 10 + '%'; }

function writeSummary_(ss, R) {
  var sh = sheetFresh_(ss, 'Summary'), r = 1, charts = [];
  var put = function (rows, bold) { if (!rows.length) return; var w = Math.max.apply(null, rows.map(function (x) { return x.length; }));
    rows = rows.map(function (x) { while (x.length < w) x.push(''); return x; });
    sh.getRange(r, 1, rows.length, w).setValues(rows); if (bold) sh.getRange(r, 1, 1, w).setFontWeight('bold').setBackground('#e8f1f8'); var at = r; r += rows.length + 1; return at; };
  sh.getRange(r, 1).setValue('Student evaluation of the platform — summary | ملخص تقييم الطلاب للمنصة').setFontSize(14).setFontWeight('bold'); r += 1;
  sh.getRange(r, 1).setValue('Updated ' + new Date().toLocaleString() + ' · ' + R.n + ' responses | عدد الاستجابات').setFontColor('#64748b'); r += 2;
  // key figures
  var ov = R.scales.filter(function (s) { return s.key === 'overall'; })[0], rc = R.scales.filter(function (s) { return s.key === 'recommend'; })[0];
  var oth = R.choice.filter(function (c) { return c.key === 'other'; })[0];
  put([['Key figures | أهم المؤشرات', 'Value | القيمة'],
    ['Responses | عدد الاستجابات', R.n],
    ['Average agreement with all positive statements | متوسط الموافقة على جميع العبارات', pct_(R.overallAgree)],
    ['Overall rating (1–10) | التقييم العام', ov && ov.n ? Math.round(ov.mean * 10) / 10 : '—'],
    ['Net Promoter Score (−100 to +100) | مؤشر التوصية', rc && rc.n ? rc.nps : '—'],
    ['Want it for other subjects (yes + probably yes) | يرغبون باستخدامها في مواد أخرى', oth && oth.answered ? pct_((oth.counts[0] + oth.counts[1]) / oth.answered) : '—']], true);
  // statements
  var st = [['Statement | العبارة', 'Agree % | نسبة الموافقة', 'Disagree % | نسبة عدم الموافقة', 'Mean (1–5) | المتوسط', 'n'].concat(SCALE)];
  R.statements.forEach(function (s) { st.push([s.text, Math.round(s.agree * 1000) / 10, Math.round(s.disagree * 1000) / 10, Math.round(s.mean * 100) / 100, s.n].concat(s.dist)); });
  var stAt = put(st, true);
  if (R.statements.length) charts.push(sh.newChart().asBarChart().addRange(sh.getRange(stAt, 1, R.statements.length + 1, 2))
    .setOption('title', 'Agreement with each statement (%) | نسبة الموافقة على كل عبارة').setOption('legend', { position: 'none' })
    .setOption('hAxis', { minValue: 0, maxValue: 100 }).setOption('height', 520).setOption('width', 900).setPosition(stAt, 12, 0, 0).build());
  r = Math.max(r, stAt + 27);   // room for the chart beside the table
  // choices and checkboxes
  R.choice.concat(R.checks).forEach(function (c) {
    var t = [[c.title, 'Count | العدد', '% of respondents | النسبة']];
    c.options.forEach(function (o, i) { t.push([o, c.counts[i], c.answered ? Math.round(c.counts[i] / c.answered * 1000) / 10 : 0]); });
    var at = put(t, true);
    charts.push(sh.newChart().asBarChart().addRange(sh.getRange(at, 1, c.options.length + 1, 2))
      .setOption('title', c.title).setOption('legend', { position: 'none' }).setOption('height', 300).setOption('width', 700).setPosition(at, 12, 0, 0).build());
    r = Math.max(r, at + 16);
  });
  // scales
  put([['Rating | التقييم', 'Mean | المتوسط', 'n']].concat(R.scales.map(function (s) { return [s.title, Math.round(s.mean * 10) / 10, s.n]; })), true);
  charts.forEach(function (c) { sh.insertChart(c); });
  sh.setColumnWidth(1, 520);
}

function writeComments_(ss, R) {
  var sh = sheetFresh_(ss, 'Comments'), r = 1;
  R.comments.forEach(function (c) {
    sh.getRange(r, 1).setValue(c.title + ' (' + c.answers.length + ')').setFontWeight('bold').setBackground('#e8f1f8'); r++;
    if (c.answers.length) { sh.getRange(r, 1, c.answers.length, 1).setValues(c.answers.map(function (a) { return [a]; })).setWrap(true); r += c.answers.length; }
    r++;
  });
  sh.setColumnWidth(1, 900);
}

if (typeof module !== 'undefined') module.exports = { SURVEY: SURVEY, SCALE: SCALE, QUESTIONS: QUESTIONS, summarize_: summarize_ };
