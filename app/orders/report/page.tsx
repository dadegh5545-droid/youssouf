"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { client, listAll, parseJson } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";
import type { Schema } from "@/amplify/data/resource";
import {
  DEPARTMENT_LABEL,
  FLAG_META,
  SEX_LABEL,
  ageLabel,
  fmtDateTime,
  isCritical,
  verificationCode,
  type Flag,
} from "@/lib/lab";

type Order = Schema["Order"]["type"];
type Patient = Schema["Patient"]["type"];
type Item = Schema["OrderItem"]["type"];

const LAB = {
  name: "مختبر النور الطبي",
  subtitle: "Al-Noor Medical Laboratory",
  license: "ترخيص وزارة الصحة رقم 1234/م",
  contact: "الرياض — هاتف 0112345678",
};

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">جارٍ التحميل…</p>}>
      <ReportPage />
    </Suspense>
  );
}

function ReportPage() {
  // اسم المختبر من الإعدادات — الترويسة الثابتة أدناه احتياط قبل ضبطها.
  const { labName } = useLabConfig();
  const params = useSearchParams();
  const orderId = params.get("id") ?? "";
  /* مسار المريض: رقم الطلب + الرقم المُتحقِّق في العنوان بدل معرّف
     داخلي، لأن الزائر لا يملك قراءة الجداول — الخادم وحده يجلب له. */
  const lookupNo = params.get("no") ?? "";
  const lookupVerify = params.get("v") ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // الزائر: كل شيء عبر بوابة واحدة تتحقّق من الرقمين على الخادم.
      if (lookupNo && lookupVerify) {
        const res = await client.queries.getMyReport({
          orderNo: lookupNo,
          verifyId: lookupVerify,
        });
        const payload = parseJson<{ status: string; order: Order; patient: Patient; items: Item[] }>(res.data);
        if (payload?.status === "OK") {
          setOrder(payload.order as Order);
          setPatient(payload.patient as Patient);
          setItems(payload.items as Item[]);
        }
        setLoading(false);
        return;
      }

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
        // استعلام مفهرس — لا Scan للجدول (انظر التعليق في صفحة الطلب)
        listAll<Item>((nextToken) =>
          client.models.OrderItem.listOrderItemsByOrder(
            { orderId: o.id },
            { limit: 200, nextToken }
          )
        ),
      ]);
      setPatient(p ?? null);
      setItems(
        [...its].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100))
      );
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [orderId, lookupNo, lookupVerify]);

  const grouped = useMemo<[string, Item[]][]>(() => {
    const map = new Map<string, Item[]>();
    items
      .filter((i) => i.valueNumeric != null || i.valueText)
      .forEach((i) => {
        const k = i.department ?? "OTHER";
        map.set(k, [...(map.get(k) ?? []), i]);
      });
    return Array.from(map.entries());
  }, [items]);

  if (loading) return <p className="muted">جارٍ التحميل…</p>;
  if (!order || !patient)
    return (
      <div className="empty">
        <span className="icon">🔍</span>
        التقرير غير متاح.
      </div>
    );

  const isApproved = order.status === "APPROVED" || order.status === "DELIVERED";
  const isCancelled = order.status === "CANCELLED";
  const revision = order.reportRevision ?? 1;

  /* رمز التحقق يُشتقّ من محتوى التقرير نفسه، فأي تغيير في قيمة نتيجة
     أو في رقم المراجعة يغيّر الرمز. يقارَن الرمز المطبوع بما يعرضه
     النظام عند الاستفسار عن صحّة تقرير. (كاشف تلاعب لا توقيع رقمي.) */
  const verifyCode = verificationCode([
    order.orderNo,
    patient.mrn,
    order.approvedAt,
    revision,
    ...items.map((i) => `${i.testCode}=${i.valueNumeric ?? i.valueText ?? ""}:${i.flag ?? ""}`),
  ]);

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        {/* الزائر يعود إلى بحثه، والموظف إلى الطلب — صفحة الطلب محجوبة عنه. */}
        {lookupNo ? (
          <Link href="/" className="btn">
            ← بحث جديد
          </Link>
        ) : (
          <Link href={`/orders/view?id=${order.id}`} className="btn">
            ← رجوع للطلب
          </Link>
        )}
        <button className="btn primary" onClick={() => window.print()}>
          🖨️ طباعة / حفظ PDF
        </button>
        {isCancelled ? (
          <span className="badge critical">طلب ملغى — لا يُطبع</span>
        ) : (
          !isApproved && (
            <span className="badge warn">
              مسودّة — لم تُعتمد النتائج بعد، لا تُسلَّم للمريض
            </span>
          )
        )}
      </div>

      <div className="report">
        <div className="report-head">
          <div>
            <h1>{labName || LAB.name}</h1>
            <div className="muted small">{LAB.subtitle}</div>
            <div className="muted small">{LAB.license}</div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
              تقرير نتائج مختبرية
              {revision > 1 && ` — مراجعة ${revision}`}
            </div>
            <div className="mono small">{order.orderNo}</div>
            <div className="muted small">{LAB.contact}</div>
          </div>
        </div>

        {isCancelled && (
          <div
            style={{
              border: "2px solid #b91c1c",
              background: "#fee2e2",
              color: "#b91c1c",
              padding: "8px 12px",
              borderRadius: 8,
              marginBottom: 16,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            طلب ملغى — {order.cancelReason || "بلا سبب مسجّل"}
          </div>
        )}

        {revision > 1 && (
          <div
            style={{
              border: "2px solid #b45309",
              background: "#fef3c7",
              color: "#92400e",
              padding: "8px 12px",
              borderRadius: 8,
              marginBottom: 16,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            تقرير مُصحَّح (مراجعة {revision}) — يُلغي ويستبدل أي نسخة سابقة
            <div style={{ fontWeight: 400, marginTop: 4 }}>
              سبب التصحيح: {order.amendReason || "—"} · بواسطة {order.amendedBy} في{" "}
              {fmtDateTime(order.amendedAt)}
            </div>
          </div>
        )}

        {!isApproved && !isCancelled && (
          <div
            style={{
              border: "2px dashed #b91c1c",
              color: "#b91c1c",
              padding: "8px 12px",
              borderRadius: 8,
              marginBottom: 16,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            مسودّة غير معتمدة — للاستخدام الداخلي فقط
          </div>
        )}

        <div className="report-meta">
          <div>
            <div className="k">اسم المريض</div>
            <div>{patient.fullName}</div>
          </div>
          <div>
            <div className="k">رقم الملف</div>
            <div className="mono">{patient.mrn}</div>
          </div>
          <div>
            <div className="k">الجنس / العمر</div>
            <div>
              {SEX_LABEL[patient.sex ?? ""]} · {ageLabel(patient.birthDate)}
            </div>
          </div>
          <div>
            <div className="k">الطبيب المُحوِّل</div>
            <div>{order.referringDoctor || "—"}</div>
          </div>
          <div>
            <div className="k">تاريخ سحب العيّنة</div>
            <div>{fmtDateTime(order.collectedAt ?? order.createdAt)}</div>
          </div>
          <div>
            <div className="k">تاريخ إصدار التقرير</div>
            <div>{fmtDateTime(order.approvedAt ?? new Date().toISOString())}</div>
          </div>
        </div>

        {grouped.length === 0 ? (
          <p className="muted">لا توجد نتائج مُدخلة بعد.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الفحص</th>
                <th>النتيجة</th>
                <th>الوحدة</th>
                <th>المدى المرجعي</th>
                <th>الدلالة</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([dept, list]) => (
                <Fragment key={dept}>
                  <tr className="dept-head">
                    <td colSpan={5}>{DEPARTMENT_LABEL[dept] ?? dept}</td>
                  </tr>
                  {list.map((i) => {
                    const flag = (i.flag ?? null) as Flag | null;
                    const meta = flag ? FLAG_META[flag] : null;
                    const abnormal = flag && flag !== "NORMAL";
                    const value =
                      i.valueNumeric != null ? String(i.valueNumeric) : i.valueText;
                    return (
                      <tr key={i.id}>
                        <td>
                          {i.testNameAr}
                          {i.comment && (
                            <div className="small muted">ملاحظة: {i.comment}</div>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              isCritical(flag)
                                ? "val-crit"
                                : abnormal
                                ? "val-abn"
                                : ""
                            }
                          >
                            {value}
                          </span>
                        </td>
                        <td>{i.unit || "—"}</td>
                        <td>{i.refText || "—"}</td>
                        <td>{meta && abnormal ? meta.label : "طبيعي"}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <div className="report-foot">
          <div>
            <div>اعتمد النتائج:</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>
              {order.approvedBy || "— بانتظار الاعتماد —"}
            </div>
            <div>{fmtDateTime(order.approvedAt)}</div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div>رمز التحقق</div>
            <div className="mono" style={{ fontWeight: 700, letterSpacing: 1 }}>
              {verifyCode}
            </div>
            <div className="muted small">
              يُطابَق مع النظام للتأكد من عدم تغيير النتائج
            </div>
          </div>
        </div>

        <div className="report-disclaimer">
          هذه النتائج تخصّ العيّنة المذكورة أعلاه فقط ولا تُغني عن استشارة الطبيب
          المعالج. أي قيمة خارج المدى المرجعي تُفسَّر ضمن الحالة السريرية للمريض.
        </div>
      </div>
    </>
  );
}
