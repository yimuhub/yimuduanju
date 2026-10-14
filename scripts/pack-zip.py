#!/usr/bin/env python3
"""重新打包一木·YIMU AI 视频创作平台本地工程 zip（跳过 node_modules/.git/logs/dist/server）"""
import zipfile, os, sys

ROOT = '/Users/shanziya/Documents/doubao/yimu-cloud'
OUT = '/Users/shanziya/Documents/doubao/一木YIMU_本地工程_云端同款.zip'
SKIP_DIRS = {'node_modules', '.git', 'logs', '.next'}

def walk():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS
                       and not os.path.join(dirpath, d).startswith(os.path.join(ROOT, 'dist/server'))]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if os.path.splitext(fn)[1].lower() in {'.pyc', '.log'}:
                continue
            rel = os.path.relpath(full, ROOT)
            if rel.startswith('dist/server'):
                continue
            yield full, rel

def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    count = 0; total = 0
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_STORED) as z:
        for full, rel in walk():
            try:
                z.write(full, rel)
                count += 1
                total += os.path.getsize(full)
            except Exception as e:
                print('skip', rel, e, flush=True)
    print('files:', count, 'bytes:', total, flush=True)
    print('zip:', OUT, round(os.path.getsize(OUT) / 1024 / 1024, 2), 'MB', flush=True)

if __name__ == '__main__':
    main()
