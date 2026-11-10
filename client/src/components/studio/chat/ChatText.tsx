/**
 * 轻量 Markdown 渲染：对话里模型常输出 **加粗**、列表与代码块。
 * 只处理这几类，保持零依赖；其余字符由 React 自动转义。
 */
import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  // **加粗** / `行内代码`；不处理嵌套，够用且不会吞普通文本
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="chat-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export const ChatText = ({ text }: { text: string }) => {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="chat-ul">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push(
          <pre key={`pre-${blocks.length}`} className="chat-pre">
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    if (/^\s*[-*·]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*·]\s+/, ''));
      continue;
    }
    flushList();
    if (!line.trim()) {
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h-${blocks.length}`} className="chat-h">
          {inline(heading[2])}
        </p>,
      );
      continue;
    }
    blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
  }
  flushList();
  if (code) {
    blocks.push(
      <pre key={`pre-${blocks.length}`} className="chat-pre">
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }
  return <>{blocks}</>;
};