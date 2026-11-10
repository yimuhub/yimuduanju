/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas + 真实生成增强
 * 大模型弹窗：textarea / 放大 / 模型 pill / 翻译 / 提示词优化 / 发送
 * - 参考自动联动：双击节点时，左侧上游节点自动注入为参考（自动链接，可移除、可追加）
 * - 图片节点：风格（真实参数包）/ 参考 / 比例 / 分辨率 / 负面词 / 参考强度 / 张数
 * - 生成走三通道 API（后端代理），未配置时演示降级并在节点标注
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  Languages,
  Star,
  ArrowUp,
  ChevronDown,
  Sparkles,
  X,
  Captions,
} from 'lucide-react';
import { useP3Store } from './pavo3Store';
import { P3, RATIOS, RESOLUTIONS, PRESETS, COUNTS, STYLE_LIBRARY, VIDEO_DURATIONS, VIDEO_RESOLUTIONS, VIDEO_MODES, type StyleItem } from './pavo3Constants';
import { useCanvasModels } from './pavo3DynamicModels';
import type { DialogKind } from './pavo3Types';
import { pavo3 as pavo3Api } from '@client/src/api';

const PLACEHOLDERS: Record<string, string> = {
  text: '写下你想讲的故事、场景或角色设定。例如:一个来自未来的机器人，在城市屋顶看星星。',
  video: '描述你想生成的视频内容，@引用素材',
  audio: '描述你想生成的音频内容，如音色、风格、场景…',
  image: '描述你想要生成的画面内容，@引用素材',
  write: '输入内容...',
};

export const ModelDialog = () => {
  const { dialogNodeId, dialogKind, closeDialog, nodes } = useP3Store();
  const node = nodes.find((n) => n.id === dialogNodeId);

  const content = useMemo(() => {
    if (!node || !dialogKind) return null;
    return (
      <div
        className="p3-dialog-outer"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 40,
        }}
      >
        <DialogBody nodeId={node.id} kind={dialogKind} />
      </div>
    );
  }, [node, dialogKind]);

  if (!content) return null;
  return <>{content}</>;
};

function DialogBody({ nodeId, kind }: { nodeId: string; kind: DialogKind }) {
  if (kind === 'image') return <ImageGenPanel nodeId={nodeId} />;
  if (kind === 'video') return <VideoGenPanel nodeId={nodeId} />;
  // 创作类节点（剧本/角色/场景/分镜/备注）：属性面板 = 富文本编辑（与「自己编写」同通道保存）
  if (kind === 'write' || kind === 'script' || kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'storyboard' || kind === 'note') {
    return <WritePanel nodeId={nodeId} />;
  }
  return <TextGenDialog nodeId={nodeId} kind={kind} />;
}

/* ---------------- 自动参考提示条（上游注入提示） ---------------- */
function AutoRefNotice({ upstream }: { upstream: { id: string; title: string; kind: string }[] }) {
  if (upstream.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        marginBottom: 8, padding: '6px 10px', borderRadius: 8,
        background: 'rgba(10,188,207,0.06)', border: '1px solid rgba(10,188,207,0.25)',
        fontSize: 12, color: P3.helper,
      }}
    >
      <span style={{ fontWeight: 600, color: P3.primary }}>参考</span>
      {upstream.map((u) => (
        <span
          key={u.id}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1px 8px', borderRadius: 999,
            background: '#fff', border: `1px solid ${P3.border}`, color: P3.text,
          }}
        >
          {u.title} <span style={{ color: P3.primary, fontSize: 11 }}>自动</span>
        </span>
      ))}
    </div>
  );
}

/* ---------------- 文本 / 视频 / 音频 生成弹窗 ---------------- */
function TextGenDialog({ nodeId, kind }: { nodeId: string; kind: DialogKind }) {
  const [value, setValue] = useState('');
  const [full, setFull] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const { runGeneration, setModelSelectFor, closeDialog, selectedModels, nodes, getUpstreamRefs } = useP3Store();
  const { models: dynModels } = useCanvasModels(kind);
  const modelId = selectedModels[kind] ?? dynModels[0]?.id ?? '';
  const model = dynModels.find((m) => m.id === modelId);

  // 上游自动参考（实时计算，显示提示）
  const upstream = useMemo(
    () =>
      getUpstreamRefs(nodeId)
        .filter((n) => n.data.markdown || n.data.richText)
        .map((n) => ({ id: n.id, title: n.data.title, kind: n.data.nodeType })),
    [nodeId, getUpstreamRefs, nodes],
  );

  const send = () => {
    if (!value.trim()) return;
    closeDialog();
    runGeneration(nodeId, kind, value, model);
  };

  /** 提示词优化：真实调用大模型（后端代理）；失败则降级提示 */
  const optimize = useCallback(async () => {
    if (!value.trim() || optimizing) return;
    setOptimizing(true);
    const prev = value;
    try {
      const st = await pavo3Api.status();
      if (!st.configured) {
        setValue(prev + '\n\n> 提示词优化需要配置模型 API（设置 → 模型服务）');
        return;
      }
      const res = await pavo3Api.generate({
        type: 'text',
        prompt: `请优化以下短剧生成提示词，使其更具体、更有画面感、更适合AI生成。直接输出优化后的提示词，不要解释、不要加前缀：\n${prev}`,
      });
      if (res.ok && res.text) setValue(res.text.trim());
      else setValue(prev);
    } catch {
      /* 后端不可达：保留原文 */
    } finally {
      setOptimizing(false);
    }
  }, [value, optimizing]);

  /** 翻译：真实调用大模型；失败降级本地翻译 */
  const translate = useCallback(async () => {
    if (!value.trim()) return;
    const prev = value;
    try {
      const st = await pavo3Api.status();
      if (!st.configured) return;
      const res = await pavo3Api.generate({
        type: 'text',
        prompt: `请把以下内容翻译成简洁的英文 AI 生成提示词（保留关键视觉细节），直接输出翻译结果：\n${prev}`,
      });
      if (res.ok && res.text) setValue(res.text.trim());
    } catch {
      /* 忽略 */
    }
  }, [value]);

  return (
    <div className="p3-model-dialog">
      <button
        className="p3-icon-btn"
        style={{ position: 'absolute', top: 16, right: 16, width: 24, height: 24, borderRadius: 8 }}
        title="放大"
        onClick={() => setFull((v) => !v)}
      >
        <Maximize2 size={16} />
      </button>

      <AutoRefNotice upstream={upstream} />

      <textarea
        className="p3-textarea"
        rows={full ? 10 : 4}
        placeholder={PLACEHOLDERS[kind] ?? PLACEHOLDERS.text}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
        style={{ paddingRight: 40 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <button className="p3-model-pill" onClick={() => setModelSelectFor(kind)}>
          <span style={{ color: P3.helper, display: 'flex' }}>
            <SparkleIcon />
          </span>
          {model?.name ?? '选择模型'}
          <ChevronDown size={14} color={P3.helper} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="p3-icon-btn"
            title="提示词优化"
            onClick={optimize}
            style={{ opacity: optimizing ? 0.5 : 1 }}
          >
            <Sparkles size={16} />
          </button>
          <button
            className="p3-icon-btn"
            title="翻译提示词"
            onClick={translate}
          >
            <Languages size={16} />
          </button>
          <button className="p3-icon-btn" title="收藏">
            <Star size={16} />
          </button>
          <span style={{ fontSize: 12, color: P3.helper, minWidth: 14, textAlign: 'center' }}>0</span>
          <button className="p3-send-btn" disabled={!value.trim()} onClick={send} style={{ marginLeft: 6 }}>
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 图片生成面板 ---------------- */
function ImageGenPanel({ nodeId }: { nodeId: string }) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('9:16');
  const [res, setRes] = useState('1K');
  const [preset, setPreset] = useState('通用');
  const [count, setCount] = useState(1);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [refMode, setRefMode] = useState(false);
  const [refs, setRefs] = useState<string[]>([]);
  const [negative, setNegative] = useState('');
  const [strength, setStrength] = useState(0.5);
  const [style, setStyle] = useState<StyleItem | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const {
    runGeneration,
    setModelSelectFor,
    setStyleLibOpen,
    closeDialog,
    nodes,
    openDialog,
    selectedModels,
    getUpstreamRefs,
  } = useP3Store();
  const { models: imageModels } = useCanvasModels('image');
  const model = imageModels.find((m) => m.id === selectedModels.image);
  const myNode = nodes.find((n) => n.id === nodeId);

  // ── 参考自动联动：打开弹窗时自动注入左侧上游节点（递归）──
  const upstream = useMemo(
    () =>
      getUpstreamRefs(nodeId).map((n) => ({
        id: n.id,
        title: n.data.title,
        kind: n.data.nodeType,
      })),
    [nodeId, getUpstreamRefs, nodes],
  );
  const upstreamIds = useMemo(() => new Set(upstream.map((n) => n.id)), [upstream]);
  useEffect(() => {
    // 仅弹窗打开时合并一次（自动链接上游 + 保留手动选择）
    setRefs((prev) => [...new Set([...upstream.map((n) => n.id), ...prev])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // ── 参考模式：点击画布节点拾取（FreeCanvas3Page onNodeClick → p3-pick-ref）──
  useEffect(() => {
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === nodeId) return;
      setRefs((r) => (r.includes(id) ? r : [...r, id]));
      setRefMode(false);
      openDialog(nodeId, 'image');
    };
    window.addEventListener('p3-pick-ref', onPick);
    return () => window.removeEventListener('p3-pick-ref', onPick);
  }, [nodeId, openDialog]);

  // ── 风格库应用（StyleLibraryDialog → 自定义事件回写）──
  useEffect(() => {
    const onApply = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const s = STYLE_LIBRARY.find((x) => x.id === id);
      if (s) {
        setStyle(s);
        setStrength(s.strength);
      }
    };
    window.addEventListener('p3-apply-style', onApply);
    return () => window.removeEventListener('p3-apply-style', onApply);
  }, []);

  const send = () => {
    if (!prompt.trim() && refs.length === 0) return;
    closeDialog();
    runGeneration(nodeId, 'image', prompt, model, {
      refs,
      style,
      negative,
      ratio,
      strength,
      preset,
      count,
    });
  };

  // 参考模式：点击画布其他节点加入参考
  const pickRef = (targetId: string) => {
    if (targetId === nodeId) return;
    if (!refs.includes(targetId)) setRefs((r) => [...r, targetId]);
    setRefMode(false);
    openDialog(nodeId, 'image');
  };

  /** 提示词优化（真实 API） */
  const optimize = useCallback(async () => {
    if (!prompt.trim() || optimizing) return;
    setOptimizing(true);
    const prev = prompt;
    try {
      const st = await pavo3Api.status();
      if (!st.configured) {
        setPrompt(prev + '\n\n> 提示词优化需要配置模型 API（设置 → 模型服务）');
        return;
      }
      const res = await pavo3Api.generate({
        type: 'text',
        prompt: `请将以下中文描述扩写成一段高质量、具体、适合 AI 图像生成的英文提示词（包含主体、环境、光线、构图、质感）。直接输出英文提示词：\n${prev}`,
      });
      if (res.ok && res.text) setPrompt(res.text.trim());
    } catch {
      /* 忽略 */
    } finally {
      setOptimizing(false);
    }
  }, [prompt, optimizing]);

  const dropdownBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 2,
    padding: '8px 10px', borderRadius: 10, border: `1px solid ${P3.border}`,
    fontSize: 13, color: P3.text, cursor: 'pointer', background: '#fff',
  };

  return (
    <div className="p3-model-dialog">
      {refMode ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(10,188,207,0.08)', border: `1px solid rgba(10,188,207,0.3)`,
            borderRadius: 12, padding: '8px 12px', marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, color: P3.text }}>在当前画布中选择参考资产</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="p3-try-btn"
              style={{ width: 'auto', padding: '4px 10px', background: '#fff', border: `1px solid ${P3.border}` }}
              onClick={() => setRefMode(false)}
            >
              返回节点
            </button>
            <button
              className="p3-try-btn"
              style={{ width: 'auto', padding: '4px 10px', background: '#fff', border: `1px solid ${P3.border}` }}
              onClick={() => {
                setRefMode(false);
                closeDialog();
              }}
            >
              退出
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea
            className="p3-textarea"
            rows={3}
            placeholder="描述你想要生成的画面内容，@引用素材"
            value={prompt}
            autoFocus
            onChange={(e) => setPrompt(e.target.value)}
            style={{ paddingRight: 40 }}
          />

          {/* 上游自动参考提示 */}
          <AutoRefNotice upstream={upstream} />

          {/* 已选参考（自动 + 手动，可移除） */}
          {refs.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {refs.map((rid) => {
                const rn = nodes.find((n) => n.id === rid);
                const isAuto = upstreamIds.has(rid);
                return (
                  <span
                    key={rid}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 12, color: P3.text, background: P3.hover,
                      padding: '3px 8px', borderRadius: 999, border: `1px solid ${P3.border}`,
                    }}
                  >
                    {rn?.data.title ?? '参考'}
                    {isAuto && <span style={{ color: P3.primary, fontSize: 11 }}>自动</span>}
                    <button
                      onClick={() => setRefs((r) => r.filter((x) => x !== rid))}
                      style={{ color: P3.helper, cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* 风格 / 参考 / 当前风格 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="p3-try-btn" style={{ width: 'auto' }} onClick={() => setStyleLibOpen(true)}>
              <PaletteIcon /> 风格
            </button>
            <button className="p3-try-btn" style={{ width: 'auto' }} onClick={() => setRefMode(true)}>
              <RefIcon /> 参考
            </button>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 50, background: P3.hover,
                fontSize: 12, color: P3.text, marginLeft: 2,
              }}
            >
              {refs.length}
            </span>
            {style && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 12, color: P3.primary, background: 'rgba(10,188,207,0.08)',
                  padding: '3px 8px', borderRadius: 999, marginLeft: 6,
                }}
              >
                {style.name}
                <button onClick={() => setStyle(null)} style={{ color: P3.helper, cursor: 'pointer' }}>
                  <X size={12} />
                </button>
              </span>
            )}
          </div>

          {/* 负面提示词（可折叠输入） */}
          <div style={{ marginTop: 8 }}>
            <input
              className="p3-textarea"
              style={{ padding: '7px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${P3.border}`, background: '#FAFAFA' }}
              placeholder="负面提示词（不希望出现的内容，可留空）"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          {/* 参考强度滑杆 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: P3.helper, whiteSpace: 'nowrap' }}>参考强度</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              style={{ flex: 1, accentColor: P3.primary }}
            />
            <span style={{ fontSize: 12, color: P3.text, minWidth: 30, textAlign: 'right' }}>
              {Math.round(strength * 100)}%
            </span>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="p3-model-pill" onClick={() => setModelSelectFor('image')}>
          <SparkleIcon />
          {model?.name ?? '选择模型'}
          <ChevronDown size={14} color={P3.helper} />
        </button>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setRatioOpen((v) => !v); setResOpen(false); setPresetOpen(false); setCountOpen(false); }}>
            {ratio} <ChevronDown size={13} color={P3.helper} />
          </button>
          {ratioOpen && (
            <SelectMenu items={RATIOS} current={ratio} onPick={(v) => { setRatio(v); setRatioOpen(false); }} />
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setResOpen((v) => !v); setRatioOpen(false); setPresetOpen(false); setCountOpen(false); }}>
            {res} <ChevronDown size={13} color={P3.helper} />
          </button>
          {resOpen && (
            <SelectMenu items={RESOLUTIONS} current={res} onPick={(v) => { setRes(v); setResOpen(false); }} />
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setPresetOpen((v) => !v); setRatioOpen(false); setResOpen(false); setCountOpen(false); }}>
            {preset} <ChevronDown size={13} color={P3.helper} />
          </button>
          {presetOpen && (
            <SelectMenu items={PRESETS} current={preset} onPick={(v) => { setPreset(v); setPresetOpen(false); }} />
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setCountOpen((v) => !v); setRatioOpen(false); setResOpen(false); setPresetOpen(false); }}>
            {count}张 <ChevronDown size={13} color={P3.helper} />
          </button>
          {countOpen && (
            <SelectMenu items={COUNTS.map(String)} current={String(count)} onPick={(v) => { setCount(Number(v)); setCountOpen(false); }} />
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button
          className="p3-icon-btn"
          title="提示词优化"
          onClick={optimize}
          style={{ opacity: optimizing ? 0.5 : 1 }}
        >
          <Sparkles size={16} />
        </button>
        <button className="p3-icon-btn" title="收藏">
          <Star size={16} />
        </button>
        <span style={{ fontSize: 12, color: P3.helper, minWidth: 14, textAlign: 'center' }}>0</span>
        <button
          className="p3-send-btn"
          disabled={!prompt.trim() && refs.length === 0}
          onClick={send}
          style={{ marginLeft: 4 }}
        >
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- 视频生成面板（Pavo 同款：文生视频 / 全能参考 / 首尾帧 + 智能规则） ---------------- */
/**
 * 模式可用性规则（已确认方案）：
 * - 上游只有文字或没有上游 → 仅「文生视频」可选，另两个置灰并提示「需要图片参考」
 * - 上游含图片（图片前可有文字）→ 「文生视频」+「全能参考」可选；全能参考自动列出左侧图片为参考图，可继续添加
 * - 上游 ≥1 张图片 → 「首尾帧」可选；自动分配首帧/尾帧；首尾帧槽位支持上传本地图片与从画布选择
 * - 描述框为空时发送：全能参考自动生成「图片1…图片2…」组合提示词；首尾帧自动生成「图1是首帧，图2是尾帧…」
 */
function VideoGenPanel({ nodeId }: { nodeId: string }) {
  const [mode, setMode] = useState('文生视频');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState('8s');
  const [res, setRes] = useState('720P');
  // 画面内字幕默认关：模型把字烧进画面会与后期字幕叠加且无法改文案
  const [onScreenText, setOnScreenText] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [durOpen, setDurOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [refMode, setRefMode] = useState(false);
  const [framePicking, setFramePicking] = useState<'first' | 'last' | null>(null);
  const [firstFrameId, setFirstFrameId] = useState<string | null>(null);
  const [lastFrameId, setLastFrameId] = useState<string | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [negative, setNegative] = useState('');
  const [strength, setStrength] = useState(0.5);
  const [style, setStyle] = useState<StyleItem | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const {
    runGeneration,
    setModelSelectFor,
    setStyleLibOpen,
    closeDialog,
    nodes,
    openDialog,
    createNode,
    updateNodeData,
    selectedModels,
    getUpstreamRefs,
  } = useP3Store();
  const { models: videoModels } = useCanvasModels('video');
  const model = videoModels.find((m) => m.id === selectedModels.video);
  const myNode = nodes.find((n) => n.id === nodeId);

  // ── 参考自动联动：打开弹窗时自动注入左侧上游节点（递归）──
  const upstream = useMemo(
    () =>
      getUpstreamRefs(nodeId).map((n) => ({
        id: n.id,
        title: n.data.title,
        kind: n.data.nodeType,
      })),
    [nodeId, getUpstreamRefs, nodes],
  );
  const upstreamIds = useMemo(() => new Set(upstream.map((n) => n.id)), [upstream]);
  useEffect(() => {
    setRefs((prev) => [...new Set([...upstream.map((n) => n.id), ...prev])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // 可参考的图片节点（自动上游图片 + 手动参考中的图片节点）
  // 规则（用户确认）：只要前面有图片节点（按节点类型判定，不要求已生成图），
  // 「全能参考」与「首尾帧」两个模式一定可用；只有文字（或无上游）才只允许「文生视频」
  // P1 修复：upstream 已收敛为 {id,title,kind} 形态（无 .data），此处按 kind 判定，避免运行时崩溃
  const imageRefs = useMemo(() => {
    const ids = new Set<string>();
    for (const u of upstream) {
      if (u.kind === 'image') ids.add(u.id);
    }
    for (const rid of refs) {
      const n = nodes.find((x) => x.id === rid);
      if (n && n.data.nodeType === 'image') ids.add(rid);
    }
    return [...ids];
  }, [upstream, refs, nodes]);
  const hasImage = imageRefs.length > 0;

  // 模式可用性：无图片节点 → 仅「文生视频」（文字参考）；有图片节点 → 全能参考 + 首尾帧必可用
  const modeDisabled: Record<string, boolean> = {
    文生视频: false,
    全能参考: !hasImage,
    首尾帧: !hasImage,
  };

  // 打开弹窗时：只要上游有图片节点，默认进入「全能参考」（Pavo 同款优先参考模式）
  // 依赖 hasImage：上游 refs 为异步注入，首次 render 后 hasImage 才变 true，需二次触发
  const userTouchedMode = useRef(false);
  useEffect(() => {
    if (hasImage && !userTouchedMode.current) {
      setMode('全能参考');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, hasImage]);

  // ── 参考模式：点击画布节点拾取（FreeCanvas3Page onNodeClick → p3-pick-ref）──
  useEffect(() => {
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === nodeId) return;
      const target = nodes.find((n) => n.id === id);
      // 首尾帧槽位选取：只收图片
      if (framePicking) {
        if (target?.data.nodeType === 'image' && target.data.mediaUrl) {
          if (framePicking === 'first') setFirstFrameId(id);
          else setLastFrameId(id);
        }
        setFramePicking(null);
      } else {
        setRefs((r) => (r.includes(id) ? r : [...r, id]));
      }
      setRefMode(false);
      openDialog(nodeId, 'video');
    };
    window.addEventListener('p3-pick-ref', onPick);
    return () => window.removeEventListener('p3-pick-ref', onPick);
  }, [nodeId, openDialog, nodes, framePicking]);

  // ── 风格库应用（全局事件回写）──
  useEffect(() => {
    const onApply = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const st = STYLE_LIBRARY.find((x) => x.id === id);
      if (st) {
        setStyle(st);
        setStrength(st.strength);
      }
    };
    window.addEventListener('p3-apply-style', onApply);
    return () => window.removeEventListener('p3-apply-style', onApply);
  }, []);

  // 上传本地图片 → 作为视频节点的输入图片节点（画布资产，自动成为参考）
  const uploadToCanvas = (file: File, slot?: 'first' | 'last') => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base = myNode?.position ?? { x: 200, y: 200 };
      createNode('image', { x: base.x - 320, y: base.y + imageRefs.length * 40 }, { target: nodeId, autoOpen: false });
      const newImg = useP3Store.getState().nodes.find((n) => n.data.nodeType === 'image' && !n.data.mediaUrl);
      if (newImg) {
        useP3Store.getState().updateNodeData(newImg.id, {
          mediaUrl: dataUrl,
          mediaKind: 'image',
          status: 'done',
          title: `上传图片 ${newImg.data.title.replace(/图片节点 (\d+)/, '$1')}`,
        });
        if (slot === 'first') setFirstFrameId(newImg.id);
        else if (slot === 'last') setLastFrameId(newImg.id);
        else setRefs((r) => [...new Set([...r, newImg.id])]);
      }
    };
    reader.readAsDataURL(file);
  };

  // 描述自动生成（发送前，参考 Pavo 模板）
  const buildAutoPrompt = () => {
    if (prompt.trim()) return prompt.trim();
    if (mode === '首尾帧') {
      const f = nodes.find((n) => n.id === (firstFrameId ?? imageRefs[0]));
      const l = nodes.find((n) => n.id === (lastFrameId ?? imageRefs[1]));
      return `图1${f ? `（${f.data.title}）` : ''}是首帧，图2${l ? `（${l.data.title}）` : ''}是尾帧，从图1无缝转场过渡到图2`;
    }
    if (mode === '全能参考') {
      const parts = imageRefs.slice(0, 4).map((rid, i) => {
        const n = nodes.find((x) => x.id === rid);
        return `图片${i + 1}${n ? `（${n.data.title}）` : ''}参考画面`;
      });
      return parts.length ? `根据${parts.join('、')}，生成连贯自然的视频` : prompt;
    }
    return prompt.trim();
  };

  const send = () => {
    const finalPrompt = buildAutoPrompt();
    if (!finalPrompt && imageRefs.length === 0) return;
    // 首尾帧：保证首帧在前、尾帧第二（后端据此取首帧/尾帧）
    let ordered: string[] = imageRefs;
    if (mode === '首尾帧') {
      const f = firstFrameId ?? imageRefs[0];
      const l = lastFrameId ?? imageRefs[1];
      ordered = [...new Set([f, l, ...imageRefs].filter(Boolean))];
    }
    closeDialog();
    runGeneration(nodeId, 'video', finalPrompt, model, {
      refs: ordered,
      style,
      negative,
      ratio,
      strength,
      duration,
      mode,
      res,
      onScreenText,
    });
  };

  /** 提示词优化（真实 API） */
  const optimize = useCallback(async () => {
    if (!prompt.trim() || optimizing) return;
    setOptimizing(true);
    const prev = prompt;
    try {
      const st = await pavo3Api.status();
      if (!st.configured) {
        setPrompt(prev + '\n\n> 提示词优化需要配置模型 API（设置 → 模型服务）');
        return;
      }
      const res2 = await pavo3Api.generate({
        type: 'text',
        prompt: `请将以下中文描述扩写成一段高质量、具体、适合 AI 视频生成的英文提示词（包含主体、动作、运镜、环境、光线、氛围）。直接输出英文提示词：\n${prev}`,
      });
      if (res2.ok && res2.text) setPrompt(res2.text.trim());
    } catch {
      /* 忽略 */
    } finally {
      setOptimizing(false);
    }
  }, [prompt, optimizing]);

  /** 翻译（真实 API，失败静默） */
  const translate = useCallback(async () => {
    if (!prompt.trim()) return;
    const prev = prompt;
    try {
      const st = await pavo3Api.status();
      if (!st.configured) return;
      const res2 = await pavo3Api.generate({
        type: 'text',
        prompt: `请把以下内容翻译成简洁的英文 AI 生成提示词（保留关键视觉细节），直接输出翻译结果：\n${prev}`,
      });
      if (res2.ok && res2.text) setPrompt(res2.text.trim());
    } catch {
      /* 忽略 */
    }
  }, [prompt]);

  const dropdownBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 2,
    padding: '8px 10px', borderRadius: 10, border: `1px solid ${P3.border}`,
    fontSize: 13, color: P3.text, cursor: 'pointer', background: '#fff',
  };
  const frameSlot: React.CSSProperties = {
    flex: 1, minWidth: 120, borderRadius: 12, border: `1px dashed ${P3.border}`,
    padding: 8, textAlign: 'center', cursor: 'pointer', background: P3.hover,
  };

  return (
    <div className="p3-model-dialog">
      {/* 模式选项卡：文生视频 / 全能参考 / 首尾帧（Pavo 同款；禁用时置灰并提示） */}
      <div
        style={{
          display: 'flex', gap: 4, marginBottom: 12, alignItems: 'center',
          background: P3.hover, borderRadius: 10, padding: 3, width: 'fit-content',
        }}
      >
        {VIDEO_MODES.map((m) => {
          const disabled = modeDisabled[m];
          return (
            <button
              key={m}
              disabled={disabled}
              title={disabled ? '需要图片参考（左侧连接图片节点或添加参考）' : m}
              onClick={() => { userTouchedMode.current = true; setMode(m); }}
              style={{
                padding: '5px 14px', borderRadius: 8, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
                color: mode === m && !disabled ? '#fff' : disabled ? '#B5B5B5' : P3.text,
                background: mode === m && !disabled ? P3.primary : 'transparent',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {m}
            </button>
          );
        })}
        {!hasImage && (
          <span style={{ fontSize: 11, color: P3.helper, marginLeft: 6 }}>需要图片参考</span>
        )}
      </div>

      {refMode ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(10,188,207,0.08)', border: `1px solid rgba(10,188,207,0.3)`,
            borderRadius: 12, padding: '8px 12px', marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, color: P3.text }}>
            {framePicking ? `选择${framePicking === 'first' ? '首帧' : '尾帧'}图片` : '在当前画布中选择参考资产'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="p3-try-btn"
              style={{ width: 'auto', padding: '4px 10px', background: '#fff', border: `1px solid ${P3.border}` }}
              onClick={() => { setRefMode(false); setFramePicking(null); }}
            >
              返回节点
            </button>
            <button
              className="p3-try-btn"
              style={{ width: 'auto', padding: '4px 10px', background: '#fff', border: `1px solid ${P3.border}` }}
              onClick={() => { setRefMode(false); setFramePicking(null); closeDialog(); }}
            >
              退出
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea
            className="p3-textarea"
            rows={3}
            placeholder="描述你想要生成的视频内容，@引用素材（留空将根据参考自动生成）"
            value={prompt}
            autoFocus
            onChange={(e) => setPrompt(e.target.value)}
            style={{ paddingRight: 40 }}
          />

          {/* 上游自动参考提示 */}
          <AutoRefNotice upstream={upstream} />

          {/* 全能参考模式：参考图列表（可多张，自动 + 手动，可移除） */}
          {mode === '全能参考' && imageRefs.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {imageRefs.map((rid) => {
                const n = nodes.find((x) => x.id === rid);
                const isAuto = upstreamIds.has(rid);
                return (
                  <div
                    key={rid}
                    style={{
                      position: 'relative', width: 64, borderRadius: 10, overflow: 'hidden',
                      border: `1px solid ${P3.border}`, background: '#fff',
                    }}
                  >
                    {n?.data.mediaUrl ? (
                      <img src={n.data.mediaUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: P3.helper }}>无图</div>
                    )}
                    <span
                      style={{
                        position: 'absolute', left: 2, bottom: 2, fontSize: 10, color: '#fff',
                        background: 'rgba(0,0,0,0.55)', padding: '0 5px', borderRadius: 6,
                        maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {n?.data.title ?? '参考'}
                      {isAuto && ' ·自动'}
                    </span>
                    <button
                      onClick={() => setRefs((r) => r.filter((x) => x !== rid))}
                      style={{ position: 'absolute', right: 2, top: 2, width: 18, height: 18, borderRadius: 9, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 首尾帧模式：首帧 / 尾帧槽位（自动分配 + 上传 + 从画布选择） */}
          {mode === '首尾帧' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              {(['first', 'last'] as const).map((slot) => {
                const fid = slot === 'first' ? (firstFrameId ?? imageRefs[0]) : (lastFrameId ?? imageRefs[1]);
                const fn = nodes.find((x) => x.id === fid);
                const label = slot === 'first' ? '首帧' : '尾帧';
                return (
                  <div key={slot} style={frameSlot}>
                    <div style={{ fontSize: 11, color: P3.helper, marginBottom: 6 }}>{label}</div>
                    {fn?.data.mediaUrl ? (
                      <div style={{ position: 'relative' }}>
                        <img src={fn.data.mediaUrl} alt="" style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                        <button
                          onClick={() => (slot === 'first' ? setFirstFrameId(null) : setLastFrameId(null))}
                          style={{ position: 'absolute', right: 4, top: 4, padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, cursor: 'pointer' }}
                        >
                          取消选择
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: P3.helper, padding: '12px 0 4px' }}>未选择</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 6 }}>
                      <button
                        className="p3-try-btn"
                        style={{ width: 'auto', padding: '3px 8px', background: '#fff', border: `1px solid ${P3.border}` }}
                        onClick={() => { setFramePicking(slot); setRefMode(true); }}
                      >
                        从画布选择
                      </button>
                      <label
                        className="p3-try-btn"
                        style={{ width: 'auto', padding: '3px 8px', background: '#fff', border: `1px solid ${P3.border}`, cursor: 'pointer' }}
                      >
                        上传
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadToCanvas(f, slot);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 风格 / 参考 / 当前风格 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="p3-try-btn" style={{ width: 'auto' }} onClick={() => setStyleLibOpen(true)}>
              <PaletteIcon /> 风格
            </button>
            <button className="p3-try-btn" style={{ width: 'auto' }} onClick={() => setRefMode(true)}>
              <RefIcon /> 参考
            </button>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 50, background: P3.hover,
                fontSize: 12, color: P3.text, marginLeft: 2,
              }}
            >
              {imageRefs.length}
            </span>
            {style && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 12, color: P3.primary, background: 'rgba(10,188,207,0.08)',
                  padding: '3px 8px', borderRadius: 999, marginLeft: 6,
                }}
              >
                {style.name}
                <button onClick={() => setStyle(null)} style={{ color: P3.helper, cursor: 'pointer' }}>
                  <X size={12} />
                </button>
              </span>
            )}
          </div>

          {/* 负面提示词 */}
          <div style={{ marginTop: 8 }}>
            <input
              className="p3-textarea"
              style={{ padding: '7px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${P3.border}`, background: '#FAFAFA' }}
              placeholder="负面提示词（不希望出现的内容，可留空）"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          {/* 参考强度滑杆 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: P3.helper, whiteSpace: 'nowrap' }}>参考强度</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              style={{ flex: 1, accentColor: P3.primary }}
            />
            <span style={{ fontSize: 12, color: P3.text, minWidth: 30, textAlign: 'right' }}>
              {Math.round(strength * 100)}%
            </span>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="p3-model-pill" onClick={() => setModelSelectFor('video')}>
          <SparkleIcon />
          {model?.name ?? '选择模型'}
          <ChevronDown size={14} color={P3.helper} />
        </button>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setRatioOpen((v) => !v); setDurOpen(false); setResOpen(false); }}>
            {ratio} <ChevronDown size={13} color={P3.helper} />
          </button>
          {ratioOpen && (
            <SelectMenu items={RATIOS} current={ratio} onPick={(v) => { setRatio(v); setRatioOpen(false); }} />
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setDurOpen((v) => !v); setRatioOpen(false); setResOpen(false); }}>
            {duration} <ChevronDown size={13} color={P3.helper} />
          </button>
          {durOpen && (
            <SelectMenu items={VIDEO_DURATIONS} current={duration} onPick={(v) => { setDuration(v); setDurOpen(false); }} />
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button style={dropdownBtn} onClick={() => { setResOpen((v) => !v); setRatioOpen(false); setDurOpen(false); }}>
            {res} <ChevronDown size={13} color={P3.helper} />
          </button>
          {resOpen && (
            <SelectMenu items={VIDEO_RESOLUTIONS} current={res} onPick={(v) => { setRes(v); setResOpen(false); }} />
          )}
        </div>

        <button
          onClick={() => setOnScreenText((v) => !v)}
          title={
            onScreenText
              ? '模型会在画面内生成字幕/文字，后期字幕可能叠加'
              : '默认关闭：画面内不生成字幕/文字，字幕由后期统一添加'
          }
          style={{
            ...dropdownBtn,
            borderColor: onScreenText ? P3.primary : P3.border,
            color: onScreenText ? P3.primary : P3.text,
          }}
        >
          <Captions size={13} color={onScreenText ? P3.primary : P3.helper} />
          画面字幕 {onScreenText ? '开' : '关'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="p3-icon-btn"
            title="提示词优化"
            onClick={optimize}
            style={{ opacity: optimizing ? 0.5 : 1 }}
          >
            <Sparkles size={16} />
          </button>
          <button className="p3-icon-btn" title="翻译提示词" onClick={translate}>
            <Languages size={16} />
          </button>
          <button className="p3-icon-btn" title="收藏">
            <Star size={16} />
          </button>
          <button
            className="p3-send-btn"
            disabled={!buildAutoPrompt() && imageRefs.length === 0}
            onClick={send}
            style={{ marginLeft: 6 }}
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 自己编写 / 创作类节点属性面板（富文本） ---------------- */
function WritePanel({ nodeId }: { nodeId: string }) {
  const [html, setHtml] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { runGeneration, closeDialog, nodes } = useP3Store();
  const node = nodes.find((n) => n.id === nodeId);

  // 属性面板语义：预填节点已有内容（富文本 / markdown / 属性 profile）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefill = node?.data.richText || node?.data.markdown || node?.data.profile || '';
    if (prefill && !el.innerText.trim()) {
      el.innerText = prefill;
      setHtml(el.innerHTML);
    }
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
  };
  const toggleBlock = (tag: string) => {
    document.execCommand('formatBlock', false, tag);
  };

  const send = () => {
    const text = ref.current?.innerText ?? '';
    if (!text.trim()) return;
    closeDialog();
    // 创作类节点：专属属性 profile 与正文 markdown 同步保存
    if (node && (node.data.nodeType === 'script' || node.data.nodeType === 'character' || node.data.nodeType === 'scene' || node.data.nodeType === 'prop' || node.data.nodeType === 'storyboard' || node.data.nodeType === 'note')) {
      useP3Store.getState().updateNodeData(nodeId, { profile: text });
    }
    runGeneration(nodeId, 'write', text);
  };

  return (
    <div className="p3-model-dialog">
      <div className="p3-write-toolbar">
        <button className="p3-write-btn" title="H1" onMouseDown={(e) => { e.preventDefault(); toggleBlock('H1'); }}>H1</button>
        <button className="p3-write-btn" title="H2" onMouseDown={(e) => { e.preventDefault(); toggleBlock('H2'); }}>H2</button>
        <button className="p3-write-btn" title="H3" onMouseDown={(e) => { e.preventDefault(); toggleBlock('H3'); }}>H3</button>
        <button className="p3-write-btn" title="段落" onMouseDown={(e) => { e.preventDefault(); toggleBlock('P'); }}>¶</button>
        <span style={{ width: 1, height: 16, background: P3.border, margin: '0 4px' }} />
        <button className="p3-write-btn" title="加粗" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><b>B</b></button>
        <button className="p3-write-btn" title="斜体" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><i>I</i></button>
        <span style={{ width: 1, height: 16, background: P3.border, margin: '0 4px' }} />
        <button className="p3-write-btn" title="无序列表" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>≡</button>
        <button className="p3-write-btn" title="有序列表" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}>1.</button>
        <button className="p3-write-btn" title="分隔线" onMouseDown={(e) => { e.preventDefault(); exec('insertHorizontalRule'); }}>—</button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        style={{
          minHeight: 140, maxHeight: 320, overflow: 'auto',
          fontSize: 14, lineHeight: 1.7, color: P3.text, outline: 'none',
          padding: '6px 2px',
        }}
        onInput={(e) => setHtml((e.target as HTMLDivElement).innerHTML)}
      />
      {!html && (
        <div style={{ position: 'absolute', top: 46, left: 26, color: P3.weak, fontSize: 14, pointerEvents: 'none' }}>
          输入内容...
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button
          className="p3-send-btn"
          disabled={!html.trim()}
          onClick={send}
        >
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- 小工具 ---------------- */
function SelectMenu({ items, current, onPick }: { items: string[]; current: string; onPick: (v: string) => void }) {
  return (
    <div
      style={{
        position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 90,
        background: '#fff', border: `1px solid ${P3.border}`, borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 88,
      }}
    >
      {items.map((it) => (
        <button
          key={it}
          onClick={() => onPick(it)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
            borderRadius: 6, fontSize: 13, cursor: 'pointer',
            color: it === current ? P3.primary : P3.text,
            background: it === current ? 'rgba(10,188,207,0.08)' : 'transparent',
          }}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l1.2 3.8L13 7l-3.8 1.2L8 12l-1.2-3.8L3 7l3.8-1.2L8 2z" fill="#0ABCCF" />
      <path d="M13 10l.6 1.9L15.5 12.5l-1.9.6L13 15l-.6-1.9-1.9-.6 1.9-.6L13 10z" fill="#7FB8FF" />
    </svg>
  );
}
function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 1.5a7.5 7.5 0 100 15c.8 0 1.2-.5 1.2-1.1 0-.8-.5-1-1.2-1.4-.6-.3-1-.9-1-.9h2.3c2 0 3.7-1.6 3.7-3.6C14 5 11.8 1.5 9 1.5z" stroke="#0ABCCF" strokeWidth="1.4" />
      <circle cx="5.5" cy="7" r="1" fill="#0ABCCF" />
      <circle cx="8" cy="4.8" r="1" fill="#0ABCCF" />
      <circle cx="11" cy="6.5" r="1" fill="#0ABCCF" />
    </svg>
  );
}
function RefIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2" stroke="#0ABCCF" strokeWidth="1.4" />
      <path d="M5 10l3-3 2 2 2.5-2.5" stroke="#0ABCCF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
