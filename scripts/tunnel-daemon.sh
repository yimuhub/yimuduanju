#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU —— 公网媒体隧道常驻进程（给 launchd 用，不手动执行）
# -----------------------------------------------------------------------------
# 和 scripts/tunnel.sh 的区别：
#   tunnel.sh        一次性启动，进程挂在当前终端下，终端/会话结束就会被回收
#   tunnel-daemon.sh 由 launchd 托管（KeepAlive），机器不关机就一直活着；
#                    cloudflared 每次重连换域名时，watcher 会自动把新域名
#                    写进 .tunnel-url，后端 15s 内自己跟上，**不用重启后端**。
#
# 安装（一次即可）：  ./scripts/tunnel.sh --install
# 卸载：              ./scripts/tunnel.sh --uninstall
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${TUNNEL_TARGET:-http://localhost:${GATEWAY_PORT:-5173}}"
LOG="$ROOT_DIR/logs/cloudflared.log"
URL_FILE="$ROOT_DIR/.tunnel-url"
ENV_FILE="$ROOT_DIR/.env"

mkdir -p "$ROOT_DIR/logs"

# 每次启动清空日志，watcher 才能只抓「本次」的域名，不会拿起上一次的旧地址
: > "$LOG"

(
  for _ in $(seq 1 180); do
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)"
    if [ -n "${URL:-}" ]; then
      printf '%s\n' "$URL" > "$URL_FILE"
      if [ -f "$ENV_FILE" ]; then
        # 用 python 回写：BSD sed 的 -i '' 在子 shell 里容易把表达式当文件名（实测踩过）
        python3 - "$ENV_FILE" "$URL" <<'PY' 2>/dev/null || true
import re, sys
path, url = sys.argv[1], sys.argv[2]
try:
    s = open(path, encoding='utf-8').read()
except FileNotFoundError:
    s = ''
s = re.sub(r'^YIMU_PUBLIC_MEDIA_BASE=.*$\n?', '', s, flags=re.M)
if s and not s.endswith('\n'):
    s += '\n'
s += f'YIMU_PUBLIC_MEDIA_BASE={url}\n'
open(path, 'w', encoding='utf-8').write(s)
PY
      fi
      echo "[tunnel-daemon] $(date '+%H:%M:%S') 新域名 $URL 已写入 .tunnel-url / .env"
      break
    fi
    sleep 1
  done
) &

# 前台运行：launchd 靠它判断存活，进程退出即按 KeepAlive 重启
exec cloudflared tunnel --url "$TARGET" --no-autoupdate --logfile "$LOG"
