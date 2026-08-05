// Statistika ekrani (PLAN §6) — butun tarixning chuqur ko'rinishi.
// Marshrut: '/stats'.
//
// Grafiklar qo'lda yozilgan inline SVG komponentlar (`Sparkline`, `BarChart`) —
// PLAN §6 da chart kutubxonasi ATAYIN rad etilgan.
//
// Ekranning ikkita raqami tushuntirishsiz sirli bo'lib qolardi, shuning uchun
// ta'riflar UI ning O'ZIDA yozilgan: seriya chegarasi va qiyin so'zlar reytingi.
//
// "Zaxira" bo'limi eksport/import bilan cheklanmaydi: o'qib bo'lmaydigan payload
// zaxirasi (PLAN §10) VA darslar omboridagi tanib bo'lmaydigan yozuvlar ham shu
// yerda ko'rinadi. Aks holda ularga faqat devtools orqali yetib borish mumkin
// bo'lardi, ya'ni "qo'lda tiklash mumkin" va'dasi ilova ichida yashiringan bo'lardi.

import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { BarChart } from '../components/BarChart.tsx'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import {
  corruptLessonsBackup,
  discardCorruptLessonsBackup,
  discardUnknownLessons,
  unknownLessonCount,
} from '../store/lessons.ts'
import {
  clearStats,
  corruptStatsBackup,
  dailySeries,
  discardCorruptStatsBackup,
  exportJson,
  hardestWords,
  importJson,
  loadStats,
  STREAK_MIN_CORRECT,
  streakDays,
  totals,
} from '../store/stats.ts'
import type { StatsData } from '../store/stats.ts'

const PANEL = 'rounded-2xl border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[10px] uppercase tracking-[0.22em] text-[#7d8b9c]'
const NOTE = 'font-mono text-[11px] leading-relaxed text-[#5c6b7d]'

const LINK_BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-4 font-mono text-[13px] font-medium tracking-[0.04em] whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]'
const LINK_PRIMARY = `${LINK_BTN} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`

/** Trend uchun tanlanadigan oraliqlar. */
const RANGES = [14, 30] as const

/** Ustunli grafikdagi so'zlar soni: `BarChart` shundan ortig'iga yorliq sig'dirolmaydi. */
const WORD_BARS = 8

/** Ro'yxatda ko'rsatiladigan oxirgi seanslar soni. */
const SESSION_ROWS = 12

// ---------------------------------------------------------------------------
// Formatlash (ekran ichida lokal — `Results.tsx` dagi tartib bilan bir xil)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "noma'lum vaqt"
  const d = new Date(ms)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours} soat ${pad2(minutes)} daq`
  if (minutes > 0) return `${minutes} daq ${pad2(seconds)} sek`
  return `${seconds} sek`
}

function formatWpm(value: number): string {
  return String(Math.round(Number.isFinite(value) && value > 0 ? value : 0))
}

function formatPercent(ratio: number): string {
  const safe = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, ratio) : 0
  return `${(safe * 100).toFixed(1)}%`
}

/** 'YYYY-MM-DD' -> 'MM.DD' — grafik yorlig'i uchun. */
function shortDay(day: string): string {
  return day.slice(5).replace('-', '.')
}

/** Fayl nomidagi sana: 'YYYY-MM-DD' (lokal vaqt, `stats.ts` dagi kun kalitlari kabi). */
function stamp(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

// ---------------------------------------------------------------------------
// Ombordan o'qish
// ---------------------------------------------------------------------------

type HardWord = { word: string; exposures: number; errors: number; rate: number }

type Snapshot = {
  stats: StatsData
  summary: { sessions: number; activeMs: number; netWpm: number; accuracy: number }
  streak: number
  /** `minExposures` ATAYIN berilmaydi — chegara `stats.ts` da belgilangan (PLAN §6). */
  hardest: HardWord[]
}

function readSnapshot(): Snapshot {
  return { stats: loadStats(), summary: totals(), streak: streakDays(), hardest: hardestWords() }
}

function hasHistory(stats: StatsData): boolean {
  return (
    stats.sessions.length > 0 ||
    Object.keys(stats.days).length > 0 ||
    Object.keys(stats.words).length > 0
  )
}

// ---------------------------------------------------------------------------
// Fayl bilan almashish
// ---------------------------------------------------------------------------

/** Ekrandagi YAGONA yuklash yo'li: eksport ham, buzuq nusxa ham shu yerdan o'tadi. */
function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Bekor qilish keyingi tsiklga qoldiriladi: darhol chaqirilsa ayrim brauzerlar
  // yuklashni boshlashga ulgurmay, fayl bo'sh tushadi.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadJson(): void {
  downloadText(exportJson(), `dnt-stats-${stamp(new Date())}.json`, 'application/json;charset=utf-8')
}

// ---------------------------------------------------------------------------
// Buzuq nusxalar (PLAN §10)
// ---------------------------------------------------------------------------

/** Zaxirada turgan, o'qib bo'lmaydigan payload: qaysi ombordan ekani va xom satri. */
type Damaged = { id: 'stats' | 'lessons'; store: string; raw: string }

function readDamaged(): Damaged[] {
  const rows: Damaged[] = []
  const stats = corruptStatsBackup()
  if (stats !== null) rows.push({ id: 'stats', store: 'statistika', raw: stats })
  const lessons = corruptLessonsBackup()
  if (lessons !== null) rows.push({ id: 'lessons', store: 'darslar', raw: lessons })
  return rows
}

/**
 * Buzuq nusxa ta'rifiga ko'ra parse qilinmaydi, shuning uchun fayl `.txt`
 * bo'lib tushadi: `.json` deb atash uni "yaroqli zaxira" deb ko'rsatardi.
 */
function downloadDamaged(row: Damaged): void {
  downloadText(row.raw, `dnt-${row.id}-buzuq-${stamp(new Date())}.txt`, 'text/plain;charset=utf-8')
}

// ---------------------------------------------------------------------------
// Kichik UI bo'laklari
// ---------------------------------------------------------------------------

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className={`${PANEL} p-4 sm:p-5`}>
      <div className={LABEL}>{label}</div>
      <div
        className="mt-2.5 font-mono text-2xl leading-none font-semibold tabular-nums sm:text-3xl"
        style={{ color: color ?? '#e6edf3' }}
      >
        {value}
      </div>
      {hint !== undefined ? <div className="mt-2 font-mono text-[11px] text-[#5c6b7d]">{hint}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

type Message = { kind: 'ok' | 'error'; text: string }

export function Stats() {
  // Ombor holatda saqlanadi: import va o'chirishdan keyin ekran QAYTA o'qishi
  // kerak, render ichidagi to'g'ridan-to'g'ri chaqiriq esa buni qilmaydi.
  const [snapshot, setSnapshot] = useState<Snapshot>(readSnapshot)
  const [range, setRange] = useState<number>(RANGES[0])
  const [importArmed, setImportArmed] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [damaged, setDamaged] = useState<Damaged[]>(readDamaged)
  const [damagedArmed, setDamagedArmed] = useState<Damaged | null>(null)
  const [junk, setJunk] = useState<number>(unknownLessonCount)
  const [junkArmed, setJunkArmed] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const series = useMemo(() => dailySeries(range), [range, snapshot])

  const recent = useMemo(
    () => [...snapshot.stats.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, SESSION_ROWS),
    [snapshot],
  )

  const filled = hasHistory(snapshot.stats)
  const activeDays = series.filter((point) => point.correctKeystrokes >= STREAK_MIN_CORRECT).length

  async function applyFile(file: File): Promise<void> {
    let raw = ''
    try {
      raw = await file.text()
    } catch {
      setMessage({ kind: 'error', text: "Faylni o'qib bo'lmadi." })
      return
    }

    const result = importJson(raw)
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error })
      return
    }

    setSnapshot(readSnapshot())
    // Import — buzuq payloadni yo'q qiladigan yozuv bo'lishi mumkin, ya'ni aynan
    // shu chaqiruq yangi zaxira yaratgan bo'lishi ehtimoli bor (`importJson`).
    setDamaged(readDamaged())
    setImportArmed(false)
    setMessage({ kind: 'ok', text: 'Statistika fayldan tiklandi.' })
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Qiymat darhol tozalanadi: aks holda AYNAN o'sha faylni ikkinchi marta
    // tanlaganda `change` hodisasi umuman chiqmaydi va tugma "o'lik" ko'rinadi.
    input.value = ''
    if (file === undefined) return
    void applyFile(file)
  }

  function handleClear(): void {
    clearStats()
    setSnapshot(readSnapshot())
    // `clearStats` statistikaning buzuq nusxasini ham o'chiradi — ro'yxat qayta o'qiladi.
    setDamaged(readDamaged())
    setDamagedArmed(null)
    setClearArmed(false)
    setMessage({ kind: 'ok', text: "Statistika o'chirildi." })
  }

  function handleDiscardDamaged(row: Damaged): void {
    if (row.id === 'stats') discardCorruptStatsBackup()
    else discardCorruptLessonsBackup()
    setDamaged(readDamaged())
    setDamagedArmed(null)
    setMessage({ kind: 'ok', text: `Buzuq nusxa o'chirildi (${row.store}).` })
  }

  function handleDiscardJunk(): void {
    discardUnknownLessons()
    setJunk(unknownLessonCount())
    setJunkArmed(false)
    setMessage({ kind: 'ok', text: "Yaroqsiz dars yozuvlari o'chirildi." })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className={LABEL}>statistika</h1>
        <Link
          to="/"
          className="font-mono text-[11px] tracking-wide text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
        >
          Darslar
        </Link>
      </div>

      {filled ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric
              label="net wpm"
              value={formatWpm(snapshot.summary.netWpm)}
              color="#5ee6c1"
              hint="Faol vaqtga og'irliklangan"
            />
            <Metric
              label="aniqlik"
              value={formatPercent(snapshot.summary.accuracy)}
              color="#f2b544"
              hint="To'g'ri bosishlar / jami"
            />
            <Metric label="seans" value={String(snapshot.summary.sessions)} hint="Yozib olingan" />
            <Metric
              label="faol vaqt"
              value={formatDuration(snapshot.summary.activeMs)}
              hint="5 sekunddan uzun tanaffuslarsiz"
            />
            <Metric
              label="seriya"
              value={`${snapshot.streak} kun`}
              color="#6ba8ff"
              hint={`Kuniga ${STREAK_MIN_CORRECT}+ to'g'ri bosish`}
            />
          </section>

          <p className={NOTE}>
            Seriya — kuniga kamida {STREAK_MIN_CORRECT} ta to&apos;g&apos;ri bosish qayd etilgan
            kunlarning uzluksiz ketma-ketligi; bitta gap yozib qo&apos;yish seriyani ushlab
            turmaydi. Bugun chegaraga yetmagan bo&apos;lsa hisob kechadan boshlanadi — kun hali
            tugamagani uchun tugallanmagan bugun seriyani uzmaydi.
          </p>

          <section className={`${PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={LABEL}>kunlik trend</h2>
              <div className="flex items-center gap-1 rounded-sm border border-[#22303d] p-0.5">
                {RANGES.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setRange(days)}
                    aria-pressed={days === range}
                    className={`h-7 rounded-xs px-2.5 font-mono text-[11px] tabular-nums transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] ${
                      days === range
                        ? 'bg-[#5ee6c1]/15 text-[#5ee6c1]'
                        : 'text-[#7d8b9c] hover:text-[#e6edf3]'
                    }`}
                  >
                    {days} kun
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <Sparkline
                values={series.map((point) => point.netWpm)}
                label="kunlik net wpm"
                width={480}
                height={84}
              />
            </div>

            <div className="mt-6">
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className={LABEL}>kunlik to&apos;g&apos;ri bosishlar</span>
                <span className="font-mono text-[10px] tabular-nums text-[#5c6b7d]">
                  {activeDays} / {series.length} kun chegaradan o&apos;tgan
                </span>
              </div>
              <BarChart
                data={series.map((point) => ({
                  label: shortDay(point.day),
                  value: point.correctKeystrokes,
                }))}
              />
            </div>

            <p className={`${NOTE} mt-4`}>
              Mashq qilinmagan kunlar nol bo&apos;lib ko&apos;rinadi — bo&apos;shliq emas, tushib
              ketgan chiziq. Kunlik wpm kunlik yig&apos;indidan hisoblanadi, shuning uchun gap
              bo&apos;yicha wpm dan bir oz farq qilishi mumkin.
            </p>
          </section>

          <section className={`${PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className={LABEL}>eng qiyin so&apos;zlar</h2>
              <span className="font-mono text-[10px] text-[#4a5768]">xato / ta&apos;sirlanish</span>
            </div>

            {snapshot.hardest.length === 0 ? (
              <p className={`${NOTE} mt-5`}>
                Hali yetarli ma&apos;lumot yo&apos;q: reytingga tushish uchun so&apos;z kamida 5
                marta uchrashi kerak.
              </p>
            ) : (
              <>
                <div className="mt-5">
                  <BarChart
                    data={snapshot.hardest.slice(0, WORD_BARS).map((row) => ({
                      label: row.word,
                      value: row.rate * 100,
                    }))}
                    max={100}
                  />
                </div>

                <ul className="mt-6 space-y-2">
                  {snapshot.hardest.map((row) => (
                    <li
                      key={row.word}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b border-white/[0.04] pb-2 last:border-b-0"
                    >
                      <span className="truncate font-mono text-[13px] text-[#e6edf3]">
                        {row.word}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#5c6b7d]">
                        {row.errors} / {row.exposures}
                      </span>
                      <span className="w-12 text-right font-mono text-[12px] tabular-nums text-[#ff8b8b]">
                        {Math.round(row.rate * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className={`${NOTE} mt-5 border-t border-white/[0.06] pt-4`}>
              Tartib xato SONI bo&apos;yicha emas, xato ULUSHI (xato / ta&apos;sirlanish)
              bo&apos;yicha va faqat kamida 5 marta uchragan so&apos;zlar orasida. Xom son bilan
              tartiblansa ro&apos;yxat boshini doim <span className="text-[#7d8b9c]">the</span>{' '}
              egallardi — u qiyin bo&apos;lgani uchun emas, ko&apos;p uchragani uchun.
            </p>
          </section>

          <section className={`${PANEL} p-5 sm:p-6`}>
            <h2 className={LABEL}>oxirgi seanslar</h2>

            {recent.length === 0 ? (
              <p className={`${NOTE} mt-5`}>Seans yozuvlari saqlanmagan.</p>
            ) : (
              <ul className="mt-4 space-y-1">
                {recent.map((session) => (
                  <li key={session.id}>
                    <Link
                      to={`/results/${encodeURIComponent(session.id)}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[13px] text-[#e6edf3]">
                          {session.lessonTitle === '' ? 'Nomsiz dars' : session.lessonTitle}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10.5px] tabular-nums text-[#5c6b7d]">
                          {formatDateTime(session.startedAt > 0 ? session.startedAt : session.endedAt)}
                        </span>
                      </span>
                      <span className="font-mono text-[12px] tabular-nums text-[#5ee6c1]">
                        {formatWpm(session.netWpm)} wpm
                      </span>
                      <span className="w-14 text-right font-mono text-[12px] tabular-nums text-[#7d8b9c]">
                        {formatPercent(session.accuracy)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {snapshot.stats.sessions.length > SESSION_ROWS ? (
              <p className={`${NOTE} mt-4`}>
                Jami {snapshot.stats.sessions.length} ta seans saqlangan, shu yerda oxirgi{' '}
                {SESSION_ROWS} tasi ko&apos;rsatilgan.
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <EmptyState
          title="Hali statistika yo'q"
          hint="Birinchi seansdan keyin bu yerda wpm trendi, aniqlik, seriya va eng qiyin so'zlar paydo bo'ladi. Boshqa brauzerdan zaxira fayli bo'lsa, uni quyida tiklash mumkin."
          action={
            <Link to="/" className={LINK_PRIMARY}>
              Darslarga o&apos;tish
            </Link>
          }
        />
      )}

      <section className={`${PANEL} p-5 sm:p-6`}>
        <h2 className={LABEL}>zaxira</h2>
        <p className={`${NOTE} mt-3`}>
          Butun tarix faqat shu brauzerning xotirasida turadi: bitta &laquo;clear browsing
          data&raquo; oylab yig&apos;ilgan xato-so&apos;z tarixini o&apos;chirib yuboradi. JSON
          fayl — yagona nusxasi.
        </p>

        {damaged.map((row) => (
          <div key={row.id} className="mt-4 rounded-sm border border-[#3a3520] bg-[#15130d] p-4">
            <p className="font-mono text-[12px] leading-relaxed text-[#f2cf8a]">
              Shu brauzerda saqlangan <span className="text-[#e6edf3]">{row.store}</span> ma&apos;lumoti
              o&apos;qib bo&apos;lmaydigan holatda topilgan edi. Dastur uni o&apos;chirmadi —
              alohida joyga ko&apos;chirib qo&apos;ydi ({row.raw.length} belgi). Uni fayl qilib
              yuklab olishingiz mumkin: ichida eski ma&apos;lumotning bir qismi qolgan
              bo&apos;lishi ehtimoli bor, lekin dastur uni o&apos;zi o&apos;qiy olmagani uchun
              avtomatik tiklamaydi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {/* `primary` ATAYIN emas: buzuq nusxa aynan bo'sh statistika bilan
                  birga chiqadi, o'shanda esa sahifada `EmptyState` ning to'ldirilgan
                  tugmasi turadi (bittadan ortiq bo'lmasligi kerak — `Button.tsx`). */}
              <Button variant="ghost" size="sm" onClick={() => downloadDamaged(row)}>
                Buzuq nusxani yuklab olish
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMessage(null)
                  setDamagedArmed(row)
                }}
              >
                O&apos;chirish
              </Button>
            </div>

            {damagedArmed !== null && damagedArmed.id === row.id ? (
              <div className="mt-3 rounded-sm border border-[#452027] bg-[#160f12] p-4">
                <p className="font-mono text-[12px] leading-relaxed text-[#ff9f9f]">
                  Bu nusxa butunlay o&apos;chiriladi va qaytarib bo&apos;lmaydi — u
                  ma&apos;lumotning oxirgi qolgan izi bo&apos;lishi mumkin. Avval yuklab olib
                  qo&apos;yish tavsiya etiladi.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" onClick={() => handleDiscardDamaged(row)}>
                    Ha, o&apos;chirilsin
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDamagedArmed(null)}>
                    Bekor qilish
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {junk > 0 ? (
          <div className="mt-4 rounded-sm border border-[#22303d] bg-[#0b0f14] p-4">
            <p className={NOTE}>
              Darslar omborida tanib bo&apos;lmaydigan {junk} ta yozuv saqlanib qolgan. Ular dars
              ro&apos;yxatiga chiqmaydi, lekin har saqlashda diskka qaytariladi va joy egallaydi.
              Tozalash mavjud darslarga tegmaydi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {junkArmed ? (
                <>
                  <Button variant="danger" size="sm" onClick={handleDiscardJunk}>
                    Ha, tozalansin
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setJunkArmed(false)}>
                    Bekor qilish
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMessage(null)
                    setJunkArmed(true)
                  }}
                >
                  Yaroqsiz yozuvlarni tozalash
                </Button>
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={downloadJson} disabled={!filled}>
            JSON eksport
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMessage(null)
              setClearArmed(false)
              setImportArmed(true)
            }}
          >
            JSON import
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setMessage(null)
              setImportArmed(false)
              setClearArmed(true)
            }}
            disabled={!filled}
          >
            Hammasini o&apos;chirish
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFile}
        />

        {importArmed ? (
          <div className="mt-4 rounded-sm border border-[#3a3520] bg-[#15130d] p-4">
            {/* Import BIRLASHTIRMAYDI, ALMASHTIRADI — `stats.ts` dagi izohda sababi: aks
                holda bitta faylni ikki marta import qilish yig'indilarni ikkilantirardi.
                Shuning uchun ogohlantirish fayl tanlashdan OLDIN ko'rsatiladi. */}
            <p className="font-mono text-[12px] leading-relaxed text-[#f2cf8a]">
              Import mavjud statistikani TO&apos;LIQ almashtiradi — birlashtirmaydi. Hozirgi
              seanslar, kunlik yig&apos;indi va so&apos;z reytingi fayldagisi bilan
              o&apos;rnini bo&apos;shatadi. Avval joriy holatni eksport qilib qo&apos;yish
              tavsiya etiladi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                Fayl tanlash
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportArmed(false)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        ) : null}

        {clearArmed ? (
          <div className="mt-4 rounded-sm border border-[#452027] bg-[#160f12] p-4">
            <p className="font-mono text-[12px] leading-relaxed text-[#ff9f9f]">
              Barcha seanslar, kunlik yig&apos;indi va so&apos;z reytingi o&apos;chiriladi.
              Qaytarib bo&apos;lmaydi. Darslar (matnlar) esa joyida qoladi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={handleClear}>
                Ha, hammasi o&apos;chirilsin
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setClearArmed(false)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        ) : null}

        {message !== null ? (
          <p
            role="status"
            className={`mt-4 font-mono text-[12px] leading-relaxed ${
              message.kind === 'ok' ? 'text-[#5ee6c1]' : 'text-[#ff9f9f]'
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>
    </div>
  )
}

export default Stats
