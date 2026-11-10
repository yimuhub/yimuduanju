/**
 * Studio · 时间线编辑 Hook（Phase 2：编辑回写 + 撤销重做）
 * -------------------------------------------------------------
 * 单一编辑通道：所有时间线变更（排序 / 修剪 / 删除 / 分割 / 字幕）
 * 都走 execute()：
 *   1. 乐观更新 rawShots（经 useStudioData.commitShots，带 epoch 防 SSE 覆盖）
 *   2. 调后端 API（axiosForBackend，自动 CSRF）
 *   3. 成功 → 用服务端结果落定 + 入撤销栈 + reloadShots 对齐其它派生数据
 *      失败 → 回滚到操作前快照 + toast 报错（后端未就绪时页面不崩溃）
 *
 * 撤销 / 重做：快照式操作栈（before/after 全量 Shot[]），
 * persistEntry() 把服务端驱动到目标快照：
 *   · reorder → 整体重排
 *   · patch   → updateShot 差异字段（修剪 / 字幕）
 *   · delete  → 撤销=重建镜头（POST shots，服务端生成新 id 后重映射）+ 重排；
 *               重做=再次删除
 *   · split   → 重做=重新分割（新 id 重映射）；撤销=恢复原镜头参数 + 删除分裂镜
 *
 * 快捷键：Cmd/Ctrl+Z 撤销、Cmd/Ctrl+Shift+Z 重做、Delete/Backspace 删除选中镜。
 * 输入框（INPUT/TEXTAREA/SELECT/contentEditable）聚焦时全部不触发。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Shot, SplitShotResult } from '@shared/api.interface';
import { updateShot, deleteShot, createShot } from '@client/src/api/storyboard';
import { reorderShots, splitShot } from '@client/src/api/timeline';
import { useStudio } from './StudioShell';
import { shotIndexAt } from './model';

/** 与后端 DTO 一致的最小镜头时长 */
const MIN_DUR = 0.1;
/** 分割点距镜头两端的最小距离（秒），避免切出 0 时长片段 */
const SPLIT_EPS = 0.05;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** 与 model.normalizeShots 相同的排序规则，保证编辑下标与时间线一致 */
const sortRaw = (shots: Shot[]): Shot[] =>
  [...shots].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.shotNumber - b.shotNumber,
  );

/** 按数组顺序重编 sortOrder / shotNumber（与 reorder 契约一致） */
const renumber = (shots: Shot[]): Shot[] =>
  shots.map((s, i) => ({ ...s, sortOrder: i, shotNumber: i + 1 }));

const errMsg = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.join('；');
  return m || e?.message || '网络错误';
};

/** 重建镜头时只提交 CreateShotDto 认可的字段（inPoint/outPoint 由后端 P2 扩展接收） */
const toCreateBody = (s: Shot): Partial<Shot> => ({
  sceneId: s.sceneId,
  shotNumber: s.shotNumber,
  duration: s.duration,
  shotSize: s.shotSize,
  cameraAngle: s.cameraAngle,
  lens: s.lens,
  movement: s.movement,
  subject: s.subject,
  action: s.action,
  emotion: s.emotion,
  dialogue: s.dialogue,
  visualPrompt: s.visualPrompt,
  negativePrompt: s.negativePrompt,
  startFrameUrl: s.startFrameUrl,
  endFrameUrl: s.endFrameUrl,
  referenceImageUrls: s.referenceImageUrls,
  videoUrl: s.videoUrl,
  voiceUrl: s.voiceUrl,
  sfxUrls: s.sfxUrls,
  subtitleText: s.subtitleText,
  characterIds: s.characterIds,
  status: s.status,
  sortOrder: s.sortOrder,
  inPoint: s.inPoint,
  outPoint: s.outPoint,
});

type EditOp =
  | { kind: 'reorder' }
  | { kind: 'patch'; shotId: string; fields: Array<'duration' | 'inPoint' | 'outPoint' | 'subtitleText'> }
  | { kind: 'delete'; shotId: string }
  | { kind: 'split'; shotId: string; atSecond: number; createdId?: string };

interface HistoryEntry {
  label: string;
  before: Shot[];
  after: Shot[];
  op: EditOp;
}

/** 把分割结果合入快照：替换原镜、在其后插入新镜、整体重编号 */
const applySplitResult = (base: Shot[], res: SplitShotResult): Shot[] => {
  const idx = base.findIndex((s) => s.id === res.original.id);
  if (idx < 0) return base;
  const next = [...base];
  next.splice(idx, 1, res.original, res.created);
  return renumber(next);
};

/**
 * 把服务端驱动到 target 快照。方向由 target 内容判定：
 * delete/split 的 undo 与 redo 走相反分支；必要时重映射服务端新生成的 id。
 */
async function persistEntry(projectId: string, entry: HistoryEntry, target: Shot[]): Promise<void> {
  const op = entry.op;
  switch (op.kind) {
    case 'reorder': {
      await reorderShots(projectId, target.map((s) => s.id));
      return;
    }
    case 'patch': {
      const shot = target.find((s) => s.id === op.shotId);
      if (!shot) throw new Error('镜头不存在');
      const body: Partial<Shot> = {};
      for (const k of op.fields) {
        if (k === 'inPoint') body.inPoint = shot.inPoint ?? 0;
        else if (k === 'outPoint') body.outPoint = shot.outPoint ?? (shot.inPoint ?? 0) + shot.duration;
        else if (k === 'duration') body.duration = shot.duration;
        else body.subtitleText = shot.subtitleText ?? '';
      }
      await updateShot(projectId, op.shotId, body);
      return;
    }
    case 'delete': {
      const oldId = op.shotId;
      if (target.some((s) => s.id === oldId)) {
        // 目标态包含该镜 → 撤销删除：重建（服务端生成新 id）后重排回目标顺序
        const src = entry.before.find((s) => s.id === oldId);
        if (!src) throw new Error('缺少被删镜头快照');
        const created = await createShot(projectId, toCreateBody(src));
        entry.before = entry.before.map((s) => (s.id === oldId ? { ...created, sortOrder: src.sortOrder, shotNumber: src.shotNumber } : s));
        op.shotId = created.id;
        await reorderShots(projectId, target.map((s) => (s.id === oldId ? created.id : s.id)));
      } else {
        await deleteShot(projectId, oldId);
      }
      return;
    }
    case 'split': {
      const { shotId, atSecond, createdId } = op;
      if (createdId && target.some((s) => s.id === createdId)) {
        // 目标态包含分裂镜 → 重做：重新分割并重映射新 id
        const res = await splitShot(projectId, shotId, atSecond);
        op.createdId = res.created.id;
        entry.after = applySplitResult(entry.before, res);
      } else {
        // 撤销：删除分裂镜，并逐镜还原编号（分割曾把全表重编为 1..N）
        if (createdId) await deleteShot(projectId, createdId);
        for (const s of target) {
          if (s.id === shotId) {
            const body: Partial<Shot> = {
              duration: s.duration,
              shotNumber: s.shotNumber,
              sortOrder: s.sortOrder,
            };
            if (s.inPoint != null) body.inPoint = s.inPoint;
            if (s.outPoint != null) body.outPoint = s.outPoint;
            // eslint-disable-next-line no-await-in-loop
            await updateShot(projectId, shotId, body);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await updateShot(projectId, s.id, {
              shotNumber: s.shotNumber,
              sortOrder: s.sortOrder,
            });
          }
        }
      }
      return;
    }
    default:
      return;
  }
}

export interface TimelineEditor {
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** 拖拽排序：把 from 下标镜头移动到 to 下标（均为时间线下标） */
  reorder: (from: number, to: number) => Promise<void>;
  /** 边缘修剪：edge=left 移动入点，edge=right 移动出点；deltaSec 为时长变化量 */
  trim: (shotId: string, edge: 'left' | 'right', deltaSec: number) => Promise<void>;
  removeShot: (shotId: string) => Promise<void>;
  /** 在播放头处分割（自动定位播放头所在镜头） */
  splitAtPlayhead: () => Promise<void>;
  editSubtitle: (shotId: string, text: string) => Promise<void>;
}

export function useTimelineEditor(): TimelineEditor {
  const { data, projectId, sel, curT, setCurT } = useStudio();

  const ordered = useMemo(() => sortRaw(data.rawShots), [data.rawShots]);

  // 事件回调（interact / 键盘）里读最新值，避免闭包过期
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const ctxRef = useRef({ projectId, sel, curT, shots: data.shots });
  ctxRef.current = { projectId, sel, curT, shots: data.shots };
  /** data 对象每次渲染都会重建；用 ref 保证编辑回调引用稳定（interact 绑定期不失效） */
  const dataRef = useRef(data);
  dataRef.current = data;

  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [histVer, setHistVer] = useState(0);
  void histVer; // 仅用于触发 canUndo/canRedo 重新计算

  const commit = useCallback(
    (shots: Shot[]) => {
      dataRef.current.commitShots(shots);
      // 编辑后把播放头收敛到新总时长内
      const total = shots.reduce((s, x) => s + Math.max(0.1, x.duration || 0.1), 0);
      if (ctxRef.current.curT > total) setCurT(Math.max(0, total));
    },
    [setCurT],
  );

  /** 乐观更新 → API → 落定 / 回滚 */
  const execute = useCallback(
    async (
      label: string,
      optimistic: Shot[],
      op: EditOp,
      request: () => Promise<Shot[]>,
    ): Promise<boolean> => {
      const pid = ctxRef.current.projectId;
      if (!pid || busyRef.current) return false;
      const before = orderedRef.current;
      busyRef.current = true;
      setBusy(true);
      dataRef.current.setShotsLocked(true);
      commit(optimistic);
      try {
        const server = await request();
        const next = server && server.length > 0 ? sortRaw(server) : optimistic;
        commit(next);
        undoStack.current.push({ label, before, after: next, op });
        redoStack.current = [];
        setHistVer((v) => v + 1);
        dataRef.current.setShotsLocked(false);
        void dataRef.current.reloadShots();
        return true;
      } catch (err) {
        commit(before);
        dataRef.current.setShotsLocked(false);
        toast.error(`${label}失败`, { description: errMsg(err) });
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [commit],
  );

  const reorder = useCallback(
    async (from: number, to: number) => {
      const before = orderedRef.current;
      const pid = ctxRef.current.projectId;
      if (!pid || from === to || from < 0 || to < 0 || from >= before.length || to >= before.length) return;
      const ids = before.map((s) => s.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      const byId = new Map(before.map((s) => [s.id, s]));
      const optimistic = renumber(ids.map((id) => byId.get(id)!).filter(Boolean));
      await execute('调整镜头顺序', optimistic, { kind: 'reorder' }, async () => {
        const res = await reorderShots(pid, ids);
        return Array.isArray(res) && res.length === before.length ? res : optimistic;
      });
    },
    [execute],
  );

  const trim = useCallback(
    async (shotId: string, edge: 'left' | 'right', deltaSec: number) => {
      const before = orderedRef.current;
      const pid = ctxRef.current.projectId;
      const src = before.find((s) => s.id === shotId);
      if (!pid || !src || !Number.isFinite(deltaSec) || Math.abs(deltaSec) < 0.001) return;
      const inP = src.inPoint ?? 0;
      const dur = src.duration;
      let newIn = inP;
      let newDur = dur;
      if (edge === 'left') {
        // 入点不能移到源媒体 0 之前；时长不能低于 MIN_DUR
        const d = clamp(deltaSec, -inP, dur - MIN_DUR);
        newIn = round3(inP + d);
        newDur = round3(dur - d);
      } else {
        newDur = round3(Math.max(MIN_DUR, dur + deltaSec));
      }
      if (newDur === dur && newIn === inP) return;
      const patch = { duration: newDur, inPoint: newIn, outPoint: round3(newIn + newDur) };
      const optimistic = before.map((s) => (s.id === shotId ? { ...s, ...patch } : s));
      await execute(
        '修剪镜头',
        optimistic,
        { kind: 'patch', shotId, fields: ['duration', 'inPoint', 'outPoint'] },
        async () => {
          const r = await updateShot(pid, shotId, patch);
          return optimistic.map((s) => (s.id === shotId ? { ...s, ...r } : s));
        },
      );
    },
    [execute],
  );

  const removeShot = useCallback(
    async (shotId: string) => {
      const before = orderedRef.current;
      const pid = ctxRef.current.projectId;
      if (!pid || !before.some((s) => s.id === shotId)) return;
      const optimistic = renumber(before.filter((s) => s.id !== shotId));
      await execute('删除镜头', optimistic, { kind: 'delete', shotId }, async () => {
        await deleteShot(pid, shotId);
        return optimistic;
      });
    },
    [execute],
  );

  const splitAtPlayhead = useCallback(async () => {
    const { projectId: pid, curT: t, shots } = ctxRef.current;
    const before = orderedRef.current;
    if (!pid || shots.length === 0 || busyRef.current) return;
    const idx = shotIndexAt(shots, t);
    const target = shots[idx];
    const atSecond = round3(t - target.start);
    if (atSecond <= SPLIT_EPS || atSecond >= target.dur - SPLIT_EPS) {
      toast.info('请把播放头移到镜头内部再分割');
      return;
    }
    const src = before.find((s) => s.id === target.id);
    if (!src) return;
    const inP = src.inPoint ?? 0;
    const left: Shot = { ...src, duration: atSecond, inPoint: inP, outPoint: round3(inP + atSecond) };
    const right: Shot = {
      ...src,
      id: `tmp-split-${Date.now()}`,
      duration: round3(src.duration - atSecond),
      inPoint: round3(inP + atSecond),
      outPoint: src.outPoint ?? round3(inP + src.duration),
    };
    const pos = before.findIndex((s) => s.id === src.id);
    const optimistic = renumber([...before.slice(0, pos), left, right, ...before.slice(pos + 1)]);
    const op: EditOp = { kind: 'split', shotId: src.id, atSecond };
    await execute('分割镜头', optimistic, op, async () => {
      const res = await splitShot(pid, src.id, atSecond);
      op.createdId = res.created.id;
      return applySplitResult(before, res);
    });
  }, [execute]);

  const editSubtitle = useCallback(
    async (shotId: string, text: string) => {
      const before = orderedRef.current;
      const pid = ctxRef.current.projectId;
      const src = before.find((s) => s.id === shotId);
      if (!pid || !src || (src.subtitleText ?? '') === text) return;
      const optimistic = before.map((s) => (s.id === shotId ? { ...s, subtitleText: text } : s));
      await execute(
        '编辑字幕',
        optimistic,
        { kind: 'patch', shotId, fields: ['subtitleText'] },
        async () => {
          const r = await updateShot(pid, shotId, { subtitleText: text });
          return optimistic.map((s) => (s.id === shotId ? { ...s, ...r } : s));
        },
      );
    },
    [execute],
  );

  /** 撤销 / 重做共用：乐观应用目标快照 → persistEntry 驱动服务端 → 失败回滚 */
  const travel = useCallback(
    async (direction: 'undo' | 'redo') => {
      const pid = ctxRef.current.projectId;
      if (!pid || busyRef.current) return;
      const from = direction === 'undo' ? undoStack.current : redoStack.current;
      const entry = from[from.length - 1];
      if (!entry) return;
      const target = direction === 'undo' ? entry.before : entry.after;
      const rollback = direction === 'undo' ? entry.after : entry.before;
      busyRef.current = true;
      setBusy(true);
      dataRef.current.setShotsLocked(true);
      commit(target);
      try {
        await persistEntry(pid, entry, target);
        from.pop();
        (direction === 'undo' ? redoStack.current : undoStack.current).push(entry);
        setHistVer((v) => v + 1);
        dataRef.current.setShotsLocked(false);
        void dataRef.current.reloadShots();
        toast.success(direction === 'undo' ? `已撤销：${entry.label}` : `已重做：${entry.label}`, {
          duration: 1500,
        });
      } catch (err) {
        commit(rollback);
        dataRef.current.setShotsLocked(false);
        toast.error(direction === 'undo' ? '撤销失败' : '重做失败', { description: errMsg(err) });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [commit],
  );

  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  // 快捷键：Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z / S 分割 / Delete（输入框聚焦时不触发；
  // 破坏性操作仅当时间线区域悬停或聚焦时生效，避免在其它页误删镜头）
  const keysRef = useRef({ undo, redo, removeShot, splitAtPlayhead });
  keysRef.current = { undo, redo, removeShot, splitAtPlayhead };
  useEffect(() => {
    const timelineActive = () => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.closest?.('#tl')) return true;
      return Boolean(document.querySelector('#tl:hover'));
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void (e.shiftKey ? keysRef.current.redo() : keysRef.current.undo());
        return;
      }
      if (mod || e.altKey) return;
      if ((e.key === 's' || e.key === 'S') && timelineActive()) {
        e.preventDefault();
        void keysRef.current.splitAtPlayhead();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && timelineActive()) {
        const { shots, sel: i } = ctxRef.current;
        const shot = shots[i];
        if (shot) {
          e.preventDefault();
          void keysRef.current.removeShot(shot.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    busy,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undo,
    redo,
    reorder,
    trim,
    removeShot,
    splitAtPlayhead,
    editSubtitle,
  };
}