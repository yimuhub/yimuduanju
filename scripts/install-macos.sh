#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU AI 短剧工坊 —— macOS 一键安装脚本
# -----------------------------------------------------------------------------
# 步骤：
#   [0] 检查 Homebrew（缺失则给中文指引并退出）
#   [1] 安装 Node.js 22 与 PostgreSQL 16（已安装则跳过；node@22 是 keg-only，
#       装好后若 PATH 中的 node 不可用/版本不足会自动尝试 brew link）
#   [2] npm install（node_modules 已存在则跳过）
#   [3] node scripts/setup.js（文件不存在则跳过并提示）
#   [4] brew services start postgresql@16（已在运行则跳过）
#
# 用法：
#   chmod +x scripts/install-macos.sh
#   ./scripts/install-macos.sh
#
# 安装完成后运行 ./scripts/start.sh 启动，访问 http://localhost:5173/
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

c_blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
c_green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
c_red()   { printf "\033[1;31m%s\033[0m\n" "$*"; }
c_yellow(){ printf "\033[1;33m%s\033[0m\n" "$*"; }

node_major() {
  if command -v node >/dev/null 2>&1; then
    local v
    v="$(node --version 2>/dev/null | sed 's/^v//')"
    v="${v%%.*}"
    case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
  else
    echo 0
  fi
}

# ---------- 0. Homebrew ----------
c_blue "[0] 检查 Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  c_red "未找到 Homebrew，请先安装 Homebrew 后再运行本脚本："
  c_red "  1. 打开浏览器访问 https://brew.sh"
  c_red "  2. 按页面指引在终端运行安装命令"
  c_red "  3. 安装完成后重新运行本脚本"
  exit 1
fi
c_green "    Homebrew 已安装"

# ---------- 1. Node.js 22 与 PostgreSQL 16 ----------
c_blue "[1] 检查 Node.js 与 PostgreSQL..."
MISSING_PKGS=()
if brew list node@22 >/dev/null 2>&1; then
  c_green "    node@22 已安装，跳过"
else
  MISSING_PKGS+=(node@22)
fi
if brew list postgresql@16 >/dev/null 2>&1; then
  c_green "    postgresql@16 已安装，跳过"
else
  MISSING_PKGS+=(postgresql@16)
fi

if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
  c_blue "    正在安装：${MISSING_PKGS[*]}（可能需要几分钟）..."
  brew install "${MISSING_PKGS[@]}"
  c_green "    安装完成"
fi

# node@22 是 keg-only 公式，安装后不会自动进入 PATH；
# 若当前 node 不可用或版本不足，尝试自动链接，失败则给中文指引。
if [ "$(node_major)" -lt 22 ]; then
  c_yellow "    当前 PATH 中的 node 不可用或版本低于 22，尝试链接 node@22..."
  c_yellow "    说明：Homebrew 的 node@22 是 keg-only 版本，安装后需手动链接才能直接使用。"
  if brew link --overwrite --force node@22 >/dev/null 2>&1; then
    c_green "    已自动执行 brew link --overwrite --force node@22"
  else
    c_yellow "    自动链接失败，请按以下任选其一手动处理后重新运行本脚本："
    c_yellow "      1) brew link --overwrite --force node@22"
    c_yellow "      2) export PATH=\"/opt/homebrew/opt/node@22/bin:\$PATH\"   （Apple Silicon Mac）"
    c_yellow "         export PATH=\"/usr/local/opt/node@22/bin:\$PATH\"     （Intel Mac）"
    exit 1
  fi
fi
if [ "$(node_major)" -lt 22 ]; then
  c_red "    node 仍不可用或版本低于 22（当前：$(node --version 2>/dev/null || echo 未安装)），需要 >= 22。"
  c_red "    请按上方说明手动处理 node@22 的链接后重新运行本脚本。"
  exit 1
fi
c_green "    Node.js 版本 OK（$(node --version)）"

# ---------- 2. 项目依赖 ----------
c_blue "[2] 安装项目依赖..."
if [ -d "$ROOT_DIR/node_modules" ]; then
  c_green "    node_modules 已存在，跳过 npm install"
else
  npm install
  c_green "    依赖安装完成"
fi

# ---------- 3. 初始化 ----------
c_blue "[3] 运行初始化脚本..."
if [ -f "$ROOT_DIR/scripts/setup.js" ]; then
  node scripts/setup.js
  c_green "    初始化完成"
else
  c_yellow "    未找到 scripts/setup.js，已跳过此步（若安装包内应包含该文件，请确认文件完整）"
fi

# ---------- 4. 启动 PostgreSQL ----------
c_blue "[4] 启动 PostgreSQL..."
PG_RUNNING=0
if command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  PG_RUNNING=1
elif brew services list 2>/dev/null | grep -Eq '^postgresql@16[[:space:]]+started'; then
  PG_RUNNING=1
fi
if [ "$PG_RUNNING" -eq 1 ]; then
  c_green "    PostgreSQL 已在运行，跳过启动"
else
  brew services start postgresql@16
  c_green "    PostgreSQL 服务已启动（并设为开机自启）"
fi

# ---------- 5. 完成 ----------
c_green ""
c_green "=================================================================="
c_green "  安装完成！"
c_green "  启动项目：./scripts/start.sh"
c_green "  访问地址：http://localhost:5173/"
c_green "=================================================================="
