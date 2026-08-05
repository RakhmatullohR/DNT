// Lokal TTS serveri bilan ishlaydigan yupqa HTTP klienti.
// Bu yerda audio dekodlanmaydi va hech qanday ijro holati saqlanmaydi —
// buning hammasi `AudioManager.ts` da.

import { isValidWord } from '../../shared/filename.ts'

/** Server bitta so'rovda qabul qiladigan maksimal so'z soni (PLAN §5a: `words.length <= 200`). */
const MAX_BATCH = 200

/** `/api/health` uchun qisqa timeout — server o'chiq bo'lsa UI kutib qolmasin. */
const HEALTH_TIMEOUT_MS = 1_500

/** Sintez sekin bo'lishi mumkin (200 so'z, parallellik <= 4), shuning uchun oraliq keng. */
const BATCH_TIMEOUT_MS = 180_000

export type BatchResult = {
  ok: Array<{ word: string; file: string; status: string }>
  failed: Array<{ word: string; reason: string }>
}

export type BatchOptions = {
  /**
   * Bu paket foydalanuvchi kutib turgan ish EMAS (butun darsni oldindan yuklash).
   * Server bunday so'rovni sintez navbatida interaktivlaridan KEYINGA qo'yadi va
   * unga 4 slotdan ko'pi bilan 2 tasini beradi (`server/index.ts`).
   */
  background?: boolean
}

/**
 * So'zlar to'plamini serverga sintez qilishga beradi.
 *
 * - Takrorlangan so'zlar bir marta yuboriladi (bir gapda `the` bir necha marta uchraydi).
 * - `isValidWord` dan o'tmagan token (raqam, tinish belgisi) serverga umuman yuborilmaydi —
 *   u 400 qaytarib butun to'plamni yiqitmasligi uchun darhol `failed` ga yoziladi.
 * - So'rov 200 tadan bo'lib, ketma-ket yuboriladi: serverni bir vaqtning o'zida
 *   o'nlab batch bilan ko'mib tashlamaslik uchun.
 * - Tarmoq xatosi ham istisno tashlamaydi — o'sha bo'lakdagi hamma so'z `failed` ga tushadi,
 *   chaqiruvchi esa `speechSynthesis` zaxirasiga o'tadi.
 *
 * `options.background` berilmasa `false` — ya'ni so'rov INTERAKTIV hisoblanadi.
 * Aylanma prefetch va bitta so'zlik zaxira so'rovi aynan shu standartda qoladi.
 */
export async function requestBatch(
  words: string[],
  voice: string,
  rate: number,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const background = options.background ?? false
  const result: BatchResult = { ok: [], failed: [] }

  const unique: string[] = []
  const seen = new Set<string>()
  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    if (!isValidWord(word)) {
      result.failed.push({ word, reason: "sintez qilib bo'lmaydigan token" })
      continue
    }
    unique.push(word)
  }

  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const chunk = unique.slice(i, i + MAX_BATCH)
    const part = await postChunk(chunk, voice, rate, background)
    result.ok.push(...part.ok)
    result.failed.push(...part.failed)
  }

  return result
}

/** MP3 ga to'liq URL. Fayl nomida `'` va `-` bo'lishi mumkin — shuning uchun kodlanadi. */
export function audioUrl(filename: string): string {
  return '/api/audio/' + encodeURIComponent(filename)
}

/**
 * TTS serveri javob beryaptimi? Qisqa timeout bilan — javob bo'lmasa
 * ilova jimgina kutib turmasdan zaxira rejimga o'tadi.
 */
export async function serverAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

// Maydon nomlari `server/index.ts` dagi `batchBodySchema` bilan AYNAN bir xil bo'lishi
// shart: sxemada `additionalProperties: false` va `removeAdditional: false` turibdi,
// ya'ni noma'lum kalit jimgina tashlanmasdan 400 qaytaradi.
async function postChunk(
  words: string[],
  voice: string,
  rate: number,
  background: boolean,
): Promise<BatchResult> {
  try {
    const res = await fetch('/api/tts/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words, voice, rate, background }),
      signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
    })
    if (!res.ok) return allFailed(words, 'server javobi ' + String(res.status))
    const body: unknown = await res.json()
    return parseBatch(words, body)
  } catch (err) {
    return allFailed(words, err instanceof Error ? err.message : 'tarmoq xatosi')
  }
}

/**
 * Javobni ishonchsiz ma'lumot sifatida o'qiydi: format kutilganidan farq qilsa
 * ilova yiqilmaydi, shunchaki o'sha so'zlar `failed` ga tushadi.
 * Javobda umuman eslatilmagan so'z ham `failed` hisoblanadi — jimlik
 * hech qachon "tayyor" deb qabul qilinmaydi.
 */
function parseBatch(words: string[], body: unknown): BatchResult {
  if (typeof body !== 'object' || body === null) {
    return allFailed(words, 'javob formati notanish')
  }

  const raw = body as { ok?: unknown; failed?: unknown }
  const out: BatchResult = { ok: [], failed: [] }
  const covered = new Set<string>()

  if (Array.isArray(raw.ok)) {
    for (const item of raw.ok) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as { word?: unknown; file?: unknown; status?: unknown }
      if (typeof row.word !== 'string' || typeof row.file !== 'string') continue
      out.ok.push({
        word: row.word,
        file: row.file,
        status: typeof row.status === 'string' ? row.status : 'ok',
      })
      covered.add(row.word)
    }
  }

  if (Array.isArray(raw.failed)) {
    for (const item of raw.failed) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as { word?: unknown; reason?: unknown }
      if (typeof row.word !== 'string') continue
      out.failed.push({
        word: row.word,
        reason: typeof row.reason === 'string' ? row.reason : 'sabab korsatilmagan',
      })
      covered.add(row.word)
    }
  }

  for (const word of words) {
    if (!covered.has(word)) out.failed.push({ word, reason: "javobda yo'q" })
  }

  return out
}

function allFailed(words: string[], reason: string): BatchResult {
  return { ok: [], failed: words.map((word) => ({ word, reason })) }
}
