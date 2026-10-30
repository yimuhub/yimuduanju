import { Check, Loader2, X } from 'lucide-react';
import type { GenerationProgress } from '@shared/api.interface';

interface GenerationProgressProps {
  steps: GenerationProgress[];
  currentStep?: string;
  overallProgress: number;
  currentMessage?: string;
}

const GenerationProgressView = ({
  steps,
  currentStep,
  overallProgress,
  currentMessage,
}: GenerationProgressProps) => {
  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              AI 正在生成你的短剧
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {currentMessage || '正在处理中，请耐心等待...'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {Math.round(overallProgress)}%
            </div>
            <div className="text-xs text-muted-foreground">总体进度</div>
          </div>
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/80">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Steps timeline */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h4 className="text-sm font-semibold text-foreground">生产链路</h4>
        <div className="mt-5 space-y-4">
          {steps.map((step, idx) => {
            const isDone = step.status === 'completed';
            const isRunning = step.status === 'running';
            const isFailed = step.status === 'failed';
            const isPending = step.status === 'pending';

            return (
              <div key={step.step} className="relative">
                {idx < steps.length - 1 && (
                  <div
                    className={`absolute left-[15px] top-8 h-full w-0.5 ${
                      isDone ? 'bg-emerald-400' : 'bg-border'
                    }`}
                    style={{ height: 'calc(100% + 16px)' }}
                  />
                )}
                <div className="flex items-start gap-4">
                  <div
                    className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                      isDone
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isRunning
                        ? 'border-primary bg-white text-primary'
                        : isFailed
                        ? 'border-red-500 bg-red-500 text-white'
                        : 'border-muted-foreground/30 bg-white text-muted-foreground/40'
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-4 w-4" />
                    ) : isFailed ? (
                      <X className="h-4 w-4" />
                    ) : isRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="text-xs font-medium">{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-medium ${
                          isDone || isRunning
                            ? 'text-foreground'
                            : isFailed
                            ? 'text-red-600'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {step.stepLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {step.progress}%
                      </span>
                    </div>
                    {step.message && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {step.message}
                      </p>
                    )}
                    {isRunning && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${step.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GenerationProgressView;
