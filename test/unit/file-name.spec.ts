/**
 * 导出文件名规范化回归测试。
 * 需求：「项目叫什么，导出的文件就叫什么」。
 * 这里锁住：中文与全角标点必须保留、路径分隔符不能存活、非法字符不能进文件名、
 * 超长要裁、空标题要兜底 —— 任何一条失守都会让导出失败或下载名不可读。
 */
import { sanitizeFileBase, projectExportFileName } from '@shared/file-name';

describe('sanitizeFileBase', () => {
  it('保留中文、空格与全角标点（项目名原样可读）', () => {
    expect(sanitizeFileBase('唐朝甜宠番外二：李昭把琉璃灯挂在窗前')).toBe(
      '唐朝甜宠番外二：李昭把琉璃灯挂在窗前',
    );
    expect(sanitizeFileBase('Raining Night 末班车')).toBe('Raining Night 末班车');
  });

  it('半角冒号换成全角，不把词粘在一起也不留非法字符', () => {
    expect(sanitizeFileBase('唐朝甜宠:琉璃灯')).toBe('唐朝甜宠：琉璃灯');
  });

  it('路径分隔符替换成短横，不会写进子目录', () => {
    expect(sanitizeFileBase('a/b\\c')).toBe('a-b-c');
  });

  it('去掉跨平台非法字符与控制字符', () => {
    expect(sanitizeFileBase('a*b?c"d<e>f|g%h#i')).toBe('abcdefghi');
    expect(sanitizeFileBase('a\u0000b\u001fc\nd')).toBe('abc d');
  });

  it('压缩连续空白并去掉首尾空格与点', () => {
    expect(sanitizeFileBase('  ..标题  多空格..  ')).toBe('标题 多空格');
  });

  it('超长标题按码点截断（中文不会被截半个字符）', () => {
    const long = '唐'.repeat(120);
    const out = sanitizeFileBase(long, 'fb', 60);
    expect(Array.from(out)).toHaveLength(60);
  });

  it('空标题回落到兜底名，Windows 保留名加后缀', () => {
    expect(sanitizeFileBase('')).toBe('yimu-export');
    expect(sanitizeFileBase('...')).toBe('yimu-export');
    expect(sanitizeFileBase('CON')).toBe('CON-export');
    expect(sanitizeFileBase(null, 'project-1234')).toBe('project-1234');
  });
});

describe('projectExportFileName', () => {
  it('文件名 = 项目名 + .mp4，不再出现 final_<uuid>', () => {
    const name = projectExportFileName('唐朝甜宠番外二：琉璃灯');
    expect(name).toBe('唐朝甜宠番外二：琉璃灯.mp4');
    expect(name).not.toMatch(/^final_/);
  });

  it('扩展名可覆盖且不会出现双点', () => {
    expect(projectExportFileName('雨夜末班', '.srt')).toBe('雨夜末班.srt');
  });

  it('空标题用兜底名，保证始终有可下载的文件名', () => {
    expect(projectExportFileName('', 'mp4', 'project-abcdef12')).toBe('project-abcdef12.mp4');
  });
});
