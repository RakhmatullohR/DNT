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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { BarChart } from '../components/BarChart.tsx'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { SHRINKAGE_M, dayNumber, dayNumberToKey } from '../core/wordScore.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import {
  corruptLessonsBackup,
  describeLessonsImport,
  discardCorruptLessonsBackup,
  discardUnknownLessons,
  exportLessonsJson,
  importLessonsJson,
  listLessons,
  unknownLessonCount,
} from '../store/lessons.ts'
// `persistenceState`/`storageEstimate` faqat HOLATNI o'qiydi — `requestPersistence`
// bu ekranda faqat foydalanuvchi "so'rash" tugmasini bosganda chaqiriladi, boot
// paytida EMAS (bu allaqachon `main.tsx` da bir marta bajarilgan; §3.1, §3.3).
import { persistenceState, requestPersistence, storageEstimate } from '../store/persist.ts'
import type { PersistEstimate, PersistState } from '../store/persist.ts'
import {
  audioComparison,
  clearStats,
  dailySeries,
  exportJson,
  G_ORDER_FLIP,
  hardestWords,
  importJson,
  initStats,
  loadOverview,
  measureBeta,
  measureG,
  measureLifetimeG,
  recentSessions,
  STREAK_MIN_CORRECT,
  streakDays,
  totals,
} from '../store/stats.ts'
import type {
  AudioBucket,
  AudioComparison,
  DailyPoint,
  HardWordRow,
  SessionRecord,
  StatsAvailability,
  StatsOverview,
  Totals,
} from '../store/stats.ts'
import { StatsBanner } from '../components/StatsBanner.tsx'

const PANEL = 'rounded-panel border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
const NOTE = 'font-mono text-[11px] leading-relaxed text-[#7d8b9c]'

const LINK_BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border px-4 font-mono text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]'
const LINK_PRIMARY = `${LINK_BTN} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`

/**
 * §6.2 — berilgan `g` da `1/1` va `10/50` tartibi buzilmasligi uchun kerakli
 * minimal `m`: `m > 40 / (9 − 49g)`.
 *
 * `g ≥ 9/49 ≈ 0.184` da maxraj musbat emas va HECH QANDAY `m` yordam bermaydi —
 * shunda `Infinity` qaytadi va taqqoslash tabiiy ravishda "yetarli emas" beradi.
 */
function requiredM(g: number): number {
  const denominator = 9 - 49 * g
  return denominator > 0 ? 40 / denominator : Number.POSITIVE_INFINITY
}

/** Trend uchun tanlanadigan oraliqlar. */
const RANGES = [14, 30] as const

/**
 * Ustunli grafikdagi so'zlar soni: `BarChart` shundan ortig'iga yorliq
 * sig'dirolmaydi. `BarChart.tsx` dagi `DENSE_LABEL_LIMIT` bilan BIR XIL bo'lishi
 * kerak — undan oshsa grafik zich rejimga o'tadi va sakkizta so'z o'rniga atigi
 * uchta yorliq (birinchi, o'rta, oxirgi) qoladi. Konteyner 1152px ga kengaygach
 * ikkovi ham 8 dan 10 ga ko'tarildi; hisob o'sha konstanta izohida.
 */
const WORD_BARS = 10

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

/**
 * Farq uchun ALOHIDA formatlovchilar.
 *
 * `formatWpm`/`formatPercent` manfiy qiymatni 0 ga tenglashtiradi — bu yagona
 * qiymat uchun to'g'ri (manfiy wpm ma'nosiz), lekin FARQ uchun halokatli:
 * "ovoz bilan sekinroq teraman" degan eng muhim signal jimgina "0" bo'lib
 * ko'rinardi va gate teskari xulosaga olib kelardi.
 */
function formatWpmDelta(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function formatPercentDelta(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0.0%'
  const pct = Math.max(-100, Math.min(100, ratio * 100))
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/** 'YYYY-MM-DD' -> 'MM.DD' — grafik yorlig'i uchun. */
function shortDay(day: string): string {
  return day.slice(5).replace('-', '.')
}

/**
 * "Oxirgi marta qachon" — so'z reytingi qatori uchun.
 *
 * `lastDay === undefined` bo'lsa ATAYIN "noma'lum" qaytariladi, bugungi sana
 * EMAS: bu maydon `de`/`dx` bilan bir vaqtda qo'shilgan, ya'ni migratsiyagacha
 * yozilgan so'zda haqiqatan noma'lum (M1, §9.1). Uni bugun deb ko'rsatish
 * ustunni ma'nosizlantirardi — minglab so'z bir xil "bugun" bilan chiqardi.
 *
 * Yaqin kunlar nisbiy ("bugun", "kecha", "N kun oldin") tezroq o'qiladi; bir
 * oydan uzoqroq bo'lsa "47 kun oldin" o'rniga aniq sana (`YYYY-MM-DD`) qulayroq.
 */
function formatLastSeen(lastDay: number | undefined, today: number): string {
  if (lastDay === undefined) return "noma'lum"
  const diff = Math.max(0, today - lastDay)
  if (diff === 0) return 'bugun'
  if (diff === 1) return 'kecha'
  if (diff <= 30) return `${diff} kun oldin`
  return dayNumberToKey(lastDay)
}

/** Fayl nomidagi sana: 'YYYY-MM-DD' (lokal vaqt, `stats.ts` dagi kun kalitlari kabi). */
function stamp(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** Xato matni — `unknown` dan foydalanuvchiga ko'rsatiladigan satr. */
function errorText(err: unknown): string {
  return err instanceof Error && err.message !== '' ? err.message : String(err)
}

/**
 * Baytni o'qish mumkin shaklga o'tkazadi — "saqlash holati" bloki uchun
 * (`docs/stats-longterm.md` §3.3, §12 M4).
 *
 * ⚠️ O'NLIK asosda (1000, 1024 EMAS) — hujjatning §2 dagi "Barcha MB — o'nlik
 * (10⁶ B)" konvensiyasiga ATAYIN mos: aks holda shu ekranda ko'rsatilgan MB
 * hujjatdagi boshqa hisoblar (masalan §1, §2 dagi ombor hajmi baholari) bilan
 * solishtirilganda kelishmay, chalkashtirardi.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "noma'lum"
  if (bytes < 1_000) return `${Math.round(bytes)} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

// ---------------------------------------------------------------------------
// Ombordan o'qish
// ---------------------------------------------------------------------------

type Snapshot = {
  /** ⭐ Faqat SANOQLAR: "tarix bormi" degan savol uchun butun ombor KERAK EMAS. */
  overview: StatsOverview
  /**
   * Umrbod yig'indi — `meta.lifetime` dan (§4.3).
   *
   * ⚠️ `null` — konvert YO'Q, ya'ni "hammasi nol" EMAS (F4). Nol ko'rsatish
   * qisman yoki noma'lum holatni "umrbod hech narsa qilmagansiz" deb
   * ko'rsatardi — §4.3 aynan shu xatoning oldini olish uchun yozilgan.
   */
  summary: Totals | null
  streak: number
  /** Ro'yxatdagi oxirgi seanslar — `by_endedAt` bo'yicha teskari kursordan (§9.4). */
  recent: SessionRecord[]
  /** `minExposures` ATAYIN berilmaydi — chegara `stats.ts` da belgilangan (PLAN §6). */
  hardest: HardWordRow[]
  /**
   * ⭐ M2/M3 gate (PLAN §8). M3 dan boshlab manba — `days` do'konidagi
   * CHELAKLAR, seanslar EMAS (§1.3): seanslar 180 kundan keyin o'chiriladi va
   * gate JIMGINA zaiflashardi.
   */
  audio: AudioComparison
  /**
   * Bugungi SO'NUVCHI global xato ulushi (M1, §6.2) — reyting formulasining
   * o'z-o'zini tekshirish soni. `null` — hali o'lchanmagan (bo'sh so'z
   * jadvali); qorovul `measureG()` imzosining O'ZIDA, shuning uchun ekran uni
   * haqiqiy 0.08 o'lchovi bilan aralashtira olmaydi.
   */
  g: number | null
  /**
   * ⭐ §12 M0 o'lchovi: UMRBOD `Σx / Σe`, urug'siz.
   *
   * `g` dan ATAYIN alohida: `g` urug'langan (`de = min(e, 20)`) jadvaldan
   * chiqadi, ya'ni ko'p uchraydigan — odatda eng oson — so'zlarning og'irligi
   * kesilgan holda. Shuning uchun `g` §12 M0 talab qilgan sonni BERA OLMAYDI
   * va faqat unga qarab "formula yaroqsiz" degan xulosa chiqarish mumkin edi.
   */
  lifetimeG: number | null
  /**
   * §6.3 — `g` va `m` ning MA'LUMOTDAN chiqarilgan bahosi.
   *
   * ⚠️ Reytingga TA'SIR QILMAYDI: u hamon qo'lda tanlangan `m = 20` bilan
   * hisoblanadi. Bu qator faqat konstantani tekshirib turish uchun (§6.3:
   * "hozir sobit m = 20, keyin baholanadigan"). `null` — baho ishonchsiz.
   */
  beta: { g: number; m: number } | null
}

/**
 * Butun ekranning ma'lumoti — YETTITA parallel so'rovda.
 *
 * `Promise.all` ATAYIN: har biri o'z tranzaksiyasini ochadi va ular
 * bir-birini kutmasligi kerak. Ketma-ket `await` ekran yuklanishini yetti
 * barobar uzaytirardi, hech qanday to'g'rilik bermasdan.
 */
async function readSnapshot(): Promise<Snapshot> {
  const [overview, summary, streak, recent, hardest, audio, g, lifetimeG, beta] = await Promise.all([
    loadOverview(),
    totals(),
    streakDays(),
    recentSessions(SESSION_ROWS),
    hardestWords(),
    audioComparison(),
    measureG(),
    measureLifetimeG(),
    measureBeta(),
  ])
  return { overview, summary, streak, recent, hardest, audio, g, lifetimeG, beta }
}

/**
 * Fayl tanlash oynasi qaysi ombor uchun ochilgan. Ekranda YAGONA `<input
 * type="file">` bor va u ikkala importga xizmat qiladi — shuning uchun tanlangan
 * faylni kim qabul qilishini aynan shu bayroq hal qiladi.
 */
type ImportTarget = 'stats' | 'lessons'

/** Eksport tugmasini o'chirish uchun: darsi yo'q omborni "zaxira qilish" ma'nosiz. */
function countLessons(): number {
  return listLessons().length
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

/**
 * Eksport endi ASINXRON (`exportJson()` to'rtta do'konni o'qiydi).
 *
 * `downloadText` faqat natija kelgach chaqiriladi: bo'sh `Blob` ni oldindan
 * yaratib, keyin to'ldirish mumkin emas.
 */
async function downloadJson(): Promise<void> {
  const text = await exportJson()
  downloadText(text, `dnt-stats-${stamp(new Date())}.json`, 'application/json;charset=utf-8')
}

/**
 * Darslar zaxirasi ALOHIDA fayl bo'lib tushadi (`dnt-lessons-…`).
 *
 * Ikkovini bitta faylga qo'shish mumkin edi, lekin ular bir xil qoidaga
 * bo'ysunmaydi: statistika importi ALMASHTIRADI, darslar importi esa
 * BIRLASHTIRADI (`lessons.importLessonsJson`). Bitta fayl foydalanuvchiga
 * bitta tugma ko'rsatib, ichida ikki xil ish qilardi — shuning uchun fayl ham,
 * tugma ham ikkita.
 */
function downloadLessons(): void {
  downloadText(
    exportLessonsJson(),
    `dnt-lessons-${stamp(new Date())}.json`,
    'application/json;charset=utf-8',
  )
}

// ---------------------------------------------------------------------------
// Buzuq nusxalar (PLAN §10)
// ---------------------------------------------------------------------------

/**
 * Zaxirada turgan, o'qib bo'lmaydigan payload.
 *
 * ⚠️ M3 (docs/stats-longterm.md §9.2): STATISTIKA uchun bu quyi tizim
 * BUTUNLAY O'CHDI. IndexedDB'da "buzuq satr" tushunchasi yo'q — strukturaviy
 * nusxa yo muvaffaqiyatli o'qiladi, yo baza umuman ochilmaydi, ya'ni zaxiraga
 * ko'chiriladigan xom payload mavjud emas. O'rnini `persist()` + muntazam
 * eksport bosadi.
 *
 * DARSLAR uchun esa u JOYIDA QOLADI: `lessons.ts` hamon `localStorage` da
 * yashaydi va bitta buzuq satr butun kutubxonani yo'q qilishi mumkin. Ikkovini
 * chalkashtirmaslik uchun tip endi faqat bitta manbani biladi.
 */
type Damaged = { id: 'lessons'; store: string; raw: string }

function readDamaged(): Damaged[] {
  const lessons = corruptLessonsBackup()
  return lessons === null ? [] : [{ id: 'lessons', store: 'darslar', raw: lessons }]
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
        className="mt-2.5 font-mono text-[21px] leading-none font-semibold tabular-nums"
        style={{ color: color ?? '#e6edf3' }}
      >
        {value}
      </div>
      {hint !== undefined ? <div className="mt-2 font-mono text-[11px] text-[#7d8b9c]">{hint}</div> : null}
    </div>
  )
}

/**
 * ⭐ M2/M3 gate xulosasi uchun minimal namuna (PLAN §8).
 *
 * Reja "bir hafta kunma-kun" deydi — bu kuniga bir necha gapdan ham ko'p
 * chiqadi. Chegara ATAYIN past emas: 5-6 gapdan chiqarilgan xulosa shovqin
 * bo'lardi va gate'ning maqsadi aynan shovqinni tasodifiy signaldan ajratish.
 */
const GATE_MIN_SENTENCES = 20

function GateColumn({ title, bucket, accent }: { title: string; bucket: AudioBucket; accent: string }) {
  return (
    <div className="rounded-control border border-white/[0.06] bg-[#0b1118] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-[#7d8b9c]">{title}</span>
        <span className="font-mono text-[11px] tabular-nums text-[#7d8b9c]">
          {bucket.sentences} gap
        </span>
      </div>
      <div
        className="mt-3 font-mono text-[16px] font-medium tabular-nums"
        style={{ color: accent }}
      >
        {formatWpm(bucket.netWpm)}
      </div>
      <div className="mt-1 font-mono text-[11px] text-[#7d8b9c]">net wpm</div>
      <div className="mt-3 font-mono text-[13px] tabular-nums text-[#e6edf3]">
        {formatPercent(bucket.accuracy)}
      </div>
      <div className="mt-1 font-mono text-[11px] text-[#7d8b9c]">aniqlik</div>
    </div>
  )
}

/**
 * Saqlash holati (`docs/stats-longterm.md` §3.3, §12 M4): "jimgina yo'qolish
 * o'rniga KO'RINADIGAN holat". Uch holat ATAYIN turlicha ko'rsatiladi —
 * `granted` xotirjam, `denied` ogohlantiradi va muntazam eksportga ishora
 * qiladi (pastdagi «zaxira» bo'limidagi mavjud tugma), `unsupported` esa
 * na yaxshi, na yomon: brauzer bu haqda ma'lumot bermaydi, xolos.
 *
 * `persistState === null` — hali yuklanayotgan holat (ikkala manba ham
 * `Promise` qaytaradi, `Stats()` ichidagi effekt asinxron to'ldiradi). Bu
 * holatda soxta "hammasi joyida" ko'rsatmaslik uchun faqat "tekshirilmoqda"
 * matni chiziladi.
 */
function StorageStatus({
  persistState,
  estimate,
  requesting,
  onRequest,
}: {
  persistState: PersistState | null
  /** `undefined` — hali yuklanmagan; ichki `null` — `storageEstimate()` ning o'zi qaytaradigan "ma'lumot yo'q" holati. */
  estimate: PersistEstimate | undefined
  requesting: boolean
  onRequest: () => void
}) {
  return (
    <div className="mt-4 rounded-control border border-white/[0.06] bg-[#0b1118] p-4">
      <div className={LABEL}>saqlash holati</div>

      {persistState === null ? (
        <p className={`${NOTE} mt-3`}>Tekshirilmoqda…</p>
      ) : (
        <>
          {persistState === 'granted' ? (
            <p className="mt-3 font-mono text-[13px] leading-relaxed text-[#5ee6c1]">
              Doimiy saqlash yoqilgan — brauzer bu ma&apos;lumotni joy tanqisligida
              avtomatik o&apos;chirmaydi.
            </p>
          ) : null}

          {persistState === 'unsupported' ? (
            <p className={`${NOTE} mt-3`}>
              Bu brauzer doimiy saqlash holati haqida ma&apos;lumot bermaydi. Bu xato
              emas — shunchaki bu yerda holatni tekshirib bo&apos;lmaydi.
            </p>
          ) : null}

          {persistState === 'denied' ? (
            <div className="mt-3 rounded-control border border-[#3a3520] bg-[#15130d] p-4">
              <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
                Doimiy saqlash yoqilmagan: brauzer joy tanqisligida bu ma&apos;lumotni
                o&apos;chirishi mumkin. Shu sababli pastdagi «JSON eksport» tugmasi
                bilan muntazam nusxa olib turish tavsiya etiladi — u yagona
                kafolatlangan zaxira.
              </p>
              <div className="mt-3">
                <Button variant="ghost" size="sm" onClick={onRequest} disabled={requesting}>
                  {requesting ? "So'ralmoqda…" : "Doimiy saqlashni so'rash"}
                </Button>
              </div>
            </div>
          ) : null}

          {estimate !== undefined && estimate !== null ? (
            <p className={`${NOTE} mt-3`}>
              Diskda: {formatBytes(estimate.usage)} / {formatBytes(estimate.quota)} (
              {formatPercent(estimate.ratio)}).
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

type Message = { kind: 'ok' | 'error'; text: string }

export function Stats() {
  useDocumentTitle('Statistika')

  // Ombor holatda saqlanadi: import va o'chirishdan keyin ekran QAYTA o'qishi
  // kerak. `null` — hali yuklanmagan: statistika endi IndexedDB'da va uni
  // render paytida sinxron o'qib bo'lmaydi (docs/stats-longterm.md §3.2a).
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  // (§8.4d) Banner uchun. Boshlang'ich `ready` — yuklanish paytida
  // ogohlantirish miltillab ketmasin.
  const [availability, setAvailability] = useState<StatsAvailability>('ready')
  // Yuklash XATO bilan tugadi. `snapshot` abadiy `null` bo'lib qolganda ekran
  // «o'qilmoqda» da qotib qolardi va sabab hech qayerda ko'rinmasdi.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [range, setRange] = useState<number>(RANGES[0])
  // Kunlik trend ALOHIDA yuklanadi: u `range` o'zgarganda qayta so'raladi,
  // qolgan sakkizta so'rov esa faqat import/o'chirishdan keyin.
  const [series, setSeries] = useState<DailyPoint[] | null>(null)
  const [importArmed, setImportArmed] = useState<ImportTarget | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [damaged, setDamaged] = useState<Damaged[]>(readDamaged)
  const [damagedArmed, setDamagedArmed] = useState<Damaged | null>(null)
  const [junk, setJunk] = useState<number>(unknownLessonCount)
  const [junkArmed, setJunkArmed] = useState(false)
  const [lessonCount, setLessonCount] = useState<number>(countLessons)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Saqlash holati (§3.3, §12 M4). `requestPersistence()` bu yerda BOOT'da
  // chaqirilmaydi — u `main.tsx` da bir marta bajarilgan. Sabab: `persist()`
  // ba'zi brauzerlarda (Firefox) foydalanuvchiga so'rov ko'rsatishi mumkin, va
  // buni Statistika ekraniga har kirganda takrorlash bezovta qilardi. Bu ekran
  // faqat HOLATNI o'qiydi (`persistenceState`) — so'rov faqat pastdagi
  // "so'rash" tugmasi orqali, foydalanuvchi o'zi bosganda yuboriladi.
  //
  // `null` — hali yuklanmagan (tekshirilmoqda).
  const [persistState, setPersistState] = useState<PersistState | null>(null)
  // `undefined` — hali yuklanmagan; ichki `null` — `storageEstimate()` ning
  // o'zi qaytaradigan "brauzer ma'lumot bermaydi" holati.
  const [estimate, setEstimate] = useState<PersistEstimate | undefined>(undefined)
  const [requestingPersistence, setRequestingPersistence] = useState(false)

  // Komponent umrini kuzatish: ekrandagi HAMMA asinxron joy natijani FAQAT
  // komponent hali ilangan bo'lsa qo'llaydi. Bayroqsiz, tez almashtirilgan
  // ekranda uzilgan komponentda `setState` chaqirilardi.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * ⭐ POYGA QOROVULI — AVLOD SANOG'I.
   *
   * `mountedRef` bu yerda YETARLI EMAS. Ekran ombordan bir necha marta qayta
   * o'qiydi (import, o'chirish, buzuq nusxani tashlash), va IndexedDB
   * so'rovlarining tugash tartibi kafolatlanmagan: import bosilgandan keyin
   * boshlangan yangi yuklash ESKI, hali tugamagan yuklashdan oldin kelishi
   * mumkin — o'shanda eski (import qilinishidan oldingi) holat yangisini bosib
   * ketardi va foydalanuvchi "import ishlamadi" deb o'ylardi.
   *
   * Sanoq har yangi yuklashda oshadi; natija faqat O'Z avlodi hamon oxirgisi
   * bo'lsa qo'llanadi.
   */
  const snapshotGenRef = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const generation = snapshotGenRef.current + 1
    snapshotGenRef.current = generation
    const next = await readSnapshot()
    if (!mountedRef.current || snapshotGenRef.current !== generation) return
    setSnapshot(next)
  }, [])

  // Birinchi yuklash. `initStats()` AVVAL kutiladi (§9): u boot'da `main.tsx`
  // dan ham chaqirilgan, lekin natijasi kutilmagan — ya'ni to'g'ridan-to'g'ri
  // o'qish migratsiya tugamasdan BO'SH omborni ko'rsatishi mumkin edi.
  useEffect(() => {
    void (async () => {
      // `setAvailability` o'qishlardan OLDIN: ombor `blocked` bo'lsa `reload()`
      // umuman hal bo'lmaydi (`statsDb.ts` saqlangan `blockedReq` tufayli
      // keyingi `openDb()` yangi so'rov chiqarmaydi), ya'ni undan keyingi
      // qatorga navbat yetmasdi.
      const state = await initStats()
      if (mountedRef.current) setAvailability(state)
      await reload()
    })().catch((err: unknown) => {
      // `withStatsDb` `InvalidStateError` dan boshqa xatolarni QAYTA TASHLAYDI,
      // ya'ni bu shox haqiqiy. `.catch` siz bu boshqarilmagan rad javobi bo'lib,
      // ekran abadiy «o'qilmoqda» da qolib ketardi.
      if (mountedRef.current) setLoadError(errorText(err))
    })
  }, [reload])

  // Saqlash holati (§3.3, §12 M4) — statistika ma'lumotidan MUSTAQIL, shuning
  // uchun alohida effekt: u import/o'chirishdan keyin qayta so'ralmasligi kerak.
  useEffect(() => {
    void persistenceState().then((state) => {
      if (mountedRef.current) setPersistState(state)
    })
    void storageEstimate().then((est) => {
      if (mountedRef.current) setEstimate(est)
    })
  }, [])

  async function handleRequestPersistence(): Promise<void> {
    setRequestingPersistence(true)
    const state = await requestPersistence()
    if (mountedRef.current) {
      setPersistState(state)
      setRequestingPersistence(false)
    }
  }

  /**
   * Kunlik trend. `range` o'zgarganda QAYTA so'raladi (§9.4 buni alohida
   * belgilaydi), shuning uchun `cancelled` bayrog'i SHART: 14 -> 30 -> 14 deb
   * tez bosilganda sekinroq tugagan o'rtadagi so'rov oxirgisini bosib ketardi.
   *
   * `snapshot` ham bog'liqlikda: import yoki o'chirishdan keyin trend ham
   * yangilanishi kerak.
   */
  useEffect(() => {
    let cancelled = false
    setSeries(null)
    void dailySeries(range).then((points) => {
      if (!cancelled && mountedRef.current) setSeries(points)
    })
    return () => {
      cancelled = true
    }
  }, [range, snapshot])

  const recent = snapshot?.recent ?? []
  const summary = snapshot?.summary ?? null
  /**
   * ⚠️ `filled` FAQAT yuklangan suratdan hisoblanadi va YUKLANISH holati undan
   * ALOHIDA shoxga chiqadi (`snapshot === null`).
   *
   * Ilgari bu ikkovi bitta shoxga tushardi, ya'ni uch yillik tarixi bor
   * foydalanuvchi ham ekranga har kirganda bir lahzaga «Hali statistika yo'q»
   * ni ko'rardi — o'sha lahzada tarix o'chib ketgandek tuyulardi. Bu aynan
   * `Results.tsx` ochiq rad etgan naqsh («Yuklanish holati "topilmadi" dan
   * ALOHIDA») va `Home.tsx` dagi `PENDING`/`UNKNOWN` ajratmasi bilan bir xil
   * qoida.
   */
  const filled = snapshot !== null && snapshot.overview.hasHistory
  const points = series ?? []
  const activeDays = points.filter((point) => point.correctKeystrokes >= STREAK_MIN_CORRECT).length
  // ⭐ `nc` si YO'Q kunlar — "o'lchanmagan" (§4.2). Ular grafikda taqribiy
  // qiymat bilan chiziladi va buni AYTIB QO'YISH shart: yo'q maydon NOL emas
  // (`PLAN.md` §11.3, 4-invariant).
  const approxDays = points.filter((point) => point.approx).length
  // "Bugun" kun raqami — reytingdagi `lastDay` ni "necha kun oldin" ga
  // aylantirish uchun (`formatLastSeen`). O'lchov bor-yo'qligini alohida
  // bayroq bilan tekshirish endi KERAK EMAS: `measureG()` va
  // `measureLifetimeG()` o'lchanmagan holatda `null` qaytaradi.
  const today = dayNumber(Date.now())

  async function applyFile(target: ImportTarget, file: File): Promise<void> {
    let raw = ''
    try {
      raw = await file.text()
    } catch {
      setMessage({ kind: 'error', text: "Faylni o'qib bo'lmadi." })
      return
    }

    // Ikki ombor ikki xil natija shakli qaytaradi (darslar importi nechta yozuv
    // qo'shilgan-yangilanganini ham beradi), shuning uchun tarmoqlar alohida.
    if (target === 'stats') {
      const result = await importJson(raw)
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error })
        return
      }
      // ⚠️ `readSnapshot()` TO'G'RIDAN-TO'G'RI chaqirilmaydi — `reload()` orqali:
      // faqat u avlod sanog'ini oshiradi va parallel ketayotgan eski yuklashni
      // bekor qiladi (`snapshotGenRef` izohi).
      await reload()
      // ⚠️ Statistikaning buzuq nusxasi endi YO'Q (§9.2), lekin DARSLARNIKI
      // bor va u shu yerda o'zgarmaydi — ro'yxat qayta o'qilmaydi.
      setImportArmed(null)
      setMessage({ kind: 'ok', text: 'Statistika fayldan tiklandi.' })
      return
    }

    const result = importLessonsJson(raw)
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error })
      return
    }
    setLessonCount(countLessons())
    // Darslar omboriga yozish tanib bo'lmaydigan yozuvlar sonini o'zgartirishi
    // mumkin: buzuq payload zaxiraga ko'chsa, ular bilan birga o'sha satr ham
    // ombordan chiqib ketadi (`readStored` → `backupCorrupt`).
    setJunk(unknownLessonCount())
    setDamaged(readDamaged())
    setImportArmed(null)
    setMessage({ kind: 'ok', text: describeLessonsImport(result.added, result.updated) })
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Qiymat darhol tozalanadi: aks holda AYNAN o'sha faylni ikkinchi marta
    // tanlaganda `change` hodisasi umuman chiqmaydi va tugma "o'lik" ko'rinadi.
    input.value = ''
    if (file === undefined || importArmed === null) return
    void applyFile(importArmed, file)
  }

  /**
   * ⚠️ Xato SHU YERDA ushlanadi. `clearStats()`/`reload()` rad etsa, `.catch` siz
   * bu boshqarilmagan rad javobi bo'lardi: tasdiq paneli ochiq qolib, tugma
   * "o'lik" ko'rinardi va foydalanuvchi ma'lumot o'chdimi-yo'qmi bilmasdi.
   */
  async function handleClear(): Promise<void> {
    try {
      await clearStats()
      await reload()
    } catch (err) {
      setMessage({ kind: 'error', text: `O'chirib bo'lmadi: ${errorText(err)}` })
      return
    }
    setClearArmed(false)
    setMessage({ kind: 'ok', text: "Statistika o'chirildi." })
  }

  /** Faqat DARSLAR nusxasi — statistikaniki §9.2 bo'yicha o'chgan. */
  function handleDiscardDamaged(row: Damaged): void {
    discardCorruptLessonsBackup()
    setDamaged(readDamaged())
    setDamagedArmed(null)
    setMessage({ kind: 'ok', text: `Buzuq nusxa o'chirildi (${row.store}).` })
  }

  /** Ikki import tugmasi uchun bitta yo'l: qarama-qarshi panellar bir vaqtda ochilmaydi. */
  function armImport(target: ImportTarget): void {
    setMessage(null)
    setClearArmed(false)
    setImportArmed(target)
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
        <h1 className="font-mono text-[21px] font-semibold">statistika</h1>
        <Link
          to="/"
          className="font-mono text-[11px] text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
        >
          Darslar
        </Link>
      </div>

      {/* (§8.4d) Ombor ishlamayotgan bo'lsa buni JIM qoldirib bo'lmaydi: pastdagi
          raqamlar bo'sh chiqadi va foydalanuvchi sababini bilmasdi. */}
      <StatsBanner availability={availability} />

      {loadError !== null ? (
        <div className="rounded-control border border-[#3a3520] bg-[#15130d] p-4">
          <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
            Statistikani o&apos;qib bo&apos;lmadi ({loadError}). Ma&apos;lumot yo&apos;qolgani
            shart emas — sahifani yangilab ko&apos;ring. Pastdagi statistika eksporti va
            &laquo;Hammasini o&apos;chirish&raquo; shu sababdan o&apos;chirilgan:
            o&apos;qib bo&apos;lmagan holat ustida ish ko&apos;rish yarim natija berardi.
          </p>
        </div>
      ) : null}

      {snapshot === null ? (
        // Yuklanish — «bo'sh ombor» EMAS (`filled` izohiga qarang).
        <div className={`${PANEL} p-8 text-center sm:p-12`}>
          <div className={LABEL}>yuklanmoqda</div>
          <p className="mt-4 font-mono text-[13px] text-[#8b98a9]">Statistika o&apos;qilmoqda…</p>
        </div>
      ) : filled ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {/* ⚠️ `summary === null` — umrbod konvert (`meta.lifetime`) TOPILMADI.
                Bu "hammasi nol" EMAS (§4.3, F4): nol ko'rsatish noma'lum holatni
                "umrbod hech narsa qilmagansiz" deb ko'rsatardi. Shuning uchun
                chiziqcha va pastda ochiq izoh. Seriya `days` dan keladi, ya'ni u
                konvertdan MUSTAQIL va baribir to'g'ri.

                ⚠️ `netWpm`/`accuracy` ALOHIDA `null` bo'lishi mumkin — konvert
                bor, lekin nisbatni izchil o'lchash uchun oyna yo'q. Ular ham
                «—» bo'lib chiziladi: taxminiy son bu yerda YOLG'ON bo'lardi
                (pastdagi izohga q.). */}
            <Metric
              label="net wpm"
              value={summary === null || summary.netWpm === null ? '—' : formatWpm(summary.netWpm)}
              color="#5ee6c1"
              hint="Faol vaqtga og'irliklangan"
            />
            <Metric
              label="aniqlik"
              value={
                summary === null || summary.accuracy === null
                  ? '—'
                  : formatPercent(summary.accuracy)
              }
              color="#f2b544"
              hint="To'g'ri bosishlar / jami"
            />
            <Metric
              label="seans"
              value={summary === null ? '—' : String(summary.sessions)}
              hint={summary?.sessionsSince === undefined ? 'Yozib olingan' : 'Qisman — pastga qarang'}
            />
            <Metric
              label="faol vaqt"
              value={summary === null ? '—' : formatDuration(summary.activeMs)}
              hint="5 sekunddan uzun tanaffuslarsiz"
            />
            <Metric
              label="seriya"
              value={`${snapshot.streak} kun`}
              color="#6ba8ff"
              hint={`Kuniga ${STREAK_MIN_CORRECT}+ to'g'ri bosish`}
            />
          </div>

          {summary === null ? (
            <p className={NOTE}>
              Umrbod yig&apos;indi o&apos;qilmadi — ombordagi umrbod konvert topilmadi. Bu
              &laquo;hech narsa qilmagansiz&raquo; degani EMAS: kunlik jadval va so&apos;z
              reytingi joyida, faqat umumiy raqamlar ko&apos;rsatilmaydi.
            </p>
          ) : (
            <>
              {/* XOM SANOQLAR haqidagi izoh. Ilgari bu yerda "Faol vaqt va
                  to'g'ri bosishlar esa kunlik jadvaldan olinadi va TO'LIQ"
                  deb yozilgan edi — o'sha jumla foydalanuvchini yuqoridagi
                  net wpm / aniqlik ham shu to'liq sonlardan chiqqan deb
                  ishontirardi. Aslida nisbatlar ular bilan bir manbadan
                  KELMAYDI (keyingi izoh), shuning uchun jumla ajratildi. */}
              {summary.sessionsSince !== undefined ? (
                <p className={NOTE}>
                  ⚠️ Seans va bosish sanoqlari{' '}
                  <span className="text-[#e6edf3]">{dayNumberToKey(summary.sessionsSince)}</span> dan
                  beri aniq bilinadi — undan oldingi seans tafsilotlari saqlanmagani uchun ular{' '}
                  <span className="text-[#e6edf3]">kamida</span> shuncha. Faol vaqt esa kunlik
                  jadvaldan olinadi va to&apos;liq. Yuqoridagi net wpm va aniqlik bu qisman
                  sanoqlardan HISOBLANMAYDI — ularning manbasi alohida, quyida.
                </p>
              ) : null}

              {/* NISBATLAR haqidagi izoh — yuqoridagisidan MUSTAQIL. */}
              {summary.netWpm === null || summary.accuracy === null ? (
                <p className={NOTE}>
                  net wpm va aniqlik <span className="text-[#e6edf3]">—</span> bilan chizildi va
                  bu ATAYIN. Ular NISBAT, ya&apos;ni surat bilan maxraj AYNAN bir davrni
                  qamrashi shart. Umrbod hisoblagichlarda bu shart buzilgan (net belgilar
                  qisman, faol vaqt to&apos;liq), shuning uchun ulardan chiqadigan son
                  ishonchli ko&apos;rinib, aslida yolg&apos;on bo&apos;lardi — o&apos;lchangan
                  holat: haqiqiy 40 wpm / 96% o&apos;rniga 9 wpm va 100.0%. Izchil
                  o&apos;lchangan kun hali yig&apos;ilmagani uchun raqam ko&apos;rsatilmaydi;
                  bir necha kun mashqdan keyin u o&apos;zi paydo bo&apos;ladi.
                </p>
              ) : summary.ratiosSince !== undefined ? (
                <p className={NOTE}>
                  net wpm va aniqlik{' '}
                  <span className="text-[#e6edf3]">{dayNumberToKey(summary.ratiosSince)}</span> dan
                  beri o&apos;lchangan kunlardan hisoblangan — undan oldingi kunlar bunga
                  kirmaydi. Bu yuqoridagi &laquo;kamida&raquo; dan BOSHQA narsa: u xom sanoqqa
                  tegishli, bu esa nisbatga. Nisbatga &laquo;kamida&raquo; qo&apos;yib
                  bo&apos;lmaydi — u monoton emas va keyingi ma&apos;lumot bilan pasayishi ham
                  mumkin.
                </p>
              ) : null}
            </>
          )}

          <p className={NOTE}>
            Seriya — kuniga kamida {STREAK_MIN_CORRECT} ta to&apos;g&apos;ri bosish qayd etilgan
            kunlarning uzluksiz ketma-ketligi; bitta gap yozib qo&apos;yish seriyani ushlab
            turmaydi. Bugun chegaraga yetmagan bo&apos;lsa hisob kechadan boshlanadi — kun hali
            tugamagani uchun tugallanmagan bugun seriyani uzmaydi.
          </p>

          <section className={`${PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={LABEL}>kunlik trend</h2>
              <div className="flex items-center gap-1 rounded-control border border-[#22303d] p-0.5">
                {RANGES.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setRange(days)}
                    aria-pressed={days === range}
                    className={`h-8 rounded-xs px-2.5 font-mono text-[11px] font-medium tabular-nums transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e141c] ${
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
                values={points.map((point) => point.netWpm)}
                label="kunlik net wpm"
                width={480}
                height={84}
              />
            </div>

            <div className="mt-6">
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className={LABEL}>kunlik to&apos;g&apos;ri bosishlar</h3>
                <span className="font-mono text-[11px] tabular-nums text-[#7d8b9c]">
                  {activeDays} / {points.length} kun chegaradan o&apos;tgan
                </span>
              </div>
              <BarChart
                data={points.map((point) => ({
                  label: shortDay(point.day),
                  value: point.correctKeystrokes,
                }))}
                label="kunlik to'g'ri bosishlar"
              />
              {/* Grafikdagi kunlik yorliqlar `aria-hidden` (`BarChart.tsx`) — ekran
                  o'quvchiga 30 kunlik ma'lumotdan faqat umumiy xulosa yetib borardi.
                  Trendni ko'rish shu sahifaning asosiy qiymati, shuning uchun to'liq
                  jadval matnli muqobil sifatida qo'shiladi. */}
              <table className="sr-only">
                <caption>Kunlik to&apos;g&apos;ri bosishlar, kun bo&apos;yicha</caption>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.day}>
                      <th scope="row">{point.day}</th>
                      <td>{point.correctKeystrokes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={`${NOTE} mt-4`}>
              Mashq qilinmagan kunlar nol bo&apos;lib ko&apos;rinadi — bo&apos;shliq emas, tushib
              ketgan chiziq.
              {approxDays === 0 ? (
                <> Kunlik wpm net belgilardan hisoblanadi, ya&apos;ni gap bo&apos;yicha wpm bilan
                bir xil o&apos;lchovda.</>
              ) : (
                <>
                  {' '}
                  Kunlik wpm net belgilardan hisoblanadi, lekin bu o&apos;lchov faqat OLDINGA
                  ishlaydi:{' '}
                  <span className="text-[#e6edf3]">{approxDays}</span> kun undan oldin yozilgan va
                  ular uchun eski, TAQRIBIY yo&apos;l ishlatiladi — backspace&apos;dan keyin qayta
                  yozilgan harf ikki marta sanalgani uchun o&apos;sha kunlarning wpm&apos;i biroz
                  yuqori chiqadi. O&apos;lchanmagan kun nol emas, shunchaki boshqa yo&apos;l bilan
                  hisoblangan.
                </>
              )}
            </p>
          </section>

          <section className={`${PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className={LABEL}>eng qiyin so&apos;zlar</h2>
              <span className="font-mono text-[11px] text-[#7d8b9c]">xato / ta&apos;sirlanish</span>
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
                    label="eng qiyin so'zlar, xato ulushi"
                  />
                </div>

                <ul className="mt-6 space-y-2">
                  {snapshot.hardest.map((row) => (
                    <li
                      key={row.word}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b border-white/[0.04] pb-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                    >
                      <span lang="en" className="truncate font-mono text-[13px] text-[#e6edf3]">
                        {row.word}
                      </span>
                      {/* Mobil kenglikda BUTUNLAY YO'Q (`hidden` = `display:none`,
                          grid ustuniga umuman kirmaydi): asosiy uchta ustun (so'z /
                          son / foiz) torroq ekranda o'z holicha, o'zgarishsiz qoladi
                          — grid ham `sm:` gacha 3 ustunlik. `Results.tsx` dagi
                          xuddi shu naqsh (`hidden … sm:block`). */}
                      <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-[#7d8b9c] sm:block">
                        {formatLastSeen(row.lastDay, today)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#7d8b9c]">
                        {row.errors} / {row.exposures}
                      </span>
                      <span className="w-12 text-right font-mono text-[13px] tabular-nums text-[#ff8b8b]">
                        {Math.round(row.rate * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className={`${NOTE} mt-5 border-t border-white/[0.06] pt-4`}>
              Tartib xato ULUSHI bo&apos;yicha emas — so&apos;nuvchi hisoblagichlardan
              hisoblangan ball bo&apos;yicha (90 kunlik yarim yemirilish bilan; bu MVP
              soddalashtirishi, sanoat standarti emas). Shu sababli uch yil oldin qiynalgan,
              endi esa mukammal yoziladigan so&apos;z ro&apos;yxat boshida abadiy qolmaydi, kam
              uchragan so&apos;z esa o&apos;rtacha darajaga tortiladi — u avtomatik &laquo;eng
              qiyin&raquo; bo&apos;lib chiqmaydi. Reyting hamon faqat kamida 5 marta uchragan
              so&apos;zlar orasida hisoblanadi: bu to&apos;siq saqlanadi, chunki kam
              ma&apos;lumotli so&apos;zni hech qanday formula ishonchli tartiblay olmaydi.
            </p>

            {snapshot.g !== null && snapshot.lifetimeG !== null ? (
              <p className={`${NOTE} mt-2`}>
                Global xato ulushi — bugungi so&apos;nuvchi{' '}
                <span className="text-[#7d8b9c]">g</span>:{' '}
                <span className="tabular-nums text-[#e6edf3]">{formatPercent(snapshot.g)}</span>,
                umrbod <span className="text-[#7d8b9c]">Σx/Σe</span>:{' '}
                <span className="tabular-nums text-[#e6edf3]">
                  {formatPercent(snapshot.lifetimeG)}
                </span>
                . Ikkalasi har xil savolga javob beradi: birinchisi so&apos;nuvchi
                hisoblagichlardan olinadi va reyting AYNAN shundan qurilgan, ikkinchisi esa
                xom umrbod yig&apos;indi — shuning uchun tez-tez uchraydigan oson so&apos;zlar
                unda to&apos;liq og&apos;irlikda qatnashadi va u odatda pastroq chiqadi.
              </p>
            ) : (
              <p className={`${NOTE} mt-2`}>Global xato ulushi hali o&apos;lchanmagan.</p>
            )}

            {snapshot.beta === null ? null : (
              <p className={`${NOTE} mt-2`}>
                Ma&apos;lumotdan baholangan (§6.3, beta-binomial momentlar usuli):{' '}
                <span className="text-[#7d8b9c]">ĝ</span>{' '}
                <span className="tabular-nums text-[#e6edf3]">
                  {formatPercent(snapshot.beta.g)}
                </span>
                , <span className="text-[#7d8b9c]">m̂</span>{' '}
                <span className="tabular-nums text-[#e6edf3]">{snapshot.beta.m.toFixed(1)}</span> —
                reytingda ishlatiladigan{' '}
                <span className="tabular-nums text-[#e6edf3]">{SHRINKAGE_M}</span> bilan
                solishtiring. <span className="text-[#7d8b9c]">ĝ</span> — SO&apos;ZLAR
                bo&apos;yicha o&apos;rtacha, ya&apos;ni har bir so&apos;z unga teng ovoz
                beradi; yuqoridagi ikkala <span className="text-[#7d8b9c]">g</span> esa pooled,
                unda ko&apos;p uchraydigan so&apos;z ko&apos;proq og&apos;irlikka ega —
                shuning uchun uchtasi bir xil ma&apos;lumotdan ham turlicha chiqadi. ⚠️ Bu son
                konstantani O&apos;ZGARTIRMAYDI: u qo&apos;lda tanlangan
                va shu yerda faqat tekshirib turiladi. Baho ishonchsiz bo&apos;lsa (kam
                so&apos;z yoki tarqoqlik sof tasodifiy) bu qator umuman chizilmaydi.
                {snapshot.beta.m < requiredM(snapshot.beta.g) ? (
                  <>
                    {' '}
                    <span className="text-[#f2cf8a]">
                      Diqqat: m̂ shu ĝ da tartib uchun zarur bo&apos;lgan{' '}
                      {requiredM(snapshot.beta.g).toFixed(1)} dan past
                    </span>{' '}
                    — ya&apos;ni ma&apos;lumot konstantani pasaytirishni EMAS, minimal
                    ta&apos;sirlanish to&apos;sig&apos;ini saqlashni taklif qiladi.
                  </>
                ) : null}
              </p>
            )}

            {snapshot.g !== null && snapshot.g >= G_ORDER_FLIP ? (
              <div className="mt-3 rounded-control border border-[#3a3520] bg-[#15130d] p-4">
                <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
                  Diagnostika: global xato ulushi shu darajaga yetdi — bunda reyting bitta marta
                  ko&apos;rilib xato qilingan so&apos;zni ko&apos;p marta sinalgan ishonchli
                  so&apos;zdan ham yuqoriga chiqarib yuborishi mumkin. Buni ushlab turgan narsa
                  formulaning o&apos;zi emas — yuqoridagi &laquo;kamida 5 marta uchragan&raquo;
                  to&apos;siq. Bu halokat emas, shunchaki reytingga hozircha ehtiyot bilan
                  qarash kerakligini bildiradi.
                </p>
              </div>
            ) : null}
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
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 rounded-control px-2 py-2 transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
                    >
                      <span className="min-w-0">
                        {/* `lang` SHARTLI: dars nomi odatda inglizcha, lekin
                            nomsiz seansda o'zbekcha zaxira matn chiqadi. */}
                        <span
                          lang={session.lessonTitle === '' ? undefined : 'en'}
                          className="block truncate font-mono text-[13px] text-[#e6edf3]"
                        >
                          {session.lessonTitle === '' ? 'Nomsiz dars' : session.lessonTitle}
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-[#7d8b9c]">
                          {formatDateTime(session.startedAt > 0 ? session.startedAt : session.endedAt)}
                        </span>
                      </span>
                      <span className="font-mono text-[13px] tabular-nums text-[#5ee6c1]">
                        {formatWpm(session.netWpm)} wpm
                      </span>
                      <span className="w-14 text-right font-mono text-[13px] tabular-nums text-[#7d8b9c]">
                        {formatPercent(session.accuracy)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {snapshot.overview.sessionCount > SESSION_ROWS ? (
              <p className={`${NOTE} mt-4`}>
                Jami {snapshot.overview.sessionCount} ta seans saqlangan, shu yerda oxirgi{' '}
                {SESSION_ROWS} tasi ko&apos;rsatilgan.
              </p>
            ) : null}
          </section>

          {/*
            ⭐ M2/M3 gate (PLAN §8, §10). Rejaning 1-raqamli xatari: matn ko'rinib
            turgani uchun mashqni ovozsiz ham bajarish mumkin, ya'ni audio
            majburiy emas. Butun pedagogik da'vo shu oqimning e'tiborga
            olinishiga tayanadi — va uni tekshirishning yagona yo'li ovozli va
            ovozsiz mashqni yonma-yon qo'yish.

            TARTIB: bu bo'lim ATAYIN "oxirgi seanslar" dan KEYIN turadi — u
            tekshiruv-tajriba bo'limi, sahifadagi YAGONA interaktiv bo'lim esa
            "oxirgi seanslar" (har qator natijaga havola).
          */}
          <section className={`${PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className={LABEL}>ovozli / ovozsiz taqqoslash</h2>
              <span className="font-mono text-[11px] text-[#7d8b9c]">m2/m3 gate</span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <GateColumn title="ovoz yoqiq" bucket={snapshot.audio.on} accent="#5ee6c1" />
              <GateColumn title="ovoz o'chiq" bucket={snapshot.audio.off} accent="#7d8b9c" />
            </div>

            {snapshot.audio.on.sentences < GATE_MIN_SENTENCES ||
            snapshot.audio.off.sentences < GATE_MIN_SENTENCES ? (
              <p className={`${NOTE} mt-5`}>
                Xulosa uchun har ikkala holatda kamida {GATE_MIN_SENTENCES} tadan gap
                kerak. Hozir:{' '}
                <span className="text-[#7d8b9c]">
                  {snapshot.audio.on.sentences} ovozli / {snapshot.audio.off.sentences} ovozsiz
                </span>
                . Mashq ekranidagi ovoz tugmasini kunma-kun almashtirib boring.
              </p>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-control border border-white/[0.06] bg-[#0b1118] p-4">
                  <div className="font-mono text-[11px] text-[#7d8b9c]">wpm farqi</div>
                  <div className="mt-2 font-mono text-[16px] font-medium tabular-nums text-[#e6edf3]">
                    {formatWpmDelta(snapshot.audio.on.netWpm - snapshot.audio.off.netWpm)}
                  </div>
                </div>
                <div className="rounded-control border border-white/[0.06] bg-[#0b1118] p-4">
                  <div className="font-mono text-[11px] text-[#7d8b9c]">aniqlik farqi</div>
                  <div className="mt-2 font-mono text-[16px] font-medium tabular-nums text-[#e6edf3]">
                    {formatPercentDelta(snapshot.audio.on.accuracy - snapshot.audio.off.accuracy)}
                  </div>
                </div>
              </div>
            )}

            {snapshot.audio.unknown > 0 ? (
              <p className={`${NOTE} mt-4`}>
                {snapshot.audio.unknown} ta eski gapda ovoz holati yozilmagan — ular
                taqqoslashga kirmaydi.
              </p>
            ) : null}

            <p className={`${NOTE} mt-5 border-t border-white/[0.06] pt-4`}>
              Bir hafta kunma-kun ovozni yoqib/o&apos;chirib bir xil hajmda matn tering.
              Agar wpm va aniqlik farqi sezilarli bo&apos;lmasa — audio qayta
              ishlanmayapti va mexanikani qayta ko&apos;rib chiqish kerak. Bu raqamlar
              o&apos;sha qarorni qabul qilish uchun.
            </p>
          </section>
        </>
      ) : (
        <EmptyState
          title="Hali statistika yo'q"
          hint="Birinchi seansdan keyin bu yerda wpm trendi, aniqlik, seriya va eng qiyin so'zlar paydo bo'ladi. Boshqa brauzerdan zaxira fayli bo'lsa, uni quyida tiklash mumkin."
          action={
            <Link to="/" className={LINK_PRIMARY}>
              Darslar
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
        {/* Ikkita fayl kerakligini aytib qo'yish SHART: statistika zaxirasi seanslarni
            saqlaydi, lekin ular ishora qiladigan darslarni emas. Yolg'iz statistika bilan
            tiklangan brauzerda o'sha seanslar mavjud bo'lmagan darsga qarab qoladi —
            pastdagi "yaroqsiz yozuvlar" bloki aynan shunday paydo bo'ladi. */}
        <p className={`${NOTE} mt-2`}>
          Darslar va statistika ALOHIDA saqlanadi, shuning uchun to&apos;liq zaxira uchun
          ikkala fayl ham kerak: statistika seanslarni saqlaydi, lekin ular tegishli
          bo&apos;lgan matnlarni emas.
        </p>

        <StorageStatus
          persistState={persistState}
          estimate={estimate}
          requesting={requestingPersistence}
          onRequest={() => {
            void handleRequestPersistence()
          }}
        />

        {damaged.map((row) => (
          <div key={row.id} className="mt-4 rounded-control border border-[#3a3520] bg-[#15130d] p-4">
            <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
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
              <div className="mt-3 rounded-control border border-[#452027] bg-[#160f12] p-4">
                <p className="font-mono text-[13px] leading-relaxed text-[#ff9f9f]">
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
          <div className="mt-4 rounded-control border border-[#22303d] bg-[#0b0f14] p-4">
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

        {/* Ikki ombor — ikki guruh. Beshta tugmani bitta qatorga yig'ish "JSON
            eksport" yozuvini ikki marta takrorlab, qaysi biri nimani saqlashini
            faqat tartibga tashlab qo'yardi. Sarlavha esa buni har bir tugma
            uchun aytib turadi va "Hammasini o'chirish" ning FAQAT statistikaga
            tegishi ham shu guruhlash orqali ko'rinadi. */}
        <div className="mt-4 space-y-4">
          <div>
            <div className={LABEL}>statistika</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* ⚠️ `downloadJson` ASINXRON: to'g'ridan-to'g'ri `onClick` ga
                  berilsa, rad javobi hech kim ushlamaydigan bo'lib qolardi va
                  tugma jimgina "o'lik" ko'rinardi — fayl tushmaydi, xabar ham
                  yo'q. Shuning uchun `.catch` va ko'rinadigan xabar. */}
              <Button
                variant="ghost"
                onClick={() => {
                  setMessage(null)
                  void downloadJson().catch((err: unknown) => {
                    setMessage({
                      kind: 'error',
                      text: `Eksport qilib bo'lmadi: ${errorText(err)}`,
                    })
                  })
                }}
                disabled={!filled}
              >
                JSON eksport
              </Button>
              <Button variant="ghost" onClick={() => armImport('stats')}>
                JSON import
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setMessage(null)
                  setImportArmed(null)
                  setClearArmed(true)
                }}
                disabled={!filled}
              >
                Hammasini o&apos;chirish
              </Button>
            </div>
          </div>

          <div>
            <div className={LABEL}>darslar</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={downloadLessons} disabled={lessonCount === 0}>
                JSON eksport
              </Button>
              <Button variant="ghost" onClick={() => armImport('lessons')}>
                JSON import
              </Button>
            </div>
            {/* Dars kartasida IKKITA eksport bor va ulardan biri BOSHQA ish
                qiladi: `.txt` tashqi `tts.sh` quvuriga matn beradi, progress va
                ta'kidlashni esa tashlab yuboradi. `.json` esa aynan shu yerdagi
                fayl bilan bir xil, faqat bitta darsniki. */}
            <p className={`${NOTE} mt-2`}>
              Bu fayl HAMMA darsning butun holatini saqlaydi: matn, progress, tashlangan
              gaplar, ta&apos;kidlash, ovoz va tezlik. Bitta dars kerak bo&apos;lsa —
              kartadagi &laquo;.json eksport&raquo;; u ham shu yerdan va Import
              ekranidan tiklanadi. Kartadagi &laquo;.txt eksport&raquo; esa faqat gaplar
              matnini beradi — u tashqi quvur uchun, zaxira uchun emas.
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFile}
        />

        {importArmed === 'stats' ? (
          <div className="mt-4 rounded-control border border-[#3a3520] bg-[#15130d] p-4">
            {/* MA'LUMOT almashtiriladi (`stats.ts`: aks holda bitta faylni ikki marta
                import qilish yig'indilarni ikkilantirardi), UMRBOD HISOBLAGICHLAR esa
                `max()` bilan birlashadi (§9.5) — ular hech qachon orqaga yurmaydi.
                Ikkovi bir jumlaga sig'maydi, shuning uchun matn ochiq ajratilgan: eski
                zaxirani tiklab umumiy sonni PASAYTIRMOQCHI bo'lgan foydalanuvchi aks
                holda ular nega o'zgarmaganini tushunmasdi. Ogohlantirish fayl
                tanlashdan OLDIN ko'rsatiladi. */}
            <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
              Import mavjud MA&apos;LUMOTNI almashtiradi — birlashtirmaydi: hozirgi
              seanslar, kunlik yig&apos;indi va so&apos;z reytingi o&apos;rnini fayldagisi
              egallaydi. ⚠️ Bitta istisno — umrbod hisoblagichlar (jami seans, bosish,
              faol vaqt): ular ORQAGA YURMAYDI, ikkala manbaning kattarog&apos;i
              saqlanadi. Ya&apos;ni eski zaxirani tiklash bilan umumiy raqamlarni
              kamaytirib bo&apos;lmaydi. Avval joriy holatni eksport qilib qo&apos;yish
              tavsiya etiladi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                Fayl tanlash
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportArmed(null)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        ) : null}

        {importArmed === 'lessons' ? (
          <div className="mt-4 rounded-control border border-[#22303d] bg-[#0b0f14] p-4">
            {/* Rang ATAYIN sariq emas: statistika importidan farqli o'laroq bu yerda
                yo'qoladigan narsa yo'q — birlashtirish qoidasi va sababi
                `lessons.importLessonsJson` da yozilgan. Panel baribir ko'rsatiladi,
                chunki "import" so'zi yuqoridagi tugmadan keyin almashtirishni
                kutishga o'rgatib qo'ygan bo'lishi mumkin. */}
            <p className={NOTE}>
              Import mavjud darslarni SAQLAB QOLADI: fayldagi yangi darslar qo&apos;shiladi,
              allaqachon bor darsning mazmuni esa fayldagisi bilan yangilanadi. Progress
              orqaga surilmaydi — shu brauzerdagi dars uzoqroq o&apos;qilgan bo&apos;lsa,
              o&apos;sha holat qoladi.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                Fayl tanlash
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setImportArmed(null)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        ) : null}

        {clearArmed ? (
          <div className="mt-4 rounded-control border border-[#452027] bg-[#160f12] p-4">
            <p className="font-mono text-[13px] leading-relaxed text-[#ff9f9f]">
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
            className={`mt-4 font-mono text-[13px] leading-relaxed ${
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
