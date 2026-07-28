"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { client } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";
import { STATUS_META, fmtDateTime } from "@/lib/lab";

/**
 * بوابة الزائر: البحث عن تقريره وحده.
 *
 * التحقّق برقمين معًا (رقم الطلب المطبوع على الإيصال + رقم الملف أو
 * الجوال) لا برقم واحد: رقم الطلب متسلسل يسهل تخمينه، فاشتراط رقم ثانٍ
 * يمنع فتح تقارير الآخرين بالتجريب.
 *
 * ولا يُعرض التقرير قبل الاعتماد: نتيجة غير معتمدة قد تتغيّر بعد مراجعة
 * مسؤول الجودة، وتسليمها للمريض يعني تسليم نتيجة قد تُسحب.
 */
export default function ReportLookup() {
  const router = useRouter();
  const { labName } = useLabConfig();
  const [orderNo, setOrderNo] = useState("");
  const [idNo, setIdNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");

    const no = orderNo.trim();
    const id = idNo.trim();
    if (!no || !id) {
      setError("أدخل رقم الطلب ورقم الملف أو الجوال معًا.");
      return;
    }

    setBusy(true);
    try {
      const { data, errors } = await client.models.Order.listOrdersByOrderNo(
        { orderNo: no },
        { limit: 1 }
      );
      if (errors?.length) throw new Error(errors[0].message);
      const order = data?.[0];

      // رسالة واحدة لعدم وجود الطلب ولعدم تطابق الرقم الثاني: التفريق
      // بينهما يكشف أي أرقام طلبات موجودة فعلًا.
      const mismatch = "لا يوجد تقرير بهذه البيانات. تحقّق من الرقمين في إيصالك.";
      if (!order) {
        setError(mismatch);
        return;
      }

      const { data: patient } = await client.models.Patient.get({
        id: order.patientId,
      });
      const matches =
        patient?.mrn?.trim() === id ||
        patient?.phone?.trim().replace(/\s/g, "") === id.replace(/\s/g, "");
      if (!matches) {
        setError(mismatch);
        return;
      }

      if (order.status !== "APPROVED" && order.status !== "DELIVERED") {
        const st = STATUS_META[order.status ?? ""];
        setInfo(
          `تقريرك لم يُعتمد بعد — الحالة الآن: ${st?.label ?? order.status}. ` +
            `سُجّل الطلب ${fmtDateTime(order.createdAt)}. جرّب لاحقًا أو راجع الاستقبال.`
        );
        return;
      }

      router.push(`/orders/report?id=${order.id}`);
    } catch (e) {
      setError(`تعذّر البحث: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>👋 أهلًا بك في {labName}</h1>
          <p>
            اطّلع على نتيجة تحاليلك بنفسك: أدخل رقم الطلب المطبوع على إيصالك مع
            رقم ملفك أو رقم جوالك.
          </p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-head">
          <h2>البحث عن تقريري</h2>
        </div>

        <form onSubmit={search}>
          <div className="field">
            <label>رقم الطلب</label>
            <input
              className="mono"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="مثال: 24-000123"
              autoFocus
            />
            <div className="hint">مطبوع أعلى الإيصال وعلى ملصق الأنبوب.</div>
          </div>

          <div className="field">
            <label>رقم الملف أو رقم الجوال</label>
            <input
              className="mono"
              value={idNo}
              onChange={(e) => setIdNo(e.target.value)}
              placeholder="رقم الملف أو 05xxxxxxxx"
            />
          </div>

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "جارٍ البحث…" : "عرض تقريري"}
          </button>
        </form>

        {error && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        {info && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            {info}
          </div>
        )}
      </div>

      <p className="small muted" style={{ marginTop: 14, maxWidth: 560 }}>
        النتائج لا تُغني عن استشارة الطبيب. لأي استفسار عن تقريرك راجع المختبر —
        الموظفون يدخلون النظام من زرّ «تسجيل الدخول» أعلى الصفحة.
      </p>
    </>
  );
}
