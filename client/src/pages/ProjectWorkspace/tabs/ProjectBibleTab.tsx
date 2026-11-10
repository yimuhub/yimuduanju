/**
 * 制作圣经 · 一部作品的一致性中枢
 * -------------------------------------------------------------
 * 设计标准（与右坞其它页一致）：
 *  · 容器驱动，不依赖视口断点：标准 548px 单列、≥700px 双列字段与卡片
 *  · 视觉只用发丝线 + 底色深浅差，强调色仅 --brand；无渐变/毛玻璃/上浮/厚影
 *  · 单一数据源：世界观 / 风格 / 人物 / 场景 / 道具全部直接读写 bible 接口
 *  · 人物按行业标准定义：1 张主图（正脸特写）+ 四视图（正/3-4/侧/背）独立成图，
 *    再叠加身份 / 服装 / 声线 / 签名细节 / 禁改项五道文本锁。
 *  · 道具是第三类可寻址资产：身份与状态变体分离，编号进分镜、设定图进首帧。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  ImagePlus,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { bible, storyboard } from '@client/src/api';
import { uploadLocalFile } from '@client/src/api/assets';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import CharacterKitStrip, { type KitViewKey } from '@client/src/components/studio/CharacterKitStrip';
import PropsPanel from '@client/src/components/studio/PropsPanel';
import type {
  Character,
  CharacterIdentityKit,
  Location,
  Prop,
  WorldView,
  StyleBible,
} from '@shared/api.interface';
import {
  CHARACTER_VIEW_KEYS,
  emptyIdentityKit,
  isCharacterFullyDefined,
  isPropReady,
} from '@shared/api.interface';

const EMPTY_WORLD: WorldView = {
  era: '', geography: '', socialRules: '', artStyle: '', colorSystem: '',
};
const EMPTY_STYLE: StyleBible = {
  visualStyle: '', cameraLanguage: '', colorPalette: '', lighting: '',
  texture: '', motionLanguage: '', subtitleStyle: '',
};

const WORLD_FIELDS: { key: keyof WorldView; label: string; hint: string }[] = [
  { key: 'era', label: '时代背景', hint: '如：近未来 2049，雨夜都市' },
  { key: 'geography', label: '地理环境', hint: '如：沿海巨型城市，旧城区与高空新区割裂' },
  { key: 'socialRules', label: '社会规则', hint: '如：财阀掌控秩序，地下情报交易盛行' },
  { key: 'artStyle', label: '美术风格', hint: '如：赛博朋克 × 新中式元素' },
  { key: 'colorSystem', label: '色彩系统', hint: '如：青橙对比，霓虹冷色主导' },
];
const STYLE_FIELDS: { key: keyof StyleBible; label: string; hint: string }[] = [
  { key: 'visualStyle', label: '视觉风格', hint: '如：电影感写实，轻微胶片颗粒' },
  { key: 'cameraLanguage', label: '镜头语言', hint: '如：手持跟拍 + 特写快切，情绪镜头缓推' },
  { key: 'colorPalette', label: '色彩体系', hint: '如：主色青蓝，点缀霓虹粉与暖橙' },
  { key: 'lighting', label: '光影风格', hint: '如：低调布光，霓虹轮廓光，夜戏为主' },
  { key: 'texture', label: '质感纹理', hint: '如：湿漉街面反射，金属与皮革质感' },
  { key: 'motionLanguage', label: '运动语言', hint: '如：快节奏剪切，关键瞬间升格慢动作' },
  { key: 'subtitleStyle', label: '字幕风格', hint: '如：底部居中白字黑边' },
];

type Kind = 'char' | 'loc';
interface EditDraft {
  name: string;
  desc: string;
  role: string;
  locked: boolean;
  identityDescriptor: string;
  wardrobe: string;
  voiceLock: string;
  signatureDetails: string;
  forbiddenChanges: string;
}
interface UploadTarget {
  kind: Kind | 'kit';
  id: string;
  view?: KitViewKey;
}

const notifyBibleChanged = () => window.dispatchEvent(new Event('yimu:bible-updated'));

const kitCellCount = (c: Character): number => {
  const kit = c.identityKit ?? emptyIdentityKit();
  return (kit.portraitUrl ? 1 : 0) + CHARACTER_VIEW_KEYS.filter((k) => !!kit.views?.[k]).length;
};

const ProjectBibleTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [worldView, setWorldView] = useState<WorldView>(EMPTY_WORLD);
  const [style, setStyle] = useState<StyleBible>(EMPTY_STYLE);
  const [chars, setChars] = useState<Character[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [propItems, setPropItems] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [genMenu, setGenMenu] = useState(false);
  const [collapsed, setCollapsed] = useState({ world: false, style: false });
  const [editing, setEditing] = useState<{ kind: Kind; id: string } | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ kind: Kind; id: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadTarget | null>(null);
  const genRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [wv, st, cs, ls, ps] = await Promise.all([
      bible.getWorldView(id).catch(() => null),
      bible.getStyleBible(id).catch(() => null),
      bible.listCharacters(id).catch(() => [] as Character[]),
      bible.listLocations(id).catch(() => [] as Location[]),
      bible.listProps(id).catch(() => [] as Prop[]),
    ]);
    setWorldView(wv ?? EMPTY_WORLD);
    setStyle(st ?? EMPTY_STYLE);
    setChars(cs ?? []);
    setLocs(ls ?? []);
    setPropItems(ps ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onUpdate = () => { void load(); };
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, [load]);

  // 点空白处收起「生成模式」菜单
  useEffect(() => {
    if (!genMenu) return;
    const close = (e: PointerEvent) => {
      if (!genRef.current?.contains(e.target as Node)) setGenMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [genMenu]);

  const worldFilled = WORLD_FIELDS.filter((f) => (worldView[f.key] ?? '').trim()).length;
  const styleFilled = STYLE_FIELDS.filter((f) => (style[f.key] ?? '').trim()).length;
  const charDefined = chars.filter(isCharacterFullyDefined).length;
  const locReady = locs.filter((l) => l.referenceImageUrls?.length > 0).length;
  const propReady = propItems.filter(isPropReady).length;
  /** 完成度按「人物 5 格 + 场景 1 格 + 道具 1 格」的资产格数计算，拼图不冒充四视图 */
  const refUnits = chars.length * 5 + locs.length + propItems.length;
  const refDone =
    chars.reduce((n, c) => n + kitCellCount(c), 0) + locReady + propReady;
  const completeness = useMemo(() => {
    const fields = (worldFilled + styleFilled) / (WORLD_FIELDS.length + STYLE_FIELDS.length);
    const refs = refUnits > 0 ? refDone / refUnits : 0;
    return Math.round((fields * 0.55 + refs * 0.45) * 100);
  }, [worldFilled, styleFilled, refUnits, refDone]);
  const isBlank = worldFilled + styleFilled === 0 && refUnits === 0;

  /* ---------------- 操作 ---------------- */
  const generate = async (mode: 'fill' | 'overwrite') => {
    if (!id || generating) return;
    setGenerating(true);
    setGenMenu(false);
    try {
      const res = await bible.generateBible(id, { mode });
      setWorldView(res.worldView);
      setStyle(res.styleBible);
      setChars(res.characters);
      setLocs(res.locations);
      setPropItems(res.props ?? []);
      setDirty(false);
      setNote(res.note ?? `已由模型生成：新增 ${res.counts.charactersCreated} 位人物、${res.counts.locationsCreated} 个场景、${res.counts.propsCreated ?? 0} 件道具`);
      notifyBibleChanged();
      toast.success(res.source === 'llm' ? '制作圣经已生成，可逐项修改' : '已生成可编辑草稿，请复核');
    } catch (e) {
      toast.error(`生成失败：${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const saveAll = async () => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await Promise.all([
        bible.updateWorldView(id, worldView),
        bible.updateStyleBible(id, style),
      ]);
      setDirty(false);
      toast.success('制作圣经已保存');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (kind: Kind, item: Character | Location) => {
    const kit = kind === 'char' ? (item as Character).identityKit ?? emptyIdentityKit() : null;
    setEditing({ kind, id: item.id });
    setConfirmDel(null);
    setDraft({
      name: item.name,
      desc: kind === 'char'
        ? (item as Character).canonicalDescription ?? ''
        : (item as Location).description ?? '',
      role: kind === 'char' ? (item as Character).roleType : (item as Location).locationType,
      locked: item.locked,
      identityDescriptor: kit?.identityDescriptor ?? '',
      wardrobe: kit?.wardrobe ?? '',
      voiceLock: kit?.voiceLock ?? '',
      signatureDetails: kit?.signatureDetails ?? '',
      forbiddenChanges: (item as Character).forbiddenChanges ?? '',
    });
  };

  const saveEdit = async () => {
    if (!id || !editing || !draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('名称不能为空'); return; }
    setBusyId(editing.id);
    try {
      if (editing.kind === 'char') {
        const cur = chars.find((c) => c.id === editing.id);
        const kit: CharacterIdentityKit = {
          ...(cur?.identityKit ?? emptyIdentityKit()),
          views: { ...(cur?.identityKit?.views ?? {}) },
          identityDescriptor: draft.identityDescriptor,
          wardrobe: draft.wardrobe,
          voiceLock: draft.voiceLock,
          signatureDetails: draft.signatureDetails,
          updatedAt: new Date().toISOString(),
        };
        const updated = await bible.updateCharacter(id, editing.id, {
          name, roleType: draft.role, canonicalDescription: draft.desc,
          forbiddenChanges: draft.forbiddenChanges, locked: draft.locked, identityKit: kit,
        });
        setChars((prev) => prev.map((c) => (c.id === editing.id ? updated : c)));
      } else {
        const updated = await bible.updateLocation(id, editing.id, {
          name, locationType: draft.role, description: draft.desc, locked: draft.locked,
        });
        setLocs((prev) => prev.map((l) => (l.id === editing.id ? updated : l)));
      }
      setEditing(null);
      setDraft(null);
      notifyBibleChanged();
      toast.success('设定已更新');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const addItem = async (kind: Kind) => {
    if (!id || !newName.trim()) return;
    setBusyId('new');
    try {
      if (kind === 'char') {
        const created = await bible.createCharacter(id, {
          name: newName.trim(), roleType: '配角', identityKit: emptyIdentityKit(),
        });
        setChars((prev) => [created, ...prev]);
      } else {
        const created = await bible.createLocation(id, { name: newName.trim(), locationType: '内景', timeOfDay: '日' });
        setLocs((prev) => [created, ...prev]);
      }
      setNewName('');
      setAdding(null);
      notifyBibleChanged();
      toast.success('已添加，记得补上形象包与标准描述');
    } catch (e) {
      toast.error(`添加失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async () => {
    if (!id || !confirmDel) return;
    setBusyId(confirmDel.id);
    try {
      if (confirmDel.kind === 'char') {
        await bible.deleteCharacter(id, confirmDel.id);
        setChars((prev) => prev.filter((c) => c.id !== confirmDel.id));
      } else {
        await bible.deleteLocation(id, confirmDel.id);
        setLocs((prev) => prev.filter((l) => l.id !== confirmDel.id));
      }
      setConfirmDel(null);
      notifyBibleChanged();
      toast.success('已删除');
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleLock = async (kind: Kind, item: Character | Location) => {
    if (!id) return;
    setBusyId(item.id);
    try {
      if (kind === 'char') {
        const updated = await bible.updateCharacter(id, item.id, { locked: !item.locked });
        setChars((prev) => prev.map((c) => (c.id === item.id ? updated : c)));
      } else {
        const updated = await bible.updateLocation(id, item.id, { locked: !item.locked });
        setLocs((prev) => prev.map((l) => (l.id === item.id ? updated : l)));
      }
      notifyBibleChanged();
      toast.success(item.locked ? '已解锁' : '已锁定，AI 生成将不再覆盖');
    } catch (e) {
      toast.error(`操作失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const pickUpload = (kind: Kind, itemId: string) => {
    uploadTarget.current = { kind, id: itemId };
    fileRef.current?.click();
  };

  const pickKitUpload = (charId: string, view: KitViewKey) => {
    uploadTarget.current = { kind: 'kit', id: charId, view };
    fileRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = uploadTarget.current;
    e.target.value = '';
    uploadTarget.current = null;
    if (!file || !target || !id) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    setBusyId(target.id);
    try {
      const { fileUrl } = await uploadLocalFile(id, file, file.name);
      if (target.kind === 'kit' && target.view) {
        const cur = chars.find((c) => c.id === target.id);
        if (!cur) return;
        const kit: CharacterIdentityKit = {
          ...(cur.identityKit ?? emptyIdentityKit()),
          views: { ...(cur.identityKit?.views ?? {}) },
          updatedAt: new Date().toISOString(),
        };
        if (target.view === 'portrait') kit.portraitUrl = fileUrl;
        else kit.views[target.view] = fileUrl;
        // 主图同步进旧参考图数组首位，保证首帧注入链路仍然生效
        const refs = kit.portraitUrl
          ? [kit.portraitUrl, ...(cur.referenceImageUrls ?? []).filter((u) => u !== kit.portraitUrl)].slice(0, 6)
          : cur.referenceImageUrls;
        const updated = await bible.updateCharacter(id, cur.id, {
          identityKit: kit, referenceImageUrls: refs,
        });
        setChars((prev) => prev.map((c) => (c.id === cur.id ? updated : c)));
        toast.success(target.view === 'portrait' ? '人物主图已绑定' : '视图已补齐');
      } else if (target.kind === 'char') {
        const cur = chars.find((c) => c.id === target.id);
        const urls = [fileUrl, ...(cur?.referenceImageUrls ?? [])].slice(0, 6);
        const updated = await bible.updateCharacter(id, target.id, { referenceImageUrls: urls });
        setChars((prev) => prev.map((c) => (c.id === target.id ? updated : c)));
        toast.success('形象参考图已绑定，建议同时补主图与四视图');
      } else {
        const cur = locs.find((l) => l.id === target.id);
        const urls = [fileUrl, ...(cur?.referenceImageUrls ?? [])].slice(0, 6);
        const updated = await bible.updateLocation(id, target.id, { referenceImageUrls: urls });
        setLocs((prev) => prev.map((l) => (l.id === target.id ? updated : l)));
        toast.success('场景参考图已绑定');
      }
      notifyBibleChanged();
    } catch (err) {
      toast.error(`上传失败：${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  /** 一键生成「主图 + 四视图」5 张独立形象图 */
  const generateKit = async (itemId: string) => {
    if (!id) return;
    setBusyId(itemId);
    try {
      const res = await bible.generateIdentityKit(id, itemId);
      toast.success(`形象包任务已提交（${res.jobIds.length} 张），完成后自动回写对应格`);
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  /** 旧链路：一张四视图拼图，作为快速定妆的兼容锚点（不冒充 4 张独立视图） */
  const generateRef = async (kind: Kind, itemId: string) => {
    if (!id) return;
    setBusyId(itemId);
    try {
      if (kind === 'char') await storyboard.generateCharacterSheet(id, itemId, {});
      else await bible.generateLocationImage(id, itemId);
      toast.success(kind === 'char' ? '四视图拼图任务已提交，完成后自动登记' : '场景概念图任务已提交，完成后自动回写');
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  /* ---------------- 渲染片段 ---------------- */
  const field = (
    f: { key: string; label: string; hint: string },
    value: string,
    onChange: (v: string) => void,
  ) => (
    <label className="bi-field" key={f.key}>
      <span className="bi-field-lb">
        {f.label}
        <i className={value.trim() ? 'on' : ''}>{value.trim() ? '已填' : '待补充'}</i>
      </span>
      <textarea value={value} rows={2} placeholder={f.hint} onChange={(ev) => onChange(ev.target.value)} />
    </label>
  );

  const sectionHead = (
    icon: React.ReactNode, title: string, sub: string, meta: string,
    collapsible: boolean, onToggle?: () => void, open?: boolean, action?: React.ReactNode,
  ) => (
    <div className="bi-sec-head">
      <span className="bi-sec-ico">{icon}</span>
      <div className="bi-sec-txt"><b>{title}</b><small>{sub}</small></div>
      <span className="bi-sec-meta">{meta}</span>
      {action}
      {collapsible ? (
        <button type="button" className={`bi-chev${open ? '' : ' shut'}`} onClick={onToggle} title={open ? '收起' : '展开'}>
          <ChevronDown size={14} />
        </button>
      ) : null}
    </div>
  );

  const editPanel = (kind: Kind) => {
    if (!draft) return null;
    const D = draft;
    const set = (patch: Partial<EditDraft>) => setDraft({ ...D, ...patch });
    return (
      <div className="bi-edit">
        <div className="bi-edit-row">
          <label>名称<input value={D.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>{kind === 'char' ? '角色定位' : '场景类型'}
            <select value={D.role} onChange={(e) => set({ role: e.target.value })}>
              {kind === 'char'
                ? ['主角', '配角', '群演'].map((v) => <option key={v} value={v}>{v}</option>)
                : ['内景', '外景'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="bi-edit-desc">
          {kind === 'char' ? '完整外貌锚点（跨镜一致性）' : '场景描述（概念图提示）'}
          <textarea rows={3} value={D.desc} onChange={(e) => set({ desc: e.target.value })} />
        </label>
        {kind === 'char' ? (
          <div className="bi-kit-fields">
            <span className="bi-kit-h">人物五道文本锁 · 逐字复用到每个镜头提示词</span>
            <label>身份锁 <small>脸型 / 肤色 / 体态 / 发型 / 稳定配色，不含摄影机动作</small>
              <textarea rows={2} value={D.identityDescriptor} onChange={(e) => set({ identityDescriptor: e.target.value })} />
            </label>
            <div className="bi-edit-row">
              <label>服装基线<input value={D.wardrobe} onChange={(e) => set({ wardrobe: e.target.value })} placeholder="款式 / 颜色 / 材质 / 鞋型" /></label>
              <label>声线锁<input value={D.voiceLock} onChange={(e) => set({ voiceLock: e.target.value })} placeholder="口音 / 音色 / 语速 / 受压变化" /></label>
            </div>
            <div className="bi-edit-row">
              <label>签名细节<input value={D.signatureDetails} onChange={(e) => set({ signatureDetails: e.target.value })} placeholder="至少两处，如银戒 / 眉骨疤" /></label>
              <label>禁改项<input value={D.forbiddenChanges} onChange={(e) => set({ forbiddenChanges: e.target.value })} /></label>
            </div>
          </div>
        ) : null}
        <div className="bi-edit-foot">
          <label className="bi-lock-chk">
            <input type="checkbox" checked={D.locked} onChange={(e) => set({ locked: e.target.checked })} />
            锁定设定（AI 生成不覆盖）
          </label>
          <button type="button" className="bi-btn ghost" onClick={() => { setEditing(null); setDraft(null); }}>取消</button>
          <button type="button" className="bi-btn primary" onClick={() => void saveEdit()} disabled={busyId === editing?.id}>
            {busyId === editing?.id ? <Loader2 size={12} className="spin" /> : <Check size={12} />} 保存
          </button>
        </div>
      </div>
    );
  };

  const addPanel = (kind: Kind) => (
    <div className="bi-add">
      <input autoFocus value={newName}
        placeholder={kind === 'char' ? '输入人物姓名，如：林晚' : '输入场景名称，如：旧城区天台'}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void addItem(kind); if (e.key === 'Escape') setAdding(null); }} />
      <button type="button" className="bi-btn primary" onClick={() => void addItem(kind)} disabled={!newName.trim() || busyId === 'new'}>创建</button>
      <button type="button" className="bi-btn ghost" onClick={() => { setAdding(null); setNewName(''); }}><X size={12} /></button>
    </div>
  );

  const cardActions = (kind: Kind, item: Character | Location) => (
    <div className="bi-card-acts">
      {kind === 'char' ? (
        <button type="button" className="pri" title="一次生成主图 + 四视图 5 张独立形象图" onClick={() => void generateKit(item.id)} disabled={busyId === item.id}>
          <Sparkles size={13} /> 形象包
        </button>
      ) : null}
      <button type="button" title={kind === 'char' ? '上传额外参考图' : '上传场景参考图'} onClick={() => pickUpload(kind, item.id)}><Upload size={13} /> 上传</button>
      <button type="button" title={kind === 'char' ? '快速生成一张四视图拼图（兼容旧链路）' : 'AI 生成场景概念图'} onClick={() => void generateRef(kind, item.id)} disabled={busyId === item.id}>
        <Wand2 size={13} /> {kind === 'char' ? '拼图' : '生成'}
      </button>
      <button type="button" title="编辑设定" onClick={() => startEdit(kind, item)}><Pencil size={13} /></button>
      <button type="button" title={item.locked ? '解锁设定' : '锁定设定'} onClick={() => void toggleLock(kind, item)}>
        {item.locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
      <button type="button" title="删除" onClick={() => setConfirmDel({ kind, id: item.id })}><Trash2 size={13} /></button>
    </div>
  );

  const confirmBar = (kind: Kind, itemId: string) => confirmDel?.kind === kind && confirmDel.id === itemId ? (
    <div className="bi-confirm">
      <span>确认删除这条设定？</span>
      <button type="button" onClick={() => setConfirmDel(null)}>取消</button>
      <button type="button" className="danger" onClick={() => void removeItem()} disabled={busyId === itemId}>删除</button>
    </div>
  ) : null;

  const renderCard = (kind: Kind, item: Character | Location) => {
    const refs = item.referenceImageUrls ?? [];
    const desc = kind === 'char'
      ? (item as Character).canonicalDescription : (item as Location).description;
    const tag = kind === 'char' ? (item as Character).roleType : (item as Location).locationType;
    const char = kind === 'char' ? (item as Character) : null;
    return (
      <article className={`bi-card${item.locked ? ' locked' : ''}`} key={item.id}>
        <button type="button" className="bi-card-thumb"
          title={refs[0] ? '点击放大参考图' : '尚未绑定参考图'}
          onClick={() => refs[0] ? setPreview({ url: refs[0], title: `${item.name} · 参考图` }) : pickUpload(kind, item.id)}>
          {refs[0] ? <img src={refs[0]} alt="" loading="lazy" /> : (
            <span className="bi-card-ph">{kind === 'char' ? <Users size={20} /> : <MapPin size={20} />}<small>点击上传</small></span>
          )}
          {busyId === item.id ? <span className="bi-card-busy"><Loader2 size={16} className="spin" /></span> : null}
          <i className={`bi-card-state${kind === 'char' ? (isCharacterFullyDefined(char!) ? ' ok' : '') : (refs.length ? ' ok' : '')}`}>
            {kind === 'char' ? (isCharacterFullyDefined(char!) ? '形象完整' : `${kitCellCount(char!)}/5`) : (refs.length ? '已绑定' : '未定妆')}
          </i>
        </button>
        <div className="bi-card-body">
          <div className="bi-card-title">
            <b title={item.name}>{item.name}</b><i>{tag}</i>
            {item.locked ? <Lock size={11} className="bi-lock" /> : null}
          </div>
          <p className="bi-card-desc">{desc || '尚未填写标准描述，点击编辑补充一致性锚点'}</p>
          {char ? (
            <CharacterKitStrip char={char}
              onPick={(view) => pickKitUpload(char.id, view)}
              onPreview={(url, title) => setPreview({ url, title })} />
          ) : null}
          {cardActions(kind, item)}
          {confirmBar(kind, item.id)}
        </div>
        {editing?.kind === kind && editing.id === item.id ? editPanel(kind) : null}
      </article>
    );
  };

  if (loading) {
    return <div className="bi-root"><div className="bi-loading"><Loader2 size={16} className="spin" /> 正在读取制作圣经…</div></div>;
  }

  const missingChars = chars.filter((c) => !isCharacterFullyDefined(c));
  const missingLocs = locs.filter((l) => !l.referenceImageUrls?.length);
  const missingProps = propItems.filter((p) => !isPropReady(p));
  const preflightOk = missingChars.length === 0 && missingLocs.length === 0 && missingProps.length === 0 && refUnits > 0;

  return (
    <div className="bi-root">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFilePicked(e)} />

      <header className="bi-hero">
        <div className="bi-hero-top">
          <span className="bi-hero-ico"><BookOpen size={16} /></span>
          <div className="bi-hero-txt"><h2>制作圣经</h2><p>世界观 · 视觉风格 · 人物 · 场景 · 道具</p></div>
          <button type="button" className="bi-icon-btn" title="重新读取" onClick={() => void load()}><RefreshCw size={14} /></button>
        </div>

        <div className="bi-progress">
          <div className="bi-progress-line"><span style={{ width: `${completeness}%` }} /></div>
          <div className="bi-progress-meta">
            <b className="num">{completeness}%</b> 完成度
            <span>设定 {worldFilled + styleFilled}/{WORLD_FIELDS.length + STYLE_FIELDS.length}</span>
            <span>人物 {charDefined}/{chars.length} 完整</span>
            <span>道具 {propReady}/{propItems.length}</span>
            <span>资产格 {refDone}/{refUnits}</span>
          </div>
        </div>

        <div className="bi-hero-acts">
          <div className="bi-gen" ref={genRef}>
            <button type="button" className="bi-btn primary lg" onClick={() => void generate('fill')} disabled={generating}>
              {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
              {generating ? '生成中…' : 'AI 一键生成'}
            </button>
            <button type="button" className="bi-btn primary lg arrow" onClick={() => setGenMenu((v) => !v)} title="生成选项" disabled={generating}><ChevronDown size={13} /></button>
            {genMenu ? (
              <div className="bi-gen-menu">
                <button type="button" onClick={() => void generate('fill')}><b>仅补空白</b><small>保留你已填写和锁定的内容</small></button>
                <button type="button" onClick={() => void generate('overwrite')}><b>重新生成</b><small>覆盖文本设定，参考图与锁定项保留</small></button>
              </div>
            ) : null}
          </div>
          <button type="button" className="bi-btn ghost lg" onClick={() => void saveAll()} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}{dirty ? '保存修改' : '已保存'}
          </button>
          <button type="button" className="bi-btn ghost lg" onClick={() => navigate(`/project/${id}/props`)}>道具页</button>
          <button type="button" className="bi-btn ghost lg" onClick={() => navigate(`/project/${id}/canvas-free3`)}>去自由画布</button>
        </div>
        {note ? <div className="bi-note"><ShieldCheck size={13} /><span>{note}</span><button type="button" onClick={() => setNote(null)}><X size={12} /></button></div> : null}
      </header>

      {/* 一致性预检：分镜生成后检查未登记/未定妆实体（参考无限画布的 preflight） */}
      <section className={`bi-preflight${preflightOk ? ' ok' : ''}`}>
        <span className="bi-preflight-ico"><ShieldCheck size={14} /></span>
        <div className="bi-preflight-txt">
          <b>{preflightOk ? '一致性预检通过' : '出首帧前还需补齐'}</b>
          <p>{preflightOk
            ? '人物主图 + 四视图、场景概念图、道具设定图均已就绪，分镜会按稳定编号注入参考图。'
            : [
                missingChars.length ? `${missingChars.length} 位人物缺主图/四视图` : '',
                missingLocs.length ? `${missingLocs.length} 个场景缺概念图` : '',
                missingProps.length ? `${missingProps.length} 件道具缺识别锚点或设定图` : '',
              ].filter(Boolean).join(' · ') || '请从剧本一键生成设定'}
          </p>
        </div>
        {missingProps.length ? (
          <button type="button" className="bi-btn ghost" onClick={() => navigate(`/project/${id}/props`)}>去补道具</button>
        ) : null}
      </section>

      {isBlank ? (
        <section className="bi-empty">
          <span className="bi-empty-ico"><Sparkles size={22} /></span>
          <b>这部作品还没有制作圣经</b>
          <p>从剧本自动提取人物、场景与道具，填好世界观、视觉风格和一致性描述；生成后每一条都能手动修改、锁定，人物可补齐主图与四视图。</p>
          <button type="button" className="bi-btn primary lg" onClick={() => void generate('fill')} disabled={generating}>
            {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} 生成完整设定
          </button>
        </section>
      ) : null}

      <section className="bi-sec">
        {sectionHead(<BookOpen size={15} />, '世界观', '时代 · 地理 · 社会规则 · 美术 · 色彩',
          `${worldFilled}/${WORLD_FIELDS.length}`, true,
          () => setCollapsed((p) => ({ ...p, world: !p.world })), !collapsed.world)}
        {!collapsed.world ? (
          <div className="bi-fields">
            {WORLD_FIELDS.map((f) => field(f, worldView[f.key] ?? '', (v) => {
              setWorldView((prev) => ({ ...prev, [f.key]: v } as WorldView)); setDirty(true);
            }))}
          </div>
        ) : null}
      </section>

      <section className="bi-sec">
        {sectionHead(<Wand2 size={15} />, '风格圣经', '视觉 · 镜头 · 色彩 · 光影 · 运动 · 字幕',
          `${styleFilled}/${STYLE_FIELDS.length}`, true,
          () => setCollapsed((p) => ({ ...p, style: !p.style })), !collapsed.style)}
        {!collapsed.style ? (
          <div className="bi-fields">
            {STYLE_FIELDS.map((f) => field(f, style[f.key] ?? '', (v) => {
              setStyle((prev) => ({ ...prev, [f.key]: v } as StyleBible)); setDirty(true);
            }))}
          </div>
        ) : null}
      </section>

      <section className="bi-sec">
        {sectionHead(<Users size={15} />, '人物 · 一致性锚点',
          '1 张主图 + 四视图，身份/服装/声线逐字复用',
          `${charDefined}/${chars.length} 完整`, false, undefined, true,
          <button type="button" className="bi-add-btn" onClick={() => { setAdding(adding === 'char' ? null : 'char'); setNewName(''); }}>
            <Plus size={12} /> 添加
          </button>)}
        {adding === 'char' ? addPanel('char') : null}
        {chars.length === 0 ? (
          <div className="bi-sec-empty">还没有人物设定。用「AI 一键生成」从剧本提取，或手动添加。</div>
        ) : (
          <div className="bi-cards">{chars.map((c) => renderCard('char', c))}</div>
        )}
      </section>

      <section className="bi-sec">
        {sectionHead(<MapPin size={15} />, '场景 · 空间基线', '概念图与场景描述保证同一场地跨镜不漂移',
          `${locReady}/${locs.length} 已定妆`, false, undefined, true,
          <button type="button" className="bi-add-btn" onClick={() => { setAdding(adding === 'loc' ? null : 'loc'); setNewName(''); }}>
            <Plus size={12} /> 添加
          </button>)}
        {adding === 'loc' ? addPanel('loc') : null}
        {locs.length === 0 ? (
          <div className="bi-sec-empty">还没有场景设定。用「AI 一键生成」从剧本场次提取，或手动添加。</div>
        ) : (
          <div className="bi-cards">{locs.map((l) => renderCard('loc', l))}</div>
        )}
      </section>

      {/* 道具：与右坞「道具」专页共用同一份数据实现 */}
      <section className="bi-sec bi-props-sec">
        {id ? <PropsPanel projectId={id} variant="embedded" /> : null}
      </section>

      <footer className="bi-foot">
        <Layers size={14} />
        <div>
          <b>一致性如何生效</b>
          <p>人物主图作为面部唯一真相、四视图锁轮廓与服装；道具按 @PROP 编号把形制与尺度注入分镜。生成首帧时这些不可变块与文本锁会和本镜动作一起送给模型；锁定后的设定不会被 AI 一键生成覆盖。</p>
        </div>
      </footer>

      {preview ? (
        <MediaPreviewDialog url={preview.url} kind="image" title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
};

export default ProjectBibleTab;
