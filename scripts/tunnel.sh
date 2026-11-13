#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU —— 公网媒体隧道（给「视频首帧」用）
# -----------------------------------------------------------------------------
# 为什么需要：Agnes 官方 /videos 的 first_frame 只吃**公网 http(s)** URL。
# 本地 `/uploads/xxx.png` 会被判成非公网素材直接丢弃，于是每一单都退化成
# 纯文生视频 —— 画面和分镜图对不上，日志里只有一行 warn。
#
# 这个脚本用 cloudflared 的**临时隧道**（trycloudflare，免注册）把本地网关
# 暴露成一个 https 地址，并把地址写进 .env 的 YIMU_PUBLIC_MEDIA_BASE。
#
# ⚠️ 临时隧道地址每次重启都会变，变了下一次出片仍然送不到首帧。
#    所以在重启机器 / 重启隧道后要重跑一次本脚本（它会顺手重启后端）。
#
# 用法：
#   ./scripts/tunnel.sh            # 起隧道 + 写 .env + 重启后端
#   ./scripts/tunnel.sh --no-restart
#   ./scripts/tunnel.sh --stop
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${TUNNEL_TARGET:-http://localhost:${GATEWAY_PORT:-5173}}"
LOG="$ROOT_DIR/logs/cloudflared.log"
PID_FILE="$ROOT_DIR/logs/cloudflared.pid"
ENV_FILE="$ROOT_DIR/.env"
RESTART=1

for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    --stop) STOP=1 ;;
  esac
done

if [ "${STOP:-0}" = "1" ]; then
  if [ -f "$PID_FILE" ]; then
    kill -TERM "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "隧道已停止（.env 里的 YIMU_PUBLIC_MEDIA_BASE 已失效，记得重跑本脚本）"
  else
    pkill -f "cloudflared tunnel --url" 2>/dev/null || true
    echo "没有记录到 PID，已尝试按进程名停止"
  fi
  exit 0
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  cat <<'EOF'
未找到 cloudflared。安装方式（任选其一）：
  brew install cloudflared
  或从 https://github.com/cloudflare/cloudflared/releases 下载对应平台的二进制放到 PATH
EOF
  exit 1
fi

mkdir -p "$ROOT_DIR/logs"

# 已有隧道且在跑就复用（避免每次重跑都换一个新域名）
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
  if [ -n "${URL:-}" ]; then
    echo "复用已在运行的隧道：$URL"
  fi
fi

if [ -z "${URL:-}" ]; then
  echo "启动临时隧道 → $TARGET"
  : > "$LOG"
  nohup cloudflared tunnel --url "$TARGET" --no-autoupdate >>"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
  for _ in $(seq 1 40); do
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)"
    [ -n "${URL:-}" ] && break
    sleep 1
  done
fi

if [ -z "${URL:-}" ]; then
  echo "未拿到公网地址，详见 $LOG"
  tail -20 "$LOG" || true
  exit 1
fi

# 写回 .env（幂等：先删旧行再追加）
python3 - "$ENV_FILE" "$URL" <<'PY'
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
print(f'已写入 .env：YIMU_PUBLIC_MEDIA_BASE={url}')
PY

# 自检：随便取一张本地图，确认外网真的能拿到
SAMPLE="$(ls -t server/../data/uploads 2>/dev/null | head -1 || true)"
echo "公网自检："
curl -s -o /dev/null -m 20 -w "  $URL/ → %{http_code}\n" "$URL/" || echo "  自检失败（可能只是首页需要鉴权，/uploads 才是关键）"

if [ "$RESTART" = "1" ]; then
  echo "重启后端以加载新的媒体基址…"
  if [ -f "$ROOT_DIR/logs/server.pid" ]; then
    kill -TERM "$(cat "$ROOT_DIR/logs/server.pid")" 2>/dev/null || true
    sleep 2
  fi
  if [ -x "$ROOT_DIR/scripts/start.sh" ]; then
    echo "请手动执行 ./scripts/start.sh 完成重启（或用你自己的启动方式）"
  fi
fi

echo
echo "完成。隧道地址：$URL"
echo "如需停止：./scripts/tunnel.sh --stop"
