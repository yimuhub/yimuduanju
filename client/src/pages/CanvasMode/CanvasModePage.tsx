/**
 * Studio · 画布模式
 * -------------------------------------------------------------
 * 所有画布项目的卡片式展示页面。
 * 最左侧是「新建画布」卡片，其他按时间倒序排列；
 * 每个卡片支持编辑（改名）与删除。
 * 「新建」直接创建一个空白画布项目并跳转到自由画布。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  PenTool,
  Pencil,
  Trash2,
  X,
  Clock,
  Layers,
} from 'lucide-react';
import { listProjects, createProject, updateProject, deleteProject } from '@client/src/api/projects';
import type { ProjectListItem } from '@shared/api.interface';

// 服务端 PageQueryDto 校验 pageSize ≤ 100，超限直接 400
const PAGE_SIZE = 100;

export const CanvasModePage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const newCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    listProjects({ page: 1, pageSize: PAGE_SIZE })
      .then((res) => {
        const items = res.items ?? [];
        items.sort((a, b) => {
          const ta = a.updatedAt ?? a.createdAt ?? '';
          const tb = b.updatedAt ?? b.createdAt ?? '';
          return tb.localeCompare(ta);
        });
        setProjects(items);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => {
    listProjects({ page: 1, pageSize: PAGE_SIZE })
      .then((res) => {
        const items = res.items ?? [];
        items.sort((a, b) => {
          const ta = a.updatedAt ?? a.createdAt ?? '';
          const tb = b.updatedAt ?? b.createdAt ?? '';
          return tb.localeCompare(ta);
        });
        setProjects(items);
      })
      .catch(() => {});
  };

  /** 新建空白画布项目 → 跳转自由画布 */
  const handleCreate = async () => {
    setCreating(true);
    try {
      const title = newTitle.trim() || `画布 ${new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
      const created = await createProject({
        title,
        description: '画布模式空白项目',
        mode: 'quick',
        durationSeconds: 60,
        aspectRatio: '16:9',
        artStyle: 'realistic',
        budgetMode: 'balanced',
      });
      refresh();
      navigate(`/project/${created.id}/canvas-free3`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
      setNewTitle('');
    }
  };

  const startEdit = (p: ProjectListItem) => {
    setEditingId(p.id);
    setEditTitle(p.title);
  };

  const saveEdit = async (p: ProjectListItem) => {
    if (!editTitle.trim()) return;
    try {
      await updateProject(p.id, { title: editTitle.trim() });
      setEditingId(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteProject(id);
      setConfirmDelete(null);
      setDeletingId(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setConfirmDelete(null);
      setDeletingId(null);
    }
  };

  const openCanvas = (id: string) => navigate(`/project/${id}/canvas-free3`);

  return (
    <div className="canvasmode-page">
      <div className="canvasmode-head">
        <h2 className="canvasmode-title">
          <PenTool size={18} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--brand-hi)' }} />
          画布模式
        </h2>
        <span className="canvasmode-sub">{projects.length} 个画布 · 按更新时间排列</span>
      </div>

      {error && (
        <div className="canvasmode-err">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="canvasmode-grid">
        {/* 新建画布卡片（最左侧最前方） */}
        <div className="canvasmode-card canvasmode-card-new" ref={newCardRef}>
          <button
            type="button"
            className="canvasmode-new-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            <Plus size={22} />
            <span>{creating ? '创建中…' : '新建画布'}</span>
          </button>
          <input
            type="text"
            placeholder="画布名称（可留空自动生成）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !creating) handleCreate();
            }}
            style={{ marginTop: 8 }}
          />
          <div className="canvasmode-new-hint">
            创建后立即进入空白自由画布
          </div>
        </div>

        {/* 既有画布卡片（按时间倒序） */}
        {loading ? (
          <div className="canvasmode-card canvasmode-card-ghost">
            <div className="canvasmode-ghost-label">加载中…</div>
          </div>
        ) : projects.length === 0 ? (
          <div className="canvasmode-card canvasmode-card-ghost">
            <div className="canvasmode-ghost-label">暂无画布项目</div>
            <div className="canvasmode-ghost-sub">点击左侧「新建画布」创建第一个</div>
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="canvasmode-card"
              onClick={() => openCanvas(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openCanvas(p.id);
              }}
            >
              {/* 缩略图 / 占位 */}
              <div className="canvasmode-thumb">
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div className="canvasmode-thumb-ph">
                    <Layers size={28} style={{ opacity: 0.3 }} />
                  </div>
                )}
              </div>

              {/* 标题区 */}
              {editingId === p.id ? (
                <div
                  className="canvasmode-title-row"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(p);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="cm-i"
                    title="保存"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveEdit(p);
                    }}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="cm-i"
                    title="取消"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(null);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="canvasmode-title-row" onClick={(e) => e.stopPropagation()}>
                  <span className="canvasmode-name" title={p.title}>
                    {p.title}
                  </span>
                  <div className="canvasmode-actions">
                    <button
                      type="button"
                      className="cm-i"
                      title="编辑名称"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(p);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="cm-i cm-i-danger"
                      title="删除画布"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(p.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* 元信息 */}
              <div className="canvasmode-meta">
                <span>
                  <Clock size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                  {p.updatedAt
                    ? new Date(p.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
                    : '—'}
                </span>
                <span className="canvasmode-meta-r">
                  {p.durationSeconds}s
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 删除确认弹层 */}
      {confirmDelete && (
        <div className="canvasmode-modal-mask" onClick={() => setConfirmDelete(null)}>
          <div className="canvasmode-modal" onClick={(e) => e.stopPropagation()}>
            <div className="canvasmode-modal-title">删除画布？</div>
            <div className="canvasmode-modal-body">
              删除后该画布及其镜头、资产将一并移除，不可恢复。
            </div>
            <div className="canvasmode-modal-actions">
              <button type="button" className="cm-btn-ghost" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button
                type="button"
                className="cm-btn-danger"
                disabled={deletingId === confirmDelete}
                onClick={() => handleDelete(confirmDelete)}
              >
                {deletingId === confirmDelete ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
