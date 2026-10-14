import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, asc, desc, sql } from 'drizzle-orm';

import { templates, projects } from '@server/database/schema';
import type {
  Template,
  TemplateType,
} from '@shared/api.interface';

interface TemplateListResult {
  items: Template[];
  total: number;
  page: number;
  pageSize: number;
}

function mapTemplate(
  row: typeof templates.$inferSelect,
  extra?: { useCount?: number | null; likeCount?: number | null },
): Template {
  return {
    id: row.id,
    name: row.name,
    templateType: row.templateType as TemplateType,
    category: row.category ?? undefined,
    description: row.description ?? undefined,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    durationSeconds: row.durationSeconds ?? 0,
    aspectRatio: row.aspectRatio as Template['aspectRatio'],
    artStyle: row.artStyle ?? undefined,
    genre: row.genre ?? undefined,
    config: (row.config as Template['config']) ?? undefined,
    isBuiltin: row.isBuiltin ?? true,
    sortOrder: row.sortOrder ?? 0,
    // W5 模板市场：运营计数列由 migration 0002 添加，生成 schema 尚未包含，用原生 SQL 读取
    useCount: Number(extra?.useCount ?? 0),
    likeCount: Number(extra?.likeCount ?? 0),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(params?: {
    templateType?: TemplateType;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<TemplateListResult> {
    const page = Math.max(1, Math.floor(Number(params?.page)) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Math.floor(Number(params?.pageSize)) || 20),
    );
    const conditions = [];
    if (params?.templateType) {
      conditions.push(eq(templates.templateType, params.templateType));
    }
    if (params?.keyword) {
      const escaped = params.keyword.replace(/[\\%_]/g, (c) => `\\${c}`);
      conditions.push(
        and(
          // 标题/描述/分类模糊搜索（转义通配符）
          sql`("templates"."name" ILIKE ${`%${escaped}%`} OR "templates"."description" ILIKE ${`%${escaped}%`} OR "templates"."category" ILIKE ${`%${escaped}%`})`,
        ),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          row: templates,
          useCount: sql<number>`COALESCE("templates"."use_count", 0)`,
          likeCount: sql<number>`COALESCE("templates"."like_count", 0)`,
        })
        .from(templates)
        .where(where)
        // W5 市场排序：后台置顶优先，其次使用量，最后创建时间
        .orderBy(
          asc(templates.sortOrder),
          desc(sql`"templates"."use_count"`),
          desc(templates.createdAt),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: count() })
        .from(templates)
        .where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Template[] = rows.map((r) =>
      mapTemplate(r.row, { useCount: r.useCount, likeCount: r.likeCount }),
    );

    return { items, total, page, pageSize };
  }

  async findById(id: string): Promise<Template> {
    const rows = await this.db
      .select({
        row: templates,
        useCount: sql<number>`COALESCE("templates"."use_count", 0)`,
        likeCount: sql<number>`COALESCE("templates"."like_count", 0)`,
      })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    return mapTemplate(rows[0].row, {
      useCount: rows[0].useCount,
      likeCount: rows[0].likeCount,
    });
  }

  async findByType(type: TemplateType): Promise<TemplateListResult> {
    return this.list({ templateType: type });
  }

  async create(dto: Partial<Template>): Promise<Template> {
    const inserted = await this.db
      .insert(templates)
      .values({
        name: dto.name ?? '未命名模板',
        templateType: dto.templateType ?? 'full',
        category: dto.category,
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        durationSeconds: dto.durationSeconds ?? 60,
        aspectRatio: dto.aspectRatio ?? '9:16',
        artStyle: dto.artStyle,
        genre: dto.genre,
        config: dto.config as typeof templates.$inferInsert['config'],
        isBuiltin: dto.isBuiltin ?? false,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    this.logger.log(`创建模板 ${inserted[0].id}`);
    return this.findById(inserted[0].id);
  }

  async update(id: string, dto: Partial<Template>): Promise<Template> {
    const patch: Partial<typeof templates.$inferInsert> = {};

    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.templateType !== undefined) patch.templateType = dto.templateType;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.thumbnailUrl !== undefined) patch.thumbnailUrl = dto.thumbnailUrl;
    if (dto.durationSeconds !== undefined) patch.durationSeconds = dto.durationSeconds;
    if (dto.aspectRatio !== undefined) patch.aspectRatio = dto.aspectRatio;
    if (dto.artStyle !== undefined) patch.artStyle = dto.artStyle;
    if (dto.genre !== undefined) patch.genre = dto.genre;
    if (dto.config !== undefined) patch.config = dto.config as typeof templates.$inferInsert['config'];
    if (dto.isBuiltin !== undefined) patch.isBuiltin = dto.isBuiltin;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    if (Object.keys(patch).length === 0) {
      return this.findById(id);
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(templates)
      .set(patch)
      .where(eq(templates.id, id))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    this.logger.log(`更新模板 ${id}`);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning({ id: templates.id });

    if (deleted.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    this.logger.log(`删除模板 ${id}`);
  }

  /** W5 模板市场：使用打点（套用/查看详情时调用，供热门排序） */
  async trackUse(id: string): Promise<Template> {
    await this.db
      .update(templates)
      .set({
        // @ts-expect-error 生成 schema 尚未包含 migration 0002 列，运行时列真实存在
        use_count: sql`"templates"."use_count" + 1`,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id));
    return this.findById(id);
  }

  /**
   * W5 模板市场：项目存为模板（标题/时长/画幅/画风/题材/导演参数一键沉淀）。
   */
  async saveAsTemplate(projectId: string, name?: string): Promise<Template> {
    const projRows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    const p = projRows[0];
    const professional = ((p.metadata ?? {}) as { professional?: Record<string, unknown> })
      .professional;
    const created = await this.create({
      name: name?.trim() || `${p.title}-模板`,
      templateType: 'full',
      category: p.genre ?? undefined,
      description: p.description ?? undefined,
      durationSeconds: p.durationSeconds ?? 90,
      aspectRatio: (p.aspectRatio ?? '9:16') as Template['aspectRatio'],
      artStyle: p.artStyle ?? undefined,
      genre: p.genre ?? undefined,
      config: {
        shotCount: Number(professional?.shotCount ?? 20),
        shotDuration: Number(professional?.shotDuration ?? 4),
        shotSizes: [],
        cameraMovements: [],
        voicePreset: String(professional?.voicePreset ?? ''),
        subtitleEnabled: professional?.subtitleEnabled !== false,
      },
      isBuiltin: false,
    });
    this.logger.log(`项目 ${projectId} 存为模板 ${created.id}`);
    return created;
  }
}
