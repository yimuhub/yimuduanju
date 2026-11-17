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

  const setGrade = (patch: Partial<typeof grade>) => setGradeState((prev) => ({ ...prev, ...patch }));

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

      if (mod && key === 's') { e.preventDefault(); void edl.saveNow(); toast.success('时间线已保存'); return; }
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); edl.undo(); return; }
      if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) { e.preventDefault(); edl.redo(); return; }
      if (mod && key === 'c') { e.preventDefault(); edl.copySelection(edl.selectedIds); return; }
      if (mod && key === 'x') { e.preventDefault(); edl.cutSelection(edl.selectedIds); return; }
      if (mod && key === 'v') { e.preventDefault(); edl.pasteAt(curT); return; }
      if (mod && key === 'a') { e.preventDefault(); edl.setSelection((data.timeline?.clips ?? []).map((c) => c.id)); return; }
      if (mod && key === 'e') { e.preventDefault(); goExport(); return; }
      if (mod && key === 'b') { e.preventDefault(); split(); return; }
      if (mod && key === '/') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (mod && (key === '+' || key === '=')) { e.preventDefault(); return; }
      if (mod) return;

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
      if (key === '?') { e.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [curT, data.timeline?.clips, edl, playing, selected, setCurT, setPlaying, snapOn, total]);

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
