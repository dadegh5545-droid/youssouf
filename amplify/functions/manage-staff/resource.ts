import { defineFunction } from "@aws-amplify/backend";

/**
 * إدارة حسابات الموظفين وأدوارهم.
 *
 * بدونها لا سبيل لتفعيل حساب موظف جديد إلا من سطر أوامر AWS
 * (`aws cognito-idp admin-add-user-to-group`) — أي أن مدير المختبر يعجز
 * عن توظيف فنّي جديد بلا مطوّر. الأدوار في Cognito وليست في جداول
 * التطبيق، فلا بد من دالة تملك صلاحية استدعاء Cognito بالنيابة عنه.
 *
 * صلاحية الاستدعاء محصورة بمجموعة `admin` في قواعد المخطط، فيرفض AppSync
 * الطلب قبل أن يصل إلى الدالة أصلًا. والدالة تتحقّق مرة أخرى من ألا يزيل
 * المدير صفة الإدارة عن نفسه فيقفل الجميع خارج النظام.
 */
export const manageStaff = defineFunction({
  name: "manage-staff",
  entry: "./handler.ts",
  timeoutSeconds: 20,
});
