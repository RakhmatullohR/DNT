// Bosh sahifa (PLAN §7) — darslar kutubxonasi va ilovaning kirish nuqtasi.
// Marshrut: '/'. "Dars" — bitta import qilingan matn; seans esa uning bir bo'lagi.
//
// Yuqoridagi yig'indi ATAYIN kichik: bu yerda faqat "bugun qanday ketyapman"
// degan savolga javob beriladi, chuqur ko'rinish Statistika ekranida.

import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { DEFAULT_RATE, DEFAULT_VOICE, RATES, VOICES } from '../../shared/filename.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { deleteLesson, getLesson, listLessons, saveLesson, setProgress } from '../store/lessons.ts'
import type { Lesson } from '../store/lessons.ts'
import { streakDays, totals } from '../store/stats.ts'

const PANEL = 'rounded-2xl border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
// Maydon uslubi `Import.tsx` dagi bilan bir xil: ikkala ekranda ham AYNAN shu
// ikki ro'yxat tanlanadi, ko'rinishi ham farq qilmasligi kerak.
const FIELD = [
  'w-full rounded-lg border border-white/[0.07] bg-[#0b1219] px-3 py-2.5',
  'font-mono text-[13px] text-[#e6edf3] placeholder:text-[#7d8b9c]',
  'transition-colors duration-150 ease-out hover:border-white/[0.12]',
  'focus:border-[#5ee6c1] focus:outline-none',
  'focus-visible:ring-2 focus-visible:ring-[#5ee6c1]',
].join(' ')

// Havola tugma ko'rinishida: `Button` — bu <button>, uni <a> ichiga solib
// bo'lmaydi, shuning uchun navigatsiya uchun `Link` o'z sinflarini oladi.
// Ko'rinish `Button.tsx` dagi `md` o'lchami bilan bir xil qilib olingan.
const LINK_BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-4 font-mono text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]'
const LINK_PRIMARY = `${LINK_BTN} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`

// ---------------------------------------------------------------------------
// Formatlash (ekran ichida lokal — `Results.tsx` dagi tartib bilan bir xil)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "noma'lum sana"
  const d = new Date(ms)
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`
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

/**
 * Bir xonali kasr — Statistika va Natijalar ekranlaridagi bilan BIR XIL shakl.
 * Yaxlitlash bu yerda mumkin emas: yonidagi &laquo;Batafsil&raquo; to'g'ri
 * Statistikaga olib boradi va bitta bosishda `94%` -> `93.7%` ni ko'rgan
 * foydalanuvchi ikkovidan qaysi biri yolg'on ekanini bilmay qoladi.
 */
function formatPercent(ratio: number): string {
  const safe = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, ratio) : 0
  return `${(safe * 100).toFixed(1)}%`
}

/** `en-US-AvaNeural` -> `Ava · en-US`. Saqlanadigan qiymat XOM qoladi. */
function voiceLabel(voice: string): string {
  const match = /^(en-[A-Z]{2})-(.+?)Neural$/.exec(voice)
  if (match === null) return voice
  return `${match[2]} · ${match[1]}`
}

function rateLabel(rate: number): string {
  if (rate === 0) return '0% — odatiy'
  return `${rate}% — sekinroq`
}

// ---------------------------------------------------------------------------
// Gaplarni `.txt` ga eksport qilish (PLAN §10)
// ---------------------------------------------------------------------------

/** Sarlavhadan xavfsiz fayl nomi. Bo'sh qolsa dars `id` si ishlatiladi. */
function safeFileName(lesson: Lesson): string {
  const base = lesson.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return base === '' ? lesson.id : base
}

/**
 * Darsni tashqi `noji/phrasal-verbs/tts.sh` quvuri qabul qiladigan ko'rinishda
 * yuklab beradi: har satrda bitta gap, raqamsiz va hech qanday sarlavhasiz.
 *
 * Nega kerak (PLAN §10): bu ilova so'zlarni ALOHIDA sintez qiladi, ya'ni
 * bog'langan nutqni umuman o'rgatmaydi. Tinglab tushunish mashqi o'sha tashqi
 * quvurda qoladi va unga matnni olib o'tish yo'li ochiq bo'lishi kerak.
 */
function downloadSentences(lesson: Lesson): void {
  const blob = new Blob([`${lesson.sentences.join('\n')}\n`], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeFileName(lesson)}.txt`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Bekor qilish keyingi tsiklga qoldiriladi: darhol chaqirilsa ayrim brauzerlar
  // yuklashni boshlashga ulgurmay, fayl bo'sh tushadi.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---------------------------------------------------------------------------
// Yig'indi
// ---------------------------------------------------------------------------

type Summary = {
  sessions: number
  activeMs: number
  netWpm: number
  accuracy: number
  streak: number
}

function readSummary(): Summary {
  return { ...totals(), streak: streakDays() }
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd
        className={`mt-1.5 font-mono text-[21px] font-semibold tabular-nums ${
          accent ? 'text-[#5ee6c1]' : 'text-[#e6edf3]'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dars kartasi
// ---------------------------------------------------------------------------

type LessonCardProps = {
  lesson: Lesson
  confirming: boolean
  onRestart: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onAudioChange: (voice: string, rate: number) => void
}

function LessonCard({
  lesson,
  confirming,
  onRestart,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onAudioChange,
}: LessonCardProps) {
  // Ovoz sozlamalari YOPIQ turadi: ular kamdan-kam o'zgaradi, doim ochiq tursa
  // ro'yxatdagi har bir karta ikki barobar uzayib ketardi.
  const [audioOpen, setAudioOpen] = useState(false)

  // `useId` — bitta ro'yxatda o'nlab karta bo'lishi mumkin, `htmlFor` va
  // `aria-labelledby` esa hujjat bo'yicha YAGONA id talab qiladi.
  const uid = useId()
  const deleteId = `${uid}-delete`
  const audioPanelId = `${uid}-audio`
  const voiceId = `${uid}-voice`
  const rateId = `${uid}-rate`
  const confirmPanelId = `${uid}-confirm`
  const confirmTextId = `${uid}-confirm-text`

  const total = lesson.sentences.length
  const done = Math.min(Math.max(0, lesson.progress), total)
  const percent = total > 0 ? (done / total) * 100 : 0
  const finished = total > 0 && done >= total
  const title = lesson.title === '' ? 'Nomsiz dars' : lesson.title

  // Omborda eski yoki noma'lum qiymat yotishi mumkin (`toLesson` tanimagan
  // ovozni bo'sh satrga tushiradi). Ro'yxatda yo'q qiymat berilsa `<select>`
  // bo'sh ko'rinardi — shuning uchun standartga qaytariladi.
  const voice = VOICES.includes(lesson.voice) ? lesson.voice : DEFAULT_VOICE
  const rate = RATES.includes(lesson.rate) ? lesson.rate : DEFAULT_RATE

  const status = finished
    ? 'tugallangan'
    : done === 0
      ? 'boshlanmagan'
      : `${Math.round(percent)}% — keyingi gap: ${done + 1}`

  // Panel yopilganda fokuslangan "Bekor qilish" yo'qoladi, fokus esa <body> ga
  // tushib ketardi — shuning uchun u ochilishni SO'RAGAN tugmaga qaytariladi
  // (tugma endi joyida qolgani uchun bu mumkin).
  function handleCancelDelete(): void {
    onCancelDelete()
    document.getElementById(deleteId)?.focus()
  }

  return (
    <li className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 truncate font-mono text-[16px] font-medium text-[#e6edf3]">
          {title}
        </h2>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#7d8b9c]">
          {done} / {total} gap
        </span>
      </div>

      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#7d8b9c]">
        {formatDate(lesson.createdAt)}
      </p>

      <div className="mt-4">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full bg-[#5ee6c1] transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-[#7d8b9c]">{status}</p>
      </div>

      {/* Tugmalar qatori HAR DOIM turadi. Uni tasdiq paneli bilan almashtirish
          fokuslangan tugmani yo'q qilardi va klaviatura foydalanuvchisi fokusni
          sahifa boshidan qaytib topishga majbur bo'lardi (`Stats.tsx` shu
          sababdan panelni qatorning USTIGA emas, TAGIGA qo'yadi). */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/practice/${encodeURIComponent(lesson.id)}`} className={LINK_PRIMARY}>
          {finished ? 'Qaytadan' : done === 0 ? 'Boshlash' : 'Davom ettirish'}
        </Link>
        <Button variant="ghost" onClick={onRestart} disabled={done === 0}>
          Boshidan
        </Button>
        <Button
          variant="ghost"
          onClick={() => downloadSentences(lesson)}
          disabled={total === 0}
          title="Gaplarni tashqi tts.sh quvuri uchun .txt fayl qilib yuklab olish"
        >
          .txt eksport
        </Button>
        <Button
          variant="ghost"
          onClick={() => setAudioOpen((open) => !open)}
          aria-expanded={audioOpen}
          aria-controls={audioOpen ? audioPanelId : undefined}
        >
          Ovoz va tezlik
        </Button>
        <Button
          id={deleteId}
          variant="danger"
          onClick={onAskDelete}
          aria-expanded={confirming}
          aria-controls={confirming ? confirmPanelId : undefined}
        >
          O&apos;chirish
        </Button>
      </div>

      {/* Ovoz/tezlik muharriri (PLAN §8 M5). Ro'yxatlar `shared/filename.ts` dan
          keladi: server AYNAN shu ro'yxatlarga qarab tekshiradi va boshqasini
          400 bilan rad etadi (PLAN §5a). */}
      {audioOpen ? (
        <div
          id={audioPanelId}
          className="mt-4 rounded-sm border border-white/[0.07] bg-[#0b1219] p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={voiceId} className={LABEL}>
                ovoz
              </label>
              <select
                id={voiceId}
                value={voice}
                onChange={(event) => {
                  const next = event.target.value
                  onAudioChange(VOICES.includes(next) ? next : DEFAULT_VOICE, rate)
                }}
                className={`${FIELD} mt-2`}
              >
                {VOICES.map((item) => (
                  <option key={item} value={item} className="bg-[#0b1219]">
                    {voiceLabel(item)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={rateId} className={LABEL}>
                tezlik
              </label>
              <select
                id={rateId}
                value={String(rate)}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  onAudioChange(voice, RATES.includes(next) ? next : DEFAULT_RATE)
                }}
                className={`${FIELD} mt-2`}
              >
                {RATES.map((item) => (
                  <option key={item} value={String(item)} className="bg-[#0b1219]">
                    {rateLabel(item)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
            O&apos;zgarish darhol saqlanadi. Audio fayl nomi ovoz va tezlikdan hosil
            bo&apos;lgani uchun tayyorlangan kesh bu darsga endi to&apos;g&apos;ri kelmaydi —
            so&apos;zlar keyingi mashqda qaytadan sintez qilinadi. Davom ettirish nuqtasi va
            statistika joyida qoladi.
          </p>
        </div>
      ) : null}

      {confirming ? (
        <div
          id={confirmPanelId}
          role="alertdialog"
          aria-live="assertive"
          aria-labelledby={confirmTextId}
          className="mt-4 rounded-sm border border-[#452027] bg-[#160f12] p-4"
        >
          <p
            id={confirmTextId}
            className="font-mono text-[13px] leading-relaxed text-[#ff9f9f]"
          >
            &laquo;{title}&raquo; o&apos;chirilsinmi? Matn ham, davom ettirish nuqtasi ham
            yo&apos;qoladi va qaytarib bo&apos;lmaydi — nusxa faqat shu brauzerda saqlanadi.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={onConfirmDelete}>
              Ha, o&apos;chirilsin
            </Button>
            {/* Fokus ataylab BEKOR QILISHga beriladi: panel ochilishi bilan
                adashib bosilgan Enter darsni o'chirib yuborsa bo'lmaydi. */}
            <Button variant="ghost" size="sm" autoFocus onClick={handleCancelDelete}>
              Bekor qilish
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

export function Home() {
  // Ro'yxat HOLATDA saqlanadi: `listLessons()` ni to'g'ridan-to'g'ri render
  // ichida chaqirsak, o'chirishdan keyin React qayta render qilish uchun sabab
  // ko'rmaydi va o'chirilgan dars ekranda qolib ketardi.
  const [lessons, setLessons] = useState<Lesson[]>(() => listLessons())
  const [summary] = useState<Summary>(readSummary)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  // O'chirishdan keyin fokus shu sarlavhaga qo'yiladi — u ro'yxat chizilganda
  // ham, bo'sh holat chizilganda ham joyida qoladigan yagona nuqta.
  const headingRef = useRef<HTMLHeadingElement>(null)

  function handleRestart(id: string): void {
    setProgress(id, 0)
    setLessons(listLessons())
  }

  function handleDelete(id: string): void {
    const removed = lessons.find((lesson) => lesson.id === id)

    // Fokus AVVAL ko'chiriladi: tasdiqdan keyin butun <li> yo'q bo'ladi va u
    // bilan birga fokuslangan tugma ham ketadi, fokus esa <body> ga tushib
    // qolardi — klaviatura foydalanuvchisi sahifa boshiga uloqtirilardi.
    headingRef.current?.focus()

    deleteLesson(id)
    const next = listLessons()
    setConfirmId(null)
    setLessons(next)

    // Fokus ko'chishining o'zi "nima bo'ldi?" degan savolga javob bermaydi —
    // e'lon matni qolgan darslar sonini ham aytadi. Son har safar o'zgargani
    // uchun bir xil sarlavhali darslar ketma-ket o'chirilganda ham matn takror
    // bo'lmaydi va `aria-live` uni qayta o'qiydi.
    const title = removed === undefined || removed.title === '' ? 'Nomsiz dars' : removed.title
    setNotice(
      next.length === 0
        ? `«${title}» o'chirildi. Ro'yxatda dars qolmadi.`
        : `«${title}» o'chirildi. Ro'yxatda ${next.length} ta dars qoldi.`,
    )
  }

  /**
   * Ovoz/tezlik ombordagi ENG SO'NGGI nusxa ustiga yoziladi. Ro'yxatdagi `lesson`
   * ni to'g'ridan-to'g'ri ustiga yozib bo'lmaydi: u mashq boshlanganidan beri
   * eskirgan bo'lishi mumkin va davom ettirish nuqtasini orqaga sudrab ketardi.
   */
  function handleAudio(id: string, voice: string, rate: number): void {
    const current = getLesson(id)
    if (current === null) return
    saveLesson({ ...current, voice, rate })
    setLessons(listLessons())
  }

  return (
    <div className="space-y-6">
      <section className={`${PANEL} px-5 py-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className={LABEL}>umumiy holat</span>
          <Link
            to="/stats"
            className="font-mono text-[11px] text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
          >
            Batafsil
          </Link>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Stat label="seans" value={String(summary.sessions)} />
          <Stat label="faol vaqt" value={formatDuration(summary.activeMs)} />
          <Stat label="net wpm" value={formatWpm(summary.netWpm)} accent />
          <Stat label="aniqlik" value={formatPercent(summary.accuracy)} />
          <Stat label="seriya" value={`${summary.streak} kun`} />
        </dl>
      </section>

      <section>
        {/* E'lon hududi DOIM chiziladi: bo'sh joyga keyin qo'shilgan
            `aria-live` ni ekran o'quvchilar ishonchli o'qimaydi. */}
        <p role="status" aria-live="polite" className="sr-only">
          {notice}
        </p>

        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={`${LABEL} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5ee6c1]`}
          >
            darslar
          </h1>
          {lessons.length > 0 ? (
            <Link to="/import" className="font-mono text-[11px] text-[#5ee6c1] underline decoration-[#5ee6c1]/30 underline-offset-4 transition-colors hover:decoration-[#5ee6c1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]">
              + yangi matn
            </Link>
          ) : null}
        </div>

        {lessons.length === 0 ? (
          <EmptyState
            title="Hali birorta dars yo'q"
            hint="Mashq qilish uchun avval matn kerak: istalgan inglizcha xatboshini nusxalab, Import sahifasiga qo'ying — u tozalanadi va gaplarga bo'linadi."
            action={
              <Link to="/import" className={LINK_PRIMARY}>
                Matn import qilish
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                confirming={confirmId === lesson.id}
                onRestart={() => handleRestart(lesson.id)}
                onAskDelete={() => setConfirmId(lesson.id)}
                onCancelDelete={() => setConfirmId(null)}
                onConfirmDelete={() => handleDelete(lesson.id)}
                onAudioChange={(voice, rate) => handleAudio(lesson.id, voice, rate)}
              />
            ))}
          </ul>
        )}
      </section>

      {lessons.length > 0 ? (
        <p className="font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
          Davom ettirish gap darajasida ishlaydi: yarim yozilgan gap saqlanmaydi, mashq doim
          gap boshidan tiklanadi.
        </p>
      ) : null}
    </div>
  )
}

export default Home
