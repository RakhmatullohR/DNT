// Dars zaxirasi — darslar (localStorage) + izohlar va rasmlar (IndexedDB) BITTA
// `.json` faylida.
//
// ⭐ NEGA ALOHIDA MODUL: `lessons.ts` `core` proyektida, `indexedDB` global'isiz
// sinaladi va shunday qolishi kerak — u omborning eng ko'p sinalgan qismi.
// Shuning uchun u sof konvert quradi/o'qiydi (`NoteBackupRow`), izohlarni
// ombordan yig'ish va base64 ↔ `Blob` o'girish esa shu yerda.
//
// ⚠️ Rasm base64'da ≈ +33% joy egallaydi va butun fayl XOTIRADA satr bo'lib
// yig'iladi. Aynan shuning uchun rasm saqlashdan oldin siqiladi
// (`media/imageResize.ts`): siqishsiz 20 ta skrinshotli dars fayli o'nlab MB ga
// chiqib, Telegram/Drive'ga yuborish uchun noqulay bo'lardi.

import { base64ToBytes, bytesToBase64 } from '../core/base64.ts'
import {
  exportLessonJson,
  exportLessonsJson,
  importLessonsFile,
  listLessons,
  readFileNotes,
} from './lessons.ts'
import type { LessonsImportResult, NoteBackupRow } from './lessons.ts'
import { importLessonNotes, listNotes } from './notes.ts'
import type { NoteImport, NoteSaveResult } from './notes.ts'
import { isAcceptedImageType } from './notesSchema.ts'

export type LessonBackupImport =
  | {
      ok: true
      added: number
      updated: number
      notes: number
      /**
       * `null` — izohlar yozildi (yoki faylda izoh yo'q edi). Aks holda sabab:
       * darslar tiklandi, izohlar esa YO'Q. Bu holat foydalanuvchiga
       * AYTILISHI shart — u zaxirasi to'liq tiklandi deb o'ylab, faylni
       * o'chirib yuborishi mumkin.
       */
      notesFailed: NoteSaveResult | null
    }
  | { ok: false; error: string }

/**
 * Bitta darsning zaxirasi. Dars topilmasa `null` (`exportLessonJson` qoidasi).
 *
 * Izohlar O'QILMASA (IDB yo'q, bloklangan tab) fayl baribir yasaladi — darslarsiz
 * qolishdan ko'ra izohsiz zaxira olish yaxshiroq. `listNotes` allaqachon shunday
 * ishlaydi: nosozlikda bo'sh ro'yxat.
 */
export async function exportLessonBackup(id: string): Promise<string | null> {
  const notes = await collectNotes([id])
  return exportLessonJson(id, notes)
}

/** Barcha darslarning zaxirasi (Statistika ekranidagi to'liq nusxa). */
export async function exportAllLessonsBackup(): Promise<string> {
  const notes = await collectNotes(listLessons().map((lesson) => lesson.id))
  return exportLessonsJson(notes)
}

/** Ombordagi izohlarni faylga yoziladigan shaklga o'giradi. */
async function collectNotes(lessonIds: readonly string[]): Promise<NoteBackupRow[]> {
  const rows: NoteBackupRow[] = []

  for (const lessonId of lessonIds) {
    for (const note of await listNotes(lessonId)) {
      const images: { name: string; type: string; data: string }[] = []
      let partial = false

      for (const image of note.images) {
        // ⚠️ `arrayBuffer()` YIQILISHI mumkin: brauzer blobning ortidagi
        // faylni chiqarib tashlagan bo'lsa `NotFoundError` beradi. O'qib
        // bo'lmagan BITTA rasm butun zaxirani to'xtatmasligi kerak —
        // qolgan darslar va izohlar baribir faylga tushadi.
        //
        // ⭐ LEKIN bu jimgina bo'lmasligi kerak: yozuv "to'liq emas" deb
        // belgilanadi, aks holda shu faylni qaytadan tiklaganda import uni
        // ishonchli to'plam deb qabul qilib, ombordagi sog'lom rasmlarni
        // o'chirib yuborardi.
        try {
          const bytes = new Uint8Array(await image.blob.arrayBuffer())
          images.push({ name: image.name, type: image.type, data: bytesToBase64(bytes) })
        } catch {
          partial = true
        }
      }

      // Matni ham, rasmi ham yo'q yozuv faylga tushmaydi.
      if (note.text === '' && images.length === 0) continue

      rows.push({
        lessonId: note.lessonId,
        sentenceIndex: note.sentenceIndex,
        text: note.text,
        updatedAt: note.updatedAt,
        ...(note.sentenceHead === undefined ? {} : { s: note.sentenceHead }),
        ...(images.length === 0 ? {} : { images }),
        ...(partial ? { imagesPartial: true } : {}),
      })
    }
  }

  return rows
}

/**
 * Zaxirani tiklaydi: avval darslar (sinxron, `lessons.ts`), keyin izohlar.
 *
 * TARTIB MUHIM: izoh faqat FAYLDA bor darsga biriktiriladi (`readFileNotes`),
 * ya'ni darslar yozilmasdan turib izoh yozish yetim qator yaratardi. Darslar
 * import qilinmasa (xato) izohlarga umuman o'tilmaydi.
 *
 * Izohlar yozilmasligi butun tiklashni yiqitmaydi: darslar allaqachon joyida va
 * ularni yo'qotish izohni yo'qotishdan qimmatroq.
 */
export async function importLessonBackup(raw: string): Promise<LessonBackupImport> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Faylni JSON sifatida o\'qib bo\'lmadi.' }
  }

  const result: LessonsImportResult = importLessonsFile(parsed)
  if (!result.ok) return result

  const rows = readFileNotes(
    parsed,
    listLessons().map((lesson) => lesson.id),
  )
  const notes = await importLessonNotes(toNoteImports(rows))

  return {
    ok: true,
    added: result.added,
    updated: result.updated,
    notes: notes.written,
    notesFailed: notes.failed,
  }
}

/** Fayldagi base64 rasmlarni `Blob` ga qaytaradi; buzug'i tashlanadi. */
function toNoteImports(rows: readonly NoteBackupRow[]): NoteImport[] {
  return rows.map((row) => {
    const source = row.images ?? []
    const images: { blob: Blob; name: string }[] = []

    for (const image of source) {
      // Turi ruxsat etilmagan rasm tiklanmaydi: zaxira fayli qo'lda
      // tahrirlangan bo'lishi mumkin, ombor esa faqat ma'lum turlarni biladi.
      if (!isAcceptedImageType(image.type)) continue
      const bytes = base64ToBytes(image.data)
      if (bytes === null) continue
      images.push({ blob: new Blob([bytes], { type: image.type }), name: image.name })
    }

    return {
      lessonId: row.lessonId,
      sentenceIndex: row.sentenceIndex,
      text: row.text,
      updatedAt: row.updatedAt,
      ...(row.s === undefined ? {} : { sentenceHead: row.s }),
      images,
      // ⭐ Ro'yxat QISQARGAN bo'lsa (buzuq base64, ruxsat etilmagan tur) yoki
      // fayl o'zi to'liq emasligini aytgan bo'lsa — import uni ombordagi
      // rasmlar ustiga YOZMAYDI. Bo'sh ro'yxat ham, qisqargan ro'yxat ham bir
      // xil xavfli: ikkovi ham "shu gapning hamma rasmi" degan da'vo qila olmaydi.
      imagesComplete: row.imagesPartial !== true && images.length === source.length,
    }
  })
}

/**
 * Import natijasining sonlar bilan aytilishi — `describeLessonsImport` ning
 * izohlarni ham aytadigan varianti.
 *
 * Izohlar 0 bo'lsa umuman tilga OLINMAYDI: izoh ishlatmaydigan foydalanuvchiga
 * "0 ta izoh" degan qo'shimcha faqat shovqin.
 */
export function describeLessonBackupImport(
  added: number,
  updated: number,
  notes: number,
  notesFailed: NoteSaveResult | null = null,
): string {
  const parts: string[] = []
  if (added > 0) parts.push(`${added} ta dars qo'shildi`)
  if (updated > 0) {
    parts.push(added > 0 ? `${updated} tasi yangilandi` : `${updated} ta dars yangilandi`)
  }
  if (notes > 0) parts.push(`${notes} ta izoh tiklandi`)

  const head = `${parts.join(', ')}.`
  if (notesFailed === null) return head

  // Darslar tiklandi, izohlar esa yo'q — bu MUVAFFAQIYAT emas, yarim natija.
  // Jim qolinsa foydalanuvchi zaxira faylini o'chirib yuborishi mumkin edi.
  return `${head} ⚠️ Izohlar tiklanmadi: ${describeNotesFailure(notesFailed)}`
}

function describeNotesFailure(reason: NoteSaveResult): string {
  switch (reason) {
    case 'no-idb':
      return "bu brauzerda izohlar saqlanmaydi. Zaxira faylini SAQLAB QO'YING."
    case 'blocked':
      return "boshqa tab ilovaning eski nusxasini ushlab turibdi. O'sha tabni yopib, faylni qaytadan tiklang."
    case 'quota':
      return "brauzer xotirasi to'lgan. Joy bo'shatib, faylni qaytadan tiklang."
    default:
      return 'kutilmagan xato. Faylni qaytadan tiklab ko\'ring.'
  }
}
