import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { characters, locations, projects, scenes, generationJobs } from '@server/database/schema';
import { eq, desc, and, count } from 'drizzle-orm';
import type {
  Character,
  Location,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  CreateLocationRequest,
  UpdateLocationRequest,
  GenerateBibleRequest,
  GenerateBibleResponse,
  GenerateBibleCounts,
  WorldView,
  StyleBible,
} from '@shared/api.interface';
import { BudgetCapService } from '../generation/budget-cap.service';
import { ModelGatewayService } from '../generation/model-gateway.service';

/** AI 生成的中间草稿（未落库） */
interface DraftCharacter {
  name: string;
  roleType: string;
  age?: number;
  gender?: string;
  faceFeatures?: string;
  hairstyle?: string;
  costume?: string;
  accessories?: string;
  personality?: string;
  voiceType?: string;
  canonicalDescription?: string;
  forbiddenChanges?: string;
}
interface DraftLocation {
  name: string;
  locationType: string;
  timeOfDay: string;
  weather?: string;
  architecture?: string;
  furniture?: string;
  lighting?: string;
  colorPalette?: string;
  description?: string;
}
interface BibleDraft {
  worldView: WorldView;
  styleBible: StyleBible;
  characters: DraftCharacter[];
  locations: DraftLocation[];
}

const WORLD_KEYS: (keyof WorldView)[] = ['era', 'geography', 'socialRules', 'artStyle', 'colorSystem'];
const STYLE_KEYS: (keyof StyleBible)[] = ['visualStyle', 'cameraLanguage', 'colorPalette', 'lighting', 'texture', 'motionLanguage', 'subtitleStyle'];
const CHAR_KEYS: (keyof DraftCharacter)[] = ['roleType', 'age', 'gender', 'faceFeatures', 'hairstyle', 'costume', 'accessories', 'personality', 'voiceType', 'canonicalDescription', 'forbiddenChanges'];
const LOC_KEYS: (keyof DraftLocation)[] = ['locationType', 'timeOfDay', 'weather', 'architecture', 'furniture', 'lighting', 'colorPalette', 'description'];

const emptyWorld = (): WorldView => ({ era: '', geography: '', socialRules: '', artStyle: '', colorSystem: '' });
const emptyStyle = (): StyleBible => ({ visualStyle: '', cameraLanguage: '', colorPalette: '', lighting: '', texture: '', motionLanguage: '', subtitleStyle: '' });
const str = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '';

@Injectable()
export class BibleService {
  private readonly logger = new Logger(BibleService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
    private readonly modelGateway: ModelGatewayService,
  ) {}

  // ========== Characters ==========
  async listCharacters(projectId: string): Promise<Character[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .orderBy(desc(characters.sortOrder), desc(characters.createdAt));
    return rows.map((r) => this.mapCharacter(r));
  }

  async getCharacter(projectId: string, id: string): Promise<Character> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('人物不存在');
    }
    return this.mapCharacter(rows[0]);
  }

  async createCharacter(
    projectId: string,
    dto: CreateCharacterRequest,
  ): Promise<Character> {
    const rows = await this.db
      .insert(characters)
      .values({
        projectId,
        name: dto.name,
        roleType: dto.roleType ?? 'supporting',
        age: dto.age,
        gender: dto.gender,
        canonicalDescription: dto.canonicalDescription,
        referenceImageUrls: dto.referenceImageUrls ?? [],
      })
      .returning();
    return this.mapCharacter(rows[0]);
  }

  async updateCharacter(
    projectId: string,
    id: string,
    dto: UpdateCharacterRequest,
  ): Promise<Character> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.roleType !== undefined) patch.roleType = dto.roleType;
    if (dto.age !== undefined) patch.age = dto.age;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.height !== undefined) patch.height = dto.height;
    if (dto.bodyType !== undefined) patch.bodyType = dto.bodyType;
    if (dto.faceFeatures !== undefined) patch.faceFeatures = dto.faceFeatures;
    if (dto.hairstyle !== undefined) patch.hairstyle = dto.hairstyle;
    if (dto.costume !== undefined) patch.costume = dto.costume;
    if (dto.accessories !== undefined) patch.accessories = dto.accessories;
    if (dto.personality !== undefined) patch.personality = dto.personality;
    if (dto.voiceType !== undefined) patch.voiceType = dto.voiceType;
    if (dto.voiceId !== undefined) patch.voiceId = dto.voiceId;
    if (dto.canonicalDescription !== undefined)
      patch.canonicalDescription = dto.canonicalDescription;
    if (dto.forbiddenChanges !== undefined)
      patch.forbiddenChanges = dto.forbiddenChanges;
    if (dto.referenceImageUrls !== undefined)
      patch.referenceImageUrls = dto.referenceImageUrls;
    if (dto.locked !== undefined) patch.locked = dto.locked;

    if (Object.keys(patch).length === 0) {
      return this.getCharacter(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(characters)
      .set(patch)
      .where(and(eq(characters.id, id), eq(characters.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('人物不存在');
    return this.mapCharacter(rows[0]);
  }

  async deleteCharacter(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(characters)
      .where(and(eq(characters.id, id), eq(characters.projectId, projectId)))
      .returning({ id: characters.id });
    if (rows.length === 0) throw new NotFoundException('人物不存在');
  }

  /**
   * W4 一致性：标准描述一键补全（无 LLM，确定性组装）。
   * 已有描述则直接返回；缺失时按姓名/年龄/性别/体型/五官/发型/服装/配饰/性格拼装，
   * 作为跨镜一致性的文本锚点（forbiddenChanges 同步给一条默认约束）。
   */
  async completeCharacterDescription(projectId: string, id: string): Promise<Character> {
    const char = await this.getCharacter(projectId, id);
    if (char.canonicalDescription?.trim()) return char;
    const parts = [
      char.name,
      char.age !== undefined ? `${char.age}岁` : '',
      char.gender || '',
      char.bodyType ? `${char.bodyType}体型` : '',
      char.faceFeatures || '',
      char.hairstyle ? `${char.hairstyle}发型` : '',
      char.costume ? `着${char.costume}` : '',
      char.accessories ? `配饰${char.accessories}` : '',
      char.personality ? `性格${char.personality}` : '',
    ].filter(Boolean);
    const canonicalDescription = parts.length > 0 ? parts.join('，') : `${char.name}`;
    const forbiddenChanges = char.forbiddenChanges?.trim()
      || '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换';
    return this.updateCharacter(projectId, id, { canonicalDescription, forbiddenChanges });
  }

  async generateCharacterImage(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    // P1 超预算拦截：所有任务创建入口统一守卫
    await this.budgetCap.assertAllowed();
    const char = await this.getCharacter(projectId, id);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'character',
        targetId: char.id,
        status: 'pending',
        inputData: {
          prompt: char.canonicalDescription ?? char.name,
          references: char.referenceImageUrls,
        },
      })
      .returning({ id: generationJobs.id });
    return { jobId: rows[0].id };
  }

  // ========== Locations ==========
  async listLocations(projectId: string): Promise<Location[]> {
    const rows = await this.db
      .select()
      .from(locations)
      .where(eq(locations.projectId, projectId))
      .orderBy(desc(locations.sortOrder), desc(locations.createdAt));
    return rows.map((r) => this.mapLocation(r));
  }

  async getLocation(projectId: string, id: string): Promise<Location> {
    const rows = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('场景不存在');
    }
    return this.mapLocation(rows[0]);
  }

  async createLocation(
    projectId: string,
    dto: CreateLocationRequest,
  ): Promise<Location> {
    const rows = await this.db
      .insert(locations)
      .values({
        projectId,
        name: dto.name,
        locationType: dto.locationType ?? 'interior',
        timeOfDay: dto.timeOfDay ?? 'day',
        description: dto.description,
        referenceImageUrls: dto.referenceImageUrls ?? [],
      })
      .returning();
    return this.mapLocation(rows[0]);
  }

  async updateLocation(
    projectId: string,
    id: string,
    dto: UpdateLocationRequest,
  ): Promise<Location> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.locationType !== undefined) patch.locationType = dto.locationType;
    if (dto.timeOfDay !== undefined) patch.timeOfDay = dto.timeOfDay;
    if (dto.weather !== undefined) patch.weather = dto.weather;
    if (dto.architecture !== undefined) patch.architecture = dto.architecture;
    if (dto.furniture !== undefined) patch.furniture = dto.furniture;
    if (dto.lighting !== undefined) patch.lighting = dto.lighting;
    if (dto.colorPalette !== undefined) patch.colorPalette = dto.colorPalette;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.referenceImageUrls !== undefined)
      patch.referenceImageUrls = dto.referenceImageUrls;
    if (dto.locked !== undefined) patch.locked = dto.locked;

    if (Object.keys(patch).length === 0) {
      return this.getLocation(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(locations)
      .set(patch)
      .where(and(eq(locations.id, id), eq(locations.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('场景不存在');
    return this.mapLocation(rows[0]);
  }

  async deleteLocation(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(locations)
      .where(and(eq(locations.id, id), eq(locations.projectId, projectId)))
      .returning({ id: locations.id });
    if (rows.length === 0) throw new NotFoundException('场景不存在');
  }

  async generateLocationImage(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const loc = await this.getLocation(projectId, id);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'location',
        targetId: loc.id,
        status: 'pending',
        inputData: {
          prompt: loc.description ?? loc.name,
          references: loc.referenceImageUrls,
        },
      })
      .returning({ id: generationJobs.id });
    return { jobId: rows[0].id };
  }

  // ========== AI 一键生成制作圣经 ==========
  /**
   * 剧本 → 完整制作圣经（世界观 5 项 + 风格 7 项 + 人物 + 场景），并写入数据库。
   *
   * 设计要点：
   *  · 这是「剧本分析后人物/场景为何一直为空」的断点：parse_script 只物化 scenes + shots，
   *    明确跳过 bible_ready，从来没有创建过 characters / locations / worldView / styleBible。
   *  · 模型不可用（无 Key、mock、限流、返回非法 JSON）时不报错中断，而是用确定性启发式
   *    从剧本抽取角色、场次并套题材模板，保证本地也能得到一份「可编辑草稿」。
   *  · mode=fill 只补空白且跳过 locked 项，用户手动修订过的设定不会被一键生成覆盖。
   */
  async generateBible(
    projectId: string,
    dto: GenerateBibleRequest,
  ): Promise<GenerateBibleResponse> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .select({
        scriptText: projects.scriptText,
        description: projects.description,
        title: projects.title,
        genre: projects.genre,
        artStyle: projects.artStyle,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    const project = rows[0];
    const script = await this.resolveScript(projectId, project, dto.scriptText);
    if (!script.trim()) {
      throw new BadRequestException(
        '尚未找到剧本内容：请先在「剧本」页写入剧本，或在生成时粘贴一段故事梗概',
      );
    }
    const meta = {
      title: project.title ?? '',
      genre: project.genre ?? '',
      artStyle: project.artStyle ?? '',
    };
    const filler = this.fallbackDraft(script, meta);
    let draft: BibleDraft = filler;
    let source: 'llm' | 'fallback' = 'fallback';
    let note = '未接文本模型，已按剧本规则生成草稿，请逐项复核';

    try {
      const raw = await this.modelGateway.generateText(
        { prompt: this.buildBiblePrompt(script, meta), temperature: 0.6 },
        dto.providerName,
      );
      const parsed = this.parseBibleJson(raw);
      if (parsed && (parsed.characters.length > 0 || parsed.locations.length > 0)) {
        draft = this.mergeDraft(parsed, filler);
        source = 'llm';
        note = undefined;
      } else {
        note = '模型未返回可用设定，已按剧本规则生成草稿，请逐项复核';
      }
    } catch (e) {
      const reason = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`圣经生成模型调用失败，转启发式草稿：${reason}`);
      note = `模型调用失败（${reason.slice(0, 120)}），已按剧本规则生成草稿，请逐项复核`;
    }

    const persisted = await this.persistBible(projectId, draft, dto.mode ?? 'fill');
    this.logger.log(
      `圣经生成完成 project=${projectId} source=${source} ` +
        `chars=${persisted.counts.charactersCreated}+${persisted.counts.charactersUpdated} ` +
        `locs=${persisted.counts.locationsCreated}+${persisted.counts.locationsUpdated}`,
    );
    return { ...persisted, source, note };
  }

  /** 剧本来源优先级：请求体 → 项目剧本 → 场次汇总 → 项目简介 */
  private async resolveScript(
    projectId: string,
    project: { scriptText: string | null; description: string | null },
    override?: string,
  ): Promise<string> {
    if (override?.trim()) return override.trim();
    if (project.scriptText?.trim()) return project.scriptText.trim();
    const sc = await this.db
      .select({ title: scenes.title, summary: scenes.summary })
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(scenes.sortOrder)
      .limit(80);
    if (sc.length > 0) {
      return sc
        .map((s, i) => `第${i + 1}场 ${s.title ?? ''}${s.summary ? `：${s.summary}` : ''}`)
        .join('\n');
    }
    return (project.description ?? '').trim();
  }

  private buildBiblePrompt(
    script: string,
    meta: { title: string; genre: string; artStyle: string },
  ): string {
    const body = script.slice(0, 8000);
    return [
      '你是一位影视制作总美术与剧本统筹。请阅读剧本，产出一份可直接用于 AI 分镜生成的「制作圣经」。',
      `片名：${meta.title || '未命名'}；题材：${meta.genre || '未指定'}；画风：${meta.artStyle || '未指定'}。`,
      '要求：人物姓名、场景名称必须尽量沿用剧本原文；所有字段用简体中文；不要写解释、不要 Markdown 围栏，只输出一个合法 JSON 对象。',
      '人物 3–8 个，场景 2–8 个；每个字段都要有具体内容，不要留空字符串。',
      'JSON 结构如下：',
      JSON.stringify({
        worldView: { era: '时代背景', geography: '地理环境', socialRules: '社会规则', artStyle: '美术风格', colorSystem: '色彩系统' },
        styleBible: { visualStyle: '视觉风格', cameraLanguage: '镜头语言', colorPalette: '色彩体系', lighting: '光影风格', texture: '质感纹理', motionLanguage: '运动语言', subtitleStyle: '字幕风格' },
        characters: [{
          name: '角色名', roleType: '主角|配角|群演', age: 28, gender: '女',
          faceFeatures: '五官与面部特征', hairstyle: '发型', costume: '服装', accessories: '配饰',
          personality: '性格', voiceType: '音色',
          canonicalDescription: '一段可直接作为跨镜一致性锚点的完整外貌描述',
          forbiddenChanges: '跨镜头必须保持不变的特征',
        }],
        locations: [{
          name: '场景名', locationType: '内景|外景', timeOfDay: '日|夜|黄昏', weather: '天气',
          architecture: '建筑结构', furniture: '陈设道具', lighting: '光线', colorPalette: '色彩',
          description: '一段可直接作为概念图提示的完整场景描述',
        }],
      }),
      '剧本正文：',
      '---',
      body,
      '---',
    ].join('\n');
  }

  /** 容忍 ```json 围栏、前后杂文本与轻微残片；结构不合法时返回 null 走兜底 */
  private parseBibleJson(raw: string): BibleDraft | null {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const wv = (obj.worldView ?? {}) as Record<string, unknown>;
    const st = (obj.styleBible ?? {}) as Record<string, unknown>;
    const worldView = emptyWorld();
    for (const k of WORLD_KEYS) worldView[k] = str(wv[k]);
    const styleBible = emptyStyle();
    for (const k of STYLE_KEYS) styleBible[k] = str(st[k]);

    const readList = (v: unknown, nameKey: string): Record<string, unknown>[] =>
      Array.isArray(v)
        ? v.slice(0, 12).filter((x): x is Record<string, unknown> =>
            !!x && typeof x === 'object' && str((x as Record<string, unknown>)[nameKey]).length > 0)
        : [];

    const characters: DraftCharacter[] = readList(obj.characters, 'name').map((r) => {
      const age = Number(r.age);
      return {
        name: str(r.name, 100),
        roleType: str(r.roleType, 30) || '配角',
        age: Number.isFinite(age) && age > 0 ? Math.min(120, Math.round(age)) : undefined,
        gender: str(r.gender, 20),
        faceFeatures: str(r.faceFeatures),
        hairstyle: str(r.hairstyle),
        costume: str(r.costume),
        accessories: str(r.accessories),
        personality: str(r.personality),
        voiceType: str(r.voiceType, 50),
        canonicalDescription: str(r.canonicalDescription, 600),
        forbiddenChanges: str(r.forbiddenChanges),
      };
    });
    const locations: DraftLocation[] = readList(obj.locations, 'name').map((r) => ({
      name: str(r.name, 100),
      locationType: str(r.locationType, 30) || '内景',
      timeOfDay: str(r.timeOfDay, 20) || '日',
      weather: str(r.weather, 30),
      architecture: str(r.architecture),
      furniture: str(r.furniture),
      lighting: str(r.lighting),
      colorPalette: str(r.colorPalette),
      description: str(r.description, 600),
    }));
    return { worldView, styleBible, characters, locations };
  }

  /** 题材模板：无模型时也要给出一套能直接用于后续生成的视觉基线 */
  private themeOf(text: string) {
    const t = text.toLowerCase();
    if (/赛博|科幻|未来|机器人|太空|霓虹|ai|全息/.test(t)) return {
      era: '近未来高科技都市，人工智能与巨型企业主导日常', geography: '垂直分层的巨型城市，高空新区与湿冷旧城区割裂',
      socialRules: '企业掌控秩序，数据身份决定阶层，地下情报交易活跃', artStyle: '赛博朋克写实，冷调科技感混少量东方元素',
      colorSystem: '青蓝为主，霓虹粉与警示橙点缀', visualStyle: '电影感写实 + 轻微胶片颗粒，夜戏为主',
      cameraLanguage: '手持跟拍与低机位广角交替，情绪镜头缓慢推近', colorPalette: '青蓝 / 品红 / 暖橙三点对比',
      lighting: '低调布光，霓虹轮廓光与湿地面反射', texture: '湿漉街面、金属拉丝、皮革与全息玻璃',
      motionLanguage: '快切推进，关键瞬间升格慢动作', subtitleStyle: '底部居中白字细黑描边，无衬线',
    };
    if (/古装|古代|宫廷|仙侠|武侠|江湖|唐朝|宋朝|民国|王朝/.test(t)) return {
      era: '古代王朝，礼制森严、门第分明', geography: '宫城与市井并立，庭院、长廊、山水远景构成主要空间',
      socialRules: '宗族与礼法高于个人意愿，身份决定言行尺度', artStyle: '东方古典写实，留白构图与低饱和设色',
      colorSystem: '黛青、朱砂、月白、沉金', visualStyle: '工笔质感与电影级柔光，讲究对称与留白',
      cameraLanguage: '稳定长镜与横向缓移，对称构图，情绪处用特写', colorPalette: '低饱和青灰 + 朱砂点缀',
      lighting: '自然光为主，窗棂侧光与烛火暖光', texture: '木构、绢帛、青砖、宣纸颗粒',
      motionLanguage: '舒缓推拉，动作段落短切但不碎', subtitleStyle: '底部居中宋体白字，淡墨底',
    };
    if (/悬疑|犯罪|凶案|侦探|警|追查|失踪|真相/.test(t)) return {
      era: '当代社会，信息不对称与旧案牵连当下', geography: '阴雨城市、旧公寓、地下室与审讯室等封闭空间',
      socialRules: '表面秩序下存在灰色地带，人人都有未说出口的动机', artStyle: '新黑色电影写实，高反差低调布光',
      colorSystem: '冷灰蓝为底，局部暖黄光源', visualStyle: '高对比写实，颗粒感与浅景深',
      cameraLanguage: '定点长镜 + 门框遮挡构图，关键信息给特写', colorPalette: '冷灰 / 深蓝 / 琥珀',
      lighting: '硬侧光、百叶窗投影、单一光源', texture: '潮湿墙面、磨旧皮革、纸张与毛玻璃',
      motionLanguage: '克制缓慢，揭露段落突然加速', subtitleStyle: '底部居中白字，细阴影',
    };
    if (/校园|青春|学生|恋爱|甜|毕业/.test(t)) return {
      era: '当代校园与城市生活', geography: '教室、走廊、操场、放学路上的街角',
      socialRules: '同龄人关系与家庭期待构成主要张力', artStyle: '清新自然写实，柔和日系色调',
      colorSystem: '米白、浅蓝、奶油黄', visualStyle: '自然光写实，轻微柔焦与逆光',
      cameraLanguage: '肩高平视与轻微手持，对话用正反打', colorPalette: '低对比高明度暖色',
      lighting: '午后侧逆光、窗边柔光', texture: '木质课桌、棉质校服、粉笔灰',
      motionLanguage: '稳定舒缓，情绪高点用慢镜', subtitleStyle: '底部居中圆体白字，淡描边',
    };
    return {
      era: '当代城市生活，时间线与现实接近', geography: '城市街区、室内居所与工作场所为主',
      socialRules: '现代都市规则，人物关系与现实利益驱动剧情', artStyle: '现代电影感写实',
      colorSystem: '中性灰蓝为底，情绪段落用暖色区分', visualStyle: '自然写实的电影质感，避免过度风格化',
      cameraLanguage: '中景与特写为主，对话正反打，情绪段落缓推', colorPalette: '低饱和中性色 + 单一强调色',
      lighting: '自然光与柔和补光结合，夜戏保留环境光源', texture: '真实材质，轻微胶片颗粒',
      motionLanguage: '以叙事清晰度优先，节奏随情绪起伏', subtitleStyle: '底部居中白字黑描边，字号适中',
    };
  }

  /** 确定性抽取：对白前缀识别角色、场次标题识别场景；不编造具体人名 */
  private fallbackDraft(
    script: string,
    meta: { title: string; genre: string; artStyle: string },
  ): BibleDraft {
    const theme = this.themeOf(`${script}\n${meta.genre}\n${meta.artStyle}`);
    const worldView: WorldView = {
      era: theme.era, geography: theme.geography, socialRules: theme.socialRules,
      artStyle: theme.artStyle, colorSystem: theme.colorSystem,
    };
    const styleBible: StyleBible = {
      visualStyle: theme.visualStyle, cameraLanguage: theme.cameraLanguage,
      colorPalette: theme.colorPalette, lighting: theme.lighting, texture: theme.texture,
      motionLanguage: theme.motionLanguage, subtitleStyle: theme.subtitleStyle,
    };

    const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const charMap = new Map<string, { count: number; quotes: string[]; actions: string[] }>();
    const locNames: string[] = [];
    const stop = new Set([
      '旁白', '画外音', '字幕', '提示', '注释', '导演', '备注', '时间', '地点', '人物',
      '场景', '镜头', '动作', '对白', '内心', 'OS', 'V.O', 'INT', 'EXT', '场', '第',
    ]);

    for (const line of lines) {
      const loc = line.match(/^(?:第\s*[零一二三四五六七八九十百\d]+\s*场|场景\s*\d*|INT\.?|EXT\.?|地点)\s*[：:·\-—]?\s*(.+)$/i);
      if (loc) {
        const name = loc[1]
          .replace(/[（(].*?[)）]/g, '')
          .split(/[，,。;；]/)[0]
          .trim()
          .slice(0, 60);
        if (name && locNames.length < 12 && !locNames.includes(name)) locNames.push(name);
      }
      const dlg = line.match(/^([^\s：:（）()【】\[\]{}<>0-9]{1,12})\s*(?:[（(][^)）]*[)）])?\s*[：:]\s*(.+)$/);
      if (!dlg) continue;
      const name = dlg[1].trim();
      if (stop.has(name) || name.length > 10 || /^(第|内景|外景|日|夜|早晨|黄昏|地点|时间)/.test(name)) continue;
      const info = charMap.get(name) ?? { count: 0, quotes: [], actions: [] };
      info.count += 1;
      if (info.quotes.length < 3) info.quotes.push(dlg[2].trim().slice(0, 60));
      charMap.set(name, info);
    }

    // 兼容「人物：林晚、陈舟」这类显式名单
    const castLine = lines.find((l) => /^(?:人物|角色|出场人物|主要人物)\s*[：:]/.test(l));
    if (castLine) {
      const rest = castLine.replace(/^(?:人物|角色|出场人物|主要人物)\s*[：:]\s*/, '');
      for (const piece of rest.split(/[、,，;；\s]+/)) {
        const name = piece.replace(/[（(].*?[)）]/g, '').trim().slice(0, 12);
        if (name && !stop.has(name) && !charMap.has(name)) {
          charMap.set(name, { count: 1, quotes: [], actions: [] });
        }
      }
    }

    // 补动作描写线索：台词之外出现该名字的行
    for (const line of lines) {
      for (const [name, info] of charMap) {
        if (info.actions.length >= 2 || line.startsWith(`${name}：`)) continue;
        if (line.includes(name) && line.length > name.length + 4) {
          info.actions.push(line.replace(/\s+/g, ' ').slice(0, 80));
        }
      }
    }

    const characters: DraftCharacter[] = [...charMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, info], i) => {
        const quotes = info.quotes.filter(Boolean);
        const actions = info.actions.filter(Boolean);
        const clue = [
          quotes.length ? `台词线索「${quotes.slice(0, 2).join(' / ')}」` : '',
          actions.length ? `动作线索「${actions[0]}」` : '',
        ].filter(Boolean).join('；');
        return {
          name,
          roleType: i === 0 ? '主角' : i < 3 ? '配角' : '群演',
          canonicalDescription:
            `${name}，${i === 0 ? '本片主要角色' : '本片出场角色'}。${clue || '请补充外貌与服装设定'}。` +
            '请在本页补全五官、发型、服装等一致性锚点，避免后续镜头形象漂移。',
          forbiddenChanges: '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换',
        };
      });

    const night = /夜|深夜|凌晨|晚上/.test(script);
    const locations: DraftLocation[] = (locNames.length > 0 ? locNames : ['主场景（请改名）'])
      .slice(0, 10)
      .map((name) => ({
        name,
        locationType: /外|街|广场|户外|路|桥|院|EXT/i.test(name) ? '外景' : '内景',
        timeOfDay: night ? '夜' : '日',
        lighting: theme.lighting,
        colorPalette: theme.colorPalette,
        architecture: `${theme.texture}；请按剧本补充空间结构与陈设`,
        description: `${name}。${theme.lighting}，${theme.colorPalette}。请补充可辨识的空间细节作为概念图一致性锚点。`,
      }));

    return { worldView, styleBible, characters, locations };
  }

  /** 模型结果与确定性草稿合并，保证每个字段都有内容 */
  private mergeDraft(primary: BibleDraft, filler: BibleDraft): BibleDraft {
    const worldView = emptyWorld();
    for (const k of WORLD_KEYS) worldView[k] = primary.worldView[k]?.trim() || filler.worldView[k];
    const styleBible = emptyStyle();
    for (const k of STYLE_KEYS) styleBible[k] = primary.styleBible[k]?.trim() || filler.styleBible[k];
    const characters = (primary.characters.length ? primary.characters : filler.characters).map((c) => ({
      ...c,
      canonicalDescription:
        c.canonicalDescription?.trim() || `${c.name}，请补充外貌与服装等跨镜一致性描述。`,
      forbiddenChanges:
        c.forbiddenChanges?.trim() || '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换',
    }));
    const locations = (primary.locations.length ? primary.locations : filler.locations).map((l) => ({
      ...l,
      description: l.description?.trim() || `${l.name}。请补充可辨识的空间细节。`,
    }));
    return { worldView, styleBible, characters, locations };
  }

  /** 落库：fill 只补空白、跳过 locked；overwrite 覆盖文本但保留参考图与锁定状态 */
  private async persistBible(
    projectId: string,
    draft: BibleDraft,
    mode: 'fill' | 'overwrite',
  ): Promise<Omit<GenerateBibleResponse, 'source' | 'note'>> {
    const counts: GenerateBibleCounts = {
      worldViewFields: 0, styleFields: 0,
      charactersCreated: 0, charactersUpdated: 0,
      locationsCreated: 0, locationsUpdated: 0,
    };

    const curWv = (await this.getWorldview(projectId)) ?? emptyWorld();
    const curSt = (await this.getStyle(projectId)) ?? emptyStyle();
    const nextWv: WorldView = { ...curWv };
    const nextSt: StyleBible = { ...curSt };
    for (const k of WORLD_KEYS) {
      const incoming = draft.worldView[k]?.trim() ?? '';
      if (!incoming) continue;
      if (mode === 'fill' && (curWv[k] ?? '').trim()) continue;
      nextWv[k] = incoming;
      counts.worldViewFields += 1;
    }
    for (const k of STYLE_KEYS) {
      const incoming = draft.styleBible[k]?.trim() ?? '';
      if (!incoming) continue;
      if (mode === 'fill' && (curSt[k] ?? '').trim()) continue;
      nextSt[k] = incoming;
      counts.styleFields += 1;
    }
    await this.updateWorldview(projectId, nextWv);
    await this.updateStyle(projectId, nextSt);

    const existingChars = await this.listCharacters(projectId);
    const charByName = new Map(existingChars.map((c) => [c.name.trim(), c]));
    let charOrder = existingChars.length;
    for (const c of draft.characters) {
      const name = c.name.trim().slice(0, 100);
      if (!name) continue;
      const found = charByName.get(name);
      if (found) {
        if (found.locked) continue;
        const patch: UpdateCharacterRequest = {};
        const cur = found as unknown as Record<string, unknown>;
        for (const k of CHAR_KEYS) {
          const incoming = (c as unknown as Record<string, unknown>)[k];
          if (incoming === undefined || incoming === '') continue;
          if (mode === 'fill' && String(cur[k] ?? '').trim()) continue;
          (patch as Record<string, unknown>)[k] = incoming;
        }
        if (Object.keys(patch).length > 0) {
          await this.updateCharacter(projectId, found.id, patch);
          counts.charactersUpdated += 1;
        }
      } else {
        await this.db.insert(characters).values({
          projectId,
          name,
          roleType: c.roleType || '配角',
          age: c.age,
          gender: c.gender,
          faceFeatures: c.faceFeatures,
          hairstyle: c.hairstyle,
          costume: c.costume,
          accessories: c.accessories,
          personality: c.personality,
          voiceType: c.voiceType,
          canonicalDescription: c.canonicalDescription,
          forbiddenChanges: c.forbiddenChanges,
          referenceImageUrls: [],
          locked: false,
          sortOrder: charOrder++,
        });
        counts.charactersCreated += 1;
      }
    }

    const existingLocs = await this.listLocations(projectId);
    const locByName = new Map(existingLocs.map((l) => [l.name.trim(), l]));
    let locOrder = existingLocs.length;
    for (const l of draft.locations) {
      const name = l.name.trim().slice(0, 100);
      if (!name) continue;
      const found = locByName.get(name);
      if (found) {
        if (found.locked) continue;
        const patch: UpdateLocationRequest = {};
        const cur = found as unknown as Record<string, unknown>;
        for (const k of LOC_KEYS) {
          const incoming = (l as unknown as Record<string, unknown>)[k];
          if (incoming === undefined || incoming === '') continue;
          if (mode === 'fill' && String(cur[k] ?? '').trim()) continue;
          (patch as Record<string, unknown>)[k] = incoming;
        }
        if (Object.keys(patch).length > 0) {
          await this.updateLocation(projectId, found.id, patch);
          counts.locationsUpdated += 1;
        }
      } else {
        await this.db.insert(locations).values({
          projectId,
          name,
          locationType: l.locationType || '内景',
          timeOfDay: l.timeOfDay || '日',
          weather: l.weather,
          architecture: l.architecture,
          furniture: l.furniture,
          lighting: l.lighting,
          colorPalette: l.colorPalette,
          description: l.description,
          referenceImageUrls: [],
          locked: false,
          sortOrder: locOrder++,
        });
        counts.locationsCreated += 1;
      }
    }

    return {
      worldView: nextWv,
      styleBible: nextSt,
      characters: await this.listCharacters(projectId),
      locations: await this.listLocations(projectId),
      counts,
    };
  }

  // ========== Worldview & Style ==========
  async getWorldview(projectId: string): Promise<WorldView | null> {
    const rows = await this.db
      .select({ worldView: projects.worldView })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return (rows[0].worldView as WorldView | null) ?? null;
  }

  async updateWorldview(projectId: string, body: WorldView): Promise<WorldView> {
    const rows = await this.db
      .update(projects)
      .set({ worldView: body, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning({ worldView: projects.worldView });
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0].worldView as WorldView;
  }

  async getStyle(projectId: string): Promise<StyleBible | null> {
    const rows = await this.db
      .select({ styleBible: projects.styleBible })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return (rows[0].styleBible as StyleBible | null) ?? null;
  }

  async updateStyle(projectId: string, body: StyleBible): Promise<StyleBible> {
    const rows = await this.db
      .update(projects)
      .set({ styleBible: body, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning({ styleBible: projects.styleBible });
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0].styleBible as StyleBible;
  }

  // ========== Mappers ==========
  private mapCharacter(row: typeof characters.$inferSelect): Character {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      roleType: row.roleType,
      age: row.age ?? undefined,
      gender: row.gender ?? undefined,
      height: row.height ?? undefined,
      bodyType: row.bodyType ?? undefined,
      faceFeatures: row.faceFeatures ?? undefined,
      hairstyle: row.hairstyle ?? undefined,
      costume: row.costume ?? undefined,
      accessories: row.accessories ?? undefined,
      personality: row.personality ?? undefined,
      voiceType: row.voiceType ?? undefined,
      voiceId: row.voiceId ?? undefined,
      canonicalDescription: row.canonicalDescription ?? undefined,
      forbiddenChanges: row.forbiddenChanges ?? undefined,
      referenceImageUrls: row.referenceImageUrls ?? [],
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapLocation(row: typeof locations.$inferSelect): Location {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      locationType: row.locationType,
      timeOfDay: row.timeOfDay,
      weather: row.weather ?? undefined,
      architecture: row.architecture ?? undefined,
      furniture: row.furniture ?? undefined,
      lighting: row.lighting ?? undefined,
      colorPalette: row.colorPalette ?? undefined,
      description: row.description ?? undefined,
      referenceImageUrls: row.referenceImageUrls ?? [],
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
