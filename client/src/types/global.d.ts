declare module '*.css';

// Vite ?url 资源导入（如 @ffmpeg/core 的 js/wasm 本地化打包）
declare module '*?url' {
  const value: string;
  export default value;
}

// Vite ?raw 原始文本导入（取未经转换的源码，如 ffmpeg ESM core）
declare module '*?raw' {
  const value: string;
  export default value;
}

// Vite ?worker&url 导入（打包为 Web Worker 并返回其 URL，如 ffmpeg classWorker）
declare module '*?worker&url' {
  const value: string;
  export default value;
}

// Type declarations for importing static assets
declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

declare module '*.webp' {
  const value: string;
  export default value;
}

declare module '*.ico' {
  const value: string;
  export default value;
}

declare module '*.json' {
  const value: any;
  export default value;
}

declare module '*.md' {
  const value: string;
  export default value;
}

declare module '*.csv' {
  const value: string;
  export default value;
}

declare namespace React {
  export interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
