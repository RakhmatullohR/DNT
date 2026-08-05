// Tarmoqli smoke test — `node tests/smoke/tts.smoke.ts` (yoki `npm run smoke`).
//
// Vitest EMAS va `npm test` ichiga KIRMAYDI: bu skript Microsoft'ning norasmiy
// edge-tts endpointiga bog'liq, ya'ni internetsiz yoki endpoint o'zgarganda yiqiladi.
// Shuning uchun u alohida turadi (PLAN §9).
//
// Server `buildServer()` orqali xotirada ko'tariladi va `app.inject()` bilan chaqiriladi —
// port band qilinmaydi, ya'ni `npm run dev` ishlab turganda ham smoke bemalol ishlaydi.
//
// Tekshiriladi (PLAN §9):
//   1. 2 ta so'z HAQIQATAN sintez qilinadi;
//   2. `audio-words/` da 2 ta MP3 paydo bo'ladi va har biri > 1 KB;
//   3. PASTKI PAPKA yaratilmaydi (struktura yassi) va `.tmp` qoldiq qolmaydi;
//   4. ikkinchi chaqiruv sintezsiz, keshdan o'tadi (fayllar tegilmaydi);
//   5. `GET /api/audio/:file` to'g'ri sarlavhalar bilan o'sha faylni qaytaradi.
//
// Muvaffaqiyatda 0, xatoda 1 kod bilan chiqadi.

import fs from 'node:fs'
import path from 'node:path'
import { buildServer } from '../../server/index.ts'
import type { BatchResponse } from '../../server/index.ts'
import { AUDIO_DIR } from '../../server/store.ts'
import { DEFAULT_RATE, DEFAULT_VOICE, audioFilename } from '../../shared/filename.ts'

const WORDS = ['quick', 'brown']
const MIN_MP3_BYTES = 1024
/** Keshdan o'qish shuncha millisekunddan uzun ketsa — demak jimgina qayta sintez bo'lgan. */
const CACHE_HIT_BUDGET_MS = 2_000

const audioDir = path.resolve(AUDIO_DIR)

let failures = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  [OK]   ${label}`)
    return
  }
  failures += 1
  console.error(`  [XATO] ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

function describeFailed(failed: BatchResponse['failed']): string {
  return failed.map((entry) => `${entry.word}: ${entry.reason}`).join('; ')
}

function describeStatuses(ok: BatchResponse['ok']): string {
  return ok.map((entry) => `${entry.word}=${entry.status}`).join(', ')
}

async function main(): Promise<void> {
  console.log('== edge-tts smoke ==')
  console.log(`   papka:   ${audioDir}`)
  console.log(`   ovoz:    ${DEFAULT_VOICE} @ ${String(DEFAULT_RATE)}`)
  console.log(`   so'zlar: ${WORDS.join(', ')}`)

  const files = WORDS.map((word) => audioFilename(word, DEFAULT_VOICE, DEFAULT_RATE))

  // Haqiqiy sintezni ko'rish uchun aynan shu ikki faylning eski nusxasi olib tashlanadi.
  // Boshqa hech narsaga tegilmaydi — qolgan kesh joyida qoladi.
  for (const file of files) {
    fs.rmSync(path.join(audioDir, file), { force: true })
  }

  const app = buildServer()
  try {
    console.log('\n1) Birinchi chaqiruv (sintez kutiladi)')
    const startedAt = Date.now()
    const first = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: WORDS },
    })
    const firstMs = Date.now() - startedAt

    check("so'rov 200 qaytardi", first.statusCode === 200, `statusCode=${String(first.statusCode)}`)
    if (first.statusCode !== 200) {
      console.error(first.body)
      return
    }

    const firstBody = first.json() as BatchResponse
    check(
      "hech bir so'z muvaffaqiyatsiz bo'lmadi",
      firstBody.failed.length === 0,
      describeFailed(firstBody.failed),
    )
    check(
      `${String(WORDS.length)} ta so'z ok ro'yxatida`,
      firstBody.ok.length === WORDS.length,
      `ok=${String(firstBody.ok.length)}`,
    )
    check(
      'ikkalasi ham shu chaqiruvda sintez qilindi',
      firstBody.ok.length === WORDS.length &&
        firstBody.ok.every((entry) => entry.status === 'synthesized'),
      describeStatuses(firstBody.ok),
    )
    console.log(`       (${String(firstMs)} ms)`)

    console.log('\n2) Disk holati')
    let allPresent = true
    for (const file of files) {
      const full = path.join(audioDir, file)
      const exists = fs.existsSync(full)
      check(`${file} mavjud`, exists)
      if (!exists) {
        allPresent = false
        continue
      }
      const size = fs.statSync(full).size
      check(`${file} > 1 KB`, size > MIN_MP3_BYTES, `${String(size)} bayt`)
    }

    const entries = fs.readdirSync(audioDir, { withFileTypes: true })
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    check('pastki papka yaratilmadi', dirs.length === 0, dirs.join(', '))
    const leftovers = entries.filter((entry) => entry.name.includes('.tmp')).map((e) => e.name)
    check("'.tmp' qoldiq yo'q", leftovers.length === 0, leftovers.join(', '))

    if (!allPresent) {
      console.error("\n  Fayllar yo'q — keyingi bosqichlar o'tkazib yuborildi.")
      return
    }

    const before = files.map((file) => fs.statSync(path.join(audioDir, file)))

    console.log('\n3) Ikkinchi chaqiruv (sintezsiz, keshdan)')
    const cacheStartedAt = Date.now()
    const second = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: WORDS },
    })
    const secondMs = Date.now() - cacheStartedAt

    check(
      "so'rov 200 qaytardi",
      second.statusCode === 200,
      `statusCode=${String(second.statusCode)}`,
    )
    const secondBody = second.json() as BatchResponse
    check(
      'hammasi keshdan olindi',
      secondBody.ok.length === WORDS.length &&
        secondBody.ok.every((entry) => entry.status === 'cached'),
      describeStatuses(secondBody.ok),
    )
    check(
      `keshdan o'qish ${String(CACHE_HIT_BUDGET_MS)} ms dan tez`,
      secondMs < CACHE_HIT_BUDGET_MS,
      `${String(secondMs)} ms`,
    )

    const after = files.map((file) => fs.statSync(path.join(audioDir, file)))
    const untouched = before.every((stat, index) => {
      const next = after[index]
      return next !== undefined && next.mtimeMs === stat.mtimeMs && next.size === stat.size
    })
    check("fayllar qayta yozilmadi (mtime va hajm o'zgarmadi)", untouched)

    console.log('\n4) GET /api/audio/:file')
    const firstFile = files[0]
    if (firstFile === undefined) {
      check("fayl nomi hosil bo'ldi", false)
    } else {
      const res = await app.inject({
        method: 'GET',
        url: `/api/audio/${encodeURIComponent(firstFile)}`,
      })
      check('audio 200 qaytardi', res.statusCode === 200, `statusCode=${String(res.statusCode)}`)
      check(
        'Content-Type: audio/mpeg',
        res.headers['content-type'] === 'audio/mpeg',
        String(res.headers['content-type']),
      )
      check(
        'Cache-Control uzoq muddatli',
        res.headers['cache-control'] === 'public, max-age=31536000',
        String(res.headers['cache-control']),
      )
      check(
        'tana > 1 KB',
        res.rawPayload.length > MIN_MP3_BYTES,
        `${String(res.rawPayload.length)} bayt`,
      )
    }
  } finally {
    await app.close()
  }
}

try {
  await main()
} catch (err) {
  failures += 1
  console.error('\n[XATO] smoke kutilmaganda uzildi:', err)
}

if (failures === 0) {
  console.log('\nNATIJA: smoke MUVAFFAQIYATLI')
  process.exit(0)
}
console.error(`\nNATIJA: ${String(failures)} ta tekshiruv YIQILDI`)
process.exit(1)
