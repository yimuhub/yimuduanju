/**
 * 一幕·YIMU 自有日志（已去平台化）。
 * 替代 @lark-apaas/client-toolkit/logger——后者会把整套平台运行时
 * （遥测发送器/水印/鉴权）打进包。 Rostrum：只用 console，不上报。
 */

const PREFIX = '[一幕]';

type Args = unknown[];

export const logger = {
  debug: (...args: Args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(PREFIX, ...args);
    }
  },
  info: (...args: Args) => {
    console.log(PREFIX, ...args);
  },
  warn: (...args: Args) => {
    console.warn(PREFIX, ...args);
  },
  error: (...args: Args) => {
    console.error(PREFIX, ...args);
  },
  success: (...args: Args) => {
    console.log(PREFIX, ...args);
  },
};
