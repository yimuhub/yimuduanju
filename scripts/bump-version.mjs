#!/usr/bin/env node
/**
 * 统一版本号真源：package.json / package-lock.json / tauri.conf.json / Cargo.toml+lock
 *
 * 用法：node scripts/bump-version.mjs 3.12.0
 * 只改文件，不提交；提交与推送由 release 流程负责（见 AGENTS.md「版本与提交」）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('用法：node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}

const write = (rel, mutate) => {
  const file = resolve(root, rel);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  mutate(data);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${rel} → ${next}`);
};

write('package.json', (p) => {
  p.version = next;
});
write('package-lock.json', (p) => {
  p.version = next;
  if (p.packages?.['']) p.packages[''].version = next;
});
write('desktop/src-tauri/tauri.conf.json', (p) => {
  if ('version' in p) p.version = next;
  if (p.package && 'version' in p.package) p.package.version = next;
});

// Cargo 包版本也必须同步：否则 macOS 安装包里的桌面壳仍显示旧版本，
// `cargo build` 的 crate 元数据与 tauri.conf.json 会长期漂移。
const cargoToml = resolve(root, 'desktop/src-tauri/Cargo.toml');
const cargoText = readFileSync(cargoToml, 'utf8');
const cargoNext = cargoText.replace(
  /(^\[package\][\s\S]*?^version = ")[^"]+(")/m,
  (_m, prefix, suffix) => `${prefix}${next}${suffix}`,
);
if (cargoNext !== cargoText) {
  writeFileSync(cargoToml, cargoNext);
  console.log(`desktop/src-tauri/Cargo.toml → ${next}`);
}
const cargoLock = resolve(root, 'desktop/src-tauri/Cargo.lock');
if (existsSync(cargoLock)) {
  const lockText = readFileSync(cargoLock, 'utf8');
  const lockNext = lockText.replace(
    /(name = "yimu-desktop"\nversion = ")[^"]+(")/,
    (_m, prefix, suffix) => `${prefix}${next}${suffix}`,
  );
  if (lockNext !== lockText) {
    writeFileSync(cargoLock, lockNext);
    console.log(`desktop/src-tauri/Cargo.lock → ${next}`);
  }
}
