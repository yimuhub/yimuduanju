/**
 * 图层面板（G18 · OpenMotion LayersPanel 对齐）
 * -------------------------------------------------------------
 * 按时间线的轨道 z 序列树展示：字幕层最上 → 画面轨（分离原声紧贴）→ 音频层最下。
 * 轨道行：名称 / 类型图标 / 显隐眼 / 锁定态；子行片段：名称 / 类型图标 / 启停态。
 * 交互全部走既有 EDL API：
 *   · 点击片段行 → edl.setSelection 联动时间线与检查器；
 *   · 轨道眼 → 画面写 exportEnabled、音频写 muted、字幕批量启停片段；
 *   · 片段眼 → edl.setClipEnabled（剪映 V 的启停语义）；
 *   · 拖拽轨道行 → edl.updateTrack 写 order，与时间线行序共用同一份元数据。
 */
import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Film,
  Layers,
  Lock,
  LockOpen,
  Music2,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TimelineClip, TimelineTrackMeta } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, sameOrigin } from './model';

/** 与时间线一致的行形状（键与轨道元数据查找共用） */
interface LayerRow {
  key: string;
  track: TimelineTrackMeta['track'];
  lane: number;
  label: string;
  name: string;
  /** 画面轨：exportEnabled；音频轨：非静音；字幕轨：全部片段启用 */
  visible: boolean;
  locked: boolean;
  muted: boolean;
  /** 音画分离后的原声轨贴在原画面轨下面 */
  pairedVideoLane?: number;
  clips: TimelineClip[];
}

const TRACK_ICON: Record<string, React.ReactNode> = {
  video: <Film size={12} />,
  audio: <Music2 size={12} />,
  subtitle: <Type size={12} />,
};

const CLIP_ICON: Record<string, React.ReactNode> = {
  video: <Film size={11} />,
  audio: <Music2 size={11} />,
  subtitle: <Type size={11} />,
};

const nameFromUrl = (url?: string | null) => {
  if (!url) return '';
  const tail = url.split('/').pop() ?? '';
  try {
    return decodeURIComponent(tail.replace(/\.[a-z0-9]+(?:\?.*)?$/i, ''));
  } catch {
    return tail;
  }
};

const clipName = (c: TimelineClip) => {
  if (c.track === 'subtitle') return c.text?.trim() || '字幕';
  return nameFromUrl(c.sourceUrl) || (c.track === 'audio' ? '音频片段' : '画面片段');
};

export const LayersPanel = () => {
  const { data } = useStudio();
  const edl = useEdl();
  const clips = data.timeline?.clips ?? [];
  const tracks = data.timeline?.tracks ?? [];

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragRowRef = useRef<LayerRow | null>(null);

  const rows = useMemo<LayerRow[]>(() => {
    const metaOf = (track: string, lane: number) =>
      tracks.find((t) => t.track === track && (t.lane ?? 0) === lane);
    // 同类型轨道内 meta.order 控制上下位置；未设置时：字幕/画面按 lane 从高到低，音频从低到高（与时间线一致）
    const orderOf = (track: TimelineTrackMeta['track'], lane: number) => {
      const meta = metaOf(track, lane);
      return meta?.order ?? (track === 'audio' ? lane : -lane);
    };

    // auto: 开头的音频是「内嵌原声」，不单独占行（与时间线同一规则）
    const audioClips = clips.filter((c) => c.track === 'audio' && !c.bindGroup?.startsWith('auto:'));
    const audioLanes = Array.from(new Set(audioClips.map((c) => c.lane ?? 0)));
    const videoSet = new Set(clips.filter((c) => c.track === 'video').map((c) => c.lane ?? 0));
    const subLanes = Array.from(new Set(clips.filter((c) => c.track === 'subtitle').map((c) => c.lane ?? 0)));
    if (subLanes.length > 0) videoSet.add(0);
    const subLanesSorted = subLanes.sort((a, b) => orderOf('subtitle', a) - orderOf('subtitle', b));
    const videoLanes = Array.from(videoSet).sort((a, b) => orderOf('video', a) - orderOf('video', b));
    const audioLanesSorted = audioLanes.sort((a, b) => orderOf('audio', a) - orderOf('audio', b));

    // 音画分离的原声贴回原画面轨：clientKey/origin 优先（id 每次落库会重建）
    const videoByKey = new Map<string, TimelineClip>();
    for (const v of clips.filter((c) => c.track === 'video')) {
      videoByKey.set(v.id, v);
      if (v.clientKey) videoByKey.set(v.clientKey, v);
    }
    const pairLaneOf = (lane: number): number | undefined => {
      const a = audioClips.find((c) => (c.lane ?? 0) === lane);
      if (!a) return undefined;
      if (a.bindGroup?.startsWith('av:') || a.bindGroup?.startsWith('auto:')) {
        const key = a.bindGroup.slice(a.bindGroup.startsWith('av:') ? 3 : 5);
        const v = videoByKey.get(key);
        if (v) return v.lane ?? 0;
      }
      const v = clips.find((c) => c.track === 'video' && sameOrigin(a, c, edl.fps));
      return v ? (v.lane ?? 0) : undefined;
    };

    const sortClips = (list: TimelineClip[]) => [...list].sort((a, b) => a.timelineStart - b.timelineStart);

    const audioRows = new Map<number, LayerRow>();
    for (const lane of audioLanesSorted) {
      const meta = metaOf('audio', lane);
      const own = sortClips(audioClips.filter((c) => (c.lane ?? 0) === lane));
      audioRows.set(lane, {
        key: `audio:${lane}`,
        track: 'audio',
        lane,
        label: 'A',
        name: meta?.name || ((lane === 0 ? '原声 / 对白' : lane === 1 ? '音乐' : '音效')),
        visible: meta?.muted !== true,
        muted: meta?.muted === true,
        locked: meta?.locked === true,
        pairedVideoLane: pairLaneOf(lane),
        clips: own,
      });
    }

    const out: LayerRow[] = [];
    // 固定图层顺序：字幕层最上 → 视频层中间（原声紧贴）→ 音频层最下
    for (const lane of subLanesSorted) {
      const meta = metaOf('subtitle', lane);
      const own = sortClips(clips.filter((c) => c.track === 'subtitle' && (c.lane ?? 0) === lane));
      out.push({
        key: `subtitle:${lane}`,
        track: 'subtitle',
        lane,
        label: 'T',
        name: meta?.name || '字幕 / 文本',
        visible: own.length > 0 && own.every((c) => c.enabled !== false),
        muted: false,
        locked: meta?.locked === true,
        clips: own,
      });
    }
    for (const lane of videoLanes) {
      const meta = metaOf('video', lane);
      out.push({
        key: `video:${lane}`,
        track: 'video',
        lane,
        label: 'V',
        name: meta?.name || (lane === 0 ? '画面主轨' : '叠加画面'),
        visible: meta?.exportEnabled !== false,
        muted: meta?.muted === true,
        locked: meta?.locked === true,
        clips: sortClips(clips.filter((c) => c.track === 'video' && (c.lane ?? 0) === lane)),
      });
      // 原声轨贴在原画面轨下面：按 pairedVideoLane 匹配，而不是假设 lane 一致
      const paired = [...audioRows.values()].find((r) => r.pairedVideoLane === lane);
      if (paired) {
        paired.name = meta?.name ? `原声 · ${meta.name}` : `原声 · V${lane + 1}`;
        out.push(paired);
        audioRows.delete(paired.lane);
      }
    }
    // 没有画面来源的音频（配乐 / 音效 / 独立导入）排在最底部
    for (const row of audioRows.values()) out.push(row);

    // 标签按同类型内的出现顺序计数（V1/A1/T1），不受 lane 空洞影响（与时间线一致）
    const seen: Record<string, number> = { video: 0, audio: 0, subtitle: 0 };
    for (const r of out) {
      seen[r.track] = (seen[r.track] ?? 0) + 1;
      r.label = `${r.label}${seen[r.track]}`;
    }
    return out;
  }, [clips, tracks, edl.fps]);

  const toggleTrackEye = (row: LayerRow) => {
    if (row.track === 'video') {
      edl.updateTrack('video', row.lane, { exportEnabled: !row.visible });
      toast.success(row.visible ? `已隐藏 ${row.label}（预览与导出跳过）` : `已显示 ${row.label}`);
      return;
    }
    if (row.track === 'audio') {
      edl.updateTrack('audio', row.lane, { muted: row.visible });
      toast.success(row.visible ? `已隐藏 ${row.label}（静音）` : `已显示 ${row.label}（取消静音）`);
      return;
    }
    // 字幕轨没有轨道级显隐元数据：按片段启停批量切换（与剪映「全部启用/停用」一致）
    const next = !row.visible;
    for (const c of row.clips) edl.setClipEnabled(c.id, next);
    toast.success(next ? `已显示 ${row.label} 的 ${row.clips.length} 条字幕` : `已隐藏 ${row.label} 的 ${row.clips.length} 条字幕`);
  };

  const toggleTrackLock = (row: LayerRow) => {
    edl.updateTrack(row.track, row.lane, { locked: !row.locked });
    toast.success(row.locked ? `已解锁 ${row.label}` : `已锁定 ${row.label}`);
  };

  /** 拖拽重排：同类型内按新视觉顺序归一化写 order，只提交真正变化的轨道 */
  const dropRow = (target: LayerRow) => {
    const src = dragRowRef.current;
    setDragKey(null);
    setOverKey(null);
    dragRowRef.current = null;
    if (!src || src.key === target.key || src.track !== target.track) return;
    const sameType = rows.filter((r) => r.track === src.track);
    const from = sameType.findIndex((r) => r.key === src.key);
    const to = sameType.findIndex((r) => r.key === target.key);
    if (from < 0 || to < 0) return;
    sameType.splice(to, 0, ...sameType.splice(from, 1));
    let moved = 0;
    sameType.forEach((r, i) => {
      const current = tracks.find((t) => t.track === r.track && (t.lane ?? 0) === r.lane)?.order ?? (r.track === 'audio' ? r.lane : -r.lane);
      if (current !== i) {
        edl.updateTrack(r.track, r.lane, { order: i });
        moved += 1;
      }
    });
    if (moved) toast.success(`已调整轨道顺序${src.track === 'audio' ? '（音频区）' : src.track === 'subtitle' ? '（字幕区）' : '（画面区）'}`);
  };

  if (!clips.length) {
    return (
      <section className="layers-panel" aria-label="图层">
        <div className="layers-empty">
          <Layers size={20} />
          <b>时间线还是空的</b>
          <p>把素材拖进时间线后，这里会按轨道展示图层树。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="layers-panel" aria-label="图层">
      <div className="layers-toolbar">
        <Layers size={13} />
        <b>图层</b>
        <span>{rows.length} 条轨道 · {clips.length} 个片段</span>
      </div>
      <div className="layers-tree">
        {rows.map((row) => {
          const open = !collapsed[row.key];
          return (
            <div
              key={row.key}
              className={`layers-track${dragKey === row.key ? ' is-drag' : ''}${overKey === row.key && dragKey ? ' is-over' : ''}`}
              onDragOver={(e) => {
                if (!dragRowRef.current || dragRowRef.current.track !== row.track) return;
                e.preventDefault();
                setOverKey(row.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropRow(row);
              }}
            >
              <div
                className="layers-track-row"
                draggable
                onDragStart={() => {
                  dragRowRef.current = row;
                  setDragKey(row.key);
                }}
                onDragEnd={() => {
                  dragRowRef.current = null;
                  setDragKey(null);
                  setOverKey(null);
                }}
                title={`${row.label} ${row.name} · 拖动可调整轨道顺序`}
              >
                <button
                  type="button"
                  className="layers-caret"
                  aria-label={open ? '收起片段' : '展开片段'}
                  onClick={() => setCollapsed((p) => ({ ...p, [row.key]: !open }))}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <span className={`layers-kind is-${row.track}`}>{TRACK_ICON[row.track]}</span>
                <span className="layers-track-label">{row.label}</span>
                <span className="layers-track-name" title={row.name}>{row.name}</span>
                <button
                  type="button"
                  className={`layers-eye${row.visible ? '' : ' off'}`}
                  aria-label={row.visible ? '隐藏该轨' : '显示该轨'}
                  title={
                    row.track === 'video'
                      ? row.visible ? '隐藏该轨（预览与导出跳过）' : '显示该轨'
                      : row.track === 'audio'
                        ? row.visible ? '隐藏该轨（静音）' : '显示该轨（取消静音）'
                        : row.visible ? '隐藏全部字幕（按片段启停）' : '显示全部字幕'
                  }
                  onClick={() => toggleTrackEye(row)}
                >
                  {row.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  type="button"
                  className={`layers-lock${row.locked ? ' on' : ''}`}
                  aria-label={row.locked ? '解锁该轨' : '锁定该轨'}
                  title={row.locked ? '解锁该轨' : '锁定该轨（禁止编辑）'}
                  onClick={() => toggleTrackLock(row)}
                >
                  {row.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
              </div>
              {open ? row.clips.map((c) => {
                const selected = edl.selectedIds.includes(c.id);
                const enabled = c.enabled !== false;
                return (
                  <div
                    key={c.id}
                    className={`layers-clip${selected ? ' selected' : ''}${enabled ? '' : ' disabled'}`}
                    onClick={() => edl.setSelection([c.id])}
                    title={`${clipName(c)} · ${c.timelineStart.toFixed(2)}s → ${(c.timelineStart + clipSpan(c)).toFixed(2)}s · 点击选中`}
                  >
                    <span className={`layers-kind is-${c.track}`}>{CLIP_ICON[c.track]}</span>
                    <span className="layers-clip-name">{clipName(c)}</span>
                    <span className="layers-clip-time">{c.timelineStart.toFixed(2)}s</span>
                    <button
                      type="button"
                      className={`layers-eye${enabled ? '' : ' off'}`}
                      aria-label={enabled ? '停用该片段' : '启用该片段'}
                      title={enabled ? '停用该片段（保留在时间线，预览与导出跳过）' : '启用该片段'}
                      onClick={(e) => {
                        e.stopPropagation();
                        edl.setClipEnabled(c.id, !enabled);
                      }}
                    >
                      {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>
                );
              }) : null}
            </div>
          );
        })}
      </div>
      <div className="layers-foot">拖动轨道行可调整上下顺序；眼睛控制显隐，锁定后时间线不可编辑。</div>
    </section>
  );
};

export default LayersPanel;
