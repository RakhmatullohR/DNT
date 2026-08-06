// Bo'sh holat (PLAN §8, M5). Ro'yxat bo'sh bo'lganda ekran jimgina bo'sh qolmasin —
// nima yo'qligi va keyin nima qilish kerakligi aytilsin.
//
// API ataylab sodda: boshqa ekranlar ham shu komponentni ishlatadi.

import type { ReactNode } from 'react'

export type EmptyStateProps = {
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    // `rounded-panel` — bu karta ro'yxatdagi dars kartasi bilan BIR XIL
    // slotni egallaydi (Home.tsx darslar bo'sh bo'lganda shu yerga tushadi),
    // shuning uchun radiusi ham panel tokeniga bog'langan — index.css dagi
    // `--radius-panel` ga qarang.
    <div className="rounded-panel border border-dashed border-border bg-panel px-6 py-14 text-center">
      {/* Kichik yorliq — bo'shlik "xato" emas, kutilgan holat ekanini bildiradi. */}
      <span
        aria-hidden="true"
        className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-muted"
      >
        bo&apos;sh
      </span>

      <h2 className="mt-4 font-mono text-[16px] font-medium text-text">
        {title}
      </h2>

      {hint ? (
        <p className="mx-auto mt-2 max-w-sm font-mono text-[13px] leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}

      {action ? <div className="mt-6 flex justify-center gap-3">{action}</div> : null}
    </div>
  )
}
