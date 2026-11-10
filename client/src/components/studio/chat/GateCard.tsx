import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  FileText,
  Hand,
  Loader2,
  Users,
} from 'lucide-react';

export type GateStage = 'script' | 'storyboard' | 'final';

interface GateCardProps {
  stage: GateStage;
  projectId: string;
  shotCount: number;
  sceneCount: number;
  /** 当前仍未处理的失败任务数（重试成功的旧失败不计） */
  failedCount?: number;
  /** 人物/场景参考图到位情况（定妆进度） */
  consistency?: { ready: number; total: number } | null;
  busy: boolean;
  onApprove: (stage: GateStage) => void;
  onNavigate: (path: string) => void;
}

const STAGE_META = {
  script: {
    kicker: '门 1 / 3',
    title: '剧本已生成，确认后进入分镜',
    desc: '确认后系统会把剧本拆成场次与镜头；确认前仍可继续修改剧本。',
    icon: Hand,
    primary: '确认剧本 · 物化分镜',
  },
  storyboard: {
    kicker: '门 2 / 3',
    title: '分镜已就绪，确认后开始出首帧',
    desc: '确认后会为每个镜头提交首帧生成任务，完成后再进入视频生成。',
    icon: Clapperboard,
    primary: '确认分镜 · 生成首帧',
  },
  final: {
    kicker: '门 3 / 3',
    title: '成片已通过质检，确认后进入就绪',
    desc: '确认后项目进入「成片就绪」，可以预览、微调时间线并导出。',
    icon: BadgeCheck,
    primary: '确认成片',
  },
} as const;

/** 三道阶段确认门：把「下一步做什么、会花什么钱」摊开，确认后流水线自动继续 */
export const GateCard = ({
  stage,
  projectId,
  shotCount,
  sceneCount,
  failedCount = 0,
  consistency = null,
  busy,
  onApprove,
  onNavigate,
}: GateCardProps) => {
  const meta = STAGE_META[stage];
  const Icon = meta.icon;
  const primary =
    stage === 'storyboard' && shotCount > 0
      ? `${meta.primary}（${shotCount} 个镜头）`
      : meta.primary;

  return (
    <section className={`gate ${stage}`}>
      <div className="gate-head">
        <span className="gate-ico">
          <Icon />
        </span>
        <div className="gate-main">
          <div className="gate-kicker">{meta.kicker} · 等待你确认</div>
          <div className="gate-title">{meta.title}</div>
          <p className="gate-desc">{meta.desc}</p>
        </div>
      </div>

      <div className="gate-facts">
        {stage === 'script' ? (
          <>
            <div className="gate-fact">
              <span>下一步</span>
              <b>物化分镜</b>
            </div>
            <div className="gate-fact">
              <span>本门计费</span>
              <b>仅文本处理</b>
            </div>
            <div className="gate-fact">
              <span>可回退</span>
              <b>确认前可改剧本</b>
            </div>
          </>
        ) : null}
        {stage === 'storyboard' ? (
          <>
            <div className="gate-fact">
              <span>镜头</span>
              <b>{shotCount} 个</b>
            </div>
            <div className="gate-fact">
              <span>场景</span>
              <b>{sceneCount} 个</b>
            </div>
            <div className="gate-fact">
              <span>下一步计费</span>
              <b>{shotCount > 0 ? `${shotCount} 个首帧任务` : '按镜头计费'}</b>
            </div>
          </>
        ) : null}
        {stage === 'final' ? (
          <>
            <div className="gate-fact">
              <span>质检</span>
              <b>报告已生成</b>
            </div>
            <div className="gate-fact">
              <span>下一步</span>
              <b>成片就绪 / 导出</b>
            </div>
            <div className="gate-fact">
              <span>可回退</span>
              <b>仍可微调时间线</b>
            </div>
          </>
        ) : null}
      </div>

      {stage === 'storyboard' && consistency && consistency.total > 0 && consistency.ready < consistency.total ? (
        <div className="gate-warn info">
          <Users />
          <span>
            人物主图/四视图、场景与道具资产还有 <b>{consistency.total - consistency.ready}</b> 项没就绪
            （{consistency.ready}/{consistency.total}），补齐后再出首帧一致性更稳
          </span>
          <button
            type="button"
            className="gate-warn-act"
            onClick={() => onNavigate(`/project/${projectId}/bible`)}
          >
            去补齐 <ArrowRight />
          </button>
        </div>
      ) : null}

      {failedCount > 0 ? (
        <div className="gate-warn">
          <AlertTriangle />
          <span>
            还有 <b>{failedCount}</b> 个任务失败，直接确认可能带着缺口进入下一步
          </span>
          <button
            type="button"
            className="gate-warn-act"
            onClick={() => onNavigate(`/project/${projectId}/tasks`)}
          >
            去处理 <ArrowRight />
          </button>
        </div>
      ) : null}

      <div className="gate-acts">
        <button
          type="button"
          className="btn pri"
          disabled={busy}
          onClick={() => onApprove(stage)}
        >
          {busy ? (
            <>
              <Loader2 className="ico spin" /> 确认中…
            </>
          ) : (
            <>
              {primary} <ArrowRight className="ico" />
            </>
          )}
        </button>
        {stage === 'script' ? (
          <button type="button" className="btn" onClick={() => onNavigate(`/project/${projectId}/script`)}>
            <FileText className="ico" /> 先看剧本
          </button>
        ) : null}
        {stage === 'storyboard' ? (
          <button
            type="button"
            className="btn"
            onClick={() => onNavigate(`/project/${projectId}/storyboard`)}
          >
            <Clapperboard className="ico" /> 先看分镜
          </button>
        ) : null}
        {stage === 'final' ? (
          <button type="button" className="btn" onClick={() => onNavigate(`/project/${projectId}/qc`)}>
            查看质检
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => onNavigate(`/project/${projectId}/flow`)}>
          流程总控
        </button>
        <span className="gate-note">
          {stage === 'storyboard' ? '确认即提交付费生成任务' : '确认后自动继续下一步'}
        </span>
      </div>
    </section>
  );
};