/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * 本文件 @IsIn 作用于字符串字面量联合类型（无需 @Type 转换），为该规则启发式误报。 */
import { Type } from 'class-transformer';
import type { Dialogue, SceneAction } from '@shared/api.interface';
import {
  ArrayMinSize,
  IsArray,
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
  MinLength,
} from 'class-validator';

export class CreateSceneDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sceneNumber?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeOfDay?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotion?: string;

  @IsOptional()
  @IsArray()
  characterIds?: string[];

  @IsOptional()
  @IsArray()
  dialogues?: Dialogue[];

  @IsOptional()
  @IsArray()
  actions?: SceneAction[];

  @IsOptional()
  @IsArray()
  props?: string[];
}

export class UpdateSceneDto extends CreateSceneDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class CreateShotDto {
  @IsUUID()
  sceneId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shotNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  duration?: number;

  // 线性剪辑：源媒体入/出点（秒）；缺省 in=0、out=in+duration
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inPoint?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outPoint?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  shotSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cameraAngle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  lens?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  movement?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotion?: string;

  @IsOptional()
  @IsString()
  dialogue?: string;

  @IsOptional()
  @IsString()
  visualPrompt?: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  startFrameUrl?: string;

  @IsOptional()
  @IsString()
  endFrameUrl?: string;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  voiceUrl?: string;

  @IsOptional()
  @IsArray()
  sfxUrls?: string[];

  @IsOptional()
  @IsString()
  subtitleText?: string;

  @IsOptional()
  @IsArray()
  characterIds?: string[];

  @IsOptional()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateShotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shotNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  duration?: number;

  // 线性剪辑：源媒体入/出点（秒）；null = 清除（恢复缺省语义）
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inPoint?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outPoint?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  shotSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cameraAngle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  lens?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  movement?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotion?: string;

  @IsOptional()
  @IsString()
  dialogue?: string;

  @IsOptional()
  @IsString()
  visualPrompt?: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  startFrameUrl?: string;

  @IsOptional()
  @IsString()
  endFrameUrl?: string;

  // 白模产线：镜头绑定的白模参考视频 URL（null/空串 = 清除绑定）
  @IsOptional()
  @IsString()
  whitemodelUrl?: string | null;

  // 白模元数据 { durationSeconds, rigId, movement, source, assetId, createdAt }
  @IsOptional()
  @IsObject()
  whitemodelMeta?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  voiceUrl?: string;

  @IsOptional()
  @IsArray()
  sfxUrls?: string[];

  @IsOptional()
  @IsString()
  subtitleText?: string;

  @IsOptional()
  @IsArray()
  characterIds?: string[];

  @IsOptional()
  locked?: boolean;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class BatchGenerateDto {
  @IsIn(['image', 'video', 'voice'])
  type!: 'image' | 'video' | 'voice';

  @IsOptional()
  @IsArray()
  shotIds?: string[];
}

/** P2 镜头清单批量重排：按数组顺序重编 sortOrder/shotNumber */
export class ReorderShotsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  shotIds!: string[];
}

/** P2 镜头分割：atSecond 须 ∈ (0, duration)，服务端二次校验 */
export class SplitShotDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  atSecond!: number;
}

export class RerunShotDto {
  @IsOptional()
  @IsString()
  shotId?: string;

  @IsIn(['image', 'video', 'voice'])
  type!: 'image' | 'video' | 'voice';
}

export class ShotVariantsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  count?: number;
}

export class ParseScriptDto {
  @IsString()
  @MinLength(1)
  scriptText!: string;
}

export class AdaptNovelDto {
  @IsString()
  @MinLength(200, { message: '小说原文过短（需 200 字以上）' })
  novelText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  styleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genreId?: string;

  @IsOptional()
  rewriteEnabled?: boolean;
}

export class RewriteScriptDto {
  @IsOptional()
  @IsString()
  scriptText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  directives?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  styleId?: string;
}

export class CreateAdDto {
  @IsString()
  @MinLength(10, { message: '产品信息过短（需 10 字以上：产品名+卖点+人群+CTA）' })
  @MaxLength(4000)
  productBrief!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  styleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genreId?: string;
}

export class RigSceneDto {
  @IsString()
  @MinLength(2, { message: '运镜描述过短' })
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(60)
  totalSeconds?: number;
}

export class DesignCharactersDto {
  @IsString()
  @MinLength(2, { message: '人物设定过短' })
  @MaxLength(2000)
  brief!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  styleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genreId?: string;
}

export class ScriptToBoardsDto {
  @IsString()
  @MinLength(10, { message: '剧本内容过短' })
  scriptText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  styleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genreId?: string;

  @IsOptional()
  replaceExisting?: boolean;
}
