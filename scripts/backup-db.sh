#!/usr/bin/env bash
# =============================================================================
# 一幕·YIMU AI 短剧工坊 PostgreSQL 自动备份（P1 数据安全：之前全库无备份，丢了找不回来）
# 用法：
#   ./scripts/backup-db.sh                    # 手动备份一次
#   # 定时每天 03:00（macOS 示例，需先 chmod +x）：
#   # (crontab -l 2>/dev/null; echo "0 3 * * * /Users/shanziya/Documents/yimuduanju/scripts/backup-db.sh >> /tmp/yimu-backup.log 2>&1") | crontab -
# 保留最近 7 天（按文件名日期清理），gzip 压缩存放于 ./backups/
# 备份内容：数据库 pg_dump + 落盘文件 data/uploads（同时间戳归档）
# 恢复：gunzip -c backups/yimu-YYYYMMDD-HHMMSS.sql.gz | psql -h localhost -d yimu
#       tar -xzf backups/yimu-uploads-YYYYMMDD-HHMMSS.tar.gz -C <项目根目录>
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-yimu}"
DB_HOST="${DB_HOST:-localhost}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/yimu-$STAMP.sql.gz"
UPLOAD_SRC="$ROOT_DIR/data/uploads"
UPLOAD_OUT="$BACKUP_DIR/yimu-uploads-$STAMP.tar.gz"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[backup-db] 未找到 pg_dump，请先安装 postgresql@16" >&2
  exit 1
fi

pg_dump -h "$DB_HOST" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$OUT"
echo "[backup-db] 已备份数据库：$OUT ($(du -h "$OUT" | cut -f1))"

# 落盘文件（资产图片/视频/音频）与数据库同时间戳归档
if [ -d "$UPLOAD_SRC" ]; then
  tar -czf "$UPLOAD_OUT" -C "$ROOT_DIR" data/uploads
  echo "[backup-db] 已备份 uploads：$UPLOAD_OUT ($(du -h "$UPLOAD_OUT" | cut -f1))"
else
  echo "[backup-db] 未找到 data/uploads 目录，跳过文件备份" >&2
fi

# 清理过期备份（保留最近 KEEP_DAYS 天，数据库与 uploads 同策略）
find "$BACKUP_DIR" \( -name 'yimu-*.sql.gz' -o -name 'yimu-uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup-db] 已清理 ${KEEP_DAYS} 天前的旧备份，当前保留：$(ls "$BACKUP_DIR"/yimu-*.sql.gz "$BACKUP_DIR"/yimu-uploads-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') 个"
