// Mashq ekranining ikonkalari.
//
// ⭐ NEGA KUTUBXONA EMAS: ilovada birorta ham UI paketi yo'q (`package.json` da
// faqat react, react-router va serverning bog'liqliklari). Besh dona glif uchun
// `lucide-react` kabi paket kiritish yig'ilmaga butun bir daraxtni olib
// kirardi, holbuki bu yerda kerak bo'lgani — bir nechta `<path>`.
//
// ⭐ NEGA BITTA FAYL: gliflar ekranda YONMA-YON turadi (diqqat rejimining
// suzuvchi burchak qatori), ya'ni ular bir xil o'lchov tizimida chizilishi
// SHART — 16 lik `viewBox`, 1.5 kenglikdagi chiziq, yumaloq uch va burchaklar.
// Har biri o'z joyida yozilsa, birinchi mos kelmagan qiymat qatorni notekis
// qilib qo'yardi (ilgari `Practice.tsx` ichida yolg'iz turgan × aynan shunday
// edi: u 14px, qolganlari 16px bo'lardi).
//
// ⚠️ Hammasi `aria-hidden`: ikonka tugmaga NOM BERMAYDI. Nomni tugmaning
// `aria-label` i beradi (`Practice.tsx` dagi `FocusToggle` naqshi) — usiz
// yozuvsiz tugma ekran o'quvchi uchun butunlay nomsiz qolardi.

import type { ReactNode } from 'react'

/**
 * Ikonkaning standart o'lchami: 32px lik tugma ichida 16px glif.
 *
 * Chetdan 8px bo'shliq qoladi — bosish nishoni to'liq tugma bo'lib qolaveradi,
 * glif esa qo'shni matnli yozuvlar (13px) bilan bir og'irlikda ko'rinadi.
 */
const SIZE = 'h-4 w-4'

/**
 * Barcha gliflarning umumiy o'ramchisi.
 *
 * `stroke="currentColor"` — glif tugmaning MATN rangini oladi, ya'ni
 * `hover`/`focus`/`disabled` holatlarida u bilan birga o'zgaradi. Aks holda
 * o'chirilgan tugmadagi ikonka yorqin bo'lib qolardi va tugma bosiladigandek
 * ko'rinardi (`Button.tsx` da o'chirilgan holat ATAYIN shaffoflik bilan emas,
 * aniq ranglar bilan berilgan).
 */
function Glyph({ className = SIZE, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Yopish (×) — diqqat rejimidan chiqish. */
export function CloseIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Glyph>
  )
}

/**
 * Rasm qo'shish: ramka + manzara, yuqori o'ng burchakda `+`.
 *
 * Ramkaning o'ng-yuqori burchagi ATAYIN ochiq qoldirilgan — `+` aynan o'sha
 * bo'shliqqa tushadi. Yopiq ramkada plyus chiziqlar ustiga chiqib, 16px da
 * ikkovi ham tanib bo'lmas dog'ga aylanardi.
 */
export function ImagePlusIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M10.5 8v3a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 11V5A1.5 1.5 0 0 1 3 3.5h3" />
      <path d="M12 2.5v4M10 4.5h4" />
      <circle cx="4.5" cy="6.5" r="1" />
      <path d="M2 11.5 4.75 8.75l2.5 2.5" />
    </Glyph>
  )
}

/**
 * Yozuvga qaytish: pastdan ko'tarilib chapga buriladigan strelka.
 *
 * Bu "javob/orqaga" giflining shakli va ma'nosi ham o'sha — HARAKAT: fokusni
 * qaytarish. Yo'nalish tasodifiy emas: strelka izoh maydonidan (past) mashq
 * yozuvi tomonga (yuqori-chap) ketadi, ya'ni kartadagi haqiqiy joylashuvni
 * takrorlaydi.
 *
 * ⚠️ Enter belgisi (↵) ATAYIN OLINMADI: bu ilovada `Enter` — "keyingi gap",
 * ya'ni o'sha glif tugmani gapni yakunlaydigandek ko'rsatib, aynan qaytishdan
 * qo'rqitardi.
 */
export function ReturnIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M6 9.5 3 6.5l3-3" />
      <path d="M12.5 13V9.5a3 3 0 0 0-3-3H3" />
    </Glyph>
  )
}

/** Izoh va rasm: varaq + qalam — "shu gapga yozib qo'yish". */
export function NoteIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M8 2.5H3.5A1.5 1.5 0 0 0 2 4v8a1.5 1.5 0 0 0 1.5 1.5h8A1.5 1.5 0 0 0 13 12V8" />
      <path d="M11.9 2.1a1.55 1.55 0 0 1 2.2 2.2L9.4 9l-2.8.4.4-2.8z" />
    </Glyph>
  )
}

/**
 * Yuklanmoqda halqasi — "Qo'shilmoqda…" yozuvining ikonkadagi o'rnini bosadi.
 *
 * Aylanish `animate-spin` bilan CHAQIRUV JOYIDA beriladi, bu yerda emas: glif
 * o'z-o'zidan aylansa, uni harakatsiz ko'rsatish (masalan tushuntirish
 * rasmida) imkonsiz bo'lardi.
 *
 * To'liq halqa `opacity-30` da qoladi — usiz aylanayotgan yoy fonda uzilib
 * ko'rinib, dumaloq shakl o'qilmasdi.
 */
export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="5.75" className="opacity-30" />
      <path d="M13.75 8A5.75 5.75 0 0 0 8 2.25" />
    </Glyph>
  )
}
