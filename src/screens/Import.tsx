// Import ekrani (PLAN §2) — paste -> normalizatsiya -> gapga bo'lish -> sintez.
// Marshrut: '/import'.
//
// Ekranning uchta o'zgarmas qoidasi bor:
//   1. Foydalanuvchi ko'rmasdan hech narsa o'zgarmaydi (PLAN §2a) — shuning uchun
//      `NormalizeDiff` matn saqlanishidan OLDIN ko'rsatiladi.
//   2. Dars TTS serverisiz ham saqlanadi (PLAN §1) — sintez qo'shimcha, shart emas.
//   3. Mashq dastlabki 3 gap tayyor bo'lishi bilan ochiladi (PLAN §2c), qolgani fonda.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DEFAULT_RATE, DEFAULT_VOICE, RATES, VOICES } from '../../shared/filename.ts'
import { requestBatch, serverAvailable } from '../audio/ttsClient.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { NormalizeDiff } from '../components/NormalizeDiff.tsx'
import { parseEmphasis } from '../core/emphasis.ts'
import { normalize } from '../core/normalize.ts'
import type { NormalizeResult } from '../core/normalize.ts'
import { splitSentences } from '../core/splitSentences.ts'
import { tokenize } from '../core/tokenize.ts'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'
import { listLessons, newLessonId, saveLesson } from '../store/lessons.ts'
import type { Lesson } from '../store/lessons.ts'

const PANEL = 'rounded-panel border border-white/[0.07] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
const FIELD = [
  'w-full rounded-control border border-white/[0.07] bg-[#0b1219] px-3 py-2.5',
  'font-mono text-[13px] text-[#e6edf3] placeholder:text-[#7d8b9c]',
  'transition-colors duration-150 ease-out hover:border-white/[0.12]',
  'focus:border-[#5ee6c1] focus:outline-none',
  'focus-visible:ring-2 focus-visible:ring-[#5ee6c1]',
  // Button/Layout dagi kabi halqa bilan chegara orasida bo'shliq: aks holda
  // halqa chegaraga yopishib, ikkovi bitta qalin chiziqqa aylanadi (izchillik
  // auditi). Offset rangi shu FIELD chizilgan panelning foni — Import dagi
  // barcha FIELD "#0e141c" panel ustida turadi (Home dagi sub-panel emas).
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e141c]',
].join(' ')

/** PLAN §2c: paste hajmi shu songa cheklanadi. */
const MAX_WORDS = 5_000

/** PLAN §2c: bundan uzun gap belgilanadi va qo'lda bo'lish taklif qilinadi. */
const LONG_SENTENCE_WORDS = 40

/** PLAN §2c: mashq shuncha gap sintez qilingach ochiladi, qolgani fonda davom etadi. */
const HEAD_SENTENCES = 3

/**
 * Katta matnni HAR BOSISHDA normallashtirish behuda: 5000 so'zlik paste uchun
 * `normalize` + `splitSentences` butun matn bo'ylab belgi-belgi yuradi. Shuning
 * uchun tahlil yozuv to'xtagandan keyin bir marta ishga tushadi.
 */
const ANALYZE_DEBOUNCE_MS = 250

/**
 * Sintez so'rovi shuncha so'zdan iborat bo'laklarga bo'linadi.
 * `requestBatch` bitta chaqiruvda 200 tagacha so'zni oladi, lekin u faqat TUGAGANDA
 * javob beradi — bo'laklarga bo'lish progress ko'rsatkichini haqiqiy qiladi.
 */
const SYNTH_CHUNK = 16

const TITLE_MAX = 48

const WARN_NO_SERVER =
  "Dars saqlandi, lekin TTS server javob bermadi — so'z audiolari oldindan tayyorlanmadi. " +
  "Mashq baribir ishlaydi: so'zlar brauzerning o'z ovozi bilan o'qiladi."

const WARN_SYNTH_FAILED =
  "Dars saqlandi, lekin dastlabki gaplardagi birorta so'z ham sintez qilinmadi. " +
  'Mashq brauzer ovozi (zaxira) bilan ishlaydi.'

const WARN_UNEXPECTED =
  'Dars saqlandi, lekin sintezni boshlashda kutilmagan xato yuz berdi. ' +
  'Mashq brauzer ovozi (zaxira) bilan ishlaydi.'

// ---------------------------------------------------------------------------
// Formatlash va kichik hisoblar (ekran ichida lokal — `Results.tsx` shu tartibni
// ataylab o'rnatgan: bitta ekranga tegishli yordamchi umumiy faylga chiqarilmaydi)
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

/** Sarlavha kiritilmasa matnning boshidan taklif qilinadi. */
function suggestTitle(text: string): string {
  const clean = text.trim()
  if (clean === '') return ''
  if (clean.length <= TITLE_MAX) return clean
  const cut = clean.slice(0, TITLE_MAX)
  const space = cut.lastIndexOf(' ')
  return `${space > 16 ? cut.slice(0, space) : cut}...`
}

/** `en-US-AvaNeural` -> `Ava · en-US`. Serverga baribir XOM qiymat yuboriladi. */
function voiceLabel(voice: string): string {
  const match = /^(en-[A-Z]{2})-(.+?)Neural$/.exec(voice)
  if (match === null) return voice
  return `${match[2]} · ${match[1]}`
}

function rateLabel(rate: number): string {
  if (rate === 0) return '0% — odatiy'
  return `${rate}% — sekinroq`
}

/**
 * Har bir gap qatoridagi "Bo'lish/Yopish" tugmasining barqaror `id`si.
 * Tahrirlash panelini "Saqlash"/"Bekor qilish" bilan yopgandan keyin fokus
 * shu tugmaga qaytariladi — `applyEdit` gaplar ro'yxatini o'zgartirgani uchun
 * qator `<li>` QAYTA ULANADI, shuning uchun fokusni React ref emas, `index`dan
 * hosil bo'lgan barqaror `id` orqali topish kerak.
 */
function editToggleId(index: number): string {
  return `gap-${index}-bolish`
}

/** Gapdagi sintez qilinadigan so'zlar; raqam va tinish belgisi `gap` bo'lgani uchun tushib qoladi. */
function sentenceWords(sentence: string): string[] {
  const words: string[] = []
  for (const token of tokenize(sentence)) {
    if (token.kind === 'word') words.push(token.text)
  }
  return words
}

/**
 * Gaplar ro'yxatidan takrorlanmas so'zlar navbatini yig'adi.
 * `skip` — allaqachon so'ralganlar: dastlabki 3 gapdagi so'z fon navbatiga
 * ikkinchi marta tushmasligi kerak.
 */
function collectWords(sentences: readonly string[], skip: Set<string>): string[] {
  const words: string[] = []
  for (const sentence of sentences) {
    for (const word of sentenceWords(sentence)) {
      if (skip.has(word)) continue
      skip.add(word)
      words.push(word)
    }
  }
  return words
}

/** Mavjud darslar nomlari — takroriy nomni sezish uchun (trimlangan, kichik harfda). */
function readTitles(): Set<string> {
  const set = new Set<string>()
  for (const lesson of listLessons()) set.add(lesson.title.trim().toLowerCase())
  return set
}

// ---------------------------------------------------------------------------
// Holat turlari
// ---------------------------------------------------------------------------

type Analysis = {
  /** Paste qilingan asl matn — diff va `Lesson.originalText` uchun. */
  original: string
  result: NormalizeResult
  /** Gaplar ro'yxati: qo'lda bo'lingandan keyin `splitSentences` natijasidan farq qiladi. */
  sentences: string[]
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'synth'; done: number; total: number }
  /** Sintez bo'lmadi, lekin dars saqlandi — foydalanuvchi ogohlantirishni o'qib o'tadi. */
  | { kind: 'saved'; lessonId: string; warning: string }

type SentenceRow = { index: number; text: string; words: number }

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

export function Import() {
  useDocumentTitle('Yangi dars')

  const navigate = useNavigate()

  const [raw, setRaw] = useState('')
  const [title, setTitle] = useState('')
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE)
  const [rate, setRate] = useState<number>(DEFAULT_RATE)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null)
  const [onlyLong, setOnlyLong] = useState(false)

  /**
   * Tahrirlash panelini "Saqlash"/"Bekor qilish" bilan yopgandan keyin fokus
   * qaytariladigan tugma `id`si. Panel yopilishi bilan fokuslangan tugma DOM dan
   * chiqib ketadi (Saqlashda esa `<li>` `key`si o'zgargani uchun butunlay qayta
   * ulanadi), shuning uchun fokus shu render commitidan KEYIN — effektda —
   * qo'yiladi, aks holda yangi DOM tayyor bo'lmasdan `getElementById` bo'sh qaytardi.
   */
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  /**
   * Kutib turgan debounce taymeri ALOHIDA holat sifatida saqlanadi. `analysis.original`
   * ni `raw` bilan solishtirish ham javob berardi, lekin u 5000 so'zlik matnni har
   * renderda belgi-belgi taqqoslardi — bu yerda esa faqat "taymer osilib turibdi"
   * fakti kerak. Ushbu bayroqsiz import eskirgan tahlildan dars yig'ib qo'yardi:
   * A matni tahlil qilinadi, B qo'yiladi, 250 ms ichida bosiladi -> A saqlanadi.
   */
  const [analyzing, setAnalyzing] = useState(false)

  /** Darslar ro'yxati ochilishda va har bir yangi import boshlanishida qayta o'qiladi. */
  const [existingTitles, setExistingTitles] = useState<Set<string>>(() => readTitles())

  /**
   * Ikki marta yuborishdan qo'riqlash. `phase` yetarli emas: `setPhase` navbatga
   * qo'yiladi, ya'ni tez ketma-ket ikki bosish ikkala chaqiruvni ham o'tkazib
   * yuborardi va IKKITA dars saqlanardi.
   */
  const runningRef = useRef(false)

  const wordCount = countWords(raw)
  const overLimit = wordCount > MAX_WORDS
  const hasText = raw.trim() !== ''

  useEffect(() => {
    if (raw.trim() === '' || countWords(raw) > MAX_WORDS) {
      setAnalyzing(false)
      setAnalysis(null)
      setEditing(null)
      return
    }
    setAnalyzing(true)
    const timer = window.setTimeout(() => {
      const result = normalize(raw)
      setAnalysis({ original: raw, result, sentences: splitSentences(result.text) })
      // Asl matn o'zgardi -> qo'lda bo'lingan gaplar ham eskirdi.
      setEditing(null)
      setAnalyzing(false)
    }, ANALYZE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [raw])

  // Fokusni tahrirlash panelini yopgan tugmaga qaytaradi — render commit
  // qilingandan (yangi DOM tayyor bo'lgandan) keyin, shu sababli effektda.
  useEffect(() => {
    if (pendingFocusId === null) return
    document.getElementById(pendingFocusId)?.focus()
    setPendingFocusId(null)
  }, [pendingFocusId])

  const sentences = analysis?.sentences ?? []

  const rows = useMemo<SentenceRow[]>(
    () => sentences.map((text, index) => ({ index, text, words: countWords(text) })),
    [sentences],
  )
  const longRows = rows.filter((row) => row.words > LONG_SENTENCE_WORDS)
  const visibleRows = onlyLong ? longRows : rows

  const suggestedTitle = suggestTitle(analysis?.result.text ?? '')
  const finalTitle = title.trim() === '' ? suggestedTitle : title.trim()
  const duplicateTitle = finalTitle !== '' && existingTitles.has(finalTitle.toLowerCase())

  const canImport = phase.kind === 'idle' && !overLimit && !analyzing && sentences.length > 0

  /**
   * Saqlangandan keyin ekranni yangi import uchun toza holatga qaytaradi.
   * Har bir maydon ataylab sanab o'tilgan: yarim tozalash oldingi darsning qo'lda
   * bo'lingan gaplarini keyingisiga bildirmasdan olib o'tardi.
   */
  function resetForNextImport(): void {
    // `phase` ni tiklashning o'zi yetarli emas — ikki marta yuborish qo'riqchisi
    // saqlangan holatda `true` bo'lib qolgan bo'lishi mumkin.
    runningRef.current = false
    setRaw('')
    setTitle('')
    setAnalysis(null)
    setAnalyzing(false)
    setEditing(null)
    setOnlyLong(false)
    setPhase({ kind: 'idle' })
    // Endigina saqlangan dars ham takroriy nom tekshiruviga tushishi kerak.
    setExistingTitles(readTitles())
  }

  function applyEdit(index: number, draft: string): void {
    setAnalysis((current) => {
      if (current === null) return current
      // Qo'lda yozilgan bo'lak ham `normalize` dan o'tkaziladi: target ASCII bo'lishi
      // kafolati tahrirdan keyin ham buzilmasligi kerak, aks holda kursor mashq
      // paytida terib bo'lmaydigan belgida qotib qolardi (PLAN §2a).
      const parts: string[] = []
      for (const line of draft.split('\n')) {
        const clean = normalize(line).text
        if (clean !== '') parts.push(clean)
      }
      const next = current.sentences.slice()
      next.splice(index, 1, ...parts)
      return { ...current, sentences: next }
    })
    setEditing(null)
    // Tahrirlangan gap o'rniga tushgan birinchi bo'lak ham `index` pozitsiyasida
    // qoladi (`splice` faqat SHU o'rindan boshlab qo'shadi) — shuning uchun
    // fokus xuddi shu `id`ga qaytariladi, `<li>` qayta ulangan bo'lsa ham.
    setPendingFocusId(editToggleId(index))
  }

  async function handleImport(): Promise<void> {
    if (runningRef.current || !canImport || analysis === null) return
    runningRef.current = true

    // Ta'kidlash belgilari (`` `...` ``) SAQLASHDA ajratiladi: ekrandagi ro'yxat
    // muallif yozgan matnni ko'rsatib turadi, omborga esa TOZALANGAN target va
    // oraliqlar alohida tushadi. Shu tufayli `Lesson.sentences` ning ma'nosi
    // o'zgarmaydi — u aynan teriladigan matn (PLAN §2a).
    const parsed = sentences.map(parseEmphasis)
    const targets = parsed.map((item) => item.text)
    const ranges = parsed.map((item) => item.ranges)
    const hasEmphasis = ranges.some((list) => list.length > 0)

    const lesson: Lesson = {
      id: newLessonId(),
      title: finalTitle === '' ? 'Nomsiz dars' : finalTitle,
      createdAt: Date.now(),
      originalText: analysis.original,
      // Saqlangan target aynan mashq qilinadigan gaplardan yig'iladi — qo'lda
      // bo'lingandan keyin `result.text` bilan farq qilishi mumkin.
      normalizedText: targets.join(' '),
      sentences: targets,
      emphasis: hasEmphasis ? ranges : undefined,
      progress: 0,
      voice,
      rate,
    }
    // Sintezdan OLDIN saqlanadi: tarmoq qismi qanday tugashidan qat'i nazar
    // dars yo'qolmaydi (PLAN §1 — audio majburiy emas).
    saveLesson(lesson)

    // Sintez TOZALANGAN matndan yig'iladi: xom matnda teskari tirnoq `gap` bo'lib
    // tushardi va so'zlar ro'yxati baribir bir xil chiqardi, lekin bu tasodif —
    // audio manbai target bilan bitta bo'lgani ANIQ turgani ma'qul.
    const requested = new Set<string>()
    const head = collectWords(targets.slice(0, HEAD_SENTENCES), requested)
    const rest = collectWords(targets.slice(HEAD_SENTENCES), requested)
    const target = `/practice/${encodeURIComponent(lesson.id)}`

    setPhase({ kind: 'synth', done: 0, total: head.length })

    if (head.length === 0) {
      navigate(target)
      return
    }

    try {
      if (!(await serverAvailable())) {
        setPhase({ kind: 'saved', lessonId: lesson.id, warning: WARN_NO_SERVER })
        runningRef.current = false
        return
      }

      let ok = 0
      let done = 0
      for (let i = 0; i < head.length; i += SYNTH_CHUNK) {
        const chunk = head.slice(i, i + SYNTH_CHUNK)
        const result = await requestBatch(chunk, voice, rate)
        ok += result.ok.length
        done += chunk.length
        setPhase({ kind: 'synth', done, total: head.length })
      }

      if (ok === 0) {
        setPhase({ kind: 'saved', lessonId: lesson.id, warning: WARN_SYNTH_FAILED })
        runningRef.current = false
        return
      }
    } catch {
      setPhase({ kind: 'saved', lessonId: lesson.id, warning: WARN_UNEXPECTED })
      runningRef.current = false
      return
    }

    // Qolgan gaplar KUTILMAYDI (PLAN §2c). 2000 so'zlik matnni to'liq sintez qilish
    // 4-8 daqiqa — shuncha vaqt bloklangan progress bar ko'rsatish mashqni boshlashga
    // yo'l qo'ymasdi. So'rov komponent hayotiga bog'lanmagan, shuning uchun ekran
    // almashgandan keyin ham fonda davom etadi; natijasi kerak emas, chunki tayyor
    // bo'lmagan so'z mashqda `speechSynthesis` zaxirasi bilan o'qiladi.
    //
    // Aynan shu davomiylik uchun `background: true`: foydalanuvchi Practice ekranida
    // allaqachon yozayotgan bo'ladi va uning joriy gapi shu paketning ORQASIDA
    // navbatga tushmasligi kerak. Server fon so'rovini interaktivlaridan keyinga
    // qo'yadi va unga slotlarning bir qismini qoldiradi (`server/index.ts`).
    if (rest.length > 0) {
      void requestBatch(rest, voice, rate, { background: true }).catch(() => undefined)
    }

    navigate(target)
  }

  return (
    <div className="w-full">
      <div className={LABEL}>import</div>
      <h1 className="mt-2 font-mono text-[21px] font-semibold text-[#e6edf3]">
        Yangi dars
      </h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#7d8b9c]">
        Inglizcha matnni joylashtiring. Matn avval tozalanadi — nusxalangan aqlli
        qo&apos;shtirnoq, tire va diakritikalar klaviaturada terilmaydi, shuning uchun ular
        ASCII ga keltiriladi. Nima o&apos;zgargani pastda yonma-yon ko&apos;rsatiladi.
      </p>

      {/* --- Matn va sozlamalar --- */}
      <section className={`${PANEL} mt-6 p-5 sm:p-6`}>
        <label htmlFor="dars-nomi" className={LABEL}>
          dars nomi
        </label>
        {/* `lang="en"`: qiymat odatda inglizcha — `suggestTitle` uni AYNAN
            joylashtirilgan inglizcha matndan oladi. Kelishuv ochiq aytilsin:
            `placeholder` o'zbekcha, lekin u faqat maydon BO'SH bo'lganda
            o'qiladi, qiymat esa butun mashq davomida qoladi. */}
        <input
          id="dars-nomi"
          type="text"
          lang="en"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={suggestedTitle === '' ? 'Masalan: Orwell — 1984, 1-bob' : suggestedTitle}
          className={`${FIELD} mt-2`}
        />
        {duplicateTitle ? (
          <p className="mt-2 font-mono text-[11px] text-[#f2b344]">
            Shu nomli dars allaqachon bor — ro&apos;yxatda ikkitasi yonma-yon turadi.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="dars-matni" className={LABEL}>
            matn
          </label>
          <span
            className={`font-mono text-[11px] tabular-nums ${
              overLimit ? 'text-[#ff6b6b]' : 'text-[#7d8b9c]'
            }`}
          >
            {wordCount} / {MAX_WORDS} so&apos;z
          </span>
        </div>
        {/* `lang="en"`: bu ilovaning butun mazmuni — foydalanuvchi shu yerga
            INGLIZCHA matn joylashtiradi. `index.html` `lang="uz"` bo'lgani uchun
            belgilanmasa minglab so'z o'zbek fonetikasida o'qilardi. Gap
            ro'yxati (`:566`) va bo'lish muharriri (`:603`) allaqachon shunday. */}
        <textarea
          id="dars-matni"
          lang="en"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          spellCheck={false}
          placeholder="Matnni shu yerga joylashtiring..."
          className={`${FIELD} mt-2 min-h-56 resize-y leading-[1.8]`}
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dars-ovozi" className={LABEL}>
              ovoz
            </label>
            {/* Ro'yxat `shared/filename.ts` dan keladi: server aynan shu ro'yxatga
                qarab tekshiradi va boshqasini 400 bilan rad etadi (PLAN §5a). */}
            <select
              id="dars-ovozi"
              value={voice}
              onChange={(event) => {
                const next = event.target.value
                setVoice(VOICES.includes(next) ? next : DEFAULT_VOICE)
              }}
              className={`${FIELD} mt-2`}
            >
              {VOICES.map((item) => (
                <option key={item} value={item} className="bg-[#0b1219]">
                  {voiceLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dars-tezligi" className={LABEL}>
              tezlik
            </label>
            <select
              id="dars-tezligi"
              value={String(rate)}
              onChange={(event) => {
                const next = Number(event.target.value)
                setRate(RATES.includes(next) ? next : DEFAULT_RATE)
              }}
              className={`${FIELD} mt-2`}
            >
              {RATES.map((item) => (
                <option key={item} value={String(item)} className="bg-[#0b1219]">
                  {rateLabel(item)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
          Ovoz va tezlik darsga bog&apos;lanadi: audio fayl nomi ulardan hosil bo&apos;ladi,
          shuning uchun keyin o&apos;zgartirish so&apos;zlarni qaytadan sintez qilishni talab
          qiladi.
        </p>
        {/* Guruhlash qoidasi aynan shu maydon yonida turadi: u matn YOZILAYOTGANDA
            kerak, gaplar ro'yxati chiqqanda esa allaqachon kech. */}
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
          Bir-birini to&apos;ldiradigan gaplarni ajratmaslik uchun ularni{' '}
          <span className="text-text">[kvadrat qavs]</span> ichiga oling — qavs ichidagi
          gaplar nechta bo&apos;lsa ham bitta mashq birligi bo&apos;lib qoladi. Qavs gap
          boshida ochilib gap oxirida yopilishi shart; qavslarning o&apos;zi terilmaydi.
        </p>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
          So&apos;z yoki iborani <span className="text-text">`teskari tirnoq`</span> ichiga
          olsangiz, u mashq paytida <span className="font-bold text-text">qalin</span>{' '}
          ko&apos;rinadi. Tirnoqlar ham terilmaydi. Tirnoq bitta gap ichida ochilib
          yopilishi kerak — bir nechta gapni birga ta&apos;kidlash uchun avval ularni
          kvadrat qavsga oling.
        </p>
      </section>

      {/* --- Limitdan oshgan holat: import bloklanadi --- */}
      {overLimit ? (
        <section className="mt-4 rounded-panel border border-[#452027] bg-[#160f12] p-5">
          <div className={`${LABEL} text-[#ff7b7b]`}>limitdan oshdi</div>
          <p className="mt-2 text-[13px] leading-relaxed text-[#e0b7b7]">
            Bitta darsga eng ko&apos;pi {MAX_WORDS} so&apos;z sig&apos;adi, matnda esa{' '}
            <span className="tabular-nums">{wordCount}</span> ta —{' '}
            <span className="tabular-nums">{wordCount - MAX_WORDS}</span> ta ortiqcha. Matnni
            bo&apos;laklarga bo&apos;lib, alohida darslar qilib import qiling.
          </p>
        </section>
      ) : null}

      {/* --- Normalizatsiya diffi (PLAN §2a) --- */}
      {analysis !== null ? (
        <section className={`${PANEL} mt-4 p-5 sm:p-6`}>
          <h2 className={LABEL}>normalizatsiya</h2>
          <div className="mt-4">
            <NormalizeDiff original={analysis.original} result={analysis.result} />
          </div>
        </section>
      ) : null}

      {/* --- Gaplar ro'yxati (PLAN §2b, §2c) --- */}
      {analysis !== null ? (
        <section className={`${PANEL} mt-4 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={LABEL}>gaplar</h2>
            <span className="font-mono text-[11px] text-[#7d8b9c] tabular-nums">
              {rows.length} ta gap · {countWords(analysis.result.text)} so&apos;z
            </span>
          </div>

          {longRows.length > 0 ? (
            <div className="mt-4 rounded-control border border-[#3a2c12] bg-[#151007] px-4 py-3">
              <p className="font-mono text-[13px] leading-relaxed text-[#e0cfa8]">
                <span className="tabular-nums">{longRows.length}</span> ta gap{' '}
                {LONG_SENTENCE_WORDS} so&apos;zdan uzun. Uzun gapni bir urinishda xatosiz terish
                charchatadi — &laquo;Bo&apos;lish&raquo; tugmasi bilan ularni qismlarga ajrating.
              </p>
              <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 font-mono text-[11px] text-[#8a7c5b]">
                <input
                  type="checkbox"
                  checked={onlyLong}
                  onChange={(event) => setOnlyLong(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#f2b344]"
                />
                faqat uzun gaplarni ko&apos;rsatish
              </label>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <p className="mt-4 text-[13px] text-[#7d8b9c]">
              Tozalangan matndan bironta gap chiqmadi.
            </p>
          ) : (
            <ul className="mt-4 max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
              {visibleRows.map((row) => {
                const isLong = row.words > LONG_SENTENCE_WORDS
                const isEditing = editing !== null && editing.index === row.index
                return (
                  <li
                    key={`${row.index}|${row.text}`}
                    className={`rounded-control border px-3 py-2.5 ${
                      isLong
                        ? 'border-[#3a2c12] bg-[#12100a]'
                        : 'border-white/[0.05] bg-white/[0.015]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[11px] text-[#7d8b9c] tabular-nums">
                        {row.index + 1}
                      </span>
                      <p
                        lang="en"
                        className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed text-[#c6d3de]"
                      >
                        {row.text}
                      </p>
                      <span
                        className={`shrink-0 pt-0.5 font-mono text-[11px] tabular-nums ${
                          isLong ? 'text-[#f2b344]' : 'text-[#7d8b9c]'
                        }`}
                      >
                        {row.words}
                      </span>
                      <Button
                        id={editToggleId(row.index)}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(isEditing ? null : { index: row.index, draft: row.text })
                        }}
                      >
                        {isEditing ? 'Yopish' : "Bo'lish"}
                      </Button>
                    </div>

                    {isEditing && editing !== null ? (
                      <div className="mt-3 border-t border-white/[0.06] pt-3">
                        <p
                          id={`gap-${row.index}-tahrir-yordam`}
                          className="font-mono text-[11px] leading-relaxed text-[#7d8b9c]"
                        >
                          Har bir qator — alohida gap. Bo&apos;sh qatorlar tashlanadi; hammasi
                          o&apos;chirilsa gap ro&apos;yxatdan chiqariladi.
                        </p>
                        <textarea
                          value={editing.draft}
                          autoFocus
                          spellCheck={false}
                          lang="en"
                          aria-label={`${row.index + 1}-gapni qatorlarga bo'lish`}
                          aria-describedby={`gap-${row.index}-tahrir-yordam`}
                          onChange={(event) => {
                            const draft = event.target.value
                            setEditing((current) =>
                              current === null ? current : { ...current, draft },
                            )
                          }}
                          className={`${FIELD} mt-2 min-h-24 resize-y leading-[1.8]`}
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              applyEdit(row.index, editing.draft)
                            }}
                          >
                            Saqlash
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              // Panel yopilishi bilan shu tugma ham DOM dan chiqadi —
                              // "Yopish"dan farqli o'laroq bu yerda tugma qayta
                              // ulanmaydi, shuning uchun fokus "Bo'lish"ga qaytariladi.
                              setPendingFocusId(editToggleId(row.index))
                              setEditing(null)
                            }}
                          >
                            Bekor qilish
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* --- Bo'sh holat --- */}
      {!hasText ? (
        <div className="mt-4">
          <EmptyState
            title="Hali matn yo'q"
            hint="Yuqoridagi maydonga inglizcha matn joylashtiring — tozalash natijasi, gaplar ro'yxati va uzun gaplar shu yerda paydo bo'ladi."
          />
        </div>
      ) : null}

      {/* --- Sintez va harakat --- */}
      {phase.kind === 'saved' ? (
        <section className="mt-4 rounded-panel border border-[#3a2c12] bg-[#151007] p-5">
          <div className={`${LABEL} text-[#f2b344]`}>ogohlantirish</div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#e0cfa8]">
            {phase.warning}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              autoFocus
              onClick={() => {
                navigate(`/practice/${encodeURIComponent(phase.lessonId)}`)
              }}
            >
              Mashqni boshlash
            </Button>
            {/* Saqlangan holatdan `idle` ga yagona yo'l — busiz ikkinchi matnni
                import qilish uchun sahifani almashtirish kerak bo'lardi. */}
            <Button variant="ghost" onClick={resetForNextImport}>
              Boshqa matn import qilish
            </Button>
          </div>
        </section>
      ) : (
        <section className="mt-4 flex flex-wrap items-center gap-4">
          <Button disabled={!canImport} onClick={() => void handleImport()}>
            {phase.kind === 'synth'
              ? 'Sintez qilinmoqda...'
              : analyzing
                ? 'Matn tahlil qilinmoqda...'
                : 'Import qilib boshlash'}
          </Button>
          {phase.kind === 'idle' ? (
            <p className="font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
              {analyzing
                ? "Yozuv to'xtagach gaplar ro'yxati yangilanadi va import ochiladi."
                : `Dastlabki ${HEAD_SENTENCES} gap sintez qilinishi bilan mashq ochiladi — qolgani fonda tayyorlanadi.`}
            </p>
          ) : null}
        </section>
      )}

      {phase.kind === 'synth' ? (
        <section className={`${PANEL} mt-4 p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={LABEL}>
              {phase.total === 0 ? 'tayyorlanmoqda' : `dastlabki ${HEAD_SENTENCES} gap`}
            </span>
            <span className="font-mono text-[11px] text-[#7d8b9c] tabular-nums">
              {phase.done} / {phase.total} so&apos;z
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={phase.total}
            aria-valuenow={phase.done}
            aria-label="Sintez jarayoni"
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
          >
            <span
              className="block h-full rounded-full bg-[#5ee6c1] motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out"
              style={{
                width: `${phase.total === 0 ? 4 : Math.round((phase.done / phase.total) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
            Dars allaqachon saqlandi. Qolgan gaplar mashq boshlangandan keyin fonda sintez
            qilinadi.
          </p>
        </section>
      ) : null}
    </div>
  )
}

export default Import
