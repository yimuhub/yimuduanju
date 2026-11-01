import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  /**
   * 修复（线上失明）：旧实现全文没有任何 Logger。未知异常在生产环境只回
   * 「服务器内部错误」，服务端不留任何痕迹（stack 仅 dev 回给前端），
   * 排障时无从下手。这里是唯一能看到未捕获异常原始信息的位置，必须落日志。
   */
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 修复：响应头已发送时不能静默吞掉。body 已经交出去、无法再写，
    // 但异常本身必须记录，否则这类错误（常见于流式响应中途抛错）完全不可见。
    if (response.headersSent) {
      this.logger.error(
        `响应头已发送后抛出异常 ${request?.method ?? '?'} ${request?.originalUrl ?? ''}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();

      // 修复（响应契约）：HTTP_STATUS_TO_RESPONSE_CODE_MAP 由反向映射生成，
      // 未覆盖的状态码（418 / 451 / 508 等）会让 code 变成 undefined，
      // 该字段直接从 JSON 中消失，客户端无法按 ApiErrorResponse 契约解析。
      const isDev = process.env.NODE_ENV !== 'production';
      errorResponse = {
        error: {
          code:
            HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus] ??
            ResponseCode.INTERNAL_ERROR,
          message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
          // 修复（信息泄漏）：details 会把 class-validator / Nest 的完整内部载荷
          // 回给客户端，且生产环境同样回传。上一轮 P0 修复只去掉了 stack，漏了 details。
          details:
            isDev && typeof exceptionResponse === 'object'
              ? JSON.stringify(exceptionResponse)
              : undefined,
          timestamp: Date.now(),
        },
      };
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '22P02'
    ) {
      // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
      // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
      httpStatus = HttpStatus.NOT_FOUND;
      errorResponse = {
        error: {
          code: ResponseCode.NOT_FOUND,
          message: '资源不存在',
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      // 修复（线上失明）：必须落日志，否则生产环境的未捕获异常无任何痕迹
      this.logger.error(
        `未处理异常 ${request?.method ?? '?'} ${request?.originalUrl ?? ''}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // P0 安全修复：生产环境不再向前端泄漏调用栈，仅开发环境返回便于排查
      const isDev = process.env.NODE_ENV !== 'production';
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误',
          ...(isDev
            ? {
                stack: (exception as Error).stack,
                cause: (exception as Error).cause as string,
              }
            : {}),
          timestamp: Date.now(),
        },
      };
    }

    response.status(httpStatus).json(errorResponse);
  }
}
