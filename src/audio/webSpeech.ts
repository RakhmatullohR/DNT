// Brauzerning o'z `speechSynthesis` dvigateli — server MP3 si bo'lmaganda ishlaydigan zaxira.
//
// PLAN §5b da sanab o'tilgan uchta amaliy tuzoq shu yerda yopiladi:
//  1. `getVoices()` birinchi chaqiruvda ko'pincha BO'SH qaytadi — `voiceschanged` kutiladi.
//  2. `cancel()` dan keyin darhol `speak()` chaqirilsa Chrome utterance'ni yutib yuboradi —
//     ular orasida kichik oraliq qoldiriladi.
//  3. `speak()` jimgina hech narsa qilmasligi mumkin — `onstart` kuzatiladi va u kelmasa
//     promise REJECT bo'ladi. Aks holda jimlik "eshitildi" deb hisoblanardi.

/** `cancel()` va `speak()` orasidagi oraliq (Chrome poygasi). */
const CANCEL_GAP_MS = 60

/** Shu vaqt ichida `onstart` kelmasa — ovoz chiqmagan hisoblanadi. */
const START_TIMEOUT_MS = 1_500

/** `voiceschanged` umuman kelmaydigan brauzerlar uchun chegara. */
const VOICES_TIMEOUT_MS = 3_000

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null
let warmed = false

/**
 * Har bir yangi chaqiruvda va har bir bekor qilishda oshadi.
 *
 * Zarur, chunki `speak()` `CANCEL_GAP_MS` kechikish bilan yuboriladi: shu oraliqda
 * so'z bekor qilinsa yoki yangi so'z kelsa, kechikkan `speak()` baribir ishga tushib
 * TASHLANGAN so'zni ovoz chiqarib o'qirdi — natijada ketma-ket ikkita so'z eshitilardi.
 */
let speechEpoch = 0

/** Brauzerda `speechSynthesis` bormi? */
export function speechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  )
}

/**
 * Foydalanuvchi harakati (`pointerdown` / `keydown`) ichida chaqiriladi.
 * iOS va Safari faqat foydalanuvchi harakati ichidagi `speak()` dan keyin ovoz beradi,
 * shuning uchun bu yerda ovozi o'chirilgan bo'sh utterance yuboriladi va
 * shu bilan birga ovozlar ro'yxati oldindan yuklab qo'yiladi.
 */
export async function warmUp(): Promise<void> {
  if (!speechAvailable() || warmed) return
  warmed = true
  try {
    const silent = new SpeechSynthesisUtterance(' ')
    silent.volume = 0
    window.speechSynthesis.speak(silent)
  } catch {
    // Isitish muvaffaqiyatsiz bo'lsa ham ovozlarni yuklashda davom etamiz.
  }
  await loadVoices()
}

/** Joriy sintezni to'xtatadi (`AudioManager.stopAll()` va uzishlar uchun). */
export function cancelSpeech(): void {
  if (!speechAvailable()) return
  // Hali yuborilmagan (kechikish oynasidagi) so'z ham bekor qilinadi.
  speechEpoch += 1
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Ba'zi brauzerlar bo'sh navbatda ham istisno tashlaydi — ahamiyati yo'q.
  }
}

/**
 * So'zni brauzer sintezi bilan o'qiydi.
 *
 * Ikkita alohida nuqta bildiriladi:
 *  - `onStarted` — ovoz HAQIQATAN chiqa boshlaganda (`onstart` hodisasi);
 *  - qaytgan promise — ijro tugaganda `resolve`, xato yoki ovoz umuman
 *    boshlanmaganda `reject`.
 *
 * Shuning uchun chaqiruvchi "boshlandi" va "tugadi" ni aralashtirib yubormaydi.
 */
export function speakWord(word: string, onStarted?: () => void): Promise<void> {
  if (!speechAvailable()) {
    return Promise.reject(new Error('speechSynthesis bu brauzerda mavjud emas'))
  }

  const synth = window.speechSynthesis

  return loadVoices().then(
    (voices) =>
      new Promise<void>((resolve, reject) => {
        // Bu chaqiruv endi yagona faol chaqiruv. Undan oldingi, hali yuborilmagan
        // so'zlar shu bilan bekor bo'ladi.
        speechEpoch += 1
        const epoch = speechEpoch

        try {
          synth.cancel()
        } catch {
          // Yuqoridagi izohga qarang.
        }

        const utt = new SpeechSynthesisUtterance(word)
        const voice = pickVoice(voices)
        if (voice) {
          utt.voice = voice
          utt.lang = voice.lang
        } else {
          utt.lang = 'en-US'
        }
        utt.rate = 1
        utt.pitch = 1
        utt.volume = 1

        let settled = false
        let startTimer: ReturnType<typeof setTimeout> | null = null
        let endTimer: ReturnType<typeof setTimeout> | null = null

        const clearTimers = (): void => {
          if (startTimer !== null) {
            clearTimeout(startTimer)
            startTimer = null
          }
          if (endTimer !== null) {
            clearTimeout(endTimer)
            endTimer = null
          }
        }

        const done = (): void => {
          if (settled) return
          settled = true
          clearTimers()
          resolve()
        }

        const fail = (reason: string): void => {
          if (settled) return
          settled = true
          clearTimers()
          reject(new Error(reason))
        }

        utt.onstart = () => {
          if (startTimer !== null) {
            clearTimeout(startTimer)
            startTimer = null
          }
          if (settled) return
          if (onStarted) onStarted()
          // Ba'zi brauzerlarda `onend` umuman kelmaydi — promise abadiy osilib qolmasin.
          endTimer = setTimeout(done, endGuardMs(word))
        }
        utt.onend = () => {
          done()
        }
        utt.onerror = (ev) => {
          fail('speechSynthesis xatosi: ' + String(ev.error))
        }

        // `cancel()` dan keyin kichik oraliq: usiz Chrome bu utterance'ni jimgina yutadi.
        setTimeout(() => {
          if (settled) return
          if (epoch !== speechEpoch) {
            // Kutish oynasida bekor qilindi yoki yangi so'z keldi — bu so'z o'qilmaydi.
            fail('so\'z yuborilishidan oldin bekor qilindi')
            return
          }
          try {
            synth.speak(utt)
          } catch {
            fail("speak() chaqiruvi muvaffaqiyatsiz bo'ldi")
            return
          }
          // `speak()` chaqirilgani ovoz chiqqanini bildirmaydi — `onstart` kutiladi.
          startTimer = setTimeout(() => {
            fail('ovoz boshlanmadi')
          }, START_TIMEOUT_MS)
        }, CANCEL_GAP_MS)
      }),
  )
}

/**
 * Ovozlar ro'yxati. Birinchi `getVoices()` deyarli doim bo'sh qaytadi,
 * shuning uchun `voiceschanged` kutiladi; hodisa kelmasa timeout bilan
 * bor narsa qaytariladi (ro'yxat bo'sh bo'lsa brauzer o'z defaultini ishlatadi).
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise

  voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const synth = window.speechSynthesis
    const immediate = safeGetVoices(synth)
    if (immediate.length > 0) {
      resolve(immediate)
      return
    }

    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      synth.removeEventListener('voiceschanged', finish)
      clearTimeout(timer)
      resolve(safeGetVoices(synth))
    }

    synth.addEventListener('voiceschanged', finish)
    const timer = setTimeout(finish, VOICES_TIMEOUT_MS)
  })

  return voicesPromise
}

function safeGetVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return synth.getVoices()
  } catch {
    return []
  }
}

/** en-US ustuvor; bo'lmasa boshqa inglizcha ovoz; u ham bo'lmasa brauzer defaulti. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => langTag(v).startsWith('en'))
  if (english.length === 0) return null

  const enUs = english.filter((v) => langTag(v).startsWith('en-us'))
  const pool = enUs.length > 0 ? enUs : english

  const preferred = pool.find((v) => v.default) ?? pool.find((v) => v.localService)
  return preferred ?? pool[0] ?? null
}

function langTag(voice: SpeechSynthesisVoice): string {
  return voice.lang.replace('_', '-').toLowerCase()
}

/** `onend` kelmasa promise'ni yopadigan taxminiy ijro davomiyligi. */
function endGuardMs(word: string): number {
  return Math.max(3_000, word.length * 250)
}
