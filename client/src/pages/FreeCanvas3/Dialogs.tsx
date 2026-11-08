/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 弹窗合集：添加节点菜单 / 模型选择 / 风格库 / 历史资产 / 快捷键 / 整理画布确认
 */
import React, { useEffect, useRef, useState } from 'react';
import { useReactFlow, type XYPosition } from '@xyflow/react';
import {
  FileText,
  Image as ImageIcon,
  Clapperboard,
  AudioLines,
  Combine,
  Box,
  Upload,
  Library,
  X,
  Search,
  Keyboard,
  Check,
  ScrollText,
  UserRound,
  Mountain,
  Film,
  StickyNote,
} from 'lucide-react';
import { useP3Store } from './pavo3Store';
import { NODE_COLORS, NODE_GROUPS, NODE_TYPES, P3, SHORTCUT_GROUPS, STYLE_CATS, STYLE_LIBRARY } from './pavo3Constants';
import { useCanvasModels } from './pavo3DynamicModels';
import type { PavoNodeType } from './pavo3Types';

const MENU_ICON: Record<string, React.ReactNode> = {
  text: <FileText size={16} strokeWidth={1.8} />,
  image: <ImageIcon size={16} strokeWidth={1.8} />,
  video: <Clapperboard size={16} strokeWidth={1.8} />,
  audio: <AudioLines size={16} strokeWidth={1.8} />,
  composite: <Combine size={16} strokeWidth={1.8} />,
  director: <Box size={16} strokeWidth={1.8} />,
  script: <ScrollText size={16} strokeWidth={1.8} />,
  character: <UserRound size={16} strokeWidth={1.8} />,
  scene: <Mountain size={16} strokeWidth={1.8} />,
  storyboard: <Film size={16} strokeWidth={1.8} />,
  note: <StickyNote size={16} strokeWidth={1.8} />,
};

/* ---------------- 添加节点菜单（双击画布 / 端口拖线 / 左右加号 / 底部按钮） ---------------- */
export const AddNodeMenu = () => {
  const { addMenu, closeAddMenu, createNode, nodes } = useP3Store();
  const { screenToFlowPosition } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeAddMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAddMenu();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [addMenu, closeAddMenu]);

  if (!addMenu) return null;

  const pick = (type: PavoNodeType) => {
    const s = useP3Store.getState();
    const flowPos: XYPosition = screenToFlowPosition({ x: addMenu.x, y: addMenu.y });
    // 从左右加号打开：新节点放在锚点节点的右侧（输出）或左侧（输入），保持同高
    if (addMenu.side && addMenu.anchorNodeId) {
      const anchor = nodes.find((n) => n.id === addMenu.anchorNodeId);
      if (anchor) {
        const anchorW = anchor.measured?.width ?? 320;
        const offset = addMenu.side === 'right' ? anchorW / 2 + 200 : -(anchorW / 2 + 200);
        const pos: XYPosition = {
          x: anchor.position.x + offset,
          y: anchor.position.y,
        };
        if (addMenu.side === 'right') {
          // 锚点 → 新节点（锚点为 source）
          createNode(type, pos, { source: addMenu.anchorNodeId });
        } else {
          // 新节点 → 锚点（新节点为 source）
          createNode(type, pos, { target: addMenu.anchorNodeId });
        }
        closeAddMenu();
        return;
      }
    }
    // 双击画布 / 端口拖线：在松手处居中创建（拖线时从源节点连线）
    const pos: XYPosition = { x: flowPos.x - 140, y: flowPos.y - 80 };
    createNode(type, pos, addMenu.sourceId ? { source: addMenu.sourceId } : undefined);
    closeAddMenu();
  };

  // 左右加号菜单：紧贴节点框外侧；双击/拖线：跟随鼠标
  const menuW = 168;
  const menuX =
    addMenu.side === 'left'
      ? Math.max(8, addMenu.x - menuW)
      : addMenu.side === 'right'
        ? Math.min(addMenu.x, window.innerWidth - menuW - 8)
        : Math.min(addMenu.x, window.innerWidth - menuW - 8);
  const menuY = Math.min(Math.max(addMenu.y - 90, 8), Math.max(8, window.innerHeight - 560));

  return (
    <div ref={ref} className="p3-add-menu" style={{ left: menuX, top: menuY }}>
      <div className="p3-add-menu-section">添加节点</div>
      {NODE_GROUPS.map((g) => (
        <React.Fragment key={g.title}>
          <div style={{ fontSize: 10.5, color: P3.faint, padding: '5px 14px 1px', fontWeight: 600, letterSpacing: 1 }}>
            {g.title}
          </div>
          {g.types.map((type) => {
            const t = NODE_TYPES.find((x) => x.type === type)!;
            return (
              <button key={t.type} className="p3-add-menu-item" onClick={() => pick(t.type)}>
                <span style={{ color: NODE_COLORS[t.type] ?? P3.helper }}>{MENU_ICON[t.type]}</span>
                {t.label}
              </button>
            );
          })}
        </React.Fragment>
      ))}
      <div className="p3-add-menu-section" style={{ marginTop: 4 }}>添加资源</div>
      <button className="p3-add-menu-item" onClick={() => { closeAddMenu(); }}>
        <span style={{ color: P3.helper }}><Upload size={16} strokeWidth={1.8} /></span>
        上传
      </button>
      <button className="p3-add-menu-item" onClick={() => { closeAddMenu(); useP3Store.getState().setAssetsOpen(true); }}>
        <span style={{ color: P3.helper }}><Library size={16} strokeWidth={1.8} /></span>
        从资产库添加
      </button>
    </div>
  );
};

/* ---------------- 模型选择弹窗（对接三通道 API 的展示结构） ---------------- */
export const ModelSelectDialog = () => {
  const { modelSelectFor, setModelSelectFor, selectedModels, setSelectedModel } = useP3Store();
  // hooks 必须在早返回之前调用
  const { models: dynList } = useCanvasModels(modelSelectFor ?? 'text');
  if (!modelSelectFor) return null;
  const list = dynList;
  const current = selectedModels[modelSelectFor];

  return (
    <div className="p3-dialog-mask" onClick={() => setModelSelectFor(null)}>
      <div
        className="p3-dialog"
        style={{ width: 460, padding: '20px 0' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px 12px' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: P3.text }}>模型选择</span>
          <button className="p3-icon-btn" onClick={() => setModelSelectFor(null)}>
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '62vh', padding: '0 12px' }}>
          {list.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelectedModel(modelSelectFor, m.id);
                setModelSelectFor(null);
              }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                background: m.id === current ? 'rgba(10,188,207,0.08)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { if (m.id !== current) e.currentTarget.style.background = P3.hover; }}
              onMouseLeave={(e) => { if (m.id !== current) e.currentTarget.style.background = 'transparent'; }}
            >
              <span
                style={{
                  width: 18, height: 18, borderRadius: 50, marginTop: 1,
                  border: m.id === current ? `5px solid ${P3.primary}` : '1.5px solid #D0D0D0',
                  flexShrink: 0, boxSizing: 'border-box',
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: P3.text }}>{m.name}</span>
                  {m.tag && (
                    <span style={{ fontSize: 11, color: P3.primary, background: 'rgba(10,188,207,0.1)', padding: '1px 6px', borderRadius: 999 }}>
                      {m.tag}
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: P3.helper, marginTop: 2 }}>{m.desc}</span>
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <div style={{ textAlign: 'center', color: P3.faint, padding: '32px 0', fontSize: 13 }}>暂无可用模型</div>
          )}
        </div>
        <div style={{ padding: '12px 24px 0', fontSize: 12, color: P3.faint, borderTop: `1px solid ${P3.border}`, margin: '0 12px' }}>
          模型列表由后台配置（火山方舟 / OpenAI 兼容中转 / 自定义 API）
        </div>
      </div>
    </div>
  );
};

/* ---------------- 风格库弹窗 ---------------- */
export const StyleLibraryDialog = () => {
  const { styleLibOpen, setStyleLibOpen } = useP3Store();
  const [cat, setCat] = useState<(typeof STYLE_CATS)[number]>('全部');
  const [picked, setPicked] = useState<string | null>(null);
  if (!styleLibOpen) return null;

  const list = cat === '全部' ? STYLE_LIBRARY : STYLE_LIBRARY.filter((s) => s.cat === cat);

  return (
    <div className="p3-dialog-mask" onClick={() => setStyleLibOpen(false)}>
      <div
        className="p3-dialog"
        style={{ width: 760, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: P3.text }}>风格库</span>
          <button className="p3-icon-btn" onClick={() => setStyleLibOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* 分类 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {STYLE_CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                color: cat === c ? '#fff' : P3.text,
                background: cat === c ? P3.primary : P3.hover,
                transition: 'background 0.12s',
              }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* 风格网格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, overflowY: 'auto', maxHeight: '54vh' }}>
          {list.map((s) => (
            <button
              key={s.id}
              onClick={() => setPicked(s.id)}
              style={{
                textAlign: 'center', cursor: 'pointer', borderRadius: 12,
                padding: 6, border: picked === s.id ? `1.5px solid ${P3.primary}` : '1px solid transparent',
              }}
            >
              <div
                style={{
                  width: '100%', aspectRatio: '1', borderRadius: 8,
                  background: `linear-gradient(135deg, ${s.hue}, ${s.hue}88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11,
                }}
              >
                {s.name.slice(0, 6)}
              </div>
              <div style={{ fontSize: 12, color: P3.text, marginTop: 6, lineHeight: 1.4 }}>{s.name}</div>
            </button>
          ))}
        </div>

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => setStyleLibOpen(false)}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, color: P3.text, background: P3.hover, cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            onClick={() => {
              if (picked) {
                // 回写当前图片生成面板（真实风格参数包：正向词/负面词/色调/参考强度）
                window.dispatchEvent(new CustomEvent('p3-apply-style', { detail: picked }));
              }
              setStyleLibOpen(false);
            }}
            disabled={!picked}
            style={{
              padding: '8px 20px', borderRadius: 10, fontSize: 13, color: '#fff',
              background: picked ? P3.primary : '#B9D8DB', cursor: picked ? 'pointer' : 'not-allowed',
            }}
          >
            应用
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- 历史资产弹窗 ---------------- */
export const AssetLibraryDialog = () => {
  const { assetsOpen, setAssetsOpen, nodes } = useP3Store();
  const [tab, setTab] = useState<'image' | 'video' | 'audio'>('image');
  if (!assetsOpen) return null;

  const assets = nodes.filter(
    (n) =>
      n.data.mediaUrl &&
      ((tab === 'image' && n.data.mediaKind === 'image') ||
        (tab === 'video' && n.data.mediaKind === 'video') ||
        (tab === 'audio' && n.data.mediaKind === 'audio')),
  );

  const TABS = [
    { key: 'image' as const, label: '图片' },
    { key: 'video' as const, label: '视频' },
    { key: 'audio' as const, label: '音频' },
  ];

  return (
    <div className="p3-dialog-mask" onClick={() => setAssetsOpen(false)}>
      <div
        className="p3-dialog"
        style={{ width: 640, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: P3.text }}>历史资产</span>
          <button className="p3-icon-btn" onClick={() => setAssetsOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '5px 16px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                color: tab === t.key ? '#fff' : P3.text,
                background: tab === t.key ? P3.primary : P3.hover,
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button style={{ fontSize: 13, color: P3.helper, cursor: 'pointer' }}>批量操作</button>
        </div>
        {assets.length === 0 ? (
          <div style={{ textAlign: 'center', color: P3.faint, padding: '48px 0', fontSize: 13 }}>
            暂无数据
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, overflowY: 'auto', maxHeight: '50vh' }}>
            {assets.map((n) => (
              <div key={n.id} style={{ border: `1px solid ${P3.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <img src={n.data.mediaUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                <div style={{ fontSize: 12, color: P3.helper, padding: '6px 8px' }}>{n.data.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------- 快捷键弹窗 ---------------- */
export const ShortcutsDialog = () => {
  const { shortcutsOpen, setShortcutsOpen } = useP3Store();
  if (!shortcutsOpen) return null;
  return (
    <div className="p3-dialog-mask" onClick={() => setShortcutsOpen(false)}>
      <div
        className="p3-dialog"
        style={{ width: 560, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Keyboard size={18} color={P3.text} />
          <span style={{ fontSize: 16, fontWeight: 600, color: P3.text }}>快捷键</span>
          <div style={{ flex: 1 }} />
          <button className="p3-icon-btn" onClick={() => setShortcutsOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px' }}>
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <div style={{ fontSize: 13, fontWeight: 600, color: P3.text, marginBottom: 10 }}>{g.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((it) => (
                  <div key={it.desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: P3.helper }}>{it.desc}</span>
                    <kbd
                      style={{
                        fontSize: 12, color: P3.text, background: P3.hover,
                        padding: '3px 8px', borderRadius: 6, border: `1px solid ${P3.border}`,
                      }}
                    >
                      {it.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------- 整理画布确认弹窗 ---------------- */
export const ReorganizeConfirm = () => {
  const { reorganizeConfirm, setReorganizeConfirm, keepReorganize, revertReorganize } = useP3Store();
  if (!reorganizeConfirm) return null;
  return (
    <div className="p3-dialog-mask" onClick={() => setReorganizeConfirm(false)}>
      <div
        className="p3-dialog"
        style={{ width: 380, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: P3.text, marginBottom: 8 }}>是否保留此次整理结果？</div>
        <div style={{ fontSize: 13, color: P3.helper, marginBottom: 20 }}>
          画布节点已按连接关系自动排列。点击「保留」应用新布局，点击「还原」恢复整理前的位置。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={revertReorganize}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, color: P3.text, background: P3.hover, cursor: 'pointer', border: 'none' }}
          >
            还原
          </button>
          <button
            onClick={keepReorganize}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, color: '#fff', background: P3.primary, cursor: 'pointer', border: 'none' }}
          >
            保留
          </button>
        </div>
      </div>
    </div>
  );
};



/* ---------------- 批量删除确认弹窗（替代原生 window.confirm，玻璃拟态一致样式） ---------------- */
export const PavoDeleteConfirm = () => {
  const { deleteConfirm } = useP3Store();
  if (!deleteConfirm) return null;
  return (
    <div className="p3-dialog-mask">
      <div
        className="p3-dialog"
        style={{ width: 380, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: P3.text, marginBottom: 8 }}>
          确认删除 {deleteConfirm.count} 个节点？
        </div>
        <div style={{ fontSize: 13, color: P3.helper, marginBottom: 20 }}>
          选中的节点及其连线将被一并删除（可用 ⌘Z 撤销）。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => deleteConfirm.resolve(false)}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, color: P3.text, background: P3.hover, cursor: 'pointer', border: 'none' }}
          >
            取消
          </button>
          <button
            onClick={() => deleteConfirm.resolve(true)}
            style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, color: '#fff', background: '#E5484D', cursor: 'pointer', border: 'none' }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
};
