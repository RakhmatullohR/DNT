// `src/core/base64.ts` — dars zaxirasidagi rasm baytlari uchun.

import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64 } from '../../src/core/base64.ts'

describe('bytesToBase64 / base64ToBytes', () => {
  it("bo'sh massiv aylanma yo'lni o'tadi", () => {
    const text = bytesToBase64(new Uint8Array())
    expect(text).toBe('')
    expect(base64ToBytes(text)).toEqual(new Uint8Array())
  })

  it('har bir bayt qiymati saqlanadi (0..255)', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) bytes[i] = i

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it("BO'LAKLASH chegarasidan uzun ma'lumot ham to'g'ri o'giriladi", () => {
    // 0x8000 dan uzun: bitta `fromCharCode` chaqiruvi stekni to'ldirardi.
    const bytes = new Uint8Array(0x8000 * 2 + 17)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it("buzuq satr `null` qaytaradi, TASHLAMAYDI", () => {
    expect(base64ToBytes('bu base64 emas !!!')).toBeNull()
  })
})
