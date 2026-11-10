import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 全站统一 Switch 开关（受控组件）
 * ─────────────────────────────────────────────
 * 修复旧手写 toggle 的「漂移」问题（红色胶囊与圆钮分离错位）：
 *   · track  w-10 h-[22px] rounded-full —— 关 = --switch-off-bg（白10%）+ 同色描边，
 *     开 = 品牌色（.bg-brand-gradient，方案 F 下为纯色品牌红；浅色主题自动跟随 token）
 *   · knob   18px 白圆钮带阴影，checked 时 translate-x 按几何精确计算（40 - 18 - 2×2 = 20px），
 *     关态 translate-x-[2px]，两端留白对称、永不溢出 track
 *   · 过渡   150ms（颜色 + 位移）
 *
 * 替换原则：真 switch 形态（状态开关）一律用它；按钮形态的 aria-pressed 工具钮
 * （如画布网格吸附 / 小地图）保留按钮样式不替换。
 * 兼容：保留 onCheckedChange（Radix 老签名）供 business-ui SwitchField 使用。
 */

type SwitchSize = 'sm' | 'md'

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  /** 受控回调：传入切换后的新状态 */
  onChange?: (checked: boolean) => void
  /** Radix 兼容签名（与 onChange 等价，同时触发） */
  onCheckedChange?: (checked: boolean) => void
  /** md = 40×22 / knob 18（默认）；sm = 36×20 / knob 14（紧凑行内场景） */
  size?: SwitchSize
}

const TRACK_SIZE: Record<SwitchSize, string> = {
  md: 'h-[22px] w-10',
  sm: 'h-5 w-9',
}

const KNOB_SIZE: Record<SwitchSize, string> = {
  md: 'h-[18px] w-[18px]',
  sm: 'h-3.5 w-3.5',
}

/** knob 纵向居中偏移：(trackH - knobH) / 2 */
const KNOB_TOP: Record<SwitchSize, string> = {
  md: 'top-[2px]',
  sm: 'top-[3px]',
}

/** knob 横向位移：off = 2px 内缩；on = trackW - knobW - 2px，精确贴边不溢出 */
const KNOB_X: Record<SwitchSize, { on: string; off: string }> = {
  md: { on: 'translate-x-[20px]', off: 'translate-x-[2px]' },
  sm: { on: 'translate-x-[20px]', off: 'translate-x-[2px]' },
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked,
      onChange,
      onCheckedChange,
      size = 'md',
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e)
      if (disabled) return
      const next = !checked
      onChange?.(next)
      onCheckedChange?.(next)
    }

    return (
      <button
        type="button"
        ref={ref}
        role="switch"
        aria-checked={checked}
        data-state={checked ? 'checked' : 'unchecked'}
        data-slot="switch"
        data-size={size}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          'relative inline-flex shrink-0 cursor-pointer rounded-full border transition-colors duration-150',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          TRACK_SIZE[size],
          checked
            ? 'border-transparent bg-brand-gradient'
            : 'border-[var(--switch-off-border)] bg-[var(--switch-off-bg)]',
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none absolute left-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
            'transition-transform duration-150 ease-out',
            KNOB_SIZE[size],
            KNOB_TOP[size],
            checked ? KNOB_X[size].on : KNOB_X[size].off,
          )}
        />
      </button>
    )
  },
)

export { Switch }
