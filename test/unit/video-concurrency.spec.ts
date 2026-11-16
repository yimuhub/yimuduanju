/**
 * 视频并发上限的运行时伸缩回归测试。
 * 事故背景：video 道写死 2，用户配了 4 把 Key、界面 4 条车道全绿，
 * 实际同时只有 2 单在跑，另外 2 把 Key 永远闲置。
 * worker 现在按「实际可用车道数」在运行时写这个上限，这里锁住写入/裁剪/复位语义。
 */
import { GenerationService } from '@server/modules/generation/generation.service';

describe('GenerationService 并发上限运行时覆盖', () => {
  afterEach(() => {
    GenerationService.setTypeCap('video', null);
  });

  it('默认回落到静态基线（环境变量或 2）', () => {
    GenerationService.setTypeCap('video', null);
    expect(GenerationService.typeCap('video')).toBe(GenerationService.TYPE_CONCURRENCY.video);
  });

  it('4 把 Key → 上限 4，认领逻辑能读到新值', () => {
    GenerationService.setTypeCap('video', 4);
    expect(GenerationService.typeCap('video')).toBe(4);
    expect(GenerationService.allTypeCaps().video).toBe(4);
  });

  it('上限被裁剪到 1..32，不会因脏值把队列打爆', () => {
    GenerationService.setTypeCap('video', 0);
    expect(GenerationService.typeCap('video')).toBe(1);
    GenerationService.setTypeCap('video', 999);
    expect(GenerationService.typeCap('video')).toBe(32);
    GenerationService.setTypeCap('video', 6.9);
    expect(GenerationService.typeCap('video')).toBe(6);
  });

  it('复位后回到基线，其他类型不受影响', () => {
    const imageBaseline = GenerationService.typeCap('image');
    GenerationService.setTypeCap('video', 5);
    GenerationService.setTypeCap('video', null);
    expect(GenerationService.typeCap('video')).toBe(GenerationService.TYPE_CONCURRENCY.video);
    expect(GenerationService.typeCap('image')).toBe(imageBaseline);
  });
});
