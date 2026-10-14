@echo off
setlocal
rem 切换到 UTF-8 代码页，保证中文提示正常显示
chcp 65001 >nul 2>nul

rem ============================================================
rem  一幕·YIMU AI 短剧工坊 —— Windows 一键停止脚本
rem ============================================================

taskkill /FI "WINDOWTITLE eq yimu-server*" /T /F >nul 2>nul || echo [提示] 后端服务未在运行。
taskkill /FI "WINDOWTITLE eq yimu-gateway*" /T /F >nul 2>nul || echo [提示] 本地网关未在运行。

echo [完成] 停止操作已执行。
