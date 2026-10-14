#!/bin/sh
# 一幕·YIMU AI 短剧工坊 —— 容器启动入口
# 职责：数据库迁移 → 后台启动后端（cwd 必须为 dist）→ 前台启动网关
# 由 Dockerfile CMD 以 sh 执行。
set -eu
# pipefail 仅 bash 支持；/bin/sh（dash）下静默忽略，保证可移植
set -o pipefail 2>/dev/null || true

cd /app

# 1. 数据库迁移：失败只中文告警，不阻塞后续启动
node scripts/migrate.js || echo '[entrypoint] 警告：数据库迁移执行失败，服务仍将继续启动（请检查数据库连接与 SUDA_DATABASE_URL / DATABASE_URL）。'

# 2. 后台启动后端：与 scripts/run.sh 一致，cwd 必须为 dist
cd /app/dist && NODE_ENV=production node server/main.js &
SERVER_PID=$!
cd /app
echo "[entrypoint] 后端已启动（pid=$SERVER_PID）"

# 3. 收到退出信号时，优雅关闭后端
trap 'echo "[entrypoint] 收到退出信号，正在关闭后端…"; kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' TERM INT

# 4. 前台启动网关：容器内必须监听 0.0.0.0，由 compose 把端口映射到宿主机；
#    网关取 process.cwd() 为工程根，因此 cwd 保持 /app。
GATEWAY_HOST=0.0.0.0 node /app/scripts/gateway.js
