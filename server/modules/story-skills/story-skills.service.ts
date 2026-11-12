import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ModelGatewayService } from '../generation/model-gateway.service';
import {
  STORY_SKILLS,
  buildAdPrompt,
  buildBoardsPrompt,
  buildCharacterPrompt,
  buildExpandPrompt,
  buildNovelAdaptPrompt,
  buildRewritePrompt,
  buildRigPrompt,
  type BoardsAssetCatalog,
} from './skills';
import { CAMERA_RIGS } from '@shared/camera-rigs';
import { SPACE_ANCHORS } from '@shared/shot-craft';
import {
  cjkRatio,
  countLanguageViolations,
  detectBoardLanguage,
  isBoardTextInLanguage,
  normalizeBoardsLanguage,
  stripBrandTokens,
} from '@shared/boards-language';
import { GENRE_PRESETS, genreBlock, getGenrePreset } from './genres';
import { getStylePreset, getStylePresetById, STYLE_PRESETS } from './styles';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { StorySkillId, StoryStylePreset } from '@shared/api.interface';

export interface SkillRunInput {
  skillId: StorySkillId;
  /** 小说原文 / 待改剧本 / 一句话创意（三技能复用该字段） */
  source: string;
  styleId?: string;
  /** S2 题材 id（12 题材铁律拼进 prompt，风格定长相、题材定写法） */
  genreId?: string;
  /** B1 环节覆盖：指定模型与温度（未指定走供应商默认） */
  model?: string;
  temperature?: number;
  rewriteEnabled?: boolean;
  directives?: string;
  providerName?: string;
  /** 目标成片时长（秒）：一句话扩写/广告创意按此控制分场数量与节奏 */
  targetSeconds?: number;
}

export interface SkillRunResult {
  skillId: StorySkillId;
  /** 存入 project.scriptText 的可读剧本（与启发式物化器格式对齐） */
  scriptText: string;
  title?: string;
  scenesCount: number;
  dialoguesCount: number;
  /** true = 模型 JSON 不完整/非法，已用容错解析抢救（仍需人工审阅） */
  degraded?: boolean;
}

export interface RigBeat {
  rig: string;
  durationSeconds: number;
  note: string;
}

export interface CharacterCard {
  name: string;
  roleType: string;
  age?: number;
  gender?: string;
  faceFeatures?: string;
  hairstyle?: string;
  costume?: string;
  personality?: string;
  voiceType?: string;
  canonicalDescription?: string;
  forbiddenChanges?: string;
}

export interface BoardsShot {
  scene: string;
  /** 场次地点名（应命中资产清单里的 location） */
  location?: string;
  /** 片段号：同一场里相同 segment 归为一段 */
  segment?: number;
  segmentTitle?: string;
  intent?: string;
  spaceAnchor?: string;
  axisDirection?: string;
  /** 本镜真正出现在画面里的人物（只写清单内的名字） */
  cast?: string[];
  /** 本镜真正看见的道具（只写清单内的名字或编号） */
  props?: string[];
  shotSize: string;
  movement: string;
  screenDirection?: string;
  durationSeconds: number;
  dialogue?: string;
  visualPrompt?: string;
  /** 3 秒分段节拍 */
  beats?: { from: number; to: number; description: string; dialogue?: string }[];
}

export interface RigRunResult {
  skillId: StorySkillId;
  beats: RigBeat[];
}

/**
 * 剧本技能执行器：prompt 构建 → 网关文本调用 → 结构化解析 → 落库友好文本。
 * 无 Key 时抛出可读错误，由调用方转为 pending 等待（与 worker 语义一致）。
 */
@Injectable()
export class StorySkillsService {
  private readonly logger = new Logger(StorySkillsService.name);

  constructor(private readonly modelGateway: ModelGatewayService) {
    this.checkSkillsLock();
  }

  /**
   * F4 lock 校验：注册表版本与 skills-lock.json 不一致打 warn（ToonFlow 纪律），
   * 防改技能忘 bump。
   */
  private checkSkillsLock(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, global-require
      const lock = require('./skills-lock.json') as {
        skills?: Record<string, string>;
      };
      for (const s of STORY_SKILLS) {
        if (lock.skills?.[s.id] !== s.version) {
          this.logger.warn(
            `技能版本漂移：${s.id} 注册表 ${s.version} vs lock ${lock.skills?.[s.id] ?? '缺失'}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`skills-lock.json 读取失败：${(e as Error).message}`);
    }
  }

  listSkills(filter?: { artStyle?: string; contentMode?: string }) {
    let skills = STORY_SKILLS;    if (filter?.artStyle || filter?.contentMode) {
      skills = skills.filter((s) => {
        const cond = s.appliesTo;
        if (!cond) return true;
        if (cond.artStyles && filter.artStyle && !cond.artStyles.includes(filter.artStyle)) {
          return false;
        }
        if (cond.contentModes && filter.contentMode && !cond.contentModes.includes(filter.contentMode)) {
          return false;
        }
        return true;
      });
    }
    return {
      skills,
      styles: Object.values(STYLE_PRESETS) as StoryStylePreset[],
      genres: GENRE_PRESETS,
    };
  }

  /**
   * 样式图提示词：固定被摄体（同少女半身像）+ 各风格 visual，保证 21 张横向可比。
   * 被摄体故意中性，风格 visual 占主导；negative 用风格自带避雷。
   */
  buildStyleShowcasePrompt(style: StoryStylePreset): { prompt: string; negativePrompt: string } {
    const subject =
      'half-body portrait of a young woman with long black hair, facing camera, neutral expression, plain background';
    return {
      prompt: `${style.visual}, ${subject}`,
      negativePrompt: style.negative,
    };
  }

  /**
   * 样式图批量生成（ToonFlow art_skills 思想：每风格一张定妆照）：
   * 调图片网关 → 下载字节 → 落盘 client/public/styles/<id>.png → 前端画风卡直接展示。
   * 需要图片 Key；无 Key 时逐项返回可读错误，不中断其余。开发态产物，建议入库。
   */
  async generateStyleImages(
    styleIds?: string[],
    providerName?: string,
  ): Promise<{ results: { styleId: string; ok: boolean; file?: string; error?: string }[] }> {
    const ids = (styleIds ?? []).filter((id) => STYLE_PRESETS[id as keyof typeof STYLE_PRESETS]);
    const targets = (ids.length > 0 ? ids : Object.keys(STYLE_PRESETS)).slice(0, 30);
    const dir = resolve(process.cwd(), 'client', 'public', 'styles');
    await mkdir(dir, { recursive: true });
    const results: { styleId: string; ok: boolean; file?: string; error?: string }[] = [];
    for (const styleId of targets) {
      const style = STYLE_PRESETS[styleId as keyof typeof STYLE_PRESETS];
      try {
        const { prompt, negativePrompt } = this.buildStyleShowcasePrompt(style);
        // eslint-disable-next-line no-await-in-loop
        const images = await this.modelGateway.generateImage(
          { prompt, negativePrompt, size: '1024x1024' },
          providerName,
        );
        const url = images[0]?.url;
        if (!url) throw new Error('图片接口未返回可用 URL');
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`样式图下载失败 (${resp.status})`);
        // eslint-disable-next-line no-await-in-loop
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length === 0) throw new Error('样式图为空文件');
        // eslint-disable-next-line no-await-in-loop
        await writeFile(join(dir, `${styleId}.png`), buf);
        results.push({ styleId, ok: true, file: `/styles/${styleId}.png` });
        this.logger.log(`样式图已生成 ${styleId} ${(buf.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        results.push({ styleId, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  }

  resolveStyle(styleId?: string, artStyle?: string): StoryStylePreset {
    if (styleId) return getStylePresetById(styleId);
    return getStylePreset(artStyle);
  }

  async runSkill(input: SkillRunInput): Promise<SkillRunResult> {
    const source = (input.source ?? '').trim();
    if (!source) throw new BadRequestException('技能输入内容为空');
    if (input.skillId === 'scene_to_rig' || input.skillId === 'character_design') {
      throw new BadRequestException('运镜/人物卡技能请走专用接口（返回 JSON，不进剧本链）');
    }
    if (input.skillId === 'script_to_boards') {
      throw new BadRequestException('分镜表技能请走分镜任务接口（直接物化）');
    }
    if (input.skillId === 'novel_to_script' && source.length < 200) {
      throw new BadRequestException('小说原文过短（需 200 字以上），请补充内容或改用一句话模式');
    }
    const style = this.resolveStyle(input.styleId);
    const genre = getGenrePreset(input.genreId);
    const rewriteEnabled = input.rewriteEnabled !== false;

    const prompt =
      input.skillId === 'novel_to_script'
        ? buildNovelAdaptPrompt(source, style, rewriteEnabled, genreBlock(genre))
        : input.skillId === 'script_rewrite'
          ? buildRewritePrompt(source, style, input.directives, genreBlock(genre))
          : input.skillId === 'ad_creative'
            ? buildAdPrompt(source, style, input.targetSeconds, genreBlock(genre))
            : ((input.skillId as string) === 'scene_to_rig'
              ? buildRigPrompt(source)
              : buildExpandPrompt(
                  source,
                  style,
                  rewriteEnabled,
                  genreBlock(genre),
                  input.targetSeconds,
                ));

    let raw: string;
    try {
      raw = await this.modelGateway.generateText(
        { prompt, model: input.model, temperature: input.temperature },
        input.providerName,
      );
    } catch (e) {
      // 无 Key / 未配置：抛出可读错误，worker 会转为 pending 等待
      throw new BadRequestException(`剧本技能调用失败：${(e as Error)?.message ?? '未知错误'}`);
    }
    const parsed = this.parseScriptJson(raw);
    const scriptText = this.toReadableScript(parsed);
    const dialoguesCount = parsed.scenes.reduce((n, s) => n + s.dialogues.length, 0);
    this.logger.log(
      `技能 ${input.skillId} 完成：${parsed.scenes.length} 场 ${dialoguesCount} 条对白（风格 ${style.id}，改写${rewriteEnabled ? '开' : '关'}）`,
    );
    return {
      skillId: input.skillId,
      scriptText,
      title: parsed.title,
      scenesCount: parsed.scenes.length,
      dialoguesCount,
      ...(parsed.degraded ? { degraded: true } : {}),
    };
  }

  /** 人物卡技能：设定 → 人物卡 JSON（调用方直接写入人物表） */
  async runCharacters(input: {
    brief: string;
    styleId?: string;
    genreId?: string;
    providerName?: string;
  }): Promise<{ skillId: StorySkillId; characters: CharacterCard[] }> {
    const brief = (input.brief ?? '').trim();
    if (!brief) throw new BadRequestException('人物设定为空');
    const style = this.resolveStyle(input.styleId);
    const prompt = buildCharacterPrompt(brief, style, genreBlock(getGenrePreset(input.genreId)));
    let raw: string;
    try {
      raw = await this.modelGateway.generateText({ prompt }, input.providerName);
    } catch (e) {
      throw new BadRequestException(`人物卡技能调用失败：${(e as Error)?.message ?? '未知错误'}`);
    }
    const characters = this.parseCharacterJson(raw);
    this.logger.log(`人物卡技能完成：${characters.length} 个人物`);
    return { skillId: 'character_design', characters };
  }

  private parseCharacterJson(raw: string): CharacterCard[] {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (!Array.isArray(arr)) return [];
      const roles = new Set(['lead', 'supporting', 'extra']);
      return arr.slice(0, 8).flatMap((b) => {
        const r = (b ?? {}) as Record<string, unknown>;
        if (typeof r.name !== 'string' || !r.name.trim()) return [];
        const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : undefined);
        const age = Number(r.age);
        return [{
          name: (r.name as string).slice(0, 100),
          roleType: typeof r.roleType === 'string' && roles.has(r.roleType) ? r.roleType : 'supporting',
          age: Number.isFinite(age) ? Math.max(1, Math.min(120, Math.round(age))) : undefined,
          gender: str(r.gender),
          faceFeatures: str(r.faceFeatures),
          hairstyle: str(r.hairstyle),
          costume: str(r.costume),
          personality: str(r.personality),
          voiceType: str(r.voiceType),
          canonicalDescription: str(r.canonicalDescription),
          forbiddenChanges: str(r.forbiddenChanges),
        }];
      });
    } catch {
      return [];
    }
  }

  /** 分镜表技能：剧本 → 分镜 JSON（调用方直接物化，空数组表示解析失败走降级） */
  async runBoards(input: {
    scriptText: string;
    styleId?: string;
    genreId?: string;
    model?: string;
    temperature?: number;
    providerName?: string;
    targetSeconds?: number;
    /** 已确认的资产清单：分镜只能引用清单里的人/景/道具 */
    catalog?: BoardsAssetCatalog | null;
  }): Promise<{ skillId: StorySkillId; shots: BoardsShot[] }> {
    const scriptText = (input.scriptText ?? '').trim();
    if (!scriptText) throw new BadRequestException('剧本为空');
    const style = this.resolveStyle(input.styleId);
    const genre = genreBlock(getGenrePreset(input.genreId));
    const language = detectBoardLanguage(scriptText);
    const buildPrompt = (strict: boolean) =>
      buildBoardsPrompt(scriptText, style, genre, input.targetSeconds, input.catalog, {
        language,
        strictLanguage: strict,
      });

    /**
     * 语言纪律不能靠模型自觉：实测中文剧本拿到了整份英文分镜，
     * 连带让按中文资产名做的人物绑定全部落空。这里做一次带强约束的重试，
     * 仍跑偏就抛错交给调用方降级到中文确定性拆分，绝不让英文内容悄悄落库。
     */
    const runOnce = async (strict: boolean): Promise<BoardsShot[]> => {
      let raw: string;
      try {
        raw = await this.modelGateway.generateText(
          { prompt: buildPrompt(strict), model: input.model, temperature: input.temperature },
          input.providerName,
        );
      } catch (e) {
        throw new BadRequestException(`分镜表技能调用失败：${(e as Error)?.message ?? '未知错误'}`);
      }
      const parsed = this.parseBoardsJson(raw);
      return normalizeBoardsLanguage(parsed, scriptText, language);
    };

    let shots = await runOnce(false);
    let violations = countLanguageViolations(shots, language);
    if (shots.length > 0 && violations.checked > 0 && violations.ratio > 0.35) {
      this.logger.warn(
        `分镜表输出语言不合格（${violations.violating}/${violations.checked} 条非${language === 'zh' ? '中文' : '英文'}），带语言硬约束重试一次`,
      );
      shots = await runOnce(true);
      violations = countLanguageViolations(shots, language);
      if (shots.length > 0 && violations.checked > 0 && violations.ratio > 0.35) {
        throw new BadRequestException(
          `分镜表输出语言与剧本不符（${violations.violating}/${violations.checked} 条文本非${language === 'zh' ? '中文' : '英文'}），已拒绝落库`,
        );
      }
    }
    this.logger.log(
      `分镜表技能完成：${shots.length} 镜，语言=${language}，违规 ${violations.violating}/${violations.checked}`,
    );
    return { skillId: 'script_to_boards', shots };
  }

  /**
   * 存量分镜的中文回填：只把英文画面描述改写成简体中文，不重建镜头、不碰产物与任务。
   * 分镜表技能加了语言锁之后新建的项目不会再产出英文，但已经落库的旧分镜仍需可逆修复。
   * 返回 id → 中文文本；不合格（解析失败 / 仍非中文）的条目不返回，调用方保持原值。
   */
  async localizeTexts(
    items: { id: string; text: string }[],
    scriptText: string,
    providerName?: string,
  ): Promise<Record<string, string>> {
    const language = detectBoardLanguage(scriptText);
    if (language !== 'zh') return {};
    const pending = items.filter(
      (i) => i.text?.trim() && !isBoardTextInLanguage(i.text, 'zh'),
    );
    if (pending.length === 0) return {};

    const out: Record<string, string> = {};
    const BATCH = 10;
    for (let start = 0; start < pending.length; start += BATCH) {
      const batch = pending.slice(start, start + BATCH);
      const prompt =
        `你是短剧分镜的中文改写校对。下面每一条是英文的画面描述，请改写成**简体中文**的分镜描述：\n` +
        `- 保留全部可见细节：人物相对位置、动作、景别、光影、道具编号（PROPxxx）、服装材质；\n` +
        `- 不得新增剧本里没有的情节，不得删减原有细节，不要写成文学抒情；\n` +
        `- 人物一律用下方剧本里的中文名字（如「老者」「皇子」），不要用 the old man / the prince；\n` +
        `- 不要翻译或改写台词；台词不在本任务范围内。\n` +
        `只输出 JSON 数组，格式 [{"id":"原始 id","text":"中文描述"}]，不要输出解释文字。\n\n` +
        `【剧本（用于对齐人名与专有名词）】\n${(scriptText ?? '').slice(0, 4000)}\n\n` +
        `【待改写】\n${JSON.stringify(batch.map((i) => ({ id: i.id, text: i.text })))}`;
      let raw: string;
      try {
        // eslint-disable-next-line no-await-in-loop
        raw = await this.modelGateway.generateText({ prompt, temperature: 0.2 }, providerName);
      } catch (e) {
        this.logger.warn(`中文回填批次 ${start} 调用失败：${(e as Error).message}`);
        continue;
      }
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const from = cleaned.indexOf('[');
      const to = cleaned.lastIndexOf(']');
      if (from < 0 || to <= from) continue;
      try {
        const arr = JSON.parse(cleaned.slice(from, to + 1)) as unknown;
        if (!Array.isArray(arr)) continue;
        for (const row of arr) {
          const r = (row ?? {}) as Record<string, unknown>;
          if (typeof r.id !== 'string' || typeof r.text !== 'string') continue;
          const text = stripBrandTokens(r.text.trim());
          // 只接受确实是中文的结果，避免把「翻译失败」写成另一种英文
          if (text.length > 0 && cjkRatio(text) >= 0.15 && batch.some((i) => i.id === r.id)) {
            out[r.id] = text.slice(0, 1000);
          }
        }
      } catch {
        this.logger.warn(`中文回填批次 ${start} 返回非法 JSON，跳过`);
      }
    }
    this.logger.log(`中文回填：${Object.keys(out).length}/${pending.length} 条`);
    return out;
  }

  private parseBoardsJson(raw: string): BoardsShot[] {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (!Array.isArray(arr)) return [];
      const sizes = new Set(['extreme_close_up', 'close_up', 'medium_close_up', 'medium', 'wide', 'long']);
      const moves = new Set(CAMERA_RIGS.map((r) => r.movement));
      const anchors = new Set(SPACE_ANCHORS);
      const axes = new Set(['left_to_right', 'right_to_left', 'frontal', 'depth']);
      const dirs = new Set([
        'left_to_right',
        'right_to_left',
        'toward_camera',
        'away_from_camera',
        'static',
      ]);
      const intents = new Set(['establish', 'develop', 'turn', 'payoff', 'transition']);
      const pick = (v: unknown, allowed: Set<string>) =>
        typeof v === 'string' && allowed.has(v) ? v : undefined;
      const names = (v: unknown, cap: number) =>
        Array.isArray(v)
          ? v
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim().slice(0, 60))
              .slice(0, cap)
          : undefined;
      return arr.slice(0, 80).flatMap((b) => {
        const r = (b ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 1000) : undefined);
        const dur = Number(r.durationSeconds);
        const beatsRaw = Array.isArray(r.beats) ? r.beats : [];
        const beats = beatsRaw
          .slice(0, 8)
          .flatMap((x) => {
            const o = (x ?? {}) as Record<string, unknown>;
            const from = Number(o.from);
            const to = Number(o.to);
            const description = str(o.description);
            if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !description) return [];
            return [{
              from: Math.max(0, Math.round(from * 10) / 10),
              to: Math.min(60, Math.round(to * 10) / 10),
              description,
              dialogue: str(o.dialogue) || undefined,
            }];
          });
        const segNo = Number(r.segment);
        return [{
          scene: typeof r.scene === 'string' && r.scene.trim() ? r.scene.slice(0, 200) : '未命名场',
          location: str(r.location),
          segment: Number.isFinite(segNo) && segNo > 0 ? Math.round(segNo) : undefined,
          segmentTitle: str(r.segmentTitle),
          intent: pick(r.intent, intents),
          spaceAnchor: pick(r.spaceAnchor, anchors),
          axisDirection: pick(r.axisDirection, axes),
          cast: names(r.cast, 6),
          props: names(r.props, 6),
          shotSize: typeof r.shotSize === 'string' && sizes.has(r.shotSize) ? r.shotSize : 'medium',
          movement: typeof r.movement === 'string' && moves.has(r.movement) ? r.movement : 'static',
          screenDirection: pick(r.screenDirection, dirs),
          durationSeconds: Number.isFinite(dur) ? Math.max(1, Math.min(30, Math.round(dur))) : 8,
          dialogue: str(r.dialogue),
          visualPrompt: str(r.visualPrompt),
          beats: beats.length > 0 ? beats : undefined,
        }];
      });
    } catch {
      return [];
    }
  }

  /** 运镜序列技能：描述 → 机位预设 JSON（直接返回，不进剧本物化链） */
  async runRig(input: {    description: string;
    totalSeconds?: number;
    contentMode?: string;
    providerName?: string;
  }): Promise<RigRunResult> {
    const description = (input.description ?? '').trim();
    if (!description) throw new BadRequestException('运镜描述为空');
    const prompt = buildRigPrompt(description, input.totalSeconds, input.contentMode);
    let raw: string;
    try {
      raw = await this.modelGateway.generateText({ prompt }, input.providerName);
    } catch (e) {
      throw new BadRequestException(`运镜技能调用失败：${(e as Error)?.message ?? '未知错误'}`);
    }
    const beats = this.parseRigJson(raw);
    this.logger.log(`运镜技能完成：${beats.length} 个机位（${beats.map((b) => b.rig).join('→')}）`);
    return { skillId: 'scene_to_rig', beats };
  }

  /** 解析运镜 JSON：校验 rig 合法性、钳制时长与数量，全坏时回落单 static 机位 */
  private parseRigJson(raw: string): RigBeat[] {
    const valid = new Set<string>(CAMERA_RIGS.map((r) => r.id));
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        if (Array.isArray(arr)) {
          const beats = arr.slice(0, 8).flatMap((b) => {
            const r = (b ?? {}) as Record<string, unknown>;
            const rig = typeof r.rig === 'string' ? r.rig : '';
            if (!valid.has(rig)) return [];
            const dur = Number(r.durationSeconds);
            return [{
              rig,
              durationSeconds: Number.isFinite(dur)
                ? Math.max(1, Math.min(30, Math.round(dur)))
                : 4,
              note: typeof r.note === 'string' ? r.note.slice(0, 100) : '',
            }];
          });
          if (beats.length > 0) return beats;
        }
      } catch {
        // 落到回落分支
      }
    }
    return [{ rig: 'static', durationSeconds: 5, note: '解析失败回落：固定机位' }];
  }

  /**
   * 解析 LLM 的 JSON（容忍 ```json 围栏与前后杂文本）。
   * 模型偶发输出损坏 JSON（缺括号/被截断）时，不能用原文直存——
   * 下游启发式物化器按空行切分正文，JSON 原文会切出乱码镜头。
   * 因此先尝试严格解析，再按字段做容错提取，最后才降级原文。
   */
  private parseScriptJson(raw: string): {
    title?: string;
    scenes: { heading: string; summary: string; dialogues: { character: string; text: string }[] }[];
    fallbackRaw?: string;
    degraded?: boolean;
  } {
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
          title?: unknown;
          logline?: unknown;
          scenes?: unknown;
        };
        const scenes = Array.isArray(obj.scenes) ? obj.scenes : [];
        const norm = scenes.slice(0, 12).map((s, i) => {
          const r = (s ?? {}) as Record<string, unknown>;
          const dialogues = Array.isArray(r.dialogues) ? r.dialogues : [];
          return {
            heading: typeof r.heading === 'string' && r.heading ? r.heading : `第 ${i + 1} 场`,
            summary: typeof r.summary === 'string' ? r.summary : '',
            dialogues: dialogues.slice(0, 20).map((d) => {
              const dr = (d ?? {}) as Record<string, unknown>;
              return {
                character: typeof dr.character === 'string' && dr.character ? dr.character : '旁白',
                text: typeof dr.text === 'string' ? dr.text : '',
              };
            }).filter((d) => d.text),
          };
        }).filter((s) => s.dialogues.length > 0 || s.summary);
        if (norm.length > 0) {
          return {
            title: typeof obj.title === 'string' ? obj.title : undefined,
            scenes: norm,
          };
        }
      } catch {
        // 落到容错提取
      }
    }
    const salvaged = this.salvageScenes(cleaned);
    if (salvaged.scenes.length > 0) {
      this.logger.warn(
        `剧本 JSON 不完整，已容错提取 ${salvaged.scenes.length} 场（建议人工审阅）`,
      );
      return { ...salvaged, degraded: true };
    }
    // 降级：原文直存，启发式物化器仍可按空行切分
    return { scenes: [], title: undefined, fallbackRaw: raw.slice(0, 12000), degraded: true };
  }

  /** 损坏 JSON 的容错提取：按 heading 分段，逐段用正则取 summary/dialogues */
  private salvageScenes(raw: string): {
    title?: string;
    scenes: { heading: string; summary: string; dialogues: { character: string; text: string }[] }[];
  } {
    const unescape = (s: string): string => {
      try {
        return JSON.parse(`"${s}"`) as string;
      } catch {
        return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    };
    const titleMatch = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
    const headings: { heading: string; index: number }[] = [];
    const headingRe = /"heading"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    for (let m = headingRe.exec(raw); m; m = headingRe.exec(raw)) {
      headings.push({ heading: unescape(m[1]), index: m.index });
    }
    if (headings.length === 0) return { scenes: [] };
    const scenes = headings.slice(0, 12).map((h, i) => {
      const block = raw.slice(h.index, headings[i + 1]?.index ?? raw.length);
      const summaryMatch = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(block);
      const dialogues: { character: string; text: string }[] = [];
      const dialogueRe =
        /"character"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      for (let d = dialogueRe.exec(block); d; d = dialogueRe.exec(block)) {
        const text = unescape(d[2]);
        if (text) dialogues.push({ character: unescape(d[1]) || '旁白', text });
        if (dialogues.length >= 20) break;
      }
      return {
        heading: h.heading || `第 ${i + 1} 场`,
        summary: summaryMatch ? unescape(summaryMatch[1]) : '',
        dialogues,
      };
    }).filter((s) => s.dialogues.length > 0 || s.summary);
    return {
      title: titleMatch ? unescape(titleMatch[1]) : undefined,
      scenes,
    };
  }

  /** 转为启发式物化器可读的纯文本（标题行 + 角色：台词），保证下游零改造可用 */
  private toReadableScript(parsed: {
    title?: string;
    scenes: { heading: string; summary: string; dialogues: { character: string; text: string }[] }[];
    fallbackRaw?: string;
  }): string {
    if (parsed.scenes.length === 0) {
      return (parsed.fallbackRaw ?? '').trim();
    }
    const lines: string[] = [];
    if (parsed.title) lines.push(`剧名：${parsed.title}`);
    for (const s of parsed.scenes) {
      lines.push('', s.heading);
      if (s.summary) lines.push(s.summary);
      for (const d of s.dialogues) lines.push(`${d.character}：${d.text}`);
    }
    return lines.join('\n').trim();
  }
}
