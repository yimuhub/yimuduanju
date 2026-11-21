/**
 * 同构版时间线：单行工具条 + 真实多轨时间线。
 *
 * 设计约束（来自用户截图）：
 * - 只保留一排：常用动作直接露出，低频动作收进同排的分组菜单；
 * - 不重复：选择/分割/撤销/重做/删除/复制各只有一个入口；
 * - 不占位：录音走 MediaRecorder + 上传，自动字幕走真实 ASR，智能包装写真实字幕片段。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  AlignJustify,
  AudioLines,
  Captions,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Diamond,
  Gauge,
  Layers,
  Loader2,
  MapPin,
  Maximize2,
  Mic,
  Minus,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Scissors,
  ScanSearch,
  Square,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Volume2,
  Wand2,
  Magnet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { ShenJianTimeline } from './ShenJianTimeline';

import { IconRazor, IconRippleDelete, IconSelect, IconSplit, IconTrimLeft, IconTrimRight } from './ShenJianIcons';
import { clipSpan } from './model';
import { useAutoRecord } from '@client/src/lib/keyframe-autorecord';
import { uploadLocalFile } from '@client/src/api/assets';
import { getAsrStatus, transcribeClip } from '@client/src/api/timeline';
import { beatFailureOf, clearBeats, loadBeats, resetManualBeats, useBeatsSnapshot } from '@client/src/lib/timeline-beats';

type MenuKind = 'delete' | 'insert' | 'pack' | 'more';
type MenuState = { kind: MenuKind; x: number; y: number } | null;

export const ParityTimeline = ({
  snapOn,
  setSnapOn,
}: {
  snapOn: boolean;
  setSnapOn: (v: boolean) => void;
}) => {
  const { data, curT, setCurT, projectId } = useStudio();
  const edl = useEdl();
  // 自动打点（G13）：与检查器动画页共用同一个开关（localStorage + 事件同步）
  const [autoRecord, setAutoRecord] = useAutoRecord();
  const clips = data.timeline?.clips ?? [];
  const selected = clips.find((c) => edl.selectedIds.includes(c.id)) ?? null;
  const selectedIsMedia = selected?.track === 'video' || selected?.track === 'audio';

  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [zoom, setZoom] = useState(44);
  const [menu, setMenu] = useState<MenuState>(null);
  const [recording, setRecording] = useState(false);
  const [asrBusy, setAsrBusy] = useState(false);
  // 节拍分析（W6）：busy 只管按钮转圈，节拍数据本体在 timeline-beats 的模块级 store
  const [beatsBusy, setBeatsBusy] = useState(false);
  const beatsSnapshot = useBeatsSnapshot();
  // R3 手动节拍覆盖层是否有内容（「重置手动节拍」置灰用，随快照刷新）
  const hasManualBeatsNow = useMemo(
    () => [...beatsSnapshot.manualEdits.values()].some((e) => e.added.length || e.removed.length),
    [beatsSnapshot.manualEdits],
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);

  const total = useMemo(
    () => Math.max(0, ...clips.map((c) => c.timelineStart + clipSpan(c))),
    [clips],
  );

  useEffect(() => {
    const onTool = (e: Event) => setTool((e as CustomEvent).detail === 'razor' ? 'razor' : 'select');
    const onZoom = (e: Event) => {
      const v = Number((e as CustomEvent).detail);
      if (Number.isFinite(v)) setZoom(Math.max(14, Math.min(240, v)));
    };
    window.addEventListener('yimu:shenjian-tool-state', onTool);
    window.addEventListener('yimu:shenjian-zoom-state', onZoom);
    return () => {
      window.removeEventListener('yimu:shenjian-tool-state', onTool);
      window.removeEventListener('yimu:shenjian-zoom-state', onZoom);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.ptl-menu-portal,.ptl-menu-trigger')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const dispatchTool = (next: 'select' | 'razor') => {
    setTool(next);
    window.dispatchEvent(new CustomEvent('yimu:shenjian-tool', { detail: next }));
  };

  const openMenu = (kind: MenuKind, e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, x: r.left, y: r.top });
  };

  const splitAtPlayhead = () => {
    const hit = selected ?? clips.find(
      (c) => (c.track === 'video' || c.track === 'audio') && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c),
    );
    if (!hit) {
      toast.info('播放头下没有可分割片段');
      return;
    }
    const next = edl.splitAtPlayhead(curT, hit.id);
    if (next) toast.success('已分割');
    else toast.info('播放头不在片段内');
  };

  const requireSelected = () => {
    if (selected) return true;
    toast.info('先选中一个片段');
    return false;
  };

  const deleteSelected = () => {
    if (!requireSelected() || !selected) return;
    edl.rippleDelete([selected.id]);
    setMenu(null);
  };

  const trimEdge = (edge: 'left' | 'right') => {
    if (!requireSelected() || !selected) return;
    edl.rippleTrimAt(selected.id, edge, curT);
    setMenu(null);
  };

  /** 修剪到播放头（非波纹）：边缘落到播放头，后续片段保持原位 */
  const trimToPlayhead = (side: 'left' | 'right') => {
    if (!requireSelected() || !selected) return;
    const ok = edl.trimClipToPlayhead(side, curT, selected.id);
    if (ok) toast.success(side === 'left' ? '已修剪到播放头（左）' : '已修剪到播放头（右）');
    setMenu(null);
  };

  const detachAudio = () => {
    if (!selected || selected.track !== 'video') {
      toast.info('先选中一个画面片段');
      return;
    }
    const audioId = edl.detachAudio(selected.id);
    toast.success(audioId ? '已分离音频，下方出现独立音频轨' : '该画面已有独立原声轨');
    setMenu(null);
  };

  const copySelected = () => {
    if (!selected) { toast.info('先选中一个片段'); return; }
    edl.copySelection([selected.id]);
    toast.success('已复制');
  };

  const pasteAtPlayhead = () => {
    const created = edl.pasteAt(curT);
    if (created.length) toast.success(`已粘贴 ${created.length} 个片段`);
    else toast.info('剪贴板是空的，先复制一个片段');
  };

  const addSubtitle = () => {
    const id = edl.addSubtitle(curT);
    if (id) toast.success('已在播放头加字幕');
    setMenu(null);
  };

  const addSubtitleLane = () => {
    const maxLane = Math.max(0, ...clips.filter((c) => c.track === 'subtitle').map((c) => c.lane ?? 0));
    const id = edl.addSubtitle(curT, maxLane + 1);
    if (id) toast.success('已新增字幕轨');
    setMenu(null);
  };

  const addMarker = () => {
    edl.addMarker(curT);
    toast.success('已在播放头加标记');
    setMenu(null);
  };

  const packVideo = () => {
    edl.packVideo();
    toast.success('画面轨已排齐');
  };

  const home = () => {
    setCurT(0);
    window.dispatchEvent(new Event('yimu:shenjian-scroll-home'));
  };

  const setZoomAbs = (v: number) => window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom-set', { detail: v }));
  const zoomStep = (dir: 'in' | 'out') => window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: dir === 'out' ? 'out' : 'in' }));
  const fit = () => window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: 'fit' }));
  const fitSelection = () => window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: 'fit-selection' }));

  const toggleRecord = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!projectId) { toast.error('项目还没准备好'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('当前浏览器不支持麦克风录音');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      recordStartRef.current = Date.now();
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const chunks = chunksRef.current;
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (!chunks.length) { toast.info('没有录到声音'); return; }
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const duration = Math.max(0.3, (Date.now() - recordStartRef.current) / 1000);
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
        const filename = `录音-${stamp}.${ext}`;
        const loading = toast.loading('正在保存录音…');
        void uploadLocalFile(projectId, blob, filename, Math.round(duration * 100) / 100)
          .then(({ fileUrl }) => {
            edl.addAudio({ name: filename, url: fileUrl, durationSeconds: duration }, curT);
            toast.success(`录音已插入播放头 · ${duration.toFixed(1)}s`);
          })
          .catch((err) => toast.error(`录音上传失败：${(err as Error).message}`))
          .finally(() => toast.dismiss(loading));
      };
      rec.start(500);
      setRecording(true);
      toast.info('开始录音，再点一次结束');
    } catch (err) {
      toast.error(`无法使用麦克风：${(err as Error).message}`);
    }
  };

  const autoCaption = async () => {
    if (!projectId) { toast.error('项目还没准备好'); return; }
    if (asrBusy) return;
    const target = selectedIsMedia && selected
      ? selected
      : clips.find((c) => (c.track === 'video' || c.track === 'audio') && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c));
    if (!target) {
      toast.info('先选中一个画面/音频片段，或把播放头移到有声音的片段上');
      return;
    }
    setAsrBusy(true);
    const loading = toast.loading('正在识别语音…');
    try {
      const status = await getAsrStatus(projectId);
      if (!status.available) {
        toast.error(`语音识别未配置：${status.reason || '请先在 Provider 设置里配置 ASR'}`);
        return;
      }
      const res = await transcribeClip(projectId, target.id);
      if (!res.segments.length) {
        toast.info('没有识别到有效语音');
        return;
      }
      let added = 0;
      for (const s of res.segments) {
        const id = edl.addSubtitle(s.start, 0, s.text, undefined, Math.max(0.3, s.end - s.start));
        if (id) added += 1;
      }
      toast.success(`已生成 ${added} 条字幕`);
    } catch (err) {
      toast.error(`自动字幕失败：${(err as Error).message}`);
    } finally {
      toast.dismiss(loading);
      setAsrBusy(false);
    }
  };

  /* ------------------------- 节拍分析（W6）：分析 → 吸附 → 竖线可视化 -------------------------
   * 目标素材 = 选中片段优先，其次播放头下的音频/画面片段；结果按 assetId
   * 缓存在 timeline-beats 模块级 store（含 localStorage），吸附与背景竖线共用。
   */
  const beatTargetAssetId = () => {
    const target = selected ?? clips.find(
      (c) => (c.track === 'audio' || c.track === 'video') && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c),
    );
    return target?.sourceAssetId ?? null;
  };

  const analyzeBeatsNow = async () => {
    if (!projectId) { toast.error('项目还没准备好'); return; }
    if (beatsBusy) return;
    const assetId = beatTargetAssetId();
    if (!assetId) {
      toast.info('先选中音频片段（或带原声的画面片段）再分析节拍');
      return;
    }
    setBeatsBusy(true);
    const loading = toast.loading('正在分析节拍…');
    try {
      const info = await loadBeats(projectId, assetId);
      if (!info) {
        toast.error(`节拍分析失败：${beatFailureOf(assetId) || '未检测到节拍'}`);
        return;
      }
      toast.success(`节拍 ${info.beats.length} 个 · BPM ${info.bpm > 0 ? Math.round(info.bpm) : '--'}`);
    } finally {
      toast.dismiss(loading);
      setBeatsBusy(false);
    }
  };

  const clearBeatsNow = () => {
    const assetId = beatTargetAssetId();
    if (!assetId || !beatsSnapshot.byAsset.has(assetId)) {
      toast.info('这个素材还没有节拍分析');
      return;
    }
    clearBeats(assetId);
    toast.success('已清除节拍，磁吸回到片段边缘 / 标记');
    setMenu(null);
  };

  const packTitle = () => {
    edl.addSubtitle(0, 0, data.project?.title || '一幕短剧', { fontSize: 34, bold: true, y: 0.18 }, 3);
    toast.success('已加片头标题');
    setMenu(null);
  };

  const packEnd = () => {
    if (total <= 0) { toast.info('时间线还是空的，先加片段'); return; }
    edl.addSubtitle(Math.max(0, total - 0.2), 0, '感谢观看', { fontSize: 28, bold: true, y: 0.82 }, 3);
    toast.success('已加片尾落版');
    setMenu(null);
  };

  const openPackAssets = () => {
    window.dispatchEvent(new CustomEvent('yimu:shenjian-module', { detail: 'text' }));
    toast.info('已打开文本/贴纸素材，点素材即可加到播放头');
    setMenu(null);
  };

  const menuBody = menu ? (
    <div className="ptl-menu-portal" style={{ left: Math.min(menu.x, window.innerWidth - 224), bottom: Math.max(8, window.innerHeight - menu.y + 6) }}>
      {menu.kind === 'delete' ? (
        <>
          <div className="ptl-menu-title">删除与修剪</div>
          <button type="button" onClick={deleteSelected}><Trash2 /><span>删除选中</span><em>Delete</em></button>
          <button type="button" onClick={() => { if (requireSelected() && selected) edl.rippleDelete([selected.id]); setMenu(null); }}><IconRippleDelete /><span>波纹删除</span><em>合拢</em></button>
          <button type="button" onClick={() => trimEdge('left')}><IconTrimLeft /><span>删除前半段</span><em>Q</em></button>
          <button type="button" onClick={() => trimEdge('right')}><IconTrimRight /><span>删除后半段</span><em>W</em></button>
          <button type="button" onClick={() => trimToPlayhead('left')} disabled={!selected}><IconTrimLeft /><span>修剪到播放头（左）</span><em>非波纹</em></button>
          <button type="button" onClick={() => trimToPlayhead('right')} disabled={!selected}><IconTrimRight /><span>修剪到播放头（右）</span><em>非波纹</em></button>
          <button type="button" onClick={detachAudio}><Volume2 /><span>音画分离</span><em>⇧⌘S</em></button>
        </>
      ) : menu.kind === 'insert' ? (
        <>
          <div className="ptl-menu-title">插入</div>
          <button type="button" onClick={addSubtitle}><Type /><span>加字幕（播放头）</span><em>3s</em></button>
          <button type="button" onClick={addSubtitleLane}><Layers /><span>新增字幕轨</span><em>+T</em></button>
          <button type="button" onClick={addMarker}><MapPin /><span>添加标记</span><em>M</em></button>
        </>
      ) : menu.kind === 'pack' ? (
        <>
          <div className="ptl-menu-title">智能包装</div>
          <button type="button" onClick={packTitle}><Type /><span>片头标题</span><em>3s</em></button>
          <button type="button" onClick={packEnd}><Captions /><span>片尾落版</span><em>3s</em></button>
          <button type="button" onClick={openPackAssets}><Wand2 /><span>文本 / 贴纸素材</span><em>素材库</em></button>
        </>
      ) : (
        <>
          <div className="ptl-menu-title">更多操作</div>
          <button type="button" onClick={() => { copySelected(); setMenu(null); }} disabled={!selected}><Copy /><span>复制片段</span><em>⌘C</em></button>
          <button type="button" onClick={() => { pasteAtPlayhead(); setMenu(null); }}><ClipboardPaste /><span>粘贴到播放头</span><em>⌘V</em></button>
          <button type="button" onClick={() => { edl.undo(); setMenu(null); }} disabled={!edl.canUndo}><Undo2 /><span>撤销</span><em>⌘Z</em></button>
          <button type="button" onClick={() => { edl.redo(); setMenu(null); }} disabled={!edl.canRedo}><Redo2 /><span>重做</span><em>⇧⌘Z</em></button>
          <button type="button" onClick={deleteSelected} disabled={!selected}><Trash2 /><span>删除选中</span><em>⌫</em></button>
          <button type="button" onClick={() => { detachAudio(); setMenu(null); }} disabled={!selected || selected.track !== 'video'}><Volume2 /><span>音画分离</span><em>⇧⌘S</em></button>
          {/* G13 自动打点开关：与检查器动画页签同一份状态（独立小项，便于并行改动合并） */}
          <button
            type="button"
            onClick={() => {
              const next = !autoRecord;
              setAutoRecord(next);
              toast.success(next ? '自动打点已开启：改运镜参数会在播放头自动落关键帧' : '自动打点已关闭：改运镜参数将整体调整动画');
              setMenu(null);
            }}
          >
            <Diamond /><span>自动打点{autoRecord ? '（开）' : '（关）'}</span><em>运镜</em>
          </button>
          <button type="button" onClick={() => { setMenu(null); window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-main', { detail: 'speed' })); }}><Gauge /><span>变速 / 检查器</span></button>
          <button type="button" onClick={() => { packTitle(); setMenu(null); }}><Type /><span>片头标题</span></button>
          <button type="button" onClick={() => { packEnd(); setMenu(null); }}><Captions /><span>片尾落版</span></button>
          <button type="button" onClick={() => { packVideo(); setMenu(null); }}><AlignJustify /><span>画面轨排齐</span></button>
          <button type="button" onClick={() => { home(); setMenu(null); }}><RotateCcw /><span>回到起点</span></button>
          {/* W6 节拍：清除当前目标素材的分析结果（内存 + localStorage），吸附不再按节拍 */}
          <button
            type="button"
            onClick={clearBeatsNow}
            disabled={!beatsSnapshot.byAsset.size}
          >
            <AudioLines /><span>清除节拍</span><em>{beatsSnapshot.byAsset.size ? `${beatsSnapshot.byAsset.size} 素材` : '无'}</em>
          </button>
          {/* R3 手动节拍：清掉全部覆盖层（加/删/拖）只留分析结果，可整体撤销 */}
          <button
            type="button"
            onClick={() => {
              const ok = resetManualBeats();
              if (ok) toast.success('已重置手动节拍，只保留分析结果');
              else toast.info('没有手动节拍可重置');
              setMenu(null);
            }}
            disabled={!hasManualBeatsNow}
          >
            <RotateCcw /><span>重置手动节拍</span><em>{hasManualBeatsNow ? '清覆盖层' : '无'}</em>
          </button>
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="parity-timeline">
      <div className="parity-tl-toolbar">
        <button type="button" className={`ptl-btn${tool === 'select' ? ' active' : ''}`} title="选择工具 (A)" onClick={() => dispatchTool('select')}>
          <IconSelect />
        </button>
        <button type="button" className={`ptl-btn${tool === 'razor' ? ' active' : ''}`} title="剃刀工具 (B)：在点击处切开" onClick={() => dispatchTool('razor')}>
          <IconRazor />
        </button>
        <span className="ptl-sep" />
        <button type="button" className="ptl-btn" title="在播放头分割 (E / Ctrl+B)" onClick={splitAtPlayhead} disabled={!selected && !clips.length}>
          <IconSplit />
        </button>
        <button type="button" className="ptl-btn" title="向左裁剪至播放头" onClick={() => trimEdge('left')} disabled={!selected}>
          <IconTrimLeft />
        </button>
        <button type="button" className="ptl-btn" title="向右裁剪至播放头" onClick={() => trimEdge('right')} disabled={!selected}>
          <IconTrimRight />
        </button>
        <span className="ptl-sep" />
        <button type="button" className="ptl-btn ptl-menu-trigger" title="插入字幕 / 字幕轨 / 标记" onClick={(e) => openMenu('insert', e)}>
          <Type />
        </button>
        <button type="button" className={`ptl-btn${recording ? ' recording' : ''}`} title={recording ? '停止录音并插入时间线' : '麦克风录音'} onClick={() => void toggleRecord()}>
          {recording ? <Square /> : <Mic />}
        </button>
        <button type="button" className="ptl-btn" title="自动字幕：对选中片段跑 ASR 并生成字幕" onClick={() => void autoCaption()} disabled={asrBusy}>
          {asrBusy ? <Loader2 className="ptl-spin" /> : <Captions />}
        </button>
        <span className="ptl-sep" />
        <button type="button" className={`ptl-btn${snapOn ? ' active' : ''}`} title="吸附开关 (N)" onClick={() => setSnapOn(!snapOn)}>
          <Magnet />
        </button>
        <button
          type="button"
          className="ptl-btn"
          title="分析节拍：对选中音频/画面片段的源素材跑节拍检测（结果缓存），开启吸附后可按节拍对齐"
          onClick={() => void analyzeBeatsNow()}
          disabled={beatsBusy}
        >
          {beatsBusy ? <Loader2 className="ptl-spin" /> : <AudioLines />}
        </button>
        <button type="button" className="ptl-btn" title="画面轨首尾相接（主轨磁吸）" onClick={packVideo}>
          <AlignJustify />
        </button>
        <button type="button" className="ptl-btn ptl-menu-trigger" title="更多：复制/粘贴/撤销/删除/音画分离/智能包装" onClick={(e) => openMenu('more', e)}>
          <MoreHorizontal />
        </button>
        <span className="ptl-grow" />
        <div className="ptl-zoom">
          <button type="button" title="缩放到选中片段" onClick={fitSelection} disabled={!selected}><ScanSearch /></button>
          <button type="button" title="时间轴适应宽度" onClick={fit}><Maximize2 /></button>
          <button type="button" title="缩小 (-)" onClick={() => zoomStep('out')}><Minus /></button>
          <input
            type="range"
            min="14"
            max="240"
            value={zoom}
            aria-label="时间线缩放"
            onChange={(e) => setZoomAbs(Number(e.target.value))}
          />
          <span className="ptl-zoom-val" title={`${zoom} px/s`}>{Math.round((zoom / 44) * 100)}%</span>
          <button type="button" title="放大 (+)" onClick={() => zoomStep('in')}><Plus /></button>
        </div>
      </div>
      {menuBody ? createPortal(menuBody, document.body) : null}
      <ShenJianTimeline snapOn={snapOn} setSnapOn={setSnapOn} hideToolbar />
    </div>
  );
};

export default ParityTimeline;
