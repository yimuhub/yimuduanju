/**
 * 全站排队 + 产物画幅校验回归测试（V8）
 * ------------------------------------------------------------------
 * 用户诉求：
 * ① 默认按提交顺序排队（queue_seq 唯一排序键，不再由三套互相矛盾的排序决定）
 * ② 暂停 / 终止前面的任务后，后面的任务自动补位
 * ③ 可以调整排队顺序（含按项目轮转的一键公平化）
 * ④ 承接上一轮：产物回来后要真的核对像素比例，不能又变回 1:1 方图
 */
import {
  QUEUE_CLAIM_STATUS,
  QUEUE_MOVE_DIRECTIONS,
  QUEUE_NOT_STARTED_STATUSES,
  QUEUE_OPEN_STATUSES,
  compareQueueSeq,
  isQueueMovable,
  isQueueOpen,
  roundRobinByProject,
  selectNextClaim,
} from '@shared/queue-order';
import {
  ASPECT_TOLERANCE,
  compareImageAspect,
  parseImageSize,
} from '@shared/image-dimensions';

// ---------- 构造最小图片文件头（只含尺寸信息，不含像素数据） ----------
const pngHeader = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const jpegHeader = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(32);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  b[2] = 0xff;
  b[3] = 0xc0; // SOF0
  b.writeUInt16BE(17, 4);
  b[6] = 8; // precision
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
};

const webpVp8xHeader = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  const wm1 = w - 1;
  const hm1 = h - 1;
  b[24] = wm1 & 0xff;
  b[25] = (wm1 >> 8) & 0xff;
  b[26] = (wm1 >> 16) & 0xff;
  b[27] = hm1 & 0xff;
  b[28] = (hm1 >> 8) & 0xff;
  b[29] = (hm1 >> 16) & 0xff;
  return b;
};

const gifHeader = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(10);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};

describe('排队状态口径', () => {
  test('排队页可见状态含 paused，不含终态', () => {
    expect(QUEUE_OPEN_STATUSES).toContain('paused');
    expect(QUEUE_OPEN_STATUSES).not.toContain('succeeded');
    expect(QUEUE_OPEN_STATUSES).not.toContain('cancelled');
    expect(isQueueOpen('paused')).toBe(true);
    expect(isQueueOpen('failed')).toBe(false);
  });

  test('只有还没开跑的任务能暂停 / 调序，running 只能终止', () => {
    expect(QUEUE_NOT_STARTED_STATUSES).toEqual(['pending', 'queued', 'retrying']);
    expect(isQueueMovable('pending')).toBe(true);
    expect(isQueueMovable('paused')).toBe(false);
    expect(isQueueMovable('running')).toBe(false);
  });

  test('消费器唯一认领 pending；调序方向四种齐全', () => {
    expect(QUEUE_CLAIM_STATUS).toBe('pending');
    expect(QUEUE_MOVE_DIRECTIONS).toEqual(['up', 'down', 'top', 'bottom']);
  });
});

describe('默认按提交顺序 + 暂停/终止后自动补位', () => {
  const line = (queueSeq: number, status: string, blockedReason?: string) => ({
    id: `j${queueSeq}`,
    queueSeq,
    status,
    ...(blockedReason ? { blockedReason } : {}),
  });

  test('queue_seq 升序就是认领顺序', () => {
    const ordered = [line(3, 'pending'), line(1, 'pending'), line(2, 'pending')];
    ordered.sort(compareQueueSeq);
    expect(ordered.map((j) => j.queueSeq)).toEqual([1, 2, 3]);
    expect(selectNextClaim(ordered)?.id).toBe('j1');
  });

  test('置顶写入比全表最小值更小的号时，仍严格排在最前', () => {
    // 置顶走「全表 min - 1」，连续置顶会产出 0 / -1 / -2 等号码，
    // 排序必须仍然是数值升序，不能把负号当成无效值或排到队尾。
    const ordered = [line(2, 'pending'), line(-2, 'pending'), line(0, 'pending')];
    ordered.sort(compareQueueSeq);
    expect(ordered.map((j) => j.queueSeq)).toEqual([-2, 0, 2]);
    expect(selectNextClaim(ordered)?.id).toBe('j-2');
  });

  test('暂停队首后，第二个任务自动补位', () => {
    const before = [line(1, 'pending'), line(2, 'pending'), line(3, 'pending')];
    expect(selectNextClaim(before)?.id).toBe('j1');
    const after = [{ ...before[0], status: 'paused' }, before[1], before[2]];
    expect(selectNextClaim(after)?.id).toBe('j2');
  });

  test('终止队首后，第二个任务自动补位；全部暂停则无任务可认领', () => {
    const cancelled = [
      { ...line(1, 'cancelled') },
      line(2, 'pending'),
      line(3, 'pending'),
    ];
    expect(selectNextClaim(cancelled)?.id).toBe('j2');
    expect(selectNextClaim([line(1, 'paused'), line(2, 'paused')])).toBeNull();
  });

  test('依赖阻断的任务不占队首，后面的可认领任务照常执行', () => {
    const ordered = [
      line(1, 'pending', 'waiting_first_frame'),
      line(2, 'pending', 'waiting_assets'),
      line(3, 'pending'),
    ];
    expect(selectNextClaim(ordered)?.id).toBe('j3');
  });
});

describe('按项目轮转重排（可选的一键公平化）', () => {
  const job = (id: string, projectId: string | null) => ({ id, projectId });

  test('一个项目批量任务不再整体挡住其它项目', () => {
    const ordered = [
      job('a1', 'A'),
      job('a2', 'A'),
      job('a3', 'A'),
      job('b1', 'B'),
      job('c1', 'C'),
    ];
    expect(roundRobinByProject(ordered).map((j) => j.id)).toEqual([
      'a1', 'b1', 'c1', 'a2', 'a3',
    ]);
  });

  test('桶内严格保持原提交顺序，桶序按首次出现位置', () => {
    const ordered = [
      job('b1', 'B'),
      job('a1', 'A'),
      job('b2', 'B'),
      job('a2', 'A'),
      job('a3', 'A'),
    ];
    expect(roundRobinByProject(ordered).map((j) => j.id)).toEqual([
      'b1', 'a1', 'b2', 'a2', 'a3',
    ]);
  });

  test('单项目 / 空队列原样返回，不无故打乱镜序', () => {
    const single = [job('a1', 'A'), job('a2', 'A')];
    expect(roundRobinByProject(single)).toEqual(single);
    expect(roundRobinByProject([])).toEqual([]);
  });

  test('无项目归属的任务归到同一个桶', () => {
    const ordered = [job('n1', null), job('a1', 'A'), job('n2', null)];
    expect(roundRobinByProject(ordered).map((j) => j.id)).toEqual(['n1', 'a1', 'n2']);
  });
});

describe('产物真实尺寸解析', () => {
  test('PNG / JPEG / WebP / GIF 都能从文件头读到宽高', () => {
    expect(parseImageSize(pngHeader(720, 1280))).toEqual({ width: 720, height: 1280 });
    expect(parseImageSize(jpegHeader(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(parseImageSize(webpVp8xHeader(720, 1280))).toEqual({ width: 720, height: 1280 });
    expect(parseImageSize(gifHeader(1024, 1024))).toEqual({ width: 1024, height: 1024 });
  });

  test('无法识别 / 截断的头部返回 null（不阻断出片）', () => {
    expect(parseImageSize(Buffer.alloc(4))).toBeNull();
    expect(parseImageSize(Buffer.from('not an image at all'))).toBeNull();
    expect(parseImageSize(pngHeader(720, 1280).subarray(0, 20))).toBeNull();
  });
});

describe('产物画幅与项目设定比对', () => {
  test('9:16 项目拿到 720x1280 / 16:9 项目拿到 1280x720 都通过', () => {
    expect(compareImageAspect('9:16', 720, 1280).ok).toBe(true);
    expect(compareImageAspect('16:9', 1280, 720).ok).toBe(true);
  });

  test('供应商无视参数返回 1:1 方图会被明确识别出来', () => {
    const check = compareImageAspect('9:16', 1024, 1024);
    expect(check.ok).toBe(false);
    expect(check.squareMismatch).toBe(true);
    expect(check.reason).toContain('1:1 方图');
    expect(check.reason).toContain('size / aspect_ratio');
  });

  test('1:1 项目拿到方图不算错', () => {
    expect(compareImageAspect('1:1', 1024, 1024).ok).toBe(true);
  });

  test('容差内放行、容差外拒绝；非法画幅不误判', () => {
    expect(ASPECT_TOLERANCE).toBe(0.06);
    expect(compareImageAspect('9:16', 720, 1250).ok).toBe(true); // 偏差约 2.4%
    expect(compareImageAspect('9:16', 720, 720).ok).toBe(false);
    expect(compareImageAspect('not-a-ratio', 720, 1280).ok).toBe(true);
  });
});
