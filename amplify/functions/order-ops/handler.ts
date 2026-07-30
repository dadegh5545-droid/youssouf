import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/* تهيئة يدوية بنفس سبب `get-my-report` و`next-order-no`: النسخة المثبّتة
   من `@aws-amplify/backend` (1.5.1) لا تصدّر `./function/runtime`، فلا يصل
   مخطّط النماذج إلى الدالة ولا يعمل `client.models`. الاستعلامات مكتوبة
   يدويًا أدناه، وبيانات الاعتماد من دور تنفيذ Lambda. */
Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT!,
        region: process.env.AWS_REGION!,
        defaultAuthMode: "iam",
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            sessionToken: process.env.AWS_SESSION_TOKEN!,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* بيانات الاعتماد من الدور، لا شيء يُمسح */
        },
      },
    },
  }
);

const client = generateClient();
const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

/* ── استعلامات مكتوبة يدويًا ───────────────────────────────────── */

const ORDER_FIELDS = `id orderNo status collectedAt approvedAt reportRevision`;

const GET_ORDER = /* GraphQL */ `
  query GetOrder($id: ID!) {
    getOrder(id: $id) { ${ORDER_FIELDS} }
  }
`;

/* الحقول المقروءة هي عين التحقّق: `valueNumeric`/`valueText` تجيب «هل
   للفحص نتيجة محفوظة»، و`enteredBy` تجيب «هل المعتمِد هو من أدخلها»،
   و`criticalPending` تجيب «هل بقيت قيمة حرجة بلا إبلاغ». */
const ITEMS_BY_ORDER = /* GraphQL */ `
  query ItemsByOrder($orderId: ID!, $nextToken: String) {
    listOrderItemsByOrder(orderId: $orderId, limit: 200, nextToken: $nextToken) {
      items {
        id testNameAr valueNumeric valueText flag enteredBy
        criticalNotifiedAt criticalPending
      }
      nextToken
    }
  }
`;

const UPDATE_ORDER = /* GraphQL */ `
  mutation UpdateOrder($input: UpdateOrderInput!) {
    updateOrder(input: $input) { id status }
  }
`;

const UPDATE_ITEM = /* GraphQL */ `
  mutation UpdateOrderItem($input: UpdateOrderItemInput!) {
    updateOrderItem(input: $input) { id }
  }
`;

const CREATE_AUDIT = /* GraphQL */ `
  mutation CreateAuditLog($input: CreateAuditLogInput!) {
    createAuditLog(input: $input) { id }
  }
`;

type Order = {
  id: string;
  orderNo: string;
  status: string;
  collectedAt?: string | null;
  approvedAt?: string | null;
  reportRevision?: number | null;
};

type Item = {
  id: string;
  testNameAr?: string | null;
  valueNumeric?: number | null;
  valueText?: string | null;
  flag?: string | null;
  enteredBy?: string | null;
  criticalNotifiedAt?: string | null;
  criticalPending?: string | null;
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  // استعلامات مكتوبة يدويًا، فأنواع المتغيّرات المولّدة لا تنطبق عليها.
  const res = (await client.graphql({ query, variables } as never)) as {
    data: T;
    errors?: { message: string }[];
  };
  if (res.errors?.length) throw new Error(res.errors[0].message);
  return res.data;
}

/* ── هوية المستدعي ────────────────────────────────────────────────
   الرمز الذي يرسله عميل Amplify في وضع `userPool` هو **رمز الوصول**
   (access token)، وحمولته لا تحمل البريد ولا الاسم — فيها `username`
   و`sub` و`cognito:groups` وحدها. لذلك يُقرأ البريد والاسم من Cognito
   بـ`AdminGetUser`.

   ولماذا البريد أصلًا: سطور سجل التدقيق و`enteredBy` القائمة كلها كُتبت
   بالبريد (`session.email`)، فلو كتب الخادم `username` لصار «من أدخل
   النتيجة» و«من اعتمدها» لا يُقارَنان، وانقطع سجل التدقيق عن تاريخه. */
/**
 * `identified` = قُرئت سمات الحساب من Cognito فعلًا، أي أن `actor` بريد
 * كسطور `enteredBy` المخزَّنة.
 *
 * ولماذا يُعلَن هذا صريحًا: تعذّر القراءة يُبقي العمل ماضيًا بـ`username`
 * (معرّف موقَّع من Cognito، لا مجهول ولا مُنتحَل) — وهو مقبول في سطر
 * تدقيق أو تسجيل سحب. لكن الاعتماد وحده **يقارن** هويّتين، ومقارنة
 * `username` ببريد لا تتطابق أبدًا، فيمرّ الاعتماد الذاتي بلا اعتراض. أي
 * أن تعذّر القراءة يفتح شرط أربع أعين لا يغلقه. لذلك يُرفض الاعتماد
 * صريحًا هناك بدل أن يسقط الشرط صامتًا.
 */
type Caller = {
  actor: string;
  display: string;
  groups: string[];
  identified: boolean;
};

/* الحاوية تُعاد بين الاستدعاءات، فالتخزين يوفّر نداء Cognito لكل عملية
   من الموظف نفسه. مفتاحه `username` وقيمته لا تتغيّر إلا بتغيير سمات
   الحساب — وحينها يكفي أن تُعاد الحاوية. */
const identityCache = new Map<string, { email: string; name: string }>();

async function resolveCaller(event: AppSyncEvent): Promise<Caller> {
  const identity = event.identity as Record<string, unknown> | undefined;
  if (!identity) return { actor: "", display: "", groups: [], identified: false };

  const claims = (identity.claims ?? {}) as Record<string, unknown>;
  const username =
    (identity.username as string) ||
    (claims["cognito:username"] as string) ||
    (claims.sub as string) ||
    "";
  if (!username) return { actor: "", display: "", groups: [], identified: false };

  const rawGroups = identity.groups ?? claims["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === "string")
    : [];

  let attrs = identityCache.get(username);
  if (!attrs) {
    try {
      const user = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      );
      const pick = (key: string) =>
        user.UserAttributes?.find((a) => a.Name === key)?.Value ?? "";
      attrs = { email: pick("email"), name: pick("name") };
      identityCache.set(username, attrs);
    } catch {
      /* الفشل **لا يُخزَّن**: عطل عابر في Cognito كان يسمّم الحاوية فتبقى
         كل العمليات بعده بهوية منقوصة حتى تُعاد. */
      attrs = { email: "", name: "" };
    }
  }

  const actor = attrs.email || username;
  return {
    actor,
    display: attrs.name || actor,
    groups,
    identified: attrs.email !== "",
  };
}

/* ── يوم المختبر المحلي ────────────────────────────────────────────
   يرسله العميل لنفس سبب `stamp` في `next-order-no`: Lambda تعمل بتوقيت
   UTC والمختبر بتوقيته، ولو حُسب هنا لظهرت أحداث ليلة واحدة في يومين.

   لكنه **مدخل من العميل**، فيُحصر في ±يوم من تاريخ UTC: أي منطقة زمنية
   على الأرض داخل هذا الحدّ، وما خرج عنه إمّا ساعة جهاز مضبوطة خطأً أو
   محاولة دسّ سطر تدقيق في قسم يومٍ بعيد لا يقرؤه أحد. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

function labDay(raw?: string | null): string {
  const utcDay = new Date().toISOString().slice(0, 10);
  const candidate = (raw ?? "").trim();
  if (!DAY.test(candidate)) return utcDay;
  const drift = Math.abs(
    Date.parse(`${candidate}T00:00:00Z`) - Date.parse(`${utcDay}T00:00:00Z`)
  );
  return Number.isFinite(drift) && drift <= ONE_DAY_MS ? candidate : utcDay;
}

/* ── مساعدات ──────────────────────────────────────────────────── */

/** الحالتان النهائيّتان: بعدهما لا يتغيّر التقرير إلا بمراجعة مرقّمة. */
const APPROVED_STATES = ["APPROVED", "DELIVERED"];

const isApproved = (status: string) => APPROVED_STATES.indexOf(status) >= 0;

/** «للفحص نتيجة محفوظة» — لا مسودّة على الشاشة بل صفٌّ في الجدول. */
const hasResult = (i: Item) =>
  i.valueNumeric != null || (i.valueText ?? "").trim() !== "";

const isCriticalFlag = (flag?: string | null) =>
  flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";

/** مقارنة هويّات: الفراغ لا يطابق شيئًا، فسطر بلا `enteredBy` لا يُعدّ ذاتيًّا. */
function samePerson(a?: string | null, b?: string | null): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

const ok = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: "OK", ...extra });

const fail = (message: string) => JSON.stringify({ status: "ERROR", message });

async function loadOrder(orderId?: string | null): Promise<Order | null> {
  const id = (orderId ?? "").trim();
  if (!id) return null;
  const { getOrder } = await gql<{ getOrder: Order | null }>(GET_ORDER, { id });
  return getOrder ?? null;
}

async function loadItems(orderId: string): Promise<Item[]> {
  const items: Item[] = [];
  let nextToken: string | null = null;
  let guard = 0;
  do {
    const page: {
      listOrderItemsByOrder: { items: Item[]; nextToken: string | null };
    } = await gql(ITEMS_BY_ORDER, { orderId, nextToken });
    items.push(...(page.listOrderItemsByOrder?.items ?? []));
    nextToken = page.listOrderItemsByOrder?.nextToken ?? null;
  } while (nextToken && ++guard < 50);
  return items;
}

/** كتابة على دفعات متزامنة: باقة كبيرة تُختم في ثوانٍ لا في دقيقة. */
async function inChunks<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

async function writeAudit(entry: {
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  day: string;
  summary?: string | null;
  before?: string | null;
  after?: string | null;
}): Promise<void> {
  await gql(CREATE_AUDIT, {
    input: {
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actor: entry.actor,
      summary: entry.summary || null,
      before: entry.before || null,
      after: entry.after || null,
      // مفتاحا الفهرس: `day` مفتاح التقسيم و`at` مفتاح الفرز.
      day: entry.day,
      /* الوقت من ساعة الخادم لا من العميل: سطر التدقيق شهادة، وساعة
         الجهاز الذي يشهد لا تُقبل منه. */
      at: new Date().toISOString(),
    },
  });
}

/* ── العمليات ─────────────────────────────────────────────────── */

type Args = {
  orderId?: string | null;
  reason?: string | null;
  day?: string | null;
  ackSelfEntered?: boolean | null;
  ackCriticals?: boolean | null;
  entity?: string | null;
  entityId?: string | null;
  action?: string | null;
  summary?: string | null;
  before?: string | null;
  after?: string | null;
};

type AppSyncEvent = {
  arguments?: Args;
  info?: { fieldName?: string };
  identity?: unknown;
};

/** سطر تدقيق بفاعل من الرمز لا من الحمولة. */
async function doWriteAudit(args: Args, caller: Caller, day: string): Promise<string> {
  const entity = (args.entity ?? "").trim();
  const entityId = (args.entityId ?? "").trim();
  const action = (args.action ?? "").trim();
  if (!entity || !entityId || !action) return fail("سطر تدقيق ناقص.");

  await writeAudit({
    entity,
    entityId,
    action,
    actor: caller.actor,
    day,
    summary: args.summary,
    before: args.before,
    after: args.after,
  });
  return ok();
}

/** تسجيل سحب العيّنة. */
async function doCollect(args: Args, caller: Caller, day: string): Promise<string> {
  const order = await loadOrder(args.orderId);
  if (!order) return fail("لم يُعثر على الطلب.");
  if (order.status === "CANCELLED") return fail("الطلب ملغى.");

  /* الحالة لا تُرجَع إلى الوراء: تسجيل سحب متأخّر يثبّت الوقت ولا يعيد
     طلبًا تقدّم عمله إلى `COLLECTED`. */
  const advance = order.status === "REGISTERED";
  const now = new Date().toISOString();

  await gql(UPDATE_ORDER, {
    input: {
      id: order.id,
      ...(advance ? { status: "COLLECTED" } : {}),
      collectedAt: now,
      collectedBy: caller.actor,
    },
  });
  await writeAudit({
    entity: "Order",
    entityId: order.id,
    action: "SAMPLE_COLLECTED",
    actor: caller.actor,
    day,
    summary: `سحب عيّنة الطلب ${order.orderNo}`,
  });

  return ok({ collectedAt: now, orderStatus: advance ? "COLLECTED" : order.status });
}

/**
 * تقديم حالة الطلب بعد حفظ نتائج — **محسوبة من المخزَّن**.
 *
 * الحالة كانت تُرسل من الشاشة (`allFilled` المشتقّ من المسودّة)، فطلب
 * تُركت فيه حقول فارغة ثم أُعيد تحميل الصفحة قد يُرسَل `PENDING_REVIEW`.
 * هنا تُعدّ الفحوص التي لها نتيجة محفوظة فعلًا.
 */
async function doProgress(args: Args): Promise<string> {
  const order = await loadOrder(args.orderId);
  if (!order) return fail("لم يُعثر على الطلب.");
  if (order.status === "CANCELLED") return fail("الطلب ملغى — لا تُحفظ نتائج عليه.");

  /* طلب معتمد لا تتغيّر حالته بحفظ نتيجة: التعديل بعد الاعتماد يمرّ
     بـ`amendOrder` فيرفع رقم المراجعة ويطلب سببًا مكتوبًا. */
  if (isApproved(order.status)) return ok({ orderStatus: order.status });

  const items = await loadItems(order.id);
  const filled = items.filter(hasResult).length;
  // لا نتيجة محفوظة بعد = الطلب حيث كان (`REGISTERED` أو `COLLECTED`).
  if (filled === 0) return ok({ orderStatus: order.status, filled, total: items.length });

  const next = filled === items.length ? "PENDING_REVIEW" : "IN_PROGRESS";
  if (next !== order.status) {
    await gql(UPDATE_ORDER, { input: { id: order.id, status: next } });
  }
  return ok({ orderStatus: next, filled, total: items.length });
}

/**
 * اعتماد النتائج.
 *
 * كل شرط هنا كان في الشاشة وحدها: الاكتمال، ومبدأ أربع أعين، والقيم
 * الحرجة. الشاشة تمنع الخطأ ولا تمنع من يتجاوزها.
 */
async function doApprove(args: Args, caller: Caller, day: string): Promise<string> {
  /* مبدأ أربع أعين مقارنة هويّتين: `enteredBy` المخزَّنة (بريد) بهوية
     المستدعي. فإن لم يُقرأ بريده هبط `actor` إلى `username`، ومقارنته
     ببريد لا تتطابق أبدًا — فيمرّ الاعتماد الذاتي كأن لا شرط. الرفض
     صريحًا أسلم من شرط يسقط صامتًا على تقرير طبي. */
  if (!caller.identified) {
    return fail(
      "تعذّرت قراءة بيانات حسابك من مجمّع المستخدمين — أعد المحاولة. لا يُعتمد طلب بهوية لا تُقارَن بمن أدخل النتائج."
    );
  }

  const order = await loadOrder(args.orderId);
  if (!order) return fail("لم يُعثر على الطلب.");
  if (order.status === "CANCELLED") return fail("الطلب ملغى — لا يُعتمد.");
  if (isApproved(order.status)) return fail("الطلب معتمد أصلًا.");

  const items = await loadItems(order.id);
  if (items.length === 0) return fail("لا فحوص في هذا الطلب.");

  const missing = items.filter((i) => !hasResult(i)).length;
  if (missing > 0) {
    return fail(`${missing} فحصًا بلا نتيجة محفوظة. لا يُعتمد طلب ناقص.`);
  }

  /* مبدأ أربع أعين: `enteredBy` المخزَّن يُقارن بهوية المستدعي من رمزه.
     المدير وحده يتجاوزه، وبتأكيد صريح، ويُكتب التجاوز في سطر التدقيق. */
  const self = items.filter((i) => samePerson(i.enteredBy, caller.actor)).length;
  if (self > 0) {
    if (caller.groups.indexOf("admin") < 0) {
      return fail(
        `لا يمكنك اعتماد ${self} نتيجة أدخلتَها بنفسك — المراجعة المستقلّة تقتضي أن يعتمدها شخص آخر.`
      );
    }
    if (!args.ackSelfEntered) {
      return fail("الاعتماد الذاتي يخالف المراجعة المستقلّة ويحتاج تأكيدًا صريحًا.");
    }
  }

  const pendingCriticals = items.filter(
    (i) => i.criticalPending === "YES" || (isCriticalFlag(i.flag) && !i.criticalNotifiedAt)
  ).length;
  if (pendingCriticals > 0 && !args.ackCriticals) {
    return fail(
      `${pendingCriticals} قيمة حرجة لم يُسجَّل إبلاغ الطبيب بها — الاعتماد يحتاج تأكيدًا.`
    );
  }

  const now = new Date().toISOString();
  await inChunks(items, 10, (i) =>
    gql(UPDATE_ITEM, { input: { id: i.id, verifiedBy: caller.actor, verifiedAt: now } })
  );
  await gql(UPDATE_ORDER, {
    input: {
      id: order.id,
      status: "APPROVED",
      approvedAt: now,
      /* الاسم المعروض من سمات Cognito — هو ما يُطبع على التقرير. لا
         يُقبل من العميل: من يرسل اسم المعتمِد يعتمد باسم غيره. */
      approvedBy: caller.display,
    },
  });
  await writeAudit({
    entity: "Order",
    entityId: order.id,
    action: "ORDER_APPROVED",
    actor: caller.actor,
    day,
    summary:
      `اعتماد الطلب ${order.orderNo} (${items.length} فحص)` +
      (self > 0
        ? ` — اعتماد ذاتي بصلاحية مدير لـ ${self} نتيجة أدخلها المعتمِد نفسه`
        : "") +
      (pendingCriticals > 0
        ? ` — رغم ${pendingCriticals} قيمة حرجة بلا إبلاغ مسجَّل`
        : ""),
  });

  return ok({
    approvedAt: now,
    approvedBy: caller.display,
    count: items.length,
    selfEntered: self,
  });
}

/** مراجعة مرقّمة لتقرير معتمد — بسبب مكتوب يُطبع على التقرير. */
async function doAmend(args: Args, caller: Caller, day: string): Promise<string> {
  const reason = (args.reason ?? "").trim();
  if (!reason) return fail("التعديل على تقرير معتمد يتطلّب ذكر السبب.");

  const order = await loadOrder(args.orderId);
  if (!order) return fail("لم يُعثر على الطلب.");
  if (!isApproved(order.status)) {
    return fail("هذا الطلب غير معتمد — لا مراجعة له.");
  }

  const rev = (order.reportRevision ?? 1) + 1;
  const now = new Date().toISOString();

  await gql(UPDATE_ORDER, {
    input: {
      id: order.id,
      reportRevision: rev,
      amendedAt: now,
      amendedBy: caller.display,
      amendReason: reason,
    },
  });
  await writeAudit({
    entity: "Order",
    entityId: order.id,
    action: "REPORT_AMENDED",
    actor: caller.actor,
    day,
    summary: `تعديل تقرير معتمد ${order.orderNo} — مراجعة ${rev}: ${reason}`,
  });

  return ok({ reportRevision: rev, amendedAt: now, amendedBy: caller.display });
}

/* ── المُوزِّع ─────────────────────────────────────────────────────
   دالة واحدة تخدم عدّة طفرات، فالتمييز بـ`info.fieldName`. الصلاحية
   لكل طفرة معلنة في المخطط، فيرفض AppSync الطلب قبل أن يبلغ الدالة —
   وما هنا تحقّق من صحة العملية لا من حقّ صاحبها فيها.               */
export const handler = async (event: AppSyncEvent): Promise<string> => {
  const field = event.info?.fieldName ?? "";
  const args = event.arguments ?? {};

  const caller = await resolveCaller(event);
  /* لا عملية بفاعل مجهول: سطر تدقيق بلا فاعل لا يشهد بشيء، واعتماد بلا
     معتمِد لا يصلح على تقرير طبي. */
  if (!caller.actor) {
    return fail("تعذّر تحديد هوية المستخدم — أعد تسجيل الدخول ثم حاول.");
  }

  const day = labDay(args.day);

  try {
    switch (field) {
      case "writeAudit":
        return await doWriteAudit(args, caller, day);
      case "collectOrder":
        return await doCollect(args, caller, day);
      case "progressOrder":
        return await doProgress(args);
      case "approveOrder":
        return await doApprove(args, caller, day);
      case "amendOrder":
        return await doAmend(args, caller, day);
      default:
        return fail("عملية غير معروفة.");
    }
  } catch (e) {
    /* رسالة الخطأ تعود إلى الشاشة كما هي: أخطاء AppSync هنا تخصّ صلاحية
       أو حقلًا، وإخفاؤها يترك الموظف أمام «تعذّرت العملية» بلا سبب. */
    return fail((e as Error).message || "خطأ غير متوقّع في الخادم.");
  }
};
