# DocBox 本地启动脚本（v0.1.1：单进程，无 Stirling-PDF 端口）
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

# ---------- MySQL（可选，用于处理历史 / 模板 / 安全报告）----------
$mysql = Get-Service -Name 'MySQL84','MySQL80','MySQL' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($mysql) {
    if ($mysql.Status -ne 'Running') {
        Write-Host "[启动] MySQL 服务 $($mysql.Name) ..." -ForegroundColor Yellow
        try { Start-Service $mysql.Name } catch { Write-Warning "MySQL 启动失败，历史记录功能将降级：$($_.Exception.Message)" }
    }
    if (Test-Port 3306) {
        Write-Host "[就绪] MySQL 已在 127.0.0.1:3306 监听" -ForegroundColor Green
    } else {
        Write-Warning "MySQL 未在 3306 监听，历史记录功能将自动降级（其余工具不受影响）"
    }
} else {
    Write-Warning "未检测到 MySQL 服务，历史记录功能将自动降级（其余工具不受影响）"
}

# ---------- DocBox :3000（PDF / 音视频 / 网络安全全部在进程内完成）----------
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
if (-not $docOk) { Write-Warning "DocBox 未在 60 秒内就绪，请查看 docbox\server.err.log" }

if ($docOk) {
    try {
        $h = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 5
        $db = if ($h.db.available) { "MySQL v$($h.db.version)" } else { '未连接（历史功能降级）' }
        $media = if ($h.media.ok) { '就绪' } else { '缺失' }
        Write-Host "数据库: $db    FFmpeg: $media    版本: v$($h.version)" -ForegroundColor DarkGray
    } catch { }
}

Write-Host ""
Write-Host "DocBox        : http://127.0.0.1:3000/" -ForegroundColor Cyan
Write-Host "停止服务      : .\stop-all.ps1" -ForegroundColor DarkGray
Write-Host "冒烟测试      : cd docbox; npm run smoke" -ForegroundColor DarkGray
Write-Host ""

if ($docOk) { Start-Process 'http://127.0.0.1:3000/' }
