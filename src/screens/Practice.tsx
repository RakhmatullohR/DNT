// Mashq ekrani (PLAN §4, §5b, §7) — marshrut: '/practice/:lessonId'.
//
// Bu fayl FAQAT chizadi. Klaviatura, audio, taymer, statistika va seans
// tugagach '/results/:sessionId' ga o'tish — hammasi `useTypingSession` ichida.
// Shu yerda `window` ga birorta ham tinglovchi qo'shilmaydi: `Enter`/`Tab`/
// `Escape` ni hook allaqachon eshitadi va ikkinchi tinglovchi har bosishni ikki
// marta hisoblab yuborardi. Shu sababli "Enter bosing" ko'rsatkichi ham
// tugma emas, balki shunchaki ko'rsatma.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '../components/Button.tsx'
import type { TypingState } from '../core/types.ts'
import type { BlockedKey } from '../hooks/useTypingSession.ts'
import { useTypingSession } from '../hooks/useTypingSession.ts'
import type { Lesson } from '../store/lessons.ts'
import { getLesson } from '../store/lessons.ts'

const PANEL = 'rounded-2xl border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[10px] uppercase tracking-[0.22em] text-[#7d8b9c]'
const KBD =
  'rounded-sm border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-[#c6d3de]'
/** `Link` tugma ko'rinishida — `Button.tsx` faqat `<button>` chiqaradi. */
const LINK_BTN_BASE =
  'inline-flex h-10 items-center justify-center rounded-sm border px-4 font-mono text-[13px] font-medium tracking-[0.04em] transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14] focus-visible:outline-none'
const LINK_BTN_PRIMARY = `${LINK_BTN_BASE} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`
const LINK_BTN_GHOST = `${LINK_BTN_BASE} border-[#22303d] text-[#c6d3de] hover:border-[#334556] hover:bg-[#131b23] hover:text-[#e6edf3]`

/** Yorliqlar: bosishlarni HOOK bajaradi, bu yerda faqat hujjatlashtiriladi (PLAN §4). */
const SHORTCUTS: readonly { key: string; text: string }[] = [
  { key: 'Enter', text: 'keyingi gap' },
  { key: 'Tab', text: 'gapni qaytadan' },
  { key: 'Esc', text: 'gapni tashlash' },
]

// ---------------------------------------------------------------------------
// Formatlash (ataylab shu fayl ichida — `Results.tsx` dagi bilan bir xil qaror:
// ikki ekran uchun umumiy yordamchi fayl ochish erta abstraksiya bo'lardi)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Qolgan vaqt `mm:ss`. `ceil` — seans boshida soat `09:59` emas, `10:00` ko'rinsin. */
function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/** HUD uchun butun foiz: o'nlik kasr har bosishda sakrab, o'qishga xalaqit beradi. */
function formatPercent(ratio: number): string {
  const safe = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, ratio) : 0
  return `${Math.round(safe * 100)}%`
}

function formatWpm(value: number): string {
  return String(Math.round(Number.isFinite(value) && value > 0 ? value : 0))
}

/** Ko'rinmas belgining nomi — xabarda «&nbsp;» hech narsa ko'rsatmaydi. */
function keyName(char: string): string {
  if (char === ' ') return 'probel'
  return `«${char}»`
}

function ratioToPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, value) * 100
}

// ---------------------------------------------------------------------------
// Kichik UI bo'laklari
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string
  value: string
  unit?: string
  color: string
}) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className="font-mono text-2xl leading-none font-semibold tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
        {unit !== undefined ? (
          <span className="font-mono text-[10.5px] tracking-wide text-[#5c6b7d]">{unit}</span>
        ) : null}
      </div>
    </div>
  )
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <span
        className="block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `${ratioToPercent(value)}%`, backgroundColor: color }}
      />
    </span>
  )
}

/**
 * Xato bosish ko'rsatkichi.
 *
 * Ota komponent buni `blocked.nonce` bilan kalitlaydi — ya'ni har xatoda
 * komponent QAYTA ULANADI. `nonce` aynan shuning uchun bor: ketma-ket bir xil
 * noto'g'ri tugma bosilganda matn o'zgarmaydi va React hech narsani yangilamas,
 * qayta ulanish esa quyidagi chaqnashni boshidan qo'yadi.
 */
function BlockedHint({ blocked, expected }: { blocked: BlockedKey; expected: string | undefined }) {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    // Bir kadr keyin — CSS o'tishi boshlang'ich holatni ko'rib ulgursin
    // (`ServerBanner.tsx` dagi bilan bir xil usul). StrictMode ikkinchi
    // chaqiruvida `cancelAnimationFrame` eski kadrni olib tashlaydi.
    const id = requestAnimationFrame(() => {
      setSettled(true)
    })
    return () => {
      cancelAnimationFrame(id)
    }
  }, [])

  // Faqat registr farq qilyapti — bu eng ko'p uchraydigan xato, chunki bosh
  // harf QAT'IY (PLAN §4 "Chegaraviy holatlar": `t` va `T` teng emas).
  const caseOnly =
    expected !== undefined &&
    expected !== blocked.wrong &&
    expected.toLowerCase() === blocked.wrong.toLowerCase()
  const needsShift = caseOnly && expected !== undefined && expected !== expected.toLowerCase()

  return (
    <div
      className={[
        'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-[#ff6b6b]/40 px-4 py-3',
        'origin-left transition-all duration-300 ease-out motion-reduce:transition-none',
        settled ? 'scale-100 bg-[#ff6b6b]/[0.07]' : 'scale-[1.02] bg-[#ff6b6b]/25',
      ].join(' ')}
    >
      <span className="font-mono text-[10px] tracking-[0.22em] text-[#ff8b8b] uppercase">
        xato
      </span>
      <span className="font-mono text-[12.5px] text-[#f0c9c9]">
        {keyName(blocked.wrong)} bosildi — kursor turib qoldi.
      </span>
      {expected === undefined ? null : (
        <span className="font-mono text-[12.5px] text-[#8b98a9]">
          {caseOnly
            ? needsShift
              ? `Shift kerak: ${keyName(expected)}`
              : `Caps Lock yoqiq bo'lishi mumkin: ${keyName(expected)}`
            : `Kutilgan belgi: ${keyName(expected)}`}
        </span>
      )}
    </div>
  )
}

/**
 * Gapni belgima-belgi chizadi.
 *
 * `split('')` — UTF-16 birliklari, ya'ni indekslar `state.cursor` va
 * `state.charErrors` kalitlari bilan AYNAN mos tushadi. `Array.from` kod
 * nuqtalari bo'yicha bo'lgani uchun bu yerda mos kelmasdi; matn `normalize.ts`
 * dan keyin ASCII bo'lgani uchun ikkalasi amalda bir xil natija beradi.
 */
function Sentence({ state, blocked }: { state: TypingState; blocked: BlockedKey | null }) {
  const chars = state.target.split('')
  const caretColor = blocked === null ? '#5ee6c1' : '#ff6b6b'

  return (
    <>
      {/* Belgilarga bo'lingan matnni ekran o'quvchisi harflab o'qib chiqardi. */}
      <div
        aria-hidden="true"
        className="font-mono text-[21px] leading-[1.85] tracking-[0.01em] break-words whitespace-pre-wrap sm:text-[25px]"
      >
        {chars.map((ch, i) => {
          const errors = state.charErrors.get(i) ?? 0

          if (i === state.cursor) {
            return (
              <span
                key={i}
                className={[
                  'relative rounded-[3px]',
                  blocked === null
                    ? 'bg-[#5ee6c1]/15 text-[#e6edf3]'
                    : 'bg-[#ff6b6b]/20 text-[#ffc2c2]',
                ].join(' ')}
              >
                {/* Kursor chizig'i alohida element: probel ustida ham ko'rinadi. */}
                <span
                  className="absolute top-[0.12em] bottom-[0.12em] -left-px w-[2px] animate-pulse rounded-full motion-reduce:animate-none"
                  style={{ backgroundColor: caretColor }}
                />
                {/* Kursor probel ustida turganda uzilmas probel qo'yiladi: oddiy probel
                    qator oxiriga tushib qolsa kursor ko'rinmay ketardi. */}
                {ch === ' ' ? '\u00a0' : ch}
              </span>
            )
          }

          if (i < state.cursor) {
            // Yozib bo'lingan: xato qilingan joy sariq bo'lib qoladi —
            // gap oxirida qayerda qoqilgani ko'rinib tursin.
            return (
              <span key={i} className={errors > 0 ? 'text-[#f2b544]' : 'text-[#e6edf3]'}>
                {ch}
              </span>
            )
          }

          // Hali yozilmagan. `Backspace` dan keyin kursor ORQAGA qaytishi mumkin,
          // shuning uchun oldinda ham xatosi bor pozitsiya uchraydi.
          return (
            <span key={i} className={errors > 0 ? 'text-[#8a6a70]' : 'text-[#46566a]'}>
              {ch}
            </span>
          )
        })}

        {state.cursor >= chars.length ? (
          <span
            className="ml-px inline-block h-[1em] w-[2px] animate-pulse rounded-full align-[-0.15em] motion-reduce:animate-none"
            style={{ backgroundColor: caretColor }}
          />
        ) : null}
      </div>

      <p className="sr-only">{state.target}</p>
    </>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className={`${PANEL} p-8 text-center sm:p-12`}>
        <div className={LABEL}>dars ochilmadi</div>
        <h1 className="mt-4 font-mono text-2xl font-semibold text-[#e6edf3]">
          Mashqni boshlab bo&apos;lmadi
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#8b98a9]">{message}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className={LINK_BTN_PRIMARY}>
            Darslar
          </Link>
          <Link to="/import" className={LINK_BTN_GHOST}>
            Yangi matn import qilish
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seans (hook shu yerda chaqiriladi)
// ---------------------------------------------------------------------------

function Session({ lesson }: { lesson: Lesson }) {
  const session = useTypingSession(lesson)
  const { state, blocked, awaitingNext } = session
  const expected = state.target[state.cursor]

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={LABEL}>mashq</div>
          <h1 className="mt-2 truncate font-mono text-lg font-semibold text-[#e6edf3] sm:text-xl">
            {lesson.title === '' ? 'Nomsiz dars' : lesson.title}
          </h1>
          <p className="mt-1.5 font-mono text-[11px] text-[#5c6b7d] tabular-nums">
            dars ichida {session.sentenceIndex + 1} / {lesson.sentences.length}-gap
          </p>
        </div>
        <Link
          to="/"
          className="font-mono text-[11px] tracking-wide text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ba8ff]"
        >
          Mashqni to&apos;xtatish
        </Link>
      </div>

      {/* HUD */}
      <section className={`${PANEL} mt-5 p-4 sm:p-5`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="gap"
            value={String(session.sentenceNo)}
            unit={`/ ${session.sessionTotal}`}
            color="#e6edf3"
          />
          <Stat
            label="net wpm"
            value={formatWpm(session.netWpm)}
            unit="so'z / daq"
            color="#4fe0a8"
          />
          <Stat label="aniqlik" value={formatPercent(session.accuracy)} color="#f2b544" />
          <Stat label="qolgan vaqt" value={formatClock(session.remainingMs)} color="#6ba8ff" />
        </div>

        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>gaplar</span>
              <span className="font-mono text-[10.5px] text-[#5c6b7d] tabular-nums">
                {formatPercent(session.sentenceProgress)}
              </span>
            </div>
            <div className="mt-2">
              <Bar value={session.sentenceProgress} color="#4fe0a8" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>vaqt</span>
              <span className="font-mono text-[10.5px] text-[#5c6b7d] tabular-nums">
                {formatPercent(session.timeProgress)}
              </span>
            </div>
            <div className="mt-2">
              {/* Oxirgi o'ndan bir qismda rang qizaradi — seans tugashi yaqin. */}
              <Bar
                value={session.timeProgress}
                color={session.timeProgress >= 0.9 ? '#ff6b6b' : '#6ba8ff'}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Yozuv maydoni. Bu yerda matn kiritish elementi YO'Q: hook `INPUT`,
          `TEXTAREA`, `SELECT` va `contenteditable` ustidagi bosishlarni o'ziga
          olmaydi, ya'ni maydon faqat shunday holatda ishlaydi.

          `tabIndex={0}` — maydon fokus olsin (fokus halqasi qayerda yozilayotganini
          ko'rsatadi). Mashq paytida oldinga `Tab` gapni qaytadan boshlaydi,
          shuning uchun bu yerga sichqoncha yoki `Shift+Tab` bilan kelinadi.
          `role`/`aria-label` esa ekran o'quvchisi uchun nomni beradi — nomsiz
          fokus nuqtasi "guruh" bo'lib o'qilardi. */}
      <section
        tabIndex={0}
        role="region"
        aria-label="Yozuv maydoni"
        className={`${PANEL} mt-4 p-6 focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14] focus-visible:outline-none sm:p-8`}
      >
        <Sentence state={state} blocked={blocked} />
      </section>

      {/* Balandligi o'zgarmaydi — xabar almashganda ekran sakramasin. */}
      <div role="status" aria-live="polite" className="mt-3 min-h-[54px]">
        {awaitingNext ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-[#5ee6c1]/40 bg-[#5ee6c1]/[0.07] px-4 py-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#5ee6c1] motion-reduce:animate-none"
            />
            <span className="font-mono text-[10px] tracking-[0.22em] text-[#5ee6c1] uppercase">
              gap tugadi
            </span>
            <span className="font-mono text-[12.5px] text-[#c6d3de]">
              Keyingi gapga o&apos;tish uchun <kbd className={KBD}>Enter</kbd> bosing.
            </span>
          </div>
        ) : blocked !== null ? (
          <BlockedHint key={blocked.nonce} blocked={blocked} expected={expected} />
        ) : (
          <p className="px-1 py-3 font-mono text-[12.5px] text-[#5c6b7d]">
            Eshitgan so&apos;zingizni yozing. Noto&apos;g&apos;ri belgida kursor joyida turadi.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={session.audioEnabled}
            onClick={session.toggleAudio}
          >
            <span
              aria-hidden="true"
              className={[
                'h-1.5 w-1.5 rounded-full',
                session.audioEnabled ? 'bg-[#5ee6c1]' : 'bg-[#4a5768]',
              ].join(' ')}
            />
            {session.audioEnabled ? 'Ovoz yoniq' : "Ovoz o'chiq"}
          </Button>

          {/* Umumiy `ServerBanner` ulanish yo'qligini aytadi; bu belgi esa
              ayni damda QAYSI ovoz eshitilayotganini tugmaning yonida ko'rsatadi. */}
          {session.audioEnabled && !session.serverOk ? (
            <span className="rounded-sm border border-[#3a2c12] bg-[#151007] px-2 py-1 font-mono text-[10.5px] text-[#e0cfa8]">
              zaxira: brauzer ovozi
            </span>
          ) : null}
        </div>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {SHORTCUTS.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <kbd className={KBD}>{item.key}</kbd>
              <span className="font-mono text-[11px] text-[#7d8b9c]">{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 border-t border-white/[0.06] pt-4 font-mono text-[11px] leading-relaxed text-[#5c6b7d]">
        Seans {session.sessionTotal} ta gap yoki 10 daqiqa bilan cheklangan — qaysi biri
        oldin tugasa, natijalar ekrani ochiladi. Tashlangan gap (Esc) statistikaga kirmaydi,
        qayta boshlangan urinish (Tab) ham yozilmaydi.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

/**
 * Tashqi komponent faqat darsni topadi.
 *
 * Ikkiga bo'linishning sababi: `useTypingSession` shartli chaqirilishi mumkin
 * emas, dars topilmasa esa ERTA qaytish kerak. Shuning uchun hook faqat dars
 * `null` emasligi ANIQLANGANDAN keyin ulanadigan `Session` ichida chaqiriladi.
 *
 * `key={lesson.id}` ham shart: react-router bitta marshrut ichida komponentni
 * qayta ulamaydi, hook esa boshlanish gapini (`startIndex`) bir marta oladi —
 * kalitsiz boshqa darsga o'tilganda seans eski joyidan davom etardi.
 */
export function Practice() {
  const params = useParams()
  const lessonId = params['lessonId'] ?? ''

  const lesson = useMemo(() => (lessonId === '' ? null : getLesson(lessonId)), [lessonId])

  if (lesson === null) {
    return (
      <NotFound
        message={
          lessonId === ''
            ? "Manzilda dars raqami ko'rsatilmagan."
            : "Dars o'chirilgan, brauzer xotirasi tozalangan yoki manzildagi raqam noto'g'ri bo'lishi mumkin."
        }
      />
    )
  }

  // Gapsiz darsda yoziladigan narsaning o'zi yo'q — hook bo'sh matn bilan
  // hech qachon tugamaydigan seansga tushib qolardi.
  if (lesson.sentences.length === 0) {
    return <NotFound message="Bu darsda birorta ham gap yo'q — matnni qaytadan import qiling." />
  }

  return <Session key={lesson.id} lesson={lesson} />
}

export default Practice
