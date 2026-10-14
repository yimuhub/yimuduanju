import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';

/**
 * 一木·YIMU AI 视频创作平台应用入口（已去平台化）。
 * 说明：此前套用云端模板的 AppContainer（内含遥测上报/水印/鉴权 SDK、
 * 平台运行时调用），现改用自有外壳——ErrorBoundary + 自有 Toaster，
 * 不再向任何外部平台发送请求、不读 window.__platform__。
 */

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';
// 去平台化说明：应用直挂根路径 /（网关 5173 即首页），不再依赖构建注入的基址。
const BASENAME = CLIENT_BASE_PATH;

const CrashFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
    <h2 style={{ fontSize: 18, marginBottom: 8 }}>一木·YIMU AI 视频创作平台启动失败</h2>
    <pre style={{ color: '#666', fontSize: 12, whiteSpace: 'pre-wrap' }}>{error?.message}</pre>
    <button
      onClick={resetErrorBoundary}
      style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer' }}
    >
      重试
    </button>
  </div>
);

const MainApp = () => {
  return (
    <BrowserRouter basename={BASENAME}>
      <ErrorBoundary FallbackComponent={CrashFallback}>
        <RoutesComponent />
        {createPortal(<Toaster />, document.body)}
      </ErrorBoundary>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
