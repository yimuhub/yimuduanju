#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU —— 后端常驻服务管理（launchd）
# -----------------------------------------------------------------------------
# 解决的老问题：从终端 / 编辑器会话里起的 node 进程，会话一回收就被 SIGKILL，
# 表现是「项目又莫名其妙被终止了」，而日志里连 FATAL 都没有。
#
# 用法：
#   ./scripts/service.sh --install    # 装成常驻服务（崩溃自动拉起）
#   ./scripts/service.sh --uninstall  # 卸载并停止
#   ./scripts/service.sh --restart    # 重启（改完代码重建后用这个）
#   ./scripts/service.sh --status     # 看状态
#
# 说明：走 launchd 后请不要再手动 `nohup node dist/server/main.js`，
#       否则两个进程抢同一个端口/同一张表（历史上就踩过）。
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LABEL="cn.yimu.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)/$LABEL"
LOG_DIR="$ROOT_DIR/logs"
DB_NAME="${DB_NAME:-yimu}"
PORT_SERVER="${SERVER_PORT:-3000}"
CONCURRENCY="${JOB_WORKER_CONCURRENCY:-8}"

ACTION="${1:---status}"

case "$ACTION" in
  --status)
    if launchctl print "$TARGET" >/dev/null 2>&1; then
      launchctl print "$TARGET" 2>/dev/null | grep -E "state|pid|last exit code|program =" | head -8
    else
      echo "未安装常驻服务（$LABEL）"
    fi
    ;;

  --uninstall)
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootout "$TARGET" 2>/dev/null || true
    rm -f "$PLIST"
    echo "已卸载后端常驻服务"
    ;;

  --restart)
    if launchctl print "$TARGET" >/dev/null 2>&1; then
      launchctl kickstart -k "$TARGET"
      echo "已重启 $LABEL"
    else
      echo "未安装，先执行 ./scripts/service.sh --install"
      exit 1
    fi
    ;;

  --install)
    command -v node >/dev/null 2>&1 || { echo "未找到 node"; exit 1; }
    chmod +x "$ROOT_DIR/scripts/server-daemon.sh"
    mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

    # 先收拾掉所有零散起的后端，避免抢端口/抢表
    pkill -f "node dist/server/main.js" 2>/dev/null || true
    pkill -f "npx nest start" 2>/dev/null || true
    sleep 2

    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/server-daemon.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/server-daemon.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server-daemon.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>SUDA_DATABASE_URL</key><string>postgres://localhost:5432/$DB_NAME?schema=$DB_NAME</string>
    <key>FORCE_AUTHN_INNERAPI_DOMAIN</key><string>http://localhost:9999</string>
    <key>NODE_ENV</key><string>development</string>
    <key>SERVER_PORT</key><string>$PORT_SERVER</string>
    <key>JOB_WORKER_CONCURRENCY</key><string>$CONCURRENCY</string>
  </dict>
</dict>
</plist>
EOF

    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
    launchctl kickstart -k "$TARGET" 2>/dev/null || true

    echo -n "等待后端就绪"
    for _ in $(seq 1 60); do
      if curl -sf -m 2 --noproxy '*' -o /dev/null "http://localhost:$PORT_SERVER/" 2>/dev/null; then
        echo " → 就绪"
        echo "访问：http://localhost:${GATEWAY_PORT:-5173}/"
        exit 0
      fi
      echo -n "."
      sleep 1
    done
    echo
    echo "60s 内未就绪，看日志：tail -40 $LOG_DIR/server.log"
    exit 1
    ;;

  *)
    echo "用法：$0 --install | --uninstall | --restart | --status"
    exit 1
    ;;
esac
