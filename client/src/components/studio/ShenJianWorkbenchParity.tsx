/**
 * 一幕·神剪 — 同构版（Parity）
 * 与经典版并存：72px 模块栏 + 300px 素材面板 / 中间舞台 / 430px 检查器 / 360px 双行工具栏时间线。
 * 工程、EDL、导出、快捷键完全复用；没有接入的能力在检查器与时间线里明确标“待接入”。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clapperboard,
  Code2,
  Download,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Keyboard,
  LayoutGrid,
  Magnet,
  Maximize2,
  PanelLeftClose,
  PanelRightClose,
  Redo2,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { exportTimeline } from '@client/src/api/timeline';
import { downloadDeliverable } from '@client/src/api/export';
import { projectExportFileName } from '@shared/file-name';
import { ParityLibrary } from './ParityLibrary';
import { ShenJianStage } from './ShenJianStage';
import { ShenJianInspectorParity } from './ShenJianInspectorParity';
import { ShenJianShotPool } from './ShenJianShotPool';
import { ParityTimeline } from './ParityTimeline';
import { StudioImportDialog } from './StudioImportDialog';
import { StudioCoverDialog } from './StudioCoverDialog';
import { StudioFloatingChat } from './StudioFloatingChat';
import { JIANYING_SHORTCUT_GROUPS } from '@client/src/lib/jianying-shortcuts';
import { clipSpan } from './model';
import { useParityLayout } from './useParityLayout';
import { ParityDockShell } from './ParityDockShell';
import { ParityEditorProvider, type ParityEditorUI } from './ParityEditorContext';
import type { DockviewApi } from 'dockview-react';
import { ShenJianVariantSwitch } from './ShenJianVariantSwitch';

type Ratio = '9:16' | '16:9' | '1:1' | '4:3';

export const ShenJianWorkbenchParity = () => {
  const {
    data,
    projectId,
    curT,
    setCurT,
    playing,
    setPlaying,
    previewQuality,
    setPreviewQuality,
    setPlayDir,
    setProEdit,
    setStageView,
    setTlCollapsed,
  } = useStudio();
  const edl = useEdl();
  const navigate = useNavigate();
  const pane = useParityLayout();
  const stageShellRef = useRef<HTMLDivElement | null>(null);
  const dockApiRef = useRef<DockviewApi | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState({ left: false, right: false });

  const [ratio, setRatio] = useState<Ratio>('9:16');
  useEffect(() => {
    const a = data.project?.aspectRatio;
    if (a === '16:9' || a === '1:1' || a === '4:3') setRatio(a);
  }, [data.project?.aspectRatio]);
  const [snapOn, setSnapOn] = useState(true);
  const [safe, setSafe] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [parityOpen, setParityOpen] = useState(false);
  const [annotate, setAnnotate] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportBurnSubs, setExportBurnSubs] = useState(true);
  const [exportLaneMode, setExportLaneMode] = useState<'sequence' | 'main' | 'overlay'>('overlay');
  const [exportAsset, setExportAsset] = useState<{ name: string; fileUrl?: string; durationSeconds?: number } | null>(null);
  const [rightTab, setRightTab] = useState<'inspector' | 'pool'>('inspector');
  const [compactPanel, setCompactPanel] = useState<'library' | 'pool' | 'inspector' | null>(null);
  const [grade, setGradeState] = useState({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number; transform: string } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [inT, setInT] = useState(0);
  const [outT, setOutT] = useState(0);
  const [attrClip, setAttrClip] = useState<{ speed: number; volume: number; transition: typeof selected extends null ? never : NonNullable<typeof selected>['transition']; textStyle: NonNullable<typeof selected>['textStyle'] } | null>(null);

  const setGrade = (patch: Partial<typeof grade>) => setGradeState((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 1180) setCompactPanel(null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const onGrade = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setGradeState((prev) => ({ ...prev, ...detail }));
    };
    window.addEventListener('yimu:shenjian-grade', onGrade);
    return () => window.removeEventListener('yimu:shenjian-grade', onGrade);
  }, []);

  const total = useMemo(() => {
    const ends = (data.timeline?.clips ?? []).map((c) => c.timelineStart + clipSpan(c));
    if (!ends.length) return Math.max(1, data.totalSec || 0);
    return Math.max(1, ...ends);
  }, [data.timeline?.clips, data.totalSec]);
  useEffect(() => {
    if (edl.selectedIds.length) {
      setRightTab('inspector');
      dockApiRef.current?.getPanel('inspector')?.api.setActive();
    }
  }, [edl.selectedIds]);

  const focusPanel = (id: string) => {
    const api = dockApiRef.current;
    const panel = api?.getPanel(id);
    if (panel) panel.api.setActive();
  };

  /**
   * 侧栏折叠：先收宽度，再由 Dockview 的分隔条约束兜底。
   * 不删除面板、不卸载内容，展开后仍然保留滚动位置与素材筛选。
   */
  const toggleSide = (side: 'left' | 'right') => {
    const id = side === 'left' ? 'library' : 'inspector';
    const api = dockApiRef.current;
    const group = api?.getPanel(id)?.group;
    const next = !sideCollapsed[side];
    if (group) {
      try {
        // Dockview 的组宽度约束允许 48px 折叠轨；右栏展开回到 430。
        (group.api as unknown as { setConstraints: (v: { minimumWidth: number }) => void }).setConstraints({ minimumWidth: next ? 48 : 220 });
        group.api.setSize({ width: next ? 48 : side === 'left' ? 372 : 430 });
      } catch {
        // 组尚未完成布局时忽略一次，下一次点击即可生效。
      }
    }
    setSideCollapsed((prev) => ({ ...prev, [side]: next }));
  };

  const selected = useMemo(() => {
    const ids = edl.selectedIds;
    const id = ids.length ? ids[ids.length - 1] : '';
    return (data.timeline?.clips ?? []).find((c) => c.id === id) ?? null;
  }, [data.timeline, edl.selectedIds]);

  const goProject = () => {
    // 退出神通剪辑时同时退出全功能编辑态：否则返回项目根仍会停在老 proEdit 壳里，
    // 看不到项目对话。返回后必须是「项目根 + 对话舞台」。
    setProEdit(false);
    setStageView('chat');
    // 项目根默认是对话主界面，旧底部时间线收起，避免一返回就看到老剪辑界面
    setTlCollapsed(true);
    navigate('/');
  };
  const goExport = () => {
    if (!projectId) return;
    // 剪映是从工作台直接弹导出面板，而不是把用户踢到另一个 0/7 镜头的交付页。
    // 这里保留时间线精剪导出（EDL）作为唯一入口，参数与导出页同一套 API。
    setExportAsset(null);
    setExportOpen(true);
  };

  const runTimelineExport = async () => {
    if (!projectId || exportBusy) return;
    setExportBusy(true);
    try {
      const res = await exportTimeline(projectId, {
        burnSubtitles: exportBurnSubs,
        videoLaneMode: exportLaneMode,
      });
      setExportAsset(res.asset);
      toast.success(`精剪成片已生成：${res.clips} 段 · ${res.durationSeconds.toFixed(1)}s`);
    } catch (e) {
      const msg =
        typeof e === 'object' && e && 'response' in e
          ? ((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? '')
          : '';
      toast.error(msg || (e as Error).message || '时间线导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  const split = () => {
    const id = selected?.id;
    if (id) {
      const next = edl.splitAtPlayhead(curT, id);
      if (!next) toast.info('播放头不在选中片段内');
      return;
    }
    const hit = (data.timeline?.clips ?? []).find((c) => c.track === 'video' && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c));
    if (hit) edl.splitAtPlayhead(curT, hit.id);
    else toast.info('播放头下没有可分割片段');
  };

  /** 与剪映一致的常用快捷键；输入框内全部让路 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (exportOpen) { if (!exportBusy) setExportOpen(false); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (parityOpen) { setParityOpen(false); return; }
        if (coverOpen) { setCoverOpen(false); return; }
        if (importOpen) { setImportOpen(false); return; }
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && e.shiftKey && key === 's') { e.preventDefault(); if (selected) { edl.detachAudio(selected.id); toast.success('已分离音画'); } return; }
      if (mod && e.shiftKey && key === 'c') {
        e.preventDefault();
        if (selected) {
          setAttrClip({ speed: selected.speed ?? 1, volume: selected.volume ?? 1, transition: selected.transition ?? null, textStyle: selected.textStyle ?? null });
          toast.success('已复制片段属性');
        }
        return;
      }
      if (mod && e.shiftKey && key === 'v') {
        e.preventDefault();
        if (selected && attrClip) {
          edl.setClipSpeed(selected.id, attrClip.speed);
          edl.setClipVolume(selected.id, attrClip.volume);
          edl.setClipTransition(selected.id, attrClip.transition);
          if (attrClip.textStyle) edl.updateTextStyle(selected.id, attrClip.textStyle);
          toast.success('已粘贴片段属性');
        }
        return;
      }
      if (mod && key === 's') { e.preventDefault(); void edl.saveNow(); toast.success('时间线已保存'); return; }
      if (mod && key === 'g' && e.shiftKey) { e.preventDefault(); edl.unbindSelection(); toast.success('已取消组合'); return; }
      if (mod && key === 'g') { e.preventDefault(); edl.bindSelection(); toast.success('已组合'); return; }
      if (mod && key === 'i') { e.preventDefault(); setImportOpen(true); return; }
      if (mod && key === 'n') { e.preventDefault(); navigate('/create'); return; }
      if (mod && key === 'f') { e.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else void stageShellRef.current?.requestFullscreen?.(); return; }
      if (mod && key === 'k') {
        e.preventDefault();
        if (selected) {
          const at = Math.max(0, curT - selected.timelineStart);
          edl.setClipKeyframes(selected.id, [...(selected.keyframes ?? []), { time: at, scale: 1, x: 0, y: 0, rotate: 0 }]);
          toast.success('已添加关键帧');
        }
        return;
      }
      if (mod && (key === '.' || key === ',')) {
        e.preventDefault();
        if (selected) {
          const next = Math.max(0, Math.min(1, (selected.volume ?? 1) + (key === '.' ? 0.05 : -0.05)));
          edl.setClipVolume(selected.id, next);
        }
        return;
      }
      if (mod && key === 'r') { e.preventDefault(); setRightTab('inspector'); window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-tab', { detail: 'basic' })); toast.info('速度面板：右侧检查器「速度与声音」'); return; }
      if (e.altKey && key === 'k') { e.preventDefault(); setRightTab('inspector'); window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-tab', { detail: 'anim' })); return; }
      if (mod && e.shiftKey && key === 'b') { e.preventDefault(); return; }
      if (e.altKey && e.shiftKey && key === 'g') { e.preventDefault(); if (selected) edl.ungroupCompound(selected.id); return; }
      if (e.altKey && key === 'g') { e.preventDefault(); if (edl.selectedIds.length) edl.createCompound(edl.selectedIds); return; }
      if (e.shiftKey && key === 'b') {
        e.preventDefault();
        if (selected) edl.setClipSpeedCurve(selected.id, [1, 1.25, 1.5, 1.25, 1]);
        return;
      }
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); edl.undo(); return; }
      if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) { e.preventDefault(); edl.redo(); return; }
      if (mod && key === 'c') { e.preventDefault(); edl.copySelection(edl.selectedIds); return; }
      if (mod && key === 'd') {
        e.preventDefault();
        if (!edl.selectedIds.length) { toast.info('先选中一个片段'); return; }
        edl.copySelection(edl.selectedIds);
        const created = edl.pasteAt(curT);
        toast.success(`已复制 ${created.length || edl.selectedIds.length} 个片段到播放头`);
        return;
      }
      if (mod && key === 'x') { e.preventDefault(); edl.cutSelection(edl.selectedIds); return; }
      if (mod && key === 'v') { e.preventDefault(); edl.pasteAt(curT); return; }
      if (mod && key === 'a') { e.preventDefault(); edl.setSelection((data.timeline?.clips ?? []).map((c) => c.id)); return; }
      if (mod && key === 'e') { e.preventDefault(); goExport(); return; }
      if (mod && key === 'b' && e.shiftKey) {
        e.preventDefault();
        let n = 0;
        for (const c of (data.timeline?.clips ?? [])) {
          if (curT > c.timelineStart && curT < c.timelineStart + clipSpan(c) && edl.splitAtPlayhead(curT, c.id)) n += 1;
        }
        toast.success(`已批量分割 ${n} 个片段`);
        return;
      }
      if (mod && key === 'b') { e.preventDefault(); split(); return; }
      if (mod && key === '/') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (mod && key === 'j') { e.preventDefault(); edl.addMarker(curT); toast.success('已打踩点'); return; }
      if (mod && (key === '+' || key === '=')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: 'in' })); return; }
      if (mod && key === '-') { e.preventDefault(); window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: 'out' })); return; }
      if (mod) return;

      if (key === 'a') { e.preventDefault(); window.dispatchEvent(new CustomEvent('yimu:shenjian-tool', { detail: 'select' })); return; }
      if (key === 'b') { e.preventDefault(); window.dispatchEvent(new CustomEvent('yimu:shenjian-tool', { detail: 'razor' })); return; }
      if (key === 'e') { e.preventDefault(); split(); return; }
      if (key === 'q') { e.preventDefault(); if (selected) edl.rippleTrimAt(selected.id, 'left', curT); return; }
      if (key === 'w') { e.preventDefault(); if (selected) edl.rippleTrimAt(selected.id, 'right', curT); return; }
      if (key === ' ') { e.preventDefault(); setPlaying(!playing); return; }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        if (edl.selectedIds.length) edl.rippleDelete(edl.selectedIds);
        return;
      }
      if ((key === 'arrowleft' || key === 'arrowright') && e.shiftKey) {
        e.preventDefault();
        const step = 10 / edl.fps;
        setCurT(Math.max(0, Math.min(total, curT + (key === 'arrowright' ? step : -step))));
        return;
      }
      if (key === 'arrowleft') { e.preventDefault(); setCurT(Math.max(0, curT - 1 / edl.fps)); return; }
      if (key === 'arrowright') { e.preventDefault(); setCurT(Math.min(total, curT + 1 / edl.fps)); return; }
      if (key === 'home') { e.preventDefault(); setCurT(0); return; }
      if (key === 'end') { e.preventDefault(); setCurT(total); return; }
      if (key === 'arrowup' || key === 'arrowdown') {
        e.preventDefault();
        const cuts = (data.timeline?.clips ?? [])
          .flatMap((c) => [c.timelineStart, c.timelineStart + clipSpan(c)])
          .sort((a, b) => a - b);
        const target = key === 'arrowup' ? [...cuts].reverse().find((t) => t < curT - 0.01) : cuts.find((t) => t > curT + 0.01);
        if (target != null) setCurT(target);
        return;
      }
      if (key === '[') {
        e.preventDefault();
        const prev = (data.timeline?.clips ?? []).filter((c) => c.timelineStart + clipSpan(c) <= curT).sort((a, b) => b.timelineStart - a.timelineStart)[0];
        if (prev) edl.setSelection([prev.id]);
        return;
      }
      if (key === ']') {
        e.preventDefault();
        const next = (data.timeline?.clips ?? []).filter((c) => c.timelineStart >= curT).sort((a, b) => a.timelineStart - b.timelineStart)[0];
        if (next) edl.setSelection([next.id]);
        return;
      }

      if (e.shiftKey && key === 'm') { e.preventDefault(); if (selected) edl.setClipVolume(selected.id, (selected.volume ?? 1) > 0 ? 0 : 1); return; }
      if (key === 'm') { e.preventDefault(); edl.addMarker(curT); toast.success('已添加标记'); return; }
      if (key === 'n') { e.preventDefault(); setSnapOn((v) => !v); toast.info(snapOn ? '吸附已关闭' : '吸附已开启', { duration: 1200 }); return; }
      if (key === 's') { e.preventDefault(); setSafe((v) => !v); return; }
      if (key === 'f') {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stageShellRef.current?.requestFullscreen?.();
        return;
      }
      if (key === 'v') { e.preventDefault(); if (selected) edl.setClipEnabled(selected.id, selected.enabled === false); return; }
      if (key === 'p') { e.preventDefault(); setSnapOn((v) => !v); toast.info(snapOn ? '主轨磁吸已关闭' : '主轨磁吸已开启', { duration: 1200 }); return; }
      if (key === '~') { e.preventDefault(); if (edl.selectedIds.length) { edl.bindSelection(); toast.success('已绑定'); } else { edl.unbindSelection(); toast.info('已解绑'); } return; }
      if (e.altKey && key === 'x') { e.preventDefault(); edl.setSelection([]); return; }
      if (key === 'i') { e.preventDefault(); setInT(curT); toast.success(`入点 ${curT.toFixed(2)}s`); return; }
      if (key === 'o') { e.preventDefault(); setOutT(curT); toast.success(`出点 ${curT.toFixed(2)}s`); return; }
      if (e.shiftKey && key === 'x') {
        e.preventDefault();
        const a = Math.min(inT, outT);
        const b = Math.max(inT, outT);
        if (b <= a) { toast.info('先按 I / O 设置入点与出点'); return; }
        const ids = (data.timeline?.clips ?? []).filter((c) => c.timelineStart < b && c.timelineStart + clipSpan(c) > a).map((c) => c.id);
        edl.setSelection(ids);
        toast.success(`已选 ${ids.length} 个片段`);
        return;
      }
      if (key === 'j' || key === 'k' || key === 'l') {
        e.preventDefault();
        if (key === 'k') setPlaying(false);
        else { setPlayDir(key === 'j' ? -1 : 1); setPlaying(true); }
        return;
      }
      if ((e.shiftKey && key === 'z')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom', { detail: 'fit' }));
        return;
      }
      if (key === '?') { e.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [curT, data.timeline?.clips, edl, inT, outT, playing, selected, setCurT, setPlayDir, setPlaying, snapOn, total, exportOpen, exportBusy, shortcutsOpen, parityOpen, coverOpen, importOpen]);

  const showTip = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!el || !el.getAttribute('data-tip')) {
      // 指针移到普通区域时立即收起，避免提示跟着上一次按钮留在屏幕上。
      setTip(null);
      setTipPos(null);
      return;
    }
    const text = el.getAttribute('data-tip') || '';
    setTip({ text, rect: el.getBoundingClientRect() });
  };
  const hideTip = () => {
    setTip(null);
    setTipPos(null);
  };

  // 悬浮提示智能避让：上方放不下就翻到下方，左右超出视口就夹紧。
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const box = tipRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const gap = 8;
    const center = tip.rect.left + tip.rect.width / 2;
    const left = Math.min(vw - gap - box.width / 2, Math.max(gap + box.width / 2, center));
    let top = tip.rect.top - gap;
    let transform = 'translate(-50%,-100%)';
    if (top - box.height < gap) {
      top = tip.rect.bottom + gap;
      transform = 'translate(-50%,0)';
    }
    if (top + box.height > vh - gap) top = Math.max(gap, vh - gap - box.height);
    setTipPos({ left, top, transform });
  }, [tip]);

  const editorUI: ParityEditorUI = {
    ratio,
    safe,
    grade,
    snapOn,
    rightTab,
    openImport: () => setImportOpen(true),
    openCover: () => setCoverOpen(true),
    setSafe,
    setGrade,
    setSnapOn,
    setRightTab,
    focusPanel,
    toggleSide,
    collapseState: sideCollapsed,
    stageRef: stageShellRef,
  };

  return (
    <ParityEditorProvider value={editorUI}>
    <div className={`sj2 parity${pane.dragging ? ' dragging' : ''}`} style={pane.rootStyle} onMouseOver={showTip} onMouseLeave={hideTip}>
      <div className="app">
        <header className="topbar parity-topbar">
          <div className="parity-brand" onClick={goProject} title="返回项目工作台">
            <div className="parity-mark"><Clapperboard /></div>
            <div className="parity-brand-text">
              <b>一幕 · 神剪</b>
              <span>PARITY</span>
            </div>
          </div>
          <div className="parity-project">
            <div className="parity-project-name">{data.project?.title || '未命名项目'}</div>
            <div className="parity-save-line">
              <i className={edl.dirty ? 'dirty' : ''} />
              <span>{edl.dirty ? '保存中…' : '自动保存 · 本地'}</span>
              <em>{ratio} · {total.toFixed(1)}s</em>
            </div>
          </div>
          <div className="parity-top-center">
            <button type="button" className={`parity-icon${sideCollapsed.left ? ' is-off' : ''}`} data-tip={sideCollapsed.left ? '展开素材面板' : '收起素材面板'} aria-pressed={sideCollapsed.left} onClick={() => toggleSide('left')}><PanelLeftClose /></button>
            <button type="button" className={`parity-icon${sideCollapsed.right ? ' is-off' : ''}`} data-tip={sideCollapsed.right ? '展开检查器' : '收起检查器'} aria-pressed={sideCollapsed.right} onClick={() => toggleSide('right')}><PanelRightClose /></button>
            <span className="parity-sep" />
            <button type="button" className="parity-icon" data-tip="撤销 (Ctrl+Z)" disabled={!edl.canUndo} onClick={() => edl.undo()}><Undo2 /></button>
            <button type="button" className="parity-icon" data-tip="重做 (Ctrl+Shift+Z)" disabled={!edl.canRedo} onClick={() => edl.redo()}><Redo2 /></button>
            <span className="parity-sep" />
            <div className="parity-meta-chip">{ratio} · {ratio === '9:16' ? '1080×1920' : ratio === '16:9' ? '1920×1080' : ratio === '1:1' ? '1080×1080' : '1440×1080'} · 24fps</div>
            <button type="button" className="parity-quality" data-tip="流畅预览：540p 代理，剪辑不卡" onClick={() => setPreviewQuality(previewQuality === 'fast' ? 'original' : 'fast')}>
              {previewQuality === 'fast' ? '流畅预览 · 540P' : '原画预览'}
            </button>
            <button type="button" className={`parity-snap${snapOn ? ' on' : ''}`} data-tip="拖动时吸附到其他片段边缘与播放头" onClick={() => setSnapOn(!snapOn)}>
              <Magnet /><span>{snapOn ? '吸附开' : '吸附关'}</span>
            </button>
          </div>
          <div className="parity-top-right">
            <ShenJianVariantSwitch />
            <button type="button" className="parity-ghost desktop-only" data-tip="素材池：点素材定位到时间线引用" onClick={() => {
              const next = rightTab === 'pool' ? 'inspector' : 'pool';
              setRightTab(next);
              focusPanel(next);
            }}><LayoutGrid /><span>素材池</span></button>
            <button type="button" className="parity-ghost" data-tip="显示 72 / 300 / 430 / 360 四区尺寸" onClick={() => setAnnotate((v) => !v)}><LayoutGrid /><span>布局对照</span></button>
            <button type="button" className="parity-ghost" data-tip="HTML 动画：写网页，直接渲染成 MP4" onClick={() => navigate('/motion')}><Code2 /><span>HTML 动画</span></button>
            <button type="button" className="parity-ghost" data-tip="查看同构版已落地 / 待接入清单" onClick={() => setParityOpen(true)}><Clapperboard /><span>差异清单</span></button>
            <button type="button" className="parity-ghost" data-tip="查看全部剪映快捷键" onClick={() => setShortcutsOpen(true)}><Keyboard /><span>快捷键</span></button>
            <button type="button" className="parity-ghost desktop-only" data-tip="封面编辑：模板、标题、字号、颜色" onClick={() => setCoverOpen(true)}><ImageIcon /><span>封面</span></button>
            <button type="button" className="parity-export" data-tip="导出成片 (Ctrl+E)" onClick={goExport}><Download /><span>导出</span></button>
            <button type="button" className="parity-ghost parity-back" data-tip="返回项目工作台" onClick={goProject}><ArrowLeft /></button>
            <div className="parity-avatar" title="当前账号">张</div>
            <button type="button" className="parity-icon compact-only" data-tip="打开素材库" onClick={() => setCompactPanel('library')}><FolderOpen /></button>
            <button type="button" className="parity-icon compact-only" data-tip="打开素材池" onClick={() => setCompactPanel('pool')}><LayoutGrid /></button>
            <button type="button" className="parity-icon compact-only" data-tip="打开属性检查器" onClick={() => setCompactPanel('inspector')}><SlidersHorizontal /></button>
          </div>
        </header>

        <ParityDockShell projectId={projectId} apiRef={dockApiRef} onReady={() => {
          // 布局恢复后把检查器/素材池保持为同一组，右键素材池按需激活。
          const api = dockApiRef.current;
          if (!api) return;
          if (rightTab === 'pool') api.getPanel('pool')?.api.setActive();
          else api.getPanel('inspector')?.api.setActive();
        }} />
      </div>

      {compactPanel ? (
        <div className="compact-drawer-backdrop" onClick={() => setCompactPanel(null)}>
          <aside className="compact-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="compact-drawer-head">
              <b>{compactPanel === 'library' ? '素材库' : compactPanel === 'pool' ? '素材池' : '属性检查器'}</b>
              <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setCompactPanel(null)}><X /></button>
            </div>
            <div className="compact-drawer-body">
              {compactPanel === 'library'
                ? <ParityLibrary onImport={() => setImportOpen(true)} />
                : compactPanel === 'pool'
                  ? <ShenJianShotPool onBack={() => setCompactPanel('inspector')} />
                  : <ShenJianInspectorParity grade={grade} setGrade={setGrade} />}
            </div>
          </aside>
        </div>
      ) : null}

      {tip ? (
        <div
          ref={tipRef}
          className="tooltip"
          style={{
            display: 'block',
            left: tipPos?.left ?? tip.rect.left,
            top: tipPos?.top ?? tip.rect.top,
            transform: tipPos?.transform ?? 'translate(-50%,-100%)',
            visibility: tipPos ? 'visible' : 'hidden',
            zIndex: 1000,
          }}
        >
          {tip.text}
        </div>
      ) : null}

      {importOpen && projectId ? (
        <StudioImportDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={(count) => {
            setImportOpen(false);
            window.dispatchEvent(new CustomEvent('yimu:assets-changed'));
            toast.success(`已导入 ${count} 个素材到项目资产库，可在左侧拖入时间线`);
          }}
        />
      ) : null}

      {coverOpen && projectId ? (
        <StudioCoverDialog
          projectId={projectId}
          currentUrl={data.project?.thumbnailUrl}
          onClose={() => setCoverOpen(false)}
          onSaved={() => {
            setCoverOpen(false);
            toast.success('封面已保存，项目卡片同步更新');
          }}
        />
      ) : null}

      {shortcutsOpen ? (
        <div className="modal-mask open" onClick={() => setShortcutsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(860px,94vw)' }}>
            <div className="modal-head">
              剪映快捷键 · 一幕·神剪已接通
              <button type="button" className="x icon-btn" onClick={() => setShortcutsOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {JIANYING_SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--acc)', margin: '2px 0 6px' }}>{group.title}</div>
                  <div className="kbd-grid">
                    {group.items.map((s) => (
                      <div className="kbd-item" key={s.id}>
                        <span title={s.note || ''}>{s.label}</span>
                        <span className="kbd"><b>{s.keys}</b></span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <span className="mini-note" style={{ marginRight: 'auto' }}>输入框内按键不会触发剪辑命令</span>
              <button type="button" className="btn primary" onClick={() => setShortcutsOpen(false)}>知道了</button>
            </div>
          </div>
        </div>
      ) : null}

      {exportOpen ? (
        <div className="modal-mask open" onClick={() => { if (!exportBusy) setExportOpen(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px,94vw)' }}>
            <div className="modal-head">
              导出精剪成片
              <button
                type="button"
                className="x icon-btn"
                disabled={exportBusy}
                onClick={() => setExportOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="mini-note" style={{ marginBottom: 12 }}>
                按底部时间线的 EDL 导出：片段顺序 / 裁剪 / 变速 / 音轨 / 字幕轨，尊重轨道静音与独奏。
              </div>
              <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={exportBurnSubs}
                    disabled={exportBusy}
                    onChange={(e) => setExportBurnSubs(e.target.checked)}
                  />
                  烧录字幕轨到画面
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  画面轨策略
                  <select
                    value={exportLaneMode}
                    disabled={exportBusy}
                    onChange={(e) => setExportLaneMode(e.target.value as 'sequence' | 'main' | 'overlay')}
                  >
                    <option value="overlay">叠加合成（画中画）</option>
                    <option value="main">只导主链</option>
                    <option value="sequence">全部串行</option>
                  </select>
                </label>
              </div>
              {exportAsset ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: '10px 12px',
                    border: '1px solid #2c4a45',
                    borderRadius: 8,
                    background: '#12201d',
                    fontSize: 12,
                  }}
                >
                  <b style={{ display: 'block', marginBottom: 4 }}>{exportAsset.name}</b>
                  <span style={{ color: '#9aa3af' }}>
                    已生成 · {exportAsset.durationSeconds ? `${exportAsset.durationSeconds.toFixed(1)}s` : '成片已归档'}
                  </span>
                  {exportAsset.fileUrl ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: 8 }}
                      onClick={() =>
                        downloadDeliverable(
                          exportAsset.fileUrl as string,
                          projectExportFileName(data.project?.title, 'mp4', '成片'),
                        ).catch(() => toast.error('下载失败'))
                      }
                    >
                      <Download size={13} /> 下载成片
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn" disabled={exportBusy} onClick={() => setExportOpen(false)}>
                取消
              </button>
              <button type="button" className="btn primary" disabled={exportBusy} onClick={() => void runTimelineExport()}>
                {exportBusy ? '导出中…' : exportAsset ? '重新导出' : '开始导出'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {annotate ? (
        <div className="parity-annot-layer" aria-hidden>
          <div className="parity-annot-frame frame-library" />
          <div className="parity-annot-frame frame-stage" />
          <div className="parity-annot-frame frame-inspector" />
          <div className="parity-annot-frame frame-timeline" />
          <span className="parity-annot-label ann-rail">① 模块栏 72px</span>
          <span className="parity-annot-label ann-lib">② 素材面板 300px</span>
          <span className="parity-annot-label ann-stage">③ 播放器 1fr</span>
          <span className="parity-annot-label ann-ins">④ 检查器 430px</span>
          <span className="parity-annot-label ann-tl">⑤ 全宽时间线 · 360px</span>
        </div>
      ) : null}

      {parityOpen ? (
        <div className="modal-mask open" onClick={() => setParityOpen(false)}>
          <div className="modal parity-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              同构版 · 已落地 / 待接入
              <button type="button" className="x icon-btn" onClick={() => setParityOpen(false)}>✕</button>
            </div>
            <div className="modal-body parity-compare">
              <div className="parity-compare-col done">
                <b>已落地</b>
                <ul>
                  <li>72px 模块栏 + 300px 素材面板，9 个模块保留</li>
                  <li>430px 检查器：7 主页签 + 4 子页签外壳</li>
                  <li>360px 时间线：双行工具栏 + 完整轨道头</li>
                  <li>四区拖拽、双击复位、尺寸独立持久化</li>
                  <li>选择 / 分割 / 撤销 / 复制 / 删除 / 导出 / 快捷键复用</li>
                </ul>
              </div>
              <div className="parity-compare-col pending">
                <b>待接入</b>
                <ul>
                  <li>抠像 / 蒙版 / 美容美体</li>
                  <li>目标跟踪 / AI 效果库</li>
                  <li>录音 / 自动字幕 / 智能包装</li>
                  <li>剪映素材生态、账号与付费素材</li>
                </ul>
                <div className="parity-compare-note">待接入项不写入 EDL，不会破坏现有工程；切回经典版即可继续原来的工作流。</div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="mini-note" style={{ marginRight: 'auto' }}>两套界面共用同一工程与时间线，可随时切换对照</span>
              <button type="button" className="btn primary" onClick={() => setParityOpen(false)}>知道了</button>
            </div>
          </div>
        </div>
      ) : null}

      <StudioFloatingChat />
    </div>
    </ParityEditorProvider>
  );
};

export default ShenJianWorkbenchParity;
