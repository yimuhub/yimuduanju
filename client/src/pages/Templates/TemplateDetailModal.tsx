import { X, Play, Clock, Monitor } from 'lucide-react';
import type { Template, TemplateType } from '@shared/api.interface';

// 全站统一品牌语言：模板封面兜底渐变统一为品牌红浅底（封面 SVG 缺失时的占位）
const getGradient = (_style?: string): string =>
  'from-primary/20 via-primary/10 to-primary/5';

const getTypeLabel = (type: TemplateType): string => {
  switch (type) {
    case 'duration':
      return '时长';
    case 'genre':
      return '题材';
    case 'style':
      return '风格';
    case 'full':
      return '完整';
    default:
      return type;
  }
};

const getTypeColor = (type: TemplateType): string => {
  switch (type) {
    case 'duration':
      return 'bg-blue-50 text-blue-600';
    case 'genre':
      return 'bg-purple-50 text-purple-600';
    case 'style':
      return 'bg-emerald-50 text-emerald-600';
    case 'full':
      return 'bg-primary/10 text-primary';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
};

interface TemplateDetailModalProps {
  template: Template;
  onClose: () => void;
  onUse: (template: Template) => void;
}

const TemplateDetailModal = ({
  template,
  onClose,
  onUse,
}: TemplateDetailModalProps) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`relative h-40 bg-gradient-to-br ${getGradient(
            template.artStyle,
          )} flex items-center justify-center`}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">未获取</span>
          <span
            className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-medium ${getTypeColor(
              template.templateType,
            )}`}
          >
            {getTypeLabel(template.templateType)}模板
          </span>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {template.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {template.description || '暂无描述'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <div className="text-xs text-muted-foreground">时长</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {formatDuration(template.durationSeconds)}
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <div className="text-xs text-muted-foreground">比例</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {template.aspectRatio}
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <div className="text-xs text-muted-foreground">风格</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {template.artStyle || '—'}
              </div>
            </div>
          </div>

          {template.config && (
            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold text-foreground">
                参数配置
              </h3>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>分镜数量</span>
                  <span className="text-foreground">
                    {template.config.shotCount} 个
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>单镜时长</span>
                  <span className="text-foreground">
                    {template.config.shotDuration} 秒
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>配音预设</span>
                  <span className="text-foreground">
                    {template.config.voicePreset}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>自动字幕</span>
                  <span className="text-foreground">
                    {template.config.subtitleEnabled ? '开启' : '关闭'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => onUse(template)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            使用此模板
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateDetailModal;
export { getGradient, getTypeLabel, getTypeColor, formatDuration };
