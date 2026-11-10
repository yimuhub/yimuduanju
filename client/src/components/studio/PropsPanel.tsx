/**
 * 道具设定面板 · 右坞「道具」专页 ↔ 圣经「道具一致性」分区共用同一实现
 * -------------------------------------------------------------
 * 数据以数据库 props 表为唯一真相；身份（形制/材质/永久标记）与
 * 状态变体（开合/破损/内容物/转手）严格分离，不拆成多个假道具。
 * 关键/复现/状态道具必须有设定图与识别锚点，才能进入分镜首帧上下文。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Check,
  ChevronDown,
  ImagePlus,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { bible } from '@client/src/api';
import { uploadLocalFile } from '@client/src/api/assets';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import type {
  Character,
  Prop,
  PropCategory,
  PropStateVariant,
  UpdatePropRequest,
} from '@shared/api.interface';
import {
  PROP_CATEGORIES,
  PROP_TEXT_POLICIES,
  isPropReady,
} from '@shared/api.interface';

const notifyChanged = () => window.dispatchEvent(new Event('yimu:bible-updated'));

const CAT_LABEL: Record<PropCategory, string> = {
  hero: '关键道具', recurring: '复现道具', stateful: '状态道具', set_dressing: '背景陈设',
};

interface EditDraft {
  name: string;
  category: PropCategory;
  identityAnchors: string;
  appearance: string;
  scaleReference: string;
  functionDesc: string;
  storyRole: string;
  ownerCharacterId: string;
  continuityLock: string;
  forbiddenChanges: string;
  textPolicy: Prop['textPolicy'];
  readableText: string;
  locked: boolean;
  stateVariants: PropStateVariant[];
}

const draftOf = (p: Prop): EditDraft => ({
  name: p.name,
  category: p.category,
  identityAnchors: p.identityAnchors ?? '',
  appearance: p.appearance ?? '',
  scaleReference: p.scaleReference ?? '',
  functionDesc: p.functionDesc ?? '',
  storyRole: p.storyRole ?? '',
  ownerCharacterId: p.ownerCharacterId ?? '',
  continuityLock: p.continuityLock ?? '',
  forbiddenChanges: p.forbiddenChanges ?? '',
  textPolicy: p.textPolicy,
  readableText: p.readableText ?? '',
  locked: p.locked,
  stateVariants: (p.stateVariants ?? []).map((v) => ({ ...v })),
});

interface PropsPanelProps {
  projectId: string;
  /** full = 右坞独立道具页；embedded = 圣经页里的一个分区 */
  variant?: 'full' | 'embedded';
}

export const PropsPanel = ({ projectId, variant = 'full' }: PropsPanelProps) => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Prop[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMenu, setGenMenu] = useState(false);
  const [filter, setFilter] = useState<PropCategory | 'all'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ id: string; variantIndex?: number } | null>(null);
  const genRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [ps, cs] = await Promise.all([
      bible.listProps(projectId).catch(() => [] as Prop[]),
      bible.listCharacters(projectId).catch(() => [] as Character[]),
    ]);
    setItems(ps);
    setChars(cs);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // 圣经页或对话侧生成道具后，本面板同步刷新
  useEffect(() => {
    const onUpdate = () => { void load(); };
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, [load]);

  useEffect(() => {
    if (!genMenu) return;
    const close = (e: PointerEvent) => {
      if (!genRef.current?.contains(e.target as Node)) setGenMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [genMenu]);

  const ready = items.filter(isPropReady).length;
  const withImage = items.filter((p) => p.referenceImageUrls?.length > 0).length;
  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((p) => p.category === filter)),
    [items, filter],
  );

  /* ---------------- 操作 ---------------- */
  const generateAll = async (mode: 'fill' | 'overwrite') => {
    if (generating) return;
    setGenerating(true);
    setGenMenu(false);
    try {
      const res = await bible.generateProps(projectId, { mode });
      await load();
      notifyChanged();
      setNote(
        res.note ??
          `已从剧本提取道具：新增 ${res.created} 项、更新 ${res.updated} 项，请逐项复核锚点与尺度`,
      );
      toast.success(res.source === 'llm' ? '道具已由模型生成，可逐项修改' : '已生成道具草稿，请复核');
    } catch (e) {
      toast.error(`生成失败：${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const startEdit = (p: Prop) => {
    setEditing(p.id);
    setDraft(draftOf(p));
    setConfirmDel(null);
  };

  const saveEdit = async (p: Prop) => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('名称不能为空'); return; }
    setBusyId(p.id);
    const payload: UpdatePropRequest = {
      name,
      category: draft.category,
      identityAnchors: draft.identityAnchors,
      appearance: draft.appearance,
      scaleReference: draft.scaleReference,
      functionDesc: draft.functionDesc,
      storyRole: draft.storyRole,
      ownerCharacterId: draft.ownerCharacterId || undefined,
      continuityLock: draft.continuityLock,
      forbiddenChanges: draft.forbiddenChanges,
      textPolicy: draft.textPolicy,
      readableText: draft.readableText,
      locked: draft.locked,
      stateVariants: draft.stateVariants,
    };
    try {
      const updated = await bible.updateProp(projectId, p.id, payload);
      setItems((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      setEditing(null);
      setDraft(null);
      notifyChanged();
      toast.success('道具设定已保存');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const addItem = async () => {
    if (!newName.trim()) return;
    setBusyId('new');
    try {
      const created = await bible.createProp(projectId, { name: newName.trim(), category: 'recurring' });
      setItems((prev) => [created, ...prev]);
      setNewName('');
      setAdding(false);
      notifyChanged();
      toast.success('已添加，请补全识别锚点、尺度并出设定图');
    } catch (e) {
      toast.error(`添加失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (id: string) => {
    setBusyId(id);
    try {
      await bible.deleteProp(projectId, id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      setConfirmDel(null);
      notifyChanged();
      toast.success('已删除');
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleLock = async (p: Prop) => {
    setBusyId(p.id);
    try {
      const updated = await bible.updateProp(projectId, p.id, { locked: !p.locked });
      setItems((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      notifyChanged();
      toast.success(p.locked ? '已解锁' : '已锁定，AI 生成将不再覆盖');
    } catch (e) {
      toast.error(`操作失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const pickUpload = (id: string, variantIndex?: number) => {
    uploadTarget.current = { id, variantIndex };
    fileRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = uploadTarget.current;
    e.target.value = '';
    uploadTarget.current = null;
    if (!file || !target) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    setBusyId(target.id);
    try {
      const { fileUrl } = await uploadLocalFile(projectId, file, file.name);
      const cur = items.find((p) => p.id === target.id);
      if (!cur) return;
      let payload: UpdatePropRequest;
      if (typeof target.variantIndex === 'number') {
        const variants = (cur.stateVariants ?? []).map((v, i) =>
          i === target.variantIndex ? { ...v, imageUrl: fileUrl } : { ...v });
        payload = { stateVariants: variants };
      } else {
        payload = {
          referenceImageUrls: [fileUrl, ...(cur.referenceImageUrls ?? [])].slice(0, 6),
        };
      }
      const updated = await bible.updateProp(projectId, cur.id, payload);
      setItems((prev) => prev.map((x) => (x.id === cur.id ? updated : x)));
      if (draft && editing === cur.id) setDraft(draftOf(updated));
      notifyChanged();
      toast.success('道具参考图已绑定，分镜首帧会以此为准');
    } catch (err) {
      toast.error(`上传失败：${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const generateImage = async (p: Prop) => {
    setBusyId(p.id);
    try {
      await bible.generatePropImage(projectId, p.id);
      toast.success('道具设定图任务已提交，完成后自动回写');
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  /* ---------------- 渲染 ---------------- */
  const editPanel = (p: Prop) => {
    if (!draft) return null;
    const D = draft;
    const set = (patch: Partial<EditDraft>) => setDraft({ ...D, ...patch });
    const setVariant = (i: number, patch: Partial<PropStateVariant>) =>
      set({ stateVariants: D.stateVariants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) });
    return (
      <div className="pr-edit">
        <div className="pr-edit-grid">
          <label>名称<input value={D.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>分类
            <select value={D.category} onChange={(e) => set({ category: e.target.value as PropCategory })}>
              {PROP_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label>归属角色
            <select value={D.ownerCharacterId} onChange={(e) => set({ ownerCharacterId: e.target.value })}>
              <option value="">未指定</option>
              {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>可读文字政策
            <select value={D.textPolicy} onChange={(e) => set({ textPolicy: e.target.value as Prop['textPolicy'] })}>
              {PROP_TEXT_POLICIES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
        </div>
        {D.textPolicy === 'exact_readable' ? (
          <label className="pr-edit-full">准确文字（逐字保留，禁用全局禁字）
            <input value={D.readableText} onChange={(e) => set({ readableText: e.target.value })} placeholder="如：潮位 7" />
          </label>
        ) : null}
        <label className="pr-edit-full">识别锚点 · 形制 / 部件关系 / 材料工艺 / 永久唯一标记
          <textarea rows={2} value={D.identityAnchors} onChange={(e) => set({ identityAnchors: e.target.value })}
            placeholder="如：手掌长的扁长黑铁匣，铰链盖，右前角永久凹陷" />
        </label>
        <label className="pr-edit-full">外观 · 形状 / 颜色 / 材质 / 磨损
          <textarea rows={2} value={D.appearance} onChange={(e) => set({ appearance: e.target.value })} />
        </label>
        <div className="pr-edit-grid">
          <label>尺度参照<input value={D.scaleReference} onChange={(e) => set({ scaleReference: e.target.value })} placeholder="约手掌长，与成年人前臂相当" /></label>
          <label>功能与操作<input value={D.functionDesc} onChange={(e) => set({ functionDesc: e.target.value })} /></label>
          <label>连续性锁<input value={D.continuityLock} onChange={(e) => set({ continuityLock: e.target.value })} placeholder="跨镜不可改变的最小名词短语" /></label>
          <label>禁改项<input value={D.forbiddenChanges} onChange={(e) => set({ forbiddenChanges: e.target.value })} /></label>
        </div>
        <label className="pr-edit-full">剧情作用
          <textarea rows={2} value={D.storyRole} onChange={(e) => set({ storyRole: e.target.value })} />
        </label>

        <div className="pr-variants">
          <div className="pr-variants-head">
            <b>状态变体</b>
            <small>同一道具的开合 / 破损 / 内容物 / 转手，不拆成两个假道具</small>
            <button type="button" className="pr-mini" onClick={() => set({
              stateVariants: [...D.stateVariants, { id: `v-${Date.now()}`, name: '', description: '' }],
            })}><Plus size={11} /> 添加状态</button>
          </div>
          {D.stateVariants.length === 0 ? <div className="pr-variants-empty">暂无状态变体</div> : null}
          {D.stateVariants.map((v, i) => (
            <div className="pr-variant-row" key={v.id || i}>
              <input value={v.name} placeholder="状态名，如 打开·空" onChange={(e) => setVariant(i, { name: e.target.value })} />
              <input value={v.description} placeholder="变化原因与有效范围" onChange={(e) => setVariant(i, { description: e.target.value })} />
              <button type="button" title={v.imageUrl ? '预览状态图' : '上传状态图'}
                onClick={() => v.imageUrl ? setPreview({ url: v.imageUrl, title: `${p.name} · ${v.name}` }) : pickUpload(p.id, i)}>
                {v.imageUrl ? <ImagePlus size={12} /> : <Upload size={12} />}
              </button>
              <button type="button" title="删除状态" onClick={() => set({ stateVariants: D.stateVariants.filter((_, idx) => idx !== i) })}><X size={12} /></button>
            </div>
          ))}
        </div>

        <div className="pr-edit-foot">
          <label className="pr-lock-chk"><input type="checkbox" checked={D.locked} onChange={(e) => set({ locked: e.target.checked })} /> 锁定（AI 不覆盖）</label>
          <button type="button" className="pr-btn ghost" onClick={() => { setEditing(null); setDraft(null); }}>取消</button>
          <button type="button" className="pr-btn primary" onClick={() => void saveEdit(p)} disabled={busyId === p.id}>
            {busyId === p.id ? <Loader2 size={12} className="spin" /> : <Check size={12} />} 保存
          </button>
        </div>
      </div>
    );
  };

  const card = (p: Prop) => {
    const ref = p.referenceImageUrls?.[0];
    const ok = isPropReady(p);
    return (
      <article className={`pr-card${p.locked ? ' locked' : ''}${ok ? ' ready' : ''}`} key={p.id}>
        <button type="button" className="pr-thumb"
          title={ref ? '点击预览设定图' : '点击上传设定图'}
          onClick={() => ref ? setPreview({ url: ref, title: `${p.code} ${p.name} · 设定图` }) : pickUpload(p.id)}>
          {ref ? <img src={ref} alt="" loading="lazy" /> : (
            <span className="pr-thumb-ph"><Box size={20} /><small>点击上传</small></span>
          )}
          {busyId === p.id ? <span className="pr-busy"><Loader2 size={15} className="spin" /></span> : null}
          <i className={`pr-state${ok ? ' ok' : ''}`}>{ok ? '可进片' : '待补全'}</i>
        </button>
        <div className="pr-body">
          <div className="pr-title">
            <span className="pr-code">{p.code || 'PROP'}</span>
            <b title={p.name}>{p.name}</b>
            <i className={`pr-cat c-${p.category}`}>{CAT_LABEL[p.category] ?? p.category}</i>
            {p.locked ? <Lock size={11} className="pr-lock" /> : null}
          </div>
          <p className="pr-desc">{p.identityAnchors || '尚未填写识别锚点：形制 / 材料 / 永久标记'}</p>
          {p.scaleReference ? <div className="pr-scale">尺度 · {p.scaleReference}</div> : null}
          {p.stateVariants?.length ? (
            <div className="pr-chips">
              {p.stateVariants.slice(0, 4).map((v) => (
                <button type="button" key={v.id} className="pr-chip"
                  title={v.description || v.name}
                  onClick={() => v.imageUrl ? setPreview({ url: v.imageUrl, title: `${p.name} · ${v.name}` }) : startEdit(p)}>
                  {v.name || '未命名状态'}
                </button>
              ))}
              {p.stateVariants.length > 4 ? <span className="pr-chip more">+{p.stateVariants.length - 4}</span> : null}
            </div>
          ) : null}
          <div className="pr-acts">
            <button type="button" title="上传设定图" onClick={() => pickUpload(p.id)}><Upload size={12} /> 上传</button>
            <button type="button" title="AI 生成道具设定图" onClick={() => void generateImage(p)} disabled={busyId === p.id}><Sparkles size={12} /> 生成</button>
            <button type="button" title="编辑设定" onClick={() => startEdit(p)}><Pencil size={12} /></button>
            <button type="button" title={p.locked ? '解锁' : '锁定'} onClick={() => void toggleLock(p)}>{p.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
            <button type="button" title="删除" onClick={() => setConfirmDel(p.id)}><Trash2 size={12} /></button>
          </div>
          {confirmDel === p.id ? (
            <div className="pr-confirm"><span>确认删除这条道具？</span>
              <button type="button" onClick={() => setConfirmDel(null)}>取消</button>
              <button type="button" className="danger" onClick={() => void removeItem(p.id)}>删除</button>
            </div>
          ) : null}
        </div>
        {editing === p.id ? editPanel(p) : null}
      </article>
    );
  };

  const head = (
    <div className="pr-head">
      <span className="pr-head-ico"><Box size={15} /></span>
      <div className="pr-head-txt"><b>道具 · 一致性资产</b><small>身份与状态分离 · 编号进分镜 · 设定图进首帧</small></div>
      <span className="pr-head-meta">{ready}/{items.length} 可进片</span>
      <button type="button" className="pr-mini" title="重新读取" onClick={() => void load()}><RefreshCw size={12} /></button>
    </div>
  );

  const toolbar = (
    <div className="pr-toolbar">
      <div className="pr-filters">
        {([['all', '全部'], ...PROP_CATEGORIES.map((c) => [c.key, c.label] as [string, string])] as [string, string][]).map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k as PropCategory | 'all')}>
            {label}{k === 'all' ? <em>{items.length}</em> : null}
          </button>
        ))}
      </div>
      <div className="pr-tool-acts">
        <div className="pr-gen" ref={genRef}>
          <button type="button" className="pr-btn primary" onClick={() => void generateAll('fill')} disabled={generating}>
            {generating ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
            {generating ? '生成中…' : 'AI 生成道具'}
          </button>
          <button type="button" className="pr-btn primary arrow" title="生成选项" onClick={() => setGenMenu((v) => !v)} disabled={generating}><ChevronDown size={12} /></button>
          {genMenu ? (
            <div className="pr-gen-menu">
              <button type="button" onClick={() => void generateAll('fill')}><b>仅补空白</b><small>只新增剧本里还没登记的道具</small></button>
              <button type="button" onClick={() => void generateAll('overwrite')}><b>重新提取</b><small>覆盖文本设定，参考图与锁定项保留</small></button>
            </div>
          ) : null}
        </div>
        <button type="button" className="pr-btn ghost" onClick={() => { setAdding(true); setNewName(''); }}><Plus size={12} /> 添加</button>
        {variant === 'embedded' ? (
          <button type="button" className="pr-btn ghost" onClick={() => navigate(`/project/${projectId}/props`)}>打开道具页</button>
        ) : (
          <button type="button" className="pr-btn ghost" onClick={() => navigate(`/project/${projectId}/bible`)}>打开圣经</button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return <div className={`pr-root ${variant}`}><div className="pr-loading"><Loader2 size={15} className="spin" /> 正在读取道具设定…</div></div>;
  }

  return (
    <div className={`pr-root ${variant}`}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFilePicked(e)} />

      {variant === 'full' ? (
        <header className="pr-hero">
          <div className="pr-hero-top">
            <span className="pr-hero-ico"><Box size={17} /></span>
            <div><h2>道具设定</h2><p>从剧本提取关键 / 复现 / 状态道具，锁定形制与尺度</p></div>
          </div>
          <div className="pr-stats">
            <div><b className="num">{items.length}</b><span>已登记</span></div>
            <div><b className="num">{withImage}</b><span>已出图</span></div>
            <div><b className="num ok">{ready}</b><span>可进片</span></div>
            <div><b className="num warn">{items.length - ready}</b><span>待补全</span></div>
          </div>
          <div className="pr-hero-note">
            只有「识别锚点 + 设定图」齐备的道具才会写进分镜场景并作为首帧参考图；状态变化记为变体，不新增假道具。
          </div>
        </header>
      ) : head}

      {note ? <div className="pr-note"><Sparkles size={12} /><span>{note}</span><button type="button" onClick={() => setNote(null)}><X size={11} /></button></div> : null}

      {toolbar}

      {adding ? (
        <div className="pr-add">
          <input autoFocus value={newName} placeholder="输入道具名称，如：铁皮匣 / 便利店监控"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); if (e.key === 'Escape') setAdding(false); }} />
          <button type="button" className="pr-btn primary" onClick={() => void addItem()} disabled={!newName.trim() || busyId === 'new'}>创建</button>
          <button type="button" className="pr-btn ghost" onClick={() => { setAdding(false); setNewName(''); }}><X size={12} /></button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="pr-empty">
          <span><Box size={20} /></span>
          <b>{items.length === 0 ? '这部作品还没有道具设定' : '这个分类下没有道具'}</b>
          <p>{items.length === 0 ? '从剧本自动提取会跨镜复现的物件，或手动添加；随后补齐识别锚点、尺度参照并出设定图。' : '切换分类，或添加一件新道具。'}</p>
          {items.length === 0 ? (
            <button type="button" className="pr-btn primary" onClick={() => void generateAll('fill')} disabled={generating}>
              <Wand2 size={13} /> 从剧本提取道具
            </button>
          ) : null}
        </div>
      ) : (
        <div className="pr-cards">{visible.map(card)}</div>
      )}

      {preview ? (
        <MediaPreviewDialog url={preview.url} kind="image" title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
};

export default PropsPanel;
