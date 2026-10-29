# YIMU 桌面壳（Tauri 2 · v0）

一幕·YIMU AI 短剧创作平台 的桌面客户端壳。v0 只做「壳」：打开一个
1280x800（最小 960x640）的 WebView 窗口，加载本机网关
`http://127.0.0.1:5173`。总体设计见
[docs/多端架构与客户端打包规划.md](../docs/多端架构与客户端打包规划.md)。

## 目录结构

```
desktop/
├── README.md                      # 本文
└── src-tauri/
    ├── tauri.conf.json            # 窗口/打包配置（productName YIMU，devUrl 指向网关）
    ├── Cargo.toml                 # Rust 依赖（tauri 2）
    ├── build.rs                   # tauri-build
    ├── capabilities/default.json  # Tauri 2 权限能力（v0 仅 core:default）
    ├── icons/README.md            # 图标占位说明（构建前需先生成图标）
    └── src/
        ├── main.rs                # 入口
        └── lib.rs                 # Builder（v1 在此接入 sidecar 生命周期）
```

## 窗口与平台适配

- 默认 1280x800，最小 960x640，启动居中。
- macOS：`titleBarStyle: "Overlay"` + `hiddenTitle` + `trafficLightPosition`（等效
  trafficLightInset 适配，红绿灯不再压住内容；前端顶栏在 Tauri 环境下可按需
  预留左侧 ~80px 空间，v0 网关页面暂未做内嵌检测）。
- Windows：默认系统标题栏；release 构建 `windows_subsystem = "windows"` 隐藏控制台。
- Linux：AppImage / deb 走 `bundle.targets: "all"` 默认配置。

## 构建前提（三平台通用）

1. 安装 Rust 工具链：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   （Windows 用 rustup-init.exe；需要 MSVC Build Tools）。
   Linux 额外需要 `libwebkit2gtk-4.1-dev libgtk-3-dev` 等，见 Tauri 官方 prerequisites。
2. 准备图标：见 [src-tauri/icons/README.md](src-tauri/icons/README.md)，
   `npx @tauri-apps/cli icon <1024px 源图>` 生成。
3. 本机网关可用：`./scripts/start.sh`（v0 壳不自带后端）。

## 构建与运行

```bash
# 开发模式：先起网关（终端 1），再起壳（终端 2，加载 http://127.0.0.1:5173）
./scripts/start.sh
cd desktop && npx @tauri-apps/cli dev

# 打包
cd desktop && npx @tauri-apps/cli build
```

根目录快捷脚本（需 `npx @tauri-apps/cli`）：

```bash
npm run desktop:dev     # = 壳开发模式（需网关已启动）
npm run desktop:build   # = 壳打包
```

产物路径：

- macOS：`desktop/src-tauri/target/release/bundle/dmg/YIMU_3.0.0_*.dmg`（另有 `macos/*.app`）
- Windows：`desktop/src-tauri/target/release/bundle/nsis/YIMU_3.0.0_x64-setup.exe`（MSI 在 `msi/`）
- Linux：`desktop/src-tauri/target/release/bundle/appimage/*.AppImage`（deb 在 `deb/`）

## 代码签名提示

- macOS：Developer ID Application 证书 + `codesign` + `notarytool` 公证，
  配置入口 `bundle.macOS.signingIdentity`；细节见规划文档 §CI 矩阵。
- Windows：EV 代码签名证书（否则 SmartScreen 拦截），NSIS 打包后签名；
  Linux 不强制签名。
- 自动更新走 Tauri updater + 签名更新清单（`latest.json`），属 v1 范围。

## 与本地网关的生命周期

- **v0（当前）**：壳不管理后端。需先运行 `./scripts/start.sh`（PostgreSQL +
  NestJS + 静态网关 5173），再打开壳。网关未启动时窗口会显示连接失败页，
  刷新即可。退出壳不影响网关进程。
- **v1（规划 P1）**：Node sidecar（SEA/Bun 单文件后端）+ 内嵌 PostgreSQL 由壳
  拉起，端口自动选 3000~3099，退出时反序关停，替代手工 start.sh；
  详见规划文档 §五/§七。
