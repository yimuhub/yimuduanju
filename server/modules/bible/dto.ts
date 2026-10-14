import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

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
