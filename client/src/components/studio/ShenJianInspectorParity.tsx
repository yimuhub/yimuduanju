/**
 * 同构版右侧检查器。
 * 7 个主页签 + 画面下 4 个子页签；音频 / 变速是真实可写面板，
 * 画面 / 动画 / 调整复用经典检查器；抠像 / 蒙版 / 美容 / 跟踪 / AI 效果全部接真实参数，写 EDL、进预览与导出。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Crosshair,
  Eye,
  EyeOff,
  Gauge,
  Image as ImageIcon,
  Palette,
  RotateCcw,
  ScanEye,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AI_PRESETS,
  DEFAULT_AI,
  DEFAULT_BEAUTY,
  DEFAULT_KEYING,
  DEFAULT_MASK,
  DEFAULT_TRACKING,
  normalizeVisualLut,
  type TimelineClipVisual,
} from '@shared/timeline-visual';
import type { Asset } from '@shared/api.interface';
import { listProjectAssets, mediaUrl, uploadLocalFile } from '@client/src/api/assets';
import { ShenJianInspector } from './ShenJianInspectorV2';
import { ShenJianAudioFx } from './ShenJianAudioFx';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';

/** .cube LUT 文件识别：按扩展名（与上传端约定一致） */
const LUT_FILE_RE = /\.cube$/i;

type Grade = { brightness: number; contrast: number; saturation: number; filter: string };
type MainTab = 'frame' | 'audio' | 'speed' | 'anim' | 'tracking' | 'adjust' | 'ai';
type SubTab = 'basic' | 'keying' | 'mask' | 'beauty';

const MAIN_TABS: Array<[MainTab, string, React.ReactNode]> = [
  ['frame', '画面', <ImageIcon key="frame" />],
  ['audio', '音频', <AudioLines key="audio" />],
  ['speed', '变速', <Gauge key="speed" />],
  ['anim', '动画', <Sparkles key="anim" />],
  ['tracking', '跟踪', <ScanEye key="tracking" />],
  ['adjust', '调整', <SlidersHorizontal key="adjust" />],
  ['ai', 'AI效果', <Wand2 key="ai" />],
];

const SUB_TABS: Array<[SubTab, string]> = [
  ['basic', '基础'],
  ['keying', '抠像'],
  ['mask', '蒙版'],
  ['beauty', '美容美体'],
];

const METRIC = {
  keying: { label: '色度键', note: '按颜色删除背景；适合绿幕/蓝幕' },
  mask: { label: '蒙版', note: '矩形/椭圆/线性遮罩，支持羽化与反转' },
  beauty: { label: '美颜', note: '磨皮、美白、红润与横向收紧' },
  tracking: { label: '点跟踪', note: '在播放头记录目标点，预览与导出按路径运动' },
  ai: { label: 'AI 风格', note: '本地滤镜链，不调用外部模型' },
} as const;

const clipName = (clip: { text?: string | null; sourceUrl?: string | null; track?: string; id: string }) => {
  if (clip.text) return clip.text;
  const file = (clip.sourceUrl || '').split('/').pop() || '';
  if (file) return decodeURIComponent(file);
  return clip.track === 'audio' ? '音频片段' : '时间线片段';
};

const ParSlider = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) => (
  <div className="parity-field">
    <label>{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <span className="parity-field-val">{value}{suffix}</span>
  </div>
);

const VisualPanel = ({
  title,
  note,
  enabled,
  onToggle,
  onReset,
  children,
}: {
  title: string;
  note: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onReset: () => void;
  children: React.ReactNode;
}) => (
  <div className="parity-panel parity-visual-panel">
    <section className="parity-group">
      <div className="parity-visual-head">
        <div>
          <h4>{title}</h4>
          <div className="parity-hint">{note}</div>
        </div>
        <button type="button" className={`parity-enable${enabled ? ' on' : ''}`} onClick={() => onToggle(!enabled)}>
          {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
          {enabled ? '已启用' : '启用'}
        </button>
      </div>
    </section>
    {children}
    <div className="parity-inline parity-visual-foot">
      <button type="button" className="parity-mini" onClick={onReset}>恢复默认</button>
    </div>
  </div>
);

export const ShenJianInspectorParity = ({
  grade,
  setGrade,
}: {
  grade: Grade;
  setGrade: (patch: Partial<Grade>) => void;
}) => {
  const { data, curT, projectId } = useStudio();
  const edl = useEdl();
  const [tab, setTab] = useState<MainTab>('frame');
  const [sub, setSub] = useState<SubTab>('basic');

  const selected = useMemo(
    () => (data.timeline?.clips ?? []).find((c) => edl.selectedIds.includes(c.id)) ?? null,
    [data.timeline?.clips, edl.selectedIds],
  );

  useEffect(() => {
    const target = tab === 'anim' ? 'anim' : tab === 'adjust' ? 'color' : 'basic';
    window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-tab', { detail: target }));
  }, [tab]);

  // 时间线快捷条「变速」等入口可把检查器直接切到对应页签
  useEffect(() => {
    const onMain = (e: Event) => {
      const d = (e as CustomEvent).detail as MainTab;
      if (['frame', 'audio', 'speed', 'anim', 'tracking', 'adjust', 'ai', 'key', 'beauty'].includes(d)) setTab(d);
    };
    window.addEventListener('yimu:shenjian-inspector-main', onMain);
    return () => window.removeEventListener('yimu:shenjian-inspector-main', onMain);
  }, []);

  // 时间线右键「裁剪」：切到 画面→基础（经典控件渲染裁剪区块），渲染后再滚动定位
  useEffect(() => {
    const onCrop = () => {
      setTab('frame');
      setSub('basic');
      window.setTimeout(() => {
        document.querySelector('.inspector [data-insp-crop]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    };
    window.addEventListener('yimu:shenjian-inspector-crop', onCrop);
    return () => window.removeEventListener('yimu:shenjian-inspector-crop', onCrop);
  }, []);

  const showClassic = (tab === 'frame' && sub === 'basic') || tab === 'anim';
  const volume = Math.round((selected?.volume ?? 1) * 100);
  const pitch = Math.round((selected?.pitch ?? 1) * 100) / 100;
  const speed = selected?.speed ?? 1;
  const span = selected ? clipSpan(selected) : 0;
  const visual: TimelineClipVisual = selected?.visual ?? {};
  const lutCfg = visual.lut ?? null;
  const patchVisual = (patch: Partial<TimelineClipVisual>) => {
    if (!selected) return;
    edl.setClipVisual(selected.id, { ...visual, ...patch });
  };
  const resetVisual = (key: keyof TimelineClipVisual) => {
    if (!selected) return;
    edl.setClipVisual(selected.id, { ...visual, [key]: null });
  };
  const localT = selected ? Math.max(0, curT - selected.timelineStart) : 0;

  const resetAll = () => {
    setGrade({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
    if (selected) {
      edl.setClipVolume(selected.id, 1);
      edl.setClipPitch(selected.id, 1);
      edl.setClipSpeed(selected.id, 1);
    }
    toast.success('已重置当前参数');
  };

  // —— LUT（.cube）资产下拉：进入「调整」页签拉一次项目内 LUT，上传成功后 tick 刷新 ——
  const [lutAssets, setLutAssets] = useState<Asset[]>([]);
  const [lutUploading, setLutUploading] = useState(false);
  const [lutListTick, setLutListTick] = useState(0);
  const lutFileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (tab !== 'adjust' || !projectId) return;
    let alive = true;
    listProjectAssets(projectId)
      .then((rows) => {
        if (!alive) return;
        setLutAssets(rows.filter((a) => a.assetType === 'lut' || LUT_FILE_RE.test(a.fileUrl ?? '') || LUT_FILE_RE.test(a.name ?? '')));
      })
      .catch(() => {
        if (alive) setLutAssets([]);
      });
    return () => {
      alive = false;
    };
  }, [tab, projectId, lutListTick]);

  /** 导入 .cube → 上传为项目资产 → 直接应用到当前画面片段 */
  const importLutFile = async (file: File) => {
    if (!projectId || !selected) return;
    setLutUploading(true);
    try {
      const { asset } = await uploadLocalFile(projectId, file, file.name);
      const url = mediaUrl(asset) ?? asset.fileUrl ?? '';
      if (!url) throw new Error('上传结果缺少文件地址');
      patchVisual({ lut: normalizeVisualLut({ url, name: file.name, strength: lutCfg?.url === url ? (lutCfg.strength ?? 1) : 1 }) });
      setLutListTick((v) => v + 1);
      toast.success(`LUT 已导入并应用：${file.name}`);
    } catch (e) {
      toast.error(`LUT 导入失败：${(e as Error).message}`);
    } finally {
      setLutUploading(false);
    }
  };

  return (
    <aside className="inspector parity-inspector">
      <div className="parity-insp-tabs">
        {MAIN_TABS.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
            title={key === 'frame' ? '画面：基础变换与片段属性' : label}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'frame' ? (
        <div className="parity-insp-subtabs">
          {SUB_TABS.map(([key, label]) => (
            <button key={key} type="button" className={sub === key ? 'on' : ''} onClick={() => setSub(key)}>
              {label}
            </button>
          ))}
        </div>
      ) : <div className="parity-insp-subplaceholder" />}

      <div className="parity-ins-head">
        <span className="parity-selected-tag">已选中：<b>{selected ? clipName(selected) : '无片段'}</b></span>
        <button type="button" className="parity-reset" title="重置画面调节 / 音量 / 音高 / 速度" onClick={resetAll}>
          <RotateCcw />
        </button>
      </div>

      <div className="parity-insp-body">
        {!selected ? (
          <div className="parity-insp-empty">
            <div className="parity-empty-ico"><ScanEye /></div>
            <b>还没有选中片段</b>
            <p>在底部时间线点一下任意片段，这里会显示它的时间、变换、音量、变速与画面增强。</p>
            <div className="parity-empty-keys">
              <span>E 分割</span><span>Q 删前</span><span>W 删后</span><span>空格播放</span>
            </div>
          </div>
        ) : tab === 'audio' ? (
          <div className="parity-panel">
            <section className="parity-group">
              <h4>音量 <span className="parity-group-val">{volume}%</span></h4>
              <ParSlider label="音量" value={volume} min={0} max={200} suffix="%" onChange={(v) => edl.setClipVolume(selected.id, v / 100)} />
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 0)}>静音</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 1)}>100%</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 2)}>200%</button>
              </div>
            </section>
            <section className="parity-group">
              <h4>音色</h4>
              <ParSlider label="音高" value={Math.round(pitch * 100)} min={50} max={200} suffix="%" onChange={(v) => edl.setClipPitch(selected.id, v / 100)} />
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 0.8)}>低沉</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 1)}>原音</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 1.25)}>明亮</button>
              </div>
            </section>
            <section className="parity-group">
              {/* 淡入淡出（G11）：秒输入，与时间线把手同一份 fadeIn/fadeOut 数据 */}
              <h4>淡入淡出 <span className="parity-group-val">{(selected.fadeIn ?? 0).toFixed(2)}s / {(selected.fadeOut ?? 0).toFixed(2)}s</span></h4>
              <div className="parity-inline">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  淡入
                  <input
                    type="number"
                    min={0}
                    max={Number(span.toFixed(3))}
                    step={0.1}
                    value={Number((selected.fadeIn ?? 0).toFixed(3))}
                    onChange={(e) => edl.setClipFades(selected.id, { fadeIn: Math.max(0, Number(e.target.value) || 0) })}
                    style={{ width: 72 }}
                  />
                  s
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  淡出
                  <input
                    type="number"
                    min={0}
                    max={Number(span.toFixed(3))}
                    step={0.1}
                    value={Number((selected.fadeOut ?? 0).toFixed(3))}
                    onChange={(e) => edl.setClipFades(selected.id, { fadeOut: Math.max(0, Number(e.target.value) || 0) })}
                    style={{ width: 72 }}
                  />
                  s
                </label>
                <button type="button" className="parity-mini" onClick={() => edl.setClipFades(selected.id, { fadeIn: 0, fadeOut: 0 })}>清除</button>
              </div>
              <div className="parity-hint">音频做线性幅度斜坡（与音量包络叠乘），画面同时透明度渐变；时间线片段角上的把手同样可调（帧量化）。</div>
            </section>
            {/* 音频效果链（FX rack）：按 key 重挂载，选中片段切换时展开态自动复位 */}
            {selected.track === 'video' || selected.track === 'audio' ? (
              <ShenJianAudioFx key={selected.id} clip={selected} />
            ) : null}
            <section className="parity-group">
              <h4>片段</h4>
              <div className="parity-inline">
                <button type="button" className={`parity-mini${selected.reverse ? ' on' : ''}`} onClick={() => edl.toggleClipReverse(selected.id)}>
                  {selected.reverse ? '取消倒放' : '倒放'}
                </button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 1)}>恢复默认</button>
              </div>
              <div className="parity-hint">音量、音高与倒放都会同步到预览和导出；负值/超限由后端统一夹紧。</div>
            </section>
          </div>
        ) : tab === 'speed' ? (
          <div className="parity-panel">
            <section className="parity-group">
              <h4>常规变速 <span className="parity-group-val">{speed.toFixed(2)}× · {span.toFixed(2)}s</span></h4>
              <ParSlider label="速度" value={speed} min={0.25} max={4} step={0.05} suffix="×" onChange={(v) => edl.setClipSpeed(selected.id, v)} />
              <div className="parity-speed-presets">
                {[0.5, 1, 1.5, 2, 3].map((v) => (
                  <button key={v} type="button" className={Math.abs(speed - v) < 0.001 ? 'on' : ''} onClick={() => edl.setClipSpeed(selected.id, v)}>{v}×</button>
                ))}
              </div>
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipSpeed(selected.id, 1)}>恢复 1×</button>
                <button type="button" className={`parity-mini${selected.reverse ? ' on' : ''}`} onClick={() => edl.toggleClipReverse(selected.id)}>{selected.reverse ? '取消倒放' : '倒放'}</button>
              </div>
            </section>
            <section className="parity-group">
              <h4>时间</h4>
              <div className="parity-kv"><span>开始</span><b>{selected.timelineStart.toFixed(2)}s</b></div>
              <div className="parity-kv"><span>结束</span><b>{(selected.timelineStart + span).toFixed(2)}s</b></div>
              <div className="parity-hint">变速后同轨后续片段会自动平移，不会留下空隙。</div>
            </section>
          </div>
        ) : tab === 'adjust' ? (
          /* 调整页签：经典调色检查器 + LUT 区块纵向排成一列 */
          <div className="parity-insp-col">
            <ShenJianInspector grade={grade} setGrade={setGrade} />
            <section className="parity-group">
              <h4>LUT 调色<span className="parity-group-val">{lutCfg ? lutCfg.name || '已应用' : '未应用'}</span></h4>
              {selected.track === 'video' ? (
                <>
                  <div className="parity-lut-row">
                    <select
                      value={lutCfg?.url ?? ''}
                      aria-label="选择项目内的 .cube LUT"
                      onChange={(e) => {
                        const url = e.target.value;
                        if (!url) {
                          resetVisual('lut');
                          return;
                        }
                        const hit = lutAssets.find((a) => (mediaUrl(a) ?? a.fileUrl ?? '') === url);
                        patchVisual({ lut: normalizeVisualLut({ url, name: hit?.name, strength: lutCfg?.strength ?? 1 }) });
                      }}
                    >
                      <option value="">不使用 LUT</option>
                      {lutAssets.map((a) => {
                        const url = mediaUrl(a) ?? a.fileUrl ?? '';
                        return (
                          <option key={a.id} value={url}>
                            {a.name || url.split('/').pop() || '未命名 LUT'}
                          </option>
                        );
                      })}
                    </select>
                    <button type="button" className="parity-mini" disabled={lutUploading || !projectId} onClick={() => lutFileRef.current?.click()}>
                      {lutUploading ? '导入中…' : '导入 .cube'}
                    </button>
                  </div>
                  {lutCfg ? (
                    <>
                      <ParSlider
                        label="强度"
                        value={Math.round((lutCfg.strength ?? 1) * 100)}
                        min={0}
                        max={100}
                        suffix="%"
                        onChange={(v) => patchVisual({ lut: { url: lutCfg.url, name: lutCfg.name, strength: v / 100 } })}
                      />
                      <div className="parity-inline">
                        <button type="button" className="parity-mini" onClick={() => resetVisual('lut')}>清除 LUT</button>
                      </div>
                    </>
                  ) : null}
                  {lutAssets.length === 0 ? (
                    <div className="parity-hint">项目里还没有 .cube LUT：点「导入 .cube」上传一份即可应用。</div>
                  ) : null}
                  <div className="parity-hint">.cube 3D 查找表只作用于画面片段：预览用 WebGL 逐帧查表，导出用 ffmpeg lut3d（三线性插值 + 强度混合，两端同语义）。</div>
                </>
              ) : (
                <div className="parity-hint">LUT 只支持画面轨片段：选中一条画面片段后再来应用。</div>
              )}
              <input
                ref={lutFileRef}
                type="file"
                accept=".cube"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void importLutFile(file);
                }}
              />
            </section>
            <div className="parity-lut-foot" />
          </div>
        ) : showClassic ? (
          <ShenJianInspector grade={grade} setGrade={setGrade} />
        ) : tab === 'frame' && sub === 'keying' ? (
          <VisualPanel
            title="抠像"
            note="按颜色删除背景，预览用实时像素键，导出用 ffmpeg chromakey。"
            enabled={Boolean(visual.keying?.enabled)}
            onToggle={(on) => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), enabled: on } })}
            onReset={() => resetVisual('keying')}
          >
            <div className="parity-visual-color">
              <span>键控颜色</span>
              <input type="color" value={visual.keying?.color ?? DEFAULT_KEYING.color} onChange={(e) => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), color: e.target.value } })} />
              <div className="parity-swatches">
                {['#00ff00', '#0000ff', '#ffffff'].map((c) => (
                  <button key={c} type="button" style={{ background: c }} className={(visual.keying?.color ?? '') === c ? 'on' : ''} onClick={() => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), color: c } })} title={c} />
                ))}
              </div>
            </div>
            <ParSlider label="相似度" value={Math.round((visual.keying?.similarity ?? DEFAULT_KEYING.similarity) * 100)} min={1} max={100} suffix="%" onChange={(v) => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), similarity: v / 100 } })} />
            <ParSlider label="边缘平滑" value={Math.round((visual.keying?.smoothness ?? DEFAULT_KEYING.smoothness) * 100)} min={0} max={100} suffix="%" onChange={(v) => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), smoothness: v / 100 } })} />
            <ParSlider label="去绿边" value={Math.round((visual.keying?.spill ?? DEFAULT_KEYING.spill) * 100)} min={0} max={100} suffix="%" onChange={(v) => patchVisual({ keying: { ...DEFAULT_KEYING, ...(visual.keying ?? {}), spill: v / 100 } })} />
          </VisualPanel>
        ) : tab === 'frame' && sub === 'mask' ? (
          <VisualPanel
            title="蒙版"
            note="矩形 / 椭圆 / 线性三种遮罩，支持羽化与反转；预览与导出共用同一组参数。"
            enabled={Boolean(visual.mask?.enabled)}
            onToggle={(on) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), enabled: on } })}
            onReset={() => resetVisual('mask')}
          >
            <div className="parity-shape-row">
              {(['rect', 'circle', 'linear'] as const).map((shape) => (
                <button key={shape} type="button" className={(visual.mask?.shape ?? DEFAULT_MASK.shape) === shape ? 'on' : ''} onClick={() => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), shape } })}>
                  {shape === 'rect' ? '矩形' : shape === 'circle' ? '椭圆' : '线性'}
                </button>
              ))}
            </div>
            <ParSlider label="中心 X" value={Math.round((visual.mask?.x ?? DEFAULT_MASK.x) * 100)} min={0} max={100} suffix="%" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), x: v / 100 } })} />
            <ParSlider label="中心 Y" value={Math.round((visual.mask?.y ?? DEFAULT_MASK.y) * 100)} min={0} max={100} suffix="%" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), y: v / 100 } })} />
            <ParSlider label="宽度" value={Math.round((visual.mask?.w ?? DEFAULT_MASK.w) * 100)} min={5} max={100} suffix="%" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), w: v / 100 } })} />
            <ParSlider label="高度" value={Math.round((visual.mask?.h ?? DEFAULT_MASK.h) * 100)} min={5} max={100} suffix="%" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), h: v / 100 } })} />
            <ParSlider label="旋转" value={Math.round(visual.mask?.rotation ?? DEFAULT_MASK.rotation)} min={-180} max={180} suffix="°" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), rotation: v } })} />
            <ParSlider label="羽化" value={Math.round((visual.mask?.feather ?? DEFAULT_MASK.feather) * 100)} min={0} max={90} suffix="%" onChange={(v) => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), feather: v / 100 } })} />
            <button type="button" className={`parity-mini${visual.mask?.invert ? ' on' : ''}`} onClick={() => patchVisual({ mask: { ...DEFAULT_MASK, ...(visual.mask ?? {}), invert: !visual.mask?.invert } })}>{visual.mask?.invert ? '取消反转' : '反转蒙版'}</button>
          </VisualPanel>
        ) : tab === 'frame' && sub === 'beauty' ? (
          <VisualPanel
            title="美容美体"
            note="磨皮 / 美白 / 红润写进预览与导出；瘦脸、美体用横向收紧近似，不做人脸关键点识别。"
            enabled={Boolean(visual.beauty?.enabled)}
            onToggle={(on) => patchVisual({ beauty: { ...DEFAULT_BEAUTY, ...(visual.beauty ?? {}), enabled: on } })}
            onReset={() => resetVisual('beauty')}
          >
            {([
              ['smooth', '磨皮'],
              ['whiten', '美白'],
              ['rosy', '红润'],
              ['faceSlim', '瘦脸'],
              ['bodySlim', '美体'],
            ] as const).map(([key, label]) => (
              <ParSlider key={key} label={label} value={visual.beauty?.[key] ?? DEFAULT_BEAUTY[key]} min={0} max={100} suffix="%" onChange={(v) => patchVisual({ beauty: { ...DEFAULT_BEAUTY, ...(visual.beauty ?? {}), [key]: v } })} />
            ))}
          </VisualPanel>
        ) : tab === 'tracking' ? (
          <VisualPanel
            title="目标跟踪"
            note={`手动点跟踪：在播放头记录目标偏移，路径自动插值。当前 ${visual.tracking?.points?.length ?? 0} 个跟踪点。`}
            enabled={Boolean(visual.tracking?.enabled)}
            onToggle={(on) => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), enabled: on } })}
            onReset={() => resetVisual('tracking')}
          >
            <ParSlider label="跟踪 X" value={Math.round((visual.tracking?.x ?? 0) * 100)} min={-100} max={100} suffix="%" onChange={(v) => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), x: v / 100 } })} />
            <ParSlider label="跟踪 Y" value={Math.round((visual.tracking?.y ?? 0) * 100)} min={-100} max={100} suffix="%" onChange={(v) => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), y: v / 100 } })} />
            <ParSlider label="跟踪缩放" value={Math.round((visual.tracking?.scale ?? 1) * 100)} min={80} max={200} suffix="%" onChange={(v) => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), scale: v / 100 } })} />
            <div className="parity-inline">
              <button type="button" className="parity-mini" onClick={() => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), enabled: true, points: [...(visual.tracking?.points ?? []), { time: Number(localT.toFixed(2)), x: visual.tracking?.x ?? 0, y: visual.tracking?.y ?? 0, scale: visual.tracking?.scale ?? 1 }] } })}><Crosshair size={12} /> 在 {localT.toFixed(2)}s 打点</button>
              <button type="button" className="parity-mini" onClick={() => patchVisual({ tracking: { ...DEFAULT_TRACKING, ...(visual.tracking ?? {}), points: [] } })}>清空路径</button>
            </div>
            <div className="parity-hint">自动识别人脸/物体的跟踪模型尚未接入；这里接入的是逐点手动跟踪，数据可落库、可预览、可导出。</div>
          </VisualPanel>
        ) : tab === 'ai' ? (
          <VisualPanel
            title="AI 效果"
            note="本地风格滤镜链，不调用外部模型；强度可调，预览与导出共用。"
            enabled={Boolean(visual.ai && visual.ai.preset !== 'none')}
            onToggle={(on) => patchVisual({ ai: on ? { ...DEFAULT_AI, ...(visual.ai ?? {}), preset: visual.ai?.preset && visual.ai.preset !== 'none' ? visual.ai.preset : 'anime' } : { ...DEFAULT_AI, ...(visual.ai ?? {}), preset: 'none' } })}
            onReset={() => resetVisual('ai')}
          >
            <div className="parity-ai-grid">
              {AI_PRESETS.map((p) => (
                <button key={p.id} type="button" className={(visual.ai?.preset ?? 'none') === p.id ? 'on' : ''} onClick={() => patchVisual({ ai: { preset: p.id, strength: visual.ai?.strength ?? DEFAULT_AI.strength } })}>
                  <Palette size={14} />
                  <span>{p.label}</span>
                  <small>{p.note}</small>
                </button>
              ))}
            </div>
            <ParSlider label="强度" value={visual.ai?.strength ?? DEFAULT_AI.strength} min={10} max={100} suffix="%" onChange={(v) => patchVisual({ ai: { preset: visual.ai?.preset ?? 'anime', strength: v } })} />
          </VisualPanel>
        ) : null}
      </div>

      <div className="parity-insp-foot">
        <span>同构版</span>
        <span className="grow" />
        <span>{showClassic ? '复用真实 EDL 控件' : '真实可写参数 · 写入 EDL'}</span>
      </div>
    </aside>
  );
};

export default ShenJianInspectorParity;
