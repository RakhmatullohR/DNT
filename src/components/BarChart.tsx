// BarChart — qo'lda yozilgan inline SVG ustunli grafik.
// PLAN §6: chart kutubxonasi YO'Q, grafiklar qo'lda yoziladi.
//
// MOSLASHUVCHANLIK QARORI (nozik joy):
// Ustunlar `viewBox="0 0 100 40"` ichida, `preserveAspectRatio="none"` bilan
// chiziladi — ya'ni grafik konteyner eniga to'liq cho'ziladi, balandligi esa
// CSS bilan qat'iy. Yorliqlar ATAYIN SVG `<text>` emas, HTML: notekis masshtabda
// SVG matni telefonda 5 px ga tushib, keng ekranda 20 px ga shishib ketardi.
// HTML yorliq esa har qanday enda bir xil o'lchamda qoladi.
//
// Ustun burchaklari yumaloqlanmagan (`rx` yo'q): notekis masshtabda `rx`
// ellipsga aylanib, chap va o'ng burchaklar har xil ko'rinardi.

import { useEffect, useState } from 'react'

export type BarChartDatum = { label: string; value: number }

export type BarChartProps = {
  data: BarChartDatum[]
  /** Shkalaning yuqori chegarasi. Berilmasa — ma'lumotdagi eng katta qiymat. */
  max?: number
  /**
   * Ekran o'quvchi uchun grafik nomi (`Sparkline.tsx` dagi naqsh bilan bir xil).
   * Bir sahifada bir nechta `BarChart` bo'lsa, shu bo'lmasa hammasi bir xil
   * umumiy matn bilan eshitiladi — qaysi biri nima ekanini bilib bo'lmaydi.
   */
  label?: string
}

const BAR = '#5ee6c1'

/** Ichki koordinata tizimi: eni doim 100 (foizga teng), balandligi 40. */
const VIEW_W = 100
const VIEW_H = 40

/** Ustunlar soni shundan oshsa har biriga yorliq sig'maydi — faqat uchtasi yoziladi. */
const DENSE_LABEL_LIMIT = 8

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100
}

export function BarChart({ data, max, label }: BarChartProps) {
  const [drawn, setDrawn] = useState(false)
  const [motionMs, setMotionMs] = useState(650)

  useEffect(() => {
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      // Brauzer `matchMedia` ni qo'llab-quvvatlamasa — odatiy animatsiya.
    }
    if (reduced) {
      setMotionMs(0)
      setDrawn(true)
      return
    }
    // Birinchi kadrdan keyin yoqiladi, aks holda o'tish (transition) o'tkazib yuboriladi.
    const frame = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const rows = data.map((item) => ({
    label: typeof item.label === 'string' ? item.label : '',
    value: Number.isFinite(item.value) && item.value > 0 ? item.value : 0,
  }))
  const n = rows.length

  let peak = 0
  for (const row of rows) {
    if (row.value > peak) peak = row.value
  }
  const requested = max !== undefined && Number.isFinite(max) && max > 0 ? max : peak
  // Nolga bo'linishdan himoya: hamma qiymat nol bo'lsa shkala 1 ga tenglashadi,
  // ustunlar nol balandlikda qoladi, bazis chizig'i esa joyida ko'rinadi.
  const scale = requested > 0 ? requested : 1

  const slot = n > 0 ? VIEW_W / n : VIEW_W
  const gap = n > 0 ? Math.min(1.4, Math.max(0.12, slot * 0.24)) : 0
  const barW = Math.max(0.35, slot - gap)

  // Zich grafikda (30 kun -> ustuniga ~3%) faqat uchta yorliq qoladi:
  // birinchi, o'rtadagi va oxirgi.
  const dense = n > DENSE_LABEL_LIMIT
  const sparseLabels = dense
    ? [rows[0]?.label ?? '', rows[Math.floor((n - 1) / 2)]?.label ?? '', rows[n - 1]?.label ?? '']
    : []

  const hasLabel = label !== undefined && label !== ''
  const summary =
    n === 0
      ? hasLabel
        ? `${label}: ma'lumot yo'q`
        : "Ustunli grafik: ma'lumot yo'q"
      : hasLabel
        ? `${label}: ${n} ta ustun, eng yuqori qiymat ${Math.round(peak)}`
        : `Ustunli grafik: ${n} ta ustun, eng yuqori qiymat ${Math.round(peak)}`

  return (
    <div className="w-full">
      <div className="relative h-28 w-full sm:h-32">
        <svg
          className="block h-full w-full"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
        >
          <line
            x1={0}
            y1={VIEW_H * 0.5}
            x2={VIEW_W}
            y2={VIEW_H * 0.5}
            stroke="rgba(230, 237, 243, 0.06)"
            strokeWidth={1}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />

          {rows.map((row, index) => {
            const ratio = Math.min(1, row.value / scale)
            const barH = roundTo2(ratio * VIEW_H)
            const x = roundTo2(index * slot + gap / 2)
            // Qiymat qanchalik katta bo'lsa, ustun shunchalik yorqin —
            // shkala o'qisiz ham balandliklar nisbati ko'zga tashlanadi.
            const opacity = row.value > 0 ? 0.4 + 0.6 * ratio : 0
            const delay = Math.min(320, index * 14)
            return (
              <rect
                key={`bar-${index}`}
                x={x}
                width={roundTo2(barW)}
                y={drawn ? roundTo2(VIEW_H - barH) : VIEW_H}
                height={drawn ? barH : 0}
                fill={BAR}
                opacity={opacity}
                style={{
                  transition:
                    motionMs === 0
                      ? undefined
                      : `y ${motionMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, height ${motionMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
                }}
              />
            )
          })}

          <line
            x1={0}
            y1={VIEW_H}
            x2={VIEW_W}
            y2={VIEW_H}
            stroke="rgba(230, 237, 243, 0.14)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {n === 0 ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]">
            ma&apos;lumot yo&apos;q
          </span>
        ) : null}
      </div>

      {n > 0 && dense ? (
        <div
          className="mt-2 flex w-full items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums text-[#7d8b9c]"
          aria-hidden="true"
        >
          {sparseLabels.map((text, index) => (
            <span key={`sparse-${index}`} className="truncate">
              {text}
            </span>
          ))}
        </div>
      ) : null}

      {n > 0 && !dense ? (
        <div className="mt-2 flex w-full" aria-hidden="true">
          {rows.map((row, index) => (
            <span
              key={`label-${index}`}
              className="min-w-0 flex-1 truncate px-0.5 text-center font-mono text-[11px] tabular-nums text-[#7d8b9c]"
            >
              {row.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default BarChart
