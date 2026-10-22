#!/usr/bin/env bash
# DocBox 一键部署（Linux / Podman）
# 用法：sudo bash install-linux.sh [选项]
#   --port 3000          宿主机端口
#   --image-tar PATH     镜像包（默认脚本目录里的 docbox-0.4.4-image.tar）
#   --volume NAME        数据卷名（默认 docbox-data）
#   --data-dir /srv/docbox   改用绑定的数据目录（替代数据卷）
#   --boot               生成 systemd 用户服务并开机自启（quadlet）
#   --no-browser         不尝试打开浏览器
#   --skip-load          镜像已在本机（自己构建过），跳过载入镜像包
#   --registry REPO      ACR 仓库地址（默认本项目的阿里云仓库）
#   --version X.Y.Z      镜像标签（默认 0.4.4）
#   --no-pull            禁止自动 podman pull（完全离线时用）
# 默认顺序：镜像包 → 本地已有镜像 → 阿里云 ACR 自动拉取（约 4.3GB）
set -euo pipefail

PORT=3000
VERSION="0.4.4"
IMAGE="docbox:0.4.4"
REGISTRY="crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev"
NO_PULL=0
SKIP_LOAD=0
VOLUME="docbox-data"
DATA_DIR=""
IMAGE_TAR=""
BOOT=0
OPEN_BROWSER=1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

info()  { printf '\033[36m[DocBox]\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m[DocBox]\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m[DocBox]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --image-tar) IMAGE_TAR="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --volume) VOLUME="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --boot) BOOT=1; shift ;;
    --no-browser) OPEN_BROWSER=0; shift ;;
    --skip-load) SKIP_LOAD=1; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --no-pull) NO_PULL=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then SUDO="sudo"; fi

# 1) 安装 podman
if ! command -v podman >/dev/null 2>&1; then
  info "未检测到 podman，开始安装 ..."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y podman curl
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y podman curl
  elif command -v zypper >/dev/null 2>&1; then
    $SUDO zypper --non-interactive install podman curl
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm podman curl
  else
    fail "不支持的发行版，请先手动安装 podman：https://podman.io/docs/installation"
  fi
fi
info "podman：$(podman --version)"

# 2) 准备镜像：镜像包 → 本地已有 → 阿里云 ACR（依次回退）
TARGET="${REGISTRY}:${VERSION}"

have_image() { $SUDO podman image exists "$1" >/dev/null 2>&1; }

pull_image() {
  if [[ "$NO_PULL" -eq 1 ]]; then return 1; fi
  info "本地没有可用镜像，尝试从阿里云 ACR 拉取：$TARGET（约 4.3 GB，首次较慢）..."
  if $SUDO podman pull "$TARGET"; then return 0; fi
  return 1
}

if [[ "$SKIP_LOAD" -eq 0 && -z "$IMAGE_TAR" ]]; then
  for c in "$SCRIPT_DIR/docbox-${VERSION}-image.tar" "$SCRIPT_DIR/docbox-${VERSION}-image.tar.gz" \
           "$ROOT_DIR/docbox-${VERSION}-image.tar" "$ROOT_DIR/docbox-${VERSION}-image.tar.gz"; do
    if [[ -f "$c" ]]; then IMAGE_TAR="$c"; break; fi
  done
  if [[ -z "$IMAGE_TAR" && -d "$ROOT_DIR/version" ]]; then
    IMAGE_TAR="$(find "$ROOT_DIR/version" -name 'docbox-*-image.tar*' 2>/dev/null | sort | tail -1 || true)"
  fi
fi

if [[ "$SKIP_LOAD" -eq 0 && -n "$IMAGE_TAR" && -f "$IMAGE_TAR" ]]; then
  info "载入镜像包：$IMAGE_TAR（首次约 1~3 分钟）..."
  if ! $SUDO podman load -i "$IMAGE_TAR"; then
    fail "podman load 失败，镜像包可能损坏。可删掉该镜像包后重跑本脚本（会自动从 ACR 拉取）"
  fi
  info "载入完成，使用镜像 $IMAGE"
else
  if have_image "$IMAGE"; then
    info "本地已有镜像 $IMAGE，跳过载入"
  elif pull_image; then
    IMAGE="$TARGET"
    info "已从 ACR 拉取：$IMAGE"
  else
    printf '\n' >&2
    fail "没有可用的 DocBox 镜像，三选一：
  1) 连网重跑本脚本（脚本会自动 podman pull $TARGET）
  2) 离线镜像包：把 docbox-${VERSION}-image.tar 放到 deploy/ 或仓库根目录，或用 --image-tar PATH 指定
  3) 自己构建：bash deploy/build-image.sh，然后 bash deploy/install-linux.sh --skip-load"
  fi
fi

# 3) 数据卷 / 数据目录
if [[ -n "$DATA_DIR" ]]; then
  $SUDO mkdir -p "$DATA_DIR"
  MOUNT="$DATA_DIR:/data"
  info "数据目录：$DATA_DIR"
else
  if ! $SUDO podman volume exists "$VOLUME" 2>/dev/null; then
    $SUDO podman volume create "$VOLUME" >/dev/null
    info "已创建数据卷 $VOLUME"
  fi
  MOUNT="$VOLUME:/data"
fi

# 4) 重建容器
if $SUDO podman container exists docbox 2>/dev/null; then
  info "移除旧容器 docbox（数据保留）..."
  $SUDO podman rm -f docbox >/dev/null
fi
info "启动容器：端口 $PORT -> 3000"
if ! $SUDO podman run -d --name docbox --restart=always \
  -p "$PORT:3000" -v "$MOUNT" "$IMAGE" >/dev/null; then
  if $SUDO ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    fail "端口 $PORT 已被占用。换一个端口重跑，例如：bash $0 --port 3100"
  fi
  fail "容器启动失败，查看详情：$SUDO podman logs docbox"
fi

# 5) 等待健康检查
URL="http://127.0.0.1:$PORT"
info "等待服务就绪（首次启动初始化数据库，约 20~60 秒）..."
ok=0
for i in $(seq 1 90); do
  sleep 2
  if curl -fsS --max-time 3 "$URL/api/health" >/dev/null 2>&1; then ok=1; break; fi
  if [[ $i -eq 20 ]]; then info "仍在启动，继续等待 ..."; fi
done
if [[ $ok -ne 1 ]]; then
  warn "服务未在 3 分钟内就绪，最后 40 行日志："
  $SUDO podman logs --tail 40 docbox || true
  fail "启动超时"
fi

VERSION=$(curl -fsS "$URL/api/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
echo
printf '\033[32m  DocBox 已启动 v%s\033[0m\n' "$VERSION"
echo "  访问地址：$URL"
echo "  默认账号：root / root（首次登录后请在「账户管理」修改密码）"
echo "  数据位置：$MOUNT"
echo "  常用命令："
echo "    podman logs -f docbox     查看日志"
echo "    podman stop docbox        停止"
echo "    podman start docbox       启动"
echo "    podman rm -f docbox       删除容器（数据保留）"
echo

# 6) 开机自启（可选 quadlet）
if [[ "$BOOT" -eq 1 ]]; then
  USER_NAME="${SUDO_USER:-$USER}"
  UNIT_DIR="/home/$USER_NAME/.config/containers/systemd"
  info "生成 systemd 用户服务：$UNIT_DIR/docbox.container"
  $SUDO -u "$USER_NAME" mkdir -p "$UNIT_DIR"
  cat <<UNIT | $SUDO -u "$USER_NAME" tee "$UNIT_DIR/docbox.container" >/dev/null
[Unit]
Description=DocBox toolbox
After=network-online.target

[Container]
ContainerName=docbox
Image=$IMAGE
PublishPort=$PORT:3000
Volume=$MOUNT

[Service]
Restart=always

[Install]
WantedBy=default.target
UNIT
  $SUDO -u "$USER_NAME" systemctl --user daemon-reload || warn "systemctl --user 不可用，跳过开机自启"
  $SUDO -u "$USER_NAME" systemctl --user enable --now docbox.service || warn "服务启用失败，请手动运行 systemctl --user enable --now docbox"
  $SUDO loginctl enable-linger "$USER_NAME" 2>/dev/null || true
  info "已启用开机自启（systemd 用户服务 docbox.service）"
fi

if [[ "$OPEN_BROWSER" -eq 1 && -n "${DISPLAY:-}" ]] && command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
