# 桌面客户端与 Docker 分发说明

> 一幕·YIMU AI 短剧创作平台 · 全量自包含打包
> 版本：v1（2026-11-12）· 对应 `desktop/runtime`、`scripts/desktop-pack.js`、`deploy/Dockerfile.allinone`

## 一、四种交付形态

| 形态 | 产物 | 需要用户装什么 | 适用 |
|---|---|---|---|
| macOS 桌面端 | `YIMU_3.7.3_*.dmg` / `.app` | **什么都不用装** | 设计/导演个人创作 |
| Windows 桌面端 | `YIMU_3.7.3_x64-setup.exe`（NSIS）/ `.msi` | **什么都不用装** | 同上 |
| Linux 桌面端 | `.AppImage` / `.deb` | **什么都不用装**（AppImage 免安装） | 同上 |
| Docker 单容器 | `yimuhub/yimuduanju:3.7.3` | 只有 Docker | 自部署 / NAS / 小团队共用一台机器 |
| Docker 三容器 | 根目录 `docker-compose.yml` | Docker + Compose | 企业版：app/Postgres/Redis 分离 |

## 二、「全量」到底包含了什么

`scripts/desktop-pack.js` 会产出一个自包含目录（约 400 MB，安装包压缩后约 150–200 MB）：

```
build/desktop-app/
├─ node                    # 内嵌 Node 22 运行时（不用装 Node）
├─ bin/ffmpeg              # 内嵌 ffmpeg（首帧压缩、成片拼接）
├─ launch.cjs              # 运行时入口
├─ dist/{server,client,shared}   # 前后端构建产物
├─ scripts/{gateway.js,migrate.js,db-init.sql}
├─ server/database/migrations/   # 20 个 SQL 增量迁移
└─ node_modules/           # 仅生产依赖
   └─ @embedded-postgres/<platform>   # PostgreSQL 16 二进制（bin/lib/share 全套）
```

**不含**：Redis（后端自带进程内串行降级）、模型推理运行时、浏览器内核（Tauri 用系统 WebView）。

### 启动链路（`desktop/runtime/launch.cjs`）

```
壳层拉起 launch.cjs
 → 端口自动分配（后端 3000-3099 / 网关 5100-5199 / 数据库 5433-5499）
 → 首次：initdb 建集群（<数据目录>/pg）+ 建库 + 建表 + 跑 20 个迁移
 → 起后端 Nest（127.0.0.1:自动端口）
 → 起本地网关（伺服 dist/client + 代理 /api + 注入单用户身份）
 → 健康检查通过 → 输出 YIMU_READY <url> → 壳层加载 WebView
退出：SIGTERM → 先停后端/网关，再停 PostgreSQL；父进程消失有看门狗兜底
```

首次启动约 10–20 秒（initdb 占大头），之后 2–3 秒。

## 三、数据与配置放在哪

| 内容 | macOS | Windows | Linux |
|---|---|---|---|
| 数据目录 | `~/Library/Application Support/com.yimu.desktop` | `%APPDATA%\com.yimu.desktop` | `~/.local/share/com.yimu.desktop` |
| 数据库 | 上表 `pg/` | 同上 | 同上 |
| 上传文件 | 上表 `uploads/` | 同上 | 同上 |
| 密钥 | 上表 `secrets.json`（`YIMU_KEY_SECRET` / `ENTERPRISE_ADMIN_TOKEN`，首次自动生成） | 同上 | 同上 |
| 日志 | 上表 `logs/{desktop,server,gateway}.log` | 同上 | 同上 |

- 备份 = 拷走整个数据目录；换机 = 把目录放到新机同位置。
- 卸载应用不会删除数据目录，需要连数据一起清时手动删。
- Docker 形态下这一切都在 `/data` 卷里：`docker run -v yimu-data:/data`。

## 四、本机构建

```bash
npm ci                      # 开发依赖（构建用）
npm run build:prod          # 前后端产物
npm run desktop:pack        # 生成 build/desktop-app（内嵌 Node+PG+ffmpeg）
npm run desktop:build       # 打安装包（Tauri）

# 只想验证运行时（不起壳）：
npm run desktop:run
```

产物位置：`desktop/src-tauri/target/release/bundle/`（`dmg/`、`macos/`、`nsis/`、`msi/`、`appimage/`、`deb/`）。

**跨平台构建必须用 CI**：Tauri 不能从 macOS 交叉编译 Windows/Linux 安装包。
仓库已带 `.github/workflows/desktop-build.yml`，矩阵覆盖：

- `macos-14` → `aarch64-apple-darwin`
- `macos-13` → `x86_64-apple-darwin`
- `windows-latest` → `x86_64-pc-windows-msvc`
- `ubuntu-22.04` → `x86_64-unknown-linux-gnu`

手动触发：Actions → Desktop Build → Run workflow；打 `v*` tag 也会跑。

## 五、Docker

```bash
# 单容器（自带 PostgreSQL）
docker build -f deploy/Dockerfile.allinone -t yimuhub/yimuduanju:latest .
docker run -d --name yimu -p 127.0.0.1:5173:5173 -v yimu-data:/data yimuhub/yimuduanju:latest
open http://localhost:5173/app/yimu/

# 或用 compose
docker compose -f deploy/docker-compose.allinone.yml up -d --build
```

- 镜像里没有外部依赖，`/data` 是唯一需要持久化的路径。
- 默认发布到 `127.0.0.1`：`/api/*` 没有登录校验，暴露到局域网等于把数据给同网段。
  确需局域网访问时改 `YIMU_LISTEN_HOST=0.0.0.0` + `YIMU_ALLOW_LAN=true`（compose 里已写好）。
- 健康检查：`GET /`（跟随 302 到 `/app/yimu/`）。

## 六、已知限制（都不影响开包即用）

1. **未做代码签名**：macOS 首次打开需右键「打开」，Windows 会过 SmartScreen。
   正式发布需要 Developer ID 证书 + 公证（macOS）与 EV 证书（Windows）。
2. **模型通道要自己配 Key**：桌面端是本地优先，生成动作仍走用户自己的供应商 Key
   （设置页配置），平台不代付。
3. **无 Redis**：队列退化为进程内串行（`JOB_WORKER_CONCURRENCY=2`），单人创作够用；
   多人并发请用三容器版接 Redis。
4. **记忆检索降级**：语义检索依赖的本地向量模型（约 440 MB）没有打进桌面包，
   桌面端自动降级为关键词检索；需要向量检索时在服务器形态使用。
5. **首帧公网地址**：部分视频通道只接受公网 URL，桌面端靠「生图返回 URL」解决；
   纯 base64 中转商需要配 `YIMU_PUBLIC_MEDIA_BASE`。

## 七、排障

| 现象 | 先看这里 |
|---|---|
| 启动页停在「启动内嵌数据库」 | `<数据目录>/logs/desktop.log`；常见是数据目录无写权限或 5433-5499 全被占 |
| 提示「安装包不完整」 | 安装包被裁剪，`app/node` 或 `app/launch.cjs` 缺失 |
| 页面能开但接口 403 | 正常的 CSRF 双提交校验，用浏览器访问即可；curl 需先拿 `suda-csrf-token` cookie |
| 端口冲突 | 运行时自动换端口，URL 以启动页跳转后的地址为准 |
