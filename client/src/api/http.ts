import axios from 'axios';

/**
 * 一幕·YIMU 自有后端请求实例（已去平台化）。
 * 替代 @lark-apaas/client-toolkit 的 getAxiosForBackend——后者会在上报错误时
 * 向外部平台发送遥测（slardar），且带登录跳转逻辑（x-login-url）。
 * 本实例：同源相对路径、携带 cookie（网关/CSRF 桥接用）、401/403 直接抛错不跳转。
 */

function csrfFromCookie(): string | null {
  try {
    const m = /(?:^|;\s*)suda-csrf-token=([^;]+)/.exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export const http = axios.create({
  baseURL: '/',
  withCredentials: true,
});

http.interceptors.request.use((config) => {
  // 直连后端（:3000）时同样带上 CSRF 头；经网关时网关也会从 cookie 桥接
  const token =
    (typeof window !== 'undefined' && (window as unknown as { csrfToken?: string }).csrfToken) ||
    csrfFromCookie();
  if (token && config.headers) {
    if (typeof (config.headers as unknown as { set?: unknown }).set === 'function') {
      (config.headers as unknown as { set: (k: string, v: string) => void }).set('X-Suda-Csrf-Token', token);
    } else {
      (config.headers as Record<string, string>)['X-Suda-Csrf-Token'] = token;
    }
  }
  return config;
});

export const axiosForBackend = http;
export const getAxiosForBackend = () => http;
