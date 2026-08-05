// Klaviatura adapteri (PLAN §4): `window.keydown` -> yuqori darajali harakat.
//
// Bu qatlam bo'lmasa (PLAN §4 da aynan shu yozilgan):
//   `Ctrl+A`  -> `e.key === "a"` bo'lib TO'G'RI harf deb sanalardi va `a` bilan
//                boshlanadigan so'z ovozini chiqarardi;
//   `Ctrl+R`  -> `"r"` yozilib, ustiga sahifa qayta yuklanardi;
//   strelkalar-> `typed[]` ga "ArrowLeft" kabi 10 belgili satr tushardi.
//
// Modul DOM'ga bog'liq emas: kirish sifatida `KeydownLike` yetarli.

import type { KeyAction, KeydownLike } from './types.ts'

/** `preventDefault()` talab qiladigan boshqaruv tugmalari (PLAN §4). */
const PREVENTED_KEYS: readonly string[] = [' ', 'Tab', 'Backspace', 'Enter', 'Escape']

/**
 * Kirish turi. `Shift` faqat shu modulga kerak bo'lgani uchun umumiy
 * `KeydownLike` ga majburiy maydon qo'shilmaydi — u shu yerda IXTIYORIY qilib
 * kengaytiriladi. DOM ning `KeyboardEvent` ida maydon bor, maydonsiz obyektda
 * esa "bosilmagan" deb o'qiladi.
 */
type KeydownInput = KeydownLike & { shiftKey?: boolean }

/**
 * Modifikator bosilganmi. Modifikatorli bosish — brauzer yorlig'i
 * (`Ctrl+A`, `Ctrl+R`, `Meta+V`, `Ctrl+Tab`), ilova unga TEGMAYDI.
 *
 * `Shift` bu ro'yxatda YO'Q: `Shift+t` — oddiy `T` harfi.
 */
function hasModifier(e: KeydownLike): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

/**
 * `Shift+Tab` ilovaniki EMAS.
 *
 * Tinglovchi `window` da o'tiradi va `preventDefault()` chaqiradi, ya'ni mashq
 * ochiq turganda `Tab` ham, `Shift+Tab` ham BUTUN hujjatdan yo'qolardi: ovoz
 * tugmasi, "Mashqni to'xtatish" havolasi, sarlavhadagi menyu va o'tkazib
 * yuborish havolasi — hech biriga klaviatura bilan yetib bo'lmasdi.
 *
 * PLAN §4 faqat `Tab` -> gapni qayta boshlash deydi, `Shift+Tab` haqida hech
 * narsa demaydi. Shuning uchun u fokusni ko'chirishga qaytariladi: qayta
 * boshlash imkoniyati zarracha kamaymaydi.
 */
function isShiftTab(e: KeydownInput): boolean {
  return e.key === 'Tab' && e.shiftKey === true
}

/**
 * Keydown ni harakatga aylantiradi. Ro'yxatda yo'q hamma narsa — `ignore`
 * (`ArrowLeft`, `F5`, `Shift`, `CapsLock`, `Ctrl+A`, ...).
 *
 * `isComposing` — IME yig'ayotgan paytdagi bosishlar: ular matn emas, shuning
 * uchun butunlay chetlab o'tiladi.
 */
export function mapKeydown(e: KeydownInput): KeyAction {
  if (e.isComposing) return { type: 'ignore' }
  if (hasModifier(e)) return { type: 'ignore' }
  if (isShiftTab(e)) return { type: 'ignore' }

  switch (e.key) {
    case 'Backspace':
      return { type: 'event', event: { type: 'backspace' } }
    case 'Enter':
      return { type: 'next' }
    case 'Escape':
      return { type: 'skip' }
    case 'Tab':
      return { type: 'restart' }
    default:
      break
  }

  // Bitta belgi — matn. Probel ham shu yerga kiradi.
  if (e.key.length === 1) {
    return { type: 'event', event: { type: 'char', char: e.key } }
  }

  return { type: 'ignore' }
}

/**
 * Brauzerning o'z xatti-harakati to'xtatiladimi.
 *
 * `Space` sahifani pastga suradi, `Tab` fokusni ko'chiradi, `Backspace` eski
 * brauzerlarda ortga qaytaradi, `Enter` formani yuboradi, `Escape` yuklanishni
 * uzadi — hammasi mashq oqimini buzadi.
 *
 * Modifikator bosilgan bo'lsa `false`: `Ctrl+R`, `Meta+V`, `Ctrl+Tab` kabi
 * brauzer yorliqlari ishlashi KERAK. `Shift+Tab` ham to'xtatilmaydi — yuqoridagi
 * `isShiftTab` ga qarang.
 */
export function shouldPreventDefault(e: KeydownInput): boolean {
  if (e.isComposing) return false
  if (hasModifier(e)) return false
  if (isShiftTab(e)) return false
  return PREVENTED_KEYS.includes(e.key)
}
