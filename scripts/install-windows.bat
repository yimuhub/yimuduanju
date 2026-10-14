@echo off
setlocal
rem 切换到 UTF-8 代码页，保证中文提示正常显示
chcp 65001 >nul 2>nul

rem ============================================================
rem  一幕·YIMU AI 短剧工坊 —— Windows 一键安装脚本
rem  双击运行即可；安装过程中不会写入任何真实密钥
rem ============================================================

rem 定位到项目根目录（脚本所在目录的上一级），后续命令都在项目根执行
cd /d "%~dp0.."

echo [1/4] 检查 Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请访问 https://nodejs.org 下载并安装 LTS 版本（需要 22 或更高版本），
  echo 安装完成后重新双击运行本安装脚本。
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node --version') do set "NVER=%%v"
set "NVER=%NVER:v=%"
if %NVER% LSS 22 (
  echo [错误] 检测到 Node.js 主版本为 %NVER%，需要 22 或更高版本。
  echo 请访问 https://nodejs.org 下载并安装最新 LTS 版本后重试。
  exit /b 1
)
echo [通过] Node.js 检查通过（主版本 %NVER%）。

echo [2/4] 检查 PostgreSQL ...
where pg_isready >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 PostgreSQL 命令行工具。
  echo Windows 下请手动安装 PostgreSQL 16：
  echo   https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
  echo 安装时请勾选安装命令行工具，安装完成后重新双击运行本安装脚本。
  exit /b 1
)
echo [通过] PostgreSQL 检查通过。

echo [3/4] 安装 npm 依赖 ...
if exist node_modules (
  echo [跳过] 已存在 node_modules 目录，不再重复安装依赖。
) else (
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 执行失败，请检查网络连接后重试。
    exit /b 1
  )
  echo [通过] npm 依赖安装完成。
)

echo [4/4] 初始化数据库与配置 ...
node scripts/setup.js
if errorlevel 1 (
  echo [错误] setup.js 执行失败，请确认 PostgreSQL 服务已启动且连接信息正确。
  exit /b 1
)
echo [通过] 初始化完成。

echo.
echo ================ 安装完成 ================
echo 后续步骤：
echo   1. 运行 npm run build 构建生产版本（前端构建约 1 分钟）
echo   2. 双击 scripts\start-windows.bat 启动服务
 echo   3. 浏览器打开 http://localhost:5173/
echo ==========================================
