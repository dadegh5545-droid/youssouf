# نشر نظام المختبر على AWS
# التشغيل:  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# يفحص المتطلبات، ثم ينشر الباكند وينتظر حتى يكتمل.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n=== فحص المتطلبات ===" -ForegroundColor Cyan

# 1) AWS CLI
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "User")
try {
    $v = (aws --version) 2>&1
    Write-Host "[✓] AWS CLI: $v"
} catch {
    Write-Host "[✗] AWS CLI غير مثبّت. نفّذ: winget install Amazon.AWSCLI" -ForegroundColor Red
    exit 1
}

# 2) بيانات الاعتماد
try {
    $id = (aws sts get-caller-identity --output json) 2>&1 | ConvertFrom-Json
    Write-Host "[✓] حساب AWS: $($id.Account)  —  $($id.Arn)"
} catch {
    Write-Host "[✗] لا توجد بيانات اعتماد صالحة." -ForegroundColor Red
    Write-Host ""
    Write-Host "نفّذ هذا الأمر وأدخل مفاتيحك (لا تشاركها مع أحد):" -ForegroundColor Yellow
    Write-Host "    aws configure"
    Write-Host ""
    Write-Host "المفاتيح تُنشأ من:" -ForegroundColor Yellow
    Write-Host "    AWS Console ← IAM ← Users ← <مستخدمك> ← Security credentials"
    Write-Host "    ← Create access key ← Command Line Interface (CLI)"
    Write-Host ""
    Write-Host "المنطقة المقترحة: eu-central-1   |   الصيغة: json"
    exit 1
}

# 3) التبعيات
if (-not (Test-Path "node_modules")) {
    Write-Host "[…] تثبيت التبعيات"
    npm.cmd install --no-audit --no-fund
}
Write-Host "[✓] التبعيات جاهزة"

# 4) نشر الباكند
Write-Host "`n=== نشر الباكند على AWS (٥–١٠ دقائق أول مرة) ===" -ForegroundColor Cyan
npx.cmd ampx sandbox --once
if ($LASTEXITCODE -ne 0) {
    Write-Host "[✗] فشل النشر — راجع الرسالة أعلاه." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "amplify_outputs.json")) {
    Write-Host "[✗] لم يُولَّد amplify_outputs.json" -ForegroundColor Red
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
Write-Host "  3) سجّل خروجًا ودخولًا، ثم حمّل كتالوج الفحوصات من صفحة الكتالوج."
Write-Host ""
