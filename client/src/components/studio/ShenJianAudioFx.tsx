/**
 * 音频效果区块（FX rack）
 * -------------------------------------------------------------
 * 检查器「音频」页签里的一段：信号路径条（In → 节点 chips → Out）+ 节点行
 * （bypass / 上移下移 / 删除 / 展开参数）+ 按组添加 + 具名一键决策。
 *
 * 交互语义对齐 OpenMotion FxSection：
 *   · 拖动滑杆只做实时预览（派发 PREVIEW_AUDIO_FX_EVENT，Stage 原位更新
 *     WebAudio 参数），松手 / 失焦才 commit 一次进 EDL；
 *   · 节点顺序 = 信号路径，上移下移即重排，导出按同一顺序翻译成 ffmpeg 滤镜；
 *   · 挂在画面片段上的 FX 作用于其内嵌原声（useEdlEditor.setClipAudioFx
 *     会镜像到 auto: 音频片段，导出读 auto 音频 part）。
 * FX 参数自动化（OpenMotion AutomationToggle 语义）：每个参数行一枚「A」开关——
 * 开启 = 以当前值在 t=0 播种单点包络（绝对值，范围随注册表），时间线展开区画
 * lane（双击加点/拖点/右键删点）；关闭 = 清除该参数自动化，值交还滑杆。
 * 自动化中的参数滑杆禁用（lane 已接管取值，滑杆值只剩种子语义，与 OpenMotion
 * 「automated 控件锁定」一致）。
 */
import { useEffect, useState } from 'react';
import {
  AUDIO_FX_GROUPS,
  AUDIO_FX_JOBS,
  AUDIO_FX_PARAM_DEFS,
  AUDIO_FX_TYPE_LABEL,
  AUDIO_FX_TYPE_SHORT,
  clampAudioFxParams,
  formatAudioFxParamValue,
  makeAudioFxNode,
  type AudioFxNodeType,
  type AudioFxParamDef,
  type TimelineClipAudioFxNode,
} from '@shared/timeline-audio-fx';
import type { TimelineClip } from '@shared/api.interface';
import { useEdl } from './EdlContext';

/** FX 拖动实时预览事件：Stage 监听；detail=null 清空（commit 后由这里派发） */
export const PREVIEW_AUDIO_FX_EVENT = 'yimu:shenjian-preview-audio-fx';

const dispatchFxPreview = (detail: { id: string; nodes: TimelineClipAudioFxNode[] } | null) => {
  window.dispatchEvent(new CustomEvent(PREVIEW_AUDIO_FX_EVENT, { detail }));
};

/** 节点在路径条 / 行头的短名（与时间线 FX lane 标签共用注册表） */
const CHIP_LABEL: Record<AudioFxNodeType, string> = AUDIO_FX_TYPE_SHORT;

/** 自动化开着的参数行头的小包络折线（12×12 内联 SVG，随品牌红变色） */
const EnvelopeGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <polyline points="1,9 4,3 7,7 11,2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/**
 * 单参数滑杆：拖动中本地持有 + 实时预览，松手/失焦 commit（OpenMotion Fader
 * 同一手法——纯受控输入会在第一笔就把 fader 弹回旧值）。
 * automated = 该参数已有自动化 lane：滑杆锁定（值由时间线包络驱动），行头
 * 显示包络小图标；开关由 AutomationToggle 语义接管。
 */
const FxSlider = ({
  def,
  value,
  automated,
  onPreview,
  onCommit,
  onToggleAutomation,
}: {
  def: AudioFxParamDef;
  value: number;
  automated: boolean;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  onToggleAutomation: () => void;
}) => {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setLocal(value);
  }, [value, dragging]);
  const move = (next: number) => {
    setDragging(true);
    setLocal(next);
    onPreview(next);
  };
  const settle = () => {
    if (!dragging) return;
    setDragging(false);
    onCommit(local);
  };
  return (
    <div className={`parity-field${automated ? ' automated' : ''}`}>
      <label className={automated ? 'on' : ''}>{def.label}</label>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={dragging ? local : value}
        disabled={automated}
        onChange={(e) => move(Number(e.target.value))}
        onPointerUp={settle}
        onKeyUp={settle}
        onBlur={settle}
        aria-label={def.label}
      />
      <span className="parity-field-val">{formatAudioFxParamValue(def, dragging ? local : value)}</span>
      <button
        type="button"
        className={`fx-auto-toggle${automated ? ' on' : ''}`}
        aria-pressed={automated}
        title={automated
          ? `关闭「${def.label}」自动化：清除时间线包络，值交还滑杆`
          : `自动化「${def.label}」：以当前值在时间线播种包络（t=0 单点，展开音频片段行可编辑）`}
        onClick={onToggleAutomation}
      >
        {automated ? <EnvelopeGlyph /> : 'A'}
      </button>
    </div>
  );
};

export const ShenJianAudioFx = ({ clip }: { clip: TimelineClip }) => {
  const edl = useEdl();
  const nodes = clip.audioFx?.nodes ?? [];
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const writeNodes = (next: TimelineClipAudioFxNode[]) => {
    edl.setClipAudioFx(clip.id, next.length > 0 ? next : null);
    dispatchFxPreview(null);
  };

  const addNode = (type: AudioFxNodeType) => {
    const fresh = makeAudioFxNode(type);
    writeNodes([...nodes, fresh]);
    setOpenId(fresh.id);
    setAdding(false);
  };

  /** 一键决策：把推荐节点追加进链尾（重新生成 id，同一决策可重复添加） */
  const addJob = (jobId: string) => {
    const job = AUDIO_FX_JOBS.find((j) => j.id === jobId);
    if (!job) return;
    const fresh = job.nodes.map((n) => makeAudioFxNode(n.type, n.params));
    writeNodes([...nodes, ...fresh]);
    setOpenId(fresh[0]?.id ?? null);
    setAdding(false);
  };

  const patchNode = (index: number, patch: Partial<TimelineClipAudioFxNode>) => {
    writeNodes(nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  };

  const moveNode = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as TimelineClipAudioFxNode);
    writeNodes(next);
    setOpenId(moved?.id ?? null);
  };

  /** 拖动中：只派发预览（Stage 原位更新），不进 EDL；settle 才 commit */
  const previewParam = (index: number, key: string, value: number) => {
    dispatchFxPreview({
      id: clip.id,
      nodes: nodes.map((n, i) => (i === index ? { ...n, params: { ...n.params, [key]: value } } : n)),
    });
  };
  const commitParam = (index: number, key: string, value: number) => {
    const def = AUDIO_FX_PARAM_DEFS[nodes[index].type].find((d) => d.key === key);
    const v = def ? clampAudioFxParams(nodes[index].type, { ...nodes[index].params, [key]: value })[key] : value;
    patchNode(index, { params: { ...nodes[index].params, [key]: v } });
  };

  /**
   * 参数自动化开关（OpenMotion AutomationToggle 语义）：
   * 开启 = 以当前滑杆值在 t=0 播种单点包络（绝对值，落库前归一化夹紧）；
   * 再次点 = 清除该参数自动化，最后一个参数清除时整份 automation 摘掉。
   */
  const toggleAutomation = (index: number, key: string) => {
    const n = nodes[index];
    if (!n) return;
    const cur = n.automation ?? {};
    if (cur[key]?.length) {
      const next = { ...cur };
      delete next[key];
      patchNode(index, { automation: Object.keys(next).length > 0 ? next : undefined });
    } else {
      patchNode(index, { automation: { ...cur, [key]: [{ t: 0, v: n.params[key] }] } });
    }
  };

  return (
    <section className="parity-group fx-section">
      <h4>音频效果 <span className="parity-group-val">{nodes.length > 0 ? `${nodes.length} 个节点` : '无'}</span></h4>

      {/* 信号路径条：In → 节点 chips → Out，点击 chip 展开/收起该节点的参数 */}
      <div className="fx-path" role="list" aria-label="音频效果信号路径">
        <span className="fx-path-port">In</span>
        {nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            role="listitem"
            className={`fx-chip${n.bypass ? ' off' : ''}${openId === n.id ? ' open' : ''}`}
            title={`${AUDIO_FX_TYPE_LABEL[n.type]}${n.bypass ? '（已旁通）' : ''}`}
            onClick={() => setOpenId(openId === n.id ? null : n.id)}
          >
            {CHIP_LABEL[n.type]}
          </button>
        ))}
        <span className="fx-path-port">Out</span>
      </div>

      {nodes.length === 0 ? (
        <div className="fx-empty">这条声音还没有效果——挑一个效果器，或直接用一键决策。</div>
      ) : (
        nodes.map((n, i) => {
          const bypassed = n.bypass === true;
          const open = openId === n.id;
          return (
            <div key={n.id} className={`fx-node${bypassed ? ' bypassed' : ''}`}>
              <div className="fx-node-head">
                <span className="fx-node-index">{String(i + 1).padStart(2, '0')}</span>
                <button type="button" className="fx-node-name" aria-expanded={open} onClick={() => setOpenId(open ? null : n.id)}>
                  {AUDIO_FX_TYPE_LABEL[n.type]}
                </button>
                <button
                  type="button"
                  className="fx-node-bypass"
                  aria-pressed={bypassed}
                  title={bypassed ? '启用该效果' : '旁通该效果（保留参数）'}
                  onClick={() => patchNode(i, { bypass: !bypassed })}
                >
                  {bypassed ? '关' : '开'}
                </button>
                <button type="button" className="fx-node-act" title="上移" disabled={i === 0} onClick={() => moveNode(i, -1)}>↑</button>
                <button type="button" className="fx-node-act" title="下移" disabled={i === nodes.length - 1} onClick={() => moveNode(i, 1)}>↓</button>
                <button type="button" className="fx-node-act fx-node-del" title="删除" onClick={() => { writeNodes(nodes.filter((_, j) => j !== i)); setOpenId(null); }}>×</button>
              </div>
              {open ? (
                <div className="fx-node-body">
                  {AUDIO_FX_PARAM_DEFS[n.type].map((def) => (
                    <FxSlider
                      key={def.key}
                      def={def}
                      value={n.params[def.key]}
                      automated={Boolean(n.automation?.[def.key]?.length)}
                      onPreview={(v) => previewParam(i, def.key, v)}
                      onCommit={(v) => commitParam(i, def.key, v)}
                      onToggleAutomation={() => toggleAutomation(i, def.key)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {adding ? (
        <div className="fx-add-menu" onMouseLeave={() => setAdding(false)}>
          {AUDIO_FX_GROUPS.map((group) => (
            <div key={group.label} className="fx-add-group">
              <span className="fx-add-group-label">{group.label}</span>
              <div className="fx-add-items">
                {group.types.map((t) => (
                  <button key={t} type="button" className="fx-add-item" title={`添加${AUDIO_FX_TYPE_LABEL[t]}`} onClick={() => addNode(t)}>
                    {AUDIO_FX_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="fx-add-group">
            <span className="fx-add-group-label">一键决策</span>
            <div className="fx-add-items">
              {AUDIO_FX_JOBS.map((job) => (
                <button key={job.id} type="button" className="fx-add-item" title={job.note} onClick={() => addJob(job.id)}>
                  {job.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="fx-foot">
        <button type="button" className="parity-mini" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {adding ? '收起' : '+ 添加效果'}
        </button>
        {nodes.length > 0 ? (
          <button type="button" className="parity-mini" onClick={() => { writeNodes([]); setOpenId(null); }}>清除全部</button>
        ) : null}
      </div>
      <div className="parity-hint">
        按 In → Out 顺序作用于该片段的声音，预览即时生效；导出把每个节点翻译成 ffmpeg 滤镜
        （混响/延迟为近似）。挂在画面片段上时作用于其内嵌原声。
        参数「A」开关可做自动化：选中片段后在时间线展开行里画包络
        （压缩/延迟/混响导出暂为静态近似）。
      </div>
    </section>
  );
};

export default ShenJianAudioFx;
