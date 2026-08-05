// Audio fayllarni diskda saqlash: atomik yozish, in-flight dedup va TOCTOU'siz kesh tekshiruvi.
//
// Asosiy qoida (PLAN.md §5a): kesh `fs.access` bilan TEKSHIRILMAYDI. `fs.access` yarim
// yozilgan yoki 0 baytli MP3 ni ham "bor" deb ko'radi — natijada o'sha so'z umrbod jim
// qoladi. Shuning uchun fayl har doim O'QILADI, hajmi va MP3 sarlavhasi tekshiriladi.
// Yaroqsiz fayl o'chiriladi va qayta sintez qilinadi.

import fs from 'node:fs/promises'
import path from 'node:path'

/** Bundan kichik fayl yaroqsiz hisoblanadi — edge-tts bo'sh audio qaytarishi mumkin. */
const MIN_AUDIO_BYTES = 1024

/** Barcha MP3 lar shu YASSI papkada yotadi — pastki papka yaratilmaydi. */
export const AUDIO_DIR: string = path.resolve(process.cwd(), 'audio-words')

/** Ayni paytda sintez qilinayotgan fayllar: nom -> tugallanmagan Promise. */
const inFlight = new Map<string, Promise<void>>()

/** `.tmp` nomlarini bir jarayon ichida ham noyob qilish uchun hisoblagich. */
let tmpCounter = 0

/**
 * Fayl nomini xavfsiz bazaviy nomga keltiradi.
 * Har qanday yo'l ajratuvchisi yoki `..` — xato, chunki bunday nom AUDIO_DIR dan
 * chiqib ketishga urinish demakdir (`voice:"../../../.config/x"` holati).
 */
function safeName(filename: string): string {
  if (filename.length === 0) {
    throw new Error("Fayl nomi bo'sh")
  }
  if (filename.includes('\0')) {
    throw new Error('Fayl nomida NUL bayt bor: ' + JSON.stringify(filename))
  }
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error("Fayl nomida yo'l ajratuvchisi bo'lishi mumkin emas: " + filename)
  }
  const base = path.basename(filename)
  if (base !== filename || base === '.' || base === '..') {
    throw new Error("Fayl nomi noto'g'ri: " + filename)
  }
  return base
}

/**
 * Fayl nomini AUDIO_DIR ichidagi to'liq yo'lga aylantiradi.
 * `path.basename` majburiy; natija AUDIO_DIR dan chiqib ketolmaydi — buzilsa xato tashlanadi.
 */
export function audioPath(filename: string): string {
  const base = safeName(filename)
  const full = path.join(AUDIO_DIR, base)
  // Himoyaning ikkinchi qatlami: natija ANIQ AUDIO_DIR ning bevosita ichida bo'lsin.
  if (path.dirname(full) !== AUDIO_DIR) {
    throw new Error("Yo'l AUDIO_DIR dan tashqariga chiqdi: " + filename)
  }
  return full
}

/** `audio-words/` papkasi borligiga kafolat beradi (usiz birinchi yozuv ENOENT beradi). */
export async function ensureAudioDir(): Promise<void> {
  await fs.mkdir(AUDIO_DIR, { recursive: true })
}

/**
 * Bufer MP3 ga o'xshaydimi: `ID3` tegi yoki MPEG frame sync (`0xFF`, keyin yuqori 3 bit).
 * Bu to'liq dekodlash emas — buzuq/bo'sh javobni arzon narxda rad etish uchun.
 */
export function looksLikeMp3(buf: Uint8Array): boolean {
  if (buf.length < 3) return false
  const b0 = buf[0] ?? 0
  const b1 = buf[1] ?? 0
  const b2 = buf[2] ?? 0
  // "ID3" — ID3v2 sarlavhasi
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return true
  // MPEG audio frame sync: 11 ta ketma-ket bir
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return true
  return false
}

/** Bufer haqiqiy audio ekanini tekshiradi; bo'lmasa tushunarli xato tashlaydi. */
function assertValidAudio(buf: Uint8Array, filename: string): void {
  if (buf.length < MIN_AUDIO_BYTES) {
    throw new Error(
      `Audio juda kichik (${String(buf.length)} bayt < ${String(MIN_AUDIO_BYTES)}): ${filename}`,
    )
  }
  if (!looksLikeMp3(buf)) {
    throw new Error('Audio MP3 sarlavhasiga ega emas: ' + filename)
  }
}

/** `err.code` ni xavfsiz o'qiydi (xato tipi `unknown` bo'lgani uchun). */
function errorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code
    return typeof code === 'string' ? code : null
  }
  return null
}

/** Faylni jimgina o'chiradi — o'chirishdagi xato asosiy oqimni buzmasligi kerak. */
async function removeQuietly(fullPath: string): Promise<void> {
  try {
    await fs.rm(fullPath, { force: true })
  } catch {
    // Ataylab e'tiborsiz: keyingi yozuv baribir ustidan yozadi.
  }
}

/**
 * Keshdagi faylni O'QIB tekshiradi.
 * Yaroqli bo'lsa buferni, aks holda `null` qaytaradi va yaroqsiz faylni o'chiradi.
 * Shu tufayli yarim yozilgan MP3 hech qachon "kesh urdi" deb hisoblanmaydi.
 */
export async function readValidCached(filename: string): Promise<Buffer | null> {
  const full = audioPath(filename)
  let buf: Buffer
  try {
    buf = await fs.readFile(full)
  } catch (err) {
    const code = errorCode(err)
    // Fayl yo'q yoki o'rnida papka turibdi — ikkalasi ham "kesh yo'q" degani.
    if (code === 'ENOENT' || code === 'EISDIR') return null
    // Kutilmagan xato (masalan EACCES) yashirilmaydi: aks holda har so'z abadiy
    // qayta sintez qilinib, sabab ko'rinmay qolardi.
    throw err
  }
  if (buf.length < MIN_AUDIO_BYTES || !looksLikeMp3(buf)) {
    await removeQuietly(full)
    return null
  }
  return buf
}

/**
 * Atomik yozish: `<nom>.<pid>.<counter>.tmp` ga yoziladi -> diskdan qayta o'qib
 * tekshiriladi -> `fs.rename` bilan joyiga qo'yiladi (ext4 da atomik).
 * Har qanday xatoda `.tmp` tozalanadi, ya'ni chala fayl qolmaydi.
 */
export async function writeAtomic(filename: string, buf: Buffer): Promise<void> {
  const full = audioPath(filename)
  await ensureAudioDir()

  tmpCounter += 1
  const tmpName = `${path.basename(full)}.${String(process.pid)}.${String(tmpCounter)}.tmp`
  const tmpPath = path.join(AUDIO_DIR, tmpName)

  try {
    await fs.writeFile(tmpPath, buf)
    // Baytlar haqiqatan diskka tushganini tekshiramiz — bufer emas, FAYL o'qiladi.
    const written = await fs.readFile(tmpPath)
    if (written.length !== buf.length) {
      throw new Error(
        `Yozuv chala: ${String(written.length)} / ${String(buf.length)} bayt — ${filename}`,
      )
    }
    assertValidAudio(written, filename)
    await fs.rename(tmpPath, full)
  } catch (err) {
    await removeQuietly(tmpPath)
    throw err
  }
}

/** Sintez qilib, tekshirib, atomik yozadi. In-flight Map shu Promise ni saqlaydi. */
async function synthesizeAndStore(filename: string, synth: () => Promise<Buffer>): Promise<void> {
  const buf = await synth()
  // Yaroqsiz buferni diskka umuman chiqarmaymiz — retry `tts.ts` da qilinadi.
  assertValidAudio(buf, filename)
  await writeAtomic(filename, buf)
}

/**
 * Kesh bo'lsa — o'qiydi va `cached` qaytaradi.
 * Bo'lmasa — in-flight Map orqali dedup qilib `synth()` ni CHAQIRADI: bir xil fayl uchun
 * bir vaqtda AYNAN BITTA sintez ketadi, qolgan chaqiruvchilar o'sha Promise ni kutadi.
 * `synth` qaytargan bufer 1024 baytdan kichik yoki MP3 sarlavhasiz bo'lsa — xato.
 */
export async function ensureAudio(
  filename: string,
  synth: () => Promise<Buffer>,
): Promise<{ status: 'cached' | 'synthesized' }> {
  const name = safeName(filename)

  const cached = await readValidCached(name)
  if (cached !== null) return { status: 'cached' }

  const running = inFlight.get(name)
  if (running !== undefined) {
    // Boshqa chaqiruv allaqachon shu faylni sintez qilyapti — natijasini kutamiz.
    await running
    return { status: 'synthesized' }
  }

  // MUHIM: `inFlight.get` va `inFlight.set` orasida `await` YO'Q — shuning uchun ikki
  // parallel chaqiruvdan faqat bittasi bu yerga tushadi.
  const task = synthesizeAndStore(name, synth)
  inFlight.set(name, task)
  try {
    await task
  } finally {
    if (inFlight.get(name) === task) inFlight.delete(name)
  }
  return { status: 'synthesized' }
}

/** Testlar uchun: ayni paytda ketayotgan sintezlar soni. */
export function inFlightCount(): number {
  return inFlight.size
}

/**
 * Testlar uchun: modul darajasidagi butun holatni tozalaydi (in-flight Map va `.tmp`
 * hisoblagichi). Boshqa keshi yo'q — kesh vazifasini `AUDIO_DIR` dagi fayllarning
 * o'zi bajaradi, shuning uchun testlar vaqtinchalik papkada ishlaydi.
 */
export function __resetForTests(): void {
  inFlight.clear()
  tmpCounter = 0
}
