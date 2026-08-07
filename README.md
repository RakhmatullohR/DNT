# dictation-and-typing

Inglizcha **eshitish** va **tez yozish** mashqini bitta harakatga birlashtirgan shaxsiy web-ilova.

Asosiy mexanika:

> Har bir so'z **o'zidan oldingi belgi** (odatda probel, ba'zan tirnoq yoki qavs) yozilganda
> **to'liq o'qiladi** — va bir urinish ichida **faqat bir marta**. Gapning birinchi so'zi esa
> o'z **birinchi harfida** o'qiladi. Shunday qilib so'zni eshitasiz va shundan keyin yozasiz.

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
| `npm test` | `tsc --noEmit` + Vitest (`core`, `server`, `client` loyihalari alohida) |
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

**Boshlashdan OLDIN (uchalasi ham majburiy):**

1. **JSON eksport qiling va sanasi bilan saqlang** (Statistika → JSON eksport). Bu
   boshlang'ich chegara belgisi. Omborni **tozalamang**: `clearStats()` kunlik jadval,
   seriya va so'z reytingini ham o'chiradi, JSON import esa birlashtirmaydi —
   **almashtiradi**, ya'ni keyin eski zaxirani qaytarish tajriba ma'lumotini yo'q qiladi.
2. **Bitta dars tanlang, kamida 140 gapli** (afzali 200+) va butun tajriba davomida
   undan chiqmang. Ikki sabab: ovoz va tezlik darsning xossasi, ya'ni dars almashsa
   matn qiyinligi ham, ovoz ham birga o'zgaradi va effektni ajratib bo'lmaydi; ikkinchidan
   tugagan dars 0-indeksdan qayta boshlanadi va takroriy matn ikkinchi safar tezroq
   teriladi.
3. **Kutish darajasini belgilang.** Sakkiz kunlik tajriba faqat **~15% dan katta** effektni
   ishonchli tutadi. 5% farqni ko'rmoqchi bo'lsangiz — 5–8 hafta rejalashtiring.

**Protokol:**

1. **Sakkiz kun** davomida kunma-kun almashtiring: bir kun ovoz **yoqiq**, ertasi
   **o'chiq** (ABABABAB). Almashtirgich — mashq ekranidagi ovoz tugmasi.
   Sakkiz, yetti emas: toq kunda ustunlar nomutanosib chiqadi (4 kun vs 3 kun).
2. **Kun tashlab ketmang.** Almashtirish muvozanati buzilsa, hafta davomidagi tabiiy
   tezlashish natijaga siljish qo'shadi.
3. Har kuni **taxminan bir xil hajmda** matn tering — bir seans (20 gap) yetarli.
4. **Har kuni mashq ekranida "TTS server ulanmadi" ogohlantirishi yo'qligini tekshiring.**
   Server tushib qolgan kunda gaplar baribir "ovoz yoqiq" deb yoziladi, lekin ovoz
   chiqmaydi — o'sha kun hisobga kirmaydi.
5. Tajriba oxirida **yana JSON eksport qiling** va tahlilni o'sha fayl ustida bajaring.

**Qanday o'qish kerak:**

Ekrandagi **Statistika → "ovozli / ovozsiz taqqoslash"** bo'limi butun tarixni oladi va
tarqalish ko'rsatmaydi, shuning uchun u **qaror uchun emas** — faqat gaplar yozilayotganini
va `on`/`off` nisbatini kuzatish uchun. Qaror eksport fayli ustida chiqariladi:
`at >= tajriba_boshlangan_vaqt` bo'yicha filtrlang, so'ng **har kun uchun bitta
`activeMs` bo'yicha og'irlangan o'rtacha** oling (8 ta son) va shularni taqqoslang.
To'g'ri tahlil birligi — **kun, gap emas**: gaplar bir kun ichida ketma-ket teriladi va
mustaqil emas, gap darajasida t-test p-qiymatni 2–5 barobar sun'iy kichraytiradi.

| Natija | Ma'nosi |
|---|---|
| farq **15% dan katta** | Audio qayta ishlanyapti — mexanika ishlayapti. |
| farq **15% dan kichik** | **Xulosa chiqarib bo'lmaydi.** Bu "audio ishlamayapti" emas, "o'lchay olmadik" degani — tajriba bu hajmdagi effektni ko'ra olmaydi. Davom ettiring yoki mashq hajmini oshiring. |
| ovoz bilan **yomonroq** | Avval ifloslanishni tekshiring (pastga qarang). Tasdiqlansagina: audio chalg'ityapti, guard/tezlik sozlamalarini ko'ring. |

**Shovqin oralig'i.** Haqiqiy farq **nol** bo'lganda ham sakkiz kunlik ma'lumotda ekran
uchdan bir hollarda ±2 wpm dan katta farq ko'rsatadi, oltidan bir hollarda esa u
manfiy tomonga tushadi. Ya'ni "±2 wpm" — shovqin, signal emas. Aniqlik uchun ham
shunday: ±1.7–2.5% ichidagi har qanday qiymat shovqin, garchi ekran uni bir kasr
xonasi bilan chizsa ham.

**Ifloslanishni tekshiring.** Taqqoslash butun tarixni oladi, ovoz holati esa standart
bo'yicha **yoqiq**. Demak tajribadan oldin qilingan mashq "ovozli" ustuniga tushadi va
natijani buzadi — sinovda bu haqiqiy +4 wpm effektni ko'rinadigan −7.5 wpm ga
aylantirgan, ya'ni **ishorani ag'dargan**. Ikki belgi:
- `on` / `off` gaplar soni nisbati 1:1 dan uzoq bo'lsa (kutilgani ~80/80);
- eski mashq tarixingiz bor-u `noma'lum` soni 0 bo'lsa.
Ikkalasida ham eksport faylini sana bo'yicha filtrlash **shart**.

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
shared/              so'z -> fayl nomi, talaffuz tuzatishlari. Server VA klient shu nusxani import qiladi
server/              Fastify: /api/tts/batch, /api/audio/:file, /api/health, atomik yozish
src/core/            SOF MANTIQ — audio/DOM'siz, to'liq testlangan
src/audio/           Web Audio: prefetch, trim, guard-navbat, fade
src/hooks/           klaviatura -> reducer -> audio -> statistika ulanishi
src/screens/         Home, Import, Practice, Results, Stats
tests/               Vitest: core + server + client (hammasi node)
```

Barcha nisbiy importlarda **`.ts` / `.tsx` kengaytmasi yoziladi** — klientda ham, serverda ham.
Vite aniq kengaytmani doim qabul qiladi, Node esa uni **talab qiladi**. Bitta qoida, ikki tomon.
`@/` alias ishlatilmaydi: Vite uni hal qiladi, `node` esa yo'q.
