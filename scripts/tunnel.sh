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
# 临时隧道地址每次重连都会变。地址写在 `.tunnel-url`，后端每 15s 读一次，
# 所以**换域名不需要重启后端**；但临时隧道进程本身活不过终端会话，
# 想长期出片请用常驻模式（launchd 托管，机器不关机就一直活着）。
#
# 用法：
#   ./scripts/tunnel.sh --install   # ★推荐：装成常驻服务（KeepAlive，自动跟随新域名）
#   ./scripts/tunnel.sh --uninstall # 卸载常驻服务
#   ./scripts/tunnel.sh             # 前台临时起一条（调试用，会话结束就没了）
#   ./scripts/tunnel.sh --stop      # 停掉前台那条
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${TUNNEL_TARGET:-http://localhost:${GATEWAY_PORT:-5173}}"
LOG="$ROOT_DIR/logs/cloudflared.log"
PID_FILE="$ROOT_DIR/logs/cloudflared.pid"
ENV_FILE="$ROOT_DIR/.env"
URL_FILE="$ROOT_DIR/.tunnel-url"
RESTART=0

for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    --stop) STOP=1 ;;
    --install) INSTALL=1 ;;
    --uninstall) UNINSTALL=1 ;;
  esac
done

# ---------------------------------------------------------------------------
# 常驻模式：交给 launchd（KeepAlive），不依赖任何终端会话，
# 隧道重连换域名时自动刷新 .tunnel-url，后端 15s 内跟上、无需重启。
# ---------------------------------------------------------------------------
PLIST="$HOME/Library/LaunchAgents/cn.yimu.tunnel.plist"
LAUNCHD_TARGET="gui/$(id -u)/cn.yimu.tunnel"

if [ "${UNINSTALL:-0}" = "1" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootout "$LAUNCHD_TARGET" 2>/dev/null || true
  rm -f "$PLIST"
  pkill -f "tunnel-daemon.sh" 2>/dev/null || true
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  echo "已卸载常驻隧道（cn.yimu.tunnel）"
  exit 0
fi

if [ "${INSTALL:-0}" = "1" ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "未找到 cloudflared，先执行：brew install cloudflared"
    exit 1
  fi
  chmod +x "$ROOT_DIR/scripts/tunnel-daemon.sh"
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT_DIR/logs"
  # 先把手动起的那条停掉，避免两条隧道抢同一个 upstream
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  rm -f "$PID_FILE"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>cn.yimu.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/tunnel-daemon.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT_DIR/logs/tunnel-daemon.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/logs/tunnel-daemon.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
  launchctl kickstart -k "$LAUNCHD_TARGET" 2>/dev/null || true
  echo "已安装常驻隧道。等待域名…"
  for _ in $(seq 1 60); do
    URL="$(cat "$URL_FILE" 2>/dev/null | head -1 || true)"
    [ -n "${URL:-}" ] && break
    sleep 1
  done
  if [ -n "${URL:-}" ]; then
    echo "常驻隧道地址：$URL（已写入 .tunnel-url，后端自动跟随）"
    echo "查看状态：launchctl print $LAUNCHD_TARGET | head -20"
  else
    echo "60s 内没拿到域名，看日志：tail -30 $ROOT_DIR/logs/tunnel-daemon.err.log"
  fi
  exit 0
fi

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
  URL="$(cat "$URL_FILE" 2>/dev/null | head -1 || true)"
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

# 地址真源：.tunnel-url（后端每 15s 读一次，隧道换域名**不需要重启后端**）
printf '%s\n' "$URL" > "$URL_FILE"
echo "已写入 .tunnel-url：$URL"

# 同时写回 .env，供重启后才启动的进程 / 自部署场景兜底（幂等：先删旧行再追加）
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

# 自检：取一张真实的上传图，确认外网真的能拿到（首页要鉴权，不看首页）
SAMPLE_PATH="$(find "$ROOT_DIR/data/uploads" -type f -name '*.png' 2>/dev/null | head -1 || true)"
if [ -n "${SAMPLE_PATH:-}" ]; then
  # uploads 是 /uploads/<uuid>/<file>.png 两级结构，不能只 glob 一层
  REL="/uploads/$(basename "$(dirname "$SAMPLE_PATH")")/$(basename "$SAMPLE_PATH")"
  echo "公网自检：$REL"
  curl -s --noproxy '*' -o /dev/null -m 30 \
    -w "  → %{http_code} %{content_type} %{size_download} bytes\n" "$URL$REL" \
    || echo "  自检失败：外网仍拿不到 $REL"
else
  echo "公网自检跳过：data/uploads 下还没有 png"
fi

if [ "$RESTART" = "1" ]; then
  if [ -f "$ROOT_DIR/logs/server.pid" ]; then
    kill -TERM "$(cat "$ROOT_DIR/logs/server.pid")" 2>/dev/null || true
    sleep 2
  fi
  echo "请手动执行 ./scripts/start.sh 完成重启（或用你自己的启动方式）"
fi

echo
echo "完成。隧道地址：$URL"
echo "后端会自动跟随（15s 内生效），无需重启。"
echo "如需停止：./scripts/tunnel.sh --stop"
