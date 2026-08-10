// Mashq seansining butun mantiqi bir joyda: klaviatura -> reducer -> effektlar ->
// audio -> statistika -> marshrut. Ekran (`Practice.tsx`) faqat chizadi.
//
// Uchta nozik joy borki, ular tasodifan to'g'ri chiqmaydi:
//
// 1. HOLAT MANBAI — `stateRef`, `useState` emas. Reducer effekt (`playWord`) qaytaradi,
//    va effekt `setState` yangilovchisi ICHIDA bajarilmasligi kerak: React 19
//    StrictMode yangilovchi funksiyani ikki marta chaqiradi va har so'z ikki marta
//    o'qilardi. Shuning uchun `reduce` handler ichida sinxron chaqiriladi, effektlar
//    qo'lda bajariladi, `setState` esa faqat tayyor obyektni oladi.
//
// 2. AUDIO CALLBACK'LARI ESKIRISHI. `onStarted`/`onFailed` faqat `tokenIndex` beradi.
//    Gap almashgach eski ijroning kech kelgan `onFailed` i YANGI gapning o'sha
//    indeksli tokenini "o'qilmagan" deb belgilab, holatni jimgina buzardi.
//    Yechim: har gap/qayta boshlashda `epoch` oshadi va callback o'z epoxasini
//    tasdiqlamasa tashlab yuboriladi.
//
// 3. GAP TUGAGANDA AVTOMATIK O'TISH YO'Q (PLAN §7): `finished` effekti faqat
//    "Enter kutilmoqda" holatini yoqadi. Avtomatik o'tilsa har gapning oxirgi
//    so'zi doim yarim eshitilardi.
//
// 4. YOZUV VA NAVIGATSIYA AJRATILGAN. Seansni yopish (`recordAndClose`)
//    marshrutni almashtirmaydi — buni faqat `endSession` qiladi. Sabab: seans
//    komponent UZILGANDA ham yozilishi kerak ("Mashqni to'xtatish", orqaga,
//    tab yopilishi), lekin o'sha yo'lda navigatsiya bo'lsa Bosh sahifaga
//    chiqmoqchi bo'lgan foydalanuvchi natijalar ekraniga uloqtirilardi.
//
// 5. ⭐ OMBOR HAR GAPDA YOZILADI (docs/stats-longterm.md §8.2), seans oxirida
//    EMAS. Sabab §8 da: IndexedDB asinxron, ya'ni `pagehide` da chiqarilgan
//    tranzaksiya sahifa o'lishidan oldin ulgurmasligi mumkin. Yozuv nuqtasini
//    har gapga ko'chirish yo'qotish radiusini butun seansdan BITTA GAPGA
//    tushiradi. Buning ikkita to'g'ridan-to'g'ri oqibati bor:
//      - so'z hissasi DELTA bo'lishi shart (`wordDeltaOf`), kumulyativ emas —
//        aks holda har gapda oldingilari qayta sanalardi (§8.1);
//      - seans `id` si seans BOSHIDA ajratiladi (§8.2.4), ya'ni "yozildimi"
//        degan javob endi `id` ning `null` ligidan CHIQMAYDI — buning uchun
//        alohida `hasWrittenRef` bayrog'i bor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { sanitizeRate, sanitizeVoice } from '../../shared/filename.ts'
import { audioManager, unlockAudio } from '../audio/AudioManager.ts'
import { requestBatch } from '../audio/ttsClient.ts'
import { mapKeydown, shouldPreventDefault } from '../core/keyboard.ts'
import { computeMetrics } from '../core/metrics.ts'
import {
  nextSentenceIndex,
  planSentenceWrite,
  SESSION_MAX_MS,
  SESSION_MAX_SENTENCES,
  sessionShouldEnd,
  wordDeltaOf,
} from '../core/session.ts'
import type { WordDelta } from '../core/session.ts'
import { tokenize } from '../core/tokenize.ts'
import { createState, reduce, wordTokenAt } from '../core/typing.ts'
import type { Effect, TypingEvent, TypingState } from '../core/types.ts'
import type { Lesson } from '../store/lessons.ts'
import { completeSentence } from '../store/lessons.ts'
import { writeSentences, writeSessionEnvelope } from '../store/stats.ts'
import type { SentenceWrite } from '../store/stats.ts'
import { roundSentence } from '../store/statsSchema.ts'
import type { SentenceRecord, SessionEnvelope } from '../store/statsSchema.ts'

/** Ovoz yoqiq/o'chiq holati shu kalitda eslab qolinadi (PLAN §8 dagi M2/M3 gate). */
const AUDIO_KEY = 'dnt.audio.v1'

/** Taymer va seans chegarasi shu oraliqda tekshiriladi. */
const TICK_MS = 500

/** Oldindan tayyorlanadigan KEYINGI gaplar soni (PLAN §7 dagi "keyingi 1-2 gap"). */
const PREFETCH_AHEAD = 2

/**
 * Server holati seans DAVOMIDA shu oraliqda qayta tekshiriladi.
 *
 * Boshlanishida bir marta tekshirish yetarli emas edi: 10 daqiqalik seansning
 * 3-daqiqasida server o'lsa, "zaxira: brauzer ovozi" belgisi hech qachon
 * chiqmasdi va har so'z jimgina `speechSynthesis` ga tushardi.
 *
 * Nega davriy so'rov, `AudioManager` dan callback emas: callback faqat
 * TUSHISHNI ko'radi, tiklanishni emas — server qaytganda belgi ekranda abadiy
 * osilib qolardi. Qolaversa bu yechim `AudioManager` ga umuman tegmaydi.
 * 60 soniya — `/api/health` ga seansiga ko'pi bilan 10 ta so'rov, ya'ni spam emas.
 */
const SERVER_POLL_MS = 60_000

/** Tashlangan gap haqidagi xabar shuncha vaqt jonli hududda turadi. */
const SKIP_NOTICE_MS = 4_000

/**
 * Oxirgi bosish kursorni SILJITMAGANI haqidagi belgi.
 * `nonce` har xatoda oshadi — ekran shu bilan animatsiyani qaytadan boshlaydi
 * (ketma-ket bir xil xato ham ko'zga tashlanishi kerak).
 */
export type BlockedKey = { wrong: string; nonce: number }

export type TypingSession = {
  /** Joriy gapning yozuv holati. */
  state: TypingState
  /** Kursor xato bosish tufayli turib qolgan bo'lsa — belgi, aks holda `null`. */
  blocked: BlockedKey | null
  /** Gap tugadi, `Enter` kutilmoqda (PLAN §7). */
  awaitingNext: boolean
  /** Joriy gapning DARS ichidagi indeksi (0 dan). */
  sentenceIndex: number
  /** Joriy gapning SEANS ichidagi tartib raqami (1 dan) — "7 / 20" dagi 7. */
  sentenceNo: number
  /** Shu seansda ko'pi bilan nechta gap bo'ladi — "7 / 20" dagi 20. */
  sessionTotal: number
  /** Jonli Net WPM: tugagan gaplar + joriy gap. */
  netWpm: number
  /** Jonli aniqlik, 0..1. */
  accuracy: number
  /** Seans tugashiga qolgan vaqt (ms). */
  remainingMs: number
  /** Gaplar bo'yicha bajarilish ulushi, 0..1. */
  sentenceProgress: number
  /** Vaqt bo'yicha bajarilish ulushi, 0..1. */
  timeProgress: number
  /** Oxirgi gap `Escape` bilan tashlangani haqidagi qisqa xabar ko'rinib turibdimi. */
  skipNotice: boolean
  audioEnabled: boolean
  toggleAudio: () => void
  /** Kursor turgan so'zni qayta o'qitadi (`Ctrl+Space`, ovoz tugmasi yonidagi tugma). */
  replayWord: () => void
  /** TTS serveri javob beryaptimi (PLAN §1 dagi "TTS server ulanmadi" ogohlantirishi). */
  serverOk: boolean
}

// ---------------------------------------------------------------------------
// Yordamchilar (React'dan tashqarida — har renderda qayta yaratilmasin)
// ---------------------------------------------------------------------------

function readAudioEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(AUDIO_KEY) !== 'off'
  } catch {
    // `file://` va cookie'lari o'chirilgan brauzerda murojaatning O'ZI xato tashlaydi.
    return true
  }
}

function writeAudioEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(AUDIO_KEY, enabled ? 'on' : 'off')
  } catch {
    // Saqlab bo'lmadi — mashq baribir davom etadi.
  }
}

/**
 * Seans identifikatori. `crypto.randomUUID` faqat xavfsiz kontekstda bor:
 * telefondan `http://192.168.x.x:5173` ga kirilganda u `undefined` bo'ladi va
 * zaxirasiz seansni yozish `TypeError` bilan yiqilardi (`store/lessons.ts` dagi
 * `newLessonId` bilan bir xil sabab).
 */
function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Pastdagi zaxiraga o'tamiz.
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Matn maydonida yozayotgan foydalanuvchining bosishini mashq o'g'irlamasligi kerak. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * `skipped` gapning so'z hissasi — BO'SH xarita.
 *
 * Modul darajasida BITTA nusxa: u hech qachon o'zgartirilmaydi (`writeSentences`
 * uni faqat o'qiydi), ya'ni har tashlangan gapda yangi `Map` yaratish bekorga
 * ish bo'lardi.
 */
const NO_WORDS: ReadonlyMap<string, WordDelta> = new Map()

function wordsOf(sentence: string): string[] {
  const words: string[] = []
  for (const token of tokenize(sentence)) {
    if (token.kind === 'word') words.push(token.text)
  }
  return words
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTypingSession(lesson: Lesson): TypingSession {
  const navigate = useNavigate()

  // Ovoz/tezlik CHEGARADA bir marta tozalanadi va shundan keyin hamma joyga
  // aynan shu juftlik uzatiladi. Ikki sabab bor:
  //   - `toLesson` (`store/lessons.ts`) `voice` maydoni yo'q yozuvni BO'SH SATRGA
  //     tushiradi, server esa bo'sh `voice` ni 400 bilan rad etadi — pastdagi
  //     ommaviy so'rov eski darslar uchun butunlay yiqilardi va `.catch` uni yutardi;
  //   - `audioManager` — modul singleton'i, `setVoice` yaroqsiz qiymatda
  //     jimgina qaytadi, ya'ni bunday dars OLDINGI darsning ovozida o'qilardi.
  // Tozalash mantig'i `shared/filename.ts` da — fayl nomini yasaydigan va uni
  // tekshiradigan qoida bir joyda tursin (PLAN §1).
  const voice = sanitizeVoice(lesson.voice)
  const rate = sanitizeRate(lesson.rate)

  // Boshlanish nuqtasi BIR MARTA olinadi: `completeSentence` omborni yangilab
  // boradi, lekin joriy seans o'z hisobini o'zi yuritadi.
  //
  // Dars oxiriga yetgan bo'lsa seans boshidan emas, `Escape` bilan tashlangan
  // gaplarning eng kichigidan boshlanadi (`nextSentenceIndex` dagi izoh).
  const [startIndex] = useState(() =>
    nextSentenceIndex(lesson.progress, lesson.sentences.length, lesson.skipped ?? []),
  )

  const [state, setState] = useState<TypingState>(() =>
    createState(lesson.sentences[startIndex] ?? ''),
  )
  const stateRef = useRef<TypingState>(state)

  /** Dars ichidagi indeks + seansda ortda qolgan gaplar soni — doim birga o'zgaradi. */
  const [progress, setProgressState] = useState({ index: startIndex, done: 0 })
  const progressRef = useRef(progress)

  const [blocked, setBlocked] = useState<BlockedKey | null>(null)
  /**
   * `Escape` bosilganini E'LON qilish uchun (PLAN §4 dagi "tashlash" harakati).
   * Usiz ekranda hech narsa o'zgarmasdi — gap jimgina almashardi va foydalanuvchi
   * nima bo'lganini tushunmasdi.
   */
  const [skipNotice, setSkipNotice] = useState(false)
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(readAudioEnabled)
  const [serverOk, setServerOk] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  /**
   * ⭐ Seans identifikatori SEANS BOSHIDA ajratiladi (§8.2.4).
   *
   * Ilgari u `recordAndClose` ichida, seans TUGAGANDA yasalardi. Gap
   * darajasidagi yozuvda bu mumkin emas: birinchi gap omborga tushayotganda
   * qaysi qatorga qo'shilishini bilish kerak, ya'ni kalit undan OLDIN
   * mavjud bo'lishi shart.
   */
  const [sessionId] = useState(newSessionId)

  /** Seans boshlangan payt = eng birinchi bosish (PLAN §6: taymer birinchi bosishda). */
  const startedAtRef = useRef<number | null>(null)
  /** Joriy gapdagi `Tab` bosishlari soni. */
  const restartsRef = useRef(0)
  const recordsRef = useRef<SentenceRecord[]>([])
  /**
   * §8.2.5 darvoza buferi: birinchi YOZILGAN gap paydo bo'lgunicha ushlab
   * turilgan `skipped` gaplar. Qaror `core/session.ts` dagi
   * `planSentenceWrite` da — bu yerda faqat holat saqlanadi.
   */
  const pendingRef = useRef<readonly SentenceWrite[]>([])
  /**
   * ⭐ "Bu seansda rostdan yozilgan gap bormi" — PLAN §7 dagi bo'sh seans
   * darvozasining YANGI signali.
   *
   * Ilgari bu javob `recordAndClose` ning `null` qaytarishidan chiqardi, u esa
   * `id` ni o'sha yerda yasagani uchun ishlardi. Endi `id` seans boshida
   * ajratiladi (yuqoriga qarang), ya'ni `null` ni "yozilmadi" belgisi sifatida
   * ishlatib bo'lmaydi — signal ALOHIDA bo'lishi shart. `endSession` ning
   * tarmoqlanishi shu bilan O'ZGARISHSIZ qoladi.
   */
  const hasWrittenRef = useRef(false)
  /** Seans yozilib bo'ldi — ikkinchi marta yozilmasligi va bosishlar o'tmasligi uchun. */
  const closedRef = useRef(false)
  const unlockedRef = useRef(false)

  /** Gap/urinish nomeri: eskirgan audio callback'lari shu bilan filtrlanadi. */
  const epochRef = useRef(0)
  /** tokenIndex -> `playWord` chaqirilgan paytdagi epoch. */
  const audioEpochRef = useRef<Map<number, number>>(new Map())
  /** Darsning qolgan qismi fonda BIR MARTA so'raladi (StrictMode effektni ikki marta yuritadi). */
  const bulkSynthRef = useRef(false)
  /**
   * Ovoz holatining REF nusxasi (PLAN §8, M2/M3 gate).
   *
   * `finishSentence` uni har gapda yozib qo'yadi. State to'g'ridan-to'g'ri
   * o'qilsa, callback `audioEnabled` ga bog'lanib qolardi va u o'zgargan har
   * safar `keydown` tinglovchisi qayta ulanardi — o'rtada bosilgan tugma
   * yo'qolishi mumkin edi.
   */
  const audioEnabledRef = useRef(audioEnabled)

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  const unlockOnce = useCallback((): void => {
    if (unlockedRef.current) return
    unlockedRef.current = true
    void unlockAudio()
  }, [])

  /** Callback shu seansning joriy gapiga tegishlimi (2-izoh, yuqoriga qarang). */
  const claimAudio = useCallback((tokenIndex: number): boolean => {
    const epoch = audioEpochRef.current.get(tokenIndex)
    if (epoch === undefined || epoch !== epochRef.current) return false
    audioEpochRef.current.delete(tokenIndex)
    return true
  }, [])

  const runEffects = useCallback((effects: Effect[], snapshot: TypingState): void => {
    for (const effect of effects) {
      if (effect.type !== 'playWord') {
        // `finished` — hech qanday avtomatik o'tish YO'Q (PLAN §7). Ekran
        // `state.finishedAt` ga qarab "Enter bosing" ko'rsatkichini chiqaradi.
        continue
      }
      const token = snapshot.tokens[effect.tokenIndex]
      if (token === undefined) continue
      // Epoch chaqiruvdan OLDIN yoziladi: ovozsiz rejimda `playWord` `onFailed` ni
      // sinxron chaqiradi va u ham shu yozuvni topishi kerak.
      audioEpochRef.current.set(effect.tokenIndex, epochRef.current)
      audioManager.playWord(token.text, effect.tokenIndex)
    }
  }, [])

  const applyEvent = useCallback(
    (event: TypingEvent): void => {
      const prev = stateRef.current
      const result = reduce(prev, event, Date.now())
      if (result.state !== prev) {
        stateRef.current = result.state
        setState(result.state)
        // Seans soati birinchi bosishda yuriladi.
        if (startedAtRef.current === null && result.state.startedAt !== null) {
          startedAtRef.current = result.state.startedAt
        }
      }
      runEffects(result.effects, result.state)
    },
    [runEffects],
  )

  const prefetchFrom = useCallback(
    (index: number): void => {
      const words: string[] = []
      const last = Math.min(index + PREFETCH_AHEAD, lesson.sentences.length - 1)
      for (let i = index; i <= last; i++) {
        const sentence = lesson.sentences[i]
        if (sentence === undefined) continue
        words.push(...wordsOf(sentence))
      }
      if (words.length === 0) return
      // Xatolar `AudioManager` ichida yutiladi: prefetch yiqilsa ijro paytida
      // zaxira zanjiri (`speechSynthesis`) ishlaydi.
      void audioManager.prefetch(words)
    },
    [lesson.sentences],
  )

  /** Yangi (yoki qaytadan boshlangan) gapga o'tish: holat, audio va epoch birga tozalanadi. */
  const resetTyping = useCallback((sentence: string): void => {
    // Epoch AVVAL oshadi: `stopAll()` kutayotgan so'z uchun `onFailed` chaqiradi,
    // u esa endi eskirgan hisoblanib tashlanadi.
    epochRef.current += 1
    audioEpochRef.current.clear()
    audioManager.stopAll()

    const fresh = createState(sentence)
    stateRef.current = fresh
    setState(fresh)
    setBlocked(null)
  }, [])

  // -------------------------------------------------------------------------
  // Seansni yopish
  // -------------------------------------------------------------------------

  /** Seansni muzlatadi: audio to'xtaydi, bosishlar endi holatga tegmaydi. */
  const freeze = useCallback((): void => {
    closedRef.current = true
    epochRef.current += 1
    audioManager.stopAll()
  }, [])

  /**
   * Seansning KONVERTI (§8.2.3): gaplarsiz yig'indi.
   *
   * WPM lar `activeMs` bo'yicha OG'IRLIKLI o'rtacha bilan yig'iladi. Bu oddiy
   * o'rtachadan farqli o'laroq matematik jihatdan aynan to'g'ri:
   * `netWpm_i = belgilar_i / (5 · daqiqa_i)` bo'lgani uchun
   * `Σ(netWpm_i · ms_i) / Σms_i = jami belgilar / (5 · jami daqiqa)`.
   *
   * ⚠️ YAXLITLASH TARTIBI (§2.3): manba sifatida `recordsRef` dagi ALLAQACHON
   * yaxlitlangan gaplar olinadi (`finishSentence` `roundSentence` ni yozuvni
   * yasashda qo'llaydi), og'irlikli o'rtacha esa aynan shulardan chiqadi.
   * Teskari tartibda diskdagi seans WPM i diskdagi gaplardan qayta
   * hisoblanmaydigan bo'lib qolardi: Natijalar ekranida yig'indi bilan gaplar
   * jadvali oxirgi kasrda kelishmay, uni tekshirgan odam mavjud bo'lmagan
   * xatoni qidirardi.
   *
   * `skipped` gaplar yig'indiga KIRMAYDI (PLAN §6a).
   */
  const envelopeOf = useCallback(
    (at: number): SessionEnvelope => {
      let activeMs = 0
      let keystrokes = 0
      let correctKeystrokes = 0
      let netWeighted = 0
      let rawWeighted = 0
      for (const record of recordsRef.current) {
        if (record.skipped) continue
        activeMs += record.activeMs
        keystrokes += record.keystrokes
        correctKeystrokes += record.correctKeystrokes
        netWeighted += record.netWpm * record.activeMs
        rawWeighted += record.rawWpm * record.activeMs
      }

      return {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        startedAt: startedAtRef.current ?? at,
        endedAt: at,
        activeMs,
        keystrokes,
        correctKeystrokes,
        netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
        rawWpm: activeMs > 0 ? rawWeighted / activeMs : 0,
        accuracy: keystrokes > 0 ? correctKeystrokes / keystrokes : 1,
      }
    },
    [lesson.id, lesson.title],
  )

  /**
   * Seansni YOPADI: yakuniy konvertni yozadi va `id` ni qaytaradi. Yozadigan
   * narsa bo'lmasa `null`.
   *
   * ⚠️ FAQAT KONVERT yoziladi (§8.2.3). So'z, kun va umrbod hisoblagichlar har
   * gapda allaqachon yangilangan; ularni bu yerda qayta qo'shish §8.1 dagi
   * "ikki marta sanash" ning to'g'ridan-to'g'ri o'zi bo'lardi.
   *
   * NAVIGATSIYA QILMAYDI — aynan shuning uchun ajratilgan. Bu funksiya
   * komponent uzilganda ("Mashqni to'xtatish", brauzerda orqaga, marshrut
   * almashishi) va `pagehide` da ham chaqiriladi; navigatsiya u yerda bo'lsa
   * Bosh sahifaga chiqmoqchi bo'lgan foydalanuvchi natijalar ekraniga
   * uloqtirilardi.
   *
   * `closedRef` FAQAT rostdan yozilganda qo'yiladi. Bo'sh seansda ham qo'yilsa,
   * React StrictMode ning dev rejimidagi SOXTA unmount'i (u hech qanday yozuv
   * bo'lmagan paytda yuz beradi) seansni tug'ilishidayoq o'ldirardi: keyingi
   * har bir bosish `closedRef` da to'xtab qolardi.
   *
   * ⚠️ Natija KUTILMAYDI (`void … .catch`): `pagehide` yo'lida kutishning
   * ma'nosi yo'q (sahifa o'lmoqda), boshqa yo'llarda esa yozuvni kutish
   * navigatsiyani sekinlashtirardi. Yo'qotilishi mumkin bo'lgan yagona narsa —
   * yakuniy `endedAt` va og'irlangan yig'indi; gaplarning O'ZI, so'z va kun
   * hisoblagichlari allaqachon diskda.
   */
  const recordAndClose = useCallback(
    (at: number): string | null => {
      if (closedRef.current) return null

      // Bitta ham gap YOZILMAGAN seans statistikani faqat ifloslantirardi.
      // Bayroq `planSentenceWrite` tomonidan qo'yiladi: Escape bilan tashlangan
      // gap `recordsRef` ga tushadi, lekin darvozani OCHMAYDI (PLAN §6a, §7).
      if (!hasWrittenRef.current) return null

      freeze()
      void writeSessionEnvelope(sessionId, envelopeOf(at)).catch(() => undefined)
      return sessionId
    },
    [envelopeOf, freeze, sessionId],
  )

  /** Seansni yozadi VA natijaga qarab marshrutni almashtiradi (normal tugash yo'li). */
  const endSession = useCallback(
    (at: number): void => {
      if (closedRef.current) return
      const id = recordAndClose(at)
      if (id === null) {
        // Yozilmadi — demak `recordAndClose` seansni yopmadi ham. Bu yerda
        // qo'lda yopamiz: navigatsiya davomida kelgan bosishlar o'lik seansga
        // tegmasligi kerak.
        freeze()
        navigate('/', { replace: true })
        return
      }
      // `replace`: tugagan seansga "orqaga" tugmasi bilan qaytib bo'lmaydi.
      navigate(`/results/${id}`, { replace: true })
    },
    [freeze, navigate, recordAndClose],
  )

  /**
   * "Gap tashlandi" xabarini yoqadi va `SKIP_NOTICE_MS` dan keyin o'chiradi.
   *
   * Ketma-ket `Escape` bosilsa taymer QAYTA boshlanadi — xabar oxirgi tashlashdan
   * keyin to'liq turadi. Bekor qilish (undo) ATAYIN yo'q: xabarning o'zi yetarli,
   * qaytarish esa yozuv/statistika/progress uchligini ortga sug'urishni talab
   * qilardi.
   */
  const announceSkip = useCallback((): void => {
    if (skipTimerRef.current !== null) clearTimeout(skipTimerRef.current)
    setSkipNotice(true)
    skipTimerRef.current = setTimeout(() => {
      skipTimerRef.current = null
      setSkipNotice(false)
    }, SKIP_NOTICE_MS)
  }, [])

  /**
   * Joriy gapni yopadi va keyingisiga o'tadi.
   *
   * `skipped` (Escape) gap statistikaga KIRMAYDI (`stats.ts` uni yig'indidan
   * chiqarib tashlaydi), lekin seans hajmini baribir yeydi.
   * `Tab` bilan qayta boshlangan urinish esa umuman yozilmaydi: holat noldan
   * tiklangani uchun bu yerga faqat OXIRGI urinishning raqamlari keladi.
   */
  const finishSentence = useCallback(
    (skipped: boolean): void => {
      if (closedRef.current) return

      const snapshot = stateRef.current
      const { index, done } = progressRef.current
      const metrics = computeMetrics(snapshot)
      const at = Date.now()

      // ⚠️ YAXLITLASH AYNAN SHU YERDA (§2.3): `recordsRef` ham, omborga
      // ketadigan nusxa ham AYNAN bir xil sonlarni ko'radi, ya'ni seans
      // konverti diskdagi gaplardan qayta hisoblanadigan bo'lib qoladi.
      const record = roundSentence({
        sentenceIndex: index,
        at,
        activeMs: metrics.activeMs,
        keystrokes: metrics.keystrokes,
        correctKeystrokes: metrics.correctKeystrokes,
        netWpm: metrics.netWpm,
        rawWpm: metrics.rawWpm,
        accuracy: metrics.accuracy,
        restarts: restartsRef.current,
        skipped,
        // ⭐ M2/M3 gate (PLAN §8): ovozli va ovozsiz mashqni keyin taqqoslash
        // uchun holat AYNAN GAP DARAJASIDA yoziladi — almashtirgich seans
        // o'rtasida ham bosilishi mumkin.
        audioEnabled: audioEnabledRef.current,
      })
      recordsRef.current.push(record)

      // ⭐ §8.1 — SO'Z DELTASI, kumulyativ xarita EMAS.
      //
      // Ilgari bu yerda seans davomida o'sib boradigan `wordStatsRef` xaritasi
      // yuritilardi va u seans oxirida BIR MARTA omborga quyilardi. Yozuv
      // nuqtasi har gapga ko'chgach o'sha xarita HALOKATLI bo'lib qoladi:
      // ikkinchi gapdan keyin birinchi gapning hissasi ikkinchi marta,
      // uchinchisidan keyin uchinchi marta yozilardi. Shuning uchun xarita
      // butunlay olib tashlandi va uning o'rniga har gap O'Z deltasini beradi.
      //
      // Delta `core/session.ts` da hisoblanadi (`wordDeltaOf`) — u yerda sof,
      // React'siz va mock'siz sinaladi. Xato TA'SIRLANISH darajasida sanaladi
      // (`min(…, 1)`), ya'ni `errors` = "bu so'z necha marta XATO BILAN
      // yozilgan"; sabab va almashuvlar o'sha funksiyaning izohida.
      const write: SentenceWrite = {
        ...record,
        words: skipped ? NO_WORDS : wordDeltaOf(snapshot.tokens, snapshot.errorCounts),
      }

      // ⭐ §8.2.5 DARVOZA BUFERI. Hammasi `Escape` bilan tashlangan seans HECH
      // NARSA yozmasligi kerak (PLAN §7, test bilan mixlangan), lekin yozuv
      // endi gap darajasida. Qaror `planSentenceWrite` da: birinchi YOZILGAN
      // gap paydo bo'lgunicha tashlanganlar buferda ushlanadi va o'sha gap
      // bilan BIRGA, bitta tranzaksiyada quyiladi.
      const plan = planSentenceWrite(pendingRef.current, hasWrittenRef.current, write)
      pendingRef.current = plan.pending
      hasWrittenRef.current = plan.hasWritten

      if (plan.write.length > 0) {
        // Natija KUTILMAYDI: ombor yozuvi UI ni bloklamasligi kerak — bu
        // IndexedDB'ga o'tishning bosh sabablaridan biri (§3.2a). Xato yutiladi,
        // chunki mashqni davom ettirish saqlashdan muhimroq; ombor umuman
        // ishlamayotgan bo'lsa banner `initStats()` natijasidan chiqadi (§8.4d).
        void writeSentences(sessionId, envelopeOf(at), plan.write).catch(() => undefined)
      }

      const nextIndex = index + 1
      const nextDone = done + 1
      // Progress GAP DARAJASIDA saqlanadi (PLAN §7): yarim yozilgan gap tashlanadi,
      // chunki kursorni gap o'rtasidan tiklab bo'lmaydi — o'tib ketilgan so'z
      // boshi endi hech qachon ovoz bermaydi.
      //
      // Tashlangan gap shu yerda ro'yxatga tushadi (yozib tugatilgani esa
      // ro'yxatdan chiqadi), progress esa ikkala holatda ham oldinga suriladi:
      // dars oxirida tashlangan gaplar `nextSentenceIndex` orqali qaytadi.
      completeSentence(lesson.id, index, skipped)
      if (skipped) announceSkip()

      const elapsed = startedAtRef.current === null ? 0 : at - startedAtRef.current
      const nextSentence = lesson.sentences[nextIndex]
      if (nextSentence === undefined || sessionShouldEnd(nextDone, elapsed)) {
        endSession(at)
        return
      }

      restartsRef.current = 0
      progressRef.current = { index: nextIndex, done: nextDone }
      setProgressState(progressRef.current)
      resetTyping(nextSentence)
      prefetchFrom(nextIndex)
    },
    [
      announceSkip,
      endSession,
      envelopeOf,
      lesson.id,
      lesson.sentences,
      prefetchFrom,
      resetTyping,
      sessionId,
    ],
  )

  /** `Tab` — gapni qayta boshlash: `playedWords` bo'shaydi, ovozlar tiklanadi (PLAN §4). */
  const restartSentence = useCallback((): void => {
    if (closedRef.current) return
    const sentence = lesson.sentences[progressRef.current.index]
    if (sentence === undefined) return
    restartsRef.current += 1
    resetTyping(sentence)
  }, [lesson.sentences, resetTyping])

  /**
   * ⭐ `Ctrl+Space` — kursor turgan so'zni QAYTA o'qitadi.
   *
   * Reducer'dan ATAYIN o'tmaydi: `playedWords`, `pendingWords`, `keystrokes`,
   * `errorCounts` va `wordStats` ga tegilmaydi. Qayta eshitish — quloq uchun,
   * statistika uchun emas. Usiz bitta so'zni qayta eshitishning yagona yo'li
   * `Tab` bilan butun gapni noldan boshlash edi.
   *
   * Epoch YOZILMASLIGI ham ataylab: bu ijro `audioEpochRef` ga YANGI yozuv
   * QO'YMAYDI. Aniqlik uchun: bu "callback'lar hech qachon o'tmaydi" degani
   * emas — tabiiy zanjir shu `tokenIndex` uchun yozuv qo'yib ulgurgan va ijro
   * hali boshlanmagan tor oynada replay'ning `onStarted`/`onFailed` i o'sha
   * yozuvni iste'mol qilishi mumkin. Zarari yo'q: dispatch qilinadigan hodisa
   * tabiiy zanjirnikidan farq qilmaydi (ayni so'z, ayni manager). Muhimi —
   * replay O'ZI yangi yozuv qo'ymagani uchun statistikaga yangi yo'l ochilmaydi.
   *
   * Yopilgan seansda umuman ishlamaydi (`closedRef`). Ovoz o'chirilganda ham
   * ishlamaydi: `Practice.tsx` dagi "So'zni qaytarish" tugmasi bunday holatda
   * `disabled` bo'ladi, klaviatura yorlig'i esa usiz baribir ishlab, ikki kirish
   * yo'li bir xil narsani boshqacha qilardi.
   */
  const replayWord = useCallback((): void => {
    if (closedRef.current || !audioEnabledRef.current) return
    unlockOnce()
    const snapshot = stateRef.current
    const tokenIndex = wordTokenAt(snapshot.tokens, snapshot.cursor)
    const token = tokenIndex === -1 ? undefined : snapshot.tokens[tokenIndex]
    if (token === undefined) return
    audioManager.playWord(token.text, tokenIndex)
  }, [unlockOnce])

  // -------------------------------------------------------------------------
  // Klaviatura
  // -------------------------------------------------------------------------

  const handleKeydown = useCallback(
    (event: KeyboardEvent): void => {
      if (closedRef.current) return
      if (isTextEntryTarget(event.target)) return

      // Birinchi harakat — audio shu yerda ochiladi (PLAN §5b: faqat `pointerdown`
      // ga bog'lansa, Enter bilan kirgan foydalanuvchining birinchi so'zi yo'qolardi).
      unlockOnce()

      if (shouldPreventDefault(event)) event.preventDefault()

      const action = mapKeydown(event)
      switch (action.type) {
        case 'event': {
          const before = stateRef.current
          applyEvent(action.event)
          const after = stateRef.current
          if (action.event.type === 'char') {
            if (after.cursor === before.cursor && after.keystrokes > before.keystrokes) {
              // Kursor SILJIMADI — bu `block` rejimining butun mohiyati.
              const wrong = action.event.char
              setBlocked((prev) => ({ wrong, nonce: (prev?.nonce ?? 0) + 1 }))
            } else if (after.cursor !== before.cursor) {
              setBlocked(null)
            }
          } else {
            setBlocked(null)
          }
          break
        }
        case 'next':
          // `Enter` faqat gap TUGAGANDA o'tkazadi (PLAN §4).
          if (stateRef.current.finishedAt !== null) finishSentence(false)
          break
        case 'restart':
          restartSentence()
          break
        case 'skip':
          finishSentence(true)
          break
        case 'replay':
          // Xato ko'rsatkichi TEGILMAYDI: qayta eshitish kursorni siljitmaydi,
          // ya'ni foydalanuvchi hali ham o'sha bloklangan belgida turibdi.
          replayWord()
          break
        case 'ignore':
          break
      }
    },
    [applyEvent, finishSentence, replayWord, restartSentence, unlockOnce],
  )

  /**
   * Tinglovchi BIR MARTA ro'yxatdan o'tadi va har renderda qayta bog'lanmaydi:
   * handler ref orqali chaqiriladi. Aks holda StrictMode ning ikki marta
   * ishlaydigan effekti va har bosishdagi qayta bog'lanish bir bosishni ikki
   * marta hisoblab yuborishi mumkin edi.
   */
  const handlerRef = useRef(handleKeydown)
  useEffect(() => {
    handlerRef.current = handleKeydown
  })

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => handlerRef.current(event)
    const onPointerDown = (): void => unlockOnce()
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [unlockOnce])

  // -------------------------------------------------------------------------
  // ⭐ Seansdan CHIQIB KETISH ham tugatish hisoblanadi
  // -------------------------------------------------------------------------

  /**
   * Ilgari statistika faqat ikki yo'l bilan yozilardi: gaplar tugagan yoki
   * taymer tugagan. Ya'ni 15 ta gap yozib "Mashqni to'xtatish" bosgan
   * foydalanuvchining `SessionRecord` i, so'z statistikasi va seriyasi JIMGINA
   * yo'qolardi.
   *
   * ⚠️ YO'QOTISH RADIUSI M3 dan keyin BUTUNLAY BOSHQA. Ilgari bu tinglovchi
   * BUTUN seansni sinxron `localStorage.setItem` bilan yozardi va u sahifa
   * o'lishidan oldin ulgurardi. Endi gaplar, so'zlar, kunlar va umrbod
   * hisoblagichlar HAR GAPDA yozilgan (§8.2), ya'ni bu yerda yozilishi kerak
   * bo'lgan yagona narsa — seansning yakuniy konverti. IndexedDB asinxron
   * bo'lgani uchun u ulgurmasligi MUMKIN, va o'shanda yo'qoladigan narsa
   * `endedAt` bilan og'irlangan yig'indi bo'ladi, mashq tarixi emas: seans
   * qatori oxirgi gap yozilgan paytdagi konvert bilan diskda qoladi.
   *
   * Bu yerda ATAYIN `recordAndClose` chaqiriladi, `endSession` emas: navigatsiya
   * bo'lsa Bosh sahifaga chiqmoqchi bo'lgan foydalanuvchi natijalar ekraniga
   * uloqtirilardi.
   *
   * Tinglovchi `beforeunload` EMAS, `pagehide`: mobil Safari sahifani ko'pincha
   * `beforeunload` siz yopadi, `pagehide` esa "orqaga/oldinga keshi" da ham
   * ishlaydi va bekor qilish dialogini talab qilmaydi.
   *
   * `recordAndClose` ref orqali chaqiriladi — effekt bir marta ulanadi va har
   * renderda `pagehide` tinglovchisi qayta bog'lanmaydi.
   */
  const recordAndCloseRef = useRef(recordAndClose)
  const navigateRef = useRef(navigate)
  useEffect(() => {
    recordAndCloseRef.current = recordAndClose
    navigateRef.current = navigate
  })

  useEffect(() => {
    const onPageHide = (): void => {
      recordAndCloseRef.current(Date.now())
    }

    /**
     * "Orqaga/oldinga keshi" (bfcache) dan qaytish.
     *
     * `pagehide` seansni yozib YOPADI (`closedRef`), lekin sahifani o'ldirmaydi:
     * foydalanuvchi tashqi havolaga chiqib "orqaga" bossa, brauzer o'sha DOM ni
     * xotiradan tiklaydi. Komponent hamon mashq ekranini ko'rsatadi-yu, aslida
     * o'lik: `onKeyDown` `closedRef` da darhol qaytadi, taymer to'xtagan, ekranda
     * esa buni bildiruvchi HECH QANDAY belgi yo'q — foydalanuvchi ilova buzilgan
     * deb o'ylaydi.
     *
     * Ma'lumot yo'qolmaydi (seans allaqachon yozilgan), shuning uchun eng to'g'ri
     * javob — jimgina o'lik ekranda ushlab turmasdan darslar ro'yxatiga chiqarish.
     * `event.persisted` SHART: u faqat bfcache tiklashida rost bo'ladi, oddiy
     * yuklashda esa yolg'on, ya'ni tirik seans bexosdan uzilmaydi.
     */
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted && closedRef.current) {
        navigateRef.current('/', { replace: true })
      }
    }

    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      // Normal tugash yo'lida `closedRef` allaqachon qo'yilgan — bu chaqiruv
      // o'sha yerdayoq qaytadi va seans ikki marta yozilmaydi. StrictMode ning
      // soxta unmount'i ham xavfsiz: yozuv bo'lmagani uchun hech narsa
      // yozilmaydi, seans yopilmaydi va navigatsiya ham yo'q.
      recordAndCloseRef.current(Date.now())
    }
  }, [])

  // -------------------------------------------------------------------------
  // Audio zanjiri (PLAN §4 dagi eng muhim bog'lanish)
  // -------------------------------------------------------------------------

  useEffect(() => {
    audioManager.setCallbacks({
      onStarted: (tokenIndex) => {
        if (!claimAudio(tokenIndex)) return
        applyEvent({ type: 'playbackStarted', tokenIndex })
      },
      onFailed: (tokenIndex) => {
        if (!claimAudio(tokenIndex)) return
        applyEvent({ type: 'playbackFailed', tokenIndex })
      },
    })
    return () => {
      audioManager.setCallbacks({ onStarted: () => {}, onFailed: () => {} })
      audioManager.stopAll()
    }
  }, [applyEvent, claimAudio])

  // Dars o'z ovozi va tezligi bilan sintez qilingan — fayl nomlari mos tushishi
  // uchun o'shalar tiklanadi (tozalangan juftlik, yuqoriga qarang).
  useEffect(() => {
    audioManager.setVoice(voice, rate)
  }, [voice, rate])

  // Server holati seans BOSHIDA bir marta emas, `SERVER_POLL_MS` da bir
  // tekshiriladi: 10 daqiqalik seansning o'rtasida server o'lsa ham (yoki
  // qaytsa ham) "zaxira: brauzer ovozi" belgisi haqiqatni ko'rsatib tursin.
  // Ovoz o'chiq bo'lsa umuman so'ralmaydi.
  useEffect(() => {
    audioEnabledRef.current = audioEnabled
    audioManager.setEnabled(audioEnabled)
    writeAudioEnabled(audioEnabled)
    if (!audioEnabled) return
    let alive = true
    const check = (): void => {
      void audioManager.checkServer().then((ok) => {
        if (alive) setServerOk(ok)
      })
    }
    check()
    const timer = setInterval(check, SERVER_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [audioEnabled])

  // Birinchi gap ham oldindan tayyorlanadi — aks holda seansning eng birinchi
  // so'zi tarmoqni kutib, kechikib eshitilardi.
  useEffect(() => {
    prefetchFrom(startIndex)
  }, [prefetchFrom, startIndex])

  // Uzilib qolgan import (PLAN §2c) darsning oxirini sintez qilmagan bo'lishi
  // mumkin, `audio-words/` keshi esa PASSIV: nima qolganini hech kim hisoblab
  // bermaydi. Yuqoridagi aylanma prefetch faqat joriy + 2 gapni tayyorlaydi,
  // ya'ni sovuq so'z gap o'rtasida tarmoqni kutdiradi yoki brauzer ovoziga
  // tushib qoladi. Shuning uchun qolgan HAMMA so'z fonda bir marta so'raladi:
  // serverda tayyor so'z kesh urishi bo'lgani uchun deyarli tekin, natija esa
  // kerak emas — fayl paydo bo'lishining o'zi yetarli (Import.tsx dagi "qolgan
  // gaplar" so'rovi bilan bir xil qaror).
  //
  // Effekt prefetch'DAN KEYIN e'lon qilingan, lekin TARMOQQA baribir birinchi shu
  // chiqadi: `prefetch` avval `serverAvailable()` ni kutadi (to'liq /api/health
  // borib-kelishi), bu effekt esa `requestBatch` ni to'g'ridan-to'g'ri chaqiradi
  // va `postChunk` birinchi `await` gacha `fetch` ni sinxron uzatadi. Ya'ni
  // ommaviy POST har safar bir RTT oldin yo'lga tushadi va shu paytda joriy
  // gapning so'zi hali so'ralmagan bo'ladi. Shuning uchun bu paket
  // `background: true` bilan belgilanadi: server uni sintez navbatida
  // interaktiv so'rovlardan keyinga qo'yadi va unga slotlarning bir qismini
  // qoldiradi, ya'ni oldinda ketayotgan ommaviy so'rov keyin kelgan bitta
  // so'zni kutdirib qo'ymaydi (`server/index.ts`).
  //
  // Ovoz o'chiq bo'lsa umuman so'ralmaydi — ref qo'yilmagani uchun foydalanuvchi
  // ovozni yoqqan zahoti bir marta ishlaydi.
  useEffect(() => {
    if (bulkSynthRef.current || !audioEnabled) return
    bulkSynthRef.current = true

    const words: string[] = []
    const seen = new Set<string>()
    for (let i = startIndex; i < lesson.sentences.length; i++) {
      const sentence = lesson.sentences[i]
      if (sentence === undefined) continue
      for (const word of wordsOf(sentence)) {
        if (seen.has(word)) continue
        seen.add(word)
        words.push(word)
      }
    }
    if (words.length === 0) return

    // Kutilmaydi va tekshirilmaydi: `requestBatch` tarmoq xatosini o'zi yutadi,
    // muvaffaqiyatsiz so'z esa ijro paytida zaxira zanjiriga tushadi.
    void requestBatch(words, voice, rate, { background: true }).catch(() => undefined)
  }, [audioEnabled, lesson.sentences, rate, startIndex, voice])

  // -------------------------------------------------------------------------
  // Taymer: 10 daqiqalik chegara (PLAN §7)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current
      // Seans hali boshlanmagan — taymer ham turadi, ekranda to'liq vaqt turaveradi.
      if (startedAt === null || closedRef.current) return
      const current = Date.now()
      setNow(current)
      if (sessionShouldEnd(progressRef.current.done, current - startedAt)) {
        // Vaqt tugadi: yarim yozilgan gap tashlanadi (PLAN §7).
        endSession(current)
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [endSession])

  // Tashlash xabarining taymeri komponent bilan birga o'chadi — aks holda u
  // uzilgan komponentda `setState` chaqirardi.
  useEffect(() => {
    return () => {
      if (skipTimerRef.current !== null) clearTimeout(skipTimerRef.current)
    }
  }, [])

  const toggleAudio = useCallback((): void => {
    setAudioEnabled((prev) => !prev)
  }, [])

  // -------------------------------------------------------------------------
  // Ekranga chiqadigan qiymatlar
  // -------------------------------------------------------------------------

  const sessionTotal = Math.min(SESSION_MAX_SENTENCES, Math.max(1, lesson.sentences.length - startIndex))

  // `recordsRef` faqat `progress` o'zgarganda to'ldiriladi, shuning uchun
  // shu ikki bog'liqlik yig'indini doim yangi ushlab turadi.
  const live = useMemo(() => {
    let activeMs = 0
    let keystrokes = 0
    let correctKeystrokes = 0
    let netWeighted = 0
    for (const record of recordsRef.current) {
      if (record.skipped) continue
      activeMs += record.activeMs
      keystrokes += record.keystrokes
      correctKeystrokes += record.correctKeystrokes
      netWeighted += record.netWpm * record.activeMs
    }
    const current = computeMetrics(state)
    activeMs += current.activeMs
    keystrokes += current.keystrokes
    correctKeystrokes += current.correctKeystrokes
    netWeighted += current.netWpm * current.activeMs

    return {
      netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
      accuracy: keystrokes > 0 ? Math.min(1, correctKeystrokes / keystrokes) : 1,
    }
  }, [state, progress])

  const elapsedMs = startedAtRef.current === null ? 0 : Math.max(0, now - startedAtRef.current)
  const remainingMs = Math.max(0, SESSION_MAX_MS - elapsedMs)

  return {
    state,
    blocked,
    awaitingNext: state.finishedAt !== null,
    sentenceIndex: progress.index,
    sentenceNo: Math.min(progress.done + 1, sessionTotal),
    sessionTotal,
    netWpm: live.netWpm,
    accuracy: live.accuracy,
    remainingMs,
    sentenceProgress: Math.min(1, progress.done / sessionTotal),
    timeProgress: Math.min(1, elapsedMs / SESSION_MAX_MS),
    skipNotice,
    audioEnabled,
    toggleAudio,
    replayWord,
    serverOk,
  }
}
