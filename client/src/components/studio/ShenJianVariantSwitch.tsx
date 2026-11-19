/** 顶栏版本开关：经典版 ↔ 同构版。两套工作台共用同一份 EDL 与同一套接口。 */
import { setShenJianVariant, useShenJianVariant } from '@client/src/lib/shenjian-variant';

export const ShenJianVariantSwitch = ({ compact = false }: { compact?: boolean }) => {
  const variant = useShenJianVariant();
  return (
    <div className={`seg variant-switch${compact ? ' compact' : ''}`} title="切换界面版本，工程与时间线数据不变">
      <button
        type="button"
        className={variant === 'classic' ? 'on' : ''}
        onClick={() => setShenJianVariant('classic')}
      >
        经典
      </button>
      <button
        type="button"
        className={variant === 'parity' ? 'on' : ''}
        onClick={() => setShenJianVariant('parity')}
      >
        同构
      </button>
    </div>
  );
};

export default ShenJianVariantSwitch;
