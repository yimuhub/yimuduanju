#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU AI 短剧工坊 —— 本地一键启动脚本
# -----------------------------------------------------------------------------
# 功能：
#   1. 检查并启动 PostgreSQL（Homebrew postgresql@16）
#   2. 确保数据库 yimu 存在、表结构与种子数据就绪（幂等）
#   3. 启动后端 NestJS（端口 3000，走平台数据层兼容环境变量）
#   4. 启动本地网关（端口 5173，伺服前端产物 + 转发动态请求 + 注入用户身份）
#   5. 自动打开浏览器访问 http://localhost:5173/（首页直挂根路径）
#
# 用法：./scripts/start.sh   （或双击 start.command）
# 停止：./scripts/stop.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"

SERVER_LOG="$LOG_DIR/server.log"
GATEWAY_LOG="$LOG_DIR/gateway.log"
PGDATA="${PGDATA:-/opt/homebrew/var/postgresql@16}"
DB_NAME="yimu"
PORT_GATEWAY="${GATEWAY_PORT:-5173}"
PORT_SERVER="${SERVER_PORT:-3000}"

c_blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
c_green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
c_red()   { printf "\033[1;31m%s\033[0m\n" "$*"; }
c_yellow(){ printf "\033[1;33m%s\033[0m\n" "$*"; }

# ---------- 0. 端口占用检查 ----------
if lsof -nP -iTCP:$PORT_SERVER -sTCP:LISTEN >/dev/null 2>&1; then
  c_yellow "[0] 端口 $PORT_SERVER 已被占用（后端可能已在运行），跳过后端启动"
  SERVER_ALREADY=1
else
  SERVER_ALREADY=0
fi
if lsof -nP -iTCP:$PORT_GATEWAY -sTCP:LISTEN >/dev/null 2>&1; then
  c_yellow "[0] 端口 $PORT_GATEWAY 已被占用（网关可能已在运行），跳过网关启动"
  GATEWAY_ALREADY=1
else
  GATEWAY_ALREADY=0
fi

# ---------- 0.5 Node.js 环境自检（P1：版本/依赖不对时给中文指引，不甩英文堆栈） ----------
c_blue "[0.5] 检查 Node.js 环境..."
if ! command -v node >/dev/null 2>&1; then
  c_red "未找到 node。请先安装 Node.js >= 22（官网 https://nodejs.org/），然后重新运行本脚本。"
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  c_red "node 版本过低（当前 $NODE_VER），需要 >= 22。"
  c_red "请升级 Node.js（nvm install 22，或从 https://nodejs.org/ 下载），然后重新运行本脚本。"
  exit 1
fi
c_green "    node 版本 OK（v${NODE_VER}）"
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  c_red "依赖未安装（未找到 node_modules），请先在项目根目录运行：npm install"
  exit 1
fi
c_green "    依赖目录 OK（node_modules）"

# ---------- 1. PostgreSQL ----------
c_blue "[1] 检查 PostgreSQL..."
if ! command -v pg_isready >/dev/null 2>&1; then
  if [ -x "$PG_BIN/pg_isready" ]; then
    PATH="$PG_BIN:$PATH"
  else
    c_red "未找到 pg_isready。请先安装：brew install postgresql@16"
    c_red "或设置 PG_BIN 环境变量指向 postgres bin 目录。"
    exit 1
  fi
fi

if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  c_green "    PostgreSQL 已在运行"
else
  c_blue "    启动 PostgreSQL..."
  if [ -x "$PG_BIN/postgres" ] && [ -d "$PGDATA" ]; then
    nohup "$PG_BIN/postgres" -D "$PGDATA" >"$LOG_DIR/postgres.log" 2>&1 &
    sleep 3
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
      c_green "    PostgreSQL 启动成功"
    else
      c_yellow "    尝试 brew services 启动..."
      brew services start postgresql@16 >/dev/null 2>&1 || true
      sleep 3
    fi
  else
    brew services start postgresql@16 >/dev/null 2>&1 || true
    sleep 3
  fi
fi
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  c_red "PostgreSQL 无法启动，请检查安装。"
  exit 1
fi

# ---------- 1.5 Redis（任务队列；缺失则消费器自动降级为进程内串行，不阻塞启动） ----------
if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -h localhost -p 6379 ping >/dev/null 2>&1; then
    c_green "    Redis 已就绪（任务队列 BullMQ 模式）"
  else
    c_yellow "    尝试 brew services 启动 Redis..."
    brew services start redis >/dev/null 2>&1 || true
    sleep 2
    if redis-cli -h localhost -p 6379 ping >/dev/null 2>&1; then
      c_green "    Redis 启动成功"
    else
      c_yellow "    Redis 未运行，任务队列将降级为进程内模式（功能可用，并发为 1）"
    fi
  fi
else
  c_yellow "    未安装 Redis（brew install redis 可启用队列并发），任务队列降级为进程内模式"
fi

# ---------- 2. 数据库 ----------
c_blue "[2] 准备数据库..."
DB_EXISTS=$(psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo 0)
if [ "$DB_EXISTS" != "1" ]; then
  c_blue "    创建数据库 $DB_NAME ..."
  createdb -h localhost "$DB_NAME"
fi

# 建表（幂等：已建则跳过）
TABLE_COUNT=$(psql -h localhost -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)
if [ "${TABLE_COUNT:-0}" -lt "3" ]; then
  c_blue "    初始化表结构与种子数据..."
  psql -h localhost -d "$DB_NAME" -f "$ROOT_DIR/scripts/db-init.sql" >/dev/null
  c_green "    数据库初始化完成"
else
  c_green "    数据库已就绪（$TABLE_COUNT 张表）"
fi

# 平台角色（SET LOCAL ROLE 依赖）——幂等
for role in authenticated_yimu anon_yimu service_role_yimu; do
  psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$role'" | grep -q 1 || \
    psql -h localhost -d postgres -c "CREATE ROLE $role NOLOGIN" >/dev/null
done
psql -h localhost -d "$DB_NAME" -c "GRANT USAGE ON SCHEMA public TO authenticated_yimu, anon_yimu, service_role_yimu; GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated_yimu, anon_yimu, service_role_yimu; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated_yimu, anon_yimu, service_role_yimu;" >/dev/null 2>&1 || true

# 增量迁移（SQL-first，幂等：已执行自动跳过）
c_blue "    执行数据库增量迁移..."
SUDA_DATABASE_URL="postgres://localhost:5432/$DB_NAME?schema=$DB_NAME" node "$ROOT_DIR/scripts/migrate.js" >>"$LOG_DIR/migrate.log" 2>&1 || {
  c_red "迁移失败，详见 $LOG_DIR/migrate.log"
  exit 1
}

# ---------- 3. 前端构建产物 ----------
c_blue "[3] 检查前端构建产物..."
if [ ! -f "$ROOT_DIR/dist/client/index.html" ] || [ ! -d "$ROOT_DIR/dist/client/assets" ]; then
  c_blue "    未找到构建产物，执行生产构建（约 1 分钟）..."
  (cd "$ROOT_DIR" && NODE_ENV=production npx vite build --config vite.config.ts >"$LOG_DIR/build.log" 2>&1) || {
    c_red "前端构建失败，详见 $LOG_DIR/build.log"
    exit 1
  }
  c_green "    前端构建完成"
else
  c_green "    构建产物已存在（dist/client）"
fi

# ---------- 4. 后端 ----------
if [ "$SERVER_ALREADY" = "0" ]; then
  c_blue "[4] 启动后端 NestJS（端口 ${PORT_SERVER}）..."
  cd "$ROOT_DIR"
  nohup env \
    SUDA_DATABASE_URL="postgres://localhost:5432/$DB_NAME?schema=$DB_NAME" \
    FORCE_AUTHN_INNERAPI_DOMAIN="http://localhost:9999" \
    NODE_ENV=development \
    SERVER_PORT=$PORT_SERVER \
    JOB_WORKER_CONCURRENCY="${JOB_WORKER_CONCURRENCY:-4}" \
    npx nest start >"$SERVER_LOG" 2>&1 &
  echo $! > "$LOG_DIR/server.pid"
  c_blue "    等待后端就绪..."
  for i in $(seq 1 40); do
    if curl -sf -m 2 "http://localhost:$PORT_SERVER/" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if curl -sf -m 2 "http://localhost:$PORT_SERVER/" >/dev/null 2>&1; then
    c_green "    后端启动成功"
  else
    c_red "后端启动失败，请查看日志：$SERVER_LOG"
    tail -20 "$SERVER_LOG" || true
    exit 1
  fi
else
  c_green "    后端已在运行"
fi

# ---------- 5. 网关 ----------
if [ "$GATEWAY_ALREADY" = "0" ]; then
  c_blue "[5] 启动本地网关（端口 ${PORT_GATEWAY}）..."
  cd "$ROOT_DIR"
  nohup env SUDA_DATABASE_URL="postgres://localhost:5432/$DB_NAME?schema=$DB_NAME" \
    node scripts/gateway.js >"$GATEWAY_LOG" 2>&1 &
  echo $! > "$LOG_DIR/gateway.pid"
  sleep 2
  if curl -sf -m 3 "http://localhost:$PORT_GATEWAY/" >/dev/null 2>&1; then
    c_green "    网关启动成功"
  else
    c_red "网关启动失败，请查看日志：$GATEWAY_LOG"
    tail -20 "$GATEWAY_LOG" || true
    exit 1
  fi
else
  c_green "    网关已在运行"
fi

# ---------- 6. 完成 ----------
URL="http://localhost:$PORT_GATEWAY/"
c_green ""
c_green "================================================================"
c_green "  一幕·YIMU AI 短剧工坊已启动！"
c_green "  访问地址：$URL"
c_green "  后端日志：$SERVER_LOG"
c_green "  网关日志：$GATEWAY_LOG"
c_green "  停止服务：./scripts/stop.sh"
c_green "================================================================"
echo ""
if command -v open >/dev/null 2>&1; then
  open "$URL"
fi
