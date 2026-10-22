#!/usr/bin/env bash
# DocBox 从源码构建镜像（Linux / macOS）
#   sudo bash deploy/build-image.sh
#   bash deploy/build-image.sh --tag docbox:test --skip-models --no-cache
# 完成后：sudo bash deploy/install-linux.sh --skip-load
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="docbox:0.4.4"
SKIP_MODELS=0
NO_CACHE=""
SUDO=""
[[ "$(id -u)" -ne 0 ]] && SUDO="sudo"

info() { printf '\033[36m[build]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[build]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[build]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --skip-models) SKIP_MODELS=1; shift ;;
    --no-cache) NO_CACHE="--no-cache"; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

command -v podman >/dev/null 2>&1 || fail "未找到 podman，请先安装（Debian/Ubuntu: apt install podman；Fedora: dnf install podman）"
info "podman：$(podman --version)"

if [[ $SKIP_MODELS -eq 1 ]]; then
  warn "跳过模型下载（--skip-models），语音转写将不可用"
elif [[ -f "$ROOT/deploy/models/sherpa/sense-voice/model.int8.onnx" ]]; then
  info "语音模型已存在，跳过下载"
else
  command -v node >/dev/null 2>&1 || fail "下载模型需要 Node.js 18+（或手动把模型放到 deploy/models，见 deploy/README.md）"
  info "下载语音模型（约 420 MB）..."
  node "$ROOT/deploy/fetch-models.mjs" || warn "模型下载失败：镜像仍可构建，但语音转写不可用"
fi

info "开始构建 $TAG（首次约 10~20 分钟）..."
cd "$ROOT"
$SUDO podman build $NO_CACHE -t "$TAG" .
info "构建完成："
podman images "$TAG"
echo
info "下一步：$SUDO bash deploy/install-linux.sh --skip-load"
