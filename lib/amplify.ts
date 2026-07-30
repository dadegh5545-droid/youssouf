"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useEffect, useState } from "react";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";
import {
  localDay,
  newOrderNo as randomOrderNo,
  orderStamp,
  sumPayments,
} from "@/lib/lab";

Amplify.configure(outputs, { ssr: true });

/* ── وضع المصادقة ──────────────────────────────────────────────
   التطبيق مفتوح للزوار بلا تسجيل دخول: من لا يملك رمزًا مميّزًا
   يمرّ عبر دور IAM غير المُصادَق (`identityPool`) الذي تسمح له
   قاعدة `allow.guest()` في المخطط. ومن سجّل دخوله نُبقيه على
   `userPool` كي تبقى قواعد المجموعات (الأدوار) سارية عليه.

   وكيل (Proxy) لأن `generateClient` يثبّت وضع المصادقة وقت الإنشاء،
   بينما الوضع هنا يتغيّر عند الدخول والخروج.                    */
const clients = {
  identityPool: generateClient<Schema>({ authMode: "identityPool" }),
  userPool: generateClient<Schema>({ authMode: "userPool" }),
};

/* قراءة الجلسة غير متزامنة، والصفحات تُطلق استعلاماتها فور تركيبها. لولا
   هذا التلميح المحفوظ لانطلق أول استعلام لمستخدم مسجَّل بوضع الزائر —
   أي عبر دور IAM المُصادَق الذي لا يملك صلاحية على شيء، فيرى «غير مصرّح»
   في أول تحميل ثم تعمل الصفحة بعد تحديثها. */
const MODE_HINT = "lis.authMode";

let mode: keyof typeof clients =
  typeof window !== "undefined" && localStorage.getItem(MODE_HINT) === "userPool"
    ? "userPool"
    : "identityPool";

export const client = new Proxy(clients.identityPool, {
  get: (_target, prop) => Reflect.get(clients[mode], prop, clients[mode]),
});

async function syncAuthMode() {
  try {
    const session = await fetchAuthSession();
    mode = session.tokens?.accessToken ? "userPool" : "identityPool";
  } catch {
    mode = "identityPool";
  }
  if (mode === "userPool") localStorage.setItem(MODE_HINT, "userPool");
  else localStorage.removeItem(MODE_HINT);
}

if (typeof window !== "undefined") {
  void syncAuthMode();
  Hub.listen("auth", ({ payload }) => {
    if (
      payload.event === "signedIn" ||
      payload.event === "signedOut" ||
      payload.event === "tokenRefresh"
    ) {
      void syncAuthMode();
    }
  });
}

/* حقل `AWSJSON` يصل نصًا، وقد يصل نصًا داخل نص لأن الدالة تُرجع
   `JSON.stringify` ثم يغلّفه AppSync مرة أخرى. فكّ مرتين على الأكثر. */
export function parseJson<T>(raw: unknown): T | null {
  let value: unknown = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return (value ?? null) as T | null;
}

export type Role = "admin" | "quality" | "tech" | "reception" | "doctor";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "مدير المختبر",
  quality: "مسؤول الجودة",
  tech: "فني مختبر",
  reception: "استقبال",
  doctor: "طبيب",
};

export type Session = {
  loading: boolean;
  email: string;
  name: string;
  roles: Role[];
  /** زائر يتصفّح بلا تسجيل دخول */
  guest: boolean;
  /** الاسم الذي يُحفظ في الحقول وسجل التدقيق: البريد، أو «زائر» */
  actor: string;
  /** مستخدم مسجَّل لكن لم يُسنَد إلى أي مجموعة بعد */
  pending: boolean;
  /** صلاحية تنفيذ إجراء معيّن */
  can: (action: Action) => boolean;
};

/** اسم الزائر كما يُحفظ في الحقول والسجلات — لا بريد له. */
export const GUEST_LABEL = "زائر";

export type Action =
  | "managePatients"
  | "createOrder"
  | "collectSample"
  | "enterResults"
  | "approveResults"
  | "amendApproved"
  | "manageCatalog"
  | "viewFinance"
  | "manageStaff"
  | "viewAudit"
  | "viewReports";

const MATRIX: Record<Action, Role[]> = {
  managePatients: ["admin", "reception"],
  createOrder: ["admin", "reception"],
  collectSample: ["admin", "reception", "tech"],
  enterResults: ["admin", "tech", "quality"],
  approveResults: ["admin", "quality"],
  amendApproved: ["admin", "quality"],
  manageCatalog: ["admin"],
  viewFinance: ["admin", "reception"],
  // منح الصلاحيات صلاحية إدارية بامتياز: من يملكها يملك كل شيء بالتبعية.
  manageStaff: ["admin"],
  // سجل التدقيق أداة مراجعة: المدير ومسؤول الجودة، لا من يُراجَع عمله.
  viewAudit: ["admin", "quality"],
  // التقارير تكشف الإيراد، فهي لمن يراه أصلًا في الفواتير.
  viewReports: ["admin", "quality"],
};

/**
 * جلسة المستخدم الحالية مع أدواره من Cognito.
 * ملاحظة أمنية: هذا للتحكم في الواجهة فقط — التطبيق الفعلي للصلاحيات
 * يتم في قواعد authorization داخل amplify/data/resource.ts.
 */
export function useSession(): Session {
  const [state, setState] = useState<Omit<Session, "can" | "pending" | "actor">>({
    loading: true,
    email: "",
    name: "",
    roles: [],
    guest: true,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await fetchAuthSession();

        // لا رمز مميّز = زائر بلا حساب. ليس خطأً ولا حالة انتظار:
        // التطبيق مفتوح له، ويُسجَّل في البيانات باسم «زائر».
        if (!session.tokens?.accessToken) {
          if (alive)
            setState({
              loading: false,
              email: "",
              name: GUEST_LABEL,
              roles: [],
              guest: true,
            });
          return;
        }

        const payload = session.tokens.accessToken.payload as
          | Record<string, unknown>
          | undefined;
        const groups = (payload?.["cognito:groups"] as string[] | undefined) ?? [];
        let email = "";
        let name = "";
        try {
          const attrs = await fetchUserAttributes();
          email = attrs.email ?? "";
          name = attrs.name ?? attrs.email ?? "";
        } catch {
          /* المستخدم قد لا يملك صلاحية قراءة السمات */
        }
        if (!alive) return;
        setState({
          loading: false,
          email,
          name,
          roles: groups.filter((g): g is Role => g in ROLE_LABEL),
          guest: false,
        });
      } catch {
        if (alive)
          setState((s) => ({ ...s, loading: false, name: GUEST_LABEL, guest: true }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return {
    ...state,
    actor: state.email || (state.guest ? GUEST_LABEL : "unknown"),
    // مستخدم بلا مجموعة لا يملك شيئًا. كان يُعامل كـ«استقبال» افتراضيًا،
    // فتظهر له أزرار يرفضها الخادم برسالة GraphQL غامضة. الآن تُخفى
    // الأزرار وتظهر له لافتة تشرح أنه بانتظار تعيين صلاحية.
    // الزائر مستثنى: ليس بانتظار شيء — هذا وضعه الطبيعي.
    pending: !state.loading && !state.guest && state.roles.length === 0,
    // الزائر لا يملك أي إجراء: دوره البحث عن تقريره وقراءته فقط،
    // والخادم لا يمنحه إلا `read`.
    can: (action) =>
      !state.guest && state.roles.some((r) => MATRIX[action].includes(r)),
  };
}

/* ── ترقيم الصفحات ────────────────────────────────────────────
   DynamoDB يرجع صفحة واحدة بحد أقصى 1MB مهما كان `limit`، ويعيد
   `nextToken` لبقية النتائج. كل استدعاء `list()` بلا حلقة كان يعرض
   الصفحة الأولى فقط ويتجاهل الباقي بصمت — أي أن العدّادات والقوائم
   تصبح خاطئة بلا أي رسالة خطأ بمجرد نمو البيانات.                */

type Page<T> = {
  data: T[];
  nextToken?: string | null;
  errors?: readonly { message: string }[];
};

export async function listAll<T>(
  fetchPage: (nextToken?: string) => Promise<Page<T>>,
  max = 10000
): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  let guard = 0;
  do {
    const res = await fetchPage(token);
    if (res.errors?.length) throw new Error(res.errors[0].message);
    out.push(...(res.data ?? []));
    token = res.nextToken ?? undefined;
  } while (token && out.length < max && ++guard < 200);
  return out;
}

/* ── أرقام فريدة ───────────────────────────────────────────────
   رقم الطلب هو الرقم المطبوع على الباركود الملصق على الأنبوب، ورقم
   الملف هو هوية المريض في النظام. تكرار أيّهما يعني نسبة عيّنة أو
   نتيجة إلى الشخص الخطأ. الفهرس الثانوي ليس قيد تفرّد، لذلك نتحقق
   صراحةً قبل الإنشاء ونعيد التوليد عند التصادم.                  */

async function reserveUnique(
  generate: () => string | Promise<string>,
  exists: (candidate: string) => Promise<boolean>,
  what: string
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = await generate();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`تعذّر توليد ${what} فريد بعد ١٠ محاولات — أعد المحاولة.`);
}

/**
 * رقم الطلب التالي: العدّاد التسلسلي الذرّي أولًا (LAB-260728-000042).
 *
 * الرجوع إلى التوليد العشوائي عند تعذّر الدالة مقصود: عطلٌ في العدّاد
 * يجب أن يبطئ المختبر لا أن يوقف استقبال المرضى. والرقمان بالطول نفسه
 * فلا يتغيّر عرض الباركود ولا تخطيط الملصق أيًّا كان المصدر.
 *
 * ويبقى فحص الوجود فوق العدّاد رغم ذرّيته: طلبات اليوم القديمة وُلّدت
 * عشوائيًا وقد يصادف أحدها رقمًا تسلسليًا. الفحص يكشفه، والمحاولة
 * التالية تأخذ الرقم الذي يليه.
 */
export function nextOrderNo(): Promise<string> {
  return reserveOrderNo(async () => {
    try {
      const { data, errors } = await client.mutations.nextOrderNo({
        stamp: orderStamp(),
      });
      if (errors?.length) throw new Error(errors[0].message);
      const parsed = parseJson<{ orderNo?: string }>(data);
      if (!parsed?.orderNo) throw new Error("ردّ فارغ من عدّاد الأرقام");
      return parsed.orderNo;
    } catch (e) {
      console.warn("تعذّر العدّاد التسلسلي — رقم عشوائي بديل", e);
      return randomOrderNo();
    }
  });
}

/* غير مُصدَّرة: المدخل الوحيد لأرقام الطلبات هو `nextOrderNo` أعلاه.
   صفحة تولّد رقمًا بطريقتها تتخطّى العدّاد وتعيد نافذة السباق. */
function reserveOrderNo(generate: () => string | Promise<string>): Promise<string> {
  return reserveUnique(
    generate,
    async (orderNo) => {
      const { data, errors } = await client.models.Order.listOrdersByOrderNo(
        { orderNo },
        { limit: 1, selectionSet: ["id"] }
      );
      if (errors?.length) throw new Error(errors[0].message);
      return (data?.length ?? 0) > 0;
    },
    "رقم طلب"
  );
}

export function reserveMrn(generate: () => string): Promise<string> {
  return reserveUnique(
    generate,
    async (mrn) => {
      const { data, errors } = await client.models.Patient.listPatientsByMrn(
        { mrn },
        { limit: 1, selectionSet: ["id"] }
      );
      if (errors?.length) throw new Error(errors[0].message);
      return (data?.length ?? 0) > 0;
    },
    "رقم ملف"
  );
}

/* ── الدفعات ───────────────────────────────────────────────────
   سطور `Payment` هي مصدر الحقيقة، و`Order.paidAmount` نسخة مخبَّأة
   تُعاد من السطور بعد كل تغيير. ترتيب العمليات مقصود: يُكتب السطر أولًا
   ثم تُحدَّث النسخة — لو انقطع الاتصال بينهما بقي المال مسجَّلًا وتأخّرت
   النسخة، وتصلحها أول قراءة لصفحة الطلب. العكس يفقد المال.        */

export type Payment = Schema["Payment"]["type"];

/* ── فحص أخطاء الطفرات ─────────────────────────────────────────
   عميل Amplify v6 **لا يرمي** عند رفض الخادم: يعيد الأخطاء في
   `res.errors` ويكمل التنفيذ. فطفرة بلا فحص تُتبَع برسالة «تمّ» فوق عملية
   لم تقع — «أُلغي الطلب» والطلب قائم في قائمة العمل، و«سُجّل الإبلاغ»
   بلا تسجيل، واعتماد يُكتب فوق سطور لم تُختم. `must` تجعل الفحص سطرًا
   واحدًا فلا يُنسى.                                                */
export async function must<T>(
  op: Promise<{ data?: T | null; errors?: readonly { message: string }[] }>
): Promise<T | null | undefined> {
  const res = await op;
  if (res.errors?.length) throw new Error(res.errors[0].message);
  return res.data;
}

/** كل دفعات طلب، الأقدم أولًا. */
export function listPayments(orderId: string): Promise<Payment[]> {
  return listAll<Payment>((nextToken) =>
    client.models.Payment.listPaymentsByOrder({ orderId }, { limit: 200, nextToken })
  );
}

/**
 * يعيد احتساب `paidAmount` من السطور ويكتبه.
 *
 * @param cached القيمة المحفوظة على الطلب، أو `null` إذا كنّا قد غيّرنا
 *   السطور للتوّ. تمرير الرقم يجعل الكتابة مشروطة باختلافه عن المجموع،
 *   فلا تُحدَّث الطلبات بلا سبب في كل فتح لصفحة. و`null` يكتب دائمًا —
 *   بعد دفعة أو إبطال نعرف أن النسخة قديمة، ومقارنتها بصفر افتراضي كانت
 *   تُسكت الكتابة حين يعود المجموع إلى صفر بإبطال كل الدفعات.
 */
export async function syncPaidAmount(
  orderId: string,
  cached: number | null
): Promise<{
  paid: number;
  payments: Payment[];
  repaired: boolean;
  /** نسخة تحمل مبلغًا بلا سطور تفسّره — طلب أقدم من جدول الدفعات. */
  needsMigration: boolean;
}> {
  const payments = await listPayments(orderId);
  const paid = sumPayments(payments);

  /* الحارس الأهمّ في هذه الدالة: طلبات ما قبل جدول `Payment` تحمل
     `paidAmount` بلا أي سطر يفسّره. الكتابة العمياء كانت تصفّر مبلغًا
     مقبوضًا فعلًا **بلا سطر تدقيق وبلا رجعة** — ويُطالَب المريض بالدفع
     مرتين. المبلغ بلا سطور ليس خطأ نسخة بل بيانات تحتاج ترحيلًا. */
  const needsMigration = payments.length === 0 && (cached ?? 0) > 0.005;
  if (needsMigration) {
    return { paid: cached ?? 0, payments, repaired: false, needsMigration: true };
  }

  const repaired = cached === null || Math.abs(paid - cached) > 0.005;
  if (repaired) {
    const { errors } = await client.models.Order.update({ id: orderId, paidAmount: paid });
    if (errors?.length) throw new Error(errors[0].message);
  }
  return { paid, payments, repaired, needsMigration: false };
}

/**
 * تسجيل دفعة: سطر جديد ثم تحديث النسخة المخبَّأة.
 *
 * `synced: false` تعني أن **المال سُجّل** وتأخّرت النسخة وحدها. التمييز
 * ضروري: خطأ واحد لا يفرّق بين «لم يُكتب» و«كُتب ولم تُحدَّث النسخة»
 * كان يجعل الواجهة تدعو الموظف إلى تسجيل الدفعة ثانيةً — فيُقيَّد المبلغ
 * مرتين، ولا يبطله إلا المدير.
 */
export async function addPayment(input: {
  orderId: string;
  orderNo: string;
  amount: number;
  method: string;
  actor: string;
  note?: string;
  /* وقت القبض الحقيقي — للترحيل وحده. الدفعة الجارية تُترك بلا تمرير
     فتأخذ اللحظة الحالية. ترحيل رصيد قديم بيوم الترحيل كان يُظهر إيراد
     سنة كاملة في تحصيل يوم واحد. */
  at?: string;
}): Promise<{ paid: number; payments: Payment[]; synced: boolean }> {
  const when = input.at ? new Date(input.at) : new Date();
  const now = Number.isNaN(when.getTime()) ? new Date() : when;
  const { data, errors } = await client.models.Payment.create({
    orderId: input.orderId,
    orderNo: input.orderNo,
    amount: input.amount,
    method: input.method as Payment["method"],
    receivedBy: input.actor,
    note: input.note || undefined,
    at: now.toISOString(),
    // يوم القبض لا يوم الطلب: من دفع باقي حسابه بعد أسبوع يُحتسب ماله
    // في اليوم الذي قُبض فيه، وهو ما يطابق صندوق المحاسب.
    day: localDay(now),
  });
  if (errors?.length) throw new Error(errors[0].message);
  if (!data) throw new Error("لم تُسجَّل الدفعة");

  // من هنا فصاعدًا المال مسجَّل. أي فشل لاحق يخصّ النسخة المخبَّأة وحدها،
  // ولا يجوز أن يُقرأ على أنه فشل في تسجيل الدفعة.
  try {
    const { paid, payments } = await syncPaidAmount(input.orderId, null);
    return { paid, payments, synced: true };
  } catch {
    return { paid: 0, payments: [], synced: false };
  }
}

/** إبطال دفعة بسبب مكتوب — لا حذف: سطر مال يُمحى لا يُراجَع. */
export async function voidPayment(
  payment: Payment,
  reason: string,
  actor: string
): Promise<{ paid: number; payments: Payment[] }> {
  const { errors } = await client.models.Payment.update({
    id: payment.id,
    voidedAt: new Date().toISOString(),
    voidedBy: actor,
    voidReason: reason,
  });
  if (errors?.length) throw new Error(errors[0].message);
  return syncPaidAmount(payment.orderId, null);
}

/* ── العمليات الحسّاسة: على الخادم لا هنا ────────────────────────
   الاعتماد والمراجعة وسحب العيّنة وتقديم الحالة وسطر التدقيق كلها
   طفرات تنفّذها دالة `order-ops`. ما تكسبه على `Order.update` المباشرة:

   أ) **الهوية من الرمز لا من الحمولة.** `approvedBy` و`collectedBy`
      و`actor` تُشتقّ من رمز Cognito الموقَّع. قبل ذلك كانت تُرسل من هنا،
      فمن يستدعي الـ API مباشرةً يكتب اعتمادًا باسم زميله.
   ب) **الشروط على الخادم.** اكتمال النتائج ومبدأ أربع أعين والقيم الحرجة
      كانت حواجز في هذه الصفحة وحدها — والصفحة لا تحكم من يتخطّاها.
   ج) **الحالة محسوبة من المخزَّن** لا من مسودّة الشاشة.

   الدالة **لا ترمي** عند رفض العملية: تعيد `{status:"ERROR", message}`
   برسالة عربية جاهزة للعرض، لأن رفضًا مشروعًا («طلب ناقص لا يُعتمد») ليس
   خطأً في النظام. `serverOp` تحوّله إلى استثناء لتلتقطه الشاشة كبقيّة
   الأخطاء.                                                           */

async function serverOp<T extends Record<string, unknown>>(
  op: Promise<{ data?: unknown; errors?: readonly { message: string }[] }>
): Promise<T> {
  const res = await op;
  // رفض AppSync (صلاحية، حقل غير معروف) يأتي هنا لا في الحمولة.
  if (res.errors?.length) throw new Error(res.errors[0].message);
  const parsed = parseJson<{ status?: string; message?: string } & T>(res.data);
  if (!parsed) throw new Error("ردّ فارغ من الخادم — أعد المحاولة.");
  if (parsed.status !== "OK") throw new Error(parsed.message || "رفض الخادم العملية.");
  return parsed;
}

/** تسجيل سحب العيّنة — الوقت والساحب من الخادم. */
export function collectOrder(orderId: string) {
  return serverOp<{ collectedAt?: string; orderStatus?: string }>(
    client.mutations.collectOrder({ orderId, day: localDay(new Date()) })
  );
}

/**
 * تقديم حالة الطلب بعد حفظ نتائج.
 *
 * الحالة تُحسب في الخادم من الفحوص المخزَّنة (`IN_PROGRESS` أو
 * `PENDING_REVIEW`) ولا تُرسل من هنا: مسودّة الشاشة قد تخالف المخزَّن.
 */
export function progressOrder(orderId: string) {
  return serverOp<{ orderStatus?: string; filled?: number; total?: number }>(
    client.mutations.progressOrder({ orderId })
  );
}

/**
 * اعتماد النتائج.
 *
 * `ack` تأكيدان صريحان لحالتين يعترض عليهما الخادم: اعتماد نتيجة أدخلها
 * المعتمِد نفسه (للمدير وحده)، والاعتماد رغم قيمة حرجة لم يُسجَّل إبلاغ
 * الطبيب بها. بلا التأكيد يرفض الخادم — فالحاجز لم يعد في الشاشة.
 */
export function approveOrder(
  orderId: string,
  ack: { selfEntered?: boolean; criticals?: boolean } = {}
) {
  return serverOp<{
    approvedAt?: string;
    approvedBy?: string;
    count?: number;
    selfEntered?: number;
  }>(
    client.mutations.approveOrder({
      orderId,
      ackSelfEntered: !!ack.selfEntered,
      ackCriticals: !!ack.criticals,
      day: localDay(new Date()),
    })
  );
}

/** مراجعة مرقّمة لتقرير معتمد — بسبب مكتوب يُطبع على التقرير. */
export function amendOrder(orderId: string, reason: string) {
  return serverOp<{ reportRevision?: number; amendedBy?: string }>(
    client.mutations.amendOrder({ orderId, reason, day: localDay(new Date()) })
  );
}

/**
 * كتابة سطر في سجل التدقيق — لا يُفشل العملية الأصلية إذا تعذّر.
 *
 * لا `actor` هنا عن قصد: يشتقّه الخادم من رمز Cognito، وكذلك `at`. كان
 * يُرسَل من العميل، فمن يملك `create` على الجدول يدسّ سطرًا يشهد بما لم
 * يقع — ولأن لا أحد يملك `update`/`delete` عمدًا، السطر المدسوس لا
 * يُصحَّح أبدًا. الحمولة الآن تصف الحدث ولا تنسبه.
 *
 * و`day` يبقى من العميل: يوم المختبر المحلي، وLambda تعمل بتوقيت UTC.
 */
export async function audit(entry: {
  entity: string;
  entityId: string;
  action: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}) {
  try {
    const { errors } = await client.mutations.writeAudit({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      summary: entry.summary,
      before: entry.before ? JSON.stringify(entry.before) : undefined,
      after: entry.after ? JSON.stringify(entry.after) : undefined,
      day: localDay(new Date()),
    });
    if (errors?.length) throw new Error(errors[0].message);
  } catch (e) {
    console.warn("audit log failed", e);
  }
}
