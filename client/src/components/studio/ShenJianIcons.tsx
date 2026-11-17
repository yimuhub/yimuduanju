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
  <Base {...p}><path d="M8.4 5.8c0-.8.9-1.3 1.6-.8l9 6.2c.6.4.6 1.2 0 1.6l-9 6.2c-.7.5-1.6 0-1.6-.8V5.8Z" fill="currentColor" stroke="none" /></Base>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><rect x="7" y="5" width="3.4" height="14" rx="1.4" fill="currentColor" stroke="none" /><rect x="13.6" y="5" width="3.4" height="14" rx="1.4" fill="currentColor" stroke="none" /></Base>
);
export const IconFramePrev = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M6 5v14" strokeWidth="2.2" /><path d="M18.5 6.2 10.6 12l7.9 5.8V6.2Z" fill="currentColor" stroke="none" /></Base>
);
export const IconFrameNext = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M18 5v14" strokeWidth="2.2" /><path d="M5.5 6.2 13.4 12l-7.9 5.8V6.2Z" fill="currentColor" stroke="none" /></Base>
);
export const IconSkipStart = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M6 5v14" strokeWidth="2.2" /><path d="M18.5 6.2 10.6 12l7.9 5.8V6.2Z" fill="currentColor" stroke="none" /><path d="M13 8.8 8.8 12l4.2 3.2" opacity=".55" /></Base>
);
export const IconSkipEnd = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}><path d="M18 5v14" strokeWidth="2.2" /><path d="M5.5 6.2 13.4 12l-7.9 5.8V6.2Z" fill="currentColor" stroke="none" /><path d="M11 8.8 15.2 12l-4.2 3.2" opacity=".55" /></Base>
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

/** 神剪助手：胶片 + 剪刀 + 星光，专用于悬浮球 */
export const IconShenJianAssistant = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p} strokeWidth="1.9">
    <rect x="3.6" y="5.2" width="12.8" height="13.6" rx="3.2" fill="currentColor" opacity=".18" stroke="none" />
    <rect x="3.6" y="5.2" width="12.8" height="13.6" rx="3.2" />
    <path d="M3.6 8.6h12.8M3.6 13.4h12.8" opacity=".55" />
    <path d="M17.6 7.2 21 12l-3.4 4.8" />
    <path d="M19.1 9.3l1.3 2.7-1.3 2.7" opacity=".5" />
    <path d="M9 10.2c1.2 0 2.2.9 2.2 2.1S10.2 14.4 9 14.4M9 10.2l4.2 4.2M9 14.4l4.2-4.2" />
  </Base>
);
