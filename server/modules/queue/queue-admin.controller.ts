import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import type {
  QueueActionResult,
  QueueMoveDirection,
  QueueOverviewResponse,
} from '@shared/api.interface';
import { QueueAdminService } from './queue-admin.service';

const QUEUE_DIRECTIONS = ['up', 'down', 'top', 'bottom'] as const;

class QueueMoveDto {
  @IsIn([...QUEUE_DIRECTIONS])
  direction!: QueueMoveDirection;
}

class QueueGlobalPauseDto {
  @IsBoolean()
  paused!: boolean;
}

/**
 * 全站排队 API。与 /api/generation/jobs（单项目任务列表、按时间倒序）互补：
 * 这里只关心「还没终结的任务、按真实执行顺序、可人工干预」。
 */
@Controller('api/queue')
export class QueueAdminController {
  constructor(private readonly queue: QueueAdminService) {}

  /** 全站队列总览：按 queue_seq 升序，即消费器的真实认领顺序 */
  @Get('overview')
  overview(): Promise<QueueOverviewResponse> {
    return this.queue.overview();
  }

  /** 暂停排队中的任务；下游依赖任务级联暂停，后面的任务自动补位 */
  @Post('jobs/:id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.pauseJob(id);
  }

  /** 恢复到原排队位置，并级联恢复下游 */
  @Post('jobs/:id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.resumeJob(id);
  }

  /** 终止（不可逆）；下游依赖任务一并终止，避免永久 blocked */
  @Post('jobs/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.terminateJob(id);
  }

  /** 上移 / 下移 / 置顶 / 置底 */
  @Post('jobs/:id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: QueueMoveDto,
  ): Promise<QueueActionResult> {
    return this.queue.moveJob(id, body.direction);
  }

  /** 一键按项目轮转重排（默认仍是严格提交顺序，只有主动调用才改变） */
  @Post('round-robin')
  roundRobin(): Promise<{ reordered: number; message: string }> {
    return this.queue.roundRobin();
  }

  /** 全站消费暂停/恢复（进程级） */
  @Post('global-pause')
  globalPause(@Body() body: QueueGlobalPauseDto): { globallyPaused: boolean; message: string } {
    return this.queue.setGlobalPause(body.paused);
  }
}
