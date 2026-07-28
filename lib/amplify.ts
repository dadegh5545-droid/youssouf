"use client";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useEffect, useState } from "react";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";

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
  | "viewFinance";

const MATRIX: Record<Action, Role[]> = {
  managePatients: ["admin", "reception"],
  createOrder: ["admin", "reception"],
  collectSample: ["admin", "reception", "tech"],
  enterResults: ["admin", "tech", "quality"],
  approveResults: ["admin", "quality"],
  amendApproved: ["admin", "quality"],
  manageCatalog: ["admin"],
  viewFinance: ["admin", "reception"],
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
  generate: () => string,
  exists: (candidate: string) => Promise<boolean>,
  what: string
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generate();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`تعذّر توليد ${what} فريد بعد ١٠ محاولات — أعد المحاولة.`);
}

export function reserveOrderNo(generate: () => string): Promise<string> {
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

/** كتابة سطر في سجل التدقيق — لا يُفشل العملية الأصلية إذا تعذّر. */
export async function audit(entry: {
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await client.models.AuditLog.create({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actor: entry.actor || "unknown",
      summary: entry.summary,
      before: entry.before ? JSON.stringify(entry.before) : undefined,
      after: entry.after ? JSON.stringify(entry.after) : undefined,
    });
  } catch (e) {
    console.warn("audit log failed", e);
  }
}
