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
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TimelineTrackKind } from '@shared/api.interface';

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
  @Max(20)
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

  @IsOptional()
  @IsBoolean()
  locked?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
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
}