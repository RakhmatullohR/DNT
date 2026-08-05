// PLAN §9 dagi `typing` ro'yxatining har bir punkti — alohida test.

import { describe, expect, it } from 'vitest'
import { createState, reduce } from '../../src/core/typing.ts'
import { mapKeydown } from '../../src/core/keyboard.ts'
import { IDLE_PAUSE_MS } from '../../src/core/types.ts'
import type { Effect, KeydownLike, TypingState } from '../../src/core/types.ts'

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

type Run = { state: TypingState; effects: Effect[] }

/** Har chaqiruvda `step` ms oldinga siljiydigan boshqariladigan soat. */
function makeClock(start = 1_000, step = 50): () => number {
  let t = start - step
  return () => {
    t += step
    return t
  }
}

/**
 * Satrni belgima-belgi `reduce` dan o'tkazadi va yo'l davomida to'plangan
 * BARCHA effektlarni qaytaradi. Testlarning asosiy asbobi.
 */
function typeChars(state: TypingState, text: string, clock = makeClock()): Run {
  let s = state
  const effects: Effect[] = []
  for (const char of text) {
    const r = reduce(s, { type: 'char', char }, clock())
    s = r.state
    effects.push(...r.effects)
  }
  return { state: s, effects }
}

/** Butun gapni boshidan oxirigacha xatosiz yozadi. */
function typeAll(target: string): Run {
  return typeChars(createState(target), target)
}

/** `playWord` effektlaridagi token indekslari — kelish tartibida. */
function playWordIndexes(effects: Effect[]): number[] {
  return effects.flatMap((e) => (e.type === 'playWord' ? [e.tokenIndex] : []))
}

function hasFinished(effects: Effect[]): boolean {
  return effects.some((e) => e.type === 'finished')
}

/** Testlar uchun `KeydownLike` yasagich: modifikatorlar sukut bo'yicha o'chiq. */
function keydown(key: string, mods: Partial<KeydownLike> = {}): KeydownLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods }
}

/** Klaviatura adapteri + reducer zanjiri: `ignore` bo'lsa holat o'zgarmaydi. */
function applyKeydown(state: TypingState, e: KeydownLike, now: number): Run {
  const action = mapKeydown(e)
  if (action.type !== 'event') return { state, effects: [] }
  return reduce(state, action.event, now)
}

/** Holatning taqqoslash uchun yaroqli suratini oladi (mutatsiya tekshiruvi). */
function snapshot(s: TypingState): string {
  return JSON.stringify({
    cursor: s.cursor,
    typed: s.typed,
    errorCounts: [...s.errorCounts],
    charErrors: [...s.charErrors],
    pendingWords: [...s.pendingWords],
    playedWords: [...s.playedWords],
    keystrokes: s.keystrokes,
    correctKeystrokes: s.correctKeystrokes,
    startedAt: s.startedAt,
    lastKeyAt: s.lastKeyAt,
    activeMs: s.activeMs,
    finishedAt: s.finishedAt,
  })
}

// ---------------------------------------------------------------------------

describe('createState', () => {
  it('toza holat qaytaradi va tokenlarni hisoblaydi', () => {
    const s = createState('the cat')
    expect(s.target).toBe('the cat')
    expect(s.cursor).toBe(0)
    expect(s.typed).toEqual([])
    expect(s.keystrokes).toBe(0)
    expect(s.correctKeystrokes).toBe(0)
    expect(s.startedAt).toBeNull()
    expect(s.lastKeyAt).toBeNull()
    expect(s.activeMs).toBe(0)
    expect(s.finishedAt).toBeNull()
    expect(s.errorCounts.size).toBe(0)
    expect(s.charErrors.size).toBe(0)
    expect(s.tokens.map((t) => t.text)).toEqual(['the', ' ', 'cat'])
  })

  it('yangi holatda playedWords BO\'SH — `Tab` bilan qayta boshlash shu orqali ishlaydi', () => {
    const played = typeAll('the cat')
    const started = played.effects.flatMap((e) => (e.type === 'playWord' ? [e.tokenIndex] : []))
    let s = played.state
    for (const i of started) {
      s = reduce(s, { type: 'playbackStarted', tokenIndex: i }, 9_000).state
    }
    expect(s.playedWords.size).toBeGreaterThan(0)

    // `Tab` -> yangi holat.
    const fresh = createState('the cat')
    expect(fresh.playedWords.size).toBe(0)
    expect(fresh.pendingWords.size).toBe(0)

    // Va ovozlar haqiqatan tiklanadi.
    expect(playWordIndexes(typeChars(fresh, 'the cat').effects)).toEqual([0, 2])
  })
})

describe('block rejimi — qat\'iy bosh harf', () => {
  it('`t` target `T` ga qarshi: XATO, kursor turadi', () => {
    const s0 = createState('The cat')
    const { state, effects } = typeChars(s0, 't')

    expect(state.cursor).toBe(0)
    expect(state.typed).toEqual([])
    expect(state.keystrokes).toBe(1)
    expect(state.correctKeystrokes).toBe(0)
    expect(state.charErrors.get(0)).toBe(1)
    expect(state.errorCounts.get(0)).toBe(1) // 0-token — `The` so'zi
    expect(effects).toEqual([]) // ovoz YO'Q
  })

  it('`T` to\'g\'ri: kursor siljiydi va Shift talabi bajarilgan hisoblanadi', () => {
    const { state } = typeChars(createState('The cat'), 'T')
    expect(state.cursor).toBe(1)
    expect(state.typed).toEqual(['T'])
    expect(state.correctKeystrokes).toBe(1)
    expect(state.charErrors.size).toBe(0)
  })

  it('xato bir necha marta takrorlansa hisob o\'sib boradi', () => {
    const { state } = typeChars(createState('The cat'), 'ttt')
    expect(state.cursor).toBe(0)
    expect(state.keystrokes).toBe(3)
    expect(state.charErrors.get(0)).toBe(3)
    expect(state.errorCounts.get(0)).toBe(3)
  })

  it('xato so\'z o\'rtasida joriy tokenga yoziladi', () => {
    const { state } = typeChars(createState('the cat'), 'thX')
    expect(state.cursor).toBe(2)
    expect(state.charErrors.get(2)).toBe(1)
    expect(state.errorCounts.get(0)).toBe(1)
  })

  it('`typed` doim `target.slice(0, cursor)` ga teng', () => {
    const { state } = typeChars(createState('the cat'), 'thq e c')
    expect(state.typed.join('')).toBe(state.target.slice(0, state.cursor))
  })
})

describe('playWord — har so\'z boshida aynan bitta', () => {
  it('har so\'z boshida bitta va faqat bitta `playWord` chiqadi', () => {
    const { effects } = typeAll('the cat')
    expect(playWordIndexes(effects)).toEqual([0, 2])
  })

  it('so\'z ichidagi keyingi harflar ovoz chiqarmaydi', () => {
    const s0 = createState('the cat')
    const first = typeChars(s0, 't')
    expect(playWordIndexes(first.effects)).toEqual([0])

    const rest = typeChars(first.state, 'he')
    expect(playWordIndexes(rest.effects)).toEqual([])
  })

  it('probel va tinish belgilari (`gap` tokenlari) ovoz chiqarmaydi', () => {
    const { effects } = typeAll('the cat.')
    expect(playWordIndexes(effects)).toEqual([0, 2])
  })

  it('noto\'g\'ri birinchi harf ovoz chiqarmaydi (kursor siljimaydi)', () => {
    const { state, effects } = typeChars(createState('the cat'), 'x')
    expect(effects).toEqual([])
    expect(state.pendingWords.size).toBe(0)
    expect(state.cursor).toBe(0)
  })

  it('`the cat and the dog` -> `the` ikki marta, HAR BIRI o\'z tokeni bilan', () => {
    const target = 'the cat and the dog'
    const { state, effects } = typeAll(target)

    // Tokenlar: 0=the 1=' ' 2=cat 3=' ' 4=and 5=' ' 6=the 7=' ' 8=dog
    expect(state.tokens[0]?.text).toBe('the')
    expect(state.tokens[6]?.text).toBe('the')

    const indexes = playWordIndexes(effects)
    expect(indexes).toEqual([0, 2, 4, 6, 8])

    // Ikkala `the` uchun ikkita ALOHIDA playWord chiqdi.
    const theIndexes = indexes.filter((i) => state.tokens[i]?.text === 'the')
    expect(theIndexes).toEqual([0, 6])
  })

  it('`"The cat," he said.` -> birinchi word token 1-INDEKSDA, playWord baribir chiqadi', () => {
    const target = '"The cat," he said.'
    const s0 = createState(target)

    // Qoida `token.start` ga tayanadi, `cursor === 0` ga emas.
    expect(s0.tokens[0]?.kind).toBe('gap')
    expect(s0.tokens[0]?.text).toBe('"')
    expect(s0.tokens[1]?.kind).toBe('word')
    expect(s0.tokens[1]?.text).toBe('The')
    expect(s0.tokens[1]?.start).toBe(1)

    // Faqat qo'shtirnoq: hali ovoz yo'q.
    const quote = typeChars(s0, '"')
    expect(playWordIndexes(quote.effects)).toEqual([])

    // `T` bosilganda 1-token o'qiladi.
    const first = typeChars(quote.state, 'T')
    expect(playWordIndexes(first.effects)).toEqual([1])

    const full = typeAll(target)
    expect(playWordIndexes(full.effects)).toEqual([1, 3, 5, 7])
  })

  it('bir harfli so\'z (`I`, `a`) ham odatdagidek ovoz chiqaradi', () => {
    const { effects, state } = typeAll('I am a cat')
    expect(playWordIndexes(effects)).toEqual([0, 2, 4, 6])
    expect(state.tokens[4]?.text).toBe('a')
  })

  it('pendingWords ga tushgan token qayta so\'ralmaydi', () => {
    const first = typeChars(createState('the cat'), 't')
    expect(first.state.pendingWords.has(0)).toBe(true)
    expect(first.state.playedWords.has(0)).toBe(false)

    // Backspace + qayta `t`: token hali pending, ovoz takrorlanmaydi.
    const back = reduce(first.state, { type: 'backspace' }, 5_000)
    const again = typeChars(back.state, 't')
    expect(playWordIndexes(again.effects)).toEqual([])
  })
})

describe('backspace', () => {
  it('kursorni ortga qaytaradi va oxirgi belgini oladi', () => {
    const typed = typeChars(createState('the cat'), 'the')
    const back = reduce(typed.state, { type: 'backspace' }, 5_000)

    expect(back.state.cursor).toBe(2)
    expect(back.state.typed).toEqual(['t', 'h'])
    expect(back.effects).toEqual([])
  })

  it('keystrokes ni OSHIRMAYDI', () => {
    const typed = typeChars(createState('the cat'), 'the')
    expect(typed.state.keystrokes).toBe(3)

    const back = reduce(typed.state, { type: 'backspace' }, 5_000)
    expect(back.state.keystrokes).toBe(3)
    expect(back.state.correctKeystrokes).toBe(3)
  })

  it('errorCounts / charErrors ni TOZALAMAYDI (PLAN §4)', () => {
    const wrong = typeChars(createState('The cat'), 't') // xato
    const right = typeChars(wrong.state, 'T')
    const back = reduce(right.state, { type: 'backspace' }, 5_000)

    expect(back.state.cursor).toBe(0)
    expect(back.state.charErrors.get(0)).toBe(1)
    expect(back.state.errorCounts.get(0)).toBe(1)
  })

  it('backspace + qayta yozish -> `playWord` YO\'Q (ovoz takrorlanmaydi)', () => {
    const first = typeChars(createState('the cat'), 't')
    expect(playWordIndexes(first.effects)).toEqual([0])

    // Ovoz haqiqatan chiqdi.
    const started = reduce(first.state, { type: 'playbackStarted', tokenIndex: 0 }, 2_000)
    expect(started.state.playedWords.has(0)).toBe(true)
    expect(started.state.pendingWords.has(0)).toBe(false)

    const back = reduce(started.state, { type: 'backspace' }, 3_000)
    expect(back.state.playedWords.has(0)).toBe(true) // backspace TEGMAYDI

    const retyped = typeChars(back.state, 'the')
    expect(playWordIndexes(retyped.effects)).toEqual([])
  })

  it('cursor 0 da backspace holatni buzmaydi', () => {
    const s0 = createState('the cat')
    const back = reduce(s0, { type: 'backspace' }, 1_000)

    expect(back.state.cursor).toBe(0)
    expect(back.state.typed).toEqual([])
    expect(back.state.keystrokes).toBe(0)
    expect(back.effects).toEqual([])
  })
})

describe('⭐ playbackStarted / playbackFailed', () => {
  it('playbackStarted: pendingWords dan playedWords ga o\'tadi', () => {
    const first = typeChars(createState('the cat'), 't')
    const started = reduce(first.state, { type: 'playbackStarted', tokenIndex: 0 }, 2_000)

    expect(started.state.pendingWords.has(0)).toBe(false)
    expect(started.state.playedWords.has(0)).toBe(true)
    expect(started.effects).toEqual([])
  })

  it('playbackFailed: pendingWords dan chiqadi, playedWords ga TUSHMAYDI', () => {
    const first = typeChars(createState('the cat'), 't')
    const failed = reduce(first.state, { type: 'playbackFailed', tokenIndex: 0 }, 2_000)

    expect(failed.state.pendingWords.has(0)).toBe(false)
    expect(failed.state.playedWords.has(0)).toBe(false)
    expect(failed.effects).toEqual([])
  })

  it('playbackFailed dan keyin o\'sha token QAYTA o\'qilishi mumkin', () => {
    const first = typeChars(createState('the cat'), 't')
    expect(playWordIndexes(first.effects)).toEqual([0])

    const failed = reduce(first.state, { type: 'playbackFailed', tokenIndex: 0 }, 2_000)
    const back = reduce(failed.state, { type: 'backspace' }, 3_000)
    const again = typeChars(back.state, 't')

    // ⭐ Jimlik "eshitilgan" hisoblanmaydi — so'z yana o'qiladi.
    expect(playWordIndexes(again.effects)).toEqual([0])
  })

  it('playbackFailed dan keyin `Tab` (yangi holat) ham ovozni tiklaydi', () => {
    const first = typeChars(createState('the cat'), 't')
    const failed = reduce(first.state, { type: 'playbackFailed', tokenIndex: 0 }, 2_000)
    expect(failed.state.playedWords.size).toBe(0)

    const fresh = createState('the cat')
    expect(playWordIndexes(typeChars(fresh, 't').effects)).toEqual([0])
  })

  it('kutilmagan playbackFailed holatni o\'zgartirmaydi', () => {
    const s0 = createState('the cat')
    const r = reduce(s0, { type: 'playbackFailed', tokenIndex: 2 }, 1_000)
    expect(r.state).toBe(s0)
  })

  it('gap tugagandan keyin ham ovoz xabarlari qabul qilinadi', () => {
    const full = typeAll('the cat')
    expect(full.state.finishedAt).not.toBeNull()
    expect(full.state.pendingWords.has(2)).toBe(true)

    const started = reduce(full.state, { type: 'playbackStarted', tokenIndex: 2 }, 99_000)
    expect(started.state.playedWords.has(2)).toBe(true)
  })
})

describe('finished', () => {
  it('oxirgi belgidan keyin `finished` effekti chiqadi', () => {
    const { state, effects } = typeAll('the cat')

    expect(hasFinished(effects)).toBe(true)
    expect(state.cursor).toBe(state.target.length)
    expect(state.finishedAt).not.toBeNull()
  })

  it('`finished` faqat oxirgi belgida va faqat bir marta chiqadi', () => {
    const target = 'the cat'
    const clock = makeClock(1_000, 10)
    let s = createState(target)
    const seen: number[] = []

    for (let i = 0; i < target.length; i += 1) {
      const char = target[i] ?? ''
      const r = reduce(s, { type: 'char', char }, clock())
      s = r.state
      if (hasFinished(r.effects)) seen.push(i)
    }

    expect(seen).toEqual([target.length - 1])
  })

  it('finishedAt aynan `now` ga teng', () => {
    const clock = makeClock(1_000, 10)
    const { state } = typeChars(createState('the cat'), 'the cat', clock)
    expect(state.finishedAt).toBe(1_000 + 10 * ('the cat'.length - 1))
  })

  it('tugagandan keyingi bosishlar holatni O\'ZGARTIRMAYDI', () => {
    const full = typeAll('the cat')

    const afterChar = reduce(full.state, { type: 'char', char: 'x' }, 50_000)
    expect(afterChar.state).toBe(full.state)
    expect(afterChar.effects).toEqual([])

    const afterBackspace = reduce(full.state, { type: 'backspace' }, 50_000)
    expect(afterBackspace.state).toBe(full.state)
    expect(afterBackspace.effects).toEqual([])
  })
})

describe('vaqt hisobi', () => {
  it('startedAt birinchi bosishda o\'rnatiladi va keyin o\'zgarmaydi', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    expect(a.state.startedAt).toBe(1_000)
    expect(a.state.lastKeyAt).toBe(1_000)
    expect(a.state.activeMs).toBe(0)

    const b = reduce(a.state, { type: 'char', char: 'b' }, 1_300)
    expect(b.state.startedAt).toBe(1_000)
    expect(b.state.lastKeyAt).toBe(1_300)
  })

  it('qisqa tanaffus faol vaqtga QO\'SHILADI', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const b = reduce(a.state, { type: 'char', char: 'b' }, 1_300)
    expect(b.state.activeMs).toBe(300)
  })

  it('5 s dan uzun tanaffus faol vaqtga QO\'SHILMAYDI', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const b = reduce(a.state, { type: 'char', char: 'b' }, 1_200)
    expect(b.state.activeMs).toBe(200)

    const c = reduce(b.state, { type: 'char', char: 'c' }, 1_200 + IDLE_PAUSE_MS + 1)
    expect(c.state.activeMs).toBe(200) // oraliq tashlab yuborildi
    expect(c.state.lastKeyAt).toBe(1_200 + IDLE_PAUSE_MS + 1)
  })

  it('aynan IDLE_PAUSE_MS ga teng tanaffus hali ham qo\'shiladi', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const b = reduce(a.state, { type: 'char', char: 'b' }, 1_000 + IDLE_PAUSE_MS)
    expect(b.state.activeMs).toBe(IDLE_PAUSE_MS)
  })

  it('xato bosish ham taymerni yuritadi', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const wrong = reduce(a.state, { type: 'char', char: 'z' }, 1_400)
    expect(wrong.state.activeMs).toBe(400)
    expect(wrong.state.lastKeyAt).toBe(1_400)
  })

  it('backspace ham taymerni yuritadi', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const back = reduce(a.state, { type: 'backspace' }, 1_500)
    expect(back.state.activeMs).toBe(500)
    expect(back.state.lastKeyAt).toBe(1_500)
  })

  it('ovoz xabarlari taymerga TEGMAYDI', () => {
    const a = reduce(createState('abc'), { type: 'char', char: 'a' }, 1_000)
    const started = reduce(a.state, { type: 'playbackStarted', tokenIndex: 0 }, 90_000)
    expect(started.state.lastKeyAt).toBe(1_000)
    expect(started.state.activeMs).toBe(0)
  })
})

describe('klaviatura bilan integratsiya', () => {
  it('`Ctrl+A`, `ArrowLeft`, `F5` -> `ignore`, holat O\'ZGARMAYDI', () => {
    const s0 = typeChars(createState('a cat'), 'a').state
    const before = snapshot(s0)

    const ignored: KeydownLike[] = [
      keydown('a', { ctrlKey: true }),
      keydown('r', { ctrlKey: true }),
      keydown('v', { metaKey: true }),
      keydown('ArrowLeft'),
      keydown('ArrowRight'),
      keydown('F5'),
      keydown('Shift'),
      keydown('CapsLock'),
    ]

    let s = s0
    for (const e of ignored) {
      expect(mapKeydown(e).type).toBe('ignore')
      const r = applyKeydown(s, e, 42_000)
      expect(r.effects).toEqual([])
      s = r.state
    }

    expect(s).toBe(s0)
    expect(snapshot(s)).toBe(before)
  })

  it('oddiy harf klaviatura orqali reducerga yetib boradi', () => {
    const s0 = createState('the cat')
    const r = applyKeydown(s0, keydown('t'), 1_000)

    expect(r.state.cursor).toBe(1)
    expect(playWordIndexes(r.effects)).toEqual([0])
  })

  it('`Backspace` klaviatura orqali kursorni qaytaradi', () => {
    const typed = typeChars(createState('the cat'), 'th')
    const r = applyKeydown(typed.state, keydown('Backspace'), 2_000)
    expect(r.state.cursor).toBe(1)
  })

  it('`Enter` / `Tab` / `Escape` reducerga TUSHMAYDI (ular ekran darajasida)', () => {
    const s0 = typeChars(createState('the cat'), 'th').state
    for (const key of ['Enter', 'Tab', 'Escape']) {
      expect(applyKeydown(s0, keydown(key), 3_000).state).toBe(s0)
    }
  })
})

describe('reducer POKLIGI', () => {
  it('eski holatni mutatsiya qilmaydi', () => {
    const s0 = createState('The cat')
    const before = snapshot(s0)

    typeChars(s0, 'tThe cat')
    reduce(s0, { type: 'backspace' }, 5_000)
    reduce(s0, { type: 'playbackStarted', tokenIndex: 0 }, 5_000)

    expect(snapshot(s0)).toBe(before)
  })

  it('har o\'zgarishda yangi Map/Set qaytariladi', () => {
    const s0 = createState('The cat')

    const wrong = reduce(s0, { type: 'char', char: 't' }, 1_000)
    expect(wrong.state.errorCounts).not.toBe(s0.errorCounts)
    expect(wrong.state.charErrors).not.toBe(s0.charErrors)

    const right = reduce(s0, { type: 'char', char: 'T' }, 1_000)
    expect(right.state.pendingWords).not.toBe(s0.pendingWords)

    const started = reduce(right.state, { type: 'playbackStarted', tokenIndex: 0 }, 2_000)
    expect(started.state.pendingWords).not.toBe(right.state.pendingWords)
    expect(started.state.playedWords).not.toBe(right.state.playedWords)
  })
})
