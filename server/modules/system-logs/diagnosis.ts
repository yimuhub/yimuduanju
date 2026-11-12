/**
 * 失败原因诊断规则
 * ------------------------------------------------------------------
 * 目标：把「上游一句英文报错」翻译成用户能采取行动的人话。
 * 规则按优先级从上到下匹配，命中第一条即返回。新增上游错误时在这里补一条，
 * 不要散落进各个 service 的字符串里。
 */
export interface ErrorDiagnosis {
  code: string;
  title: string;
  /** 具体是什么原因造成的 */
  cause: string;
  /** 可以马上做什么 */
  suggestions: string[];
  severity: 'critical' | 'error' | 'warning';
  /** 这类错误重试是否有意义（参数错误重试 3 次只是白烧额度） */
  retryable: boolean;
}

interface Rule {
  code: string;
  test: RegExp;
  title: string;
  cause: string;
  suggestions: string[];
  severity?: ErrorDiagnosis['severity'];
  retryable?: boolean;
}

const RULES: Rule[] = [
  {
    code: 'IMAGE_REF_NOT_BASE64',
    test: /image is not a valid image base64|invalid.*image.*base64|image.*must be.*base64/i,
    title: '参考图不是合法的 base64（图片生图 400）',
    cause:
      '生图请求的 image 字段收到的是本地 /uploads 相对路径（或普通 URL），而不是图片像素数据。' +
      '我们的人物/场景/道具定妆图与首帧都落盘为 /uploads/xxx.png，供应商无法访问本机路径，' +
      '于是把这段字符串直接判为「非 base64」并拒绝整个请求。该错误是确定性的参数错误，' +
      '原样重试 3 次必然全部失败，这也是「某个项目的图片一直失败、别的项目却正常」的原因：' +
      '只有带参考图的镜头首帧会走这条通路，无参考图的定妆图不受影响。',
    suggestions: [
      '已在 generateImage 里统一规范化参考图：本地图片转压缩 data URL，Agnes 通道再剥成纯 base64；重新运行该镜首帧即可。',
      '若仍失败，到「系统日志 → 失败诊断」展开该任务，核对 referenceRawShape 是否已从 local-path 变为 base64。',
      '确认参考图文件确实存在（缺失时不会发送 image 字段，会退化为纯文生图）。',
    ],
    severity: 'critical',
    retryable: false,
  },
  {
    code: 'AUTH_FAILED',
    test: /401|unauthorized|invalid api key|api key.*(invalid|expired)|authentication/i,
    title: '供应商鉴权失败',
    cause: 'API Key 无效、已过期，或该 Key 没有所选模型的权限。',
    suggestions: [
      '到「设置 → 供应商」重新填写并测试连通性。',
      '若刚换过 YIMU_KEY_SECRET，库里的 enc:v1: 密文会解不开，需要重新录入 Key。',
    ],
    retryable: false,
  },
  {
    code: 'QUOTA_EXCEEDED',
    test: /insufficient|quota|余额不足|额度不足|billing|arrears/i,
    title: '账户余额或额度不足',
    cause: '官方通道余额不足、免费额度用尽，或触发了单项目预算上限。',
    suggestions: ['检查官方通道余额与项目预算设置。', '可临时切到 BYO Key 或 mock 沙盒验证流程。'],
  },
  {
    code: 'RATE_LIMITED',
    test: /429|rate.?limit|too many requests|限流/i,
    title: '上游限流',
    cause: '短时间请求过多，供应商返回限流。任务队列会退避重试，一般不会立刻终结。',
    suggestions: ['降低 JOB_CONCURRENCY_* 并发水位。', '稍后再试，不要手动连续重跑整个项目。'],
    severity: 'warning',
    retryable: true,
  },
  {
    code: 'UPSTREAM_TIMEOUT',
    test: /timeout|timed? ?out|ETIMEDOUT|ECONNABORTED|请求超时|aborted/i,
    title: '上游请求超时',
    cause: '供应商在超时窗口内没有返回（文本默认 60s、视频 120s），常见于模型排队或网络不稳。',
    suggestions: ['检查网络与供应商状态页。', '错峰重试；视频任务可改到并发更低的时段。'],
    retryable: true,
  },
  {
    code: 'TTS_UNSUPPORTED',
    test: /暂无配音接口|no tts|tts.*not supported|换有 TTS 能力的供应商/i,
    title: '当前供应商不支持配音',
    cause: 'Agnes 测试通道没有 TTS 接口，配音任务无法创建。',
    suggestions: ['在「设置 → 模型绑定」把配音环节绑定到支持 TTS 的供应商。', '或临时跳过配音，先完成画面与剪辑。'],
    retryable: false,
  },
  {
    code: 'ASSET_GATE',
    test: /waiting_assets|等待资产|资产未齐|missingAssets/i,
    title: '等待一致性资产（任务被挂起）',
    cause: '该镜引用的人物/场景/道具还没有定妆图，按主线流程必须先补齐资产再出首帧。',
    suggestions: ['到「资产准备」补齐缺失的定妆图，系统会自动解封被阻塞的首帧任务。', '不要在资产未齐时手动强制生成，否则跨镜会换脸。'],
    severity: 'warning',
    retryable: true,
  },
  {
    code: 'REDIS_UNAVAILABLE',
    test: /redis|ECONNREFUSED.*6379|Connection is closed/i,
    title: 'Redis 连接异常',
    cause: 'BullMQ 队列依赖 Redis；连接断开或配置错误会让任务无法入队/消费。',
    suggestions: ['确认 Redis 在 6379 运行：redis-cli ping。', '本地部署允许降级为进程内队列，检查启动日志里的降级提示。'],
    severity: 'critical',
  },
  {
    code: 'DB_UNAVAILABLE',
    test: /postgres|ECONNREFUSED.*5432|relation .* does not exist|22P02/i,
    title: '数据库异常',
    cause: 'PostgreSQL 连接失败、表结构未迁移，或传入了非法 UUID。',
    suggestions: ['确认 PostgreSQL 16 已启动。', '执行 npm run db:migrate 补齐表结构。'],
    severity: 'critical',
  },
  {
    code: 'FFMPEG_MISSING',
    test: /ffmpeg|ffprobe|ENOENT.*spawn/i,
    title: '本地 ffmpeg 不可用',
    cause: '成片合成、媒体压缩依赖 ffmpeg，找不到可执行文件会让导出/压缩失败。',
    suggestions: ['安装 ffmpeg（Homebrew: brew install ffmpeg）。', '或在环境变量 FFMPEG_PATH 指向可执行文件。'],
  },
  {
    code: 'UPSTREAM_4XX',
    test: /\b400\b|\b403\b|\b404\b|invalid_request|bad request/i,
    title: '上游拒绝请求（参数或路径不合法）',
    cause: '请求体字段、模型名、尺寸或接口路径不符合供应商要求。',
    suggestions: ['展开系统日志里的上游完整响应体确认具体字段。', '核对「设置 → 供应商」的 Base URL 与模型名。'],
    retryable: false,
  },
  {
    code: 'UPSTREAM_5XX',
    test: /\b500\b|\b502\b|\b503\b|\b504\b|bad gateway|service unavailable/i,
    title: '上游服务异常',
    cause: '供应商或本地网关暂时不可用，与本次参数无关。',
    suggestions: ['稍后重试。', '检查本地网关与后端进程是否仍在运行。'],
    retryable: true,
  },
];

export function diagnoseError(text: string | null | undefined): ErrorDiagnosis {
  const s = (text ?? '').trim();
  if (!s) {
    return {
      code: 'NO_ERROR_TEXT',
      title: '任务未提供错误信息',
      cause: '任务被标记为失败但没有写下原因，通常是进程被强杀或任务被外部取消。',
      suggestions: ['查看该时间点附近的 server.log / trace.log。', '检查后端是否重启过。'],
      severity: 'warning',
      retryable: true,
    };
  }
  for (const r of RULES) {
    if (r.test.test(s)) {
      return {
        code: r.code,
        title: r.title,
        cause: r.cause,
        suggestions: r.suggestions,
        severity: r.severity ?? 'error',
        retryable: r.retryable ?? true,
      };
    }
  }
  return {
    code: 'UNKNOWN',
    title: '未归类的生成失败',
    cause: `上游返回的原始错误：${s.slice(0, 300)}`,
    suggestions: [
      '展开「系统日志 → 失败诊断」查看完整上游响应与任务输入。',
      '按 trace_id 在原始日志里检索同一请求的上下文。',
    ],
    severity: 'error',
    retryable: true,
  };
}
