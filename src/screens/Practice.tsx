// Mashq ekrani (PLAN §4, §5b, §7) — marshrut: '/practice/:lessonId'.
//
// Bu fayl FAQAT chizadi. Klaviatura, audio, taymer, statistika va seans
// tugagach '/results/:sessionId' ga o'tish — hammasi `useTypingSession` ichida.
// Shu yerda `window` ga birorta ham tinglovchi qo'shilmaydi: `Enter`/`Tab`/
// `Escape` ni hook allaqachon eshitadi va ikkinchi tinglovchi har bosishni ikki
// marta hisoblab yuborardi. Shu sababli "Enter bosing" ko'rsatkichi ham
// tugma emas, balki shunchaki ko'rsatma.
//
// Diqqat rejimi (`focusMode`) ham shu qoidaga bo'ysunadi: u SOF KO'RINISH
// holati — global tinglovchi qo'shmaydi va seansga umuman tegmaydi. Yozuv,
// taymer, ovoz va statistika rejimdan qat'i nazar bir xil ishlayveradi.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '../components/Button.tsx'
import type { EmphasisRange } from '../core/emphasis.ts'
import { isEmphasized } from '../core/emphasis.ts'
import { maskedIndexes } from '../core/mask.ts'
import type { TypingState } from '../core/types.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import type { BlockedKey } from '../hooks/useTypingSession.ts'
import { useTypingSession } from '../hooks/useTypingSession.ts'
import type { Lesson } from '../store/lessons.ts'
import { getLesson } from '../store/lessons.ts'
import { readPrefs, writePrefs } from '../store/prefs.ts'

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

/** Yozuv maydoni oddiy rejimda: panel karta va fokus halqasi (sahifa fonida turadi). */
const FIELD_NORMAL = `${PANEL} mx-auto mt-4 max-w-5xl p-6 focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14] focus-visible:outline-none sm:p-8`

/**
 * Yozuv maydoni diqqat rejimida: chegara, fon va fokus halqasi YO'Q.
 *
 * Karta shakli bo'lakni ATROFIDAGI narsalardan ajratish uchun kerak edi —
 * diqqat rejimida esa atrofda hech narsa yo'q, ya'ni chegara faqat ko'zni
 * bo'ladigan ramka bo'lib qolardi.
 *
 * `outline-none` SHART: maydon `tabIndex={0}` bilan fokus oladi va brauzer
 * unga o'z halqasini chizardi. Fokus qayerdaligi baribir bilinadi — matn
 * ichidagi kursor chizig'i aynan shu maqsadda turadi, chiqish tugmasi esa
 * fokus olganda o'z halqasini ko'rsatadi.
 *
 * BO'SHLIQ SHU YERDA YO'Q — hammasi qatlamning `p-[30px]` ida (`DIALOG`).
 * Maydon va uni o'rab turgan elementlarning padding/margin yig'indisi aynan
 * 30px bo'lishi kerak, shuning uchun oraliq o'ram ham butunlay olib
 * tashlangan: ilgari bu yerda `p-4 sm:p-8` li markazlashtiruvchi div turardi
 * va yig'indi 48px/80px ga chiqardi. Kenglik cheklovi (`max-w-5xl`) ham
 * yo'q — u 1024px dan keng oynada maydonni o'rtaga tortib, chekkagacha
 * bo'lgan masofani 30px dan ancha kattaga aylantirardi.
 *
 * Joylashuv: BALANDLIK bo'yicha tepada (`justify-start`), UFQ bo'yicha o'rtada
 * (`items-center`). Ustun yo'nalishidagi flexda `items-center` bolaning eniga
 * ham ta'sir qiladi — u cho'zilmay, mazmuni bo'yicha qisqaradi va shu bilan
 * chinakam markazga tushadi. Uzun gap bunda kengaymay qolmaydi: eni yetmasa
 * maydonni to'ldirib, odatdagidek qatorlarga bo'linadi.
 *
 * `min-h-full` — maydon (fokus va tanlash hududi) oynani to'liq egallaydi,
 * matn esa tepada qoladi. Tepaga tekislanganda uzun matn faqat pastga o'sadi,
 * ya'ni qatlam skrollansa ham matnning boshi hech qachon kesilmaydi.
 */
const FIELD_FOCUS = 'flex min-h-full w-full flex-col items-center justify-start outline-none'

/**
 * Diqqat rejimi qatlami: butun oynani qoplaydi va faqat yozuv maydonini
 * qoldiradi.
 *
 * ⭐ `show()`, `showModal()` EMAS — bu qaror o'lchov bilan olingan.
 *
 * Modal dialog "yuqori qatlam"ga (top layer) chiqadi, u esa BUTUN oddiy
 * stacking-kontekstdan yuqorida turadi. Natijada sahifaga tashqaridan
 * qo'shilgan har qanday interfeys — Google Translate ning matn tanlanganda
 * chiqadigan ikonkasi, parol menejeri, lug'at kengaytmalari — qatlam OSTIDA
 * bo'yalardi, garchi ularning `z-index` i 2147483647 bo'lsa ham. Ustiga modal
 * dialog ortidagi hamma narsani bloklaydi, ya'ni ko'ringan taqdirda ham
 * bosib bo'lmasdi. O'lchov (bir xil qatlam, bir xil `z-index: 50`):
 *   `showModal()` -> ustidagi element: bizning maydon;
 *   `show()`      -> ustidagi element: kengaytmaniki.
 * Mashq matnini tanlab tarjima qilish — bu ilovada kutiladigan ish, shuning
 * uchun modal rejimdan voz kechildi.
 *
 * Modal bo'lmagan dialog uchun brauzer ikki narsani endi BAJARMAYDI, ya'ni
 * ular qo'lda qilinadi:
 *   - qatlam yuqori qatlamga chiqmaydi -> `z-50` yetarli: `Layout` dagi
 *     sticky sarlavha `z-20` da va ikkalasi bir xil stacking-kontekstda;
 *   - ort fon o'z-o'zidan inert bo'lmaydi -> effekt `<main>` ning qo'shni
 *     elementlariga (sarlavha, `ServerBanner`, o'tkazib yuborish havolasi)
 *     `inert` qo'yadi. Usiz ko'rinmay qolgan navigatsiyaga `Shift+Tab` bilan
 *     (u ilova tomonidan tutilmaydi — `core/keyboard.ts` dagi `isShiftTab`)
 *     yoki ekran o'quvchi bilan yetib borish mumkin edi. Kengaytmalarning
 *     elementlari `<body>` da, ya'ni bu ro'yxatga TUSHMAYDI va ishlayveradi.
 *
 * `overscroll-contain` — modal dialog sahifa skrollini o'zi to'xtatardi;
 * modalsizida esa qatlam oxiriga yetgan g'ildirak ortdagi sahifani surib
 * yuborardi.
 *
 * Fon `#21222c` — ilovaning `--color-base` (`#0b0f14`) idan FARQ QILADI va bu
 * ataylab: diqqat rejimi boshqa ekran emas, boshqa MUHIT. Rang bir bosqich
 * ochiqroq va ko'kroq: qorong'i xonada sof qora-ko'k fondagi matnning keskin
 * chekkasi ko'zni tezroq charchatadi. Matn ranglari kontrastni saqlaydi —
 * eng past juftlik yozilmagan matn `#7d8b9c` bo'lib, 4.54:1 beradi (WCAG AA
 * uchun oddiy matnda 4.5:1 talab qilinadi, bu yerdagi 21/25px matn esa
 * "yirik" hisoblanib, 3:1 bilan ham yetarli bo'lardi).
 *
 * `max-h-none`/`max-w-none`/`m-0`/`border-0` — brauzerning `dialog` uchun
 * standart uslublarini (markazga tortilgan, mazmun bo'yicha o'lchamli, ramkali
 * quti) yechish uchun.
 *
 * `p-[30px]` — yozuv maydonini o'rab turgan YAGONA bo'shliq: maydonning o'zida
 * ham, oradagi elementlarda ham padding/margin yo'q (`FIELD_FOCUS`), ya'ni matn
 * oyna chekkasidan aynan 30px da turadi va bu masofa bitta joydan boshqariladi.
 * `box-sizing: border-box` (Tailwind preflight) tufayli `h-full` shu paddingni
 * O'Z ICHIGA oladi — qatlam oynadan tashqariga chiqmaydi.
 */
const DIALOG = [
  'fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none',
  'overflow-y-auto overscroll-contain border-0 bg-[#21222c] p-[30px] text-[#e6edf3]',
].join(' ')

/**
 * Diqqat rejimi qatlamining foni — PWA oynasining sarlavha panelini bo'yash
 * uchun (`theme-color`, `index.html` ga qarang).
 *
 * Qiymat yuqoridagi `bg-[#21222c]` bilan bir xil bo'lishi SHART, lekin sinf
 * bu konstantadan yasala olmaydi: Tailwind manba faylni matn sifatida o'qiydi
 * va o'zgaruvchining qiymatini bilmaydi, ya'ni sinf umuman generatsiya
 * qilinmasdi. Shuning uchun rang ikki joyda yozilgan — o'zgartirilsa ikkovi
 * ham yangilanishi kerak.
 */
const FOCUS_BG = '#21222c'

/** Diqqat rejimidagi chiqish tugmasi shuncha vaqt harakatsizlikdan keyin so'nadi. */
const CONTROLS_IDLE_MS = 2_500

/** Chiqish tugmasining nomi — `aria-label` va `title` uchun YAGONA manba. */
const EXIT_LABEL = 'Diqqat rejimidan chiqish'

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
 * ⚠️ Kutilgan belgini KO'RSATADI, ya'ni bosh harf rejimida yashirin harfni
 * ochib beradi. Bu ongli qaror: rejim yoqilganda so'zni eshita olmagan
 * foydalanuvchi uchun boshqa chiqish yo'li qolmaydi (kursor noto'g'ri belgida
 * turib qoladi — `typing.ts`, `block` rejimi), maslahat esa faqat XATO
 * bosgandan keyin chiqadi va o'sha xato aniqlik ko'rsatkichiga yoziladi. Ya'ni
 * "ochib olish" bepul emas.
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

/** `null` bo'laklarni tashlab sinf ro'yxatini yig'adi — shartli sinf uchun. */
function classes(...tokens: (string | null)[]): string {
  return tokens.filter((token): token is string => token !== null).join(' ')
}

/**
 * Ta'kidlashsiz gaplar uchun BARQAROR bo'sh ro'yxat.
 * Har renderda yangi `[]` yasalsa, `Sentence` ning propi har safar o'zgargan
 * ko'rinardi — hozir memoizatsiya yo'q, lekin bu tuzoqni qoldirmagan ma'qul.
 */
const NO_EMPHASIS: readonly EmphasisRange[] = []

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
  emphasis,
  masked,
  sentenceNo,
  sentenceTotal,
}: {
  state: TypingState
  blocked: BlockedKey | null
  /** Import paytida `` `...` `` bilan belgilangan qalin oraliqlar (`core/emphasis.ts`). */
  emphasis: readonly EmphasisRange[]
  /** Bosh harf rejimi yoniqmi (`core/mask.ts`). */
  masked: boolean
  sentenceNo: number
  sentenceTotal: number
}) {
  const chars = state.target.split('')
  const caretColor = blocked === null ? '#5ee6c1' : '#ff6b6b'

  // Gap uchun bir marta: `state.tokens` gap davomida o'zgarmaydi (`typing.ts`
  // `reduce` uni yangilamaydi), ya'ni har bosishda qayta hisoblash behuda
  // bo'lardi. Rejim o'chiq bo'lsa umuman hisoblanmaydi.
  const hidden = useMemo(
    () => (masked ? maskedIndexes(state.tokens) : null),
    [masked, state.tokens],
  )

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

          // ⭐ Bosh harf rejimi. Ikki shart BIRGA:
          //
          //   `i >= state.cursor`  — YOZILGAN qism doim ochiq qoladi. Aks holda
          //     xato rangi, nuqtali tag chizig'i va "qayerdaligim" hissi
          //     birdan yo'qolardi: mashqning qiyin joyi keyingi so'zni ESLASH,
          //     yozganini ko'ra olmaslik emas. `Backspace` kursorni orqaga
          //     surganda harflar qaytadan yashirinadi — bu ham to'g'ri: ular
          //     endi yana yoziladigan harflar.
          //
          //   `hidden.has(i)`      — qoida `core/mask.ts` da, shu yerda emas.
          //
          // Yashirish `visibility: hidden` (Tailwind `invisible`) bilan, MATN
          // RANGINI shaffof qilish bilan emas. Uch sabab:
          //   1. Yuqori kontrast rejimida (`forced-colors: active`) brauzer
          //      matn RANGINI o'zinikiga majburan almashtiradi — shaffof harf
          //      o'sha muhitda butunlay ochilib qolardi;
          //   2. shaffof matnni sichqoncha bilan TANLAB ko'rish mumkin
          //      (tanlash foni ostida harf ko'rinadi), `visibility: hidden`
          //      esa umuman tanlanmaydi;
          //   3. ikkalasi ham joyni saqlaydi, ya'ni "sakramaslik" shartida
          //      farq yo'q — bu tanlov hech narsaga tushmaydi.
          const invisible = hidden !== null && i >= state.cursor && hidden.has(i)

          // Qalinlik YOZUV HOLATIDAN mustaqil: u matn muallifining belgisi, holat
          // emas — shuning uchun uchala tarmoqda ham (yozilgan / kursor / yozilmagan)
          // bir xil qo'llanadi va terish davomida o'zgarmaydi. Monospace shriftda
          // qalin variantning advance eni bir xil, ya'ni matn qayta joylashmaydi.
          const weight = isEmphasized(emphasis, i) ? 'font-bold' : null

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
                className={classes(
                  'relative',
                  weight,
                  // `visibility` MEROS bo'ladi, ya'ni kursor chizig'i ham shu
                  // bilan yo'qolardi — u pastda `visible` bilan qaytariladi.
                  invisible ? 'invisible' : null,
                  blocked !== null
                    ? 'text-[#ffc2c2]'
                    : errors > 0
                      ? 'text-[#b08a90]'
                      : 'text-[#7d8b9c]',
                )}
              >
                {/* Kursor chizig'i alohida element: probel ustida ham ko'rinadi.
                    Yonib-o'chish ATAYIN yo'q: `animate-pulse` sikl davomida
                    shaffoflikni 50% ga tushiradi va bloklangan holatda kontrast
                    2.49:1 gacha pasayadi (3:1 dan past). Kursor o'rinni
                    ko'rsatuvchi yagona signal bo'lgani uchun uning ko'rinishi
                    hech qachon pasaymasligi kerak. Qolaversa animatsiya 2 s,
                    kursor esa har ~200 ms da siljiydi — ya'ni u har safar
                    tasodifiy shaffoflikda paydo bo'lardi. */}
                {/* `visible` — bosh harf rejimida kursordagi HARF yashirin,
                    lekin kursorning O'ZI ko'rinishi SHART: u yozuv qayerda
                    turganini ko'rsatuvchi yagona signal va aynan yashirin
                    joyda eng kerak. */}
                <span
                  className="visible absolute top-[0.12em] bottom-[0.12em] -left-px w-[2px] rounded-full"
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
                className={classes(
                  weight,
                  errors > 0
                    ? 'text-[#f2b544] underline decoration-dotted underline-offset-4'
                    : 'text-[#e6edf3]',
                )}
              >
                {ch}
              </span>
            )
          }

          // Hali yozilmagan. `Backspace` dan keyin kursor ORQAGA qaytishi mumkin,
          // shuning uchun oldinda ham xatosi bor pozitsiya uchraydi.
          return (
            <span
              key={i}
              className={classes(
                weight,
                invisible ? 'invisible' : null,
                errors > 0 ? 'text-[#b08a90]' : 'text-[#7d8b9c]',
              )}
            >
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
          tushunarsiz chiqadi.

          ⚠️ Bosh harf rejimida bu matn TO'LIQ qoladi va bu ongli qaror. Rejim
          KO'RISH kanalidan nusxa ko'chirishni oladi; ekran o'quvchi bilan
          ishlaydigan foydalanuvchida o'sha kanal yo'q — unga niqoblangan matn
          berilsa ("Te, nuqta, nuqta"), qoladigan narsa umuman yozib bo'lmaydigan
          gap bo'lardi. Ya'ni niqob u yerda qiyinlik emas, to'siq bo'lib
          qolardi. */}
      <p className="sr-only" aria-live="polite">
        <span lang="uz">
          {sentenceNo} / {sentenceTotal}-gap:{' '}
        </span>
        <span lang="en">{state.target}</span>
      </p>
    </>
  )
}

/**
 * ⭐ Diqqat rejimining YAGONA boshqaruvi — shu tugma ham kiritadi, ham chiqaradi.
 *
 * Nega alohida komponent: tugma ikki xil joyda chiqadi (oddiy rejimda boshqaruv
 * qatorida, diqqat rejimida qatlam burchagida), lekin xatti-harakati va
 * yozuvi bir manbadan kelishi kerak — ikki nusxa yozilsa ular vaqt o'tib
 * ajralib ketardi.
 */
function FocusToggle({
  active,
  className,
  onToggle,
}: {
  active: boolean
  className?: string
  onToggle: () => void
}) {
  /**
   * `Enter` shu tugmada TO'XTAYDI va `window` gacha yetmaydi.
   *
   * Sababi: `useTypingSession` `window` da o'tirib `Enter` ning brauzer
   * xatti-harakatini to'xtatadi (`shouldPreventDefault`). Ya'ni fokus tugmada
   * turganda `Enter` uni BOSMASDI — diqqat rejimidan klaviatura bilan
   * chiqishning yagona yo'li yo'qolardi. Hodisa shu yerda to'xtatilsa
   * `preventDefault()` umuman chaqirilmaydi va brauzer tugmani odatdagidek
   * bosadi; seans esa bosishni ko'rmaydi — bu ham to'g'ri, foydalanuvchi
   * tugmani bosdi, gapni tugatmadi.
   *
   * Probel ATAYIN o'tkazib yuboriladi: u mashqda haqiqiy belgi. Bu yerda tutib
   * qolinsa, tugmada fokus qolgan foydalanuvchi probel bosganda matn o'rniga
   * rejim almashardi (ilovadagi boshqa tugmalar ham xuddi shunday ishlaydi:
   * fokus ularda tursa ham yozish davom etaveradi).
   */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter') event.stopPropagation()
  }

  // `aria-pressed` ATAYIN yo'q — yonidagi "Ovoz yoniq" tugmasidan farqli o'laroq.
  // U yerda yozuv HOLATNI ataydi ("ovoz yoniq"), shuning uchun "bosilgan/bosilmagan"
  // bilan bir yo'nalishda o'qiladi. Bu yerda esa tugma HARAKATNI ataydi va ikkovi
  // qarama-qarshi chiqardi: ekran o'quvchi "Diqqat rejimidan chiqish, bosilgan"
  // deb o'qib, foydalanuvchini chalg'itardi. Nomning o'zi nima bo'lishini to'liq
  // aytadi (pleyerdagi "ijro"/"to'xtat" tugmasi kabi).

  // Diqqat rejimida yozuv yo'q — faqat X. Rejimning butun mohiyati ekranda matndan
  // boshqa hech narsa qolmasligi, matnli tugma esa aynan o'sha "boshqa narsa"
  // bo'lardi. Nom shuning uchun ikki kanaldan beriladi:
  //   `aria-label` — ekran o'quvchi uchun (SVG `aria-hidden`, ya'ni tugma usiz
  //                  butunlay nomsiz qolardi);
  //   `title`      — sichqoncha ushlab turilganda chiqadigan brauzer maslahati.
  // Ikkovi bir xil matn: `title` yolg'iz o'zi ishonchli nom emas (ekran o'quvchilar
  // uni har xil o'qiydi, klaviatura bilan esa umuman ko'rinmaydi).
  if (active) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={EXIT_LABEL}
        title={EXIT_LABEL}
        // `px-0!` — `size="sm"` ning `px-3` i bilan bitta xossa uchun kurashadi va
        // g'olibni sinf tartibi emas, uslublar jadvalidagi tartib hal qilardi.
        // Muhimlik belgisi natijani mixlab qo'yadi: tugma 32x32 kvadrat bo'ladi.
        className={`h-8 w-8 px-0! ${className ?? ''}`}
        onClick={onToggle}
        onKeyDown={onKeyDown}
      >
        {/* `stroke="currentColor"` — X tugmaning matn rangini oladi, ya'ni
            `hover`/`focus` holatlarida u bilan birga yorishadi. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      Diqqat rejimi
    </Button>
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

  // ⭐ Diqqat rejimi: butun oynada faqat yozuv maydoni qoladi.
  const [focusMode, setFocusMode] = useState(false)

  /**
   * ⭐ Bosh harf rejimi: so'z harflari yashiriladi (`core/mask.ts`).
   *
   * Diqqat rejimidan FARQLI o'laroq saqlanadi (`store/prefs.ts`). Sabab
   * mashqning ritmida: seans 10 gap yoki 10 daqiqada tugaydi va Natijalar
   * ekranidan qaytilganda bu komponent QAYTA ulanadi — saqlanmasa rejimni
   * kuniga o'nlab marta qayta yoqishga to'g'ri kelardi. Diqqat rejimi esa
   * "hozir jim o'tirib yozaman" degan bir martalik qaror.
   *
   * Boshlang'ich qiymat FUNKSIYA orqali o'qiladi: `useState(readPrefs()...)`
   * omborni har renderda qayta o'qirdi.
   */
  const [maskWords, setMaskWords] = useState(() => readPrefs().maskWords)

  function toggleMask(): void {
    setMaskWords((on) => {
      const next = !on
      // Yozish natijasi TEKSHIRILMAYDI: kvota to'lgan bo'lsa ham rejim shu
      // mashqda ishlayveradi, faqat keyingi safar esda qolmaydi (`prefs.ts`).
      writePrefs({ maskWords: next })
      return next
    })
  }
  /** Chiqish tugmasi ayni damda ko'rinib turibdimi (pastdagi izohga qarang). */
  const [controlsVisible, setControlsVisible] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fieldRef = useRef<HTMLElement>(null)

  /**
   * Chiqish tugmasini ko'rsatadi va harakatsizlik taymerini qaytadan qo'yadi.
   *
   * Tugma DOIM ko'rinib tursa diqqat rejimi o'z ma'nosini yo'qotardi, butunlay
   * yashirilsa esa sichqoncha bilan ishlaydigan foydalanuvchi rejimdan chiqish
   * yo'lini topa olmasdi. Shuning uchun u video pleyer boshqaruvi kabi
   * tutadi: sichqoncha qimirlasa chiqadi, `CONTROLS_IDLE_MS` dan keyin so'nadi.
   * Klaviatura fokusi tushganda esa CSS (`focus-visible:opacity-100`) uni
   * shu holatdan qat'i nazar ko'rsatadi — aks holda tugma fokusda bo'lib
   * turib ko'rinmasdi.
   */
  const revealControls = useCallback((): void => {
    setControlsVisible(true)
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setControlsVisible(false)
    }, CONTROLS_IDLE_MS)
  }, [])

  /** Yozish boshlanishi bilan tugma darhol so'nadi — taymerni kutib turmaydi. */
  const hideControls = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setControlsVisible(false)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
    }
  }, [])

  // Dialog FAQAT diqqat rejimida chiziladi, ya'ni bu effekt aynan rejimga
  // kirganda ishga tushadi (aks holda `ref` bo'sh va effekt darhol qaytadi).
  // Qatlam ochilishi bilan chiqish tugmasi bir marta ko'rsatiladi: rejimga
  // endigina kirgan foydalanuvchi undan qanday chiqishni ko'rib qolsin.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    // `showModal()` EMAS, `show()` — farqi `DIALOG` izohida tushuntirilgan.
    // Tekshiruv `dialog` ni qo'llab-quvvatlamaydigan muhit uchun (masalan test
    // muhitidagi DOM): u yerda atribut qo'lda qo'yiladi, ilova yiqilmaydi.
    if (typeof dialog.show === 'function') dialog.show()
    else dialog.open = true

    // Ort fonni inert qilamiz. `<main>` ning O'ZI chetda qoladi: qatlam ham
    // uning ichida. `Layout` dan qidirish `#asosiy` orqali — bu ID o'tkazib
    // yuborish havolasining nishoni, ya'ni tasodifiy emas, kelishilgan nuqta.
    // Topilmasa (Layout o'zgargan bo'lsa) rejim baribir ishlaydi, faqat
    // ko'rinmay qolgan navigatsiya klaviatura uchun ochiq qoladi.
    const main = dialog.closest('main')
    const covered =
      main === null || main.parentElement === null
        ? []
        : [...main.parentElement.children].filter((element) => element !== main)
    for (const element of covered) element.setAttribute('inert', '')

    // O'rnatilgan PWA oynasining sarlavha paneli (telefonda — brauzer manzil
    // satri) `theme-color` dan bo'yaladi va Chrome uni JONLI kuzatadi. Diqqat
    // rejimida qatlam butun oynani egallaydi, ya'ni panel ham shu rangda
    // bo'lmasa tepada begona tasma qolib ketardi. Eski qiymat saqlanadi:
    // rejimdan chiqilganda ilova o'z fon rangiga qaytadi.
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    const previousTheme = themeMeta === null ? null : themeMeta.getAttribute('content')
    themeMeta?.setAttribute('content', FOCUS_BG)

    revealControls()
    return () => {
      for (const element of covered) element.removeAttribute('inert')
      if (themeMeta !== null && previousTheme !== null) {
        themeMeta.setAttribute('content', previousTheme)
      }
      if (dialog.open) dialog.close()
    }
  }, [focusMode, revealControls])

  // Ekran ochilishi bilan fokus mashq maydonida bo'lsin: usiz foydalanuvchi
  // qayerga yozishni bilmaydi, fokus halqasi esa faqat bosilgandan keyin
  // chiqadi. `preventScroll` SHART — usiz brauzer maydonni ko'rinishga tortib,
  // sahifani sakratib yuboradi. Seans `key={lesson.id}` bilan kalitlangani
  // uchun bu effekt boshqa darsga o'tilganda ham qayta ishlaydi.
  //
  // Bog'liqlikda `focusMode` ham bor: rejim almashganda `<section>` DOM daraxtida
  // BOSHQA joyga ko'chadi (qatlam ichiga va qaytib), ya'ni React eski tugunni
  // yo'q qilib yangisini yasaydi va fokus `<body>` ga tushib qolardi. Effekt
  // yuqoridagi dialog effektidan KEYIN e'lon qilingan — effektlar e'lon
  // tartibida ishlaydi, `showModal()` esa fokusni qatlamdagi birinchi
  // fokuslanadigan elementga (chiqish tugmasiga) ko'chirib qo'yadi.
  useEffect(() => {
    fieldRef.current?.focus({ preventScroll: true })
  }, [focusMode])

  const field = (
    // Yozuv maydoni. Bu yerda matn kiritish elementi YO'Q: hook `INPUT`,
    // `TEXTAREA`, `SELECT` va `contenteditable` ustidagi bosishlarni o'ziga
    // olmaydi, ya'ni maydon faqat shunday holatda ishlaydi.
    //
    // `tabIndex={0}` — maydon fokus olsin (fokus halqasi qayerda yozilayotganini
    // ko'rsatadi). Mashq paytida oldinga `Tab` gapni qaytadan boshlaydi,
    // shuning uchun bu yerga sichqoncha yoki `Shift+Tab` bilan kelinadi.
    // `role`/`aria-label` esa ekran o'quvchisi uchun nomni beradi — nomsiz
    // fokus nuqtasi "guruh" bo'lib o'qilardi.
    <section
      ref={fieldRef}
      tabIndex={0}
      role="region"
      aria-label="Yozuv maydoni"
      // Ikki rejim ikki xil ko'rinish: oddiy rejimda karta (atrofidagi HUD va
      // boshqaruvlardan ajralib tursin), diqqat rejimida esa ramkasiz matn.
      className={focusMode ? FIELD_FOCUS : FIELD_NORMAL}
    >
      <Sentence
        state={state}
        blocked={blocked}
        emphasis={lesson.emphasis?.[session.sentenceIndex] ?? NO_EMPHASIS}
        masked={maskWords}
        sentenceNo={session.sentenceIndex + 1}
        sentenceTotal={lesson.sentences.length}
      />
    </section>
  )

  const status = (
    // Balandligi o'zgarmaydi — xabar almashganda ekran sakramasin. Tor
    // ekranda `blocked` xabari ikki-uch qatorga yoyilib ~92px ga chiqadi,
    // shuning uchun 54px faqat `sm` dan boshlab yetarli.
    //
    // Diqqat rejimida hudud KO'ZDAN yashiriladi, lekin o'chirilmaydi va
    // qatlam ICHIDA qoladi. Ikki sabab: (1) bu "gap tugadi", "xato belgi" va
    // "gap tashlandi" xabarlarining ekran o'quvchi uchun yagona manbai —
    // `hidden`/`display:none` qo'yilsa jonli hudud butunlay jim bo'lardi;
    // (2) modal dialog ortidagi hamma narsa inert, ya'ni qatlamdan TASHQARIDA
    // qolgan jonli hudud baribir e'lon qilinmasdi.
    <div
      role="status"
      aria-live="polite"
      className={focusMode ? 'sr-only' : 'mt-3 min-h-23 sm:min-h-13.5'}
    >
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
              o'zidan oldingi belgi yozilgani uchun eshitiladi va shundan keyin
              teriladi (`core/typing.ts`, `wordToPlay`). Matn qasddan qisqa: bu
              hudud balandligi mixlangan (yuqoriga qarang) va uzun ko'rsatma
              ikkinchi qatorga tushib, xabar almashganda ekranni sakratardi. */}
          Har so&apos;z o&apos;zidan oldingi belgi yozilganda bir marta
          o&apos;qiladi. <kbd className={KBD}>Ctrl+Space</kbd> — qaytarish.
        </p>
      )}
    </div>
  )

  if (focusMode) {
    return (
      // `onKeyDown` va `onPointerMove` — element darajasidagi tinglovchilar,
      // `window` ga hech narsa qo'shilmaydi (fayl boshidagi qoida). Ular
      // hodisani na to'xtatadi, na bekor qiladi: seans ularni odatdagidek
      // `window` da qabul qilaveradi.
      <dialog
        ref={dialogRef}
        aria-label="Diqqat rejimi"
        className={DIALOG}
        onPointerMove={revealControls}
        onKeyDown={hideControls}
        onCancel={(event) => {
          // `Escape` bu ilovada GAPNI TASHLASH tugmasi (PLAN §4). Brauzerning
          // "Escape — dialogni yop" xatti-harakati qoldirilsa, bitta bosish
          // ikki ishni birdan qilardi: gap tashlanib, ustiga rejimdan ham
          // chiqilardi. Rejimdan faqat tugma orqali chiqiladi.
          //
          // Spetsifikatsiya bo'yicha bu hodisa MODAL dialogda chiqadi, biznikisi
          // esa modalsiz (`show()`), ya'ni amalda chaqirilmasligi kerak.
          // Qoldirildi: qoida o'zgarsa yoki brauzer boshqacha qilsa, qatlam
          // jimgina yopilib ketmasligi kerak.
          event.preventDefault()
        }}
      >
        {/* Maydon qatlamning BEVOSITA bolasi: oraliq o'ram bo'lsa uning
            padding'i ham 30px lik yig'indiga qo'shilardi. */}
        {field}
        {status}
        <FocusToggle
          active
          className={[
            'fixed top-4 right-4 z-10',
            'transition-opacity duration-200 ease-out motion-reduce:transition-none',
            'focus-visible:opacity-100',
            controlsVisible ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          onToggle={() => {
            setFocusMode(false)
          }}
        />
      </dialog>
    )
  }

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

      {field}

      {status}

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

          {/* ⭐ Bosh harf rejimi. Seansga TEGMAYDI (diqqat rejimi kabi): taymer,
              ovoz va statistika o'zgarmaydi — yashirilgan matn ham aynan o'sha
              matn bo'lib qolaveradi.

              YOZUV o'zgarmaydi, holatni nuqta va `aria-pressed` aytadi. Bu
              yonidagi "Ovoz yoniq / Ovoz o'chiq" dan boshqacha va ATAYIN: u
              yerda yozuv HOLATNI ataydi, bu yerda esa rejim nomi ikkiga
              bo'linmaydi — "Butun matn / Faqat bosh harf" juftligi tugmani
              nima qilishini emas, hozir nima ko'rinayotganini aytardi va bosish
              paytida o'quvchi ikkovini bir-biriga chalkashtirardi. Nom rejimni
              ataydi, `aria-pressed` esa yoniq-o'chiqni — bu oddiy almashtirgich
              tugmasining standart shakli.

              `title` — nuqta rangini ko'rmaydigan yoki nomni birinchi marta
              ko'rgan foydalanuvchi uchun: rejim nima qilishini bir jumlada
              aytadi. */}
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={maskWords}
            title="So'zlarning faqat bosh harfi ko'rinadi, qolgan harflar yashiriladi — matn diktant bo'lib qoladi. Tinish belgisi, raqam va yozib bo'lingan qism ochiq turadi."
            onClick={toggleMask}
          >
            <span
              aria-hidden="true"
              className={[
                'h-1.5 w-1.5 rounded-full',
                maskWords ? 'bg-[#5ee6c1]' : 'bg-[#7d8b9c]',
              ].join(' ')}
            />
            Bosh harf rejimi
          </Button>

          {/* Butun oynani yozuv maydoniga topshiradi. Seansga TEGMAYDI: taymer
              yurishda davom etadi, ovoz va statistika o'zgarmaydi — bu faqat
              ko'rinish rejimi (fayl boshidagi izohga qarang). */}
          <FocusToggle
            active={false}
            onToggle={() => {
              setFocusMode(true)
            }}
          />

          {/* Umumiy `ServerBanner` ulanish yo'qligini aytadi; bu belgi esa
              ayni damda QAYSI ovoz eshitilayotganini tugmaning yonida ko'rsatadi. */}
          {session.audioEnabled && !session.serverOk ? (
            <span className="rounded-control border border-[#3a2c12] bg-[#151007] px-2 py-1 font-mono text-[11px] text-[#e0cfa8]">
              zaxira: brauzer ovozi
            </span>
          ) : null}

          {/* Ikkovi birga yoqilganda mashq deyarli imkonsiz bo'lib qoladi:
              so'z ham ko'rinmaydi, ham eshitilmaydi — qoladigan yagona manba
              xato bosgandan keyin chiqadigan "kutilgan belgi" maslahati.
              Rejim baribir O'CHIRILMAYDI (bu foydalanuvchining qarori, masalan
              yod olingan matnni tekshirish), lekin holat aytib qo'yiladi: aks
              holda birinchi gapdayoq ilova buzilgandek tuyulardi. */}
          {maskWords && !session.audioEnabled ? (
            <span className="rounded-control border border-[#3a2c12] bg-[#151007] px-2 py-1 font-mono text-[11px] text-[#e0cfa8]">
              ovoz o&apos;chiq — yashirin so&apos;z eshitilmaydi
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
