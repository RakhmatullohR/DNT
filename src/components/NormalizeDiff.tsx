// Normalizatsiya diffi (PLAN §2a): ASL va TOZALANGAN matn YONMA-YON, o'zgargan
// belgilar ajratib ko'rsatiladi. Qoida bitta: "Foydalanuvchi ko'rmasdan hech narsa
// o'zgarmaydi."
//
// NOZIK JOY — ajratish `normalize()` ning O'Z natijasidan quriladi.
// Bu yerda `normalize.ts` dagi jadvallar (aqlli qo'shtirnoq, tire, probel) QAYTA
// YOZILMAYDI: agar yozilsa, ikki nusxa vaqt o'tib bir-biridan uzoqlashardi va diff
// haqiqatda bo'lgan almashtirishni emas, shu fayldagi eskirgan tasavvurni ko'rsatardi.
// O'rniga `result.changes` dagi `from -> to` juftliklari jadval sifatida ishlatiladi.
//
// Moslashtirish algoritmi (O(n), chunki `normalize` belgi-belgi ishlaydi):
// asl matn bo'ylab yuriladi va tozalangan matndagi kursor (`j`) parallel suriladi.
//   - belgi jadvalda bor          -> o'zgargan deb belgilanadi, `to` uzunligicha `j` suriladi;
//   - belgi tozalangan matnda ayni shu joyda turibdi -> o'zgarmagan;
//   - ikkalasi ham emas           -> belgini `trim()` yoki probel siqilishi yutgan.
// Moslik buzilgan holatda ham ko'rsatiladigan TOZALANGAN MATN doim `result.text` —
// ya'ni ajratish xato bo'lishi mumkin, target esa hech qachon.

import type { ReactElement } from 'react'

import type { ChangeKind, NormalizeChange, NormalizeResult } from '../core/normalize.ts'

/** Diff bo'lagining turi; `none` — o'zgarmagan matn. */
type SegmentKind = ChangeKind | 'none'

type Segment = { kind: SegmentKind; text: string }

type KindMeta = {
  label: string
  /** Afsonadagi rangli nuqta. */
  dot: string
  /** Matn ichidagi ajratish uslubi. */
  mark: string
}

/**
 * Har bir o'zgarish turining o'z rangi bor: bu yerda rang bezak emas, ma'lumot —
 * bitta xatboshida beshta turdagi almashtirish bir vaqtda uchrashi mumkin.
 */
const KIND_META: Record<ChangeKind, KindMeta> = {
  diacritic: {
    label: 'Diakritika',
    dot: 'bg-[#c792ea]',
    mark: 'bg-[#c792ea]/20 text-[#dcb6ff] ring-1 ring-[#c792ea]/40',
  },
  quote: {
    label: "Qo'shtirnoq va apostrof",
    dot: 'bg-[#7cb6ff]',
    mark: 'bg-[#7cb6ff]/20 text-[#a8d0ff] ring-1 ring-[#7cb6ff]/40',
  },
  dash: {
    label: "Tire va ko'p nuqta",
    dot: 'bg-[#f2b544]',
    mark: 'bg-[#f2b544]/20 text-[#ffd08a] ring-1 ring-[#f2b544]/40',
  },
  space: {
    label: "Bo'shliq",
    dot: 'bg-[#5ad1a5]',
    mark: 'bg-[#5ad1a5]/20 text-[#8ee7c6] ring-1 ring-[#5ad1a5]/40',
  },
  removed: {
    label: 'Olib tashlandi',
    dot: 'bg-[#ef6f6c]',
    mark: 'bg-[#ef6f6c]/20 text-[#ff9f9c] ring-1 ring-[#ef6f6c]/40',
  },
}

/**
 * Ekranda ko'rinadigan shakli YO'Q belgilar: boshqaruv (`\p{C}`, bunga `U+200B`,
 * `U+FEFF` kabi nol enli belgilar ham kiradi) va har xil probellar (`\p{Z}`).
 * Ular o'rniga `·` chiziladi — aks holda "olib tashlandi" deb belgilangan joy
 * mutlaqo bo'sh ko'rinardi va foydalanuvchi nima o'chganini bilmasdi.
 */
const NO_GLYPH_RE = /^[\p{C}\p{Z}]$/u

/** `U+00A0` ko'rinishidagi kod nuqtasi yorlig'i. */
function codePointLabel(ch: string): string {
  const code = ch.codePointAt(0)
  if (code === undefined) return 'U+????'
  return 'U+' + code.toString(16).toUpperCase().padStart(4, '0')
}

function displayText(text: string): string {
  let out = ''
  for (const ch of text) {
    out += NO_GLYPH_RE.test(ch) ? '·' : ch
  }
  return out
}

function codePointList(text: string): string {
  const parts: string[] = []
  for (const ch of text) parts.push(codePointLabel(ch))
  return parts.join(' ')
}

/** Ketma-ket bir xil turdagi belgilar bitta bo'lakka yig'iladi — DOM tugunlari soni shu bilan cheklanadi. */
function pushSegment(list: Segment[], kind: SegmentKind, text: string): void {
  if (text === '') return
  const last = list[list.length - 1]
  if (last !== undefined && last.kind === kind) {
    last.text += text
    return
  }
  list.push({ kind, text })
}

type DiffPair = { left: Segment[]; right: Segment[] }

/**
 * `result.changes` dan belgi -> almashtirish jadvalini yig'adi.
 * Bir nechta kod nuqtasidan iborat `from` (ketma-ket probellar guruhi) tashlab
 * ketiladi: u alohida belgiga emas, siqilish HODISASIGA tegishli.
 */
function buildReplacementMap(changes: readonly NormalizeChange[]): Map<string, NormalizeChange> {
  const map = new Map<string, NormalizeChange>()
  for (const change of changes) {
    if ([...change.from].length !== 1) continue
    if (map.has(change.from)) continue
    map.set(change.from, change)
  }
  return map
}

export function buildDiff(original: string, result: NormalizeResult): DiffPair {
  const map = buildReplacementMap(result.changes)
  const clean = result.text
  const left: Segment[] = []
  const right: Segment[] = []
  let j = 0

  for (const ch of original) {
    const change = map.get(ch)
    if (change !== undefined) {
      pushSegment(left, change.kind, ch)
      if (change.to !== '' && clean.startsWith(change.to, j)) {
        pushSegment(right, change.kind, change.to)
        j += change.to.length
      }
      continue
    }
    if (clean.startsWith(ch, j)) {
      pushSegment(left, 'none', ch)
      pushSegment(right, 'none', ch)
      j += ch.length
      continue
    }
    // Jadvalda ham yo'q, natijada ham yo'q: bu belgini `trim()` yoki
    // ketma-ket probellarni siqish yutgan.
    pushSegment(left, 'space', ch)
  }

  // Nazariy jihatdan bo'sh qolishi kerak; moslik buzilsa target baribir to'liq ko'rinadi.
  if (j < clean.length) pushSegment(right, 'none', clean.slice(j))

  return { left, right }
}

function renderSegments(segments: readonly Segment[]): ReactElement[] {
  return segments.map((segment, index) => {
    if (segment.kind === 'none') {
      return <span key={index}>{segment.text}</span>
    }
    const meta = KIND_META[segment.kind]
    const strike = segment.kind === 'removed' ? ' line-through decoration-[#ef6f6c]/70' : ''
    return (
      <mark
        key={index}
        title={`${meta.label} · ${codePointList(segment.text)}`}
        className={`rounded-[3px] px-[1px] ${meta.mark}${strike}`}
      >
        {displayText(segment.text)}
      </mark>
    )
  })
}

/** Jadvaldagi `from` ustuni: ko'rinmas belgi kod nuqtasi bilan yoziladi. */
function changeFromLabel(change: NormalizeChange): string {
  if ([...change.from].length > 1 && change.from.trim() === '') {
    return 'ketma-ket probellar'
  }
  const shown = displayText(change.from)
  return `${shown}  ${codePointList(change.from)}`
}

const PANEL = 'rounded-lg border border-[#1d2833] bg-[#0d131a]'
const CAPTION = "text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8fa1]"

type PaneProps = {
  caption: string
  hint: string
  tone: string
  children: ReactElement[]
}

function Pane({ caption, hint, tone, children }: PaneProps): ReactElement {
  return (
    <div className={PANEL}>
      <div className="flex items-baseline justify-between gap-3 border-b border-[#1d2833] px-3 py-2">
        <span className={`${CAPTION} ${tone}`}>{caption}</span>
        <span className="text-[11px] tabular-nums text-[#7d8b9c]">{hint}</span>
      </div>
      <div className="max-h-72 overflow-auto px-3 py-3 text-[13px] leading-[1.8] break-words whitespace-pre-wrap">
        {children.length === 0 ? <span className="text-[#7d8b9c]">— bo'sh —</span> : children}
      </div>
    </div>
  )
}

export type NormalizeDiffProps = {
  /** Foydalanuvchi paste qilgan asl matn. */
  original: string
  result: NormalizeResult
}

/**
 * Asl va tozalangan matnni yonma-yon ko'rsatadi, o'zgargan belgilarni ajratadi va
 * olib tashlanganlarini alohida ro'yxat qilib beradi (PLAN §2a).
 */
export function NormalizeDiff({ original, result }: NormalizeDiffProps): ReactElement {
  const { left, right } = buildDiff(original, result)
  const kinds: ChangeKind[] = []
  for (const change of result.changes) {
    if (!kinds.includes(change.kind)) kinds.push(change.kind)
  }
  const totalChanges = result.changes.reduce((sum, change) => sum + change.count, 0)

  return (
    <section aria-label="Normalizatsiya natijasi" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {result.changes.length === 0 ? (
          <p className="text-[13px] text-[#5ad1a5]">
            Matn allaqachon toza — bironta ham belgi o'zgartirilmadi.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-[#8b98a9]">
              <span className="tabular-nums text-[#e6edf3]">{totalChanges}</span> ta belgi
              o'zgartirildi:
            </p>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {kinds.map((kind) => (
                <li key={kind} className="flex items-center gap-1.5 text-[11px] text-[#8b98a9]">
                  <span className={`h-2 w-2 rounded-[2px] ${KIND_META[kind].dot}`} aria-hidden="true" />
                  {KIND_META[kind].label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Pane caption="Asl matn" hint={`${original.length} belgi`} tone="text-[#8b98a9]">
          {renderSegments(left)}
        </Pane>
        <Pane
          caption="Tozalangan matn — mashq targeti"
          hint={`${result.text.length} belgi`}
          tone="text-[#5ad1a5]"
        >
          {renderSegments(right)}
        </Pane>
      </div>

      {result.changes.length > 0 && (
        <div className={`${PANEL} overflow-hidden`}>
          <div className="border-b border-[#1d2833] px-3 py-2">
            <span className={CAPTION}>O'zgarishlar</span>
          </div>
          <ul className="divide-y divide-[#151f29]">
            {result.changes.map((change) => (
              <li
                key={`${change.kind}|${change.from}|${change.to}`}
                className="flex items-center gap-3 px-3 py-2 text-[13px]"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-[2px] ${KIND_META[change.kind].dot}`}
                  aria-hidden="true"
                />
                <span className="w-40 shrink-0 truncate text-[#8b98a9]">
                  {KIND_META[change.kind].label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[#e6edf3]">
                  {changeFromLabel(change)}
                </span>
                <span className="shrink-0 text-[#7d8b9c]" aria-hidden="true">
                  &rarr;
                </span>
                <span className="w-24 shrink-0 truncate text-[#5ad1a5]">
                  {change.to === '' ? "o'chirildi" : `"${change.to}"`}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-[#7d8fa1]">
                  {change.count}&times;
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.removed.length > 0 && (
        <div className={`${PANEL} p-3`}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className={CAPTION}>Olib tashlangan belgilar</span>
            <span className="text-[11px] tabular-nums text-[#7d8b9c]">
              {result.removed.length} xil
            </span>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-[#7d8fa1]">
            Bu belgilar klaviaturada terilmaydi, shuning uchun mashq matnidan chiqarildi. Ular
            bo'lmaganda kursor birinchi shunday belgida qotib qolardi va gap hech qachon
            tugamasdi.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.removed.map((ch) => (
              <li
                key={ch}
                className="flex items-center gap-2 rounded border border-[#ef6f6c]/30 bg-[#ef6f6c]/10 px-2 py-1 text-[11px]"
              >
                <span className="text-[#ff9f9c]">{displayText(ch)}</span>
                <span className="tabular-nums text-[#7d8fa1]">{codePointLabel(ch)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default NormalizeDiff
