import { Controller, Get, Param, Query } from '@nestjs/common';
import { SystemLogsService } from './system-logs.service';

/**
 * 系统日志只读接口。
 * 本地优先部署：/api/* 与业务接口一样由网关注入身份，不额外加登录；
 * 所有返回内容都经 redact 脱敏，且文件名走白名单，不允许任意路径读取。
 */
@Controller('api/system-logs')
export class SystemLogsController {
  constructor(private readonly logs: SystemLogsService) {}

  @Get('files')
  files() {
    return this.logs.files();
  }

  @Get('overview')
  overview() {
    return this.logs.overview();
  }

  @Get('entries')
  entries(
    @Query('file') file?: string,
    @Query('level') level?: string,
    @Query('q') q?: string,
    @Query('traceId') traceId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.entries({
      file,
      level,
      q,
      traceId,
      since,
      until,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('events')
  events(
    @Query('level') level?: string,
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('projectId') projectId?: string,
    @Query('jobId') jobId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.events({
      level,
      category,
      q,
      projectId,
      jobId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('failures')
  failures(
    @Query('projectId') projectId?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.failures({
      projectId,
      q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 单个失败任务的完整诊断（含上游响应、输入参数、关联日志） */
  @Get('diagnose/:jobId')
  diagnose(@Param('jobId') jobId: string) {
    return this.logs.diagnose(jobId);
  }
}
