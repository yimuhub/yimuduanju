'use strict';
/**
 * 内嵌 PostgreSQL 生命周期：随应用启动，数据落在应用数据目录，退出即停。
 *
 * 设计要点（与 docs/多端架构与客户端打包规划.md §3.3 方案 A 一致）：
 * - 用 embedded-postgres 携带的平台二进制，用户不需要 brew/apt 装 PG；
 * - 首次启动 initialise()（initdb），之后只 start()，数据持久化在 <dataDir>/pg；
 * - 只监听 127.0.0.1，initdb 用 trust 认证（只有本机回环可达，无需密码管理）；
 * - 迁移脚本沿用 scripts/migrate.js（SQL-first，唯一真相），不在这里重写 SQL。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// 该包是 ESM 产物，CJS require 得到 { default: class }，两种形态都要兼容
const embeddedPostgresModule = require('embedded-postgres');
const EmbeddedPostgres = embeddedPostgresModule.default || embeddedPostgresModule;

const log = require('./log.cjs');

const DB_NAME = 'yimu';
const ROLES = ['authenticated_yimu', 'anon_yimu', 'service_role_yimu'];

/** 平台数据层以受限角色执行查询，角色缺失会让所有查询 42501 */
const ROLE_SQL = [
  ...ROLES.map(
    (role) => `DO $$ BEGIN
  CREATE ROLE ${role} NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  ),
  `GRANT USAGE ON SCHEMA public TO ${ROLES.join(', ')};`,
  `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${ROLES.join(', ')};`,
  `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${ROLES.join(', ')};`,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 桌面内置的 PG 只带 timezone 数据，没有 contrib 扩展文件。
 * db-init.sql 头部的 pgcrypto / uuid-ossp 只是为了让 gen_random_uuid() 可用，
 * 而它在 PG 13+ 已是内核函数，因此这里剔除这两行即可，其余 SQL 原样执行。
 */
function stripUnavailableExtensions(sqlText) {
  return sqlText.replace(/^\s*CREATE\s+EXTENSION[^;]*;\s*$/gim, '-- [desktop] CREATE EXTENSION 已内联跳过');
}

class Database {
  constructor({ dataDir, port }) {
    this.dataDir = dataDir;
    this.pgDir = path.join(dataDir, 'pg');
    this.port = port;
    this.instance = null;
  }

  get url() {
    return `postgres://yimu@127.0.0.1:${this.port}/${DB_NAME}`;
  }

  /** 数据层连接串（平台 SDK 只认 SUDA_DATABASE_URL，且会带 ?schema=） */
  get urlWithSchema() {
    return `${this.url}?schema=${DB_NAME}`;
  }

  get initialised() {
    return fs.existsSync(path.join(this.pgDir, 'PG_VERSION'));
  }

  async start() {
    fs.mkdirSync(this.pgDir, { recursive: true });
    this.instance = new EmbeddedPostgres({
      databaseDir: this.pgDir,
      port: this.port,
      user: 'yimu',
      password: 'yimu',
      authMethod: 'password',
      persistent: true,
      // trust：只监听回环，桌面单用户场景不需要口令；--no-locale 保证三平台一致
      initdbFlags: ['--encoding=UTF8', '--no-locale', '--auth=trust'],
      onLog: (m) => log.info(`[pg] ${String(m).trim()}`),
      onError: (m) => log.warn(`[pg:err] ${String(m).trim()}`),
    });

    if (!this.initialised) {
      log.info(`首次启动，初始化数据库集群：${this.pgDir}`);
      await this.instance.initialise();
    }
    await this.instance.start();
    await this.waitReady();
    log.info(`PostgreSQL 已就绪 127.0.0.1:${this.port}`);
  }

  async waitReady(timeoutMs = 30000) {
    const pg = require('pg');
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
      const client = new pg.Client({ connectionString: `postgres://yimu@127.0.0.1:${this.port}/postgres` });
      try {
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return;
      } catch (err) {
        lastErr = err;
        try {
          await client.end();
        } catch {
          /* ignore */
        }
        await sleep(300);
      }
    }
    throw new Error(`PostgreSQL 启动超时：${lastErr ? lastErr.message : '未知原因'}`);
  }

  /** 用 pg Client 连接业务库执行一段 SQL（多语句简单查询） */
  async exec(sqlText, database = DB_NAME) {
    const pg = require('pg');
    const client = new pg.Client({ connectionString: `postgres://yimu@127.0.0.1:${this.port}/${database}` });
    await client.connect();
    try {
      await client.query(sqlText);
    } finally {
      await client.end();
    }
  }

  async ensureDatabase() {
    const pg = require('pg');
    const client = new pg.Client({ connectionString: `postgres://yimu@127.0.0.1:${this.port}/postgres` });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
      if (rows.length === 0) {
        log.info(`创建数据库 ${DB_NAME}`);
        await client.query(`CREATE DATABASE ${DB_NAME}`);
      }
    } finally {
      await client.end();
    }
  }

  async tableCount() {
    const pg = require('pg');
    const client = new pg.Client({ connectionString: this.url });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      return rows[0].n;
    } finally {
      await client.end();
    }
  }

  /** 建表 + 角色 + 授权：全部幂等，重复启动不会破坏已有数据 */
  async bootstrapSchema(appDir) {
    await this.ensureDatabase();

    const tables = await this.tableCount();
    if (tables < 3) {
      const initSql = path.join(appDir, 'scripts', 'db-init.sql');
      log.info(`初始化表结构：${initSql}`);
      const text = stripUnavailableExtensions(fs.readFileSync(initSql, 'utf8'));
      await this.exec(text);
      log.info('表结构初始化完成');
    } else {
      log.info(`表结构已存在（${tables} 张表），跳过初始化`);
    }

    await this.exec(ROLE_SQL.join('\n'));
  }

  /** 增量迁移：直接调用 scripts/migrate.js，避免 SQL 逻辑出现第二份实现 */
  async migrate(appDir) {
    const script = path.join(appDir, 'scripts', 'migrate.js');
    if (!fs.existsSync(script)) {
      log.warn(`未找到迁移脚本 ${script}，跳过增量迁移`);
      return;
    }
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: appDir,
        env: { ...process.env, SUDA_DATABASE_URL: this.urlWithSchema, DATABASE_URL: this.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.stderr.on('data', (d) => {
        out += d.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('数据库迁移超时（120s）'));
      }, 120000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        out.trim().split('\n').filter(Boolean).slice(-6).forEach((l) => log.info(`[migrate] ${l}`));
        if (code === 0) resolve();
        else reject(new Error(`数据库迁移失败（exit ${code}）`));
      });
    });
  }

  async stop() {
    if (!this.instance) return;
    try {
      await this.instance.stop();
      log.info('PostgreSQL 已停止');
    } catch (err) {
      log.warn(`停止 PostgreSQL 失败：${err.message}`);
    }
  }
}

module.exports = { Database, DB_NAME };
