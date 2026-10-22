/**
 * Student evaluation survey of the Interactive Pathology Teaching Platform — in Arabic (user, 2026-10-22: Arabic only,
 * anonymous — the opening text tells students no one can know who they are and asks for a frank opinion).
 *
 * Paste this file into a NEW, SEPARATE Apps Script project (script.google.com → New project). Do NOT put it into the
 * platform's project (Code.gs / Portal.gs) — it needs nothing from there and must not touch it.
 *
 *   1. ▶ Run createSurvey   → creates the Google Form + a linked results Sheet + the automatic analysis;
 *                             the Execution log prints the student link, the edit link and the Sheet link.
 *   2. Share the student link (or its QR code: Form → Send → 🔗 link → "Shorten URL").
 *   3. The Sheet's "الملخص" (summary) and "التعليقات" (comments) tabs refresh by themselves after every answer.
 *      ▶ Run buildSummary   → rebuilds them by hand at any time.
 *
 * The survey is ANONYMOUS: no email addresses or names are collected.
 */

var SURVEY = {
  title: 'استبيان تقييم الطلاب لمنصة تعليم علم الأمراض التفاعلية',
  description:
    'عزيزي الطالب، عزيزتي الطالبة،\n' +
    'يهدف هذا الاستبيان إلى معرفة رأيك في منصة تعليم علم الأمراض التفاعلية من أجل تطويرها وتحسينها.\n\n' +
    '🔒 الاستبيان مجهول الهوية تماماً: لا نطلب اسمك ولا بريدك الإلكتروني ولا رقمك الجامعي، ولا يمكن لأي أحد أن يعرف هويتك.\n\n' +
    'لذلك نرجو أن تعبّر عن رأيك بكل صراحة وحرية، في الإيجابيات والسلبيات معاً — فرأيك الصريح هو ما يساعدنا على التحسين.\n\n' +
    'يستغرق الاستبيان حوالي 7 دقائق. شكراً لوقتك.',
  confirmation: 'شكراً لك! تم حفظ إجاباتك. نقدّر رأيك الصريح.'
};

/** The 5-point agreement scale used by every statement grid (1 = strongly disagree … 5 = strongly agree). */
var SCALE = [
  'لا أوافق بشدة',
  'لا أوافق',
  'محايد',
  'أوافق',
  'أوافق بشدة'
];

/** Platform features — used by "most useful" and "least useful". */
var FEATURES = [
  'التعلّم: شرح المواضيع',
  'الصور والرسوم التوضيحية وصور الأطلس',
  'أسئلة التدريب (الاختيار من متعدد)',
  'الحالات السريرية',
  'شرائح العرض',
  'اختبارات المواضيع والتقييمات',
  'المراجعة السريعة قبل الامتحان',
  'قاموس المصطلحات',
  'متابعة التقدّم',
  'تسجيل الحضور',
  'القراءة بملء الشاشة'
];

/** The questionnaire, in order. type: section | choice | checkbox | grid | scale | paragraph. */
var QUESTIONS = [
  { type: 'section', title: 'الجزء الأول — معلومات عنك' },
  { type: 'checkbox', key: 'modules', required: true,
    title: 'ما الوحدات التي استخدمتها على المنصة؟',
    options: ['مقدمة في علم الأمراض', 'إصابة الخلية وموتها',
      'الالتهاب والالتئام', 'الأورام'] },
  { type: 'choice', key: 'device', required: true,
    title: 'ما الجهاز الذي استخدمته أكثر؟',
    options: ['الهاتف المحمول', 'حاسوب محمول أو مكتبي', 'جهاز لوحي'] },
  { type: 'choice', key: 'frequency', required: true,
    title: 'كم مرة استخدمت المنصة؟',
    options: ['يومياً', 'عدة مرات في الأسبوع', 'مرة في الأسبوع',
      'قبل الامتحانات فقط', 'نادراً'] },

  { type: 'section', title: 'الجزء الثاني — رأيك',
    help: 'إلى أي مدى توافق على كل عبارة؟' },
  { type: 'grid', key: 'use', required: true,
    title: 'أ. سهولة الاستخدام',
    rows: ['تسجيل الدخول إلى المنصة سهل.',
      'من السهل إيجاد ما أحتاجه على المنصة.',
      'المنصة تعمل بشكل جيد على هاتفي.',
      'الصفحات تُحمَّل بسرعة.'] },
  { type: 'grid', key: 'content', required: true,
    title: 'ب. المحتوى التعليمي',
    rows: ['الشروحات واضحة وسهلة الفهم.',
      'المحتوى يتوافق مع المحاضرات والمنهج.',
      'الصور والرسوم التوضيحية ساعدتني على الفهم.',
      'النقاط الرئيسية ومربعات "يجب أن تعرف" مفيدة.'] },
  { type: 'grid', key: 'practice', required: true,
    title: 'ج. التدريب والتقييم',
    rows: ['أسئلة التدريب والحالات حسّنت فهمي.',
      'الاختبارات والتقييمات كانت عادلة.',
      'رؤية الإجابات الصحيحة والشروحات فوراً ساعدتني على التعلّم.',
      'المراجعة السريعة ساعدتني في الاستعداد للامتحانات.'] },
  { type: 'grid', key: 'class', required: true,
    title: 'د. داخل القاعة الدراسية',
    rows: ['تسجيل الحضور سهل.',
      'شرائح العرض في المحاضرات واضحة.',
      'الاختبارات أثناء المحاضرة تُبقيني منتبهاً.'] },
  { type: 'grid', key: 'impact', required: true,
    title: 'هـ. الأثر العام',
    rows: ['المنصة حسّنت فهمي لعلم الأمراض.',
      'المنصة زادت دافعيتي للدراسة.',
      'المنصة وفّرت عليّ الوقت في الدراسة.',
      'أشعر أنني مستعد للامتحانات بشكل أفضل.',
      'أُفضّل التعلّم بالمنصة على المحاضرات والمذكرات وحدها.'] },

  { type: 'section', title: 'الجزء الثالث — التقييم والاختيارات' },
  { type: 'scale', key: 'overall', required: true, min: 1, max: 10,
    title: 'بشكل عام، كيف تقيّم المنصة؟',
    low: 'ضعيف جداً', high: 'ممتاز' },
  { type: 'scale', key: 'recommend', required: true, min: 0, max: 10,
    title: 'ما مدى احتمال أن توصي بالمنصة لطلاب آخرين؟',
    low: 'غير محتمل إطلاقاً', high: 'محتمل جداً' },
  { type: 'checkbox', key: 'best', required: true, limit: 3,
    title: 'ما أكثر الميزات فائدة؟ (اختر حتى 3)',
    options: FEATURES },
  { type: 'checkbox', key: 'least', required: false,
    title: 'ما أقل الميزات فائدة؟',
    options: FEATURES.concat(['لا شيء — كلها مفيدة']) },
  { type: 'checkbox', key: 'problems', required: true,
    title: 'هل واجهت أياً من هذه المشكلات؟',
    options: ['مشكلات في تسجيل الدخول', 'بطء التحميل',
      'التقييمات لم تفتح', 'صعوبة الاستخدام على الهاتف',
      'المحتوى طويل جداً', 'المحتوى قصير جداً',
      'أخطاء تقنية', 'لا توجد مشكلات'] },
  { type: 'choice', key: 'other', required: true,
    title: 'هل يجب استخدام هذه المنصة في مواد أخرى بالجامعة؟',
    options: ['نعم، بالتأكيد', 'غالباً نعم', 'لست متأكداً',
      'غالباً لا', 'لا'] },

  { type: 'section', title: 'الجزء الرابع — بكلماتك',
    help: 'اكتب رأيك بحرية وصراحة — لن يعرف أحد هويتك.' },
  { type: 'paragraph', key: 'positives', required: false,
    title: 'ما أكثر ما أعجبك في المنصة؟' },
  { type: 'paragraph', key: 'negatives', required: false,
    title: 'ما الذي لم يعجبك، أو ما المشكلات التي واجهتها؟' },
  { type: 'paragraph', key: 'suggestions', required: false,
    title: 'ما الذي تقترح إضافته أو تغييره؟' },
  { type: 'paragraph', key: 'otherSubjects', required: false,
    title: 'ما المواد الأخرى التي تود دراستها بمنصة مشابهة؟' }
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
  var ss = SpreadsheetApp.create('نتائج استبيان المنصة');
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
/** Rebuilds the "الملخص" (summary) and "التعليقات" (comments) tabs of the results Sheet from all answers so far. */
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
  var sh = sheetFresh_(ss, 'الملخص'), r = 1, charts = [];
  sh.setRightToLeft(true);
  var put = function (rows, bold) { if (!rows.length) return; var w = Math.max.apply(null, rows.map(function (x) { return x.length; }));
    rows = rows.map(function (x) { while (x.length < w) x.push(''); return x; });
    sh.getRange(r, 1, rows.length, w).setValues(rows); if (bold) sh.getRange(r, 1, 1, w).setFontWeight('bold').setBackground('#e8f1f8'); var at = r; r += rows.length + 1; return at; };
  sh.getRange(r, 1).setValue('ملخص تقييم الطلاب للمنصة').setFontSize(14).setFontWeight('bold'); r += 1;
  sh.getRange(r, 1).setValue('آخر تحديث: ' + new Date().toLocaleString() + ' · عدد الاستجابات: ' + R.n).setFontColor('#64748b'); r += 2;
  // key figures
  var ov = R.scales.filter(function (s) { return s.key === 'overall'; })[0], rc = R.scales.filter(function (s) { return s.key === 'recommend'; })[0];
  var oth = R.choice.filter(function (c) { return c.key === 'other'; })[0];
  put([['أهم المؤشرات', 'القيمة'],
    ['عدد الاستجابات', R.n],
    ['متوسط نسبة الموافقة على جميع العبارات (أوافق + أوافق بشدة)', pct_(R.overallAgree)],
    ['التقييم العام (من 1 إلى 10)', ov && ov.n ? Math.round(ov.mean * 10) / 10 : '—'],
    ['مؤشر التوصية (من −100 إلى +100: نسبة من اختاروا 9–10 ناقص نسبة من اختاروا 0–6)', rc && rc.n ? rc.nps : '—'],
    ['نسبة من يرغبون باستخدامها في مواد أخرى (نعم بالتأكيد + غالباً نعم)', oth && oth.answered ? pct_((oth.counts[0] + oth.counts[1]) / oth.answered) : '—']], true);
  // statements
  var st = [['العبارة', 'نسبة الموافقة %', 'نسبة عدم الموافقة %', 'المتوسط (من 1 إلى 5)', 'عدد الإجابات'].concat(SCALE)];
  R.statements.forEach(function (s) { st.push([s.text, Math.round(s.agree * 1000) / 10, Math.round(s.disagree * 1000) / 10, Math.round(s.mean * 100) / 100, s.n].concat(s.dist)); });
  var stAt = put(st, true);
  if (R.statements.length) charts.push(sh.newChart().asBarChart().addRange(sh.getRange(stAt, 1, R.statements.length + 1, 2))
    .setOption('title', 'نسبة الموافقة على كل عبارة').setOption('legend', { position: 'none' })
    .setOption('hAxis', { minValue: 0, maxValue: 100 }).setOption('height', 520).setOption('width', 900).setPosition(stAt, 12, 0, 0).build());
  r = Math.max(r, stAt + 27);   // room for the chart beside the table
  // choices and checkboxes
  R.choice.concat(R.checks).forEach(function (c) {
    var t = [[c.title, 'العدد', 'النسبة % من المجيبين']];
    c.options.forEach(function (o, i) { t.push([o, c.counts[i], c.answered ? Math.round(c.counts[i] / c.answered * 1000) / 10 : 0]); });
    var at = put(t, true);
    charts.push(sh.newChart().asBarChart().addRange(sh.getRange(at, 1, c.options.length + 1, 2))
      .setOption('title', c.title).setOption('legend', { position: 'none' }).setOption('height', 300).setOption('width', 700).setPosition(at, 12, 0, 0).build());
    r = Math.max(r, at + 16);
  });
  // scales
  put([['التقييم', 'المتوسط', 'عدد الإجابات']].concat(R.scales.map(function (s) { return [s.title, Math.round(s.mean * 10) / 10, s.n]; })), true);
  charts.forEach(function (c) { sh.insertChart(c); });
  sh.setColumnWidth(1, 520);
}

function writeComments_(ss, R) {
  var sh = sheetFresh_(ss, 'التعليقات'), r = 1;
  sh.setRightToLeft(true);
  R.comments.forEach(function (c) {
    sh.getRange(r, 1).setValue(c.title + ' (' + c.answers.length + ')').setFontWeight('bold').setBackground('#e8f1f8'); r++;
    if (c.answers.length) { sh.getRange(r, 1, c.answers.length, 1).setValues(c.answers.map(function (a) { return [a]; })).setWrap(true); r += c.answers.length; }
    r++;
  });
  sh.setColumnWidth(1, 900);
}

if (typeof module !== 'undefined') module.exports = { SURVEY: SURVEY, SCALE: SCALE, QUESTIONS: QUESTIONS, summarize_: summarize_ };
