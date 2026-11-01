#!/bin/sh
# ============================================================================
#  一幕 YIMU · 本地 Git 仓库一键初始化脚本
# ----------------------------------------------------------------------------
#  用途：把当前项目变成一个本地 Git 仓库，并完成第一次提交（建立回滚点）。
#  特点：提交前会自动做安全检查，绝不把 .env / backups / logs 等敏感内容
#        写进 Git 历史。任何一步不通过都会中止并告诉你原因。
#
#  用法：在项目根目录下执行
#        sh scripts/setup-git-repo.sh
#
#  说明：本脚本只创建 .git/ 目录并提交，不修改任何业务源码。
# ============================================================================

# 不用 set -e：需要在中止前打印诊断信息
LC_ALL=C
export LC_ALL

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '    \033[0;32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '    \033[0;33m[注意]\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m[X 已中止]\033[0m %s\n\n' "$1"; exit 1; }

# ----------------------------------------------------------------------------
# 0. 定位项目根目录（脚本可从任意位置调用）
# ----------------------------------------------------------------------------
cd "$(dirname "$0")/.." || die "无法进入脚本所在目录的上一级"
ROOT="$(pwd)"
say "项目目录：$ROOT"

[ -f package.json ] || die "当前目录下没有 package.json，请确认你在项目根目录执行本脚本。"
ok "已确认这是项目根目录（存在 package.json）"

# ----------------------------------------------------------------------------
# 1. 检查 git 是否安装
# ----------------------------------------------------------------------------
say "检查 git 是否已安装"
if ! command -v git >/dev/null 2>&1; then
  die "没有找到 git 命令。请先安装：打开 https://git-scm.com/download/mac 下载安装，
      或在终端执行  xcode-select --install  （macOS 自带方式）。
      安装完成后重新执行本脚本。"
fi
ok "git 版本：$(git --version)"

# ----------------------------------------------------------------------------
# 2. 检查是否已经是 git 仓库（避免覆盖已有历史）
# ----------------------------------------------------------------------------
say "检查是否已存在 Git 仓库"
if [ -d .git ]; then
  warn "已存在 .git 目录，说明这里已经是 Git 仓库了。"
  warn "本脚本不会覆盖它。当前状态如下："
  git --no-pager log --oneline -5 2>/dev/null || warn "（还没有任何提交）"
  git status --short | head -20
  printf '\n如果你只是想提交改动，直接执行：\n'
  printf '    git add -A && git commit -m "你的说明"\n\n'
  exit 0
fi
ok "尚未初始化，可以继续"

# ----------------------------------------------------------------------------
# 3. 初始化仓库（默认分支 main，兼容老版本 git）
# ----------------------------------------------------------------------------
say "初始化 Git 仓库（默认分支 main）"
if git init -b main >/dev/null 2>&1; then
  ok "git init -b main 成功"
else
  git init >/dev/null 2>&1 || die "git init 执行失败"
  git branch -m main 2>/dev/null
  ok "git init 成功（git 版本较老，已改用两步方式设置 main 分支）"
fi

# ----------------------------------------------------------------------------
# 4. 设置提交身份（新手最常见的坑：没配 user.email 会导致 commit 失败）
#    只写入本仓库的局部配置，不改动你的全局 git 设置。
# ----------------------------------------------------------------------------
say "检查提交身份（user.name / user.email）"
if [ -z "$(git config user.name)" ]; then
  git config user.name "YIMU Developer"
  warn "未配置 user.name，已为本仓库设置为 'YIMU Developer'"
fi
if [ -z "$(git config user.email)" ]; then
  git config user.email "dev@yimu.local"
  warn "未配置 user.email，已为本仓库设置为 'dev@yimu.local'"
fi
ok "提交身份：$(git config user.name) <$(git config user.email)>"
printf '    （想改成你自己的名字，执行：git config user.name "你的名字" 和 git config user.email "你的邮箱"）\n'

# ----------------------------------------------------------------------------
# 5. 安全检查 A：确认 .gitignore 确实忽略了敏感路径
# ----------------------------------------------------------------------------
say "安全检查 A：确认敏感目录已被 .gitignore 忽略"
[ -f .gitignore ] || die "没有找到 .gitignore 文件！继续提交会把 .env 密钥和数据库备份写进历史。请先恢复 .gitignore。"
ok ".gitignore 存在"

MISSING=""
for P in .env backups logs data dist node_modules tsconfig.tsbuildinfo; do
  if git check-ignore -q "$P"; then
    ok "已忽略：$P"
  else
    # 路径本身不存在时 check-ignore 也会失败，这里区分一下
    if [ -e "$P" ]; then
      MISSING="$MISSING $P"
      warn "未忽略：$P  <-- 该路径实际存在且不在忽略列表！"
    else
      printf '    \033[0;90m[--]\033[0m %s（当前不存在，跳过）\n' "$P"
    fi
  fi
done

if [ -n "$MISSING" ]; then
  die "以下敏感路径没有被 .gitignore 忽略：$MISSING
      为避免密钥泄漏，已中止。请把它们加进 .gitignore 后重新执行。"
fi

# ----------------------------------------------------------------------------
# 6. 安全检查 B：扫描是否存在游离的私钥 / 证书文件
# ----------------------------------------------------------------------------
say "安全检查 B：扫描游离的私钥与证书文件"
FOUND_KEYS=$(find . -path ./node_modules -prune -o -path ./.git -prune -o \
  \( -name '*.pem' -o -name '*.p12' -o -name '*.pfx' -o -name 'id_rsa' -o -name '*.key' \) \
  -print 2>/dev/null)
if [ -n "$FOUND_KEYS" ]; then
  printf '%s\n' "$FOUND_KEYS" | while read -r F; do warn "发现疑似私钥文件：$F"; done
  die "存在疑似私钥文件，已中止。请确认它们是否需要提交，或加入 .gitignore 后重试。"
fi
ok "未发现游离的私钥 / 证书文件"

# ----------------------------------------------------------------------------
# 7. 暂存所有文件
# ----------------------------------------------------------------------------
say "暂存文件（git add -A）"
git add -A || die "git add 失败"
STAGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
ok "已暂存 $STAGED 个文件"
[ "$STAGED" -gt 0 ] || die "暂存文件数为 0，异常情况，已中止。"

# ----------------------------------------------------------------------------
# 8. 安全检查 C：再次核对「即将提交」的清单里没有敏感内容（最后一道闸）
# ----------------------------------------------------------------------------
say "安全检查 C：核对即将提交的清单"
# 先排除 *.example 示例模板（它们不含真实密钥，允许提交），再做敏感匹配
BAD=$(git diff --cached --name-only | grep -v '\.example$' | grep -E '(^|/)\.env($|\.)|^backups/|^logs/|^data/|^node_modules/|^dist/|\.tsbuildinfo$|\.sql\.gz$' || true)
if [ -n "$BAD" ]; then
  printf '%s\n' "$BAD" | while read -r F; do warn "危险文件已进入暂存区：$F"; done
  git reset >/dev/null 2>&1
  die "检测到敏感文件被暂存，已自动撤销暂存并中止。请把上面的路径加入 .gitignore 后重试。"
fi
ok "暂存清单干净，不含 .env / backups / logs / data / dist / node_modules / 数据库备份"

# .env.enterprise.example 这类示例文件允许提交，仅提示
if git diff --cached --name-only | grep -q '\.env\.enterprise\.example$'; then
  ok "包含 .env.enterprise.example（示例模板，不含真实密钥，允许提交）"
fi

# ----------------------------------------------------------------------------
# 9. 第一次提交
# ----------------------------------------------------------------------------
say "创建第一次提交"
git commit -q -m "chore: 初始化本地 Git 仓库

纳入版本控制的初始快照，包含 server / client / shared / scripts / deploy 全部源码。

同时包含对后端核心链路的一批缺陷修复：
- generation: 任务状态机加终态谓词，消除重复计费与 pending 被 poll 偷成 running
- model-gateway: 全部外部 HTTP 调用加 AbortSignal.timeout
- url-guard: SSRF 判定 fail-closed、支持 ::ffff:a.b.c.d、遍历全部 DNS 记录、端口黑名单
- exception.filter: 补齐服务端日志，details 仅开发环境返回
- admin.guard: 失败锁定 + 定长摘要恒定时间比对
- budget-cap: 计入在途花费、配置错误告警、咨询锁串行化
- crypto.util: 读路径改 tryDecryptApiKey，新增启动自检
- job-worker: stale-queued 周期回收、Redis 掉线降级、按 provider 冷却
- uploads.controller: 413 可正常返回、接收超时与单次结算
- main: bootstrap 错误处理、enableShutdownHooks、静态资源安全头
- test/unit: 新增 url-guard 与任务状态机回归测试

敏感文件（.env / backups / logs / data / dist / node_modules）均由 .gitignore 排除。" \
  || die "git commit 失败，请把上面的报错信息发出来"
ok "提交成功"

# ----------------------------------------------------------------------------
# 10. 结果展示
# ----------------------------------------------------------------------------
say "完成！当前仓库状态"
printf '\n--- 提交历史 ---\n'
git --no-pager log --oneline
printf '\n--- 分支 ---\n'
git branch
printf '\n--- 工作区状态（应为 clean）---\n'
git status --short
[ -z "$(git status --short)" ] && ok "工作区干净，所有改动都已纳入版本控制"

printf '\n\033[1;32m==================== 全部完成 ====================\033[0m\n'
printf '你现在拥有了一个本地 Git 仓库，从此任何改动都可以：\n'
printf '    git status                 # 看改了哪些文件\n'
printf '    git diff                   # 看具体改了什么\n'
printf '    git checkout -- 文件路径   # 撤销某个文件的改动\n'
printf '    git log --oneline          # 看提交历史\n\n'
printf '把上面这段完整输出复制发回给我，我来核对是否正常。\n'
printf '\033[1;32m==================================================\033[0m\n\n'
