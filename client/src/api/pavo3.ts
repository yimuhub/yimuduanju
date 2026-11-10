import { axiosForBackend } from '@client/src/api/http';

/** 自由画布 · 三通道 API 真实生成（后端代理：火山方舟 / OpenAI 兼容中转 / 自定义） */
export interface P3RefInput {
  id?: string;
  title?: string;
  kind?: string;
  text?: string;
  url?: string;
}

export interface P3StyleInput {
  name: string;
  prompt: string;
  negative: string;
}

export interface P3GenerateRequest {
  type: 'text' | 'image' | 'video' | 'audio';
  prompt: string;
  negativePrompt?: string;
  size?: string;
  model?: string;
  refs?: P3RefInput[];
  style?: P3StyleInput | null;
  voice?: string;
  duration?: number;
  /** 视频画面内是否生成字幕/文字；缺省 false（字幕由后期统一添加） */
  onScreenText?: boolean;
  projectId?: string;
  taskId?: string;
}

export interface P3GenerateResult {
  ok: boolean;
  message?: string;
  mediaKind?: 'image' | 'video' | 'audio';
  text?: string;
  url?: string;
  model?: string;
  provider?: string;
  taskId?: string;
  costCny?: number;
}

/** 生成前检测：后端是否可达且已配置 Provider */
export const status = () =>
  axiosForBackend
    .get<{ configured: boolean; providerName?: string }>('/api/pavo3/status')
    .then((res) => res.data);

/** 通用生成代理 */
export const generate = (data: P3GenerateRequest) =>
  axiosForBackend
    .post<P3GenerateResult>('/api/pavo3/generate', data)
    .then((res) => res.data);
