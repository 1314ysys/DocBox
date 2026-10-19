# 停止 DocBox 本地服务（v0.1.1 起不再有 Stirling-PDF 8090 端口）
$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Stop-Managed([string]$Name, [string]$PidFile, [string]$Match) {
    if (-not (Test-Path $PidFile)) {
        Write-Host "[跳过] $Name 没有 PID 文件。" -ForegroundColor DarkGray
        return
    }
    $procId = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $procId) { return }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[清理] $Name 进程已不存在。" -ForegroundColor DarkGray
    } elseif ($proc.CommandLine -like "*$Match*") {
        Stop-Process -Id $procId -Force
        Write-Host "[停止] $Name PID=$procId" -ForegroundColor Yellow
    } else {
        Write-Warning "$Name 的 PID 文件指向了其他进程（PID=$procId），为避免误杀已跳过。"
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-Managed 'DocBox' "$Root\docbox\server.pid" 'server.mjs'

# 兼容旧版本遗留的 Stirling-PDF（0.1.0 及以前）
$legacyPid = "$Root\stirling\stirling.pid"
if (Test-Path $legacyPid) {
    $procId = (Get-Content $legacyPid | Select-Object -First 1)
    if ($procId) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if ($p -and $p.CommandLine -like '*Stirling-PDF*') {
            Stop-Process -Id $procId -Force
            Write-Host "[停止] 遗留 Stirling-PDF PID=$procId" -ForegroundColor Yellow
        }
    }
    Remove-Item $legacyPid -Force -ErrorAction SilentlyContinue
}

Write-Host "完成。" -ForegroundColor Green
