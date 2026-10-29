import { useEffect, useState } from 'react';
import { providers as providersApi } from '@client/src/api';
import { MODELS } from './pavo3Constants';
import type { ModelItem } from './pavo3Types';

/**
 * 3.0 动态模型装配：画布模型列表从用户真实供应商配置拉取，
 * 彻底替换 pavo3Constants 里写死的假模型 ID。
 * - 有配置：每个供应商按 textModel/imageModel/videoModel/ttsModel 绑定展开成可选模型；
 * - 无任何配置：回落到内置演示列表并在 UI 引导去设置页添加供应商。
 * 模块级缓存 60s，多组件共享，不重复请求。
 */

interface DynamicModels {
  byKind: Record<string, ModelItem[]>;
  providerCount: number;
  loadedAt: number;
}

let cache: DynamicModels | null = null;
let inflight: Promise<DynamicModels> | null = null;
const listeners = new Set<(d: DynamicModels) => void>();

const KIND_OF: { kind: string; field: string }[] = [
  { kind: 'text', field: 'textModel' },
  { kind: 'image', field: 'imageModel' },
  { kind: 'video', field: 'videoModel' },
  { kind: 'audio', field: 'ttsModel' },
];

async function fetchDynamic(): Promise<DynamicModels> {
  try {
    const items = await providersApi.listProviders();
    const byKind: Record<string, ModelItem[]> = { text: [], image: [], video: [], audio: [] };
    for (const p of items as unknown as Record<string, unknown>[]) {
      const pname = String(p.name ?? '供应商');
      for (const { kind, field } of KIND_OF) {
        const model = p[field];
        if (typeof model === 'string' && model.trim()) {
          const id = model.trim();
          if (!byKind[kind].some((m) => m.id === id)) {
            byKind[kind].push({ id, name: id, desc: `来自 ${pname}`, kind: kind as ModelItem['kind'] });
          }
        }
      }
    }
    cache = { byKind, providerCount: items.length, loadedAt: Date.now() };
  } catch {
    cache = { byKind: {}, providerCount: 0, loadedAt: Date.now() };
  }
  return cache;
}

export function refreshCanvasModels(): void {
  inflight = fetchDynamic().then((d) => {
    listeners.forEach((fn) => fn(d));
    return d;
  });
}

function ensureLoading(): void {
  if (!cache && !inflight) inflight = fetchDynamic().then((d) => { listeners.forEach((fn) => fn(d)); return d; });
}

/** 画布模型列表 hook：优先动态配置，60s 静默刷新；无配置回落内置演示列表 */
export function useCanvasModels(kind: string): { models: ModelItem[]; providerCount: number } {
  const [, bump] = useState(0);
  useEffect(() => {
    ensureLoading();
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (cache && Date.now() - cache.loadedAt > 60_000) refreshCanvasModels();
    return () => { listeners.delete(fn); };
  }, []);
  const dynamic = cache?.byKind[kind] ?? [];
  if (dynamic.length > 0) return { models: dynamic, providerCount: cache?.providerCount ?? 0 };
  return { models: MODELS[kind] ?? [], providerCount: cache?.providerCount ?? 0 };
}
