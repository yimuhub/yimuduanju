/**
 * 用户身份 · 单一来源（Single Source of Truth）
 * ─────────────────────────────────────────────
 * 侧栏用户卡 / 顶栏头像 / 极客左栏用户卡 / 用户中心资料等所有展示处，
 * 一律从本模块取昵称、会员等级与头像首字，禁止各处再写死。
 *
 * 昵称持久化在 localStorage（yimu.account.nickname），默认「一幕用户」。
 * 组件在挂载时读取（切换页面即拿到最新值）；AccountPage 保存后通过
 * NICKNAME_CHANGE_EVENT 广播，同页挂载的组件可监听实时同步。
 */

import { useEffect, useState } from 'react';

export const NICKNAME_KEY = 'yimu.account.nickname';

/** 同文档昵称变更广播事件（storage 事件只在跨 tab 触发，同页用自定义事件） */
export const NICKNAME_CHANGE_EVENT = 'yimu:nickname-changed';

export const DEFAULT_NICKNAME = '一幕用户';
export const TIER_LABEL = '专业版';
export const AVATAR_INITIAL = '一';

/** 读取当前昵称（未设置时返回默认值） */
export function getNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) || DEFAULT_NICKNAME;
  } catch {
    return DEFAULT_NICKNAME;
  }
}

/** 保存昵称并广播变更（供同页挂载的组件同步） */
export function setNickname(nickname: string) {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    /* 隐私模式写不进去：本次会话内存值仍生效 */
  }
  window.dispatchEvent(new Event(NICKNAME_CHANGE_EVENT));
}

/** 头像首字：取昵称首字符，兜底 AVATAR_INITIAL（全站统一展示） */
export function getAvatarInitial(nickname?: string): string {
  return (nickname || getNickname() || AVATAR_INITIAL).slice(0, 1);
}

/**
 * 昵称订阅 hook：挂载读档 + 监听 NICKNAME_CHANGE_EVENT 实时同步。
 * 经典侧栏用户卡 / 极客左栏用户卡等共用，替代各处手写的 useState + useEffect 监听块。
 */
export function useNickname(): string {
  const [nickname, setNicknameState] = useState(getNickname);
  useEffect(() => {
    const onNicknameChange = () => setNicknameState(getNickname());
    window.addEventListener(NICKNAME_CHANGE_EVENT, onNicknameChange);
    return () => window.removeEventListener(NICKNAME_CHANGE_EVENT, onNicknameChange);
  }, []);
  return nickname;
}
