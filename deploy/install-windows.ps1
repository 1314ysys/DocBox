# DocBox 一键部署（Windows / Podman）
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里执行：
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# 可选参数：-Port 3000 -ImageTar .\docbox-0.2.0-image.tar -Volume docbox-data -NoBrowser
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ImageTar = "",
  [string]$Image    = "docbox:0.2.0",
  [int]$Port        = 3000,
  [string]$Volume   = "docbox-data",
  [int]$Cpus        = 4,
  [int]$MemoryMB    = 6144,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $PSScriptRoot
function Info($m) { Write-Host "[DocBox] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[DocBox] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[DocBox] $m" -ForegroundColor Red; exit 1 }

function Find-Podman {
  $cmd = Get-Command podman -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\RedHat\Podman\podman.exe", "$env:LOCALAPPDATA\Programs\RedHat\Podman\podman.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Install-Podman {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "未找到 podman，也没有 winget。请先安装 Podman Desktop：https://podman.io/docs/installation（安装后重跑本脚本）"
  }
  Info "未检测到 podman，开始用 winget 安装 Red Hat Podman（约 100MB，需要网络）..."
  winget install --id RedHat.Podman --source winget --accept-package-agreements --accept-source-agreements --silent
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Find-Podman)) { Fail "podman 安装后仍未找到可执行文件，请重启 PowerShell 后重跑。" }
}

# 1) podman
$podman = Find-Podman
if (-not $podman) { Install-Podman; $podman = Find-Podman }
if (-not $podman) { Fail "podman 不可用" }
Info "podman: $podman（$(& $podman --version)）"

# 2) podman 虚拟机
$machines = (& $podman machine list --format "{{.Name}}|{{.Running}}") -join "`n"
if (-not $machines.Trim()) {
  Info "初始化 podman 虚拟机（CPU $Cpus / 内存 $MemoryMB MB / 磁盘 80GB）..."
  & $podman machine init --cpus $Cpus --memory $MemoryMB --disk-size 80
} elseif ($machines -notmatch 'true') {
  Info "启动 podman 虚拟机..."
  & $podman machine start
}
if ($LASTEXITCODE -ne 0) { Fail "podman 虚拟机启动失败，请运行 'podman machine start' 查看原因。" }
Info "podman 虚拟机已就绪"

# 3) 镜像包
if (-not $ImageTar) {
  $candidates = @(
    (Join-Path $PSScriptRoot "docbox-0.2.0-image.tar"),
    (Join-Path $PSScriptRoot "docbox-0.2.0-image.tar.gz"),
    (Join-Path $script:Root "docbox-0.2.0-image.tar"),
    (Join-Path $script:Root "docbox-0.2.0-image.tar.gz")
  ) + (Get-ChildItem -Path (Join-Path $script:Root "version") -Recurse -Include "docbox-*-image.tar","docbox-*-image.tar.gz" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  $ImageTar = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $ImageTar -or -not (Test-Path $ImageTar)) { Fail "找不到镜像包 docbox-*-image.tar(.gz)，请把它放在 $PSScriptRoot 后重跑，或用 -ImageTar 指定路径。" }
Info "载入镜像：$ImageTar（首次需要 1~3 分钟）..."
& $podman load -i $ImageTar
if ($LASTEXITCODE -ne 0) { Fail "podman load 失败" }

# 4) 数据卷
$vols = & $podman volume ls --format "{{.Name}}"
if ($vols -notcontains $Volume) { & $podman volume create $Volume | Out-Null; Info "已创建数据卷 $Volume" }

# 5) 重建容器（保留数据卷）
$exists = (& $podman ps -a --format "{{.Names}}") -split "`n"
if ($exists -contains "docbox") {
  Info "移除旧容器 docbox（数据卷保留）..."
  & $podman rm -f docbox | Out-Null
}
Info "启动容器（端口 $Port -> 3000）..."
& $podman run -d --name docbox --restart=always `
  -p "${Port}:3000" -v "${Volume}:/data" $Image | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "容器启动失败，运行 'podman logs docbox' 查看原因" }

# 6) 等待健康检查
$url = "http://127.0.0.1:$Port"
Info "等待服务就绪（首次启动要初始化数据库，约 20~60 秒）..."
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
  if ($i -eq 20) { Info "仍在启动，继续等待..." }
}
if (-not $ok) {
  Warn "服务未在 3 分钟内就绪，最后 40 行日志："
  & $podman logs --tail 40 docbox
  Fail "启动超时"
}

$health = (Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing).Content | ConvertFrom-Json
Write-Host ""
Write-Host "  DocBox 已启动  v$($health.version)" -ForegroundColor Green
Write-Host "  访问地址：$url"
Write-Host "  默认账号：root / root（首次登录后请到「账户管理」修改密码）"
Write-Host "  数据卷：  $Volume（数据库 / 上传 / 产物都在里面，删除容器不丢数据）"
Write-Host "  常用命令："
Write-Host "    podman logs -f docbox        查看日志"
Write-Host "    podman stop docbox           停止"
Write-Host "    podman start docbox          启动"
Write-Host "    podman rm -f docbox          删除容器（数据卷保留）"
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }
