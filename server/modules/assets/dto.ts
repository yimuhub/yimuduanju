import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '@server/common/dto/pagination.dto';

export class CreateAssetDto {
  // P1 资产隔离：归属项目必填（之前可空导致跨项目混池）
  @IsUUID()
  projectId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  assetType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceId?: string;

  @IsOptional()
  @IsString()
  generationPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  generationModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  generationSeed?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsUUID()
  parentAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @IsOptional()
  locked?: boolean;
}

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  assetType?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceId?: string;

  @IsOptional()
  @IsString()
  generationPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  generationModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  generationSeed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @IsOptional()
  locked?: boolean;
}

export class AssetListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  assetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

export class AssetProjectQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  assetType?: string;
}
