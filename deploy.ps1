# نشر نظام المختبر على AWS
#
#   .\deploy.ps1              ← بيئة تجريبية (sandbox) للتقييم والتدريب
#   .\deploy.ps1 -Production  ← يطبع خطوات النشر الإنتاجي عبر Amplify Hosting
#
# التشغيل: powershell -ExecutionPolicy Bypass -File .\deploy.ps1

param(
    [switch]$Production,
    [string]$Region = "eu-central-1"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Production) {
    Write-Host "`n=== النشر الإنتاجي (بيانات مرضى حقيقية) ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "لا تستخدم sandbox لبيانات حقيقية. مكدّس الـ sandbox مرتبط بجهازك"
    Write-Host "ومستخدمك، مُعرَّف كبيئة مؤقتة، و 'npx ampx sandbox delete' يمحو"
    Write-Host "جداول DynamoDB بما فيها من نتائج مرضى بلا إمكانية استرجاع."
    Write-Host ""
    Write-Host "الخطوات:" -ForegroundColor Yellow
    Write-Host "  1) ادفع الكود إلى GitHub:"
    Write-Host "       git push origin main"
    Write-Host "  2) AWS Console -> Amplify -> Create new app -> GitHub -> اختر المستودع والفرع main"
    Write-Host "     (ملف amplify.yml الموجود يتكفّل ببناء الباكند والفرونت معًا)"
    Write-Host "  3) بعد أول نشر ناجح، فعّل النسخ الاحتياطي المستمر لكل جدول:"
    Write-Host "       aws dynamodb list-tables --region $Region"
    Write-Host "       aws dynamodb update-continuous-backups ``"
    Write-Host "         --table-name <اسم الجدول> ``"
    Write-Host "         --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true ``"
    Write-Host "         --region $Region"
    Write-Host "  4) فعّل الحذف المحمي على المكدّس حتى لا يُمحى بالخطأ:"
    Write-Host "       aws cloudformation update-termination-protection ``"
    Write-Host "         --enable-termination-protection --stack-name <اسم المكدّس> --region $Region"
    Write-Host ""
    Write-Host "ملاحظة قانونية: بيانات صحية تُعرِّف المريض. تحقّق من متطلبات"
    Write-Host "توطين البيانات في بلدك قبل اختيار المنطقة ($Region حاليًا)."
    Write-Host "أقرب منطقة للسعودية عادةً me-south-1 (البحرين) أو me-central-1 (الإمارات)"
    Write-Host "— تأكّد من دعمها لـ Amplify قبل الاعتماد عليها."
    Write-Host ""
    exit 0
}

Write-Host "`n=== فحص المتطلبات ===" -ForegroundColor Cyan

# 1) AWS CLI
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "User")

$awsCmd = Get-Command aws -ErrorAction SilentlyContinue
if (-not $awsCmd) {
    Write-Host "[X] AWS CLI غير مثبّت. نفّذ: winget install Amazon.AWSCLI" -ForegroundColor Red
    Write-Host "    ثم أعد فتح PowerShell." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] AWS CLI: $($awsCmd.Source)"

# 2) بيانات الاعتماد
#    نعتمد على رمز الخروج لا على الاستثناءات: الأوامر الأصلية (native) لا
#    ترمي استثناءً في PowerShell، وإنما تضبط $LASTEXITCODE.
$idJson = aws sts get-caller-identity --output json 2>$null
if ($LASTEXITCODE -ne 0 -or -not $idJson) {
    Write-Host "[X] لا توجد بيانات اعتماد صالحة." -ForegroundColor Red
    Write-Host ""
    Write-Host "نفّذ هذا الأمر وأدخل مفاتيحك (لا تشاركها مع أحد):" -ForegroundColor Yellow
    Write-Host "    aws configure"
    Write-Host ""
    Write-Host "المفاتيح تُنشأ من:" -ForegroundColor Yellow
    Write-Host "    AWS Console -> IAM -> Users -> <مستخدمك> -> Security credentials"
    Write-Host "    -> Create access key -> Command Line Interface (CLI)"
    Write-Host ""
    Write-Host "إن كنت تدخل عبر رابط شركة (…awsapps.com/start) فاستخدم بدلًا منه:" -ForegroundColor Yellow
    Write-Host "    aws configure sso   ثم   aws sso login"
    Write-Host ""
    Write-Host "المنطقة المقترحة: $Region   |   الصيغة: json"
    exit 1
}
$id = $idJson | ConvertFrom-Json
Write-Host "[OK] حساب AWS: $($id.Account)  —  $($id.Arn)"

# 3) التبعيات
if (-not (Test-Path "node_modules")) {
    Write-Host "[..] تثبيت التبعيات"
    npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] فشل npm install" -ForegroundColor Red; exit 1 }
}
Write-Host "[OK] التبعيات جاهزة"

# 4) تحذير صريح قبل النشر
Write-Host ""
Write-Host "تنبيه: هذه بيئة sandbox — للتقييم والتدريب فقط." -ForegroundColor Yellow
Write-Host "لا تُدخل فيها بيانات مرضى حقيقية: المكدّس مؤقت وقابل للحذف،" -ForegroundColor Yellow
Write-Host "ولا نسخ احتياطي عليه. للإنتاج شغّل: .\deploy.ps1 -Production" -ForegroundColor Yellow
Write-Host ""

Write-Host "=== نشر الباكند على AWS (5-10 دقائق أول مرة) ===" -ForegroundColor Cyan
npx.cmd ampx sandbox --once
if ($LASTEXITCODE -ne 0) {
    Write-Host "[X] فشل النشر — راجع الرسالة أعلاه." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "amplify_outputs.json")) {
    Write-Host "[X] لم يُولَّد amplify_outputs.json" -ForegroundColor Red
    exit 1
}

$outputs = Get-Content "amplify_outputs.json" -Raw | ConvertFrom-Json
$pool = $outputs.auth.user_pool_id

Write-Host "`n=== تم النشر بنجاح ===" -ForegroundColor Green
Write-Host "User Pool: $pool"
Write-Host ""
Write-Host "الخطوات المتبقية:" -ForegroundColor Cyan
Write-Host "  1) npm.cmd run dev   ثم افتح http://localhost:3000 وأنشئ حسابك."
Write-Host "  2) أضف حسابك إلى مجموعة admin:"
Write-Host "     aws cognito-idp admin-add-user-to-group --user-pool-id $pool --username <بريدك> --group-name admin"
Write-Host "  3) سجّل خروجًا ودخولًا (الصلاحيات تُقرأ من الرمز المميّز عند الدخول)،"
Write-Host "     ثم حمّل كتالوج الفحوصات من صفحة الكتالوج."
Write-Host ""
Write-Host "قبل أي استخدام حقيقي: يجب أن يراجع مسؤول الجودة كل مدى مرجعي" -ForegroundColor Yellow
Write-Host "وكل قيمة حرجة في الكتالوج وفق أجهزة المختبر وكواشفه." -ForegroundColor Yellow
Write-Host ""
