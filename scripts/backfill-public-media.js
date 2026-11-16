#!/usr/bin/env node
/**
 * 历史项目「本地图片入库」回填（幂等）
 * ============================================================================
 * 背景：视频通道只吃公网 http(s) 首帧/参考图，而早期项目全部落的是
 * `/uploads/xxx.png`。新代码在提交时会自动入图库（public-media-library），
 * 但老项目里那些图**从没被提交过**，第一次跑任务时才上传会让首帧等待变长。
 * 这里一次性把它们全部提交进图库并写 public_media 映射，后续所有任务直接命中缓存。
 *
 * 幂等：已在 public_media 里的路径跳过，可反复执行。
 *
 * 用法（在部署目录执行，数据目录以 cwd 为准）：
 *   node scripts/backfill-public-media.js            # 全部
 *   node scripts/backfill-public-media.js --dry-run  # 只统计不执行
 *   node scripts/backfill-public-media.js --limit=50 # 只处理前 N 张（先小批试）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LIMIT = (() => {
  const hit = argv.find((a) => a.startsWith('--limit='));
  if (!hit) return Infinity;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();
const CONCURRENCY = 3;

function dbUrl() {
  const raw =
    process.env.SUDA_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost:5432/yimu';
  return raw.split('?')[0];
}

function uploadDir() {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'data/uploads');
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function mimeForExt(ext) {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

async function uploadCatbox(abs) {
  const buf = await fs.promises.readFile(abs);
  if (buf.length === 0) return null;
  const ext = path.extname(abs).toLowerCase() || '.png';
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([new Uint8Array(buf)], { type: mimeForExt(ext) }), path.basename(abs));
  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    headers: { 'User-Agent': BROWSER_UA },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!/^https?:\/\/\S+$/i.test(text)) throw new Error(`非 URL 响应: ${text.slice(0, 80)}`);
  return text;
}

/** 收集全库所有本地图片引用（去重） */
async function collectLocalPaths(sql) {
  const rows = await sql`
    SELECT DISTINCT p FROM (
      SELECT unnest(reference_image_urls) AS p FROM characters
      UNION ALL SELECT unnest(reference_image_urls) FROM locations
      UNION ALL SELECT unnest(reference_image_urls) FROM props
      UNION ALL SELECT unnest(reference_image_urls) FROM shots
      UNION ALL SELECT start_frame_url FROM shots
      UNION ALL SELECT end_frame_url FROM shots
      UNION ALL SELECT whitemodel_url FROM shots
      UNION ALL SELECT file_url FROM assets WHERE asset_type = 'image'
      UNION ALL SELECT thumbnail_url FROM projects
      UNION ALL
      SELECT (jsonb_path_query(c.identity_kit, '$.**')) #>> '{}'
      FROM characters c WHERE c.identity_kit IS NOT NULL
    ) t
    WHERE p LIKE '/uploads/%'
    ORDER BY p
  `;
  return rows.map((r) => r.p).filter(Boolean);
}

async function main() {
  const sql = postgres(dbUrl(), { max: 4, onnotice: () => {} });
  const root = uploadDir();
  try {
    console.log(`[backfill] 上传目录：${root}`);
    const all = await collectLocalPaths(sql);
    console.log(`[backfill] 全库本地图片引用：${all.length} 条（去重后）`);

    const known = new Set(
      (await sql`SELECT local_path FROM public_media`).map((r) => r.local_path),
    );
    console.log(`[backfill] 已在图库：${known.size} 条`);

    const missing = all.filter((p) => !known.has(p));
    const todo = missing.slice(0, Number.isFinite(LIMIT) ? LIMIT : missing.length);
    console.log(`[backfill] 待处理：${missing.length} 条，本轮处理 ${todo.length} 条`);
    if (DRY || todo.length === 0) {
      for (const p of todo.slice(0, 20)) console.log(`  · ${p}`);
      if (todo.length > 20) console.log(`  ... 其余 ${todo.length - 20} 条`);
      return;
    }

    let ok = 0;
    let skipMissing = 0;
    let fail = 0;
    let done = 0;

    const worker = async () => {
      for (;;) {
        const idx = done++;
        if (idx >= todo.length) return;
        const localPath = todo[idx];
        const abs = path.resolve(root, localPath.replace(/^\/uploads\//, ''));
        if (!abs.startsWith(root + path.sep)) {
          fail += 1;
          continue;
        }
        let size = 0;
        try {
          size = (await fs.promises.stat(abs)).size;
        } catch {
          skipMissing += 1;
          console.log(`  - 跳过（文件不存在）${localPath}`);
          continue;
        }
        try {
          const url = await uploadCatbox(abs);
          if (!url) throw new Error('空响应');
          await sql`
            INSERT INTO public_media (local_path, public_url, host, bytes)
            VALUES (${localPath}, ${url}, 'catbox', ${size})
            ON CONFLICT (local_path) DO UPDATE
              SET public_url = EXCLUDED.public_url,
                  host = EXCLUDED.host,
                  bytes = EXCLUDED.bytes,
                  last_used_at = CURRENT_TIMESTAMP
          `;
          ok += 1;
          const pct = Math.round(((ok + fail + skipMissing) / todo.length) * 100);
          console.log(`  ✓ [${pct}%] ${localPath.slice(-40)} → ${url}`);
        } catch (e) {
          fail += 1;
          console.log(`  ✗ ${localPath.slice(-40)}：${e.message}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    console.log(
      `[backfill] 完成：成功 ${ok}，文件缺失 ${skipMissing}，失败 ${fail}，共 ${todo.length}`,
    );
    if (fail > 0) {
      console.log('[backfill] 失败的条目可重复执行本脚本重试（已成功的会跳过）');
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('[backfill] 异常：', e);
  process.exit(1);
});
