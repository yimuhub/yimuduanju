#!/usr/bin/env node
/**
 * 数据库迁移运行器（SQL-first，幂等）。
 * 用法：node scripts/migrate.js
 * 连接串：SUDA_DATABASE_URL（与 start.sh 一致）或 DATABASE_URL，缺省 postgres://localhost:5432/yimu
 */
'use strict';

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'server', 'database', 'migrations');

function dbUrl() {
  const raw =
    process.env.SUDA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://localhost:5432/yimu';
  // postgres-js 不消费 ?schema= 参数，剥离
  return raw.split('?')[0];
}

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.log('[migrate] no migration files');
    return;
  }
  const sql = postgres(dbUrl(), { max: 1 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    const applied = await sql`SELECT name FROM schema_migrations`;
    const appliedSet = new Set(applied.map((r) => r.name));
    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      count += 1;
      console.log(`[migrate] applied ${file}`);
    }
    console.log(`[migrate] done, ${count} new migration(s)`);
    // 平台数据层以受限角色（authenticated_yimu 等）执行查询，新表必须授权，
    // 否则运行时 42501 permission denied（实机验证发现）
    try {
      await sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated_yimu, anon_yimu, service_role_yimu`;
      console.log('[migrate] grants refreshed');
    } catch (e) {
      console.log(`[migrate] grant skipped: ${e.message}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('[migrate] FAILED:', e.message);
  process.exit(1);
});
