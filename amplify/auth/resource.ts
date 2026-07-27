import { defineAuth } from "@aws-amplify/backend";

/**
 * مصادقة نظام المختبر.
 * الأدوار (Cognito groups) مرتبة من الأعلى صلاحية للأدنى:
 *   admin     : المدير — كل شيء
 *   quality   : مسؤول الجودة — مراجعة واعتماد النتائج
 *   tech      : فني المختبر — إدخال النتائج
 *   reception : الاستقبال — تسجيل المرضى والطلبات
 *   doctor    : الطبيب المُحوِّل — قراءة فقط
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    fullname: { required: false, mutable: true },
    phoneNumber: { required: false, mutable: true },
  },
  groups: ["admin", "quality", "tech", "reception", "doctor"],
});
