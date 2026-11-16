// Bosh harf rejimi (PLAN §4) — gapning qaysi belgilari YASHIRILISHINI hal qiladi.
//
// Rejimning maqsadi: matnni ko'chirib yozishni diktantga aylantirish. Ovoz
// so'zni aytadi, ekranda esa faqat uning BOSH HARFI qoladi — qolgan harflar
// o'z joyini egallab turib ko'rinmaydi (chizuvchi tomonda `visibility: hidden`,
// `Practice.tsx`), ya'ni matn yozish davomida qayta joylashmaydi.
//
// ⭐ QOIDA BITTA: yashiriladigan narsa — SO'Z HARFI, so'zning birinchi
// harfidan boshqasi. Boshqa hamma narsa ko'rinadi. Bu tasodifiy tanlov emas,
// "ovoz aytmagan narsani yashirmaymiz" tamoyilining natijasi:
//
//   - `gap` tokenlari (probel, tinish belgisi, RAQAM) ovozsiz (PLAN §3), ya'ni
//     ularni eshitib bilib bo'lmaydi. Ilova esa noto'g'ri belgida kursorni
//     to'xtatadi (`typing.ts`, `block` rejimi) — ko'rinmaydigan vergul yoki
//     `2024` foydalanuvchini taxmin qilishga majbur qilardi.
//   - So'z ICHIDAGI apostrof va tire (`don't`, `well-known`) ham shu sababdan
//     ko'rinadi: ular `word` tokenining ichida, lekin quloq ularni ajratmaydi.
//     Ya'ni yashirin qoladigan narsa aynan TALAFFUZ QILINGAN harflar.
//   - So'zning birinchi harfi esa ATAYIN qoldiriladi: u so'zni ovoz bilan
//     bog'laydigan langar (qaysi so'z ekani va bosh harfmi-yo'qmi) — ilovada
//     registr QAT'IY (PLAN §4), shuning uchun `The`/`the` farqini ko'rsatib
//     turadigan belgi kerak.
//
// Modul SOF: DOM ham, holat ham yo'q — shu sababdan `core` da va test bilan
// qoplangan.

import type { Token } from './types.ts'

/** ASCII harf. Kirish `normalize.ts` dan keladi, ya'ni diakritika yo'q. */
const LETTER_RE = /[A-Za-z]/

/**
 * Yashiriladigan pozitsiyalar to'plami.
 *
 * `Set` qaytariladi, massiv emas: chizuvchi gapni belgima-belgi aylanib
 * chiqadi va har indeks uchun O(1) javob kerak (`Sentence`, `Practice.tsx`).
 * Natija gap uchun BIR MARTA hisoblanadi — `tokens` gap davomida o'zgarmaydi
 * (`typing.ts` `reduce` ni yangi tokenlar bilan qayta yaratmaydi).
 *
 * Bo'sh to'plam butunlay ehtimolli: so'zsiz gap (`2024.`) yoki hammasi bir
 * harfli so'zlardan iborat gap (`I a`) — bunday gapda rejim ko'rinishga
 * umuman ta'sir qilmaydi va bu TO'G'RI, chunki yashiradigan harf yo'q.
 */
export function maskedIndexes(tokens: readonly Token[]): Set<number> {
  const hidden = new Set<number>()
  for (const token of tokens) {
    if (token.kind !== 'word') continue
    // `i = 1` — birinchi harf hech qachon yashirilmaydi. `WORD_RE`
    // (`tokenize.ts`) so'zni faqat harf bilan boshlaydi, ya'ni `text[0]` doim
    // harf va "birinchi HARF" bilan "birinchi BELGI" bu yerda bir xil narsa.
    for (let i = 1; i < token.text.length; i += 1) {
      const char = token.text[i]
      if (char !== undefined && LETTER_RE.test(char)) hidden.add(token.start + i)
    }
  }
  return hidden
}
