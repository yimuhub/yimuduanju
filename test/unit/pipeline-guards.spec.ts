/**
 * 通用流程守门规则的回归测试（不依赖数据库，纯函数）。
 * 覆盖的四条铁律，是「所有项目」共用的判定，不是某个项目的补丁：
 *  1. 完成态只认 M/N（computePipelineReadiness）
 *  2. 产物形态必须与字段一致（video 字段不能落图片）
 *  3. 分镜语言必须与剧本一致（英文分镜会让中文资产绑定落空）
 *  4. 时长预算只砍余量，绝不砍台词
 */
import { computePipelineReadiness } from '@shared/pipeline-readiness';
import { checkArtifact, classifyArtifactUrl } from '@shared/artifact-kind';
import {
  countLanguageViolations,
  detectBoardLanguage,
  isBoardTextInLanguage,
  normalizeBoardsLanguage,
  stripBrandTokens,
} from '@shared/boards-language';
import { fitTotalBudget } from '@shared/shot-duration';

const shot = (over: Partial<Parameters<typeof computePipelineReadiness>[0][number]> = {}) => ({
  id: `s-${Math.random().toString(36).slice(2)}`,
  startFrameUrl: '/uploads/a.png',
  videoUrl: '/uploads/a.mp4',
  dialogue: '',
  voiceUrl: null,
  status: 'ready',
  ...over,
});

describe('完成态：M/N 是唯一口径', () => {
  it('没有镜头时不算完成（空集合不能当全齐）', () => {
    const r = computePipelineReadiness([]);
    expect(r.total).toBe(0);
    expect(r.videoComplete).toBe(false);
    expect(r.fullyComplete).toBe(false);
  });

  it('7 镜只出 1 片 → 未完成，进度如实为 14%', () => {
    const shots = [
      shot({ videoUrl: '/uploads/1.mp4' }),
      ...Array.from({ length: 6 }, () => shot({ videoUrl: null })),
    ];
    const r = computePipelineReadiness(shots);
    expect(r.videoComplete).toBe(false);
    expect(r.withVideo).toBe(1);
    expect(r.missingVideos).toHaveLength(6);
    expect(r.videoPercent).toBe(14);
  });

  it('7 镜全齐才算完成；有失败镜头时仍不算 fullyComplete', () => {
    const ok = computePipelineReadiness(Array.from({ length: 7 }, () => shot()));
    expect(ok.videoComplete).toBe(true);
    expect(ok.videoPercent).toBe(100);
    expect(ok.fullyComplete).toBe(true);

    const withFailed = computePipelineReadiness([
      ...Array.from({ length: 6 }, () => shot()),
      shot({ status: 'failed' }),
    ]);
    expect(withFailed.videoComplete).toBe(true);
    expect(withFailed.failedShots).toBe(1);
    expect(withFailed.fullyComplete).toBe(false);
  });

  it('有对白就必须有配音才算 fullyComplete', () => {
    const r = computePipelineReadiness([shot({ dialogue: '走', voiceUrl: null })]);
    expect(r.needVoice).toBe(1);
    expect(r.voiceComplete).toBe(false);
    expect(r.fullyComplete).toBe(false);
  });
});

describe('产物形态：视频字段不能落图片', () => {
  it('识别常见形态', () => {
    expect(classifyArtifactUrl('https://cdn/x/videos/a.mp4?sign=1')).toBe('video');
    expect(classifyArtifactUrl('https://cdn/x/images/t2i/task_1.png')).toBe('image');
    expect(classifyArtifactUrl('/uploads/a.webp')).toBe('image');
    expect(classifyArtifactUrl('/uploads/a.mp3')).toBe('audio');
    expect(classifyArtifactUrl('data:video/mp4;base64,AAA')).toBe('video');
    expect(classifyArtifactUrl('https://cdn/dl/task_abc')).toBe('unknown');
  });

  it('图片地址写进 videoUrl 必须被拒绝（实测事故形态）', () => {
    const bad = checkArtifact(
      'https://cos-platform-outputs.agnes-ai.cn/images/t2i/task_uOj1/o.png',
      'video',
    );
    expect(bad.ok).toBe(false);
    expect(bad.kind).toBe('image');
    expect(bad.reason).toContain('拒绝写入');
  });

  it('无扩展名的签名链接放行但给提示', () => {
    const r = checkArtifact('https://cdn.example.com/download/task_abc123', 'video');
    expect(r.ok).toBe(true);
    expect(r.warning).toBeTruthy();
  });
});

describe('语言纪律：分镜必须与剧本同语言', () => {
  const script = ['第1场 夜 内 宫殿', '老者：这把剑认主。', '皇子：我不信。'].join('\n');

  it('中文剧本判定为 zh', () => {
    expect(detectBoardLanguage(script)).toBe('zh');
    expect(detectBoardLanguage('EXT. CASTLE - NIGHT\nOLD MAN: The sword knows its master.')).toBe(
      'en',
    );
  });

  it('整份英文分镜的违规率会触发重试阈值', () => {
    const shots = [
      { visualPrompt: 'The old man holds a broken sword in the rain, wide shot' },
      { visualPrompt: 'The prince steps back, close up on his eyes' },
      { visualPrompt: '老者站在雨中，手中握着一把断剑' },
    ];
    const v = countLanguageViolations(shots, 'zh');
    expect(v.checked).toBe(3);
    expect(v.violating).toBe(2);
    expect(v.ratio).toBeGreaterThan(0.35);
  });

  it('被翻译成英文的台词会按剧本原文还原，编造的台词不落库', () => {
    const [fixed, invented] = normalizeBoardsLanguage(
      [
        { visualPrompt: '老者举剑', dialogue: 'This sword knows its master.' },
        { visualPrompt: '皇子后退', dialogue: 'I will never believe such nonsense today.' },
      ],
      script,
      'zh',
    );
    expect(isBoardTextInLanguage(fixed.dialogue ?? '', 'zh')).toBe(true);
    expect(script).toContain(fixed.dialogue);
    // 模型编造/翻译的台词：要么按剧本顺序回溯成原文，要么留空；
    // 绝不允许把英文原样落库（这就是「对白也是英文」的直接成因）
    expect(
      invented.dialogue === undefined || script.includes(invented.dialogue),
    ).toBe(true);
    expect(isBoardTextInLanguage(invented.dialogue ?? '', 'zh')).toBe(true);
  });

  it('品牌/字体词必须清掉（实测「袍服上 Verdana 字样刺绣」）', () => {
    expect(stripBrandTokens('袍服上 Verdana 字样刺绣')).toBe('袍服上字样刺绣');
    expect(stripBrandTokens('Nike 的鞋')).not.toContain('Nike');
  });
});

describe('时长预算：只砍余量不砍台词', () => {
  it('超出目标时按余量回收，且不低于最小可读时长', () => {
    const wants = [8, 8, 8];
    const mins = [4, 5, 6];
    const r = fitTotalBudget(wants, mins, 18);
    r.seconds.forEach((s, i) => expect(s).toBeGreaterThanOrEqual(mins[i]));
    expect(r.total).toBeLessThanOrEqual(24);
  });

  it('余量砍光仍超时如实报 overflow，不静默截断', () => {
    const r = fitTotalBudget([6, 6], [6, 6], 8);
    expect(r.seconds).toEqual([6, 6]);
    expect(r.overflow).toBe(4);
  });
});
