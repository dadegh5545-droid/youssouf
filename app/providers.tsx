"use client";

import { translations } from "@aws-amplify/ui-react";
import { I18n } from "aws-amplify/utils";
import { usePathname } from "next/navigation";
import "@aws-amplify/ui-react/styles.css";
import { useSession } from "@/lib/amplify"; // يُهيّئ Amplify.configure مرة واحدة
import { LabConfigProvider } from "@/lib/config";
import Nav from "./components/Nav";
import PendingBanner from "./components/PendingBanner";
import StaffOnly from "./components/StaffOnly";

I18n.putVocabularies(translations);
I18n.setLanguage("ar");

// مصطلحات إضافية غير مترجمة افتراضيًا
I18n.putVocabulariesForLanguage("ar", {
  "Sign In": "تسجيل الدخول",
  "Sign in": "تسجيل الدخول",
  "Create Account": "إنشاء حساب",
  "Enter your Email": "أدخل البريد الإلكتروني",
  "Enter your Password": "أدخل كلمة المرور",
  Email: "البريد الإلكتروني",
  Password: "كلمة المرور",
  "Confirm Password": "تأكيد كلمة المرور",
  "Forgot your password?": "نسيت كلمة المرور؟",
});

/* الصفحات المسموحة للزائر: البحث عن تقريره، التقرير نفسه، وشاشة الدخول.
   ما عداها للموظفين. */
const GUEST_PATHS = ["/", "/login", "/orders/report"];

const isGuestPath = (pathname: string) =>
  GUEST_PATHS.includes(pathname.replace(/\/+$/, "") || "/");

/**
 * لا بوابة تسجيل دخول على مستوى التطبيق: الزائر يدخل مباشرة إلى البحث عن
 * تقريره. والحجب يتم هنا في نقطة واحدة لا داخل كل صفحة — صفحة جديدة
 * تُضاف لاحقًا تكون محجوبة عن الزائر تلقائيًا، وهو الخطأ الآمن.
 *
 * هذا حجب واجهة فقط؛ التطبيق الفعلي في قواعد `authorization` بالمخطط:
 * الزائر لا يملك إلا `read`.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LabConfigProvider>
      <Nav />
      <div className="container">
        <PendingBanner />
        <Gate>{children}</Gate>
      </div>
    </LabConfigProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const pathname = usePathname() || "/";

  // قبل معرفة الجلسة لا نعرض المحتوى ولا لافتة الحجب: أيّهما ظهر ثم
  // انقلب أحدث وميضًا مربكًا.
  if (session.loading && !isGuestPath(pathname)) {
    return <p className="muted">جارٍ التحميل…</p>;
  }
  if (session.guest && !isGuestPath(pathname)) return <StaffOnly />;
  return <>{children}</>;
}
