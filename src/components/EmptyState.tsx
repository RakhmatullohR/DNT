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
    <div className="rounded-sm border border-dashed border-[#1e2a36] bg-[#0d131a] px-6 py-14 text-center">
      {/* Kichik yorliq — bo'shlik "xato" emas, kutilgan holat ekanini bildiradi. */}
      <span
        aria-hidden="true"
        className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8fa1]"
      >
        bo&apos;sh
      </span>

      <h2 className="mt-4 font-mono text-[16px] font-medium text-[#e6edf3]">
        {title}
      </h2>

      {hint ? (
        <p className="mx-auto mt-2 max-w-sm font-mono text-[13px] leading-relaxed text-[#7d8fa1]">
          {hint}
        </p>
      ) : null}

      {action ? <div className="mt-6 flex justify-center gap-3">{action}</div> : null}
    </div>
  )
}
