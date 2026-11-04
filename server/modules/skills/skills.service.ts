import { Injectable, Inject, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, asc } from 'drizzle-orm';
import { skills } from '@server/database/schema';
import { BUILTIN_SKILLS } from './skills.seed';
import { EXTENDED_SKILLS } from './skills.seed.extended';

/**
 * Skill 注册表（产品 3.0 harness 化核心）。
 * 平台 = skill 的执行框架：流水线各环节（slot）按产品线（line）取启用的 skill，
 * 把正文注入对应环节的系统提示词；换 skill = 换脑子，不改代码。
 * 升级策略（火宝验证过）：内置包只补缺不覆盖——用户改过/导入的同名 skill 不被更新。
 */
@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly logger = new Logger(SkillsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 模块启动时补种内置 skill（按 slug 补缺，不覆盖已有记录） */
  async onModuleInit() {
    try {
      const existing = await this.db.select({ slug: skills.slug }).from(skills);
      const have = new Set(existing.map((r) => r.slug));
      const ALL_SKILLS = [...BUILTIN_SKILLS, ...EXTENDED_SKILLS];
      const missing = ALL_SKILLS.filter((s) => !have.has(s.slug));
      if (missing.length > 0) {
        // onConflictDoNothing：多实例并发启动时 select→insert 存在竞态窗口，
        // 撞 slug 唯一约束会让整批补种（含尚未插入的）一起失败回滚；
        // 冲突行跳过、其余照插，保证补种最终完整。
        const inserted = await this.db
          .insert(skills)
          .values(
            missing.map((s) => ({
              slug: s.slug,
              name: s.name,
              line: s.line,
              slot: s.slot,
              description: s.description,
              body: s.body,
              source: 'builtin' as const,
            })),
          )
          .onConflictDoNothing({ target: skills.slug })
          .returning({ id: skills.id });
        if (inserted.length > 0) {
          this.logger.log(`skill 注册表补种 ${inserted.length} 个内置技能`);
        }
      }
    } catch (e) {
      // 表尚未迁移时静默——迁移脚本 0013 会建表
      this.logger.warn(`skill 补种跳过：${(e as Error).message}`);
    }
  }

  async list(params?: { line?: string; enabled?: boolean }) {
    const where = [];
    if (params?.line && params.line !== 'all') where.push(eq(skills.line, params.line));
    if (params?.enabled !== undefined) where.push(eq(skills.enabled, params.enabled));
    const rows = await this.db
      .select()
      .from(skills)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(skills.line), asc(skills.slot), asc(skills.createdAt));
    return rows;
  }

  async setEnabled(slug: string, enabled: boolean) {
    const rows = await this.db
      .update(skills)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(skills.slug, slug))
      .returning();
    if (rows.length === 0) throw new NotFoundException(`skill 不存在：${slug}`);
    return rows[0];
  }

  async updateBody(slug: string, body: string, description?: string) {
    const rows = await this.db
      .update(skills)
      .set({ body, ...(description !== undefined ? { description } : {}), updatedAt: new Date() })
      .where(eq(skills.slug, slug))
      .returning();
    if (rows.length === 0) throw new NotFoundException(`skill 不存在：${slug}`);
    return rows[0];
  }

  async create(input: {
    slug: string;
    name: string;
    line: string;
    slot: string;
    description?: string;
    body?: string;
  }) {
    const rows = await this.db
      .insert(skills)
      .values({ ...input, source: 'user' })
      .onConflictDoNothing({ target: skills.slug })
      .returning();
    // 唯一约束冲突（slug 重复）不抛 500，给出业务化 400
    if (rows.length === 0) {
      throw new BadRequestException(`slug 已存在：${input.slug}`);
    }
    return rows[0];
  }

  async remove(slug: string) {
    const rows = await this.db.delete(skills).where(eq(skills.slug, slug)).returning();
    if (rows.length === 0) throw new NotFoundException(`skill 不存在：${slug}`);
    return { id: rows[0].id };
  }

  /** 按 slug 精确取启用 skill 的拼装文本（Agent 绑定注入用） */
  async getBodiesBySlugs(slugs: string[]): Promise<string> {
    if (slugs.length === 0) return '';
    const rows = await this.db.select().from(skills).where(eq(skills.enabled, true));
    const picked = rows.filter((r) => slugs.includes(r.slug));
    if (picked.length === 0) return '';
    return picked.map((r) => `## 技能：${r.name}\n${r.body}`).join('\n\n');
  }

  /**
   * 流水线注入：按产品线与槽位集合，取全部启用 skill 的正文拼装。
   * Agent / 生成环节把它附加到系统提示词——skill 有则生效，无则行为不变（旁路注入）。
   */
  async getInjection(line: string, slots: string[]): Promise<string> {
    const rows = await this.db.select().from(skills).where(eq(skills.enabled, true));
    const picked = rows.filter((r) => (r.line === line || r.line === 'common') && slots.includes(r.slot));
    if (picked.length === 0) return '';
    return [
      '# 生效技能包（平台 harness 注入，请严格遵循以下创作规范）',
      ...picked.map((r) => `\n## ${r.name}（${r.slug} · 槽位 ${r.slot}）\n${r.body}`),
    ].join('\n');
  }
}
