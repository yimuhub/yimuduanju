# 一幕·YIMU AI 短剧工坊 —— Docker 多阶段构建
# 构建：docker build -t yimuduanju .
# 运行：docker compose up --build

# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# 先拷贝依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

# 拷贝其余源码，构建后端（Nest）与前端（Vite）
COPY . .
RUN npx nest build
RUN npx vite build --config vite.config.ts

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# 仅装生产依赖（migrate.js 需要 postgres，gateway.js 需要 dotenv，均在 dependencies）
COPY package.json package-lock.json ./
RUN npm install --omit=dev --ignore-scripts \
  && npm cache clean --force

# 只带运行时必需产物：前端/后端构建结果、脚本、SQL 迁移文件
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server/database/migrations ./server/database/migrations

# 5173 网关 / 3000 后端
EXPOSE 5173 3000

CMD ["sh", "scripts/docker-entrypoint.sh"]
