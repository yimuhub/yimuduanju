/**
 * 剪映草稿（draft_content.json）纯函数构造器
 * -------------------------------------------------------------
 * 学自剪映官方草稿与开源 capcut-mate 的字段语义，不复制其代码。
 * 只负责「时间线 → 草稿 JSON」；媒体落盘与 ZIP 由服务端完成。
 *
 * 边界：
 *   · 视频/音频/字幕三类轨；复合片段先展开；
 *   · 运镜关键帧暂不写入 common_keyframes（剪映字段方言未逐版本验证），
 *     避免写出「能导入但效果错」的假关键帧；
 *   · 文本字体走系统默认（font_path=D:），不依赖用户机器已装字体。
 */
import type { TimelineClip, TimelineDocument, TimelineTextStyle } from './api.interface';
import { expandCompounds } from './timeline-compound';

const US = 1_000_000;
const us = (sec: number) => Math.max(0, Math.round(sec * US));
const uid = () => crypto.randomUUID().replace(/-/g, '');

export interface JianyingDraftOptions {
  draftId: string;
  name: string;
  /** sourceUrl → 草稿内 Resources 相对路径（含占位前缀） */
  resources: Record<string, string>;
  /** 媒体像素尺寸；缺省用画布尺寸 */
  mediaSize?: Record<string, { width: number; height: number; duration: number; type: 'video' | 'photo' }>;
}

interface TrackDraft {
  attribute: number;
  flag: number;
  id: string;
  is_default_name: boolean;
  name: string;
  segments: Record<string, unknown>[];
  type: 'video' | 'audio' | 'text';
}

function baseSegment(clip: TimelineClip, materialId: string, sourceDurationUs: number, pathSpeedId: string) {
  const span = Math.max(0, (clip.outPoint - clip.inPoint) / (clip.speed > 0 ? clip.speed : 1));
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: Boolean(clip.reverse),
    track_attribute: 0,
    track_render_index: 0,
    visible: clip.enabled !== false,
    id: uid(),
    material_id: materialId,
    target_timerange: { start: us(clip.timelineStart), duration: us(span) },
    source_timerange: { start: us(clip.inPoint), duration: Math.max(0, sourceDurationUs) },
    speed: clip.speed > 0 ? clip.speed : 1,
    volume: Math.max(0, Math.min(2, clip.volume ?? 1)),
    change_pitch: false,
    is_tone_modify: false,
    extra_material_refs: [pathSpeedId],
    common_keyframes: [],
    keyframe_refs: [],
  };
}

function clipSettings() {
  return {
    alpha: 1,
    flip: { horizontal: false, vertical: false },
    rotation: 0,
    scale: { x: 1, y: 1 },
    transform: { x: 0, y: 0 },
  };
}

function colorToRgb(hex: string | undefined): number[] {
  const clean = (hex ?? '#FFFFFF').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function textMaterial(clip: TimelineClip, style: TimelineTextStyle) {
  const text = (clip.text ?? '').trim();
  const size = Math.max(1, Math.min(72, style.fontSize ?? 5.2)) * 1.35;
  const align = style.align === 'left' ? 0 : style.align === 'right' ? 2 : 1;
  const content = {
    text,
    styles: [
      {
        fill: { content: { solid: { color: colorToRgb(style.color) } } },
        font: { id: '', path: 'D:' },
        size,
        range: [0, text.length],
        bold: Boolean(style.bold),
        italic: Boolean(style.italic),
        strokes: style.strokeWidth
          ? [
              {
                content: { solid: { alpha: 1, color: colorToRgb(style.strokeColor) } },
                width: Math.max(0, Math.min(0.2, style.strokeWidth)),
              },
            ]
          : undefined,
      },
    ],
  };
  return {
    add_type: 0,
    alignment: align,
    background_alpha: style.bgOpacity ?? 0.45,
    background_color: style.bgColor ?? '',
    background_height: 0.14,
    background_horizontal_offset: 0,
    background_round_radius: 0,
    background_style: style.bgColor ? 1 : 0,
    background_vertical_offset: 0,
    background_width: 0.14,
    base_content: '',
    bold_width: 0,
    border_alpha: 1,
    border_color: style.strokeColor ?? '',
    border_width: Math.max(0, Math.min(0.2, style.strokeWidth ?? 0)),
    caption_template_info: {
      category_id: '',
      category_name: '',
      effect_id: '',
      is_new: false,
      path: '',
      request_id: '',
      resource_id: '',
      resource_name: '',
      source_platform: 0,
    },
    check_flag: 7,
    combo_info: { text_templates: [] },
    content: JSON.stringify(content),
    fixed_height: -1,
    fixed_width: -1,
    font_category_id: '',
    font_category_name: '',
    font_id: '',
    font_name: '',
    font_path: 'D:',
    font_resource_id: '',
    font_size: size,
    font_source_platform: 0,
    font_team_id: '',
    font_title: 'none',
    font_url: '',
    fonts: [],
    force_apply_line_max_width: false,
    global_alpha: 1,
    group_id: '',
    has_shadow: false,
    id: uid(),
    initial_scale: 1,
    italic_degree: 0,
    k_italic_degree: 0,
    k_underline: false,
    language: 'zh',
    layer_alpha: 1,
    layer_color: '',
    layer_width: 0,
    letter_spacing: 0,
    line_feed: 1,
    line_spacing: 0,
    lines: [],
    name: '',
    offset_x: ((style.x ?? 0.5) - 0.5) * 2,
    offset_y: ((style.y ?? 0.86) - 0.5) * -2,
    path: '',
    preset_category: '',
    preset_category_id: '',
    preset_id: '',
    preset_name: '',
    recognize_task_id: '',
    recognize_type: 0,
    shadow_alpha: 0.9,
    shadow_angle: -45,
    shadow_color: '',
    shadow_distance: 5,
    shadow_smoothing: 0.45,
    shape_clip_x: false,
    shape_clip_y: false,
    source_from: '',
    style_name: '',
    subtitle_template_original_fontsize: 0,
    text_alpha: 1,
    text_color: style.color ?? '#FFFFFF',
    text_size: size,
    text_to_video_keep_ratio: false,
    type: 'text',
    underline: false,
    vertical: false,
  };
}

export function buildJianyingDraftContent(doc: TimelineDocument, opts: JianyingDraftOptions) {
  const clips = expandCompounds(doc.clips).filter((c) => c.enabled !== false);
  const width = doc.width || 1080;
  const height = doc.height || 1920;
  const ratio = width === height ? '1:1' : width > height ? '16:9' : '9:16';
  const materials: Record<string, unknown[]> = {
    audio_balances: [], audio_effects: [], audio_fades: [], audios: [], beats: [], canvases: [],
    chromas: [], color_curves: [], drafts: [], effects: [], handwrites: [], hsl: [], images: [],
    log_color_wheels: [], masks: [], material_animations: [], placeholders: [],
    primary_color_wheels: [], realtime_denoises: [], speeds: [], stickers: [], tail_leaders: [],
    text_templates: [], texts: [], transitions: [], video_effects: [], video_trackings: [], videos: [],
  };
  const tracks: TrackDraft[] = [];
  const materialBySource = new Map<string, string>();
  let maxEnd = 0;

  const addTrack = (type: TrackDraft['type'], lane: number, label: string, segs: Record<string, unknown>[], renderIndex: number) => {
    if (!segs.length) return;
    for (const seg of segs) seg.render_index = renderIndex;
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uid(),
      is_default_name: false,
      name: label || `${type}${lane + 1}`,
      segments: segs,
      type,
    });
  };

  const videoClips = clips.filter((c) => c.track === 'video');
  const audioClips = clips.filter((c) => c.track === 'audio');
  const subs = clips.filter((c) => c.track === 'subtitle' && c.text?.trim());

  const videoByLane = new Map<number, Record<string, unknown>[]>();
  for (const clip of videoClips) {
    if (!clip.sourceUrl) continue;
    const resPath = opts.resources[clip.sourceUrl];
    if (!resPath) continue;
    let materialId = materialBySource.get(clip.sourceUrl);
    if (!materialId) {
      materialId = uid();
      materialBySource.set(clip.sourceUrl, materialId);
      const meta = opts.mediaSize?.[clip.sourceUrl];
      const isPhoto = meta?.type === 'photo';
      materials.videos.push({
        audio_fade: null,
        category_id: '',
        category_name: 'local',
        check_flag: 63487,
        crop: { lower_left_x: 0, lower_left_y: 0, lower_right_x: 1, lower_right_y: 0, upper_left_x: 0, upper_left_y: 1, upper_right_x: 1, upper_right_y: 1 },
        crop_ratio: 'free',
        crop_scale: 1,
        duration: isPhoto ? 10_800 * US : us(meta?.duration ?? Math.max(clip.outPoint, 1)),
        height: meta?.height ?? height,
        id: materialId,
        local_material_id: '',
        material_id: materialId,
        material_name: resPath.split('/').pop() ?? 'material.mp4',
        media_path: '',
        path: resPath,
        type: isPhoto ? 'photo' : 'video',
        width: meta?.width ?? width,
      });
    }
    const speedId = uid();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: clip.speed > 0 ? clip.speed : 1, type: 'speed' });
    const sourceUs = us(Math.max(clip.inPoint, clip.outPoint) - clip.inPoint);
    const seg = { ...baseSegment(clip, materialId, sourceUs, speedId), clip: clipSettings(), uniform_scale: { on: true, value: 1 }, hdr_settings: { intensity: 1, mode: 1, nits: 1000 } };
    const lane = Math.max(0, clip.lane ?? 0);
    const arr = videoByLane.get(lane) ?? [];
    arr.push(seg);
    videoByLane.set(lane, arr);
    maxEnd = Math.max(maxEnd, clip.timelineStart + sourceUs / US / (clip.speed || 1));
  }

  const audioByLane = new Map<number, Record<string, unknown>[]>();
  for (const clip of audioClips) {
    if (!clip.sourceUrl) continue;
    const resPath = opts.resources[clip.sourceUrl];
    if (!resPath) continue;
    let materialId = materialBySource.get(`audio:${clip.sourceUrl}`);
    if (!materialId) {
      materialId = uid();
      materialBySource.set(`audio:${clip.sourceUrl}`, materialId);
      materials.audios.push({
        app_id: 0,
        category_id: '',
        category_name: 'local',
        check_flag: 3,
        copyright_limit_type: 'none',
        duration: us(opts.mediaSize?.[clip.sourceUrl]?.duration ?? Math.max(clip.outPoint, 1)),
        effect_id: '',
        formula_id: '',
        id: materialId,
        local_material_id: materialId,
        music_id: materialId,
        name: resPath.split('/').pop() ?? 'audio.mp3',
        path: resPath,
        source_platform: 0,
        type: 'extract_music',
        wave_points: [],
      });
    }
    const speedId = uid();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: clip.speed > 0 ? clip.speed : 1, type: 'speed' });
    const sourceUs = us(Math.max(clip.inPoint, clip.outPoint) - clip.inPoint);
    const seg = baseSegment(clip, materialId, sourceUs, speedId);
    const lane = Math.max(0, clip.lane ?? 0);
    const arr = audioByLane.get(lane) ?? [];
    arr.push(seg);
    audioByLane.set(lane, arr);
    maxEnd = Math.max(maxEnd, clip.timelineStart + sourceUs / US / (clip.speed || 1));
  }

  const textSegs: Record<string, unknown>[] = [];
  for (const clip of subs) {
    const style: TimelineTextStyle = clip.textStyle ?? { fontFamily: 'source-han-sans', fontSize: 5.2, color: '#FFFFFF', bold: true, italic: false, strokeColor: '#000000', strokeWidth: 0.08, bgColor: '', bgOpacity: 0.45, align: 'center', x: 0.5, y: 0.86, maxWidth: 0.86 };
    const mat = textMaterial(clip, style);
    materials.texts.push(mat);
    const speedId = uid();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1, type: 'speed' });
    const base = baseSegment({ ...clip, speed: 1 }, mat.id, us(Math.max(0, clip.outPoint - clip.inPoint)), speedId);
    textSegs.push({
      ...base,
      clip: clipSettings(),
      uniform_scale: { on: true, value: 1 },
      caption_info: null,
      cartoon: false,
      enable_adjust: false,
      enable_lut: false,
      group_id: '',
      hdr_settings: null,
      intensifies_audio: false,
      is_placeholder: false,
      responsive_layout: { enable: false, horizontal_pos_layout: 0, size_layout: 0, target_follow: '', vertical_pos_layout: 0 },
      template_id: '',
      template_scene: 'default',
    });
    maxEnd = Math.max(maxEnd, clip.timelineStart + (clip.outPoint - clip.inPoint));
  }

  let render = 0;
  for (const [lane, segs] of [...videoByLane.entries()].sort((a, b) => a[0] - b[0])) addTrack('video', lane, lane === 0 ? '主轨' : `画中画${lane}`, segs, render++);
  for (const [lane, segs] of [...audioByLane.entries()].sort((a, b) => a[0] - b[0])) addTrack('audio', lane, lane === 0 ? '对白' : lane === 1 ? '配乐' : `音频${lane}`, segs, 0);
  addTrack('text', 0, '字幕', textSegs, 15000);

  return {
    canvas_config: { height, ratio, width },
    color_space: -1,
    config: {
      adjust_max_index: 1, combination_max_index: 1, export_range: null, extract_audio_last_index: 1,
      lyrics_recognition_id: '', lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true,
      material_save_mode: 0, original_sound_last_index: 1, record_audio_last_index: 1,
      sticker_max_index: 1, subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [],
      video_mute: false,
    },
    cover: null,
    create_time: Math.round(Date.now() / 1000),
    duration: us(maxEnd),
    extra_info: null,
    fps: doc.fps || 24,
    group_container: null,
    id: opts.draftId.toUpperCase(),
    keyframes: { adjusts: [], audios: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: { app_id: 3704, app_version: '5.9.0', os: 'mac', os_version: '15.0' },
    materials,
    mutable_config: null,
    name: opts.name,
    new_version: '110.0.0',
    platform: { app_id: 3704, app_version: '5.9.0', os: 'mac', os_version: '15.0' },
    relationships: [],
    render_index_track_mode_on: true,
    tracks,
    update_time: Math.round(Date.now() / 1000),
    version: 360000,
  };
}

export function buildJianyingMeta(draftId: string, name: string, durationSec: number) {
  const now = Math.round(Date.now() / 1000);
  return {
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '',
    draft_cloud_tutorial_info: '',
    draft_cover: '',
    draft_fold_path: '',
    draft_id: draftId.toUpperCase(),
    draft_materials: [],
    draft_materials_copied_info: [],
    draft_name: name,
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_duration: us(durationSec),
  };
}
