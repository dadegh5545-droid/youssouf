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
  TUBE_VERIFIED: "مطابقة أنبوب",
  TUBE_MISMATCH: "أنبوب غير مطابق",
  DAY_BACKFILLED: "ملء رجعي ليوم الطلب",
  PAYMENTS_MIGRATED: "ترحيل أرصدة سابقة",
  PAYMENT_RECORDED: "تسجيل دفعة",
  PAYMENT_VOIDED: "إبطال دفعة",
  PRICE_CHANGED: "تغيير سعر",
  TEST_CREATED: "إضافة فحص",
  TEST_UPDATED: "تعديل فحص",
  RANGES_APPROVED: "اعتماد مديات مرجعية",
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
  // «كاد أن يقع»: أنبوب مريض أمام طلب مريض آخر. أهمّ ما يُراجَع.
  "TUBE_MISMATCH",
  // مال قُبض ثم أُلغي قبضه — أول ما تسأل عنه مراجعة الصندوق.
  "PAYMENT_VOIDED",
  "PRICE_CHANGED",
  "STAFF_ADD_GROUP",
  "STAFF_REMOVE_GROUP",
  "STAFF_DISABLE",
]);

/** اسم الحدث بالعربية، وإلا رمزه كما هو — لا سطر بلا عنوان. */
export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;
