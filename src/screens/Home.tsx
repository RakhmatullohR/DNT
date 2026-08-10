// Bosh sahifa (PLAN §7) — darslar kutubxonasi va ilovaning kirish nuqtasi.
// Marshrut: '/'. "Dars" — bitta import qilingan matn; seans esa uning bir bo'lagi.
//
// Yuqoridagi yig'indi ATAYIN kichik: bu yerda faqat "bugun qanday ketyapman"
// degan savolga javob beriladi, chuqur ko'rinish Statistika ekranida.

import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { DEFAULT_RATE, DEFAULT_VOICE, RATES, VOICES } from '../../shared/filename.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { StatsBanner } from '../components/StatsBanner.tsx'
import { dayNumberToKey } from '../core/wordScore.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import {
  deleteLesson,
  exportLessonJson,
  getLesson,
  listLessons,
  saveLesson,
  setProgress,
} from '../store/lessons.ts'
import type { Lesson } from '../store/lessons.ts'
import { initStats, streakDays, totals } from '../store/stats.ts'
import type { StatsAvailability, Totals } from '../store/stats.ts'

const PANEL = 'rounded-panel border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-muted'
// Maydon uslubi `Import.tsx` dagi bilan bir xil: ikkala ekranda ham AYNAN shu
// ikki ro'yxat tanlanadi, ko'rinishi ham farq qilmasligi kerak.
//
// Fokus IKKI qatlam bilan ko'rsatiladi va bu ATAYIN takrorlanish EMAS, chunki
// ikkovi turli hollarda yonadi:
//   `focus:border`        — HAR QANDAY fokusda (sichqoncha, dasturiy, klaviatura)
//   `focus-visible:ring`  — FAQAT klaviatura fokusida
// Bu yerdagi `FIELD` faqat `<select>` ga qo'yiladi, `:focus-visible` esa
// `<select>` sichqoncha bilan bosilganda brauzerlarda MOS KELMAYDI (matn
// maydonlaridan farqi shu — ularda keyingi klaviatura kiritilishi kutilgani
// uchun mos keladi). Ya'ni `focus:border` olib tashlansa, tanlagichni sichqoncha
// bilan bosgan foydalanuvchida fokus belgisi umuman qolmaydi.
//
// Halqa orasi (`ring-offset`) `Button`/`Layout` dagi bilan BIR XIL qalinlikda,
// lekin RANGI boshqa: bu maydon `#0b1219` sub-panel (ovoz/tezlik bloki) ustida
// turadi, sahifa foni `#0b0f14` emas — mos kelmasa halqa bilan fon orasida
// notekis qorong'i chok paydo bo'lardi.
const FIELD = [
  'w-full rounded-control border border-white/[0.07] bg-[#0b1219] px-3 py-2.5',
  'font-mono text-[13px] text-[#e6edf3] placeholder:text-muted',
  'transition-colors duration-150 ease-out hover:border-white/[0.12]',
  'focus:border-[#5ee6c1] focus:outline-none',
  'focus-visible:ring-2 focus-visible:ring-[#5ee6c1]',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1219]',
].join(' ')

// Havola tugma ko'rinishida: `Button` — bu <button>, uni <a> ichiga solib
// bo'lmaydi, shuning uchun navigatsiya uchun `Link` o'z sinflarini oladi.
// Ko'rinish `Button.tsx` dagi `md` o'lchami bilan bir xil qilib olingan.
const LINK_BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border px-4 font-mono text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]'
const LINK_PRIMARY = `${LINK_BTN} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`

/**
 * "Boshidan" bekor qilish oynasi (ms). To'liq tasdiq paneli (`O'chirish` dagi
 * kabi) bu yerda ORTIQCHA — faqat ko'rsatkich tiklanadi, hech qanday matn
 * yo'qolmaydi. Shuning uchun eski progress shu vaqt davomida ushlab turiladi
 * va "Bekor qilish" bosilsa qaytariladi.
 */
const RESTART_UNDO_MS = 6_000

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
// Darsni faylga chiqarish (PLAN §10)
//
// IKKI XIL eksport bor va ular BOSHQA-BOSHQA ish qiladi — shuning uchun ikkita
// tugma ham:
//
//   `.txt`  — faqat gaplar matni, tashqi TTS quvuri uchun. Progress tushmaydi.
//   `.json` — darsning BUTUN holati (progress, tashlangan gaplar, ta'kidlash,
//             ovoz va tezlik), ya'ni ZAXIRA: dars o'chirilgan bo'lsa ham Import
//             ekranidan aynan o'sha joyidan qaytariladi.
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
  downloadFile(
    `${lesson.sentences.join('\n')}\n`,
    `${safeFileName(lesson)}.txt`,
    'text/plain;charset=utf-8',
  )
}

/** Ekrandagi YAGONA yuklash yo'li — `Stats.tsx` dagi `downloadText` bilan bir xil. */
function downloadFile(text: string, filename: string, mime: string): void {
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
 * Zaxira fayli nomiga qo'shiladigan sana (`YYYY-MM-DD` — `Stats.tsx` dagi
 * zaxira nomlari bilan bir xil shakl).
 *
 * `.txt` da bunday belgi YO'Q va bu farq ATAYIN: `.txt` ning ichi dars matni
 * o'zgarmaguncha o'zgarmaydi, `.json` esa har mashqdan keyin BOSHQA bo'ladi —
 * ichida progress bor. Sanasiz ikki haftalik zaxira brauzerda «dars.json» va
 * «dars (1).json» bo'lib yotardi va qaysi biri yangiroq ekanini fayl nomidan
 * bilib bo'lmasdi.
 */
function stamp(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

// ---------------------------------------------------------------------------
// Yig'indi
// ---------------------------------------------------------------------------

/**
 * Yuqoridagi beshta raqamning holati.
 *
 * ⚠️ UCH holat, ikkita emas (docs/stats-longterm.md §4.3, F4):
 *
 *   `null`                — hali YUKLANMAGAN (ombor asinxron);
 *   `{ totals: null }`    — umrbod konvert YO'Q. Bu "hammasi nol" DEGANI EMAS:
 *                           nol ko'rsatish qisman yoki noma'lum holatni
 *                           "umrbod hech narsa qilmagansiz" deb ko'rsatardi;
 *   `{ totals: {...} }`   — o'lchangan.
 *
 * Uchalasi ekranda ham FARQ QILADI (`PENDING` / `UNKNOWN` / son).
 */
type Summary = { totals: Totals | null; streak: number }

/** Hali yuklanmagan qiymat. */
const PENDING = '…'
/**
 * O'lchanmagan qiymat — nol EMAS (`PLAN.md` §11.3, 4-invariant).
 *
 * Ikki holatda chiqadi: umrbod konvert topilmaganda VA nisbat (`netWpm`,
 * `accuracy`) `null` bo'lganda, ya'ni ularni izchil o'lchash uchun yetarli
 * oyna hali yo'q. Bu ekrandagi «—» ning o'zbekcha yozilishi.
 */
const UNKNOWN = "noma'lum"
/** O'qish XATO bilan tugadi — `PENDING` da abadiy osilib qolmaslik uchun. */
const FAILED = 'xato'

/**
 * `*Since` si bor maydon `≥ N` bo'lib chiziladi (§4.3).
 *
 * ⚠️ FAQAT XOM, MONOTON hisoblagichlarga (`sessions`, `keystrokes`, `activeMs`)
 * qo'llanadi. NISBATGA (`netWpm`, `accuracy`) qo'llash MUMKIN EMAS va bu shu
 * yerda o'lchangan xato edi: nisbat monoton emas — yangi ma'lumot uni
 * PASAYTIRISHI ham mumkin, ya'ni "ko'rsatilgandan kam emas" degan va'da
 * yolg'on bo'lardi. Amalda ekran haqiqiy 96% o'rniga «≥ 100.0%» chizardi.
 *
 * Sabab jadvalda: `sessions` va `keystrokes` faqat OMON QOLGAN seanslardan
 * bilinadi, `activeMs` esa `days` dan ANIQ. Ularni bir xil ko'rsatish qisman
 * sonni yalang'och umrbod raqam qilib qo'yardi — §4.3 aynan shu xatoning
 * oldini olish uchun yozilgan.
 */
function partial(value: string, since: number | undefined): string {
  return since === undefined ? value : `≥ ${value}`
}

/** Xato matni — `unknown` dan foydalanuvchiga ko'rsatiladigan satr. */
function errorText(err: unknown): string {
  return err instanceof Error && err.message !== '' ? err.message : String(err)
}

/** Uzilmas bo'shliq — son bilan uning birligini bir-biridan ajratmaydi. */
const NBSP = ' '

/**
 * Qiymatni raqam va birlik bo'laklariga ajratib chiqaradi ("29 daq 25 sek" ->
 * "29" / " daq " / "25" / " sek"). Bu FAQAT ko'rinish — `formatDuration`
 * va boshqa formatlovchilar o'zgarmaydi, hisoblash aynan ular bergan satrga
 * tayanadi.
 *
 * Ikki qaror bu yerda ATAYIN shunday:
 *
 * 1. Bo'sh joylar birlik bo'lagi ICHIDA qoladi (CSS `gap` bilan emas): aks holda
 *    ekran o'quvchi matnni bo'shliqsiz "29daq25sek" deb o'qib berardi.
 *
 * 2. Birlikning OLDIDAGI bo'shliq uzilmas (` `), ORQASIDAGISI esa oddiy
 *    bo'shliq bo'lib qoladi. Shu sabab satr faqat "...daq" va "25" orasidan
 *    uzilishi mumkin, "29" bilan "daq" orasidan esa hech qachon.
 *
 *    Nega `whitespace-nowrap` emas: u sinishni butunlay taqiqlaydi, lekin
 *    TOSHISHNI to'xtatmaydi — panjara treki tor bo'lganda qiymat o'z ustunidan
 *    chiqib qo'shni statistika ustiga bosib ketardi (768px va 320px da o'lchab
 *    ko'rilgan: +25px gacha). Toshish o'qib bo'lmaydigan holat, sinish esa —
 *    shunchaki notekis. Shuning uchun eng yomon holatda sinishga RUXSAT beriladi.
 *
 * Birlik (daq, sek, soat, kun, %) ikkinchi darajali ma'lumot bo'lgani uchun
 * kichikroq va xiraroq chiqadi — bu ham qiymatni toraytiradi, ham son/birlik
 * ierarxiyasini ko'rsatadi.
 */
function statTokens(value: string): { text: string; unit: boolean }[] {
  const parts = value.match(/\d[\d.]*|[^\d]+/g) ?? [value]
  return parts.map((part) => {
    // Birlik = ichida BIRORTA raqam yo'q bo'lak. `\D` bilan tekshirib bo'lmaydi:
    // "94.5" ichidagi nuqta ham `\D` ga mos keladi va butun son birlik bo'lib,
    // kichkina va xira chiqib ketardi.
    if (/\d/.test(part)) return { text: part, unit: false }
    // Faqat BOSHIDAGI bo'shliqlar uzilmas bo'ladi; oxiridagilar guruhlar
    // orasidagi yagona ruxsat etilgan uzilish nuqtasi bo'lib qoladi.
    return { text: part.replace(/^\s+/, (run) => NBSP.repeat(run.length)), unit: true }
  })
}

function Stat({
  label,
  value,
  accent = false,
  hint,
}: {
  label: string
  value: string
  accent?: boolean
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1.5 font-mono text-[21px] font-semibold">
        {statTokens(value).map((token, index) =>
          token.unit ? (
            <span key={index} className="text-[12px] font-medium text-muted">
              {token.text}
            </span>
          ) : (
            <span key={index} className={`tabular-nums ${accent ? 'text-[#5ee6c1]' : 'text-[#e6edf3]'}`}>
              {token.text}
            </span>
          ),
        )}
      </dd>
      {/* Faqat `net wpm` bu izohni oladi: qolgan to'rttasi o'z-o'zidan tushunarli,
          har biriga qo'shsak qator ortiqcha uzayib ketardi. */}
      {hint !== undefined ? <p className="mt-1 font-mono text-[11px] text-muted">{hint}</p> : null}
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
  onBackup: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onAudioChange: (voice: string, rate: number) => void
}

function LessonCard({
  lesson,
  confirming,
  onRestart,
  onBackup,
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

  // `Escape` bilan tashlangan va hali yozilmagan gaplar. Progress ular ustidan
  // ham oldinga suriladi (`session.ts` dagi `nextSentenceIndex` izohiga q.), ya'ni
  // `done === total` bo'la turib ish tugamagan bo'lishi mumkin — shu bois
  // "tugallangan" holati SONGA emas, shu ro'yxatga ham qarab aniqlanadi.
  // Ro'yxat `localStorage` dan keladi, shuning uchun yaroqsiz indekslar
  // `nextSentenceIndex` dagi bilan BIR XIL qoida bo'yicha chiqarib tashlanadi —
  // aks holda karta o'chirib bo'lmaydigan "1 ta gap qaytadi" bilan qotib qolardi.
  const pendingSkipped = (lesson.skipped ?? []).filter(
    (raw) => Number.isFinite(raw) && Math.floor(raw) >= 0 && Math.floor(raw) < total,
  ).length
  // Dars ROSTDAN tugadi: oxiriga yetgan VA qaytadigan gap qolmagan.
  const allDone = finished && pendingSkipped === 0

  // Omborda eski yoki noma'lum qiymat yotishi mumkin (`toLesson` tanimagan
  // ovozni bo'sh satrga tushiradi). Ro'yxatda yo'q qiymat berilsa `<select>`
  // bo'sh ko'rinardi — shuning uchun standartga qaytariladi.
  const voice = VOICES.includes(lesson.voice) ? lesson.voice : DEFAULT_VOICE
  const rate = RATES.includes(lesson.rate) ? lesson.rate : DEFAULT_RATE

  // Holat yorlig'i progress blokining o'ng ustunida chiqadi — chapdagi
  // son/foiz bilan bitta qatorda, alohida "status satri" sifatida emas.
  const stateLabel = allDone
    ? 'tugallangan'
    : finished
      ? `${pendingSkipped} ta gap qaytadi`
      : done === 0
        ? 'boshlanmagan'
        : `keyingi: ${done + 1}-gap`

  // Panel yopilganda fokuslangan "Bekor qilish" yo'qoladi, fokus esa <body> ga
  // tushib ketardi — shuning uchun u ochilishni SO'RAGAN tugmaga qaytariladi
  // (tugma endi joyida qolgani uchun bu mumkin).
  function handleCancelDelete(): void {
    onCancelDelete()
    document.getElementById(deleteId)?.focus()
  }

  return (
    <li className={`${PANEL} p-5`}>
      {/* `lang` SHARTLI: nomsiz darsda `title` o'zbekcha "Nomsiz dars" ga
          tushadi — qat'iy `lang="en"` uni ingliz fonetikasida o'qitardi. */}
      <h2
        lang={lesson.title === '' ? undefined : 'en'}
        className="truncate font-mono text-[16px] font-medium text-[#e6edf3]"
      >
        {title}
      </h2>
      {/* Sana meta-matn sifatida sarlavhaga TIQ turadi (kichik bo'shliq) — ilgari
          bu ikkovi bir xil xira rangdagi ikkita bog'liqsiz qatorga o'xshab
          ko'rinardi. Gap soni endi shu yerda emas, progress blokida: u foiz va
          keyingi gap bilan birga BITTA joyda o'qiladi, uch marta qaytarilmaydi. */}
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
        {formatDate(lesson.createdAt)}
      </p>

      {/* Progress — BITTA blok: chapda son/foiz, o'ngda holat, tagida yo'lak.
          Ilgari bu uch alohida parcha edi (sarlavhadagi son, yalang'och yo'lak,
          pastdagi status satri) va ikkinchisi birinchisini boshqa shaklda
          qaytarardi. Yo'lak balandligi ham sal oshirildi (h-1 -> h-1.5): sarlavha
          bilan tegishmasa, 7% kabi kichik to'ldirish "chang zarrasi"dek ko'rinardi. */}
      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {done} / {total} gap · {Math.round(percent)}%
          </span>
          {/* Tugallanganda ham na'na rangga bo'yalmaydi: shu kartada allaqachon
              to'la yo'lak va yashil "Qaytadan" tugmasi bor, uchinchi na'na yuza
              qo'shilsa aksent "bosiladigan narsa" ma'nosini yo'qotadi (Layout.tsx:
              aksent faqat faol holat va bitta asosiy harakat uchun). Tugallanganini
              chapdagi "149 / 149 gap · 100%" va to'la yo'lakning o'zi aytib turadi. */}
          <span className="font-mono text-[11px] text-muted">{stateLabel}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full bg-[#5ee6c1] transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Tugmalar qatori HAR DOIM turadi. Uni tasdiq paneli bilan almashtirish
          fokuslangan tugmani yo'q qilardi va klaviatura foydalanuvchisi fokusni
          sahifa boshidan qaytib topishga majbur bo'lardi (`Stats.tsx` shu
          sababdan panelni qatorning USTIGA emas, TAGIGA qo'yadi).

          Og'irlik ATAYIN teng emas: ikkilamchi uchtasi `sm` o'lchamda, shuning
          uchun yashil asosiy harakat qatorda yolg'iz kattaroq bo'lib ajralib
          turadi.

          O'chirish esa alohida o'ram ichida: buzuvchi harakat "Ovoz va tezlik"
          bilan yelka-yelkama turmasligi kerak, aks holda bitta adashgan bosish
          darsni yo'q qilib yuboradi. Yolg'iz `ml-auto` bunga YETMAYDI — u faqat
          ORTIB QOLGAN bo'shliqni yeydi, 320px da esa qator o'ralib, oxirgi
          satrda atigi 14px qolardi (o'lchab ko'rilgan), ya'ni ajratish aynan eng
          tor ekranda — xato bosish ehtimoli eng yuqori joyda — yo'qolardi.
          Shuning uchun `sm` gacha o'ram `basis-full` bilan butun satrni egallaydi
          va tugma o'ng chetga o'tadi; `sm` dan boshlab esa `ml-auto` yetarli
          bo'shliq beradi. Tab tartibi DOM bo'yicha bir xil qoladi. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to={`/practice/${encodeURIComponent(lesson.id)}`} className={LINK_PRIMARY}>
          {allDone
            ? 'Qaytadan'
            : finished
              ? 'Tashlanganlarni yozish'
              : done === 0
                ? 'Boshlash'
                : 'Davom ettirish'}
        </Link>
        {/* Dars ROSTDAN tugaganda (`allDone`) bu tugma "Qaytadan" bilan AYNAN bir
            xil ishni qiladi — ikkovi ham 0-gapga qaytaradi — shuning uchun shu
            holatda o'chirilgan, `done === 0` dagi kabi.
            LEKIN oxiriga yetgan-u tashlangan gapi qolgan darsda o'chirilmaydi:
            u yerda yuqoridagi havola `nextSentenceIndex` bo'yicha eng kichik
            TASHLANGAN gapga boradi, 0-gapga emas — ya'ni progressni chindan
            nolga tushirishning yagona yo'li aynan shu tugma bo'lib qoladi. */}
        <Button variant="ghost" size="sm" onClick={onRestart} disabled={done === 0}>
          Boshidan
        </Button>
        {/* Ikki eksport YONMA-YON turadi va yorliqlari ataylab bir xil shaklda
            (`.kengaytma eksport`): ular bir oilaga tegishli, farqi esa faqat
            fayl turida — `title` izohlari buni ochib beradi. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadSentences(lesson)}
          disabled={total === 0}
          title="Gaplarni tashqi tts.sh quvuri uchun .txt fayl qilib yuklab olish"
        >
          .txt eksport
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBackup}
          title={`Zaxira: matn va hozirgi holat (${done} / ${total} gap) bilan .json fayl. Import ekranidan qaytariladi.`}
        >
          .json eksport
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAudioOpen((open) => !open)}
          aria-expanded={audioOpen}
          aria-controls={audioOpen ? audioPanelId : undefined}
        >
          Ovoz va tezlik
        </Button>
        <div className="flex basis-full justify-end sm:ml-auto sm:basis-auto">
          <Button
            id={deleteId}
            variant="danger"
            size="sm"
            onClick={onAskDelete}
            aria-expanded={confirming}
            aria-controls={confirming ? confirmPanelId : undefined}
          >
            O&apos;chirish
          </Button>
        </div>
      </div>

      {/* Ovoz/tezlik muharriri (PLAN §8 M5). Ro'yxatlar `shared/filename.ts` dan
          keladi: server AYNAN shu ro'yxatlarga qarab tekshiradi va boshqasini
          400 bilan rad etadi (PLAN §5a). */}
      {audioOpen ? (
        <div
          id={audioPanelId}
          className="mt-4 rounded-control border border-white/[0.07] bg-[#0b1219] p-4"
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
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
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
          className="mt-4 rounded-control border border-[#452027] bg-[#160f12] p-4"
        >
          <p
            id={confirmTextId}
            className="font-mono text-[13px] leading-relaxed text-[#ff9f9f]"
          >
            &laquo;{title}&raquo; o&apos;chirilsinmi? Matn ham, davom ettirish nuqtasi ham
            yo&apos;qoladi — nusxa faqat shu brauzerda saqlanadi. Qaytarishning yagona
            yo&apos;li — OLDINDAN olingan zaxira fayli (shu kartadagi &laquo;.json
            eksport&raquo; yoki Statistikadagi darslar zaxirasi): uni Import ekranidan
            tiklaganda dars shu holatida qaytadi.
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

/** "Boshidan" ni bekor qilish uchun ushlab turilgan eski davom ettirish nuqtasi. */
type RestartUndo = { id: string; progress: number; title: string }

export function Home() {
  useDocumentTitle('Darslar')

  // Ro'yxat HOLATDA saqlanadi: `listLessons()` ni to'g'ridan-to'g'ri render
  // ichida chaqirsak, o'chirishdan keyin React qayta render qilish uchun sabab
  // ko'rmaydi va o'chirilgan dars ekranda qolib ketardi.
  const [lessons, setLessons] = useState<Lesson[]>(() => listLessons())
  // `null` — hali yuklanmagan. Statistika endi IndexedDB'da, ya'ni uni render
  // paytida sinxron o'qib bo'lmaydi (docs/stats-longterm.md §3.2a).
  const [summary, setSummary] = useState<Summary | null>(null)
  // Banner uchun (§8.4d). Boshlang'ich `ready`: ombor odatda ishlaydi va
  // yuklanish paytida ogohlantirish miltillab ketishi kerak emas.
  const [availability, setAvailability] = useState<StatsAvailability>('ready')
  // Yuklash XATO bilan tugadi. `summary` abadiy `null` bo'lib qolganda ekran
  // jimgina "…" ko'rsatib turardi — foydalanuvchi kutayotgan narsa hech qachon
  // kelmasligini bilmasdi.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [restartUndo, setRestartUndo] = useState<RestartUndo | null>(null)

  // O'chirishdan keyin fokus shu sarlavhaga qo'yiladi — u ro'yxat chizilganda
  // ham, bo'sh holat chizilganda ham joyida qoladigan yagona nuqta.
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Statistikani yuklash. `initStats()` AVVAL kutiladi (§9): u boot'da
  // `main.tsx` dan ham chaqirilgan, lekin natijasi kutilmagan — ya'ni bu yerda
  // to'g'ridan-to'g'ri o'qish migratsiya tugamasdan bo'sh omborni ko'rishi
  // mumkin edi.
  //
  // `cancelled` SHART: foydalanuvchi javob kelgunicha boshqa ekranga o'tsa,
  // uzilgan komponentda `setState` chaqirilardi. Bu yerda effekt bir marta
  // ishlaydi, lekin naqsh boshqa ekranlarniki bilan bir xil.
  //
  // ⚠️ TARTIB MUHIM: `setAvailability` `initStats()` dan DARHOL keyin, o'qishlardan
  // OLDIN chaqiriladi. Ilgari u o'qishlardan KEYIN turardi va `blocked` banneri
  // HECH QACHON chiqmasdi: `statsDb.ts` `onblocked` dan keyin so'rovni saqlab
  // qo'yadi, ya'ni keyingi `openDb()` yangi so'rov chiqarmaydi va `totals()`
  // bloklovchi tab yopilmaguncha umuman hal bo'lmaydi — `setAvailability` ga
  // esa navbat yetmasdi. `Stats.tsx` buni boshidan to'g'ri qilgan.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await initStats()
      if (!cancelled) setAvailability(state)
      const [value, streak] = await Promise.all([totals(), streakDays()])
      if (cancelled) return
      setSummary({ totals: value, streak })
    })().catch((err: unknown) => {
      // `withStatsDb` `InvalidStateError` dan boshqa xatolarni QAYTA TASHLAYDI,
      // ya'ni bu shox haqiqiy. `.catch` siz bu boshqarilmagan rad javobi bo'lib,
      // ekran abadiy "…" da qolib ketardi.
      if (cancelled) return
      setLoadError(errorText(err))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // "Boshidan" oynasining taymeri. Ref da: o'zgarishi qayta renderni talab
  // qilmaydi, faqat keyingi bosishda eskisini bekor qilish uchun kerak.
  const restartTimerRef = useRef<number | null>(null)

  function clearRestartTimer(): void {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }

  // Komponent uzilganda taymer osilib qolmasin — uzilgan komponentda `setState`
  // chaqirish ogohlantirish beradi (`Reveal.tsx` dagi bilan bir xil qoida).
  useEffect(() => clearRestartTimer, [])

  function handleRestart(id: string): void {
    const target = lessons.find((lesson) => lesson.id === id)
    if (target === undefined) return
    const title = target.title === '' ? 'Nomsiz dars' : target.title

    setProgress(id, 0)
    setLessons(listLessons())

    // ⚠️ NUANS: shu kartadagi `O'chirish` ikki bosqichli tasdiq bilan
    // himoyalangan, lekin bu yerga to'liq tasdiq paneli ORTIQCHA — tasdiq
    // qaytarib bo'lmaydigan MA'LUMOT yo'qolishiga ajratilgan, ko'rsatkich
    // tiklashga emas. Shuning uchun arzonroq yo'l: eski indeks bir necha
    // soniya ushlab turiladi va shu oynada "Bekor qilish" bilan qaytariladi.
    clearRestartTimer()
    setRestartUndo({ id, progress: target.progress, title })
    setNotice(`«${title}» boshidan boshlandi.`)
    restartTimerRef.current = window.setTimeout(() => {
      setRestartUndo(null)
      restartTimerRef.current = null
    }, RESTART_UNDO_MS)
  }

  function handleUndoRestart(): void {
    if (restartUndo === null) return
    clearRestartTimer()
    setProgress(restartUndo.id, restartUndo.progress)
    setLessons(listLessons())
    setNotice(`«${restartUndo.title}» boshidan boshlash bekor qilindi.`)
    setRestartUndo(null)
  }

  /**
   * Darsning zaxirasini `.json` fayl qilib beradi.
   *
   * ⚠️ Ombordan QAYTA o'qiladi (`exportLessonJson` ichida `getLesson`), ro'yxatdagi
   * `lesson` dan yozilmaydi: `handleAudio` dagi bilan bir xil sabab — bu ro'yxat
   * mashq boshlanganidan beri eskirgan bo'lishi mumkin va zaxira o'sha eski
   * progressni "hozirgi holat" deb saqlab qo'yardi.
   *
   * Shu sababdan dars TOPILMASLIGI ham mumkin (boshqa tabda o'chirilgan) — bunda
   * bo'sh fayl bermaymiz: "zaxira oldim" degan yolg'on ishonch keyin qimmatga
   * tushadi. Xabar `notice` orqali beriladi, chunki ekranda boshqa yo'l yo'q.
   */
  function handleBackup(id: string): void {
    const current = getLesson(id)
    const text = current === null ? null : exportLessonJson(id)
    if (current === null || text === null) {
      setLessons(listLessons())
      setNotice("Dars topilmadi — zaxira olinmadi. Ro'yxat yangilandi.")
      return
    }

    downloadFile(
      text,
      `${safeFileName(current)}-${stamp(new Date())}.json`,
      'application/json;charset=utf-8',
    )
    setNotice(
      `«${current.title === '' ? 'Nomsiz dars' : current.title}» zaxirasi .json fayl bo'lib yuklab olindi.`,
    )
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

    // Shu darsning "Boshidan" bekor qilish oynasi ochiq bo'lsa, uni yopamiz:
    // dars endi o'chirilgan, `setProgress` o'chirilgan `id` uchun jimgina
    // qaytadi (qarang: `store/lessons.ts`), ya'ni "Bekor qilish" osilib qolgan
    // bannerdek hech narsa qilmay turib qolardi.
    if (restartUndo !== null && restartUndo.id === id) {
      clearRestartTimer()
      setRestartUndo(null)
    }

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
            className="font-mono text-[11px] text-muted underline decoration-white/20 underline-offset-4 transition-colors hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
          >
            Batafsil
          </Link>
        </div>

        {/* Beshta ustun FAQAT `lg` dan boshlab: 640-1024px oralig'ida besh trek
            atigi ~118px bo'lib qolardi va uzun qiymat ("180 soat 05 daq" — bir
            yil kunlik mashqdan keyin real holat) unga sig'masdi. Oraliqda uchta
            ustun ~213px beradi, `lg` da esa besh trek ~170-195px (1024px ekranda
            170, konteyner o'z 1152px chegarasiga yetgach 195) — eng uzun
            qiymatdan ham keng. Tor ekranda ikkita ustun qoladi.
            Hisob: (panel eni − 4×gap-x-6) / 5, panel eni = kontent − shu
            `<section>` ning `px-5` i. Ilgari bu yerda "~152px" turardi — u
            ikki jihatdan eskirgan: konteyner hali 896px edi VA panelning
            `px-5` i tushirib qoldirilgan edi (o'sha paytdagi haqiqiy trek
            144px). */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {/* Tartib Stats.tsx bilan KANONIK: net wpm -> aniqlik -> seans -> faol
              vaqt -> seriya. Bir xil beshta raqam ikki ekranda boshqa tartibda
              turishi "Batafsil" bosgan foydalanuvchini chalg'itardi. */}
          {/* ⚠️ `netWpm` — NISBAT, shuning uchun `partial` (ya'ni «≥») unga
              QO'LLANMAYDI: `partial` izohiga qarang. `null` esa "izchil oyna
              yo'q" degani — nol ham, taxmin ham emas. */}
          <Stat
            label="net wpm"
            value={
              loadError !== null
                ? FAILED
                : summary === null
                  ? PENDING
                  : summary.totals === null || summary.totals.netWpm === null
                    ? UNKNOWN
                    : formatWpm(summary.totals.netWpm)
            }
            accent
            hint="Faol vaqtga og'irliklangan"
          />
          <Stat
            label="aniqlik"
            value={
              loadError !== null
                ? FAILED
                : summary === null
                  ? PENDING
                  : summary.totals === null || summary.totals.accuracy === null
                    ? UNKNOWN
                    : formatPercent(summary.totals.accuracy)
            }
          />
          <Stat
            label="seans"
            value={
              loadError !== null
                ? FAILED
                : summary === null
                  ? PENDING
                  : summary.totals === null
                    ? UNKNOWN
                    : // `≥` AYNAN shu yerda o'rinli: `sessions` — xom, MONOTON
                      // hisoblagich, ya'ni haqiqiy qiymat ko'rsatilgandan faqat
                      // KO'P bo'lishi mumkin (§4.3 jadvali).
                      partial(String(summary.totals.sessions), summary.totals.sessionsSince)
            }
          />
          <Stat
            label="faol vaqt"
            value={
              loadError !== null
                ? FAILED
                : summary === null
                  ? PENDING
                  : summary.totals === null
                    ? UNKNOWN
                    : // ⚠️ `≥` YO'Q va bu ATAYIN: `activeMs` `days` do'konidan
                      // ANIQ bilinadi (`days` hech qachon qisqartirilmaydi), ya'ni
                      // unga "falon sanadan beri" belgisini qo'yish aniq sonni
                      // noaniq qilib ko'rsatardi (§4.3 jadvali).
                      formatDuration(summary.totals.activeMs)
            }
          />
          <Stat
            label="seriya"
            value={loadError !== null ? FAILED : summary === null ? PENDING : `${summary.streak} kun`}
          />
        </dl>

        {loadError !== null ? (
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-[#f2cf8a]">
            Statistikani o&apos;qib bo&apos;lmadi ({loadError}). Mashq ishlayveradi — faqat
            shu yerdagi raqamlar ko&apos;rsatilmaydi.
          </p>
        ) : null}

        {/* `*Since` belgisi bir marta izohlanadi — beshta qatorga takrorlanmaydi. */}
        {summary?.totals?.sessionsSince !== undefined ? (
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            «≥» belgisi qo&apos;yilgan raqamlar migratsiyada faqat qisman
            tiklangan: ular ko&apos;rsatilgandan KAM emas, lekin undan ko&apos;p
            bo&apos;lishi mumkin.
          </p>
        ) : null}

        {/* ⚠️ Bu `sessionsSince` DAN BOSHQA narsa: u XOM hisoblagichga tegishli,
            bu esa NISBATGA. Nisbatning surati bilan maxraji AYNAN bir davrni
            qamrashi shart, shuning uchun ombor ularni faqat izchil oynadan
            hisoblaydi — va oyna qaysi kundan boshlanganini aytib qo'yish shart,
            aks holda raqam butun tarixniki bo'lib ko'rinardi. */}
        {summary?.totals?.ratiosSince !== undefined ? (
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            net wpm va aniqlik{' '}
            <span className="text-[#e6edf3]">
              {dayNumberToKey(summary.totals.ratiosSince)}
            </span>{' '}
            dan beri o&apos;lchangan kunlardan hisoblangan — undan oldingi kunlar
            bunga kirmaydi. Ularga «≥» qo&apos;yilmaydi: nisbat monoton emas, u
            keyingi ma&apos;lumot bilan pasayishi ham mumkin.
          </p>
        ) : null}
      </section>

      <StatsBanner availability={availability} />

      <section>
        {/* E'lon hududi DOIM chiziladi: bo'sh joyga keyin qo'shilgan
            `aria-live` ni ekran o'quvchilar ishonchli o'qimaydi. */}
        <p role="status" aria-live="polite" className="sr-only">
          {notice}
        </p>

        {/* "Boshidan" bekor qilish banneri. `notice` DAN ATAYIN mustaqil —
            u yuqoridagi sr-only e'londa alohida ishlatiladi va keyinroq boshqa
            harakat (masalan, o'chirish) uni ustidan yozib qo'yishi mumkin;
            shu banner esa faqat `restartUndo` borligiga qarab chiziladi. */}
        {restartUndo !== null ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-white/10 bg-white/[0.03] px-4 py-2.5">
            <span className="font-mono text-[12px] text-muted">
              «{restartUndo.title}» boshidan boshlandi.
            </span>
            <Button variant="ghost" size="sm" onClick={handleUndoRestart}>
              Bekor qilish
            </Button>
          </div>
        ) : null}

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
          <>
            <ul className="space-y-3">
              {lessons.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  confirming={confirmId === lesson.id}
                  onRestart={() => handleRestart(lesson.id)}
                  onBackup={() => handleBackup(lesson.id)}
                  onAskDelete={() => setConfirmId(lesson.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onConfirmDelete={() => handleDelete(lesson.id)}
                  onAudioChange={(voice, rate) => handleAudio(lesson.id, voice, rate)}
                />
              ))}
            </ul>

            {/* Izoh ro'yxatga chegara chizig'i bilan "yopishtiriladi" — `Stats.tsx`
                dagi izoh bandlarining o'zi ham xuddi shu tarzda (`border-t` +
                `pt-4`) o'z bo'limiga ankerlangan. Ilgari bu xatboshi bo'lim
                tugagach erkin osilib qolardi va tasodifiy qoldiq matnga
                o'xshab ko'rinardi. */}
            <div className="mt-6 space-y-2 border-t border-white/[0.06] pt-4">
              <p className="font-mono text-[11px] leading-relaxed text-muted">
                Davom ettirish gap darajasida ishlaydi: yarim yozilgan gap saqlanmaydi, mashq doim
                gap boshidan tiklanadi.
              </p>
              {/* Tiklash yo'li KARTADA emas, shu yerda aytiladi: u kerak bo'lganda
                  (dars o'chirilgandan keyin) karta allaqachon yo'q bo'ladi. */}
              <p className="font-mono text-[11px] leading-relaxed text-muted">
                &laquo;.json eksport&raquo; darsni hozirgi holati bilan saqlaydi —{' '}
                <Link
                  to="/import"
                  className="text-[#5ee6c1] underline decoration-[#5ee6c1]/30 underline-offset-4 transition-colors hover:decoration-[#5ee6c1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
                >
                  Import
                </Link>{' '}
                ekranidagi &laquo;zaxiradan tiklash&raquo; uni o&apos;chirib yuborilgandan
                keyin ham o&apos;sha joyidan qaytaradi.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default Home
