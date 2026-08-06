// Klaviatura adapteri testlari (PLAN §4 "Klaviatura adapteri").

import { describe, expect, it } from 'vitest'
import { mapKeydown, shouldPreventDefault } from '../../src/core/keyboard.ts'
import type { KeydownLike } from '../../src/core/types.ts'

/**
 * Testlar uchun bosish yasagichi: modifikatorlar sukut bo'yicha o'chiq.
 * `shiftKey` `KeydownLike` da yo'q (u faqat `keyboard.ts` ga kerak), shuning
 * uchun bu yerda qo'shib beriladi — brauzer hodisasida u doim bor.
 */
type Keydown = KeydownLike & { shiftKey: boolean }

function keydown(key: string, mods: Partial<Keydown> = {}): Keydown {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...mods,
  }
}

describe('mapKeydown — harflar', () => {
  it('bitta belgi `char` hodisasiga aylanadi', () => {
    for (const key of ['a', 'Z', '.', ',', "'", '-', '1', '$']) {
      expect(mapKeydown(keydown(key))).toEqual({
        type: 'event',
        event: { type: 'char', char: key },
      })
    }
  })

  it('probel ham oddiy belgi — u ham `char`', () => {
    expect(mapKeydown(keydown(' '))).toEqual({
      type: 'event',
      event: { type: 'char', char: ' ' },
    })
  })

  it('bosh harf o\'zgartirilmaydi: `T` aynan `T` bo\'lib uzatiladi', () => {
    expect(mapKeydown(keydown('T'))).toEqual({
      type: 'event',
      event: { type: 'char', char: 'T' },
    })
  })

  it('`Ctrl` / `Meta` / `Alt` bilan bosilgan harf `ignore`', () => {
    expect(mapKeydown(keydown('a', { ctrlKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('r', { ctrlKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('v', { metaKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('n', { altKey: true })).type).toBe('ignore')
  })

  it('IME yig\'ayotgan paytdagi bosish `ignore`', () => {
    expect(mapKeydown(keydown('a', { isComposing: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('Enter', { isComposing: true })).type).toBe('ignore')
  })
})

describe('mapKeydown — boshqaruv tugmalari', () => {
  it('`Backspace` -> backspace hodisasi', () => {
    expect(mapKeydown(keydown('Backspace'))).toEqual({
      type: 'event',
      event: { type: 'backspace' },
    })
  })

  it('modifikatorli `Backspace` ilovaga tegishli emas', () => {
    expect(mapKeydown(keydown('Backspace', { ctrlKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('Backspace', { altKey: true })).type).toBe('ignore')
  })

  it('`Enter` -> next, `Escape` -> skip, `Tab` -> restart', () => {
    expect(mapKeydown(keydown('Enter'))).toEqual({ type: 'next' })
    expect(mapKeydown(keydown('Escape'))).toEqual({ type: 'skip' })
    expect(mapKeydown(keydown('Tab'))).toEqual({ type: 'restart' })
  })

  it('modifikatorli `Tab` / `Enter` brauzerga qoldiriladi', () => {
    // `Ctrl+Tab` — brauzer varag'ini almashtiradi; ilova gapni qayta boshlamasligi kerak.
    expect(mapKeydown(keydown('Tab', { ctrlKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('Enter', { metaKey: true })).type).toBe('ignore')
  })

  it("`Shift+Tab` `ignore` — fokus ko'chishi uchun bo'sh qoldiriladi", () => {
    expect(mapKeydown(keydown('Tab', { shiftKey: true }))).toEqual({ type: 'ignore' })
  })

  it('yolg\'iz `Tab` baribir restart — Shift qoidasi uni buzmaydi', () => {
    expect(mapKeydown(keydown('Tab'))).toEqual({ type: 'restart' })
    expect(mapKeydown(keydown('Tab', { shiftKey: false }))).toEqual({ type: 'restart' })
  })

  it('`Shift` boshqa tugmalarga TEGMAYDI: `Shift+t` — oddiy harf', () => {
    expect(mapKeydown(keydown('T', { shiftKey: true }))).toEqual({
      type: 'event',
      event: { type: 'char', char: 'T' },
    })
    expect(mapKeydown(keydown('Enter', { shiftKey: true }))).toEqual({ type: 'next' })
    expect(mapKeydown(keydown('Escape', { shiftKey: true }))).toEqual({ type: 'skip' })
  })
})

describe("mapKeydown — Ctrl+Space (so'zni qayta eshitish)", () => {
  it('`Ctrl+Space` -> replay', () => {
    expect(mapKeydown(keydown(' ', { ctrlKey: true }))).toEqual({ type: 'replay' })
  })

  it('modifikatorsiz probel oddiy belgi bo\'lib qoladi', () => {
    expect(mapKeydown(keydown(' '))).toEqual({
      type: 'event',
      event: { type: 'char', char: ' ' },
    })
  })

  it('`Shift+Ctrl+Space` ham replay — `Shift` hech qachon hisobga olinmaydi', () => {
    expect(mapKeydown(keydown(' ', { ctrlKey: true, shiftKey: true }))).toEqual({
      type: 'replay',
    })
  })

  it("boshqa modifikator qo'shilsa ilovaniki EMAS", () => {
    // `Ctrl+Alt+Space` / `Ctrl+Meta+Space` — tizim yorliqlari bo'lishi mumkin.
    expect(mapKeydown(keydown(' ', { ctrlKey: true, altKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown(' ', { ctrlKey: true, metaKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown(' ', { metaKey: true })).type).toBe('ignore')
  })

  it('IME yig\'ayotganda replay ham ishlamaydi', () => {
    expect(mapKeydown(keydown(' ', { ctrlKey: true, isComposing: true })).type).toBe('ignore')
  })

  it("`Ctrl` bilan bosilgan BOSHQA tugmalar hamon `ignore`", () => {
    // Yangi istisno faqat probelga tegishli, butun `Ctrl` qatoriga emas.
    expect(mapKeydown(keydown('a', { ctrlKey: true })).type).toBe('ignore')
    expect(mapKeydown(keydown('Enter', { ctrlKey: true })).type).toBe('ignore')
  })

  it("`Ctrl+Space` uchun `shouldPreventDefault` — true", () => {
    // Yorliq endi ilovaniki, ya'ni probelning sahifani surishiga yo'l qo'yilmaydi.
    expect(shouldPreventDefault(keydown(' ', { ctrlKey: true }))).toBe(true)
    expect(shouldPreventDefault(keydown(' ', { ctrlKey: true, isComposing: true }))).toBe(false)
  })
})

describe('mapKeydown — qolgan HAMMASI ignore', () => {
  it('navigatsiya, funksional va modifikator tugmalari e\'tiborsiz', () => {
    const keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Delete',
      'Insert',
      'F5',
      'F12',
      'Shift',
      'Control',
      'Alt',
      'Meta',
      'CapsLock',
      'ContextMenu',
      'Dead',
      'Unidentified',
    ]
    for (const key of keys) {
      expect(mapKeydown(keydown(key)).type).toBe('ignore')
    }
  })
})

describe('shouldPreventDefault', () => {
  it('`Space`, `Tab`, `Backspace`, `Enter`, `Escape` uchun true', () => {
    for (const key of [' ', 'Tab', 'Backspace', 'Enter', 'Escape']) {
      expect(shouldPreventDefault(keydown(key))).toBe(true)
    }
  })

  it('oddiy harflar va e\'tiborsiz tugmalar uchun false', () => {
    for (const key of ['a', 'T', '.', 'ArrowLeft', 'F5', 'Shift']) {
      expect(shouldPreventDefault(keydown(key))).toBe(false)
    }
  })

  it('modifikator bosilgan bo\'lsa false — brauzer yorliqlari ishlashi kerak', () => {
    expect(shouldPreventDefault(keydown('Tab', { ctrlKey: true }))).toBe(false)
    expect(shouldPreventDefault(keydown('Backspace', { metaKey: true }))).toBe(false)
    expect(shouldPreventDefault(keydown('Enter', { altKey: true }))).toBe(false)
    // `Ctrl+Space` bu qoidadan CHIQARILGAN — pastdagi bo'limga qarang.
    expect(shouldPreventDefault(keydown(' ', { metaKey: true }))).toBe(false)
  })

  it('IME yig\'ayotganda brauzerga xalaqit berilmaydi', () => {
    expect(shouldPreventDefault(keydown('Enter', { isComposing: true }))).toBe(false)
  })

  it("`Shift+Tab` to'xtatilmaydi, yolg'iz `Tab` esa to'xtatiladi", () => {
    // Tinglovchi `window` da: `Shift+Tab` ham yutilsa sahifada birorta havola
    // yoki tugmaga klaviatura bilan yetib bo'lmasdi.
    expect(shouldPreventDefault(keydown('Tab', { shiftKey: true }))).toBe(false)
    expect(shouldPreventDefault(keydown('Tab'))).toBe(true)
  })

  it("`Shift` boshqa to'xtatiladigan tugmalarni ozod qilmaydi", () => {
    expect(shouldPreventDefault(keydown(' ', { shiftKey: true }))).toBe(true)
    expect(shouldPreventDefault(keydown('Enter', { shiftKey: true }))).toBe(true)
  })
})
