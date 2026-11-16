// `src/store/notes.ts` — izoh matni va rasmlar ustidagi amallar.
//
// `store` loyihasi: `fake-indexeddb/auto` FAQAT shu yerda ulanadi
// (`vitest.config.ts`). Har testdan keyin baza butunlay o'chiriladi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteNotesDb } from '../../src/store/notesDb.ts'
import {
  MAX_IMAGES_PER_NOTE,
  MAX_NOTE_CHARS,
  STORE_NOTES,
  STORE_NOTE_IMAGES,
} from '../../src/store/notesSchema.ts'
import {
  addNoteImage,
  deleteLessonNotes,
  deleteNote,
  deleteNoteImage,
  getNote,
  importLessonNotes,
  listNotes,
  noteSentenceIndexes,
  pruneOrphanNotes,
  writeNoteText,
} from '../../src/store/notes.ts'

function png(bytes: string): Blob {
  return new Blob([bytes], { type: 'image/png' })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteNotesDb()
})

describe('getNote / writeNoteText', () => {
  it('bo\'sh omborda `null`', async () => {
    expect(await getNote('l-1', 0)).toBeNull()
  })

  it('matnni yozadi va qaytadan o\'qiydi', async () => {
    expect(await writeNoteText('l-1', 2, 'phrasal verb', 'The cat sat.')).toBe('saved')

    const note = await getNote('l-1', 2)
    expect(note?.text).toBe('phrasal verb')
    expect(note?.sentenceHead).toBe('The cat sat.')
    expect(note?.updatedAt).toBeGreaterThan(0)
    expect(note?.images).toEqual([])
  })

  it('boshqa gapga tegmaydi', async () => {
    await writeNoteText('l-1', 0, 'birinchi')
    await writeNoteText('l-1', 1, 'ikkinchi')

    expect((await getNote('l-1', 0))?.text).toBe('birinchi')
    expect((await getNote('l-1', 1))?.text).toBe('ikkinchi')
  })

  it('uzun matnni chegaraga keltiradi', async () => {
    await writeNoteText('l-1', 0, 'a'.repeat(MAX_NOTE_CHARS + 100))
    expect((await getNote('l-1', 0))?.text).toHaveLength(MAX_NOTE_CHARS)
  })

  it('bo\'sh matn qatorni o\'chiradi, LEKIN rasmlar qoladi', async () => {
    await writeNoteText('l-1', 0, 'vaqtinchalik')
    await addNoteImage('l-1', 0, png('bir'), 'bir.png')

    expect(await writeNoteText('l-1', 0, '')).toBe('saved')

    const note = await getNote('l-1', 0)
    expect(note?.text).toBe('')
    expect(note?.images).toHaveLength(1)
  })
})

describe('rasmlar', () => {
  it('blobni bayt-baytiga qaytaradi', async () => {
    expect(await addNoteImage('l-1', 0, png('rasm baytlari'), 'skrinshot.png')).toBe('saved')

    const note = await getNote('l-1', 0)
    expect(note?.images).toHaveLength(1)
    const image = note?.images[0]
    expect(image?.name).toBe('skrinshot.png')
    expect(image?.type).toBe('image/png')
    expect(await image?.blob.text()).toBe('rasm baytlari')
  })

  it('slotlarni tartib bilan beradi va chegaradan oshirmaydi', async () => {
    for (let i = 0; i < MAX_IMAGES_PER_NOTE; i += 1) {
      expect(await addNoteImage('l-1', 0, png(`rasm-${i}`), `${i}.png`)).toBe('saved')
    }
    expect(await addNoteImage('l-1', 0, png('ortiqcha'), 'ortiqcha.png')).toBe('limit')

    const note = await getNote('l-1', 0)
    expect(note?.images.map((image) => image.slot)).toEqual([0, 1, 2])
  })

  it('o\'chirilgan slotni qayta ishlatadi', async () => {
    await addNoteImage('l-1', 0, png('a'), 'a.png')
    await addNoteImage('l-1', 0, png('b'), 'b.png')
    await deleteNoteImage('l-1', 0, 0)

    expect(await addNoteImage('l-1', 0, png('c'), 'c.png')).toBe('saved')

    const note = await getNote('l-1', 0)
    expect(note?.images.map((image) => image.name)).toEqual(['c.png', 'b.png'])
  })

  it('rasm o\'chirilganda matn qoladi', async () => {
    await writeNoteText('l-1', 0, 'izoh')
    await addNoteImage('l-1', 0, png('a'), 'a.png')

    expect(await deleteNoteImage('l-1', 0, 0)).toBe('saved')

    const note = await getNote('l-1', 0)
    expect(note?.text).toBe('izoh')
    expect(note?.images).toEqual([])
  })

  it('yaroqsiz turni va bo\'sh blobni rad etadi', async () => {
    expect(await addNoteImage('l-1', 0, new Blob(['x'], { type: 'image/svg+xml' }), 'x.svg')).toBe(
      'invalid',
    )
    expect(await addNoteImage('l-1', 0, new Blob([], { type: 'image/png' }), 'bo.png')).toBe(
      'invalid',
    )
    expect(await getNote('l-1', 0)).toBeNull()
  })

  it('kvota to\'lganda yozmaydi', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: () => Promise.resolve({ usage: 990, quota: 1000 }),
      },
    })

    expect(await addNoteImage('l-1', 0, png('rasm'), 'a.png')).toBe('quota')
  })
})

describe('deleteNote / deleteLessonNotes', () => {
  it('bitta gapning matnini ham, rasmini ham o\'chiradi', async () => {
    await writeNoteText('l-1', 0, 'izoh')
    await addNoteImage('l-1', 0, png('a'), 'a.png')

    expect(await deleteNote('l-1', 0)).toBe('saved')
    expect(await getNote('l-1', 0)).toBeNull()
  })

  it('faqat o\'z darsini tozalaydi (matnsiz, rasmli gap bilan birga)', async () => {
    await writeNoteText('l-1', 0, 'birinchi')
    await addNoteImage('l-1', 5, png('faqat rasm'), 'r.png')
    await writeNoteText('l-2', 0, 'boshqa dars')

    expect(await deleteLessonNotes('l-1')).toBe(2)

    expect(await listNotes('l-1')).toEqual([])
    expect((await listNotes('l-2'))[0]?.text).toBe('boshqa dars')
  })
})

describe('listNotes / noteSentenceIndexes', () => {
  beforeEach(async () => {
    await writeNoteText('l-1', 3, 'uchinchi')
    await writeNoteText('l-1', 1, 'birinchi')
    await addNoteImage('l-1', 7, png('faqat rasm'), 'r.png')
  })

  it('gap tartibida qaytaradi va matnsiz gapni ham qo\'shadi', async () => {
    const notes = await listNotes('l-1')
    expect(notes.map((note) => note.sentenceIndex)).toEqual([1, 3, 7])
    expect(notes[2]?.text).toBe('')
    expect(notes[2]?.images).toHaveLength(1)
  })

  it('so\'ralgan gaplar bilan cheklaydi', async () => {
    const notes = await listNotes('l-1', [3, 7, 99])
    expect(notes.map((note) => note.sentenceIndex)).toEqual([3, 7])
  })

  it('izohli gaplar indekslarini beradi', async () => {
    expect(await noteSentenceIndexes('l-1')).toEqual([1, 3, 7])
  })
})

describe('pruneOrphanNotes', () => {
  it('darsi yo\'q qatorlarni supuradi', async () => {
    await writeNoteText('bor', 0, 'qoladi')
    await writeNoteText('yoq', 0, 'ketadi')
    await addNoteImage('yoq', 1, png('a'), 'a.png')

    expect(await pruneOrphanNotes(['bor'])).toBe(2)

    expect((await listNotes('bor'))[0]?.text).toBe('qoladi')
    expect(await listNotes('yoq')).toEqual([])
  })

  it("⭐ BO'SH ro'yxat hech narsani o'chirmaydi", async () => {
    // `listLessons()` darslar omborini o'qib bo'lmaganda ham bo'sh qaytaradi —
    // o'shanda supurgi hamma izohni yo'q qilib yuborardi.
    await writeNoteText('l-1', 0, 'omon qolishi shart')

    expect(await pruneOrphanNotes([])).toBe(0)

    expect((await getNote('l-1', 0))?.text).toBe('omon qolishi shart')
  })
})

describe('importLessonNotes', () => {
  it('izoh va rasmni tiklaydi', async () => {
    const written = await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 2,
        text: 'zaxiradan',
        updatedAt: 500,
        sentenceHead: 'The cat',
        images: [{ blob: png('tiklangan'), name: 'z.png' }],
      },
    ])
    expect(written).toEqual({ written: 1, failed: null })

    const note = await getNote('l-1', 2)
    expect(note?.text).toBe('zaxiradan')
    expect(note?.sentenceHead).toBe('The cat')
    expect(await note?.images[0]?.blob.text()).toBe('tiklangan')
  })

  it('yangiroq mavjud izohni ORQAGA sudramaydi', async () => {
    await writeNoteText('l-1', 0, 'hozirgi')
    const current = await getNote('l-1', 0)

    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'eski zaxira',
        updatedAt: (current?.updatedAt ?? 0) - 1000,
        images: [],
      },
    ])

    expect((await getNote('l-1', 0))?.text).toBe('hozirgi')
  })

  it('kelgan rasm to\'plami butunlay almashtiriladi va chegarada ushlanadi', async () => {
    await addNoteImage('l-1', 0, png('eski'), 'eski.png')

    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'yangi',
        updatedAt: Date.now() + 1000,
        images: Array.from({ length: MAX_IMAGES_PER_NOTE + 2 }, (_, i) => ({
          blob: png(`yangi-${i}`),
          name: `${i}.png`,
        })),
      },
    ])

    const note = await getNote('l-1', 0)
    expect(note?.images).toHaveLength(MAX_IMAGES_PER_NOTE)
    expect(await note?.images[0]?.blob.text()).toBe('yangi-0')
  })
})

describe('IndexedDB yo\'q muhitda', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined)
  })

  it('o\'qish `null`/bo\'sh, yozuv `no-idb` — hech biri tashlamaydi', async () => {
    expect(await getNote('l-1', 0)).toBeNull()
    expect(await listNotes('l-1')).toEqual([])
    expect(await noteSentenceIndexes('l-1')).toEqual([])
    expect(await writeNoteText('l-1', 0, 'izoh')).toBe('no-idb')
    expect(await addNoteImage('l-1', 0, png('a'), 'a.png')).toBe('no-idb')
    expect(await deleteNoteImage('l-1', 0, 0)).toBe('no-idb')
    expect(await deleteNote('l-1', 0)).toBe('no-idb')
    expect(await deleteLessonNotes('l-1')).toBe(0)
    expect(await pruneOrphanNotes([])).toBe(0)
  })
})

describe('sxema', () => {
  it('ikkita do\'kon va `by_lesson` indekslari yaratiladi', async () => {
    const { openNotesDb } = await import('../../src/store/notesDb.ts')
    const db = await openNotesDb()
    expect(db).not.toBeNull()
    expect([...(db?.objectStoreNames ?? [])].sort()).toEqual([STORE_NOTE_IMAGES, STORE_NOTES])

    const tx = db?.transaction([STORE_NOTES, STORE_NOTE_IMAGES], 'readonly')
    expect(tx?.objectStore(STORE_NOTES).keyPath).toEqual(['lessonId', 'sentenceIndex'])
    expect(tx?.objectStore(STORE_NOTE_IMAGES).keyPath).toEqual([
      'lessonId',
      'sentenceIndex',
      'slot',
    ])
    expect([...(tx?.objectStore(STORE_NOTES).indexNames ?? [])]).toEqual(['by_lesson'])
  })
})

describe('⭐ yangilanish vaqti — rasm ham hisobga olinadi', () => {
  // `Date` ni FAQAT o'zini soxtalashtiramiz: `setTimeout`/mikrovazifalar haqiqiy
  // qoladi, aks holda `fake-indexeddb` ning hodisalari umuman yetib kelmasdi.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rasm qo\'shilishi izohning `updatedAt` ini oshiradi', async () => {
    vi.setSystemTime(1000)
    await writeNoteText('l-1', 0, 'matn')
    vi.setSystemTime(2000)
    await addNoteImage('l-1', 0, png('rasm'), 'a.png')

    // Xom `NoteRow.updatedAt` 1000 bo'lib qoladi (rasm matn qatorini ochmaydi),
    // lekin ko'rinadigan qiymat rasm vaqtini ham qamrashi kerak.
    expect((await getNote('l-1', 0))?.updatedAt).toBe(2000)
    expect((await listNotes('l-1'))[0]?.updatedAt).toBe(2000)
  })

  it('ZAXIRADAN KEYIN qo\'shilgan rasm tiklashda yo\'qolmaydi', async () => {
    vi.setSystemTime(1000)
    await writeNoteText('l-1', 0, 'matn')
    vi.setSystemTime(2000)
    await addNoteImage('l-1', 0, png('A'), 'a.png')

    // "Zaxira olindi" — fayldagi yozuv aynan shu holatni saqlaydi.
    const backup = (await listNotes('l-1'))[0]
    expect(backup?.updatedAt).toBe(2000)

    // Zaxiradan KEYIN yana bitta rasm qo'shildi.
    vi.setSystemTime(3000)
    await addNoteImage('l-1', 0, png('B'), 'b.png')

    // O'sha zaxira qaytadan tiklandi (odatiy "nusxamni tiklayman" harakati).
    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'matn',
        updatedAt: backup?.updatedAt ?? 0,
        images: [{ blob: png('A'), name: 'a.png' }],
      },
    ])

    const note = await getNote('l-1', 0)
    expect(note?.images).toHaveLength(2)
    expect(await note?.images[1]?.blob.text()).toBe('B')
  })
})

describe('⭐ import rasmsiz kelganda ombordagi rasmga tegmaydi', () => {
  it('fayldagi rasm tushib qolgan bo\'lsa ham sog\'lom rasm qoladi', async () => {
    await writeNoteText('l-1', 0, 'eski matn')
    await addNoteImage('l-1', 0, png('sog\'lom'), 'ok.png')

    // `lessonBackup.toNoteImports` buzuq base64/yaroqsiz turdagi rasmni tashlab
    // yuboradi va yozuv `images: []` bo'lib keladi — o'shanda ham o'chirilmasin.
    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'yangi matn',
        updatedAt: Date.now() + 10_000,
        images: [],
      },
    ])

    const note = await getNote('l-1', 0)
    expect(note?.text).toBe('yangi matn')
    expect(note?.images).toHaveLength(1)
    expect(await note?.images[0]?.blob.text()).toBe("sog'lom")
  })
})

describe('⭐ import nosozligi muvaffaqiyat bo\'lib ko\'rinmaydi', () => {
  it('IDB yo\'q bo\'lsa `failed` bilan qaytadi', async () => {
    vi.stubGlobal('indexedDB', undefined)

    expect(
      await importLessonNotes([
        { lessonId: 'l-1', sentenceIndex: 0, text: 'izoh', updatedAt: 1, images: [] },
      ]),
    ).toEqual({ written: 0, failed: 'no-idb' })
  })

  it('yozadigan narsa bo\'lmasa `failed` YO\'Q', async () => {
    expect(await importLessonNotes([])).toEqual({ written: 0, failed: null })
  })
})

describe('⭐ QISMAN kelgan rasm ro\'yxati ombordagini yo\'q qilmaydi', () => {
  it('to\'liq emas deb belgilangan ro\'yxat ustiga yozmaydi', async () => {
    await writeNoteText('l-1', 0, 'matn')
    await addNoteImage('l-1', 0, png('A'), 'a.png')
    await addNoteImage('l-1', 0, png('B'), 'b.png')

    // Faylda ikkitadan faqat bittasi omon qolgan (buzuq base64 / o'qilmagan blob).
    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'matn',
        updatedAt: Date.now() + 10_000,
        images: [{ blob: png('B'), name: 'b.png' }],
        imagesComplete: false,
      },
    ])

    const note = await getNote('l-1', 0)
    expect(note?.images.map((image) => image.name)).toEqual(['a.png', 'b.png'])
  })

  it('YANGI gapda esa qisman ro\'yxat ham tiklanadi — yo\'qotadigan narsa yo\'q', async () => {
    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'matn',
        updatedAt: 5,
        images: [{ blob: png('B'), name: 'b.png' }],
        imagesComplete: false,
      },
    ])

    expect((await getNote('l-1', 0))?.images.map((image) => image.name)).toEqual(['b.png'])
  })

  it("TO'LIQ ro'yxat avvalgidek butunlay almashtiradi", async () => {
    await addNoteImage('l-1', 0, png('eski'), 'eski.png')

    await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: 'matn',
        updatedAt: Date.now() + 10_000,
        images: [{ blob: png('yangi'), name: 'yangi.png' }],
        imagesComplete: true,
      },
    ])

    expect((await getNote('l-1', 0))?.images.map((image) => image.name)).toEqual(['yangi.png'])
  })
})

describe('⭐ `written` faqat HAQIQATAN o\'zgargan qatorni sanaydi', () => {
  it('matnsiz va rasmsiz yozuv sanalmaydi', async () => {
    await addNoteImage('l-1', 0, png('sog\'lom'), 'ok.png')

    // Faqat rasmli izohning hamma rasmi faylda tushib qolgan: yoziladigan
    // hech narsa qolmadi — bu "1 ta izoh tiklandi" degani EMAS.
    const result = await importLessonNotes([
      {
        lessonId: 'l-1',
        sentenceIndex: 0,
        text: '',
        updatedAt: Date.now() + 10_000,
        images: [],
        imagesComplete: false,
      },
    ])

    expect(result).toEqual({ written: 0, failed: null })
    // Ombordagi rasm ham joyida qolishi kerak.
    expect((await getNote('l-1', 0))?.images).toHaveLength(1)
  })
})
