/**
 * 一幕·神剪快捷键总表（对标剪映专业版桌面端）
 * -------------------------------------------------------------
 * 单一真源：帮助面板、悬浮提示、文档进度表都从这里读，避免三处各写一份。
 *
 * 说明：
 *   · 标注 ready 的项已在 StudioTimeline 键盘层/编辑器内核中真正接通；
 *   · 标注 partial 的项有可用替代实现（会在面板里写明边界）；
 *   · 标注 todo 的项当前数据模型不支持，不能伪装成已实现。
 *   · 字母键在输入框/文本域/可编辑区域内一律让路，不抢输入。
 */
export type ShortcutStatus = 'ready' | 'partial' | 'todo';

export interface JianyingShortcut {
  id: string;
  label: string;
  keys: string;
  /** Windows 与 macOS 的主要差异（默认只写 mac 的 ⌘，面板会同时显示 Ctrl） */
  macKeys?: string;
  status: ShortcutStatus;
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  items: JianyingShortcut[];
}

export const JIANYING_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '剪辑与选择',
    items: [
      { id: 'split', label: '分割（播放头处）', keys: 'Ctrl+B', macKeys: '⌘B', status: 'ready' },
      { id: 'batch-split', label: '批量分割（所有轨）', keys: 'Ctrl+Shift+B', macKeys: '⌘⇧B', status: 'ready' },
      { id: 'select-mode', label: '选择模式', keys: 'A', status: 'ready' },
      { id: 'split-mode', label: '分割模式（点击即切）', keys: 'B', status: 'ready' },
      { id: 'delete-left', label: '删除播放头左侧', keys: 'Q', status: 'ready' },
      { id: 'delete-right', label: '删除播放头右侧', keys: 'W', status: 'ready' },
      { id: 'delete', label: '删除选中片段', keys: 'Delete / Backspace', status: 'ready', note: '波纹删除；Shift+Delete 保留空隙' },
      { id: 'enable', label: '启用 / 停用片段', keys: 'V', status: 'ready', note: '停用后保留在时间线，预览与导出跳过' },
      { id: 'copy', label: '复制', keys: 'Ctrl+C', macKeys: '⌘C', status: 'ready' },
      { id: 'cut', label: '剪切', keys: 'Ctrl+X', macKeys: '⌘X', status: 'ready' },
      { id: 'paste', label: '粘贴到播放头', keys: 'Ctrl+V', macKeys: '⌘V', status: 'ready' },
      { id: 'undo', label: '撤销', keys: 'Ctrl+Z', macKeys: '⌘Z', status: 'ready' },
      { id: 'redo', label: '重做', keys: 'Ctrl+Shift+Z', macKeys: '⌘⇧Z', status: 'ready', note: 'Ctrl+Y 兼容保留' },
      { id: 'select-all', label: '全选片段', keys: 'Ctrl+A', macKeys: '⌘A', status: 'ready' },
      { id: 'select-left', label: '选中播放头左侧片段', keys: '[', status: 'ready' },
      { id: 'select-right', label: '选中播放头右侧片段', keys: ']', status: 'ready' },
      { id: 'in', label: '设入点', keys: 'I', status: 'ready' },
      { id: 'out', label: '设出点', keys: 'O', status: 'ready' },
      { id: 'mark-area', label: '按片段选择区域', keys: 'Shift+X', status: 'partial', note: '当前用于导出区间；完整区间剪辑需配合 I/O' },
      { id: 'clear-area', label: '清除选择区域', keys: 'Alt+X', status: 'ready' },
    ],
  },
  {
    title: '播放与时间线',
    items: [
      { id: 'play', label: '播放 / 暂停', keys: '空格', status: 'ready' },
      { id: 'prev-frame', label: '上一帧', keys: '←', status: 'ready' },
      { id: 'next-frame', label: '下一帧', keys: '→', status: 'ready' },
      { id: 'prev-cut', label: '上一剪辑点', keys: '↑', status: 'ready' },
      { id: 'next-cut', label: '下一剪辑点', keys: '↓', status: 'ready' },
      { id: 'home', label: '跳到片头', keys: 'Home', status: 'ready' },
      { id: 'end', label: '跳到片尾', keys: 'End', status: 'ready' },
      { id: 'fit', label: '时间线适配全屏', keys: 'Shift+Z', status: 'ready' },
      { id: 'zoom-in', label: '轨道放大', keys: 'Ctrl++', macKeys: '⌘+', status: 'ready' },
      { id: 'zoom-out', label: '轨道缩小', keys: 'Ctrl+-', macKeys: '⌘-', status: 'ready' },
      { id: 'wheel-zoom', label: '指针为锚点缩放', keys: 'Ctrl+滚轮', macKeys: '⌘+滚轮', status: 'ready' },
      { id: 'wheel-horizontal', label: '时间线左右滚动', keys: 'Alt+滚轮', status: 'ready' },
      { id: 'wheel-vertical', label: '时间线上下滚动', keys: '滚轮', status: 'ready' },
      { id: 'snap', label: '吸附开关', keys: 'N', status: 'ready' },
      { id: 'preview-axis', label: '预览轴开关', keys: 'S', status: 'partial', note: '当前映射为播放头参考线显隐；剪辑点吸附仍由 N 控制' },
      { id: 'magnet', label: '主轨磁吸', keys: 'P', status: 'partial', note: '与 N 吸附共用编辑器吸附策略，P 作为主轨磁吸别名' },
      { id: 'link', label: '音视频联动', keys: '~', status: 'ready', note: '绑定 / 解绑选中片段（bindGroup）' },
      { id: 'marker', label: '添加标记点', keys: 'M', status: 'ready', note: '内部标记；非剪映标准键位，剪映手动踩点为 Ctrl+J' },
      { id: 'beat', label: '手动踩点', keys: 'Ctrl+J', macKeys: '⌘J', status: 'ready', note: '在播放头打踩点并显示标记' },
      { id: 'mute', label: '静音 / 取消静音片段', keys: 'Shift+M', status: 'ready' },
      { id: 'jkl', label: '播放控制 J/K/L', keys: 'J / K / L', status: 'partial', note: 'L 正放、K 暂停、J 以 0.5s 回退近似倒放；浏览器 video 不支持负速率' },
    ],
  },
  {
    title: '音频、速度与组合',
    items: [
      { id: 'detach-audio', label: '分离 / 还原音频', keys: 'Ctrl+Shift+S', macKeys: '⌘⇧S', status: 'ready' },
      { id: 'speed-panel', label: '速度面板', keys: 'Ctrl+R', macKeys: '⌘R', status: 'ready', note: '聚焦属性条速度选择器' },
      { id: 'curve-speed', label: '曲线变速', keys: 'Shift+B', status: 'todo', note: '需要关键帧速度曲线模型；当前仅支持匀速变速' },
      { id: 'volume-up', label: '音量微调 +', keys: 'Ctrl+.', macKeys: '⌘.', status: 'ready' },
      { id: 'volume-down', label: '音量微调 -', keys: 'Ctrl+,', macKeys: '⌘,', status: 'ready' },
      { id: 'group', label: '组合片段', keys: 'Ctrl+G', macKeys: '⌘G', status: 'ready', note: '以 bindGroup 实现整组同动' },
      { id: 'ungroup', label: '取消组合', keys: 'Ctrl+Shift+G', macKeys: '⌘⇧G', status: 'ready' },
      { id: 'compound', label: '新建复合片段', keys: 'Alt+G', status: 'partial', note: '当前等价于强绑定组：整组联动，但不能作为单个片段二次裁剪' },
      { id: 'uncompound', label: '解除复合片段', keys: 'Alt+Shift+G', status: 'ready' },
      { id: 'keyframe', label: '添加关键帧', keys: 'Ctrl+K', macKeys: '⌘K', status: 'todo', note: '需要位置/缩放/透明度关键帧模型与预览插值；当前未接入' },
      { id: 'keyframe-panel', label: '关键帧面板', keys: 'Alt+K', status: 'todo', note: '同上；不提供假面板' },
      { id: 'attr-copy', label: '复制属性', keys: 'Ctrl+Shift+C', macKeys: '⌘⇧C', status: 'partial', note: '当前复制片段，属性级复制待属性模型统一' },
      { id: 'attr-paste', label: '粘贴属性', keys: 'Ctrl+Shift+V', macKeys: '⌘⇧V', status: 'partial', note: '同上' },
    ],
  },
  {
    title: '文件与视图',
    items: [
      { id: 'import', label: '导入素材', keys: 'Ctrl+I', macKeys: '⌘I', status: 'ready' },
      { id: 'export', label: '导出成片', keys: 'Ctrl+E', macKeys: '⌘E', status: 'ready' },
      { id: 'new', label: '新建草稿', keys: 'Ctrl+N', macKeys: '⌘N', status: 'ready', note: '跳转一键创作' },
      { id: 'save', label: '保存时间线', keys: 'Ctrl+S', macKeys: '⌘S', status: 'ready' },
      { id: 'fullscreen', label: '全屏 / 退出全屏', keys: 'Ctrl+F', macKeys: '⌘F', status: 'ready' },
      { id: 'media-panel', label: '切换素材面板', keys: 'Tab', status: 'ready' },
      { id: 'shortcuts', label: '快捷键面板', keys: 'Ctrl+/', macKeys: '⌘/', status: 'ready', note: '? 兼容保留' },
    ],
  },
];

export const ALL_JIANYING_SHORTCUTS = JIANYING_SHORTCUT_GROUPS.flatMap((g) => g.items);

export const shortcutStats = () => {
  const all = ALL_JIANYING_SHORTCUTS;
  return {
    total: all.length,
    ready: all.filter((s) => s.status === 'ready').length,
    partial: all.filter((s) => s.status === 'partial').length,
    todo: all.filter((s) => s.status === 'todo').length,
  };
};
