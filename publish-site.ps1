# نشر واجهة المختبر على Amplify Hosting (نشر يدوي من مجلد out/)
#
#   .\publish-site.ps1            ← تحقّق كامل ثم بناء ثم نشر
#   .\publish-site.ps1 -SkipCheck ← بناء ونشر فقط (للتجارب السريعة)
#
# التشغيل: powershell -ExecutionPolicy Bypass -File .\publish-site.ps1
#
# لماذا سكربت بدل أوامر متتابعة؟ لأن ضغط المجلد بـ Compress-Archive في
# Windows PowerShell 5.1 يكتب أسماء المدخلات بشرطة مقلوبة (catalog\index.html)
# بينما معيار ZIP يوجب الشرطة المائلة (/). فكّ Amplify للحزمة يُنتج ملفًا
# واحدًا اسمه حرفيًّا "catalog\index.html" في الجذر، فلا يوجد أي مجلد فرعي:
# كل صفحة و كل ملف JS يرجع 404 والموقع يبدو صفحة بيضاء. هذا السكربت يبني
# الحزمة بنفسه بأسماء مائلة ويتحقّق منها قبل الرفع.

param(
    [switch]$SkipCheck,
    [string]$AppId  = "d1mvwoi85qfdt",
    [string]$Branch = "main",
    [string]$Region = "us-east-2"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "[X] $msg" -ForegroundColor Red; exit 1 }

# 1) المتطلبات
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { Fail "AWS CLI غير مثبّت" }
aws sts get-caller-identity --output json > $null 2>&1
if ($LASTEXITCODE -ne 0) { Fail "لا توجد بيانات اعتماد AWS صالحة — نفّذ: aws configure" }

# 2) بوّابة الجودة: أنواع + اختبارات + بناء. لا يُنشر كودٌ لم يمرّ بها.
if ($SkipCheck) {
    Write-Host "=== بناء فقط (تم تخطّي التحقّق) ===" -ForegroundColor Yellow
    npm.cmd run build
} else {
    Write-Host "=== تحقّق كامل ثم بناء ===" -ForegroundColor Cyan
    npm.cmd run check
}
if ($LASTEXITCODE -ne 0) { Fail "فشل البناء أو التحقّق — لم يُنشر شيء." }
if (-not (Test-Path "out\index.html")) { Fail "مجلد out/ ناقص" }

# 3) بناء الحزمة بأسماء مدخلات مائلة (/) لا مقلوبة (\)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = (Resolve-Path "out").Path
$zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "lis-site-$Branch.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$count = 0
try {
    Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $count++
    }
} finally { $zip.Dispose() }

# تحقّق من الحزمة نفسها لا من نيّتنا: لا مدخل واحد بشرطة مقلوبة، ووجود
# ملف داخل مجلد فرعي دليلٌ على أن البنية محفوظة.
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $bad    = @($zip.Entries | Where-Object { $_.FullName -like '*\*' })
    $nested = @($zip.Entries | Where-Object { $_.FullName -like '_next/*' })
} finally { $zip.Dispose() }
if ($bad.Count -gt 0)    { Fail "الحزمة فيها $($bad.Count) مدخلًا بشرطة مقلوبة" }
if ($nested.Count -eq 0) { Fail "الحزمة بلا ملفات _next/ — البنية الفرعية مفقودة" }
Write-Host "[OK] الحزمة: $count ملفًا، $([math]::Round((Get-Item $zipPath).Length / 1KB))KB"

# 4) رفع ونشر
$dep = aws amplify create-deployment --app-id $AppId --branch-name $Branch --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $dep.jobId) { Fail "فشل create-deployment" }
$jobId = $dep.jobId

$http = & curl.exe -s -o NUL -w "%{http_code}" -X PUT -T "$zipPath" "$($dep.zipUploadUrl)"
if ($http -ne "200") { Fail "فشل رفع الحزمة (HTTP $http)" }

aws amplify start-deployment --app-id $AppId --branch-name $Branch --job-id $jobId --region $Region --output json > $null
if ($LASTEXITCODE -ne 0) { Fail "فشل start-deployment" }

Write-Host "[..] النشر جارٍ (المهمة $jobId)"
do {
    Start-Sleep -Seconds 5
    $status = aws amplify get-job --app-id $AppId --branch-name $Branch --job-id $jobId --region $Region --query "job.summary.status" --output text
} until ($status -in @("SUCCEED", "FAILED", "CANCELLED"))

if ($status -ne "SUCCEED") { Fail "انتهى النشر بحالة $status" }

# 5) تحقّق من الموقع الحيّ: الجذر وحده لا يكفي — ملفات الجذر تُخدَم حتى
#    عندما تكون المجلدات الفرعية مفقودة، وهو بالضبط عيب الشرطة المقلوبة.
$base = "https://$Branch.$AppId.amplifyapp.com"
$failed = @()
foreach ($p in @("/", "/orders/", "/catalog/", "/settings/", "/reports/", "/staff/", "/audit/", "/patients/")) {
    $code = & curl.exe -s -o NUL -w "%{http_code}" "$base$p"
    if ($code -ne "200") { $failed += "$p ($code)" }
}
if ($failed.Count -gt 0) { Fail "مسارات لا تُخدَم: $($failed -join ', ')" }

Write-Host "`n=== نُشر بنجاح ===" -ForegroundColor Green
Write-Host $base
