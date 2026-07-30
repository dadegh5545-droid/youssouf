"use client";

import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  addPayment,
  amendOrder,
  approveOrder,
  audit,
  client,
  collectOrder,
  listAll,
  must,
  progressOrder,
  syncPaidAmount,
  useSession,
  voidPayment,
  type Payment,
} from "@/lib/amplify";
import { actionLabel } from "@/lib/audit";
import { scanMatchesOrder } from "@/lib/scanner";
import ScanBox from "@/app/components/ScanBox";
import type { Schema } from "@/amplify/data/resource";
import {
  DEPARTMENT_LABEL,
  FLAG_META,
  PAYMENT_METHOD_LABEL,
  PRIORITY_LABEL,
  SEX_LABEL,
  STATUS_META,
  ageLabel,
  computeFlag,
  computeTextFlag,
  fmtDateTime,
  fmtMoney,
  isCritical,
  orderDue,
  orderNet,
  sumPayments,
  type Flag,
} from "@/lib/lab";

type Order = Schema["Order"]["type"];
type Patient = Schema["Patient"]["type"];
type Item = Schema["OrderItem"]["type"];
type Log = Schema["AuditLog"]["type"];

type Draft = { value: string; comment: string };

/* المعرّف يأتي من `?id=` لا من مقطع مسار ديناميكي، لأن التطبيق يُصدَّر
   كموقع ثابت (output: "export") ولا يستطيع Next توليد صفحة لكل طلب
   وقت البناء — الطلبات تُنشأ بعد النشر. الصفحة كلها عميلة أصلًا
   وتجلب بياناتها من AppSync، فلا خسارة وظيفية.                    */
export default function Page() {
  return (
    <Suspense fallback={<p className="muted">جارٍ التحميل…</p>}>
      <OrderPage />
    </Suspense>
  );
}

function OrderPage() {
  const params = useSearchParams();
  const orderId = params.get("id") ?? "";
  /* إنشاء الطلب نجح لكن تسجيل دفعته الأولى فشل: الطلب قائم والمال في
     الدرج بلا سطر. اللافتة تُظهر الخلل هنا حيث زرّ التسجيل، بدل أن
     يُلغى عمل صحيح أو يمرّ القبض بصمت. */
  const payFail = params.get("payfail") ?? "";
  const session = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  /* طلب أقدم من جدول الدفعات: يحمل مبلغًا بلا سطور تفسّره. */
  const [needsMigration, setNeedsMigration] = useState(false);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /* سجل الطلب: استعلام لكل سطر مسجَّل (الطلب نفسه + كل فحص فيه)، فلا
     يُحمَّل إلا بطلب صريح — فتح الطلب لإدخال نتيجة لا يستدعي تاريخه. */
  const [history, setHistory] = useState<Log[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  /* نتيجة مطابقة الأنبوب الممسوح بهذا الطلب. */
  const [tube, setTube] = useState<{
    code: string;
    ok: boolean;
    otherId?: string;
  } | null>(null);
  /* الرموز التي سُجّلت في سجل التدقيق — كي لا يكتب مسحٌ مكرَّر سطرًا جديدًا. */
  const loggedScans = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    /* التبديل إلى طلب آخر يبقي المكوّن حيًّا (نفس المسار، معامل مختلف).
       بلا هذين السطرين كانت الترويسة تعرض رقم الطلب الجديد فوق فحوصات
       الطلب السابق وحقول الإدخال فعّالة — وعند فشل الجلب تبقى كذلك بلا
       حدّ زمني، ولافتة مطابقة الأنبوب قد صُفّرت للتوّ. مسار مباشر لنسبة
       نتيجة إلى مريض خطأ. */
    setLoading(true);
    setItems([]);

    const { data: o } = await client.models.Order.get({ id: orderId });
    if (!o) {
      setLoading(false);
      return;
    }
    const [{ data: p }, its] = await Promise.all([
      client.models.Patient.get({ id: o.patientId }),
      // استعلام مفهرس على orderId. البديل السابق كان
      // `list({ filter: { orderId } })` وهو Scan للجدول كله يُطبَّق عليه
      // الفلتر بعد المسح — فتُفتح الطلبات فارغة بمجرد تجاوز الجدول صفحة.
      listAll<Item>((nextToken) =>
        client.models.OrderItem.listOrderItemsByOrder(
          { orderId: o.id },
          { limit: 200, nextToken }
        )
      ),
    ]);
    /* الحالات كلها في دفعة واحدة بعد اكتمال الجلب: الترتيب هنا يمنع أي
       لحظة تكون فيها الترويسة لطلب والفحوصات لطلب آخر. */
    setOrder(o);
    setPatient(p ?? null);
    const sorted = [...its].sort(
      (a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100)
    );
    setItems(sorted);
    setDraft(
      Object.fromEntries(
        sorted.map((i) => [
          i.id,
          {
            value:
              i.valueNumeric != null
                ? String(i.valueNumeric)
                : i.valueText ?? "",
            comment: i.comment ?? "",
          },
        ])
      )
    );
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    load().catch((e) => {
      setMsg(String(e));
      setLoading(false);
    });
  }, [load]);

  /* الانتقال إلى طلب آخر يبقي المكوّن نفسه حيًّا (نفس المسار، معامل مختلف).
     بلا هذا التصفير تبقى لافتة «الأنبوب مطابق» معروضة فوق طلب لم يُمسح. */
  useEffect(() => {
    setTube(null);
    setPayments([]);
    loggedScans.current = new Set();
  }, [orderId]);

  /**
   * سجل الدفعات — مصدر الحقيقة في المال، و`paidAmount` نسخة مخبَّأة منه.
   *
   * يُقرأ في تأثير مستقلّ لا داخل `load`: صلاحية رؤية المال تصل بعد
   * الجلسة، وربطها بـ`load` كان يعيد تحميل الطلب وفحوصاته كلها مرة
   * ثانية بلا سبب حين تصل.
   *
   * `syncPaidAmount` تصلح النسخة إن خالفت السطور — وهو ما يشفي انقطاعًا
   * وقع بين كتابة سطر الدفعة وتحديث النسخة.
   */
  const canSeeMoney = session.can("viewFinance");

  /* النسخة المحفوظة تُمرَّر كي تكون الكتابة مشروطة باختلافها عن مجموع
     السطور — بلا تمريرها يُكتب الطلب في كل فتح لصفحته بلا سبب. لذلك
     ننتظر تحميل الطلب أولًا (`null` = لم يصل بعد). */
  const cachedPaid = order?.id === orderId ? order.paidAmount ?? 0 : null;

  const loadPayments = useCallback(async () => {
    if (!orderId || !canSeeMoney || cachedPaid === null) return;
    const synced = await syncPaidAmount(orderId, cachedPaid);
    setPayments(synced.payments);
    setNeedsMigration(synced.needsMigration);
    if (synced.repaired) {
      setOrder((cur) => (cur && cur.id === orderId ? { ...cur, paidAmount: synced.paid } : cur));
    }
  }, [orderId, canSeeMoney, cachedPaid]);

  useEffect(() => {
    loadPayments().catch((e) => console.warn("تعذّر قراءة سجل الدفعات", e));
  }, [loadPayments]);

  /** العَلَم المحسوب لحظيًا من القيمة المكتوبة (قبل الحفظ). */
  const flagOf = useCallback(
    (item: Item): Flag | null => {
      const raw = draft[item.id]?.value ?? "";
      if (!raw.trim()) return null;
      if (item.resultType === "NUMERIC") {
        const n = Number(raw);
        if (Number.isNaN(n)) return null;
        return computeFlag({
          value: n,
          low: item.refLow,
          high: item.refHigh,
          criticalLow: item.criticalLow,
          criticalHigh: item.criticalHigh,
        });
      }
      return computeTextFlag(raw);
    },
    [draft]
  );

  /** القيمة المخزَّنة فعلًا على الخادم — لا ما في الحقل. */
  const storedValue = (i: Item) =>
    i.valueNumeric != null ? String(i.valueNumeric) : i.valueText ?? "";

  /* التقدّم من المسودّة (ما يراه الفنّي وهو يكتب)، والاعتماد من المخزَّن.
     كان الاثنان من المسودّة، فيتفعّل زرّ «اعتماد النتائج» بقيم لم تُكتب
     بعد: و`approve()` لا يكتب أي قيمة — يختم السطور ويرفع الحالة إلى
     APPROVED ثم يعيد التحميل فتُمسح القيم من الشاشة بلا إنذار. النتيجة
     تقرير معتمد وموقَّع بلا نتائج.

     والأخبث: مسؤول جودة يصحّح قيمة ثم يضغط «اعتماد» بدل «حفظ» (الزرّان
     متجاوران) فيُعتمد الطلب بالقيمة القديمة وتضيع التصحيحة صامتة —
     وحارس «أربع أعين» لا يعترض لأن `enteredBy` ما زال فارغًا. */
  const filledCount = items.filter((i) => (draft[i.id]?.value ?? "").trim()).length;
  const savedCount = items.filter((i) => storedValue(i).trim()).length;
  const allSaved = items.length > 0 && savedCount === items.length;

  /** مسودّة فيها تعديل لم يُحفظ. */
  const dirty = items.some((i) => {
    const d = draft[i.id];
    if (!d) return false;
    return d.value.trim() !== storedValue(i).trim() || d.comment !== (i.comment ?? "");
  });

  const allFilled = items.length > 0 && filledCount === items.length;
  const criticals = items.filter((i) => isCritical(flagOf(i)));

  /* المال: الصافي من الطلب، والمقبوض من سجل الدفعات لا من النسخة
     المخبَّأة. من لا يملك رؤية المال لا يقرأ السجل أصلًا، فتبقى له
     النسخة — وهو لا يرى بطاقة الفاتورة على أي حال. */
  const net = orderNet(order?.totalPrice, order?.discount);
  /* الطلب الذي يحتاج ترحيلًا يُقرأ من النسخة لا من السجل الفارغ: صفرٌ
     هنا يعني مطالبة المريض بمبلغ دفعه فعلًا. */
  const paid =
    canSeeMoney && !needsMigration ? sumPayments(payments) : order?.paidAmount ?? 0;
  const due = orderDue(net, paid);

  const approved = order?.status === "APPROVED" || order?.status === "DELIVERED";
  const cancelled = order?.status === "CANCELLED";
  const delivered = order?.status === "DELIVERED";

  const canEnter =
    session.can("enterResults") &&
    !cancelled &&
    (!approved || session.can("amendApproved"));
  const canApprove = session.can("approveResults") && !cancelled;
  const canManageOrder = session.can("createOrder");

  /* مبدأ «أربع أعين» (ISO 15189): من أدخل النتيجة لا يعتمدها بنفسه.
     `quality` موجود في enterResults و approveResults معًا، فبلا هذا
     الفحص يستطيع شخص واحد إدخال نتيجة واعتمادها دون أي مراجعة.     */
  const selfEntered = items.filter(
    (i) => i.enteredBy && session.actor && i.enteredBy === session.actor
  );
  const isAdmin = session.roles.includes("admin");

  const grouped = useMemo<[string, Item[]][]>(() => {
    const map = new Map<string, Item[]>();
    items.forEach((i) => {
      const key = i.department ?? "OTHER";
      map.set(key, [...(map.get(key) ?? []), i]);
    });
    return Array.from(map.entries());
  }, [items]);

  async function saveResults() {
    if (!order) return;

    // تعديل تقرير معتمد يستوجب سببًا مكتوبًا — يُطبع على التقرير المصحّح
    // ويُحفظ في سجل التدقيق.
    let reason = "";
    if (approved) {
      const entered = window.prompt(
        "هذا التقرير معتمد ومسلَّم للمريض غالبًا.\nاكتب سبب التعديل (يظهر في التقرير المصحّح وسجل التدقيق):"
      );
      if (entered === null) return;
      if (!entered.trim()) {
        setMsg("التعديل على تقرير معتمد يتطلّب ذكر السبب.");
        return;
      }
      reason = entered.trim();
    }

    setBusy(true);
    setMsg("");
    try {
      const now = new Date().toISOString();
      let changed = 0;

      for (const item of items) {
        const d = draft[item.id];
        if (!d) continue;
        const raw = d.value.trim();
        const numeric = item.resultType === "NUMERIC" ? Number(raw) : null;
        const prevValue =
          item.valueNumeric != null ? String(item.valueNumeric) : item.valueText ?? "";
        const unchanged = prevValue === raw && (item.comment ?? "") === d.comment;
        if (unchanged) continue;
        if (raw && item.resultType === "NUMERIC" && Number.isNaN(numeric)) {
          throw new Error(`قيمة غير رقمية في فحص ${item.testNameAr}`);
        }

        const flag = flagOf(item);
        const { errors } = await client.models.OrderItem.update({
          id: item.id,
          valueNumeric: raw && item.resultType === "NUMERIC" ? numeric : null,
          valueText: raw && item.resultType !== "NUMERIC" ? raw : null,
          flag: flag ?? null,
          comment: d.comment || null,
          enteredBy: session.actor,
          enteredAt: now,
          // الفهرس المتفرّق لتنبيه القيم الحرجة في لوحة اليوم
          criticalPending:
            isCritical(flag) && !item.criticalNotifiedAt ? "YES" : null,
        });
        if (errors?.length) throw new Error(errors[0].message);
        changed++;

        await audit({
          entity: "OrderItem",
          entityId: item.id,
          action: approved ? "RESULT_AMENDED" : "RESULT_ENTERED",
          summary: `${item.testNameAr}: ${prevValue || "—"} ← ${raw || "—"}${
            reason ? ` (سبب التعديل: ${reason})` : ""
          }`,
          before: { value: prevValue, flag: item.flag },
          after: { value: raw, flag },
        });
      }

      if (changed === 0) {
        setMsg("لا توجد تغييرات لحفظها.");
        return;
      }

      /* رقم المراجعة وحالة الطلب كلاهما على الخادم الآن: الأول يحمل اسم
         المعدِّل من رمزه، والثانية محسوبة من الفحوص المخزَّنة لا من
         `allFilled` المشتقّ من مسودّة هذه الشاشة. */
      if (approved) {
        const { reportRevision: rev } = await amendOrder(order.id, reason);
        setMsg(`حُفظت ${changed} نتيجة. صدرت مراجعة رقم ${rev} من التقرير.`);
      } else {
        const { orderStatus } = await progressOrder(order.id);
        setMsg(
          `حُفظت ${changed} نتيجة.${
            orderStatus === "PENDING_REVIEW" ? " الطلب الآن بانتظار الاعتماد." : ""
          }`
        );
      }

      await load();
    } catch (e) {
      setMsg(`تعذّر الحفظ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function markCollected() {
    if (!order) return;
    setBusy(true);
    try {
      /* على الخادم: اسم الساحب من رمزه، والحالة لا تُرجَع إلى الوراء إن
         كان العمل قد تقدّم (تسجيل سحب متأخّر يثبّت الوقت لا أكثر).
         وبها يعمل الفنّي أيضًا — لا يملك `update` على `Order`. */
      await collectOrder(order.id);
      await load();
    } catch (e) {
      setMsg(`تعذّرت العملية: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!order) return;

    // حارسان قبل أي شيء: لا اعتماد فوق مسودّة غير محفوظة، ولا اعتماد
    // لطلب سطوره ناقصة في المخزَّن مهما بدا مكتملًا على الشاشة.
    if (dirty) {
      setMsg(
        "لديك تعديلات غير محفوظة. احفظ النتائج أولًا ثم اعتمد — الاعتماد لا يحفظ ما في الحقول."
      );
      return;
    }
    if (!allSaved) {
      setMsg(
        `${items.length - savedCount} فحصًا بلا نتيجة محفوظة. لا يُعتمد طلب ناقص.`
      );
      return;
    }

    if (selfEntered.length > 0) {
      if (!isAdmin) {
        setMsg(
          `لا يمكنك اعتماد نتائج أدخلتَها بنفسك (${selfEntered.length} فحص). ` +
            "يجب أن يعتمدها شخص آخر — هذا شرط مراجعة مستقلّة."
        );
        return;
      }
      const ok = window.confirm(
        `أنت من أدخل ${selfEntered.length} من هذه النتائج.\n` +
          "الاعتماد الذاتي يخالف مبدأ المراجعة المستقلّة وسيُسجَّل صراحةً في سجل التدقيق.\n\n" +
          "هل تريد المتابعة كمدير؟"
      );
      if (!ok) return;
    }

    const pending = criticals.filter((c) => !c.criticalNotifiedAt);
    if (pending.length > 0) {
      const ok = window.confirm(
        `يوجد ${pending.length} قيمة حرجة لم يُسجَّل إبلاغ الطبيب بها. هل تريد الاعتماد رغم ذلك؟`
      );
      if (!ok) return;
    }

    setBusy(true);
    setMsg("");
    try {
      /* الاعتماد كله على الخادم: يعيد فحص الشروط الثلاثة من المخزَّن،
         ويختم كل سطر نتيجة، ويكتب `approvedBy` من رمز المعتمِد لا من
         حمولة الطلب. والحواجز أعلاه تنبيه للموظف لا حماية — والتأكيدان
         يُمرَّران ليعرف الخادم أنه رأى التنبيه ووافق عليه. */
      await approveOrder(order.id, {
        selfEntered: selfEntered.length > 0,
        criticals: pending.length > 0,
      });
      setMsg("تم اعتماد النتائج — التقرير جاهز للطباعة.");
      await load();
    } catch (e) {
      setMsg(`تعذّر الاعتماد: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function markDelivered() {
    if (!order) return;
    const who = window.prompt(
      "اسم من استلم التقرير (المريض أو مندوبه):",
      patient?.fullName ?? ""
    );
    if (who === null) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await must(
        client.models.Order.update({
          id: order.id,
          status: "DELIVERED",
          deliveredAt: now,
          deliveredBy: session.actor,
          deliveredTo: who.trim() || null,
        })
      );
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "REPORT_DELIVERED",
        summary: `تسليم تقرير ${order.orderNo} إلى ${who.trim() || "—"}`,
      });
      setMsg("سُجّل تسليم التقرير.");
      await load();
    } catch (e) {
      setMsg(`تعذّر التسجيل: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * تسجيل دفعة على الطلب.
   *
   * سطر مستقلّ في `Payment` لا زيادة على `paidAmount`: الزيادة كانت
   * قراءة ثم كتابة بلا قفل، فدفعتان في اللحظة نفسها تُبقي إحداهما وتمحو
   * الأخرى — مالٌ قُبض من المريض واختفى. السطور لا تتصادم.
   */
  async function recordPayment(method: string) {
    if (!order) return;
    if (due <= 0) {
      setMsg("لا متبقّي على هذا الطلب.");
      return;
    }
    const raw = window.prompt(
      `الصافي ${fmtMoney(net)} · المدفوع ${fmtMoney(paid)} · المتبقّي ${fmtMoney(due)}.` +
        `\nطريقة الدفع: ${PAYMENT_METHOD_LABEL[method] ?? method}` +
        `\n\nاكتب المبلغ المدفوع الآن:`,
      String(due)
    );
    if (raw === null) return;

    const amount = Number(raw.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("مبلغ غير صالح.");
      return;
    }
    // الزيادة على المتبقّي تُرفض: فائض في حساب المريض لا مكان له في هذا
    // النموذج، وتسجيله يجعل تقرير التحصيل يعدّ مالًا لا يقابله فاتورة.
    if (amount > due + 0.005) {
      setMsg(`المبلغ أكبر من المتبقّي (${fmtMoney(due)}). سجّل ${fmtMoney(due)} أو أقل.`);
      return;
    }

    setBusy(true);
    try {
      const res = await addPayment({
        orderId: order.id,
        orderNo: order.orderNo,
        amount,
        method,
        actor: session.actor,
      });

      /* المال سُجّل لكن النسخة لم تُحدَّث: لا نعرض فشلًا ولا ندعو إلى
         إعادة التسجيل — إعادتها تُقيّد المبلغ مرتين ولا يبطله إلا المدير.
         نعيد قراءة السجل، فإن تعذّرت أيضًا نطلب تحديث الصفحة. */
      if (!res.synced) {
        setMsg(
          `سُجّلت دفعة ${fmtMoney(amount)} — لكن تعذّر تحديث ملخّص الفاتورة. ` +
            "المبلغ مقيَّد في سجل الدفعات؛ حدّث الصفحة ولا تسجّله ثانيةً."
        );
        await loadPayments().catch(() => {});
        return;
      }

      setPayments(res.payments);
      setOrder((cur) => (cur ? { ...cur, paidAmount: res.paid } : cur));
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "PAYMENT_RECORDED",
        summary:
          `دفعة ${fmtMoney(amount)} (${PAYMENT_METHOD_LABEL[method] ?? method}) ` +
          `على الطلب ${order.orderNo} — المتبقّي ${fmtMoney(orderDue(net, res.paid))}`,
        after: { amount, method, paid: res.paid },
      });
      setMsg(`سُجّلت دفعة ${fmtMoney(amount)}.`);
    } catch (e) {
      setMsg(`تعذّر تسجيل الدفعة: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * إبطال دفعة — لا حذف.
   *
   * سطر مال يُمحى لا يُراجَع: من أراد إخفاء قبض لا يظهر أثره في نظام
   * يسمح بالحذف. الإبطال يترك السطر ظاهرًا مشطوبًا بسببه واسم مُبطِله،
   * وهو لمجموعة `admin` وحدها في قواعد المخطط — من يقبض لا يبطل قبضه.
   */
  async function undoPayment(p: Payment) {
    if (!order) return;
    const reason = window.prompt(
      `إبطال دفعة ${fmtMoney(p.amount)} المسجَّلة في ${fmtDateTime(p.at)}.\n` +
        "اكتب السبب (خطأ إدخال، دفعة مكرّرة، ارتجاع…):"
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg("الإبطال يتطلّب ذكر السبب.");
      return;
    }
    setBusy(true);
    try {
      const res = await voidPayment(p, reason.trim(), session.actor);
      setPayments(res.payments);
      setOrder((cur) => (cur ? { ...cur, paidAmount: res.paid } : cur));
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "PAYMENT_VOIDED",
        summary: `إبطال دفعة ${fmtMoney(p.amount)} على الطلب ${order.orderNo}: ${reason.trim()}`,
        before: { amount: p.amount, at: p.at, receivedBy: p.receivedBy },
      });
      setMsg(`أُبطلت دفعة ${fmtMoney(p.amount)}.`);
    } catch (e) {
      setMsg(`تعذّر الإبطال: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * سجل هذا الطلب: من فعل ماذا ومتى، مرتّبًا من الأحدث.
   *
   * الأحداث موزّعة على معرّفين: ما يخصّ الطلب (إنشاء · سحب · اعتماد ·
   * دفعة · إلغاء) تحت معرّف الطلب، وما يخصّ نتيجةً بعينها تحت معرّف
   * الفحص. فتُقرأ كلها عبر فهرس `entityId` — استعلام لكل معرّف، لا مسح
   * للجدول ولا فلترة سجل اليوم كله في المتصفّح.
   */
  async function loadHistory() {
    if (!order) return;
    setHistoryBusy(true);
    try {
      const ids = [order.id, ...items.map((i) => i.id)];
      const pages = await Promise.all(
        ids.map((entityId) =>
          listAll<Log>((nextToken) =>
            client.models.AuditLog.listAuditByEntity(
              { entityId },
              { limit: 100, sortDirection: "DESC", nextToken }
            )
          )
        )
      );
      const rows = pages
        .flat()
        .sort((a, b) =>
          String(b.at ?? b.createdAt).localeCompare(String(a.at ?? a.createdAt))
        );
      setHistory(rows);
    } catch (e) {
      setMsg(`تعذّر جلب سجل الطلب: ${(e as Error).message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;

    /* مال مقبوض على طلب يُلغى: القرار المالي يجب أن يُتَّخذ صراحةً هنا،
       لا أن يُترك معلّقًا. كان الإلغاء يمرّ صامتًا ولا يذكر المبلغ في سطر
       التدقيق، وزرّ إبطال الدفعة يختفي بعد الإلغاء — فيبقى المال مقبوضًا
       بلا أثر ولا آلية تصحيح. */
    if (paid > 0) {
      const ok = window.confirm(
        `على هذا الطلب مبلغ مقبوض: ${fmtMoney(paid)}.\n\n` +
          "الإلغاء لا يُعيد المال ولا يبطل دفعاته تلقائيًّا. " +
          "بعد الإلغاء يبقى سجل الدفعات ظاهرًا، ويستطيع مدير المختبر إبطال " +
          "دفعة بسبب مكتوب إن رُدَّ المبلغ للمريض.\n\n" +
          "هل تريد المتابعة؟"
      );
      if (!ok) return;
    }

    const reason = window.prompt(
      `إلغاء الطلب ${order.orderNo}.\nاكتب السبب (عيّنة غير صالحة، طلب مكرّر، انسحاب المريض…):`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg("الإلغاء يتطلّب ذكر السبب.");
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const { errors } = await client.models.Order.update({
        id: order.id,
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: session.actor,
        cancelReason: reason.trim(),
      });
      if (errors?.length) throw new Error(errors[0].message);
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CANCELLED",
        // المبلغ في السطر نفسه: مراجعة الصندوق تبحث عن الملغى بمال.
        summary:
          `إلغاء الطلب ${order.orderNo}: ${reason.trim()}` +
          (paid > 0 ? ` — عليه مبلغ مقبوض ${fmtMoney(paid)} لم يُبطَل` : ""),
      });
      setMsg("أُلغي الطلب.");
      await load();
    } catch (e) {
      setMsg(`تعذّر الإلغاء: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function notifyCritical(item: Item) {
    const who = window.prompt(
      `اسم الطبيب/الجهة التي أُبلغت بالقيمة الحرجة لفحص «${item.testNameAr}»:`
    );
    if (!who) return;
    setBusy(true);
    try {
      await must(
        client.models.OrderItem.update({
          id: item.id,
          criticalNotifiedTo: who,
          criticalNotifiedAt: new Date().toISOString(),
          criticalPending: null, // يخرج من فهرس التنبيهات المعلّقة
        })
      );
      await audit({
        entity: "OrderItem",
        entityId: item.id,
        action: "CRITICAL_NOTIFIED",
        summary: `إبلاغ ${who} بقيمة حرجة في ${item.testNameAr}`,
      });
      await load();
    } catch (e) {
      setMsg(`تعذّر التسجيل: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * مطابقة الأنبوب الممسوح بهذا الطلب.
   *
   * هذا هو الحاجز الأخير قبل نسبة نتيجة إلى مريض خطأ: الفنّي يفتح طلبًا
   * على الشاشة ويحمل أنبوبًا في يده، ولا شيء يربط بينهما إلا انتباهه.
   * أنبوبان متجاوران على الحامل يكفيان.
   *
   * عدم التطابق يُسجَّل في سجل التدقيق كما يُسجَّل التطابق: «كاد أن يقع»
   * (near miss) هو ما تبحث عنه مراجعة الجودة، وحذفه يُخفي أخطر ما جرى.
   */
  async function handleScan(code: string) {
    if (!order) return;
    setMsg("");

    if (scanMatchesOrder(code, order.orderNo)) {
      setTube({ code, ok: true });
      if (!loggedScans.current.has(code)) {
        loggedScans.current.add(code);
        await audit({
          entity: "Order",
          entityId: order.id,
          action: "TUBE_VERIFIED",
          summary: `مطابقة أنبوب الطلب ${order.orderNo} قبل إدخال النتائج`,
        });
      }
      return;
    }

    // رمز لا يخصّ هذا الطلب: نبحث عن صاحبه كي يفتحه الفنّي بضغطة واحدة
    // بدل أن يعود إلى القائمة ويبحث بيده — الاختصار هنا يقلّل إغراء
    // تجاهل التحذير.
    let otherId: string | undefined;
    try {
      const { data } = await client.models.Order.listOrdersByOrderNo(
        { orderNo: code },
        { limit: 1, selectionSet: ["id"] }
      );
      otherId = data?.[0]?.id;
    } catch {
      /* تعذّر البحث لا يمنع عرض التحذير — والتحذير هو المهم. */
    }
    setTube({ code, ok: false, otherId });

    if (!loggedScans.current.has(code)) {
      loggedScans.current.add(code);
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "TUBE_MISMATCH",
        summary: `أنبوب ممسوح لا يطابق الطلب المفتوح: ${code} ≠ ${order.orderNo}`,
      });
    }
  }

  if (loading) return <p className="muted">جارٍ التحميل…</p>;
  if (!order)
    return (
      <div className="empty">
        <span className="icon">🔍</span>
        الطلب غير موجود.
      </div>
    );

  const st = STATUS_META[order.status ?? ""] ?? { label: order.status, tone: "muted" };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="mono">{order.orderNo}</span>{" "}
            <span className={`badge ${st.tone}`}>{st.label}</span>
            {(order.reportRevision ?? 1) > 1 && (
              <span className="badge warn" style={{ marginInlineStart: 8 }}>
                مراجعة {order.reportRevision}
              </span>
            )}
            {order.priority === "URGENT" && !cancelled && (
              <span className="pill-urgent" style={{ marginInlineStart: 8 }}>
                مستعجل
              </span>
            )}
          </h1>
          <p>
            {patient?.fullName} · <span className="mono">{patient?.mrn}</span> ·{" "}
            {SEX_LABEL[patient?.sex ?? ""]} · {ageLabel(patient?.birthDate)}
          </p>
        </div>
        <div className="row">
          {/* الشرط على `collectedAt` لا على الحالة: كان مشروطًا بـ
              `REGISTERED`، وحفظ أول نتيجة ينقل الحالة إلى `IN_PROGRESS`
              فيختفي الزرّ نهائيًّا و`collectedAt` يبقى فارغًا — فلا حدث
              سحب في سجل التدقيق، والتقرير يطبع تاريخ التسجيل تحت عنوان
              «تاريخ سحب العيّنة». */}
          {!order.collectedAt && !approved && !cancelled &&
            session.can("collectSample") && (
              <button className="btn" onClick={markCollected} disabled={busy}>
                تسجيل سحب العيّنة
              </button>
            )}
          {canEnter && (
            <button className="btn primary" onClick={saveResults} disabled={busy}>
              {busy ? "جارٍ الحفظ…" : approved ? "حفظ تعديل معتمد" : "حفظ النتائج"}
            </button>
          )}
          {canApprove && !approved && (
            <button
              /* لا `primary`: كان بجوار «حفظ النتائج» وكلاهما بارز، فيُضغط
                 الاعتماد سهوًا مكان الحفظ. */
              className="btn"
              onClick={approve}
              disabled={busy || !allSaved || dirty}
              title={
                dirty
                  ? "احفظ التعديلات أولًا — الاعتماد لا يحفظ ما في الحقول"
                  : !allSaved
                  ? "أكمل إدخال جميع النتائج واحفظها أولًا"
                  : ""
              }
            >
              اعتماد النتائج
            </button>
          )}
          {approved && (
            <Link href={`/orders/report?id=${order.id}`} className="btn primary">
              التقرير 🖨️
            </Link>
          )}
          {/* الإيصال يبقى متاحًا بعد الاعتماد أيضًا: المريض يفقد إيصاله
              فيعود لطلب نسخة، ورقم الطلب لا يُستخرج من غيره. */}
          {!cancelled && (
            <Link href={`/orders/receipt?id=${order.id}`} className="btn">
              الإيصال والملصقات 🏷️
            </Link>
          )}
          {order.status === "APPROVED" && canManageOrder && (
            <button className="btn" onClick={markDelivered} disabled={busy}>
              تسجيل التسليم
            </button>
          )}
          {!approved && !cancelled && canManageOrder && (
            <button className="btn ghost" onClick={cancelOrder} disabled={busy}>
              إلغاء الطلب
            </button>
          )}
        </div>
      </div>

      {msg && <div className="alert">{msg}</div>}

      {payFail && (
        <div className="alert danger">
          أُنشئ الطلب لكن <strong>لم تُسجَّل دفعته الأولى</strong> ({payFail}). سجّلها
          الآن من بطاقة الفاتورة أدناه — المبلغ مقبوض من المريض وغير مقيَّد.
        </div>
      )}

      {cancelled && (
        <div className="alert danger">
          هذا الطلب ملغى — {order.cancelReason || "بلا سبب مسجّل"} · ألغاه{" "}
          {order.cancelledBy} في {fmtDateTime(order.cancelledAt)}
          {paid > 0 && (
            <div className="small" style={{ fontWeight: 400, marginTop: 6 }}>
              ⚠️ عليه مبلغ مقبوض {fmtMoney(paid)} لم يُبطَل. إن رُدَّ للمريض
              فأبطل دفعاته من السجل أدناه بسبب مكتوب.
            </div>
          )}
        </div>
      )}

      {needsMigration && (
        <div className="alert warn">
          هذا الطلب أقدم من سجل الدفعات: يحمل مبلغًا مقبوضًا{" "}
          <strong>{fmtMoney(order.paidAmount)}</strong> بلا سطور تفسّره. المبلغ
          محفوظ ومعروض كما هو — لكن لا تفصيل له ولا إمكان إبطال حتى يُرحَّل.
          استعمل «صيانة البيانات» في الإعدادات.
        </div>
      )}

      {criticals.length > 0 && !cancelled && (
        <div className="alert danger">
          ⚠️ قيم حرجة تستوجب إبلاغ الطبيب فورًا:
          <ul style={{ margin: "8px 0 0", paddingInlineStart: 20, fontWeight: 400 }}>
            {criticals.map((c) => (
              <li key={c.id}>
                {c.testNameAr}: <strong>{draft[c.id]?.value}</strong> {c.unit}
                {c.criticalNotifiedAt ? (
                  <span className="badge ok" style={{ marginInlineStart: 8 }}>
                    أُبلغ {c.criticalNotifiedTo} — {fmtDateTime(c.criticalNotifiedAt)}
                  </span>
                ) : (
                  <button
                    className="btn sm"
                    style={{ marginInlineStart: 8 }}
                    onClick={() => notifyCritical(c)}
                    disabled={busy}
                  >
                    تسجيل الإبلاغ
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {approved && (
        <div className="alert ok">
          اعتُمد بواسطة {order.approvedBy} — {fmtDateTime(order.approvedAt)}
          {delivered &&
            ` · سُلّم إلى ${order.deliveredTo || "—"} في ${fmtDateTime(
              order.deliveredAt
            )}`}
          {session.can("amendApproved") &&
            " · أي تعديل الآن يرفع رقم مراجعة التقرير ويتطلّب ذكر السبب."}
          {(order.reportRevision ?? 1) > 1 && order.amendReason && (
            <div className="small" style={{ fontWeight: 400, marginTop: 6 }}>
              آخر تعديل ({fmtDateTime(order.amendedAt)}) بواسطة {order.amendedBy}:{" "}
              {order.amendReason}
            </div>
          )}
        </div>
      )}

      {canApprove && !approved && selfEntered.length > 0 && (
        <div className="alert warn">
          أنت من أدخل {selfEntered.length} من هذه النتائج
          {isAdmin
            ? " — الاعتماد الذاتي متاح لك كمدير لكنه يُسجَّل في سجل التدقيق."
            : " — يلزم أن يعتمدها زميل آخر (مراجعة مستقلّة)."}
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className={`stat${dirty ? " warn-accent" : ""}`}>
          <div className="label">التقدّم</div>
          <div className="value">
            {savedCount}/{items.length}
          </div>
          <div className="sub">
            {dirty ? "⚠️ تعديلات غير محفوظة" : "نتيجة محفوظة"}
          </div>
        </div>
        <div className="stat">
          <div className="label">الطبيب المُحوِّل</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {order.referringDoctor || "—"}
          </div>
          <div className="sub">{PRIORITY_LABEL[order.priority ?? "ROUTINE"]}</div>
        </div>
        <div className="stat">
          <div className="label">تاريخ الطلب</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {fmtDateTime(order.createdAt)}
          </div>
          <div className="sub">
            {order.collectedAt ? `سُحبت ${fmtDateTime(order.collectedAt)}` : "لم تُسحب بعد"}
          </div>
        </div>
        <div className={`stat${due > 0 ? " warn-accent" : ""}`}>
          <div className="label">الفاتورة</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {fmtMoney(net)}
          </div>
          <div className="sub">
            مدفوع {fmtMoney(paid)}
            {due > 0 && ` · متبقٍّ ${fmtMoney(due)}`}
          </div>
          {due > 0 && !cancelled && canSeeMoney && (
            <div className="row" style={{ marginTop: 8 }}>
              {/* طريقة الدفع زرّ لا قائمة: الاستقبال يقبض ويطبع في ثانية،
                  وخطوة اختيار إضافية تُترك على الافتراضي دائمًا فتفسد
                  مطابقة الصندوق بدل أن تفيدها. */}
              {Object.entries(PAYMENT_METHOD_LABEL).map(([key, label]) => (
                <button
                  key={key}
                  className={`btn sm${key === "CASH" ? " primary" : ""}`}
                  onClick={() => recordPayment(key)}
                  disabled={busy}
                  title={`تسجيل دفعة ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {canSeeMoney && payments.length > 0 && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 style={{ margin: 0, fontSize: "1rem" }}>سجل الدفعات</h2>
            <span className="muted small">
              {payments.filter((p) => !p.voidedAt).length} دفعة سارية ·{" "}
              {fmtMoney(paid)} مقبوض
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th className="num">المبلغ</th>
                  <th>الطريقة</th>
                  <th>قبضها</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={p.voidedAt ? { opacity: 0.55 } : undefined}>
                    <td className="small nowrap">{fmtDateTime(p.at)}</td>
                    <td className="num nowrap">
                      <span
                        style={
                          p.voidedAt ? { textDecoration: "line-through" } : undefined
                        }
                      >
                        {fmtMoney(p.amount)}
                      </span>
                    </td>
                    <td className="small nowrap">
                      {PAYMENT_METHOD_LABEL[p.method ?? ""] ?? "—"}
                    </td>
                    <td className="small nowrap">{p.receivedBy}</td>
                    <td className="small">
                      {p.voidedAt ? (
                        <span className="badge muted">
                          مُبطلة — {p.voidReason} · {p.voidedBy}
                        </span>
                      ) : (
                        /* بلا شرط `!cancelled`: كان الزرّ يختفي بالضبط في
                           الحالة التي يُحتاج فيها — طلب ملغى عليه مال
                           مقبوض يجب أن يُبطَل قيده عند ردّه للمريض. */
                        isAdmin && (
                          <button
                            className="btn sm ghost"
                            onClick={() => undoPayment(p)}
                            disabled={busy}
                          >
                            إبطال
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            الدفعات لا تُحذف — الخطأ يُبطَل بسبب مكتوب ويبقى السطر ظاهرًا.
            الإبطال لمدير المختبر وحده: من يقبض لا يبطل قبضه.
          </p>
        </div>
      )}

      {order.clinicalNotes && (
        <div className="alert">الشكوى: {order.clinicalNotes}</div>
      )}

      {!cancelled && (canEnter || session.can("collectSample")) && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 style={{ margin: 0, fontSize: "1rem" }}>مطابقة الأنبوب</h2>
            <ScanBox onScan={handleScan} />
          </div>

          {!tube && (
            <p className="muted small" style={{ margin: 0 }}>
              امسح باركود الأنبوب قبل إدخال النتائج ليتأكّد النظام أنه يخصّ هذا
              الطلب. المسح اختياري ولا يمنع الحفظ، ويُسجَّل في سجل الطلب.
            </p>
          )}

          {tube?.ok && (
            <div className="alert ok" style={{ margin: 0 }}>
              ✓ الأنبوب <span className="mono">{tube.code}</span> يطابق هذا الطلب.
            </div>
          )}

          {tube && !tube.ok && (
            <div className="alert danger" style={{ margin: 0 }}>
              ⚠️ الأنبوب الممسوح <span className="mono">{tube.code}</span> لا يخصّ
              هذا الطلب (<span className="mono">{order.orderNo}</span>). لا تُدخل
              نتائجه هنا.
              {tube.otherId ? (
                <div style={{ marginTop: 8 }}>
                  <Link href={`/orders/view?id=${tube.otherId}`} className="btn sm">
                    فتح الطلب الصحيح
                  </Link>
                </div>
              ) : (
                <div className="small" style={{ fontWeight: 400, marginTop: 6 }}>
                  ولا يوجد طلب بهذا الرقم في النظام — راجع الملصق.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الفحص</th>
              <th style={{ width: 190 }}>النتيجة</th>
              <th>الوحدة</th>
              <th>المدى المرجعي</th>
              <th>الحالة</th>
              <th>ملاحظة الفني</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([dept, list]) => (
              <Fragment key={dept}>
                <tr className="dept-head">
                  <td colSpan={6}>{DEPARTMENT_LABEL[dept] ?? dept}</td>
                </tr>
                {list.map((item) => {
                  const flag = flagOf(item);
                  const meta = flag ? FLAG_META[flag] : null;
                  const cls =
                    flag === "CRITICAL_HIGH" || flag === "CRITICAL_LOW"
                      ? "flag-critical"
                      : flag === "HIGH" || flag === "ABNORMAL"
                      ? "flag-high"
                      : flag === "LOW"
                      ? "flag-low"
                      : flag === "NORMAL"
                      ? "flag-ok"
                      : "";
                  return (
                    <tr key={item.id} className={isCritical(flag) ? "critical-row" : ""}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.testNameAr}</div>
                        <div className="small muted mono">{item.testCode}</div>
                      </td>
                      <td>
                        {item.resultType === "OPTION" ? (
                          <select
                            disabled={!canEnter}
                            value={draft[item.id]?.value ?? ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [item.id]: {
                                  ...draft[item.id],
                                  value: e.target.value,
                                },
                              })
                            }
                          >
                            <option value="">—</option>
                            {(item.options ?? []).map((o) => (
                              <option key={o} value={o ?? ""}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : item.resultType === "TEXT" ? (
                          <textarea
                            disabled={!canEnter}
                            rows={2}
                            value={draft[item.id]?.value ?? ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [item.id]: {
                                  ...draft[item.id],
                                  value: e.target.value,
                                },
                              })
                            }
                          />
                        ) : (
                          <input
                            className={`result-input ${cls}`}
                            disabled={!canEnter}
                            inputMode="decimal"
                            value={draft[item.id]?.value ?? ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [item.id]: {
                                  ...draft[item.id],
                                  value: e.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="small nowrap">{item.unit || "—"}</td>
                      <td className="small nowrap">
                        {item.refText || "—"}
                        {/* الفنّي يرى العَلَم «طبيعي/حرج» بجوار هذا المدى
                            ويثق به. إن لم يراجعه مسؤول الجودة فليعلم. */}
                        {item.refApproved === false && (
                          <div>
                            <span className="badge warn">مدى غير معتمد</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {meta ? (
                          <span className={`badge ${meta.tone}`}>
                            {meta.short ? `${meta.short} · ` : ""}
                            {meta.label}
                          </span>
                        ) : (
                          <span className="muted small">بانتظار</span>
                        )}
                        {item.verifiedAt && (
                          <div className="small muted">معتمد ✓</div>
                        )}
                        {item.enteredBy && (
                          <div className="small muted">أدخلها {item.enteredBy}</div>
                        )}
                      </td>
                      <td>
                        <input
                          disabled={!canEnter}
                          value={draft[item.id]?.comment ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [item.id]: {
                                ...draft[item.id],
                                comment: e.target.value,
                              },
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {!canEnter && !approved && !cancelled && (
        <p className="muted small" style={{ marginTop: 12 }}>
          صلاحيتك الحالية لا تسمح بإدخال النتائج.
        </p>
      )}

      {/* سجل الطلب لمن يراجع لا لمن يُراجَع عمله — كصفحة سجل التدقيق. */}
      {session.can("viewAudit") && (
        <section className="card no-print" style={{ marginTop: 20 }}>
          <div className="card-head">
            <h2 style={{ margin: 0, fontSize: "1rem" }}>سجل هذا الطلب</h2>
            <button
              className="btn sm"
              onClick={() => (history ? setHistory(null) : void loadHistory())}
              disabled={historyBusy}
            >
              {historyBusy ? "جارٍ…" : history ? "إخفاء" : "عرض السجل"}
            </button>
          </div>

          {history && history.length === 0 && (
            <p className="muted small">لا أحداث مسجَّلة على هذا الطلب.</p>
          )}

          {history && history.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>الحدث</th>
                    <th>الفاعل</th>
                    <th>التفصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((l) => (
                    <tr key={l.id}>
                      <td className="small nowrap">
                        {fmtDateTime(l.at ?? l.createdAt)}
                      </td>
                      <td className="small nowrap">{actionLabel(l.action)}</td>
                      <td className="small nowrap">{l.actor}</td>
                      <td className="small">{l.summary || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
