// Natijalar ekrani (PLAN §7) — bitta tugagan seansning yakuni.
// Marshrut: '/results/:sessionId'.
//
// MA'LUM CHEKLOV (integratsiya uchun muhim): `SessionRecord` ichida SO'Z bo'yicha
// xato hisobi saqlanmaydi — `recordSession(session, wordDelta)` dagi `wordDelta`
// umumiy `words` jadvaliga qo'shilib ketadi va seansga bog'lanmaydi. Shuning uchun
// bu yerdagi "qiyin so'zlar" ro'yxati SHU SEANSDA uchragan so'zlar bilan
// cheklanadi, xato ulushi esa BUTUN tarix bo'yicha hisoblanadi (PLAN §6 dagi
// "ta'sirlanishga nisbatan" qoidasi shu tarzda saqlanadi). Bu ekranda ochiq
// yozib qo'yilgan — foydalanuvchi ko'rsatkich qayerdan kelganini bilishi kerak.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { tokenize } from '../core/tokenize.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import { getLesson } from '../store/lessons.ts'
import { getSession, hardestWords, loadStats, streakDays } from '../store/stats.ts'
import type { SessionRecord } from '../store/stats.ts'
import { Sparkline } from '../components/Sparkline.tsx'

const PANEL = 'rounded-panel border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control px-5 py-2.5 font-mono text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2'
const BTN_PRIMARY = `${BTN_BASE} bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3] focus-visible:outline-[#5ee6c1]`
const BTN_GHOST = `${BTN_BASE} border border-white/10 bg-white/[0.03] text-[#e6edf3] hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-[#5ee6c1]`

/** Ro'yxatdagi so'zlar soni — undan ortig'i ekranni ma'nosiz uzaytiradi. */
const WORD_ROWS = 8

// ---------------------------------------------------------------------------
// Formatlash (ekran ichida lokal: bu yordamchilarni umumiy `utils` fayliga
// chiqarish hozircha erta abstraksiya bo'lardi — har bir ekran o'z shaklini
// biroz boshqacha talab qiladi)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "noma'lum vaqt"
  const d = new Date(ms)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Faol vaqt: `12 daq 30 sek`, uzun seans uchun `1 soat 05 daq`. */
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

/** Oldingi seansga nisbatan wpm farqi — "o'zgarishsiz" | "+3 wpm" | "-2 wpm". */
function formatWpmDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "o'zgarishsiz"
  const rounded = Math.round(delta)
  if (rounded === 0) return "o'zgarishsiz"
  return `${rounded > 0 ? '+' : ''}${rounded} wpm`
}

// ---------------------------------------------------------------------------
// Kichik UI bo'laklari
// ---------------------------------------------------------------------------

/**
 * Ochilishdagi bosqichma-bosqich paydo bo'lish. Tailwind ning tayyor
 * o'tishlaridan (transition) foydalanadi — bitta ekrandagi effekt uchun
 * `index.css` ga global `@keyframes` qo'shish shart emas.
 */
function Reveal({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      // Qo'llab-quvvatlanmasa — odatiy animatsiya.
    }
    if (reduced) {
      setShown(true)
      return
    }
    const timer = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`transition-all duration-500 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      {children}
    </div>
  )
}

function Metric({
  label,
  value,
  unit,
  color,
  hint,
}: {
  label: string
  value: string
  unit?: string
  color: string
  hint?: string
}) {
  return (
    <div className={`${PANEL} p-4 sm:p-5`}>
      <div className={LABEL}>{label}</div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[21px] leading-none font-semibold tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
        {unit !== undefined ? (
          <span className="font-mono text-[11px] text-[#7d8b9c]">{unit}</span>
        ) : null}
      </div>
      {hint !== undefined ? (
        <div className="mt-2 font-mono text-[11px] text-[#7d8b9c]">{hint}</div>
      ) : null}
    </div>
  )
}

function NotFound({ sessionId }: { sessionId: string }) {
  return (
    // `Layout.tsx` allaqachon <main>, markazlash va yon bo'shliqni beradi —
    // bu yerda faqat matnni torroq ustunga siqish qoladi.
    <div className="mx-auto w-full max-w-3xl">
      <Reveal>
        <div className={`${PANEL} p-8 text-center sm:p-12`}>
          <div className={LABEL}>seans topilmadi</div>
          <h1 className="mt-4 font-mono text-[21px] font-semibold text-[#e6edf3]">
            Bu seans yozuvi yo&apos;q
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-[#8b98a9]">
            {sessionId === ''
              ? "Manzilda seans raqami ko'rsatilmagan."
              : "Yozuv o'chirilgan, brauzer xotirasi tozalangan yoki manzildagi raqam noto'g'ri bo'lishi mumkin."}{' '}
            Umumiy statistika saqlanib qolgan bo'lsa, uni Statistika sahifasida ko&apos;rasiz.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/stats" className={BTN_PRIMARY}>
              Statistika
            </Link>
            <Link to="/" className={BTN_GHOST}>
              Darslar
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seansdagi qiyin so'zlar
// ---------------------------------------------------------------------------

type WordRow = { word: string; exposures: number; errors: number; rate: number }

/**
 * Shu seansda TERILGAN gaplardagi so'zlar to'plamini yig'adi va ular ichidan
 * xato ulushi eng yuqori bo'lganlarini qaytaradi.
 *
 * `hardestWords(1, ...)` chaqiriladi — chegara 1 ga tushiriladi, chunki bitta
 * seansdan keyin ko'p so'z hali 5 martadan kam uchragan bo'ladi va standart
 * chegara bilan ro'yxat doim bo'sh chiqardi. Umumiy Statistika ekranida esa
 * PLAN §6 dagi 5 martalik chegara saqlanadi.
 */
function sessionWordRows(session: SessionRecord): WordRow[] {
  const lesson = getLesson(session.lessonId)
  if (lesson === null) return []

  const seen = new Set<string>()
  for (const record of session.sentences) {
    if (record.skipped) continue
    const sentence = lesson.sentences[record.sentenceIndex]
    if (sentence === undefined) continue
    for (const token of tokenize(sentence)) {
      if (token.kind !== 'word') continue
      seen.add(token.text.toLowerCase())
    }
  }
  if (seen.size === 0) return []

  const rows: WordRow[] = []
  for (const row of hardestWords(1, 5_000)) {
    if (row.errors === 0) continue
    if (!seen.has(row.word)) continue
    rows.push(row)
    if (rows.length >= WORD_ROWS) break
  }
  return rows
}

// ---------------------------------------------------------------------------
// Taqqoslash konteksti — bu seansdan OLDINGI seansni topadi
// ---------------------------------------------------------------------------

/**
 * `startedAt` bo'yicha saralangan seanslar ro'yxatida shu seansdan bevosita
 * oldingisi. Birinchi seans bo'lsa (yoki hozirgisi ro'yxatda topilmasa)
 * `null` — chaqiruvchi taqqoslash qatorini shunchaki chizmaydi.
 */
function previousSession(current: SessionRecord): SessionRecord | null {
  const ordered = [...loadStats().sessions].sort((a, b) => a.startedAt - b.startedAt)
  const index = ordered.findIndex((item) => item.id === current.id)
  return index > 0 ? (ordered[index - 1] ?? null) : null
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

export function Results() {
  const params = useParams()
  const sessionId = params['sessionId'] ?? ''

  // `localStorage` dan faqat `sessionId` o'zgarganda o'qiladi. `useState`
  // ishlatilmaydi: react-router bir marshrutning ichida komponentni QAYTA
  // ULAMAYDI, ya'ni boshqa seansga o'tilganda eski yozuv ekranda qolib ketardi.
  //
  // `lesson` shu yerda ham o'qiladi (`sessionWordRows` ichida allaqachon
  // chaqirilgani uchun arzon): "Davom ettirish" darsning o'zi o'chirilganmi
  // yoki tugaganmi bilishi kerak, buni faqat `session.lessonId` bo'sh emasligi
  // bilan tekshirib bo'lmaydi.
  const { session, words, lesson, previous } = useMemo(() => {
    const found: SessionRecord | null = sessionId === '' ? null : getSession(sessionId)
    return {
      session: found,
      words: found === null ? [] : sessionWordRows(found),
      lesson: found === null ? null : getLesson(found.lessonId),
      previous: found === null ? null : previousSession(found),
    }
  }, [sessionId])

  // Sarlavha SESSIYA HOLATIGA qarab tanlanadi, shuning uchun hook har ikki
  // holatda ham (topilgan/topilmagan) bir xil tartibda chaqiriladi — u pastdagi
  // erta `return` dan OLDIN turishi shart (React Hooks qoidasi).
  const lessonTitle =
    session === null ? '' : session.lessonTitle === '' ? 'Nomsiz dars' : session.lessonTitle
  useDocumentTitle(session === null ? 'Topilmadi' : `${lessonTitle} — seans yakuni`)

  if (session === null) return <NotFound sessionId={sessionId} />

  const written = session.sentences.filter((record) => !record.skipped)
  const skippedCount = session.sentences.length - written.length
  const restarts = written.reduce((sum, record) => sum + record.restarts, 0)
  const wpmSeries = written.map((record) => record.netWpm)

  // To'rtta holat: dars o'chirilgan (`lesson === null`) bo'lsa mashq havolasi
  // umuman ko'rsatilmaydi — u berk ko'chaga olib borardi. Qolgan uchtasi
  // `Home.tsx` dagi karta bilan BIR XIL qoidaga bo'ysunadi, chunki ikkovi ham
  // AYNAN bitta manzilga (`/practice/:id`) boradi va u yerda seans qaysi gapdan
  // boshlanishini `session.ts` dagi `nextSentenceIndex` hal qiladi:
  //   - tugagan, tashlangani yo'q  -> 0-gap        -> "Darsni qaytadan boshlash"
  //   - tugagan, tashlangani bor   -> eng kichik   -> "Tashlanganlarni yozish"
  //   - tugamagan                  -> keyingi gap  -> "Davom ettirish"
  // Yorliq shu uchtasidan chetga chiqsa foydalanuvchini aldaydi: ilgari bu yerda
  // "Darsni qaytadan boshlash" deb yozilgan-u, `nextSentenceIndex` uni tashlangan
  // gapga olib borardi.
  const lessonTotal = lesson === null ? 0 : lesson.sentences.length
  const lessonDone = lesson === null ? 0 : Math.min(Math.max(0, lesson.progress), lessonTotal)
  const lessonFinished = lessonTotal > 0 && lessonDone >= lessonTotal
  // Yaroqsiz indekslar `nextSentenceIndex` dagi bilan bir xil qoida bo'yicha
  // chiqarib tashlanadi — ro'yxat `localStorage` dan keladi va ishonchsiz.
  const pendingSkipped =
    lesson === null
      ? 0
      : (lesson.skipped ?? []).filter(
          (raw) =>
            Number.isFinite(raw) && Math.floor(raw) >= 0 && Math.floor(raw) < lessonTotal,
        ).length
  const allDone = lessonFinished && pendingSkipped === 0
  const practiceLabel = allDone
    ? 'Darsni qaytadan boshlash'
    : lessonFinished
      ? 'Tashlanganlarni yozish'
      : 'Davom ettirish'
  const showPracticeLink = lesson !== null
  const streak = streakDays()

  return (
    // Ildiz ATAYLAB oddiy <div>: <main>, markazlash, kenglik chegarasi va yon
    // bo'shliq `Layout.tsx` da bir marta beriladi. Ikkinchi <main> HTML ni
    // buzardi va ekran o'quvchiga ikkita "asosiy qism" ko'rsatardi.
    <div className="w-full">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className={LABEL}>seans yakuni</div>
            {/* `lang` SHARTLI — `Practice.tsx` dagi sarlavha bilan bir xil sabab:
                nomsiz darsda o'zbekcha zaxira matn chiqadi. */}
            <h1
              lang={session.lessonTitle === '' ? undefined : 'en'}
              className="mt-2 truncate font-mono text-[21px] font-semibold text-[#e6edf3]"
            >
              {lessonTitle}
            </h1>
            <p className="mt-1.5 font-mono text-[11px] text-[#7d8b9c]">
              {formatDateTime(session.startedAt > 0 ? session.startedAt : session.endedAt)}
            </p>
          </div>
          <Link
            to="/"
            className="font-mono text-[11px] text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
          >
            Darslar
          </Link>
        </div>
      </Reveal>

      {/* Asosiy ko'rsatkich: butun ekranning yagona urg'usi. */}
      <Reveal delay={70}>
        <section className={`${PANEL} mt-6 overflow-hidden`}>
          <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
            <div>
              <div className={LABEL}>net wpm</div>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="font-mono text-[60px] leading-none font-semibold tracking-tight text-[#5ee6c1] tabular-nums">
                  {formatWpm(session.netWpm)}
                </span>
                <span className="font-mono text-[13px] font-medium tracking-[0.22em] text-[#7d8b9c] uppercase">
                  so&apos;z / daq
                </span>
              </div>
              <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-[#7d8b9c]">
                Faqat to&apos;g&apos;ri yozilgan belgilar hisobga olingan; 5 belgi = 1 so&apos;z.
              </p>

              {/* Taqqoslash konteksti: mutlaq raqamning o'zi "bu yaxshimi?" degan
                  savolga javob bermaydi. Uch qator yetarli — yangi grafik shart emas. */}
              <div className="mt-4 space-y-1 font-mono text-[12px] text-[#7d8b9c]">
                {previous !== null ? (
                  <p>Oldingi seansdan: {formatWpmDelta(session.netWpm - previous.netWpm)}</p>
                ) : null}
                {lesson !== null ? (
                  <p>
                    Darsda: {lessonDone} / {lessonTotal} gap
                  </p>
                ) : null}
                <p>Seriya: {streak} kun</p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:text-right">
              <div>
                <dt className={LABEL}>xatolar</dt>
                <dd className="mt-1.5 font-mono text-[16px] font-medium text-[#ff6b6b] tabular-nums">
                  {Math.max(0, Math.round(session.keystrokes - session.correctKeystrokes))}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>qayta boshlash</dt>
                <dd className="mt-1.5 font-mono text-[16px] font-medium text-[#e6edf3] tabular-nums">
                  {restarts}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>bosishlar</dt>
                <dd className="mt-1.5 font-mono text-[16px] font-medium text-[#e6edf3] tabular-nums">
                  {Math.round(session.keystrokes)}
                </dd>
              </div>
              <div>
                <dt className={LABEL}>tashlangan</dt>
                <dd className="mt-1.5 font-mono text-[16px] font-medium text-[#e6edf3] tabular-nums">
                  {skippedCount}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-white/[0.06] px-6 py-5 sm:px-8">
            <Sparkline
              values={wpmSeries}
              label="gaplar bo'yicha net wpm"
              width={480}
              height={84}
            />
            <p className="mt-3 font-mono text-[11px] text-[#7d8b9c]">
              Har bir nuqta — bitta gap. Tashlangan gaplar (Escape) chizmaga kirmaydi.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal delay={140}>
        <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric
            label="raw wpm"
            value={formatWpm(session.rawWpm)}
            unit="so'z / daq"
            color="#6ba8ff"
            hint="Xato bosishlar ham qo'shilgan"
          />
          <Metric
            label="aniqlik"
            value={formatPercent(session.accuracy)}
            color="#f2b544"
            hint="To'g'ri bosishlar / jami"
          />
          <Metric
            label="faol vaqt"
            value={formatDuration(session.activeMs)}
            color="#e6edf3"
            hint="5 sekunddan uzun tanaffuslar chiqarilgan"
          />
          <Metric
            label="yozilgan gaplar"
            value={String(written.length)}
            unit={`/ ${session.sentences.length}`}
            color="#e6edf3"
            hint={skippedCount > 0 ? `${skippedCount} ta gap tashlangan` : 'Hammasi yozib tugatilgan'}
          />
        </section>
      </Reveal>

      <Reveal delay={210}>
        <section className={`${PANEL} mt-4 p-6 sm:p-8`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={LABEL}>shu seansdagi qiyin so&apos;zlar</h2>
            <span className="font-mono text-[11px] text-[#7d8b9c]">
              xato / ta&apos;sirlanish
            </span>
          </div>

          {words.length === 0 ? (
            <p className="mt-5 text-[13px] leading-relaxed text-[#7d8b9c]">
              Bu seansdagi so&apos;zlarda qayd etilgan xato yo&apos;q — yoki dars
              o&apos;chirilgani uchun so&apos;zlar ro&apos;yxatini tiklab bo&apos;lmadi.
            </p>
          ) : (
            <ul className="mt-5 space-y-2.5">
              {words.map((row) => (
                <li key={row.word} className="flex items-center gap-3 sm:gap-4">
                  <span
                    lang="en"
                    className="w-28 shrink-0 truncate font-mono text-[13px] text-[#e6edf3] sm:w-40"
                  >
                    {row.word}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <span
                      className="block h-full rounded-full bg-[#ff6b6b]/80"
                      style={{ width: `${Math.max(3, Math.min(100, row.rate * 100))}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[13px] text-[#ff8b8b] tabular-nums">
                    {Math.round(row.rate * 100)}%
                  </span>
                  <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] text-[#7d8b9c] tabular-nums sm:block">
                    {row.errors}/{row.exposures}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 border-t border-white/[0.06] pt-4 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
            Ro&apos;yxat shu seansda uchragan so&apos;zlardan tuzilgan, xato ulushi esa
            butun tarix bo&apos;yicha hisoblangan — so&apos;z xatolari seansga
            bog&apos;lanmagan holda saqlanadi.
          </p>
        </section>
      </Reveal>

      <Reveal delay={280}>
        <div className="mt-6 flex flex-wrap gap-3">
          {/* Manzil uchala holatda ham BITTA — farq faqat yorliqda, shuning uchun
              ilgarigi ikkita bir xil `to` li `<Link>` bittaga yig'ildi. */}
          {showPracticeLink ? (
            <Link to={`/practice/${encodeURIComponent(session.lessonId)}`} className={BTN_PRIMARY}>
              {practiceLabel}
            </Link>
          ) : null}
          <Link to="/stats" className={BTN_GHOST}>
            Statistika
          </Link>
          {/* Dars tugagan yoki o'chirilgan bo'lsa "keyingi qadam" mashq emas —
              darslar ro'yxatiga qaytish yo'li ochiq turishi kerak. */}
          {allDone || lesson === null ? (
            <Link to="/" className={BTN_GHOST}>
              Darslar
            </Link>
          ) : null}
        </div>
      </Reveal>
    </div>
  )
}

export default Results
