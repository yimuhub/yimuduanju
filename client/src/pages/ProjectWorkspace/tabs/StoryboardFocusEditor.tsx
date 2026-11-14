import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Save, RefreshCw, FileText, Loader2, ZoomIn, ImageOff } from 'lucide-react';
import type { Asset, Scene, Shot } from '@shared/api.interface';
import { CAMERA_RIGS, movementLabel } from '@shared/camera-rigs';

/**
 * 分镜聚焦编辑器（全屏覆盖层）——精修检查器完全体：
 * 三区：左=镜头导航（缩略图小图+镜号），中=首帧大图+剧本原文并排核对，右=检查器
 * （画面提示词 / 字段级精修：镜头标题·动作描述·时长·运镜，全部 blur 即单字段
 * PATCH 保存，失败回滚+toast / forceNew 局部重跑 / 历史点选回填主图）。
 * 编辑逻辑全部回调 ProjectStoryboardTab 现有 handlers，行为零分叉。
 */
interface FocusEditorProps {
  shots: Shot[];
  scenes: Scene[];
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

type FieldKey = 'subject' | 'action' | 'duration' | 'movement';

const FIELD_META: { key: FieldKey; label: string; hint: string }[] = [
  { key: 'subject', label: '镜头标题（主体）', hint: '画面主体，一句话' },
  { key: 'action', label: '动作描述', hint: '该镜发生了什么' },
  { key: 'duration', label: '时长（秒）', hint: '建议 3-15s' },
  { key: 'movement', label: '运镜（机位预设）', hint: '视频提示词会拼入运镜事实' },
];

const StoryboardFocusEditor = ({
  shots,
  scenes,
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
  const [fieldDrafts, setFieldDrafts] = useState<Record<FieldKey, string>>({
    subject: '',
    action: '',
    duration: '',
    movement: '',
  });
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
    setFieldDrafts({
      subject: shot.subject ?? '',
      action: shot.action ?? '',
      duration: String(shot.duration ?? ''),
      movement: shot.movement ?? '',
    });
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
  const commitField = (key: FieldKey) => {
    const raw = fieldDrafts[key];
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
    const current = String(shot[key] ?? '');
    if (raw === current) return;
    void onPatchField(shot, { [key]: raw.trim() } as Partial<Shot>);
  };

  const fieldBusy = (key: FieldKey) => patching && fieldDrafts[key] !== String(shot[key] ?? '');

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
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">画面提示词（生成依据）</label>
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
              {FIELD_META.map(({ key, label, hint }) => (
                <div key={key}>
                  <label htmlFor={`focus-f-${key}`} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {label}
                    {fieldBusy(key) && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  </label>
                  {key === 'movement' ? (
                    <select
                      id={`focus-f-${key}`}
                      value={fieldDrafts.movement}
                      onChange={(e) => setFieldDrafts((p) => ({ ...p, movement: e.target.value }))}
                      onBlur={() => commitField('movement')}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                    >
                      {movementOptions(shot.movement).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : key === 'action' ? (
                    <textarea
                      id={`focus-f-${key}`}
                      value={fieldDrafts.action}
                      onChange={(e) => setFieldDrafts((p) => ({ ...p, action: e.target.value }))}
                      onBlur={() => commitField('action')}
                      rows={2}
                      className="w-full resize-y rounded-lg border border-input bg-background p-2 text-xs leading-relaxed outline-none focus:border-primary"
                    />
                  ) : (
                    <input
                      id={`focus-f-${key}`}
                      type={key === 'duration' ? 'number' : 'text'}
                      min={key === 'duration' ? 1 : undefined}
                      value={fieldDrafts[key]}
                      onChange={(e) => setFieldDrafts((p) => ({ ...p, [key]: e.target.value }))}
                      onBlur={() => commitField(key)}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
                    />
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground/60">{hint}</p>
                </div>
              ))}
            </div>

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
