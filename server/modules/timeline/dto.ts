/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * 本文件 @IsIn 作用于字符串字面量联合类型（无需 @Type 转换），为该规则启发式误报。 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TimelineTextStyle, TimelineTrackKind } from '@shared/api.interface';
import type { TimelineVideoKeyframe } from '@shared/timeline-keyframes';

/** 片段转场（与下一片段之间）；Phase 4 导出暂按硬切渲染，EDL 先存决策 */
export class ClipTransitionDto {
  @IsIn(['none', 'crossfade', 'fade'])
  type!: 'none' | 'crossfade' | 'fade';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  duration!: number;
}

/** SaveTimelineRequest.clips 元素（缺省 id 视为新建） */
export class SaveTimelineClipDto {
  @IsOptional()
  @IsUUID('all')
  id?: string;

  /** 客户端稳定标识（保存重建 id 后仍可定位同一片段） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientKey?: string;

  @IsIn(['video', 'audio', 'subtitle', 'overlay'])
  track!: TimelineTrackKind;

  @IsOptional()
  @IsUUID('all')
  sourceShotId?: string | null;

  @IsOptional()
  @IsString()
  sourceUrl?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inPoint!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outPoint!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  timelineStart!: number;

  /** 同类型轨道内的分层下标（音频 0 对白 / 1 配乐 / 2 音效）；缺省 0 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(19)
  lane?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.25)
  @Max(4)
  speed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  volume?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClipTransitionDto)
  transition?: ClipTransitionDto | null;

  @IsOptional()
  @IsString()
  text?: string | null;

  /** 运镜关键帧（画面轨）；逐项数值在服务端归一化，非法值夹紧而不是整单报错 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(120)
  keyframes?: TimelineVideoKeyframe[] | null;
  reverse?: boolean | null;
  compound?: { children: import('@shared/api.interface').TimelineCompoundChild[] } | null;

  /** ASR 转写段落（服务端写回；保存时间线时原样保留） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4000)
  transcript?: import('@shared/api.interface').TimelineTranscriptSegment[] | null;

  /** 绑定组 id（同组一起平移）；null / 空 = 解绑 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bindGroup?: string | null;

  /**
   * 字幕样式。只校验「是个对象」—— 内部字段都可选且都有默认值，
   * 逐个加装饰器会让 DTO 膨胀几十行，收益为零（前端已经用 resolveTextStyle 兜底）。
   */
  @IsOptional()
  @IsObject()
  textStyle?: TimelineTextStyle | null;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  /** 片段启用状态；缺省 true（旧客户端保存不会误停用） */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** 轨道元信息（名称 / 静音 / 独奏 / 锁定 / 行高），随 EDL 一起保存 */
export class TimelineTrackMetaDto {
  @IsIn(['video', 'audio', 'subtitle', 'overlay'])
  track!: TimelineTrackKind;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(19)
  lane!: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsBoolean()
  solo?: boolean;

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  height?: number;
}

/** PUT /timeline：整体替换该项目 EDL（事务写入） */
export class SaveTimelineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  fps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8192)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8192)
  height?: number;

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => SaveTimelineClipDto)
  clips!: SaveTimelineClipDto[];

  /** 期望的当前版本号：与库内不一致返回 409，避免并发编辑互相覆盖 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  /** 轨道元信息（名称 / 静音 / 独奏 / 锁定 / 行高） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TimelineTrackMetaDto)
  tracks?: TimelineTrackMetaDto[];
}

/** POST /timeline/export：按 EDL 合成成片 */
export class ExportTimelineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8192)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(8192)
  height?: number;

  @IsOptional()
  @IsBoolean()
  burnSubtitles?: boolean;

  /** 画面轨处理：sequence=全部串行拼接（旧行为）；main=只取主链 */
  @IsOptional()
  @IsIn(['sequence', 'main', 'overlay'])
  videoLaneMode?: 'sequence' | 'main' | 'overlay';

  /** 选区导出起点（秒）；与 endSec 同时给才生效 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(86400)
  startSec?: number;

  /** 选区导出终点（秒） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(86400)
  endSec?: number;
}

/** POST /timeline/agent-ops：对话驱动的剪辑动作（结构由 shared/timeline-ops 校验） */
export class AgentTimelineOpsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseVersion!: number;

  @IsArray()
  @ArrayMaxSize(40)
  ops!: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID('all')
  sessionId?: string;

  @IsOptional()
  @IsUUID('all')
  messageId?: string;
}
/** 单片段 ASR：clipId 传 id 或 clientKey 均可 */
export class TranscribeClipDto {
  @IsString()
  @MaxLength(120)
  clipId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string | null;
}
