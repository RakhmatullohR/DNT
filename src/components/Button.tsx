// Butun ilova uchun yagona tugma. Boshqa ekranlar ham shuni ishlatadi,
// shuning uchun API ataylab kichik: `variant` + `size` + oddiy <button> atributlari.
//
// Uslub qarori: interfeys butunlay monospace (PLAN — yozuv mashqi ilovasi).
// Shrift almashtirish orqali emas, og'irlik, o'lcham va harflar oralig'i orqali
// ierarxiya quriladi. Burchaklar deyarli o'tkir (4px) — asbob paneli hissi.

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

/** Barcha variantlar uchun umumiy asos: fokus halqasi, bosish javobi, o'chirilgan holat. */
const BASE = [
  'inline-flex items-center justify-center gap-2 rounded-sm',
  'font-mono font-medium tracking-[0.04em] whitespace-nowrap select-none',
  'border transition-colors duration-150 ease-out',
  'active:translate-y-px',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1]',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0',
].join(' ')

const VARIANTS: Record<ButtonVariant, string> = {
  // Asosiy harakat — yagona to'ldirilgan yuza. Sahifada bittadan ortiq bo'lmasligi kerak.
  primary: [
    'border-transparent bg-[#5ee6c1] text-[#04231c]',
    'hover:bg-[#7cf0d3] disabled:hover:bg-[#5ee6c1]',
  ].join(' '),
  // Ikkilamchi harakat — faqat ingichka chegara, fon deyarli sezilmaydi.
  ghost: [
    'border-[#22303d] bg-transparent text-[#c6d3de]',
    'hover:border-[#334556] hover:bg-[#131b23] hover:text-[#e6edf3]',
    'disabled:hover:border-[#22303d] disabled:hover:bg-transparent',
  ].join(' '),
  // Buzuvchi harakat — qizil faqat chegarada, to'ldirilgan qizil tugma juda baland ovozli.
  danger: [
    'border-[#452027] bg-transparent text-[#ff7b7b]',
    'hover:border-[#ff7b7b] hover:bg-[#1e1215]',
    'disabled:hover:border-[#452027] disabled:hover:bg-transparent',
  ].join(' '),
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-10 px-4 text-[13px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type,
  children,
  ...rest
}: ButtonProps) {
  // `type` ataylab default `button`: form ichida qolib ketgan tugma
  // kutilmaganda submit qilib, sahifani qayta yuklamasligi uchun.
  const classes = [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ')

  return (
    <button type={type ?? 'button'} className={classes} {...rest}>
      {children}
    </button>
  )
}
