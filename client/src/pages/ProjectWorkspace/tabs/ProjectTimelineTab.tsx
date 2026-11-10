/**
 * 经典 / 极客模式 · 时间线迁移引导
 * -------------------------------------------------------------
 * 原「智能剪辑助手」页已取消：那 5 条轨道只是把同一批镜头重复画 5 遍，
 * 没有 AI、不能放音频字幕，唯一能改的是 shots.duration，和底部真时间线
 * 的 timeline_clips 互不同步（两份数据源）。
 *
 * 现在 Studio 只有一个时间线入口：项目功能条「时间线」→ 展开底部面板。
 * 经典 / 极客模式没有 Studio 外壳，这里保留入口但改成一键迁移，
 * 不让用户再落到假的剪辑界面。
 */
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Download,
  Film,
  Layers3,
  Scissors,
  Undo2,
  Wand2,
} from 'lucide-react';
import { switchUIMode } from '@client/src/lib/uiMode';

const CAPABILITIES = [
  {
    icon: Layers3,
    title: '一份 EDL 落库',
    desc: '画面 / 字幕 / 对白 / 配乐 / 音效全部读写 timeline_clips，刷新后不丢，不再各算各的时长。',
  },
  {
    icon: Scissors,
    title: '真剪辑操作',
    desc: '拖动片段改位置与轨道、左右把手修剪入出点、播放头处分割、首尾吸附对齐。',
  },
  {
    icon: Wand2,
    title: '字幕与音频素材',
    desc: '双击字幕就地改字，从项目资产库插入配音 / 配乐，随时新增可重叠的字幕轨与音轨。',
  },
  {
    icon: Undo2,
    title: '撤销重做与自动保存',
    desc: '⌘Z / ⌘⇧Z 回退，⌘S 立即保存；编辑 0.4 秒自动写回服务端。',
  },
  {
    icon: Download,
    title: '按 EDL 导出成片',
    desc: '先保存再按剪辑决策表合成 MP4，自动归档到项目资产，可烧录字幕。',
  },
  {
    icon: Clock,
    title: '镜头列表与选中详情',
    desc: '底部信息栏常驻总时长、片段 / 轨道数、镜头快速定位与当前镜详情。',
  },
];

const ProjectTimelineTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Film className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">时间线已并入 Studio 底部</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          原来的「智能剪辑助手」页已经取消：它只是把同一批镜头重复画在 5 条占位轨道上，
          没有 AI，也不能放音频、加字幕；改到的镜头时长与真正的剪辑决策表互不同步。
          现在只保留一个入口、一份数据源 —— Studio 底部的多轨时间线。
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => switchUIMode('studio', `/project/${id}`)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            切到 Studio 打开时间线
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate(`/project/${id}/storyboard`)}
            className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
          >
            返回分镜
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          切换后在项目功能条点「时间线」即可展开底部面板；⌥T 或 \ 可随时收起 / 展开。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <c.icon className="h-4 w-4 text-primary" />
              {c.title}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectTimelineTab;
