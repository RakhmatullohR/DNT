// Bayt ↔ base64 — dars zaxirasiga rasm qo'shish uchun.
//
// JSON faylga ikkilik ma'lumot to'g'ridan-to'g'ri sig'maydi, shuning uchun
// `lessons.ts` dagi eksport rasmni base64 satri sifatida yozadi. Bu yerdagi
// funksiyalar SOF: DOM ham, IndexedDB ham kerak emas, `btoa`/`atob` esa
// brauzerda ham, Node'da ham global.

/**
 * Bir chaqiruvda `String.fromCharCode` ga beriladigan bayt soni.
 *
 * Butun massivni bitta chaqiruvga bersak, bir necha MB li rasmda JS dvigateli
 * argumentlar stekini to'ldirib `RangeError` beradi — bu mashhur tuzoq va u
 * aynan katta fayllarda, ya'ni eng yomon paytda chiqadi.
 */
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/**
 * Base64 satrini baytlarga qaytaradi; satr buzuq bo'lsa `null`.
 *
 * TASHLAMAYDI: bitta buzuq rasm butun zaxirani tiklashni to'xtatmasligi kerak —
 * chaqiruvchi shu `null` ga qarab faqat o'sha rasmni tashlab, qolganini
 * tiklaydi.
 */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
