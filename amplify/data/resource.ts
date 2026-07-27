import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * نموذج بيانات نظام إدارة المختبر الطبي (LIS).
 *
 * رحلة العيّنة:
 *   Patient → Order → OrderItem (فحص واحد) → نتيجة + عَلَم (flag) → اعتماد → تقرير
 *
 * كل تعديل على نتيجة معتمدة يُسجَّل في AuditLog.
 */
const schema = a.schema({
  /* ── قوائم ثابتة ──────────────────────────────────────────── */
  Sex: a.enum(["MALE", "FEMALE"]),

  Department: a.enum([
    "CHEMISTRY", // كيمياء حيوية
    "HEMATOLOGY", // أمراض الدم
    "IMMUNOLOGY", // مناعة ومصليات
    "HORMONES", // هرمونات
    "MICROBIOLOGY", // أحياء دقيقة
    "URINALYSIS", // تحليل بول وبراز
  ]),

  ResultType: a.enum(["NUMERIC", "TEXT", "OPTION"]),

  OrderStatus: a.enum([
    "REGISTERED", // مسجّل — بانتظار سحب العيّنة
    "COLLECTED", // تم سحب العيّنة
    "IN_PROGRESS", // جارٍ إدخال النتائج
    "PENDING_REVIEW", // مكتمل — بانتظار الاعتماد
    "APPROVED", // معتمد
    "DELIVERED", // سُلّم للمريض
    "CANCELLED", // ملغى
  ]),

  Priority: a.enum(["ROUTINE", "URGENT"]),

  ResultFlag: a.enum([
    "NORMAL",
    "LOW",
    "HIGH",
    "CRITICAL_LOW",
    "CRITICAL_HIGH",
    "ABNORMAL",
  ]),

  /* ── نوع مضمّن: المدى المرجعي ────────────────────────────────
     المدى يختلف حسب الجنس والعمر، لذلك كل فحص يحمل قائمة مديات
     ويُختار المدى المطابق للمريض وقت إدخال النتيجة.            */
  ReferenceRange: a.customType({
    sex: a.string(), // MALE | FEMALE | null = الاثنان
    ageMinYears: a.float(),
    ageMaxYears: a.float(),
    low: a.float(),
    high: a.float(),
    text: a.string(), // للمديات غير الرقمية: "سلبي"
  }),

  /* ── كتالوج الفحوصات ────────────────────────────────────────
     مرجع ثابت يديره المدير. الاستنساخ في OrderItem مقصود:
     تغيير سعر أو مدى مرجعي لاحقًا يجب ألا يغيّر تقارير قديمة.   */
  LabTest: a
    .model({
      code: a.string().required(), // GLU, HGB, TSH …
      nameAr: a.string().required(),
      nameEn: a.string(),
      department: a.ref("Department").required(),
      resultType: a.ref("ResultType").required(),
      unit: a.string(),
      sampleType: a.string(), // دم وريدي / بول / مسحة …
      price: a.float().default(0),
      options: a.string().array(), // لفحوصات OPTION: ["إيجابي","سلبي"]
      ranges: a.ref("ReferenceRange").array(),
      criticalLow: a.float(), // قيمة حرجة تستوجب اتصالًا فوريًا
      criticalHigh: a.float(),
      panelOf: a.string().array(), // باقة: أكواد الفحوصات المكوّنة لها
      sortOrder: a.integer().default(100),
      active: a.boolean().default(true),
    })
    .secondaryIndexes((index) => [index("code")])
    .authorization((allow) => [
      allow.groups(["admin"]),
      allow.authenticated().to(["read"]),
    ]),

  /* ── المريض ─────────────────────────────────────────────────── */
  Patient: a
    .model({
      mrn: a.string().required(), // رقم الملف الطبي
      fullName: a.string().required(),
      sex: a.ref("Sex").required(),
      birthDate: a.date(),
      phone: a.string(),
      nationalId: a.string(),
      address: a.string(),
      notes: a.string(),
      orders: a.hasMany("Order", "patientId"),
    })
    .secondaryIndexes((index) => [index("mrn")])
    .authorization((allow) => [
      allow.groups(["admin", "reception"]),
      allow.groups(["quality", "tech", "doctor"]).to(["read"]),
    ]),

  /* ── طلب الفحص ──────────────────────────────────────────────── */
  Order: a
    .model({
      orderNo: a.string().required(), // الرقم المطبوع على الباركود
      patientId: a.id().required(),
      patient: a.belongsTo("Patient", "patientId"),
      items: a.hasMany("OrderItem", "orderId"),
      status: a.ref("OrderStatus").required(),
      priority: a.ref("Priority"),
      referringDoctor: a.string(),
      clinicalNotes: a.string(), // الشكوى / التشخيص المبدئي
      collectedAt: a.datetime(),
      collectedBy: a.string(),
      approvedAt: a.datetime(),
      approvedBy: a.string(),
      deliveredAt: a.datetime(),
      totalPrice: a.float().default(0),
      paidAmount: a.float().default(0),
      discount: a.float().default(0),
    })
    .secondaryIndexes((index) => [index("orderNo")])
    .authorization((allow) => [
      allow.groups(["admin", "reception"]),
      allow.groups(["quality", "tech"]).to(["read", "update"]),
      allow.groups(["doctor"]).to(["read"]),
    ]),

  /* ── سطر داخل الطلب: فحص واحد ونتيجته ───────────────────────── */
  OrderItem: a
    .model({
      orderId: a.id().required(),
      order: a.belongsTo("Order", "orderId"),

      // نسخة مجمّدة من الكتالوج وقت الطلب
      testCode: a.string().required(),
      testNameAr: a.string().required(),
      department: a.ref("Department").required(),
      resultType: a.ref("ResultType").required(),
      unit: a.string(),
      options: a.string().array(),
      price: a.float().default(0),
      refLow: a.float(),
      refHigh: a.float(),
      refText: a.string(), // نص المدى كما يظهر في التقرير
      criticalLow: a.float(),
      criticalHigh: a.float(),
      sortOrder: a.integer().default(100),

      // النتيجة
      valueNumeric: a.float(),
      valueText: a.string(),
      flag: a.ref("ResultFlag"),
      comment: a.string(),
      enteredBy: a.string(),
      enteredAt: a.datetime(),
      verifiedBy: a.string(),
      verifiedAt: a.datetime(),
      criticalNotifiedTo: a.string(), // اسم من أُبلِغ بالقيمة الحرجة
      criticalNotifiedAt: a.datetime(),
    })
    .secondaryIndexes((index) => [index("testCode")])
    .authorization((allow) => [
      allow.groups(["admin", "quality", "tech"]),
      allow.groups(["reception"]).to(["create", "read", "delete"]),
      allow.groups(["doctor"]).to(["read"]),
    ]),

  /* ── سجل التدقيق — يُكتب ولا يُعدَّل ولا يُحذف ─────────────────── */
  AuditLog: a
    .model({
      entity: a.string().required(), // Order | OrderItem | Patient
      entityId: a.string().required(),
      action: a.string().required(), // RESULT_ENTERED | APPROVED | AMENDED …
      actor: a.string().required(),
      summary: a.string(),
      before: a.json(),
      after: a.json(),
    })
    .authorization((allow) => [
      allow.authenticated().to(["create", "read"]),
      allow.groups(["admin"]).to(["create", "read", "delete"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // بيانات صحية حسّاسة: لا وصول عبر مفتاح API عام.
    defaultAuthorizationMode: "userPool",
  },
});
