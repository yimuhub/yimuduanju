import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { interval, Observable, of } from 'rxjs';
import { catchError, finalize, map, switchMap, takeWhile } from 'rxjs/operators';
import type {
  GenerationJob,
  JobListResponse,
} from '@shared/api.interface';
import { GenerationService } from './generation.service';
import { JobWorkerService } from './job-worker.service';
import { CreateJobDto, JobListQueryDto } from './dto';

const SSE_INTERVAL_MS = 2000;
const SSE_PAGE_SIZE = 100;
/** 单进程并发 SSE 上限：每条连接每 2s 一次 COUNT(*) + 全量查询，必须封顶 */
const MAX_SSE_CONNECTIONS = 32;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_JOB_STATUSES: string[] = ['succeeded', 'failed', 'cancelled'];

@Controller('api/generation')
export class GenerationController {
  private activeSseConnections = 0;

  constructor(
    private readonly generationService: GenerationService,
    private readonly worker: JobWorkerService,
  ) {}

  /** V7 并发可见性：消费模式/并发数/队列深度（改并发需重启，JOB_WORKER_CONCURRENCY） */
  @Get('worker-stats')
  async workerStats(): Promise<{ mode: string; concurrency: number; waiting: number; active: number }> {
    return this.worker.workerStats();
  }

  @Get('jobs')
  async listJobs(
    @Query() params: JobListQueryDto,
  ): Promise<JobListResponse> {
    return this.generationService.listJobs(params);
  }

  /**
   * P2-3 任务流 SSE（移植 MicroDrama api.py:183-219 的断线重放思想）：
   * 每 2s 推全量快照（非事件流；重连即拿到最新快照 = 天然重放）。
   * 快照推送完整 GenerationJob（含 errorMessage/cost 等），供任务页与作战室
   * 面板直接渲染，掉线时前端降级回轮询。必须注册在 jobs/:id 之前。
   *
   * 本轮修复：
   * 1) 去掉 `{...} as JobListQueryDto` 断言 —— 它绕过了 DTO 校验，非 UUID 的 projectId
   *    会直达 eq(generationJobs.projectId, ...) 触发 Postgres 22P02，
   *    再被全局异常过滤器翻译成误导性的「404 资源不存在」。
   * 2) 全部任务进入终态后自动 complete。旧流永不结束：每个客户端每 2s 一次
   *    COUNT(*) + 100 行全量查询，terminal 算出来只发给前端、没用来关流。
   * 3) 加并发连接上限与 catchError 兜底，避免连接数与查询量无界增长。
   */
  @Sse('jobs/stream')
  streamJobs(
    @Query('projectId') projectId?: string,
  ): Observable<MessageEvent> {
    // 修复 1：显式校验 UUID，不再用 as 断言绕过 DTO
    const filter: JobListQueryDto = { pageSize: SSE_PAGE_SIZE };
    if (projectId !== undefined && projectId !== '') {
      if (!UUID_PATTERN.test(projectId)) {
        // SSE 无法回 4xx：推一条明确的错误事件后立即结束流，
        // 让前端拿到真实原因，而不是一个静默的空列表
        return of({
          data: {
            error: 'projectId 非法（应为 UUID）',
            jobs: [],
            terminal: true,
            total: 0,
          },
        } as MessageEvent);
      }
      filter.projectId = projectId;
    }

    // 修复 3：并发连接上限
    if (this.activeSseConnections >= MAX_SSE_CONNECTIONS) {
      return of({
        data: {
          error: '任务流连接数已达上限，请稍后重连（前端可降级为轮询）',
          jobs: [],
          terminal: true,
          total: 0,
        },
      } as MessageEvent);
    }
    this.activeSseConnections += 1;

    return interval(SSE_INTERVAL_MS).pipe(
      switchMap(() => this.generationService.listJobs(filter)),
      map((res) => {
        const terminal =
          res.items.length > 0 &&
          res.items.every((j) => TERMINAL_JOB_STATUSES.includes(j.status));
        return { data: { jobs: res.items, terminal, total: res.total } } as MessageEvent;
      }),
      // 修复 2：inclusive=true 让「全部终态」这一帧仍推给前端，随后才 complete
      takeWhile(
        (evt) => !(evt.data as { terminal?: boolean } | undefined)?.terminal,
        true,
      ),
      catchError((e: unknown) =>
        of({
          data: {
            error: (e as Error)?.message ?? '任务流异常',
            jobs: [],
            terminal: true,
            total: 0,
          },
        } as MessageEvent),
      ),
      finalize(() => {
        this.activeSseConnections = Math.max(0, this.activeSseConnections - 1);
      }),
    );
  }

  @Get('jobs/:id')
  async getJob(@Param('id', ParseUUIDPipe) id: string): Promise<GenerationJob> {
    return this.generationService.getJob(id);
  }

  @Post('jobs')
  async createJob(
    @Body() body: CreateJobDto,
  ): Promise<GenerationJob> {
    return this.generationService.createJob(body);
  }

  @Post('jobs/:id/retry')
  async retryJob(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationJob> {
    return this.generationService.retryJob(id);
  }

  @Post('jobs/:id/adopt')
  async adoptJob(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationJob> {
    return this.generationService.adoptJob(id);
  }

  @Post('jobs/:id/cancel')
  async cancelJob(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationJob> {
    return this.generationService.cancelJob(id);
  }

  @Delete('jobs/:id')
  async deleteJob(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.generationService.deleteJob(id);
  }

  @Get('jobs/:id/poll')
  async pollJob(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GenerationJob> {
    return this.generationService.pollJob(id);
  }
}
