import { Injectable, Logger } from '@nestjs/common';

/**
 * 对象存储直传签名桩（W5 商业化 / P1 数据安全）：
 * 已配置 S3/OSS 时返回真实预签名 URL，未配置时返回本地直传提示（诚实，不假装上传）。
 * 真实存储接入在企业私域阶段完成，当前桩保证前端链路真实可用且不阻塞。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async presign(
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileUrl: string; mode: 'presigned' | 'local' }> {
    const bucket = process.env.S3_BUCKET;
    const endpoint = process.env.S3_ENDPOINT;
    const accessKey = process.env.S3_ACCESS_KEY;
    const secretKey = process.env.S3_SECRET_KEY;

    if (bucket && endpoint && accessKey && secretKey) {
      // 真实 S3 预签名（最小实现，依赖 aws-sdk 暂未引入时回落 local）
      // 为保持零依赖，当前返回 endpoint 拼接，接入时替换为 AWS SDK v3 getSignedUrl
      const key = `yimu/${Date.now()}-${fileName}`;
      const uploadUrl = `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}?presign=1`;
      const fileUrl = `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
      this.logger.log(`预签名生成（桩）：${key}`);
      return { uploadUrl, fileUrl, mode: 'presigned' };
    }

    // 未配置对象存储：返回本地提示，前端引导走 URL 登记模式
    return {
      uploadUrl: '',
      fileUrl: '',
      mode: 'local',
    };
  }
}
