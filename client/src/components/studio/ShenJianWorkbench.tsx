/**
 * 一幕·神剪 — 原型同款工作台
 * 布局与视觉严格沿用 docs/神剪原型/神剪-剪映级全能编辑.html：
 *   52px 顶栏 / 286px 左素材库（48 rail + 238 面板）/ 中舞台 / 318px 检查器 / 380px 多轨时间线
 * 所有面板都接真实项目数据与 EDL，不是静态演示。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Image as ImageIcon,
  Keyboard,
  LayoutGrid,
  Magnet,
  Redo2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { ShenJianLibrary } from './ShenJianLibrary';
import { ShenJianStage } from './ShenJianStage';
import { ShenJianInspector } from './ShenJianInspectorV2';
import { ShenJianShotPool } from './ShenJianShotPool';
import { ShenJianTimeline } from './ShenJianTimeline';
import { StudioImportDialog } from './StudioImportDialog';
import { StudioCoverDialog } from './StudioCoverDialog';
import { StudioFloatingChat } from './StudioFloatingChat';
import { JIANYING_SHORTCUT_GROUPS } from '@client/src/lib/jianying-shortcuts';
import { clipSpan } from './model';

type Ratio = '9:16' | '16:9' | '1:1';

export const ShenJianWorkbench = () => {
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

  const [ratio, setRatio] = useState<Ratio>('9:16');
  const [snapOn, setSnapOn] = useState(true);
  const [safe, setSafe] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'inspector' | 'pool'>('inspector');
  const [grade, setGradeState] = useState({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [inT, setInT] = useState(0);
  const [outT, setOutT] = useState(0);
  const [attrClip, setAttrClip] = useState<{ speed: number; volume: number; transition: typeof selected extends null ? never : NonNullable<typeof selected>['transition']; textStyle: NonNullable<typeof selected>['textStyle'] } | null>(null);

  const setGrade = (patch: Partial<typeof grade>) => setGradeState((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    const onGrade = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setGradeState((prev) => ({ ...prev, ...detail }));
    };
    window.addEventListener('yimu:shenjian-grade', onGrade);
    return () => window.removeEventListener('yimu:shenjian-grade', onGrade);
  }, []);

  const total = Math.max(1, data.totalSec || 0, ...(data.timeline?.clips ?? []).map((c) => c.timelineStart + clipSpan(c)));
  useEffect(() => {
    if (edl.selectedIds.length) setRightTab('inspector');
  }, [edl.selectedIds]);

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
    if (projectId) navigate(`/project/${projectId}`);
  };
  const goExport = () => {
    if (projectId) navigate(`/project/${projectId}/export`);
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
      if (mod && key === 'f') { e.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); return; }
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
        else void document.documentElement.requestFullscreen?.();
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
  }, [curT, data.timeline?.clips, edl, inT, outT, playing, selected, setCurT, setPlayDir, setPlaying, snapOn, total]);

  const showTip = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!el) return;
    const text = el.getAttribute('data-tip') || '';
    if (!text) return;
    const rect = el.getBoundingClientRect();
    setTip({ text, x: rect.left + rect.width / 2, y: rect.top });
  };
  const hideTip = () => setTip(null);

  return (
    <div className="sj2" onMouseOver={showTip} onMouseLeave={hideTip}>
      <div className="app">
        <header className="topbar">
          <div className="brand" onClick={goProject} style={{ cursor: 'pointer' }} title="返回项目工作台">
            <div className="brand-mark">神</div>
            <div className="brand-name">一幕 · <em>神剪</em></div>
          </div>
          <div className="proj">
            <span className="proj-title">{data.project?.title || '未命名项目'}</span>
            <span className="proj-badge">{ratio} · {total.toFixed(1)}s</span>
            <span className={`save-dot${edl.dirty ? ' dirty' : ''}`} title={edl.dirty ? '改动待保存' : '已自动保存'} />
          </div>
          <div className="top-center">
            <button type="button" className="icon-btn" data-tip="撤销 (Ctrl+Z)" disabled={!edl.canUndo} onClick={() => edl.undo()}><Undo2 /></button>
            <button type="button" className="icon-btn" data-tip="重做 (Ctrl+Shift+Z)" disabled={!edl.canRedo} onClick={() => edl.redo()}><Redo2 /></button>
            <div className="seg">
              {(['9:16', '16:9', '1:1'] as Ratio[]).map((r) => (
                <button key={r} type="button" className={ratio === r ? 'on' : ''} onClick={() => setRatio(r)}>{r}</button>
              ))}
            </div>
            <div className="seg">
              <button type="button" className={previewQuality === 'fast' ? 'on' : ''} data-tip="流畅预览：540p 代理，剪辑不卡" onClick={() => setPreviewQuality('fast')}>流畅</button>
              <button type="button" className={previewQuality === 'original' ? 'on' : ''} data-tip="原画预览：加载原始分辨率" onClick={() => setPreviewQuality('original')}>原画</button>
            </div>
            <button type="button" className="chip" data-tip="拖动时吸附到其他片段边缘与播放头" onClick={() => setSnapOn(!snapOn)}>
              <Magnet /><span>{snapOn ? '吸附开' : '吸附关'}</span>
            </button>
          </div>
          <div className="top-right">
            <button type="button" className="chip" data-tip="镜头池：点镜头自动起播，可删除镜头" onClick={() => setRightTab((v) => (v === 'pool' ? 'inspector' : 'pool'))}><LayoutGrid />镜头池</button>
            <button type="button" className="chip" data-tip="查看全部剪映快捷键" onClick={() => setShortcutsOpen(true)}><Keyboard />快捷键</button>
            <button type="button" className="chip" data-tip="封面编辑：模板、标题、字号、颜色" onClick={() => setCoverOpen(true)}><ImageIcon />封面</button>
            <button type="button" className="chip primary" data-tip="导出成片 (Ctrl+E)" onClick={goExport}><Download />导出</button>
            <button type="button" className="chip" data-tip="返回项目工作台" onClick={goProject}><ArrowLeft />返回</button>
          </div>
        </header>

        <main className="workspace">
          <ShenJianLibrary onImport={() => setImportOpen(true)} />
          <ShenJianStage ratio={ratio} safe={safe} onToggleSafe={() => setSafe((v) => !v)} grade={grade} />
          {rightTab === 'pool' ? <ShenJianShotPool onBack={() => setRightTab('inspector')} /> : <ShenJianInspector grade={grade} setGrade={setGrade} />}
        </main>

        <ShenJianTimeline snapOn={snapOn} setSnapOn={setSnapOn} />
      </div>

      {tip ? (
        <div className="tooltip" style={{ display: 'block', left: tip.x, top: tip.y, transform: 'translate(-50%,-100%)' }}>
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

      <StudioFloatingChat />
    </div>
  );
};

export default ShenJianWorkbench;
