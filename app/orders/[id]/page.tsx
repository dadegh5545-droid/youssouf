"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { audit, client, useSession } from "@/lib/amplify";
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

type Draft = { value: string; comment: string };

export default function OrderPage({ params }: { params: { id: string } }) {
  const session = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data: o } = await client.models.Order.get({ id: params.id });
    if (!o) {
      setLoading(false);
      return;
    }
    setOrder(o);
    const [{ data: p }, { data: its }] = await Promise.all([
      client.models.Patient.get({ id: o.patientId }),
      client.models.OrderItem.list({
        limit: 500,
        filter: { orderId: { eq: o.id } },
      }),
    ]);
    setPatient(p ?? null);
    const sorted = (its ?? []).sort(
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
  }, [params.id]);

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

  const canEnter = session.can("enterResults") && (!approved || session.can("amendApproved"));
  const canApprove = session.can("approveResults");

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
          enteredBy: session.email,
          enteredAt: now,
        });
        if (errors?.length) throw new Error(errors[0].message);
        changed++;

        await audit({
          entity: "OrderItem",
          entityId: item.id,
          action: approved ? "RESULT_AMENDED" : "RESULT_ENTERED",
          actor: session.email,
          summary: `${item.testNameAr}: ${prevValue || "—"} ← ${raw || "—"}`,
          before: { value: prevValue, flag: item.flag },
          after: { value: raw, flag },
        });
      }

      if (changed === 0) {
        setMsg("لا توجد تغييرات لحفظها.");
        return;
      }

      if (!approved) {
        const nextStatus = allFilled ? "PENDING_REVIEW" : "IN_PROGRESS";
        await client.models.Order.update({ id: order.id, status: nextStatus });
      }

      setMsg(
        `حُفظت ${changed} نتيجة.${
          allFilled && !approved ? " الطلب الآن بانتظار الاعتماد." : ""
        }`
      );
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
    await client.models.Order.update({
      id: order.id,
      status: "COLLECTED",
      collectedAt: new Date().toISOString(),
      collectedBy: session.email,
    });
    await audit({
      entity: "Order",
      entityId: order.id,
      action: "SAMPLE_COLLECTED",
      actor: session.email,
      summary: `سحب عيّنة الطلب ${order.orderNo}`,
    });
    await load();
    setBusy(false);
  }

  async function approve() {
    if (!order) return;
    const pending = criticals.filter((c) => !c.criticalNotifiedAt);
    if (pending.length > 0) {
      const ok = window.confirm(
        `يوجد ${pending.length} قيمة حرجة لم يُسجَّل إبلاغ الطبيب بها. هل تريد الاعتماد رغم ذلك؟`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      for (const i of items) {
        await client.models.OrderItem.update({
          id: i.id,
          verifiedBy: session.email,
          verifiedAt: now,
        });
      }
      await client.models.Order.update({
        id: order.id,
        status: "APPROVED",
        approvedAt: now,
        approvedBy: session.name || session.email,
      });
      await audit({
        entity: "Order",
        entityId: order.id,
        action: "ORDER_APPROVED",
        actor: session.email,
        summary: `اعتماد الطلب ${order.orderNo} (${items.length} فحص)`,
      });
      setMsg("تم اعتماد النتائج — التقرير جاهز للطباعة.");
      await load();
    } catch (e) {
      setMsg(`تعذّر الاعتماد: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function notifyCritical(item: Item) {
    const who = window.prompt(
      `اسم الطبيب/الجهة التي أُبلغت بالقيمة الحرجة لفحص «${item.testNameAr}»:`
    );
    if (!who) return;
    await client.models.OrderItem.update({
      id: item.id,
      criticalNotifiedTo: who,
      criticalNotifiedAt: new Date().toISOString(),
    });
    await audit({
      entity: "OrderItem",
      entityId: item.id,
      action: "CRITICAL_NOTIFIED",
      actor: session.email,
      summary: `إبلاغ ${who} بقيمة حرجة في ${item.testNameAr}`,
    });
    await load();
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
            {order.priority === "URGENT" && (
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
              {busy ? "جارٍ الحفظ…" : "حفظ النتائج"}
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
            <Link href={`/orders/${order.id}/report`} className="btn primary">
              التقرير 🖨️
            </Link>
          )}
        </div>
      </div>

      {msg && <div className="alert">{msg}</div>}

      {criticals.length > 0 && (
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
          {session.can("amendApproved") &&
            " · أي تعديل الآن يُسجَّل كتعديل على تقرير معتمد."}
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
        <div className="stat">
          <div className="label">الفاتورة</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {fmtMoney((order.totalPrice ?? 0) - (order.discount ?? 0))}
          </div>
          <div className="sub">
            مدفوع {fmtMoney(order.paidAmount)}
          </div>
        </div>
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

      {!canEnter && !approved && (
        <p className="muted small" style={{ marginTop: 12 }}>
          صلاحيتك الحالية لا تسمح بإدخال النتائج.
        </p>
      )}
    </>
  );
}
