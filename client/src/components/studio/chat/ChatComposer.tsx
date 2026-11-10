import { useEffect, useRef } from 'react';
import { Paperclip, Send, Square, X } from 'lucide-react';
import { toast } from 'sonner';

export interface PendingAttachment {
  name: string;
  text?: string;
  size?: number;
}

const TEXT_EXT = /\.(txt|md|markdown|json|csv|srt)$/i;
const MAX_CHARS = 60_000;

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  onStop: () => void;
  attachments: PendingAttachment[];
  onAddAttachment: (a: PendingAttachment) => void;
  onRemoveAttachment: (index: number) => void;
  placeholder?: string;
  /** 左侧业务动作（自动模式 / 一键创作 / 引用镜头等） */
  leftActions?: React.ReactNode;
  /** 发送快捷键提示，默认 Enter */
  sendHint?: string;
}

/**
 * 统一输入区：附件（剧本/小说 txt、md 等）+ 自动增高 + 流式生成中可停止。
 * 附件正文随消息发给模型并落库，界面只显示文件名，避免长文刷屏。
 */
export const ChatComposer = ({
  value,
  onChange,
  onSend,
  busy,
  onStop,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  placeholder = '描述题材、人物或改动，Enter 发送…',
  leftActions,
  sendHint = 'Enter',
}: ChatComposerProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自动增高：内容超过 190px 后内部滚动
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value]);

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files).slice(0, 5)) {
      if (!TEXT_EXT.test(file.name)) {
        toast.error(`${file.name} 暂不支持：请上传 txt / md / srt 等文本文件`);
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error(`${file.name} 超过 2MB，请精简后再上传`);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const text = await file.text();
        const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
        if (text.length > MAX_CHARS) {
          toast.info(`${file.name} 较长，已截取前 ${MAX_CHARS} 字送入对话`);
        }
        onAddAttachment({ name: file.name, text: clipped, size: file.size });
      } catch {
        toast.error(`${file.name} 读取失败`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const canSend = !busy && (!!value.trim() || attachments.length > 0);

  return (
    <div className="composer">
      <div className="composer-in">
        {attachments.length > 0 ? (
          <div className="chat-files" style={{ marginBottom: 8 }}>
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="chat-file">
                {a.name}
                <button
                  type="button"
                  className="chat-file-x"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => onRemoveAttachment(i)}
                >
                  <X />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="cbox">
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // 中文输入法组词中按 Enter 是选词，不能当发送
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
          <div className="cbar">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.json,.csv,.srt,text/plain"
              multiple
              hidden
              onChange={(e) => void pickFiles(e.target.files)}
            />
            <button
              type="button"
              className="ctool chat-attach"
              title="上传剧本 / 小说附件（txt、md、srt）"
              aria-label="上传附件"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </button>
            {leftActions}
            <div className="spacer" />
            <span className="kbd">{sendHint}</span>
            {busy ? (
              <button
                type="button"
                className="send chat-stop"
                onClick={onStop}
                aria-label="停止生成"
                title="停止生成（已生成内容会保留）"
              >
                <Square />
              </button>
            ) : (
              <button
                type="button"
                className="send"
                onClick={onSend}
                disabled={!canSend}
                aria-label="发送"
              >
                <Send />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};