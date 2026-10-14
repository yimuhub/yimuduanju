/**
 * 模型 ID 启发式归类（添加供应商 → 拉模型后自动归类）。
 * ------------------------------------------------------------------
 * /models 只返回 id，没有能力字段，只能按命名规律猜：
 * 顺序很重要——先精确（doubao- 系列），再视频/图片/配音，最后文本兜底，
 * 都不中算 unknown（自动归类跳过， badge 标"未知"，人工指定）。
 * 猜错不致命：归类只做预填，所有字段都可手改。
 */

export type ModelKind = 'text' | 'image' | 'video' | 'tts' | 'unknown';

export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  text: '文字',
  image: '图片',
  video: '视频',
  tts: '配音',
  unknown: '未知',
};

const has = (id: string, ...keys: string[]) => keys.some((k) => id.includes(k));

export function classifyModelId(rawId: string): ModelKind {
  const id = (rawId ?? '').toLowerCase().trim();
  if (!id) return 'unknown';
  // 火山系精确前缀（seedream=图 vs seedance=视频极易混淆，先判）
  if (id.includes('doubao-seedream') || id.includes('seedream')) return 'image';
  if (id.includes('doubao-seedance') || id.includes('seedance')) return 'video';
  if (id.includes('doubao-tts')) return 'tts';
  if (id.includes('doubao-seed') || id.startsWith('doubao-')) return 'text';
  // 视频
  if (
    has(
      id, 'sora', 'veo', 'kling', 'hailuo', 'minimax', 'luma', 'runway',
      'pika', 'cogvideo', 'jimeng', 'gen-3', 'gen3', 'svd', 'video',
      'movie', 'motion', 'animate', 'wan2', 'wan-2',
    )
  ) {
    return 'video';
  }
  // 图片
  if (
    has(
      id, 'dall-e', 'gpt-image', 'imagen', 'flux', 'stable-diffusion',
      'sdxl', 'sd-xl', 'midjourney', 'wanx', 'ideogram', 'recraft',
      'image', 'picture', 'paint', 'photoreal',
    )
  ) {
    return 'image';
  }
  // 配音
  if (
    has(
      id, 'tts', 'text-to-speech', 'bark', 'vits', 'cosyvoice',
      'gpt-sovits', 'voice-clone', 'speech-t5',
    )
  ) {
    return 'tts';
  }
  // embedding/语音识别类：我们没有对应模型位，算未知（不进文本）
  if (has(id, 'embedding', 'bge-', 'm3e', 'rerank', 'whisper', 'asr')) return 'unknown';
  // 文字（明确文本信号才判）
  if (
    has(
      id, 'gpt', 'claude', 'deepseek', 'qwen', 'gemini', 'llama', 'mistral',
      'glm', 'moonshot', 'kimi', 'ernie', 'hunyuan', 'spark', 'chat',
      'instruct', 'turbo', 'mini', 'nano',
    )
  ) {
    return 'text';
  }
  return 'unknown';
}

/** 四个模型字段是干什么的（表单下方说明用） */
export const MODEL_FIELD_GUIDE: { field: string; label: string; desc: string }[] = [
  {
    field: 'textModel',
    label: '文本模型',
    desc: '动笔的活：AI 对话、剧本技能、人物卡、分镜表、运镜编排。没有它技能任务全 pending。',
  },
  {
    field: 'imageModel',
    label: '图片模型',
    desc: '画图的活：分镜首帧图、关键帧、角色参考图。白模是 3D 录的，不走这里。',
  },
  {
    field: 'videoModel',
    label: '视频模型',
    desc: '成片的活：首帧图→镜头视频。最烧钱的一个，预算看它。',
  },
  {
    field: 'ttsModel',
    label: '配音模型',
    desc: '说话的活：对白配音，配合下面的"默认音色"用。',
  },
];
