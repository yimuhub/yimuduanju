/**
 * 一幕·YIMU AI 短剧创作平台 画布 v2 —— 3D 导演台（Pavo 融合）
 * 2D 俯视摆位示意：拖拽角色素体摆位、放置相机（低/高/侧）、导演视角/相机视角切换、
 * 导出「站位示意图」落回画布作为分镜参考。
 */
import { useMemo, useRef, useState } from 'react';
import { X, Camera, User, Download } from 'lucide-react';
import { PAVO_C } from './pavoTypes';

export interface StageItem {
  id: string;
  type: 'char' | 'cam';
  label: string;
  x: number; // 0-100
  y: number; // 0-100
  angle?: string; // 相机角度
  body?: string;  // 素体类型
}

export interface DirectorExport {
  title: string;
  items: StageItem[];
  image: string; // 站位示意图 dataURI
}

interface Props {
  open: boolean;
  onClose: () => void;
  onExport: (out: DirectorExport) => void;
}

const BODY_TYPES = ['男性', '女性', '高瘦', '健壮', '少年', '儿童', '二头身'];
const CAM_ANGLES = ['平视', '俯角', '仰角', '侧拍'];

const Director3DPanel = ({ open, onClose, onExport }: Props) => {
  const [items, setItems] = useState<StageItem[]>([
    { id: 'c1', type: 'char', label: '女主', x: 34, y: 55, body: '女性' },
    { id: 'c2', type: 'char', label: '男主', x: 60, y: 42, body: '男性' },
    { id: 'cam1', type: 'cam', label: '相机01', x: 15, y: 20, angle: '平视' },
  ]);
  const [view, setView] = useState<'director' | 'cam'>('director');
  const [nextId, setNextId] = useState(3);
  const [dragging, setDragging] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const moveItem = (id: string, px: number, py: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.max(4, Math.min(96, ((px - rect.left) / rect.width) * 100));
    const ny = Math.max(6, Math.min(94, ((py - rect.top) / rect.height) * 100));
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, x: nx, y: ny } : it)));
  };

  const addChar = (body: string) => {
    setItems((arr) => [...arr, { id: `c${nextId}`, type: 'char', label: `角色${nextId}`, x: 30 + Math.random() * 40, y: 30 + Math.random() * 40, body }]);
    setNextId((n) => n + 1);
  };
  const addCam = () => {
    setItems((arr) => [...arr, { id: `cam${nextId}`, type: 'cam', label: `相机${nextId}`, x: 15 + Math.random() * 30, y: 15 + Math.random() * 30, angle: CAM_ANGLES[Math.floor(Math.random() * CAM_ANGLES.length)] }]);
    setNextId((n) => n + 1);
  };

  const exportShot = () => {
    // 生成站位示意图 SVG dataURI
    const w = 800, h = 500;
    const ground = `<rect x='0' y='0' width='${w}' height='${h}' fill='#F2F7F5'/>`;
    const grid = Array.from({ length: 8 }).map((_, i) => `<line x1='${i * 100}' y1='0' x2='${i * 100}' y2='${h}' stroke='rgba(31,169,126,0.12)'/><line x1='0' y1='${i * 62.5}' x2='${w}' y2='${i * 62.5}' stroke='rgba(31,169,126,0.12)'/>`).join('');
    const chars = items.filter((i) => i.type === 'char').map((c, i) => {
      const cx = (c.x / 100) * w, cy = (c.y / 100) * h;
      const colors = ['#1FA97E', '#178A66', '#4AC2A1', '#2F9E7F'];
      return `<circle cx='${cx}' cy='${cy}' r='18' fill='${colors[i % 4]}'/><text x='${cx}' y='${cy + 5}' text-anchor='middle' font-size='12' fill='#fff'>${c.label}</text>`;
    }).join('');
    const cams = items.filter((i) => i.type === 'cam').map((cm) => {
      const cx = (cm.x / 100) * w, cy = (cm.y / 100) * h;
      return `<g transform='translate(${cx},${cy})'><path d='M0,-10 L14,0 L0,10 Z' fill='#17332A'/><text x='4' y='-12' font-size='10' fill='#17332A'>${cm.label} ${cm.angle}</text></g>`;
    }).join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${ground}${grid}${chars}${cams}<text x='20' y='30' font-size='16' fill='#17332A' font-weight='bold'>3D导演台 · 站位示意图</text></svg>`;
    onExport({
      title: '导演台 · 站位示意图',
      items: [...items],
      image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    });
    onClose();
  };

  const sceneSvg = useMemo(() => {
    const W = 100, H = 100;
    const charEls = items.filter((i) => i.type === 'char').map((c) => {
      const colors = ['#1FA97E', '#178A66', '#4AC2A1', '#2F9E7F'];
      const idx = items.filter((i) => i.type === 'char').findIndex((x) => x.id === c.id);
      return (
        <g key={c.id} transform={`translate(${(c.x / 100) * 800},${(c.y / 100) * 500})`}>
          <circle r={16} fill={colors[idx % 4]} opacity={0.9} />
          <circle r={16} fill="none" stroke={dragging === c.id ? '#17332A' : 'none'} strokeWidth={2} />
          <text y={4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>{c.label}</text>
        </g>
      );
    });
    const camEls = items.filter((i) => i.type === 'cam').map((cm) => (
      <g key={cm.id} transform={`translate(${(cm.x / 100) * 800},${(cm.y / 100) * 500})`}>
        <path d="M0,-12 L16,0 L0,12 Z" fill="#17332A" />
        <text x={6} y={-13} fontSize={10} fill="#17332A">{cm.label}·{cm.angle}</text>
      </g>
    ));
    const grid = Array.from({ length: 8 }).map((_, i) => (
      <g key={i}>
        <line x1={i * 100} y1={0} x2={i * 100} y2={500} stroke="rgba(31,169,126,0.10)" />
        <line x1={0} y1={i * 62.5} x2={800} y2={i * 62.5} stroke="rgba(31,169,126,0.10)" />
      </g>
    ));
    return { grid, charEls, camEls };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dragging]);

  if (!open) return null;

  return (
    <div data-yimu-panel style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(20,35,30,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Roboto','PingFang SC','Segoe UI',Arial,sans-serif" }}>
      <div style={{ width: 980, maxWidth: '94vw', height: '86vh', background: PAVO_C.panel, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
        {/* 头部 */}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${PAVO_C.borderSoft}` }}>
          <span style={{ fontSize: 16 }}>🎥</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: PAVO_C.text }}>3D 导演台</span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 10 }}>
            <button onClick={() => setView('director')} style={{ padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, background: view === 'director' ? PAVO_C.primary : '#fff', color: view === 'director' ? '#fff' : '#3E4944', border: `1px solid ${view === 'director' ? PAVO_C.primary : PAVO_C.border}` }}>导演视角</button>
            <button onClick={() => setView('cam')} style={{ padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, background: view === 'cam' ? PAVO_C.primary : '#fff', color: view === 'cam' ? '#fff' : '#3E4944', border: `1px solid ${view === 'cam' ? PAVO_C.primary : PAVO_C.border}` }}>相机视角</button>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={exportShot} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: PAVO_C.primary, color: '#fff', border: 'none', fontSize: 11, fontWeight: 700 }}><Download size={12} /> 导出站位示意图</button>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#8A948F' }}><X size={18} /></button>
        </div>

        {/* 主体 */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* 左侧场景面板 */}
          <div style={{ width: 170, borderRight: `1px solid ${PAVO_C.borderSoft}`, padding: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7C8782', marginBottom: 6 }}>场景</div>
            <div style={{ fontSize: 9.5, color: '#8A948F', marginBottom: 10 }}>拖拽角色/相机摆位</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7C8782', marginBottom: 5 }}>添加角色素体</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {BODY_TYPES.map((b) => (
                <button key={b} onClick={() => addChar(b)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.borderSoft}`, fontSize: 10.5, color: '#3E4944' }}><User size={11} color={PAVO_C.primary} /> {b}素体</button>
              ))}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7C8782', margin: '10px 0 5px' }}>添加相机</div>
            <button onClick={addCam} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.borderSoft}`, fontSize: 10.5, color: '#3E4944' }}><Camera size={11} color={PAVO_C.primary} /> 相机</button>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7C8782', margin: '10px 0 5px' }}>当前元素</div>
            {items.map((it) => (
              <button key={it.id} onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))} title="点击删除" style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '4px 7px', borderRadius: 7, cursor: 'pointer', background: '#F2F5F4', border: 'none', fontSize: 9.5, color: '#5E6B65' }}>
                {it.type === 'char' ? '👤' : '🎥'} {it.label} {it.angle || it.body}
                <span style={{ marginLeft: 'auto', color: '#B0B8B3' }}>×</span>
              </button>
            ))}
          </div>

          {/* 舞台 */}
          <div style={{ flex: 1, position: 'relative', background: '#F2F7F5', overflow: 'hidden' }}>
            {view === 'director' ? (
              <svg
                ref={svgRef}
                viewBox="0 0 800 500"
                width="100%" height="100%"
                style={{ cursor: dragging ? 'grabbing' : 'default', touchAction: 'none' }}
                onMouseDown={(e) => {
                  const target = (e.target as SVGElement).closest('[data-item]');
                  if (target) setDragging(target.getAttribute('data-item'));
                }}
                onMouseMove={(e) => { if (dragging) moveItem(dragging, e.clientX, e.clientY); }}
                onMouseUp={() => setDragging(null)}
                onMouseLeave={() => setDragging(null)}
              >
                {sceneSvg.grid}
                {sceneSvg.camEls}
                {sceneSvg.charEls.map((el, i) => (
                  <g key={i} data-item={items.filter((x) => x.type === 'char')[i]?.id} style={{ cursor: 'grab' }}>
                    {el.props.children}
                  </g>
                ))}
                <text x={20} y={26} fontSize={14} fill="#17332A" fontWeight={700}>导演视角 · 俯视摆位</text>
                <text x={20} y={44} fontSize={10} fill="#6B7A74">拖拽人物/相机调整站位；切换「相机视角」查看取景</text>
              </svg>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#5E6B65' }}>相机视角 · 取景框（示意）</div>
                <div style={{ width: '58%', aspectRatio: '9/16', borderRadius: 12, border: '3px solid #17332A', background: '#E9F5F0', position: 'relative', boxShadow: '0 10px 30px rgba(15,45,35,0.15)' }}>
                  {items.filter((i) => i.type === 'char').map((c, i) => {
                    const colors = ['#1FA97E', '#178A66', '#4AC2A1', '#2F9E7F'];
                    return (
                      <div key={c.id} style={{ position: 'absolute', left: `${10 + ((c.x + i * 15) % 60)}%`, top: `${30 + ((c.y + i * 10) % 40)}%`, width: 30, height: 52, borderRadius: '50% 50% 8px 8px', background: colors[i % 4], opacity: 0.85, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3, fontSize: 8, color: '#fff', fontWeight: 700 }}>
                        {c.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Director3DPanel;
