/**
 * منطق المختبر المشترك: المديات المرجعية، احتساب الأعلام (flags)،
 * توليد الأرقام، وتسميات الحالات بالعربية.
 */

export type Sex = "MALE" | "FEMALE";

export type Flag =
  | "NORMAL"
  | "LOW"
  | "HIGH"
  | "CRITICAL_LOW"
  | "CRITICAL_HIGH"
  | "ABNORMAL";

export type Range = {
  sex?: string | null;
  ageMinYears?: number | null;
  ageMaxYears?: number | null;
  low?: number | null;
  high?: number | null;
  text?: string | null;
};

/* ── العمر ─────────────────────────────────────────────────── */

/**
 * العمر بالسنوات.
 *
 * بفروق التقويم لا بالقسمة على ٣٦٥٫٢٥: القسمة كانت تعطي عمرًا أقلّ من
 * الحقيقي بنحو يوم في السنة (سنوات كبيسة)، فيقع من بلغ الخامسة عشرة
 * تحت عتبة `ageMaxYears: 15` في يوم ميلاده وما بعده بأيام، فيُختار له
 * **مدى الأطفال** ويُجمَّد في تقريره: كرياتينين ٠٫٩ لذكر في الخامسة
 * عشرة يُعلَّم «مرتفعًا» وهو طبيعي. أصاب هذا نحو ثلث تواريخ الميلاد عند
 * الحدّ.
 *
 * @param now يُحقن في الاختبارات كي تكون النتيجة ثابتة لا تعتمد على
 *   لحظة التشغيل — بلا ذلك لا يمكن اختبار حدود الأعمار أصلًا.
 */
export function ageInYears(
  birthDate?: string | null,
  now: Date = new Date()
): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime()) || Number.isNaN(now.getTime())) return null;

  let years = now.getFullYear() - b.getFullYear();
  const monthDiff = now.getMonth() - b.getMonth();
  const dayDiff = now.getDate() - b.getDate();
  // لم يحلّ يوم الميلاد بعد هذا العام.
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years -= 1;

  // تاريخ ميلاد مستقبلي = خطأ إدخال. `null` تجعل `pickRange` يتجاهل
  // العمر بدل أن يختار مدًى بعمر سالب، وتُظهر «—» للفنّي بدل «1 شهر».
  if (years < 0) return null;

  // الكسر داخل السنة الجارية — يلزم للمديات دون السنة (حديثو الولادة).
  const lastBirthday = new Date(b);
  lastBirthday.setFullYear(b.getFullYear() + years);
  const nextBirthday = new Date(b);
  nextBirthday.setFullYear(b.getFullYear() + years + 1);
  const span = nextBirthday.getTime() - lastBirthday.getTime();
  const into = now.getTime() - lastBirthday.getTime();
  return years + (span > 0 ? Math.max(0, Math.min(1, into / span)) : 0);
}

/** عمر الرضيع بالأشهر التقويمية الكاملة — لا بكسر السنة. */
export function ageInMonths(
  birthDate?: string | null,
  now: Date = new Date()
): number | null {
  if (ageInYears(birthDate, now) === null) return null;
  const b = new Date(birthDate as string);
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  return Math.max(0, months);
}

export function ageLabel(birthDate?: string | null, now: Date = new Date()): string {
  const y = ageInYears(birthDate, now);
  if (y === null) return "—";
  if (y < 1) {
    /* بالأشهر التقويمية لا بـ`y * 12`: الكسر يُحسب على طول السنة، وستة
       أشهر تبدأ بشهور قصيرة (يناير–يوليو) تعطي ٥٫٩٥ فتُعرض «٥ شهر».
       فرق شهر في عمر رضيع يقلب المدى المرجعي. */
    const months = ageInMonths(birthDate, now) ?? 0;
    // «أقل من شهر» أصدق من «١ شهر» لمولود عمره أيام.
    return months <= 0 ? "أقل من شهر" : `${months} شهر`;
  }
  return `${Math.floor(y)} سنة`;
}

/* ── اختيار المدى المرجعي المطابق للمريض ────────────────────── */

export function pickRange(
  ranges: readonly (Range | null | undefined)[] | null | undefined,
  sex?: Sex | null,
  age?: number | null
): Range | null {
  const list = (ranges ?? []).filter(Boolean) as Range[];
  if (!list.length) return null;

  const matches = list.filter((r) => {
    if (r.sex && sex && r.sex !== sex) return false;
    if (age !== null && age !== undefined) {
      if (r.ageMinYears != null && age < r.ageMinYears) return false;
      if (r.ageMaxYears != null && age >= r.ageMaxYears) return false;
    }
    return true;
  });

  if (!matches.length) return list[0];
  // الأكثر تخصيصًا أولًا.
  matches.sort((a, b) => specificity(b) - specificity(a));
  return matches[0];
}

/**
 * وزن العمر (٢) أعلى من وزن الجنس (١) — عن قصد.
 *
 * الفروق الفسيولوجية بين طفل وبالغ أكبر بكثير من الفروق بين ذكر وأنثى،
 * والفروق بين الجنسين لا تظهر أصلًا قبل البلوغ. حين كان وزن الجنس أعلى
 * كان مدى البالغين يهزم مدى الأطفال: طفل هيموغلوبينه ١٢ (طبيعي لعمره)
 * يُعلَّم «منخفض»، وطفل كرياتينينه ١.٠ (مرتفع فعليًا) يظهر «طبيعي».
 */
function specificity(r: Range): number {
  const byAge = r.ageMinYears != null || r.ageMaxYears != null ? 2 : 0;
  const bySex = r.sex ? 1 : 0;
  return byAge + bySex;
}

export function rangeLabel(
  low?: number | null,
  high?: number | null,
  text?: string | null
): string {
  if (text) return text;
  if (low != null && high != null) return `${low} – ${high}`;
  if (low != null) return `> ${low}`;
  if (high != null) return `< ${high}`;
  return "—";
}

/* ── احتساب العَلَم ────────────────────────────────────────── */

export function computeFlag(opts: {
  value: number | null;
  low?: number | null;
  high?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
}): Flag | null {
  const { value, low, high, criticalLow, criticalHigh } = opts;
  if (value === null || Number.isNaN(value)) return null;
  if (criticalLow != null && value <= criticalLow) return "CRITICAL_LOW";
  if (criticalHigh != null && value >= criticalHigh) return "CRITICAL_HIGH";
  if (low != null && value < low) return "LOW";
  if (high != null && value > high) return "HIGH";
  if (low == null && high == null) return null;
  return "NORMAL";
}

/* نتيجة نصية/اختيارية: أي شيء غير "سلبي/طبيعي" يُعلَّم كغير طبيعي.

   ⚠️ المطابقة **كاملة لا جزئية**. كانت `v.includes(w)` فكانت «غير طبيعي»
   تحوي «طبيعي» و«abnormal» تحوي «normal» فتُعلَّم كلتاهما NORMAL —
   مزرعة بول موجبة تخرج في تقرير المريض «طبيعية». وأخبث منهما نصّ يحوي
   نفيًا عرضيًّا مثل «نمو بكتيري كثيف، لا يوجد حساسية للسيفترياكسون»:
   يحوي «لا يوجد» فيُعلَّم طبيعيًّا وهو من أشدّ النتائج خطورة.

   ولأن الفنّي يكتب نصًّا حرًّا، المطابقة الكاملة وحدها لا تكفي: نطبّع
   المسافات وعلامات الترقيم أولًا، وأي نصّ لا يطابق قائمة الطبيعي
   بالكامل يُعلَّم ABNORMAL — الميل إلى «غير طبيعي» مقصود، فمراجعة
   نتيجة سليمة كلفتها دقيقة، وتمرير نتيجة مرضية كلفتها مريض.        */
const NORMAL_PHRASES = [
  "سلبي",
  "طبيعي",
  "لا يوجد",
  "لا يوجد نمو",
  "لا يوجد نمو بكتيري",
  "غير مصاب",
  "negative",
  "normal",
  "nil",
  "none",
  "no growth",
  "not detected",
];

/** توحيد النصّ قبل المقارنة: مسافات وترقيم وتشكيل ومحارف عربية متغيّرة. */
function normalizeResultText(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[ً-ْ]/g, "") // تشكيل
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[.,،؛;:!?"'()\[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMAL_SET = new Set(NORMAL_PHRASES.map(normalizeResultText));

export function computeTextFlag(value?: string | null): Flag | null {
  if (!value || !value.trim()) return null;
  return NORMAL_SET.has(normalizeResultText(value)) ? "NORMAL" : "ABNORMAL";
}

export const FLAG_META: Record<Flag, { label: string; short: string; tone: string }> = {
  NORMAL: { label: "طبيعي", short: "", tone: "ok" },
  LOW: { label: "منخفض", short: "↓ L", tone: "low" },
  HIGH: { label: "مرتفع", short: "↑ H", tone: "high" },
  CRITICAL_LOW: { label: "منخفض حرج", short: "↓↓ LL", tone: "critical" },
  CRITICAL_HIGH: { label: "مرتفع حرج", short: "↑↑ HH", tone: "critical" },
  ABNORMAL: { label: "غير طبيعي", short: "A", tone: "high" },
};

export function isCritical(flag?: Flag | string | null): boolean {
  return flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";
}

/* ── تسميات ────────────────────────────────────────────────── */

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  REGISTERED: { label: "مسجّل", tone: "muted" },
  COLLECTED: { label: "تم السحب", tone: "info" },
  IN_PROGRESS: { label: "قيد التحليل", tone: "info" },
  PENDING_REVIEW: { label: "بانتظار الاعتماد", tone: "warn" },
  APPROVED: { label: "معتمد", tone: "ok" },
  DELIVERED: { label: "مُسلّم", tone: "ok" },
  CANCELLED: { label: "ملغى", tone: "muted" },
};

export const DEPARTMENT_LABEL: Record<string, string> = {
  CHEMISTRY: "الكيمياء الحيوية",
  HEMATOLOGY: "أمراض الدم",
  IMMUNOLOGY: "المناعة والمصليات",
  HORMONES: "الهرمونات",
  MICROBIOLOGY: "الأحياء الدقيقة",
  URINALYSIS: "تحليل البول والبراز",
};

export const SEX_LABEL: Record<string, string> = {
  MALE: "ذكر",
  FEMALE: "أنثى",
};

export const PRIORITY_LABEL: Record<string, string> = {
  ROUTINE: "عادي",
  URGENT: "مستعجل",
};

/* ── أرقام وتواريخ ─────────────────────────────────────────── */

/**
 * أرقام عشوائية بجودة تشفيرية حين تتوفر (المتصفح والـ Node الحديث).
 * `Math.random` رديء التوزيع ومتوقَّع، ورقم الطلب يُطبع على الباركود
 * الملصق على الأنبوب — تصادمه يعني نسبة نتائج مريض إلى مريض آخر.
 */
function randomDigits(n: number): string {
  const g =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  let out = "";
  if (g?.getRandomValues) {
    const buf = new Uint32Array(n);
    g.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += String(buf[i] % 10);
    return out;
  }
  for (let i = 0; i < n; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

/**
 * تاريخ محلي بصيغة YYYY-MM-DD — مفتاح تقسيم الطلبات وسجل التدقيق.
 *
 * محلي لا UTC: مدير المختبر يسأل عن «ما جرى اليوم» بيومه هو، وسطر
 * أُدخل الساعة الثانية صباحًا بالرياض يظهر في يوم أمس لو حُسب بـ UTC.
 */
export function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * يوم إنشاء طلب قديم، مستخرجًا من طابعه الزمني — للملء الرجعي للحقل
 * `day`. يرجع `null` لطابع مفقود أو تالف بدل أن يخترع يومًا: طلب في
 * اليوم الخطأ يشوّه تقرير الإيراد أكثر من طلب خارج التقرير.
 */
export function dayOf(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : localDay(d);
}

/**
 * ختم اليوم (YYMMDD) بالتوقيت المحلي — مفتاح عدّاد أرقام الطلبات
 * والجزء الأوسط من رقم الطلب. محلي لا UTC: طلبان في ليلة واحدة يجب
 * أن يحملا ختم اليوم نفسه الذي يعرفه المختبر.
 */
export function orderStamp(d: Date = new Date()): string {
  return (
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * رقم طلب عشوائي — مسار احتياطي وحده.
 *
 * المصدر الأساسي للأرقام هو العدّاد التسلسلي الذرّي في دالة
 * `next-order-no` (يعطي LAB-260728-000042). هذا يُستعمل حين تتعذّر
 * الدالة، لأن تعذّر توليد رقم يعني توقّف استقبال المرضى.
 *
 * ٦ خانات = مليون احتمال في اليوم بدل ١٠٬٠٠٠، والتفرّد الفعلي مضمون
 * بفحص الرقم قبل الإنشاء في `reserveOrderNo` (lib/amplify.ts).
 *
 * مثال: LAB-260728-482913
 */
export function newOrderNo(): string {
  return `LAB-${orderStamp()}-${randomDigits(6)}`;
}

/** P-2607-482913 — يُتحقَّق من تفرّده في `reserveMrn`. */
export function newMrn(): string {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0");
  return `P-${stamp}-${randomDigits(6)}`;
}

/* ── رمز التحقق المطبوع على التقرير ────────────────────────────
   بصمة قصيرة (FNV-1a معدّلة) على الحقول التي تهمّ: رقم الطلب، رقم
   الملف، وقت الاعتماد، رقم المراجعة، وكل قيمة نتيجة. تغيير أي رقم
   في نسخة مطبوعة يجعل الرمز لا يطابق ما يعرضه النظام.

   ملاحظة: هذا كاشف تلاعب/خطأ نسخ، وليس توقيعًا رقميًا — من يملك
   الكود يستطيع إعادة احتسابه. للتوقيع الحقيقي يلزم مفتاح خادم.   */

export function verificationCode(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => (p == null ? "" : String(p))).join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  const raw = h1.toString(36).padStart(7, "0") + h2.toString(36).padStart(7, "0");
  return raw.toUpperCase().slice(0, 10);
}

/* ── اعتماد المديات المرجعية ────────────────────────────────────
   ISO 15189 يوجب أن يتحقّق المختبر من مدياته المرجعية وحدوده الحرجة وفق
   أجهزته وكواشفه ومجتمع مرضاه. المديات التي تصل مع بذرة الكتالوج
   تقريبيّة، وتعليم نتيجة «طبيعية» بمدى لم يراجعه أحد هو خطأ سريري
   صامت — لا يظهر كعطل بل كطمأنة في غير موضعها.                    */

/**
 * بصمة الأرقام السريرية لفحص: المديات والحدّان الحرجان.
 *
 * تُحفظ وقت الاعتماد ليسقط الاعتماد تلقائيًا إن غُيّرت الأرقام بعده —
 * وإلا صار الاعتماد ختمًا يُؤخذ مرة ثم تُبدَّل الأرقام تحته.
 *
 * ترتيب المديات لا يغيّر معناها السريري، فتُرتَّب نصوصها قبل البصم كي
 * لا يُسقط إعادةُ ترتيبٍ اعتمادًا صحيحًا.
 */
export function rangesFingerprint(opts: {
  ranges?: readonly (Range | null | undefined)[] | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
}): string {
  const rows = (opts.ranges ?? [])
    .filter(Boolean)
    .map((r) =>
      [r!.sex ?? "", r!.ageMinYears ?? "", r!.ageMaxYears ?? "", r!.low ?? "", r!.high ?? "", r!.text ?? ""].join(",")
    )
    .sort();
  return verificationCode([
    ...rows,
    `C:${opts.criticalLow ?? ""}`,
    `C:${opts.criticalHigh ?? ""}`,
  ]);
}

export type ApprovableTest = {
  ranges?: readonly (Range | null | undefined)[] | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  rangesApprovedAt?: string | null;
  rangesHash?: string | null;
};

/** هل مديات هذا الفحص معتمدة **وغير معدَّلة** بعد الاعتماد؟ */
export function isRangesApproved(t?: ApprovableTest | null): boolean {
  if (!t?.rangesApprovedAt) return false;
  return t.rangesHash === rangesFingerprint(t);
}

/** سبب عدم الاعتماد — للعرض بجانب الفحص. */
export function approvalState(
  t?: ApprovableTest | null
): "APPROVED" | "STALE" | "NEVER" {
  if (!t?.rangesApprovedAt) return "NEVER";
  return t.rangesHash === rangesFingerprint(t) ? "APPROVED" : "STALE";
}

export const APPROVAL_LABEL: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "معتمد", tone: "ok" },
  STALE: { label: "عُدِّل بعد الاعتماد", tone: "warn" },
  NEVER: { label: "غير معتمد", tone: "warn" },
};

/* لغة عربية بأرقام لاتينية: `-u-nu-latn` يمنع الأرقام الهندية (١٢٣).
   السبب عملي لا جمالي — أرقام الطلبات والملفات والنتائج المخبرية كلها
   لاتينية، وخلطها بأرقام هندية في نفس الصفّ يربك القراءة السريعة. */
const LOCALE = "ar-SA-u-nu-latn";

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(LOCALE, {
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(LOCALE, {
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/* ── العملة ────────────────────────────────────────────────────
   الرمز يأتي من إعدادات المختبر (`LabConfig`) لا من الكود، فالمختبر
   قد يعمل بريال أو دولار أو أي عملة. يُضبط مرة عند تحميل الإعدادات
   عبر `setCurrency`، ويبقى «ر.س» افتراضًا قبل وصولها.            */
export const DEFAULT_CURRENCY = "ر.س";

let currencySymbol = DEFAULT_CURRENCY;

export function setCurrency(symbol?: string | null): void {
  currencySymbol = symbol?.trim() || DEFAULT_CURRENCY;
}

export function getCurrency(): string {
  return currencySymbol;
}

export function fmtMoney(v?: number | null, symbol?: string): string {
  const unit = symbol?.trim() || currencySymbol;
  return `${(v ?? 0).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} ${unit}`;
}

/**
 * تقريب إلى خانتين عشريتين.
 *
 * جمع الفواصل العائمة يزحف: ٠٫١ + ٠٫٢ = ٠٫٣٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٤. عشر دفعات
 * صغيرة تترك «متبقّيًا» بكسر لا يراه المريض ولا يستطيع دفعه، فيبقى الطلب
 * غير مسدَّد إلى الأبد.
 */
export function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "نقدًا",
  CARD: "شبكة",
  TRANSFER: "تحويل",
  OTHER: "أخرى",
};

export type PaymentLike = {
  amount?: number | null;
  voidedAt?: string | null;
};

/** المقبوض فعلًا: مجموع الدفعات غير المبطَلة. */
export function sumPayments(
  rows: readonly (PaymentLike | null | undefined)[] | null | undefined
): number {
  const total = (rows ?? [])
    .filter((p): p is PaymentLike => !!p && !p.voidedAt)
    .reduce((n, p) => n + (p.amount ?? 0), 0);
  return roundMoney(total);
}

/** صافي الفاتورة بعد الخصم — لا يقلّ عن صفر مهما كان الخصم. */
export function orderNet(totalPrice?: number | null, discount?: number | null): number {
  return roundMoney(Math.max(0, (totalPrice ?? 0) - (discount ?? 0)));
}

/** المتبقّي على الطلب. */
export function orderDue(net: number, paid: number): number {
  return roundMoney(Math.max(0, net - paid));
}

export function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** زمن الإنجاز (Turn-Around Time) بالساعات */
export function tatHours(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 3600000;
}
