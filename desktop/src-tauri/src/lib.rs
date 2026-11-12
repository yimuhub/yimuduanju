//! 一幕·YIMU AI 短剧创作平台 · Tauri 2 桌面壳（v1：全量自包含运行时）
//!
//! 壳只做四件事：
//!   1. 打开窗口，先显示启动页（`desktop/splash`）；
//!   2. 拉起随包分发的运行时 `app/launch.cjs`（内嵌 PostgreSQL + 后端 + 网关），
//!      Node 二进制本身也在包内（`app/node`），用户无需安装任何环境；
//!   3. 读到 `YIMU_READY <url>` 后把窗口导航到该地址；
//!   4. 退出时反序关停运行时，避免数据库进程成孤儿。
//!
//! 数据目录由 `app_data_dir()` 决定（macOS `~/Library/Application Support/<id>`，
//! Windows `%APPDATA%\<id>`，Linux `~/.local/share/<id>`），升级安装不会丢数据。

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// 运行时长句柄：退出时用于终止 sidecar（其内部会再关停 PG 与子进程）
struct RuntimeHandle(Mutex<Option<Child>>);

fn node_bin_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// 在启动页里更新进度（1..=4），失败忽略：页面可能已经导航走
fn splash_step(window: &tauri::WebviewWindow, step: u8) {
    let _ = window.eval(&format!("window.__yimuStep && window.__yimuStep({step})"));
}

fn splash_error(window: &tauri::WebviewWindow, message: &str) {
    let escaped = message
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n");
    let _ = window.eval(&format!(
        "window.__yimuError && window.__yimuError('{escaped}')"
    ));
}

fn navigate(window: &tauri::WebviewWindow, url: &str) {
    let escaped = url.replace('\'', "%27");
    let _ = window.eval(&format!("window.location.replace('{escaped}')"));
}

/// 跨平台终止子进程：Unix 发 SIGTERM 让 launcher 走优雅停机（关 PG），
/// Windows 没有 SIGTERM，直接 kill，launcher 侧的父进程看门狗会兜底清理。
fn terminate(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id().to_string();
        let _ = Command::new("kill").arg("-TERM").arg(pid).status();
    }
    #[cfg(windows)]
    {
        let _ = child.kill();
    }
}

fn spawn_runtime(app_dir: &Path, data_dir: &Path) -> Result<Child, String> {
    let node = app_dir.join(node_bin_name());
    let launcher = app_dir.join("launch.cjs");
    if !node.exists() {
        return Err(format!(
            "安装包不完整：缺少内置运行时 {}\n请重新安装客户端。",
            node.display()
        ));
    }
    if !launcher.exists() {
        return Err(format!("安装包不完整：缺少启动脚本 {}", launcher.display()));
    }

    let mut command = Command::new(&node);
    command
        .arg(&launcher)
        .current_dir(app_dir)
        .env("YIMU_APP_DIR", app_dir)
        .env("YIMU_DATA_DIR", data_dir)
        .env("YIMU_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x08000000 = CREATE_NO_WINDOW：不弹黑色控制台窗口
        command.creation_flags(0x0800_0000);
    }

    command
        .spawn()
        .map_err(|err| format!("无法启动内置运行时：{err}\n路径：{}", node.display()))
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(RuntimeHandle(Mutex::new(None)))
        .setup(|app| {
            let resource_dir: PathBuf = app.path().resource_dir()?;
            let app_dir = resource_dir.join("app");
            let data_dir = app.path().app_data_dir()?;
            let _ = std::fs::create_dir_all(&data_dir);

            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("一幕 · YIMU AI 短剧创作平台")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .build()?;

            let handle = app.handle().clone();
            let splash = window.clone();
            let data_dir_for_log = data_dir.clone();
            let app_dir_for_err = app_dir.clone();

            std::thread::spawn(move || {
                let mut child = match spawn_runtime(&app_dir_for_err, &data_dir) {
                    Ok(child) => child,
                    Err(msg) => {
                        splash_error(&splash, &msg);
                        return;
                    }
                };

                // 先取出管道所有权，再把子进程句柄托管给 state（ChildStdout 不支持 try_clone）
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                if let Some(state) = handle.try_state::<RuntimeHandle>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(child);
                    }
                } else {
                    splash_error(&splash, "内部错误：运行时句柄注册失败");
                    return;
                }

                let stream = match stdout {
                    Some(stream) => stream,
                    None => {
                        splash_error(&splash, "无法读取运行时输出（stdout 不可用）");
                        return;
                    }
                };

                // stderr 只做日志透传：真正的失败原因 launcher 会以 YIMU_ERROR 走 stdout
                if let Some(err_stream) = stderr {
                    std::thread::spawn(move || {
                        for line in BufReader::new(err_stream).lines().map_while(Result::ok) {
                            eprintln!("[runtime:err] {line}");
                        }
                    });
                }

                let mut last_error = String::new();
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    if let Some(url) = line.strip_prefix("YIMU_READY ") {
                        splash_step(&splash, 4);
                        navigate(&splash, url.trim());
                        return;
                    }
                    if let Some(err) = line.strip_prefix("YIMU_ERROR ") {
                        last_error = err.to_string();
                        splash_error(&splash, &last_error);
                        continue;
                    }
                    if line.contains("PostgreSQL 已就绪") || line.contains("初始化完成") {
                        splash_step(&splash, 2);
                    } else if line.contains("后端已就绪") {
                        splash_step(&splash, 3);
                    } else if line.contains("桌面端就绪") {
                        splash_step(&splash, 4);
                    }
                }

                // 输出流结束仍未就绪 = 运行时中途崩溃
                if last_error.is_empty() {
                    splash_error(
                        &splash,
                        &format!(
                            "本地引擎意外退出，未给出原因。\n日志目录：{}\n请把该目录下的 desktop.log / server.log 发给我们。",
                            data_dir_for_log.join("logs").display()
                        ),
                    );
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("[yimu-desktop] Tauri 初始化失败");

    app.run(|handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = handle.try_state::<RuntimeHandle>() {
                if let Ok(mut slot) = state.0.lock() {
                    if let Some(mut child) = slot.take() {
                        terminate(&mut child);
                    }
                }
            }
        }
    });
}
