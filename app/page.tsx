"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { client, listAll } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import {
  FLAG_META,
  STATUS_META,
  fmtDateTime,
  fmtMoney,
  isToday,
  tatHours,
  type Flag,
} from "@/lib/lab";

type Order = Schema["Order"]["type"];
type Item = Schema["OrderItem"]["type"];

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [criticals, setCriticals] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [o, c] = await Promise.all([
          listAll<Order>((nextToken) =>
            client.models.Order.list({ limit: 500, nextToken })
          ),
          /* فهرس متفرّق على `criticalPending` — يحوي القيم الحرجة غير
             المُبلَّغ عنها وحدها. البديل السابق كان مسح أول ٢٠٠ صفّ من
             الجدول ثم التصفية، فيتوقّف التنبيه عن الظهور بصمت بمجرد
             نمو الجدول. ولا نقصره على اليوم: قيمة حرجة من الأمس لم
             يُبلَّغ عنها أخطر لا أقل.                                */
          listAll<Item>((nextToken) =>
            client.models.OrderItem.listPendingCriticals(
              { criticalPending: "YES" },
              { limit: 100, sortDirection: "DESC", nextToken }
            )
          ),
        ]);
        setOrders(o);
        setCriticals(c.filter((i) => !i.criticalNotifiedAt));
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    // الطلبات الملغاة لا تُحتسب في العدّ ولا في الإيراد
    const today = orders.filter(
      (o) => isToday(o.createdAt) && o.status !== "CANCELLED"
    );
    const pendingReview = orders.filter((o) => o.status === "PENDING_REVIEW");
    const inProgress = orders.filter(
      (o) => o.status === "COLLECTED" || o.status === "IN_PROGRESS"
    );
    const waitingCollection = orders.filter((o) => o.status === "REGISTERED");
    const revenue = today.reduce(
      (s, o) => s + (o.totalPrice ?? 0) - (o.discount ?? 0),
      0
    );
    const unpaid = today.reduce(
      (s, o) => s + Math.max(0, (o.totalPrice ?? 0) - (o.discount ?? 0) - (o.paidAmount ?? 0)),
      0
    );

    const tats = orders
      .map((o) => tatHours(o.createdAt, o.approvedAt))
      .filter((v): v is number => v !== null);
    const avgTat = tats.length ? tats.reduce((a, b) => a + b, 0) / tats.length : null;

    return {
      today: today.length,
      pendingReview: pendingReview.length,
      inProgress: inProgress.length,
      waitingCollection: waitingCollection.length,
      revenue,
      unpaid,
      avgTat,
    };
  }, [orders]);

  const recent = useMemo(
    () =>
      [...orders]
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .slice(0, 12),
    [orders]
  );

  if (loading) return <p className="muted">جارٍ التحميل…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>لوحة اليوم</h1>
          <p>نظرة سريعة على حركة المختبر والحالات التي تحتاج تدخّلًا.</p>
        </div>
        <div className="row">
          <Link href="/orders/new" className="btn primary">
            + طلب فحص جديد
          </Link>
        </div>
      </div>

      {error && (
        <div className="alert danger">
          تعذّر الاتصال بالخادم: {error}
          <div className="small" style={{ fontWeight: 400, marginTop: 6 }}>
            تأكد من تشغيل <span className="mono">npx ampx sandbox</span> لإنشاء
            الباكند.
          </div>
        </div>
      )}

      {criticals.length > 0 && (
        <div className="alert danger">
          ⚠️ يوجد {criticals.length} نتيجة بقيمة حرجة لم يُبلَّغ عنها الطبيب بعد.
          <ul style={{ margin: "8px 0 0", paddingInlineStart: 20, fontWeight: 400 }}>
            {criticals.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link href={`/orders/${c.orderId}`}>
                  {c.testNameAr}: {c.valueNumeric ?? c.valueText} {c.unit ?? ""} (
                  {FLAG_META[(c.flag ?? "ABNORMAL") as Flag].label})
                </Link>
                {!isToday(c.enteredAt) && (
                  <span className="badge critical" style={{ marginInlineStart: 8 }}>
                    متأخّر منذ {fmtDateTime(c.enteredAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <div className="stat accent">
          <div className="label">طلبات اليوم</div>
          <div className="value">{stats.today}</div>
          <div className="sub">{stats.waitingCollection} بانتظار سحب العيّنة</div>
        </div>
        <div className="stat">
          <div className="label">قيد التحليل</div>
          <div className="value">{stats.inProgress}</div>
          <div className="sub">عيّنات في الأقسام</div>
        </div>
        <div className="stat warn-accent">
          <div className="label">بانتظار الاعتماد</div>
          <div className="value">{stats.pendingReview}</div>
          <div className="sub">تحتاج مراجعة مسؤول الجودة</div>
        </div>
        <div className="stat">
          <div className="label">إيراد اليوم</div>
          <div className="value" style={{ fontSize: "1.4rem" }}>
            {fmtMoney(stats.revenue)}
          </div>
          <div className="sub">
            {stats.unpaid > 0 ? `متبقٍ ${fmtMoney(stats.unpaid)}` : "محصّل بالكامل"}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>أحدث الطلبات</h2>
          <div className="row">
            {stats.avgTat !== null && (
              <span className="badge muted">
                متوسط زمن الإنجاز: {stats.avgTat.toFixed(1)} ساعة
              </span>
            )}
            <Link href="/orders" className="btn sm">
              كل الطلبات
            </Link>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="empty">
            <span className="icon">🧾</span>
            لا توجد طلبات بعد.
            <div style={{ marginTop: 12 }}>
              <Link href="/orders/new" className="btn primary">
                سجّل أول طلب
              </Link>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم الطلب</th>
                  <th>التاريخ</th>
                  <th>الطبيب المُحوِّل</th>
                  <th>الحالة</th>
                  <th className="num">المبلغ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => {
                  const st = STATUS_META[o.status ?? ""] ?? {
                    label: o.status,
                    tone: "muted",
                  };
                  return (
                    <tr key={o.id}>
                      <td className="mono nowrap">
                        {o.orderNo}
                        {o.priority === "URGENT" && (
                          <span className="pill-urgent" style={{ marginInlineStart: 6 }}>
                            مستعجل
                          </span>
                        )}
                      </td>
                      <td className="nowrap small">{fmtDateTime(o.createdAt)}</td>
                      <td>{o.referringDoctor || "—"}</td>
                      <td>
                        <span className={`badge ${st.tone}`}>{st.label}</span>
                      </td>
                      <td className="num">{fmtMoney((o.totalPrice ?? 0) - (o.discount ?? 0))}</td>
                      <td>
                        <Link href={`/orders/${o.id}`} className="btn sm">
                          فتح
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
