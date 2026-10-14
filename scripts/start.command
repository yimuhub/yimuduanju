#!/usr/bin/env bash
# 一木·YIMU AI 视频创作平台一键启动（双击此文件，或在终端执行）
# 双击前：先执行一次 chmod +x scripts/start.command
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT_DIR/scripts/start.sh"
