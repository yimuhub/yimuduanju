/**
 * 风格中心 · 主流画风库浏览页
 * 分类 tab + 渐变卡片网格 + 详情弹窗（提示词复制 / 以此风格开拍）
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette, Check, Copy, Clapperboard, X, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  STYLE_LIBRARY,
  STYLE_CATEGORY_LABELS,
  type StylePreset,
  type StyleCategory,
} from '@client/src/data/styleLibrary';
import PageHeader from '@client/src/components/PageHeader';

type TabKey = StyleCategory | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '真人短剧' },
  { key: 'anime', label: '漫剧动漫' },
  { key: 'guofeng', label: '国风水墨' },
  { key: 'three_d', label: '3D 写实' },
  { key: 'stylized', label: '赛博朋克' },
];

/** 封面：优先用静态生成的 /covers/styles-<id>.svg（3:4），加载失败回退纯渐变底 */
const StyleCover = ({ style, className = 'aspect-[3/4]' }: { style: StylePreset; className?: string }) => (
  <div
    className={`relative overflow-hidden ${className}`}
    style={{
      background: `linear-gradient(135deg, ${style.gradient[0]}, ${style.gradient[1]})`,
    }}
  >
    <img
      src={`/covers/styles-${style.id}.svg`}
      alt={style.nameZh}
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
    <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap gap-1">
      {style.productLines.map((line) => (
        <span
          key={line}
          className="whitespace-nowrap rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur"
        >
          {line}
        </span>
      ))}
    </div>
  </div>
);

const StylesPage = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('all');
  const [selected, setSelected] = useState<StylePreset | null>(null);
  const [copied, setCopied] = useState<'positive' | 'negative' | null>(null);

  const styles = useMemo(
    () => (tab === 'all' ? STYLE_LIBRARY : STYLE_LIBRARY.filter((s) => s.category === tab)),
    [tab],
  );

  const copyText = async (text: string, kind: 'positive' | 'negative') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === 'positive' ? '正向提示词已复制' : '负面提示词已复制');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  const handleStartWithStyle = (style: StylePreset) => {
    // 携带风格提示词回创作作战室，由首页消费 location.state.stylePrompt
    navigate('/', { state: { stylePrompt: style.positivePrompt, styleName: style.nameZh } });
  };

  return (
    /* @container：窄坞（极客模式右栏）与整页共用本页，网格按容器宽度取列数 */
    <div className="@container space-y-6">
      <PageHeader
        title="风格中心"
        icon={Palette}
        description={`${STYLE_LIBRARY.length} 个主流画风，覆盖真人短剧 / 漫剧 / 广告三条产品线 · 点卡片查看提示词`}
      />

      {/* 分类 tab */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
              tab === item.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-input bg-card text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 卡片网格 */}
      {styles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card py-20 text-muted-foreground">
          <Palette className="mb-3 h-10 w-10 opacity-40" />
          <p>该分类暂无风格</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 @sm:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
          {styles.map((style) => (
            <button
              key={style.id}
              onClick={() => setSelected(style)}
              className="group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <StyleCover style={style} />
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                    {style.nameZh}
                  </h3>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {style.nameEn}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {style.tagline}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头图（横版裁切展示，避免 3:4 竖图撑爆弹窗） */}
            <div className="relative shrink-0">
              <StyleCover style={selected} className="aspect-[16/10]" />
              <button
                onClick={() => setSelected(null)}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/30 text-white backdrop-blur hover:bg-black/50"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {selected.nameZh}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {selected.nameEn}
                    </span>
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.tagline}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {STYLE_CATEGORY_LABELS[selected.category]}
                </span>
              </div>

              {/* 正向提示词 */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">正向提示词（英文）</span>
                  <button
                    onClick={() => copyText(selected.positivePrompt, 'positive')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary"
                  >
                    {copied === 'positive' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    复制
                  </button>
                </div>
                <p className="mt-2 rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground/80">
                  {selected.positivePrompt}
                </p>
              </div>

              {/* 负面提示词 */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">负面提示词</span>
                  <button
                    onClick={() => copyText(selected.negativePrompt, 'negative')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary"
                  >
                    {copied === 'negative' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    复制
                  </button>
                </div>
                <p className="mt-2 rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground/60">
                  {selected.negativePrompt}
                </p>
              </div>
            </div>

            {/* 底部操作条 */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                适用：
                {selected.productLines.map((line) => (
                  <span key={line} className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground/70">
                    {line}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleStartWithStyle(selected)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Clapperboard className="h-4 w-4" />
                以此风格开拍
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StylesPage;
