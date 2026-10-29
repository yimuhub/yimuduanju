/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * 本文件 @IsIn 作用于 shared 定义的字符串联合类型（非 TS enum、无需 @Type 转换），
 * 为该规则启发式误报，关闭以保持 DTO 与共享契约同源。 */
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '@server/common/dto/pagination.dto';
import type {
  AspectRatio,
  ArtStyle,
  BudgetMode,
  ContentMode,
  CreationMode,
  ProfessionalPrefs,
  ProjectMetadata,
  ProjectStatus,
} from '@shared/api.interface';

/** 与 shared ProjectStatus 保持一致的白名单（写操作另有 service 层转移白名单） */
const PROJECT_STATUSES = [
  'draft',
  'parsing',
  'planning',
  'bible_ready',
  'storyboard_ready',
  'assets_generating',
  'video_generating',
  'audio_generating',
  'editing',
  'qc',
  'ready',
  'exported',
  'failed',
] as const;

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['quick', 'script', 'professional'])
  mode?: CreationMode;

  @IsOptional()
  @IsIn(['general', 'drama', 'ads'])
  contentMode?: ContentMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(7200)
  durationSeconds?: number;

  @IsOptional()
  @IsIn(['9:16', '16:9', '4:3', '3:4', '21:9', '1:1'])
  aspectRatio?: AspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  artStyle?: ArtStyle;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsIn(['quality_first', 'balanced', 'cost_first', 'fast_first'])
  budgetMode?: BudgetMode;

  @IsOptional()
  @IsString()
  scriptText?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  status?: ProjectStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(7200)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  aspectRatio?: AspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  artStyle?: ArtStyle;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsString()
  budgetMode?: BudgetMode;

  @IsOptional()
  @IsIn(['general', 'drama', 'ads'])
  contentMode?: ContentMode;

  @IsOptional()
  @IsString()
  scriptText?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  // 元数据包（含 professional 导演参数），结构由 service 侧消费时收敛，不在此强约束
  @IsOptional()
  metadata?: ProjectMetadata;

  // 项目级供应商覆盖（对标 ArcReel 项目覆盖全局；null = 清除回全局）
  @IsOptional()
  providerOverride?: { providerName?: string } | null;
}

export class QuickCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  prompt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(7200)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  aspectRatio?: AspectRatio;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  artStyle?: ArtStyle;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsString()
  budgetMode?: BudgetMode;

  @IsOptional()
  @IsIn(['quick', 'script', 'professional'])
  mode?: CreationMode;

  @IsOptional()
  @IsIn(['general', 'drama', 'ads'])
  contentMode?: ContentMode;

  // 专业模式导演参数（shotCount/shotDuration/shotSizePref/cameraStyle/voicePreset/subtitleEnabled），
  // service 侧逐项钳制，此处仅要求为对象
  @IsOptional()
  professional?: ProfessionalPrefs;

  // 一句话扩写开关：true（默认）= 先经剧本技能扩写成剧本再物化；
  // false = 离线启发式直接拆分（无 Key 也可用）
  @IsOptional()
  expandScript?: boolean;

  // S2 题材 id：透传给 one_sentence_expand 技能（题材铁律拼进 prompt）
  @IsOptional()
  @IsString()
  @MaxLength(50)
  genreId?: string;
}

export class ProjectListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn([...PROJECT_STATUSES])
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

/** 阶段确认门（POST /api/projects/:id/approve） */
export class ApproveProjectDto {
  @IsIn(['script', 'storyboard', 'final'])
  stage!: 'script' | 'storyboard' | 'final';
}
