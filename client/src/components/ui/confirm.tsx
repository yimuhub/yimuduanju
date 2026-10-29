import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 一幕·YIMU 自有确认框（已去平台化）。
 * 替代 @lark-apaas/client-toolkit 的 showConfirm——后者从包根导入，
 * 会连带打包平台组件链。用法：`if (!await showConfirm('确定删除？')) return;`
 */

let seq = 0;
type Pending = { id: number; message: string; resolve: (v: boolean) => void };
const listeners = new Set<(p: Pending[]) => void>();
let pendings: Pending[] = [];

function emit() {
  listeners.forEach((fn) => fn([...pendings]));
}

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = (seq += 1);
    pendings = [...pendings, { id, message, resolve }];
    emit();
  });
}

function settle(id: number, value: boolean) {
  const target = pendings.find((p) => p.id === id);
  pendings = pendings.filter((p) => p.id !== id);
  emit();
  target?.resolve(value);
}

/** 挂载一次（已在 Layout 中挂载，页面无需重复挂载） */
export function ConfirmHost() {
  const [items, setItems] = useState<Pending[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  if (items.length === 0) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      {items.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => settle(p.id, false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 20, minWidth: 300, maxWidth: 420 }}
          >
            <div style={{ fontSize: 14, marginBottom: 16 }}>{p.message}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => settle(p.id, false)}
                style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', background: '#fff' }}
              >
                取消
              </button>
              <button
                onClick={() => settle(p.id, true)}
                style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#111', color: '#fff' }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
