# Dictation + Typing — loyiha rejasi

> Bu reja OMC agentlari (critic / architect / analyst) tomonidan tanqid qilingan va tuzatilgan.
> Tanqid natijasida rejadagi **ikkita yozma da'vo noto'g'ri** ekani amaliy tekshiruvda aniqlandi
> (`Intl.Segmenter` va `block` rejimi), edge-tts manbasida **uchta kritik xato** topildi.
> Hammasi quyida hisobga olingan.

## Context

Maqsad: inglizcha eshitish va tez yozish mashqini **bitta harakatga** birlashtirgan shaxsiy web-ilova.

Asosiy mexanika:
> Har bir so'zning **birinchi harfini** yozganda, o'sha so'z **to'liq o'qiladi** — va bir urinish ichida **faqat bir marta**. Foydalanuvchi eshitgan so'zini qolgan harflarini yozish davomida mustahkamlaydi.

Tanlangan qarorlar:
- **To'liq matn ko'rinib turadi.** Yashirin dictation emas.
- **Web app** (brauzer), backend faqat TTS uchun lokal.
- **Gibrid audio**: `edge-tts` neural MP3 asosiy, brauzer `speechSynthesis` zaxira.
- **Kontent**: matn paste qilish. **Statistika**: WPM, aniqlik, xato so'zlar.
- **Har so'z urinish ichida bir martadan ortiq o'qilmaydi.** Gapni qayta boshlaganda tiklanadi.
- **Faqat so'z audiosi** — butun gapni tinglash imkoniyati yo'q.
- **Qisqa so'z audiosi kesilmaydi** — keyingi so'z ~250 ms kutadi (yangi qaror, quyida §5).
- **Bosh harf qat'iy** — `The` uchun Shift bosish shart (yangi qaror, §4).
- **Barcha audio bitta yassi `audio-words/` papkada**, fayl nomi — so'zning o'zi.
- **Global npm paket ishlatilmaydi.**
- Doirada emas: SRS, noji `.md` import, yashirin rejimlar, chuqur fonetik statistika.

Muhit: `node v24.15.0`, `npm 11.12.1`. Loyiha papkasi bo'sh — noldan quriladi.

---

## 1. Arxitektura

```
dictation-and-typing/
├── package.json            # "type": "module"
├── tsconfig.json           # allowImportingTsExtensions + noEmit
├── vite.config.ts          # @tailwindcss/vite, /api -> :8787 proxy
├── .gitignore              # node_modules/ dist/ audio-words/
├── shared/
│   └── filename.ts         # so'z -> fayl nomi. Server VA klient shu bitta faylni import qiladi
├── server/
│   ├── index.ts            # Fastify: /api/tts/batch, /api/audio/:file, statik dist
│   ├── tts.ts              # EdgeTTS wrapper: har chaqiruvga yangi instance, timeout, retry
│   └── store.ts            # atomik yozish (.tmp -> rename), in-flight dedup
├── audio-words/            # gitignore — YASSI, hamma MP3 shu yerda
├── src/
│   ├── core/               # SOF MANTIQ — audio/DOM'siz, to'liq testlanadi
│   │   ├── normalize.ts    # ⭐ YANGI — matnni yozib bo'ladigan ASCII ga keltiradi
│   │   ├── splitSentences.ts
│   │   ├── tokenize.ts
│   │   ├── typing.ts       # reducer
│   │   └── metrics.ts
│   ├── audio/
│   │   ├── AudioManager.ts # Web Audio: prefetch, trim, guard-navbat, fade
│   │   ├── ttsClient.ts
│   │   └── webSpeech.ts
│   ├── store/              # localStorage: lessons.ts, stats.ts (+ JSON eksport)
│   ├── screens/            # Home, Import, Practice, Results, Stats
│   └── components/
└── tests/                  # Vitest projects: core (node) + server (node)
```

**Node 24 da `tsx` KERAK EMAS.** Tekshirildi: `process.features.typescript === "strip"`, ya'ni `node --watch server/index.ts` to'g'ridan-to'g'ri ishlaydi. Buning ikkita oqibati bor:
- Tip tekshiruvi bo'lmaydi → `"typecheck": "tsc --noEmit"` skripti **majburiy** va `npm test` ichiga kiradi.
- `server/**` va `shared/**` da `enum`, `namespace`, dekorator, parametr-xossalari **ishlatilmaydi** (strip ularni qo'llab-quvvatlamaydi).

**Umumiy modul (`shared/filename.ts`) — eng nozik nuqta.** Tekshirildi: Node 24 kengaytmasiz nisbiy importni **rad etadi** (CJS ham, ESM ham: `ERR_MODULE_NOT_FOUND`), Vite esa qabul qiladi. Ya'ni klient qismi kompilyatsiya bo'ladi, server qismi ishga tushganda yiqiladi.
Yechim (uchta qadam, yangi paketsiz):
1. `package.json` da `"type": "module"`.
2. `tsconfig.json` da `"allowImportingTsExtensions": true` + `"noEmit": true`.
3. **Barcha nisbiy importlarda `.ts` kengaytmasi yoziladi** — klientda ham, serverda ham. Vite aniq kengaytmani doim qabul qiladi, Node esa talab qiladi. Bitta qoida, ikki tomon.

`@/` alias **ishlatilmaydi**: Vite uni hal qiladi, `node` esa yo'q.

**Tailwind — v4.** `npm i tailwindcss` v4 o'rnatadi va v3 sozlash tartibi butunlay ishlamaydi (xatosiz, shunchaki nol stil). Aniq yozib qo'yilsin: `npm i tailwindcss @tailwindcss/vite`, `vite.config.ts` da `tailwindcss()` plagini, entry CSS da `@import "tailwindcss";`. `tailwind.config.js` va `npx tailwindcss init` — **yo'q**.

**Ishga tushirish:** `concurrently --kill-others-on-fail "npm:dev:server" "npm:dev:web"`. Bayroqsiz: 8787 band bo'lsa Fastify o'ladi, Vite ishlayveradi va ilova **jimgina** `speechSynthesis` ga tushib qoladi — ya'ni bizning zaxiramiz ishga tushish xatosini yashiradi. UI da "TTS server ulanmadi" ogohlantirishi ko'rsatiladi.

---

## 2. ⭐ Import quvuri (rejaning eng katta yangi qismi)

Avvalgi rejada normalizatsiya bosqichi **umuman yo'q edi**. Bu ikkita jiddiy nuqsonning sababi bo'lgan.

### 2a. Normalizatsiya (`src/core/normalize.ts`)

**Muammo (tekshirilgan):** kitobdan/saytdan nusxalangan matnda klaviaturada **yozib bo'lmaydigan** belgilar bor. `He said, "I don't know—maybe."` ichida `“ ’ — ”` bor. `block` rejimida kursor `“` da turib qoladi, `Tab` ham xuddi shu holatga qaytaradi — gap **hech qachon tugamaydi**.

Import paytida matn bir marta tozalanadi va **normallashtirilgan matn** target sifatida saqlanadi:

| Bosqich | Amal |
|---|---|
| 1 | NFD → birikuvchi diakritikalarni (`U+0300–U+036F`) olib tashlash → NFC. `café→cafe`, `naïve→naive` |
| 2 | Aqlli qo'shtirnoq `“ ” „ ‟` → `"`, apostrof `‘ ’ ‚ ‛` → `'` |
| 3 | Tire `— – ‒ −` → `-`, `…` → `...` |
| 4 | NBSP `U+00A0`, `U+202F`, tab → oddiy probel |
| 5 | Ketma-ket bo'shliqlarni bittaga siqish, `trim()` |
| 6 | Qolgan `0x20–0x7E` dan tashqari har qanday belgi → olib tashlanadi va **ro'yxatga yoziladi** |

Import ekranida asl va tozalangan matn **yonma-yon** ko'rsatiladi, o'zgargan belgilar ajratib beriladi. Foydalanuvchi ko'rmasdan hech narsa o'zgarmaydi.

1-bosqich tufayli tokenizator `[A-Za-z]` bo'lib qolaveradi va to'g'ri ishlaydi — chunki kirish ma'lumoti kafolatlangan ASCII. Aks holda (tekshirilgan) `naïve` → `na`,`ve` bo'lib parchalanardi va `n` bosganda `"na"` eshitilardi.

### 2b. Gapga bo'lish (`splitSentences.ts`) — avvalgi da'vo noto'g'ri edi

**Tekshirildi, `node v24.15.0`:**
```
"Mr. Smith paid $1.50. He left."
  → ["Mr. ", "Smith paid $1.50. ", "He left."]        ← 2 emas, 3 ta!
"The quick brown fox ... lazy dog. It barked twice."
  → ["The quick brown fox ... lazy dog. ", "It ..."]   ← oxirida PROBEL bor
"First line\nsecond line."
  → ["First line\n", "second line."]                   ← \n segment ichida
```
`Intl.Segmenter` da qisqartmalar ro'yxati yo'q. Shuning uchun:
1. `Intl.Segmenter` bilan bo'linadi (asos sifatida yaxshi ishlaydi),
2. so'ng **qisqartma birlashtirish** o'tkaziladi: segment `Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e.g|i.e|a.m|p.m|No` bilan tugasa — keyingisi bilan qo'shiladi,
3. har segment `.replace(/\s+/g," ").trim()` qilinadi.

3-qadam trailing probel muammosini hal qiladi: usiz gap ko'zga tugagandek ko'rinadi, lekin `finished` ishlamaydi va ko'rinmas joyda probel bosish talab qilinadi.

### 2c. Import limitlari

- Paste hajmi **5000 so'z** bilan cheklanadi.
- **40 so'zdan uzun gap** import ekranida belgilanadi va qo'lda bo'lish taklif qilinadi (`block` rejimida uzun gap charchatadi).
- **Darhol boshlash:** dastlabki **3 gap** sintez qilinib mashq ochiladi, qolgani fonda davom etadi. Aks holda 2000 so'zlik matn 4–8 daqiqa bloklangan progress bar demakdir.
- Import uzilib qolsa — qayta ochilganda qolgan so'zlardan davom etadi (`audio-words/` dagi kesh o'zi holat vazifasini bajaradi).

---

## 3. Fayl nomlash (`shared/filename.ts`)

```
default (en-US-AvaNeural, 0%)  ->  <word>.mp3          the.mp3, don't.mp3
katta harfli qisqartma          ->  <word>@caps.mp3     US -> us@caps.mp3
boshqa ovoz/tezlik              ->  <word>@<Voice>@<rate>.mp3
```

- Normalizatsiyadan keyin so'z doim `/^[a-z]+(?:['-][a-z]+)*$/` ga mos keladi. Apostrof va tire **saqlanadi** → `don't` va `don-t` to'qnashmaydi. HTTP yo'lida `encodeURIComponent`.
- **Qisqartmalar:** normal qoida bilan `US` → `us.mp3` bo'lib, /ʌs/ deb o'qilardi. Barcha harfi katta va uzunligi ≥2 bo'lgan token alohida `@caps` fayliga tushadi va **asl katta harfli shakli** sintez qilinadi.
- **Ma'lum cheklov — omograflar.** So'zlar alohida sintez qilinadi va umrbod keshlanadi, shuning uchun `read`, `live`, `wind`, `lead`, `tear`, `record` birinchi sintezdagi talaffuzda **abadiy qotib qoladi**. Yumshatish: `overrides.json` — `{"read": "reed"}` ko'rinishidagi qo'lda tuzatiladigan jadval; sintez matni almashadi, fayl nomi imlodan olinadi.
- **Raqamlar** (`$1.50`, `2024`) tokenizatordan tashqarida — `gap` token bo'ladi, ovozi yo'q, lekin yozish shart.

---

## 4. Yozuv dvigateli (`src/core/typing.ts`)

Sof reducer, audio/DOM'siz:

```ts
type Key = { type:'char'; char:string } | { type:'backspace' }
type Event = Key
  | { type:'playbackStarted';  tokenIndex:number }   // ⭐ YANGI
  | { type:'playbackFailed';   tokenIndex:number }   // ⭐ YANGI

type Effect = { type:'playWord'; tokenIndex:number } | { type:'finished' }

function reduce(s:TypingState, e:Event): { state:TypingState; effects:Effect[] }
```

`TypingState`: `{ target, cursor, typed[], errorCounts:Map<tokenIndex,number>, charErrors:Map<charIndex,number>, pendingWords:Set, playedWords:Set, keystrokes, correctKeystrokes, startedAt, lastKeyAt, finishedAt }`

### ⭐ Eng muhim tuzatish: ovoz *chiqqanda* belgilanadi

Avvalgi rejada token `playWord` effekti **yuborilganda** `playedWords`ga qo'shilardi. Reducer sof bo'lgani uchun ovoz haqiqatan chiqqanini bilmaydi. Natijada quyidagilarning **har biri** so'zni "o'qilgan" deb belgilab, uni bir martalik qoida bo'yicha **abadiy o'chirardi**:

prefetch hali tugamagan · `decodeAudioData` buzuq MP3 da yiqilgan · sintez o'sha so'z uchun muvaffaqiyatsiz · `speechSynthesis` ovozlari hali yuklanmagan (`voiceschanged` kelmagan) · `AudioContext` `suspended` holatda · quloqchin uzilgan.

Va siz buni **sezmaysiz** — jimlik ham "eshitilgan", ham "hech qachon eshitilmagan" degani.

Yangi qoida:
> To'g'ri harf so'z boshiga tushsa → token `pendingWords`ga qo'shiladi va `playWord` chiqadi.
> `playbackStarted` kelganda → `playedWords`ga o'tadi (endi qayta o'qilmaydi).
> `playbackFailed` kelganda → `pendingWords`dan **chiqariladi** (yana o'qilishi mumkin).

Bu shartingizni buzmaydi: ovoz chiqmagan so'z "bir marta o'qilgan" hisoblanmaydi.

### Chegaraviy holatlar

| Holat | Yechim |
|---|---|
| Noto'g'ri 1-harf | Kursor siljimaydi → ovoz yo'q. |
| Backspace + qayta yozish | Ovoz chiqmaydi — so'z `playedWords`da. |
| Bosh harf (`T` vs `t`) | **Qat'iy.** `t` xato, kursor turadi, Shift talab qilinadi. |
| Bir harfli so'z (`a`, `I`) | Bir xil qoida; audio §5 dagi guard bilan to'liq eshitiladi. |
| Takrorlangan so'z (`the ... the`) | Har uchrashuv alohida token → har biri bir martadan. |
| So'z boshi 0-indeksda emas (`"The cat`) | Qoida `t.start` ga tayanadi, `cursor===0` ga emas. Test bilan qoplangan. |
| `forgiving` rejimi | **v1 ga kiritilmaydi.** Unda kursor so'z boshidan noto'g'ri harf bilan o'tib ketadi va ovoz **hech qachon** chiqmaydi — jimgina buziladi. Faqat `block`. |
| Gapni qayta boshlash (`Tab`) | Yangi holat → `playedWords` bo'shaydi. |
| Xato hisobi | Backspace `errorCounts`ni tozalamaydi. |

### Klaviatura adapteri (avval umuman yozilmagan edi)

`window.keydown` → `Event` aylantirish qoidasi:
- Harf sifatida qabul qilinadi: `e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing`
- `Backspace` → `{type:'backspace'}`
- `Enter` → gap tugagan bo'lsa keyingisiga o'tadi
- `Escape` → gapni tashlab ketadi (statistikaga kirmaydi)
- `Tab` → gapni qayta boshlaydi
- Boshqa hammasi **e'tiborsiz qoldiriladi**
- `preventDefault()`: `Space`, `Tab`, `Backspace`, `Enter`, `Escape`

Filtrsiz `Ctrl+A` → `e.key === "a"` bo'lib **to'g'ri harf** deb hisoblanardi va `a` bilan boshlanadigan so'z ovozini chiqarardi; `Ctrl+R` → `"r"` yozilib, sahifa qayta yuklanardi; strelkalar `typed[]` ga 10 belgili satr solardi.

---

## 5. Audio quvuri

### 5a. Server (`server/tts.ts`) — manbadan tekshirilgan uchta kritik xato

`@andresaya/edge-tts@1.8.0`, `dist/services/EdgeTTS.js` o'qib tasdiqlandi:

| Xato | Manba | Oqibat va yechim |
|---|---|---|
| **Instance holati** | `:173` `this.audio_stream=[]`, `:176` `this.ws=…`, `:388` `this.ws?.close()` | Bitta obyekt 4 parallel chaqiruvda audiolarni aralashtiradi/kesadi va **boshqa** so'zning socketini yopadi. → **Har so'zga `new EdgeTTS()`**, hech qachon qayta ishlatilmaydi. |
| **Bo'sh audioda ham muvaffaqiyat** | `:214-219` — `close` da `resolve()`, `audio_stream.length` tekshirilmaydi | Sintez "muvaffaqiyatli" tugaydi, xato esa `toBuffer()` da chiqadi. Retry `synthesize()` atrofida bo'lsa **hech qachon ishlamaydi**. → `synthesize()` **va** `toBuffer()` bitta `try` ichida; `buf.length < 1024` retry sababi. |
| **Ulanish taymeri yo'q** | `:187-196` — 30 s taymer faqat `ws.on('open')` ichida yoqiladi; `handshakeTimeout` berilmagan | Socket ochilmay osilsa — abadiy kutadi, 4 slot band bo'lib server qotadi. → `Promise.race([synthesize(), rejectAfter(20_000)])`. |

Qo'shimcha: `validateRate` da **diapazon tekshiruvi yo'q** (`:140-154`) — noto'g'ri qiymat buzuq SSML → bo'sh audio → yuqoridagi 2-xato. `toFile('quick.mp3')` → `quick.mp3.mp3` yasaydi (`:475`), shuning uchun `toBuffer()` + o'z `writeFile` imiz ishlatiladi. Kutubxona defaulti `AnaNeural` (`AvaNeural` emas) — ovoz doim aniq beriladi.

**Endpointlar:**
- `POST /api/tts/batch` `{ words[], voice, rate }` — `voice` ma'lum ro'yxatga, `rate` `{0,-10,-25}` ga qarshi tekshiriladi, `words.length ≤ 200`. Validatsiyasiz `voice:"../../../.config/x"` fayl nomiga tushib, `audio-words/` dan tashqariga yozardi.
- `GET /api/audio/:file` — `path.basename` majburiy, `Cache-Control: max-age=31536000` (yalang'och `immutable` emas).
- `@fastify/static` + `setNotFoundHandler` → `index.html` (SPA fallback). Usiz beshta ekranning hammasi sahifa yangilanganda 404 beradi. `/api/*` marshrutlari **oldin** ro'yxatdan o'tkaziladi.
- Ishga tushishda `fs.mkdir('audio-words', {recursive:true})` — usiz birinchi yozuv `ENOENT` beradi.

**Atomik yozish (`store.ts`).** Avvalgi reja `fs.access` bilan kesh tekshirardi — bu TOCTOU. `Ctrl+C` yoki React 19 StrictMode ning ikki marta chaqiriladigan effekti yarim yozilgan MP3 qoldiradi; `fs.access` uni **abadiy kesh urdi** deb ko'radi va o'sha so'z umrbod jim bo'ladi. Yechim: `<nom>.<pid>.tmp` ga yozish → hajm va MP3 sarlavhasini (`ID3` / `0xFFEx`) tekshirish → `fs.rename` (ext4 da atomik). Ustiga `Map<filename, Promise>` in-flight dedup.

### 5b. Klient (`src/audio/AudioManager.ts`)

- `AudioContext` — **modul darajasidagi singleton**, effekt ichida emas (StrictMode ikkitasini yaratardi). Mashq ekraniga o'tishdagi `pointerdown` **yoki** `keydown` da `resume()` — faqat klik bilan bog'lansa, Enter bilan kirgan foydalanuvchining birinchi so'zi yo'qolardi.
- **Har ijroga yangi `AudioBufferSourceNode`.** Node bir martalik: ikkinchi `start()` `InvalidStateError` beradi va butun seans ovozi o'ladi. "Bitta kanal" — bu *joriy nodega ishora qiluvchi bitta o'zgaruvchi*, qayta ishlatiladigan node emas.
- **Dekodlangan `AudioBuffer` keshlanadi, `ArrayBuffer` emas** — `decodeAudioData` kirish buferini yo'q qiladi (detach), shuning uchun baytlarni qayta dekodlash jimlik beradi.
- **Boshidagi jimlikni kesish.** MP3 kodlovchi kechikishi + Microsoft padding ~100–200 ms. Dekoddan keyin 0-kanal bo'ylab birinchi `|sample| > 0.01` qidiriladi va `src.start(0, offset)` bilan ijro shu joydan boshlanadi. Qisqa so'zlar uchun bu hal qiluvchi: usiz `a` (150 ms oyna) **faqat jimlik** bo'lardi.
- **⭐ Qisqa so'z guard'i.** `GUARD_MS = 250`, `MAX_LAG_MS = 300`.
  Yangi so'z kelganda: joriy ijro `GUARD_MS` dan kam bo'lsa **va** to'plangan kechikish `MAX_LAG_MS` dan oshmasa → yangi so'z `startedAt + GUARD_MS` ga rejalashtiriladi; aks holda joriy ijro so'ndiriladi va yangisi darhol boshlanadi. Kutish slotida bitta so'z turadi; undan ham yangisi kelsa, kutayotgani tashlanadi (`playedWords`ga tushmagani uchun holat buzilmaydi, lekin u so'z eshitilmaydi — `MAX_LAG_MS` tufayli bu kamdan-kam bo'ladi).
- **Uzishda fade.** Yalang'och `.stop()` to'lqinni tasodifiy nuqtada kesadi → "chirs" etadi. Uzish bu yerda **odatiy yo'l**, chekka holat emas, shuning uchun har ijro `GainNode` orqali o'tadi: `gain.setTargetAtTime(0, now, 0.005)` + `stop(now + 0.02)`.
- **Zaxira `speechSynthesis`:** `voiceschanged` kutiladi (`getVoices()` boshida bo'sh), foydalanuvchi harakatida alohida "isitiladi", `.cancel()` → `speak()` poygasi hisobga olinadi. Muvaffaqiyatsizlikda `playbackFailed` yuboriladi.
- `voice`/`rate` mashq o'rtasida o'zgarsa — fayl nomi o'zgaradi, shuning uchun butun bufer keshi tozalanadi.

---

## 6. Statistika

`localStorage`: `dnt.lessons.v1`, `dnt.stats.v1`.

- **Net WPM** = `(to'g'ri belgilar / 5) / daqiqa`, **Raw WPM** alohida.
- **Aniqlik** = `to'g'ri bosishlar / jami bosishlar`.
- **Xato so'zlar — ta'sirlanish soniga nisbatan.** `{word: {exposures, errors}}` saqlanadi, ro'yxat `errors/exposures` bo'yicha va faqat `exposures ≥ 5` bo'lganlar orasida tartiblanadi. Xom son bo'yicha tartiblansa ro'yxat boshini doim `the` egallardi — 200 marta uchraydi, qiyin bo'lgani uchun emas.
- **Seriya (streak)** aniq ta'rif bilan: kunlik ≥100 to'g'ri bosish. Aks holda bitta gap seriyani ushlab turaverardi.
- **Aniq qoidalar:** taymer **birinchi bosishda** boshlanadi; bosishlar orasi **5 s** dan oshsa taymer pauza qiladi; `Tab` bilan qayta boshlangan urinish statistikaga **kirmaydi** (lekin qayta boshlash soni gap bo'yicha yoziladi); `Escape` bilan tashlangan gap chiqarib tashlanadi. Bu qoidalar yozilmasa, kod ularni tasodifan hal qiladi va WPM trendi siz tanlamagan narsani o'lchaydi.
- **JSON eksport/import — M4 da**, M5 da emas. Oylab yig'ilgan xato-so'z tarixi bitta "clear browsing data" bilan yo'qoladi; bu ~30 qator kod.
- Grafiklar: qo'lda yozilgan inline SVG. Chart kutubxonasi yo'q.

---

## 7. Seans oqimi (avval umuman yozilmagan edi)

| Savol | Qaror |
|---|---|
| Gap tugagach? | `finished` → **`Enter` kutiladi**. Avtomatik o'tilsa har gapning oxirgi so'zi doim yarim eshitilardi. |
| Taymer qachon? | Birinchi bosishda. |
| Skip bormi? | `Escape` — gap tashlanadi, statistikaga kirmaydi. Usiz noma'lum imloda seans boshi berk ko'chaga kirardi. |
| Bo'sh turish | Bosishlar orasi >5 s → taymer pauza. |
| Davom ettirish | **Gap darajasida.** Yarim yozilgan gap tashlanadi. Kursorni gap o'rtasidan tiklash mumkin emas: o'tib ketilgan so'z boshi endi hech qachon ovoz bermaydi. |
| Seans uzunligi | 20 gap yoki 10 daqiqa — qaysi biri oldin tugasa → Natijalar ekrani. |
| "Dars" nima? | Bitta import qilingan matn. Seans — uning bir bo'lagi. |

---

## 8. Bosqichlar

**M1 — Sof mantiq (audiosiz).** Skelet, `normalize` + `splitSentences` + `tokenize` + `typing` + `metrics` va ularning testlari; audiosiz `Practice` ekrani.
→ *Natija:* gapni terasiz, ranglar va WPM ishlaydi.

**M2 — TTS server va asosiy mexanika.** `server/*` (yangi instance, timeout, atomik yozish), `AudioManager` (trim, guard, fade), `playbackStarted/Failed` zanjiri.
→ *Natija:* 1-harfda so'z bir marta va **to'liq** eshitiladi.

**⭐ M2/M3 oralig'idagi gate — bir haftalik shaxsiy tekshiruv.** Matn ko'rinib turgani uchun mashqni **ovozsiz ham** bajarish mumkin — ya'ni audio vazifa uchun majburiy emas, faqat qo'shimcha. Bir hafta kunma-kun almashtirib (ovoz yoqiq / o'chiq) bir xil hajmdagi matn teriladi. Agar WPM, aniqlik va xato so'zlar taqsimoti farq qilmasa — audio qayta ishlanmayapti va M3–M5 ni qurishdan oldin mexanikani qayta ko'rib chiqish kerak. Bu gipotezani tekshirishning eng arzon yo'li va baribir qiladigan mashqingizdan boshqa hech narsa talab qilmaydi.

**M3 — Import va saqlash.** Paste → normalizatsiya diff'i → gap bo'linishini tuzatish → dastlabki 3 gapdan darhol boshlash → fonda davom etish. Dars ro'yxati, gap darajasida davom ettirish.

**M4 — Statistika, natijalar, eksport.** Seans yozuvi, Natijalar/Statistika ekranlari, SVG grafiklar, ta'sirlanishga nisbatan xato reytingi, JSON eksport/import.

**M5 — Sayqal.** Sozlamalar (ovoz, tezlik), yorliqlar, tungi rejim, bo'sh holatlar.

---

## 9. Tekshirish

**`npm test` = `tsc --noEmit` + Vitest** (`test.projects`: `core` va `server` alohida — sof mantiq testlari React plagini va `/api` proksisini tortib kelmasligi uchun).

`src/core`:
- `normalize`: `He said, "I don't know—maybe."` natijasida `0x20–0x7E` dan tashqari belgi **qolmaydi**; `café naïve` → `cafe naive`; ketma-ket probellar siqiladi; o'zgargan belgilar ro'yxati qaytariladi.
- `splitSentences`: `"Mr. Smith paid $1.50. He left."` → **2** ta gap (qisqartma birlashtirish ishlaydi); hech bir segmentda bosh/oxirgi bo'shliq **qolmaydi**; `"First line\nsecond line."` → 2 ta gap, `\n` siz.
- `tokenize`: `Don't stop - it's fine.` da offsetlar to'g'ri; `US` → bitta token; `3D-printed` da token `D-printed` dan boshlanishi **hujjatlashtirilgan** holat sifatida tasdiqlanadi.
- `filename`: `The`→`the.mp3`; `US`→`us@caps.mp3`; `don't` va `don-t` → **turli** fayllar; `-25%` → `@` yorlig'i.
- `typing`:
  - `t` target `T` ga qarshi → **xato**, kursor turadi (qat'iy bosh harf);
  - har so'z boshida aynan bitta `playWord`;
  - backspace + qayta yozish → `playWord` **yo'q**;
  - `playbackFailed` dan keyin **o'sha token qayta o'qilishi mumkin**;
  - `"the cat and the dog"` → 2 ta alohida `playWord`;
  - `"The cat," he said.` → birinchi token **1-indeksda**, `playWord` baribir chiqadi;
  - `Ctrl+A`, `ArrowLeft`, `F5` → hech qanday holat o'zgarmaydi;
  - `Tab` dan keyin ovozlar tiklanadi; oxirgi belgidan keyin `finished`.
- `metrics`: qo'lda hisoblangan qiymatga tenglik; 5 s dan uzun tanaffus taymerga qo'shilmaydi.

`server` (tarmoqsiz, sintez funksiyasi stub bilan):
- bir xil so'z ikki parallel so'rovda → **bitta** sintez chaqiruvi (in-flight dedup);
- yarim yozilgan `.tmp` qolsa → kesh urishi **hisoblanmaydi**;
- 0 baytli / sarlavhasiz bufer → retry, keyin `muvaffaqiyatsiz` ro'yxatiga;
- `voice:"../../x"` va `rate:"-500"` → **400**;
- `words.length = 500` → 400.

**Tarmoqli smoke** (`npm run smoke`, `npm test` ichida emas — Microsoft endpointiga bog'liq bo'lgani uchun): 2 ta so'z sintez qilinadi, `audio-words/` da 2 ta MP3 (>1 KB) paydo bo'ladi, **pastki papka yaratilmaydi**, ikkinchi chaqiruv sintezsiz o'tadi.

**Qo'lda E2E** (`npm run dev`):
1. `rm -rf node_modules && npm i && npm run dev` → global paketsiz ishga tushadi; 8787 band bo'lsa **ikkalasi ham to'xtaydi** (jimgina degradatsiya emas).
2. Saytdan aqlli qo'shtirnoqli xatboshi paste qilinadi → normalizatsiya diff'i ko'rinadi → **gap oxirigacha yozib bo'ladi** (avvalgi rejada bu joyda qotib qolardi).
3. Har so'zning 1-harfida o'sha so'z eshitiladi; `a`, `I`, `is` **to'liq** eshitiladi (guard ishlayapti).
4. Backspace + qayta yozish → ovoz takrorlanmaydi. `Tab` → ovozlar tiklanadi.
5. Serverni to'xtatib davom etish → `speechSynthesis` zaxirasi ishlaydi; DevTools da `/api/tts/batch` ni bloklab qo'yish → o'sha so'z **keyin ham eshitilishi mumkin** (`playbackFailed` zanjiri).
6. `audio-words/quick.mp3` ni 0 baytga qisqartirish → dastur uni rad etadi va qayta sintez qiladi.
7. Gapni tugatish → `Enter` kutiladi, oxirgi so'z audiosi kesilmaydi → Natijalar; sahifa yangilangach statistika joyida.

---

## 10. Xatarlar

- **Audio vazifa uchun majburiy emas.** Matn ko'rinib turgani uchun mashqni ovozsiz ham bajarish mumkin; audio o'qilgandan **keyin** keladi. Butun pedagogik da'vo shu oqimning e'tiborga olinishiga tayanadi. → M2/M3 oralig'idagi gate (§8).
- **Bu "dictation" emas.** Eshitib-yozish emas, imlo↔talaffuz bog'lanishi mashq qilinadi — o'zbek tilida imlo deyarli fonematik, ingliz tilida esa yo'q, shuning uchun qiymati bor, lekin **tinglab tushunish o'rgatilmaydi**. Bog'langan nutq uchun mavjud `noji/phrasal-verbs/tts.sh` quvuri ishlatilaveradi; dars ekranidan gaplarni `tts.sh` qabul qiladigan `.txt` ga eksport qilish tugmasi qo'shiladi.
- **Alohida sintez = lug'aviy (citation) talaffuz.** `of` → to'liq /ʌv/, tabiiy nutqdagi /əv/ emas; `a` → /eɪ/, /ə/ emas. Bu tuzatib bo'lmaydigan cheklov, faqat bilib turish kerak.
- **`edge-tts` — norasmiy Microsoft endpoint.** Yumshatish: disk keshi, `speechSynthesis` zaxirasi, parallellik ≤4, timeout, retry.
- **`localStorage` — yagona nusxa.** Bitta "clear browsing data" oylik tarixni o'chiradi; ikkita ochiq tab oxirgi yozganini g'olib qiladi. → M4 da JSON eksport. `audio-words/` uchun `tar` zaxirasi README ga yoziladi.
- **`shared/filename.ts` ikki toolchain ostida.** Kelishmasa kesh hech qachon urmaydi. → bitta fayl, aniq `.ts` kengaytmasi, testlar bilan qoplangan.
- **Mobil klaviatura/IME**: v1 `window.keydown` ga tayanadi, telefonda ishonchli emas.
