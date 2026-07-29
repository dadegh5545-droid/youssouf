"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { client, listAll, listPayments, type Payment } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";
import Barcode from "@/app/components/Barcode";
import type { Schema } from "@/amplify/data/resource";
import {
  SEX_LABEL,
  ageLabel,
  fmtDateTime,
  fmtMoney,
  orderDue,
  orderNet,
  sumPayments,
} from "@/lib/lab";

type Order = Schema["Order"]["type"];
type Patient = Schema["Patient"]["type"];
type Item = Schema["OrderItem"]["type"];

/**
 * إيصال المريض وملصقات الأنابيب.
 *
 * ورقتان من مصدر واحد لأنهما تُطبعان في اللحظة نفسها عند الاستقبال:
 *
 * • الإيصال: ما يأخذه المريض. يحمل رقم الطلب مطبوعًا وباركودًا، وهو
 *   الرقم الذي يستعلم به عن نتيجته لاحقًا. قبل هذه الصفحة كانت واجهة
 *   المريض تحيله إلى «الرقم المطبوع على إيصالك» ولا إيصال يُطبع.
 *
 * • ملصقات الأنابيب: ملصق لكل أنبوب مطلوب، عليه الباركود واسم المريض
 *   ونوع الأنبوب. كتابة الرقم بخط اليد على الأنبوب أشيع أسباب نسبة
 *   العيّنة إلى المريض الخطأ.
 */
export default function Page() {
  return (
    <Suspense fallback={<p className="muted">جارٍ التحميل…</p>}>
      <ReceiptPage />
    </Suspense>
  );
}

function ReceiptPage() {
  const { labName, currency } = useLabConfig();
  const params = useSearchParams();
  const orderId = params.get("id") ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  /* الإيصال وثيقة مال بيد المريض: المقبوض فيه يُقرأ من سطور `Payment`
     لا من النسخة المخبَّأة على الطلب — إيصال يخالف السجل يفتح نزاعًا. */
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  /* الإيصال والملصقات لا يُطبعان معًا: الأول على ورق A4 أو حرارية إيصالات،
     والثاني على ورق ملصقات. الطباعة الواحدة تفسد أحدهما. */
  const [view, setView] = useState<"receipt" | "labels">("receipt");

  useEffect(() => {
    (async () => {
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
        listAll<Item>((nextToken) =>
          client.models.OrderItem.listOrderItemsByOrder(
            { orderId: o.id },
            { limit: 200, nextToken }
          )
        ),
      ]);
      setPatient(p ?? null);
      setItems([...its].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100)));
      // من لا يملك صلاحية على `Payment` يُطبع له الإيصال بالنسخة المخبَّأة
      // بدل أن تفشل الصفحة كلها — الملصقات لا شأن لها بالمال.
      try {
        setPayments(await listPayments(o.id));
      } catch {
        setPayments([]);
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [orderId]);

  /* أنبوب واحد يكفي لعدة فحوصات من النوع نفسه، فالفحوصات تُجمَّع حسب
     الأنبوب: ثلاثة فحوصات كيمياء = ملصق واحد لا ثلاثة. */
  const tubes = useMemo(() => {
    const map = new Map<string, { tube: string; sample: string; tests: string[] }>();
    for (const i of items) {
      const tube = i.tubeType?.trim() || "غير محدَّد";
      const sample = i.sampleType?.trim() || "";
      const key = `${tube}|${sample}`;
      const entry = map.get(key) ?? { tube, sample, tests: [] };
      entry.tests.push(i.testNameAr);
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [items]);

  if (loading) return <p className="muted">جارٍ التحميل…</p>;
  if (!order || !patient)
    return (
      <div className="empty">
        <span className="icon">🧾</span>
        الطلب غير موجود.
      </div>
    );

  const total = order.totalPrice ?? 0;
  const discount = order.discount ?? 0;
  const net = orderNet(total, discount);
  const paid = payments.length ? sumPayments(payments) : order.paidAmount ?? 0;
  const due = orderDue(net, paid);

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Link href={`/orders/view?id=${order.id}`} className="btn">
          ← رجوع للطلب
        </Link>
        <button
          className={`btn ${view === "receipt" ? "primary" : ""}`}
          onClick={() => setView("receipt")}
        >
          🧾 إيصال المريض
        </button>
        <button
          className={`btn ${view === "labels" ? "primary" : ""}`}
          onClick={() => setView("labels")}
        >
          🏷️ ملصقات الأنابيب ({tubes.length})
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>
          🖨️ طباعة
        </button>
      </div>

      <div className="alert no-print">
        {view === "receipt" ? (
          <>
            سلّم هذا الإيصال للمريض: رقم الطلب المطبوع عليه هو ما يستعلم به عن
            نتيجته من الصفحة الرئيسية.
          </>
        ) : (
          <>
            ألصق كل ملصق على أنبوبه <strong>قبل</strong> السحب، وتأكّد من اسم
            المريض على الملصق أمامه. جرّب الماسح على أول ملصق تطبعه قبل
            اعتماد الطابعة.
          </>
        )}
      </div>

      {view === "receipt" ? (
        <div className="report">
          <div className="report-head">
            <div>
              <h1>{labName || "المختبر"}</h1>
              <div className="muted small">إيصال استلام عيّنة وفاتورة</div>
            </div>
            <div style={{ textAlign: "left" }}>
              <Barcode value={order.orderNo} height={44} />
            </div>
          </div>

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
              <div className="k">تاريخ الطلب</div>
              <div>{fmtDateTime(order.createdAt)}</div>
            </div>
            <div>
              <div className="k">الطبيب المُحوِّل</div>
              <div>{order.referringDoctor || "—"}</div>
            </div>
            <div>
              <div className="k">الأولوية</div>
              <div>{order.priority === "URGENT" ? "مستعجل" : "عادي"}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>الفحص</th>
                <th className="num">السعر</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.testNameAr}</td>
                  <td className="num">{fmtMoney(i.price ?? 0, currency)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>الإجمالي</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmtMoney(total, currency)}
                </td>
              </tr>
              {discount > 0 && (
                <tr>
                  <td>الخصم</td>
                  <td className="num">− {fmtMoney(discount, currency)}</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 700 }}>الصافي</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmtMoney(net, currency)}
                </td>
              </tr>
              <tr>
                <td>المدفوع</td>
                <td className="num">{fmtMoney(paid, currency)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>المتبقّي</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmtMoney(due, currency)}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              border: "1px dashed #94a3b8",
              borderRadius: 8,
              padding: "10px 14px",
              marginTop: 18,
              lineHeight: 1.9,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              كيف تستعلم عن نتيجتك
            </div>
            افتح صفحة المختبر، وأدخل <strong>رقم الطلب</strong> أعلاه مع{" "}
            <strong>رقم ملفك</strong> <span className="mono">({patient.mrn})</span>{" "}
            أو رقم جوّالك. لا تظهر النتيجة قبل اعتمادها من مسؤول الجودة، فقد
            تتغيّر قبل ذلك.
            <div className="muted small" style={{ marginTop: 6 }}>
              احتفظ بهذا الإيصال — رقم الطلب لا يُستخرج إلا منه أو من الاستقبال.
            </div>
          </div>

          <div className="report-foot">
            <div>
              <div>استلم الطلب:</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                ……………………………………
              </div>
            </div>
            <div style={{ textAlign: "left" }}>
              <div className="mono" style={{ fontWeight: 700 }}>
                {order.orderNo}
              </div>
              <div className="muted small">{fmtDateTime(order.createdAt)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="labels">
          {tubes.length === 0 ? (
            <div className="empty">لا فحوصات في هذا الطلب.</div>
          ) : (
            tubes.map((t, idx) => (
              <div className="label-card" key={`${t.tube}-${idx}`}>
                <div className="label-head">
                  <strong>{patient.fullName}</strong>
                  <span className="mono small">{patient.mrn}</span>
                </div>
                <Barcode value={order.orderNo} height={40} unit={1.5} />
                <div className="label-tube">
                  {t.tube}
                  {t.sample && <span className="muted"> · {t.sample}</span>}
                </div>
                <div className="label-tests">{t.tests.join(" · ")}</div>
                <div className="label-foot small muted">
                  {fmtDateTime(order.createdAt)} · أنبوب {idx + 1} من {tubes.length}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
