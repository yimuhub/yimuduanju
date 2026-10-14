/**
 * 自由画布 3 · 1:1 复刻 Pavo AI Canvas
 * 3D 导演台（Pavo 完整版）：
 *  - 底部工具栏：变换模式(V/R/F) / 添加角色(10种素体) / 导入全景图 / 导入本地模型 / 添加机位 / 画幅比例(8种) / 当前/四方位/十二方位截图 / 全屏
 *  - 六向视图 + 三维坐标指示器 + 九宫格辅助线
 *  - 变换 Gizmo：移动箭头 / 旋转圆环 / 缩放
 *  - 机位视角取景预览窗 + 截图确认窗（落回画布为图片节点）
 *  - 左栏对象列表（眼睛/锁/搜索）、右栏属性/姿势面板
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  X, Eye, EyeOff, Lock, Unlock, Search, Camera, User, Plus, Download, Trash2,
  Move, Rotate3d, Scale, Maximize, Grid3x3, ImagePlus, Box, Grid3X3, ChevronRight,
  Circle, Video, Images, Upload, Clapperboard,
} from 'lucide-react';
import { useP3Store } from './pavo3Store';
import { BODY_SLIDERS, P3, POSE_PRESETS } from './pavo3Constants';
import { CAMERA_RIGS, type RigPathKind } from '@shared/camera-rigs';
import { uploadLocalFile } from '@client/src/api/assets';
import { rigScene } from '@client/src/api/storyboard';

/* ---------------- 类型 ---------------- */
type BodyKind = 'male' | 'female' | 'wide' | 'strong' | 'slim' | 'teen' | 'child' | 'chibi' | 'crowd' | 'geo' | 'cube' | 'sphere' | 'cylinder' | 'torus' | 'cone' | 'pyramid';
type TransformMode = 'move' | 'rotate' | 'scale';
type ShotMode = 'current' | '4' | '12';

interface StageChar {
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
interface StageCam {
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

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const DEFAULT_VIEW = new THREE.Vector3(4.5, 3.6, 5.5);

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
const PALETTE = ['#4F8EF7', '#E5484D', '#46A758', '#F5A524', '#8E4EC6', '#12A594', '#E93D82', '#11181C', '#3E63DD', '#9B8C3C'];

/* ---------------- 白模材质（共享实例，切换时暂存原材质到 userData） ---------------- */
const CLAY_BODY = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.92 });
const CLAY_CAM = new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.85 });
const CLAY_GEO = new THREE.MeshStandardMaterial({ color: 0xdcd9d3, roughness: 0.95 });

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

function buildBody(kind: BodyKind, color: string): THREE.Group {
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

/* ---------------- 变换 Gizmo ---------------- */
function buildGizmo(mode: TransformMode): THREE.Group {
  const giz = new THREE.Group();
  const AXES: { dir: THREE.Vector3; color: string; axis: string }[] = [
    { dir: new THREE.Vector3(1, 0, 0), color: '#E5484D', axis: 'x' },
    { dir: new THREE.Vector3(0, 1, 0), color: '#46A758', axis: 'y' },
    { dir: new THREE.Vector3(0, 0, 1), color: '#4F8EF7', axis: 'z' },
  ];
  if (mode === 'move') {
    for (const a of AXES) {
      const arrow = new THREE.ArrowHelper(a.dir, new THREE.Vector3(0, 0.02, 0), 0.62, a.color, 0.16, 0.08);
      arrow.traverse((o) => { o.userData.axis = a.axis; });
      giz.add(arrow);
    }
  } else if (mode === 'rotate') {
    for (const a of AXES) {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.018, 8, 48),
        new THREE.MeshBasicMaterial({ color: a.color }),
      );
      if (a.axis === 'x') torus.rotation.y = Math.PI / 2;
      else if (a.axis === 'z') torus.rotation.x = Math.PI / 2;
      torus.position.y = 0.02;
      torus.userData.axis = a.axis;
      giz.add(torus);
    }
  } else {
    for (const a of AXES) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshBasicMaterial({ color: a.color }),
      );
      box.position.set(a.dir.x * 0.62, 0.02 + a.dir.y * 0.62, a.dir.z * 0.62);
      box.userData.axis = a.axis;
      giz.add(box);
    }
  }
  return giz;
}

/* ---------------- 主组件 ---------------- */
export const Director3D = ({ projectId }: { projectId?: string }) => {
  const { director3DOpen, setDirector3DOpen } = useP3Store();
  const [view, setView] = useState<'director' | 'cam'>('director');
  const [tab, setTab] = useState<'属性' | '姿势'>('属性');
  const [selected, setSelected] = useState<string>('c1');
  const [search, setSearch] = useState('');
  const [transformMode, setTransformMode] = useState<TransformMode>('move');
  // 旋转/缩放灵敏度（Pavo 手感：阻尼滑行 + 适中速度；1.0 = 0.002 rad/px）
  const [sensitivity, setSensitivity] = useState(1);
  const [sensMenuOpen, setSensMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [leftKindMenu, setLeftKindMenu] = useState(false);
  const [subMenu, setSubMenu] = useState<string | null>(null);
  const [ratioMenuOpen, setRatioMenuOpen] = useState(false);
  const [ratio, setRatio] = useState('auto');
  const [guideLines, setGuideLines] = useState(false);
  const [panoramaFile, setPanoramaFile] = useState<string | null>(null);
  // P1 修复：替代 window.alert 的内联错误提示（3 秒自动消失）
  const [importError, setImportError] = useState<string | null>(null);
  const flashImportError = (msg: string) => {
    setImportError(msg);
    window.setTimeout(() => setImportError((cur) => (cur === msg ? null : cur)), 3000);
  };
  const [shotDialog, setShotDialog] = useState<{ mode: ShotMode; imgs: string[] } | null>(null);
  const [shotHistory, setShotHistory] = useState<string[]>([]);
  /* 白模产线：白模材质模式 + 相机路径录制 + 照片对位 */
  const [clayMode, setClayMode] = useState(false);
  const [recDuration, setRecDuration] = useState(5);
  const [recording, setRecording] = useState(false);
  const [recResult, setRecResult] = useState<{ url: string; blob: Blob; duration: number } | null>(null);
  const [recMsg, setRecMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rigMenuOpen, setRigMenuOpen] = useState(false);
  const [rigAiOpen, setRigAiOpen] = useState(false);
  const [rigDesc, setRigDesc] = useState('');
  const [rigTotal, setRigTotal] = useState(10);
  const [rigBeats, setRigBeats] = useState<{ rig: string; durationSeconds: number; note: string }[]>([]);
  const [rigJson, setRigJson] = useState('');
  const [rigBusy, setRigBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [compareShot, setCompareShot] = useState<{ photo: string; clay: string | null } | null>(null);
  const recordingRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const flashRecMsg = (msg: string) => {
    setRecMsg(msg);
    window.setTimeout(() => setRecMsg((cur) => (cur === msg ? null : cur)), 4000);
  };
  const [chars, setChars] = useState<StageChar[]>([
    { id: 'c1', name: '角色01', kind: 'male', x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color: PALETTE[0], visible: true, locked: false },
  ]);
  const [cams, setCams] = useState<StageCam[]>([
    { id: 'm1', name: '摄像机01', x: 2.2, y: 1.5, z: 3.2, rx: 0, ry: 0, rz: 0, visible: true, locked: false, fov: 50, lookTarget: 'auto', lookX: 0, lookY: 1, lookZ: 0 },
  ]);
  const [pose, setPose] = useState('站立');
  const [sliders, setSliders] = useState<Record<string, number>>(
    Object.fromEntries(BODY_SLIDERS.map((b) => [b.key, 0])),
  );

  const mountRef = useRef<HTMLDivElement>(null);
  const shotPreviewRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const charGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const camGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const gizmoRef = useRef<THREE.Group | null>(null);
  const importedRef = useRef<THREE.Group[]>([]);
  const dragRef = useRef<{ mode: 'orbit' | 'moveChar' | 'gizmo'; charId: string | null; axis: string | null; px: number; py: number; velX: number; velY: number; inDrag: boolean }>({
    mode: 'orbit', charId: null, axis: null, px: 0, py: 0, velX: 0, velY: 0, inDrag: false,
  });
  const stateRef = useRef({ chars, cams, selected, transformMode, sensitivity, view });
  stateRef.current = { chars, cams, selected, transformMode, sensitivity, view };

  /* ---------------- 场景基础设施（一次） ---------------- */
  useEffect(() => {
    if (!director3DOpen || !mountRef.current) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f6f8);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 200);
    camera.position.copy(DEFAULT_VIEW);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fc7ff, 0.4);
    fill.position.set(-4, 3, -3);
    scene.add(fill);

    const grid = new THREE.GridHelper(12, 12, 0xd0d0d0, 0xe4e4e4);
    scene.add(grid);
    const axes = new THREE.AxesHelper(2.5);
    scene.add(axes);

    /* 交互 */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const line = new THREE.Line3();

    const toNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const pickObject = (clientX: number, clientY: number): { kind: 'char' | 'cam' | 'gizmo'; id: string | null; axis: string | null } => {
      toNdc(clientX, clientY);
      // gizmo 优先
      const giz = gizmoRef.current;
      if (giz && giz.visible) {
        raycaster.setFromCamera(ndc, camera);
        const gh = raycaster.intersectObjects(giz.children, true);
        if (gh.length) {
          let node: THREE.Object3D | null = gh[0].object;
          while (node && !node.userData.axis) node = node.parent;
          if (node) return { kind: 'gizmo', id: null, axis: node.userData.axis as string };
        }
      }
      raycaster.setFromCamera(ndc, camera);
      const objs: THREE.Object3D[] = [];
      charGroupsRef.current.forEach((g) => objs.push(g));
      camGroupsRef.current.forEach((g) => objs.push(g));
      const hits = raycaster.intersectObjects(objs, true);
      if (!hits.length) return { kind: 'char', id: null, axis: null };
      let node: THREE.Object3D | null = hits[0].object;
      while (node && !node.userData.charId && !node.userData.camId) node = node.parent;
      if (node && node.userData.camId) return { kind: 'cam', id: node.userData.camId as string, axis: null };
      if (node && node.userData.charId) return { kind: 'char', id: node.userData.charId as string, axis: null };
      return { kind: 'char', id: null, axis: null };
    };

    const onDown = (e: MouseEvent) => {
      if (recordingRef.current) return; // 录制中锁定交互，相机由路径接管
      const st = stateRef.current;
      const p = pickObject(e.clientX, e.clientY);
      if (p.kind === 'gizmo' && p.axis) {
        dragRef.current = { mode: 'gizmo', charId: null, axis: p.axis, px: e.clientX, py: e.clientY, velX: 0, velY: 0, inDrag: true };
        return;
      }
      const id = p.id;
      if (id && p.kind === 'char') {
        const c = st.chars.find((x) => x.id === id);
        if (c && c.locked) return;
        if (c) setSelected(id);
        dragRef.current = { mode: 'moveChar', charId: id, axis: null, px: e.clientX, py: e.clientY, velX: 0, velY: 0, inDrag: true };
        return;
      }
      if (id && p.kind === 'cam') {
        const c = st.cams.find((x) => x.id === id);
        if (c && c.locked) return;
        if (c) setSelected(id);
        dragRef.current = { mode: 'moveChar', charId: id, axis: null, px: e.clientX, py: e.clientY, velX: 0, velY: 0, inDrag: true };
        return;
      }
      dragRef.current = { mode: 'orbit', charId: null, axis: null, px: e.clientX, py: e.clientY, velX: 0, velY: 0, inDrag: true };
    };

    const onMove = (e: MouseEvent) => {
      if (recordingRef.current) return;
      const d = dragRef.current;
      const st = stateRef.current;
      if (d.mode === 'gizmo' && d.axis) {
        const sel = st.selected;
        const isChar = st.chars.some((c) => c.id === sel);
        const obj = isChar
          ? charGroupsRef.current.get(sel)
          : camGroupsRef.current.get(sel);
        if (!obj) return;
        const base = obj.position.clone();
        if (st.transformMode === 'move') {
          const dir = new THREE.Vector3(d.axis === 'x' ? 1 : 0, d.axis === 'y' ? 1 : 0, d.axis === 'z' ? 1 : 0);
          line.set(base.clone().sub(dir.clone().multiplyScalar(50)), base.clone().add(dir.clone().multiplyScalar(50)));
          toNdc(e.clientX, e.clientY);
          raycaster.setFromCamera(ndc, camera);
          // P1 修复：three r185 Ray 已无 intersectLine，改用“相机朝向平面求交 + 投影到轴线”的等价实现；
          // 注意用独立临时平面，不可复用下方地面拖拽共用的 plane
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const gizmoPlane = new THREE.Plane();
          gizmoPlane.setFromNormalAndCoplanarPoint(camDir, base);
          if (raycaster.ray.intersectPlane(gizmoPlane, hit)) {
            const np = base.clone().add(dir.clone().multiplyScalar(hit.clone().sub(base).dot(dir)));
            const nx = Math.round(np.x * 100) / 100, ny = Math.round(np.y * 100) / 100, nz = Math.round(np.z * 100) / 100;
            if (isChar) setChars((arr) => arr.map((c) => (c.id === sel ? { ...c, x: nx, y: Math.max(0, ny), z: nz } : c)));
            else setCams((arr) => arr.map((c) => (c.id === sel ? { ...c, x: nx, y: ny, z: nz } : c)));
          }
        } else if (st.transformMode === 'rotate') {
          const dx = (e.clientX - d.px) * 0.012;
          const dy = (e.clientY - d.py) * 0.012;
          d.px = e.clientX; d.py = e.clientY;
          const delta = d.axis === 'x' ? dy : d.axis === 'y' ? dx : -dy;
          const rot: Record<string, 'rx' | 'ry' | 'rz'> = { x: 'rx', y: 'ry', z: 'rz' };
          const k = rot[d.axis];
          if (isChar) setChars((arr) => arr.map((c) => (c.id === sel ? { ...c, [k]: Math.round((c[k] + delta) * 100) / 100 } : c)));
          else setCams((arr) => arr.map((c) => (c.id === sel ? { ...c, [k]: Math.round((c[k] + delta) * 100) / 100 } : c)));
        } else {
          const dx = (e.clientX - d.px) * 0.005;
          d.px = e.clientX;
          const f = 1 + dx;
          if (isChar) setChars((arr) => arr.map((c) => (c.id === sel ? { ...c, sx: Math.min(8, Math.max(0.1, Math.round((c.sx * f) * 100) / 100)) } : c)));
        }
        return;
      }
      if (d.mode === 'moveChar' && d.charId) {
        toNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(ndc, camera);
        if (raycaster.ray.intersectPlane(plane, hit)) {
          const isChar = st.chars.some((c) => c.id === d.charId);
          const nx = Math.round(hit.x * 100) / 100, nz = Math.round(hit.z * 100) / 100;
          if (isChar) setChars((arr) => arr.map((c) => (c.id === d.charId ? { ...c, x: nx, z: nz } : c)));
          else setCams((arr) => arr.map((c) => (c.id === d.charId ? { ...c, x: nx, z: nz } : c)));
        }
        return;
      }
      if (d.mode === 'orbit') {
        const dx = e.clientX - d.px, dy = e.clientY - d.py;
        d.px = e.clientX; d.py = e.clientY;
        const rate = 0.002 * (stateRef.current.sensitivity || 1);
        const st = stateRef.current;
        const cm = st.view === 'cam' ? st.cams.find((x) => x.id === st.selected) : undefined;
        const lx = cm && cm.lookTarget === 'manual' ? (cm.lookX ?? 0) : 0;
        const ly = cm && cm.lookTarget === 'manual' ? (cm.lookY ?? 1) : 1;
        const lz = cm && cm.lookTarget === 'manual' ? (cm.lookZ ?? 0) : 0;
        const offset = camera.position.clone().sub(new THREE.Vector3(lx, ly, lz));
        const r = offset.length();
        const theta = Math.atan2(offset.x, offset.z) + dx * rate;
        const phi = Math.acos(Math.min(0.99, Math.max(0.2, offset.y / r))) + dy * rate;
        offset.set(
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.cos(theta),
        );
        camera.position.copy(new THREE.Vector3(lx, ly, lz).add(offset));
        camera.lookAt(lx, ly, lz);
        d.velX = dx * rate;
        d.velY = dy * rate;
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      d.mode = 'orbit'; d.charId = null; d.axis = null; d.inDrag = false; d.px = 0; d.py = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = stateRef.current;
      const cm = st.view === 'cam' ? st.cams.find((x) => x.id === st.selected) : undefined;
      const lx = cm && cm.lookTarget === 'manual' ? (cm.lookX ?? 0) : 0;
      const ly = cm && cm.lookTarget === 'manual' ? (cm.lookY ?? 1) : 1;
      const lz = cm && cm.lookTarget === 'manual' ? (cm.lookZ ?? 0) : 0;
      const dir = camera.position.clone().sub(new THREE.Vector3(lx, ly, lz)).normalize();
      camera.position.addScaledVector(dir, e.deltaY * 0.0035 * (st.sensitivity || 1));
      camera.lookAt(lx, ly, lz);
    };
    mount.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    mount.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // 阻尼惯性（Pavo OrbitControls 手感）：松手后按速度滑行并衰减
      const d = dragRef.current;
      if (!d.inDrag && (Math.abs(d.velX) > 0.00015 || Math.abs(d.velY) > 0.00015)) {
        const st = stateRef.current;
        const cm = st.view === 'cam' ? st.cams.find((x) => x.id === st.selected) : undefined;
        const lx = cm && cm.lookTarget === 'manual' ? (cm.lookX ?? 0) : 0;
        const ly = cm && cm.lookTarget === 'manual' ? (cm.lookY ?? 1) : 1;
        const lz = cm && cm.lookTarget === 'manual' ? (cm.lookZ ?? 0) : 0;
        const offset = camera.position.clone().sub(new THREE.Vector3(lx, ly, lz));
        const r = offset.length();
        const theta = Math.atan2(offset.x, offset.z) + d.velX;
        const phi = Math.acos(Math.min(0.99, Math.max(0.2, offset.y / r))) + d.velY;
        offset.set(
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.cos(theta),
        );
        camera.position.copy(new THREE.Vector3(lx, ly, lz).add(offset));
        camera.lookAt(lx, ly, lz);
        d.velX *= 0.9;
        d.velY *= 0.9;
      } else if (!d.inDrag) {
        d.velX = 0; d.velY = 0;
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      mount.removeEventListener('wheel', onWheel);
      charGroupsRef.current.clear();
      camGroupsRef.current.clear();
      gizmoRef.current = null;
      importedRef.current = [];
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [director3DOpen]);

  /* ---------------- 对象同步：角色/摄像机 ---------------- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    charGroupsRef.current.forEach((g) => scene.remove(g));
    charGroupsRef.current.clear();
    camGroupsRef.current.forEach((g) => scene.remove(g));
    camGroupsRef.current.clear();
    chars.forEach((c) => {
      const g = buildBody(c.kind, c.color);
      g.position.set(c.x, c.y, c.z);
      g.rotation.set(c.rx, c.ry, c.rz);
      g.scale.set(c.sx, c.sy, c.sz);
      g.userData.charId = c.id;
      g.visible = c.visible !== false;
      scene.add(g);
      charGroupsRef.current.set(c.id, g);
    });
    cams.forEach((cm) => {
      const g = buildCameraMarker();
      g.position.set(cm.x, cm.y, cm.z);
      g.rotation.set(cm.rx, cm.ry, cm.rz);
      g.userData.camId = cm.id;
      g.visible = cm.visible !== false;
      scene.add(g);
      camGroupsRef.current.set(cm.id, g);
    });
  }, [chars, cams, director3DOpen]);

  /* ---------------- Gizmo 同步（跟随选中对象 + 模式） ---------------- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (gizmoRef.current) {
      scene.remove(gizmoRef.current);
      gizmoRef.current = null;
    }
    const isChar = chars.some((c) => c.id === selected);
    const obj = isChar ? charGroupsRef.current.get(selected) : camGroupsRef.current.get(selected);
    const c = isChar ? chars.find((x) => x.id === selected) : cams.find((x) => x.id === selected);
    if (!obj || !c || c.visible === false || c.locked) return;
    const giz = buildGizmo(transformMode);
    giz.position.set(c.x, c.y, c.z);
    giz.visible = true;
    scene.add(giz);
    gizmoRef.current = giz;
    return () => {
      if (gizmoRef.current) {
        scene.remove(gizmoRef.current);
        gizmoRef.current = null;
      }
    };
  }, [chars, cams, selected, transformMode, view]);

  /* ---------------- 姿势应用到选中角色 ---------------- */
  useEffect(() => {
    const g = charGroupsRef.current.get(selected);
    if (!g) return;
    const parts = (g.userData as Record<string, unknown>).parts as Record<string, THREE.Group> | undefined;
    if (!parts) return;
    const { armL, armR, legL, legR, body } = parts;
    const a = POSE_ANGLES[pose] ?? { arm: 0, leg: 0 };
    const tBend = sliders.torsoBend ?? 0, tTwist = sliders.torsoTwist ?? 0, lean = sliders.lean ?? 0;
    if (armL) armL.rotation.x = a.arm;
    if (armR) armR.rotation.x = -a.arm;
    if (legL) legL.rotation.x = a.leg;
    if (legR) legR.rotation.x = -a.leg;
    if (body) {
      body.rotation.x = tBend * 0.5;
      body.rotation.y = tTwist * 0.5;
      body.rotation.z = lean * 0.3;
    }
    const c = stateRef.current.chars.find((x) => x.id === selected);
    if (c) {
      g.rotation.x = c.rx + (sliders.bend ?? 0) * 0.4;
      g.rotation.y = c.ry + (sliders.turn ?? 0) * 0.6;
      g.rotation.z = c.rz;
    }
  }, [pose, sliders, selected]);

  /* ---------------- 视角切换（导演 / 机位）+ 六向视图 ---------------- */
  const applyCam = (cm: StageCam, camera: THREE.PerspectiveCamera) => {
    camera.position.set(cm.x, cm.y + 0.2, cm.z);
    camera.fov = cm.fov ?? 50;
    camera.updateProjectionMatrix();
    if (cm.lookTarget === 'manual') camera.lookAt(cm.lookX ?? 0, cm.lookY ?? 1, cm.lookZ ?? 0);
    else camera.lookAt(0, 1, 0);
  };
  const lookFrom = (pos: THREE.Vector3) => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.copy(pos);
    camera.lookAt(0, 1, 0);
  };
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (view === 'cam') {
      const cm = cams.find((x) => x.id === selected) ?? cams[0];
      if (cm) applyCam(cm, camera);
    } else {
      lookFrom(DEFAULT_VIEW);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected, cams]);

  /* ---------------- 机位视角取景预览窗（副渲染器） ---------------- */
  useEffect(() => {
    if (!director3DOpen || view !== 'cam') return;
    const host = shotPreviewRef.current;
    const scene = sceneRef.current;
    const mainRenderer = rendererRef.current;
    if (!host || !scene || !mainRenderer) return;
    const w = Math.max(260, Math.round(host.clientWidth)), h = Math.max(146, Math.round(host.clientHeight));
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    host.appendChild(renderer.domElement);
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cm = stateRef.current.cams.find((x) => x.id === stateRef.current.selected) ?? stateRef.current.cams[0];
      if (cm) {
        cam.position.set(cm.x, cm.y + 0.2, cm.z);
        cam.lookAt(0, 1, 0);
      }
      renderer.render(scene, cam);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, [director3DOpen, view]);

  /* ---------------- 截图系统 ---------------- */
  const captureRatio = (src: string, r: number | null): string => {
    const img = new Image();
    img.src = src;
    const w = img.width, h = img.height;
    if (!r || !w || !h) return src;
    let cw = w, ch = h;
    if (w / h > r) { ch = h; cw = h * r; } else { cw = w; ch = w / r; }
    const cv = document.createElement('canvas');
    cv.width = Math.round(cw); cv.height = Math.round(ch);
    const ctx = cv.getContext('2d');
    if (!ctx) return src;
    ctx.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
    return cv.toDataURL('image/png');
  };

  const capture = (pos: THREE.Vector3, r: number | null): string | null => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current;
    if (!renderer || !scene || !camera) return null;
    const oldPos = camera.position.clone();
    camera.position.copy(pos);
    camera.lookAt(0, 1, 0);
    const giz = gizmoRef.current;
    if (giz) giz.visible = false;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    if (giz) giz.visible = true;
    camera.position.copy(oldPos);
    camera.lookAt(0, 1, 0);
    return captureRatio(url, r);
  };

  const runShots = (mode: ShotMode) => {
    const r = RATIOS.find((x) => x.key === ratio)?.value ?? null;
    const imgs: string[] = [];
    if (mode === 'current') {
      const camera = cameraRef.current;
      if (camera) {
        const u = capture(camera.position, r);
        if (u) imgs.push(u);
      }
    } else {
      const n = mode === '4' ? 4 : 12;
      for (let i = 0; i < n; i++) {
        const ang = (i * (360 / n)) * Math.PI / 180;
        const p = new THREE.Vector3(5.2 * Math.sin(ang), 2.1, 5.2 * Math.cos(ang));
        const u = capture(p, r);
        if (u) imgs.push(u);
      }
    }
    setShotDialog({ mode, imgs });
    setShotHistory((h) => [...imgs.slice().reverse(), ...h].slice(0, 12));
  };

  const confirmShots = () => {
    if (!shotDialog) return;
    const st = useP3Store.getState();
    shotDialog.imgs.forEach((url, i) => {
      const pos = { x: 100 + Math.random() * 260, y: 100 + Math.random() * 220 };
      st.createNode('image', pos);
      const last = st.nodes[st.nodes.length - 1];
      if (last) {
        st.closeDialog();
        st.updateNodeData(last.id, {
          title: shotDialog.mode === 'current' ? '导演台机位图' : `导演台${shotDialog.mode}方位图${i + 1}`,
          mediaUrl: url,
          mediaKind: 'image',
          status: 'done',
        });
      }
      if (i === 0 && st.directorNodeId) {
        st.updateNodeData(st.directorNodeId, { directorShot: url });
      }
    });
    setShotDialog(null);
  };

  /* ---------------- 白模产线：材质切换 / 预设摆机位 / 路径录制 / 照片对位 ---------------- */
  useEffect(() => {
    const apply = (group: THREE.Group, mat: THREE.Material) => {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const ud = mesh.userData as Record<string, unknown>;
        if (clayMode) {
          if (!ud._origMat) ud._origMat = mesh.material;
          mesh.material = mat;
        } else if (ud._origMat) {
          mesh.material = ud._origMat as THREE.Material;
          delete ud._origMat;
        }
      });
    };
    charGroupsRef.current.forEach((g) => apply(g, CLAY_BODY));
    camGroupsRef.current.forEach((g) => apply(g, CLAY_CAM));
    importedRef.current.forEach((g) => apply(g, CLAY_GEO));
  }, [clayMode, chars, cams, director3DOpen]);

  /** 机位 → 录制关键帧（位置/注视点/FOV），渲染器与录制共用同一份数据 */
  const camKeyframe = (cm: StageCam) => ({
    pos: new THREE.Vector3(cm.x, cm.y + 0.2, cm.z),
    look: cm.lookTarget === 'manual'
      ? new THREE.Vector3(cm.lookX ?? 0, cm.lookY ?? 1, cm.lookZ ?? 0)
      : new THREE.Vector3(0, 1, 0),
    fov: cm.fov ?? 50,
  });

  /** 十种机位预设 → 起点/终点机位（相对原点布局，用户再按需微调） */
  const buildRigPair = (kind: RigPathKind, prefix: string): [StageCam, StageCam] => {
    const rig = CAMERA_RIGS.find((r) => r.id === kind) ?? CAMERA_RIGS[0];
    const mk = (name: string, x: number, y: number, z: number, fov: number, lx: number, ly: number, lz: number): StageCam => ({
      id: `m-${uid()}`, name, x, y, z, rx: 0, ry: 0, rz: 0,
      visible: true, locked: false, fov, lookTarget: 'manual', lookX: lx, lookY: ly, lookZ: lz,
    });
    const L = (s: string) => `${prefix}${rig.label}·${s}`;
    switch (kind) {
      case 'pan': return [mk(L('起点'), 0, 1.6, 4.2, rig.fov, -2, 1, 0), mk(L('终点'), 0, 1.6, 4.2, rig.fov, 2, 1, 0)];
      case 'zoom': return [mk(L('起点'), 0, 1.6, 4.2, 55, 0, 1, 0), mk(L('终点'), 0, 1.6, 4.2, 30, 0, 1, 0)];
      case 'dolly': return [mk(L('起点'), 0, 1.6, 5.5, rig.fov, 0, 1, 0), mk(L('终点'), 0, 1.6, 2.5, rig.fov, 0, 1, 0)];
      case 'follow': return [mk(L('起点'), 0, 1.7, -2.5, rig.fov, 0, 1.1, 0), mk(L('终点'), 0, 1.7, 0, rig.fov, 0, 1.1, 2.5)];
      case 'retreat': return [mk(L('起点'), 0, 1.6, 2.5, rig.fov, 0, 1.2, -1), mk(L('终点'), 0, 1.6, 5, rig.fov, 0, 1.2, -1)];
      case 'orbit': {
        const r = 4, y = 1.6;
        const a0 = -35 * Math.PI / 180, a1 = 35 * Math.PI / 180;
        return [
          mk(L('起点'), r * Math.sin(a0), y, r * Math.cos(a0), rig.fov, 0, 1, 0),
          mk(L('终点'), r * Math.sin(a1), y, r * Math.cos(a1), rig.fov, 0, 1, 0),
        ];
      }
      case 'crane': return [mk(L('起点'), 3, 0.8, 3, rig.fov, 0, 1, 0), mk(L('终点'), 3, 3.2, 3, rig.fov, 0, 1, 0)];
      case 'aerial': return [mk(L('起点'), 0, 9, 4, rig.fov, 0, 0.5, 0), mk(L('终点'), 0, 9, 1.5, rig.fov, 0, 0.5, 0)];
      case 'pov': return [mk(L('起点'), 0, 1.6, 0, rig.fov, 0, 1.6, 3), mk(L('终点'), 0, 1.6, 1.8, rig.fov, 0, 1.6, 5)];
      default: return [mk(L('机位'), 2.2, 1.5, 3.2, rig.fov, 0, 1, 0), mk(L('机位'), 2.2, 1.5, 3.2, rig.fov, 0, 1, 0)];
    }
  };

  const applyRigPreset = (kind: RigPathKind) => {
    const rig = CAMERA_RIGS.find((r) => r.id === kind);
    const pair = buildRigPair(kind, '');
    setCams((arr) => [...arr, ...pair]);
    setSelected(pair[0].id);
    setRigMenuOpen(false);
    flashRecMsg(`已按「${rig?.label ?? kind}」摆好起点/终点机位，可再微调后录制`);
  };

  /** 运镜序列一键摆机位（AI 排运镜 / 粘贴 JSON 共用）：逐 beat 追加机位对 */
  const applyRigSequence = (beats: { rig: string; durationSeconds: number; note: string }[]): boolean => {
    const valid = new Set(CAMERA_RIGS.map((r) => r.id));
    const clean = beats.filter((b) => valid.has(b.rig as RigPathKind)).slice(0, 8);
    if (clean.length === 0) {
      flashRecMsg('序列里没有可识别的机位（rig 必须是十种预设 id 之一）');
      return false;
    }
    const pairs = clean.flatMap((b, i) => buildRigPair(
      b.rig as RigPathKind,
      `运镜${i + 1}·${Math.max(1, Math.min(30, Math.round(b.durationSeconds) || 4))}s·`,
    ));
    setCams((arr) => [...arr, ...pairs]);
    setSelected(pairs[0].id);
    setRigAiOpen(false);
    flashRecMsg(`已摆好 ${clean.length} 组机位（${clean.map((b) => CAMERA_RIGS.find((r) => r.id === b.rig)?.label).join('→')}），微调后录制`);
    return true;
  };

  const pickRecorderMime = (): string | undefined => {
    if (typeof MediaRecorder === 'undefined') return undefined;
    for (const m of ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch { /* 忽略 */ }
    }
    return undefined;
  };

  /** 白模录制：机位列表即关键帧序列，线性插值（忌缓动瘫尾），canvas.captureStream 直录 */
  const buildRecordFrames = () => {
    const keys = cams.filter((c) => c.visible).map(camKeyframe);
    return keys.length === 1 ? [keys[0], keys[0]] : keys;
  };

  /**
   * P0-3 录制前几何探针（移植 seedance-skill probe.mjs 的纯几何项，只警告不拦截）：
   * - 主体出画率：采样路径，角色中心投影出 NDC 占比
   * - 双人重叠：两人在画面上距离过近的采样占比（相机落在两人连线方向）
   * - 主体丢弃风险：平均占画高 <10%（实测模型会把主体丢掉）
   * - 死时间：路径过短而时长过长（等于没给 AI 运动信号）
   * 穿墙/队形超框需墙体数据，当前场景无此数据，诚实跳过。
   */
  const probeRecordingPath = (total: number): string[] => {
    const out: string[] = [];
    const renderer = rendererRef.current;
    if (!renderer) return out;
    const frames = buildRecordFrames();
    if (frames.length < 2) return out;
    const chars = stateRef.current.chars.filter((c) => c.visible);
    if (chars.length === 0) {
      out.push('场景里没有可见角色，白模将只有空镜运镜');
      return out;
    }
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const cam = new THREE.PerspectiveCamera(50, size.x / Math.max(1, size.y), 0.1, 200);
    const N = Math.min(60, Math.max(10, frames.length * 10));
    const proj = new THREE.Vector3();
    // 每角色：出画采样数、平均占画高
    const stats = chars.map(() => ({ out: 0, hSum: 0, n: 0 }));
    let overlapSamples = 0;
    let pathLen = 0;
    let prevPos: THREE.Vector3 | null = null;
    for (let k = 0; k < N; k++) {
      const t = (k / (N - 1)) * (frames.length - 1);
      const i = Math.min(frames.length - 2, Math.floor(t));
      const f = t - i;
      const a = frames[i], b = frames[i + 1];
      const pos = new THREE.Vector3().lerpVectors(a.pos, b.pos, f);
      const look = new THREE.Vector3().lerpVectors(a.look, b.look, f);
      if (prevPos) pathLen += pos.distanceTo(prevPos);
      prevPos = pos.clone();
      cam.position.copy(pos);
      cam.fov = a.fov + (b.fov - a.fov) * f;
      cam.updateProjectionMatrix();
      cam.lookAt(look);
      cam.updateMatrixWorld();
      const pts = chars.map((c, ci) => {
        const h = 1.7 * (c.sy || 1);
        proj.set(c.x, c.y + h * 0.55, c.z).project(cam);
        const inFrame = Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1 && proj.z < 1;
        if (!inFrame) stats[ci].out += 1;
        else {
          const dist = pos.distanceTo(new THREE.Vector3(c.x, c.y + h * 0.55, c.z));
          const frac = h / (2 * dist * Math.tan(((cam.fov * Math.PI) / 180) / 2));
          stats[ci].hSum += frac;
          stats[ci].n += 1;
        }
        return { x: proj.x, y: proj.y, inFrame };
      });
      // 双人重叠：都在画内且屏距 <0.15
      let overlap = false;
      for (let p = 0; p < pts.length && !overlap; p++) {
        for (let q = p + 1; q < pts.length && !overlap; q++) {
          if (!pts[p].inFrame || !pts[q].inFrame) continue;
          const d = Math.hypot(pts[p].x - pts[q].x, pts[p].y - pts[q].y);
          if (d < 0.15) overlap = true;
        }
      }
      if (overlap) overlapSamples += 1;
    }
    chars.forEach((c, ci) => {
      const s = stats[ci];
      if (s.out / N > 0.05) {
        out.push(`「${c.name}」${Math.round((s.out / N) * 100)}% 采样出画——运镜覆盖不到，成片里会丢人`);
      }
      if (s.n > 0 && s.hSum / s.n < 0.1) {
        out.push(`「${c.name}」平均只占画高 ${((s.hSum / s.n) * 100).toFixed(1)}%（<10%）——模型很可能把它丢掉，拉近机位`);
      }
    });
    if (overlapSamples / N > 0.3) {
      out.push(`双人画面重叠 ${Math.round((overlapSamples / N) * 100)}% 采样——相机可能落在两人连线方向，挪机位错开`);
    }
    if (pathLen < 0.2 && total > 3) {
      out.push(`相机全程只走了 ${pathLen.toFixed(2)}m 却录 ${total}s——等于没给运动信号（死时间），加运镜或缩短`);
    }
    out.push('线性插值无缓动瘫尾；穿墙/队形超框需墙体数据，当前未检');
    return out;
  };

  /** 白模录制：机位列表即关键帧序列，线性插值（忌缓动瘫尾），canvas.captureStream 直录 */
  const startRecording = () => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current;
    if (!renderer || !scene || !camera) { flashRecMsg('渲染器未就绪，请先打开导演台'); return; }
    if (buildRecordFrames().length === 0) { flashRecMsg('没有可见机位：先添加机位或按预设摆机位'); return; }
    const canvas = renderer.domElement as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
    if (typeof canvas.captureStream !== 'function') { flashRecMsg('当前浏览器不支持画布录制（需 Chrome/Edge）'); return; }
    const mimeType = pickRecorderMime();
    if (!mimeType) { flashRecMsg('当前浏览器无可用录制编码'); return; }
    const total = Math.max(1, Math.min(30, Number(recDuration) || 5));
    // P0-3：录制前先跑几何探针，只警告不拦截
    const probeMsgs = probeRecordingPath(total);
    if (probeMsgs.length > 0) {
      flashRecMsg(`录制前体检：${probeMsgs.join('；')}`);
    }
    // 白模录制自动切白模材质：白模只锁空间/运镜/节奏，颜色不能渗进成片
    if (!clayMode) setClayMode(true);
    const giz = gizmoRef.current;
    if (giz) giz.visible = false;
    const oldPos = camera.position.clone();
    const oldFov = camera.fov;
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    } catch {
      flashRecMsg('录制器创建失败');
      if (giz) giz.visible = true;
      return;
    }
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const frames = buildRecordFrames();
    const t0 = performance.now();
    recordingRef.current = true;
    setRecording(true);
    if (progressBarRef.current) progressBarRef.current.style.width = '0%';
    rec.start(250);
    const step = () => {
      if (!recordingRef.current) return;
      const el = (performance.now() - t0) / 1000;
      const done = el >= total;
      const t = Math.min(1, el / total) * (frames.length - 1);
      const i = Math.min(frames.length - 2, Math.floor(t));
      const f = t - i;
      const a = frames[i], b = frames[i + 1];
      camera.position.lerpVectors(a.pos, b.pos, f);
      camera.fov = a.fov + (b.fov - a.fov) * f;
      camera.updateProjectionMatrix();
      camera.lookAt(new THREE.Vector3().lerpVectors(a.look, b.look, f));
      renderer.render(scene, camera);
      if (progressBarRef.current) progressBarRef.current.style.width = `${Math.min(100, (el / total) * 100)}%`;
      if (done) { stopRecording(); return; }
      requestAnimationFrame(step);
    };
    const stopRecording = () => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      setRecording(false);
      try { rec.stop(); } catch { /* 忽略 */ }
      stream.getTracks().forEach((tr) => tr.stop());
      if (giz) giz.visible = true;
      camera.position.copy(oldPos);
      camera.fov = oldFov;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 1, 0);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        if (blob.size === 0) { flashRecMsg('录制失败：未采集到画面'); return; }
        if (recResult) URL.revokeObjectURL(recResult.url);
        setRecResult({ url: URL.createObjectURL(blob), blob, duration: total });
      };
    };
    // 暴露给停止按钮：存到 ref 上避免闭包过期
    (startRecording as unknown as { _stop?: () => void })._stop = stopRecording;
    requestAnimationFrame(step);
  };

  const stopRecordingManual = () => {
    const fn = (startRecording as unknown as { _stop?: () => void })._stop;
    if (fn) fn();
  };

  const downloadRec = () => {
    if (!recResult) return;
    const a = document.createElement('a');
    a.href = recResult.url;
    a.download = `whitemodel-${Math.round(recResult.duration)}s.webm`;
    a.click();
  };

  const uploadRec = async () => {
    if (!recResult) return;
    if (!projectId) { flashRecMsg('当前为自由画布（无项目归属），请下载后到项目导演台上传'); return; }
    setUploading(true);
    try {
      const ext = recResult.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const { fileUrl } = await uploadLocalFile(
        projectId,
        recResult.blob,
        `whitemodel-${Date.now()}.${ext}`,
        recResult.duration,
      );
      flashRecMsg(`已上传为项目资产：${fileUrl}（去导演台绑定到镜头）`);
    } catch {
      flashRecMsg('上传失败（文件需 ≤25MB，后端服务需在线）');
    } finally {
      setUploading(false);
    }
  };

  /** AI 排运镜：描述 → 运镜序列 JSON（走本系统 LLM，GPT-6 接入后同口径可用） */
  const runRigAi = async () => {
    if (!projectId) { flashRecMsg('自由画布无项目归属，AI 排运镜需在项目内使用（可先粘贴 JSON 摆机位）'); return; }
    if (!rigDesc.trim()) { flashRecMsg('请先写一句运镜描述'); return; }
    setRigBusy(true);
    try {
      const res = await rigScene(projectId, {
        description: rigDesc.trim(),
        totalSeconds: Math.max(3, Math.min(60, rigTotal || 10)),
      });
      setRigBeats(res.beats);
      if (res.beats.length === 0) flashRecMsg('AI 未返回可用机位，换个说法试试');
    } catch {
      flashRecMsg('AI 排运镜失败（需配置文本模型 Key，无 Key 时走粘贴 JSON）');
    } finally {
      setRigBusy(false);
    }
  };

  /** 粘贴 JSON 摆机位：GPT-6（含 ChatGPT）或任意 LLM 产出的同构数组 */
  const applyRigJson = () => {
    const text = rigJson.trim()
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) { flashRecMsg('没找到 JSON 数组（形如 [{"rig":"dolly","durationSeconds":4}]）'); return; }
    try {
      const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (!Array.isArray(arr)) throw new Error('not array');
      const beats = arr.slice(0, 8).map((b) => {
        const r = (b ?? {}) as Record<string, unknown>;
        return {
          rig: typeof r.rig === 'string' ? r.rig : '',
          durationSeconds: Number(r.durationSeconds) || 4,
          note: typeof r.note === 'string' ? r.note : '',
        };
      });
      applyRigSequence(beats);
    } catch {
      flashRecMsg('JSON 解析失败，请检查格式');
    }
  };

  /** 照片对位：照片与白模首帧并排（反解产线的手动等价版：位置一律对照读数，不肉眼估） */
  const shootCompare = () => {
    if (!photoUrl) { flashRecMsg('请先选择一张照片作为对位底'); return; }
    const st = stateRef.current;
    const cm = st.cams.find((x) => x.id === st.selected) ?? st.cams[0];
    let clay: string | null = null;
    if (cm) {
      const r = RATIOS.find((x) => x.key === ratio)?.value ?? null;
      clay = capture(new THREE.Vector3(cm.x, cm.y + 0.2, cm.z), r);
    }
    setCompareShot({ photo: photoUrl, clay });
  };

  /* ---------------- 对象增删改 ---------------- */
  const addChar = (kind: BodyKind) => {
    const n = chars.length + 1;
    const id = `c-${uid()}`;
    const color = PALETTE[(chars.length) % PALETTE.length];
    setChars((arr) => [...arr, { id, name: `角色${String(n).padStart(2, '0')}`, kind, x: 1.4, y: 0, z: 0.6, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, color, visible: true, locked: false }]);
    setSelected(id);
    setKindMenuOpen(false);
    setLeftKindMenu(false);
    setSubMenu(null);
  };
  const addCam = () => {
    const n = cams.length + 1;
    const id = `m-${uid()}`;
    setCams((arr) => [...arr, { id, name: `摄像机${String(n).padStart(2, '0')}`, x: 3.2, y: 1.6, z: 3, rx: 0, ry: 0, rz: 0, visible: true, locked: false, fov: 50, lookTarget: 'auto', lookX: 0, lookY: 1, lookZ: 0 }]);
    setSelected(id);
  };
  const delSelected = () => {
    if (chars.some((c) => c.id === selected)) {
      setChars((arr) => arr.filter((c) => c.id !== selected));
      setSelected(chars[0]?.id ?? '');
    } else {
      setCams((arr) => arr.filter((c) => c.id !== selected));
      setSelected(chars[0]?.id ?? '');
    }
  };
  const toggleVisible = (id: string) => {
    if (chars.some((c) => c.id === id)) setChars((arr) => arr.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
    else setCams((arr) => arr.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  };
  const toggleLock = (id: string) => {
    if (chars.some((c) => c.id === id)) setChars((arr) => arr.map((c) => (c.id === id ? { ...c, locked: !c.locked } : c)));
    else setCams((arr) => arr.map((c) => (c.id === id ? { ...c, locked: !c.locked } : c)));
  };

  const importPanorama = (file: File) => {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (tex) => {
      const scene = sceneRef.current;
      if (scene) scene.background = tex;
      setPanoramaFile(file.name);
      // P1 修复：blob URL 用后释放，避免多次导入内存上涨
      URL.revokeObjectURL(url);
    });
  };
  const importModel = (file: File) => {
    const url = URL.createObjectURL(file);
    new GLTFLoader().load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        const scene = sceneRef.current;
        if (!scene) return;
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).castShadow = true;
            (o as THREE.Mesh).receiveShadow = true;
          }
        });
        gltf.scene.position.set(0, 0.01, 0);
        scene.add(gltf.scene);
        importedRef.current.push(gltf.scene);
      },
      undefined,
      () => {
        // 加载失败（如非 GLB）：释放 URL 并内联提示，不再 window.alert 阻塞
        URL.revokeObjectURL(url);
        flashImportError('模型加载失败：仅支持 GLB/GLTF 格式');
      },
    );
  };
  const toggleFullscreen = () => {
    const el = mountRef.current?.closest('.p3-director3d') as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  if (!director3DOpen) return null;

  const isChar = (id: string) => chars.some((c) => c.id === id);
  const cur = chars.find((c) => c.id === selected) ?? cams.find((c) => c.id === selected);
  const selectedName = cur?.name ?? '';
  const updateChar = (patch: Partial<StageChar>) =>
    setChars((arr) => arr.map((c) => (c.id === selected ? { ...c, ...patch } : c)));
  const updateCam = (patch: Partial<StageCam>) =>
    setCams((arr) => arr.map((c) => (c.id === selected ? { ...c, ...patch } : c)));
  const filteredChars = chars.filter((c) => c.name.includes(search));
  const filteredCams = cams.filter((c) => c.name.includes(search));

  const sixViews: { label: string; pos: [number, number, number] }[] = [
    { label: 'X+', pos: [5.5, 1, 0] },
    { label: 'X-', pos: [-5.5, 1, 0] },
    { label: 'Y+', pos: [0, 5.5, 0.01] },
    { label: 'Y-', pos: [0, -5.5, 0.01] },
    { label: 'Z+', pos: [0, 1, 5.5] },
    { label: 'Z-', pos: [0, 1, -5.5] },
  ];

  return (
    <div className="p3-director3d">
      {/* 顶栏 */}
      <div style={{ height: 52, borderBottom: `1px solid ${P3.border}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>3D导演台</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['director', 'cam'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '5px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                color: view === v ? '#fff' : P3.text,
                background: view === v ? P3.primary : P3.hover,
              }}
            >
              {v === 'director' ? '导演视角' : '机位视角'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: P3.helper }}>选中对象拖拽/Gizmo 变换 · 滚轮缩放 · 空白拖拽旋转</span>
        <div style={{ flex: 1 }} />
        <button className="p3-icon-btn" onClick={() => setDirector3DOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* 左栏 */}
        <div style={{ width: 224, borderRight: `1px solid ${P3.border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: P3.hover, borderRadius: 8, padding: '6px 10px' }}>
            <Search size={14} color={P3.helper} />
            <input
              placeholder="请输入搜索内容"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 12, color: P3.helper, flex: 1 }}>角色</span>
            <button
              onClick={() => setLeftKindMenu((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: P3.primary, cursor: 'pointer', background: 'none', border: 'none' }}
            >
              <Plus size={13} /> 添加
            </button>
          </div>
          {leftKindMenu && (
            <MenuPop style={{ left: 14, top: 148, minWidth: 158 }}>
              <KindMenuItems subMenu={subMenu} setSubMenu={setSubMenu} onPick={(k) => { addChar(k); }} />
            </MenuPop>
          )}
          {filteredChars.map((c) => (
            <SceneRow
              key={c.id}
              icon={<User size={15} />}
              name={c.name}
              active={selected === c.id}
              visible={c.visible}
              locked={c.locked}
              onSelect={() => !c.locked && setSelected(c.id)}
              onEye={() => toggleVisible(c.id)}
              onLock={() => toggleLock(c.id)}
            />
          ))}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: P3.helper, flex: 1 }}>摄像机</span>
            <button
              onClick={addCam}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: P3.primary, cursor: 'pointer', background: 'none', border: 'none' }}
            >
              <Plus size={13} /> 添加
            </button>
          </div>
          {filteredCams.map((c) => (
            <SceneRow
              key={c.id}
              icon={<Camera size={15} />}
              name={c.name}
              active={selected === c.id}
              visible={c.visible}
              locked={c.locked}
              onSelect={() => !c.locked && setSelected(c.id)}
              onEye={() => toggleVisible(c.id)}
              onLock={() => toggleLock(c.id)}
            />
          ))}
        </div>

        {/* 中央视口 */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={mountRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {/* 九宫格辅助线 */}
            {guideLines && (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
                <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(10,188,207,0.5)' }} />
                <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(10,188,207,0.5)' }} />
                <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(10,188,207,0.5)' }} />
                <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(10,188,207,0.5)' }} />
              </div>
            )}
            {/* 机位视角取景预览窗 */}
            {view === 'cam' && (
              <div
                ref={shotPreviewRef}
                style={{
                  position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
                  width: '46%', height: '42%', borderRadius: 12, border: `2px solid ${P3.primary}`,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden', zIndex: 4, background: '#f5f6f8',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span style={{ position: 'absolute', left: 10, top: 8, fontSize: 12, color: '#fff', background: 'rgba(0,0,0,0.45)', borderRadius: 6, padding: '2px 8px', zIndex: 2 }}>
                  摄像机取景
                </span>
              </div>
            )}
            {/* 六向视图按钮 */}
            <div style={{ position: 'absolute', right: 12, top: 10, zIndex: 5, display: 'flex', gap: 3 }}>
              {sixViews.map((v) => (
                <button
                  key={v.label}
                  title={`切换到 ${v.label} 视图`}
                  onClick={() => lookFrom(new THREE.Vector3(...v.pos))}
                  style={{
                    width: 30, height: 30, borderRadius: 8, fontSize: 11, cursor: 'pointer',
                    color: P3.text, background: 'rgba(255,255,255,0.92)', border: `1px solid ${P3.border}`,
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {/* 三维坐标指示器 */}
            <div style={{ position: 'absolute', left: 12, top: 10, zIndex: 5, width: 74, height: 74, pointerEvents: 'none', opacity: 0.92 }}>
              <AxisIndicator camera={cameraRef.current} />
            </div>
          </div>

          {/* 底部工具栏（Pavo 同款） */}
          <div style={{ height: 48, borderTop: `1px solid ${P3.border}`, background: '#fafafa', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 2, position: 'relative' }}>
            <ToolBtn label={transformMode === 'move' ? '当前变换模式：移动' : transformMode === 'rotate' ? '当前变换模式：旋转' : '当前变换模式：缩放'} onClick={() => setModeMenuOpen((v) => !v)}>
              {transformMode === 'move' ? <Move size={17} /> : transformMode === 'rotate' ? <Rotate3d size={17} /> : <Scale size={17} />}
            </ToolBtn>
            <ToolBtn label="展开变换模式菜单" onClick={() => setModeMenuOpen((v) => !v)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </ToolBtn>
            {modeMenuOpen && (
              <MenuPop style={{ left: 12, bottom: 52 }}>
                {(['move', 'rotate', 'scale'] as const).map((m) => (
                  <MenuRow key={m} label={m === 'move' ? '移动' : m === 'rotate' ? '旋转' : '缩放'} hotkey={m === 'move' ? 'V' : m === 'rotate' ? 'R' : 'F'}
                    active={transformMode === m} onClick={() => { setTransformMode(m); setModeMenuOpen(false); }} />
                ))}
              </MenuPop>
            )}
            <ToolBtn label="添加角色" onClick={() => setKindMenuOpen((v) => !v)}>
              <User size={17} />
            </ToolBtn>
            {kindMenuOpen && (
              <MenuPop style={{ left: 72, bottom: 52, minWidth: 158 }}>
                <KindMenuItems subMenu={subMenu} setSubMenu={setSubMenu} onPick={(k) => { addChar(k); }} />
              </MenuPop>
            )}
            <ToolBtn label="导入全景图" onClick={() => document.getElementById('p3-pano-input')?.click()}>
              <ImagePlus size={17} />
            </ToolBtn>
            <input id="p3-pano-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importPanorama(e.target.files[0])} />
            <ToolBtn label="导入本地模型" onClick={() => document.getElementById('p3-model-input')?.click()}>
              <Box size={17} />
            </ToolBtn>
            <input id="p3-model-input" type="file" accept=".glb,.gltf" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importModel(e.target.files[0])} />
            <ToolBtn label={clayMode ? '关闭白模模式' : '开启白模模式（去色去材质，只留空间关系）'} onClick={() => setClayMode((v) => !v)}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M8.5 2.5l5.5 3v6l-5.5 3-5.5-3v-6l5.5-3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />{clayMode && <circle cx="8.5" cy="8.5" r="2" fill="currentColor" />}</svg>
            </ToolBtn>
            <ToolBtn label="添加机位" onClick={addCam}>
              <Camera size={17} />
            </ToolBtn>
            <ToolBtn label="选择画幅比例" onClick={() => setRatioMenuOpen((v) => !v)}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="5" cy="6.5" r="1.1" fill="currentColor" /></svg>
            </ToolBtn>
            {ratioMenuOpen && (
              <MenuPop style={{ right: 210, bottom: 52 }}>
                {RATIOS.map((r) => (
                  <MenuRow key={r.key} label={r.label} active={ratio === r.key} onClick={() => { setRatio(r.key); setRatioMenuOpen(false); }} />
                ))}
              </MenuPop>
            )}
            <ToolBtn label="当前视角截图" onClick={() => runShots('current')}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2.5" y="4" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="8.5" cy="8.5" r="2.2" stroke="currentColor" strokeWidth="1.3" /></svg>
            </ToolBtn>
            <ToolBtn label="四方位截图" onClick={() => runShots('4')}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><rect x="2" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" /><rect x="9.5" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" /><rect x="2" y="9.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" /><rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" /></svg>
            </ToolBtn>
            <ToolBtn label="十二方位截图" onClick={() => runShots('12')}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.3" /><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" /><path d="M8.5 2.5v3M8.5 11.5v3M2.5 8.5h3M11.5 8.5h3" stroke="currentColor" strokeWidth="1.2" /></svg>
            </ToolBtn>
            <ToolBtn label={guideLines ? '关闭九宫格辅助线' : '开启九宫格辅助线'} onClick={() => setGuideLines((v) => !v)}>
              <Grid3x3 size={17} />
            </ToolBtn>
            <ToolBtn label="旋转 / 缩放灵敏度（Pavo 手感可调）" onClick={() => setSensMenuOpen((v) => !v)}>
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><path d="M2.5 8.5h3M11.5 8.5h3M8.5 3v3M8.5 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="8.5" cy="8.5" r="2.2" stroke="currentColor" strokeWidth="1.3" /></svg>
            </ToolBtn>
            {sensMenuOpen && (
              <MenuPop style={{ right: 138, bottom: 52, width: 216, padding: 12 }}>
                <div style={{ fontSize: 12, color: P3.helper, marginBottom: 6 }}>旋转 / 缩放灵敏度</div>
                <input
                  type="range" min={0.2} max={2} step={0.1} value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: P3.primary, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: P3.helper, marginTop: 2 }}>
                  <span>慢 0.2×</span>
                  <span style={{ color: P3.text, fontWeight: 600 }}>{sensitivity.toFixed(1)}×</span>
                  <span>快 2.0×</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {[{ v: 0.5, l: '慢' }, { v: 1, l: '标准' }, { v: 1.8, l: '快' }].map((p) => (
                    <button
                      key={p.l}
                      onClick={() => setSensitivity(p.v)}
                      style={{
                        flex: 1, padding: '5px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                        border: `1px solid ${P3.border}`,
                        background: sensitivity === p.v ? 'rgba(10,188,207,0.12)' : '#fff',
                        color: sensitivity === p.v ? P3.primary : P3.text,
                      }}
                    >
                      {p.l}
                    </button>
                  ))}
                </div>
              </MenuPop>
            )}
            <ToolBtn label="全屏" onClick={toggleFullscreen}>
              <Maximize size={17} />
            </ToolBtn>
            <div style={{ flex: 1 }} />
            {importError && (
              <span style={{ fontSize: 12, color: '#C2410C', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, padding: '3px 10px', marginRight: 8 }}>
                {importError}
              </span>
            )}
            <span style={{ fontSize: 12, color: P3.helper, paddingRight: 8 }}>
              {ratio !== 'auto' ? `画幅 ${ratio}` : '画幅 自动'}
              {panoramaFile ? ` · 全景 ${panoramaFile.slice(0, 8)}` : ''}
            </span>
          </div>
        </div>

        {/* 右栏：属性/姿势 */}
        <div style={{ width: 268, borderLeft: `1px solid ${P3.border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['属性', '姿势'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                  color: tab === t ? P3.primary : P3.helper,
                  background: tab === t ? 'rgba(10,188,207,0.1)' : 'transparent',
                  fontWeight: tab === t ? 600 : 400,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === '属性' && (
            <>
              <Field label="名称" value={selectedName} onChange={(v) => (isChar(selected) ? updateChar({ name: v }) : updateCam({ name: v }))} />
              <VecField label="位置" value={[cur?.x ?? 0, cur?.y ?? 0, cur?.z ?? 0]} onChange={(arr) => (isChar(selected) ? updateChar({ x: arr[0], y: arr[1], z: arr[2] }) : updateCam({ x: arr[0], y: arr[1], z: arr[2] }))} />
              {isChar(selected) ? (
                <>
                  <VecField label="旋转" value={[cur?.rx ?? 0, cur?.ry ?? 0, cur?.rz ?? 0]} onChange={(arr) => updateChar({ rx: arr[0], ry: arr[1], rz: arr[2] })} />
                  <VecField label="缩放" value={[(cur as StageChar)?.sx ?? 1, (cur as StageChar)?.sy ?? 1, (cur as StageChar)?.sz ?? 1]} onChange={(arr) => updateChar({ sx: arr[0] || 1, sy: arr[1] || 1, sz: arr[2] || 1 })} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: P3.helper }}>颜色</span>
                    <input type="color" value={(cur as StageChar)?.color ?? '#4F8EF7'} onChange={(e) => updateChar({ color: e.target.value })} style={{ width: 32, height: 24, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </div>
                </>
              ) : (
                <>
                  {/* Pavo 摄像机属性：切换机位 / 注视目标 / 注视坐标 / FOV / 相机截图 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: P3.helper }}>切换机位</span>
                    <select
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                      style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${P3.border}`, background: '#fff', color: P3.text, outline: 'none' }}
                    >
                      {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: P3.helper }}>注视目标</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['auto', 'manual'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => updateCam({ lookTarget: m })}
                          style={{
                            padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: 'none',
                            color: (cur as StageCam)?.lookTarget === m ? '#fff' : P3.helper,
                            background: (cur as StageCam)?.lookTarget === m ? P3.primary : P3.hover,
                          }}
                        >
                          {m === 'auto' ? '自动' : '手动坐标'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(cur as StageCam)?.lookTarget === 'manual' && (
                    <VecField
                      label="注视坐标"
                      value={[(cur as StageCam)?.lookX ?? 0, (cur as StageCam)?.lookY ?? 1, (cur as StageCam)?.lookZ ?? 0]}
                      onChange={(arr) => updateCam({ lookX: arr[0], lookY: arr[1], lookZ: arr[2] })}
                    />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, color: P3.helper, whiteSpace: 'nowrap' }}>视野角度(FOV)</span>
                    <input
                      type="range" min={20} max={120} step={1}
                      value={(cur as StageCam)?.fov ?? 50}
                      onChange={(e) => updateCam({ fov: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: P3.primary }}
                    />
                    <span style={{ fontSize: 12, color: P3.text, width: 30, textAlign: 'right' }}>{(cur as StageCam)?.fov ?? 50}</span>
                  </div>
                  <div style={{ borderTop: `1px solid ${P3.border}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 13, color: P3.helper, marginBottom: 8 }}>相机截图</div>
                    <button onClick={() => runShots('current')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none', width: '100%' }}>
                      <Camera size={14} /> 当前机位截图
                    </button>
                    {shotHistory.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                        {shotHistory.map((u, i) => (
                          <img key={i} src={u} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6, border: `1px solid ${P3.border}`, cursor: 'pointer' }} onClick={() => window.open(u, '_blank')} />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <button onClick={delSelected} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#E5484D', background: 'rgba(229,72,77,0.06)', border: 'none' }}>
                <Trash2 size={14} /> 删除选中对象
              </button>
              <button onClick={() => runShots('current')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none' }}>
                <Download size={14} /> 导出站位示意图
              </button>
              {/* 白模产线：白模材质 → 预设摆机位 → 路径录制 → 上传/下载 → 照片对位 */}
              <div style={{ borderTop: `1px solid ${P3.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: P3.helper, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clapperboard size={14} /> 白模产线
                </div>
                <button
                  onClick={() => setClayMode((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: clayMode ? '#fff' : P3.text, background: clayMode ? P3.primary : P3.hover, border: 'none', width: '100%' }}
                >
                  <Box size={14} /> {clayMode ? '白模模式：开' : '白模模式：关'}
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setRigMenuOpen((v) => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none', width: '100%' }}
                  >
                    <Video size={14} /> 按机位预设摆机位
                  </button>
                  {rigMenuOpen && (
                    <MenuPop style={{ left: 0, right: 0, bottom: 'calc(100% + 6px)' }}>
                      {CAMERA_RIGS.map((r) => (
                        <MenuRow key={r.id} label={r.label} onClick={() => applyRigPreset(r.id)} />
                      ))}
                    </MenuPop>
                  )}
                </div>
                <button
                  onClick={() => { setRigAiOpen(true); setRigBeats([]); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none', width: '100%' }}
                >
                  <Clapperboard size={14} /> AI 排运镜 / 粘贴 JSON 摆机位
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: P3.helper, whiteSpace: 'nowrap' }}>录制时长</span>
                  <input
                    type="number" min={1} max={30} step={1} value={recDuration}
                    onChange={(e) => setRecDuration(Math.max(1, Math.min(30, Number(e.target.value) || 5)))}
                    style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${P3.border}`, outline: 'none' }}
                  />
                  <span style={{ fontSize: 12, color: P3.helper }}>秒</span>
                </div>
                {!recording ? (
                  <button
                    onClick={startRecording}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: '#E5484D', border: 'none', width: '100%' }}
                  >
                    <Circle size={14} fill="currentColor" /> 录制白模（按机位顺序）
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ height: 6, borderRadius: 3, background: P3.hover, overflow: 'hidden' }}>
                      <div ref={progressBarRef} style={{ height: '100%', width: '0%', background: '#E5484D' }} />
                    </div>
                    <button
                      onClick={stopRecordingManual}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: '#11181C', border: 'none', width: '100%' }}
                    >
                      停止录制
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => document.getElementById('p3-photo-input')?.click()}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
                  >
                    <Images size={14} /> {photoUrl ? '更换照片' : '照片对位'}
                  </button>
                  <input id="p3-photo-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (photoUrl) URL.revokeObjectURL(photoUrl);
                    setPhotoUrl(URL.createObjectURL(f));
                    flashRecMsg('照片已载入，点击「并排对比」与白模首帧对位（建议先开九宫格）');
                  }} />
                  <button
                    onClick={shootCompare}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
                  >
                    并排对比
                  </button>
                </div>
                {recMsg && (
                  <div style={{ fontSize: 12, color: '#0A6C74', background: 'rgba(10,188,207,0.1)', borderRadius: 8, padding: '6px 10px', wordBreak: 'break-all' }}>
                    {recMsg}
                  </div>
                )}
              </div>
            </>
          )}
          {tab === '姿势' && (
            <>
              <div style={{ fontSize: 12, color: P3.helper }}>姿势预设（应用到选中角色）</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {POSE_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPose(p)}
                    style={{ padding: '6px 0', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: pose === p ? '#fff' : P3.text, background: pose === p ? P3.primary : P3.hover }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: P3.helper, marginTop: 10 }}>姿势调节</div>
              {BODY_SLIDERS.map((b) => (
                <div key={b.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: P3.helper }}>{b.group} · {b.label}</span>
                    <span style={{ fontSize: 12, color: P3.text }}>{sliders[b.key] ?? 0}</span>
                  </div>
                  <input
                    type="range" min={-2} max={2} step={0.1}
                    value={sliders[b.key] ?? 0}
                    onChange={(e) => setSliders((s) => ({ ...s, [b.key]: Number(e.target.value) }))}
                    style={{ width: '100%', accentColor: P3.primary }}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* AI 排运镜窗：描述→序列→一键摆机位；或粘贴 GPT-6 等任意 LLM 的同构 JSON */}
      {rigAiOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRigAiOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 20, width: 520, maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>AI 排运镜</span>
              <div style={{ flex: 1 }} />
              <button className="p3-icon-btn" onClick={() => setRigAiOpen(false)}><X size={16} /></button>
            </div>
            <textarea
              value={rigDesc}
              onChange={(e) => setRigDesc(e.target.value)}
              placeholder="一句话描述运镜，如：从全景推进到人物，环绕一圈后升到高空"
              rows={2}
              style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: `1px solid ${P3.border}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: P3.helper }}>总时长</span>
              <input
                type="number" min={3} max={60} value={rigTotal}
                onChange={(e) => setRigTotal(Math.max(3, Math.min(60, Number(e.target.value) || 10)))}
                style={{ width: 70, fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${P3.border}`, outline: 'none' }}
              />
              <span style={{ fontSize: 12, color: P3.helper }}>秒</span>
              <div style={{ flex: 1 }} />
              <button
                onClick={runRigAi}
                disabled={rigBusy}
                style={{ padding: '7px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none', opacity: rigBusy ? 0.6 : 1 }}
              >
                {rigBusy ? '生成中…' : '生成序列'}
              </button>
            </div>
            {rigBeats.length > 0 && (
              <div style={{ marginTop: 10, border: `1px solid ${P3.border}`, borderRadius: 10, padding: 10 }}>
                {rigBeats.map((b, i) => (
                  <div key={i} style={{ fontSize: 12, color: P3.text, padding: '3px 0' }}>
                    <b>运镜{i + 1}</b> · {CAMERA_RIGS.find((r) => r.id === b.rig)?.label ?? b.rig} · {b.durationSeconds}s{b.note ? ` · ${b.note}` : ''}
                  </div>
                ))}
                <button
                  onClick={() => applyRigSequence(rigBeats)}
                  style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none', fontWeight: 600 }}
                >
                  一键摆机位（{rigBeats.length} 组）
                </button>
              </div>
            )}
            <div style={{ fontSize: 12, color: P3.helper, marginTop: 12 }}>或粘贴运镜 JSON（GPT-6 / ChatGPT / 任意 LLM 输出，同构即可）：</div>
            <textarea
              value={rigJson}
              onChange={(e) => setRigJson(e.target.value)}
              placeholder='[{"rig":"dolly","durationSeconds":4,"note":"前推"}]'
              rows={3}
              style={{ width: '100%', fontSize: 12, fontFamily: 'monospace', padding: '8px 10px', borderRadius: 8, border: `1px solid ${P3.border}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginTop: 6 }}
            />
            <button
              onClick={applyRigJson}
              style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
            >
              解析并摆机位
            </button>
          </div>
        </div>
      )}

      {/* 录制结果窗：预览 → 下载 → 上传为项目资产（去导演台绑定镜头） */}
      {recResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRecResult(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 20, width: 520, maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>
                白模录制完成 · {recResult.duration}s · {(recResult.blob.size / 1024).toFixed(0)}KB
              </span>
              <div style={{ flex: 1 }} />
              <button className="p3-icon-btn" onClick={() => setRecResult(null)}><X size={16} /></button>
            </div>
            <video src={recResult.url} controls style={{ width: '100%', borderRadius: 10, background: '#000' }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={downloadRec}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
              >
                <Download size={14} /> 下载
              </button>
              <button
                onClick={uploadRec}
                disabled={uploading || !projectId}
                title={!projectId ? '自由画布无项目归属，请下载后到项目导演台上传' : '上传为项目白模资产'}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 22px', borderRadius: 10, fontSize: 13, cursor: !projectId ? 'not-allowed' : 'pointer', color: '#fff', background: !projectId ? '#9aa0a6' : P3.primary, border: 'none', fontWeight: 600, opacity: uploading ? 0.6 : 1 }}
              >
                <Upload size={14} /> {uploading ? '上传中…' : '上传为项目资产'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 照片对位窗：照片 vs 白模首帧并排（位置一律对照读数，不肉眼估） */}
      {compareShot && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCompareShot(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 20, width: 720, maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>照片对位 · 左照片 / 右白模首帧</span>
              <div style={{ flex: 1 }} />
              <button className="p3-icon-btn" onClick={() => setCompareShot(null)}><X size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: P3.helper, marginBottom: 4 }}>照片（空间+材质来源）</div>
                <img src={compareShot.photo} alt="对位照片" style={{ width: '100%', borderRadius: 10, border: `1px solid ${P3.border}` }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: P3.helper, marginBottom: 4 }}>白模首帧（当前机位{clayMode ? '' : ' · 建议开白模模式重拍'}）</div>
                {compareShot.clay ? (
                  <img src={compareShot.clay} alt="白模首帧" style={{ width: '100%', borderRadius: 10, border: `1px solid ${P3.border}` }} />
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: P3.helper, border: `1px dashed ${P3.border}`, borderRadius: 10 }}>
                    无可用机位，先添加机位
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: P3.helper, marginTop: 12, lineHeight: 1.7 }}>
              对位方法：打开九宫格辅助线，以照片里的人物站位/灭点位置为读数基准，在 3D 里把素体摆到同一格；两三轮收敛后再加运动和运镜。自动灭点检测不可信，以手动读数为准。
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={() => { if (!clayMode) setClayMode(true); window.setTimeout(shootCompare, 60); }}
                style={{ padding: '8px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
              >
                开白模重拍对比
              </button>
              <button
                onClick={() => setCompareShot(null)}
                style={{ padding: '8px 22px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none', fontWeight: 600 }}
              >
                确认对位
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 截图确认窗 */}
      {shotDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShotDialog(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: 20, width: shotDialog.mode === 'current' ? 480 : 620,
              maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: P3.text }}>
                导演台截图{shotDialog.mode === 'current' ? '' : `（${shotDialog.mode}方位）`} · 画幅 {ratio}
              </span>
              <div style={{ flex: 1 }} />
              <button className="p3-icon-btn" onClick={() => setShotDialog(null)}><X size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: shotDialog.mode === 'current' ? '1fr' : 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }}>
              {shotDialog.imgs.map((u, i) => (
                <img key={i} src={u} alt={`截图${i + 1}`} style={{ width: '100%', borderRadius: 10, border: `1px solid ${P3.border}`, background: '#f5f6f8' }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => setShotDialog(null)}
                style={{ padding: '8px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: P3.text, background: P3.hover, border: 'none' }}
              >
                取消
              </button>
              <button
                onClick={confirmShots}
                style={{ padding: '8px 22px', borderRadius: 10, fontSize: 13, cursor: 'pointer', color: '#fff', background: P3.primary, border: 'none', fontWeight: 600 }}
              >
                生成{shotDialog.mode === 'current' ? '' : ` ${shotDialog.imgs.length} 张`}并落回画布
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------------- 坐标轴指示器 ---------------- */
function AxisIndicator({ camera }: { camera: THREE.PerspectiveCamera | null }) {
  const [rot, setRot] = useState({ rx: 0, ry: 0 });
  useEffect(() => {
    if (!camera) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = camera.position.clone().normalize();
      const ry = Math.atan2(v.x, v.z);
      const rx = Math.asin(Math.max(-1, Math.min(1, v.y)));
      setRot({ rx, ry });
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [camera]);
  return (
    <div style={{ transform: `rotateY(${-rot.ry}rad) rotateX(${rot.rx}rad)`, transformStyle: 'preserve-3d', width: 0, height: 0 }}>
      {[
        { c: '#E5484D', d: 'M0 0 L30 0' },
        { c: '#46A758', d: 'M0 0 L0 -30' },
        { c: '#4F8EF7', d: 'M0 0 L0 30' },
      ].map((l, i) => (
        <svg key={i} width="30" height="30" viewBox="0 0 30 30" style={{ position: 'absolute' }}>
          <line x1="0" y1="15" x2={i === 0 ? '30' : '15'} y2="15" stroke={l.c} strokeWidth="2.4" />
        </svg>
      ))}
      <svg width="70" height="30" viewBox="0 0 30 30" style={{ position: 'absolute', left: 30 }}>
        <line x1="15" y1="30" x2="15" y2="0" stroke="#46A758" strokeWidth="2.4" />
        <line x1="0" y1="15" x2="30" y2="15" stroke="#E5484D" strokeWidth="2.4" />
        <line x1="15" y1="15" x2="0" y2="15" stroke="#4F8EF7" strokeWidth="2.4" />
      </svg>
    </div>
  );
}

/* ---------------- 底部工具栏小组件 ---------------- */
function ToolBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: P3.text, background: 'transparent', border: 'none', position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = P3.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}
function MenuPop({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute', background: '#fff', border: `1px solid ${P3.border}`, borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.14)', padding: 6, zIndex: 20, minWidth: 150, ...style,
      }}
    >
      {children}
    </div>
  );
}
function MenuRow({ label, hotkey, active, onClick }: { label: string; hotkey?: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: 'none', background: 'transparent',
        color: active ? P3.primary : P3.text, fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = P3.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span>{label}</span>
      {hotkey && <span style={{ fontSize: 11, color: P3.faint }}>{hotkey}</span>}
    </button>
  );
}
/* 素体菜单项：Pavo 同款——「几何模型」hover 展开二级（立方体/球体/圆柱体/环状体/圆锥/棱锥） */
function KindMenuItems({ subMenu, setSubMenu, onPick }: {
  subMenu: string | null;
  setSubMenu: React.Dispatch<React.SetStateAction<string | null>>;
  onPick: (k: BodyKind) => void;
}) {
  const hoverTimer = React.useRef<number>(0);
  const clearSub = (key: string) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setSubMenu((s) => (s === key ? null : s)), 180);
  };
  const keepSub = () => window.clearTimeout(hoverTimer.current);
  return (
    <>
      {BODY_KINDS.map((k) => (
        <div
          key={k.key}
          style={{ position: 'relative' }}
          onMouseEnter={() => { window.clearTimeout(hoverTimer.current); if (k.children) setSubMenu(k.key); }}
          onMouseLeave={() => k.children && clearSub(k.key)}
        >
          <button
            onClick={() => (k.children ? setSubMenu(subMenu === k.key ? null : k.key) : onPick(k.key))}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              padding: '8px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: 'none', background: 'transparent',
              color: subMenu === k.key ? P3.primary : P3.text, fontWeight: subMenu === k.key ? 600 : 400,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = P3.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span>{k.label}</span>
            {k.children && <ChevronRight size={14} style={{ color: P3.faint, marginLeft: 8 }} />}
          </button>
          {k.children && subMenu === k.key && (
            <div
              onMouseEnter={keepSub}
              onMouseLeave={() => clearSub(k.key)}
              style={{
                position: 'absolute', left: '100%', top: -6, background: '#fff', border: `1px solid ${P3.border}`,
                borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.14)', padding: 6, zIndex: 30, minWidth: 108,
              }}
            >
              {k.children.map((c) => (
                <button
                  key={c.key}
                  onClick={() => onPick(c.key)}
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', padding: '8px 10px', borderRadius: 8,
                    fontSize: 13, cursor: 'pointer', border: 'none', background: 'transparent', color: P3.text,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = P3.hover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ---------------- 场景行 / 字段 ---------------- */
function SceneRow({ icon, name, active, visible, locked, onSelect, onEye, onLock }: {
  icon: React.ReactNode; name: string; active: boolean;
  visible: boolean; locked: boolean;
  onSelect: () => void; onEye: () => void; onLock: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8,
        cursor: locked ? 'not-allowed' : 'pointer',
        background: active ? 'rgba(10,188,207,0.1)' : 'transparent',
        border: active ? `1px solid rgba(10,188,207,0.4)` : '1px solid transparent',
        opacity: visible ? 1 : 0.45,
      }}
    >
      <span style={{ color: P3.helper }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, color: P3.text }}>{name}</span>
      <button onClick={(e) => { e.stopPropagation(); onEye(); }} title={visible ? '隐藏' : '显示'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: P3.faint, padding: 2 }}>
        {visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button onClick={(e) => { e.stopPropagation(); onLock(); }} title={locked ? '解锁' : '锁定'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: locked ? P3.primary : P3.faint, padding: 2 }}>
        {locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: P3.helper }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 150, fontSize: 13, color: P3.text, textAlign: 'right', border: `1px solid ${P3.border}`, borderRadius: 8, padding: '4px 8px', outline: 'none' }}
      />
    </div>
  );
}

function VecField({ label, value, onChange }: { label: string; value: number[]; onChange: (v: number[]) => void }) {
  const parts = value.map((v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0));
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: P3.helper }}>{label}</span>
      <input
        value={raw ?? parts.join(' / ')}
        placeholder="x / y / z"
        onChange={(e) => {
          setRaw(e.target.value);
          const nums = e.target.value.split('/').map((s) => parseFloat(s.trim()));
          if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) onChange(nums);
        }}
        onBlur={() => setRaw(null)}
        style={{ width: 150, fontSize: 13, color: P3.text, textAlign: 'right', border: `1px solid ${P3.border}`, borderRadius: 8, padding: '4px 8px', outline: 'none' }}
      />
    </div>
  );
}

/* ---------------- 姿势角度表 ---------------- */
const POSE_ANGLES: Record<string, { arm: number; leg: number }> = {
  站立: { arm: 0, leg: 0 },
  T型: { arm: Math.PI / 2, leg: 0 },
  行走: { arm: 0.5, leg: 0.5 },
  跑步: { arm: 0.9, leg: 0.9 },
  坐姿: { arm: -0.4, leg: 1.2 },
  蹲下: { arm: 0.2, leg: 1.4 },
  单膝跪: { arm: 0.3, leg: 1.1 },
  双膝跪: { arm: 0.2, leg: 1.4 },
  叉腰: { arm: -0.6, leg: 0 },
  倚靠: { arm: -0.3, leg: -0.2 },
  鞠躬: { arm: 0, leg: 0 },
  思考: { arm: 0.8, leg: 0 },
  格斗: { arm: 1.1, leg: 0.4 },
  踢球: { arm: 0.6, leg: 1.6 },
  投掷: { arm: 1.4, leg: 0.3 },
  推进: { arm: 0.9, leg: 0.2 },
  招手: { arm: 1.0, leg: 0 },
  伸手: { arm: 0.7, leg: 0 },
  抱臂: { arm: -1.2, leg: 0 },
  看手机: { arm: -0.9, leg: 0 },
};

/* ---------------- 摄像机标记 ---------------- */
function buildCameraMarker(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.22),
    new THREE.MeshStandardMaterial({ color: '#2A2A2A', roughness: 0.5 }),
  );
  g.add(body);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.16, 16),
    new THREE.MeshStandardMaterial({ color: '#555' }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.15;
  g.add(lens);
  const dir = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.3, 12),
    new THREE.MeshStandardMaterial({ color: '#0ABCCF' }),
  );
  dir.rotation.x = Math.PI / 2;
  dir.position.z = 0.45;
  g.add(dir);
  return g;
}
