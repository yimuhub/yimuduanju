/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 节点卡片：端口 / 标题行 / 空态尝试 / 内容态 / 执行中（6 类节点共用结构）
 */
import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  FileText,
  Image as ImageIcon,
  Clapperboard,
  AudioLines,
  Combine,
  Box,
  Play,
  Plus,
  ScrollText,
  UserRound,
  Mountain,
  Film,
  StickyNote,
  Pencil,
} from 'lucide-react';
import type { PavoFlowNode } from './pavo3Types';
import { useP3Store } from './pavo3Store';
import { AUDIO_TRY, NODE_COLORS, NODE_TYPES, P3, TEXT_TRY } from './pavo3Constants';

const TYPE_ICON: Record<string, React.ReactNode> = {
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

/** 短剧创作类节点（属性面板 = 富文本编辑） */
const CREATION_KINDS = new Set<string>(['script', 'character', 'scene', 'storyboard', 'note']);

/** 端口连接图标（Pavo 同款：紧贴节点框两侧的圆形「+」） */
function ConnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 空态占位（textPlaceholder 风格） */
function Placeholder({ kind }: { kind: string }) {
  if (kind === 'image') {
    return (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="10" y="10" width="60" height="60" rx="10" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
        <circle cx="30" cy="30" r="5" fill="#D9D9D9" />
        <path d="M14 56l16-16 10 10 8-8 12 12" stroke="#C9C9C9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'video') {
    return (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="10" y="22" width="60" height="40" rx="8" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
        <polygon points="34,32 34,52 52,42" fill="#D9D9D9" />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="26" y="18" width="14" height="48" rx="4" stroke="#C9C9C9" strokeWidth="2" />
        <path d="M40 30l16-8v40l-16-8" stroke="#C9C9C9" strokeWidth="2" strokeLinejoin="round" />
        <path d="M20 34v16M12 40v8M56 40v8M64 34v16" stroke="#D9D9D9" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'composite') {
    return (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="14" y="20" width="22" height="44" rx="6" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
        <rect x="44" y="20" width="22" height="44" rx="6" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
        <path d="M36 26l8-3M36 42l8-3M36 58l8-3" stroke="#D9D9D9" strokeWidth="2" />
      </svg>
    );
  }
  if (kind === 'director') {
    return (
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="14" y="30" width="52" height="34" rx="6" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
        <circle cx="40" cy="47" r="9" stroke="#D9D9D9" strokeWidth="2" />
        <path d="M30 16h20M40 16v14" stroke="#C9C9C9" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  // text
  return (
    <svg width="80" height="48" viewBox="0 0 80 48" fill="none">
      <rect x="14" y="6" width="52" height="36" rx="6" stroke="#C9C9C9" strokeWidth="2" strokeDasharray="4 4" />
      <path d="M22 18h36M22 26h28M22 34h20" stroke="#D9D9D9" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TryButton({ label, icon, onClick }: { label: string; icon?: React.ReactNode; onClick: () => void }) {
  return (
    <button className="p3-try-btn" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {icon ?? <Plus size={18} strokeWidth={1.8} />}
      {label}
    </button>
  );
}

const Pavo3NodeInner = ({ id, data, selected }: NodeProps<PavoFlowNode>) => {
  const openDialog = useP3Store((s) => s.openDialog);
  const runTryAction = useP3Store((s) => s.runTryAction);
  const setDirector3DOpen = useP3Store((s) => s.setDirector3DOpen);
  const openHandleMenu = useP3Store((s) => s.openHandleMenu);

  const kind = data.nodeType;
  // P1 升级：引用徽标——自动上游 + 手动参考去重计数（之前核心卖点藏在弹窗深处）
  const refCount = useP3Store((s) => {
    const upstream = s.getUpstreamRefs(id);
    const manual = data.gen?.refs ?? [];
    return new Set([...upstream.map((n) => n.id), ...manual]).size;
  });
  const onDouble = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (kind === 'director') return;
      openDialog(id, kind === 'text' ? 'text' : kind);
    },
    [id, kind, openDialog],
  );
  /** 左右加号：弹节点类型菜单（右加号在右侧建输出节点；左加号在左侧建输入节点） */
  const onHandleClick = useCallback(
    (e: React.MouseEvent, side: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = side === 'left' ? rect.left - 140 : rect.right + 10;
      const y = rect.top + rect.height / 2;
      openHandleMenu(id, side, x, y);
    },
    [id, openHandleMenu],
  );

  // 「尝试」仅文本 / 音频显示；视频的「文生视频 / 全能参考 / 首尾帧」在弹出框内（Pavo 同款）
  const tryList = kind === 'text' ? TEXT_TRY : kind === 'audio' ? AUDIO_TRY : [];

  const statusClass =
    data.status === 'running' ? 'is-running' : data.status === 'done' ? 'is-done' : data.status === 'error' ? 'is-error' : '';

  return (
    <div
      className={`p3-node-card ${selected ? 'is-active' : ''} ${statusClass}`}
      onDoubleClick={onDouble}
    >
      {/* 左右端口（各一）—— 点击弹节点类型菜单（不再弹大模型对话框） */}
      <Handle
        type="target"
        position={Position.Left}
        className="p3-handle p3-handle-left"
        onClick={(e) => onHandleClick(e, 'left')}
      >
        <ConnIcon />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        className="p3-handle p3-handle-right"
        onClick={(e) => onHandleClick(e, 'right')}
      >
        <ConnIcon />
      </Handle>

      {/* 标题行 */}
      <div className="p3-node-title-row">
        <span style={{ display: 'inline-flex', color: NODE_COLORS[kind] ?? P3.helper }}>{TYPE_ICON[kind]}</span>
        <span>{data.title}</span>
        {CREATION_KINDS.has(kind) && (
          <span
            style={{
              marginLeft: 6, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
              color: NODE_COLORS[kind], background: `${NODE_COLORS[kind]}1A`,
              borderRadius: 999, padding: '1px 7px',
            }}
          >
            {NODE_TYPES.find((t) => t.type === kind)?.label}
          </span>
        )}
        {data.isReference && (
          <span
            title="已设为参考素材（右键可取消标记）"
            style={{ marginLeft: 6, fontSize: 11, color: P3.text, background: P3.hover, border: `1px solid ${P3.border}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}
          >
            参考
          </span>
        )}
        {refCount > 0 && (
          <span
            title={`引用 ${refCount} 个上游/手动参考，生成时自动注入`}
            style={{ marginLeft: 6, fontSize: 11, color: P3.primary, background: 'rgba(10,188,207,0.12)', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}
          >
            🔗引用×{refCount}
          </span>
        )}
        {data.status === 'running' && (
          <span style={{ marginLeft: 'auto', color: P3.primary, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="p3-spin" style={{ display: 'inline-block', animation: 'p3spin 1s linear infinite' }}>◐</span>
            执行中 {data.progress ?? 0}%
          </span>
        )}
        {data.status === 'done' && (
          <span style={{ marginLeft: 'auto', color: P3.green, fontSize: 12 }}>
            {data.isDemo ? '演示' : '已完成'}
          </span>
        )}
        {data.status === 'error' && (
          <span style={{ marginLeft: 'auto', color: '#E5484D', fontSize: 12 }}>失败</span>
        )}
      </div>

      {/* 导演台特殊：提示 + 打开按钮 */}
      {kind === 'director' && (
        <div style={{ padding: '8px 0 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
            <Placeholder kind="director" />
          </div>
          <div style={{ textAlign: 'center', color: P3.helper, fontSize: 13, lineHeight: 1.6, padding: '0 12px' }}>
            在3D空间中搭建场景并进行多视角截图
          </div>
          <button
            className="p3-director-open"
            onClick={(e) => {
              e.stopPropagation();
              useP3Store.getState().setDirectorNodeId(id);
              useP3Store.getState().setDirector3DOpen(true);
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              width: '100%', marginTop: 12, padding: '9px 0',
              borderRadius: 10, background: '#F2F2F2', color: P3.text,
              fontSize: 13, fontWeight: 500, transition: 'background 0.12s',
            }}
          >
            <Play size={14} />
            打开导演台
          </button>
        </div>
      )}

      {/* 执行中：进度 */}
      {data.status === 'running' && (
        <div className="p3-progress-track">
          <div className="p3-progress-fill" style={{ width: `${data.progress ?? 0}%` }} />
        </div>
      )}

      {/* 失败原因 */}
      {data.status === 'error' && data.errorMessage && (
        <div
          style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 8,
            background: '#FDF0F0', border: '1px solid #F5C6C6',
            color: '#C93B3F', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all',
          }}
        >
          {data.errorMessage}
        </div>
      )}

      {/* 演示产物标注 */}
      {data.status === 'done' && data.isDemo && data.mediaUrl && (
        <div
          style={{
            marginTop: 6, padding: '5px 8px', borderRadius: 6,
            background: 'rgba(10,188,207,0.06)', border: '1px dashed rgba(10,188,207,0.35)',
            color: P3.helper, fontSize: 11, textAlign: 'center',
          }}
        >
          演示产物 · 配置 API 后自动生成真实结果
        </div>
      )}

      {/* 内容态 */}
      {data.status !== 'running' && kind !== 'director' && (
        <>
          {data.markdown && (
            <div className="p3-markdown" onDoubleClick={onDouble}>
              {renderMarkdown(data.markdown)}
            </div>
          )}
          {data.mediaUrl && data.mediaKind && (
            <div onDoubleClick={onDouble} style={{ marginTop: 4 }}>
              <img
                src={data.mediaUrl}
                alt={data.title}
                style={{ width: '100%', borderRadius: 10, display: 'block' }}
                draggable={false}
              />
            </div>
          )}
          {/* 空态：占位 + 尝试 */}
          {!data.markdown && !data.mediaUrl && (
            <div>
              <div className="p3-placeholder">
                <Placeholder kind={kind} />
              </div>
              {kind === 'composite' ? (
                <div style={{ textAlign: 'center', color: P3.helper, fontSize: 13, padding: '4px 0 8px' }}>
                  请连接视频节点后操作
                </div>
              ) : kind === 'video' ? (
                <div style={{ textAlign: 'center', color: P3.helper, fontSize: 13, padding: '4px 0 8px' }}>
                  双击打开视频生成（文生视频 / 全能参考 / 首尾帧）
                </div>
              ) : CREATION_KINDS.has(kind) ? (
                <>
                  <div style={{ textAlign: 'center', color: P3.helper, fontSize: 13, padding: '4px 0 8px' }}>
                    {NODE_TYPES.find((t) => t.type === kind)?.hint}
                  </div>
                  <TryButton
                    label="编辑属性"
                    icon={<Pencil size={15} strokeWidth={1.8} />}
                    onClick={() => openDialog(id, kind)}
                  />
                </>
              ) : (
                <>
                  <div style={{ color: P3.faint, fontSize: 13, padding: '2px 2px 6px' }}>尝试：</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {tryList.map((t) => (
                      <TryButton key={t} label={t} onClick={() => runTryAction(id, t)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
      <style>{`@keyframes p3spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

/** markdown 渲染（简单：code 块高亮，其余纯文本） */
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let inCode = false;
  let code: string[] = [];
  let key = 0;
  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(
          <code key={key++} style={{ display: 'block' }}>
            {code.join('\n')}
          </code>,
        );
        code = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      code.push(line);
      return;
    }
    if (line.trim() === '') return;
    out.push(
      <div key={key++} style={{ padding: '1px 0' }}>
        {line}
      </div>,
    );
  });
  return out;
}

export const Pavo3Node = memo(Pavo3NodeInner);
