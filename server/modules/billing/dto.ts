/* eslint-disable @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator --
 * counts 为自由键数字映射（无需 @Type 转换），为该规则启发式误报。 */
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class PricingUpdateDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPriceCny?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marketPriceCny?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OfficialChannelUpdateDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

const ESTIMATE_JOB_TYPES = [
  'text',
  'image',
  'video',
  'tts',
  'parse_script',
  'storyboard',
  'qc',
  'edit',
] as const;

export class CostEstimateDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  tier?: string;

  @IsOptional()
  counts?: Partial<Record<string, number>>;
}

export { ESTIMATE_JOB_TYPES };
