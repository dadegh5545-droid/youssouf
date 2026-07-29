"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { client, listAll, useSession } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";
import {
  PAYMENT_METHOD_LABEL,
  fmtMoney,
  localDay,
  orderDue,
  orderNet,
  roundMoney,
  sumPayments,
} from "@/lib/lab";
import type { Schema } from "@/amplify/data/resource";

type Order = Schema["Order"]["type"];
type Item = Schema["OrderItem"]["type"];
type Payment = Schema["Payment"]["type"];

/**
 * تقارير الإدارة — الإيراد والإنتاجية والجودة على فترة.
 *
 * القراءة يومًا بيوم عبر فهرس `day` لا بمسح جدول الطلبات: تقرير شهر
 * يقرأ طلبات ذلك الشهر وحدها مهما كبر تاريخ المختبر.
 *
 * حدّ الفترة ٩٢ يومًا: كل يوم استعلام مستقلّ، وسنة كاملة تعني ٣٦٥
 * استعلامًا في فتحة واحدة. التقارير السنوية تحتاج تجميعًا مسبقًا
 * (جدول ملخّص يومي تكتبه دالة مجدولة) لا استعلامًا حيًّا.
 */

const MAX_DAYS = 92;

/** أيام المدى شاملةً الطرفين. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (isNaN(+start) || isNaN(+end) || start > end) return out;
  const cur = new Date(start);
  while (cur <= end && out.length <= MAX_DAYS) {
    out.push(localDay(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** ساعات بين وقتين — تُستخدم لزمن الإنجاز. */
function hoursBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return diff >= 0 ? diff / 3_600_000 : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const hrs = (v: number | null) =>
  v == null ? "—" : v < 1 ? `${Math.round(v * 60)} د` : `${v.toFixed(1)} س`;

export default function ReportsPage() {
  const session = useSession();
  const { currency } = useLabConfig();
  const canView = session.can("viewReports");

  const firstOfMonth = () => {
    const d = new Date();
    d.setDate(1);
    return localDay(d);
  };

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(() => localDay());
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ran, setRan] = useState(false);

  // تفصيل الفحوصات استعلام لكل طلب، فلا يُحمّل إلا بطلب صريح.
  const [tests, setTests] = useState<{ name: string; count: number; revenue: number }[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);

  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const tooLong = days.length > MAX_DAYS;

  const load = useCallback(async () => {
    if (tooLong || days.length === 0) return;
    setLoading(true);
    setErr("");
    setTests([]);
    try {
      /* الطلبات بيوم إنشائها، والدفعات بيوم قبضها — يومان مختلفان عن قصد.
         من دفع باقي حسابه بعد أسبوع يُحتسب ماله في اليوم الذي قُبض فيه،
         وهو ما يطابق صندوق المحاسب. الاحتساب من `paidAmount` على طلبات
         الفترة كان ينسب ذلك المال إلى يوم الطلب لا يوم القبض. */
      const [orderPages, paymentPages] = await Promise.all([
        Promise.all(
          days.map((d) =>
            listAll<Order>((nextToken) =>
              client.models.Order.listOrdersByDay({ day: d }, { limit: 500, nextToken })
            )
          )
        ),
        Promise.all(
          days.map((d) =>
            listAll<Payment>((nextToken) =>
              client.models.Payment.listPaymentsByDay(
                { day: d },
                { limit: 500, nextToken }
              )
            )
          )
        ),
      ]);
      setOrders(orderPages.flat());
      setPayments(paymentPages.flat());
      setRan(true);
    } catch (e) {
      setErr(`تعذّر جلب التقرير: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days, tooLong]);

  useEffect(() => {
    if (!session.loading && canView) void load();
    // القراءة الأولى فقط؛ ما بعدها بزرّ «عرض التقرير».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.loading, canView]);

  const s = useMemo(() => {
    const live = orders.filter((o) => o.status !== "CANCELLED");
    const cancelled = orders.filter((o) => o.status === "CANCELLED");

    const gross = live.reduce((n, o) => n + (o.totalPrice ?? 0), 0);
    const discount = live.reduce((n, o) => n + (o.discount ?? 0), 0);
    const net = gross - discount;

    // التحصيل من سجل الدفعات بيوم القبض — مالٌ دخل الصندوق في الفترة.
    const collected = sumPayments(payments);
    const byMethod = new Map<string, number>();
    for (const p of payments) {
      if (p.voidedAt) continue;
      const k = p.method ?? "OTHER";
      byMethod.set(k, roundMoney((byMethod.get(k) ?? 0) + (p.amount ?? 0)));
    }
    const voided = payments.filter((p) => p.voidedAt);

    // المتبقّي على طلبات الفترة — سؤال آخر: ذمم لا صندوق.
    const due = live.reduce(
      (n, o) => n + orderDue(orderNet(o.totalPrice, o.discount), o.paidAmount ?? 0),
      0
    );

    const tat = live
      .map((o) => hoursBetween(o.createdAt, o.approvedAt))
      .filter((v): v is number => v != null);

    // زمن السحب: من تسجيل الطلب إلى أخذ العيّنة — يقيس ازدحام الاستقبال.
    const collect = live
      .map((o) => hoursBetween(o.createdAt, o.collectedAt))
      .filter((v): v is number => v != null);

    const byStatus = new Map<string, number>();
    for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

    const byDay = days.map((d) => ({
      day: d,
      count: orders.filter((o) => o.day === d && o.status !== "CANCELLED").length,
      revenue: orders
        .filter((o) => o.day === d && o.status !== "CANCELLED")
        .reduce((n, o) => n + (o.totalPrice ?? 0) - (o.discount ?? 0), 0),
    }));

    const urgent = live.filter((o) => o.priority === "URGENT").length;
    const amended = orders.filter((o) => (o.reportRevision ?? 1) > 1).length;

    return {
      count: live.length,
      cancelled: cancelled.length,
      cancelRate: orders.length ? (cancelled.length / orders.length) * 100 : 0,
      gross,
      discount,
      net,
      collected,
      byMethod,
      voided,
      due,
      avgTicket: live.length ? net / live.length : 0,
      tatAvg: tat.length ? tat.reduce((a, b) => a + b, 0) / tat.length : null,
      tatMedian: median(tat),
      tatCount: tat.length,
      collectAvg: collect.length
        ? collect.reduce((a, b) => a + b, 0) / collect.length
        : null,
      byStatus,
      byDay,
      urgent,
      amended,
    };
  }, [orders, payments, days]);

  /** أكثر الفحوصات طلبًا — استعلام لكل طلب، لذلك بزرّ منفصل. */
  async function loadTests() {
    setTestsLoading(true);
    setErr("");
    try {
      const live = orders.filter((o) => o.status !== "CANCELLED");
      const map = new Map<string, { name: string; count: number; revenue: number }>();
      // على دفعات: مئات الاستعلامات دفعة واحدة تخنق المتصفّح والـ API.
      const BATCH = 10;
      for (let i = 0; i < live.length; i += BATCH) {
        const chunk = live.slice(i, i + BATCH);
        const lists = await Promise.all(
          chunk.map((o) =>
            listAll<Item>((nextToken) =>
              client.models.OrderItem.listOrderItemsByOrder(
                { orderId: o.id },
                { limit: 200, nextToken }
              )
            )
          )
        );
        for (const items of lists) {
          for (const it of items) {
            const key = it.testCode;
            const e = map.get(key) ?? { name: it.testNameAr, count: 0, revenue: 0 };
            e.count += 1;
            e.revenue += it.price ?? 0;
            map.set(key, e);
          }
        }
      }
      setTests(Array.from(map.values()).sort((a, b) => b.count - a.count));
    } catch (e) {
      setErr(`تعذّر حساب الفحوصات: ${(e as Error).message}`);
    } finally {
      setTestsLoading(false);
    }
  }

  if (session.loading) return <p className="muted">جارٍ التحميل…</p>;

  if (!canView) {
    return (
      <div className="alert warn">
        التقارير متاحة لمدير المختبر ومسؤول الجودة فقط.
      </div>
    );
  }

  const peak = Math.max(1, ...s.byDay.map((d) => d.count));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>تقارير الإدارة</h1>
          <p>
            الإيراد والإنتاجية وزمن الإنجاز على فترة تختارها. الطلبات المنشأة قبل
            إضافة حقل اليوم لا تُحتسب هنا — يعالجها «صيانة البيانات» في صفحة
            الإعدادات.
          </p>
        </div>
        <div className="row no-print">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="من"
          />
          <input
            type="date"
            value={to}
            max={localDay()}
            onChange={(e) => setTo(e.target.value)}
            aria-label="إلى"
          />
          <button
            className="btn primary"
            onClick={() => void load()}
            disabled={loading || tooLong}
          >
            {loading ? "جارٍ الحساب…" : "عرض التقرير"}
          </button>
          <button className="btn" onClick={() => window.print()}>
            🖨️
          </button>
        </div>
      </div>

      {tooLong && (
        <div className="alert warn">
          المدى {days.length} يومًا — الحدّ {MAX_DAYS} يومًا. كل يوم استعلام
          مستقلّ، والمدى الأطول يحتاج جدول ملخّص يومي لا استعلامًا حيًّا.
        </div>
      )}
      {err && <div className="alert danger">{err}</div>}

      {ran && orders.length === 0 && !loading && (
        <div className="alert">
          لا طلبات في هذه الفترة. الطلبات المُنشأة قبل تحديث التقارير لا تحمل
          مفتاح اليوم فلا تظهر هنا.
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat accent">
          <div className="label">الطلبات</div>
          <div className="value">{s.count}</div>
          <div className="sub">
            {s.urgent} مستعجل · {days.length} يوم
          </div>
        </div>
        <div className="stat">
          <div className="label">صافي الإيراد</div>
          <div className="value">{fmtMoney(s.net, currency)}</div>
          <div className="sub">
            بعد خصم {fmtMoney(s.discount, currency)}
          </div>
        </div>
        <div className="stat">
          <div className="label">التحصيل في الفترة</div>
          <div className="value">{fmtMoney(s.collected, currency)}</div>
          <div className="sub">
            {Array.from(s.byMethod.entries())
              .map(([k, v]) => `${PAYMENT_METHOD_LABEL[k] ?? k} ${fmtMoney(v, currency)}`)
              .join(" · ") || "لا دفعات"}
          </div>
        </div>
        <div className={`stat${s.due > 0 ? " warn-accent" : ""}`}>
          <div className="label">ذمم غير محصَّلة</div>
          <div className="value">{fmtMoney(s.due, currency)}</div>
          <div className="sub">متبقٍّ على طلبات الفترة</div>
        </div>
      </div>

      {/* الرقمان يقيسان شيئين مختلفين، وخلطهما يجعل المحاسب يبحث عن فرق
          ليس خطأً. صافي الإيراد فوترةُ طلبات أُنشئت في الفترة، والتحصيل
          مالٌ قُبض فيها — وقد يكون على طلبات أقدم. */}
      <p className="muted small" style={{ marginTop: -8 }}>
        «صافي الإيراد» فوترة طلبات أُنشئت في الفترة، و«التحصيل» مالٌ قُبض فيها
        ولو كان على طلبات أقدم — فلا يتطابقان بالضرورة.
        {s.voided.length > 0 && (
          <>
            {" "}
            ويوجد <strong>{s.voided.length}</strong> دفعة مُبطلة في هذه الفترة
            بمجموع {fmtMoney(
              roundMoney(s.voided.reduce((n, p) => n + (p.amount ?? 0), 0)),
              currency
            )}{" "}
            — غير محتسبة أعلاه وتفصيلها في سجل التدقيق.
          </>
        )}
      </p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">متوسط الفاتورة</div>
          <div className="value">{fmtMoney(s.avgTicket, currency)}</div>
          <div className="sub">للطلب الواحد</div>
        </div>
        <div className="stat">
          <div className="label">زمن الإنجاز (وسيط)</div>
          <div className="value">{hrs(s.tatMedian)}</div>
          <div className="sub">
            متوسط {hrs(s.tatAvg)} · {s.tatCount} طلبًا معتمدًا
          </div>
        </div>
        <div className="stat">
          <div className="label">زمن سحب العيّنة</div>
          <div className="value">{hrs(s.collectAvg)}</div>
          <div className="sub">من التسجيل إلى السحب</div>
        </div>
        <div className={`stat${s.cancelRate > 5 ? " danger-accent" : ""}`}>
          <div className="label">معدّل الإلغاء</div>
          <div className="value">{s.cancelRate.toFixed(1)}٪</div>
          <div className="sub">
            {s.cancelled} ملغى · {s.amended} تقرير مُصحَّح
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>الحركة اليومية</h2>
            <span className="muted small">عدد الطلبات</span>
          </div>
          {s.byDay.length === 0 ? (
            <div className="empty">—</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
              <table>
                <tbody>
                  {s.byDay.map((d) => (
                    <tr key={d.day}>
                      <td className="mono small nowrap">{d.day}</td>
                      <td style={{ width: "60%" }}>
                        {/* شريط نسبي: يكشف يوم الذروة ويوم التعطّل بلا رسم بياني */}
                        <div
                          style={{
                            height: 10,
                            borderRadius: 5,
                            background: "var(--brand)",
                            width: `${Math.max(2, (d.count / peak) * 100)}%`,
                            opacity: d.count ? 1 : 0.15,
                          }}
                        />
                      </td>
                      <td className="num nowrap">{d.count}</td>
                      <td className="num nowrap small muted">
                        {fmtMoney(d.revenue, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>الطلبات حسب الحالة</h2>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {Array.from(s.byStatus.entries()).map(([st, n]) => (
                  <tr key={st}>
                    <td>{STATUS_LABEL[st] ?? st}</td>
                    <td className="num">{n}</td>
                    <td className="num muted small">
                      {orders.length ? `${Math.round((n / orders.length) * 100)}٪` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint">
            «بانتظار المراجعة» المرتفع يعني اختناقًا عند الاعتماد لا عند
            التحليل.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>الفحوصات الأكثر طلبًا</h2>
          {tests.length === 0 ? (
            <button
              className="btn sm no-print"
              onClick={() => void loadTests()}
              disabled={testsLoading || s.count === 0}
            >
              {testsLoading ? "جارٍ الحساب…" : "احسب"}
            </button>
          ) : (
            <span className="muted small">{tests.length} فحصًا مختلفًا</span>
          )}
        </div>
        {tests.length === 0 ? (
          <div className="empty">
            يحتاج قراءة فحوصات كل طلب في الفترة، فلا يُحسب تلقائيًا.
            {s.count > 0 && (
              <div className="muted small" style={{ marginTop: 6 }}>
                {s.count} طلبًا — قد يستغرق دقيقة.
              </div>
            )}
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 400, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>الفحص</th>
                  <th className="num">مرّة</th>
                  <th className="num">الإيراد</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="num">{t.count}</td>
                    <td className="num">{fmtMoney(t.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="hint">
        الإيراد محسوب على الطلبات غير الملغاة في الفترة، بسعر وقت الطلب لا
        بسعر الكتالوج اليوم.
      </div>
    </>
  );
}

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "مسجّل — بانتظار السحب",
  COLLECTED: "سُحبت العيّنة",
  IN_PROGRESS: "جارٍ التحليل",
  PENDING_REVIEW: "بانتظار المراجعة",
  APPROVED: "معتمد",
  DELIVERED: "سُلّم",
  CANCELLED: "ملغى",
};
