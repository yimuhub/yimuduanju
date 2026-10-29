import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 一木·YIMU AI 视频创作平台前端构建（已去平台化）。
 * 替代 @lark-apaas/fullstack-vite-preset——后者会在入口注入平台运行时
 * （遥测/水印/鉴权）、上报构建信息、代理沙箱域名。
 * 本配置只做纯构建：React + Tailwind(postcss) + 别名 + 环境变量透传。
 * 输出 dist/client（emptyOutDir 清理陈旧分包）。
 */
export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'client/public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@client': path.resolve(__dirname, 'client'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  define: {
    // 与 scripts/gateway.js 的 /app/yimu 前缀保持一致（basename 失配会导致首页 404）
    'process.env.CLIENT_BASE_PATH': JSON.stringify(process.env.CLIENT_BASE_PATH || '/app/yimu'),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
