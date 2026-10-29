//! 一幕·YIMU AI 短剧创作平台 · Tauri 2 桌面壳 v0
//!
//! 壳只负责一件事：打开 WebView 窗口并加载本机网关
//! `http://127.0.0.1:5173`（由 `./scripts/start.sh` 拉起，端口与
//! scripts/gateway.js 保持一致）。
//!
//! v1 规划（见 docs/多端架构与客户端打包规划.md · P1）：
//! 在这里以 sidecar（`tauri_plugin_shell` + `externalBin`）拉起
//! Node 单文件后端与内嵌 PostgreSQL，退出时反序关停，替代手工 start.sh。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)]
            eprintln!(
                "[yimu-desktop] dev 壳已启动，加载 {}（请确保网关已运行：./scripts/start.sh）",
                app.config().build.dev_url.as_ref().map(|u| u.to_string()).unwrap_or_default()
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("[yimu-desktop] Tauri 应用运行失败");
}
