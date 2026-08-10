// Seans yozuvlarini qisqartirish (docs/stats-longterm.md §4.4, §12 M4).
//
// `sessions` — YAGONA chegaralangan do'kon. `words` va `days` ABADIY saqlanadi
// va bu yerda ularga UMUMAN tegilmaydi: eski gap yozuvining butun ma'lumoti
// allaqachon o'sha ikkalasida va `meta.lifetime` da yashaydi (§4.3), shuning
// uchun seansning o'zini tashlash hech qanday hisobotni kambag'allashtirmaydi.
//
// ⚠️ Bu modul `meta.lifetime` ga TEGMAYDI va bu ataylab. §8.2 shartnomasiga
// ko'ra umrbod hisoblagichlar HAR GAP yozilganda oshiriladi, ya'ni seans
// o'chirilgan paytga kelib ular allaqachon yangilangan. Agar `compact` ularni
// o'chirilayotgan seanslardan "ayirsa" yoki qayta hisoblasa, aynan §4.3 oldini
// olish uchun yaratilgan nuqson qaytardi: umrbod seans sanog'i ORQAGA yurardi.

import { dayNumber } from '../core/wordScore.ts'
import { withStatsDb, eachCursor } from './statsDb.ts'
import { INDEX_SESSIONS_BY_ENDED_AT, STORE_SESSIONS } from './statsSchema.ts'

/**
 * Seans yozuvlari shuncha kun saqlanadi (§4.4).
 *
 * EKSPORT qilinadi, chunki bu son foydalanuvchiga ko'rsatiladigan va'da:
 * Statistika ekrani "seans tafsilotlari N kun saqlanadi" deb yozganda
 * konstanta bilan matn ikki joyda ayrilib ketmasligi kerak.
 */
export const RETENTION_DAYS = 180

/** Qisqartirish uchun kerak bo'lgan minimal maydonlar — to'liq `SessionRecord` emas. */
type SessionKeyFields = { id: string; endedAt: number }

/**
 * `RETENTION_DAYS` dan eski seanslarni o'chiradi va o'chirilganlar sonini qaytaradi.
 *
 * Chegara KUN RAQAMIDA solishtiriladi, xom millisekundda emas: butun ombor
 * lokal kun tushunchasiga qurilgan (`days` kaliti, `words.l`, seriyalar), va
 * "180 kun" ni `now - 180*86400000` deb hisoblash DST o'tishlarida chegarani
 * bir soatga siljitardi — yil davomida ikki marta, jimgina.
 *
 * Kursor `by_endedAt` bo'yicha ENG ESKIDAN yuradi va chegaraga yetgan birinchi
 * qatorda TO'XTAYDI (§9.4 bilan bir xil sabab): omborni to'liq skanerlash
 * o'chiriladigan yozuv yo'q bo'lgan odatiy holatda ham har boshlanishda butun
 * tarixni o'qishni anglatardi.
 *
 * `null` emas, `0` qaytariladi: IDB yo'q bo'lsa qisqartiradigan narsa ham yo'q,
 * va chaqiruvchi buni xato sifatida ko'rishi kerak emas (§8.4d).
 */
export async function compactSessions(now: number = Date.now()): Promise<number> {
  const cutoffDay = dayNumber(now) - RETENTION_DAYS

  const removed = await withStatsDb<number>(
    [STORE_SESSIONS],
    'readwrite',
    (tx, collect) => {
      const store = tx.objectStore(STORE_SESSIONS)
      const index = store.index(INDEX_SESSIONS_BY_ENDED_AT)

      let count = 0

      // (§8.4a) O'chirish kursorning `onsuccess` i ICHIDAN chiqariladi, ya'ni
      // tranzaksiya butun yurish davomida faol qoladi.
      eachCursor<SessionKeyFields>(index, 'next', (row) => {
        if (dayNumber(row.endedAt) >= cutoffDay) return false
        store.delete(row.id)
        count += 1
        collect(count)
      })
    },
    // Kursor birorta qator bermasa `collect` UMUMAN chaqirilmaydi. Boshlang'ich
    // qiymatni `runTx` ning imzosi talab qiladi, ya'ni buni unutib bo'lmaydi.
    0,
  )

  // `null` — IDB umuman yo'q (§8.4d): qisqartiradigan narsa ham yo'q, va bu
  // chaqiruvchi uchun xato EMAS.
  return removed ?? 0
}
