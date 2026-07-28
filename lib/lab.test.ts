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
  fmtDateTime,
  fmtMoney,
  newMrn,
  newOrderNo,
  pickRange,
  rangeLabel,
  verificationCode,
} from "./lab";
import { SEED_TESTS } from "./seedTests";

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

/* ── النتيجة ───────────────────────────────────────────────── */
console.log(
  `\n${failed === 0 ? "✓" : "✗"} ${passed} نجح · ${failed} فشل\n`
);
process.exit(failed === 0 ? 0 : 1);
