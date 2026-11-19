/**
 * 神剪 UI 版本开关。
 * - parity：剪映同构版，默认进入。
 * - classic：原工作台，行为/尺寸完全保持不动，可随时切回对照。
 */
import { useEffect, useState } from 'react';

export type ShenJianVariant = 'classic' | 'parity';

// 升到 v2：旧版本存下的 classic 不再生效，确保老用户打开就是同构版。
const STORAGE_KEY = 'yimu:shenjian:ui-variant:v2';
const EVENT = 'yimu:shenjian-variant';

export function getShenJianVariant(): ShenJianVariant {
  if (typeof window === 'undefined') return 'parity';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('ui');
    if (fromQuery === 'parity' || fromQuery === 'classic') return fromQuery;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'parity' || saved === 'classic') return saved;
  } catch {
    // 无 localStorage / 无查询参数时回落到经典版
  }
  return 'parity';
}

export function setShenJianVariant(variant: ShenJianVariant) {
  try {
    window.localStorage.setItem(STORAGE_KEY, variant);
  } catch {
    // 仅本会话生效
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: variant }));
}

export function useShenJianVariant() {
  const [variant, setVariant] = useState<ShenJianVariant>(getShenJianVariant);
  useEffect(() => {
    const onLocal = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (next === 'classic' || next === 'parity') setVariant(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'classic' || e.newValue === 'parity') setVariant(e.newValue);
    };
    window.addEventListener(EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return variant;
}
