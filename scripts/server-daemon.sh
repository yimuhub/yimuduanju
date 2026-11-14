#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU —— 后端常驻进程（给 launchd 用，不手动执行）
# -----------------------------------------------------------------------------
# 为什么要有它：从编辑器/终端会话里 `nohup node dist/server/main.js &` 起的进程
# 会随会话回收被 SIGKILL（日志里没有任何 FATAL，看着像"项目又莫名其妙挂了"）。
# 交给 launchd 托管后，进程属于用户登录会话而不是某个 shell：
#   - 崩溃自动拉起（KeepAlive）
#   - 会话关闭、终端退出都不影响
#
# 安装（一次）：./scripts/service.sh --install
# 卸载：       ./scripts/service.sh --uninstall
# 看状态：     launchctl print gui/$(id -u)/cn.yimu.server | head -20
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
SERVER_LOG="$LOG_DIR/server.log"
mkdir -p "$LOG_DIR"

# launchd 会给 EnvironmentVariables，但这脚本也可能被手工 `bash scripts/server-daemon.sh`
# 直接跑（launchd 不可用时就是这条路）。这里补默认值，两条路都能起得来。
DB_NAME_LOCAL="${DB_NAME:-yimu}"
export SUDA_DATABASE_URL="${SUDA_DATABASE_URL:-postgres://localhost:5432/$DB_NAME_LOCAL?schema=$DB_NAME_LOCAL}"
export FORCE_AUTHN_INNERAPI_DOMAIN="${FORCE_AUTHN_INNERAPI_DOMAIN:-http://localhost:9999}"
export NODE_ENV="${NODE_ENV:-development}"
export SERVER_PORT="${SERVER_PORT:-3000}"
export JOB_WORKER_CONCURRENCY="${JOB_WORKER_CONCURRENCY:-8}"

if [ ! -f "$ROOT_DIR/dist/server/main.js" ]; then
  echo "[server-daemon] 未找到 dist/server/main.js，先构建一次"
  npm run build:server >>"$LOG_DIR/build.log" 2>&1 || {
    echo "[server-daemon] 构建失败，见 $LOG_DIR/build.log"
    exit 1
  }
fi

echo "[server-daemon] $(date '+%F %T') 启动后端（pid $$）" >>"$SERVER_LOG"
exec node "$ROOT_DIR/dist/server/main.js" >>"$SERVER_LOG" 2>&1
