#!/bin/sh
# DocBox 容器入口：初始化 MariaDB（数据在 /data/mysql）→ 建库建号 → 启动应用
set -e

DATA_DIR="${DOCBOX_DATA_DIR:-/data}"
DB_NAME="${DOCBOX_DB_NAME:-docbox}"
DB_USER="${DOCBOX_DB_USER:-docbox}"
DB_PASS="${DOCBOX_DB_PASSWORD:-docbox}"
MYSQL_DIR="$DATA_DIR/mysql"
SOCK="/run/mysqld/mysqld.sock"

log() { echo "[docbox] $*"; }

mkdir -p "$DATA_DIR" "$DATA_DIR/uploads" "$DATA_DIR/outputs" "$DATA_DIR/cache" "$MYSQL_DIR" /run/mysqld
chown -R mysql:mysql /run/mysqld 2>/dev/null || true

# 1) 首次启动初始化数据目录
if [ ! -d "$MYSQL_DIR/mysql" ]; then
  log "初始化 MariaDB 数据目录 $MYSQL_DIR ..."
  mariadb-install-db --user=mysql --datadir="$MYSQL_DIR" --auth-root-authentication-method=normal >/tmp/mariadb-install.log 2>&1 || {
    cat /tmp/mariadb-install.log; exit 1; }
fi

# 2) 启动 MariaDB（仅本机 3306，供应用访问）
log "启动 MariaDB ..."
mariadbd --user=mysql --datadir="$MYSQL_DIR" --socket="$SOCK" \
  --pid-file=/run/mysqld/mysqld.pid --bind-address=127.0.0.1 --port=3306 \
  --skip-name-resolve --innodb-buffer-pool-size=128M \
  --log-error=/tmp/mariadb.err &
DB_PID=$!

for i in $(seq 1 60); do
  if mariadb-admin --socket="$SOCK" ping >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! mariadb-admin --socket="$SOCK" ping >/dev/null 2>&1; then
  log "MariaDB 启动失败：" ; cat /tmp/mariadb.err || true; exit 1
fi

# 3) 建库 / 建账号（幂等）
mariadb --socket="$SOCK" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

cleanup() {
  log "收到停止信号，正在退出 ..."
  kill "$APP_PID" 2>/dev/null || true
  mariadb-admin --socket="$SOCK" -uroot shutdown >/dev/null 2>&1 || kill "$DB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup TERM INT

# 4) 启动应用
log "启动 DocBox（$DB_USER@$DB_NAME，数据目录 $DATA_DIR）..."
cd /app
node --max-old-space-size=4096 server.mjs &
APP_PID=$!
wait "$APP_PID"
