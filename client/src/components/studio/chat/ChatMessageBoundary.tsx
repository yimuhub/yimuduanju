/**
 * 单条消息的渲染隔离。
 * -------------------------------------------------------------
 * 对话内容来自模型/服务端，历史里可能有缺字段的旧数据。任何一条消息渲染抛错，
 * 都不该把整个页面（含弹窗、设置面板）炸掉——之前一个 undefined 就会让
 * 顶层 ErrorBoundary 接管，用户看到的是整站变成「启动失败」白屏。
 * 这里把边界下沉到每条消息：坏的那条显示占位，其余照常。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ChatMessageBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 仅记录，不打断渲染；桌面端可在 devtools/日志里追溯
    console.error('消息渲染失败', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="turn agent">
          <div className="turn-h">
            <span className="turn-w a">一幕 Agent</span>
          </div>
          <div className="turn-b">
            <span className="chat-thinking">这条消息渲染失败，已跳过（可刷新重试）</span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
