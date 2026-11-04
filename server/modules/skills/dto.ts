import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** skill slug：URL 安全（小写字母/数字/连字符），防止路径注入与脏数据 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 产品线白名单（与 seed 的 SkillSeed['line'] 同源） */
const SKILL_LINES = ['shortdrama', 'comic', 'ads', 'common'] as const;

/** 流水线槽位白名单（与 skills.seed 实际使用的 slot 同源） */
const SKILL_SLOTS = [
  'topic',
  'script',
  'outline',
  'storyboard',
  'character',
  'scene',
  'style',
  'voice',
  'bgm',
  'edit',
  'qc',
  'common',
] as const;

/** slug 既用于路由又作唯一键：只放行 URL 安全字符 */
export class CreateSkillDto {
  @Matches(SLUG_PATTERN, { message: 'slug 仅允许小写字母/数字/连字符（2-64 位）' })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn(SKILL_LINES)
  line!: string;

  @IsIn(SKILL_SLOTS)
  slot!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;
}

export class SetSkillEnabledDto {
  @Type(() => Boolean)
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateSkillBodyDto {
  @IsString()
  @MaxLength(20000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** 注入预览（GET /api/skills/injection）的查询参数 */
export class SkillInjectionQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  line!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  slots?: string;
}

/** 列表过滤（GET /api/skills） */
export class SkillListQueryDto {
  @IsOptional()
  @IsIn(['all', ...SKILL_LINES])
  line?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;
}
