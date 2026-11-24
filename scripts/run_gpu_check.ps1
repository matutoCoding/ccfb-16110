# 一体化 GPU 验证：清场 → 独立 Chrome → CDP 测试 → 收尾
$ErrorActionPreference = 'Stop'
$ws = 'D:\work\biaozhu\userFeedBack\cc-feedback-workbench\runs\16110\attempts\attempt-3a11b9e07523\workspace'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$ud = 'C:\Users\Matuto\AppData\Local\Temp\cchrome-gpu-test'

# 只清理带测试 profile 的实例，不动用户日常 Chrome
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*cchrome-gpu-test*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (Test-Path $ud) { Remove-Item $ud -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }

$p = Start-Process $chrome -PassThru -ArgumentList @(
  '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9222', "--user-data-dir=$ud",
  'about:blank'
)

$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $v = Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 3
    if ($v.Browser) { $ok = $true; break }
  } catch {}
}
if (-not $ok) { throw 'CDP 端口未就绪' }
"CDP ready, browser pid=$($p.Id)"

Push-Location $ws
try {
  $env:NO_PROXY = '*'
  if ($args[0] -eq 'wgsl') {
    node scripts/.tmp/cdp_check.mjs index.html
  } else {
    node scripts/.tmp/cdp_check.mjs gpu_smoke.html
  }
} finally {
  Pop-Location
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like '*cchrome-gpu-test*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
}
