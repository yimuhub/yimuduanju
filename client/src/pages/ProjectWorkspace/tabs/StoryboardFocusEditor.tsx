import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Save,
  RefreshCw,
  FileText,
  Loader2,
  ZoomIn,
  ImageOff,
  Layers,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Wand2,
} from 'lucide-react';
import type { Asset, Character, Scene, Shot, ShotTimeSegment } from '@shared/api.interface';
import { CAMERA_RIGS, movementLabel } from '@shared/camera-rigs';
import { blankTimeSegment, segmentsTotalSeconds, timeSegmentsOf } from '@shared/shot-time-segments';
// 提示词模板库（migration 0025）：从技能库/内置目录选片段插入光标位置
import { PromptTemplateButton } from '@client/src/components/PromptTemplateMenu';

/**
 * 分镜聚焦编辑器（全屏覆盖层）——精修检查器完全体：
 * 三区：左=镜头导航（缩略图小图+镜号），中=首帧大图+剧本原文并排核对，右=检查器
 * （画面提示词 / 字段级精修：镜头标题·动作描述·时长·运镜，全部 blur 即单字段
 * PATCH 保存，失败回滚+toast / forceNew 局部重跑 / 历史点选回填主图 /
 * 时间分段编辑：每段独立景别·时长·运镜·画面描述·@出场角色，可增删拖拽排序）。
 * 编辑逻辑全部回调 ProjectStoryboardTab 现有 handlers，行为零分叉。
 */
interface FocusEditorProps {
  shots: Shot[];
  scenes: Scene[];
  /** 项目角色表：时间分段「@出场角色」自动补全的数据源 */
  characters: Character[];
  initialShotId: string;
  promptDrafts: Record<string, string>;
  onPromptDraftChange: (shotId: string, value: string) => void;
  /** 保存提示词；rerun='image' 时保存并重跑首帧；opts.forceNew = 不复用旧产物（先清主图再重跑） */
  onSavePrompt: (shot: Shot, rerun?: 'image', opts?: { forceNew?: boolean }) => Promise<void> | void;
  savingPromptIds: Set<string>;
  /** 字段级 blur 保存：单字段 PATCH updateShot，失败回滚 + toast（实现在 Tab 侧） */
  onPatchField: (shot: Shot, patch: Partial<Shot>) => Promise<void>;
  patchingFields: Set<string>;
  /** 历史点选回填主图：确认交互 + updateShot 写回 startFrameUrl + toast（实现在 Tab 侧） */
  onSelectHistory: (shot: Shot, asset: Asset) => Promise<void>;
  selectingHistoryIds: Set<string>;
  historyMap: Record<string, Asset[]>;
  historyLoading: Set<string>;
  onClose: () => void;
}

const mediaUrl = (u?: string) =>
  u && u.startsWith('/uploads/') ? u : u?.startsWith('http') ? u : undefined;

/** 运镜下拉选项：相机 rig 预设（新取值）+ 当前存量值兜底（老取值共存，不丢数据） */
const movementOptions = (current: string | undefined): { value: string; label: string }[] => {
  const rigOpts = CAMERA_RIGS.map((r) => ({ value: r.movement, label: `${r.label} · ${r.movement}` }));
  if (current && !rigOpts.some((o) => o.value === current)) {
    rigOpts.unshift({ value: current, label: `${movementLabel(current)}（当前值）` });
  }
  return rigOpts;
};

type FieldKind = 'text' | 'textarea' | 'number' | 'select';

interface FieldSpec {
  key: string;
  label: string;
  hint: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
}

/** 机位角度：与 shared/shot-continuity.ts 的 ANGLE_BUCKET 同一套取值，存量未知值兜底 */
const CAMERA_ANGLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'eye_level', label: '平视 eye_level' },
  { value: 'front', label: '正面 front' },
  { value: 'three_quarter', label: '四分之三侧 three_quarter' },
  { value: 'side', label: '侧面 side' },
  { value: 'over_shoulder', label: '过肩 over_shoulder' },
  { value: 'back', label: '背面 back' },
  { value: 'high', label: '俯拍 high' },
  { value: 'low', label: '仰拍 low' },
  { value: 'pov', label: '主观 pov' },
];

/**
 * 检查器字段表（分组）——「非常详细的分镜头编辑」的落点。
 * 分三组：镜内容（写什么）/ 摄影（怎么拍）/ 节奏与约束（多长、不要什么）。
 * 全部字段都走 blur 单字段 PATCH（onPatchField），后端 UpdateShotDto 已全部接收。
 */
const FIELD_GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: '镜内容',
    fields: [
      { key: 'subject', label: '镜头标题（主体）', hint: '画面主体，一句话', kind: 'text' },
      { key: 'action', label: '动作描述', hint: '该镜发生了什么（可见的物理现象）', kind: 'textarea' },
      { key: 'dialogue', label: '台词', hint: '逐字对剧本；字幕与对白绑定以此为准', kind: 'textarea' },
      { key: 'emotion', label: '情绪基调', hint: '如：压抑 / 释然 / 警觉', kind: 'text' },
    ],
  },
  {
    title: '摄影',
    fields: [
      { key: 'shotSize', label: '景别', hint: '影响接缝校验与画面信息量', kind: 'select', options: [] },
      { key: 'cameraAngle', label: '机位角度', hint: '相邻镜角度差 <1 档会提示越轴', kind: 'select', options: [] },
      { key: 'lens', label: '镜头焦距', hint: '等效焦距，如 24mm / 50mm / 85mm', kind: 'text' },
      { key: 'movement', label: '运镜（机位预设）', hint: '视频提示词会拼入运镜事实', kind: 'select', options: [] },
    ],
  },
  {
    title: '节奏与约束',
    fields: [
      { key: 'duration', label: '时长（秒）', hint: '建议 3-15s；改这里会重排时间线', kind: 'number' },
      { key: 'negativePrompt', label: '负面提示（本镜）', hint: '只写本镜额外禁止项，底线负面词由系统统一加', kind: 'textarea' },
    ],
  },
];

const ALL_FIELDS: FieldSpec[] = FIELD_GROUPS.flatMap((g) => g.fields);

/* ================= 时间分段编辑器（migration 0025，对标 Pavo / huobao 分镜编辑） ================= */

const SEGMENT_SHOT_TYPES: { value: string; label: string }[] = [
  { value: 'extreme_close_up', label: '大特写' },
  { value: 'close_up', label: '特写' },
  { value: 'medium_close_up', label: '近景' },
  { value: 'medium_shot', label: '中景' },
  { value: 'medium_long_shot', label: '全景' },
  { value: 'long_shot', label: '远景' },
  { value: 'over_the_shoulder', label: '过肩' },
];

/** @出场角色：输入以 @ 开头时从 characters 表自动补全（选中即加 chip） */
const SegmentCharactersInput = ({
  characters,
  value,
  onChange,
}: {
  characters: Character[];
  value: string[];
  onChange: (next: string[]) => void;
}) => {
  const [query, setQuery] = useState('');
  const showAt = query.startsWith('@');
  const q = query.slice(1).trim().toLowerCase();
  const candidates = showAt
    ? characters
        .filter((c) => !value.includes(c.name))
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, 6)
    : [];
  const add = (name: string) => {
    if (!value.includes(name)) onChange([...value, name]);
    setQuery('');
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
          >
            @{name}
            <button
              onClick={() => onChange(value.filter((v) => v !== name))}
              className="ml-0.5 text-primary/70 hover:text-primary"
              aria-label={`移除 ${name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && candidates[0]) {
              e.preventDefault();
              add(candidates[0].name);
            }
            if (e.key === 'Backspace' && !query && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length === 0 ? '@角色（自动补全）' : '@再加'}
          className="min-w-[80px] flex-1 border-none bg-transparent p-0 text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {candidates.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => add(c.name)}
              className="block w-full px-2 py-1 text-left text-[11px] text-foreground hover:bg-muted"
            >
              @{c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** 单镜时间段落列表：每段独立景别/时长/运镜/描述/@角色，可增删、上下移与拖拽排序 */
const TimeSegmentEditor = ({
  shot,
  characters,
  scenes,
  onPatchField,
}: {
  shot: Shot;
  characters: Character[];
  scenes: Scene[];
  onPatchField: (shot: Shot, patch: Partial<Shot>) => Promise<void>;
}) => {
  const [segs, setSegs] = useState<ShotTimeSegment[]>(() => timeSegmentsOf(shot.metadata));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // 切镜时重置草稿为该镜当前分段
  useEffect(() => {
    setSegs(timeSegmentsOf(shot.metadata));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id]);

  const update = (i: number, patch: Partial<ShotTimeSegment>) => {
    setSegs((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setSegs((prev) => prev.filter((_, j) => j !== i));
    setDirty(true);
  };
  const add = () => {
    setSegs((prev) => [...prev, blankTimeSegment(prev.length + 1)]);
    setDirty(true);
  };
  const move = (from: number, to: number) => {
    setSegs((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
  };
  const drop = (to: number) => {
    if (dragIdx !== null) move(dragIdx, to);
    setDragIdx(null);
    setOverIdx(null);
  };

  const total = segmentsTotalSeconds(segs);
  const shotDur = Number(shot.duration) || 0;
  const mismatched = segs.length > 0 && Math.abs(total - shotDur) > 0.5;

  const commit = async () => {
    setSaving(true);
    try {
      await onPatchField(shot, {
        metadata: { ...(shot.metadata ?? {}), timeSegments: segs },
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Layers className="h-3.5 w-3.5 text-primary" /> 时间分段
          <span className="text-[10px] font-normal text-muted-foreground">
            生成时按段拼接提示词（景别/运镜/描述/@角色）
          </span>
        </span>
        <button
          onClick={add}
          className="inline-flex items-center gap-1 rounded-lg border border-input px-2 py-1 text-[10px] font-medium text-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-3 w-3" /> 加一段
        </button>
      </div>

      {segs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          未分段（单段模式）：生成时沿用整镜提示词。点「加一段」把镜头按 3-6s 拆成时间段落，
          每段可独立指定景别、运镜、画面与出场角色。
        </p>
      ) : (
        <div className="space-y-2">
          {segs.map((seg, i) => (
            <div
              key={seg.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
              onDrop={() => drop(i)}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              className={`rounded-xl border bg-background p-2.5 ${
                overIdx === i && dragIdx !== null && dragIdx !== i
                  ? 'border-primary ring-1 ring-primary/40'
                  : 'border-border'
              } ${dragIdx === i ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                  <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground/70" />
                  段 {i + 1}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    aria-label="上移"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => move(i, i + 1)}
                    disabled={i === segs.length - 1}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    aria-label="下移"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => remove(i)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                    aria-label="删除该段"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <select
                  value={seg.shotType ?? ''}
                  onChange={(e) => update(i, { shotType: e.target.value })}
                  className="rounded-lg border border-input bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary"
                  title="本段景别（空 = 沿用镜头级景别）"
                >
                  <option value="">景别（沿用整镜）</option>
                  {SEGMENT_SHOT_TYPES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={seg.movement ?? ''}
                  onChange={(e) => update(i, { movement: e.target.value })}
                  className="rounded-lg border border-input bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary"
                  title="本段运镜（空 = 沿用镜头级运镜）"
                >
                  <option value="">运镜（沿用整镜）</option>
                  {movementOptions(shot.movement).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2">
                <SegmentCharactersInput
                  characters={characters}
                  value={seg.characters}
                  onChange={(next) => update(i, { characters: next })}
                />
              </div>
              <textarea
                value={seg.description}
                onChange={(e) => update(i, { description: e.target.value })}
                rows={2}
                placeholder="这段时间画面发生什么（可见的物理现象）"
                className="mt-2 w-full resize-y rounded-lg border border-input bg-background p-2 text-[11px] leading-relaxed outline-none focus:border-primary"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <label className="shrink-0 text-[10px] text-muted-foreground">时长</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={seg.duration}
                  onChange={(e) => update(i, { duration: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-input bg-background px-1.5 py-1 text-[11px] tabular-nums outline-none focus:border-primary"
                />
                <span className="text-[10px] text-muted-foreground">秒</span>
                <select
                  value={seg.sceneRef ?? ''}
                  onChange={(e) => update(i, { sceneRef: e.target.value })}
                  className="ml-auto rounded-lg border border-input bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
                  title="场景引用（可选）"
                >
                  <option value="">场景（沿用）</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.title || `第${s.sceneNumber}场`}>
                      {s.title || `第${s.sceneNumber}场`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-2">
            <span className={`text-[10px] ${mismatched ? 'text-amber-500' : 'text-muted-foreground'}`}>
              共 {total}s / 镜头 {shotDur}s{mismatched ? ' · 分段总时长与镜头时长不一致（不影响生成，建议对齐）' : ''}
            </span>
            <button
              onClick={() => void commit()}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-gradient px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              保存分段
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const StoryboardFocusEditor = ({
  shots,
  scenes,
  characters,
  initialShotId,
  promptDrafts,
  onPromptDraftChange,
  onSavePrompt,
  savingPromptIds,
  onPatchField,
  patchingFields,
  onSelectHistory,
  selectingHistoryIds,
  historyMap,
  historyLoading,
  onClose,
}: FocusEditorProps) => {
  const [idx, setIdx] = useState(() => {
    const i = shots.findIndex((s) => s.id === initialShotId);
    return i >= 0 ? i : 0;
  });
  const [showScript, setShowScript] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // forceNew：勾选后「保存并重跑首帧」先清空旧主图再重跑（不复用旧产物），默认关
  const [forceNew, setForceNew] = useState(false);
  // 字段级精修草稿：切镜时重置为该镜当前值；blur 才落盘（单字段 PATCH）
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const taRef = useRef<HTMLTextAreaElement>(null);
  const shot = shots[idx];
  const shotId = shot?.id;
  const sceneName = useMemo(() => {
    const s = scenes.find((x) => x.id === shot?.sceneId);
    return s ? `第${s.sortOrder ?? ''}场 · ${(s as unknown as {name?:string}).name ?? ''}` : (shot?.sceneId ?? '');
  }, [shot, scenes]);
  const history = shot ? (historyMap[shot.id] ?? []) : [];
  const histLoading = shot ? historyLoading.has(shot.id) : false;
  const keyframe = mediaUrl(shot?.startFrameUrl);
  const saving = shot ? savingPromptIds.has(shot.id) : false;
  const patching = shot ? patchingFields.has(shot.id) : false;

  // 切镜 / shots 数据刷新时，把字段草稿对齐当前镜头值（草稿仅在聚焦期间生效）
  useEffect(() => {
    if (!shot) return;
    const next: Record<string, string> = {};
    for (const f of ALL_FIELDS) next[f.key] = String((shot as unknown as Record<string, unknown>)[f.key] ?? '');
    setFieldDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && !e.altKey) setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(shots.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, shots.length]);

  if (!shot) return null;
  const scriptBlock =
    (shot as unknown as { scriptText?: string }).scriptText ??
    (shot as unknown as { action?: string }).action ??
    '';
  const draft = promptDrafts[shot.id] ?? shot.visualPrompt ?? shot.action ?? '';

  /** 字段 blur 保存：值有变化才 PATCH；时长做数值校验，非法值静默还原 */
  const commitField = (key: string) => {
    const raw = fieldDrafts[key] ?? '';
    if (key === 'duration') {
      const n = Number(raw);
      if (!raw.trim() || !Number.isFinite(n) || n <= 0) {
        setFieldDrafts((p) => ({ ...p, duration: String(shot.duration ?? '') }));
        return;
      }
      if (n === shot.duration) return;
      void onPatchField(shot, { duration: n });
      return;
    }
    const current = String((shot as unknown as Record<string, unknown>)[key] ?? '');
    if (raw === current) return;
    void onPatchField(shot, { [key]: raw.trim() } as Partial<Shot>);
  };

  const fieldBusy = (key: string) =>
    patching && (fieldDrafts[key] ?? '') !== String((shot as unknown as Record<string, unknown>)[key] ?? '');

  /** 下拉项：景别 / 机位角度 / 运镜（运镜依赖当前值，需现算）；存量未知值兜底保留 */
  const optionsFor = (f: FieldSpec): { value: string; label: string }[] => {
    const current = fieldDrafts[f.key] ?? '';
    let base: { value: string; label: string }[];
    if (f.key === 'shotSize') base = SEGMENT_SHOT_TYPES;
    else if (f.key === 'cameraAngle') base = CAMERA_ANGLE_OPTIONS;
    else if (f.key === 'movement') return movementOptions(shot.movement);
    else base = f.options ?? [];
    if (current && !base.some((o) => o.value === current)) {
      return [{ value: current, label: `${current}（当前值）` }, ...base];
    }
    return base;
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">分镜 {idx + 1}</span>
          <span className="truncate text-sm font-semibold text-foreground">{shot.subject || shot.action?.slice(0, 30) || '未命名镜头'}</span>
          <span className="text-xs text-muted-foreground">{sceneName} · {shot.duration ?? 8}s · {movementLabel(shot.movement)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0} className="rounded-lg border border-input p-1.5 disabled:opacity-30" aria-label="上一镜"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-xs tabular-nums text-muted-foreground">{idx + 1}/{shots.length}</span>
          <button onClick={() => setIdx((i) => Math.min(shots.length - 1, i + 1))} disabled={idx >= shots.length - 1} className="rounded-lg border border-input p-1.5 disabled:opacity-30" aria-label="下一镜"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={onClose} className="ml-2 rounded-lg border border-input p-1.5 hover:bg-muted" aria-label="退出聚焦编辑"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：镜头导航条（缩略图小图 + 镜号 + 标题） */}
        <div className="hidden w-44 shrink-0 overflow-y-auto border-r border-border bg-card md:block">
          {shots.map((s, i) => {
            const thumb = mediaUrl(s.startFrameUrl);
            const active = i === idx;
            return (
              <button
                key={s.id}
                onClick={() => setIdx(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:bg-muted'}`}
              >
                <span className="w-5 shrink-0 tabular-nums opacity-60">{String(i + 1).padStart(2, '0')}</span>
                <span className="h-9 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center"><ImageOff className="h-3 w-3 text-muted-foreground/60" /></span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.subject || s.action?.slice(0, 14) || `镜${i + 1}`}</span>
              </button>
            );
          })}
        </div>

        {/* 中：首帧大图 + 剧本核对 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background p-5">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
              {keyframe ? (
                <img src={keyframe} alt={`镜${idx + 1} 首帧`} className="max-h-[60vh] w-full cursor-zoom-in object-contain" onClick={() => setLightboxUrl(keyframe)} />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">本镜暂无首帧 · 在右侧「保存并重跑首帧」生成</div>
              )}
            </div>
            {lightboxUrl && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-8" onClick={() => setLightboxUrl(null)}>
                <img src={lightboxUrl} alt="放大预览" className="max-h-full max-w-full rounded-xl" />
              </div>
            )}
            <button
              onClick={() => setShowScript((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <FileText className="h-3.5 w-3.5" /> {showScript ? '收起剧本对照' : '展开剧本对照'}
            </button>
            {showScript && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 text-xs font-semibold text-primary">分镜提示词（生成依据）</div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{shot.visualPrompt || shot.action || '（空）'}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">剧本原文（该场）</div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{scriptBlock || '（该镜头未关联剧本段落）'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右：检查器（提示词 + 字段精修 + 历史） */}
        <div className="hidden w-[400px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card lg:flex">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">镜头编辑</div>
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">画面提示词（生成依据）</label>
                {/* 提示词模板库：从技能库/内置目录选片段插入光标位置 */}
                <PromptTemplateButton
                  onInsert={(text) => {
                    const ta = taRef.current;
                    if (!ta) {
                      onPromptDraftChange(shot.id, `${draft}${text}`);
                      return;
                    }
                    const start = ta.selectionStart ?? draft.length;
                    const end = ta.selectionEnd ?? draft.length;
                    const next = draft.slice(0, start) + text + draft.slice(end);
                    onPromptDraftChange(shot.id, next);
                    requestAnimationFrame(() => {
                      ta.focus();
                      const pos = start + text.length;
                      ta.setSelectionRange(pos, pos);
                    });
                  }}
                />
              </div>
              <textarea
                ref={taRef}
                value={draft}
                onChange={(e) => onPromptDraftChange(shot.id, e.target.value)}
                rows={9}
                className="w-full resize-y rounded-xl border border-input bg-background p-3 text-xs leading-relaxed outline-none focus:border-primary"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  id="focus-force-new"
                  type="checkbox"
                  checked={forceNew}
                  onChange={(e) => setForceNew(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[hsl(2_85%_60%)]"
                />
                <label htmlFor="focus-force-new" className="cursor-pointer text-[11px] text-muted-foreground" title="勾选后重跑先清空旧主图再生成（不复用旧产物指纹），适合提示词大改后想要全新画面">
                  不复用旧产物（强制全新生成）
                </label>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void onSavePrompt(shot)}
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-input py-2 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
                </button>
                <button
                  onClick={() => void onSavePrompt(shot, 'image', { forceNew })}
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-gradient py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 保存并重跑首帧
                </button>
              </div>
            </div>

            {/* 字段级精修：blur 即单字段 PATCH（失败回滚 + toast 由 Tab 侧处理） */}
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">字段精修</span>
                <span className="text-[10px] text-muted-foreground/70">失焦自动保存</span>
              </div>
              {FIELD_GROUPS.map((group) => (
                <div key={group.title} className="space-y-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {group.title}
                  </div>
                  {group.fields.map((f) => (
                    <div key={f.key}>
                      <label htmlFor={`focus-f-${f.key}`} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        {f.label}
                        {fieldBusy(f.key) && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                      </label>
                      {f.kind === 'select' ? (
                        <select
                          id={`focus-f-${f.key}`}
                          value={fieldDrafts[f.key] ?? ''}
                          onChange={(e) => setFieldDrafts((p) => ({ ...p, [f.key]: e.target.value }))}
                          onBlur={() => commitField(f.key)}
                          className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                        >
                          {optionsFor(f).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : f.kind === 'textarea' ? (
                        <textarea
                          id={`focus-f-${f.key}`}
                          value={fieldDrafts[f.key] ?? ''}
                          onChange={(e) => setFieldDrafts((p) => ({ ...p, [f.key]: e.target.value }))}
                          onBlur={() => commitField(f.key)}
                          rows={f.key === 'action' ? 2 : 3}
                          className="w-full resize-y rounded-lg border border-input bg-background p-2 text-xs leading-relaxed outline-none focus:border-primary"
                        />
                      ) : (
                        <input
                          id={`focus-f-${f.key}`}
                          type={f.kind === 'number' ? 'number' : 'text'}
                          min={f.kind === 'number' ? 1 : undefined}
                          step={f.kind === 'number' ? 0.1 : undefined}
                          value={fieldDrafts[f.key] ?? ''}
                          onChange={(e) => setFieldDrafts((p) => ({ ...p, [f.key]: e.target.value }))}
                          onBlur={() => commitField(f.key)}
                          className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                        />
                      )}
                      <p className="mt-0.5 text-[10px] text-muted-foreground/60">{f.hint}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* 时间分段（migration 0025）：每段独立景别/时长/运镜/描述/@角色，生成时按段拼接 */}
            <TimeSegmentEditor shot={shot} characters={characters} scenes={scenes} onPatchField={onPatchField} />

            {/* 生成历史：点选回填主图（确认后写回 startFrameUrl），角标放大预览 */}
            <div className="border-t border-border pt-4">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">生成历史（点图设为主图）</div>
              {histLoading ? (
                <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无历史产物</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {history.map((a) => {
                    const u = mediaUrl(a.fileUrl);
                    const isCurrent = !!u && u === shot.startFrameUrl;
                    return (
                      <div key={a.id} className="group relative">
                        <button
                          onClick={() => u && a.assetType === 'image' && void onSelectHistory(shot, a)}
                          disabled={!u || a.assetType !== 'image' || selectingHistoryIds.has(a.id)}
                          title={a.assetType === 'image' ? '点击设为本镜主图' : '非图片产物不可设为主图'}
                          className={`block w-full overflow-hidden rounded-lg border bg-background ${isCurrent ? 'border-primary ring-1 ring-primary' : 'border-border'} disabled:cursor-not-allowed`}
                        >
                          {a.assetType === 'image' && u ? (
                            <img src={u} alt={a.name} loading="lazy" className="h-16 w-full object-cover" />
                          ) : (
                            <div className="flex h-16 items-center justify-center text-[10px] text-muted-foreground">{a.assetType === 'video' ? '成片' : a.assetType}</div>
                          )}
                        </button>
                        {u && (
                          <button
                            onClick={() => setLightboxUrl(u)}
                            title="放大预览"
                            className="absolute right-1 top-1 hidden rounded-md bg-black/60 p-1 text-white hover:bg-black/80 group-hover:block"
                          >
                            <ZoomIn className="h-3 w-3" />
                          </button>
                        )}
                        {isCurrent && (
                          <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[9px] font-semibold text-white">主图</span>
                        )}
                        {selectingHistoryIds.has(a.id) && (
                          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoryboardFocusEditor;
