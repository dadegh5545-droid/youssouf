"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { audit, client, listAll, useSession } from "@/lib/amplify";
import { actionLabel } from "@/lib/audit";
import type { Schema } from "@/amplify/data/resource";
import {
  DEPARTMENT_LABEL,
  FLAG_META,
  PRIORITY_LABEL,
  SEX_LABEL,
  STATUS_META,
  ageLabel,
  computeFlag,
  computeTextFlag,
  fmtDateTime,
  fmtMoney,
  isCritical,
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
  const session = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /* سجل الطلب: استعلام لكل سطر مسجَّل (الطلب نفسه + كل فحص فيه)، فلا
     يُحمَّل إلا بطلب صريح — فتح الطلب لإدخال نتيجة لا يستدعي تاريخه. */
  const [history, setHistory] = useState<Log[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    const { data: o } = await client.models.Order.get({ id: orderId });
    if (!o) {
      setLoading(false);
      return;
    }
    setOrder(o);
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

  const filledCount = items.filter((i) => (draft[i.id]?.value ?? "").trim()).length;
  const allFilled = items.length > 0 && filledCount === items.length;
  const criticals = items.filter((i) => isCritical(flagOf(i)));

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
          actor: session.actor,
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

      if (approved) {
        const rev = (order.reportRevision ?? 1) + 1;
        await client.models.Order.update({
          id: order.id,
          reportRevision: rev,
          amendedAt: now,
          amendedBy: session.name || session.actor,
          amendReason: reason,
        });
        await audit({
          entity: "Order",
          entityId: order.id,
          action: "REPORT_AMENDED",
          actor: session.actor,
          summary: `تعديل تقرير معتمد ${order.orderNo} — مراجعة ${rev}: ${reason}`,
        });
        setMsg(`حُفظت ${changed} نتيجة. صدرت مراجعة رقم ${rev} من التقرير.`);
      } else {
        const nextStatus = allFilled ? "PENDING_REVIEW" : "IN_PROGRESS";
        await client.models.Order.update({ id: order.id, status: nextStatus });
        setMsg(
          `حُفظت ${changed} نتيجة.${
            allFilled ? " الطلب الآن بانتظار الاعتماد." : ""
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
      await client.models.Order.update({
        id: order.id,
        status: "COLLECTED",
        collectedAt: new Date().toISOString(),
        collectedBy: session.actor,
      });
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "SAMPLE_COLLECTED",
        actor: session.actor,
        summary: `سحب عيّنة الطلب ${order.orderNo}`,
      });
      await load();
    } catch (e) {
      setMsg(`تعذّرت العملية: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!order) return;

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
      const now = new Date().toISOString();
      for (const i of items) {
        await client.models.OrderItem.update({
          id: i.id,
          verifiedBy: session.actor,
          verifiedAt: now,
        });
      }
      await client.models.Order.update({
        id: order.id,
        status: "APPROVED",
        approvedAt: now,
        approvedBy: session.name || session.actor,
      });
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "ORDER_APPROVED",
        actor: session.actor,
        summary:
          `اعتماد الطلب ${order.orderNo} (${items.length} فحص)` +
          (selfEntered.length > 0
            ? ` — اعتماد ذاتي بصلاحية مدير لـ ${selfEntered.length} نتيجة أدخلها المعتمِد نفسه`
            : ""),
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
      await client.models.Order.update({
        id: order.id,
        status: "DELIVERED",
        deliveredAt: now,
        deliveredBy: session.actor,
        deliveredTo: who.trim() || null,
      });
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "REPORT_DELIVERED",
        actor: session.actor,
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
   * `paidAmount` كان يُكتب مرة واحدة عند إنشاء الطلب، فمريض دفع نصف
   * المبلغ وعاد ليكمل لم يكن لدفعته مكان في النظام — تُكتب في دفتر جانبي
   * أو تضيع.
   *
   * ملاحظة: هذه قراءة ثم كتابة بلا قفل. لو سجّل موظفان دفعتين على الطلب
   * نفسه في اللحظة نفسها ضاعت إحداهما. المخرج الكامل جدول `Payment`
   * مستقل تُجمع سطوره، وهو ما يلزم عند تعدّد نقاط التحصيل.
   */
  async function recordPayment() {
    if (!order) return;
    const net = Math.max(0, (order.totalPrice ?? 0) - (order.discount ?? 0));
    const paid = order.paidAmount ?? 0;
    const due = Math.max(0, net - paid);
    if (due <= 0) {
      setMsg("لا متبقّي على هذا الطلب.");
      return;
    }
    const raw = window.prompt(
      `الصافي ${fmtMoney(net)} · المدفوع ${fmtMoney(paid)} · المتبقّي ${fmtMoney(due)}.\n\nاكتب المبلغ المدفوع الآن:`,
      String(due)
    );
    if (raw === null) return;

    const amount = Number(raw.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("مبلغ غير صالح.");
      return;
    }
    // الزيادة على المتبقّي تُرفض: فائض في حساب المريض لا مكان له في هذا
    // النموذج، وتسجيله يجعل تقرير الإيراد يعدّ مالًا لم يُقبض.
    if (amount > due + 0.001) {
      setMsg(`المبلغ أكبر من المتبقّي (${fmtMoney(due)}). سجّل ${fmtMoney(due)} أو أقل.`);
      return;
    }

    setBusy(true);
    try {
      const next = Math.round((paid + amount) * 100) / 100;
      const { errors } = await client.models.Order.update({
        id: order.id,
        paidAmount: next,
      });
      if (errors?.length) throw new Error(errors[0].message);
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "PAYMENT_RECORDED",
        actor: session.actor,
        summary: `دفعة ${fmtMoney(amount)} على الطلب ${order.orderNo} — المتبقّي ${fmtMoney(
          Math.max(0, net - next)
        )}`,
        before: { paidAmount: paid },
        after: { paidAmount: next },
      });
      setMsg(`سُجّلت دفعة ${fmtMoney(amount)}.`);
      await load();
    } catch (e) {
      setMsg(`تعذّر تسجيل الدفعة: ${(e as Error).message}`);
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
      await client.models.Order.update({
        id: order.id,
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: session.actor,
        cancelReason: reason.trim(),
      });
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CANCELLED",
        actor: session.actor,
        summary: `إلغاء الطلب ${order.orderNo}: ${reason.trim()}`,
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
      await client.models.OrderItem.update({
        id: item.id,
        criticalNotifiedTo: who,
        criticalNotifiedAt: new Date().toISOString(),
        criticalPending: null, // يخرج من فهرس التنبيهات المعلّقة
      });
      await audit({
        entity: "OrderItem",
        entityId: item.id,
        action: "CRITICAL_NOTIFIED",
        actor: session.actor,
        summary: `إبلاغ ${who} بقيمة حرجة في ${item.testNameAr}`,
      });
      await load();
    } catch (e) {
      setMsg(`تعذّر التسجيل: ${(e as Error).message}`);
    } finally {
      setBusy(false);
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
          {order.status === "REGISTERED" && session.can("collectSample") && (
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
              className="btn primary"
              onClick={approve}
              disabled={busy || !allFilled}
              title={!allFilled ? "أكمل إدخال جميع النتائج أولًا" : ""}
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

      {cancelled && (
        <div className="alert danger">
          هذا الطلب ملغى — {order.cancelReason || "بلا سبب مسجّل"} · ألغاه{" "}
          {order.cancelledBy} في {fmtDateTime(order.cancelledAt)}
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
        <div className="stat">
          <div className="label">التقدّم</div>
          <div className="value">
            {filledCount}/{items.length}
          </div>
          <div className="sub">نتيجة مُدخلة</div>
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
        {(() => {
          const net = Math.max(0, (order.totalPrice ?? 0) - (order.discount ?? 0));
          const due = Math.max(0, net - (order.paidAmount ?? 0));
          return (
            <div className={`stat${due > 0 ? " warn-accent" : ""}`}>
              <div className="label">الفاتورة</div>
              <div className="value" style={{ fontSize: "1rem" }}>
                {fmtMoney(net)}
              </div>
              <div className="sub">
                مدفوع {fmtMoney(order.paidAmount)}
                {due > 0 && ` · متبقٍّ ${fmtMoney(due)}`}
              </div>
              {due > 0 && !cancelled && session.can("viewFinance") && (
                <button
                  className="btn sm"
                  style={{ marginTop: 8 }}
                  onClick={recordPayment}
                  disabled={busy}
                >
                  تسجيل دفعة
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {order.clinicalNotes && (
        <div className="alert">الشكوى: {order.clinicalNotes}</div>
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
                      <td className="small nowrap">{item.refText || "—"}</td>
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
