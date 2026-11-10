# 第三方开源组件归属说明（ATTRIBUTION）

本项目在商业使用中仅引入 **MIT / ISC** 等宽松许可依赖，不包含 GPL 源码。
以下为线性剪辑（时间线）相关组件及许可信息；完整依赖清单以 `package-lock.json` 为准。

## 前端依赖

| 组件 | 版本 | 许可 | 用途 | 版权声明 |
| --- | --- | --- | --- | --- |
| [interact.js](https://github.com/taye/interact.js) | 1.10.27 | MIT | 时间线片段拖拽排序、边缘修剪 | Copyright (c) 2012-present Taye Adeyemi `<dev@taye.me>` |
| [@xyflow/react](https://github.com/xyflow/xyflow) | 12.11.6 | MIT | 自由画布节点画布 | Copyright (c) 2019-2025 webkid GmbH |
| [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.15 | MIT | 浏览器端音视频合成（ffmpeg.wasm 封装） | 许可字段见包内 `package.json` |
| [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.6 | MIT（npm 包声明） | 同上，FFmpeg WASM 核心 | FFmpeg 上游为 LGPL-2.1-or-later；本项目仅通过 npm 包使用 |
| [@ffmpeg/util](https://github.com/ffmpegwasm/ffmpeg.wasm) | 0.12.2 | MIT | 同上，WASM 文件读取工具 | 许可字段见包内 `package.json` |
| [lucide-react](https://github.com/lucide-icons/lucide) | 0.554.0 | ISC | 界面图标 | Copyright (c) Lucide Contributors；部分图标版权 Cole Bemis 2013-2023（Feather, MIT） |
| [sonner](https://github.com/emilkowalski/sonner) | 2.0.7 | MIT | 轻提示 Toast | Copyright (c) Emil Kowalski |

MIT / ISC 许可要求：在软件副本中保留上述版权声明与许可声明。
对应完整许可文本随 npm 依赖安装保存在各包的 `LICENSE` 文件中；再分发时请一并保留。

## 服务端渲染（成片导出）

- 成片导出通过 **调用系统 ffmpeg 可执行文件**（独立进程，`child_process.spawn`）完成，
  本项目仓库不包含、不打包、不再分发 ffmpeg 二进制。
- 系统 ffmpeg 的许可以实际安装版本为准（Homebrew 构建可能含 GPL 组件，Ubuntu 官方包为 LGPL/GPL 视编解码器而定）。
  部署方需自行确认其 ffmpeg 构建的许可与商用合规性。
- 字幕烧录优先选择带 **libass** 的 ffmpeg（`subtitles` / `ass` 滤镜）；
  若系统 ffmpeg 不含 libass，则自动降级为软字幕（mov_text）封装，功能不受影响但字幕不“烧”进画面。

## 说明

- 本项目未复制任何 GPL 项目源码，未修改第三方库源码。
- 若后续引入新的第三方组件，请同步更新本文件与 `package-lock.json`。
