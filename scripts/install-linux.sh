#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU AI 短剧工坊 —— Linux 一键安装脚本
# -----------------------------------------------------------------------------
# 支持：Debian/Ubuntu（apt）、RHEL/CentOS/Rocky/AlmaLinux（dnf）、Arch（pacman）
#
# 步骤：
#   [0] 检查 root / sudo（非 root 则提示用 sudo 重跑）
#   [1] 安装 Node.js 22（apt/dnf 走 NodeSource，pacman 走系统源；装完校验主版本）
#   [2] 安装 PostgreSQL 16，启动并设开机自启（systemctl enable --now）
#   [3] 配置数据库免密访问（start.sh 用 psql -h localhost 走 TCP 连接）
#   [4] npm install（node_modules 已存在则跳过）
#   [5] node scripts/setup.js（文件不存在则跳过并提示）
#   [6] 询问是否安装 systemd 开机自启服务（15 秒无应答默认否）
#
# 用法：
#   chmod +x scripts/install-linux.sh
#   sudo ./scripts/install-linux.sh
#
# 注意：start.sh 默认按 macOS Homebrew 路径查找 PostgreSQL，
#       Linux 下运行 start.sh 前请先 export PG_BIN / PGDATA（脚本结尾会给出本机适用的值）。
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

c_blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
c_green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
c_red()   { printf "\033[1;31m%s\033[0m\n" "$*"; }
c_yellow(){ printf "\033[1;33m%s\033[0m\n" "$*"; }

# 以调用 sudo 的普通用户身份执行，避免 root 污染项目文件属主
as_user() {
  if [ "$SUDO_USER" != "root" ]; then
    sudo -u "$SUDO_USER" "$@"
  else
    "$@"
  fi
}

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

check_node_ok() {
  if [ "$(node_major)" -ge 22 ]; then
    c_green "    Node.js 版本 OK（$(node --version)）"
    return 0
  fi
  c_red "    Node.js 仍不可用或版本低于 22（当前：$(node --version 2>/dev/null || echo 未安装)），需要 >= 22。"
  c_red "    请手动安装 Node.js >= 22（https://nodejs.org/）后重新运行本脚本。"
  exit 1
}

# ---------- 0. root 检查 ----------
c_blue "[0] 检查运行身份..."
if [ "$EUID" -ne 0 ]; then
  c_red "请使用 root 或 sudo 运行本脚本："
  c_red "  sudo ./scripts/install-linux.sh"
  exit 1
fi
SUDO_USER="${SUDO_USER:-root}"
c_green "    当前为 root 身份"

# ---------- 包管理器识别 ----------
c_blue "识别包管理器..."
PKG_MGR=""
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
else
  c_red "不支持的 Linux 发行版：未找到 apt-get / dnf / pacman。"
  c_red "请手动安装 Node.js >= 22 与 PostgreSQL 16，"
  c_red "然后在项目根目录运行：npm install && node scripts/setup.js"
  exit 1
fi
c_green "    包管理器：$PKG_MGR"

# ---------- 1. Node.js 22 ----------
c_blue "[1] 安装 Node.js 22..."
case "$PKG_MGR" in
  apt)
    if [ "$(node_major)" -ge 22 ]; then
      c_green "    Node.js 已满足要求，跳过安装"
    else
      c_blue "    通过 NodeSource 安装 Node.js 22..."
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
    fi
    ;;
  dnf)
    if [ "$(node_major)" -ge 22 ]; then
      c_green "    Node.js 已满足要求，跳过安装"
    else
      c_blue "    通过 NodeSource 安装 Node.js 22..."
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      dnf install -y nodejs
    fi
    ;;
  pacman)
    if [ "$(node_major)" -ge 22 ]; then
      c_green "    Node.js 已满足要求，跳过安装"
    else
      c_blue "    通过 pacman 安装 nodejs..."
      pacman -Sy --needed --noconfirm nodejs
    fi
    ;;
esac
check_node_ok

# ---------- 2. PostgreSQL 16 ----------
c_blue "[2] 安装 PostgreSQL 16..."
PG_SERVICE=""
PG_BIN_HINT=""
PGDATA_HINT=""
case "$PKG_MGR" in
  apt)
    if dpkg-query -W -f='${Status}' postgresql-16 2>/dev/null | grep -q "install ok installed"; then
      c_green "    postgresql-16 已安装，跳过"
    else
      c_blue "    尝试从系统源安装 postgresql-16..."
      if ! apt-get install -y postgresql-16; then
        c_yellow "    系统源没有 postgresql-16，尝试添加 PGDG 官方源..."
        apt-get install -y curl ca-certificates gnupg
        install -m 0755 -d /usr/share/postgresql-common/pgdg
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
          | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
        CODENAME="$(lsb_release -cs 2>/dev/null || awk -F= '/^VERSION_CODENAME=/{print $2}' /etc/os-release 2>/dev/null || echo "")"
        if [ -z "$CODENAME" ]; then
          c_red "    无法识别系统版本代号，请手动安装 PostgreSQL 16 后重新运行本脚本："
          c_red "    https://www.postgresql.org/download/ 选择你的发行版按指引操作"
          exit 1
        fi
        echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
          > /etc/apt/sources.list.d/pgdg.list
        apt-get update
        apt-get install -y postgresql-16 || {
          c_red "    PostgreSQL 16 安装失败，请手动安装后重新运行本脚本："
          c_red "    https://www.postgresql.org/download/ 选择你的发行版按指引操作"
          exit 1
        }
      fi
    fi
    PG_SERVICE="postgresql"
    PG_BIN_HINT="/usr/lib/postgresql/16/bin"
    PGDATA_HINT="/var/lib/postgresql/16/main"
    ;;
  dnf)
    if rpm -q postgresql16-server >/dev/null 2>&1; then
      c_green "    postgresql16-server 已安装，跳过"
    else
      c_blue "    通过 PGDG 官方源安装 PostgreSQL 16..."
      RHEL_VER="$(rpm -E '%{rhel}' 2>/dev/null || echo 9)"
      dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-${RHEL_VER}-x86_64/pgdg-redhat-repo-latest.noarch.rpm" || {
        c_red "    PGDG 源添加失败，请手动安装 PostgreSQL 16 后重新运行本脚本："
        c_red "    https://www.postgresql.org/download/linux/redhat/"
        exit 1
      }
      dnf -qy module disable postgresql || true
      dnf install -y postgresql16-server || {
        c_red "    postgresql16-server 安装失败，请手动安装后重新运行本脚本："
        c_red "    https://www.postgresql.org/download/linux/redhat/"
        exit 1
      }
      /usr/pgsql-16/bin/postgresql-16-setup initdb || true
    fi
    PG_SERVICE="postgresql-16"
    PG_BIN_HINT="/usr/pgsql-16/bin"
    PGDATA_HINT="/var/lib/pgsql/16/data"
    ;;
  pacman)
    if pacman -Q postgresql >/dev/null 2>&1; then
      c_green "    postgresql 已安装，跳过"
    else
      c_blue "    通过 pacman 安装 postgresql..."
      pacman -Sy --needed --noconfirm postgresql || {
        c_red "    postgresql 安装失败，请手动安装后重新运行本脚本。"
        exit 1
      }
    fi
    if [ ! -f /var/lib/postgres/data/PG_VERSION ]; then
      c_blue "    初始化数据库簇..."
      sudo -u postgres initdb -D /var/lib/postgres/data
    fi
    PG_SERVICE="postgresql"
    PG_BIN_HINT="/usr/bin"
    PGDATA_HINT="/var/lib/postgres/data"
    ;;
esac

# 本机 PG 可执行文件目录加入 PATH（后续 psql / pg_isready 调用需要）
export PATH="$PG_BIN_HINT:$PATH"
PSQL="$PG_BIN_HINT/psql"

# ---------- 启动 PostgreSQL 并设开机自启 ----------
c_blue "启动 PostgreSQL 并设置开机自启..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now "$PG_SERVICE"
  c_green "    PostgreSQL 已启动并设为开机自启（服务名：$PG_SERVICE）"
else
  c_yellow "    未找到 systemctl，已跳过开机自启设置；请手动启动 PostgreSQL 后再继续。"
fi

# ---------- 3. 数据库免密访问 ----------
# start.sh 用 psql -h localhost（TCP）连接数据库；Debian/RHEL 系默认要求密码认证。
# 这里为调用 sudo 的用户创建一个同名数据库超级用户，并写入 ~/.pgpass（600 权限）。
if [ "$SUDO_USER" != "root" ]; then
  c_blue "[3] 配置数据库访问..."
  USER_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  USER_HOME="${USER_HOME:-/home/$SUDO_USER}"
  if sudo -u "$SUDO_USER" "$PSQL" -h localhost -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    c_green "    $SUDO_USER 已可连接 PostgreSQL，跳过配置"
  else
    c_yellow "    $SUDO_USER 经 TCP 尚不能免密连接 PostgreSQL（start.sh 走 -h localhost）。"
    DB_ANS=""
    read -r -t 30 -p "    是否为 $SUDO_USER 创建数据库超级用户并写入 ~/.pgpass 免密文件？[y/N] " DB_ANS || DB_ANS=""
    case "$DB_ANS" in
      y|Y|yes|YES)
        if ! sudo -u postgres "$PSQL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='$SUDO_USER'" | grep -q 1; then
          sudo -u postgres "$PG_BIN_HINT/createuser" -s "$SUDO_USER"
        fi
        DB_PW=""
        read -r -s -t 60 -p "    请设置数据库密码（将写入 $USER_HOME/.pgpass，仅本人可读）： " DB_PW || DB_PW=""
        echo ""
        if [ -n "$DB_PW" ]; then
          sudo -u postgres "$PSQL" -v pw="$DB_PW" -c "ALTER USER \"$SUDO_USER\" PASSWORD :'pw';" >/dev/null
          printf 'localhost:5432:*:*:%s\n' "$DB_PW" > "$USER_HOME/.pgpass"
          chmod 600 "$USER_HOME/.pgpass"
          chown "$SUDO_USER:" "$USER_HOME/.pgpass"
          unset DB_PW
          c_green "    数据库用户与免密文件配置完成"
        else
          c_yellow "    未输入密码，已跳过：运行 start.sh 前请自行配置 PostgreSQL 认证。"
        fi
        ;;
      *)
        c_yellow "    已跳过：运行 start.sh 前请自行配置 PostgreSQL 密码认证。"
        ;;
    esac
  fi
else
  c_yellow "[3] 直接以 root 运行，已跳过数据库用户配置；请用普通用户运行 start.sh 并自行配置 PostgreSQL 认证。"
fi

# ---------- 4. 项目依赖 ----------
c_blue "[4] 安装项目依赖..."
if [ -d "$ROOT_DIR/node_modules" ]; then
  c_green "    node_modules 已存在，跳过 npm install"
else
  as_user env ROOT_DIR="$ROOT_DIR" bash -c 'cd "$ROOT_DIR" && npm install'
  c_green "    依赖安装完成"
fi

# ---------- 5. 初始化 ----------
c_blue "[5] 运行初始化脚本..."
if [ -f "$ROOT_DIR/scripts/setup.js" ]; then
  as_user env ROOT_DIR="$ROOT_DIR" bash -c 'cd "$ROOT_DIR" && node scripts/setup.js'
  c_green "    初始化完成"
else
  c_yellow "    未找到 scripts/setup.js，已跳过此步（若安装包内应包含该文件，请确认文件完整）"
fi

# ---------- 6. systemd 开机自启服务（可选） ----------
c_blue "[6] systemd 开机自启服务"
if ! command -v systemctl >/dev/null 2>&1; then
  c_yellow "    未找到 systemctl，跳过此步。"
else
  SVC_ANS=""
  read -r -t 15 -p "是否安装 systemd 开机自启服务？[y/N] " SVC_ANS || SVC_ANS=""
  case "$SVC_ANS" in
    y|Y|yes|YES)
      TEMPLATE="$ROOT_DIR/deploy/yimuduanju.service"
      if [ ! -f "$TEMPLATE" ]; then
        c_red "    未找到模板文件 deploy/yimuduanju.service，无法安装 systemd 服务。"
        exit 1
      fi
      ESCAPED_ROOT="${ROOT_DIR//&/\\&}"
      sed "s|<绝对路径>|${ESCAPED_ROOT}|g" "$TEMPLATE" > /etc/systemd/system/yimuduanju.service
      systemctl daemon-reload
      systemctl enable yimuduanju
      c_green "    systemd 服务已安装并设为开机自启：/etc/systemd/system/yimuduanju.service"
      c_yellow "    注意：start.sh 默认按 macOS Homebrew 路径查找 PostgreSQL，"
      c_yellow "    Linux 下请编辑 /etc/systemd/system/yimuduanju.service，"
      c_yellow "    取消对应 Environment 行的注释并确认路径无误："
      c_yellow "      Environment=PG_BIN=$PG_BIN_HINT"
      c_yellow "      Environment=PGDATA=$PGDATA_HINT"
      c_yellow "    修改后执行：systemctl daemon-reload"
      c_blue "    启动服务：systemctl start yimuduanju"
      c_blue "    查看状态：systemctl status yimuduanju"
      ;;
    *)
      c_yellow "    已跳过 systemd 服务安装。"
      ;;
  esac
fi

# ---------- 完成 ----------
c_green ""
c_green "=================================================================="
c_green "  安装完成！"
c_green "  手动启动：先设置 PostgreSQL 路径环境变量（本机适用值）："
c_green "    export PG_BIN=$PG_BIN_HINT"
c_green "    export PGDATA=$PGDATA_HINT"
c_green "  然后运行：./scripts/start.sh"
c_green "  访问地址：http://localhost:5173/"
c_green "=================================================================="
