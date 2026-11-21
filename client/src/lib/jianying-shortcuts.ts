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
      { id: 'split', label: '分割 / 分开（播放头处）', keys: 'E', status: 'ready', note: '剪映常用自定义键位；同 Ctrl+B，按 E 直接切开选中片段' },
      { id: 'split-b', label: '分割（默认键）', keys: 'Ctrl+B', macKeys: '⌘B', status: 'ready', note: '剪映专业版默认键；与 E 等价' },
      { id: 'batch-split', label: '批量分割（所有轨）', keys: 'Ctrl+Shift+B', macKeys: '⌘⇧B', status: 'ready' },
      { id: 'select-mode', label: '选择模式', keys: 'A', status: 'ready' },
      { id: 'split-mode', label: '分割模式（点击即切）', keys: 'B', status: 'ready' },
      { id: 'razor-shift', label: '剃刀切所有轨', keys: 'B + Shift点击', status: 'ready', note: '剃刀激活时 Shift+点击：在指针时刻切开所有轨的可切片段（一次撤销）' },
      { id: 'trim-playhead', label: '修剪到播放头（左 / 右）', keys: '右键菜单', status: 'ready', note: '非波纹修剪：边缘落到播放头，后续片段保持原位；工具栏「删除与修剪」与片段右键菜单都有入口' },
      { id: 'pickup-move', label: '拾取并移动片段', keys: '空格（选中单个片段时）', status: 'ready', note: 'Space 拿起 → ↑↓ 换轨 → ←→ 帧步进（Shift 十帧）→ Space/Enter 放下 → Esc 取消还原；无选中时空格仍是播放/暂停' },
      { id: 'delete-left', label: '删除播放头左侧', keys: 'Q', status: 'ready' },
      { id: 'delete-right', label: '删除播放头右侧', keys: 'W', status: 'ready' },
      { id: 'delete', label: '删除选中片段', keys: 'Delete / Backspace', status: 'ready', note: '波纹删除；Shift+Delete 保留空隙' },
      { id: 'enable', label: '启用 / 停用片段', keys: 'V', status: 'ready', note: '停用后保留在时间线，预览与导出跳过' },
      { id: 'copy', label: '复制', keys: 'Ctrl+C', macKeys: '⌘C', status: 'ready' },
      { id: 'duplicate', label: '原地复制到播放头', keys: 'Ctrl+D', macKeys: '⌘D', status: 'ready', note: '复制选中片段并粘贴到播放头，与 OpenMotion 的 ⌘D 对齐' },
      { id: 'cut', label: '剪切', keys: 'Ctrl+X', macKeys: '⌘X', status: 'ready' },
      { id: 'paste', label: '粘贴到播放头', keys: 'Ctrl+V', macKeys: '⌘V', status: 'ready' },
      { id: 'undo', label: '撤销', keys: 'Ctrl+Z', macKeys: '⌘Z', status: 'ready' },
      { id: 'redo', label: '重做', keys: 'Ctrl+Shift+Z', macKeys: '⌘⇧Z', status: 'ready', note: 'Ctrl+Y 兼容保留' },
      { id: 'select-all', label: '全选片段', keys: 'Ctrl+A', macKeys: '⌘A', status: 'ready' },
      { id: 'select-left', label: '选中播放头左侧片段', keys: '[', status: 'ready' },
      { id: 'select-right', label: '选中播放头右侧片段', keys: ']', status: 'ready' },
      { id: 'in', label: '设入点', keys: 'I', status: 'ready', note: '帧量化设点；入出区域成型时自动开启循环播放（G8）' },
      { id: 'out', label: '设出点', keys: 'O', status: 'ready', note: '帧量化设点；入出区域成型时自动开启循环播放（G8）' },
      { id: 'mark-area', label: '按片段选择区域', keys: 'Shift+X', status: 'ready', note: '按 I/O 选区选择片段；工具栏「选区」按同一区间导出' },
      { id: 'clear-area', label: '清除选择区域', keys: 'Alt+X', status: 'ready', note: '清除选区与 I/O 区域，循环播放自动关闭' },
    ],
  },
  {
    title: '播放与时间线',
    items: [
      { id: 'play', label: '播放 / 暂停', keys: '空格', status: 'ready' },
      { id: 'prev-frame', label: '上一帧', keys: '←', status: 'ready' },
      { id: 'next-frame', label: '下一帧', keys: '→', status: 'ready' },
      { id: 'frame-10', label: '前后 10 帧', keys: 'Shift+← / Shift+→', status: 'ready', note: '按 10 帧步进，粗定位后再逐帧' },
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
      { id: 'preview-axis', label: '安全区参考线', keys: 'S', status: 'ready', note: 'S 开关短视频平台 UI 安全区；分割仍用 E / Ctrl+B' },
      { id: 'magnet', label: '主轨磁吸', keys: 'P', status: 'partial', note: 'P 与 N 都切换吸附总开关；当前未区分只吸附 V1' },
      { id: 'close-gaps', label: '闭合此空隙 / 闭合全部空隙', keys: '右键空白轨区', status: 'ready', note: '该行空隙之后的片段整体左移收拢；前导留黑不吞，画面轨从 0 排齐请用「画面轨排齐」；锁定轨 / 锁定片段会拒绝并说明' },
      { id: 'freeze-frame', label: '冻结帧', keys: '右键画面片段', status: 'ready', note: '播放头在片段内时可用：抓当前帧生成图片片段插入切点（默认 1s，可拖右边缘拉长）' },
      { id: 'time-frame-toggle', label: '时间码 / 帧号显示', keys: '点击预览时间码', status: 'ready', note: '预览走带、时间线状态栏、hover 与标尺读数同步切换并持久化' },
      { id: 'link', label: '音视频联动', keys: '~', status: 'ready', note: '把选中的画面/音频绑成 bindGroup 整组同动；再按 ~ 解绑' },
      { id: 'marker', label: '添加标记点', keys: 'M', status: 'ready', note: '内部标记；非剪映标准键位，剪映手动踩点为 Ctrl+J' },
      { id: 'beat', label: '手动踩点', keys: 'Ctrl+J', macKeys: '⌘J', status: 'ready', note: '在播放头打踩点并显示标记' },
      { id: 'mute', label: '静音 / 取消静音片段', keys: 'Shift+M', status: 'ready' },
      { id: 'jkl', label: '播放控制 J/K/L', keys: 'J / K / L', status: 'ready', note: 'L 正放（再按加速 1×→2×→4×）、K 停止回 1×、J 反放（同向连按加速）；反放/倒放片段按帧步进 seek' },
      { id: 'loop', label: '循环播放开关', keys: 'Shift+L', status: 'ready', note: '有 I/O 区域时在区域内循环，否则循环整段；预览控制条同款按钮；I/O 设点自动开循环，Alt+X 清除区域自动关' },
    ],
  },
  {
    title: '音频、速度与组合',
    items: [
      { id: 'detach-audio', label: '分离 / 还原音频', keys: 'Ctrl+Shift+S', macKeys: '⌘⇧S', status: 'ready' },
      { id: 'speed-panel', label: '速度面板', keys: 'Ctrl+R', macKeys: '⌘R', status: 'partial', note: '打开右侧检查器「速度与声音」，不自动聚焦输入框' },
      { id: 'curve-speed', label: '曲线变速', keys: 'Shift+B', status: 'ready', note: '等长源片段逐段速度折线逼近；拆分后是真片段，可预览、保存与导出' },
      { id: 'volume-up', label: '音量微调 +', keys: 'Ctrl+.', macKeys: '⌘.', status: 'ready' },
      { id: 'volume-down', label: '音量微调 -', keys: 'Ctrl+,', macKeys: '⌘,', status: 'ready' },
      { id: 'audio-gain', label: '音频增益对话框', keys: 'G', status: 'ready', note: '选中含音频的片段弹出 fader 推子（0dB 中心刻度），拖动实时试听，确认批量应用；Esc 取消还原' },
      { id: 'group', label: '组合片段', keys: 'Ctrl+G', macKeys: '⌘G', status: 'ready', note: '以 bindGroup 实现整组同动' },
      { id: 'ungroup', label: '取消组合', keys: 'Ctrl+Shift+G', macKeys: '⌘⇧G', status: 'ready' },
      { id: 'compound', label: '新建复合片段', keys: 'Alt+G', status: 'ready', note: '同轨相邻画面收成一个整体，可整体移动/裁剪；导出自动展开子片段' },
      { id: 'uncompound', label: '解除复合片段', keys: 'Alt+Shift+G', status: 'ready' },
      { id: 'keyframe', label: '添加关键帧', keys: 'Ctrl+K', macKeys: '⌘K', status: 'ready', note: '为选中画面在播放头添加运镜关键帧（缩放/平移/旋转），预览与导出共用数据' },
      { id: 'keyframe-panel', label: '关键帧面板', keys: 'Alt+K', status: 'ready', note: '逐帧编辑缩放/平移/旋转，可定位与删除' },
      { id: 'attr-copy', label: '复制片段属性', keys: 'Ctrl+Shift+C', macKeys: '⌘⇧C', status: 'ready', note: '复制速度/音量/转场/字幕样式，不复制片段本体' },
      { id: 'attr-paste', label: '粘贴片段属性', keys: 'Ctrl+Shift+V', macKeys: '⌘⇧V', status: 'ready', note: '粘贴到选中片段，可 ⌘Z 撤销' },
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
      { id: 'media-panel', label: '切换素材面板', keys: 'Tab', status: 'partial', note: '当前用左侧栏点击切换，Tab 暂未绑定' },
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
