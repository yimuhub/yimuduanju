/**
 * 自由画布 · 成片合成面板
 * 把画布上的视频节点按用户排序在服务端 ffmpeg 拼接为一条可交付 MP4，
 * 可选配音/ BGM / 画幅，并可登记为项目资产（项目工作台资产页可见）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clapperboard, Combine, Download, Film, Loader2, Music, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { useP3Store } from './pavo3Store';
import { P3 } from './pavo3Constants';
import type { PavoFlowNode } from './pavo3Types';
import { composeCanvas, type CanvasComposeResult } from '@client/src/api/pavo3';
import { downloadDeliverable } from '@client/src/api/export';

const RATIO_OPTIONS = [
  { value: '9:16', label: '竖屏 9:16' },
  { value: '16:9', label: '横屏 16:9' },
  { value: '1:1', label: '方形 1:1' },
  { value: '4:5', label: '社媒 4:5' },
  { value: '3:4', label: '竖版 3:4' },
  { value: '21:9', label: '宽银幕 21:9' },
];

const isPlayableVideo = (n: PavoFlowNode) =>
  n.data.mediaKind === 'video' &&
  n.data.nodeType !== 'composite' &&
  typeof n.data.mediaUrl === 'string' &&
  n.data.mediaUrl.length > 0;

const isAudio = (n: PavoFlowNode) =>
  n.data.mediaKind === 'audio' && typeof n.data.mediaUrl === 'string' && n.data.mediaUrl.length > 0;

/** 从标题 / 生成面板里读时长（秒），用于合成前预估 */
function clipSeconds(n: PavoFlowNode): number {
  const fromPanel = Number(String(n.data.gen?.duration ?? '').replace(/s$/i, ''));
  if (Number.isFinite(fromPanel) && fromPanel > 0) return fromPanel;
  const m = n.data.title.match(/(\d+(?:\.\d+)?)\s*s/i);
  return m ? Number(m[1]) : 0;
}

function errorText(e: unknown): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = err?.response?.data?.message;
  if (Array.isArray(m)) return m.join('；');
  return m || err?.message || '合成失败，请稍后重试';
}

export function ComposePanel({ nodeId }: { nodeId: string }) {
  const nodes = useP3Store((s) => s.nodes);
  const edges = useP3Store((s) => s.edges);
  const projectName = useP3Store((s) => s.projectName);
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId === 'free' ? undefined : routeProjectId;

  const videoNodes = useMemo(() => nodes.filter(isPlayableVideo), [nodes]);
  const videoMap = useMemo(() => new Map(videoNodes.map((n) => [n.id, n])), [videoNodes]);
  const audioNodes = useMemo(() => nodes.filter(isAudio), [nodes]);
  const signature = videoNodes.map((n) => n.id).join('|');

  const [order, setOrder] = useState<string[]>(() => {
    const st = useP3Store.getState();
    const upstreamIds = st
      .getUpstreamRefs(nodeId)
      .filter(isPlayableVideo)
      .map((n) => n.id);
    const rest = st.nodes
      .filter(isPlayableVideo)
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id);
    return [...new Set([...upstreamIds, ...rest])];
  });

  // 节点增删后同步片段清单（保留用户已排顺序，不覆盖手动移除）
  useEffect(() => {
    setOrder((prev) => {
      const alive = prev.filter((id) => videoMap.has(id));
      const added = videoNodes.map((n) => n.id).filter((id) => !alive.includes(id));
      return [...alive, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const [ratio, setRatio] = useState<string>(() => {
    const first = useP3Store.getState().nodes.find(isPlayableVideo);
    return (first?.data.gen?.ratio as string) || '9:16';
  });
  const [title, setTitle] = useState(() => `${projectName} · 成片`);
  const [bgmId, setBgmId] = useState<string>('');
  const [registerAsset, setRegisterAsset] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [result, setResult] = useState<CanvasComposeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clips = order.map((id) => videoMap.get(id)).filter((n): n is PavoFlowNode => Boolean(n));
  const estimateSeconds = clips.reduce((sum, n) => sum + clipSeconds(n), 0);
  const usedVoiceNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of clips) {
      for (const e of edges) {
        if (e.target !== n.id) continue;
        const src = nodes.find((x) => x.id === e.source);
        if (src && isAudio(src)) ids.add(src.id);
      }
    }
    return ids;
  }, [clips, edges, nodes]);
  const bgmChoices = audioNodes.filter((n) => !usedVoiceNodeIds.has(n.id));

  const move = (index: number, delta: number) => {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const voiceFor = (node: PavoFlowNode): string | undefined => {
    for (const e of edges) {
      if (e.target !== node.id) continue;
      const src = nodes.find((x) => x.id === e.source);
      if (src && isAudio(src)) return src.data.mediaUrl as string;
    }
    return undefined;
  };

  const submit = async () => {
    if (clips.length === 0 || phase === 'running') return;
    setPhase('running');
    setError(null);
    try {
      const res = await composeCanvas({
        projectId,
        clips: clips.map((n) => ({
          url: n.data.mediaUrl as string,
          voiceUrl: voiceFor(n),
          duration: clipSeconds(n) || undefined,
          label: n.data.title,
        })),
        bgmUrl: bgmId ? (audioNodes.find((n) => n.id === bgmId)?.data.mediaUrl as string) : undefined,
        aspectRatio: ratio,
        title: title.trim() || `${projectName} · 成片`,
        registerAsset: Boolean(projectId) && registerAsset,
      });
      setResult(res);
      useP3Store.getState().updateNodeData(nodeId, {
        title: `成片 · ${title.trim() || projectName}`.slice(0, 80),
        status: 'done',
        progress: 100,
        mediaUrl: res.fileUrl,
        mediaKind: 'video',
        markdown: undefined,
        errorMessage: undefined,
        composeMeta: {
          clips: res.clips,
          durationSeconds: res.durationSeconds,
          width: res.width,
          height: res.height,
          engine: 'ffmpeg',
          bgm: Boolean(bgmId),
        },
      });
      setPhase('done');
      toast.success(`成片已合成：${res.clips} 段 · ${res.durationSeconds}s`);
    } catch (e) {
      setError(errorText(e));
      setPhase('idle');
      toast.error('合成失败', { description: errorText(e) });
    }
  };

  const download = async () => {
    if (!result) return;
    try {
      await downloadDeliverable(result.fileUrl);
    } catch (e) {
      toast.error('下载失败', { description: errorText(e) });
    }
  };

  return (
    <div className="p3-model-dialog" style={{ position: 'relative', width: 'min(760px, calc(100vw - 80px))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span
          style={{
            width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(10,188,207,0.1)', color: P3.primary,
          }}
        >
          <Combine size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: P3.text }}>合成可交付成片</div>
          <div style={{ fontSize: 12, color: P3.helper, marginTop: 2 }}>
            按下方顺序拼接画布视频（服务端 ffmpeg，不消耗模型额度）
          </div>
        </div>
        <button
          className="p3-icon-btn"
          title="关闭"
          onClick={() => useP3Store.getState().closeDialog()}
        >
          <X size={16} />
        </button>
      </div>

      {phase === 'done' && result ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <video
              src={result.fileUrl}
              controls
              playsInline
              style={{ width: 210, borderRadius: 12, background: '#000', flexShrink: 0, maxHeight: 374 }}
            />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>
                {title.trim() || projectName}
              </div>
              <div style={{ fontSize: 12.5, color: P3.helper, marginTop: 8, lineHeight: 1.9 }}>
                <div>{result.clips} 段 · {result.durationSeconds}s · {result.width}×{result.height}</div>
                <div>合成引擎：ffmpeg（本地拼接，未调用模型）</div>
                <div>文件大小：{(result.size / 1024 / 1024).toFixed(1)} MB</div>
                {projectId && registerAsset && <div style={{ color: P3.green }}>已登记到项目资产</div>}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={download}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10,
                    background: P3.primary, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  <Download size={15} /> 下载 MP4
                </button>
                <button
                  onClick={() => { setPhase('idle'); setResult(null); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10,
                    background: P3.hover, color: P3.text, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  <Film size={15} /> 再合成一次
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 片段清单 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: P3.text }}>片段顺序</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: P3.helper }}>
                {clips.length} 段{estimateSeconds > 0 ? ` · 约 ${Math.round(estimateSeconds)}s` : ''}
              </span>
              <div style={{ flex: 1 }} />
              {!projectId && (
                <span style={{ fontSize: 11.5, color: P3.faint }}>自由画布：成片不入库</span>
              )}
            </div>
            {clips.length === 0 ? (
              <div
                style={{
                  padding: '28px 16px', borderRadius: 12, border: `1px dashed ${P3.border}`,
                  textAlign: 'center', color: P3.helper, fontSize: 13, lineHeight: 1.8,
                }}
              >
                <Clapperboard size={22} style={{ opacity: 0.45 }} />
                <div style={{ marginTop: 6 }}>画布里还没有已生成的视频片段</div>
                <div style={{ fontSize: 12, color: P3.faint }}>先生成镜头视频，或到分镜页「分镜上画布」</div>
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {clips.map((n, i) => {
                  const voice = voiceFor(n);
                  return (
                    <div
                      key={n.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px',
                        border: `1px solid ${P3.border}`, borderRadius: 10, background: '#fff',
                      }}
                    >
                      <span
                        style={{
                          width: 22, height: 22, borderRadius: 6, flexShrink: 0, fontSize: 11.5,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(10,188,207,0.1)', color: P3.primary, fontWeight: 600,
                        }}
                      >
                        {i + 1}
                      </span>
                      <video
                        src={n.data.mediaUrl as string}
                        muted
                        preload="metadata"
                        style={{ width: 54, height: 32, borderRadius: 6, background: '#000', flexShrink: 0, objectFit: 'cover' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: P3.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {n.data.title}
                        </div>
                        <div style={{ fontSize: 11, color: P3.helper, marginTop: 2 }}>
                          {clipSeconds(n) > 0 ? `${clipSeconds(n)}s` : '时长未知'}
                          {voice ? ' · 含配音' : ''}
                        </div>
                      </div>
                      <button
                        className="p3-icon-btn"
                        title="上移"
                        style={{ width: 26, height: 26 }}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="p3-icon-btn"
                        title="下移"
                        style={{ width: 26, height: 26 }}
                        disabled={i === clips.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="p3-icon-btn"
                        title="移出合成"
                        style={{ width: 26, height: 26, color: '#E5484D' }}
                        onClick={() => setOrder((prev) => prev.filter((id) => id !== n.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 输出设置 */}
          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: '#FAFAFA', border: `1px solid ${P3.cardBorder}` }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 220 }}>
                <span style={{ display: 'block', fontSize: 11.5, color: P3.helper, marginBottom: 5 }}>成片名称</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${P3.border}`, fontSize: 13, color: P3.text, outline: 'none', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ width: 150 }}>
                <span style={{ display: 'block', fontSize: 11.5, color: P3.helper, marginBottom: 5 }}>输出画幅</span>
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${P3.border}`, fontSize: 13, color: P3.text, background: '#fff', outline: 'none' }}
                >
                  {RATIO_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ width: 170 }}>
                <span style={{ display: 'block', fontSize: 11.5, color: P3.helper, marginBottom: 5 }}>
                  <Music size={11} style={{ marginRight: 3, verticalAlign: -1 }} />BGM（可选）
                </span>
                <select
                  value={bgmId}
                  onChange={(e) => setBgmId(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${P3.border}`, fontSize: 13, color: P3.text, background: '#fff', outline: 'none' }}
                >
                  <option value="">不使用</option>
                  {bgmChoices.map((n) => (
                    <option key={n.id} value={n.id}>{n.data.title}</option>
                  ))}
                </select>
              </label>
            </div>
            {projectId && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 12.5, color: P3.helper, cursor: 'pointer' }}>
                <input type="checkbox" checked={registerAsset} onChange={(e) => setRegisterAsset(e.target.checked)} />
                合成后登记为项目资产（工作台资产页 / 导出页可见）
              </label>
            )}
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: '#FDF0F0', border: '1px solid #F5C6C6', color: '#C93B3F', fontSize: 12, lineHeight: 1.55 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button
              onClick={() => useP3Store.getState().closeDialog()}
              style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, color: P3.text, background: P3.hover, cursor: 'pointer' }}
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={clips.length === 0 || phase === 'running'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 22px', borderRadius: 10,
                fontSize: 13, fontWeight: 500, border: 'none',
                background: clips.length === 0 || phase === 'running' ? '#B9D8DB' : P3.primary,
                color: '#fff', cursor: clips.length === 0 || phase === 'running' ? 'not-allowed' : 'pointer',
              }}
            >
              {phase === 'running' ? <Loader2 size={15} className="p3-spin" /> : <Combine size={15} />}
              {phase === 'running' ? '合成中…（片段较多时需数分钟）' : '开始合成'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
