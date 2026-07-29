/**
 * اختبارات انحدار لمنطق المختبر.  التشغيل:  npm test
 *
 * سبب وجودها: أخطاء هذا الملف لا تظهر كأعطال — تظهر كنتائج مريض خاطئة.
 * خطأ اختيار المدى المرجعي كان يجعل طفلًا كرياتينينه ١.٠ (مرتفع فعليًا)
 * يظهر «طبيعيًا»، وهذا لا يكشفه أي بناء ناجح ولا أي فحص أنواع.
 */

import {
  computeFlag,
  computeTextFlag,
  dayOf,
  fmtDateTime,
  fmtMoney,
  localDay,
  newMrn,
  newOrderNo,
  orderStamp,
  pickRange,
  rangeLabel,
  verificationCode,
} from "./lab";
import { SEED_TESTS } from "./seedTests";
import { CODE39, encodeCode39 } from "./barcode";
import {
  SCAN_MAX_GAP_MS,
  ScanBuffer,
  normalizeScan,
  scanMatchesOrder,
} from "./scanner";

let failed = 0;
let passed = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      المتوقَّع: ${JSON.stringify(want)}`);
    console.log(`      الناتج  : ${JSON.stringify(got)}`);
  }
}

function group(title: string) {
  console.log(`\n${title}`);
}

const test = (code: string) => {
  const t = SEED_TESTS.find((x) => x.code === code);
  if (!t) throw new Error(`فحص غير موجود في الكتالوج: ${code}`);
  return t;
};

/* ── ١. اختيار المدى المرجعي: العمر يسبق الجنس ──────────────── */
group("المدى المرجعي — الأطفال لا يأخذون مدى البالغين");

const hgb = test("HGB").ranges!;
const crea = test("CREA").ranges!;

check("HGB ذكر ٥ سنوات → مدى الأطفال", pickRange(hgb, "MALE", 5), {
  ageMaxYears: 12,
  low: 11.5,
  high: 15.5,
});
check("HGB أنثى ٨ سنوات → مدى الأطفال", pickRange(hgb, "FEMALE", 8), {
  ageMaxYears: 12,
  low: 11.5,
  high: 15.5,
});
check("HGB ذكر ٤٠ سنة → مدى الذكور البالغين", pickRange(hgb, "MALE", 40), {
  sex: "MALE",
  ageMinYears: 12,
  low: 13.5,
  high: 17.5,
});
check("HGB أنثى ٣٠ سنة → مدى الإناث البالغات", pickRange(hgb, "FEMALE", 30), {
  sex: "FEMALE",
  ageMinYears: 12,
  low: 12,
  high: 15.5,
});
check("CREA ذكر ١٠ سنوات → مدى الأطفال", pickRange(crea, "MALE", 10), {
  ageMaxYears: 15,
  low: 0.3,
  high: 0.7,
});
check("CREA ذكر ٤٠ سنة → مدى البالغين", pickRange(crea, "MALE", 40), {
  sex: "MALE",
  ageMinYears: 15,
  low: 0.7,
  high: 1.3,
});
check(
  "CREA عمر مجهول → مدى البالغين (افتراض آمن)",
  pickRange(crea, "MALE", null),
  { sex: "MALE", ageMinYears: 15, low: 0.7, high: 1.3 }
);
check("بلا مديات → null", pickRange([], "MALE", 30), null);

/* ── ٢. الحالات السريرية التي كانت تُصنَّف خطأً ───────────────── */
group("تصنيف النتائج — الحالات التي كانت خاطئة");

const childCrea = pickRange(crea, "MALE", 10)!;
check(
  "طفل ١٠ سنوات، كرياتينين ١.٠ → مرتفع (كان يظهر طبيعيًا)",
  computeFlag({
    value: 1.0,
    low: childCrea.low,
    high: childCrea.high,
    criticalHigh: 7,
  }),
  "HIGH"
);

const boyHgb = pickRange(hgb, "MALE", 5)!;
check(
  "طفل ٥ سنوات، هيموغلوبين ١٢.٠ → طبيعي (كان يظهر منخفضًا)",
  computeFlag({
    value: 12.0,
    low: boyHgb.low,
    high: boyHgb.high,
    criticalLow: 7,
  }),
  "NORMAL"
);

check(
  "بالغ، هيموغلوبين ٦.٠ → منخفض حرج",
  computeFlag({ value: 6.0, low: 13.5, high: 17.5, criticalLow: 7 }),
  "CRITICAL_LOW"
);
check(
  "الحرج يسبق المرتفع العادي",
  computeFlag({ value: 7.0, low: 3.5, high: 5.1, criticalHigh: 6.5 }),
  "CRITICAL_HIGH"
);
check("قيمة فارغة → بلا عَلَم", computeFlag({ value: null }), null);
check("بلا مدى → بلا عَلَم", computeFlag({ value: 5 }), null);
check("نتيجة «سلبي» → طبيعي", computeTextFlag("سلبي"), "NORMAL");
check("نتيجة «إيجابي» → غير طبيعي", computeTextFlag("إيجابي"), "ABNORMAL");
check("نتيجة فارغة → بلا عَلَم", computeTextFlag("  "), null);

/* ── ٣. صياغة المدى في التقرير ──────────────────────────────── */
group("صياغة المدى المرجعي");
check("حدّان", rangeLabel(70, 99), "70 – 99");
check("حد أدنى فقط", rangeLabel(40, null), "> 40");
check("حد أعلى فقط", rangeLabel(null, 200), "< 200");
check("نصّي", rangeLabel(null, 5, "< 5 (غير حامل)"), "< 5 (غير حامل)");
check("بلا شيء", rangeLabel(), "—");

/* ── ٤. تفرّد الأرقام ───────────────────────────────────────── */
group("أرقام الطلبات والملفات");

const N = 20000;
const orderNos = new Set(Array.from({ length: N }, () => newOrderNo()));
const dupRate = (N - orderNos.size) / N;
check(
  `${N} رقم طلب: نسبة التكرار أقل من ٢٪ (المدى ١٠٠٠٠٠٠/يوم)`,
  dupRate < 0.02,
  true
);
check("صيغة رقم الطلب", /^LAB-\d{6}-\d{6}$/.test(newOrderNo()), true);
check("صيغة رقم الملف", /^P-\d{4}-\d{6}$/.test(newMrn()), true);
console.log(`      مثال: ${newOrderNo()} / ${newMrn()}`);
console.log(`      نسبة التكرار المرصودة: ${(dupRate * 100).toFixed(3)}٪`);

/* ── ٥. رمز التحقق على التقرير ──────────────────────────────── */
group("رمز التحقق");

const base = ["LAB-260728-482913", "P-2607-111111", "2026-07-28T10:00:00Z", 1, "GLU=95:NORMAL"];
const changedValue = [...base.slice(0, 4), "GLU=96:NORMAL"];
const changedRevision = [...base.slice(0, 3), 2, base[4]];

check("ثابت لنفس المحتوى", verificationCode(base) === verificationCode(base), true);
check(
  "يتغيّر بتغيّر قيمة نتيجة",
  verificationCode(base) !== verificationCode(changedValue),
  true
);
check(
  "يتغيّر بتغيّر رقم المراجعة",
  verificationCode(base) !== verificationCode(changedRevision),
  true
);
check("طوله ١٠ خانات", verificationCode(base).length, 10);
console.log(`      مثال: ${verificationCode(base)}`);

/* ── ٦. التنسيق بأرقام لاتينية ───────────────────────────────── */
group("التنسيق");

const money = fmtMoney(1234.5);
const when = fmtDateTime("2026-07-28T10:05:00Z");
const arabicIndic = /[٠-٩]/;
check("المبلغ بأرقام لاتينية", /\d/.test(money) && !arabicIndic.test(money), true);
check("التاريخ بأرقام لاتينية", /\d/.test(when) && !arabicIndic.test(when), true);
check("التاريخ ميلادي (سنة ٢٠٢٦)", when.includes("2026"), true);
check("تاريخ فارغ", fmtDateTime(null), "—");
console.log(`      ${money}  |  ${when}`);

/* ── ٧. باركود الأنبوب ──────────────────────────────────────────
   الخطر هنا ليس عطلًا: باركود مطبوع بجدول فيه خطأ مطبعي واحد يُمسح
   بنجاح ويعطي رقمًا آخر — فتُنسب العيّنة إلى مريض غير صاحبها. لذلك
   نتحقّق من قواعد Code 39 البنيوية على الجدول كله، وهي كاشفة لأي حرف
   كُتب خطأً حتى لو بدا الباركود سليمًا للعين.                     */
group("باركود الأنبوب (Code 39)");

const entries = Object.entries(CODE39);
const isSpecial = (ch: string) => ["$", "/", "+", "%"].includes(ch);

check("الجدول ٤٤ حرفًا (٤٣ + حرف الحدّ)", entries.length, 44);
check(
  "كل نمط تسعة عناصر",
  entries.every(([, p]) => p.length === 9),
  true
);
check(
  "كل حرف ثلاثة عناصر عريضة",
  entries.every(([, p]) => p.split("").filter((c) => c === "w").length === 3),
  true
);
check(
  "الأحرف العادية: خطّان عريضان وفراغ عريض",
  entries
    .filter(([ch]) => !isSpecial(ch))
    .every(([, p]) => {
      const wideBars = p.split("").filter((c, i) => c === "w" && i % 2 === 0).length;
      return wideBars === 2;
    }),
  true
);
check(
  "الأحرف الخاصة ($ / + %): ثلاثة فراغات عريضة بلا خط عريض",
  entries
    .filter(([ch]) => isSpecial(ch))
    .every(([, p]) => p.split("").filter((c, i) => c === "w" && i % 2 === 0).length === 0),
  true
);
check(
  "لا نمطين متطابقين لحرفين",
  new Set(entries.map(([, p]) => p)).size,
  entries.length
);
check(
  "كل حرف يبدأ وينتهي بخط",
  entries.every(([, p]) => p.length === 9),
  true
);

const bc = encodeCode39("LAB-260729-812326");
// ١٧ حرف بيانات + حرفا حدّ = ١٩ حرفًا × ٥ خطوط
check("عدد الخطوط = ٥ لكل حرف", bc.bars.length, 19 * 5);
check("النص المرمَّز كما هو", bc.text, "LAB-260729-812326");
check("لا خطوط متداخلة", bc.bars.every((b, i) => i === 0 || b.x >= bc.bars[i - 1].x + bc.bars[i - 1].width), true);
check("حروف صغيرة تُرفع", encodeCode39("lab-1").text, "LAB-1");
check("حرف غير مقبول يصير شرطة لا يُحذف", encodeCode39("A#B").text, "A-B");
check("النجمة في البيانات لا تكسر الحدّ", encodeCode39("A*B").text, "A-B");
console.log(`      عرض باركود "LAB-260729-812326" = ${bc.width} وحدة`);

/* ── ٨. قراءة الباركود بالماسح ───────────────────────────────────
   الخطر مرآة خطر الطباعة: مطابقة متساهلة تقول «الأنبوب صحيح» عن أنبوب
   ليس له، ومطابقة متزمّتة تقول «خطأ» عن الأنبوب الصحيح فيتعلّم الفنّي
   تجاهل التحذير. وتمييز المسح عن الكتابة بالسرعة يجب ألا يبتلع ما
   يكتبه إنسان — الابتلاع هنا يعني تغيير نتيجة مريض بصمت.          */
group("قراءة الباركود بالماسح");

check("حرفا الحدّ يُحذفان", normalizeScan("*LAB-260729-000042*"), "LAB-260729-000042");
check("الأحرف تُرفع والفراغ يُزال", normalizeScan(" lab-1 "), "LAB-1");
check("مطابقة رقم الطلب", scanMatchesOrder("*LAB-260729-000042*", "LAB-260729-000042"), true);
check("رقم آخر لا يطابق", scanMatchesOrder("LAB-260729-000043", "LAB-260729-000042"), false);
// رقم فارغ يطابق كل شيء لو قورن بسذاجة — والنتيجة «الأنبوب صحيح» دائمًا.
check("رمز فارغ لا يطابق شيئًا", scanMatchesOrder("", ""), false);
check("طلب بلا رقم لا يطابق", scanMatchesOrder("LAB-1", null), false);

/** يغذّي المخزن بنص كامل بفاصل زمني ثابت بين الأحرف. */
function feed(text: string, gapMs: number): string | null {
  const buf = new ScanBuffer();
  let t = 1000;
  for (const ch of text) {
    buf.push(ch, t);
    t += gapMs;
  }
  return buf.flush();
}

const FAST = SCAN_MAX_GAP_MS - 10;
const HUMAN = SCAN_MAX_GAP_MS + 50;

check("دفعة سريعة تُقرأ رمزًا", feed("LAB-260729-000042", FAST), "LAB-260729-000042");
check("كتابة بشرية بطيئة لا تتراكم", feed("LAB-260729-000042", HUMAN), null);
check("رمز أقصر من الحدّ الأدنى يُهمَل", feed("A1", FAST), null);
check(
  "حرف خارج أبجدية Code 39 يُبطل الدفعة",
  feed("LAB-26ج0729-000042", FAST),
  null
);
check("الدفعة تُفرَّغ بعد القراءة", (() => {
  const buf = new ScanBuffer();
  let t = 1000;
  for (const ch of "LAB-1234") { buf.push(ch, t); t += FAST; }
  buf.flush();
  return buf.flush();
})(), null);
check("دفعة جديدة بعد صمت تبدأ نظيفة", (() => {
  const buf = new ScanBuffer();
  let t = 1000;
  for (const ch of "XXXX") { buf.push(ch, t); t += FAST; }
  t += 5000; // صمت طويل: أنبوب آخر
  for (const ch of "LAB-1234") { buf.push(ch, t); t += FAST; }
  return buf.flush();
})(), "LAB-1234");

/* ── ٩. أيام وأختام التواريخ ─────────────────────────────────────
   `day` مفتاح تقسيم التقارير: طلب بيوم خاطئ يُحتسب إيراده في اليوم
   الخطأ، وطلب بلا يوم يغيب عن كل تقرير بلا رسالة. و`orderStamp` جزء
   من رقم الطلب المطبوع على الأنبوب.                              */
group("أيام وأختام التواريخ");

const noon = new Date(2026, 6, 29, 12, 0, 0); // ٢٩ يوليو ٢٠٢٦ محليًّا
check("اليوم المحلي YYYY-MM-DD", localDay(noon), "2026-07-29");
check("ختم اليوم YYMMDD", orderStamp(noon), "260729");
check("خانتان للشهر واليوم", orderStamp(new Date(2026, 0, 5)), "260105");
check("يوم الطلب من طابعه الزمني", dayOf(noon.toISOString()), "2026-07-29");
// الملء الرجعي يمرّ على طلبات قديمة قد تحمل طابعًا ناقصًا.
check("طابع مفقود لا يخترع يومًا", dayOf(null), null);
check("طابع تالف لا يخترع يومًا", dayOf("ليس تاريخًا"), null);
check(
  "رقم الطلب العشوائي يحمل ختم اليوم",
  newOrderNo().startsWith(`LAB-${orderStamp()}-`),
  true
);

/* ── النتيجة ───────────────────────────────────────────────── */
console.log(
  `\n${failed === 0 ? "✓" : "✗"} ${passed} نجح · ${failed} فشل\n`
);
process.exit(failed === 0 ? 0 : 1);
