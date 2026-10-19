# DocBox + Stirling-PDF 本地启动脚本
# 用法：右键“使用 PowerShell 运行”，或执行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\start-all.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Http([string]$Url, [int]$Seconds = 60) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host "== DocBox 本地文档工具箱 ==" -ForegroundColor Cyan

# ---------- JDK 25 ----------
$jdk = Get-ChildItem "$Root\runtime" -Directory -Filter 'jdk-25*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $jdk) {
    throw "未找到 runtime\jdk-25*。请确认 runtime 目录完整，或安装 JDK 25 后重试。"
}
$java = Join-Path $jdk.FullName 'bin\java.exe'

# ---------- Stirling-PDF :8090 ----------
$stirlingJar = Join-Path $Root 'stirling\Stirling-PDF.jar'
if (-not (Test-Path $stirlingJar)) {
    throw "未找到 stirling\Stirling-PDF.jar（带 Web UI 的完整版）。"
}
if (Test-Port 8090) {
    Write-Host "[跳过] 8090 已被占用，Stirling-PDF 可能已在运行。" -ForegroundColor Yellow
} else {
    New-Item -ItemType Directory -Force -Path "$Root\stirling\tmp" | Out-Null
    $javaArgs = @(
        '-Xmx1536m',
        '-Dfile.encoding=UTF-8',
        "-Djava.io.tmpdir=$Root\stirling\tmp",
        '-jar', $stirlingJar,
        '--server.port=8090'
    )
    $p = Start-Process -FilePath $java -ArgumentList $javaArgs `
        -WorkingDirectory "$Root\stirling" `
        -RedirectStandardOutput "$Root\stirling\stdout.log" `
        -RedirectStandardError "$Root\stirling\stderr.log" `
        -WindowStyle Hidden -PassThru
    $p.Id | Set-Content "$Root\stirling\stirling.pid"
    Write-Host "[启动] Stirling-PDF PID=$($p.Id)  http://127.0.0.1:8090/" -ForegroundColor Green
}

# ---------- DocBox :3000 ----------
if (-not (Test-Path "$Root\docbox\node_modules\express\package.json")) {
    Write-Host "[安装] DocBox 依赖（首次运行）..." -ForegroundColor Yellow
    $env:npm_config_cache = "$Root\.npm-cache"
    Push-Location "$Root\docbox"
    try { npm install --no-audit --no-fund } finally { Pop-Location }
}
if (Test-Port 3000) {
    Write-Host "[跳过] 3000 已被占用，DocBox 可能已在运行。" -ForegroundColor Yellow
} else {
    $p = Start-Process -FilePath 'node' -ArgumentList @('--max-old-space-size=1536', '--max-semi-space-size=16', 'server.mjs') `
        -WorkingDirectory "$Root\docbox" `
        -RedirectStandardOutput "$Root\docbox\server.out.log" `
        -RedirectStandardError "$Root\docbox\server.err.log" `
        -WindowStyle Hidden -PassThru
    $p.Id | Set-Content "$Root\docbox\server.pid"
    Write-Host "[启动] DocBox PID=$($p.Id)  http://127.0.0.1:3000/" -ForegroundColor Green
}

Write-Host "[等待] 正在检查服务健康状态..." -ForegroundColor Yellow
$docOk = Wait-Http 'http://127.0.0.1:3000/api/health' 60
$stOk = Wait-Http 'http://127.0.0.1:8090/' 90

if (-not $docOk) { Write-Warning "DocBox 未在 60 秒内就绪，请查看 docbox\server.err.log" }
if (-not $stOk) { Write-Warning "Stirling-PDF 未在 90 秒内就绪（首次启动可能需要更久），请查看 stirling\stdout.log" }

Write-Host ""
Write-Host "DocBox        : http://127.0.0.1:3000/" -ForegroundColor Cyan
Write-Host "Stirling-PDF  : http://127.0.0.1:8090/" -ForegroundColor Cyan
Write-Host "停止服务      : .\stop-all.ps1" -ForegroundColor DarkGray
Write-Host ""

if ($docOk) { Start-Process 'http://127.0.0.1:3000/' }
Write-Host "冒烟测试: cd docbox; npm run smoke" -ForegroundColor DarkGray
