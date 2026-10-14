import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { memoryChunks, projects } from '@server/database/schema';
import { and, eq, desc } from 'drizzle-orm';
import { keywordSimilarity } from '@shared/text-metrics';

/**
 * F2 本地向量记忆（移植 ToonFlow memory.ts/embedding.ts 思想）：
 * all-MiniLM-L6-v2 本地跑（transformers.js，无 Key 可用），记忆分块入库，
 * 检索 = 向量余弦 + 关键词混合；模型加载失败时纯关键词降级（shorts 式），不阻塞。
 * 用途：系列记忆语义检索、素材复用向量升级。
 */
const MODEL_ID = process.env.MEMORY_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const VECTOR_WEIGHT = 0.7;

type Extractor = (text: string, opts?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;

export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private extractor: Extractor | null = null;
  private loadFailed = false;
  private loading: Promise<Extractor | null> | null = null;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 惰性加载本地模型；失败则永久降级关键词（进程内记忆，避免反复重试） */
  async vectorAvailable(): Promise<boolean> {
    if (this.extractor) return true;
    if (this.loadFailed) return false;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
          const { pipeline } = require('@huggingface/transformers') as {
            pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Extractor>;
          };
          this.extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
          this.logger.log(`本地记忆模型已加载 ${MODEL_ID}`);
          return this.extractor;
        } catch (e) {
          this.loadFailed = true;
          this.logger.warn(`本地记忆模型加载失败，检索降级为关键词：${(e as Error).message}`);
          return null;
        }
      })();
    }
    return (await this.loading) !== null;
  }

  async embed(text: string): Promise<number[] | null> {
    const ok = await this.vectorAvailable();
    if (!ok || !this.extractor) return null;
    try {
      const out = await this.extractor(text.slice(0, 2000), { pooling: 'mean', normalize: true });
      return Array.from(out.data as Float32Array);
    } catch (e) {
      this.logger.warn(`embedding 失败，本次降级：${(e as Error).message}`);
      return null;
    }
  }

  cosine(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
    return dot;
  }

  /** 索引：同 kind 先清后写（幂等重建），逐条附向量（失败则存空向量走关键词） */
  async index(
    projectId: string,
    kind: string,
    texts: string[],
  ): Promise<{ indexed: number; withVector: boolean }> {
    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    const k = (kind || 'fact').slice(0, 30);
    await this.db
      .delete(memoryChunks)
      .where(and(eq(memoryChunks.projectId, projectId), eq(memoryChunks.kind, k)));
    let withVector = false;
    for (const text of texts) {
      const clean = text.trim().slice(0, 2000);
      if (!clean) continue;
      // eslint-disable-next-line no-await-in-loop
      const vec = await this.embed(clean);
      if (vec) withVector = true;
      // eslint-disable-next-line no-await-in-loop
      await this.db.insert(memoryChunks).values({
        projectId,
        kind: k,
        text: clean,
        embedding: vec ?? [],
      });
    }
    return { indexed: texts.length, withVector };
  }

  /** 检索：有向量则混合分（向量×0.7+关键词×0.3），否则纯关键词 */
  async search(
    projectId: string,
    query: string,
    topK = 5,
  ): Promise<{ mode: 'hybrid' | 'keyword'; results: { text: string; score: number }[] }> {
    const rows = await this.db
      .select({ text: memoryChunks.text, embedding: memoryChunks.embedding })
      .from(memoryChunks)
      .where(eq(memoryChunks.projectId, projectId))
      .orderBy(desc(memoryChunks.createdAt))
      .limit(200);
    if (rows.length === 0 || !query.trim()) return { mode: 'keyword', results: [] };
    const qvec = await this.embed(query);
    const scored = rows.map((r) => {
      const kw = keywordSimilarity(query, r.text ?? '');
      const emb = Array.isArray(r.embedding) && r.embedding.length > 0 && qvec
        ? this.cosine(qvec, (r.embedding as number[]).map(Number))
        : null;
      const score = emb === null ? kw : emb * VECTOR_WEIGHT + kw * (1 - VECTOR_WEIGHT);
      return { text: r.text ?? '', score };
    });
    scored.sort((a, b) => b.score - a.score);
    return {
      mode: qvec ? 'hybrid' : 'keyword',
      results: scored.filter((s) => s.score > 0).slice(0, topK),
    };
  }
}
