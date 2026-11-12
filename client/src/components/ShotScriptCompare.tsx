/**
 * 分镜 ↔ 剧本核对（并排对照）：左侧该镜头对应的剧本原文，右侧当前分镜生成的主图。
 * 纯展示组件（不含弹窗外壳），画布分镜节点与工作台分镜 Tab 共用同一份内容布局。
 * 剧本原文来源：项目 scriptText 按「场标题/场序」截取本场段落；截取失败回落场景摘要+对白。
 */

export interface ShotScriptCompareProps {
  /** 项目完整剧本（projects.scriptText） */
  scriptText?: string;
  /** 本镜所属场景（scenes 表）：标题/摘要/对白，作为剧本截取失败时的兜底 */
  scene?: { title?: string; summary?: string; dialogues?: { character?: string; text?: string }[] } | null;
  /** 本镜序号（标题展示） */
  shotNumber: number;
  /** 本镜台词 */
  shotDialogue?: string;
  /** 本镜画面描述 */
  shotVisualPrompt?: string;
  /** 当前主图 URL（无则显示占位提示） */
  imageUrl?: string;
  /** 景别中文名 */
  shotSizeLabel?: string;
}

/** 从完整剧本里截取某一场的原文：优先按场标题匹配，其次按场序取第 N 个场块 */
export function extractSceneScript(scriptText: string | undefined, sceneTitle: string | undefined, sceneNumber: number): string {
  const text = (scriptText ?? '').trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  // 场块切分（与后端 splitScenes 同口径的宽松标题正则）
  const headingRe = /^(第.{1,6}[场集幕镜]|#{1,3}\s*.+|SCENE\s*\d+)/i;
  const blocks: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (headingRe.test(line)) {
      if (current) blocks.push(current);
      current = { title: line.replace(/^#{1,3}\s*/, '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { title: '', lines: [line] };
    }
  }
  if (current) blocks.push(current);
  if (blocks.length === 0) return text;
  // 1) 场标题精确/包含匹配
  const t = (sceneTitle ?? '').trim();
  if (t) {
    const byTitle = blocks.find((b) => b.title && (b.title === t || b.title.includes(t) || t.includes(b.title)));
    if (byTitle) return [byTitle.title, ...byTitle.lines].join('\n').trim();
  }
  // 2) 按场序兜底
  const byIndex = blocks[sceneNumber - 1];
  if (byIndex) return [byIndex.title, ...byIndex.lines].join('\n').trim();
  return text;
}

const ShotScriptCompare = ({
  scriptText,
  scene,
  shotNumber,
  shotDialogue,
  shotVisualPrompt,
  imageUrl,
  shotSizeLabel,
}: ShotScriptCompareProps) => {
  const sceneTitle = scene?.title;
  const sceneNo = sceneTitle?.match(/第\s*(\d+)\s*[场集幕]/)?.[1];
  const excerpt = extractSceneScript(scriptText, sceneTitle, sceneNo ? Number(sceneNo) : shotNumber);
  const fallbackScript = [
    scene?.title ? `【${scene.title}】` : '',
    scene?.summary ?? '',
    ...(scene?.dialogues ?? []).map((d) => (d.character ? `${d.character}：${d.text ?? ''}` : (d.text ?? ''))),
  ]
    .filter(Boolean)
    .join('\n');
  const script = excerpt || fallbackScript || '（暂无剧本原文：请先在「剧本」页生成或粘贴剧本）';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 左：剧本原文（本场） */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">剧本原文（本场）</span>
          {sceneTitle && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{sceneTitle}</span>}
        </div>
        <pre className="max-h-72 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card p-2.5 text-xs leading-relaxed text-muted-foreground">
{script}
        </pre>
        {(shotDialogue || shotVisualPrompt) && (
          <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
            {shotDialogue && (
              <p>
                <span className="font-medium text-foreground">本镜台词：</span>
                <span className="text-muted-foreground">{shotDialogue}</span>
              </p>
            )}
            {shotVisualPrompt && (
              <p>
                <span className="font-medium text-foreground">画面描述：</span>
                <span className="text-muted-foreground">{shotVisualPrompt}</span>
              </p>
            )}
          </div>
        )}
      </div>
      {/* 右：当前分镜主图 */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">分镜 #{shotNumber} 主图</span>
          {shotSizeLabel && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{shotSizeLabel}</span>}
        </div>
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-card">
          {imageUrl ? (
            <img src={imageUrl} alt={`分镜 ${shotNumber} 主图`} className="max-h-72 w-auto max-w-full object-contain" />
          ) : (
            <div className="flex h-40 flex-col items-center justify-center text-xs text-muted-foreground">
              该镜头还没有主图，先「生成图片」再核对
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          核对要点：主图人物/场景是否与剧本原文一致；不一致可在左侧修改画面描述后重跑首帧。
        </p>
      </div>
    </div>
  );
};

export default ShotScriptCompare;
