/**
 * 3D 导演台 · 场景构建工具（从 Director3D.tsx 机械抽出，行为零变化）
 * ─────────────────────────────────────────────
 * 只含纯 three.js 类型 / 常量 / 素体构建函数，与 React 组件无耦合：
 * Director3D.tsx 2200+ 行的巨型文件由此瘦身约 200 行；拆分仅为可维护性，
 * 任何构建函数的行为改动仍需走原回归（素体形状 / 群众阵列 / 几何子类型）。
 */
import * as THREE from 'three';

/* ---------------- 类型 ---------------- */
export type BodyKind = 'male' | 'female' | 'wide' | 'strong' | 'slim' | 'teen' | 'child' | 'chibi' | 'crowd' | 'geo' | 'cube' | 'sphere' | 'cylinder' | 'torus' | 'cone' | 'pyramid';

export interface StageChar {
  id: string;
  name: string;
  kind: BodyKind;
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
  color: string;
  visible: boolean;
  locked: boolean;
}
export interface StageCam {
  id: string;
  name: string;
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  visible: boolean;
  locked: boolean;
  fov?: number;
  lookTarget?: 'auto' | 'manual';
  lookX?: number; lookY?: number; lookZ?: number;
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const DEFAULT_VIEW = new THREE.Vector3(4.5, 3.6, 5.5);

/* ---------------- 常量（Pavo 同款） ---------------- */
export const BODY_KINDS: { key: BodyKind; label: string; children?: { key: BodyKind; label: string }[] }[] = [
  { key: 'male', label: '男性素体' },
  { key: 'female', label: '女性素体' },
  { key: 'wide', label: '宽厚素体' },
  { key: 'strong', label: '健壮素体' },
  { key: 'slim', label: '纤细素体' },
  { key: 'teen', label: '少年素体' },
  { key: 'child', label: '儿童素体' },
  { key: 'chibi', label: '二头身' },
  { key: 'crowd', label: '群众 (3x3)' },
  {
    key: 'geo', label: '几何模型',
    children: [
      { key: 'cube', label: '立方体' },
      { key: 'sphere', label: '球体' },
      { key: 'cylinder', label: '圆柱体' },
      { key: 'torus', label: '环状体' },
      { key: 'cone', label: '圆锥' },
      { key: 'pyramid', label: '棱锥' },
    ],
  },
];
export const RATIOS: { key: string; label: string; value: number | null }[] = [
  { key: 'auto', label: '自动', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '2:1', label: '2:1', value: 2 },
  { key: '3:4', label: '3:4', value: 3 / 4 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
  { key: '21:9', label: '21:9', value: 21 / 9 },
  { key: '9:16', label: '9:16', value: 9 / 16 },
];
export const PALETTE = ['#4F8EF7', '#E5484D', '#46A758', '#F5A524', '#8E4EC6', '#12A594', '#E93D82', '#11181C', '#3E63DD', '#9B8C3C'];

/* ---------------- 白模材质（共享实例，切换时暂存原材质到 userData） ---------------- */
export const CLAY_BODY = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.92 });
export const CLAY_CAM = new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.85 });
export const CLAY_GEO = new THREE.MeshStandardMaterial({ color: 0xdcd9d3, roughness: 0.95 });

/* ---------------- 素体构建（10 种） ---------------- */
function mkPart(color: string, r: number, len: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
}

/** 参数化人形：s 身高比例、肩宽、四肢粗细、头比例 */
function buildHumanoid(color: string, cfg: { h: number; shoulder: number; limbR: number; head: number; lean: number }): THREE.Group {
  const g = new THREE.Group();
  const { h, shoulder, limbR, head, lean } = cfg;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const body = new THREE.Group();
  g.add(body);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22 * head, 24, 24), mat);
  headMesh.position.y = h * 0.92;
  g.add(headMesh);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28 * lean, 0.7 * h * 0.55, 8, 16), mat);
  torso.position.y = h * 0.62;
  body.add(torso);

  const armL = new THREE.Group();
  armL.position.set(0.36 * shoulder, h * 0.78, 0);
  const a1 = mkPart(color, limbR, 0.3 * h); a1.position.y = -0.15 * h;
  armL.add(a1);
  const a2 = mkPart(color, limbR * 0.85, 0.28 * h); a2.position.y = -0.42 * h;
  armL.add(a2);
  g.add(armL);

  const armR = new THREE.Group();
  armR.position.set(-0.36 * shoulder, h * 0.78, 0);
  const b1 = mkPart(color, limbR, 0.3 * h); b1.position.y = -0.15 * h;
  armR.add(b1);
  const b2 = mkPart(color, limbR * 0.85, 0.28 * h); b2.position.y = -0.42 * h;
  armR.add(b2);
  g.add(armR);

  const legL = new THREE.Group();
  legL.position.set(0.15 * lean, h * 0.4, 0);
  const l1 = mkPart(color, limbR * 1.3, 0.32 * h); l1.position.y = -0.16 * h;
  legL.add(l1);
  const l2 = mkPart(color, limbR * 1.1, 0.28 * h); l2.position.y = -0.44 * h;
  legL.add(l2);
  g.add(legL);

  const legR = new THREE.Group();
  legR.position.set(-0.15 * lean, h * 0.4, 0);
  const r1 = mkPart(color, limbR * 1.3, 0.32 * h); r1.position.y = -0.16 * h;
  legR.add(r1);
  const r2 = mkPart(color, limbR * 1.1, 0.28 * h); r2.position.y = -0.44 * h;
  legR.add(r2);
  g.add(legR);

  g.userData.parts = { armL, armR, legL, legR, body };
  return g;
}

// P1 修复：几何体子类型（cube/sphere/…）走 buildBody 的几何分支，不需要人体参数；之前 Record<BodyKind> 强制要求全量导致类型错误
const BODY_CFG: Partial<Record<BodyKind, { h: number; shoulder: number; limbR: number; head: number; lean: number }>> = {
  male: { h: 1.8, shoulder: 1, limbR: 0.07, head: 1, lean: 1 },
  female: { h: 1.72, shoulder: 0.82, limbR: 0.055, head: 1.06, lean: 0.88 },
  wide: { h: 1.8, shoulder: 1.3, limbR: 0.09, head: 0.95, lean: 1.15 },
  strong: { h: 1.85, shoulder: 1.18, limbR: 0.11, head: 0.9, lean: 1.08 },
  slim: { h: 1.82, shoulder: 0.88, limbR: 0.05, head: 1.02, lean: 0.9 },
  teen: { h: 1.55, shoulder: 0.85, limbR: 0.06, head: 1.1, lean: 0.92 },
  child: { h: 1.15, shoulder: 0.8, limbR: 0.055, head: 1.3, lean: 0.95 },
  chibi: { h: 0.9, shoulder: 0.95, limbR: 0.08, head: 1.9, lean: 1.25 },
  crowd: { h: 1.1, shoulder: 0.85, limbR: 0.06, head: 1.15, lean: 0.9 },
  geo: { h: 1.6, shoulder: 1, limbR: 0.07, head: 1, lean: 1 },
};

export function buildBody(kind: BodyKind, color: string): THREE.Group {
  const isGeo = kind === 'geo' || kind === 'cube' || kind === 'sphere' || kind === 'cylinder' || kind === 'torus' || kind === 'cone' || kind === 'pyramid';
  if (isGeo) {
    // 几何模型（Pavo 二级菜单：立方体/球体/圆柱体/环状体/圆锥/棱锥）
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
    if (kind === 'geo') {
      // 兼容旧数据：默认立方体
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.85), mat);
      m.position.y = 0.8;
      g.add(m);
    } else if (kind === 'cube') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat);
      m.position.y = 0.45;
      g.add(m);
    } else if (kind === 'sphere') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), mat);
      m.position.y = 0.55;
      g.add(m);
    } else if (kind === 'cylinder') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 24), mat);
      m.position.y = 0.65;
      g.add(m);
    } else if (kind === 'torus') {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 16, 48), mat);
      m.position.y = 0.55;
      g.add(m);
    } else if (kind === 'cone') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 24), mat);
      m.position.y = 0.65;
      g.add(m);
    } else if (kind === 'pyramid') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4), mat);
      m.position.y = 0.6;
      g.add(m);
    }
    return g;
  }
  const cfg = BODY_CFG[kind] ?? BODY_CFG.geo ?? { h: 1.6, shoulder: 1, limbR: 0.07, head: 1, lean: 1 };
  const g = buildHumanoid(color, cfg);
  if (kind === 'crowd') {
    // 群众 3x3：9 个小人排成方阵
    const step = 0.55;
    for (let i = 0; i < 9; i++) {
      const sub = buildHumanoid(color, { ...cfg, h: 0.9 });
      sub.position.set((i % 3 - 1) * step, 0, (Math.floor(i / 3) - 1) * step);
      g.add(sub);
      sub.userData.parts = undefined;
    }
  }
  return g;
}
