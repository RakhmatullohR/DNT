// `src/store/notesSchema.ts` — sof yordamchilar va qator tekshiruvchilari.
//
// Bu testlar IndexedDB'ga UMUMAN tegmaydi (`statsSchema.test.ts` bilan bir xil):
// fayl faqat "diskda nima yotadi"ni tasvirlaydi. `tests/store/` da turishining
// sababi mavzu — o'z domeni bilan yonma-yon.

import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_INPUT_IMAGE_BYTES,
  MAX_NOTE_CHARS,
  SENTENCE_HEAD_CHARS,
  checkImage,
  clampNoteText,
  isAcceptedImageType,
  sentenceHead,
  toNoteImageRow,
  toNoteRow,
} from '../../src/store/notesSchema.ts'

describe('clampNoteText', () => {
  it('chegaragacha bo\'lgan matnga tegmaydi', () => {
    expect(clampNoteText('salom')).toBe('salom')
  })

  it('aynan chegarada qirqmaydi', () => {
    const text = 'a'.repeat(MAX_NOTE_CHARS)
    expect(clampNoteText(text)).toHaveLength(MAX_NOTE_CHARS)
  })

  it('chegaradan uzunini qirqadi', () => {
    const text = 'a'.repeat(MAX_NOTE_CHARS + 500)
    expect(clampNoteText(text)).toHaveLength(MAX_NOTE_CHARS)
  })
})

describe('sentenceHead', () => {
  it('qisqa gapni to\'liq qaytaradi', () => {
    expect(sentenceHead('The cat sat.')).toBe('The cat sat.')
  })

  it('uzun gapni kesadi', () => {
    expect(sentenceHead('x'.repeat(200))).toHaveLength(SENTENCE_HEAD_CHARS)
  })
})

describe('checkImage', () => {
  it('ruxsat etilgan har bir turni qabul qiladi', () => {
    for (const type of ACCEPTED_IMAGE_TYPES) {
      expect(checkImage({ type, size: 1024 })).toBe('ok')
    }
  })

  it('SVG va hujjat turlarini rad etadi', () => {
    expect(checkImage({ type: 'image/svg+xml', size: 1024 })).toBe('type')
    expect(checkImage({ type: 'application/pdf', size: 1024 })).toBe('type')
  })

  it('turi yo\'q faylni rad etadi', () => {
    expect(checkImage({ type: '', size: 1024 })).toBe('type')
  })

  it('bo\'sh faylni rad etadi', () => {
    expect(checkImage({ type: 'image/png', size: 0 })).toBe('empty')
  })

  it('aynan chegarada qabul qiladi, bittada ko\'pini rad etadi', () => {
    expect(checkImage({ type: 'image/png', size: MAX_INPUT_IMAGE_BYTES })).toBe('ok')
    expect(checkImage({ type: 'image/png', size: MAX_INPUT_IMAGE_BYTES + 1 })).toBe('size')
  })
})

describe('isAcceptedImageType', () => {
  it('noma\'lum turni rad etadi', () => {
    expect(isAcceptedImageType('image/bmp')).toBe(false)
    expect(isAcceptedImageType('image/png')).toBe(true)
  })
})

describe('toNoteRow', () => {
  const valid = { lessonId: 'l-1', sentenceIndex: 2, text: 'izoh', updatedAt: 100 }

  it('yaroqli qatorni o\'qiydi', () => {
    expect(toNoteRow(valid)).toEqual(valid)
  })

  it('obyekt bo\'lmagan qiymatni rad etadi', () => {
    expect(toNoteRow(null)).toBeNull()
    expect(toNoteRow([valid])).toBeNull()
    expect(toNoteRow('izoh')).toBeNull()
  })

  it('bo\'sh yoki noto\'g\'ri `lessonId` ni rad etadi', () => {
    expect(toNoteRow({ ...valid, lessonId: '' })).toBeNull()
    expect(toNoteRow({ ...valid, lessonId: 7 })).toBeNull()
  })

  it('manfiy, kasr va sonsiz indeksni rad etadi', () => {
    expect(toNoteRow({ ...valid, sentenceIndex: -1 })).toBeNull()
    expect(toNoteRow({ ...valid, sentenceIndex: 1.5 })).toBeNull()
    expect(toNoteRow({ ...valid, sentenceIndex: '2' })).toBeNull()
  })

  it('matni yo\'q qatorni bo\'sh matn bilan tiklaydi', () => {
    expect(toNoteRow({ lessonId: 'l-1', sentenceIndex: 0 })?.text).toBe('')
  })

  it('uzun matnni qirqadi', () => {
    const row = toNoteRow({ ...valid, text: 'a'.repeat(MAX_NOTE_CHARS + 10) })
    expect(row?.text).toHaveLength(MAX_NOTE_CHARS)
  })

  it('gap boshini saqlaydi va kesadi', () => {
    expect(toNoteRow({ ...valid, s: 'The cat' })?.s).toBe('The cat')
    expect(toNoteRow({ ...valid, s: 'x'.repeat(200) })?.s).toHaveLength(SENTENCE_HEAD_CHARS)
    expect(toNoteRow({ ...valid, s: '' })?.s).toBeUndefined()
  })
})

describe('toNoteImageRow', () => {
  const blob = new Blob(['rasm baytlari'], { type: 'image/png' })
  const valid = {
    lessonId: 'l-1',
    sentenceIndex: 0,
    slot: 1,
    blob,
    type: 'image/png',
    size: blob.size,
    name: 'skrinshot.png',
    addedAt: 50,
  }

  it('yaroqli qatorni o\'qiydi', () => {
    expect(toNoteImageRow(valid)).toEqual(valid)
  })

  it('`blob` Blob bo\'lmasa rad etadi', () => {
    expect(toNoteImageRow({ ...valid, blob: 'base64...' })).toBeNull()
    expect(toNoteImageRow({ ...valid, blob: undefined })).toBeNull()
  })

  it('yaroqsiz `slot` ni rad etadi', () => {
    expect(toNoteImageRow({ ...valid, slot: -1 })).toBeNull()
    expect(toNoteImageRow({ ...valid, slot: 0.5 })).toBeNull()
  })

  it('buzuq `type`/`size` ni blobning O\'ZIDAN tiklaydi', () => {
    const row = toNoteImageRow({ ...valid, type: 42, size: 'katta' })
    expect(row?.type).toBe('image/png')
    expect(row?.size).toBe(blob.size)
  })
})
