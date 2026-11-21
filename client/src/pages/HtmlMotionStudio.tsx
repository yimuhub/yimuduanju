import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  buildSceneDocument,
  motionDuration,
  newScene,
  type MotionDocument,
  type MotionProject,
  type MotionScene,
} from '@shared/html-motion';
import {
  createMotionProject,
  deleteMotionProject,
  getMotionProject,
  getMotionRender,
  listMotionProjects,
  startMotionRender,
  updateMotionProject,
  type MotionRenderJob,
} from '../api/motion';
import '../styles/html-motion.css';

const TEMPLATES: Array<{ name: string; html: string }> = [
  {
    name: '文字上升',
    html: `<div class="scene"><h1>标题<br><em>逐行出现</em></h1><p>SUB TITLE</p></div>
<style>
html,body{margin:0;height:100%;background:#0b0d10;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif;color:#fff}
.scene{height:100%;display:grid;place-content:center;text-align:center}
h1{font-size:86px;line-height:1.08;margin:0;letter-spacing:-.04em}
h1 em{font-style:normal;color:#2ee6cf}
p{letter-spacing:.36em;color:#8d949e;margin-top:24px;font-size:15px}
h1,p{animation:up .9s both}
p{animation-delay:.35s}
@keyframes up{from{opacity:0;translate:0 40px;filter:blur(10px)}to{opacity:1;translate:0 0;filter:blur(0)}}
</style>`,
  },
  {
    name: '玻璃卡片',
    html: `<div class="wrap"><article><i>01</i><h2>代码即画面</h2><p>实时预览 · 逐帧渲染</p></article><article><i>02</i><h2>场景即片段</h2><p>拖动排序 · 单段改时长</p></article></div>
<style>
html,body{margin:0;height:100%;background:radial-gradient(80% 80% at 20% 0%,#173c3a,#080a0c 60%);overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
.wrap{height:100%;display:grid;gap:20px;place-content:center;padding:8%}
article{width:820px;padding:36px;border-radius:26px;border:1px solid #ffffff1f;background:#ffffff0d;backdrop-filter:blur(20px);color:#fff;display:grid;grid-template-columns:80px 1fr;gap:4px 20px;animation:in .8s both}
article:nth-child(2){animation-delay:.15s;margin-left:90px}
i{grid-row:span 2;font-style:normal;font-size:44px;color:#2ee6cf;align-self:center}
h2{margin:0;font-size:34px}p{margin:0;color:#9aa3ad}
@keyframes in{from{opacity:0;translate:0 32px}to{opacity:1;translate:0 0}}
</style>`,
  },
  {
    name: '数字冲击',
    html: `<div class="scene"><span class="n">24</span><p>FPS · 逐帧可控</p><div class="bar"></div></div>
<style>
html,body{margin:0;height:100%;background:#ff403a;overflow:hidden;font-family:Inter,"PingFang SC",sans-serif}
.scene{height:100%;display:grid;place-content:center;text-align:center;color:#111}
.n{font-size:250px;font-weight:900;line-height:.9;letter-spacing:-.06em;animation:pop .7s cubic-bezier(.2,1.4,.4,1) both}
p{font-size:18px;letter-spacing:.2em;margin:26px 0 0;font-weight:600;animation:in .8s .2s both}
.bar{height:8px;background:#111;width:0;margin:34px auto 0;animation:grow 1.2s .3s both}
@keyframes pop{from{scale:.4;opacity:0}to{scale:1;opacity:1}}
@keyframes in{from{opacity:0}to{opacity:1}}
@keyframes grow{to{width:70%}}
</style>`,
  },
];

function fmt(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export default function HtmlMotionStudio() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<MotionProject[]>([]);
  const [project, setProject] = useState<MotionProject | null>(null);
  const [activeId, setActiveId] = useState('');
  const [localTime, setLocalTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codeOpen, setCodeOpen] = useState(true);
  const [previewHtml, setPreviewHtml] = useState('');
  const [job, setJob] = useState<MotionRenderJob | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playRef = useRef({ localTime, activeId, project, playing });
  const dragIndex = useRef<number | null>(null);
  const pastRef = useRef<MotionDocument[]>([]);
  const futureRef = useRef<MotionDocument[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const doc = project?.document;
  const activeScene = doc?.scenes.find((s) => s.id === activeId) ?? doc?.scenes[0];
  const total = doc ? motionDuration(doc) : 0;
  const offset = useMemo(() => {
    if (!doc || !activeScene) return 0;
    return doc.scenes.slice(0, doc.scenes.indexOf(activeScene)).reduce((a, s) => a + s.duration, 0);
  }, [doc, activeScene]);
  const globalTime = offset + localTime;

  const load = useCallback(async (pid: string) => {
    const p = await getMotionProject(pid);
    setProject(p);
    setActiveId((prev) => p.document.scenes.find((s) => s.id === prev)?.id ?? p.document.scenes[0]?.id ?? '');
    setLocalTime(1.2);
    setDirty(false);
    navigate(`/motion/${p.id}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listMotionProjects();
        if (!alive) return;
        setProjects(list);
        if (id) {
          await load(id);
        } else if (list[0]) {
          await load(list[0].id);
        }
      } catch (e) {
        setError((e as Error).message || '加载失败');
      }
    })();
    return () => { alive = false; };
  }, [id, load]);

  useEffect(() => {
    if (project) playRef.current = { localTime, activeId, project, playing };
  }, [localTime, activeId, project, playing]);

  // 输入防抖，避免每敲一个字 iframe 整页重载
  useEffect(() => {
    if (!activeScene || !doc) return;
    const timer = setTimeout(() => setPreviewHtml(buildSceneDocument(activeScene, doc)), 420);
    return () => clearTimeout(timer);
  }, [activeScene?.id, activeScene?.html, doc?.width, doc?.height, doc?.background]);

  useEffect(() => {
    const onMsg = () => {
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage({ type: 'hf-seek', t: localTime }, '*');
    };
    const iframe = iframeRef.current;
    iframe?.addEventListener('load', onMsg);
    onMsg();
    return () => iframe?.removeEventListener('load', onMsg);
  }, [previewHtml, localTime]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.12, (now - last) / 1000);
      last = now;
      const s = playRef.current;
      const p = s.project;
      if (!p) return;
      const scene = p.document.scenes.find((x) => x.id === s.activeId) ?? p.document.scenes[0];
      const idx = p.document.scenes.indexOf(scene);
      let nt = s.localTime + dt;
      if (nt >= scene.duration) {
        const next = p.document.scenes[idx + 1];
        if (!next) {
          setLocalTime(scene.duration);
          setPlaying(false);
          return;
        }
        nt = 0;
        setActiveId(next.id);
      }
      setLocalTime(nt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const remember = () => {
    if (!project) return;
    pastRef.current = [...pastRef.current.slice(-49), JSON.parse(JSON.stringify(project.document))];
    futureRef.current = [];
    setUndoCount(pastRef.current.length);
    setRedoCount(0);
  };

  const commitDoc = (next: MotionDocument) => {
    if (!project) return;
    remember();
    setProject({ ...project, document: next });
    setDirty(true);
  };

  const undo = () => {
    if (!project || !pastRef.current.length) return;
    const prev = pastRef.current.pop() as MotionDocument;
    futureRef.current = [JSON.parse(JSON.stringify(project.document)), ...futureRef.current.slice(0, 49)];
    setProject({ ...project, document: prev });
    setUndoCount(pastRef.current.length);
    setRedoCount(futureRef.current.length);
    setDirty(true);
  };

  const redo = () => {
    if (!project || !futureRef.current.length) return;
    const next = futureRef.current.shift() as MotionDocument;
    pastRef.current = [...pastRef.current.slice(-49), JSON.parse(JSON.stringify(project.document))];
    setProject({ ...project, document: next });
    setUndoCount(pastRef.current.length);
    setRedoCount(futureRef.current.length);
    setDirty(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const patchDoc = (patch: Partial<MotionDocument>) => {
    if (!project) return;
    commitDoc({ ...project.document, ...patch });
  };

  const patchScene = (sceneId: string, patch: Partial<MotionScene>) => {
    if (!project) return;
    commitDoc({
      ...project.document,
      scenes: project.document.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
    });
  };

  const save = async () => {
    if (!project) return;
    setSaving(true);
    setError('');
    try {
      const p = await updateMotionProject(project.id, {
        title: project.title,
        document: project.document,
      });
      setProject(p);
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      setDirty(false);
    } catch (e) {
      setError((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const create = async (title = '未命名 HTML 动画', scene?: MotionScene) => {
    try {
      const base = project?.document;
      const p = await createMotionProject({
        title,
        document: base ? { ...base, scenes: scene ? [scene] : base.scenes } : undefined,
      });
      setProjects((prev) => [p, ...prev]);
      await load(p.id);
    } catch (e) {
      setError((e as Error).message || '新建失败');
    }
  };

  const addScene = (tpl?: { name: string; html: string }) => {
    if (!doc) return;
    const scene = tpl
      ? { id: `scene-${Date.now()}`, name: tpl.name, duration: 3, html: tpl.html }
      : newScene(doc.scenes.length);
    patchDoc({ scenes: [...doc.scenes, scene] });
    setActiveId(scene.id);
    setLocalTime(0);
  };

  const removeScene = (sceneId: string) => {
    if (!doc || doc.scenes.length <= 1) return;
    const idx = doc.scenes.findIndex((s) => s.id === sceneId);
    const scenes = doc.scenes.filter((s) => s.id !== sceneId);
    patchDoc({ scenes });
    if (activeId === sceneId) {
      setActiveId(scenes[Math.max(0, idx - 1)].id);
      setLocalTime(0);
    }
  };

  const duplicateScene = (scene: MotionScene) => {
    if (!doc) return;
    const copy = { ...scene, id: `scene-${Date.now()}`, name: `${scene.name} 副本` };
    const idx = doc.scenes.findIndex((s) => s.id === scene.id);
    const scenes = [...doc.scenes];
    scenes.splice(idx + 1, 0, copy);
    patchDoc({ scenes });
    setActiveId(copy.id);
    setLocalTime(1.2);
  };

  const moveScene = (from: number, to: number) => {
    if (!doc || from === to || to < 0 || to >= doc.scenes.length) return;
    const scenes = [...doc.scenes];
    const [item] = scenes.splice(from, 1);
    scenes.splice(to, 0, item);
    patchDoc({ scenes });
  };

  const seekGlobal = (t: number) => {
    if (!doc) return;
    let acc = 0;
    for (const s of doc.scenes) {
      if (t < acc + s.duration || s === doc.scenes[doc.scenes.length - 1]) {
        setActiveId(s.id);
        setLocalTime(Math.max(0, Math.min(s.duration, t - acc)));
        return;
      }
      acc += s.duration;
    }
  };

  const render = async () => {
    if (!project) return;
    if (dirty) await save();
    setRenderOpen(true);
    setError('');
    try {
      const j = await startMotionRender(project.id);
      setJob(j);
      const poll = async () => {
        const latest = await getMotionRender(j.id);
        setJob(latest);
        if (latest.status === 'done' || latest.status === 'failed') return;
        setTimeout(poll, 1200);
      };
      setTimeout(poll, 900);
    } catch (e) {
      setError((e as Error).message || '渲染启动失败');
      setRenderOpen(false);
    }
  };

  if (!project || !doc || !activeScene) {
    return (
      <div className="hm-shell hm-empty">
        <div>
          <h2>HTML 动画工作室</h2>
          <p>把 HTML / CSS / JS 直接渲染成 MP4。{error && <span className="hm-error">{error}</span>}</p>
          <button className="hm-primary" onClick={() => create()}>新建第一个工程</button>
          <Link className="hm-ghost" to="/">返回项目列表</Link>
        </div>
      </div>
    );
  }

  const sceneIndex = doc.scenes.indexOf(activeScene);
  const scale = Math.min(1, 610 / doc.height, 680 / doc.width);
  const frameW = Math.round(doc.width * scale);
  const frameH = Math.round(doc.height * scale);

  return (
    <div className="hm-shell">
      <header className="hm-header">
        <div className="hm-brand">
          <Link to="/" className="hm-back">←</Link>
          <span className="hm-logo">YIMU</span>
          <strong>HTML MOTION</strong>
        </div>
        <div className="hm-title-edit">
          <input
            value={project.title}
            onChange={(e) => {
              setProject({ ...project, title: e.target.value });
              setDirty(true);
            }}
            aria-label="工程名称"
          />
          {dirty && <span className="hm-dot" title="有未保存修改" />}
        </div>
        <div className="hm-actions">
          <button className="hm-icon" disabled={!undoCount} title="撤销 (⌘Z)" onClick={undo}>↶</button>
          <button className="hm-icon" disabled={!redoCount} title="重做 (⇧⌘Z)" onClick={redo}>↷</button>
          <button className="hm-btn" onClick={() => create('未命名 HTML 动画')}>新建工程</button>
          <button className="hm-btn" onClick={save} disabled={saving}>
            {saving ? '保存中…' : dirty ? '保存' : '已保存'}
          </button>
          <button className="hm-primary" onClick={render}>渲染 MP4</button>
        </div>
      </header>

      {error && <div className="hm-toast" onClick={() => setError('')}>{error}</div>}

      <main className="hm-main">
        <aside className="hm-left">
          <div className="hm-panel-head">
            <span>工程</span>
            <select
              value={project.id}
              onChange={(e) => load(e.target.value)}
              aria-label="切换工程"
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>

          <div className="hm-panel-head hm-scenes-head">
            <span>场景 · {doc.scenes.length}</span>
            <div>
              <button className="hm-icon" title="新建空白场景" onClick={() => addScene()}>＋</button>
              <button className="hm-icon" title="删除当前工程" onClick={async () => {
                if (!confirm(`删除工程「${project.title}」？`)) return;
                await deleteMotionProject(project.id);
                const rest = projects.filter((p) => p.id !== project.id);
                setProjects(rest);
                if (rest[0]) await load(rest[0].id);
                else setProject(null);
              }}>⌫</button>
            </div>
          </div>

          <div className="hm-scene-list">
            {doc.scenes.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={() => { dragIndex.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex.current != null) moveScene(dragIndex.current, i);
                  dragIndex.current = null;
                }}
                className={`hm-scene-card ${s.id === activeId ? 'is-active' : ''}`}
                onClick={() => { setActiveId(s.id); setLocalTime(1.2); setPlaying(false); }}
              >
                <div className="hm-scene-thumb">
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <i />
                </div>
                <div className="hm-scene-meta">
                  <b>{s.name}</b>
                  <small>{s.duration.toFixed(1)}s · HTML</small>
                </div>
                <button
                  className="hm-mini"
                  title="删除场景"
                  onClick={(e) => { e.stopPropagation(); removeScene(s.id); }}
                >×</button>
              </div>
            ))}
            <button className="hm-add-scene" onClick={() => addScene()}>＋ 添加场景</button>
          </div>

          <div className="hm-tpl">
            <div className="hm-panel-head"><span>场景模板</span></div>
            <div className="hm-tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.name} onClick={() => addScene(t)}>{t.name}</button>
              ))}
            </div>
          </div>
        </aside>

        <section className="hm-center">
          <div className="hm-center-bar">
            <div className="hm-center-left">
              <span className="hm-chip">{activeScene.name}</span>
              <span className="hm-muted">场景 {sceneIndex + 1}/{doc.scenes.length}</span>
            </div>
            <div className="hm-transport">
              <button className="hm-icon" title="回到开头" onClick={() => setLocalTime(0)}>⏮</button>
              <button className="hm-play" onClick={() => setPlaying((v) => !v)} title={playing ? '暂停' : '播放'}>
                {playing ? 'Ⅱ' : '▶'}
              </button>
              <span className="hm-time">{fmt(globalTime)}</span>
              <span className="hm-muted">/ {fmt(total)}</span>
            </div>
            <div className="hm-center-right">
              <button className={`hm-btn ${codeOpen ? 'is-on' : ''}`} onClick={() => setCodeOpen((v) => !v)}>
                &lt;/&gt; 代码
              </button>
            </div>
          </div>

          <div className={`hm-work ${codeOpen ? 'with-code' : ''}`}>
            <div className="hm-stage-wrap">
              <div className="hm-stage" style={{ width: frameW, height: frameH }}>
                <iframe
                  ref={iframeRef}
                  title="HTML 动画预览"
                  srcDoc={previewHtml || buildSceneDocument(activeScene, doc)}
                  sandbox="allow-scripts"
                  style={{ width: doc.width, height: doc.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                />
              </div>
              <div className="hm-stage-foot">
                <span>{doc.width} × {doc.height}</span>
                <span>{doc.fps} fps</span>
                <span>{activeScene.duration.toFixed(2)}s</span>
                <span className="hm-live"><i /> LIVE PREVIEW</span>
              </div>
            </div>

            {codeOpen && (
              <div className="hm-code">
                <div className="hm-code-head">
                  <span><i /> scene-{String(sceneIndex + 1).padStart(2, '0')}.html</span>
                  <span className="hm-muted">可写 CSS 动画 / WAAPI / __hfSeek(t)</span>
                </div>
                <textarea
                  spellCheck={false}
                  value={activeScene.html}
                  onChange={(e) => patchScene(activeScene.id, { html: e.target.value })}
                />
                <div className="hm-code-foot">
                  <span>保存后逐帧 seek 截图 · {Math.round(activeScene.duration * doc.fps)} 帧</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="hm-right">
          <div className="hm-panel-head"><span>检查器</span></div>
          <div className="hm-inspector">
            <label>场景名称
              <input value={activeScene.name} onChange={(e) => patchScene(activeScene.id, { name: e.target.value })} />
            </label>
            <label>时长（秒）
              <input
                type="number" min={0.2} max={30} step={0.1}
                value={activeScene.duration}
                onChange={(e) => patchScene(activeScene.id, { duration: Math.max(0.2, Number(e.target.value) || 0.2) })}
              />
            </label>
            <div className="hm-sec">画布</div>
            <div className="hm-row2">
              <label>宽度
                <input type="number" min={320} max={2160} value={doc.width}
                  onChange={(e) => patchDoc({ width: Math.max(320, Number(e.target.value) || 1080) })} />
              </label>
              <label>高度
                <input type="number" min={320} max={3840} value={doc.height}
                  onChange={(e) => patchDoc({ height: Math.max(320, Number(e.target.value) || 1920) })} />
              </label>
            </div>
            <div className="hm-row2">
              <label>帧率
                <input type="number" min={12} max={60} value={doc.fps}
                  onChange={(e) => patchDoc({ fps: Math.min(60, Math.max(12, Number(e.target.value) || 24)) })} />
              </label>
              <label>底色
                <input type="color" value={doc.background}
                  onChange={(e) => patchDoc({ background: e.target.value })} />
              </label>
            </div>
            <div className="hm-sec">工程</div>
            <div className="hm-info"><span>总时长</span><b>{total.toFixed(2)}s</b></div>
            <div className="hm-info"><span>总帧数</span><b>{Math.round(total * doc.fps)}</b></div>
            <div className="hm-info"><span>渲染</span><b>Chrome → FFmpeg</b></div>
            <div className="hm-sec">快捷操作</div>
            <button className="hm-block-btn" onClick={() => duplicateScene(activeScene)}>⧉ 复制当前场景</button>
            <button className="hm-block-btn" onClick={() => addScene(TEMPLATES[0])}>＋ 复制片头模板</button>
            <button className="hm-block-btn" onClick={() => { setActiveId(activeScene.id); setLocalTime(activeScene.duration); }}>跳到本场景末尾</button>
            <p className="hm-hint">HyperFrames 契约：每帧 seek 后截图，CSS 动画全部按时间轴定位，不靠录屏。</p>
          </div>
        </aside>
      </main>

      <footer className="hm-timeline">
        <div className="hm-tl-head">
          <div className="hm-tl-title">时间线 <span>· 拖动场景卡片可排序</span></div>
          <div className="hm-tl-zoom">{fmt(globalTime)}</div>
        </div>
        <div className="hm-tl-ruler">
          {Array.from({ length: 11 }).map((_, i) => (
            <span key={i} style={{ left: `${i * 10}%` }}>{fmt((total * i) / 10)}</span>
          ))}
        </div>
        <div className="hm-tl-tracks">
          <div className="hm-track-label">场景</div>
          <div className="hm-track hm-track-scenes">
            {doc.scenes.map((s, i) => (
              <div
                key={s.id}
                className={`hm-clip ${s.id === activeId ? 'is-active' : ''}`}
                style={{ width: `${(s.duration / total) * 100}%` }}
                onClick={() => seekGlobal(doc.scenes.slice(0, i).reduce((a, x) => a + x.duration, 0) + 0.01)}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                <b>{s.name}</b>
                <small>{s.duration.toFixed(1)}s</small>
              </div>
            ))}
          </div>
        </div>
        <div className="hm-tl-tracks">
          <div className="hm-track-label">代码层</div>
          <div className="hm-track hm-track-code">
            {doc.scenes.map((s) => (
              <div key={s.id} className="hm-codeclip" style={{ width: `${(s.duration / total) * 100}%` }}>
                &lt;html&gt; · {Math.round(s.duration * doc.fps)}f
              </div>
            ))}
          </div>
        </div>
        <div className="hm-playhead" style={{ left: `calc(88px + (100% - 88px) * ${total ? globalTime / total : 0})` }} />
        <div className="hm-timeline-foot">
          <span>Drag to reorder</span>
          <span>·</span>
          <span>Click to seek</span>
          <span className="hm-tl-total">{doc.scenes.length} scenes · {Math.round(total * doc.fps)} frames</span>
        </div>
      </footer>

      {renderOpen && (
        <div className="hm-modal" onClick={() => job?.status !== 'done' && setRenderOpen(false)}>
          <div className="hm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="hm-modal-head">
              <span>渲染 · {project.title}</span>
              <button className="hm-icon" onClick={() => setRenderOpen(false)}>×</button>
            </div>
            <div className="hm-render-body">
              <div className="hm-render-ring" style={{ ['--p' as string]: `${job?.progress ?? 0}%` }}>
                <b>{job?.progress ?? 0}%</b>
              </div>
              <div className="hm-render-info">
                <strong>{job?.status === 'done' ? '渲染完成' : job?.status === 'failed' ? '渲染失败' : '正在渲染'}</strong>
                <span>{job?.message || '正在创建任务…'}</span>
                <small>{doc.width}×{doc.height} · {doc.fps}fps · {Math.round(total * doc.fps)} 帧</small>
              </div>
            </div>
            {job?.status === 'failed' && <div className="hm-error">{job.error}</div>}
            {job?.status === 'done' && job.outputUrl && (
              <>
                <video className="hm-render-video" src={job.outputUrl} controls />
                <div className="hm-modal-actions">
                  <a className="hm-primary" href={job.outputUrl} download={`${project.title}.mp4`}>下载 MP4</a>
                  <button className="hm-btn" onClick={() => setRenderOpen(false)}>关闭</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
