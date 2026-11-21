#!/usr/bin/env bash
# macOS 桌面客户端打包（.app + .dmg），带签名封条校验。
#
# 背景：Tauri 在未配置 signingIdentity 时**完全跳过 codesign**，产物只剩链接器给
# 主二进制的 ad-hoc 签名（Info.plist 未绑定、无 Sealed Resources）。这种包一旦被
# 浏览器下载打上 com.apple.quarantine，Gatekeeper 校验封条失败，弹「已损坏，无法
# 打开。你应该将它移到废纸篓」，且系统设置里没有「仍要打开」开关。
# 见 tauri.conf.json 的 bundle.macOS.signingIdentity = "-"（默认 ad-hoc 封条）。
#
# 有 Apple 开发者证书时，设置以下环境变量即自动升级为 Developer ID 签名 + 公证：
#   APPLE_SIGNING_IDENTITY  例：Developer ID Application: Xxx (TEAMID)
#   APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID   （公证账号，App 专用密码）
#
# 用法：
#   bash scripts/macos-bundle.sh                       # 本机架构
#   bash scripts/macos-bundle.sh aarch64-apple-darwin
#   bash scripts/macos-bundle.sh x86_64-apple-darwin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
LABEL="${TARGET:-$(uname -m)}"
LABEL="${LABEL/aarch64-apple-darwin/macos-arm64}"
LABEL="${LABEL/x86_64-apple-darwin/macos-x64}"

APP_NAME="$(node -p "require('./desktop/src-tauri/tauri.conf.json').productName")"
VER="$(node -p "require('./package.json').version")"
if [ -z "$TARGET" ]; then
  BUNDLE="desktop/src-tauri/target/release/bundle"
  BUILD_ARGS="--bundles app"
else
  BUNDLE="desktop/src-tauri/target/$TARGET/release/bundle"
  BUILD_ARGS="--target $TARGET --bundles app"
fi
APP="$BUNDLE/macos/$APP_NAME.app"
DMG="$BUNDLE/dmg/YIMU_${VER}_${LABEL}.dmg"

log() { printf '[macos-bundle] %s\n' "$*"; }

# ---------- 1. 出 .app ----------
log "打包 ${APP_NAME}.app（${VER}）"
(cd desktop && npx --yes @tauri-apps/cli@2 build $BUILD_ARGS)

if [ ! -d "$APP" ]; then
  echo "找不到产物：${APP}" >&2
  echo "若 productName 改名，请同步 scripts/macos-bundle.sh 与 CI 的路径。" >&2
  exit 1
fi

# ---------- 2. 签名 ----------
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [ -n "$IDENTITY" ]; then
  log "使用 Developer ID 签名：$IDENTITY"
else
  IDENTITY="-"
  log "未提供证书，使用 ad-hoc 签名（保证封条完整，用户首次打开需手动放行）"
fi

# --deep 依次重签内嵌的 node / ffmpeg / PostgreSQL 二进制，再封外层 app
SIGN_ARGS=(--force --deep --options runtime --sign "$IDENTITY")
if [ -n "$IDENTITY" ] && [ "$IDENTITY" != "-" ]; then
  SIGN_ARGS+=(--timestamp)
else
  SIGN_ARGS+=(--timestamp=none)
fi
if [ -f desktop/src-tauri/entitlements.plist ]; then
  SIGN_ARGS+=(--entitlements desktop/src-tauri/entitlements.plist)
fi
codesign "${SIGN_ARGS[@]}" "$APP"

# 封条必须能过：这一步失败就是「已损坏」的根因，宁可构建失败也不出废包
log "校验签名封条"
codesign --verify --deep --strict --verbose=2 "$APP"

# ---------- 3. 公证（有证书时才做） ----------
if [ -n "$IDENTITY" ] && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  log "提交 Apple 公证（可能耗时数分钟）"
  ZIP="$(mktemp -d)/${APP_NAME}.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  xcrun notarytool submit "$ZIP" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$APP"
  rm -rf "$(dirname "$ZIP")"
fi

# ---------- 4. 出 DMG（ditto 保留封条，附 Applications 快捷方式） ----------
STAGE="$(mktemp -d)"
MNT="$(mktemp -d)"
cleanup() {
  hdiutil detach "$MNT" -quiet 2>/dev/null || true
  rm -rf "$STAGE" "$MNT"
}
trap cleanup EXIT

log "生成 DMG：$DMG"
ditto "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/安装说明.txt" <<'TXT'
一幕短剧（YIMU）· macOS 安装说明

1. 把「一幕短剧.app」拖进左侧「Applications（应用程序）」文件夹。
2. 首次打开若被系统拦下（提示「无法验证开发者」或「已损坏」），任选其一：
   · 在「应用程序」里右键点图标 → 打开 → 再点「打开」；
   · 或执行：xattr -cr "/Applications/一幕短剧.app"
3. 数据保存在 ~/Library/Application Support/com.yimu.desktop，升级不会丢。
TXT

mkdir -p "$BUNDLE/dmg"
hdiutil create -ov -srcfolder "$STAGE" -format UDZO \
  -volname "$APP_NAME" "$DMG" >/dev/null
hdiutil verify "$DMG" >/dev/null

# ---------- 5. 校验 DMG 内的 app 封条没被打包环节破坏 ----------
log "校验 DMG 内的签名封条"
hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -quiet
codesign --verify --deep --strict --verbose=2 "$MNT/$APP_NAME.app"
hdiutil detach "$MNT" -quiet

log "完成：$APP"
log "完成：$DMG"
