/**
 * 同构版编辑器的 UI 上下文。
 *
 * Dockview 面板是跨 React 树渲染的，不能直接闭包读取工作台组件里的局部 state。
 * 把「预览比例、安全框、调色、吸附、素材池入口」这类纯 UI 值放进来，
 * 业务数据仍走 WorkbenchContext / EdlContext，避免形成第二份 EDL。
 */
import { createContext, useContext, type ReactNode, type RefObject } from 'react';

export type ParityRatio = '9:16' | '16:9' | '1:1' | '4:3';
export type ParityGrade = { brightness: number; contrast: number; saturation: number; filter: string };
export type ParityRightPanel = 'inspector' | 'pool';

export interface ParityEditorUI {
  ratio: ParityRatio;
  safe: boolean;
  grade: ParityGrade;
  snapOn: boolean;
  rightTab: ParityRightPanel;
  openImport: () => void;
  openCover: () => void;
  setSafe: (v: boolean | ((prev: boolean) => boolean)) => void;
  setGrade: (patch: Partial<ParityGrade>) => void;
  setSnapOn: (v: boolean) => void;
  setRightTab: (v: ParityRightPanel | ((prev: ParityRightPanel) => ParityRightPanel)) => void;
  focusPanel: (id: string) => void;
  toggleSide: (side: 'left' | 'right') => void;
  collapseState: { left: boolean; right: boolean };
  stageRef: RefObject<HTMLDivElement | null>;
}

const Ctx = createContext<ParityEditorUI | null>(null);

export const ParityEditorProvider = ({ value, children }: { value: ParityEditorUI; children: ReactNode }) => (
  <Ctx.Provider value={value}>{children}</Ctx.Provider>
);

export const useParityEditorUI = () => {
  const value = useContext(Ctx);
  if (!value) throw new Error('useParityEditorUI must be used inside ParityEditorProvider');
  return value;
};
