import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { getMyReport } from './functions/get-my-report/resource.js';
import { manageStaff } from './functions/manage-staff/resource.js';
import { nextOrderNo } from './functions/next-order-no/resource.js';
import { orderOps } from './functions/order-ops/resource.js';

const backend = defineBackend({
  auth,
  data,
  getMyReport,
  manageStaff,
  nextOrderNo,
  orderOps,
});

/* ── صلاحية إدارة الموظفين ───────────────────────────────────────
   دالة `manage-staff` تستدعي Cognito بالنيابة عن المدير: تقرأ قائمة
   المستخدمين، وتضيفهم إلى المجموعات وتزيلهم، وتعطّل حسابًا أو تعيد
   تعيين كلمته. الصلاحيات مذكورة واحدة واحدة — لا `cognito-idp:*` —
   ومحصورة في مجمّع مستخدمي هذا التطبيق وحده.

   لا تشمل القائمة `AdminSetUserPassword` ولا `AdminInitiateAuth`: الأولى
   تتيح للمدير ضبط كلمة موظف ثم الدخول باسمه، والثانية انتحال جلسة.
   إعادة التعيين ترسل رمزًا إلى بريد الموظف نفسه، فتبقى هويته له وحده،
   ويبقى سجل التدقيق دالًّا على فاعله الحقيقي.                      */
const userPool = backend.auth.resources.userPool;

backend.manageStaff.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminResetUserPassword',
    ],
    resources: [userPool.userPoolArn],
  })
);

// معرّف المجمّع لا يُعرف قبل النشر، فيُحقن متغيّر بيئة بدل كتابته في الكود.
backend.manageStaff.addEnvironment('USER_POOL_ID', userPool.userPoolId);

/* ── هوية المعتمِد في العمليات الحسّاسة ─────────────────────────────
   دالة `order-ops` تشتقّ الفاعل من `event.identity`، وهو رمز **الوصول**
   الذي يرسله عميل Amplify في وضع `userPool`: حمولته تحمل `username`
   و`sub` و`cognito:groups` ولا تحمل البريد ولا الاسم. فتُقرأ السمتان من
   Cognito — `AdminGetUser` وحدها، بلا أي صلاحية كتابة.

   ولماذا البريد أصلًا: سطور `enteredBy` وسجل التدقيق القائمة كلها كُتبت
   بالبريد، فلو كتب الخادم `username` لصار «من أدخل النتيجة» و«من اعتمدها»
   لا يُقارَنان — فيسقط مبدأ أربع أعين — وانقطع سجل التدقيق عن تاريخه.
   والاسم المعروض هو ما يُطبع على التقرير تحت «اعتمدها». */
backend.orderOps.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminGetUser'],
    resources: [userPool.userPoolArn],
  })
);

backend.orderOps.addEnvironment('USER_POOL_ID', userPool.userPoolId);

/* ── حماية البيانات على مستوى الجدول ────────────────────────────────
   فجر ٣٠ يوليو ٢٠٢٦ أُعيد إنشاء الـ sandbox فضاعت البيانات كلها: مجمّع
   مستخدمين بصفر حساب وثمانية جداول بصفر سطر. الدرس أن الحماية إن كانت
   أمر CLI فهي تُمحى مع الجدول نفسه — فمحلّها هنا، في الكود، لتُطبَّق
   على كل جدول يُنشأ بعدها.

   `pointInTimeRecoveryEnabled` يتيح الرجوع إلى أي لحظة في آخر ٣٥ يومًا،
   ويشمل استعادة جدول محذوف كان مُفعَّلًا عليه.

   `deletionProtectionEnabled` يجعل حذف الجدول يفشل صراحةً، وهو بالضبط
   ما كان سيمنع الضياع: حذف الحزمة كان سيتعطّل بدل أن يمضي صامتًا.
   وثمنه أن أي تغيير في المخطَّط يستوجب استبدال الجدول سيفشل، وأن
   `ampx sandbox delete` لن يمرّ. لرفعه مؤقّتًا: بدّل القيمة إلى false
   ثم `npx ampx sandbox --once`، ولا تنسَ إعادتها.

   الحلقة تمرّ على كل الجداول بلا تسمية، فأي نموذج جديد يُحمى تلقائيًّا
   بلا أن يتذكّره أحد.                                              */
for (const table of Object.values(
  backend.data.resources.cfnResources.amplifyDynamoDbTables
)) {
  table.pointInTimeRecoveryEnabled = true;
  table.deletionProtectionEnabled = true;
}
