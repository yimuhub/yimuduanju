# YIMU 桌面客户端（Tauri 2 · v1 全量自包含）

一幕·YIMU AI 短剧创作平台的桌面客户端。**开包即用**：安装包里自带 Node 运行时、
PostgreSQL 16 二进制与 ffmpeg，用户不需要装 Node / 数据库 / Redis，也不需要跑
`./scripts/start.sh`。

## 目录结构

```
desktop/
├── README.md                     # 本文
├── splash/index.html             # 启动页（等内嵌运行时起来时显示）
├── icon-source.png               # 1024px 图标源图
├── runtime/                      # 内嵌运行时（Node 侧，打包进 app/app/）
│   ├── launch.cjs                # 入口：端口分配 → PG → 迁移 → 后端 → 网关 → READY
│   └── lib/{database,ports,log}.cjs
└── src-tauri/
    ├── tauri.conf.json           # 窗口/打包配置；resources 指向 build/desktop-app
    ├── Cargo.toml                # Rust 依赖（tauri 2）
    ├── capabilities/default.json # 权限（仅 core:default，壳不做文件/网络插件）
    ├── icons/                    # 三平台图标（由 icon-source.png 生成）
    └── src/{main,lib}.rs         # 壳：拉起 sidecar、读 READY、导航、退出时关停
```

## 构建

```bash
# 1. 生成运行时目录（内嵌 Node + PostgreSQL + ffmpeg + 生产依赖）
npm run desktop:pack

# 2. 打安装包（需要 Rust 工具链）
npm run desktop:build

# 3. 只验证运行时（不启壳，直接看日志/接口）
npm run desktop:run
```

产物：`desktop/src-tauri/target/release/bundle/`（dmg / macos / nsis / msi / appimage / deb）。

跨平台必须用 CI（`.github/workflows/desktop-build.yml`），Tauri 不支持从 macOS
交叉编译出 Windows/Linux 安装包。

## 壳层行为

1. 开窗即显示 `splash/index.html`（Graphite 风格，四步进度）。
2. Rust 侧 `spawn` 资源目录下的 `app/node app/launch.cjs`，注入：
   - `YIMU_APP_DIR`：资源目录 `app/`
   - `YIMU_DATA_DIR`：`app_data_dir()`（macOS `~/Library/Application Support/com.yimu.desktop`）
   - `YIMU_PARENT_PID`：壳进程 pid，运行时用它做父进程看门狗
3. 读 stdout：`YIMU_READY <url>` → 窗口 `location.replace` 到该地址；
   `YIMU_ERROR <msg>` → 启动页展示可读错误（不是白屏）。
4. 退出（`RunEvent::Exit`）时对 sidecar 发 SIGTERM，运行时据此先停后端与网关、
   再停 PostgreSQL，杜绝孤儿进程。

## 数据与日志

- 数据（数据库/上传/密钥/日志）全在数据目录，**升级安装不覆盖**。
- 日志：`<数据目录>/logs/{desktop,server,gateway}.log`。

## 代码签名（发布前必做）

- macOS：Developer ID Application 证书 + `codesign` + `notarytool` 公证，
  配置入口 `bundle.macOS.signingIdentity`；当前构建是未签名包，首次打开需右键「打开」。
- Windows：EV 代码签名证书（否则 SmartScreen 拦截）。
- Linux：不强制签名。

详见 [docs/桌面客户端与Docker分发.md](../docs/桌面客户端与Docker分发.md) 与
[docs/多端架构与客户端打包规划.md](../docs/多端架构与客户端打包规划.md)。
