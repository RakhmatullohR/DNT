// Ko'rinish sozlamalari — kalit `dnt.prefs.v1`.
//
// Nega UCHINCHI ombor (`lessons.ts` va `stats.ts` yonida): bu yerdagi qiymat
// na darsning xossasi, na o'lchov. Bosh harf rejimi bitta darsga emas,
// FOYDALANUVCHIGA tegishli — u "men shu tarzda mashq qilaman" degan qaror va
// darslar orasida o'zgarmaydi. Uni `Lesson` ga qo'shish har bir darsda alohida
// yoqishga majbur qilardi, statistikaga qo'shish esa o'lchovni sozlama bilan
// aralashtirardi (va zaxira/tiklash qoidalarini ham unga tortardi).
//
// ⚠️ Bu ma'lumot ZAXIRA QILINMAYDI va bu ATAYIN: yo'qolsa foydalanuvchi bitta
// tugmani qayta bosadi, xolos. Shuning uchun bu yerda `lessons.ts` dagi kabi
// buzuq payload zaxirasi ham, migratsiya ham yo'q — o'qib bo'lmagan qiymat
// jimgina standartga tushadi.

const PREFS_KEY = 'dnt.prefs.v1'

export type Prefs = {
  /**
   * Mashqda so'z harflari yashiriladi, faqat bosh harflar ko'rinadi
   * (`core/mask.ts`).
   */
  maskWords: boolean
}

/** O'chiq holat — standart. Yangi foydalanuvchi avval matnni ko'rib mashq qiladi. */
const DEFAULTS: Prefs = { maskWords: false }

/**
 * `localStorage` ga xavfsiz murojaat — `lessons.ts` dagi `getStore` bilan
 * AYNAN bir xil himoya: Node (test/SSR), cookie'lari o'chirilgan brauzer va
 * `file://` sahifasida murojaatning O'ZI tashlashi mumkin.
 */
function getStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/**
 * Saqlangan sozlamalar; o'qib bo'lmasa standart qiymatlar.
 *
 * HAR SAFAR yangi obyekt qaytadi: chaqiruvchi uni `useState` boshlang'ich
 * qiymati sifatida ushlab qoladi va umumiy nusxani o'zgartirib qo'ymasligi
 * kerak.
 *
 * Nomatanish maydonlar TASHLANMAYDI (`readPrefs` ularni ko'rmaydi, lekin
 * `writePrefs` saqlab qoladi) — kelajakdagi sozlama eski versiyada ochilgan
 * ilova tomonidan o'chirilmasligi uchun.
 */
export function readPrefs(): Prefs {
  const raw = readRaw()
  return {
    maskWords: typeof raw['maskWords'] === 'boolean' ? raw['maskWords'] : DEFAULTS.maskWords,
  }
}

/**
 * Bitta yoki bir nechta sozlamani yozadi; qolganlari tegilmaydi.
 *
 * Natija QAYTARILMAYDI (`lessons.ts` dagi `saveLesson` bilan bir xil qaror):
 * kvota to'lgan bo'lsa ham mashq to'xtamasligi kerak, foydalanuvchi esa faqat
 * "keyingi safar ham yoniq tursin" imkonini yo'qotadi — bu holat uchun
 * xato oynasi ko'rsatish shovqindan boshqa narsa emas.
 */
export function writePrefs(patch: Partial<Prefs>): void {
  const store = getStore()
  if (store === null) return
  try {
    store.setItem(PREFS_KEY, JSON.stringify({ ...readRaw(), ...patch }))
  } catch {
    // Kvota to'lgan yoki yozish taqiqlangan — jimgina davom etamiz.
  }
}

/** Xom obyekt: tanilmagan maydonlar ham shu yerda qoladi (`writePrefs` uchun). */
function readRaw(): Record<string, unknown> {
  const store = getStore()
  if (store === null) return {}

  let raw: string | null = null
  try {
    raw = store.getItem(PREFS_KEY)
  } catch {
    return {}
  }
  if (raw === null || raw === '') return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    // Massiv ham `object` bo'lgani uchun alohida chiqarib tashlanadi.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}
