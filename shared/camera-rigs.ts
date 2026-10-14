/**
 * 机位预设库（白模产线 · 十种机位类型）
 * ---------------------------------------------------------------
 * 对标 seedance-skill 的 camera-rig：每种机位 = 时间的纯函数（路径类型），
 * 前后端共用同一份定义——导演台一键套用、视频 prompt 事实前缀、
 * QC 体检交叉核对、白模录制路径生成，全部以此为准，不各自发明口径。
 *
 * movement 取值说明：shots.movement 为自由 varchar，新老取值共存；
 * 老取值（static/slow_push_in/push_in/pull_out/pan_left/pan_right/tilt_up/
 * tilt_down/tracking/crane_up）保持有效，预设使用更精确的新取值。
 */

export type RigPathKind =
  | 'static'
  | 'pan'
  | 'zoom'
  | 'dolly'
  | 'follow'
  | 'retreat'
  | 'orbit'
  | 'crane'
  | 'aerial'
  | 'pov';

export interface CameraRig {
  id: RigPathKind;
  /** 中文名（导演台展示） */
  label: string;
  /** 写入 shots.movement 的值 */
  movement: string;
  /** 建议机位角度（shots.cameraAngle） */
  cameraAngle: string;
  /** 建议焦段（shots.lens） */
  lens: string;
  /** 建议 FOV（3D 摆机位用） */
  fov: number;
  /**
   * prompt 事实片段：技术术语，不用形容词（seedance-skill 铁律 3）。
   * 由 generateShotVideo 自动拼入【运镜事实】，描述运镜本身，不承诺叙事内容。
   */
  promptFragment: string;
  description: string;
}

export const CAMERA_RIGS: CameraRig[] = [
  {
    id: 'static',
    label: '固定机位',
    movement: 'static',
    cameraAngle: 'eye_level',
    lens: '50mm',
    fov: 50,
    promptFragment: 'locked-off static shot, tripod, no camera movement',
    description: '三脚架锁死，画面内靠人物动作推进，适合对话与反应镜头',
  },
  {
    id: 'pan',
    label: '摇摄',
    movement: 'pan',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 55,
    promptFragment: 'slow horizontal pan, constant angular velocity, level horizon',
    description: '机位不动、水平摇摄扫过空间，适合交代环境与人物调度',
  },
  {
    id: 'zoom',
    label: '变焦',
    movement: 'zoom',
    cameraAngle: 'eye_level',
    lens: '85mm',
    fov: 35,
    promptFragment: 'slow optical zoom-in, camera position fixed, focal length ramps linearly',
    description: '机位不动、焦段线性推进，适合情绪收紧与细节揭示',
  },
  {
    id: 'dolly',
    label: '轨道推拉',
    movement: 'dolly',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 55,
    promptFragment: 'linear dolly move on straight track, constant speed, no easing tail',
    description: '整机沿直线轨道匀速推/拉，空间纵深感最强，忌缓动瘫尾',
  },
  {
    id: 'follow',
    label: '背后跟随',
    movement: 'follow',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 55,
    promptFragment: 'tracking shot from behind subject, constant following distance, subject back to camera',
    description: '跟在人物身后保持等距，适合行走、潜入、探险类段落',
  },
  {
    id: 'retreat',
    label: '前置倒退跟拍',
    movement: 'retreat',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 55,
    promptFragment: 'reverse tracking shot, camera retreats ahead of subject, subject face visible',
    description: '相机在人物前方倒退，能拍到脸，适合对话行走与追逐回头',
  },
  {
    id: 'orbit',
    label: '环绕',
    movement: 'orbit',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 55,
    promptFragment: 'circular orbit around subject at constant radius and height, constant angular speed',
    description: '绕主体等半径等高匀速环绕，环绕中心必须是主体位置（probe 必查项）',
  },
  {
    id: 'crane',
    label: '摇臂升降',
    movement: 'crane',
    cameraAngle: 'high',
    lens: '24mm',
    fov: 65,
    promptFragment: 'vertical crane move, smooth constant-speed ascent, slight tilt compensation',
    description: '垂直升降带轻微俯仰补偿，适合从人物升到全景的揭示镜头',
  },
  {
    id: 'aerial',
    label: '航拍',
    movement: 'aerial',
    cameraAngle: 'high',
    lens: '24mm',
    fov: 65,
    promptFragment: 'aerial drone shot, high altitude slow forward push, wide establishing view',
    description: '高空缓慢前推，大场面 establishing，主体占画比例天然小',
  },
  {
    id: 'pov',
    label: '主观视角',
    movement: 'pov',
    cameraAngle: 'eye_level',
    lens: '35mm',
    fov: 60,
    promptFragment: 'first-person POV, handheld micro-shake, eye-level forward motion',
    description: '人物主观视角，允许轻微手持抖动，忌大幅运镜（易晕眩穿帮）',
  },
];

export const rigById = (id: string | undefined): CameraRig | undefined =>
  CAMERA_RIGS.find((r) => r.id === id || r.movement === id);

/** 老 movement 取值 → 中文（兼容历史数据展示） */
export const LEGACY_MOVEMENT_LABELS: Record<string, string> = {
  static: '固定',
  slow_push_in: '缓推',
  push_in: '推进',
  pull_out: '拉远',
  pan_left: '左摇',
  pan_right: '右摇',
  tilt_up: '上摇',
  tilt_down: '下摇',
  tracking: '跟拍',
  crane_up: '升降',
};

export const movementLabel = (movement: string | undefined): string => {
  if (!movement) return '固定';
  const rig = rigById(movement);
  if (rig) return rig.label;
  return LEGACY_MOVEMENT_LABELS[movement] ?? movement;
};

export const SHOT_SIZE_LABELS: Record<string, string> = {
  extreme_close_up: '大特写',
  close_up: '特写',
  medium_close_up: '中近景',
  medium: '中景',
  wide: '全景',
  long: '远景',
};

export const CAMERA_ANGLE_LABELS: Record<string, string> = {
  eye_level: '平视',
  high: '俯拍',
  low: '仰拍',
  over_shoulder: '过肩',
  top: '顶拍',
  dutch: '斜角',
};
