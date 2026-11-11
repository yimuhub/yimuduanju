import type { StorySkillId, StoryStylePreset } from '@shared/api.interface';

/**
 * 剧本技能注册表（W4 商业化 / 用户技能要求，版本化可追踪）。
 * 设计对标 GitHub 实践：
 * - novel-to-screenplay-skill（自动/引导双模式、好莱坞格式、三幕映射、6:1 压缩）
 * - ScriptPilot-AI（YAML 结构化中间表示：分析→抽取→场景→生成→质检）
 * - drama-skills（点子→分集→资产→提示词→审查，创作者确认点）
 * - video-prompt-engineer（提示词独立自足、情绪外化、资产纪律）
 * - ai-shortfilm-prompts（5 段式结构、真实摄影机锚定、10 项自检）
 */
export interface StorySkillMeta {
  id: StorySkillId;
  name: string;
  description: string;
  version: string;
  /**
   * F4 动态装配条件（移植 ToonFlow 技能矩阵思想）：
   * 为空 = 全模式适用；调用方按项目画风/内容模式过滤，只拼装对的技能。
   */
  appliesTo?: {
    artStyles?: string[];
    contentModes?: string[];
  };
}

export const STORY_SKILLS: StorySkillMeta[] = [
  {
    id: 'novel_to_script',
    name: '小说转剧本',
    description: '长篇小说压缩为竖屏短剧分集剧本骨架：人物合并、心理转动作、悬念前置',
    version: 'v1.0',
  },
  {
    id: 'script_rewrite',
    name: '剧本深度改造',
    description: '对现有剧本做吸引力改造：钩子前置、节拍加密、悬念结尾，可定向微调',
    version: 'v1.0',
  },
  {
    id: 'one_sentence_expand',
    name: '一句话扩写成剧本',
    description: '一句话创意扩展为完整短剧剧本，自动套用风格与吸引力规则',
    version: 'v1.0',
  },
  {
    id: 'ad_creative',
    name: '广告创意成片脚本',
    description: '产品信息→Hook(5选1公式)+PAS正文+CTA三段式广告脚本，直接物化为分镜',
    version: 'v1.0',
    appliesTo: { contentModes: ['ads', 'general'] },
  },
  {
    id: 'scene_to_rig',
    name: '描述转运镜序列',
    description: '一句话运镜描述→机位预设序列JSON，导演台一键摆机位再录白模',
    version: 'v1.0',
  },
  {
    id: 'character_design',
    name: '人物卡设计',
    description: '一句话人物设定→标准人物卡JSON（外貌/服装/性格/声线/禁改项），直接写入人物表',
    version: 'v1.0',
  },
  {
    id: 'script_to_boards',
    name: '剧本转分镜表',
    description: '剧本→结构化分镜JSON（景别/运镜/时长/对白/画面），直接物化为分镜',
    version: 'v1.0',
  },
];

/** 输出契约：LLM 必须返回 JSON（外层允许 ```json 围栏），失败时调用方降级用原文 */
export const SCRIPT_JSON_CONTRACT = `只输出一个 JSON 对象，不要输出任何解释文字，格式如下：
{"title":"剧名","logline":"一句话梗概","scenes":[{"heading":"第一场 客厅·夜","summary":"本场一句话概述","dialogues":[{"character":"角色名","text":"对白内容"}],"beats":["节拍1","节拍2"]}]}`;

const ATTRACTIVENESS_RULES = `吸引力铁律（竖屏短剧，直接决定完播率）：
1. 钩子前置：开场3秒内必须出现冲突、悬念或反转，禁止铺垫式开场；
2. 每场三要素：每场有明确目标-阻碍-转折，场尾必须留悬念钩子；
3. 对白驱动：多用短促有力的对白推进，少用旁白；内心独白转为可见的动作或表情；
4. 节拍密度：全片至少6个情节点，反转不少于2处；
5. 可拍性：每个动作必须是摄影机能记录的物理现象（位置/动作/表情/物件状态），抽象情绪必须外化；
6. 人物经济：主要人物不超过4人，次要人物合并或删除。`;

function styleBlock(style: StoryStylePreset): string {
  return `风格设定【${style.label}】：${style.description}\n视觉基调：${style.visual}\n避开：${style.negative}\n色调光影：${style.tone}\n镜头倾向：${style.camera}`;
}

export function buildNovelAdaptPrompt(
  novelText: string,
  style: StoryStylePreset,
  rewriteEnabled: boolean,
  genreRules = '',
): string {
  const mode = rewriteEnabled
    ? `改编模式：深度改造。允许为短剧节奏压缩合并人物、重排事件顺序、前置高潮悬念，但不得违背原著核心人设与主线。\n${ATTRACTIVENESS_RULES}`
    : `改编模式：忠实转换。只做结构化转写（分场、抽对白、标动作），不增删情节、不注入额外悬念，保留原著原貌。`;
  const genre = genreRules ? `\n${genreRules}\n` : '';
  return (
    `你是资深竖屏短剧编剧，擅长把长篇小说压缩成一集约60秒的短剧剧本骨架。\n${styleBlock(style)}\n${genre}${mode}\n` +
    `产出要求：分场标题用“第X场 地点·时间”格式；每场配2-6条对白；\n${SCRIPT_JSON_CONTRACT}\n\n【小说原文】\n${novelText.slice(0, 12000)}`
  );
}

export function buildRewritePrompt(
  scriptText: string,
  style: StoryStylePreset,
  directives?: string,
  genreRules = '',
): string {
  const extra = directives?.trim() ? `\n用户定向要求（优先满足）：${directives.trim().slice(0, 500)}` : '';
  const genre = genreRules ? `\n${genreRules}\n` : '';
  return (
    `你是资深竖屏短剧编剧兼剧本医生，对给定剧本做一次深度改造，但保持原故事内核、人物关系与结局走向不变。\n${styleBlock(style)}\n${genre}${ATTRACTIVENESS_RULES}${extra}\n` +
    `产出要求：分场标题用“第X场 地点·时间”格式；每场配2-6条对白；\n${SCRIPT_JSON_CONTRACT}\n\n【待改造剧本】\n${scriptText.slice(0, 12000)}`
  );
}

export function buildExpandPrompt(
  idea: string,
  style: StoryStylePreset,
  rewriteEnabled: boolean,
  genreRules = '',
  targetSeconds = 60,
): string {
  const secs = Math.max(15, Math.min(600, Math.round(targetSeconds || 60)));
  // 每场按 10-15 秒有效内容估算，避免 90 秒项目被写成 60 秒体量
  const sceneHint = Math.max(3, Math.min(12, Math.round(secs / 12)));
  const mode = rewriteEnabled
    ? `创作模式：爆款改造。从一句话出发自由发挥完整短剧，套用全部吸引力铁律。\n${ATTRACTIVENESS_RULES}`
    : `创作模式：朴素展开。把一句话扩展为结构完整的短剧剧本，不刻意堆砌反转，保持原意。`;
  const genre = genreRules ? `\n${genreRules}\n` : '';
  return (
    `你是资深竖屏短剧编剧，用户只给一句话创意，请输出一部时长约${secs}秒、可直接拍摄的短剧剧本。\n${styleBlock(style)}\n${genre}${mode}\n` +
    `产出要求：共 ${sceneHint} 场左右（按 ${secs} 秒分配，单场内容约 10-15 秒）；分场标题用“第X场 地点·时间”格式；每场配2-6条对白；\n${SCRIPT_JSON_CONTRACT}\n\n【一句话创意】\n${idea.slice(0, 2000)}`
  );
}

/**
 * 广告创意技能（借鉴 creatify-ai/video-ad-generator Part 1 框架）。
 * 输出可直接物化的可读脚本：每镜一行标题“第X镜 类型·景别·运镜·时长”（类型=钩子/正文/CTA），
 * 后跟对白/旁白行。物化器按标题切镜、按运镜字段设 movement。
 */
const AD_HOOK_FORMULAS = `Hook 公式（5选1，3秒内必须抓住人）：
1 痛点打断“还在为XX烦恼吗”；2 提问悬念“为什么XX都在换XX”；3 强断言“XX替代了XX”；
4 POV 代入“POV：你终于找到了XX”；5 数据权威“XX人都在用”。`;

const AD_BODY_PAS = `正文用 PAS 结构：P 痛点（点名疼）→ A 煽动（不解决的后果）→ S 解决（产品自然登场，最多3个卖点）。
结尾 CTA 必须明确单一动作（购买/下单/点击链接/领取试用/预约咨询二选一）。`;

export function buildAdPrompt(
  productBrief: string,
  style: StoryStylePreset,
  targetSeconds = 30,
  genreRules = '',
): string {
  const secs = Math.max(10, Math.min(60, targetSeconds || 30));
  const genre = genreRules ? `\n${genreRules}\n` : '';
  return (
    `你是资深短视频广告编导，为竖屏信息流写一条约${secs}秒、可直接拍摄的产品广告脚本。\n${styleBlock(style)}\n${genre}${AD_HOOK_FORMULAS}\n${AD_BODY_PAS}\n` +
    `输出格式（严格遵守，逐镜输出，不要解释）：
第1镜 钩子·特写·push_in·3s
旁白：钩子文案（套用上面5选1公式，注明用了哪个公式）
第2镜 正文·中景·dolly·5s
角色：对白或旁白文案
……（按${secs}秒均分4-7镜，运镜只能用：static/pan/zoom/dolly/follow/retreat/orbit/crane/aerial/pov）
第N镜 CTA·特写·static·3s
旁白：CTA文案（单一明确动作）
景别只能用：特写/中近景/中景/全景/远景。\n\n【产品信息】\n${productBrief.slice(0, 4000)}`
  );
}

/**
 * 运镜序列技能（GPT-6 场景代码来源之一，也可由本系统 LLM 直接产出）。
 * 输出 JSON 数组，导演台一键摆机位。rig 必须是十种机位 id 之一。
 */
export const RIG_JSON_CONTRACT = `只输出一个 JSON 数组，不要输出任何解释文字，格式如下：
[{"rig":"dolly","durationSeconds":4,"note":"轨道前推交代环境"},{"rig":"orbit","durationSeconds":5,"note":"环绕主体"}]
rig 只能是：static/pan/zoom/dolly/follow/retreat/orbit/crane/aerial/pov。`;

export function buildRigPrompt(
  description: string,
  totalSeconds = 10,
  contentMode: string = 'general',
): string {
  const secs = Math.max(3, Math.min(60, totalSeconds || 10));
  const flavor = contentMode === 'ads'
    ? '广告节奏：首镜必须用 push_in 或 zoom 做 Hook 式开场，尾镜用 static 收 CTA。'
    : contentMode === 'drama'
      ? '短剧节奏：首镜交代空间（dolly/aerial），中段跟随人物（follow/retreat），悬念处用 orbit。'
      : '节奏：首镜交代空间，中段推进，尾镜收束。';
  return (
    `你是资深摄影指导，把一段运镜描述转成机位预设序列。总时长约${secs}秒，切 2-5 个机位。${flavor}\n${RIG_JSON_CONTRACT}\n\n【运镜描述】\n${description.slice(0, 2000)}`
  );
}

/**
 * 人物卡技能（移植 ToonFlow art_character 约束手册 + MicroDrama character
 * 静/动二分思想）。输出 JSON 数组，调用方直接写入 characters 表。
 * 造型即锚点：外貌/服装/声线一次定死，后续生成一律引用 canonicalDescription。
 */
export const CHARACTER_JSON_CONTRACT = `只输出一个 JSON 数组，不要输出任何解释文字，格式如下：
[{"name":"阿强","roleType":"lead","age":28,"gender":"男","faceFeatures":"方脸浓眉","hairstyle":"短寸","costume":"黑色夹克牛仔裤","personality":"讲义气冲动","voiceType":"青年男中音","canonicalDescription":"28岁男子方脸浓眉短寸头，常年黑色夹克","forbiddenChanges":"脸型发型夹克三件套"}]
roleType 只能是：lead（主角）/supporting（配角）/extra（群演）。`;

export function buildCharacterPrompt(
  brief: string,
  style: StoryStylePreset,
  genreRules = '',
): string {
  const genre = genreRules ? `\n${genreRules}\n` : '';
  return (
    `你是资深角色设计师，为竖屏短剧设计人物卡。人物不求多：主角1-2人，配角不超过3人。\n${styleBlock(style)}\n${genre}` +
    `要求：每人一句 canonicalDescription（外貌+服装，50字内，后续生成逐字引用）；forbiddenChanges 写死绝不能变的三项（脸/发型/标志服装）；声线具体（青年男中音/少女清亮音之类，不写“好听”）。\n${CHARACTER_JSON_CONTRACT}\n\n【人物设定】\n${brief.slice(0, 2000)}`
  );
}

/** 分镜表可用的已确认资产清单（真实存在于项目里的人物/场景/道具） */
export interface BoardsAssetCatalog {
  characters?: { name: string; roleType?: string }[];
  locations?: { name: string; timeOfDay?: string }[];
  props?: { code?: string; name: string; category?: string }[];
}

/** 把资产清单渲染成「只能用这些」的约束块；空清单返回空串（不虚构） */
export function renderAssetCatalog(catalog?: BoardsAssetCatalog | null): string {
  if (!catalog) return '';
  const lines: string[] = [];
  const chars = (catalog.characters ?? []).filter((c) => c.name?.trim());
  if (chars.length > 0) {
    lines.push(
      `角色：${chars
        .map((c) => (c.roleType === 'lead' || c.roleType === 'protagonist' ? `${c.name}（主角）` : c.name))
        .join('、')}`,
    );
  }
  const locs = (catalog.locations ?? []).filter((l) => l.name?.trim());
  if (locs.length > 0) {
    lines.push(`场景：${locs.map((l) => (l.timeOfDay ? `${l.name}（${l.timeOfDay}）` : l.name)).join('、')}`);
  }
  const propList = (catalog.props ?? []).filter((p) => p.name?.trim());
  if (propList.length > 0) {
    lines.push(`道具：${propList.map((p) => [p.code?.trim(), p.name].filter(Boolean).join(' ')).join('、')}`);
  }
  if (lines.length === 0) return '';
  return [
    '【可用资产 · 只能用清单里的名字，不得新造人物/场景/道具】',
    ...lines,
    'cast / location / props 必须逐字使用上面的名称或编号；清单里没有的东西不要写进这三个字段，需要出现的背景陈设直接写进 visualPrompt 描述，不要当成道具。',
  ].join('\n');
}

/**
 * 分镜表技能（移植 ToonFlow storyboard_table + production_execution 思想）。
 * 输出扁平镜头数组，`scene` + `segment` 两级归组 → 调用方建「场 → 片段 → 镜」三级结构。
 * 解析失败回落 parse_script。
 */
export const BOARDS_JSON_CONTRACT = `只输出一个 JSON 数组，不要输出任何解释文字。数组每一项是**一个镜头**，按拍摄顺序排列，格式如下：
[{"scene":"第一场 雨夜·外","location":"旧书店·内","segment":1,"segmentTitle":"推门而入","intent":"establish","spaceAnchor":"mid_mid","axisDirection":"left_to_right","cast":["林晚"],"props":["PROP001 怀表"],"shotSize":"wide","movement":"dolly","screenDirection":"left_to_right","durationSeconds":6,"dialogue":"","visualPrompt":"林晚推门进来，雨从门缝灌进，暖黄台灯照亮左侧书架","beats":[{"from":0,"to":3,"description":"手推门，门缝透出暖光"},{"from":3,"to":6,"description":"跨进店内，回头看一眼门外"}]}]

字段规则：
- scene 相同 = 同一场；同一场里 segment 相同 = 同一片段。一段 = 同一空间内一段连续动作，时长 ≤15 秒、含 2-4 镜，超了就开新段。
- segmentTitle 给这段起个 4-12 字的名字；intent 只能是 establish/develop/turn/payoff/transition。
- spaceAnchor 是空间基准九宫格：left_front/mid_front/right_front/left_mid/mid_mid/right_mid/left_back/mid_back/right_back。
- axisDirection 是本段轴线：left_to_right/right_to_left/frontal/depth，同一段内不得翻转。
- screenDirection 是本镜画面方向：left_to_right/right_to_left/toward_camera/away_from_camera/static。普通反打时左侧人物向右看（left_to_right）、右侧人物向左看（right_to_left）。
- cast 只能写本镜真正出现在画面里的人物；props 只能写本镜真正看见的道具。清单外的名字一律不许写。
- shotSize 只能是：extreme_close_up/close_up/medium_close_up/medium/wide/long；movement 只能是十种机位：static/pan/zoom/dolly/follow/retreat/orbit/crane/aerial/pov。
- durationSeconds 4-15 整数；台词按约 4 字/秒估算，超 20 字必须拆镜或切听者反应镜。
- beats 每 3 秒一条，覆盖整镜时长，每条只写这一段的可见动作，台词放该段的 dialogue 里（无台词留空字符串）。`;

export function buildBoardsPrompt(
  scriptText: string,
  style: StoryStylePreset,
  genreRules = '',
  targetSeconds?: number,
  catalog?: BoardsAssetCatalog | null,
): string {
  const genre = genreRules ? `\n${genreRules}\n` : '';
  const durationRule =
    targetSeconds && targetSeconds > 0
      ? `全片目标总时长约${Math.round(targetSeconds)}秒：镜数×单镜时长之和须接近该值（允许±10%）。单镜默认 8-10 秒；动作/对白需要完整起承转合的镜头 10-12 秒；快切/过渡 4-6 秒；按内容选择，不要所有镜头同一时长。`
      : '';
  const catalogBlock = renderAssetCatalog(catalog);
  return (
    `你是资深分镜师，把剧本拆成可直接拍摄的分镜表。按「场 → 片段 → 镜」三级组织：每场先立空间基准，再按同一空间内的连续动作切片段（≤15 秒、2-4 镜），片段内按信息推进切镜。\n${styleBlock(style)}\n${genre}${durationRule}\n` +
    `${catalogBlock ? `${catalogBlock}\n` : ''}` +
    `【镜头语法】先问本镜给观众什么新信息再选景别与运镜；定场 1-2 镜完成；连续三个同景别而无信息变化必须改；一镜只安排一个主要运镜。\n` +
    `【空间连续性】每场第一次交代空间后必须给出九宫格基准与轴线；普通反打左者右看、右者左看，不得为露正脸让两人都面朝镜头；相邻镜核对站位、动作完成度、持物手、眼线与服装。\n` +
    `要求：visualPrompt 必须是摄影机能记录的物理现象（位置/动作/表情/光影），抽象情绪外化；dialogue 只写本镜要念的词。\n${BOARDS_JSON_CONTRACT}\n\n【剧本】\n${scriptText.slice(0, 12000)}`
  );
}

/**
 * V1 四视图定妆照提示词（移植 ToonFlow art_character.md:127-166 约束）：
 * 单图拼图一次生成——特写+正面+侧面+背面并排，同肤色体型发型服装。
 * 16:9 横版为原配方；竖屏项目用 9:16 由调用方指定尺寸。
 */
export function buildSheetPrompt(
  character: { name: string; canonicalDescription?: string; costume?: string },
  style: StoryStylePreset,
): string {
  const who = character.canonicalDescription?.trim()
    || `${character.name}${character.costume ? `，${character.costume}` : ''}`;
  return (
    `角色标准四视图定妆照，同一画面并排四格从左到右依次为：面部特写、正面全身、侧面全身、背面全身。` +
    `四格为同一人：肤色体型发型服装完全一致，中性微表情，纯色中性背景。${style.visual}\n` +
    `角色：${who}`
  );
}
