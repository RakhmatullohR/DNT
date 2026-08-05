// Sparkline — qo'lda yozilgan inline SVG chiziqli grafik.
// PLAN §6: chart kutubxonasi YO'Q, grafiklar qo'lda yoziladi.
//
// MOSLASHUVCHANLIK QARORI (nozik joy):
// `width`/`height` — SVG ning ICHKI koordinata tizimi (`viewBox`), ekrandagi
// o'lcham emas. Element eni doim konteynerga to'liq cho'ziladi, balandligi esa
// `height` piksel bilan qat'iy belgilanadi. `preserveAspectRatio="none"` bo'lgani
// uchun nisbat saqlanmaydi — aks holda keng ekranda 320x76 grafik 1000x237 bo'lib
// butun kartani egallab olardi, telefonda esa yassilanib ketardi.
//
// Notekis masshtabning ikkita oqibati bor va ikkalasi ham hal qilingan:
//   1. chiziq qalinligi cho'zilardi -> `vectorEffect="non-scaling-stroke"`;
//   2. oxirgi nuqta aylanasi ellipsga aylanardi -> u SVG emas, HTML qatlamda
//      foizli joylashuv bilan chiziladi.

import { useEffect, useId, useState } from 'react'

export type SparklineProps = {
  values: number[]
  /** `viewBox` eni — nuqtalar orasidagi masofa aniqligini belgilaydi. */
  width?: number
  /** Ekrandagi haqiqiy balandlik (px) va ayni paytda `viewBox` balandligi. */
  height?: number
  label?: string
}

const LINE = '#4fe0a8'
const GRID = 'rgba(230, 237, 243, 0.07)'

/** Chiziq chetga yopishib qolmasligi uchun ichki chekinishlar (viewBox birligida). */
const PAD_X = 3
const PAD_TOP = 10
const PAD_BOTTOM = 10

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmt(n: number): string {
  return String(Math.round(n))
}

/** `Math.min(...arr)` ATAYIN ishlatilmaydi: uzun massivda stek chegarasidan oshadi. */
function extent(values: number[]): { lo: number; hi: number } {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  return { lo, hi }
}

export function Sparkline({ values, width = 320, height = 76, label }: SparklineProps) {
  // `useId()` natijasida `:` belgilari bor; ular `url(#...)` havolasida ayrim
  // brauzerlarda muammo tug'diradi, shuning uchun olib tashlanadi.
  const uid = useId().replace(/:/g, '')
  const [anim, setAnim] = useState<{ drawn: boolean; ms: number }>({ drawn: false, ms: 900 })

  useEffect(() => {
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      // Brauzer `matchMedia` ni qo'llab-quvvatlamasa — odatiy animatsiya.
    }
    if (reduced) {
      setAnim({ drawn: true, ms: 0 })
      return
    }
    // Birinchi kadrdan keyin yoqiladi, aks holda o'tish (transition) o'tkazib yuboriladi.
    const frame = requestAnimationFrame(() => setAnim({ drawn: true, ms: 900 }))
    return () => cancelAnimationFrame(frame)
  }, [])

  const w = Math.max(60, Math.round(Number.isFinite(width) ? width : 320))
  const h = Math.max(36, Math.round(Number.isFinite(height) ? height : 76))
  const innerW = w - PAD_X * 2
  const innerH = h - PAD_TOP - PAD_BOTTOM

  const safe = values.map((value) => (Number.isFinite(value) ? value : 0))
  const n = safe.length
  const { lo, hi } = extent(safe)
  const last = n > 0 ? (safe[n - 1] ?? 0) : 0

  const xAt = (index: number): number =>
    PAD_X + (n <= 1 ? innerW / 2 : (index / (n - 1)) * innerW)

  const yAt = (value: number): number => {
    // Butun qator bir xil bo'lsa bo'lish 0 ga tushardi. Hammasi nol bo'lsa chiziq
    // PASTDA turadi (bu haqiqatan "hech narsa yo'q" degani), aks holda o'rtada.
    if (hi === lo) return hi === 0 ? PAD_TOP + innerH : PAD_TOP + innerH / 2
    return PAD_TOP + (1 - (value - lo) / (hi - lo)) * innerH
  }

  const points = safe.map((value, index) => ({ x: xAt(index), y: yAt(value) }))
  const first = points[0]
  const tail = points[n - 1]

  let linePath = ''
  let areaPath = ''
  if (first !== undefined && tail !== undefined) {
    linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${roundTo2(p.x)} ${roundTo2(p.y)}`)
      .join(' ')
    const bottom = roundTo2(h - PAD_BOTTOM / 2)
    areaPath = `${linePath} L${roundTo2(tail.x)} ${bottom} L${roundTo2(first.x)} ${bottom} Z`
  }

  const gridYs = [PAD_TOP, PAD_TOP + innerH / 2, PAD_TOP + innerH]

  const summary =
    label !== undefined && label !== ''
      ? `${label}: ${n} nuqta, eng past ${fmt(lo)}, eng yuqori ${fmt(hi)}, oxirgi ${fmt(last)}`
      : `Chiziqli grafik: ${n} nuqta`

  return (
    <div className="w-full">
      {label !== undefined && label !== '' ? (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#7d8b9c]">
            {label}
          </span>
          {n > 0 ? (
            <span className="font-mono text-[10px] tabular-nums text-[#5c6b7d]">
              past {fmt(lo)} <span className="text-[#33404f]">·</span> yuqori {fmt(hi)}{' '}
              <span className="text-[#33404f]">·</span>{' '}
              <span className="text-[#4fe0a8]">oxirgi {fmt(last)}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative w-full" style={{ height: `${h}px` }}>
        <svg
          className="block h-full w-full overflow-visible"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
        >
          <defs>
            <linearGradient id={`sl-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity="0.26" />
              <stop offset="100%" stopColor={LINE} stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridYs.map((y, i) => (
            <line
              key={i}
              x1={0}
              y1={y}
              x2={w}
              y2={y}
              stroke={GRID}
              strokeWidth={1}
              strokeDasharray={i === 1 ? '3 5' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {n === 0 ? (
            <line
              x1={PAD_X}
              y1={PAD_TOP + innerH / 2}
              x2={w - PAD_X}
              y2={PAD_TOP + innerH / 2}
              stroke="rgba(230, 237, 243, 0.14)"
              strokeWidth={1}
              strokeDasharray="4 6"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <>
              <path
                d={areaPath}
                fill={`url(#sl-fill-${uid})`}
                style={{
                  opacity: anim.drawn ? 1 : 0,
                  transition: `opacity ${anim.ms}ms ease-out`,
                }}
              />
              <path
                d={linePath}
                fill="none"
                stroke={LINE}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={anim.drawn ? 0 : 1}
                style={{
                  transition: `stroke-dashoffset ${anim.ms}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                }}
              />
            </>
          )}
        </svg>

        {tail !== undefined ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute block"
            style={{
              left: `${(tail.x / w) * 100}%`,
              top: `${(tail.y / h) * 100}%`,
              transform: 'translate(-50%, -50%)',
              opacity: anim.drawn ? 1 : 0,
              transition: `opacity ${anim.ms}ms ease-out`,
            }}
          >
            <span className="absolute -inset-1.5 animate-ping rounded-full bg-[#4fe0a8]/25" />
            <span className="relative block h-1.5 w-1.5 rounded-full bg-[#4fe0a8] ring-2 ring-[#0b0f14]" />
          </span>
        ) : null}

        {n === 0 ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[#4a5768]">
            ma&apos;lumot yo&apos;q
          </span>
        ) : null}
      </div>
    </div>
  )
}

export default Sparkline
