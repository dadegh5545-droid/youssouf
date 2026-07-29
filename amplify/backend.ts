import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { getMyReport } from './functions/get-my-report/resource.js';
import { manageStaff } from './functions/manage-staff/resource.js';

const backend = defineBackend({
  auth,
  data,
  getMyReport,
  manageStaff,
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
