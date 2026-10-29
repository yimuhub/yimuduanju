// 桌面壳入口（Windows release 下隐藏控制台窗口）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yimu_desktop_lib::run()
}
