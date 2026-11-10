import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AssistantChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class CreateChatSessionDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

export class UpdateChatTitleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}

export class LinkChatSessionDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}

export class SuggestTitleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class StreamAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60000)
  text?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  size?: number;
}

export class StreamMessageDto {
  // 允许只传附件：正文由服务端按附件名补全，空文本且无附件时才拒绝
  @IsString()
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StreamAttachmentDto)
  attachments?: StreamAttachmentDto[];
}