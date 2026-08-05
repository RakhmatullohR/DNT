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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { sanitizeRate, sanitizeVoice } from '../../shared/filename.ts'
import { audioManager, unlockAudio } from '../audio/AudioManager.ts'
import { requestBatch } from '../audio/ttsClient.ts'
import { mapKeydown, shouldPreventDefault } from '../core/keyboard.ts'
import { computeMetrics } from '../core/metrics.ts'
import {
  clampIndex,
  SESSION_MAX_MS,
  SESSION_MAX_SENTENCES,
  sessionShouldEnd,
} from '../core/session.ts'
import { tokenize } from '../core/tokenize.ts'
import { createState, reduce } from '../core/typing.ts'
import type { Effect, TypingEvent, TypingState } from '../core/types.ts'
import type { Lesson } from '../store/lessons.ts'
import { setProgress } from '../store/lessons.ts'
import type { SentenceRecord, SessionRecord, WordStat } from '../store/stats.ts'
import { recordSession } from '../store/stats.ts'

/** Ovoz yoqiq/o'chiq holati shu kalitda eslab qolinadi (PLAN §8 dagi M2/M3 gate). */
const AUDIO_KEY = 'dnt.audio.v1'

/** Taymer va seans chegarasi shu oraliqda tekshiriladi. */
const TICK_MS = 500

/** Oldindan tayyorlanadigan KEYINGI gaplar soni (PLAN §7 dagi "keyingi 1-2 gap"). */
const PREFETCH_AHEAD = 2

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
  audioEnabled: boolean
  toggleAudio: () => void
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

  // Boshlanish nuqtasi BIR MARTA olinadi: `setProgress` omborni yangilab boradi,
  // lekin joriy seans o'z hisobini o'zi yuritadi.
  const [startIndex] = useState(() => clampIndex(lesson.progress, lesson.sentences.length))

  const [state, setState] = useState<TypingState>(() =>
    createState(lesson.sentences[startIndex] ?? ''),
  )
  const stateRef = useRef<TypingState>(state)

  /** Dars ichidagi indeks + seansda ortda qolgan gaplar soni — doim birga o'zgaradi. */
  const [progress, setProgressState] = useState({ index: startIndex, done: 0 })
  const progressRef = useRef(progress)

  const [blocked, setBlocked] = useState<BlockedKey | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(readAudioEnabled)
  const [serverOk, setServerOk] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  /** Seans boshlangan payt = eng birinchi bosish (PLAN §6: taymer birinchi bosishda). */
  const startedAtRef = useRef<number | null>(null)
  /** Joriy gapdagi `Tab` bosishlari soni. */
  const restartsRef = useRef(0)
  const recordsRef = useRef<SentenceRecord[]>([])
  const wordStatsRef = useRef<Map<string, WordStat>>(new Map())
  /** Seans yozilib bo'ldi — ikkinchi marta yozilmasligi va bosishlar o'tmasligi uchun. */
  const closedRef = useRef(false)
  const unlockedRef = useRef(false)

  /** Gap/urinish nomeri: eskirgan audio callback'lari shu bilan filtrlanadi. */
  const epochRef = useRef(0)
  /** tokenIndex -> `playWord` chaqirilgan paytdagi epoch. */
  const audioEpochRef = useRef<Map<number, number>>(new Map())
  /** Darsning qolgan qismi fonda BIR MARTA so'raladi (StrictMode effektni ikki marta yuritadi). */
  const bulkSynthRef = useRef(false)

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

  const endSession = useCallback(
    (at: number): void => {
      if (closedRef.current) return
      closedRef.current = true
      epochRef.current += 1
      audioManager.stopAll()

      const records = recordsRef.current
      if (records.length === 0) {
        // Bitta ham gap yozilmagan seans statistikani faqat ifloslantirardi.
        navigate('/', { replace: true })
        return
      }

      let activeMs = 0
      let keystrokes = 0
      let correctKeystrokes = 0
      let netWeighted = 0
      let rawWeighted = 0
      for (const record of records) {
        if (record.skipped) continue
        activeMs += record.activeMs
        keystrokes += record.keystrokes
        correctKeystrokes += record.correctKeystrokes
        netWeighted += record.netWpm * record.activeMs
        rawWeighted += record.rawWpm * record.activeMs
      }

      const id = newSessionId()
      const session: SessionRecord = {
        id,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        startedAt: startedAtRef.current ?? at,
        endedAt: at,
        sentences: records,
        activeMs,
        keystrokes,
        correctKeystrokes,
        netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
        rawWpm: activeMs > 0 ? rawWeighted / activeMs : 0,
        accuracy: keystrokes > 0 ? correctKeystrokes / keystrokes : 1,
      }

      const wordDelta: Record<string, WordStat> = {}
      for (const [word, stat] of wordStatsRef.current) wordDelta[word] = stat

      recordSession(session, wordDelta)
      // `replace`: tugagan seansga "orqaga" tugmasi bilan qaytib bo'lmaydi.
      navigate(`/results/${id}`, { replace: true })
    },
    [lesson.id, lesson.title, navigate],
  )

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

      recordsRef.current.push({
        lessonId: lesson.id,
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
      })

      if (!skipped) {
        // So'z statistikasi (PLAN §6): har so'z bir "ta'sirlanish", xatolar esa
        // reducer yig'gan `errorCounts` dan olinadi.
        for (let i = 0; i < snapshot.tokens.length; i++) {
          const token = snapshot.tokens[i]
          if (token === undefined || token.kind !== 'word') continue
          const key = token.text.toLowerCase()
          const current = wordStatsRef.current.get(key) ?? { exposures: 0, errors: 0 }
          wordStatsRef.current.set(key, {
            exposures: current.exposures + 1,
            errors: current.errors + (snapshot.errorCounts.get(i) ?? 0),
          })
        }
      }

      const nextIndex = index + 1
      const nextDone = done + 1
      // Progress GAP DARAJASIDA saqlanadi (PLAN §7): yarim yozilgan gap tashlanadi,
      // chunki kursorni gap o'rtasidan tiklab bo'lmaydi — o'tib ketilgan so'z
      // boshi endi hech qachon ovoz bermaydi.
      setProgress(lesson.id, nextIndex)

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
    [endSession, lesson.id, lesson.sentences, prefetchFrom, resetTyping],
  )

  /** `Tab` — gapni qayta boshlash: `playedWords` bo'shaydi, ovozlar tiklanadi (PLAN §4). */
  const restartSentence = useCallback((): void => {
    if (closedRef.current) return
    const sentence = lesson.sentences[progressRef.current.index]
    if (sentence === undefined) return
    restartsRef.current += 1
    resetTyping(sentence)
  }, [lesson.sentences, resetTyping])

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
        case 'ignore':
          break
      }
    },
    [applyEvent, finishSentence, restartSentence, unlockOnce],
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

  useEffect(() => {
    audioManager.setEnabled(audioEnabled)
    writeAudioEnabled(audioEnabled)
    if (!audioEnabled) return
    let alive = true
    void audioManager.checkServer().then((ok) => {
      if (alive) setServerOk(ok)
    })
    return () => {
      alive = false
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
    audioEnabled,
    toggleAudio,
    serverOk,
  }
}
