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

export function ageInYears(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const diff = Date.now() - b.getTime();
  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

export function ageLabel(birthDate?: string | null): string {
  const y = ageInYears(birthDate);
  if (y === null) return "—";
  if (y < 1) return `${Math.max(1, Math.round(y * 12))} شهر`;
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
  // الأكثر تخصيصًا أولًا: المطابق للجنس ثم المطابق للعمر
  matches.sort((a, b) => specificity(b) - specificity(a));
  return matches[0];
}

function specificity(r: Range): number {
  return (r.sex ? 2 : 0) + (r.ageMinYears != null || r.ageMaxYears != null ? 1 : 0);
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

/** نتيجة نصية/اختيارية: أي شيء غير "سلبي/طبيعي" يُعلَّم كغير طبيعي. */
const NORMAL_WORDS = ["سلبي", "طبيعي", "لا يوجد", "negative", "normal"];

export function computeTextFlag(value?: string | null): Flag | null {
  if (!value || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  return NORMAL_WORDS.some((w) => v.includes(w.toLowerCase()))
    ? "NORMAL"
    : "ABNORMAL";
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

const CODE_CHARS = "0123456789";

function randomDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

/** LAB-260727-4831 */
export function newOrderNo(): string {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  return `LAB-${stamp}-${randomDigits(4)}`;
}

/** P-25073-8419 */
export function newMrn(): string {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0");
  return `P-${stamp}-${randomDigits(4)}`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-EG", {
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
  return d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function fmtMoney(v?: number | null): string {
  return `${(v ?? 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ر.س`;
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
