import { defineFunction } from "@aws-amplify/backend";

/**
 * بوابة تقرير المريض.
 *
 * وجودها ضروري لأن صلاحيات AppSync على مستوى الجدول لا الصفّ: لو مُنح
 * الزائر `read` على `Order` و`Patient` لاستطاع من يستدعي الـ API مباشرةً
 * قراءة طلبات غيره مهما فعلت الواجهة. هذه الدالة هي المنفذ الوحيد
 * للزائر: تتحقّق من رقم الطلب ورقم الملف/الجوال معًا قبل أن ترجع شيئًا.
 */
export const getMyReport = defineFunction({
  name: "get-my-report",
  entry: "./handler.ts",
  timeoutSeconds: 20,
});
