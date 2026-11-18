/**
 * 一幕·神剪 · 自绘图标
 * 统一 24 栅格、1.7px 线宽、圆角端点；用于舞台走带与时间线工具，
 * 避免 Lucide 原生图标在深色高密度界面里显细、显乱。
 */
import type { ReactNode, SVGProps } from 'react';

const Base = ({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
    {children}
  </svg>
);

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M9 5.7c0-1 .99-1.55 1.76-1.07l8.2 5.02c.73.45.73 1.51 0 1.96l-8.2 5.02c-.77.48-1.76-.07-1.76-1.07V5.7Z" fill="currentColor" stroke="none" /></Base>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="7.2" y="5.2" width="3.1" height="13.6" rx="1.3" fill="currentColor" stroke="none" /><rect x="13.7" y="5.2" width="3.1" height="13.6" rx="1.3" fill="currentColor" stroke="none" /></Base>
);
export const IconFramePrev = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="5.2" y="5.2" width="2.1" height="13.6" rx=".8" fill="currentColor" stroke="none" /><path d="M18.6 6.3 10.9 12l7.7 5.7V6.3Z" fill="currentColor" stroke="none" /></Base>
);
export const IconFrameNext = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="16.7" y="5.2" width="2.1" height="13.6" rx=".8" fill="currentColor" stroke="none" /><path d="M5.4 6.3 13.1 12l-7.7 5.7V6.3Z" fill="currentColor" stroke="none" /></Base>
);
export const IconSkipStart = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="5.2" y="5.2" width="2.1" height="13.6" rx=".8" fill="currentColor" stroke="none" /><path d="M10.2 6.3 15.5 12l-5.3 5.7V6.3Z" fill="currentColor" stroke="none" /><path d="M15.6 6.3 20.9 12l-5.3 5.7V6.3Z" fill="currentColor" opacity=".55" stroke="none" /></Base>
);
export const IconSkipEnd = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="16.7" y="5.2" width="2.1" height="13.6" rx=".8" fill="currentColor" stroke="none" /><path d="M13.8 6.3 8.5 12l5.3 5.7V6.3Z" fill="currentColor" stroke="none" /><path d="M8.4 6.3 3.1 12l5.3 5.7V6.3Z" fill="currentColor" opacity=".55" stroke="none" /></Base>
);
export const IconFullscreen = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M8.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v2.5M15.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v2.5M8.5 19.5H6a1.5 1.5 0 0 1-1.5-1.5v-2.5M15.5 19.5H18a1.5 1.5 0 0 0 1.5-1.5v-2.5" strokeWidth="2" /></Base>
);
export const IconSplit = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M8.2 4.6 15.8 19.4" /><path d="M4.8 8.2h4.4M4.8 15.8h4.4" opacity=".6" /><path d="M15.4 8.2h3.8M15.4 15.8h3.8" opacity=".6" /><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" /></Base>
);
export const IconTrimLeft = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M7 4.5v15" strokeWidth="2" /><path d="M12 12H20" /><path d="m15.2 8.8-3.4 3.2 3.4 3.2" /><path d="M4.5 8h.01M4.5 12h.01M4.5 16h.01" opacity=".45" /></Base>
);
export const IconTrimRight = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M17 4.5v15" strokeWidth="2" /><path d="M4 12h8" /><path d="m8.8 8.8 3.4 3.2-3.4 3.2" /><path d="M19.5 8h.01M19.5 12h.01M19.5 16h.01" opacity=".45" /></Base>
);
export const IconRippleDelete = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M5 8.3h14" /><path d="M8.2 8.3V5.6c0-.6.5-1.1 1.1-1.1h5.4c.6 0 1.1.5 1.1 1.1v2.7" /><path d="M7 8.3l.7 10.1c0 .7.6 1.1 1.2 1.1h6.2c.7 0 1.2-.5 1.2-1.1l.7-10.1" /><path d="M10 12.2 13.8 16M13.8 12.2 10 16" opacity=".75" /></Base>
);
export const IconSelect = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M5.2 4.6 18 11.7l-5.8 1.3-2.5 5.6L5.2 4.6Z" fill="currentColor" stroke="none" /></Base>
);
export const IconRazor = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M7.2 4.8 16.8 19.2" /><path d="M5 9.2c0-1.5 1.2-2.7 2.7-2.7M19 14.8c0 1.5-1.2 2.7-2.7 2.7" opacity=".55" /><path d="M3.8 12h3.4M16.8 12h3.4" opacity=".35" /></Base>
);

/** 神剪助手：纯四角星，简洁大方；用于悬浮球与对话窗 */
export const IconShenJianAssistant = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p} strokeWidth="1.8">
    <path d="M12 3.1l2.12 6.78L20.9 12l-6.78 2.12L12 20.9l-2.12-6.78L3.1 12l6.78-2.12z" fill="currentColor" stroke="none" />
    <path d="M18.7 3.4l.62 1.98 1.98.62-1.98.62-.62 1.98-.62-1.98-1.98-.62 1.98-.62z" fill="currentColor" opacity=".5" stroke="none" />
  </Base>
);
