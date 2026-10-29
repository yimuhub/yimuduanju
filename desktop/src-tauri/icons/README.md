# 图标占位说明（icons/）

Tauri 打包要求此处存在以下图标文件（`tauri.conf.json` → `bundle.icon`）：

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns`（macOS）
- `icon.ico`（Windows）

本目录当前为占位，**首次构建前**请先准备一张 1024x1024 的品牌源图
（建议：红橙渐变底 + 场记板图形，与 client 侧栏 Logo 一致），然后执行：

```bash
cd desktop/src-tauri
npx @tauri-apps/cli icon /path/to/yimu-icon-1024.png
```

该命令会自动生成上述全部尺寸与平台格式。缺少图标时 `cargo build` / `tauri build`
会在 `tauri-build` 阶段直接报错，属预期行为。
