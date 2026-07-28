"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { client, listAll } from "@/lib/amplify";
import type { Schema } from "@/amplify/data/resource";
import { PRIORITY_LABEL, STATUS_META, fmtDateTime, fmtMoney } from "@/lib/lab";

type Order = Schema["Order"]["type"];
type Patient = Schema["Patient"]["type"];

const FILTERS: { key: string; label: string }[] = [
  { key: "ACTIVE", label: "قيد العمل" },
  { key: "REGISTERED", label: "بانتظار السحب" },
  { key: "IN_PROGRESS", label: "قيد التحليل" },
  { key: "PENDING_REVIEW", label: "بانتظار الاعتماد" },
  { key: "APPROVED", label: "معتمد" },
  { key: "DELIVERED", label: "مُسلّم" },
  { key: "CANCELLED", label: "ملغى" },
  { key: "ALL", label: "الكل" },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [patients, setPatients] = useState<Map<string, Patient>>(new Map());
  const [filter, setFilter] = useState("ACTIVE");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      // listAll يتبع nextToken — بدونه تُعرض الصفحة الأولى فقط (حد 1MB
      // في DynamoDB) فتختفي طلبات ومرضى من القائمة بلا أي رسالة.
      const [o, p] = await Promise.all([
        listAll<Order>((nextToken) =>
          client.models.Order.list({ limit: 500, nextToken })
        ),
        listAll<Patient>((nextToken) =>
          client.models.Patient.list({ limit: 500, nextToken })
        ),
      ]);
      setOrders(o);
      setPatients(new Map(p.map((x) => [x.id, x])));
      setLoading(false);
    })().catch((e) => {
      setMsg(`تعذّر تحميل القائمة: ${(e as Error).message}`);
      setLoading(false);
    });
  }, []);

  const rows = useMemo(() => {
    const term = q.trim();
    return orders
      .filter((o) => {
        if (filter === "ALL") return true;
        if (filter === "ACTIVE")
          return ["REGISTERED", "COLLECTED", "IN_PROGRESS", "PENDING_REVIEW"].includes(
            o.status ?? ""
          );
        if (filter === "IN_PROGRESS")
          return o.status === "IN_PROGRESS" || o.status === "COLLECTED";
        return o.status === filter;
      })
      .filter((o) => {
        if (!term) return true;
        const p = patients.get(o.patientId ?? "");
        return (
          o.orderNo?.includes(term) ||
          p?.fullName?.includes(term) ||
          p?.mrn?.includes(term)
        );
      })
      .sort((a, b) => {
        // المستعجل أولًا، ثم الأحدث
        if ((a.priority === "URGENT") !== (b.priority === "URGENT"))
          return a.priority === "URGENT" ? -1 : 1;
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      });
  }, [orders, patients, filter, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>قائمة العمل</h1>
          <p>الطلبات مرتّبة حسب الأولوية — المستعجل أولًا.</p>
        </div>
        <Link href="/orders/new" className="btn primary">
          + طلب جديد
        </Link>
      </div>

      {msg && <div className="alert danger">{msg}</div>}

      <div className="card">
        <div className="card-head">
          <div className="row">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`btn sm${filter === f.key ? " primary" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            style={{ maxWidth: 260 }}
            placeholder="رقم الطلب أو اسم المريض…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {loading ? (
          <p className="muted">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <div className="empty">
            <span className="icon">📋</span>
            لا توجد طلبات في هذا التصنيف.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم الطلب</th>
                  <th>المريض</th>
                  <th>التاريخ</th>
                  <th>الأولوية</th>
                  <th>الحالة</th>
                  <th className="num">الصافي</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const p = patients.get(o.patientId ?? "");
                  const st = STATUS_META[o.status ?? ""] ?? {
                    label: o.status,
                    tone: "muted",
                  };
                  return (
                    <tr key={o.id}>
                      <td className="mono nowrap">{o.orderNo}</td>
                      <td>
                        {p?.fullName ?? "—"}
                        <div className="small muted mono">{p?.mrn}</div>
                      </td>
                      <td className="small nowrap">{fmtDateTime(o.createdAt)}</td>
                      <td>
                        {o.priority === "URGENT" ? (
                          <span className="pill-urgent">مستعجل</span>
                        ) : (
                          <span className="muted small">
                            {PRIORITY_LABEL[o.priority ?? "ROUTINE"]}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${st.tone}`}>{st.label}</span>
                      </td>
                      <td className="num nowrap">
                        {fmtMoney((o.totalPrice ?? 0) - (o.discount ?? 0))}
                      </td>
                      <td className="nowrap">
                        <Link href={`/orders/view?id=${o.id}`} className="btn sm">
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
