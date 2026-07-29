/**
 * أسماء أحداث سجل التدقيق بالعربية.
 *
 * في وحدة مشتركة لا في صفحة السجل: الحدث نفسه يظهر في صفحة السجل وفي
 * «سجل هذا الطلب» داخل صفحة الطلب. لو نُسخ الجدول في الموضعين لظهر حدث
 * جديد مترجَمًا في شاشة وبرمزه الإنجليزي في الأخرى.
 */
export const ACTION_LABEL: Record<string, string> = {
  PATIENT_CREATED: "تسجيل مريض",
  PATIENT_UPDATED: "تعديل بيانات مريض",
  ORDER_CREATED: "إنشاء طلب",
  SAMPLE_COLLECTED: "سحب عيّنة",
  RESULT_ENTERED: "إدخال نتيجة",
  RESULT_AMENDED: "تعديل نتيجة معتمدة",
  ORDER_APPROVED: "اعتماد نتائج",
  REPORT_AMENDED: "تصحيح تقرير معتمد",
  REPORT_DELIVERED: "تسليم تقرير",
  ORDER_CANCELLED: "إلغاء طلب",
  CRITICAL_NOTIFIED: "إبلاغ عن قيمة حرجة",
  PAYMENT_RECORDED: "تسجيل دفعة",
  PRICE_CHANGED: "تغيير سعر",
  TEST_CREATED: "إضافة فحص",
  TEST_UPDATED: "تعديل فحص",
  STAFF_ADD_GROUP: "منح صلاحية",
  STAFF_REMOVE_GROUP: "سحب صلاحية",
  STAFF_ENABLE: "تفعيل حساب",
  STAFF_DISABLE: "تعطيل حساب",
  STAFF_RESET_PASSWORD: "إعادة تعيين كلمة مرور",
};

/** الإجراءات التي تستحق انتباهًا عند المراجعة. */
export const NOTABLE = new Set([
  "RESULT_AMENDED",
  "REPORT_AMENDED",
  "ORDER_CANCELLED",
  "PRICE_CHANGED",
  "STAFF_ADD_GROUP",
  "STAFF_REMOVE_GROUP",
  "STAFF_DISABLE",
]);

/** اسم الحدث بالعربية، وإلا رمزه كما هو — لا سطر بلا عنوان. */
export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;
