/**
 * 人物形象包 · 「1 张主图 + 四视图」的标准展示与逐格补齐
 * -------------------------------------------------------------
 * 依据 AI 短剧/漫剧流水线的行业规范：
 *   主图 = 3/4 正脸特写（面部唯一真相），四视图 = 正 / 3-4 / 侧 / 背，
 *   全部独立成图、可单独替换，而不是一张拼图糊过去。
 * 只有 5 格齐全，人物才算「完成定义」，门控与首帧注入才认为可用。
 */
import { ImagePlus, Plus } from 'lucide-react';
import type { Character, CharacterViewKey } from '@shared/api.interface';
import {
  CHARACTER_VIEW_KEYS,
  CHARACTER_VIEW_LABELS,
  emptyIdentityKit,
  isCharacterFullyDefined,
} from '@shared/api.interface';

export type KitViewKey = 'portrait' | CharacterViewKey;

interface CharacterKitStripProps {
  char: Character;
  /** 点击空格：父组件触发对应槽位的上传 */
  onPick: (view: KitViewKey) => void;
  onPreview: (url: string, title: string) => void;
}

export const CharacterKitStrip = ({ char, onPick, onPreview }: CharacterKitStripProps) => {
  const kit = char.identityKit ?? emptyIdentityKit();
  const cells: { key: KitViewKey; label: string; url?: string; main: boolean }[] = [
    { key: 'portrait', label: '主图 · 正脸特写', url: kit.portraitUrl, main: true },
    ...CHARACTER_VIEW_KEYS.map((k) => ({
      key: k as KitViewKey,
      label: CHARACTER_VIEW_LABELS[k],
      url: kit.views?.[k],
      main: false,
    })),
  ];
  const done = cells.filter((c) => !!c.url).length;
  const complete = isCharacterFullyDefined(char);

  return (
    <div className="ck-strip">
      <div className="ck-head">
        <span className="ck-title"><ImagePlus size={12} /> 形象包</span>
        <span className={`ck-count${complete ? ' ok' : ''}`}>{done}/5</span>
        <span className="ck-hint">{complete ? '已完成定义' : '主图 + 四视图'}</span>
      </div>
      <div className="ck-cells">
        {cells.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`ck-cell${c.main ? ' main' : ''}${c.url ? ' ok' : ''}`}
            title={c.url ? `${char.name} · ${c.label}：点击预览` : `${char.name} · ${c.label}：点击上传或生成`}
            onClick={() => (c.url ? onPreview(c.url, `${char.name} · ${c.label}`) : onPick(c.key))}
          >
            {c.url ? (
              <img src={c.url} alt={c.label} loading="lazy" />
            ) : (
              <span className="ck-ph"><Plus size={14} /></span>
            )}
            <i>{c.label}</i>
            {!c.url ? <em>待补</em> : null}
          </button>
        ))}
      </div>
      {kit.sheetUrl ? (
        <button
          type="button"
          className="ck-sheet"
          onClick={() => onPreview(kit.sheetUrl!, `${char.name} · 四视图拼图（旧版）`)}
        >
          旧版四视图拼图已登记 · 点击预览（拼图不替代 4 张独立视图）
        </button>
      ) : null}
    </div>
  );
};

export default CharacterKitStrip;
