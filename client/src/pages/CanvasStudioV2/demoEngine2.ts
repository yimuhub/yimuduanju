/**
 * 一木·YIMU AI 视频创作平台 画布 v2 —— 演示生成引擎
 * 模拟 Pavo 各节点工具的真实产出：文生图 / 角色四视图 / 场景全景 / 剧本拆解 / 多分支等。
 * 阶段四接入真实三通道 API（火山 / 中转站 / 自定义）时，替换本模块为真实调用适配层。
 */
import { defaultPavoNode, type PavoNodeData } from './pavoTypes';

export interface ToolOutput {
  nodes: PavoNodeData[];      // 本次生成产出的节点（含连线目标）
  edgeNote?: string;          // 连线备注
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 演示占位图：青绿系渐变 SVG data URI（无需外部资源，仿 Pavo 浅色清爽） */
export function pavoDemoImage(seed: string, label: string): string {
  const colors: Array<[string, string]> = [
    ['#1FA97E', '#7FD9BC'],
    ['#4AC2A1', '#A9E8D4'],
    ['#2F9E7F', '#94D8C3'],
    ['#58C4B2', '#C2EFE4'],
    ['#178A66', '#6FCFAE'],
    ['#3AB795', '#BDE9DB'],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  const [c1, c2] = colors[h % colors.length];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='560'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/>` +
    `</linearGradient></defs>` +
    `<rect width='400' height='560' fill='url(#g)'/>` +
    `<text x='200' y='270' text-anchor='middle' font-size='20' fill='rgba(255,255,255,0.94)' font-family='sans-serif'>${label}</text>` +
    `<text x='200' y='312' text-anchor='middle' font-size='12' fill='rgba(255,255,255,0.78)' font-family='sans-serif'>一木·YIMU AI 视频创作平台演示生成 · 后续接入真实 API</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 四视图拼图：正面/侧面/背面/45° 四宫格（锁人物一致性演示） */
export function fourViewImage(seed: string, label: string): string {
  const views = ['正面', '侧面', '背面', '45°'];
  const colors = [['#1FA97E', '#7FD9BC'], ['#178A66', '#6FCFAE'], ['#2F9E7F', '#94D8C3'], ['#4AC2A1', '#A9E8D4']];
  const cells = views.map((v, i) => {
    const [c1, c2] = colors[i];
    return (
      `<svg x='${(i % 2) * 210}' y='${Math.floor(i / 2) * 280}' width='210' height='280' viewBox='0 0 210 280'>` +
      `<defs><linearGradient id='g${i}' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/>` +
      `</linearGradient></defs>` +
      `<rect width='210' height='280' fill='url(#g${i})'/>` +
      `<text x='105' y='135' text-anchor='middle' font-size='14' fill='rgba(255,255,255,0.92)' font-family='sans-serif'>${label}</text>` +
      `<text x='105' y='160' text-anchor='middle' font-size='11' fill='rgba(255,255,255,0.75)' font-family='sans-serif'>${v}</text>` +
      `</svg>`
    );
  }).join('');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='560'>` +
    `<rect width='420' height='560' fill='#F2F7F5'/>` + cells + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const pick = (arr: string[], seed: string) => arr[seed.length % arr.length];
const SIZES = ['特写', '近景', '中景', '全景', '远景'];
const ANGLES = ['平视', '俯角', '仰角'];
const MOVES = ['固定机位', '缓慢推近', '横移', '跟拍', '升降', '环绕'];
const LIGHTS = ['暖黄侧光', '冷蓝月光', '逆光剪影', '自然柔光', '霓虹光晕'];

function splitShots(text: string): string[] {
  const clean = text.trim();
  if (!clean) return ['角色推门而入，环顾四周', '两人对视，沉默片刻', '特写：关键道具', '角色缓缓说出关键台词'];
  const segs = clean.split(/[。！？\n]+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return ['角色推门而入'];
  return segs.slice(0, 4);
}

/**
 * 执行节点工具（Pavo 节点即工具箱）。
 * @param kind 节点类型
 * @param tool 工具 id
 * @param input 输入文本（节点摘要或用户提示词）
 * @returns 产出的新节点
 */
export async function runPavoTool(kind: PavoNodeData['kind'], tool: string, input: string): Promise<ToolOutput> {
  const text = input.trim() || '一木·YIMU AI 视频创作平台的创意';
  const seed = text + Math.random().toString(36).slice(2, 6);

  switch (tool) {
    case 'write': {
      await sleep(300);
      return {
        nodes: [{ ...defaultPavoNode('text', '文本'), values: { content: text }, seed }],
      };
    }
    case 'gen-script': {
      await sleep(1100);
      return {
        nodes: [{
          ...defaultPavoNode('script', '剧本大纲'),
          values: { content: `${text}\n\n第一幕：开场钩子\n第二幕：冲突升级\n第三幕：反转与余味\n——由一木·YIMU AI 视频创作平台自动展开（演示）` },
          seed,
        }],
        edgeNote: '一句话 → 剧本',
      };
    }
    case 'script-outline': {
      await sleep(1000);
      return {
        nodes: [{
          ...defaultPavoNode('script', '剧本 · 分集大纲'),
          values: { content: `第1集：${text.slice(0, 12)}…\n第2集：矛盾加深\n第3集：真相浮出\n——按三幕结构展开（演示）` },
          seed,
        }],
      };
    }
    case 'script2storyboard':
    case '拆解分镜':
    case 'script2storyboard-auto': {
      await sleep(1200);
      const shots = splitShots(text);
      return {
        nodes: shots.map((s, i) => ({
          ...defaultPavoNode('storyboard', `分镜 ${i + 1}`),
          values: { title: `分镜 ${i + 1} · ${pick(SIZES, s)}`, shots: '1', content: s.slice(0, 60), movement: pick(MOVES, s), lighting: pick(LIGHTS, s) },
          seed: seed + i,
        })),
        edgeNote: '剧本 → 分镜',
      };
    }
    case 'text2img':
    case '文生图': {
      await sleep(900);
      const s = pick(SIZES, seed);
      return {
        nodes: [{
          ...defaultPavoNode('image', `画面 · ${s}`),
          values: { prompt: `${text}，${s}，电影感`, url: pavoDemoImage(seed, `${text.slice(0, 6)} ${s}`) },
          hasImage: true, seed,
        }],
        edgeNote: `文生图 · ${s}`,
      };
    }
    case 'text2video':
    case '文生视频': {
      await sleep(1400);
      const m = pick(MOVES, seed);
      return {
        nodes: [{
          ...defaultPavoNode('video', `镜头 · ${m}`),
          values: { title: `镜头 · ${m}`, duration: String(3 + (seed.length % 4)), content: `${text.slice(0, 40)} / ${m} / ${pick(ANGLES, seed)}` },
          seed,
        }],
        edgeNote: `文生视频 · ${m}`,
      };
    }
    case 'img2img':
    case '图生图': {
      await sleep(900);
      const s = pick(SIZES, seed);
      return {
        nodes: [{
          ...defaultPavoNode('image', `图生图 · ${s}`),
          values: { prompt: `基于参考：${text.slice(0, 40)}，保持构图与风格，${s}`, url: pavoDemoImage(seed, `图生图 ${s}`) },
          hasImage: true, seed,
        }],
        edgeNote: '图生图（保持参考特征）',
      };
    }
    case 'char-set':
    case '角色设定': {
      await sleep(1000);
      return {
        nodes: [{
          ...defaultPavoNode('character', '角色设定'),
          values: { name: text.slice(0, 10), description: `外貌：${text.slice(0, 40)}…\n性格：冷静果决\n背景：待补充（演示）` },
          hasImage: true, isAsset: true, seed,
        }],
        edgeNote: '角色资产 · 已固化',
      };
    }
    case 'char-fourview':
    case '角色四视图': {
      await sleep(1300);
      return {
        nodes: [{
          ...defaultPavoNode('character', '角色四视图'),
          values: { name: text.slice(0, 10), description: '正面/侧面/背面/45° 多视角设定，锁定人物一致性', url: fourViewImage(seed, text.slice(0, 6)) },
          hasImage: true, isAsset: true, seed,
        }],
        edgeNote: '角色四视图 · 资产固化',
      };
    }
    case 'scene-set':
    case '场景设定图': {
      await sleep(1000);
      return {
        nodes: [{
          ...defaultPavoNode('scene', '场景设定图'),
          values: { name: text.slice(0, 10), description: `${text.slice(0, 40)}… 统一风格场景`, url: pavoDemoImage(seed, `场景 ${text.slice(0, 6)}`) },
          hasImage: true, isAsset: true, seed,
        }],
        edgeNote: '场景资产 · 已固化',
      };
    }
    case 'panorama':
    case '720全景': {
      await sleep(1400);
      return {
        nodes: [{
          ...defaultPavoNode('scene', '720° 全景场景'),
          values: { name: text.slice(0, 10), description: '720° 全景锁定空间一致性，可在各镜头复用', url: pavoDemoImage(seed, '720° 全景') },
          hasImage: true, isAsset: true, seed,
        }],
        edgeNote: '720° 全景 · 空间锁定',
      };
    }
    case 'product-set':
    case '产品设定图': {
      await sleep(1000);
      return {
        nodes: [{
          ...defaultPavoNode('image', '产品/道具设定图'),
          values: { prompt: `${text.slice(0, 50)}，产品设定图，纯白背景`, url: pavoDemoImage(seed, '道具设定') },
          hasImage: true, isAsset: true, seed,
        }],
        edgeNote: '道具资产 · 已固化',
      };
    }
    case 'storyboard2img':
    case '生成关键帧':
    case 'script2img': {
      await sleep(1000);
      const s = pick(SIZES, seed);
      return {
        nodes: [{
          ...defaultPavoNode('image', `关键帧 · ${s}`),
          values: { prompt: `${text.slice(0, 50)}，统一画风，电影感`, url: pavoDemoImage(seed, `关键帧 ${s}`) },
          hasImage: true, seed,
        }],
        edgeNote: `关键帧 · ${s}`,
      };
    }
    case 'storyboard2video':
    case '生成视频':
    case 'char2video':
    case 'asset2video':
    case 'img2video':
    case '视频生成': {
      await sleep(1400);
      const m = pick(MOVES, seed);
      return {
        nodes: [{
          ...defaultPavoNode('video', `镜头 · ${m}`),
          values: { title: `镜头 · ${m}`, duration: String(3 + (seed.length % 4)), content: `${text.slice(0, 40)} / ${m} / ${pick(ANGLES, seed)}` },
          seed,
        }],
        edgeNote: `视频 · ${m}`,
      };
    }
    case 'firstlast-frame':
    case '首尾帧': {
      await sleep(1500);
      return {
        nodes: [{
          ...defaultPavoNode('video', '首尾帧过渡'),
          values: { title: '首尾帧过渡', duration: '4', content: `首帧 → 尾帧：${text.slice(0, 30)}（演示）` },
          seed,
        }],
        edgeNote: '首尾帧',
      };
    }
    case 'all-ref':
    case '全能参考': {
      await sleep(1500);
      return {
        nodes: [{
          ...defaultPavoNode('video', '全能参考镜头'),
          values: { title: '全能参考镜头', duration: '4', content: `参考多主体：${text.slice(0, 30)}（演示）` },
          seed,
        }],
        edgeNote: '全能参考',
      };
    }
    case 'regenerate':
    case '局部重生成': {
      await sleep(1200);
      return {
        nodes: [{
          ...defaultPavoNode('video', '重生成镜头（新分支）'),
          values: { title: '重生成镜头 · v2', duration: '4', content: `新分支：${text.slice(0, 30)}（旧版保留对比）` },
          seed,
        }],
        edgeNote: '新分支 · 旧版保留',
      };
    }
    case 'voice':
    case '配音': {
      await sleep(800);
      return {
        nodes: [{
          ...defaultPavoNode('audio', '配音'),
          values: { type: '配音', name: `配音 · ${text.slice(0, 8)}`, voice: pick(['沉稳男声', '清亮女声', '温柔旁白'], seed) },
          seed,
        }],
        edgeNote: `配音 · ${pick(['沉稳男声', '清亮女声', '温柔旁白'], seed)}`,
      };
    }
    case 'bgm':
    case 'BGM': {
      await sleep(850);
      const bgms = ['抒情钢琴', '悬疑低音', '温暖弦乐', '史诗管弦'];
      return {
        nodes: [{
          ...defaultPavoNode('audio', 'BGM'),
          values: { type: 'BGM', name: `配乐 · ${pick(bgms, seed)}` },
          seed,
        }],
        edgeNote: `BGM · ${pick(bgms, seed)}`,
      };
    }
    case 'sfx':
    case '音效': {
      await sleep(700);
      const sfx = ['雨声', '脚步', '心跳', '风声'];
      return {
        nodes: [{
          ...defaultPavoNode('audio', '音效'),
          values: { type: '音效', name: pick(sfx, seed) },
          seed,
        }],
        edgeNote: `音效 · ${pick(sfx, seed)}`,
      };
    }
    case 'reverse-prompt':
    case '图片反推提示词': {
      await sleep(900);
      return {
        nodes: [{
          ...defaultPavoNode('text', '反推提示词'),
          values: { content: `反推提示词：电影感${pick(SIZES, seed)}，${pick(LIGHTS, seed)}，${pick(MOVES, seed)}，主体${text.slice(0, 20)}（演示）` },
          seed,
        }],
        edgeNote: '图片 → 提示词',
      };
    }
    case 'open-director':
    case '打开导演台': {
      await sleep(200);
      return { nodes: [], edgeNote: '导演台' };
    }
    case 'edit-note':
    case '编辑备注': {
      await sleep(200);
      return {
        nodes: [{ ...defaultPavoNode('note', '备注'), values: { text: text.slice(0, 80) }, seed }],
      };
    }
    case 'pick-asset':
    case '引用资产': {
      await sleep(300);
      return { nodes: [], edgeNote: '资产引用' };
    }
    default:
      await sleep(800);
      return {
        nodes: [{
          ...defaultPavoNode('text', 'AI 生成'),
          values: { content: `已按「${text.slice(0, 40)}」生成（演示引擎）` },
          seed,
        }],
      };
  }
}

/** 剧本 → 资产自动拆解（Pavo Harness 式：输入故事自动铺开角色/场景资产） */
export async function autoHarness(story: string): Promise<ToolOutput> {
  const base = story.trim() || '一个雨夜，少年与少女在旧书店重逢';
  await sleep(900);
  const chars = ['女主', '男主'];
  const scenes = ['雨夜旧书店', '老街小巷', '天台'];
  const nodes: PavoNodeData[] = [];
  chars.forEach((c, i) => {
    nodes.push({
      ...defaultPavoNode('character', `角色 · ${c}`),
      values: { name: c, description: `由剧本自动解析：${base.slice(0, 30)}…（演示）` },
      hasImage: true, isAsset: true, seed: `${base}${i}`,
    });
  });
  scenes.forEach((s, i) => {
    nodes.push({
      ...defaultPavoNode('scene', `场景 · ${s}`),
      values: { name: s, description: '由剧本自动解析的场景资产（演示）' },
      hasImage: true, isAsset: true, seed: `${base}s${i}`,
    });
  });
  return { nodes, edgeNote: '剧本 → 角色/场景资产自动拆解' };
}

/** Agent 对话演示回复 */
export async function pavoAgentReply(agentName: string, instruction: string, contextLabel: string): Promise<string> {
  await sleep(800);
  const ctx = contextLabel ? `（已选中：${contextLabel}）` : '（作用于整幅画布）';
  if (/剧本|剧情|情节|分集/i.test(instruction)) {
    return `【${agentName}】收到「${instruction}」${ctx}\n\n已生成剧本创作建议（演示）：\n1. 开场 3 秒制造钩子\n2. 第一个冲突提前到 30 秒内\n3. 结尾留悬念\n\n可在画布上：选中「剧本」节点 → 点「拆解分镜」自动铺开。`;
  }
  if (/角色|人物|一致/i.test(instruction)) {
    return `【${agentName}】收到「${instruction}」${ctx}\n\n角色一致性方案（演示）：\n1. 新建「角色」节点\n2. 用「角色四视图」生成正面/侧面/背面/45° 锁定形象\n3. 后续镜头从该资产节点拉线生成视频`;
  }
  if (/镜头|机位|运镜|景别|导演/i.test(instruction)) {
    return `【${agentName}】收到「${instruction}」${ctx}\n\n镜头建议（演示）：\n· 冲突戏用「仰拍 + 低机位」\n· 情绪戏用「特写 + 缓慢推近」\n· 可拖入「3D 导演台」节点精确摆位`;
  }
  if (/一键|成片|全流程|自动/i.test(instruction)) {
    return `【${agentName}】收到「${instruction}」${ctx}\n\n已按一键成片思路处理（演示）：\n输入一句故事 → AI 自动：剧本 → 分镜 → 关键帧 → 视频 → 配音 → BGM → 合成。\n在画布输入框输入故事后点「一键铺开」即可看到节点流。`;
  }
  return `【${agentName}】收到「${instruction}」${ctx}\n\n已生成创作建议并落地（演示模式）。\n\n可继续：\n· 双击画布空白添加节点\n· 点击节点 → 弹出该节点的专属工具\n· 让我把某段文本解析成多个分镜`;
}
