import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsIn,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CharacterIdentityKit, PropCategory, PropTextPolicy, PropStateVariant } from '@shared/api.interface';

export class CreateCharacterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  roleType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  age?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  canonicalDescription?: string;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  /** 人物视觉资产包（主图 + 四视图 + 文本锁） */
  @IsOptional()
  @IsObject()
  identityKit?: CharacterIdentityKit;

  /** 归集（migration 0024）；缺省 = 全剧共享资产 */
  @IsOptional()
  @IsUUID()
  episodeId?: string;

  /** 身份锁短语数组（一致性工程 B1） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lockAnchors?: string[];
}

export class UpdateCharacterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  roleType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  age?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @IsOptional()
  @IsString()
  height?: string;

  @IsOptional()
  @IsString()
  bodyType?: string;

  @IsOptional()
  @IsString()
  faceFeatures?: string;

  @IsOptional()
  @IsString()
  hairstyle?: string;

  @IsOptional()
  @IsString()
  costume?: string;

  @IsOptional()
  @IsString()
  accessories?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  voiceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  voiceId?: string;

  @IsOptional()
  @IsString()
  canonicalDescription?: string;

  @IsOptional()
  @IsString()
  forbiddenChanges?: string;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  @IsOptional()
  @IsObject()
  identityKit?: CharacterIdentityKit;

  @IsOptional()
  @IsUUID()
  episodeId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lockAnchors?: string[];

  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  locationType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeOfDay?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  locationType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  timeOfDay?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  weather?: string;

  @IsOptional()
  @IsString()
  architecture?: string;

  @IsOptional()
  @IsString()
  furniture?: string;

  @IsOptional()
  @IsString()
  lighting?: string;

  @IsOptional()
  @IsString()
  colorPalette?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  @IsOptional()
  locked?: boolean;
}

const PROP_CATEGORY_VALUES = ['hero', 'recurring', 'stateful', 'set_dressing'];
const PROP_TEXT_POLICY_VALUES = [
  'exact_readable',
  'graphic_only',
  'no_readable_text',
  'pending_creator_text',
];

/** 道具：跨镜复现的物件，身份与状态变体分离 */
export class CreatePropDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(PROP_CATEGORY_VALUES)
  category?: PropCategory;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  identityAnchors?: string;

  @IsOptional()
  @IsString()
  appearance?: string;

  @IsOptional()
  @IsString()
  scaleReference?: string;

  @IsOptional()
  @IsString()
  functionDesc?: string;

  @IsOptional()
  @IsString()
  storyRole?: string;

  @IsOptional()
  @IsString()
  ownerCharacterId?: string;

  @IsOptional()
  @IsString()
  continuityLock?: string;

  @IsOptional()
  @IsString()
  forbiddenChanges?: string;

  @IsOptional()
  @IsIn(PROP_TEXT_POLICY_VALUES)
  textPolicy?: PropTextPolicy;

  @IsOptional()
  @IsString()
  readableText?: string;

  @IsOptional()
  @IsArray()
  stateVariants?: PropStateVariant[];

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];
}

export class UpdatePropDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(PROP_CATEGORY_VALUES)
  category?: PropCategory;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  identityAnchors?: string;

  @IsOptional()
  @IsString()
  appearance?: string;

  @IsOptional()
  @IsString()
  scaleReference?: string;

  @IsOptional()
  @IsString()
  functionDesc?: string;

  @IsOptional()
  @IsString()
  storyRole?: string;

  @IsOptional()
  @IsString()
  ownerCharacterId?: string;

  @IsOptional()
  @IsString()
  continuityLock?: string;

  @IsOptional()
  @IsString()
  forbiddenChanges?: string;

  @IsOptional()
  @IsIn(PROP_TEXT_POLICY_VALUES)
  textPolicy?: PropTextPolicy;

  @IsOptional()
  @IsString()
  readableText?: string;

  @IsOptional()
  @IsArray()
  stateVariants?: PropStateVariant[];

  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];

  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

/** 一键生成制作圣经：不传 scriptText 时服务端自行解析项目剧本 */
export class GenerateBibleDto {
  @IsOptional()
  @IsString()
  @MaxLength(30000)
  scriptText?: string;

  /** fill = 只补空白（默认）；overwrite = 覆盖已有文本 */
  @IsOptional()
  @IsIn(['fill', 'overwrite'])
  mode?: 'fill' | 'overwrite';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerName?: string;
}
