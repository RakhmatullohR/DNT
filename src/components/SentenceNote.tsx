// Gap izohi — mashq ekranidagi YAGONA kartaning quyi qavatlari.
//
// ⭐ Bu komponent endi O'ZINING kartasini chizmaydi: yozuv (gap matni), izoh va
// rasm bitta karta ichida uchta qavat bo'lib turadi (karta Practice.tsx dagi
// `STACK`). Shuning uchun bu yerdagi ildiz element faqat ajratuvchi chiziq va
// qavatlardan iborat — chegara, fon va burchak radiusi kartaniki.
//
// ⭐ NEGA ALOHIDA FAYL (Practice.tsx ichidagi `Sentence`/`Stat`/`Bar` kabi emas):
// o'sha komponentlar SOF chizuvchi, bu esa async IndexedDB yozuvi, debounce
// taymeri, bufer/fayl o'qishi, `URL.createObjectURL` hayot sikli va ikkita
// `window`/`document` tinglovchisini olib keladi. Practice.tsx sarlavhasidagi
// "bu fayl faqat chizadi, bu yerda `window` ga birorta tinglovchi qo'shilmaydi"
// qoidasi shu ajratish tufayli SO'ZMA-SO'Z kuchda qoladi.
//
// ⚠️ Mashq klavishlari: `<textarea>` ustidagi bosishlarni seans hook'i o'ziga
// OLMAYDI (`useTypingSession` dagi `isTextEntryTarget`), ya'ni bu yerda yozish
// mashqqa tegmaydi. TUGMALAR esa boshqa: hook `Enter` da `preventDefault()`
// qiladi, shuning uchun har bir tugmada `stopEnter` bo'lishi SHART — usiz
// tugmani klaviaturadan bosib bo'lmasdi (naqsh: Practice.tsx dagi `FocusToggle`).

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import { Button } from './Button.tsx'
import { BAND_X, DIVIDER, RAIL_BTN, RAIL_NOTE } from './practiceCard.ts'
import { prepareImage } from '../media/imageResize.ts'
import {
  addNoteImage,
  deleteNoteImage,
  getNote,
  writeNoteText,
} from '../store/notes.ts'
import type { NoteImage, NoteSaveResult } from '../store/notes.ts'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGES_PER_NOTE,
  MAX_NOTE_CHARS,
  checkImage,
  sentenceHead,
} from '../store/notesSchema.ts'

/**
 * Yozishdan keyin saqlashgacha kutiladigan vaqt.
 *
 * Qisqa (600 ms) ATAYIN: `pagehide` da boshlangan IndexedDB tranzaksiyasi
 * tugamasligi mumkin (`useTypingSession` dagi bilan bir xil ogohlantirish),
 * ya'ni yo'qotish radiusi aynan shu oraliq bilan chegaralanadi.
 */
const DEBOUNCE_MS = 600

/**
 * Uzluksiz yozilganda majburiy saqlash oralig'i.
 *
 * Busiz to'xtamay yozayotgan foydalanuvchida debounce hech qachon ishga
 * tushmasdi va uzun izoh butunlay saqlanmagan holda qolardi.
 */
const MAX_WAIT_MS = 3000

/**
 * Izoh maydoni — karta ICHIDAGI qavat, alohida quti EMAS.
 *
 * Chegara, fon va burchak radiusi ATAYIN yo'q: ular bo'lganda maydon
 * kartaning USTIDA turgan ikkinchi quti bo'lib ko'rinardi va "uchalasi bitta
 * karta" ta'siri buzilardi. Gorizontal chekka `BAND_X` — ya'ni izoh matni gap
 * matni bilan aynan bir vertikalda boshlanadi; shu sabab maydon qavat
 * o'ramining ichiga emas, chekkadan chekkagacha qo'yilgan.
 *
 * Fokus halqasi ICHKI (`inset-ring`), tashqi emas: tashqi halqa to'la enli
 * maydonda karta chegarasidan tashqariga chiqib, qo'shni qavatlar ustiga
 * tushardi. Hover'dagi zaif fon — quti yo'qolgandan keyin "bu yerga yozsa
 * bo'ladi" ishorasining o'rnini bosadi (bo'shligida buni `placeholder` aytadi).
 */
const NOTE_FIELD = [
  BAND_X,
  'w-full resize-y border-0 bg-transparent py-2',
  'font-mono text-[#e6edf3] placeholder:text-[#7d8b9c]',
  'transition-colors duration-150 ease-out hover:bg-white/[0.02]',
  'outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-[#5ee6c1]',
].join(' ')

/** Yozuv natijasini foydalanuvchi tilidagi sababga aylantiradi. */
function describeResult(result: NoteSaveResult): string {
  switch (result) {
    case 'saved':
      return ''
    case 'no-idb':
      return "Bu brauzerda izoh saqlanmaydi — yozilgani faqat shu sahifada qoladi."
    case 'blocked':
      return "Boshqa tab ilovaning eski nusxasini ushlab turibdi — o'sha tabni yoping."
    case 'quota':
      return "Brauzer xotirasi to'lgan — rasm saqlanmadi."
    case 'limit':
      return `Bitta gapga ${MAX_IMAGES_PER_NOTE} tadan ortiq rasm qo'yilmaydi.`
    case 'invalid':
      return "Rasm yaroqsiz yoki juda katta — boshqa nusxa tanlang."
    default:
      return "Izoh saqlanmadi. Sahifani yangilab ko'ring."
  }
}

export type SentenceNoteProps = {
  /** Ochuvchi tugmaning `aria-controls` i shu id ga ishora qiladi. */
  id: string
  lessonId: string
  sentenceIndex: number
  /** Joriy gap matni — `s` (gap boshi) va mos kelmaslik ogohlantirishi uchun. */
  sentenceText: string
  /** Diqqat rejimida shrift kattaroq: u yerda gap ham 21/25px da chiziladi. */
  focusMode?: boolean
  /**
   * Kartaning o'ng rafi — bu komponentning ikkita tugmasi SHU YERGA portal
   * qilinadi (`Practice.tsx` dagi `RAIL`).
   *
   * ⭐ NEGA PORTAL: raf kartaning butun balandligi bo'ylab cho'zilgan alohida
   * ustun, ya'ni uni faqat kartaga egalik qiladigan `Practice.tsx` chiza
   * oladi. "Rasm qo'shish" esa aynan shu komponentning ichki holatiga tayanadi
   * (yashirin `<input>`, `busy`, `canAdd`) — uni yuqoriga ko'chirish uchtala
   * holatni ham ko'tarishni talab qilardi. Portal ikkovini ham joyida
   * qoldiradi: DOM da tugma rafda, React daraxtida esa shu yerda — demak
   * `stopEnter` ham odatdagidek ishlaydi.
   *
   * Birinchi renderda `null` bo'ladi (raf hali DOM ga tushmagan) — o'shanda
   * tugmalar chizilmaydi va keyingi renderda paydo bo'ladi.
   */
  railNode: HTMLElement | null
  /** "Yozuvga qaytish" — fokusni mashq maydoniga qaytaradi. */
  onReturnToField: () => void
}

type Pending = {
  key: string
  lessonId: string
  sentenceIndex: number
  text: string
  sentence: string
}

export function SentenceNote({
  id,
  lessonId,
  sentenceIndex,
  sentenceText,
  focusMode = false,
  railNode,
  onReturnToField,
}: SentenceNoteProps) {
  const uid = useId()
  const textId = `${uid}-text`

  const [text, setText] = useState('')
  const [images, setImages] = useState<NoteImage[]>([])
  const [savedHead, setSavedHead] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  /** Saqlanmagan tahrir. Kalitni O'ZIDA olib yuradi — pastdagi izohga qarang. */
  const pendingRef = useRef<Pending | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstEditAtRef = useRef(0)
  /** O'qish avlodi: kechikkan javob yangi gap ustiga tushmasin. */
  const loadIdRef = useRef(0)
  const mountedRef = useRef(true)

  const noteKey = `${lessonId}:${sentenceIndex}`

  /**
   * Kutilayotgan tahrirni DARHOL yozadi.
   *
   * ⭐ Kalit (`lessonId`/`sentenceIndex`) `pendingRef` ning ICHIDAN olinadi,
   * props'dan EMAS. Shu tufayli foydalanuvchi yozib turib keyingi gapga o'tib
   * ketsa ham matn O'Z gapiga tushadi — bu eskirgan yozuvning yagona
   * ishonchli yechimi.
   */
  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    if (pending === null) return
    pendingRef.current = null
    firstEditAtRef.current = 0

    void writeNoteText(pending.lessonId, pending.sentenceIndex, pending.text, pending.sentence)
      .then((result) => {
        if (!mountedRef.current) return
        setNotice(describeResult(result))
      })
      .catch(() => {
        if (mountedRef.current) setNotice(describeResult('error'))
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Gap almashdi (yoki panel endi ochildi): avval saqlanmagan matnni yozamiz,
  // keyin yangisini o'qiymiz. Tozalashda ham `flush` — panel yopilganda,
  // diqqat rejimiga o'tilganda va komponent uzilganda ishlaydi.
  useEffect(() => {
    flush()
    const myId = loadIdRef.current + 1
    loadIdRef.current = myId

    setText('')
    setImages([])
    setSavedHead(undefined)
    setNotice('')
    // ⚠️ `busy` ham SHU YERDA tozalanadi: rasm tayyorlanayotganda gap almashsa,
    // `attach` ning yakuni eskirgan bo'lib qoladi va o'z `setBusy(false)` ini
    // o'tkazib yuboradi — tugma esa "Qo'shilmoqda…" holatida abadiy o'chib
    // qolardi.
    setBusy(false)

    void getNote(lessonId, sentenceIndex).then((note) => {
      if (!mountedRef.current || myId !== loadIdRef.current) return
      // ⚠️ Faqat MATN saqlab qolinadi: foydalanuvchi o'qish tugashidan oldin
      // yozib ulgurgan bo'lsa, omborning eski qiymati uning matnini bosib
      // ketmasligi kerak. Rasmlar esa BARIBIR qo'yiladi — ular yozilayotgan
      // matnga bog'liq emas, va butun javobni tashlab yuborish mavjud rasmlarni
      // ko'rinmas qilib qo'yardi ("rasm qo'shish" ham noto'g'ri hisoblanardi).
      const typing = pendingRef.current?.key === `${lessonId}:${sentenceIndex}`
      if (!typing) setText(note?.text ?? '')
      setImages(note?.images ?? [])
      setSavedHead(note?.sentenceHead)
    })

    return () => {
      flush()
    }
  }, [lessonId, sentenceIndex, flush])

  // Sahifa yopilishi/yashirinishi. `beforeunload` ATAYIN emas: mobil brauzerlar
  // uni ko'pincha umuman bermaydi (`useTypingSession` dagi bilan bir xil qaror).
  useEffect(() => {
    const onHide = (): void => {
      flush()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush])

  function onTextChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const next = event.currentTarget.value.slice(0, MAX_NOTE_CHARS)
    setText(next)
    setNotice('')

    pendingRef.current = {
      key: noteKey,
      lessonId,
      sentenceIndex,
      text: next,
      sentence: sentenceText,
    }

    const now = Date.now()
    if (firstEditAtRef.current === 0) firstEditAtRef.current = now
    if (now - firstEditAtRef.current >= MAX_WAIT_MS) {
      flush()
      return
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flush()
    }, DEBOUNCE_MS)
  }

  /**
   * Rasmni tekshiradi, siqadi va saqlaydi; so'ng ro'yxatni yangilaydi.
   *
   * ⚠️ `myId` QOROVULI SHART. Rasm tayyorlash (bitmap ochish + WebP kodlash)
   * telefon skrinshotida bir necha yuz millisekund oladi va shu vaqtda
   * foydalanuvchi gapni tugatib keyingisiga o'tib ketishi mumkin. Komponent
   * uzilmaydi (u `key` siz, ya'ni o'sha nusxa qoladi), demak `mountedRef`
   * yetarli emas edi: eski gapning rasmlari YANGI gap ostida chizilardi va
   * shundan keyingi "o'chirish" bosishi allaqachon boshqa gapga tegardi.
   *
   * Yozuvning O'ZI to'g'ri gapga tushadi — `lessonId`/`sentenceIndex` bu
   * yopilmada muzlatilgan; qorovul faqat KO'RSATISHNI to'xtatadi.
   */
  const attach = useCallback(
    async (file: Blob, name: string): Promise<void> => {
      const myId = loadIdRef.current
      const stale = (): boolean => !mountedRef.current || myId !== loadIdRef.current

      const check = checkImage({ type: file.type, size: file.size })
      if (check !== 'ok') {
        setNotice(
          check === 'type'
            ? "Faqat rasm qo'shiladi: PNG, JPEG, WebP, GIF yoki AVIF."
            : check === 'size'
              ? 'Rasm juda katta — kichikroq nusxa tanlang.'
              : "Fayl bo'sh.",
        )
        return
      }

      setBusy(true)
      setNotice('')
      try {
        const prepared = await prepareImage(file, name)
        const result = await addNoteImage(lessonId, sentenceIndex, prepared.blob, prepared.name)
        if (stale()) return
        setNotice(describeResult(result))
        if (result !== 'saved') return

        const note = await getNote(lessonId, sentenceIndex)
        if (!stale()) setImages(note?.images ?? [])
      } finally {
        // ⚠️ Qorovul `stale()` EMAS, faqat `mountedRef`: gap almashgan bo'lsa
        // ham bayroq tushirilishi SHART, aks holda tugma abadiy o'chgan
        // holatda qolardi. (Yuklash effekti ham uni tozalaydi — ikkovi bir-birini
        // qo'llab-quvvatlaydi, chunki effekt tartibi kafolatlangan emas.)
        if (mountedRef.current) setBusy(false)
      }
    },
    [lessonId, sentenceIndex],
  )

  function onFilePicked(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const file = input.files?.[0]
    // SINXRON tozalash: aks holda AYNAN o'sha faylni qayta tanlaganda `change`
    // umuman chiqmaydi va tugma ishlamaydigandek ko'rinadi (`Import.tsx` naqshi).
    input.value = ''
    if (file === undefined) return
    void attach(file, file.name)
  }

  /**
   * Buferdan rasm qo'yish — izoh yozish oqimining tabiiy qismi.
   *
   * `preventDefault` FAQAT rasm topilganda: aks holda oddiy matn qo'yish
   * buzilardi. Rasm topilganda esa brauzer matn o'rniga fayl nomini yoki
   * `blob:` yo'lini qo'yib yuborishi mumkin — o'shani to'xtatamiz.
   */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    for (const item of event.clipboardData.items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file === null) continue
      event.preventDefault()
      void attach(file, file.name === '' ? 'qoyilgan-rasm.png' : file.name)
      return
    }
  }

  /**
   * ⚠️ Kalit BOSISH PAYTIDA muzlatiladi (`attach` dagi bilan bir xil sabab).
   *
   * Bu funksiya har renderda qaytadan yasaladi, ya'ni `lessonId`/`sentenceIndex`
   * ni chaqirilgan PAYTDAGI props'dan olardi. Eskirgan ro'yxat ekranda turganda
   * bu boshqa gapning rasmini o'chirib yuborardi.
   */
  async function removeImage(lesson: string, index: number, slot: number): Promise<void> {
    const myId = loadIdRef.current
    const result = await deleteNoteImage(lesson, index, slot)
    if (!mountedRef.current || myId !== loadIdRef.current) return
    setNotice(describeResult(result))
    if (result !== 'saved') return
    setImages((current) => current.filter((image) => image.slot !== slot))
  }

  const canAdd = images.length < MAX_IMAGES_PER_NOTE
  const mismatch = savedHead !== undefined && savedHead !== sentenceHead(sentenceText)

  /**
   * Tugma shakli maqsadga qarab: oddiy rejimda u kartaning o'ng RAFIDA, ya'ni
   * ustundagi qo'shnilari bilan bir xil enda bo'lishi kerak; diqqat rejimida
   * esa suzuvchi burchak QATORIDA, ya'ni mazmuni bo'yicha qisqarishi kerak —
   * u yerda `w-full` tugmalarni bir-biriga siqib tashlardi.
   */
  const railBtn = focusMode ? undefined : RAIL_BTN

  return (
    <>
      {/* Rafdagi ikkita tugma — DOM da kartaning o'ng ustunida, React daraxtida
          esa shu yerda (`railNode` propiga qarang). */}
      {railNode === null
        ? null
        : createPortal(
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                className="hidden"
                onChange={onFilePicked}
              />
              {/* Mashq boshqaruvlarini izoh harakatlaridan ajratadi. FAQAT
                  rafning ustun ko'rinishida: tor ekrandagi o'ralgan qatorda va
                  diqqat rejimidagi burchak qatorida bu chiziq tugmalar
                  orasidan ma'nosiz kesib o'tardi (u yerda ajratadigan mashq
                  boshqaruvi ham yo'q). */}
              {focusMode ? null : (
                <div aria-hidden="true" className={`hidden w-full ${DIVIDER} sm:block`} />
              )}
              <Button
                size="sm"
                variant="ghost"
                className={railBtn}
                disabled={!canAdd || busy}
                onKeyDown={stopEnter}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? 'Qo’shilmoqda…' : "Rasm qo’shish"}
              </Button>
              {/* Chegara TUGMANING YONIDA turadi: 3/3 da tugma o'chadi va
                  sababini aynan shu son aytadi. */}
              <span className={RAIL_NOTE}>
                {images.length} / {MAX_IMAGES_PER_NOTE} rasm
              </span>
              {/* Gap tugagach "Enter bosing" deyiladi, lekin fokus izoh
                  maydonida bo'lsa Enter yangi qator qo'shadi va mashq
                  qimirlamaydi. Bu tugma — o'sha tuzoqning yechimi, bezak
                  emas. */}
              <Button
                size="sm"
                variant="ghost"
                className={railBtn}
                onKeyDown={stopEnter}
                onClick={onReturnToField}
              >
                Yozuvga qaytish
              </Button>
            </>,
            railNode,
          )}

      {/* Ildizda `p-*` YO'Q: chekkani har bir qavat O'ZI beradi, chunki izoh
          maydoni chekkadan chekkagacha cho'ziladi (`NOTE_FIELD` ga qarang) —
          umumiy padding uni qavat ichiga qamab, fokus halqasini kesib qo'yardi. */}
      <section id={id} role="region" aria-label="Izoh va rasm" className={DIVIDER}>
        {/* ── izoh qavati ── */}
        <div className="py-0">
          {/* ⚠️ Ko'rinadigan "izoh" yorlig'i ATAYIN olib tashlangan:
              `placeholder` maydonning nima ekanini o'zi aytadi va yorliq
              ustiga yana bitta qator shovqin qo'shardi. Yorliqning O'ZI esa
              `sr-only` bo'lib QOLADI — `placeholder` ekran o'quvchi uchun nom
              emas: brauzerlar uni har xil o'qiydi va matn yozila boshlashi
              bilan butunlay yo'qoladi, ya'ni maydon nomsiz qolardi. */}
          <label htmlFor={textId} className="sr-only">
            Gap izohi
          </label>

          {/* Shrift gapникidan biroz KICHIK: izoh mashq matnining o'rnini
              egallamasligi, lekin o'qilishi ham qiyin bo'lmasligi kerak. */}
          <textarea
            id={textId}
            value={text}
            rows={focusMode ? 3 : 4}
            maxLength={MAX_NOTE_CHARS}
            onChange={onTextChange}
            onBlur={flush}
            onPaste={onPaste}
            placeholder="Bu gap haqida eslatma — rasmni Ctrl+V bilan ham qo'yish mumkin. 4000 tagacha matn kirita olasan"
            className={`${NOTE_FIELD} ${focusMode ? 'text-[17px]' : 'text-[15px]'}`}
          />

          {mismatch ? (
            <div className={`${BAND_X} mt-2`}>
              <p className="rounded-control border border-[#3a2c12] bg-[#151007] px-2 py-1 font-mono text-[11px] text-[#e0cfa8]">
                Bu izoh boshqa matnga yozilgan bo&apos;lishi mumkin — dars qayta
                import qilinganda gaplar siljigan.
              </p>
            </div>
          ) : null}
        </div>

        {/* ── rasm qavati: FAQAT rasm bo'lganda ──
            Tugma rafga ko'chgach bu qavatda boshqa hech narsa qolmadi, ya'ni
            rasmsiz holatda u bo'sh chiziqdan iborat bo'lardi. Qo'shish
            harakati endi rafdan qilinadi. */}
        {images.length === 0 ? null : (
          <div className={`${DIVIDER} space-y-3`}>
            {images.map((image) => (
              <NoteImageView
                key={image.slot}
                image={image}
                onRemove={() => {
                  void removeImage(lessonId, sentenceIndex, image.slot)
                }}
              />
            ))}
          </div>
        )}

        {/* ── holat va yordam qavati ──
            Diqqat rejimida bu qavat xabarsiz holatda BUTUNLAY yig'iladi:
            chiziq ham, bo'shliq ham, mixlangan balandlik ham yo'q — aks holda
            matn ostida doim bo'sh 40px osilib turardi. Mixlangan balandlik
            oddiy rejimda SAQLANADI: u yerda pastda boshqaruvlar bor va xabar
            chiqqanda ular sakrab ketmasligi kerak; diqqat rejimida esa
            pastda hech narsa yo'q, ya'ni siljiydigan narsa ham yo'q. */}
        <div
          className={
            focusMode
              ? `${BAND_X} ${notice === '' ? '' : 'py-3'}`
              : `${BAND_X} ${DIVIDER} py-3`
          }
        >
          {/* Shoshilinch emas — `alert` emas, `status`. Mashq maydonining o'z
              jonli hududi bilan raqobatlashmasligi uchun `polite`. */}
          <p
            role="status"
            aria-live="polite"
            className={`font-mono text-[11px] leading-relaxed text-[#e0cfa8] ${
              focusMode ? '' : 'min-h-4'
            }`}
          >
            {notice}
          </p>

          {/* ⚠️ Diqqat rejimida bu tushuntirish CHIZILMAYDI: u bir marta
              o'qiladigan matn, o'sha rejimda esa ekranda gapdan boshqa hech
              narsa qolmasligi kerak. Oddiy rejimda qoladi — izoh birinchi
              marta ochilganda "yozganim qayerga ketadi" savoliga javob beradi.
              Yuqoridagi holat satri esa IKKALA rejimda ham turadi: saqlanmagan
              izoh haqidagi xabar ko'rinmay qolsa bo'lmaydi. */}
          {focusMode ? null : (
            <p className="mt-2 max-w-xl font-mono text-[11px] leading-relaxed text-[#7d8b9c]">
              Izoh shu brauzerda saqlanadi va dars zaxirasi (.json) bilan birga
              ko&apos;chadi. Izoh yozilgan vaqt seansning 10 daqiqasidan
              sarflanadi; tezlik va aniqlik esa o&apos;zgarmaydi.
            </p>
          )}
        </div>
      </section>
    </>
  )
}

/**
 * Bitta rasm: eskiz + o'chirish.
 *
 * `URL.createObjectURL` EFFEKTDA yaratiladi va O'SHA effekt tozalashida bekor
 * qilinadi. Renderda yaratilsa har renderda bittadan URL oqib ketardi.
 *
 * ⚠️ `Home.tsx` dagi `downloadFile` naqshi (setTimeout bilan `revokeObjectURL`)
 * bu yerda YARAMAYDI: u yerda URL bosishdan keyin darhol keraksiz bo'ladi,
 * bu yerda esa `<img>` dan uzoq yashashi kerak.
 */
function NoteImageView({ image, onRemove }: { image: NoteImage; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(image.blob)
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
    }
  }, [image.blob])

  return (
    // Chekka `BAND_X`: rasmning chap qirrasi gap matni va izoh matni bilan
    // AYNAN bir vertikalda turadi. Rasmning O'Z chegarasi qoladi — oq fonli
    // skrinshot usiz kartaga qo'shilib ketardi.
    <figure className={BAND_X}>
      {url === null ? null : (
        <img
          src={url}
          alt={`Izoh rasmi: ${image.name}`}
          className="max-h-[60vh] w-full rounded-control border border-[#1d2833] object-contain"
        />
      )}
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-[#7d8b9c]">{image.name}</span>
        <Button size="sm" variant="danger" onKeyDown={stopEnter} onClick={onRemove}>
          Rasmni o&apos;chirish
        </Button>
      </figcaption>
    </figure>
  )
}

/**
 * `Enter` ni mashq hook'iga yetkazmaydi.
 *
 * Hook `window` da o'tiradi va `Enter` da `preventDefault()` qiladi (u yerda
 * Enter — "keyingi gap"). To'xtatilmasa bu paneldagi tugmalarni klaviaturadan
 * bosib bo'lmasdi. `Space` ATAYIN to'xtatilmaydi: u haqiqiy mashq belgisi.
 */
function stopEnter(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Enter') event.stopPropagation()
}
