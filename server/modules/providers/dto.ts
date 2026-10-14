/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * 本文件 @IsIn 作用于 shared 定义的字符串联合类型（非 TS enum、无需 @Type 转换），
 * 为该规则启发式误报，关闭以保持 DTO 与共享契约同源。 */
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  FormatType,
  ModelCapabilities,
  ProviderModelParams,
  ProviderType,
} from '@shared/api.interface';

const PROVIDER_TYPES = ['volcengine_ark', 'openai_proxy', 'custom', 'official'] as const;
// P2-3 mock 通道：formatType='mock' 的供应商免 Key，视频任务秒级成功（占位输出）
const FORMAT_TYPES = ['openai', 'volcengine_ark', 'mock', 'agnes'] as const;

export class CreateProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn([...PROVIDER_TYPES])
  providerType!: ProviderType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  textModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  videoModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ttsModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ttsVoice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  promptPrefix?: string;

  @IsOptional()
  @IsIn([...FORMAT_TYPES])
  formatType?: FormatType;

  @IsOptional()
  capabilities?: ModelCapabilities;

  @IsOptional()
  @IsObject()
  modelParams?: ProviderModelParams;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  textModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  videoModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ttsModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ttsVoice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  promptPrefix?: string;

  @IsOptional()
  @IsIn([...FORMAT_TYPES])
  formatType?: FormatType;

  @IsOptional()
  capabilities?: ModelCapabilities;

  @IsOptional()
  @IsObject()
  modelParams?: ProviderModelParams;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  routingPriority?: number;
}

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  apiKey!: string;
}

export class ProviderConnectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsIn([...FORMAT_TYPES])
  formatType?: FormatType;

  @IsOptional()
  @IsIn(['offline', 'preview', 'live'])
  mode?: 'offline' | 'preview' | 'live';

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}

export class SetStageBindingDto {
  @IsOptional()
  @IsUUID()
  providerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(128000)
  maxTokens?: number;
}
