import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { getMyReport } from "../functions/get-my-report/resource";
import { manageStaff } from "../functions/manage-staff/resource";
import { nextOrderNo } from "../functions/next-order-no/resource";

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

  PaymentMethod: a.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),

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
      tubeType: a.string(), // أنبوب أحمر / بنفسجي EDTA / أزرق سترات …
      price: a.float().default(0),
      options: a.string().array(), // لفحوصات OPTION: ["إيجابي","سلبي"]
      ranges: a.ref("ReferenceRange").array(),
      criticalLow: a.float(), // قيمة حرجة تستوجب اتصالًا فوريًا
      criticalHigh: a.float(),
      panelOf: a.string().array(), // باقة: أكواد الفحوصات المكوّنة لها
      sortOrder: a.integer().default(100),
      active: a.boolean().default(true),

      /* اعتماد المديات المرجعية (ISO 15189 §5.5.2).
         المديات في الكتالوج تصل مع البذرة تقريبيّة، ومختبر يعمل بمرضى
         حقيقيين لا يجوز أن يعلّم نتيجة «طبيعية» أو «حرجة» بمدى لم يراجعه
         مسؤول الجودة وفق أجهزته وكواشفه ومجتمع مرضاه. هذان الحقلان
         يحوّلان التحذير من سطر في التوثيق إلى حالة ظاهرة في كل شاشة:
         بلا اعتماد يظهر الفحص موسومًا في الكتالوج وشاشة النتائج وعلى
         التقرير المطبوع.

         `rangesHash` بصمة المديات وقت الاعتماد: تعديلها بعده يُسقط
         الاعتماد تلقائيًا، وإلا صار الاعتماد ختمًا يُؤخذ مرة ثم تُغيَّر
         الأرقام تحته.                                                */
      rangesApprovedBy: a.string(),
      rangesApprovedAt: a.datetime(),
      rangesHash: a.string(),
    })
    .secondaryIndexes((index) => [index("code").queryField("listLabTestsByCode")])
    .authorization((allow) => [
      allow.groups(["admin"]),
      allow.authenticated().to(["read"]),
    ]),

  /* ── إعدادات المختبر ────────────────────────────────────────
     سجل واحد فقط (`key = "MAIN"`) يديره مدير المختبر: العملة المعروضة
     في الأسعار والفواتير، وقوائم أنواع العيّنات والأنابيب التي تظهر
     كخيارات جاهزة عند تعريف الفحوصات. القوائم هنا وليست ثوابت في
     الكود كي يضيف المدير نوعًا جديدًا بلا نشر جديد.                */
  LabConfig: a
    .model({
      key: a.string().required(), // "MAIN" — سجل مفرد
      labName: a.string(),
      /* ترويسة التقرير المطبوع. كانت ثابتة في الكود بقيم مُختلَقة —
         «ترخيص وزارة الصحة رقم 1234/م» و«الرياض — هاتف 0112345678» —
         تُطبع على كل تقرير مختبري. رقم ترخيص مُختلَق لجهة تنظيمية على
         وثيقة طبية‑قانونية خطر قانوني، ولا سبيل كان لضبطه ولا لإخفائه.
         الآن تأتي من إعدادات المختبر، والفارغ منها لا يُطبع أصلًا. */
      labNameEn: a.string(),
      licenseNo: a.string(), // رقم الترخيص كما تصدره الجهة التنظيمية
      contact: a.string(), // العنوان والهاتف
      currency: a.string(), // الرمز المعروض: ر.س · $ · ﷼ …
      currencyCode: a.string(), // SAR · USD · YER — للفواتير والتصدير
      sampleTypes: a.string().array(), // دم وريدي · بول · براز · مسحة …
      tubeTypes: a.string().array(), // أنبوب أحمر · بنفسجي EDTA …
    })
    .secondaryIndexes((index) => [index("key").queryField("listLabConfigByKey")])
    .authorization((allow) => [
      allow.guest().to(["read"]), // اسم المختبر والعملة في ترويسة التقرير
      allow.groups(["admin"]),
      allow.authenticated().to(["read"]),
    ]),

  /* ── عدّاد أرقام الطلبات ─────────────────────────────────────
     سجل لكل يوم (`ORDER-YYMMDD`) يحمل آخر رقم صدر فيه. الكتابة عليه
     محصورة بدالة `next-order-no` عبر مقارنة-وتبديل ذرّية؛ لا عميل
     يكتب هنا، لأن من يكتب على العدّاد يستطيع إعادة إصدار رقم مستعمل.
     القراءة متاحة للمدير وحده كي يرى عدّاد اليوم عند الحاجة.        */
  Counter: a
    .model({
      key: a.string().required(),
      value: a.integer().required(),
    })
    .identifier(["key"])
    .authorization((allow) => [allow.groups(["admin"]).to(["read"])]),

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
    .secondaryIndexes((index) => [index("mrn").queryField("listPatientsByMrn")])
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
      deliveredBy: a.string(),
      deliveredTo: a.string(), // من استلم التقرير: المريض أو مندوبه
      cancelledAt: a.datetime(),
      cancelledBy: a.string(),
      cancelReason: a.string(),

      // تعديل تقرير معتمد يرفع رقم المراجعة ويُطبع على التقرير،
      // حتى تُميَّز النسخة المصحّحة عن النسخة المسلَّمة سابقًا.
      reportRevision: a.integer().default(1),
      amendedAt: a.datetime(),
      amendedBy: a.string(),
      amendReason: a.string(),

      totalPrice: a.float().default(0),
      discount: a.float().default(0),

      /* مجموع الدفعات — نسخة مخبَّأة لا مصدر الحقيقة. المصدر سطور
         `Payment`، وهذا الحقل يوفّر على القوائم والتقارير استعلامًا لكل
         طلب. يُعاد احتسابه من السطور بعد كل دفعة وكل إبطال، وصفحة الطلب
         تصلحه إن وجدته مخالفًا — فأسوأ ما يصيبه تأخّر لا ضياع مال.     */
      paidAmount: a.float().default(0),

      /* يوم إنشاء الطلب (YYYY-MM-DD بالتوقيت المحلي) — مفتاح تقسيم
         لتقارير الفترة. بدونه يقرأ تقرير شهر واحد كل طلبات المختبر منذ
         افتتاحه ثم يرمي ما لا يخصّه، فتزداد كلفته وبطؤه كل شهر بلا
         سبب. والتوقيت محلي لا UTC: تقرير «أمس» يجب أن يطابق يوم
         المحاسب لا يوم غرينتش.                                     */
      day: a.string(),
    })
    .secondaryIndexes((index) => [
      index("orderNo").queryField("listOrdersByOrderNo"),
      index("day").queryField("listOrdersByDay"),
    ])
    .authorization((allow) => [
      allow.groups(["admin", "reception"]),
      /* `quality` يعتمد النتائج ويصحّح التقارير المعتمدة، فيحتاج `update`.
         `tech` كان يملكها أيضًا وهو لا يحتاجها: عمله على `OrderItem`،
         وحالة الطلب تنتقل إلى `IN_PROGRESS`/`PENDING_REVIEW` بحفظ
         النتائج.

         ⚠️ قيد باقٍ معروف: صلاحيات AppSync على مستوى العملية لا الحقل،
         فمن يملك `update` على `Order` يملكه على كل حقوله — بما فيها
         `status` و`approvedBy` و`discount`. أي أن `quality` يستطيع من
         خارج الواجهة كتابة اعتماد باسم غيره أو تغيير خصم. الإغلاق الكامل
         ينقل الاعتماد وحقول المال إلى عمليات مخصّصة تنفّذها Lambda —
         مسجَّل في «المرحلة التالية». */
      allow.groups(["quality"]).to(["read", "update"]),
      allow.groups(["tech", "doctor"]).to(["read"]),
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
      // العيّنة والأنبوب مجمّدان مع الفحص لا مقروءان من الكتالوج وقت
      // الطباعة: تغيير أنبوب فحص في الكتالوج بعد سحب العيّنة يجعل ملصق
      // الأنبوب المطبوع يخالف الأنبوب الذي في يد الفنّي.
      sampleType: a.string(),
      tubeType: a.string(),
      options: a.string().array(),
      price: a.float().default(0),
      refLow: a.float(),
      refHigh: a.float(),
      refText: a.string(), // نص المدى كما يظهر في التقرير
      criticalLow: a.float(),
      criticalHigh: a.float(),
      /* هل كان مدى هذا الفحص معتمدًا وقت الطلب؟ مجمَّد كبقية أرقام
         المدى: تقرير طُبع بمدى غير معتمد يجب أن يبقى معلومًا أنه كذلك
         مهما اعتُمد الفحص لاحقًا. */
      refApproved: a.boolean().default(false),
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

      /* عَلَم مُشتَقّ: "YES" فقط حين تكون النتيجة حرجة ولم يُسجَّل الإبلاغ بعد.
         سبب وجوده: تنبيه القيم الحرجة في لوحة اليوم كان يمسح الجدول كاملًا
         (Scan + filter) فيتوقف عن العثور عليها بعد نمو الجدول. هذا الحقل
         يُنشئ فهرسًا متفرّقًا (sparse index) يحوي الصفوف المعنيّة وحدها.  */
      criticalPending: a.string(),
    })
    .secondaryIndexes((index) => [
      index("testCode"),
      // فحوصات طلب واحد: استعلام مفهرس بدل مسح الجدول
      index("orderId").queryField("listOrderItemsByOrder"),
      index("criticalPending")
        .sortKeys(["enteredAt"])
        .queryField("listPendingCriticals"),
    ])
    .authorization((allow) => [
      /* لا `delete` لأحد. حذف سطر نتيجة يغيّر `verificationCode` المطبوع
         على التقرير، فتبدو النسخة الورقية بيد المريض «مزوّرة» بلا أن
         يتحرّك `reportRevision` — ولا سطر في التطبيق يحذف `OrderItem`
         أصلًا، فالمنحة كانت زائدة بالكامل. الطلب الخطأ يُلغى بسبب مكتوب،
         لا تُمحى سطوره. */
      allow.groups(["admin", "quality", "tech"]).to(["create", "read", "update"]),
      allow.groups(["reception"]).to(["create", "read"]),
      allow.groups(["doctor"]).to(["read"]),
    ]),

  /* ── الدفعات ────────────────────────────────────────────────
     سطر لكل مبلغ مقبوض، وهو مصدر الحقيقة في المال.

     البديل السابق كان تعديل `paidAmount` على الطلب مباشرة: قراءة ثم
     كتابة بلا قفل، فدفعتان على الطلب نفسه في اللحظة نفسها تُبقي إحداهما
     وتمحو الأخرى — مالٌ قُبض من المريض واختفى من النظام. السطور المستقلّة
     لا تتصادم: كلٌّ يُنشئ صفًّا خاصًّا به.

     ويحلّ الجدول مسألة ثانية: `day` هنا **يوم القبض** لا يوم الطلب، فمن
     دفع باقي حسابه بعد أسبوع يُحتسب ماله في اليوم الذي قُبض فيه فعلًا —
     وهو ما يطابق صندوق المحاسب.

     **لا حذف لأحد.** سطر مال يُمحى لا يُراجَع؛ الخطأ يُبطَل بسبب مكتوب
     ويبقى ظاهرًا. والإبطال لمجموعة `admin` وحدها: من يقبض لا يبطل قبضه. */
  Payment: a
    .model({
      orderId: a.id().required(),
      // رقم الطلب مجمَّد هنا كي يقرأ تقرير التحصيل اليومي سطوره وحدها
      // بلا استعلام على كل طلب لمعرفة رقمه.
      orderNo: a.string().required(),
      amount: a.float().required(),
      method: a.ref("PaymentMethod"),
      receivedBy: a.string().required(),
      at: a.datetime().required(),
      day: a.string().required(), // يوم القبض المحلي — مفتاح تقسيم
      note: a.string(),

      voidedAt: a.datetime(),
      voidedBy: a.string(),
      voidReason: a.string(),
    })
    .secondaryIndexes((index) => [
      index("orderId").sortKeys(["at"]).queryField("listPaymentsByOrder"),
      index("day").sortKeys(["at"]).queryField("listPaymentsByDay"),
    ])
    .authorization((allow) => [
      allow.groups(["admin"]).to(["create", "read", "update"]),
      allow.groups(["reception"]).to(["create", "read"]),
      allow.groups(["quality"]).to(["read"]),
    ]),

  /* ── سجل التدقيق — يُكتب ولا يُعدَّل ولا يُحذف ───────────────────
     لا أحد — بما في ذلك admin — يملك update أو delete هنا. سجل تدقيق
     يستطيع المدير محوه لا يصلح دليلًا عند مراجعة أو نزاع.           */
  AuditLog: a
    .model({
      entity: a.string().required(), // Order | OrderItem | Patient | Staff
      entityId: a.string().required(),
      action: a.string().required(), // RESULT_ENTERED | APPROVED | AMENDED …
      actor: a.string().required(),
      summary: a.string(),
      before: a.json(),
      after: a.json(),

      /* `day` (YYYY-MM-DD) مفتاح تقسيم للعرض الزمني، و`at` مفتاح فرز.
         سجل التدقيق يكبر بأسرع من كل الجداول — سطر لكل نتيجة تُدخل —
         فقراءته بمسح الجدول تبطؤ شهرًا بعد شهر حتى تعجز الصفحة. واليوم
         مفتاحًا يوزّع الكتابة على أقسام بعدد الأيام بدل قسم واحد ساخن. */
      day: a.string(),
      at: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("day").sortKeys(["at"]).queryField("listAuditByDay"),
      // سجل طلب أو مريض بعينه: «من غيّر هذه النتيجة ومتى».
      index("entityId").sortKeys(["at"]).queryField("listAuditByEntity"),
    ])
    .authorization((allow) => [
      /* القراءة لمن يراجع لا لمن يُراجَع عمله. كانت `allow.authenticated()`
         فكان أي حساب — فنّي أو طبيب أو حساب بلا مجموعة أصلًا — يقرأ لقطات
         `before/after` ومبالغ الدفعات وتغييرات الصلاحيات، وهي بيانات لا
         يملك `read` عليها في جداولها. */
      /* ⚠️ كل مجموعة في قاعدة واحدة فقط: تكرار المجموعة نفسها في قاعدتين
         على النموذج نفسه يرفضه Amplify عند النشر
         (`@auth … staticGroup:admin … already exists`). */
      allow.groups(["admin", "quality"]).to(["create", "read"]),

      /* الكتابة لمن يعمل في النظام فعلًا — وهي **ليست حصانة**: `actor`
         يأتي من العميل (`lib/amplify.ts`)، فمن يملك `create` يستطيع دسّ
         سطر يشهد بما لم يقع — ولأن لا أحد يملك `update`/`delete` عمدًا،
         السطر المدسوس لا يُصحَّح أبدًا.

         ⚠️ الإغلاق الكامل يحتاج نقل الكتابة إلى دالة تشتقّ `actor` من
         `event.identity` لا من الطلب — كما تفعل `manage-staff`. مسجَّل في
         «المرحلة التالية»، وتضييق المجموعات هنا يقلّل السطح ولا يزيله. */
      allow.groups(["tech", "reception", "doctor"]).to(["create"]),
    ]),

  /* ── بوابة تقرير المريض ──────────────────────────────────────
     المنفذ الوحيد للزائر إلى بيانات الطلبات. لا يملك الزائر `read`
     على `Order` ولا `Patient` ولا `OrderItem`، لأن صلاحيات AppSync
     على مستوى الجدول: منحه القراءة يعني قراءة طلبات الناس جميعًا من
     خارج الواجهة. هنا يتحقّق الخادم من رقم الطلب ورقم الملف/الجوال
     معًا، ولا يُرجع إلا تقريرًا معتمدًا يخصّ صاحب الرقمين.       */
  getMyReport: a
    .query()
    .arguments({
      orderNo: a.string().required(),
      verifyId: a.string().required(), // رقم الملف أو الجوال
    })
    .returns(a.json())
    .handler(a.handler.function(getMyReport))
    .authorization((allow) => [allow.guest(), allow.authenticated()]),

  /* ── إدارة الموظفين وأدوارهم ─────────────────────────────────
     الأدوار مجموعات في Cognito لا صفوف في جدول، فلا تُدار من الواجهة
     إلا عبر دالة تملك صلاحية استدعاء Cognito. الصلاحية محصورة بـ`admin`
     هنا، فيرفض AppSync الطلب قبل أن يبلغ الدالة.                */
  listStaff: a
    .query()
    .returns(a.json())
    .handler(a.handler.function(manageStaff))
    .authorization((allow) => [allow.groups(["admin"])]),

  manageStaff: a
    .mutation()
    .arguments({
      action: a.string().required(), // ADD_GROUP | REMOVE_GROUP | ENABLE | DISABLE | RESET_PASSWORD
      username: a.string().required(),
      group: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(manageStaff))
    .authorization((allow) => [allow.groups(["admin"])]),

  /* ── حجز رقم الطلب التالي ────────────────────────────────────
     `stamp` هو ختم اليوم (YYMMDD) بتوقيت المختبر المحلي، يرسله العميل
     لأن الدالة تعمل بتوقيت UTC. من يملك إنشاء الطلبات يملك حجز رقم:
     الحجز بلا إنشاء يحرق رقمًا لا أكثر.                            */
  nextOrderNo: a
    .mutation()
    .arguments({ stamp: a.string().required() })
    .returns(a.json())
    .handler(a.handler.function(nextOrderNo))
    .authorization((allow) => [allow.groups(["admin", "reception"])]),
})
  // الدوال تقرأ الجداول وتكتب فيها بالنيابة عن المستخدم بعد التحقّق،
  // فتحتاج صلاحية على المخطط — وهي وحدها، لا العميل.
  .authorization((allow) => [
    allow.resource(getMyReport).to(["query"]),
    allow.resource(nextOrderNo).to(["query", "mutate"]),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // المسجَّلون يستخدمون رمز Cognito، فتبقى قواعد المجموعات (الأدوار)
    // سارية عليهم. الزائر بلا حساب يمرّ عبر دور IAM غير المُصادَق
    // (identityPool) بصلاحية `read` وحدها: يبحث عن تقريره ولا يكتب شيئًا.
    //
    // ⚠️ حدّ هذا النموذج: صلاحية القراءة على مستوى الجدول لا الصفّ، فمن
    // يستدعي الـ API مباشرةً يمكنه قراءة طلبات غيره. الواجهة تطلب رقم
    // الطلب + رقم الملف معًا، لكن الحماية الحقيقية تحتاج مُحلِّلًا
    // مخصّصًا (Lambda) يتحقّق من التطابق قبل الإرجاع.
    defaultAuthorizationMode: "userPool",
  },
});
