"use client";

import { translations } from "@aws-amplify/ui-react";
import { I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-react/styles.css";
import "@/lib/amplify"; // يُهيّئ Amplify.configure مرة واحدة
import { LabConfigProvider } from "@/lib/config";
import Nav from "./components/Nav";
import PendingBanner from "./components/PendingBanner";
import WelcomeBanner from "./components/WelcomeBanner";

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

/**
 * لا بوابة تسجيل دخول: التطبيق يُفتح مباشرة للزائر.
 *
 * كان `<Authenticator>` يلفّ كل شيء فلا يظهر أي محتوى قبل الدخول. الآن
 * الزائر يدخل ويجرّب كل الصفحات (الخادم يسمح له عبر `allow.guest()`)،
 * وتسجيل الدخول اختياري من `/login` لمن يريد أن يُسجَّل اسمه في
 * سجل التدقيق ويعمل ضمن دوره.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LabConfigProvider>
      <Nav />
      <div className="container">
        <WelcomeBanner />
        <PendingBanner />
        {children}
      </div>
    </LabConfigProvider>
  );
}
