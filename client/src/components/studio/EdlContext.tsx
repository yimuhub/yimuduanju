/**
 * EDL 编辑器上下文
 * -------------------------------------------------------------
 * 时间线、对话里的「应用」卡、后续的检查器都必须操作同一个编辑器实例，
 * 否则撤销栈、冲突状态、选中态会分裂成两份。
 *
 * 注意：这里不重新拉数据，只把 StudioShell 的 data 交给 useEdlEditor，
 * 保证「同一数据源」红线。
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useEdlEditor, type EdlEditor } from './useEdlEditor';
import type { StudioData } from './useStudioData';

const EdlContext = createContext<EdlEditor | null>(null);

export const EdlProvider = ({
  data,
  children,
}: {
  data: StudioData;
  children: ReactNode;
}) => {
  const editor = useEdlEditor(data);
  return <EdlContext.Provider value={editor}>{children}</EdlContext.Provider>;
};

/** 必须在 EdlProvider 内使用；拿不到就抛错，避免静默走两套状态 */
export const useEdl = (): EdlEditor => {
  const editor = useContext(EdlContext);
  if (!editor) throw new Error('useEdl 必须在 EdlProvider 内使用');
  return editor;
};

/** 可选版本：草稿会话（新建作品）没有时间线，返回 null 而不是抛错 */
export const useEdlOptional = (): EdlEditor | null => useContext(EdlContext);
