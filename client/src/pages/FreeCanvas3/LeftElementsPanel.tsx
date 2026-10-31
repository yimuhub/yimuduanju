/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 左侧面板：项目名 / 创建新项目 / 画布元素列表 / 全部筛选
 */
import React, { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Plus, FileText, Image as ImageIcon, Clapperboard, AudioLines, Combine, Box, ArrowLeft } from 'lucide-react';
import { useP3Store } from './pavo3Store';
import { FILTERS, P3 } from './pavo3Constants';
import type { PavoNodeType } from './pavo3Types';

const TYPE_ICON: Record<string, React.ReactNode> = {
  text: <FileText size={15} strokeWidth={1.8} />,
  image: <ImageIcon size={15} strokeWidth={1.8} />,
  video: <Clapperboard size={15} strokeWidth={1.8} />,
  audio: <AudioLines size={15} strokeWidth={1.8} />,
  composite: <Combine size={15} strokeWidth={1.8} />,
  director: <Box size={15} strokeWidth={1.8} />,
};

export const LeftElementsPanel = () => {
  const { nodes, filter, setFilter, projectName, setProjectName } = useP3Store();
  const { setCenter } = useReactFlow();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const visible = filter === 'all' ? nodes : nodes.filter((n) => n.data.nodeType === filter);

  const focusNode = (id: string, x: number, y: number) => {
    setCenter(x + 140, y + 40, { zoom: 1, duration: 400 });
  };

  return (
    <div
      style={{
        width: 248,
        flexShrink: 0,
        height: '100%',
        background: '#ffffff',
        borderRight: '1px solid #F0F0F0',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 14px',
        gap: 12,
        overflowY: 'auto',
      }}
    >
      {/* 返回工作台（平台导航，不影响 Pavo 画布交互） */}
      <button
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
        title="返回工作台"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          color: '#5F5F5F',
          background: '#F7F7F7',
          border: '1px solid #EFEFEF',
          cursor: 'pointer',
          width: 'fit-content',
        }}
      >
        <ArrowLeft size={14} />
        返回工作台
      </button>

      {/* 项目名（双击重命名） */}
      {renaming ? (
        <input
          autoFocus
          defaultValue={projectName}
          onBlur={(e) => {
            setProjectName(e.target.value.trim() || '未命名项目');
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          style={{
            fontSize: 16, fontWeight: 600, color: P3.text,
            border: `1px solid ${P3.primary}`, borderRadius: 8, padding: '4px 8px', outline: 'none',
          }}
        />
      ) : (
        <div
          title="双击重命名"
          onDoubleClick={() => setRenaming(true)}
          style={{
            fontSize: 16, fontWeight: 600, color: P3.text,
            padding: '4px 2px', cursor: 'text', userSelect: 'none',
          }}
        >
          {projectName}
        </div>
      )}

      {/* 创建新项目 */}
      <button
        onClick={() => {
          // 重置为空白画布（演示：清空节点）
          useP3Store.setState({ nodes: [], edges: [], counters: { text: 0, image: 0, video: 0, audio: 0, composite: 0, director: 0 } });
          setProjectName('未命名项目');
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          height: 46, borderRadius: 24, background: P3.hover, color: P3.text,
          fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#E9E9E9')}
        onMouseLeave={(e) => (e.currentTarget.style.background = P3.hover)}
      >
        <Plus size={16} strokeWidth={2} />
        创建新项目
      </button>

      {/* 画布元素 + 筛选 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 13, color: P3.helper }}>画布元素</span>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 2,
              fontSize: 12, color: P3.helper, padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
            }}
          >
            {FILTERS.find((f) => f.key === filter)?.label}
            <ChevronDown size={12} />
          </button>
          {filterOpen && (
            <div
              style={{
                position: 'absolute', right: 0, top: 26, zIndex: 50,
                background: '#fff', border: `1px solid ${P3.border}`, borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 108,
              }}
            >
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    setFilter(f.key);
                    setFilterOpen(false);
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                    color: f.key === filter ? P3.primary : P3.text,
                    background: f.key === filter ? 'rgba(10,188,207,0.08)' : 'transparent',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 节点列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
        {visible.map((n) => (
          <button
            key={n.id}
            onClick={() => focusNode(n.id, n.position.x, n.position.y)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 8px', borderRadius: 8, fontSize: 13, color: P3.text,
              cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = P3.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ color: P3.helper }}>{TYPE_ICON[n.data.nodeType]}</span>
            {n.data.title}
            {n.data.status === 'running' && <span style={{ marginLeft: 'auto', fontSize: 11, color: P3.primary }}>生成中</span>}
          </button>
        ))}
        {visible.length === 0 && (
          <div style={{ fontSize: 13, color: P3.faint, padding: '16px 8px', textAlign: 'center' }}>
            暂无节点
          </div>
        )}
      </div>
    </div>
  );
};
