/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * 本文件 @IsIn 作用于 shared 定义的字符串联合类型（非 TS enum、无需 @Type 转换），
 * 为该规则启发式误报，关闭以保持 DTO 与共享契约同源。 */
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '@server/common/dto/pagination.dto';
import type { JobStatus, JobType } from '@shared/api.interface';

const JOB_TYPES = [
  'text',
  'image',
  'video',
  'tts',
  'parse_script',
  'storyboard',
  'qc',
  'edit',
  'script',
] as const;

const JOB_STATUSES = [
  'pending',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'retrying',
] as const;

export class CreateJobDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsIn([...JOB_TYPES])
  jobType!: JobType;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  targetType?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  modelName?: string;

  @IsOptional()
  inputData?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;
}

export class JobListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsIn([...JOB_STATUSES])
  status?: JobStatus;

  @IsOptional()
  @IsIn([...JOB_TYPES])
  jobType?: JobType;
}
