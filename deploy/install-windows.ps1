# DocBox 一键部署（Windows / Podman）
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里执行：
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# 默认流程：有镜像包就载入 → 没有就本地镜像 → 都没有就自动从阿里云 ACR 拉取（约 4.3GB）
# 可选参数：-Port 3000 -ImageTar .\docbox-0.4.4-image.tar -Volume docbox-data -NoBrowser -NoPull
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ImageTar = "",
  [string]$Image    = "docbox:0.4.4",
  [int]$Port        = 3000,
  [string]$Volume   = "docbox-data",
  [int]$Cpus        = 4,
  [int]$MemoryMB    = 6144,
  [switch]$NoBrowser,
  [switch]$SkipLoad,
  [string]$Registry = "crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev",
  [string]$Version  = "0.4.4",
  [switch]$NoPull
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

# 3) 准备镜像：镜像包 → 本地已有 → 阿里云 ACR（依次回退）
$norm = { param($s) "$s".Trim() -replace "^(localhost|docker\.io)/", "" }
$targetRef = "${Registry}:${Version}"

function Get-LocalImageNames {
  $raw = @(& $podman images --format "{{.Repository}}:{{.Tag}}" 2>$null)
  if (-not $raw.Count) {
    Warn "podman 没能列出本地镜像（可能虚拟机的 podman.socket 挂了），尝试重启 podman.socket ..."
    & $podman machine ssh "systemctl --user restart podman.socket" 2>$null | Out-Null
    Start-Sleep -Seconds 5
    $raw = @(& $podman images --format "{{.Repository}}:{{.Tag}}" 2>$null)
  }
  return @($raw | ForEach-Object { & $norm $_ } | Where-Object { $_ -and $_ -notmatch "<none>" })
}

function Try-PullImage {
  if ($NoPull) { return $false }
  Info "本地没有可用镜像，尝试从阿里云 ACR 拉取：$targetRef（约 4.3 GB，首次较慢）..."
  & $podman pull $targetRef
  if ($LASTEXITCODE -ne 0) { return $false }
  return $true
}

if (-not $ImageTar) {
  $candidates = @(
    (Join-Path $PSScriptRoot "docbox-$Version-image.tar"),
    (Join-Path $PSScriptRoot "docbox-$Version-image.tar.gz"),
    (Join-Path $script:Root "docbox-$Version-image.tar"),
    (Join-Path $script:Root "docbox-$Version-image.tar.gz")
  ) + (Get-ChildItem -Path (Join-Path $script:Root "version") -Recurse -Include "docbox-*-image.tar","docbox-*-image.tar.gz" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  $ImageTar = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

if (-not $SkipLoad -and $ImageTar -and (Test-Path $ImageTar)) {
  Info "载入镜像包：$ImageTar（首次需要 1~3 分钟）..."
  & $podman load -i $ImageTar
  if ($LASTEXITCODE -ne 0) { Fail "podman load 失败，镜像包可能损坏；可改用 -NoPull:\$false 从 ACR 拉取" }
  Info "载入完成，使用镜像 $Image"
} else {
  $have = Get-LocalImageNames
  if ($have -contains (& $norm $Image)) {
    Info "本地已有镜像 $Image，跳过载入"
  } elseif (Try-PullImage) {
    $Image = $targetRef
    Info "已从 ACR 拉取：$Image"
  } else {
    Fail @"
没有可用的 DocBox 镜像，三种办法任选其一：
  1) 连网跑一次（脚本会自动 podman pull）：重新执行本脚本，或手动
     podman pull $targetRef
  2) 用离线镜像包：把 docbox-$Version-image.tar 放到 deploy\\ 或仓库根目录，或加 -ImageTar PATH
  3) 自己构建：deploy\build-image.ps1，然后 .\deploy\install-windows.ps1 -SkipLoad
当前本地镜像：$($have -join ', ')
"@
  }
}

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
