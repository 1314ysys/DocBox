# DocBox 从源码构建镜像（Windows / Podman）
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\deploy\build-image.ps1
#   powershell -ExecutionPolicy Bypass -File .\deploy\build-image.ps1 -Tag docbox:test -SkipModels
# 完成后可直接跑： .\deploy\install-windows.ps1 -SkipLoad
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Tag = "docbox:0.4.1",
  [switch]$SkipModels,
  [switch]$NoCache,
  [string]$Dns = "223.5.5.5,119.29.29.29"
)

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $PSScriptRoot
function Info($m) { Write-Host "[build] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[build] $m" -ForegroundColor Red; exit 1 }

# 1) podman
$podman = Get-Command podman -ErrorAction SilentlyContinue
if (-not $podman) { Fail "未找到 podman，请先安装：winget install RedHat.Podman（装完重开终端）" }
Info "podman：$(& $podman.Source --version)"

# 2) 虚拟机
$machines = (& $podman.Source machine list --format "{{.Name}} {{.Running}}" 2>$null) -join "`n"
if (-not $machines.Trim()) { Info "初始化 podman 虚拟机（4 核 / 6 GB）..."; & $podman.Source machine init --cpus 4 --memory 6144 --disk-size 80 }
if ($machines -notmatch "true") { Info "启动虚拟机..."; & $podman.Source machine start }

# 3) 语音模型（可选，缺了只是转写不可用）
$modelFile = Join-Path $script:Root "deploy\models\sherpa\sense-voice\model.int8.onnx"
if ($SkipModels) {
  Write-Host "[build] 跳过模型下载（-SkipModels）" -ForegroundColor Yellow
} elseif (Test-Path $modelFile) {
  Info "语音模型已存在，跳过下载"
} else {
  Info "下载语音模型（约 420 MB，来自 hf-mirror.com）..."
  & node (Join-Path $script:Root "deploy\fetch-models.mjs")
  if ($LASTEXITCODE -ne 0) { Write-Host "[build] 模型下载失败：镜像仍可构建，但语音转写不可用（可稍后重跑本脚本）" -ForegroundColor Yellow }
}

# 4) 构建
$dnsArgs = @()
if ($Dns) { foreach ($d in $Dns.Split(',')) { if ($d.Trim()) { $dnsArgs += '--dns'; $dnsArgs += $d.Trim() } } }
$cacheArgs = @()
if ($NoCache) { $cacheArgs += '--no-cache' }
Info "开始构建 $Tag（首次约 10~20 分钟，含依赖与 chromium）..."
Push-Location $script:Root
try {
  $buildArgs = @('build') + $cacheArgs + $dnsArgs + @('-t', $Tag, '.')
  & $podman.Source @buildArgs
  if ($LASTEXITCODE -ne 0) { Fail "podman build 失败（上面有详细报错）" }
} finally { Pop-Location }

Info "构建完成：$Tag"
& $podman.Source images $Tag
Write-Host ""
Info "下一步：.\deploy\install-windows.ps1 -SkipLoad    # 用刚构建的镜像起容器"
