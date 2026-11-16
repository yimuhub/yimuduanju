/**
 * 时间线撤销历史持久化（IndexedDB）
 * -------------------------------------------------------------
 * 撤销栈原来只在内存，刷新即丢。这里按项目隔离落到 IndexedDB，
 * 只保留最近 30 条（EDL 快照体积可控），关闭页面再打开仍能撤销。
 * 任何异常都静默降级为「无历史」，绝不阻断编辑。
 */
import type { TimelineClip, TimelineTrackMeta } from '@shared/api.interface';

export interface HistoryEntry {
  label: string;
  before: TimelineClip[];
  after: TimelineClip[];
  /**
   * 轨道元信息快照：只有「跨轨拖拽新建轨」这种同时改 tracks 的操作才写。
   * 旧历史没有这两个字段，travel 时按「不变」处理，向后兼容。
   */
  tracksBefore?: TimelineTrackMeta[];
  tracksAfter?: TimelineTrackMeta[];
}

export interface HistorySnapshot {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

const DB_NAME = 'yimu-timeline';
const STORE = 'history';
const DB_VERSION = 1;
export const HISTORY_LIMIT = 30;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadHistory(projectId: string): Promise<HistorySnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(projectId);
      req.onsuccess = () => {
        const value = req.result as HistorySnapshot | undefined;
        resolve(value && Array.isArray(value.undo) ? value : null);
        db.close();
      };
      req.onerror = () => {
        resolve(null);
        db.close();
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function saveHistory(
  projectId: string,
  snapshot: HistorySnapshot,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        {
          undo: snapshot.undo.slice(-HISTORY_LIMIT),
          redo: snapshot.redo.slice(-HISTORY_LIMIT),
        },
        projectId,
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function clearHistory(projectId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
