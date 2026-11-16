#!/usr/bin/env node
/**
 * 统一版本号真源：package.json / package-lock.json / desktop tauri.conf.json
 *
 * 用法：node scripts/bump-version.mjs 3.12.0
 * 只改文件，不提交；提交与推送由 release 流程负责（见 AGENTS.md「版本与提交」）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
