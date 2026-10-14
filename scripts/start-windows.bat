@echo off
setlocal
rem 切换到 UTF-8 代码页，保证中文提示正常显示
chcp 65001 >nul 2>nul

rem ============================================================
rem  一幕·YIMU AI 短剧工坊 —— Windows 一键启动脚本
rem  以后台方式启动生产后端 + 本地网关；停止请双击 stop-windows.bat
rem ============================================================

rem 网关按当前目录 <cwd>/dist/client 读取前端静态文件，先切到项目根目录
cd /d "%~dp0.."

if not exist "%~dp0..\dist\server\main.js" (
  echo [错误] 未找到构建产物 dist\server\main.js。
  echo 请先运行 npm run build 构建生产版本，然后再双击启动。
  exit /b 1
)

echo [步骤] 正在以后台方式启动后端服务（生产模式）...
start "yimu-server" /b cmd /c "cd /d %~dp0..\dist && set NODE_ENV=production && node server\main.js"

echo [步骤] 正在以后台方式启动本地网关 ...
start "yimu-gateway" /b node "%~dp0gateway.js"

echo.
echo ================ 启动完成 ================
echo 访问地址：http://localhost:5173/
echo 停止服务：双击 scripts\stop-windows.bat
echo ==========================================
