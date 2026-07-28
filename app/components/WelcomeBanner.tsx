"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/amplify";
import { useLabConfig } from "@/lib/config";

const DISMISS_KEY = "lis.welcome.dismissed";

/**
 * ترحيب بالزائر الذي يدخل بلا تسجيل دخول.
 *
 * يظهر للزوار وحدهم — من سجّل دخوله لا يحتاج شرحًا لوضعه. ويُخفى بعد
 * الإغلاق طوال الجلسة (`sessionStorage`) حتى لا يتكرّر في كل صفحة.
 */
export default function WelcomeBanner() {
  const session = useSession();
  const { labName } = useLabConfig();
  const [dismissed, setDismissed] = useState(true); // نبدأ مخفيًا: لا وميض قبل قراءة التخزين

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  function close() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  if (session.loading || !session.guest || dismissed) return null;

  return (
    <div className="card no-print" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2>👋 أهلًا بك في {labName}</h2>
        <button className="btn sm ghost" onClick={close} aria-label="إغلاق الترحيب">
          ✕
        </button>
      </div>

      <p style={{ margin: "0 0 10px" }}>
        أنت تتصفّح <strong>كزائر</strong> بدون تسجيل دخول، وكل شيء متاح لك:
        سجّل مريضًا، أنشئ طلب فحص، أدخل النتائج، ثم اعتمدها واطبع التقرير.
      </p>

      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <Link href="/orders/new" className="btn primary">
          ابدأ بطلب فحص جديد
        </Link>
        <Link href="/catalog" className="btn">
          تصفّح كتالوج الفحوصات
        </Link>
        <Link href="/login" className="btn ghost">
          تسجيل الدخول كموظف
        </Link>
      </div>

      <p className="small muted" style={{ margin: "10px 0 0" }}>
        ملاحظة: البيانات التي تُدخلها كزائر يراها كل الزوار — لا تُدخل بيانات
        مرضى حقيقية. سجّل دخولك ليُحفظ اسمك في سجل التدقيق وتعمل ضمن دورك.
      </p>
    </div>
  );
}
