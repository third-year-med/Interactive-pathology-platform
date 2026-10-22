# Student evaluation survey — the questions | استبيان تقييم الطلاب — الأسئلة

Created automatically by [`tools/survey/StudentSurvey.gs`](https://github.com/third-year-med/Interactive-pathology-platform/blob/main/tools/survey/StudentSurvey.gs) (▶ createSurvey). Anonymous · about 7 minutes · every question in English and Arabic.

## How to create, share and analyse it

1. Open https://script.google.com → **New project** (a NEW, separate project — not the platform's Code.gs / Portal.gs project).
   Name it "Platform survey".
2. Open the raw file https://raw.githubusercontent.com/third-year-med/Interactive-pathology-platform/main/tools/survey/StudentSurvey.gs,
   **Ctrl+A**, **Ctrl+C**; in the project select everything in `Code.gs`, paste, 💾 Save.
3. At the top choose **createSurvey** → **▶ Run** → allow the permissions (Forms, Sheets, triggers). The **Execution log**
   prints three links: the **student link**, the form's edit link and the **results Sheet**.
4. Open the edit link once: check it, add your university logo if you like (🎨 Customize theme).
   Share with students: **Send** → 🔗 → *Shorten URL* → copy; or the QR code (any free QR generator from the short link).
5. Results: Google Forms → **Responses** tab shows charts at once; the results Sheet has a **Summary** tab (key figures, % agree
   per statement, every choice question with a chart) and a **Comments** tab (all written answers) — both refresh after every
   answer. **▶ Run buildSummary** rebuilds them by hand.
6. For the faculty / dean: share the Sheet (view only), or File → Download → PDF of the Summary tab.

**Agreement scale (parts A–E):** Strongly disagree | لا أوافق بشدة · Disagree | لا أوافق · Neutral | محايد · Agree | أوافق · Strongly agree | أوافق بشدة

## Part 1 — About you | الجزء الأول — معلومات عنك

**1. Which modules did you use on the platform? | ما الوحدات التي استخدمتها على المنصة؟** — *one or more | إجابة أو أكثر*
- Introduction to Pathology | مقدمة في علم الأمراض
- Cell Injury & Cell Death | إصابة الخلية وموتها
- Inflammation & Healing | الالتهاب والالتئام
- Neoplasia | الأورام

**2. Which device did you use most? | ما الجهاز الذي استخدمته أكثر؟** — *one answer | إجابة واحدة*
- Mobile phone | الهاتف المحمول
- Laptop or desktop computer | حاسوب محمول أو مكتبي
- Tablet | جهاز لوحي

**3. How often did you use the platform? | كم مرة استخدمت المنصة؟** — *one answer | إجابة واحدة*
- Daily | يومياً
- Several times a week | عدة مرات في الأسبوع
- Once a week | مرة في الأسبوع
- Only before exams | قبل الامتحانات فقط
- Rarely | نادراً

## Part 2 — Your opinion | الجزء الثاني — رأيك

*How much do you agree with each statement? | إلى أي مدى توافق على كل عبارة؟*

**4. A. Ease of use | أ. سهولة الاستخدام** — *agreement scale 1–5 | مقياس الموافقة*
- Signing in to the platform is easy. | تسجيل الدخول إلى المنصة سهل.
- It is easy to find what I need on the platform. | من السهل إيجاد ما أحتاجه على المنصة.
- The platform works well on my phone. | المنصة تعمل بشكل جيد على هاتفي.
- The pages load quickly. | الصفحات تُحمَّل بسرعة.

**5. B. Learning content | ب. المحتوى التعليمي** — *agreement scale 1–5 | مقياس الموافقة*
- The explanations are clear and easy to understand. | الشروحات واضحة وسهلة الفهم.
- The content matches the lectures and the syllabus. | المحتوى يتوافق مع المحاضرات والمنهج.
- The pictures and diagrams helped me understand. | الصور والرسوم التوضيحية ساعدتني على الفهم.
- The key points and "Must know" boxes are helpful. | النقاط الرئيسية ومربعات "يجب أن تعرف" مفيدة.

**6. C. Practice and assessment | ج. التدريب والتقييم** — *agreement scale 1–5 | مقياس الموافقة*
- The practice questions and cases improved my understanding. | أسئلة التدريب والحالات حسّنت فهمي.
- The quizzes and assessments were fair. | الاختبارات والتقييمات كانت عادلة.
- Seeing the correct answers and explanations right away helped me learn. | رؤية الإجابات الصحيحة والشروحات فوراً ساعدتني على التعلّم.
- The Last-Minute Review helped me prepare for exams. | المراجعة السريعة ساعدتني في الاستعداد للامتحانات.

**7. D. In the classroom | د. داخل القاعة الدراسية** — *agreement scale 1–5 | مقياس الموافقة*
- Checking in for attendance is easy. | تسجيل الحضور سهل.
- The presentation slides in lectures are clear. | شرائح العرض في المحاضرات واضحة.
- Quizzes during the lecture keep me focused. | الاختبارات أثناء المحاضرة تُبقيني منتبهاً.

**8. E. Overall impact | هـ. الأثر العام** — *agreement scale 1–5 | مقياس الموافقة*
- The platform improved my understanding of pathology. | المنصة حسّنت فهمي لعلم الأمراض.
- The platform made me more motivated to study. | المنصة زادت دافعيتي للدراسة.
- The platform saved me time when studying. | المنصة وفّرت عليّ الوقت في الدراسة.
- I feel better prepared for exams. | أشعر أنني مستعد للامتحانات بشكل أفضل.
- I prefer learning with the platform over lectures and notes alone. | أُفضّل التعلّم بالمنصة على المحاضرات والمذكرات وحدها.

## Part 3 — Ratings and choices | الجزء الثالث — التقييم والاختيارات

**9. Overall, how would you rate the platform? | بشكل عام، كيف تقيّم المنصة؟** — *scale 1–10 | مقياس*
- 1 = Very poor | ضعيف جداً … 10 = Excellent | ممتاز

**10. How likely are you to recommend the platform to other students? | ما مدى احتمال أن توصي بالمنصة لطلاب آخرين؟** — *scale 0–10 | مقياس*
- 0 = Not at all likely | غير محتمل إطلاقاً … 10 = Extremely likely | محتمل جداً

**11. Which features were the MOST useful? (choose up to 3) | ما أكثر الميزات فائدة؟ (اختر حتى 3)** — *up to 3 | حتى 3*
- Learn: topic explanations | التعلّم: شرح المواضيع
- Pictures, diagrams and atlas images | الصور والرسوم التوضيحية وصور الأطلس
- Practice questions (MCQs) | أسئلة التدريب (الاختيار من متعدد)
- Clinical cases | الحالات السريرية
- Presentation slides | شرائح العرض
- Topic quizzes and assessments | اختبارات المواضيع والتقييمات
- Last-Minute Review | المراجعة السريعة قبل الامتحان
- Glossary | قاموس المصطلحات
- Progress tracking | متابعة التقدّم
- Attendance check-in | تسجيل الحضور
- Full-screen reading | القراءة بملء الشاشة

**12. Which features were the LEAST useful? | ما أقل الميزات فائدة؟** — *one or more | إجابة أو أكثر · optional | اختياري*
- Learn: topic explanations | التعلّم: شرح المواضيع
- Pictures, diagrams and atlas images | الصور والرسوم التوضيحية وصور الأطلس
- Practice questions (MCQs) | أسئلة التدريب (الاختيار من متعدد)
- Clinical cases | الحالات السريرية
- Presentation slides | شرائح العرض
- Topic quizzes and assessments | اختبارات المواضيع والتقييمات
- Last-Minute Review | المراجعة السريعة قبل الامتحان
- Glossary | قاموس المصطلحات
- Progress tracking | متابعة التقدّم
- Attendance check-in | تسجيل الحضور
- Full-screen reading | القراءة بملء الشاشة
- None — all were useful | لا شيء — كلها مفيدة

**13. Did you face any of these problems? | هل واجهت أياً من هذه المشكلات؟** — *one or more | إجابة أو أكثر*
- Problems signing in | مشكلات في تسجيل الدخول
- Slow loading | بطء التحميل
- Assessments did not open | التقييمات لم تفتح
- Hard to use on the phone | صعوبة الاستخدام على الهاتف
- Content too long | المحتوى طويل جداً
- Content too short | المحتوى قصير جداً
- Technical errors | أخطاء تقنية
- No problems | لا توجد مشكلات

**14. Should this platform be used for other subjects in the university? | هل يجب استخدام هذه المنصة في مواد أخرى بالجامعة؟** — *one answer | إجابة واحدة*
- Yes, definitely | نعم، بالتأكيد
- Probably yes | غالباً نعم
- Not sure | لست متأكداً
- Probably not | غالباً لا
- No | لا

## Part 4 — In your own words | الجزء الرابع — بكلماتك

*Write in English or Arabic. | اكتب بالعربية أو الإنجليزية.*

**15. What did you like most about the platform? | ما أكثر ما أعجبك في المنصة؟** — *written answer | إجابة مكتوبة · optional | اختياري*

**16. What did you NOT like, or what problems did you face? | ما الذي لم يعجبك، أو ما المشكلات التي واجهتها؟** — *written answer | إجابة مكتوبة · optional | اختياري*

**17. What would you add or change? | ما الذي تقترح إضافته أو تغييره؟** — *written answer | إجابة مكتوبة · optional | اختياري*

**18. Which other subjects would you like to study with a platform like this? | ما المواد الأخرى التي تود دراستها بمنصة مشابهة؟** — *written answer | إجابة مكتوبة · optional | اختياري*
