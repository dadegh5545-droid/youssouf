"use client";

import Link from "next/link";

/** ما يراه الزائر إن فتح صفحة من صفحات الموظفين. */
export default function StaffOnly() {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-head">
        <h2>🔒 هذه الصفحة للموظفين</h2>
      </div>
      <p style={{ margin: "0 0 12px" }}>
        بصفتك زائرًا يمكنك البحث عن تقريرك وقراءته فقط. أما تسجيل المرضى
        والطلبات وإدخال النتائج فتتطلّب حساب موظف.
      </p>
      <div className="row">
        <Link href="/" className="btn primary">
          البحث عن تقريري
        </Link>
        <Link href="/login" className="btn">
          تسجيل الدخول
        </Link>
      </div>
    </div>
  );
}
