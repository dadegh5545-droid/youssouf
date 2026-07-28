"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * تسجيل دخول اختياري للموظفين.
 *
 * التطبيق مفتوح للزوار، لكن من يسجّل دخوله يُحفظ بريده في حقول
 * «أدخلها / اعتمدها» وفي سجل التدقيق، وتُطبَّق عليه قواعد دوره.
 */
export default function LoginPage() {
  return (
    <div style={{ maxWidth: 480, margin: "24px auto" }}>
      <div className="page-head">
        <div>
          <h1>تسجيل دخول الموظفين</h1>
          <p>
            الدخول اختياري — الزوار يستخدمون النظام بلا حساب. سجّل دخولك ليُنسب
            عملك إلى اسمك.
          </p>
        </div>
      </div>

      <Authenticator variation="default" signUpAttributes={["name"]}>
        {() => <RedirectHome />}
      </Authenticator>
    </div>
  );
}

/** بعد نجاح الدخول: عودة إلى لوحة اليوم بتحميل كامل ليُلتقط الرمز المميّز. */
function RedirectHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return <p className="muted">تم تسجيل الدخول — جارٍ التحويل…</p>;
}
