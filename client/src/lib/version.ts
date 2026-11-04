/**
 * 版本号 · 单一来源
 * ─────────────────────────────────────────────
 * 唯一定义在根 vite.config.ts 的 define 注入（process.env.APP_VERSION，
 * 默认取 package.json version 同步的 '3.4.3'）。任何 UI 处展示版本号
 * 一律 import 本常量，禁止手写字面量版本号。
 */
export const APP_VERSION = (process.env.APP_VERSION as string | undefined) ?? '';
