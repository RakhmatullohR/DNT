// So'z -> audio fayl nomi. Bu modulni SERVER HAM, KLIENT HAM import qiladi (PLAN §1).
//
// QAT'IY CHEKLOVLAR (buzilsa ikki toolchain'dan biri yiqiladi):
//   - hech qanday DOM (`window`, `document`, `Blob`) ishlatilmaydi;
//   - hech qanday `node:` moduli (`fs`, `path`) ishlatilmaydi;
//   - hech qanday tashqi paket ishlatilmaydi;
//   - faqat sof funksiyalar — bir xil kirishga doim bir xil chiqish.
// Sabab: server va klient bir xil fayl nomini hisoblashi shart. Kelishmasa
// disk keshi hech qachon urmaydi va har so'z qayta-qayta sintez qilinadi (PLAN §10).

import { OVERRIDES } from './overrides.ts'

/** Standart ovoz. Fayl nomida bu ovoz YOZILMAYDI — u "yalang'och" nom beradi. */
export const DEFAULT_VOICE = 'en-US-AvaNeural'

/** Standart tezlik (foizda). Fayl nomida bu tezlik YOZILMAYDI. */
export const DEFAULT_RATE = 0

/**
 * Ruxsat etilgan ovozlar — faqat en-US va en-GB neural ovozlari.
 * Server bu ro'yxatga qarab validatsiya qiladi: usiz `voice: "../../../.config/x"`
 * fayl nomiga tushib, `audio-words/` dan tashqariga yozardi (PLAN §5a).
 */
export const VOICES: readonly string[] = [
  // en-US
  'en-US-AvaNeural',
  'en-US-AndrewNeural',
  'en-US-EmmaNeural',
  'en-US-BrianNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-US-AriaNeural',
  'en-US-ChristopherNeural',
  'en-US-EricNeural',
  'en-US-MichelleNeural',
  'en-US-RogerNeural',
  'en-US-SteffanNeural',
  // en-GB
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-GB-LibbyNeural',
  'en-GB-MaisieNeural',
  'en-GB-ThomasNeural',
]

/**
 * Ruxsat etilgan tezliklar (foizda). Kutubxonada diapazon tekshiruvi YO'Q —
 * noto'g'ri qiymat buzuq SSML va bo'sh audio beradi (PLAN §5a).
 */
export const RATES: readonly number[] = [0, -10, -25]

/**
 * Ovozni ruxsat etilgan ro'yxatga keltiradi: `VOICES` da yo'q, bo'sh yoki umuman
 * satr bo'lmagan qiymat `DEFAULT_VOICE` ga tushadi.
 *
 * Nega alohida funksiya: omborda `voice` maydoni yo'q eski dars `toLesson`
 * (`src/store/lessons.ts`) dan BO'SH SATR bilan chiqadi, server esa bo'sh
 * `voice` ni 400 bilan rad etadi. Tozalash bir joyda turmasa, darsning bir
 * so'rovi tozalangan, boshqasi xom qiymat bilan ketib, BITTA dars ikki xil
 * ovozda (yoki umuman sintezsiz) qolardi.
 */
export function sanitizeVoice(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_VOICE
  return VOICES.includes(value) ? value : DEFAULT_VOICE
}

/**
 * Tezlikni ruxsat etilgan ro'yxatga keltiradi: `RATES` da yo'q son, `NaN` va
 * son bo'lmagan qiymat `DEFAULT_RATE` ga tushadi. `sanitizeVoice` bilan bir juft —
 * ovoz va tezlik doim BIRGA fayl nomiga tushadi (`audioFilename`).
 */
export function sanitizeRate(value: unknown): number {
  if (typeof value !== 'number') return DEFAULT_RATE
  return RATES.includes(value) ? value : DEFAULT_RATE
}

/**
 * So'z butunlay katta harfdan iborat va uzunligi >= 2 (`US`, `NASA`).
 * Bunday token alohida `@caps` fayliga tushadi va ASL shakli sintez qilinadi —
 * aks holda `US` -> `us.mp3` bo'lib, /ʌs/ deb o'qilardi (PLAN §3).
 */
export function isCapsWord(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word)
}

/**
 * Fayl nomiga aylantirish mumkin bo'lgan so'z: harflar, ichida apostrof yoki tire.
 * Apostrof va tire SAQLANADI -> `don't` va `don-t` to'qnashmaydi (PLAN §3).
 *
 * Bu tekshiruv ayni paytda xavfsizlik chegarasi: `/`, `\`, `.`, `..`, probel va
 * boshqa har qanday belgi rad etiladi, ya'ni fayl nomida yo'l ajratuvchi
 * HECH QACHON paydo bo'lmaydi.
 */
export function isValidWord(word: string): boolean {
  return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(word)
}

/**
 * So'z uchun audio fayl nomi (PLAN §3):
 *   default                  ->  `the.mp3`
 *   katta harfli qisqartma   ->  `us@caps.mp3`
 *   boshqa ovoz YOKI tezlik  ->  `the@en-US-AvaNeural@-25.mp3`
 *
 * Ovoz/tezlik yorlig'i faqat ULARDAN BIRI standartdan farq qilganda qo'shiladi,
 * lekin qo'shilganda IKKALASI ham yoziladi — shunda nom bir ma'noli bo'ladi.
 *
 * Noto'g'ri so'z / noma'lum ovoz / ruxsatsiz tezlikda XATO TASHLAYDI.
 * Server buni 400 ga aylantiradi.
 */
export function audioFilename(
  word: string,
  voice: string = DEFAULT_VOICE,
  rate: number = DEFAULT_RATE,
): string {
  if (!isValidWord(word)) {
    throw new Error(`Fayl nomiga yaroqsiz so'z: ${JSON.stringify(word)}`)
  }
  if (!VOICES.includes(voice)) {
    throw new Error(`Noma'lum ovoz: ${JSON.stringify(voice)}`)
  }
  if (!RATES.includes(rate)) {
    throw new Error(`Ruxsat etilmagan tezlik: ${JSON.stringify(rate)}`)
  }

  let name = word.toLowerCase()
  if (isCapsWord(word)) {
    name += '@caps'
  }
  if (voice !== DEFAULT_VOICE || rate !== DEFAULT_RATE) {
    name += `@${voice}@${rate}`
  }
  return `${name}.mp3`
}

/**
 * Sintezatorga beriladigan matn (PLAN §3):
 *   - katta harfli qisqartma -> ASL shakli (`US`, `NASA`) qaytariladi;
 *   - aks holda overrides jadvalidan qaraladi (kalit — kichik harfli so'z);
 *   - topilmasa so'zning o'zi.
 * Fayl nomi imlodan olinadi, sintez matni esa shu yerda almashadi.
 */
export function synthTextFor(word: string): string {
  if (isCapsWord(word)) {
    return word
  }
  const override = OVERRIDES[word.toLowerCase()]
  return override ?? word
}
