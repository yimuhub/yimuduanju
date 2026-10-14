import { Type } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AssistantChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}
