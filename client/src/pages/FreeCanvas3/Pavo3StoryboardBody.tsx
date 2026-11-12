/**
 * Pavo 分镜节点卡 · 镜头正文（Pavo3Node 的 storyboard 分支）：
 *  - 参考图缩略行：上游连线节点（角色定妆/场景图）的产物图，兜底 shots.referenceImageUrls
 *  - 时间分段块：shot.beats（每段 = 时长 + 描述 + @角色标记）；无分段回落整段描述
 *  - 关键帧预览区：主图点击放大（Lightbox）+ 生成方式明示 + 可展开完整提示词
 *  - 底部操作：「生成图片」/「查看剧本」（剧本原文 ↔ 主图并排核对）
 *  - 历史记录条：该镜头历次首帧缩略图，点缩略图 ✅ 选定为主图（写回 shots + 节点）
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, ChevronDown, ChevronUp, Loader2, Maximize2, ScrollText, Sparkles } from 'lucide-react';
import { assets as assetsApi, projects as projectsApi, storyboard as storyboardApi } from '@client/src/api';
import type { Asset, Scene } from '@shared/api.interface';
import Lightbox from '@client/src/components/Lightbox';
import ShotScriptCompare from '@client/src/components/ShotScriptCompare';
import { useP3Store } from './pavo3Store';
import { P3 } from './pavo3Constants';
import type { PavoNodeData } from './pavo3Types';

/** 景别 → 中文（与工作台分镜页同口径） */
const SHOT_SIZE_LABELS: Record<string, string> = {
  close_up: '特写',
  close_up_shot: '特写',
  medium_close_up: '近景',
  medium_shot: '中景',
  medium_long_shot: '全景',
  long_shot: '远景',
  wide_shot: '全景',
  extreme_close_up: '大特写',
  over_the_shoulder: '过肩',
  wide: '全景',
  closeup: '特写',
};

/** 上游参考缩略（图 URL + 名称） */
interface RefThumb {
  url: string;
  title: string;
}

const Pavo3StoryboardBody = ({ id, data }: { id: string; data: PavoNodeData }) => {
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId === 'free' ? undefined : routeProjectId;
  const nodes = useP3Store((s) => s.nodes);
  const edges = useP3Store((s) => s.edges);
  const updateNodeData = useP3Store((s) => s.updateNodeData);
  const openDialog = useP3Store((s) => s.openDialog);

  const shot = data.shot;
  const shotId = shot?.id ?? (typeof data.backendShotId === 'string' ? data.backendShotId : undefined);
  const mainUrl = (data.mediaUrl as string | undefined) || shot?.startFrameUrl || undefined;

  /* ---- 参考图缩略行：上游可达节点里的图片产物（角色定妆/场景图），兜底物化参考图 ---- */
  const refThumbs = useMemo<RefThumb[]>(() => {
    const visited = new Set<string>();
    const queue = [id];
    const out: RefThumb[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.target !== cur) continue;
        const src = e.source;
        if (visited.has(src)) continue;
        visited.add(src);
        queue.push(src);
        const n = nodes.find((x) => x.id === src);
        if (!n) continue;
        const u = n.data.mediaUrl ?? n.data.directorShot;
        if (n.data.mediaKind === 'image' && typeof u === 'string' && u.length > 0) {
          out.push({ url: u, title: n.data.title });
        }
      }
    }
    if (out.length > 0) return out.slice(0, 5);
    return (shot?.referenceImageUrls ?? []).slice(0, 5).map((u, i) => ({ url: u, title: `物化参考图 ${i + 1}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, edges, nodes, shot?.referenceImageUrls?.join('|')]);

  /* ---- 历史记录：该镜头历次首帧（assets 版本链，version 倒序） ---- */
  const [history, setHistory] = useState<Asset[] | null>(null);
  useEffect(() => {
    if (!shotId) {
      setHistory(null);
      return;
    }
    let alive = true;
    assetsApi
      .listShotHistory(shotId, 'image')
      .then((list) => {
        if (alive) setHistory(list ?? []);
      })
      .catch(() => {
        if (alive) setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, [shotId, mainUrl]);

  /* ---- 弹层状态 ---- */
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptData, setScriptData] = useState<{ scriptText: string; scene: Scene | null } | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  /* ---- ✅ 选定主图：写回 shots.startFrameUrl + 节点 mediaUrl ---- */
  const adoptHistory = async (asset: Asset) => {
    if (!projectId || !shotId) return;
    const url = asset.fileUrl || asset.filePath || '';
    if (!url) {
      toast.error('该版本没有可用图片');
      return;
    }
    if (url === mainUrl) {
      setLightbox({ url, title: `分镜 ${shot?.shotNumber ?? ''} 主图` });
      return;
    }
    setAdoptingId(asset.id);
    try {
      await assetsApi.revertShotAsset(shotId, asset.id, 'image');
      updateNodeData(id, {
        mediaUrl: url,
        mediaKind: 'image',
        status: 'done',
        progress: 100,
        errorMessage: undefined,
        shot: shot ? { ...shot, startFrameUrl: url } : undefined,
      });
      toast.success(`已选定 v${asset.version ?? 1} 为主图`);
    } catch (e) {
      toast.error(`选定失败：${(e as Error).message}`);
    } finally {
      setAdoptingId(null);
    }
  };

  /* ---- 生成图片：建首帧任务，SSE 自动回填预览 ---- */
  const generateFrame = async () => {
    if (!projectId || !shotId || generating) return;
    setGenerating(true);
    updateNodeData(id, { status: 'running', progress: 6, errorMessage: undefined });
    try {
      await storyboardApi.rerunShot(projectId, shotId, { type: 'image' });
      toast.success('已发起首帧生成，完成后自动回填预览');
    } catch (e) {
      updateNodeData(id, { status: 'error', progress: 0, errorMessage: (e as Error).message });
      toast.error(`生成发起失败：${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  /* ---- 查看剧本：取项目剧本 + 本镜所属场景 → 并排核对 ---- */
  const openScriptCheck = async () => {
    setScriptOpen(true);
    if (scriptData || !projectId) return;
    try {
      const [proj, scenes] = await Promise.all([
        projectsApi.getProject(projectId),
        storyboardApi.listScenes(projectId).catch(() => [] as Scene[]),
      ]);
      const scene = shot?.sceneId ? (scenes.find((sc) => sc.id === shot.sceneId) ?? null) : null;
      setScriptData({ scriptText: proj.scriptText ?? '', scene });
    } catch {
      setScriptData({ scriptText: '', scene: null });
    }
  };

  const beats = shot?.beats ?? [];
  const castNames = data.castNames ?? [];
  const sizeLabel = SHOT_SIZE_LABELS[shot?.shotSize ?? ''] || shot?.shotSize || '中景';
  const durationText = shot?.duration ? `${Math.round(Number(shot.duration))}s` : '';
  const methodLabel = refThumbs.length > 0 ? `参考图生（${refThumbs.length} 张参考）` : '文生图';
  const promptText = (data.gen?.prompt as string | undefined) || shot?.visualPrompt || '';

  /** 文本里出现的角色名渲染成 @角色 chip（Pavo 分镜卡的时间分段标记） */
  const castChips = (text: string): string[] =>
    castNames.filter((n) => n && (text ?? '').includes(n));

  return (
    <div>
      {/* 元信息行：景别 · 时长 · 场景 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: P3.text, background: P3.hover, borderRadius: 6, padding: '2px 7px' }}>
          {sizeLabel}
        </span>
        {durationText && (
          <span style={{ fontSize: 10.5, color: P3.helper, background: P3.hover, borderRadius: 6, padding: '2px 7px' }}>
            {durationText}
          </span>
        )}
        {data.sceneName && (
          <span title={`所属场景：${data.sceneName}`} style={{ fontSize: 10.5, color: P3.helper, background: P3.hover, borderRadius: 6, padding: '2px 7px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.sceneName}
          </span>
        )}
        {data.status === 'done' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: P3.green, fontWeight: 600 }}>主图就绪</span>
        )}
      </div>

      {/* 参考图缩略行（引用的角色/场景资产图） */}
      {refThumbs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, color: P3.faint, marginBottom: 3 }}>参考图（{refThumbs.length}）</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {refThumbs.map((t, i) => (
              <button
                key={`${t.url}-${i}`}
                title={`${t.title}（生成时自动注入）`}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox({ url: t.url, title: t.title });
                }}
                style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: `1px solid ${P3.border}`, padding: 0, cursor: 'zoom-in', background: P3.hover, flexShrink: 0 }}
              >
                <img src={t.url} alt={t.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 时间分段块（3 秒节拍；无分段回落整段描述） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {beats.length > 0 ? (
          beats.map((b, i) => {
            const chips = castChips(`${b.description ?? ''} ${b.dialogue ?? ''}`);
            return (
              <div
                key={`${b.from}-${i}`}
                style={{ border: `1px solid ${P3.border}`, borderRadius: 10, padding: '6px 8px', background: '#FAFAFA' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#5B8DEF', background: 'rgba(91,141,239,0.12)', borderRadius: 999, padding: '1px 7px' }}>
                    {b.from}s-{b.to}s
                  </span>
                  <span style={{ fontSize: 10, color: P3.faint }}>{sizeLabel}</span>
                  {chips.length > 0 && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                      {chips.slice(0, 3).map((n) => (
                        <span key={n} style={{ fontSize: 10, fontWeight: 600, color: '#E85D75', background: 'rgba(232,93,117,0.1)', borderRadius: 999, padding: '1px 6px' }}>
                          @{n}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: P3.text, wordBreak: 'break-word' }}>
                  {b.description || '（无描述）'}
                </div>
                {b.dialogue ? (
                  <div style={{ fontSize: 11, color: P3.helper, marginTop: 2, wordBreak: 'break-word' }}>台词：{b.dialogue}</div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div style={{ border: `1px dashed ${P3.border}`, borderRadius: 10, padding: '6px 8px', background: '#FAFAFA' }}>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: P3.text, wordBreak: 'break-word' }}>
              {shot?.visualPrompt || data.markdown || '暂无画面描述（可双击编辑属性补充）'}
            </div>
            {(shot?.dialogue || castNames.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3, alignItems: 'center' }}>
                {shot?.dialogue && <span style={{ fontSize: 11, color: P3.helper }}>台词：{shot.dialogue}</span>}
                {castNames.slice(0, 3).map((n) => (
                  <span key={n} style={{ fontSize: 10, fontWeight: 600, color: '#E85D75', background: 'rgba(232,93,117,0.1)', borderRadius: 999, padding: '1px 6px' }}>
                    @{n}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 关键帧预览区 */}
      <div style={{ border: `1px solid ${P3.border}`, borderRadius: 12, padding: 8, background: '#FCFCFC' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: P3.helper }}>关键帧预览</span>
          <span style={{ fontSize: 10, color: P3.primary, background: 'rgba(10,188,207,0.1)', borderRadius: 999, padding: '1px 7px' }}>
            {methodLabel}
          </span>
        </div>
        {mainUrl ? (
          <button
            className="nodrag"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox({ url: mainUrl, title: `分镜 ${shot?.shotNumber ?? ''} 主图` });
            }}
            title="点击放大查看"
            style={{ width: '100%', borderRadius: 9, overflow: 'hidden', border: 'none', padding: 0, cursor: 'zoom-in', position: 'relative', display: 'block', background: '#000' }}
          >
            <img src={mainUrl} alt={`分镜 ${shot?.shotNumber ?? ''} 主图`} style={{ width: '100%', display: 'block' }} draggable={false} />
            <span
              style={{ position: 'absolute', right: 6, bottom: 6, width: 22, height: 22, borderRadius: 7, background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Maximize2 size={11} />
            </span>
          </button>
        ) : (
          <div style={{ height: 84, borderRadius: 9, background: P3.hover, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P3.faint, fontSize: 12 }}>
            {data.status === 'running' ? '首帧生成中…' : '还没有主图，点击下方按钮生成'}
          </div>
        )}

        {/* 生成方式明示 + 完整提示词（可展开） */}
        {promptText && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPromptOpen((v) => !v);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, color: P3.helper, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {promptOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              生成方式：{methodLabel} · 完整提示词
            </button>
            {promptOpen && (
              <div
                style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.55, color: P3.helper, background: '#F7F7F7', borderRadius: 8, padding: '6px 8px', maxHeight: 120, overflow: 'auto', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                onClick={(e) => e.stopPropagation()}
              >
                {promptText}
              </div>
            )}
          </div>
        )}

        {/* 底部操作 */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            className="nodrag"
            disabled={generating || data.status === 'running' || !shotId || !projectId}
            onClick={(e) => {
              e.stopPropagation();
              void generateFrame();
            }}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 9, border: 'none', background: generating || data.status === 'running' ? P3.hover : P3.primary, color: generating || data.status === 'running' ? P3.faint : '#fff', fontSize: 12.5, fontWeight: 600, cursor: generating ? 'wait' : 'pointer' }}
          >
            {generating || data.status === 'running' ? <Loader2 size={13} className="p3-spin" /> : <Sparkles size={13} />}
            生成图片
          </button>
          <button
            className="nodrag"
            onClick={(e) => {
              e.stopPropagation();
              void openScriptCheck();
            }}
            title="剧本原文 ↔ 分镜主图并排核对"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 10px', borderRadius: 9, border: `1px solid ${P3.border}`, background: '#fff', color: P3.text, fontSize: 12, cursor: 'pointer' }}
          >
            <ScrollText size={12} />
            查看剧本
          </button>
        </div>

        {/* 历史记录条：历次生成结果缩略图，点缩略图 ✅ 选定为主图 */}
        {shotId && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10.5, color: P3.faint, marginBottom: 3 }}>
              历史记录{history ? `（${history.length}）` : '…'}
            </div>
            <div style={{ display: 'flex', gap: 4, minHeight: 40 }}>
              {!history ? (
                <span style={{ fontSize: 10.5, color: P3.faint }}>加载中…</span>
              ) : history.length === 0 ? (
                <span style={{ fontSize: 10.5, color: P3.faint }}>暂无历史（每次重生成自动保留旧版）</span>
              ) : (
                history.slice(0, 8).map((a) => {
                  const url = a.fileUrl || '';
                  const isMain = Boolean(url && mainUrl && url === mainUrl);
                  return (
                    <button
                      key={a.id}
                      className="nodrag"
                      title={isMain ? '当前主图（点击放大）' : `v${a.version ?? 1} · 点击选定为主图`}
                      disabled={adoptingId === a.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void adoptHistory(a);
                      }}
                      style={{ position: 'relative', width: 40, height: 40, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer', flexShrink: 0, border: isMain ? `2px solid ${P3.green}` : `1px solid ${P3.border}`, opacity: adoptingId === a.id ? 0.6 : 1 }}
                    >
                      {url ? (
                        <img src={url} alt={`v${a.version ?? 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <span style={{ fontSize: 9, color: P3.faint }}>无图</span>
                      )}
                      {isMain && (
                        <span style={{ position: 'absolute', top: 1, right: 1, width: 13, height: 13, borderRadius: 999, background: P3.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={9} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 编辑入口（空态提示） */}
      {!shotId && (
        <button
          className="p3-try-btn nodrag"
          onClick={(e) => {
            e.stopPropagation();
            openDialog(id, 'storyboard');
          }}
        >
          编辑分镜属性
        </button>
      )}

      {/* Lightbox（主图 / 参考图 / 历史版本放大） */}
      {lightbox && (
        <Lightbox url={lightbox.url} kind="image" title={lightbox.title} caption={methodLabel + (promptText ? ` · ${promptText.slice(0, 80)}${promptText.length > 80 ? '…' : ''}` : '')} onClose={() => setLightbox(null)} />
      )}

      {/* 剧本核对弹窗（玻璃拟态，Pavo 弹层语言） */}
      {scriptOpen && (
        <div
          className="p3-dialog-mask"
          onMouseDown={() => setScriptOpen(false)}
        >
          <div
            className="p3-dialog"
            style={{ width: 'min(880px, calc(100vw - 80px))', padding: 20 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>
                剧本核对 · 分镜 {shot?.shotNumber ?? ''}
              </div>
              <button
                onClick={() => setScriptOpen(false)}
                style={{ border: 'none', background: P3.hover, borderRadius: 8, padding: '4px 12px', fontSize: 12, color: P3.text, cursor: 'pointer' }}
              >
                关闭
              </button>
            </div>
            <ShotScriptCompare
              scriptText={scriptData?.scriptText}
              scene={scriptData?.scene ?? null}
              shotNumber={shot?.shotNumber ?? 0}
              shotDialogue={shot?.dialogue}
              shotVisualPrompt={shot?.visualPrompt}
              imageUrl={mainUrl}
              shotSizeLabel={sizeLabel}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Pavo3StoryboardBody;
