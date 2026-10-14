/**
 * 一木·YIMU AI 视频创作平台 无限画布 —— 自定义连线（带「小剪刀」剪断交互）
 * 悬停连线任意处 → 出现 ✂️ 按钮，点击剪断该连接。
 * （原 CanvasStudio v1 遗留组件，现收归 CanvasStudioV2 自有，避免跨目录依赖已删除的旧画布）
 */
import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

interface Props extends EdgeProps {
  data?: { onScissor?: (edgeId: string) => void };
}

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}: Props) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });
  const [hover, setHover] = useState(false);

  const handleScissor = (e: React.MouseEvent) => {
    e.stopPropagation();
    data?.onScissor?.(id);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#9C6FE0' : style.stroke || '#B8BFC7',
          strokeWidth: selected ? 2.5 : style.strokeWidth || 2,
        }}
        markerEnd={markerEnd}
      />
      <EdgeLabelRenderer>
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 10,
          }}
        >
          <button
            onClick={handleScissor}
            title="剪断连接"
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: '#fff',
              border: '1px solid rgba(0,0,0,0.15)',
              boxShadow: '0 1px 5px rgba(0,0,0,0.18)',
              cursor: 'pointer',
              fontSize: 13,
              lineHeight: '24px',
              textAlign: 'center',
              padding: 0,
              opacity: hover ? 1 : 0,
              transition: 'opacity .15s',
            }}
          >
            ✂️
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default CustomEdge;
