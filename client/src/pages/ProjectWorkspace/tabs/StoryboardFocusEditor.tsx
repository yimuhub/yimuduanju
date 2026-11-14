import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Save, RefreshCw, FileText, Loader2 } from 'lucide-react';
import type { Asset, Scene, Shot } from '@shared/api.interface';

/**
 * 分镜聚焦编辑器（全屏覆盖层）——解决右栏/卡片内编辑空间太小的问题。
 * 三区：左=镜头导航（可切镜），中=首帧大图+剧本原文并排核对，右=提示词编辑
 * （保存/保存并重跑首帧）+ 历史记录。所有编辑逻辑复用 ProjectStoryboardTab
 * 现有 handlers，行为零分叉。
 */
interface FocusEditorProps {
  shots: Shot[];
  scenes: Scene[];
  initialShotId: string;
  promptDraft: string;
  onPromptDraftChange: (shotId: string, value: string) => void;
  onSavePrompt: (shot: Shot, rerun?: 'image') => Promise<void> | void;
  savingPromptIds: Set<string>;
  historyMap: Record<string, Asset[]>;
  historyLoading: Set<string>;
  onClose: () => void;
}

const mediaUrl = (u?: string) =>
  u && u.startsWith('/uploads/') ? u : u?.startsWith('http') ? u : undefined;

const StoryboardFocusEditor = ({
  shots,
  scenes,
  initialShotId,
  promptDraft,
  onPromptDraftChange,
  onSavePrompt,
  savingPromptIds,
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const shot = shots[idx];
  const sceneName = useMemo(() => {
    const s = scenes.find((x) => x.id === shot?.sceneId);
    return s ? `第${s.sortOrder ?? ''}场 · ${(s as unknown as {name?:string}).name ?? ''}` : (shot?.sceneId ?? '');
  }, [shot, scenes]);
  const history = shot ? (historyMap[shot.id] ?? []) : [];
  const histLoading = shot ? historyLoading.has(shot.id) : false;
  const keyframe = mediaUrl(shot?.startFrameUrl);
  const saving = shot ? savingPromptIds.has(shot.id) : false;

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
  const draft = promptDraft ?? (shot.visualPrompt ?? shot.action ?? '');

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">分镜 {idx + 1}</span>
          <span className="truncate text-sm font-semibold text-foreground">{shot.action?.slice(0, 30) || '未命名镜头'}</span>
          <span className="text-xs text-muted-foreground">{sceneName} · {shot.duration ?? 8}s · {shot.movement ?? '固定'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0} className="rounded-lg border border-input p-1.5 disabled:opacity-30" aria-label="上一镜"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-xs tabular-nums text-muted-foreground">{idx + 1}/{shots.length}</span>
          <button onClick={() => setIdx((i) => Math.min(shots.length - 1, i + 1))} disabled={idx >= shots.length - 1} className="rounded-lg border border-input p-1.5 disabled:opacity-30" aria-label="下一镜"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={onClose} className="ml-2 rounded-lg border border-input p-1.5 hover:bg-muted" aria-label="退出聚焦编辑"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：镜头导航条 */}
        <div className="hidden w-40 shrink-0 overflow-y-auto border-r border-border bg-card md:block">
          {shots.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIdx(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${i === idx ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:bg-muted'}`}
            >
              <span className="tabular-nums opacity-60">{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate">{s.action?.slice(0, 14) || `镜${i + 1}`}</span>
            </button>
          ))}
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

        {/* 右：提示词编辑 + 历史 */}
        <div className="hidden w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card lg:flex">
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
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void onSavePrompt(shot)}
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-input py-2 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
                </button>
                <button
                  onClick={() => void onSavePrompt(shot, 'image')}
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-gradient py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 保存并重跑首帧
                </button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">生成历史（点图选定主图）</div>
              {histLoading ? (
                <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无历史产物</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {history.map((a) => {
                    const u = mediaUrl(a.fileUrl);
                    return (
                      <button key={a.id} onClick={() => u && setLightboxUrl(u)} className="overflow-hidden rounded-lg border border-border bg-background">
                        {a.assetType === 'image' && u ? <img src={u} alt={a.name} className="h-16 w-full object-cover" /> : <div className="flex h-16 items-center justify-center text-[10px] text-muted-foreground">{a.assetType}</div>}
                      </button>
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
