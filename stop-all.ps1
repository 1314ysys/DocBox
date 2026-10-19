# 停止 DocBox 与 Stirling-PDF 本地服务
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
Stop-Managed 'Stirling-PDF' "$Root\stirling\stirling.pid" 'Stirling-PDF'

Write-Host "完成。" -ForegroundColor Green
