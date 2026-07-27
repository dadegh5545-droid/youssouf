"use client";

import { Authenticator, translations } from "@aws-amplify/ui-react";
import { I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-react/styles.css";
import "@/lib/amplify"; // يُهيّئ Amplify.configure مرة واحدة
import Nav from "./components/Nav";

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

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Authenticator variation="modal" signUpAttributes={["name"]}>
      <Nav />
      <div className="container">{children}</div>
    </Authenticator>
  );
}
