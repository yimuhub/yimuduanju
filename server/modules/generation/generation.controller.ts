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
import { interval, Observable } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import type {
  GenerationJob,
  JobListResponse,
} from '@shared/api.interface';
import { GenerationService } from './generation.service';
import { JobWorkerService } from './job-worker.service';
import { CreateJobDto, JobListQueryDto } from './dto';

@Controller('api/generation')
export class GenerationController {
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
   */
  @Sse('jobs/stream')
  streamJobs(
    @Query('projectId') projectId?: string,
  ): Observable<MessageEvent> {
    return interval(2000).pipe(
      switchMap(() =>
        this.generationService.listJobs({
          projectId,
          pageSize: 100,
        } as JobListQueryDto),
      ),
      map((res) => {
        const terminal = res.items.length > 0 && res.items.every((j) =>
          ['succeeded', 'failed', 'cancelled'].includes(j.status),
        );
        return { data: { jobs: res.items, terminal, total: res.total } } as MessageEvent;
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
