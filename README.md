# dictation-and-typing

Inglizcha **eshitish** va **tez yozish** mashqini bitta harakatga birlashtirgan shaxsiy web-ilova.

Asosiy mexanika:

> Har bir so'zning **birinchi harfini** yozganingizda, o'sha so'z **to'liq o'qiladi** — va bir
> urinish ichida **faqat bir marta**. Eshitgan so'zingizni qolgan harflarini yozish davomida
> mustahkamlaysiz.

To'liq matn ko'rinib turadi — bu yashirin dictation emas. Mashq qilinadigan narsa
**imlo ↔ talaffuz bog'lanishi**: o'zbek tilida imlo deyarli fonematik, ingliz tilida esa yo'q.

Loyihaning to'liq spetsifikatsiyasi va undagi har bir qarorning sababi — [PLAN.md](PLAN.md).

---

## Talablar

- **Node 24+** (ishlab chiqilgan va tekshirilgan: `v24.15.0`, `npm 11.12.1`)
- Global npm paket **kerak emas** — `tsx` ham shu jumlada.

Node 24 TypeScript'ni o'zi "strip" qiladi (`process.features.typescript === "strip"`), shuning
uchun `server/index.ts` to'g'ridan-to'g'ri ishga tushadi. Buning narxi bor: **ishga tushirishda
tip tekshiruvi bo'lmaydi**, shuning uchun `tsc --noEmit` alohida skript va `npm test` ichida.

## Ishga tushirish

```bash
npm install
npm run dev
```

`dev` ikkita jarayonni birga ko'taradi:

| Jarayon | Manzil | Nima |
|---|---|---|
| `dev:server` | `http://127.0.0.1:8787` | Fastify — TTS sintezi va MP3 keshi |
| `dev:web` | `http://localhost:5173` | Vite — `/api` so'rovlari serverga proksilanadi |

`concurrently --kill-others-on-fail` ataylab ishlatilgan: 8787 porti band bo'lsa **ikkalasi ham
to'xtaydi**. Aks holda Vite yolg'iz ishlayverar va ilova jimgina brauzerning
`speechSynthesis` zaxirasiga tushib qolardi — ya'ni zaxiramiz ishga tushish xatosini
yashirardi. Portni band qilib turgan nusxa bo'lsa: `PORT=8788 npm run dev:server`.

## Skriptlar

| Skript | Nima qiladi |
|---|---|
| `npm run dev` | Server + web birga (yuqoriga qarang) |
| `npm test` | `tsc --noEmit` + Vitest (`core` va `server` loyihalari alohida) |
| `npm run typecheck` | Faqat tip tekshiruvi |
| `npm run build` | Typecheck + Vite ishlab chiqarish qurilishi (`dist/`) |
| `npm start` | Serverni ishlab chiqarish rejimida (`dist/` ni ham tarqatadi) |
| `npm run smoke` | **Tarmoqli** smoke test — pastga qarang |

### `npm run smoke` nima uchun `npm test` ichida emas

U Microsoft'ning **norasmiy** edge-tts endpointiga murojaat qiladi: internetsiz yoki endpoint
o'zgarganda yiqiladi. Shuning uchun alohida turadi va CI'ning yashil/qizilini bu tashqi
bog'liqlikka bog'lab qo'ymaydi. Server xotirada ko'tariladi (`app.inject()`), port band
qilinmaydi — `npm run dev` ishlab turganda ham bemalol ishlaydi.

---

## Audio keshi va uning zaxirasi

Sintez qilingan har bir so'z **`audio-words/` papkasida yassi** saqlanadi (pastki papkalar yo'q),
fayl nomi — so'zning o'zi: `the.mp3`, `don't.mp3`, `us@caps.mp3`. Kesh **umrbod** — bir marta
sintez qilingan so'z boshqa qayta so'ralmaydi.

`audio-words/` **git'ga kirmaydi** (`.gitignore`). Oylab yig'ilgan kesh — bu Microsoft
endpointiga qilingan minglab so'rovning natijasi, va uni qaytadan yig'ish soatlar oladi.
Shuning uchun vaqti-vaqti bilan zaxira oling:

```bash
# Zaxira
tar -czf audio-words-$(date +%F).tar.gz audio-words/

# Tiklash
tar -xzf audio-words-2026-08-04.tar.gz
```

Kesh o'zi holat vazifasini ham bajaradi: import yarim yo'lda uzilib qolsa, qayta ochilganda
faqat **qolgan** so'zlar sintez qilinadi.

### Buzuq fayllar o'zi tuzaladi

Yozuv atomik: avval `<nom>.<pid>.tmp` ga yoziladi, hajmi va MP3 sarlavhasi tekshiriladi, so'ng
`rename` qilinadi. `Ctrl+C` yarim yozilgan MP3 qoldirsa, u `.tmp` bo'lib qoladi va kesh urishi
hisoblanmaydi — o'sha so'z keyingi safar qaytadan sintez qilinadi.

## Statistika zaxirasi

Butun statistika va darslar `localStorage` da (`dnt.lessons.v1`, `dnt.stats.v1`). Bu **yagona
nusxa**: bitta "clear browsing data" oylik tarixni o'chiradi, ikkita ochiq tab esa oxirgi
yozganini g'olib qiladi.

Shuning uchun **Statistika** ekranida JSON eksport/import bor. Muhim mashqlardan keyin eksport
qilib qo'ying. Import mavjud ma'lumotni **birlashtirmaydi, to'liq almashtiradi** — ikki marta
import qilish yig'indilarni ikkilantirmasligi uchun.

---

## ⭐ Audio tekshiruvi (M2/M3 gate)

Matn ekranda **ko'rinib turadi**, ya'ni mashqni ovozsiz ham bajarish mumkin. Demak audio
vazifa uchun majburiy emas — u faqat qo'shimcha. Loyihaning butun pedagogik da'vosi
shu oqimning e'tiborga olinishiga tayanadi, va buni tekshirmasdan bilib bo'lmaydi.

**Protokol:**

1. Bir hafta davomida kunma-kun almashtiring: bir kun ovoz **yoqiq**, ertasi **o'chiq**.
   Almashtirgich — mashq ekranidagi ovoz tugmasi.
2. Har kuni **taxminan bir xil hajmda** matn tering (kamida 20 tadan gap kerak, aks holda
   xulosa shovqin bo'ladi).
3. Hafta oxirida **Statistika → "ovozli / ovozsiz taqqoslash"** bo'limiga qarang.

**Qanday o'qish kerak:**

| Natija | Ma'nosi |
|---|---|
| wpm va aniqlik farqi **sezilarli** | Audio qayta ishlanyapti — mexanika ishlayapti. |
| farq **deyarli yo'q** | Audio e'tiborga olinmayapti. Yangi imkoniyat qurishdan oldin mexanikani qayta ko'rib chiqing. |
| ovoz bilan **yomonroq** | Audio chalg'ityapti. Guard/tezlik sozlamalarini ko'ring. |

Ovoz holati **gap darajasida** yoziladi, shuning uchun seans o'rtasida almashtirsangiz ham
hisob to'g'ri qoladi. Bu maydon qo'shilishidan **oldingi** gaplarda holat noma'lum — ular
taqqoslashdan chiqarib tashlanadi va bo'lim ostida alohida ko'rsatiladi.

---

## Klaviatura

| Tugma | Amal |
|---|---|
| `Enter` | Gap tugagach keyingisiga o'tish |
| `Tab` | Joriy gapni qayta boshlash (bu urinish statistikaga kirmaydi) |
| `Escape` | Gapni tashlab ketish (statistikaga kirmaydi) |
| `Backspace` | Orqaga — lekin ovoz **qayta chiqmaydi** |

**Bosh harf qat'iy:** `The` uchun `Shift` bosish shart. `t` bosilsa — xato, kursor turadi.

Gap tugagach ilova **avtomatik o'tmaydi**, `Enter` kutadi: aks holda har gapning oxirgi
so'zi doim yarim eshitilardi.

## Ma'lum cheklovlar

- **Omograflar.** So'zlar alohida sintez qilinib umrbod keshlanadi, shuning uchun `read`,
  `live`, `wind`, `lead`, `tear` birinchi sintezdagi talaffuzda qotib qoladi. Qo'lda
  tuzatiladigan jadval: [`shared/overrides.ts`](shared/overrides.ts).
- **Alohida sintez = lug'aviy talaffuz.** `of` → to'liq /ʌv/, tabiiy nutqdagi /əv/ emas.
  Bu tuzatib bo'lmaydigan cheklov.
- **Tinglab tushunish o'rgatilmaydi.** Bog'langan nutq uchun Bosh sahifadagi
  **.txt eksport** tugmasi orqali gaplarni tashqi `tts.sh` quvuriga bering.
- **Mobil klaviatura/IME** — v1 `window.keydown` ga tayanadi, telefonda ishonchli emas.
- **`edge-tts` — norasmiy Microsoft endpointi.** Yumshatish: disk keshi,
  `speechSynthesis` zaxirasi, parallellik ≤ 4, timeout, retry.

## Tuzilma

```
shared/filename.ts   so'z -> fayl nomi. Server VA klient shu BITTA faylni import qiladi
server/              Fastify: /api/tts/batch, /api/audio/:file, atomik yozish
src/core/            SOF MANTIQ — audio/DOM'siz, to'liq testlangan
src/audio/           Web Audio: prefetch, trim, guard-navbat, fade
src/screens/         Home, Import, Practice, Results, Stats
tests/               Vitest: core (node) + server (node)
```

Barcha nisbiy importlarda **`.ts` / `.tsx` kengaytmasi yoziladi** — klientda ham, serverda ham.
Vite aniq kengaytmani doim qabul qiladi, Node esa uni **talab qiladi**. Bitta qoida, ikki tomon.
`@/` alias ishlatilmaydi: Vite uni hal qiladi, `node` esa yo'q.
