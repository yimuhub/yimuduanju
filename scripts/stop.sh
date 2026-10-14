#!/usr/bin/env bash
# 一木·YIMU AI 视频创作平台本地停止脚本：停止网关与后端（PostgreSQL 保留运行）
# 用法：./scripts/stop.sh
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"

if [ -f "$LOG_DIR/gateway.pid" ]; then
  kill "$(cat "$LOG_DIR/gateway.pid")" 2>/dev/null && echo "[stop] 网关已停止"
  rm -f "$LOG_DIR/gateway.pid"
else
  # 兜底：按进程名停止
  pkill -f "scripts/gateway.js" 2>/dev/null && echo "[stop] 网关已停止" || true
fi

if [ -f "$LOG_DIR/server.pid" ]; then
  # nest start 会派生多个进程，按端口清理
  lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | sort -u | xargs -r kill 2>/dev/null || true
  kill "$(cat "$LOG_DIR/server.pid")" 2>/dev/null && echo "[stop] 后端已停止"
  rm -f "$LOG_DIR/server.pid"
else
  lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | sort -u | xargs -r kill 2>/dev/null || true
  echo "[stop] 后端已停止"
fi

echo "[stop] 完成。PostgreSQL 保持运行。"
