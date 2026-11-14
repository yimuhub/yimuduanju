/**
 * 「插入模板」菜单（migration 0025 提示词模板库的前端入口）。
 * 按钮 + 下拉目录：内置经验片段 + 技能库片段（用户可编辑复用），支持搜索过滤。
 * 选中后把片段正文回调给宿主，由宿主插入到当前光标位置（insertAtCursor）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { fetchPromptTemplates, type PromptTemplate } from '@client/src/lib/prompt-templates';

interface PromptTemplateButtonProps {
  /** 选中模板后的插入回调（宿主负责插入到自己的光标位置） */
  onInsert: (body: string) => void;
  /** 按钮文案（默认「插入模板」） */
  label?: string;
}

const SOURCE_LABEL: Record<PromptTemplate['source'], string> = {
  builtin: '经验库',
  skill: '技能库',
};

export const PromptTemplateButton = ({ onInsert, label = '插入模板' }: PromptTemplateButtonProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // 首次展开时拉目录（内置 + 技能库；技能库失败回落内置）
  useEffect(() => {
    if (!open || templates.length > 0 || loading) return;
    setLoading(true);
    fetchPromptTemplates()
      .then((list) => setTemplates(list))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q),
    );
  }, [templates, query]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-input px-2 py-1 text-[10px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
        title="从提示词模板库（经验片段 + 技能库）选择片段插入光标位置"
      >
        <Wand2 className="h-3 w-3" /> {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模板…"
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载模板…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">没有匹配的模板</p>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onInsert(t.body);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{t.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {SOURCE_LABEL[t.source]}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {t.body}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
