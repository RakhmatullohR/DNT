// `src/store/lessonBackup.ts` — dars + izoh + rasm bitta `.json` faylida.
//
// ⭐ Bu faylning eng muhim testi — EKSPORT → IMPORT aylanmasi: talab aynan shu
// faylni Drive/Telegram'ga tashlab qo'yib, keyin tiklash edi.
//
// `store` loyihasi: `fake-indexeddb/auto` shu yerda ulanadi. `lessons.ts` esa
// `localStorage` da, shuning uchun u ham xotirada taqlid qilinadi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  describeLessonBackupImport,
  exportAllLessonsBackup,
  exportLessonBackup,
  importLessonBackup,
} from '../../src/store/lessonBackup.ts'
import { getLesson, listLessons, saveLesson } from '../../src/store/lessons.ts'
import type { Lesson } from '../../src/store/lessons.ts'
import { addNoteImage, getNote, writeNoteText } from '../../src/store/notes.ts'
import { deleteNotesDb } from '../../src/store/notesDb.ts'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length(): number {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

function makeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l-1',
    title: 'Sinov darsi',
    createdAt: 1_700_000_000_000,
    originalText: 'The cat sat. The dog ran.',
    normalizedText: 'The cat sat. The dog ran.',
    sentences: ['The cat sat.', 'The dog ran.'],
    progress: 1,
    skipped: [],
    voice: 'en-US-AriaNeural',
    rate: 0,
    ...over,
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteNotesDb()
})

describe('eksport → import aylanmasi', () => {
  it('izoh ham, rasm ham bayt-baytiga qaytadi', async () => {
    saveLesson(makeLesson())
    await writeNoteText('l-1', 1, 'phrasal verb', 'The dog ran.')
    await addNoteImage('l-1', 1, new Blob(['rasm baytlari'], { type: 'image/png' }), 'a.png')

    const file = await exportLessonBackup('l-1')
    expect(file).not.toBeNull()

    // Fayl haqiqatan izohni olib yuribdimi — matn muharririda ochilganda ham
    // ko'rinadigan narsa.
    const parsed = JSON.parse(file ?? '') as { version: number; notes?: unknown[] }
    expect(parsed.version).toBe(2)
    expect(parsed.notes).toHaveLength(1)

    // "Boshqa brauzer": ikkala ombor ham bo'sh.
    localStorage.clear()
    await deleteNotesDb()

    const result = await importLessonBackup(file ?? '')
    expect(result).toEqual({ ok: true, added: 1, updated: 0, notes: 1, notesFailed: null })

    expect(getLesson('l-1')?.title).toBe('Sinov darsi')
    const note = await getNote('l-1', 1)
    expect(note?.text).toBe('phrasal verb')
    expect(note?.sentenceHead).toBe('The dog ran.')
    expect(await note?.images[0]?.blob.text()).toBe('rasm baytlari')
    expect(note?.images[0]?.type).toBe('image/png')
  })

  it("hamma darslar zaxirasi ham izohlarni olib yuradi", async () => {
    saveLesson(makeLesson({ id: 'a' }))
    saveLesson(makeLesson({ id: 'b' }))
    await writeNoteText('a', 0, 'a dagi izoh')
    await writeNoteText('b', 0, 'b dagi izoh')

    const parsed = JSON.parse(await exportAllLessonsBackup()) as { notes?: unknown[] }

    expect(parsed.notes).toHaveLength(2)
  })

  it("izohi yo'q darsda `notes` maydoni umuman yozilmaydi", async () => {
    saveLesson(makeLesson())

    const parsed = JSON.parse((await exportLessonBackup('l-1')) ?? '') as Record<string, unknown>

    expect('notes' in parsed).toBe(false)
  })

  it("dars topilmasa `null` — bo'sh fayl berilmaydi", async () => {
    expect(await exportLessonBackup('yoq')).toBeNull()
  })

  it("matni ham, rasmi ham yo'q yozuv faylga tushmaydi", async () => {
    saveLesson(makeLesson())
    await writeNoteText('l-1', 0, 'vaqtinchalik')
    await writeNoteText('l-1', 0, '')

    const parsed = JSON.parse((await exportLessonBackup('l-1')) ?? '') as Record<string, unknown>

    expect('notes' in parsed).toBe(false)
  })
})

describe('import — chidamlilik', () => {
  it("ESKI (v1, izohsiz) fayl o'qiladi", async () => {
    const result = await importLessonBackup(
      JSON.stringify({ version: 1, kind: 'lessons', lessons: [makeLesson()] }),
    )

    expect(result).toEqual({ ok: true, added: 1, updated: 0, notes: 0, notesFailed: null })
    expect(listLessons()).toHaveLength(1)
  })

  it('begona `lessonId` li izoh yetim qator yaratmaydi', async () => {
    const result = await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [makeLesson()],
        notes: [{ lessonId: 'begona', sentenceIndex: 0, text: 'yetim', updatedAt: 1 }],
      }),
    )

    expect(result).toEqual({ ok: true, added: 1, updated: 0, notes: 0, notesFailed: null })
    expect(await getNote('begona', 0)).toBeNull()
  })

  it("buzuq base64 faqat O'SHA rasmni yo'qotadi, matn qoladi", async () => {
    await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [makeLesson()],
        notes: [
          {
            lessonId: 'l-1',
            sentenceIndex: 0,
            text: 'izoh joyida',
            updatedAt: 5,
            images: [{ name: 'a.png', type: 'image/png', data: 'bu base64 emas !!!' }],
          },
        ],
      }),
    )

    const note = await getNote('l-1', 0)
    expect(note?.text).toBe('izoh joyida')
    expect(note?.images).toEqual([])
  })

  it("ruxsat etilmagan turdagi rasm tiklanmaydi", async () => {
    await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [makeLesson()],
        notes: [
          {
            lessonId: 'l-1',
            sentenceIndex: 0,
            text: 'izoh',
            updatedAt: 5,
            images: [{ name: 'x.svg', type: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=' }],
          },
        ],
      }),
    )

    expect((await getNote('l-1', 0))?.images).toEqual([])
  })

  it("darslar o'qilmasa izohlarga umuman o'tilmaydi", async () => {
    const result = await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [],
        notes: [{ lessonId: 'l-1', sentenceIndex: 0, text: 'izoh', updatedAt: 1 }],
      }),
    )

    expect(result.ok).toBe(false)
    expect(await getNote('l-1', 0)).toBeNull()
  })

  it("JSON bo'lmagan fayl sababi bilan rad etiladi", async () => {
    const result = await importLessonBackup('bu JSON emas {{{')

    expect(result).toEqual({ ok: false, error: "Faylni JSON sifatida o'qib bo'lmadi." })
  })
})

describe('describeLessonBackupImport', () => {
  it("izohlar 0 bo'lsa tilga olinmaydi", () => {
    expect(describeLessonBackupImport(2, 0, 0)).toBe('2 ta dars qo\'shildi.')
  })

  it('izohlar sonini ham aytadi', () => {
    expect(describeLessonBackupImport(1, 2, 5)).toBe(
      "1 ta dars qo'shildi, 2 tasi yangilandi, 5 ta izoh tiklandi.",
    )
  })
})

describe('⭐ izohlar tiklanmagani MUVAFFAQIYAT bo\'lib ko\'rinmaydi', () => {
  it('xabar ogohlantirish bilan tugaydi', () => {
    const text = describeLessonBackupImport(1, 0, 0, 'no-idb')

    expect(text).toContain('1 ta dars qo\'shildi')
    expect(text).toContain('Izohlar tiklanmadi')
  })

  it("bloklangan tab uchun ANIQ maslahat beriladi", () => {
    expect(describeLessonBackupImport(1, 0, 0, 'blocked')).toContain("O'sha tabni yopib")
  })

  it("IDB yo'q bo'lsa import `notesFailed` ni ko'rsatadi", async () => {
    // Darslar `localStorage` da — ular tiklanadi; izohlar esa IDB da va yo'q.
    vi.stubGlobal('indexedDB', undefined)

    const result = await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [makeLesson()],
        notes: [{ lessonId: 'l-1', sentenceIndex: 0, text: 'izoh', updatedAt: 1 }],
      }),
    )

    expect(result).toEqual({
      ok: true,
      added: 1,
      updated: 0,
      notes: 0,
      notesFailed: 'no-idb',
    })
  })
})

describe('⭐ o\'qib bo\'lmagan rasm zaxirani JIMGINA lossy qilmaydi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('eksport yozuvni `imagesPartial` deb belgilaydi', async () => {
    saveLesson(makeLesson())
    await writeNoteText('l-1', 0, 'matn')
    await addNoteImage('l-1', 0, new Blob(['A'], { type: 'image/png' }), 'a.png')
    await addNoteImage('l-1', 0, new Blob(['B'], { type: 'image/png' }), 'b.png')

    // Birinchi blob o'qilmaydi — brauzer uni chiqarib tashlagan holat.
    const original = Blob.prototype.arrayBuffer
    let call = 0
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      call += 1
      if (call === 1) return Promise.reject(new Error("blob o'qilmadi"))
      return original.call(this)
    })

    const parsed = JSON.parse((await exportLessonBackup('l-1')) ?? '') as {
      notes: { images: unknown[]; imagesPartial?: boolean }[]
    }

    expect(parsed.notes[0]?.images).toHaveLength(1)
    expect(parsed.notes[0]?.imagesPartial).toBe(true)
  })

  it('shunday fayl qaytadan tiklanganda ombordagi rasmlar OMON qoladi', async () => {
    saveLesson(makeLesson())
    await writeNoteText('l-1', 0, 'matn')
    await addNoteImage('l-1', 0, new Blob(['A'], { type: 'image/png' }), 'a.png')
    await addNoteImage('l-1', 0, new Blob(['B'], { type: 'image/png' }), 'b.png')

    const original = Blob.prototype.arrayBuffer
    let call = 0
    const spy = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      call += 1
      if (call === 1) return Promise.reject(new Error("blob o'qilmadi"))
      return original.call(this)
    })

    const file = (await exportLessonBackup('l-1')) ?? ''
    spy.mockRestore()

    await importLessonBackup(file)

    const note = await getNote('l-1', 0)
    expect(note?.images.map((image) => image.name)).toEqual(['a.png', 'b.png'])
  })

  it('buzuq base64 li fayl ham ombordagi rasmni o\'chirmaydi', async () => {
    saveLesson(makeLesson())
    await addNoteImage('l-1', 0, new Blob(["sog'lom"], { type: 'image/png' }), 'ok.png')

    await importLessonBackup(
      JSON.stringify({
        version: 2,
        kind: 'lessons',
        lessons: [makeLesson()],
        notes: [
          {
            lessonId: 'l-1',
            sentenceIndex: 0,
            text: 'matn',
            updatedAt: Date.now() + 10_000,
            images: [
              { name: 'a.png', type: 'image/png', data: 'buzuq base64 !!!' },
              { name: 'b.png', type: 'image/png', data: 'Qg==' },
            ],
          },
        ],
      }),
    )

    const note = await getNote('l-1', 0)
    expect(note?.text).toBe('matn')
    expect(note?.images.map((image) => image.name)).toEqual(['ok.png'])
  })
})
