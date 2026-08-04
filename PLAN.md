# Dictation + Typing — loyiha rejasi

## Context

Maqsad: inglizcha eshitish (dictation) va tez yozish (typing) mashqini **bitta harakatga** birlashtirgan shaxsiy web-ilova.

Asosiy mexanika:
> Har bir so'zning **birinchi harfini** yozganda, o'sha so'z **to'liq o'qiladi** — va bir urinish ichida **faqat bir marta**. Foydalanuvchi eshitgan so'zini qolgan harflarini yozish davomida mustahkamlaydi.

Ovoz va yozuv shu tarzda vaqt bo'yicha ustma-ust tushadi: so'z ~500 ms o'qiladi, qolgan harflar ~500 ms da teriladi. Shuning uchun mashq "eshitdim → keyin yozdim" emas, "eshitayotib yozyapman" bo'ladi — imlo va talaffuz bir vaqtda mustahkamlanadi.

Tanlangan qarorlar:
- **To'liq matn ko'rinib turadi** (typing trenajyor + talaffuz rejimi), yashirin dictation emas.
- **Web app** (brauzer), backend faqat TTS uchun lokal.
- **Gibrid audio**: `edge-tts` neural MP3 asosiy, brauzer `speechSynthesis` zaxira.
- **Kontent**: matn paste qilish. **Statistika** (WPM, aniqlik, xato so'zlar) kerak.
- **Har so'z urinish ichida bir martadan ortiq o'qilmaydi.** Gapni qayta boshlaganda ovozlar yangidan ishlaydi.
- **Faqat so'z audiosi.** Butun gapni tinglash imkoniyati yo'q — hech qanday qayta tinglash tugmasi qo'yilmaydi.
- **Barcha audio bitta yassi `audio-words/` papkada**, fayl nomi — so'zning o'zi (`quick.mp3`).
- **Global npm paket ishlatilmaydi** — hamma narsa loyihaning `node_modules`ida.
- Doirada emas: noji `.md` import, SRS/interval takrori, yashirin rejimlar. (Keyinchalik qo'shsa bo'ladigan qilib arxitektura ochiq qoladi.)

Loyiha papkasi hozir bo'sh — noldan quriladi. Muhit: `node v24.15.0`, `npm 11.12.1`.

---

## Arxitektura

Bitta npm paket, ikkita ishga tushish nuqtasi. Monorepo/workspaces shart emas.

```
dictation-and-typing/
├── package.json            # dev = concurrently server + web
├── vite.config.ts          # /api -> localhost:8787 proxy
├── node_modules/           # @andresaya/edge-tts SHU YERDA (global emas)
├── server/
│   ├── index.ts            # Fastify: /api/tts/batch, /api/audio/:file, prod'da statik dist
│   ├── tts.ts              # EdgeTTS wrapper: navbat (≤4), retry
│   └── store.ts            # audio-words/ ga yozish, fs.access bilan kesh tekshiruvi
│                           #   (nomlashni src/core/filename.ts dan import qiladi)
├── audio-words/            # .gitignore'da — YASSI, hamma MP3 shu yerda
├── src/
│   ├── core/               # SOF MANTIQ — audio/DOM'siz, to'liq testlanadi
│   │   ├── tokenize.ts
│   │   ├── splitSentences.ts
│   │   ├── typing.ts       # reducer
│   │   ├── filename.ts     # server bilan BIR XIL nomlash (shared)
│   │   └── metrics.ts
│   ├── audio/
│   │   ├── AudioManager.ts # Web Audio: prefetch, uzib-qo'yish (interrupt)
│   │   ├── ttsClient.ts    # /api/tts/batch
│   │   └── webSpeech.ts    # zaxira
│   ├── store/              # localStorage: lessons.ts, stats.ts
│   ├── screens/            # Home, Import, Practice, Results, Stats
│   └── components/         # SentenceView, charts/
└── src/core/__tests__/     # Vitest
```

**Nega lokal server kerak:** `edge-tts` — Microsoft'ga WebSocket ochadigan Node kutubxonasi, brauzerdan chaqirib bo'lmaydi. Foydalanuvchi ixtiyoriy matn paste qilgani uchun MP3'ni oldindan tayyorlab qo'yish mumkin emas — talab bo'yicha generatsiya qilinadi va diskda keshlanadi.

**Paketlar:** `npm i @andresaya/edge-tts` loyihaga o'rnatiladi va `import { EdgeTTS } from '@andresaya/edge-tts'` bilan chaqiriladi. Global o'rnatmaga ham, `tts.sh`ga ham bog'liqlik yo'q — `git clone && npm i` bilan loyiha to'liq tiklanadi.

Stack: React 19 + TypeScript + Vite + Tailwind + Fastify + Vitest. Og'ir kutubxona yo'q (chart ham qo'lda SVG).

---

## Yurak: yozuv dvigateli (`src/core/typing.ts`)

Butun mexanika **sof reducer**ga yig'iladi — audio va DOM'siz, shuning uchun to'liq testlanadi. Bu rejadagi eng muhim dizayn qarori.

```ts
type Effect = { type: 'playWord'; tokenIndex: number } | { type: 'finished' }
type Key    = { type: 'char'; char: string } | { type: 'backspace' }

function reduce(s: TypingState, k: Key): { state: TypingState; effects: Effect[] }
```

`TypingState`: `{ target, cursor, typed[], errorIndices:Set, playedWords:Set, keystrokes, correctKeystrokes, startedAt, finishedAt }`

**Ovoz qoidasi (aniq ta'rif):**
> Kursor `i` pozitsiyada **to'g'ri** harf yozilsa **va** `i` biror so'z tokenining `start` indeksi bo'lsa **va** bu token hali `playedWords`da bo'lmasa → `playWord` effekti chiqadi va token `playedWords`ga qo'shiladi.
>
> Shundan keyin bu so'z shu urinish davomida **boshqa o'qilmaydi**.

Chegaraviy holatlar va yechimlar:

| Holat | Yechim |
|---|---|
| Noto'g'ri 1-harf | Kursor siljimaydi → ovoz **yo'q**. |
| Backspace qilib qayta yozish | Ovoz **chiqmaydi** — so'z allaqachon o'qilgan. |
| Bir harfli so'z (`a`, `I`) | Bir xil qoida ishlaydi, alohida kod kerak emas. |
| Bir gapda takrorlangan so'z (`the ... the`) | Har **uchrashuv** alohida token → har biri o'z navbatida bir martadan o'qiladi. |
| Juda tez yozish | Yangi so'z avvalgisini **uzib** qo'yadi (bitta playback kanali). Doim joriy so'z eshitiladi. |
| Gapni qayta boshlash (`Tab`) | Yangi `TypingState` → `playedWords` bo'shaydi, ovozlar qaytadan ishlaydi. |
| Xato hisobi | Backspace `errorIndices`'ni tozalamaydi — aniqlik halol qoladi. |

`playedWords` tufayli debounce, taymer va "so'nggi ijro vaqti" kabi holatlar **umuman kerak emas** — mantiq soddalashadi va deterministik bo'ladi.

**Xato rejimi:** default `block` — to'g'ri harf yozilmaguncha kursor turadi (imlo uchun muhim). Sozlamada `forgiving` (qizil bo'lib o'tib ketadi) varianti ham bo'ladi.

**Tokenizatsiya** (`tokenize.ts`): `/[A-Za-z]+(?:['’-][A-Za-z]+)*/g` — `don't`, `well-known` to'g'ri ushlanadi. Regex orasidagi hamma narsa (probel, tinish belgisi) `gap` token. Foydalanuvchi **asl matnni to'liq**, tinish belgilari bilan teradi.

**Gapga bo'lish** (`splitSentences.ts`): `Intl.Segmenter('en', { granularity: 'sentence' })` — Node 24 va barcha zamonaviy brauzerlarda bor, `Mr. Smith` / `e.g.` muammosini o'zi hal qiladi. Regex ishlatilmaydi. Import ekranida natijani qo'lda tuzatish mumkin.

---

## Audio quvuri

### Saqlash — bitta yassi papka, o'qiladigan nomlar

Barcha MP3 `audio-words/` ichida, pastki papkasiz. Fayl soni 15 000 dan oshsa ham muammo yo'q: ext4 `dir_index` (htree) tufayli ilova to'g'ridan-to'g'ri yo'l bo'yicha ochadi. Faqat `ls` kabi papkani to'liq o'qiydigan buyruqlar sekinlashadi — **ilova papka ro'yxatini hech qachon o'qimaydi**, kesh bor-yo'qligini aniq yo'ldan `fs.access` bilan tekshiradi.

Fayl nomi qoidasi (`filename.ts`, server va klientda **bir xil** kod):

```
lowercase + Unicode ’ -> ASCII '
default ovoz (en-US-AvaNeural) va tezlik (0%)  ->  <word>.mp3
boshqa ovoz yoki tezlik                        ->  <word>@<VoiceShort>@<rate>.mp3
```

```
audio-words/
  the.mp3
  quick.mp3
  don't.mp3
  well-known.mp3
  quick@SoniaNeural@-25.mp3
```

- Tokenizator faqat `[A-Za-z' -]` chiqargani uchun nom doim `/^[a-z]+(?:['-][a-z]+)*$/` ga mos keladi — apostrof va tire **o'zgartirilmaydi**, shuning uchun `don't` va `don-t` to'qnashmaydi. ext4 bu belgilarni bemalol qabul qiladi; HTTP yo'lida `encodeURIComponent` bilan uzatiladi.
- Naqshga mos kelmagan kutilmagan holat uchun zaxira: sha1 hash nomi (himoya chorasi, normal ishda ishlamaydi).
- `The`, `the`, `"the` → hammasi `the.mp3` ga tushadi (kichik harf + tinish belgisi tokenizatsiyada tushib qoladi).

### Server (`server/tts.ts`)

`EdgeTTS` klassini kutubxona sifatida ishlatadi (`.synthesize()` → `.toBuffer()`), `tts.sh` chaqirilmaydi:

- `POST /api/tts/batch` → `{ words[], voice, rate }`. Har so'z uchun fayl nomi hisoblanadi; kesh bor bo'lsa o'tkazib yuboriladi, yo'q bo'lsa sintez qilinadi. Javob: `{ word: url }` + muvaffaqiyatsizlar ro'yxati.
- `GET /api/audio/:file` → `audio-words/` dan beradi, `Cache-Control: immutable`. Yo'l traversal himoyasi: `path.basename` majburiy, `..` va `/` rad etiladi.
- Parallellik **≤ 4** (har sintez alohida WebSocket ochadi), xatoda backoff bilan 2 marta qayta urinish.
- Gap audiosi endpoint'i **yo'q** — faqat so'zlar sintez qilinadi.

So'zlar **butun korpus bo'yicha deduplikatsiya** qilinadi — `the` umri davomida bir marta sintez qilinadi. 500 so'zli matnda odatda ~250 ta unikal so'z; papka vaqt o'tib ingliz tilining chastotali yadrosi bilan to'ladi va yangi darslar deyarli darhol ochiladi.

### Klient (`src/audio/AudioManager.ts`)

- Gap ochilganda o'sha gapdagi unikal so'zlar **oldindan yuklanadi** va `AudioBuffer` sifatida xotirada turadi → bosishda kechikish 0 ms. `<audio>` elementi emas, **Web Audio API** (`decodeAudioData` + `AudioBufferSourceNode`).
- **Zaxira:** server o'chiq bo'lsa yoki so'z sintez bo'lmasa → `speechSynthesis` (har chaqirishdan oldin `.cancel()`, `en-*` ovoz tanlanadi). Ilova serversiz ham ishlaydi, faqat ovoz sifati pastroq.
- **Tezlik sozlash:** `rate` (`0%` / `-10%` / `-25%`) fayl nomiga kiradi. Sekinroq ovoz — so'z hali eshitilib turganda qolgan harflar teriladi, mustahkamlash kuchayadi.

---

## Statistika

Seans yozuvi: `localStorage['dnt.stats.v1']` (lesson'lar `dnt.lessons.v1`). Shaxsiy foydalanish uchun hajmi yetarli; kerak bo'lsa keyin IndexedDB'ga ko'chiriladi.

- **Net WPM** = `(to'g'ri belgilar / 5) / daqiqa`, **Raw WPM** ham alohida.
- **Aniqlik** = `to'g'ri bosishlar / jami bosishlar`.
- **Xato so'zlar reytingi** — qaysi so'zda necha marta qoqildingiz (seanslar bo'ylab yig'iladi). Bu keyinchalik SRS qo'shish uchun tayyor ma'lumot.
- Kunlik seriya (streak), umumiy vaqt, WPM dinamikasi.

Grafiklar — **qo'lda yozilgan inline SVG** (`components/charts/`): WPM chizig'i + xato so'zlar bar ro'yxati. Chart kutubxonasi qo'shilmaydi.

---

## Bosqichlar

**M1 — Skelet va sof mantiq (audiosiz)**
`package.json`, `vite.config.ts`, Tailwind, `src/core/*` + Vitest testlari, `Practice.tsx`ning audiosiz varianti.
→ *Natija:* qattiq yozilgan gapni terasiz, harflar yashil/qizil bo'ladi, WPM hisoblanadi.

**M2 — TTS server va asosiy mexanika**
`server/*`, `AudioManager`, `ttsClient`, `webSpeech`; `playWord` effektini ulash.
→ *Natija:* 1-harfni bosganda so'z bir marta o'qiladi. Loyihaning yuragi ishlaydi.

**M3 — Matn import va saqlash**
Paste ekrani → gapga bo'lish ko'rinishi (qo'lda tuzatiladi) → audio tayyorlash progress bari → saqlash. Lesson ro'yxati, to'xtagan joydan davom etish.

**M4 — Statistika va natijalar**
Seans yozuvi, `Results.tsx`, `Stats.tsx`, SVG grafiklar, xato so'zlar reytingi.

**M5 — Sayqal**
Sozlamalar (ovoz, tezlik, block/forgiving), klaviatura yorliqlari, tungi rejim, bo'sh holat ekranlari.

---

## Tekshirish (verification)

**Avtomatik** — `npm test` (Vitest):
- `tokenize`: `"Don't stop — it's fine."` da so'z chegaralari va offsetlar to'g'ri; apostrof va tire so'z ichida qoladi.
- `splitSentences`: `"Mr. Smith paid $1.50. He left."` → **2** ta gap.
- `filename`: `The` → `the.mp3`; `don't` va `don-t` → **turli** fayllar; `-25%` tezlik → `@` yorlig'i qo'shiladi; default ovoz/tezlik → yorliqsiz.
- `typing` reducer:
  - to'g'ri harf → kursor siljiydi; noto'g'ri harf `block` rejimida siljitmaydi;
  - backspace `errorIndices`ni tozalamaydi;
  - har so'z boshida **aynan bitta** `playWord` effekti;
  - **backspace qilib 1-harfni qayta yozish `playWord` chiqarmaydi**;
  - `"the cat and the dog"` → **2 ta** alohida `playWord` (`the` ikki uchrashuv);
  - holatni qayta yaratish (`Tab`) → ovozlar yana ishlaydi;
  - oxirgi belgidan keyin `finished`.
- `metrics`: ma'lum bosishlar ketma-ketligi uchun WPM/aniqlik qo'lda hisoblangan qiymatga teng.

**Server** — `npm run test:server`:
- `POST /api/tts/batch` ikki so'z bilan → `audio-words/` da `the.mp3`, `quick.mp3` paydo bo'ladi (hajmi > 1 KB), **pastki papka yaratilmaydi**.
- Xuddi shu so'rov ikkinchi marta → yangi sintez **bo'lmaydi** (kesh urishi), javob sezilarli tezroq.
- `The`, `the`, `"the"` → bitta faylga tushadi.
- `GET /api/audio/..%2F..%2Fetc%2Fpasswd` → 400/404 qaytaradi.

**Qo'lda E2E** — `npm run dev` (server :8787 + web :5173):
1. `rm -rf node_modules && npm i && npm run dev` → global paketsiz ishga tushadi.
2. Import: `The quick brown fox jumps over the lazy dog. It barked twice.` → 2 gap ko'rinadi, audio progress 100% ga yetadi; `ls audio-words | wc -l` ≈ 11.
3. Mashq: har so'zning 1-harfida **aynan o'sha so'z** eshitiladi; noto'g'ri harfda ovoz chiqmaydi.
4. Bir so'zni backspace qilib qayta yozish → **ovoz takrorlanmaydi**.
5. `Tab` bilan gapni qayta boshlash → ovozlar **yana ishlaydi**.
6. Tez yozib ko'rish → ovozlar ustma-ust tushmaydi, har doim joriy so'z eshitiladi.
7. Serverni to'xtatib qayta urinish → `speechSynthesis` zaxirasi ishlaydi, ilova qulamaydi.
8. Gapni tugatish → Results ekranida WPM/aniqlik chiqadi; sahifani yangilaganda statistika saqlanib qoladi.

---

## Xatarlar

- **`edge-tts` — norasmiy Microsoft endpoint**: to'xtashi yoki cheklanishi mumkin. Yumshatish: disk keshi (har unikal so'z umrida bir marta), `speechSynthesis` zaxirasi, parallellik ≤4 + retry.
- **Autoplay bloki + bir martalik ovoz birga**: brauzer foydalanuvchi harakatisiz ovoz chiqarmaydi. Agar birinchi so'z shu sababli eshitilmasa, qoida bo'yicha u qayta o'qilmaydi. Yumshatish: `AudioContext` mashq ekranini ochish tugmasi bosilganda tayyorlanadi (`resume()`), birinchi `keydown`da emas.
- **Mobil klaviatura/IME**: v1 `window.keydown`ga tayanadi, telefonda ishonchli emas. Kerak bo'lsa keyin yashirin `<input>` + `beforeinput` ga o'tiladi.
- **Nomlash kodi ikki joyda**: `filename.ts` server va klientda bir xil bo'lishi shart, aks holda kesh urmaydi. Yumshatish: bitta fayl `src/core/`da yoziladi va server o'sha modulni import qiladi (nusxa ko'chirilmaydi), test bilan qoplanadi.
