// Mashq ekrani (PLAN §4, §5b, §7) — marshrut: '/practice/:lessonId'.
//
// Bu fayl FAQAT chizadi. Klaviatura, audio, taymer, statistika va seans
// tugagach '/results/:sessionId' ga o'tish — hammasi `useTypingSession` ichida.
// Shu yerda `window` ga birorta ham tinglovchi qo'shilmaydi: `Enter`/`Tab`/
// `Escape` ni hook allaqachon eshitadi va ikkinchi tinglovchi har bosishni ikki
// marta hisoblab yuborardi. Shu sababli "Enter bosing" ko'rsatkichi ham
// tugma emas, balki shunchaki ko'rsatma.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '../components/Button.tsx'
import type { TypingState } from '../core/types.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import type { BlockedKey } from '../hooks/useTypingSession.ts'
import { useTypingSession } from '../hooks/useTypingSession.ts'
import type { Lesson } from '../store/lessons.ts'
import { getLesson } from '../store/lessons.ts'

// Karta radiusi `--radius-panel` tokenidan keladi (index.css): mashq ekranining
// paneli boshqa ekranlardagi karta bilan BIR XIL shaklda bo'lishi kerak, aks
// holda bitta ilova ichida ikki xil karta oilasi paydo bo'ladi. Ichkaridagi
// chip va tugmalar esa o'tkirroq (4px) qoladi — bu ATAYIN: boshqaruv elementi
// konteynerdan o'tkirroq bo'lsa "asbob paneli" hissi saqlanadi.
const PANEL = 'rounded-panel border border-[#1d2833] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
const KBD =
  'rounded-control border border-[#22303d] bg-[#131b23] px-1.5 py-0.5 font-mono text-[11px] text-[#c6d3de]'
/**
 * `Link` tugma ko'rinishida — `Button.tsx` faqat `<button>` chiqaradi.
 *
 * Fokus halqasi offseti `#0e141c`, `#0b0f14` emas: bu havolalar faqat `NotFound`
 * panelining USTIDA turadi. Sahifa foniga sozlangan offset panel ustida halqa
 * ostidan qorong'i chok bo'lib chiqardi.
 */
const LINK_BTN_BASE =
  'inline-flex h-10 items-center justify-center rounded-control border px-4 font-mono text-[13px] font-medium transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e141c] focus-visible:outline-none'
const LINK_BTN_PRIMARY = `${LINK_BTN_BASE} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`
const LINK_BTN_GHOST = `${LINK_BTN_BASE} border-[#22303d] text-[#c6d3de] hover:border-[#334556] hover:bg-[#131b23] hover:text-[#e6edf3]`

/** Yorliqlar: bosishlarni HOOK bajaradi, bu yerda faqat hujjatlashtiriladi (PLAN §4). */
const SHORTCUTS: readonly { key: string; text: string }[] = [
  { key: 'Enter', text: 'keyingi gap' },
  { key: 'Ctrl+Space', text: "so'zni qaytarish" },
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
          className="font-mono text-[16px] font-medium tabular-nums"
          style={{ color }}
        >
          {value}
        </span>
        {unit !== undefined ? (
          <span className="font-mono text-[11px] text-[#7d8b9c]">{unit}</span>
        ) : null}
      </div>
    </div>
  )
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-[#1d2833]">
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
 *
 * SHU SABABLI butunlay `aria-hidden`. Komponent jonli hudud (`aria-live`)
 * ICHIDA turadi va qayta ulanish DOM mutatsiyasi hisoblanadi: bir xil xato
 * tugma ketma-ket bosilganda ekran o'quvchi bir xil xabarni har safar qaytadan
 * o'qib, foydalanuvchini bosib ketardi. Jonli hududga o'zgarmas qisqa matnni
 * ota komponent alohida beradi — matn o'zgarmasa e'lon takrorlanmaydi.
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
      aria-hidden="true"
      className={[
        'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control border border-[#ff6b6b]/40 px-4 py-3',
        'origin-left transition-all duration-300 ease-out motion-reduce:transition-none',
        settled ? 'scale-100 bg-[#ff6b6b]/[0.07]' : 'scale-[1.02] bg-[#ff6b6b]/25',
      ].join(' ')}
    >
      <span className="font-mono text-[11px] font-medium tracking-[0.22em] text-[#ff8b8b] uppercase">
        xato
      </span>
      <span className="font-mono text-[13px] text-[#f0c9c9]">
        {keyName(blocked.wrong)} bosildi — kursor turib qoldi.
      </span>
      {expected === undefined ? null : (
        <span className="font-mono text-[13px] text-[#8b98a9]">
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
function Sentence({
  state,
  blocked,
  sentenceNo,
  sentenceTotal,
}: {
  state: TypingState
  blocked: BlockedKey | null
  sentenceNo: number
  sentenceTotal: number
}) {
  const chars = state.target.split('')
  const caretColor = blocked === null ? '#5ee6c1' : '#ff6b6b'

  return (
    <>
      {/* Belgilarga bo'lingan matnni ekran o'quvchisi harflab o'qib chiqardi.
          `lang="en"` shunga qaramay qo'yilgan: sahifa tili o'zbekcha, matn esa
          inglizcha — brauzerning matn qayta ishlashi (tanlash, tarjima, izlash)
          to'g'ri tilga tayanishi kerak. */}
      <div
        lang="en"
        aria-hidden="true"
        className="font-mono text-[21px] leading-[1.8] break-words whitespace-pre-wrap sm:text-[25px]"
      >
        {chars.map((ch, i) => {
          const errors = state.charErrors.get(i) ?? 0

          if (i === state.cursor) {
            // Fon ATAYIN yo'q: joriy belgini kursor chizig'ining o'zi ko'rsatadi.
            //
            // Rang ham YOZILMAGAN belgilarniki bilan bir xil (pastdagi oxirgi
            // tarmoqqa qarang): kursordagi harf hali terilmagan, shuning uchun
            // uni yorqin qilish "bu allaqachon yozilgan" degan yolg'on signal
            // berardi. Bloklangan holat esa chiziq VA harf rangidan bilinadi.
            return (
              <span
                key={i}
                className={[
                  'relative',
                  blocked !== null
                    ? 'text-[#ffc2c2]'
                    : errors > 0
                      ? 'text-[#b08a90]'
                      : 'text-[#7d8b9c]',
                ].join(' ')}
              >
                {/* Kursor chizig'i alohida element: probel ustida ham ko'rinadi.
                    Yonib-o'chish ATAYIN yo'q: `animate-pulse` sikl davomida
                    shaffoflikni 50% ga tushiradi va bloklangan holatda kontrast
                    2.49:1 gacha pasayadi (3:1 dan past). Kursor o'rinni
                    ko'rsatuvchi yagona signal bo'lgani uchun uning ko'rinishi
                    hech qachon pasaymasligi kerak. Qolaversa animatsiya 2 s,
                    kursor esa har ~200 ms da siljiydi — ya'ni u har safar
                    tasodifiy shaffoflikda paydo bo'lardi. */}
                <span
                  className="absolute top-[0.12em] bottom-[0.12em] -left-px w-[2px] rounded-full"
                  style={{ backgroundColor: caretColor }}
                />
                {/* Probel ODDIY probel bo'lib qoladi.
                    Avval bu yerda uzilmas probel (U+00A0) qo'yilardi: kursor qator
                    oxiriga tushganda ko'rinsin degan maqsadda. Lekin uzilmas probel
                    QATOR UZISH IMKONIYATINI YO'Q QILADI. Kursor "way| to" dagi
                    probelga tushishi bilan `to` keyingi so'zga yopishib qolardi va
                    ikkalasi birga pastki qatorga sakrardi, ya'ni matn terish
                    davomida o'z-o'zidan qayta joylashardi.
                    `whitespace-pre-wrap` qator oxiridagi probelni baribir saqlaydi,
                    shuning uchun kursorning ko'rinishi ham yo'qolmaydi. */}
                {ch}
              </span>
            )
          }

          if (i < state.cursor) {
            // Yozib bo'lingan: xato qilingan joy sariq bo'lib qoladi —
            // gap oxirida qayerda qoqilgani ko'rinib tursin.
            //
            // Nuqtali tag chizig'i — rangdan TASHQARI signal: to'g'ri (#e6edf3)
            // va xato (#f2b544) orasidagi yorug'lik ajralishi atigi 1.55:1,
            // ya'ni farq deyarli faqat tusda. Rang ko'rmaydigan foydalanuvchi
            // aks holda qayerda qoqilganini umuman ko'rmasdi. Monospace advance
            // eni o'zgarmaydi, shuning uchun matn qayta joylashmaydi.
            return (
              <span
                key={i}
                className={
                  errors > 0
                    ? 'text-[#f2b544] underline decoration-dotted underline-offset-4'
                    : 'text-[#e6edf3]'
                }
              >
                {ch}
              </span>
            )
          }

          // Hali yozilmagan. `Backspace` dan keyin kursor ORQAGA qaytishi mumkin,
          // shuning uchun oldinda ham xatosi bor pozitsiya uchraydi.
          return (
            <span key={i} className={errors > 0 ? 'text-[#b08a90]' : 'text-[#7d8b9c]'}>
              {ch}
            </span>
          )
        })}

        {state.cursor >= chars.length ? (
          <span
            className="ml-px inline-block h-[1em] w-[2px] rounded-full align-[-0.15em]"
            style={{ backgroundColor: caretColor }}
          />
        ) : null}
      </div>

      {/* Ekran o'quvchi uchun YAGONA matn manbai.
          `aria-live` SHART: `Enter` bosilgach gap jimgina almashardi va ekran
          o'quvchi endi nima terish kerakligini umuman aytmasdi — fokus o'sha
          maydonda qolgani uchun brauzer ham hech narsa e'lon qilmasdi.
          Raqam ham shu yerda: gap almashgani matnning o'zidan bilinmasligi
          mumkin (bir xil takrorlangan gaplar).
          Ikki til ikki `span` da: o'zbekcha raqamni inglizcha ovoz bilan o'qish
          tushunarsiz chiqadi. */}
      <p className="sr-only" aria-live="polite">
        <span lang="uz">
          {sentenceNo} / {sentenceTotal}-gap:{' '}
        </span>
        <span lang="en">{state.target}</span>
      </p>
    </>
  )
}

function NotFound({ message }: { message: string }) {
  useDocumentTitle('Topilmadi')

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className={`${PANEL} p-8 text-center sm:p-12`}>
        <div className={LABEL}>dars ochilmadi</div>
        <h1 className="mt-4 font-mono text-[21px] font-semibold text-[#e6edf3]">
          Mashqni boshlab bo&apos;lmadi
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-[#8b98a9]">{message}</p>
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

  const title = lesson.title === '' ? 'Nomsiz dars' : lesson.title
  // Dars nomi eng oldinda: yorliq torayganda brauzer sarlavhaning OXIRINI kesadi.
  useDocumentTitle(`${title} — mashq`)

  // Ekran ochilishi bilan fokus mashq maydonida bo'lsin: usiz foydalanuvchi
  // qayerga yozishni bilmaydi, fokus halqasi esa faqat bosilgandan keyin
  // chiqadi. `preventScroll` SHART — usiz brauzer maydonni ko'rinishga tortib,
  // sahifani sakratib yuboradi. Seans `key={lesson.id}` bilan kalitlangani
  // uchun bu bir martalik effekt boshqa darsga o'tilganda ham qayta ishlaydi.
  const fieldRef = useRef<HTMLElement>(null)
  useEffect(() => {
    fieldRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    // Tashqi o'ram `Layout` ning 1152px ini oladi: `max-w-5xl` bu yerda turganda
    // navigatsiyaning o'ng chekkasi mashq kontentidan 64px o'ngda qolardi.
    // Tor o'qish ustuni faqat mashq matni panelida — u yerda ataylab qilingan
    // ierarxiya signali, bu yerda esa tekislanmagan chekka edi.
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={LABEL}>mashq</div>
          {/* `lang` SHARTLI: dars nomi odatda inglizcha (matndan olinadi), lekin
              nomsiz darsda o'rniga o'zbekcha "Nomsiz dars" chiqadi — qat'iy
              `lang="en"` uni ingliz fonetikasida o'qitardi. */}
          <h1
            lang={lesson.title === '' ? undefined : 'en'}
            className="mt-2 truncate font-mono text-[21px] font-semibold text-[#e6edf3]"
          >
            {title}
          </h1>
          <p className="mt-1.5 font-mono text-[11px] text-[#7d8b9c] tabular-nums">
            dars ichida {session.sentenceIndex + 1} / {lesson.sentences.length}-gap
          </p>
        </div>
        {/* Havolaning O'ZI o'zgarmaydi: seans komponent uzilganda yoziladi
            (`useTypingSession` dagi tozalash effekti), ya'ni bu yerda hech
            qanday qo'shimcha ishlov kerak emas. Izoh esa SHART — aks holda
            foydalanuvchi yozganini yo'qotishdan qo'rqib bosmasdi. */}
        <div className="flex flex-col items-end gap-0.5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center font-mono text-[11px] text-[#7d8b9c] underline decoration-white/20 underline-offset-4 transition-colors duration-150 ease-out hover:text-[#e6edf3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee6c1]"
          >
            Mashqni to&apos;xtatish
          </Link>
          <span className="font-mono text-[11px] text-[#7d8b9c]">
            yozilgan gaplar saqlanadi
          </span>
        </div>
      </div>

      {/* HUD */}
      <section className={`${PANEL} mt-5 p-4 sm:p-5`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Yorliq "gap" EMAS: yuqorida "dars ichida N / M-gap" turibdi va
              ikkovi bir xil atalsa bitta ekranda ikki xil "gap" hisobi paydo
              bo'lardi. Bu yerdagi son SEANS ichidagi o'rin. */}
          <Stat
            label="seansda"
            value={String(session.sentenceNo)}
            unit={`/ ${session.sessionTotal}`}
            color="#e6edf3"
          />
          {/* HUD qiymatlari bir xil neytral rangda: uchta to'yingan rang mashq
              matnidan diqqatni o'g'irlardi. Yagona istisno — qolgan vaqt seans
              oxiriga yaqinlashganda: bu haqiqiy signal, bezak emas. */}
          <Stat
            label="net wpm"
            value={formatWpm(session.netWpm)}
            unit="so'z / daq"
            color="#e6edf3"
          />
          <Stat label="aniqlik" value={formatPercent(session.accuracy)} color="#e6edf3" />
          <Stat
            label="qolgan vaqt"
            value={formatClock(session.remainingMs)}
            color={session.timeProgress >= 0.9 ? '#ff6b6b' : '#e6edf3'}
          />
        </div>

        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>gaplar</span>
              <span className="font-mono text-[11px] text-[#7d8b9c] tabular-nums">
                {formatPercent(session.sentenceProgress)}
              </span>
            </div>
            <div className="mt-2">
              <Bar value={session.sentenceProgress} color="#5ee6c1" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>vaqt</span>
              <span className="font-mono text-[11px] text-[#7d8b9c] tabular-nums">
                {formatPercent(session.timeProgress)}
              </span>
            </div>
            <div className="mt-2">
              {/* Oxirgi o'ndan bir qismda rang qizaradi — seans tugashi yaqin. */}
              <Bar
                value={session.timeProgress}
                color={session.timeProgress >= 0.9 ? '#ff6b6b' : '#7d8b9c'}
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
        ref={fieldRef}
        tabIndex={0}
        role="region"
        aria-label="Yozuv maydoni"
        className={`${PANEL} mx-auto mt-4 max-w-5xl p-6 focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14] focus-visible:outline-none sm:p-8`}
      >
        <Sentence
          state={state}
          blocked={blocked}
          sentenceNo={session.sentenceIndex + 1}
          sentenceTotal={lesson.sentences.length}
        />
      </section>

      {/* Balandligi o'zgarmaydi — xabar almashganda ekran sakramasin. Tor
          ekranda `blocked` xabari ikki-uch qatorga yoyilib ~92px ga chiqadi,
          shuning uchun 54px faqat `sm` dan boshlab yetarli. */}
      <div role="status" aria-live="polite" className="mt-3 min-h-23 sm:min-h-13.5">
        {awaitingNext ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control border border-[#5ee6c1]/40 bg-[#5ee6c1]/[0.07] px-4 py-3">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#5ee6c1] motion-reduce:animate-none"
            />
            <span className="font-mono text-[11px] font-medium tracking-[0.22em] text-[#5ee6c1] uppercase">
              gap tugadi
            </span>
            <span className="font-mono text-[13px] text-[#c6d3de]">
              Keyingi gapga o&apos;tish uchun <kbd className={KBD}>Enter</kbd> bosing.
            </span>
          </div>
        ) : blocked !== null ? (
          <>
            <BlockedHint key={blocked.nonce} blocked={blocked} expected={expected} />
            {/* Jonli hududdagi YAGONA o'qiladigan matn. Kalitlanmagan va
                chaqnamaydi: ketma-ket bir xil xatoda matn o'zgarmaydi, ya'ni
                DOM ham o'zgarmaydi va e'lon takrorlanmaydi. */}
            <p className="sr-only">
              {expected === undefined
                ? 'Xato belgi bosildi.'
                : `Xato belgi bosildi. Kutilgan belgi: ${keyName(expected)}`}
            </p>
          </>
        ) : session.skipNotice ? (
          <p className="px-1 py-3 font-mono text-[13px] text-[#e0cfa8]">
            Gap tashlandi — dars oxirida qaytadi.
          </p>
        ) : (
          <p className="px-1 py-3 font-mono text-[13px] text-[#7d8b9c]">
            {/* Ilgari bu yerda "Eshitgan so'zingizni yozing" turardi — mexanikani
                TESKARI tushuntirardi: so'z eshitilgani uchun yozilmaydi, aksincha
                birinchi harfi yozilgani uchun eshitiladi (`core/typing.ts`).
                Matn qasddan qisqa: bu hudud balandligi mixlangan (yuqoriga
                qarang) va uzun ko'rsatma ikkinchi qatorga tushib, xabar
                almashganda ekranni sakratardi. */}
            Har so&apos;zning birinchi harfini yozganda o&apos;sha so&apos;z bir marta
            o&apos;qiladi. <kbd className={KBD}>Ctrl+Space</kbd> — qaytarish.
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
                // O'chiq holat 5.32:1 — oldingi so'niq kulrang fon sifatida
                // atigi 2.61:1 edi, ya'ni WCAG 1.4.11 (3:1) dan past.
                session.audioEnabled ? 'bg-[#5ee6c1]' : 'bg-[#7d8b9c]',
              ].join(' ')}
            />
            {session.audioEnabled ? 'Ovoz yoniq' : "Ovoz o'chiq"}
          </Button>

          {/* Yorliqni bilmaydigan yoki sichqoncha bilan ishlaydigan foydalanuvchi
              uchun. Aynan `Ctrl+Space` bilan bir xil funksiyani chaqiradi va u
              ham statistikaga tegmaydi.
              Bosgandan keyin fokus tugmada qoladi — bu ATAYIN: yozuv maydoniga
              zo'rlab qaytarish klaviaturadagi foydalanuvchining fokusini
              o'g'irlagan bo'lardi, tinglovchi esa `window` da o'tirgani uchun
              yozish baribir davom etaveradi. */}
          <Button
            size="sm"
            variant="ghost"
            disabled={!session.audioEnabled}
            onClick={session.replayWord}
          >
            So&apos;zni qaytarish
          </Button>

          {/* Umumiy `ServerBanner` ulanish yo'qligini aytadi; bu belgi esa
              ayni damda QAYSI ovoz eshitilayotganini tugmaning yonida ko'rsatadi. */}
          {session.audioEnabled && !session.serverOk ? (
            <span className="rounded-control border border-[#3a2c12] bg-[#151007] px-2 py-1 font-mono text-[11px] text-[#e0cfa8]">
              zaxira: brauzer ovozi
            </span>
          ) : null}
        </div>

        {/* Ovoz o'chirilganda `Ctrl+Space` yorlig'i ro'yxatdan chiqariladi:
            hook uni bunday holatda bajarmaydi (`replayWord` `audioEnabledRef` da
            to'xtaydi) va yonidagi "So'zni qaytarish" tugmasi ham `disabled`.
            Ishlamaydigan yorliqni reklama qilish — yolg'on va'da. */}
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {SHORTCUTS.filter(
            (item) => session.audioEnabled || item.key !== 'Ctrl+Space',
          ).map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <kbd className={KBD}>{item.key}</kbd>
              <span className="font-mono text-[11px] text-[#7d8b9c]">{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 border-t border-[#1d2833] pt-4 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
        Seans {session.sessionTotal} ta gap yoki 10 daqiqa bilan cheklangan — qaysi biri
        oldin tugasa, natijalar ekrani ochiladi. Tashlangan gap (Esc) statistikaga kirmaydi,
        lekin yo&apos;qolmaydi — dars oxirida qaytadi. Qayta boshlangan urinish (Tab)
        yozilmaydi.
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
