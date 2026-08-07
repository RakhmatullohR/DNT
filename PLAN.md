# Dictation + Typing — loyiha rejasi va qarorlar registri

> Bu reja OMC agentlari (critic / architect / analyst) tomonidan tanqid qilingan va tuzatilgan.
> Tanqid natijasida rejadagi **ikkita yozma da'vo noto'g'ri** ekani amaliy tekshiruvda aniqlandi
> (`Intl.Segmenter` va `block` rejimi), edge-tts manbasida **uchta kritik xato** topildi.
> Hammasi quyida hisobga olingan.
>
> Kod yozilgandan keyin hujjat uchta mustaqil audit bilan bandma-band solishtirildi va
> hozirgi holatga keltirildi. Qurilishdan OLDINGI tanqid tarix sifatida saqlanadi —
> u qayta ochilmagan masala emas, allaqachon yopilgan qaror.

## Holat (2026-08-06)

| Bosqich | Holat | Nima chiqdi |
|---|---|---|
| M1 — sof mantiq | BAJARILDI | `src/core/*` va ularning testlari |
| M2 — TTS server va audio | BAJARILDI | `server/*`, `AudioManager`, `playbackStarted/Failed` zanjiri |
| ⭐ M2/M3 gate | ASBOB TAYYOR, TAJRIBA O'TKAZILMAGAN | o'lchov — `stats.ts` dagi `audioComparison()`, protokol — README |
| M3 — import va saqlash | BAJARILDI | `Import` ekrani, `lessons.ts`, gap darajasida davom ettirish |
| M4 — statistika va eksport | BAJARILDI | `stats.ts`, `Results`, `Stats`, JSON eksport/import |
| M5 — sayqal | BAJARILDI | yorliqlar, bo'sh holatlar, dars bo'yicha ovoz va tezlik |

`npm test` yashil: `tsc --noEmit` toza, 16 fayl / 568 test. `npm run build` o'tadi.

**Bu hujjat endi qurilish rejasi emas — qaror registri.** Quyidagi hamma narsa hozirgi
zamonda yozilgan va kodda mavjud. Yagona istisno `> ⚠ Bajarilmagan:` bilan belgilangan
va butun hujjatda bitta joyda uchraydi (§8, gate tajribasi). Hujjatning qiymati
vazifalar ro'yxatida emas, har qaror yonidagi NEGA da: kod o'zgarsa ham ular to'g'ri
qolaveradi, chunki ular oldini olgan xatolar o'zgarmaydi.

Kodga havola faqat FAYL nomi bilan beriladi, qator raqami bilan emas — qator raqami bir
commit'da eskiradi, eskirgan havola esa havolasizlikdan yomonroq. Qator raqami faqat
tashqi va versiyasi qotirilgan manba uchun ishlatiladi (§5a dagi `edge-tts` dist fayli).

README bilan bo'linish: **README — qanday ishlatiladi** (ishga tushirish, gate protokoli,
klaviatura, zaxira). **PLAN — nega aynan shunday.** Ikkalasi bir narsani eslatishi kerak
bo'lsa, sabab shu yerda, tartib esa README da qoladi.

## Context

Maqsad: inglizcha eshitish va tez yozish mashqini **bitta harakatga** birlashtirgan shaxsiy web-ilova.

Asosiy mexanika:
> Har bir so'z **o'zidan oldingi belgi** terilganda (odatda probel; tirnoq yoki qavs ham bo'lishi mumkin) **to'liq o'qiladi** — va bir urinish ichida **faqat bir marta**. Yagona istisno — gapning **birinchi so'zi**: u o'z birinchi harfida o'qiladi, chunki undan oldin bosiladigan belgi bo'lmasligi mumkin. Maqsad: foydalanuvchi so'zni **terishdan oldin** eshitsin va yozayotganda mustahkamlasin.

Tanlangan qarorlar:
- **To'liq matn ko'rinib turadi.** Yashirin dictation emas.
- **Web app** (brauzer), backend faqat TTS uchun lokal.
- **Gibrid audio**: `edge-tts` neural MP3 asosiy, brauzer `speechSynthesis` zaxira.
- **Kontent**: matn paste qilish. **Statistika**: WPM, aniqlik, xato so'zlar.
- **Har so'z urinish ichida bir martadan ortiq o'qilmaydi.** Gapni qayta boshlaganda tiklanadi.
- **Faqat so'z audiosi** — butun gapni tinglash imkoniyati yo'q.
- **Qisqa so'z audiosiga ~250 ms oyna beriladi** — keyingi so'z shuncha kutadi. Bu
  kafolat EMAS: to'plangan kechikish 300 ms byudjetidan oshsa, joriy ijro kesiladi.
  Byudjet audio matndan orqada qolib ketmasligi uchun bor (§5b).
- **Audioni butunlay o'chirib qo'yish mumkin** va holat HAR GAP uchun alohida yoziladi.
  Bu qulaylik emas: §8 dagi gate — "audio umuman ta'sir qiladimi?" degan savol — faqat
  shu yozuv borligi uchun o'lchanadi.
- **Bosh harf qat'iy** — `The` uchun Shift bosish shart (yangi qaror, §4).
- **Barcha audio bitta yassi `audio-words/` papkada**, fayl nomi — so'zning o'zi.
- **Global npm paket ishlatilmaydi.**
- Doirada emas: SRS, noji `.md` import, yashirin rejimlar, chuqur fonetik statistika.

Muhit: `node v24.15.0`, `npm 11.12.1`. Loyiha qurilgan; bosqichlar holati yuqorida.

---

## 1. Arxitektura

```
dictation-and-typing/
├── package.json            # "type": "module"
├── package-lock.json       # qotirilgan; global paket yo'q qoidasining dalili
├── tsconfig.json           # allowImportingTsExtensions + noEmit + erasableSyntaxOnly
├── vite.config.ts          # @tailwindcss/vite, /api -> :8787 proxy
├── vitest.config.ts        # vite.config.ts dan MUSTAQIL — pastdagi izohga qarang
├── index.html              # SPA kirish nuqtasi
├── .gitignore              # node_modules/ dist/ audio-words/ .omc/ *.local .DS_Store
├── README.md               # QANDAY ishlatiladi (bu hujjat — NEGA shunday)
├── PLAN.md                 # shu hujjat — qaror registri
├── shared/                 # server VA klient import qiladigan YAGONA nusxa
│   ├── filename.ts         # so'z -> fayl nomi, ovoz/tezlik tozalash
│   └── overrides.ts        # homograf talaffuz jadvali — .json EMAS, sababi §3 da
├── server/
│   ├── index.ts            # Fastify: /api/tts/batch, /api/audio/:file, /api/health, statik dist
│   ├── tts.ts              # EdgeTTS wrapper: har chaqiruvga yangi instance, timeout, retry
│   └── store.ts            # atomik yozish (.tmp -> rename), in-flight dedup
├── audio-words/            # gitignore — YASSI, hamma MP3 shu yerda
├── src/
│   ├── main.tsx            # StrictMode + BrowserRouter; audio ATAYIN import qilinmaydi
│   ├── App.tsx             # marshrutlar jadvali
│   ├── index.css           # Tailwind v4 kirishi: @import "tailwindcss"
│   ├── core/               # SOF MANTIQ — audio/DOM/soatsiz, to'liq testlanadi
│   │   ├── types.ts        # umumiy tiplar + IDLE_PAUSE_MS
│   │   ├── normalize.ts    # matnni yozib bo'ladigan ASCII ga keltiradi
│   │   ├── splitSentences.ts
│   │   ├── tokenize.ts
│   │   ├── typing.ts       # reducer
│   │   ├── metrics.ts
│   │   ├── keyboard.ts     # keydown -> yuqori darajali amal
│   │   └── session.ts      # seans chegaralari, davom ettirish indeksi
│   ├── audio/
│   │   ├── AudioManager.ts # Web Audio: prefetch, trim, guard-navbat, fade
│   │   ├── ttsClient.ts    # serverga HTTP — dekodlash ham, holat ham yo'q
│   │   └── webSpeech.ts    # speechSynthesis zaxirasi
│   ├── hooks/
│   │   └── useTypingSession.ts  # klaviatura -> reducer -> audio -> statistika -> marshrut
│   ├── store/              # localStorage: lessons.ts, stats.ts (ikkovida ham JSON eksport/import)
│   ├── screens/            # Home, Import, Practice, Results, Stats
│   └── components/
│       ├── Layout.tsx      # umumiy ramka + ServerBanner
│       ├── ServerBanner.tsx     # "TTS server ulanmadi" ogohlantirishi
│       ├── NormalizeDiff.tsx    # asl va tozalangan matn yonma-yon (§2a)
│       ├── BarChart.tsx    # qo'lda yozilgan inline SVG
│       ├── Sparkline.tsx   # qo'lda yozilgan inline SVG
│       ├── Button.tsx
│       └── EmptyState.tsx
└── tests/                  # Vitest projects: core + server + client (hammasi node)
    └── smoke/              # tarmoqli smoke — `npm test` ichida EMAS (§9)
```

**Node 24 da `tsx` KERAK EMAS.** Tekshirildi: `process.features.typescript === "strip"`, ya'ni `node --watch server/index.ts` to'g'ridan-to'g'ri ishlaydi. Buning ikkita oqibati bor:
- Tip tekshiruvi bo'lmaydi → `"typecheck": "tsc --noEmit"` skripti **majburiy** va `npm test` ichiga kiradi.
- `server/**` va `shared/**` da `enum`, `namespace`, dekorator, parametr-xossalari **ishlatilmaydi** (strip ularni qo'llab-quvvatlamaydi). Bu endi kelishuv emas: `tsconfig.json` da `erasableSyntaxOnly: true` turibdi va `npm test` ichidagi `tsc` ularni xato deb qaytaradi. Kelishuv bo'lib qolganda uni bir yildan keyin hech kim eslamas edi.

**Umumiy modul (`shared/`) — eng nozik nuqta.** Bu yerda ikkita fayl bor va ikkalasi ham
bir xil qonunga bo'ysunadi: `filename.ts` va `overrides.ts`. Ikkinchisi `.json` emasligining
sababi aynan shu qonun — §3 ga qarang. Tekshirildi: Node 24 kengaytmasiz nisbiy importni **rad etadi** (CJS ham, ESM ham: `ERR_MODULE_NOT_FOUND`), Vite esa qabul qiladi. Ya'ni klient qismi kompilyatsiya bo'ladi, server qismi ishga tushganda yiqiladi.
Yechim (uchta qadam, yangi paketsiz):
1. `package.json` da `"type": "module"`.
2. `tsconfig.json` da `"allowImportingTsExtensions": true` + `"noEmit": true`.
3. **Barcha nisbiy importlarda `.ts` kengaytmasi yoziladi** — klientda ham, serverda ham. Vite aniq kengaytmani doim qabul qiladi, Node esa talab qiladi. Bitta qoida, ikki tomon.

`@/` alias **ishlatilmaydi**: Vite uni hal qiladi, `node` esa yo'q.

**Tailwind — v4.** `npm i tailwindcss` v4 o'rnatadi va v3 sozlash tartibi butunlay ishlamaydi (xatosiz, shunchaki nol stil). Aniq yozib qo'yilsin: `npm i tailwindcss @tailwindcss/vite`, `vite.config.ts` da `tailwindcss()` plagini, entry CSS da `@import "tailwindcss";`. `tailwind.config.js` va `npx tailwindcss init` — **yo'q**.

**Palitra qorong'i va tema almashtirish yo'q.** Bu qarz emas, tanlov: ranglar
komponentlarda to'g'ridan-to'g'ri yozilgan, CSS o'zgaruvchi qatlami yo'q. Shu sababli
`index.html` dagi `class="dark"` markeri OLIB TASHLANGAN — Tailwind v4 da u `dark:`
yorliqlarisiz hech narsa qilmaydi va "tema qo'llab-quvvatlanadi" degan yolg'on signal
berardi. Yorug' tema qo'shish kelajakda kerak bo'lsa, u avval token qatlamini talab
qiladi, ya'ni "sayqal" emas, alohida ish.

**`vitest.config.ts` `vite.config.ts` dan mustaqil.** Aks holda sof mantiq testlari
React plaginini va `/api` proksisini o'zi bilan tortib kelardi — ya'ni `src/core` testi
brauzer muhitiga bog'lanib qolardi.

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
| 4 | HAR QANDAY Unicode bo'shlig'i (`\p{White_Space}`) → oddiy probel. Jumladan NBSP `U+00A0`, `U+202F`, tab, `\n`, `\r`, `U+0085`, `U+2000–U+200A` |
| 5 | `trim()`, so'ng ketma-ket bo'shliqlarni bittaga siqish |
| 6 | Qolgan `0x20–0x7E` dan tashqari har qanday belgi → olib tashlanadi va **ro'yxatga yoziladi** |
| 7 | 6-bosqich biror narsa olib tashlagan bo'lsa — 5-bosqich QAYTA qo'llanadi |

4-bosqich ataylab sanab emas, SINF bo'yicha yozilgan (`\p{White_Space}`): qo'lda sanalgan
ro'yxat yangi manbadan kelgan notanish bo'shliqni o'tkazib yuborardi va u 6-bosqichda
jimgina O'CHIRILARDI — ya'ni `so'z so'z` ikki so'z emas, bitta bo'lib qolardi.

5-bosqichda `trim()` siqishdan OLDIN turishi ataylab. Teskari tartibda kirish chetidagi
bo'shliqlar avval `/ {2,}/` ga tushib, `changes` ga soxta `space` yozuvi qo'shardi —
`normalize('   hello')` diff ekranida "bo'shliq siqildi" deb ko'rinardi, holbuki
foydalanuvchi uchun hech narsa siqilmagan, shunchaki chet kesilgan.

7-bosqich `normalize` ning idempotentligi uchun MAJBURIY. Belgi olib tashlanganda uning
o'rnida qo'shni probellar yonma-yon qolishi mumkin (`a © b` → `a  b`); ular siqilmasa
ikkinchi `normalize` chaqiruvi ularni siqib, `changes` ni bo'sh emas qilardi — ya'ni
quyidagi idempotentlik kafolati buzilardi.

Import ekranida asl va tozalangan matn **yonma-yon** ko'rsatiladi, o'zgargan belgilar ajratib beriladi (`NormalizeDiff` komponenti). Foydalanuvchi ko'rmasdan hech narsa o'zgarmaydi.

Shuning uchun `normalize` faqat matn qaytarmaydi — `{ text, changes, removed }` qaytaradi va har o'zgarish o'z TURI bilan belgilanadi (`diacritic | quote | dash | space | removed`). Diff ekrani "nimadir o'zgardi" emas, "aynan nima o'zgardi" deyishi kerak; tur bo'lmasa u faqat ikki matnni yonma-yon qo'yib, farqni foydalanuvchining o'ziga qidirtirardi.

`normalize` **idempotent** va bu test bilan qotirilgan: `normalize(normalize(x).text).changes` doim bo'sh. Aks holda bir xil matnni qayta import qilganda boshqa target chiqardi — ya'ni fayl nomlari o'zgarib, butun audio kesh jimgina yaroqsiz bo'lib qolardi.

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

Qisqartma tekshiruvining bir nozikligi bor: qisqartmadan OLDINGI belgi harf bo'lmasligi
shart. Usiz `revs.` `vs.` deb o'qilib, keyingi gap bilan noto'g'ri birlashardi.

3-qadam trailing probel muammosini hal qiladi: usiz gap ko'zga tugagandek ko'rinadi, lekin `finished` ishlamaydi va ko'rinmas joyda probel bosish talab qilinadi.

**4-qadam — qo'lda guruhlash `[...]`.** Ba'zi gaplar bir-birini to'ldiradi: alohida
mashq birligiga ajratilsa mazmuni yo'qoladi. Buni avtomatik bo'luvchi bila olmaydi,
shuning uchun qaror **matn muallifiga** berilgan — u guruhni `[` va `]` bilan
belgilaydi va ichidagi gaplar nechta bo'lsa ham bitta birlik bo'lib qoladi.
Qavslarning o'zi targetdan **olib tashlanadi**: ular belgi, kontent emas — aks holda
foydalanuvchi mashq paytida `[` ni terishga majbur bo'lardi (§2a bilan bir mantiq).

Guruh **butun gaplarni** qamrashi shart: `[` gap boshida, `]` gap oxirida. Ikkala shart
ham kerak, chunki:

| Kirish | Sabab | Natija |
|---|---|---|
| `He said [sic] loudly.` | `[` gap boshida emas | tegilmaydi |
| `[sic] he said.` | `]` gap oxirida emas | tegilmaydi |
| `[One. Two.] and more.` | `]` dan keyin dum bor | tegilmaydi |
| `Zero. [One. Two.` | `[` yopilmagan | tegilmaydi |

Shart bajarilmasa gaplar **birlashtirilmaydi va qavslar matnda ko'rinib qoladi** —
muallif xatoni gaplar ro'yxatida darrov ko'radi. Teskarisi xavfliroq bo'lardi: bitta
tasodifiy `[` butun darsni bitta ulkan gapga aylantirib qo'yardi. Ichma-ich qavsda
faqat tashqi juft olinadi, ichkilari xuddi shu sababdan ko'rinib turadi.

### 2b'. Qo'lda ta'kidlash — `` `...` `` (`emphasis.ts`)

Muallif so'z yoki iborani teskari tirnoqqa olsa, u mashq ekranida **qalin** chiziladi.
Tirnoqlarning o'zi **targetdan olib tashlanadi** — bu §2a bilan bir mantiq: target faqat
klaviaturada teriladigan belgilardan iborat, aks holda kursor terib bo'lmaydigan belgida
qotib qolardi. Ya'ni `` `...` `` — matn muallifining belgisi, mashq kontenti emas.

**Ta'kidlash mazmunga tegmaydi.** Tokenizatsiya, audio, xato hisobi va statistika
tozalangan matn ustida ishlaydi va oraliqlar haqida umuman bilmaydi. Bu ataylab: qalinlik
faqat chizishga ta'sir qilsa, uni keyin o'chirish yoki o'zgartirish hech qayerda aks
etmaydi.

**Qayerda saqlanadi.** `Lesson.sentences` ning ma'nosi O'ZGARMAYDI — u aynan teriladigan
matn. Oraliqlar alohida ixtiyoriy maydonda: `Lesson.emphasis[i]` — `sentences[i]` uchun.
Muqobil yechim — belgilarni `sentences` ichida qoldirib, har ishlatish joyida ajratish —
rad etildi: `sentences` oltita joyda o'qiladi (target, sintez, natijalar, oldindan yuklash)
va bitta unutilgan joy tirnoqni targetga olib chiqardi. Eski darslarda maydon umuman yo'q
(qalinlik yo'q), birorta oraliq bo'lmasa esa u saqlanmaydi ham.

**Belgi hisoblanmaydigan holatlar** — `[...]` bilan bir xil falsafada, ikkalasida ham
tirnoq matnda **ko'rinib qoladi** va muallif xatoni darrov ko'radi:

| Kirish | Sabab |
|---|---|
| ``He was `absolutely certain.`` | yopilmagan tirnoq |
| ``a `` b`` | ichi bo'sh juft — hech narsani ta'kidlamaydi |
| ``a ` ` b`` | faqat probel — ko'rinadigan narsa yo'q |

Tirnoq **bitta gap ichida** ochilib yopilishi kerak, chunki parser gaplarga
bo'lingandan KEYIN ishlaydi. Bir nechta gapni birga ta'kidlash uchun ularni avval
`[...]` bilan bitta birlikka birlashtirish kerak — ikki belgi shu tartibda birga
ishlaydi va bu testlar bilan qoplangan.

Shu birikma bitta yashirin tuzoq tug'dirdi: guruh bo'laklari **probel bilan ulanadi**,
ya'ni yopuvchi tirnoq bo'lak boshiga tushsa (`[One. `Two. Three.`]`) uning oldiga probel
qo'shiladi va tirnoq olingach o'sha probel **target oxirida** qolardi — o'rtada esa
ikkilangan probel. Bu §2b dagi 3-qadam oldini olgan aynan o'sha nuqson: gap ko'zga
tugagandek ko'rinadi, lekin `finished` ishlamaydi. Shuning uchun `parseEmphasis`
belgilarni olgandan **keyin** bo'shliqni qayta tozalaydi va oraliqlarni suradi.
Belgisi umuman yo'q matn bu yo'lga TUSHMAYDI — ombordagi eski darslar aynan o'zi
bo'lib qolishi kerak.

### 2c. Import limitlari

- Paste hajmi **5000 so'z** bilan cheklanadi.
- **40 so'zdan uzun gap** import ekranida belgilanadi va qo'lda bo'lish taklif qilinadi (`block` rejimida uzun gap charchatadi).
- **Darhol boshlash:** dastlabki **3 gap** sintez qilinib mashq ochiladi, qolgani fonda davom etadi. Aks holda 2000 so'zlik matn 4–8 daqiqa bloklangan progress bar demakdir.
- Import uzilib qolsa — qayta ochilganda qolgan so'zlardan davom etadi (`audio-words/` dagi kesh o'zi holat vazifasini bajaradi). Mashqqa kirilganda darsning qolgan qismi fon yo'lagi orqali qaytadan so'raladi (§5a) — server uchun kesh urishi arzon, shuning uchun alohida "qayerda to'xtadi" hisobini yuritish shart emas.
  Bitta shart bor: bu so'rov **ovoz yoqiq bo'lgandagina** yuboriladi. Ovoz o'chiq bo'lsa
  sintez qilingan fayl baribir ishlatilmaydi, ya'ni so'rov yo'qolmaydi — KECHIKTIRILADI:
  almashtirgich yoqilgan zahoti effekt qayta ishga tushadi va qoldiqni bir marta so'raydi.
  Yagona qoladigan holat — butun seans ovozsiz o'tsa, dars qoldig'i o'sha seansda umuman
  so'ralmaydi; bu ataylab, chunki ovozsiz mashqda keshning o'zi keraksiz.
- Matn tahrirlanayotganda qayta tahlil `ANALYZE_DEBOUNCE_MS = 250` bilan kechiktiriladi. Usiz 5000 so'zlik paste'da har bosishda normalizatsiya va gapga bo'lish qaytadan ishlab, ekran muzlab qolardi. Sintez `SYNTH_CHUNK = 16` bo'lakchalarda yuboriladi.

---

## 3. Fayl nomlash (`shared/filename.ts`)

```
default (en-US-AvaNeural, 0%)  ->  <word>.mp3          the.mp3, don't.mp3
katta harfli qisqartma          ->  <word>@caps.mp3     US -> us@caps.mp3
boshqa ovoz/tezlik              ->  <word>@<Voice>@<rate>.mp3
ikkalasi birga                  ->  <word>@caps@<Voice>@<rate>.mp3
                                    US + en-GB-SoniaNeural + (-10)
                                      -> us@caps@en-GB-SoniaNeural@-10.mp3
```

Yorliqlar QO'SHILADI, biri ikkinchisini almashtirmaydi. Aks holda nostandart ovozda
qisqartma `us@en-GB-SoniaNeural@-10.mp3` bo'lib, oddiy `us` bilan bitta faylga tushardi
va /ʌs/ talaffuzi keshni ifloslantirardi.

- Normalizatsiyadan keyin so'z doim `/^[A-Za-z]+(?:['-][A-Za-z]+)*$/` ga mos keladi. Registr ATAYIN saqlanadi: normalizatsiya bosh harfga tegmaydi, `@caps` qoidasi esa aynan katta harfni ko'rishi kerak — kichik harfga majburlangan regex `The` va `US` ni ham rad etardi, ya'ni eng ko'p uchraydigan so'zlar ovozsiz qolardi. Fayl nomi baribir `toLowerCase()` dan o'tadi, demak registr faqat FILTR va `@caps` qaroriga ta'sir qiladi. Apostrof va tire **saqlanadi** → `don't` va `don-t` to'qnashmaydi. HTTP yo'lida `encodeURIComponent`.
- **Qisqartmalar:** normal qoida bilan `US` → `us.mp3` bo'lib, /ʌs/ deb o'qilardi. Barcha harfi katta va uzunligi ≥2 bo'lgan token alohida `@caps` fayliga tushadi va **asl katta harfli shakli** sintez qilinadi.
- **Ma'lum cheklov — omograflar.** So'zlar alohida sintez qilinadi va umrbod keshlanadi, shuning uchun `read`, `live`, `wind`, `lead`, `tear` birinchi sintezdagi talaffuzda **abadiy qotib qoladi**. Yumshatish: `shared/overrides.ts` — `{"read": "reed"}` ko'rinishidagi qo'lda tuzatiladigan jadval; sintez matni almashadi, fayl nomi imlodan olinadi. Hozirgi jadvalda to'qqiz kalit: `read`, `lead`, `live`, `wind`, `tear`, `row`, `bow`, `sow`, `close`.
- **Nega `overrides.ts`, `.json` emas.** Node 24 `import x from './overrides.json'` ni `with { type: 'json' }` atributisiz **rad etadi** (`ERR_IMPORT_ATTRIBUTE_MISSING`), Vite esa `.json` ni o'zicha JS moduliga aylantiradi va atribut mos kelmay qolishi mumkin. Bu §1 dagi "bitta fayl, ikki toolchain" qonunining aynan o'zi: oddiy `.ts` moduli har ikkala tomonda bir xil ishlaydi, hech qanday atribut va hech qanday resolver farqisiz.
- **Tartib: qisqartma tekshiruvi overrides'dan OLDIN.** `US` hech qachon jadvalga tushmaydi, ya'ni jadval kalitlari doim kichik harfli so'z bo'lib qoladi. Teskari tartibda qisqartma uchun tasodifiy override yozib qo'yish mumkin bo'lardi va u faqat sintez paytida bilinardi.
- **`sanitizeVoice` / `sanitizeRate` bitta joyda.** Eski darsda `voice` maydoni bo'lmasa, u bo'sh satr bo'lib chiqadi va server uni 400 bilan qaytaradi. Tozalash bir joyda bo'lmasa, bitta darsning bir so'rovi toza, boshqasi xom ketardi — natijada bitta dars ikki xil ovozda (yoki umuman audiosiz) qolardi.
- **Raqamlar** (`$1.50`, `2024`) tokenizatordan tashqarida — `gap` token bo'ladi, ovozi yo'q, lekin yozish shart.

---

## 4. Yozuv dvigateli (`src/core/typing.ts`)

Sof reducer, audio/DOM'siz. Tiplar `types.ts` da, reducer `typing.ts` da — §1 dagi
"`types.ts` — umumiy tiplar" bo'linishi shu yerda ham amal qiladi:

```ts
// src/core/types.ts
type Key = { type:'char'; char:string } | { type:'backspace' }
type TypingEvent = Key
  | { type:'playbackStarted';  tokenIndex:number }   // ⭐ YANGI
  | { type:'playbackFailed';   tokenIndex:number }   // ⭐ YANGI

type Effect = { type:'playWord'; tokenIndex:number } | { type:'finished' }

// src/core/typing.ts
function reduce(s:TypingState, e:TypingEvent, now:number): { state:TypingState; effects:Effect[] }
```

Hodisa tipi `Event` emas, **`TypingEvent`** deb ataladi: `Event` — brauzerning global
tipi, va uni soya qilish klaviatura adapterida (`KeyboardEvent` bilan bir faylda)
jimgina noto'g'ri tipni tanlashga olib kelardi.

Vaqt ATAYIN uchinchi argument sifatida beriladi, ichkarida `Date.now()` chaqirilmaydi:
shunda 5 soniyalik pauza qoidasini soxta soat qurmasdan testlash mumkin. `session.ts` ham
xuddi shu tartibga bo'ysunadi.

`TypingState`: `{ target, tokens, cursor, typed[], errorCounts:Map<tokenIndex,number>, charErrors:Map<charIndex,number>, pendingWords:Set, playedWords:Set, keystrokes, correctKeystrokes, activeMs, startedAt, lastKeyAt, finishedAt }` — `IDLE_PAUSE_MS = 5000` shu yerda, `types.ts` da.

### ⭐ Ovoz trigger nuqtasi: so'zdan OLDINGI belgi

Avval so'z **o'z birinchi harfida** o'qilardi. Muammo shundaki, o'sha payt foydalanuvchi
so'zni allaqachon yozishni boshlagan bo'ladi: eshitish yozishga kechikadi va mashq
"eshit → yoz" emas, "yoz → eshit" bo'lib qolardi. Yangi qoida ovozni bir qadam oldinga
suradi — so'z **o'zidan oldingi belgi** terilganda o'qiladi, ya'ni foydalanuvchi uni
**terishdan oldin** eshitadi va yozayotganda mustahkamlaydi.

Nega "probel" emas, aynan "oldingi belgi": tinish belgilari so'z bilan probel orasiga
kiradi. `He said "hello" to me.` da `hello` dan oldin probel EMAS, qo'shtirnoq turadi.
Qoida probelga bog'lansa, `hello` boshqa so'zlardan bir bosish kechikib eshitilardi —
ritm gapdan gapga sakrardi. Shuning uchun trigger — so'zdan oldingi belgi qanday bo'lsa
o'sha (probel, tirnoq, qavs).

Nega gapning **birinchi so'zi** istisno va eski qoidada qoladi:
- undan oldin bosiladigan belgi umuman bo'lmasligi mumkin (`The cat sat` — `T` birinchi bosish);
- belgi bo'lganda ham u bezak: `"The cat," he said.` dagi boshlang'ich qo'shtirnoq gap
  mazmuniga tegishli emas. Uni trigger qilish so'zni foydalanuvchi hali gapga qaramasdan,
  terishga tayyor bo'lmasdan o'qib yuborardi — ya'ni ovoz behuda ketardi.

Amaldagi ko'rinish (chapda bosilgan belgi, o'ngda o'qilgan so'z):

| Gap | Ketma-ketlik |
|---|---|
| `the cat sat` | `t`→the · probel→cat · probel→sat |
| `He said "hello" to me.` | `H`→He · probel→said · `"`→hello · probel→to |
| `"The cat," he said.` | `T`→The (boshdagi `"` hech nima chiqarmaydi) · probel→cat · probel→he · probel→said |

Qoida `typing.ts` dagi `wordToPlay()` va `firstWordIndex()` funksiyalarida, `reduceChar()`
ularni har bir to'g'ri bosishda chaqiradi.

### ⭐ Eng muhim tuzatish: ovoz *chiqqanda* belgilanadi

Avvalgi rejada token `playWord` effekti **yuborilganda** `playedWords`ga qo'shilardi. Reducer sof bo'lgani uchun ovoz haqiqatan chiqqanini bilmaydi. Natijada quyidagilarning **har biri** so'zni "o'qilgan" deb belgilab, uni bir martalik qoida bo'yicha **abadiy o'chirardi**:

prefetch hali tugamagan · `decodeAudioData` buzuq MP3 da yiqilgan · sintez o'sha so'z uchun muvaffaqiyatsiz · `speechSynthesis` ovozlari hali yuklanmagan (`voiceschanged` kelmagan) · `AudioContext` `suspended` holatda · quloqchin uzilgan.

Va siz buni **sezmaysiz** — jimlik ham "eshitilgan", ham "hech qachon eshitilmagan" degani.

Yangi qoida:
> So'zdan OLDINGI belgi to'g'ri terilsa (gapning birinchi so'zi uchun — uning birinchi harfi bosilsa) → token `pendingWords`ga qo'shiladi va `playWord` chiqadi.
> `playbackStarted` kelganda → `playedWords`ga o'tadi (endi qayta o'qilmaydi).
> `playbackFailed` kelganda → `pendingWords`dan **chiqariladi** (yana o'qilishi mumkin).

Bu shartingizni buzmaydi: ovoz chiqmagan so'z "bir marta o'qilgan" hisoblanmaydi.

### Chegaraviy holatlar

| Holat | Yechim |
|---|---|
| Noto'g'ri belgi bosilishi | Kursor siljimaydi → ovoz yo'q. Keyingi so'z faqat undan oldingi belgi TO'G'RI terilgandagina o'qiladi. |
| Backspace + qayta yozish | Ovoz chiqmaydi — so'z `playedWords`da. |
| Bosh harf (`T` vs `t`) | **Qat'iy.** `t` xato, kursor turadi, Shift talab qilinadi. |
| Bir harfli so'z (`a`, `I`) | Bir xil qoida. Audio §5b dagi guard oynasini oladi; juda tez terishda oyna qisqarishi mumkin — §5b, kechikish byudjeti. |
| Takrorlangan so'z (`the ... the`) | Har uchrashuv alohida token → har biri bir martadan. |
| Gap tirnoq bilan boshlanadi (`"The cat`) | Boshdagi `"` birinchi so'zni CHIQARMAYDI — birinchi so'z istisno bo'lib, o'z birinchi harfida (`T`) o'qiladi. Qolgan so'zlar oldingi belgiga tayanadi (`wordToPlay`). Test bilan qoplangan. |
| `forgiving` rejimi | **v1 ga kiritilmaydi.** Unda kursor so'z boshidan noto'g'ri harf bilan o'tib ketadi va ovoz **hech qachon** chiqmaydi — jimgina buziladi. Faqat `block`. |
| Gapni qayta boshlash (`Tab`) | Yangi holat → `playedWords` bo'shaydi. |
| Xato hisobi | Backspace `errorCounts`ni tozalamaydi. |

### Klaviatura adapteri (avval umuman yozilmagan edi)

`window.keydown` → `KeyAction` aylantirish qoidasi. Adapter reducer hodisasini EMAS,
yuqori darajali amalni qaytaradi: `KeyAction = { type:'event', event:TypingEvent }
| { type:'next' } | { type:'restart' } | { type:'skip' } | { type:'ignore' }`.
Sabab: `Enter`/`Tab`/`Escape` reducerning ishi emas — ular gap ALMASHTIRADI, ya'ni
seans oqimiga tegishli (§7). Ularni `TypingEvent` ga tiqish reducerga marshrut va
statistika haqidagi bilimni olib kirardi va uning sofligini yo'q qilardi:
- Harf sifatida qabul qilinadi: `e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing`
- `Backspace` → `{type:'backspace'}`
- `Enter` → gap tugagan bo'lsa keyingisiga o'tadi
- `Escape` → gapni tashlab ketadi (statistikaga kirmaydi)
- `Tab` → gapni qayta boshlaydi
- Boshqa hammasi **e'tiborsiz qoldiriladi**
- `preventDefault()`: `Space`, `Tab`, `Backspace`, `Enter`, `Escape`

Filtrsiz `Ctrl+A` → `e.key === "a"` bo'lib **to'g'ri harf** deb hisoblanardi va `a` bilan boshlanadigan so'z ovozini chiqarardi; `Ctrl+R` → `"r"` yozilib, sahifa qayta yuklanardi; strelkalar `typed[]` ga 10 belgili satr solardi.

Ikkita qoida keyin qo'shildi, ikkalasi ham `preventDefault` ning yon ta'siri sababli:

- **`Shift+Tab` e'tiborsiz qoldiriladi VA to'xtatilmaydi.** Tinglovchi `window` da o'tirgani uchun `Tab` ni to'xtatish butun hujjatdan klaviatura navigatsiyasini olib tashlardi — ovoz tugmasi, "mashqni to'xtatish" havolasi, yuqoridagi menyu, o'tkazib yuborish havolasi — hech biriga klaviatura bilan yetib bo'lmasdi.
- **Modifikator bosilgan bo'lsa `shouldPreventDefault` doim `false`.** `Ctrl+R`, `Meta+V`, `Ctrl+Tab` brauzerning o'zida ishlashi kerak.

### Chizish qarorlari

Reducer sof, lekin ekranda ham ikkita qaror bor va ikkalasi ham xato SIGNAL haqida:

- **Kursordagi belgi foni yo'q, rangi ham yozilmagan belgilarniki bilan bir xil.** Uni ajratib ko'rsatish "bu allaqachon yozilgan" deb aytardi — holbuki u hali terilmagan. Kursor o'rnini chiziqning o'zi ko'rsatadi; chiziq alohida, absolyut joylashtirilgan element, shuning uchun probel ustida ham ko'rinadi. Bloklangan holat chiziq VA harf rangidan bilinadi, ya'ni fon bu yerda hech qanday ma'lumot tashimaydi.
- **Probel oddiy probel bo'lib qoladi.** Avval bu yerda uzilmas probel (U+00A0) turardi — kursor qator oxiriga tushganda ko'rinsin deb. Lekin u qator uzish imkoniyatini yo'q qiladi: kursor `way| to` dagi probelga tushishi bilan `to` keyingi so'zga yopishib, ikkalasi birga pastki qatorga sakrardi. Ya'ni matn terish davomida o'z-o'zidan qayta joylashardi. `whitespace-pre-wrap` qator oxiridagi probelni baribir saqlaydi, demak uzilmas probel hech narsa bermay, faqat joylashuvni buzgan.
- **`BlockedKey` + `nonce` — xato chaqnashi.** Qat'iy bosh harf ilovadagi eng chalg'ituvchi qoida, jimgina turib qolgan kursor esa buzuq klaviatura kabi o'qiladi. `nonce` shuning uchun bor: ketma-ket ikkita bir xil xatoda ham chaqnash qaytadan ishlashi kerak.

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
- `GET /api/health` — klient shu orqali serverning tirikligini biladi (qisqa, 1.5 s timeout bilan: o'lik server ekranni ushlab turmasligi kerak). §1 dagi "jimgina degradatsiya" muammosining yechimi aynan shu: UI "TTS server ulanmadi" deya olishi uchun avval buni bilishi kerak.
- **Fon sintezi yo'lagi.** `POST /api/tts/batch` `background: true` bayrog'ini qabul qiladi. Umumiy parallellik `MAX_CONCURRENCY = 4`, shundan fon uchun ko'pi bilan `MAX_BACKGROUND_CONCURRENCY = 2`, navbat adolatli slot bilan boshqariladi. Sabab: mashqqa kirganda BUTUN dars fonda sintez qilinadi — alohida yo'lak bo'lmasa, foydalanuvchi ayni damda yozayotgan so'z 800 ta fon so'zining orqasida navbatda turardi va guard ma'nosiz bo'lardi, chunki hech narsa tayyor bo'lmasdi.
- `MAX_WORD_LENGTH = 64`; klient 200 dan uzun ro'yxatni o'zi bo'laklarga bo'lib yuboradi; batch uchun `BATCH_TIMEOUT_MS = 180_000`.
- `@fastify/static` + `setNotFoundHandler` → `index.html` (SPA fallback). Usiz beshta ekranning hammasi sahifa yangilanganda 404 beradi. `/api/*` marshrutlari **oldin** ro'yxatdan o'tkaziladi.
- Ishga tushishda `fs.mkdir('audio-words', {recursive:true})` — usiz birinchi yozuv `ENOENT` beradi.

**Atomik yozish (`store.ts`).** Avvalgi reja `fs.access` bilan kesh tekshirardi — bu TOCTOU. `Ctrl+C` yoki React 19 StrictMode ning ikki marta chaqiriladigan effekti yarim yozilgan MP3 qoldiradi; `fs.access` uni **abadiy kesh urdi** deb ko'radi va o'sha so'z umrbod jim bo'ladi. Yechim: `<nom>.<pid>.<hisoblagich>.tmp` ga yozish → hajm va MP3 sarlavhasini (`ID3` / `0xFFEx`) tekshirish → `fs.rename` (ext4 da atomik). Ustiga `Map<filename, Promise>` in-flight dedup. Nomdagi hisoblagich `<pid>` ustiga qo'shiladi, chunki `pid` faqat JARAYONLAR orasida noyob: bitta jarayonning ikki chaqiruvi (`voice` o'zgargan darsda bir xil so'z) bir vaqtda bir xil `.tmp` ga yozib, ikkalasi ham buzuq fayl qoldirardi.

### 5b. Klient (`src/audio/AudioManager.ts`)

- `AudioContext` — **modul darajasidagi singleton**, effekt ichida emas (StrictMode ikkitasini yaratardi). Mashq ekraniga o'tishdagi `pointerdown` **yoki** `keydown` da `resume()` — faqat klik bilan bog'lansa, Enter bilan kirgan foydalanuvchining birinchi so'zi yo'qolardi.
- **Har ijroga yangi `AudioBufferSourceNode`.** Node bir martalik: ikkinchi `start()` `InvalidStateError` beradi va butun seans ovozi o'ladi. "Bitta kanal" — bu *joriy nodega ishora qiluvchi bitta o'zgaruvchi*, qayta ishlatiladigan node emas.
- **Dekodlangan `AudioBuffer` keshlanadi, `ArrayBuffer` emas** — `decodeAudioData` kirish buferini yo'q qiladi (detach), shuning uchun baytlarni qayta dekodlash jimlik beradi.
- **Boshidagi jimlikni kesish.** MP3 kodlovchi kechikishi + Microsoft padding ~100–200 ms. Dekoddan keyin 0-kanal bo'ylab birinchi `|sample| > 0.01` qidiriladi va `src.start(0, offset)` bilan ijro shu joydan boshlanadi. Qisqa so'zlar uchun bu hal qiluvchi: usiz `a` (150 ms oyna) **faqat jimlik** bo'lardi.
  Offset topilgan nuqtaning O'ZI emas — undan `TRIM_SAFETY_S = 20 ms` orqaga suriladi.
  0.01 chegarasi tovushning eng boshidagi past amplitudali qismini (portlovchi undoshning
  havo oqimi, `s`/`f` ning boshlanishi) jimlik deb kesib yuborardi va `so` `o` bo'lib
  eshitilardi. 20 ms — qulog'i sezmaydigan, lekin hujumni saqlaydigan chekinish.
- **⭐ Qisqa so'z guard'i.** `GUARD_MS = 250`, `MAX_LAG_MS = 300`.
  Yangi so'z kelganda: joriy ijro `GUARD_MS` dan kam bo'lsa **va** to'plangan kechikish `MAX_LAG_MS` dan oshmasa → yangi so'z `startedAt + GUARD_MS` ga rejalashtiriladi; aks holda joriy ijro so'ndiriladi va yangisi darhol boshlanadi. Kutish slotida bitta so'z turadi; undan ham yangisi kelsa, kutayotgani tashlanadi (`playedWords`ga tushmagani uchun holat buzilmaydi, lekin u so'z eshitilmaydi — `MAX_LAG_MS` tufayli bu kamdan-kam bo'ladi).
- **Kechikish byudjeti (`lagMs`) — guard aslida nima kafolatlaydi.**
  Har rejalashtirish `lagMs` ga o'z kechikishini QO'SHADI. Hisob faqat ikki joyda nolga
  qaytadi: so'z darhol boshlanganda va `stopAll()` da. Rejalashtirilgan so'z haqiqatan
  boshlanganda hisob tozalanMAYDI.
  Undan kelib chiqadigan aniq oqibat: `MAX_LAG_MS (300) < 2 × GUARD_MS (500)`, ya'ni
  byudjet bitta burst ichida BITTA to'liq kechikishga yetadi. Ketma-ket qisqa so'zlarda
  har ikkinchisi o'z oynasini to'liq olmaydi. Tekshirilgan iz: `t=0` da 1-so'z boshlandi;
  `t=50` da 2-so'z `t=250` ga rejalashtirildi (`lagMs = 200`); `t=250` da 2-so'z
  boshlandi (`lagMs` hamon 200); `t=300` da 3-so'z keldi — `200 + 200 > 300`, demak
  2-so'z atigi 50 ms o'qilib kesiladi.
  **Bu ataylab shunday.** Hisob rejalashtirilgan so'z boshlanganda nolga qaytarilsa,
  zanjir cheksiz cho'zilishi mumkin edi: har qisqa so'z keyingisini yana 250 ms surib,
  audio matndan bir necha so'z orqada qolardi va foydalanuvchi allaqachon boshqa so'zni
  yozayotganda oldingisini eshitardi — bu kesilishdan ham yomon. Byudjet aynan shu
  siljishni chegaralaydi.
  Kafolatning to'g'ri o'qilishi: *qisqa so'z tinch terishda to'liq eshitiladi; tez
  terishda audio matndan 300 ms dan ko'proq orqada qolmaydi.*
  Invariant testda mixlangan (`tests/client/audioManager.test.ts`: `MAX_LAG_MS < 2 × GUARD_MS`).
- **Eskirgan ijrolarni bekor qiluvchi ikki qatlam.** `AudioManager` da `generation`,
  `useTypingSession` da `epoch` + `claimAudio`. Usiz oldingi gapdan kechikib kelgan
  `onFailed` YANGI gapning xuddi shu indeksli tokenini "o'qilmagan" deb belgilab, holatni
  ko'rinmas joyda buzardi — va bu xato faqat tez gap almashtirganda chiqqani uchun
  qo'lda deyarli topilmasdi.
- **`deadFiles`.** Buzuq yoki butunlay jim MP3 bir marta belgilanadi. Usiz har bosishda
  o'sha fayl qayta yuklanib, qayta yiqilar va zaxiraga o'tish har safar kechikardi.
- **Uzishda fade.** Yalang'och `.stop()` to'lqinni tasodifiy nuqtada kesadi → "chirs" etadi. Uzish bu yerda **odatiy yo'l**, chekka holat emas, shuning uchun har ijro `GainNode` orqali o'tadi: `gain.setTargetAtTime(0, now, 0.005)` + `stop(now + 0.02)`.
- **Zaxira `speechSynthesis`:** `voiceschanged` kutiladi (`getVoices()` boshida bo'sh), foydalanuvchi harakatida alohida "isitiladi", `.cancel()` → `speak()` poygasi hisobga olinadi. Muvaffaqiyatsizlikda `playbackFailed` yuboriladi.
- `voice`/`rate` mashq o'rtasida o'zgarsa — fayl nomi o'zgaradi, shuning uchun butun bufer keshi tozalanadi.

---

## 6. Statistika

`localStorage`: `dnt.lessons.v1`, `dnt.stats.v1`.

- **Net WPM** = `(to'g'ri belgilar / 5) / daqiqa`, **Raw WPM** alohida. "To'g'ri belgilar" —
  `typed.length`, ya'ni ekranda TURGAN matn: backspace uni kamaytiradi.
- **Bitta istisno — Statistika ekranidagi KUNLIK trend chizig'i.** U `dayStat.correctKeystrokes`
  dan hisoblanadi, ya'ni to'g'ri BOSISHLAR bo'yicha: backspace'dan keyin qayta yozilgan
  harf ikki marta sanaladi va kunlik WPM gap darajasidagi Net WPM dan biroz yuqori chiqadi.
  Sabab ombor shaklida: kunlik jadval seans yopilganda faqat yig'ma sonlarni saqlaydi
  (`activeMs`, `keystrokes`, `correctKeystrokes`) — `typed.length` gap yozuvi bilan birga
  yashaydi va 500 seansdan keyin eng eskilari tashlanadi (§6b). Ya'ni to'g'ri belgilarni
  kunlik saqlash uchun jadvalga yangi maydon kerak bo'lardi; tanlov — trend uchun mavjud
  kattalikni ishlatish. Gap, seans, `totals()` va `audioComparison()` — hammasi to'g'ri
  formulada; farq faqat trend chizig'ida va u UI da aytilgan.
- **Aniqlik** = `to'g'ri bosishlar / jami bosishlar`.
- **Xato so'zlar — ta'sirlanish soniga nisbatan.** `{word: {exposures, errors}}` saqlanadi, ro'yxat `errors/exposures` bo'yicha va faqat `exposures ≥ 5` bo'lganlar orasida tartiblanadi. Xom son bo'yicha tartiblansa ro'yxat boshini doim `the` egallardi — 200 marta uchraydi, qiyin bo'lgani uchun emas. Tartib uch bosqichli: ulush → ta'sirlanish soni → alifbo; oxirgisi faqat natija har chaqiruvda bir xil chiqishi uchun.
- **Natijalar ekranida chegara 1 ga tushiriladi** (`hardestWords(1, ...)`) — bitta seansdan keyin deyarli hech bir so'z 5 martaga yetmaydi va standart chegara bilan ro'yxat doim bo'sh chiqardi. Statistika ekranida §6 dagi 5 martalik chegara saqlanadi, farq esa foydalanuvchiga UI da aytiladi: ro'yxat shu seansda uchragan so'zlardan, ulush esa butun tarix bo'yicha.
  Chegara bilan BIRGA ikkinchi filtr keladi: `errors === 0` bo'lgan so'z ro'yxatga
  umuman kirmaydi. `hardestWords` ning o'zi xatosiz so'zlarni chiqarib tashlamaydi
  (u faqat `exposures` bo'yicha filtrlaydi va `rate = 0` ni oxiriga tartiblaydi),
  shuning uchun chegara 1 ga tushirilgach ro'yxatning sakkiz qatorini "0%" li so'zlar
  to'ldirib ketardi — ya'ni "eng qiyin so'zlar" ro'yxati eng oson so'zlarni ko'rsatardi.
  Shu filtr tufayli xatosiz seansda ro'yxat o'rniga bo'sh holat matni chiqadi.
- **Seriya (streak)** aniq ta'rif bilan: kunlik ≥100 to'g'ri bosish. Aks holda bitta gap seriyani ushlab turaverardi. Tugallanmagan BUGUN seriyani uzmaydi: kun hali tugamagan, shuning uchun bugun chegaraga yetmagan bo'lsa sanash kechadan boshlanadi.
- **⭐ `audioComparison()` — gate'ning o'lchov asbobi.** Gaplarni ovoz yoqiq/o'chiq holatiga qarab ikki ustunga ajratadi va har biri uchun net WPM, raw WPM va aniqlikni beradi. WPM `activeMs` bo'yicha og'irlanadi — uch so'zlik gap to'liq gap bilan teng vaznga ega bo'lmasligi kerak. §8 dagi gate faqat shu funksiya borligi uchun o'tkaziladi.
  Statistika ekrani ustunlardan **net WPM va aniqlikni** chizadi; `rawWpm` hisoblanadi,
  lekin ko'rsatilmaydi — gate savoli "audio o'zlashtirishga ta'sir qiladimi?", raw WPM
  esa xatolarni ham sanagani uchun bu savolga javob bermaydi. U funksiya natijasida
  qoladi, chunki JSON eksportda kerak bo'ladi.
- **Aniq qoidalar:** taymer **birinchi bosishda** boshlanadi; bosishlar orasi **5 s** dan oshsa taymer pauza qiladi; `Tab` bilan qayta boshlangan urinish statistikaga **kirmaydi** (lekin qayta boshlash soni gap bo'yicha yoziladi); `Escape` bilan tashlangan gap chiqarib tashlanadi. Bu qoidalar yozilmasa, kod ularni tasodifan hal qiladi va WPM trendi siz tanlamagan narsani o'lchaydi.
- **JSON eksport/import — M4 da**, M5 da emas. Oylab yig'ilgan xato-so'z tarixi bitta "clear browsing data" bilan yo'qoladi; bu ~30 qator kod.
- Grafiklar: qo'lda yozilgan inline SVG. Chart kutubxonasi yo'q.

### 6a. Yozuv shakllari

`SentenceRecord`: `lessonId`, `sentenceIndex`, `at`, `activeMs`, `keystrokes`,
`correctKeystrokes`, `netWpm`, `rawWpm`, `accuracy`, `restarts`, `skipped`,
`audioEnabled?`.

`SessionRecord`: `id`, `lessonId`, `lessonTitle`, `startedAt`, `endedAt`, `sentences[]`
va gaplardan qayta hisoblangan yig'indilar.

Qayta hisoblashning bitta istisnosi bor: `sentences` BO'SH bo'lsa, yig'indilar kirishdan
qanday kelgan bo'lsa shundayligicha qoladi (maydonlar baribir alohida tozalanadi —
manfiy, `NaN` va `Infinity` nolga tushadi). Aks holda faqat yig'indi bilan tiklangan
eski seans — masalan `unknownSessions` orqali qaytib kelgan yoki JSON import qilingan
yozuv — nolga aylanardi va u bilan birga o'sha kunning seriyasi (§6) ham yo'qolardi.

Uch maydongina izohga muhtoj, chunki faqat ularda qaror bor:

- **`audioEnabled?` ATAYIN ixtiyoriy.** Bu maydon qo'shilishidan oldin yozilgan gaplarda ovoz holati NOMA'LUM. Ularni `false` deb hisoblash "ovozsiz" ustunini butun eski tarix bilan ifloslantirardi va gate'ning ma'nosini yo'q qilardi. Parser ham shuning uchun boshqa maydonlardan farq qiladi: `skipped` `=== true` bilan majburlanadi, `audioEnabled` esa yo'q bo'lsa yo'qligicha qoladi. Holat gap darajasida yoziladi, chunki almashtirgichni seans o'rtasida ham bosish mumkin.
- **`skipped`** — `Escape` bilan tashlangan gap. Yig'indiga kirmaydi, lekin seans hajmini baribir yeydi (§7).
- **`restarts`** — `Tab` bosishlari soni. Qayta boshlangan urinishning O'ZI yozilmaydi, faqat nechta marta boshlangani qoladi.

`SessionRecord` da so'z bo'yicha xatolar YO'Q: ular global `words` jadvalida yig'iladi.
Shuning uchun Natijalar ekranidagi ro'yxat seans so'zlarini butun tarix ulushi bilan
ko'rsatadi — bu ma'lum cheklov va UI da ochiq aytilgan.

### 6b. Ombor cheklovlari

`localStorage` ~5 MB. Bitta yillik mashq unga sig'masligi mumkin, shuning uchun:

- **`MAX_SESSIONS = 500`**, chegaradan oshganda eng eski seanslar tashlanadi. Kunlik va so'z yig'indilari esa TO'LIQ qoladi — grafiklar va reyting shulardan chiqadi, ya'ni eski seansni tashlash tarixni yo'qotmaydi.
- **Kvota to'lganda** yozuv qaytadan urinadi va eski yarmini tashlaydi. Usiz yozuv jimgina uzila boshlardi va foydalanuvchi buni faqat statistika to'xtab qolganda sezardi.
- **Buzuq payload alohida kalitga ko'chiriladi** (`dnt.stats.v1.corrupt`, `dnt.lessons.v1.corrupt`). Buzuq satrni joyida qoldirish yetarli emas edi: har qanday yozuv butun hujjatni qayta yozgani uchun tiklash oynasi bitta tugagan gapgacha davom etardi.
- **`unknownSessions` qaytarib yoziladi.** Parser tanimagan seans yozuvi ekranga chiqmaydi, lekin diskka qaytadi — aks holda yangi versiyada yozilgan yozuvlarni eski build birinchi tugagan gapdayoq o'chirib yuborardi.
- **Kun kaliti LOKAL yarim tundan** olinadi, `toISOString()` dan emas: aks holda kechqurungi mashq ertangi kunga tushardi.
- **Seans WPM'i `activeMs` bo'yicha og'irlangan o'rtacha.** Oddiy o'rtacha bilan bitta qisqa gap butun seansni tortib ketardi.
- Ovoz almashtirgichi holati `dnt.audio.v1` da saqlanadi.

---

## 7. Seans oqimi (avval umuman yozilmagan edi)

| Savol | Qaror |
|---|---|
| Gap tugagach? | `finished` → **`Enter` kutiladi**. Avtomatik o'tilsa har gapning oxirgi so'zi doim yarim eshitilardi. |
| Taymer qachon? | Birinchi bosishda. |
| Skip bormi? | `Escape` — gap tashlanadi, statistikaga kirmaydi. Usiz noma'lum imloda seans boshi berk ko'chaga kirardi. Ikkita oqibati bor: tashlangan gap seans hajmini baribir yeydi, va uning so'zlari uchun ta'sirlanish ham yozilmaydi (yozilsa, o'qimasdan `Escape` bosish xato ulushini sun'iy pasaytirardi). |
| Bo'sh turish | Bosishlar orasi >5 s → taymer pauza. |
| Davom ettirish | **Gap darajasida.** Yarim yozilgan gap tashlanadi. Kursorni gap o'rtasidan tiklash mumkin emas: o'tib ketilgan so'zning ovoz nuqtasi (undan oldingi belgi) endi hech qachon ovoz bermaydi. Tugagan dars esa 0-indeksdan qayta boshlanadi, oxirgi gapdan emas: "tugagan" belgisi `progress === sentences.length` bo'lgani uchun, uni oxirgi gapga qaytarish Natijalar → "Davom ettirish" → o'sha gap → yana Natijalar tsiklini yasab, har aylanishda bir gaplik seansni statistikaga yozardi. |
| Seans uzunligi | 20 gap yoki 10 daqiqa — qaysi biri oldin tugasa → Natijalar ekrani. Agar bitta ham gap yozilmagan bo'lsa — Bosh sahifaga qaytadi: bo'sh seans statistikani faqat ifloslantirardi. **"Yozilgan" — `skipped` bo'lmagan gap.** Yozuvlar SONIGA qaralsa, hammasi `Escape` bilan tashlangan seans ham "bo'sh emas" ko'rinardi va omborga `activeMs: 0`, `netWpm: 0` bo'lgan seans tushardi — ya'ni qoida aynan o'zi oldini olishi kerak bo'lgan holatni o'tkazib yuborardi. Darvoza `hasWrittenSentence()` sof funksiyasida va test bilan mixlangan (§9). |
| Ovoz yoqiqmi? | Almashtirgich holati `dnt.audio.v1` da saqlanadi va HAR GAP uchun alohida yoziladi — tugmani seans o'rtasida ham bosish mumkin (§6a, §8). |
| "Dars" nima? | Bitta import qilingan matn. Seans — uning bir bo'lagi. Ovoz va tezlik ham darsning xossasi (§8). |

---

## 8. Bosqichlar

**M1 — Sof mantiq (audiosiz). BAJARILDI.** `src/core/*` va ularning testlari; audiosiz
`Practice` ekrani. Chiqdi: gapni terasiz, ranglar va WPM ishlaydi.

**M2 — TTS server va asosiy mexanika. BAJARILDI.** `server/*` (har chaqiruvga yangi
instance, timeout, atomik yozish), `AudioManager` (trim, guard, fade),
`playbackStarted/Failed` zanjiri. Chiqdi: so'z o'zidan oldingi belgi terilganda (gapning
birinchi so'zi — 1-harfida) bir marta eshitiladi — guard oynasi doirasida (aniq kafolat
§5b da).

**⭐ M2/M3 oralig'idagi gate — shaxsiy tekshiruv.** Matn ko'rinib turgani uchun mashqni **ovozsiz ham** bajarish mumkin — ya'ni audio vazifa uchun majburiy emas, faqat qo'shimcha. Kunma-kun almashtirib (ovoz yoqiq / o'chiq) bir xil hajmdagi matn teriladi. Agar WPM va aniqlik farq qilmasa — audio qayta ishlanmayapti va mexanikani qayta ko'rib chiqish kerak. Bu gipotezani tekshirishning eng arzon yo'li va baribir qiladigan mashqingizdan boshqa hech narsa talab qilmaydi.

Almashtirgichning o'zi boshidan bor edi, lekin ovoz holati hech qayerda YOZILMAGANI
uchun tajribaning natijasini o'qib bo'lmasdi — ya'ni loyihaning butun pedagogik
farazini tekshiradigan yagona sinov o'tkazib bo'lmaydigan holatda qolgan edi. Buni
`audioComparison()` (§6) yopdi, protokol README da.

**Asbob tekshirildi, protokol qayta o'lchandi.** Sun'iy seans ma'lumotlari bilan
`audioComparison()` yugurtirildi: og'irlash to'g'ri ishlaydi (oddiy o'rtacha farqni 59% ga
bo'rttirardi), `skipped` gaplar ikkala ustundan chiqariladi, maydonsiz eski yozuvlar
`noma'lum` ga tushadi va `off` ni ifloslantirmaydi. Asbobning matematikasi to'g'ri.
Qayta o'lchangani — **hafta uzunligi**, va uchta qaror shundan chiqdi:

- **Bir hafta emas, sakkiz kun; va u ham faqat ~15% dan katta effektni tutadi.**
  Kunlik chegara `SESSION_MAX_SENTENCES = 20` bo'lgani uchun "kuniga 20 gap" aynan bitta
  seans, ya'ni haftada 7 ta kuzatuv — 140 ta emas. Gaplar bir kun ichida ketma-ket
  teriladi (bir dars, bir kayfiyat, bir charchoq), demak ular mustaqil emas va tahlilning
  haqiqiy birligi **kun**. Shundan minimal seziladigan effekt 13–24% chiqadi; 5% farq
  uchun 5–15 hafta kerak bo'lardi. Toq kun (4 vs 3) ustunlarni nomutanosib qoldirgani
  uchun sakkiz kun tanlandi. Almashtirish tartibi (ABABABAB) esa saqlanadi: A va B
  kunlarining o'rtacha pozitsiyasi teng, ya'ni hafta davomidagi tabiiy tezlashish
  natijaga deyarli siljish qo'shmaydi — bu tartibning butun maqsadi.
- **"Farq yo'q" va "o'lchay olmadik" — boshqa-boshqa xulosa, va README avval ularni
  ajratmasdi.** Haqiqiy effekt nol bo'lganda ham ekran uchdan bir hollarda ±2 wpm dan
  katta farq ko'rsatadi. Ajratilmasa, shovqin "audio ishlamayapti" deb o'qilib, gate
  o'zi oldini olishi kerak bo'lgan xatoni — keraksiz qayta qurishni — keltirib
  chiqarardi.
- **Taqqoslash butun tarixni oladi, ovoz holati esa standart bo'yicha yoqiq.** Ya'ni
  tajribadan oldin qilingan har qanday mashq "ovozli" ustuniga tushadi. Sinovda bu
  haqiqiy +4 wpm effektni ko'rinadigan −7.5 wpm ga aylantirdi — ishorani ag'dardi.
  Funksiyaga sana filtri QO'SHILMADI: gate bir martalik tajriba, doimiy imkoniyat emas,
  va filtr UI da ham, tipda ham yangi holat talab qilardi. Buning o'rniga qaror ekrandan
  emas, JSON eksportidan chiqariladi — `at`, `audioEnabled`, `activeMs`, `netWpm`,
  `lessonId` hammasi o'sha yerda. Ekran endi kuzatish asbobi, qaror asbobi emas.

**Ma'lum cheklov — `audioEnabled: true` "ovoz eshitildi" degani emas.** U almashtirgich
holatini yozadi, sintez natijasini emas: TTS server tushib qolsa yoki sintez yiqilsa,
gap baribir "ovozli" deb yoziladi. "Nechta so'z rostdan o'qildi" hech qayerda
saqlanmaydi. Buni yozish `SentenceRecord` ga yangi maydon va `AudioManager` dan
statistikaga yangi yo'l talab qilardi — gate uchun arzimaydi, chunki mashq ekrani
serverning o'ligini allaqachon ko'rsatadi (§5a). Shuning uchun bu **protokol sharti**
bo'lib qoldi: server ogohlantirishi chiqqan kun hisobga kirmaydi (README).

> ⚠ **Bajarilmagan:** tajribaning o'zi. Asbob tayyor va tekshirilgan, protokol qayta
> o'lchangan — sakkiz kun o'tkazilmagan. Gate M2 va M3 orasida turishi kerak edi;
> amalda M3–M5 undan oldin qurildi, ya'ni gate salbiy natija bersa qayta ko'riladigan
> hajm rejadagidan katta.

**M3 — Import va saqlash. BAJARILDI.** Paste → normalizatsiya diff'i → gap bo'linishini tuzatish → dastlabki 3 gapdan darhol boshlash → fonda davom etish. Dars ro'yxati, gap darajasida davom ettirish.

**M4 — Statistika, natijalar, eksport. BAJARILDI.** Seans yozuvi, Natijalar/Statistika ekranlari, SVG grafiklar, ta'sirlanishga nisbatan xato reytingi, JSON eksport/import, buzuq nusxani tiklash.

**M5 — Sayqal. BAJARILDI**, lekin sozlamalar rejadagidan boshqacha chiqdi: ovoz va
tezlik **global sozlama emas, darsning xossasi**. Sabab shundaki, ovoz va tezlik audio
kesh kalitining bir qismi (§3) — ular global bo'lganda sozlamani o'zgartirish butun
darslarning keshini bir vaqtda yaroqsiz qilardi. Qolgani: klaviatura yorliqlari mashq
ekranida ko'rsatiladi, bo'sh holatlar barcha ro'yxatlarda bor — ro'yxatlarda umumiy
`EmptyState` komponenti bilan, Natijalar ekranida esa o'z paneli bilan: u ro'yxat emas,
va bo'sh holati "dars yo'q" emas, "shu seansda xato qayd etilmadi" degan BOSHQA gapni
aytadi.

---

## 9. Tekshirish

**`npm test` = `tsc --noEmit` + Vitest.** Uchta loyiha: `core`, `server`, `client` — sof
mantiq testlari React plagini va `/api` proksisini tortib kelmasligi uchun alohida.
Hozirgi holat: 16 fayl, 568 test, hammasi o'tadi.

`client` loyihasi `AudioManager` uchun bor — u brauzer API'lariga tayanadi. `jsdom`
ATAYIN qo'shilmagan: kerak bo'lgani `window.AudioContext` va `fetch`, ikkalasi ham testda
qo'lda qo'yiladi. Shu bilan §1 dagi "ortiqcha paket yo'q" qoidasi buzilmaydi.

`src/core`:
- `normalize`: `He said, "I don't know—maybe."` natijasida `0x20–0x7E` dan tashqari belgi **qolmaydi**; `café naïve` → `cafe naive`; ketma-ket probellar siqiladi; o'zgargan belgilar ro'yxati qaytariladi.
- `splitSentences`: `"Mr. Smith paid $1.50. He left."` → **2** ta gap (qisqartma birlashtirish ishlaydi); hech bir segmentda bosh/oxirgi bo'shliq **qolmaydi**; `"First line\nsecond line."` → 2 ta gap, `\n` siz.
- `tokenize`: `Don't stop - it's fine.` da offsetlar to'g'ri; `US` → bitta token; `3D-printed` da token `D-printed` dan boshlanishi **hujjatlashtirilgan** holat sifatida tasdiqlanadi.
- `filename`: `The`→`the.mp3`; `US`→`us@caps.mp3`; `don't` va `don-t` → **turli** fayllar; `-25%` → `@` yorlig'i. Shu yerda `overrides.ts` ham qoplanadi: jadval bo'ylab aylanib HAR BIR kalit uchun `synthTextFor` tekshiriladi, kalitlar kichik harfli ekani va to'qqiztaligi mixlanadi — ya'ni jadvaldan kalit tushib qolsa test qizaradi (§10 dagi "ikkalasi ham testlar bilan qoplangan" da'vosi shu).
- `typing`:
  - `t` target `T` ga qarshi → **xato**, kursor turadi (qat'iy bosh harf);
  - har so'z uchun aynan bitta `playWord` (so'zdan oldingi belgi terilganda; gapning birinchi so'zi uchun — uning birinchi harfida);
  - backspace + qayta yozish → `playWord` **yo'q**;
  - `playbackFailed` dan keyin **o'sha token qayta o'qilishi mumkin**;
  - `"the cat and the dog"` → 2 ta alohida `playWord`;
  - `"The cat," he said.` → birinchi token **1-indeksda**, `playWord` baribir chiqadi — boshdagi `"` da emas, `T` da (birinchi so'z istisnosi);
  - `Ctrl+A`, `ArrowLeft`, `F5` → hech qanday holat o'zgarmaydi;
  - `Tab` dan keyin ovozlar tiklanadi; oxirgi belgidan keyin `finished`.
- `metrics`: qo'lda hisoblangan qiymatga tenglik; 5 s dan uzun tanaffus taymerga qo'shilmaydi.

`server` (tarmoqsiz, sintez funksiyasi stub bilan):
- bir xil so'z ikki parallel so'rovda → **bitta** sintez chaqiruvi (in-flight dedup);
- yarim yozilgan `.tmp` qolsa → kesh urishi **hisoblanmaydi**;
- 0 baytli / sarlavhasiz bufer → retry, keyin `muvaffaqiyatsiz` ro'yxatiga;
- `voice:"../../x"` va `rate:"-500"` → **400**;
- `words.length = 500` → 400;
- 0 baytga qisqartirilgan MP3 kesh urishi deb hisoblanmaydi va qayta sintez qilinadi (avval bu qo'lda tekshiriladigan band edi).

Yuqoridagi ro'yxat dastlabki rejadan qolgan. Undan tashqari OLTITA fayl bor va ular
umumiy testlarning uchdan birini tashkil qiladi:

- **`audioManager`** (`client`) — guard oynasi, kutish sloti, kechikish byudjeti va "jimlik hech qachon eshitilgan hisoblanmaydi" sharti. §5b dagi `MAX_LAG_MS < 2 × GUARD_MS` invarianti shu yerda mixlangan.
- **`stats`** — butun ombor: buzuq payloadni tiklash, kvota siqilishi, eksport/import, seriya, va `audioComparison` ning ustunlarga ajratishi (jumladan eski yozuv "ovozsiz" ustuniga TUSHMASLIGI).
- **`session`** — seans chegaralari va `clampIndex`; tugagan dars 0-indeksdan qayta boshlanishi; bo'sh seans darvozasi — hammasi `Escape` bilan tashlangan seans BO'SH hisoblanishi (§7).
- **`keyboard`** — modifikatorli tugmalar, IME, va `Shift+Tab` ning to'xtatilmasligi (§4).
- **`lessons`** — dars CRUD'i va buzuq yozuvga chidamlilik.
- **`ttsClient`** (`server`) — klient↔server sxema chegarasi `app.inject` bilan: klient yuboradigan tana serverning validatsiyasidan o'tadimi. Bu ikki tomonni bir vaqtda ushlaydigan yagona test, shuning uchun `server` loyihasida turadi. Shu yerda `useTypingSession.ts` va `Import.tsx` ning MANBA MATNI ham o'qiladi — `sanitizeVoice` bir marta chaqirilishi va fon bayrog'i to'g'ri joyda turishi hisoblab tekshiriladi. Bu xulq-atvor testi emas, chok qoidasining qorovuli.

**Tarmoqli smoke** (`npm run smoke`, `npm test` ichida emas — Microsoft endpointiga bog'liq bo'lgani uchun): 2 ta so'z sintez qilinadi, `audio-words/` da 2 ta MP3 (>1 KB) paydo bo'ladi, **pastki papka yaratilmaydi**, ikkinchi chaqiruv sintezsiz o'tadi.

**Qo'lda E2E** (`npm run dev`):
1. `rm -rf node_modules && npm i && npm run dev` → global paketsiz ishga tushadi; 8787 band bo'lsa **ikkalasi ham to'xtaydi** (jimgina degradatsiya emas).
2. Saytdan aqlli qo'shtirnoqli xatboshi paste qilinadi → normalizatsiya diff'i ko'rinadi → **gap oxirigacha yozib bo'ladi** (avvalgi rejada bu joyda qotib qolardi).
3. Har so'z o'zidan oldingi belgi terilganda eshitiladi (gapning birinchi so'zi — o'z 1-harfida), ya'ni so'zni yozishdan OLDIN eshitasiz. Odatiy tezlikda `a`, `I`, `is` to'liq eshitiladi. ATAYLAB juda tez terilganda har ikkinchi qisqa so'zning kesilishi — **kutilgan** xatti-harakat (§5b, kechikish byudjeti), xato emas. Buni ko'rish uchun qisqa so'zlar ketma-ket kelgan gapni imkon qadar tez tering.
4. Backspace + qayta yozish → ovoz takrorlanmaydi. `Tab` → ovozlar tiklanadi.
5. Serverni to'xtatib davom etish → `speechSynthesis` zaxirasi ishlaydi; DevTools da `/api/tts/batch` ni bloklab qo'yish → o'sha so'z **keyin ham eshitilishi mumkin** (`playbackFailed` zanjiri).
6. Gapni tugatish → `Enter` kutiladi, oxirgi so'z audiosi kesilmaydi → Natijalar; sahifa yangilangach statistika joyida.

### Qoplanmagan joylar

Qoplama uch darajada: XULQ-ATVOR testi (eng kuchli), MANBA MATNI testi (chok qoidasini
hisoblab tekshiradi), va umuman qoplanmagan. Farqni yashirmaslik kerak, chunki
"qoplangan" so'zi uchalasiga ham qo'llanganda ma'nosini yo'qotadi.

- **`useTypingSession.ts`** — reducer bilan audio orasidagi chok, loyihadagi eng nozik kod: epoch qalqoni, effekt yuborish, statistikaga yozish. **Xulq-atvor testi yo'q** (DOM stendi kerak bo'lardi). Qisman himoyalangan: `ttsClient` manba matnini tekshiradi, va bo'sh seans darvozasi kabi TESTLANADIGAN qarorlar `src/core` ga sof funksiya bo'lib chiqariladi (`hasWrittenSentence` — §7). Chokning o'zi qo'lda E2E ning 4, 5 va 6-bandlari bilan tekshiriladi.
- **`webSpeech.ts`** — zaxira zanjiri, umuman testsiz. E2E 5-band uni qo'lda tekshiradi AYNAN shuning uchun. `client` loyihasida `speechSynthesis` ni ham qo'lda qo'yish bilan qoplasa bo'ladi.
- **`AudioManager` ning `unlockAudio` va `checkServer`** — umuman chaqirilmaydi.
- **`prefetch` va MP3 yuklab olish yo'li — qoplanmagan EMAS, lekin o'z testi ham yo'q.** `audioManager` testining `beforeEach` i har safar `prefetch` chaqiradi va `loadBuffer → fetch → decodeAudioData → findSoundStart` zanjiri to'liq yuriydi; guard testlari keshning to'lganiga tayangani uchun bu yo'l jimgina buzilsa ular qizaradi. Xato tarmog'i (fayl ham, brauzer sintezi ham ishlamasa `onFailed`) esa to'g'ridan-to'g'ri tekshiriladi. Qoplanmagani — `prefetch` ning O'Z shartnomasi: dublikatlarni tashlash, `isValidWord` filtri, `serverAvailable` false bo'lganda so'rov yubormaslik.

Ekranlar va komponentlar esa **ataylab** testsiz: ular uchun DOM stendi kerak, ya'ni
`jsdom`. §1 dagi "ortiqcha paket yo'q" qoidasi bu yerda qamrovdan qimmatroq — chunki
ekranlar chizadigan mantiq allaqachon `src/core` va `src/store` ga chiqarilgan va
o'sha yerda qoplangan. Yagona istisno — `Import.tsx`, undan ham faqat manba matni
o'qiladi (fon bayrog'i to'g'ri joyda turibdimi). Qoladigan xavf — ulash xatolari,
ular uchun qo'lda E2E bor.

---

## 10. Xatarlar

- **Audio vazifa uchun majburiy emas.** Matn ko'rinib turgani uchun mashqni ovozsiz ham bajarish mumkin; audio o'qilgandan **keyin** keladi. Butun pedagogik da'vo shu oqimning e'tiborga olinishiga tayanadi. → M2/M3 oralig'idagi gate (§8).
- **Bu "dictation" emas.** Eshitib-yozish emas, imlo↔talaffuz bog'lanishi mashq qilinadi — o'zbek tilida imlo deyarli fonematik, ingliz tilida esa yo'q, shuning uchun qiymati bor, lekin **tinglab tushunish o'rgatilmaydi**. Bog'langan nutq uchun mavjud `noji/phrasal-verbs/tts.sh` quvuri ishlatilaveradi. Yumshatish yetkazilgan: gaplarni `.txt` qilib yuklab olish tugmasi bor — lekin **Bosh sahifadagi dars kartasida**, mashq ekranida emas (reja joyni noto'g'ri aytgan edi; mashq ekranidan qidirgan odam topmaydi).
- **Alohida sintez = lug'aviy (citation) talaffuz.** `of` → to'liq /ʌv/, tabiiy nutqdagi /əv/ emas; `a` → /eɪ/, /ə/ emas. Bu tuzatib bo'lmaydigan cheklov, faqat bilib turish kerak.
- **`edge-tts` — norasmiy Microsoft endpoint.** Yumshatish: disk keshi, `speechSynthesis` zaxirasi, parallellik ≤4, timeout, retry.
- **`localStorage` — yagona nusxa.** Bitta "clear browsing data" oylik tarixni o'chiradi; ikkita ochiq tab oxirgi yozganini g'olib qiladi. Yumshatish yetkazilgan: **ikkala** ombor uchun JSON eksport/import (statistika VA darslar — pastdagi bandga qarang), buzuq payloadni alohida kalitga ko'chirib tiklash (§6b), va `audio-words/` uchun `tar` zaxirasi — buyruqlari README da.
- **Darslar zaxirasi — statistikanikidan KEYIN qo'shilgan va boshqa qoida bilan ishlaydi.** M4 da faqat statistika zaxiralanardi, chunki himoya qilinayotgan narsa qayta tiklab bo'lmaydigan xato-so'z tarixi edi; dars esa "matnni yana paste qilasiz" deb hisoblangan. Bu ikki sababdan yetarli emas: (1) `.txt` eksport tashqi `tts.sh` quvuri uchun va progressni, tashlangan gaplarni, ta'kidlashni, ovoz/tezlikni tashlab yuboradi; (2) statistika zaxirasi seanslarni saqlaydi, lekin ular ishora qiladigan darslarni emas — toza brauzerda tiklangan seanslar aynan shu sababdan `unknownLessons` bo'lib qolardi. Import qoidasi ham teskari: statistika ALMASHTIRADI (yig'indilar ikkilanmasin), darslar esa BIRLASHTIRADI (turg'un `id` li yakka obyekt, ya'ni takroriy import idempotent) va progressni ORQAGA SURMAYDI.
- **`shared/` ikki toolchain ostida.** Kelishmasa kesh hech qachon urmaydi. Xatar o'sdi: endi bu bitta emas, **ikkita** fayl — `filename.ts` va `overrides.ts`. Yumshatish ikkalasi uchun bir xil: aniq `.ts` kengaytmasi, hech qanday import atributi, testlar bilan qoplangan.
- **Mobil klaviatura/IME**: v1 `window.keydown` ga tayanadi, telefonda ishonchli emas.
