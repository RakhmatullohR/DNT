# Statistikani yillar davomida saqlash — tahlil va taklif

**Holat:** ✅ **qabul qilindi va amalga oshirildi.** §11 dagi beshta ochiq savolga javob berilgan (pastda, §11 da har birining tagida qayd etilgan). Bajarilgan ish `PLAN.md` §11 da qisqartirilgan; bu hujjat **asoslash manbai** bo'lib qoladi — qaror nima uchun shunday qabul qilinganini shu yerdan qidiring.
**Sana:** 2026-08-09 (taklif), amalga oshirildi 2026-08-09.
**Aloqador:** `PLAN.md` §6 (statistika), `PLAN.md` §10 (xatarlar) va `PLAN.md` §11 (qarorlar registri); `src/core/wordScore.ts`, `src/store/stats.ts`, `src/store/statsSchema.ts`, `src/store/statsDb.ts`, `src/store/statsMigrate.ts`, `src/store/statsCompact.ts`, `src/store/persist.ts`.

> ⚠️ **Bu hujjat TAKLIF tilida yozilgan** ("taklif etilayotgan sxema", "qaror sizniki") va u ataylab shunday qoldirilgan: uni o'tgan zamonga tarjima qilish tahlilning borishini — qaysi nomzod nega rad etilganini — o'chirib yuborardi. Amaldagi holat uchun `PLAN.md` §11 ga qarang.
*(Eslatma: `§N` yolg'iz yozilsa — shu hujjatning bo'limi; `PLAN.md` bo'limlari doim shunday to'liq nomlanadi.)*
**Tashqi manbalar:** §15.

Bu hujjat bitta so'rovdan chiqdi:

> *"Statistikaning yillar davomida saqlab borilishini hohlayman. Har bir so'z nechi marta yozilganini, oxirgi marta qachon yozilganini, nechi marta xato yozilganini — bitta id asosida saqlash. Shunda statistikaning hajmi oshib ketmaydi."*

Quyida shu g'oya xalqaro amaliyot bilan qayta tahlil qilingan. **Xulosa oldindan: g'oyaning yadrosi to'g'ri, lekin uni oqlaydigan sabab siz aytgani emas.** Buni ochiq yozish shu hujjatning asosiy vazifasi — chunki noto'g'ri sababga qurilgan qaror keyin noto'g'ri joyda buziladi.

---

## 1. Bugungi holat — o'lchangan raqamlar

`src/store/stats.ts` (897 qator) uchta jadvalni bitta `localStorage` kalitida saqlaydi (`dnt.stats.v1`):

```ts
type StatsData = {
  version: 1
  sessions: SessionRecord[]              // MAX_SESSIONS = 500, eng eskisi tashlanadi
  words: Record<string, WordStat>        // { exposures, errors } — SANA YO'Q
  days: Record<string, DayStat>          // 'YYYY-MM-DD' → { correctKeystrokes, activeMs, sentences }
}
```

**Uchta muammo bor, va ularning hech biri hajm emas:**

**1.1. So'z yozuvida vaqt o'lchovi yo'q.** `WordStat = { exposures, errors }` — bo'shliq. `hardestWords()` reytingi `errors / exposures` bo'yicha tartiblaydi, ya'ni **umrbod o'rtacha**. Uch yil oldin qiynalgan va endi mukammal yozadigan so'z ro'yxat boshida abadiy qoladi; kecha qiynala boshlagan so'z esa eski to'g'ri urinishlar ichida eriydi. **Bu sizning asosiy shikoyatingiz va u to'liq asosli.**

**1.2. Ikkita ochiq tab ma'lumot yo'qotadi.** `stats.ts:4-8` da ochiq tan olingan: har `recordSession` butun hujjatni o'qib, yangilab, qayta yozadi. Ikkinchi tabda bir vaqtda tugagan seans jimgina yo'qoladi.

**1.3. Eskirish bilan o'lchov asboblari zaiflashadi.** `audioComparison()` — PLAN §8 dagi ⭐ M2/M3 gate'ning yagona o'lchov asbobi — faqat `sessions` dan o'qiydi (`stats.ts:707`). `MAX_SESSIONS = 500` chegarasidan oshgach eng eski seanslar tashlanadi va gate **jimgina** zaiflashadi. Kuniga 2 seansda 500 ta ~8 oyda to'ladi. Bu nazariy ufq emas.

**Hajm esa quyidagicha (taxminlar, kiritma qiymatlari bilan):**

| Nima | Hisob | Natija |
|---|---|---|
| Bitta `SentenceRecord` JSON | suzuvchi sonlar **yaxlitlanmagan** (`netWpm: 39.71388918543824`) | ~261 B |
| 500 seans × ~17 gap | `500 × (311 + 17 × 261)` | **~2.3 MB** |
| `words`, ~5k so'z | `{"the":{"exposures":1234,"errors":12}}` ≈ 38 B | ~190 KB |
| `days`, 3 yil | ~75 B × 1100 | ~82 KB |

Ya'ni bugungi ombor ~5 MB shiftning yarmiga yaqinini egallagan, va uning **90% i — seans tafsilotlari**, so'z jadvali emas.

---

## 2. G'oyangizning tahlili

### 2.1. Yadro to'g'ri: "har so'z uchun bitta qator"

Bu **pre-agregatsiya** — telemetriya va OLAP tizimlarining asosiy usuli. Hodisalar jurnalini saqlash o'rniga har bir obyekt uchun sobit o'lchamdagi hisoblagichlar saqlanadi. Natijada hajm *nechi marta yozganingizga* emas, *nechta HAR XIL so'z ko'rganingizga* bog'liq bo'ladi.

Va har xil so'zlar soni **to'yinadi**. Heaps qonuni: `V = K · n^β`, bunda `n` — jami so'zlar, `V` — har xil so'zlar, β ≈ 0.5. Ya'ni jadval **kvadrat ildiz tezligida** o'sadi.

### 2.2. Lekin `n` siz o'ylagan narsa emas

Muhim nuqta: `n` — bu **terilgan** so'zlar emas, **import qilingan matn korpusi**. Bir darsni qayta-qayta terish `n` ni oshiradi, `V` ni umuman oshirmaydi.

Ufqni ochiq qo'yamiz: 20 yil × ~250 mashq kuni, har ~25 mashq kuniga bitta yangi dars → ~200 dars × ~15 gap × ~12 so'z ≈ **36 000 manba so'zi**.

```
V = K · √36000 = K · 189.7

K = 15  →  ~2 850     (soddalashtirilgan ESL matni)
K = 25  →  ~4 740
K = 50  →  ~9 490     (Brown korpusi: 1M so'z → ~50k tur, ya'ni K ≈ 50)
```

`K` matn turiga bog'liq va ingliz nasri uchun standart baho **K ≈ 50** — shuni ham kiritish halolroq. **Eng yomon holatda ham ~9 500 har xil so'z**, ya'ni 30 baytdan **~285 KB**.

**Xulosa butun oraliqda saqlanadi:** so'z jadvali hech qachon megabaytlarga chiqmaydi.

### 2.3. Sabab-oqibatdagi tuzatish

> *"Bitta id asosida saqlasak, hajm oshib ketmaydi."*

Hajmni cheklaydigan narsa **id emas — hisoblagich**. `"the": {e, x}` ham, `17: {e, x}` ham bitta qatorda qoladi. Id faqat konstanta koeffitsiyentni ~35–45% kamaytiradi.

Va yuqoridagi hisobdan ko'rinadiki, **bu kamaytirish kerak ham emas**: so'z jadvali hech qachon muammo bo'lmagan. Muammo bo'lgan narsa — seans tafsilotlari, va ular allaqachon `MAX_SESSIONS` bilan kesilgan.

Ustiga, eng arzon to'rtta tuzatish bugungi omborni abadiy barqaror qiladi:

| Tuzatish | Ta'siri |
|---|---|
| `netWpm`/`rawWpm` ni 1 kasrgacha, `accuracy` ni 3 kasrgacha yaxlitlash | 261 → 222 B |
| `SentenceRecord` dan `lessonId` ni olib tashlash (u `SessionRecord.lessonId` da allaqachon bor) | 222 → 192 B |
| `words` ni tuple shakliga: `{"w": [e, x, lastDay]}` | 38 → ~21 B/qator |
| `MAX_SESSIONS` 500 → 250 | 1.79 → 0.89 MB |

To'rttala tuzatish qo'llangandagi barqaror holat (20 yillik ufq, §2.2 dagi eng yomon so'z soni bilan):

```
seanslar   250 × (311 + 17×192 B)  ≈ 0.89 MB
so'zlar    9 500 × 21 B            ≈ 0.20 MB
kunlar     5 000 × 75 B            ≈ 0.38 MB
                                   ─────────
jami                               ≈ 1.5 MB   — 5 MB shiftining ~30% i
```

**Natija: ~1.5 MB, barqaror.** `localStorage` da, ~80 qator kod bilan, hech qanday yangi bog'liqliksiz. (`MAX_SESSIONS` 500 da qoldirilsa ~2.4 MB — u ham shiftdan xotirjam pastda.)

*Barcha MB — o'nlik (10⁶ B).*

### 2.4. Demak `localStorage` hajmi hech qachon bog'lovchi cheklov bo'lmagan

Bu hujjatning eng muhim halol qismi. Agar biz IndexedDB'ni "hajm sig'maydi" degan sabab bilan olsak — noto'g'ri sababga qurgan bo'lamiz.

**Lekin bu IndexedDB kerak emas degani emas.** U kerak, faqat boshqa sabablar uchun (§3).

### 2.5. "Bitta id" ga halol javob

IndexedDB'da **so'z satrining o'zini birlamchi kalit qilish** (`keyPath: 'w'`) sizning g'oyangizning mohiyatini — "har so'zga bitta barqaror qator" — to'liq bajaradi. **So'zning o'zi o'sha id.**

Raqamli id qo'shsak, u nima beradi va nima olib keladi:

| Raqamli id | `keyPath: 'w'` |
|---|---|
| `nextWordId` hisoblagichi `meta` da | yo'q |
| Ajratish uchun alohida tranzaksiya | yo'q |
| `by_w` unikal ikkilamchi indeks (satrdan qatorga o'tish uchun) | yo'q — kalit o'zi satr |
| id ↔ satr desinxron bo'lish sinfi | yo'q |
| **Kalit qoidasi o'zgarganda: indeksni qayta qurish** | **har qatorni o'chirib qayta kiritish** |

Oxirgi qator — raqamli id'ning yagona haqiqiy afzalligi, va u haqiqiy. IndexedDB birlamchi kalitlari **o'zgarmas**. Bugun kalit `token.text.toLowerCase()`, va `WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/` (`src/core/tokenize.ts:19`) apostrof va defisni so'z **ichida** ushlaydi — `don't` va `well-known` bitta kalit. Ertaga bu qoida o'zgarsa (`'s` ni kesish, defislilarni ajratish), `keyPath: 'w'` bilan migratsiya og'ir bo'ladi: har qatorni o'chirib qayta kiritish va to'qnashganlarini qo'lda birlashtirish.

Yumshatuvchi omil: `src/core/normalize.ts:81` importda `’` → `'` ni allaqachon yig'adi, ya'ni eng ehtimolli sabab (turli apostroflar) yopiq.

**Tavsiya: `keyPath: 'w'`. Qaror sizniki** — §11.1 ga qarang.

---

## 3. Nima uchun IndexedDB

> ⚠️ **Bu bo'lim tuzatildi.** Hujjatning oldingi qoralamasida "`persist()` faqat IndexedDB'ni himoya qiladi, `localStorage` da bunday himoya yo'q" deyilgan edi. **Bu noto'g'ri** — pastda sabab bilan.

### 3.1. Eviction himoyasi IndexedDB'ning afzalligi EMAS

WHATWG Storage Standard bo'yicha `navigator.storage.persist()` **origin'ning butun storage bucket'ini** doimiy qiladi. Bucket ichida IndexedDB ham, Cache API ham, **Web Storage (`localStorage`) ham** birga yashaydi. Eviction ham shu darajada ishlaydi: bucket chiqarib tashlansa, uning **hammasi** birdan o'chadi, qismi emas.

**Ikkita amaliy natija:**

1. `persist()` — IndexedDB'ga o'tish sababi **emas**. U ikkala variantni ham bir xil himoya qiladi.
2. ⭐ **`persist()` ni bugunoq chaqirish kerak.** U migratsiyani kutmaydi va hozirgi `localStorage` ma'lumotingizni **darhol** himoya qiladi. Bu hujjatdagi eng arzon va eng tez foydali tavsiya.

### 3.2. Haqiqiy sabablar

**(a) `localStorage` sinxron va asosiy oqimni bloklaydi.**
Har `setItem` disk I/O tugaguncha oqimni to'xtatadi. Bugun har seans oxirida ~2 MB JSON qayta seriyalanadi va sinxron yoziladi — ya'ni interfeys o'sha paytda **qotadi**. web.dev buni ochiq yozadi: *"LocalStorage should be avoided because it is synchronous and will block the main thread"*, va katta ma'lumot uchun IndexedDB tavsiya qilinadi. IndexedDB asinxron.

**(b) Tranzaksiya — ko'p tab muammosi (§1.2).** IndexedDB yozuvlari atomik: `readwrite` tranzaksiya ichidagi o'qi-o'zgartir-yoz ketma-ketligi boshqa tab bilan to'qnashmaydi.
⚠️ Lekin buni **shartsiz da'vo qilib bo'lmaydi** — §8.4 ga qarang: versiya yangilanishi ochiq turgan boshqa tab tufayli bloklanishi mumkin va bu holat qo'lda hal qilinishi shart.

**(c) Qisman yozuv.** Butun hujjat o'rniga faqat o'zgargan qatorlar yoziladi. Bu **har gap tugaganda yozish** imkonini beradi (§8) — `pagehide` da yo'qotish blast radiusi bitta seansdan bitta gapga tushadi. Yon foyda: yozuv amplifikatsiyasi ~2 MB dan ~1 KB ga tushadi.

**(d) Strukturaviy nusxa.** IndexedDB obyektlarni JSON matn sifatida emas, strukturaviy nusxa sifatida saqlaydi — har o'qishda 2 MB `JSON.parse` qilish kerak emas.

**(e) Kvota.** 5 MB o'rniga diskning 10–60% i. §2 ga ko'ra bu bugungi ehtiyoj uchun hal qiluvchi emas, lekin shiftni butunlay olib tashlaydi.

### 3.3. Halol qolgan xatar

`persist()` **rad etilishi mumkin** (brauzer foydalanuvchi bilan aloqa evristikasiga qaraydi; Firefox so'raydi). Va WebKit skript yozadigan omborni ma'lum sharoitlarda 7 kun bilan cheklaydi. Shuning uchun §12 M4 da Statistika ekraniga `navigator.storage.persisted()` va `estimate()` holat ko'rsatkichi kiritiladi: **jimgina yo'qolish o'rniga ko'rinadigan holat**, va muntazam eksport odatga aylantiriladi.

---

## 4. Taklif etilayotgan sxema

Ma'lumotlar bazasi `dnt-stats`, to'rtta object store.

### 4.1. `words` — abadiy, `keyPath: 'w'`

```ts
type WordRow = {
  w:  string   // kichik harfli yuza shakl — BIRLAMCHI KALIT
  e:  number   // umrbod ta'sirlanish   ← "nechi marta yozilgan"
  x:  number   // umrbod xato           ← "nechi marta xato"
  f:  number   // birinchi kun (kun raqami, LOKAL)
  l:  number   // oxirgi kun            ← "oxirgi marta qachon"
  de: number   // so'nuvchi ta'sirlanish (yarim yemirilish 90 kun)
  dx: number   // so'nuvchi xato
  s:  number   // joriy toza seriya (ketma-ket xatosiz ta'sirlanish)
  b:  number   // eng yaxshi seriya
}
```

Sizning uch so'rovingiz — `e`, `l`, `x`. Qolgan to'rttasi ularni **foydali** qiladi (§5, §6).

**`l` MONOTON:** `l = max(oldingi, bugun)`. Tizim soati orqaga ketsa yoki mintaqa o'zgarsa yozuv buzilmasin.

Indeks `by_l` — "yaqinda mashq qilinganlar" ro'yxati uchun. **Reyting uchun emas:** so'nuvchi ballni IndexedDB indekslay olmaydi (u hisoblanadigan ifoda va o'qish vaqtida o'zgaradi), shuning uchun reyting to'liq skanerdan chiqadi. ~5 000 qatorda bu ~10 ms — muammo emas, lekin buni bilib turish kerak.

**Ataylab QO'SHILMAYDI:**
- **So'z bo'yicha tarix massivi** (`[{sana, xato}, ...]`) — chegarasiz o'sadi. Aynan siz qochmoqchi bo'lgan narsa. `de`/`dx` xuddi shu ma'lumotni **sobit ikkita songa** siqadi (§5).
- **So'z bo'yicha yozish tezligi** — klavish bosish vaqt tamg'alari `TypingState` da umuman yo'q (`src/core/types.ts`), faqat `startedAt`, `lastKeyAt` va yig'ma `activeMs` bor. Buni qo'shish yozuv dvigatelini o'zgartirishni talab qiladi. Alohida ish (§7.2).

### 4.2. `days` — abadiy, `keyPath: 'd'` (`'YYYY-MM-DD'`, LOKAL)

Bugungi uchta maydon ustiga:

| Yangi maydon | Nima uchun |
|---|---|
| `k` — jami bosishlar | Kunlik **aniqlikni** abadiy hisoblash uchun. Bugun aniqlik faqat seans yozuvida bor va seans bilan birga o'chadi. |
| `nc` — net belgilar | PLAN §6 da **ochiq tan olingan** kunlik trend nomuvofiqligini tuzatadi (kunlik chiziq `correctKeystrokes` dan chizilgani uchun backspace'dan keyin qayta yozilgan harf ikki marta sanaladi). `nc` gap yozuvidan hosil qilinadi: `netWpm · activeMs / 60000 · 5`. |
| `on` / `off` chelaklar | **M2/M3 gate seanslar tashlangandan keyin ham yashaydi** — §1.3 dagi muammoning yechimi. |

⚠️ **Ikkita son bilan chelak yasab bo'lmaydi.** `AudioBucket` (`stats.ts:650-658`) yetti maydonli. Kunlik jadvalda chelak boshiga **oltita yig'uvchi** kerak:

```
sentences, activeMs, keystrokes, correctKeystrokes, netWeighted, rawWeighted
```

Qolgan uchtasi shulardan chiqadi: `netWpm = netWeighted/activeMs`, `rawWpm = rawWeighted/activeMs`, `accuracy = correctKeystrokes/keystrokes`. Ustiga `unknown` sanog'i (ovoz holati yozilmagan eski gaplar).

**Qator kengligi:** 3 baza + `k` + `nc` + 12 chelak + `unknown` = 18 son ≈ ~500 B.
**20 yil:** 20 × 250 mashq kuni = 5 000 qator ≈ **~2.5 MB**.

**Oylik yig'ish (rollup) kerak emas** — 2.5 MB IndexedDB kvotasi oldida hech narsa, kod esa murakkablashardi.

⚠️ **`k`, `nc` va chelaklar faqat OLDINGA ishlaydi.** Migratsiyada ularni faqat omon qolgan ≤500 seansdan tiklash mumkin; undan eskiroq kunlar hozirgi taqribiy trendda **abadiy qoladi**. Bu `audioEnabled?` bilan bir xil presedent: **yo'q maydon ≠ nol**, va u UI da shunday ko'rsatiladi.

### 4.3. `meta.lifetime` — umrbod hisoblagichlar

Bu bo'lim mavjud emas edi va **kerak ekanligi tahlil paytida aniqlandi**.

`totals()` (`stats.ts:775-796`) FAQAT `sessions` dan o'qiydi va `sessions.length` ni qaytaradi. U **ikkita** ekranda umrbod raqam sifatida chiziladi: `Stats.tsx:153` va `Home.tsx:165`. 180 kunlik retention joriy qilinsa, **umrbod seans sanog'i orqaga yurishni boshlaydi**.

Lekin barcha maydonni omon qolgan seanslardan urug'lantirish ham xato bo'lardi — bu **noto'g'ri sonni "umrbod" deb muzlatish**. Har maydon o'z manbasiga ega:

| Maydon | Manbasi | `since` |
|---|---|---|
| `activeMs`, `correctKeystrokes` | ✅ **`days` dan ANIQ** | yo'q — haqiqiy umrbod |
| `netChars` | ⚠️ omon qolgan seanslardan **hosil qilinadi** (`netWpm·5·activeMs/60000`) | eng eski omon qolgan seans |
| `sessions`, `keystrokes` | ❌ faqat qisman — omon qolgan seanslardan | eng eski omon qolgan seans |

Birinchi qator nega aniq: `recordSession` har bir `skipped` bo'lmagan gapning `correctKeystrokes` va `activeMs` ini `days` ga yozadi, va **`days` hech qachon qisqartirilmaydi** (`stats.ts:557-590` — qisqartirish faqat `sessions` ga tegadi).

Uchala guruh **har xil `since` ga ega**. Bitta umumiy sana qo'yish aynan bu jadval oldini olishi kerak bo'lgan xatoni yasardi. Tiklanmagan maydonlar UI da **`≥ N (sanadan)`** deb chiziladi, yalang'och umrbod raqam sifatida emas.

> **Yon topilma:** `totals().activeMs` **bugun ham noto'g'ri** — seanslar qisqarganda u kamayadi, `days` esa to'g'ri sonni ushlab turadi. `days` dan urug'lantirish jonli xatoni ham tuzatadi.

### 4.4. `sessions` — 180 kun, `keyPath: 'id'`, `by_endedAt` indeksi

To'liq `SessionRecord` + gap yozuvlari. Har boshlanishda `compact()` 180 kundan eskisini o'chiradi. Ularning hissasi `days` va `meta.lifetime` da yashaydi.

---

## 5. So'nish (decay)

Sizning `lastAt` so'rovingiz to'g'ri edi, lekin uning asosiy qiymati **ko'rsatishda emas**.

Muammo: umrbod nisbat hech narsani unutmaydi. Yillar o'tib u fossilga aylanadi.

Yechim — **eksponensial so'nuvchi hisoblagichlar** (EWMA; Redis LFU, Prometheus va tavsiya tizimlarida ishlatiladi):

```ts
const HALF_LIFE_DAYS = 90

function decayTo(row: WordRow, today: number): void {
  const dt = Math.max(0, today - row.l)          // ⚠️ max(0, …) — soat orqaga ketsa shishmasin
  if (dt === 0) return
  const factor = Math.pow(0.5, dt / HALF_LIFE_DAYS)
  row.de *= factor
  row.dx *= factor
}

// Ta'sirlanish paytida:
decayTo(row, today)
row.de += 1;  row.dx += errors
row.e  += 1;  row.x  += errors
row.l = Math.max(row.l, today)
```

Xususiyatlari:

- **O(1), tarixsiz.** Ikkita son butun tarixni ifodalaydi.
- **Har kuni so'ndirish bilan matematik jihatdan aynan teng** — eksponensial funksiya multiplikativ, shuning uchun dangasa hisoblash aniq natija beradi.
- 90 kunlik yarim yemirilish: 3 oy oldingi xato bugungisining yarmi og'irligiga ega, bir yil oldingisi ~1/16.

**⚠️ Eskirish invarianti.** Saqlangan `de`/`dx` — `l` sanasidagi holat, bugungi emas. **Har o'qishda, tartiblashdan OLDIN `decayTo(bugun)` qo'llanishi shart.** Bu qoida buzilsa reyting jimgina noto'g'ri tartibda chiqadi.

### 5.1. ⚠️ Sobit 90 kun — bu soddalashtirish, "eng yaxshi amaliyot" EMAS

Buni halol yozish kerak: **nashr etilgan tizimlarning hech biri yagona global yarim yemirilishdan foydalanmaydi.**

- **Duolingo HLR** (Settles & Meeder, ACL 2016) yarim yemirilishni **har element uchun alohida hisoblaydi**: `ĥ = 2^(Θ·x)`, esda qolish ehtimoli `p = 2^(−Δ/h)`. Bu yerda `x` — xususiyatlar vektori (ta'sirlanish/to'g'ri javob sonlari, leksema teglari), `Θ` — o'rgatilgan og'irliklar.
- **FSRS** har karta uchun **Stability `S`** ni saqlaydi va uni har takrorlashdan keyin qayta hisoblaydi.

Ya'ni ular yarim yemirilishni **o'rganadi**, biz esa uni qo'lda qo'yamiz.

**Almashuv halol ko'rinishi:**

| Sobit 90 kun (taklif) | O'rganiladigan half-life (HLR/FSRS) |
|---|---|
| Ikkita son, O(1), nol parametr | Model + parametr moslash kerak |
| Cold-start muammosi yo'q | Har element uchun yetarli tarix kerak |
| Bir qatorda tushuntiriladi | Foyda real: FSRS bir xil eslab qolish uchun ~20–30% kam takrorlash da'vo qiladi |
| **Tuzatish oson: konstantani o'zgartirish** | Qayta o'qitish kerak |

**Qaror: sobit 90 kun bilan boshlanadi, lekin u "MVP soddalashtirishi" deb belgilanadi**, "sanoat standarti" deb emas. `HALF_LIFE_DAYS` `STREAK_MIN_CORRECT` kabi eksport qilinadigan konstanta bo'ladi (§11.2).

---

## 6. Reyting formulasi

Bu hujjatning eng texnik qismi, va **dastlabki uchala nomzod raqamda yiqildi**. Ularni ko'rsatib o'tamiz, chunki nima uchun rad etilgani muhim.

Sinov holati: `1 ta ko'rildi / 1 ta xato` (100%, lekin bitta kuzatuv) va `50 ta ko'rildi / 10 ta xato` (20%, ishonchli). Ikkinchisi yuqoriroq turishi kerak.

| Nomzod | `1/1` | `10/50` | Natija |
|---|---|---|---|
| Xom nisbat `x/e` | 1.000 | 0.200 | ❌ bir marta ko'rilgan so'z birinchi |
| Wilson pastki chegarasi (z=1.96) | 0.207 | 0.112 | ❌ **baribir teskari** |
| `(dx + 0.5)/(de + 2)` | 0.500 | 0.202 | ❌ **yanada kuchliroq teskari** |
| ⭐ `(dx + m·g)/(de + m)`, m=20, g=0.08 | **0.124** | **0.166** | ✅ to'g'ri tartib |

### 6.1. G'olib: empirik Bayes shrinkage

```
g = Σdx / Σde                    // global so'nuvchi xato ulushi
score = (dx + m·g) / (de + m)    // m = 20
```

Farq nimada: oldingi ikkala nomzod kam kuzatilgan so'zni **yuqoriga** tortadigan priorga ega edi. Bu yerda prior **kuzatilgan bazaviy darajaga** (`g`) o'rnatiladi — ya'ni "bu so'z haqida ma'lumot yo'q" degani "u o'rtacha" degani, "u dahshatli" degani emas.

Bu **empirik Bayes shrinkage** — xalqaro standart usul. IMDb Top 250 reytingi, beysbol o'yinchilari statistikasi va A/B testlarda aynan shu ishlatiladi.

Namunaviy tartib (m=20, g=0.08):

```
 5/10   raw=0.50   score=0.2200   ← eng qiyin
 3/3    raw=1.00   score=0.2000
10/50   raw=0.20   score=0.1657
 2/3    raw=0.67   score=0.1565
 1/1    raw=1.00   score=0.1238
20/200  raw=0.10   score=0.0982
 0/20   raw=0.00   score=0.0400   ← eng oson
```

### 6.2. ⚠️ Sezgirlik — buni bilib turish shart

`g` konstanta emas, u vaqt bilan siljiydi. `1/1` va `10/50` tartibi buzilmasligi uchun:

```
m > 40 / (9 − 49g)
```

| `g` | kerakli `m` | m=10 | m=20 |
|---|---|---|---|
| 0.08 | > 7.9 | ✅ (tor) | ✅ |
| 0.10 | > 9.8 | ⚠️ chegarada | ✅ |
| 0.12 | > 12.8 | ❌ | ✅ |
| 0.15 | > 24.2 | ❌ | ❌ |
| ≥ 0.184 | **imkonsiz** | ❌ | ❌ |

Tartib ag'dariladigan nuqta `m` ga bog'liq: `g = (9 − 40/m) / 49`.

| `m` | tartib ag'dariladigan `g` |
|---|---|
| 10 | **0.102** |
| 20 | **0.143** ← tanlangan qiymatning haqiqiy zaxirasi |
| ∞ | 0.184 (nazariy chegara) |

Shuning uchun `m = 20` tanlangan: `m = 10` da zaxira `g = 0.102` da tugaydi, `m = 20` da esa `g = 0.143` gacha cho'ziladi. **Lekin hech qanday `m` `g ≥ 9/49 ≈ 0.184` da ishlamaydi.**

~~Va `g` kutilganidan yuqori chiqishi mumkin: xatolar klavish darajasida sanaladi (`useTypingSession.ts:491` — `errorCounts` yig'indisi), ya'ni bitta so'zdagi uchta noto'g'ri harf uchta xato bo'lib hisoblanadi.~~
✅ **Bu xatar amalga oshirishda YOPILDI** (pastdagi izohga qarang): xato endi ta'sirlanish darajasida sanaladi, ya'ni `g` haqiqiy ulush va u shu jadvaldagi chegaralardan tabiiy ravishda pastroq turadi.

**Xulosa: haqiqiy kafolat formula emas — minimal ta'sirlanish to'sig'i.** Bu §11.4 ni hujjatdagi eng muhim ochiq savolga aylantiradi.

> ✅ **AMALGA OSHIRISHDA TUZATILDI — xato endi TA'SIRLANISH darajasida sanaladi.**
>
> Yuqoridagi xatboshi ("bitta so'zdagi uchta noto'g'ri harf uchta xato") amalga oshirish paytida **ikkita** nuqsonga olib kelishi aniqlandi:
>
> 1. **`errors > exposures` bo'lishi qisqichni talab qilardi, qisqich esa TARTIBGA BOG'LIQ edi.** Ayni mashq tarixi, faqat seanslar tartibi boshqa: `{e:1,x:3}` → `{e:5,x:0}` **17%** beradi, teskarisi esa **50%**. Buzilish umrbod `errors` da — foydalanuvchi aynan so'ragan raqamda — va kesilgan farq na diskda, na seanslarda qolmaydi, ya'ni tiklab bo'lmaydi.
> 2. **Qisqich xato OG'IRLIGINI baribir yo'q qilardi.** `{e:1,x:1}` × 10 va `{e:1,x:5}` × 10 qisqichdan keyin **baytma-bayt bir xil** qatorga tushadi. Ya'ni klavish darajasidagi sanoq hech qachon ekranga yetib bormasdi.
> 3. **§6.3 bilan birlik nomuvofiqligi.** `estimateBeta` `p_i = errors_i / exposures_i` ni **binomial ulush** deb modellaydi (`Var(p_i) = Var(θ) + E[θ(1−θ)]·E[1/n_i]` hadi aynan shuni talab qiladi). Klavish sanog'ida `p_i` umuman ulush emas, ya'ni §6.3 apparati noto'g'ri birlik ustida ishlardi.
>
> **Qaror:** qisqich MANBAGA ko'chirildi — `useTypingSession` xatoni `min(errorCounts, 1)` bilan yozadi. Endi `x` = *"bu so'z necha marta xato bilan yozilgan"*, klavish xatolari soni emas.
>
> Bu foydalanuvchining so'roviga ham **yaqinroq**: *"nechi marta xato yozilganini"* — uch harfni chalkashtirish "uch marta xato yozish" emas. Yon foyda: `x ≤ e` qurilish bo'yicha o'rinli, natija tartibdan mustaqil, `g` haqiqiy ulushga aylanadi va shu jadvaldagi chegaralardan **pastroq** turadi — ya'ni siljish xavfsiz tomonga.
>
> ⚠️ **Almashuv:** xato og'irligi (bitta so'zda nechta harf xato qilingani) endi umuman saqlanmaydi. Yuqorida ko'rsatilganidek u qisqich tufayli **allaqachon** yo'qolgan edi, shuning uchun bu yangi yo'qotish emas — lekin kerak bo'lsa alohida hisoblagich sifatida keyin qo'shilishi mumkin.

### 6.3. `m` ni ma'lumotdan baholash mumkin

`m = 20` **qo'lda tanlangan** — buni tan olish kerak. Standart usul bor: `g` va `m` ni so'zlar populyatsiyasiga Beta(α, β) prior moslash bilan baholash, so'ng

```
g = α / (α + β)              // prior o'rtacha
m = α + β                    // priorning "effektiv namuna hajmi"
```

Momentlar usuli bilan: so'zlar bo'yicha kuzatilgan xato ulushlarining o'rtachasi `μ̄` va dispersiyasi `s²` orqali

```
m̂ = μ̄(1 − μ̄) / s² − 1
```

**Qaror: hozir sobit `m = 20`, keyin baholanadigan.** Sababi — `m̂` ning o'zi kam ma'lumotda beqaror, va §6.2 jadvali ko'rsatdiki muhimi `m` ning **aniq qiymati emas, yetarlicha katta bo'lishi**. Lekin `m` ni `g` bilan birga bir marta hisoblab, konstantani tekshirib turish arzon — bu M4 ga qo'yiladi.

### 6.4. Chegara yo'q — nega

Dastlabki loyihada "`de < 3` bo'lsa umrbod nisbatga qaytish" qoidasi bor edi. **U rad etildi.**

Sababi: Δ kunda bir marta takrorlanadigan so'z uchun barqaror holat

```
de* = 1 / (1 − 0.5^(Δ/90))
```

`de* ≥ 3` sharti `Δ ≤ 90·ln(2/3)/ln(0.5) = 52.6 kun` beradi.

Ya'ni **~53 kundan siyrak uchraydigan so'z chegaraga hech qachon yetmaydi** va abadiy umrbod nisbat bilan baholanadi — aynan §1.1 dagi fossillashuv. Va siyrak uchraydigan so'z odatda aynan qiyin so'z.

Ikkinchi nuqson: chegara bitta tartiblangan ro'yxatga ikkita o'lchamas shkalani aralashtirardi.

**Bitta formula, shoxlanishsiz.**

### 6.5. Migratsiya cold-start

`de = dx = 0` bilan boshlansa, hamma so'z `g` ga teng ball oladi va reyting **o'lik** bo'ladi. Shuning uchun:

```
de = min(e, m)
dx = x · de / e        // e > 0 kafolatlangan: parseStats `exposures === 0` qatorlarini tashlaydi (stats.ts:361)
```

Umrbod tartib **taxminan** saqlanadi (aniq faqat `e > m` bo'lganda va teng ulushli so'zlar orasida; chegara ustida tartib o'zgaradi va bu yaxshilanish). Keyingi oylarda so'nish uni tabiiy ravishda haqiqiy ma'lumotga almashtiradi.

### 6.6. Wilson nega rad etildi — halol sabab

Wilson pastki chegarasi ("How Not To Sort By Average Rating") aynan shu masala uchun mashhur. Lekin:

1. **U kutilgan foydani bermaydi.** `1/1 → 0.207` va `10/50 → 0.112` — yuqoridagi jadval. U minimal to'siq ehtiyojini **yo'qotmaydi**, faqat yumshatadi.
2. **U ishonch chegarasi, baho emas.** Bizga kerak narsa — bazaviy darajaga tortilgan baho.
3. Qamrov kafolati butun sonlarni nazarda tutadi, so'nuvchi hisoblagichlar esa kasr. *(Diqqat: "kasr uchun aniqlanmagan" degani emas — Wilson uzluksiz funksiya va kasr `n` da ham hisoblanadi. Faqat statistik kafolati o'z kuchini yo'qotadi.)*

---

## 7. Xalqaro amaliyot bilan taqqoslash — nima qamralmagan

Bu bo'lim ataylab qo'shildi: yuqoridagi taklif **o'lchov** tizimi, **o'qitish** tizimi emas. Farqni ochiq qo'yish kerak.

### 7.1. ⭐ Eng katta bo'shliq: takrorlash rejasi (spaced repetition) yo'q

Taklif *"qaysi so'z qiyin?"* savoliga javob beradi. U *"bugun qaysi so'zni mashq qilishim kerak?"* savoliga javob **bermaydi**. Ikkinchisi — lug'at o'rganishning asosiy savoli, va uning nashr etilgan yechimlari bor:

| Algoritm | Har element uchun saqlanadigan holat | Izoh |
|---|---|---|
| **SM-2** (SuperMemo, 1987) | takrorlash soni `n`, yengillik `EF` (boshlang'ich 2.5), interval `I` — 3 skalar | Evristik, o'rganilmaydi. Anki'ning eski standarti. |
| **HLR** (Duolingo, ACL 2016) | ta'sirlanish/to'g'ri sonlari + leksema teglari; `h = 2^(Θ·x)` | Global `Θ` o'rgatiladi, half-life element bo'yicha chiqadi. |
| **FSRS** | **Stability `S`**, **Difficulty `D`** (`R` shulardan chiqadi) | 17–21 global parametr, foydalanuvchi tarixidan moslanadi. **Anki 23.10+ da mavjud va amalda ochiq standartga aylandi.** |

**Bizning sxema bunga to'sqinlik qiladimi?** Yo'q — aksincha, **poydevor mos**:

- `l` (oxirgi kun) — `Δ` ni beradi, bu uchala algoritmga ham kerak.
- `de`/`dx` — HLR ning asosiy xususiyatlari (ta'sirlanish va xato sonlari) bilan bir xil turdagi kattaliklar.
- `s`/`b` (toza seriya) — SM-2 dagi `n` ning to'g'ridan-to'g'ri analogi.

FSRS'ga o'tish uchun `WordRow` ga ikkita maydon (`S`, `D`) qo'shilishi kifoya — sxema kengaytiriladigan, chunki IndexedDB'da yangi maydon qo'shish migratsiya talab qilmaydi (yo'q maydon `undefined` bo'ladi, `audioEnabled?` presedenti).

**Qaror: HOZIR qo'shilmaydi.** Sabablari:

1. **Vazifa boshqa.** Anki'da karta *yashirin* — siz eslashga urinasiz. Bu ilovada **matn ko'rinib turadi** (README: *"bu yashirin dictation emas"*). Ya'ni "esda qolish ehtimoli" o'lchanmaydi; o'lchanadigan narsa — imlo/talaffuz bog'lanishining avtomatlashuvi. FSRS ning `R` (retrievability) modeli bu yerga to'g'ridan-to'g'ri ko'chmaydi.
2. **Mashq birligi — gap, so'z emas.** Siz darsni gapma-gap terasiz; alohida so'zni navbatga qo'yish uchun **so'zdan matn generatsiya qilish** kerak bo'lardi. Bu butunlay yangi xususiyat (keybr.com shunday qiladi), o'lchov masalasi emas.
3. Bu bo'shliq **ochiq qayd etilgan** va poydevor tayyor — kerak bo'lsa keyin qo'shiladi.

### 7.2. Belgi darajasidagi statistika — mavjud, lekin tashlab yuboriladi

`TypingState.charErrors` (`src/core/types.ts:41`) har bir belgi pozitsiyasi bo'yicha xatolarni **allaqachon hisoblaydi**. Lekin u faqat `Practice.tsx:360` da jonli chizish uchun o'qiladi va gap tugashi bilan **yo'qoladi** — hech qayerda saqlanmaydi.

Xalqaro amaliyotda bu odatiy emas: **keybr.com** butun modelini per-key xato ulushi va kechikishiga quradi (va shu asosda mashq matnini generatsiya qiladi), **Monkeytype** belgi darajasidagi xato issiqlik xaritasini ko'rsatadi. Ya'ni adaptiv terish trenajyorlari uchun per-key statistika **standart**.

**Qaror: hozir qo'shilmaydi, lekin bu ataylab qilingan tanlov.** Sabab: bu ilovaning maqsadi terish tezligi emas, **imlo↔talaffuz bog'lanishi** (README). Per-key issiqlik xaritasi klaviatura mashqi uchun foydali, lug'at mashqi uchun kam. Agar §7.1 dagi generativ yo'nalish tanlansa, `charErrors` birinchi navbatda kerak bo'ladi — **shuning uchun uni tashlashdan oldin shu qaror eslansin**.

> Diqqat: `charErrors` ni saqlash **arzon emas** — bu belgi darajasidagi jadval, ya'ni yangi store va yangi o'sish o'qi. Uni "tekin ma'lumot" deb qo'shish §2.1 dagi butun intizomni buzardi.

---

## 8. Yozuv shartnomasi

IndexedDB **asinxron**. Bugungi `pagehide` yo'li (`useTypingSession.ts:670`) sinxron `localStorage.setItem` ga tayanadi va u sahifa o'lishidan oldin ulguradi. IDB tranzaksiyasi ulgurmasligi mumkin.

`localStorage` da write-ahead log yuritish — IDB'dan qochmoqchi bo'lgan bog'liqlikni qaytarish. Buning o'rniga **yozuv nuqtasi har gap tugashiga ko'chiriladi** (`useTypingSession.ts:463`). Yo'qotish blast radiusi bitta seansdan **bitta gapga** tushadi.

### 8.1. ⚠️ Ikki marta sanash xatari — real

- `wordStatsRef` seans davomida **kumulyativ** yig'iladi (`useTypingSession.ts:488-492`: `exposures: current.exposures + 1`). Uni har gapda quysa, sonlar ko'payib ketadi. **Delta kerak.**
- `recordAndClose` hozir to'liq `recordsRef` va to'liq so'z xaritasini beradi (`:401-404`), `recordSession` esa gaplarni qayta yurib `days` ga yozadi. **Ikkalasi ham yozsa — seans, so'z va kun ikkilanadi.**

### 8.2. Shartnoma

1. **Gap tugaganda, bitta tranzaksiyada:** gap yozuvi + so'z **deltalari** + kun **deltalari** + **`meta.lifetime` deltalari**.
2. ⚠️ **`meta.lifetime` yopilishda EMAS, har gapda yoziladi.** Aks holda §4.3 dagi bosh to'g'rilik tuzatishi aynan bu bo'lim omon qolish uchun yaratilgan `pagehide` stsenariysining **yagona qurboni** bo'lardi. Hisoblagichlar monoton va additiv — deltalar bemalol qo'shiladi. `sessions` birinchi quyilgan gapda bir marta oshiriladi.
3. **`recordAndClose` faqat seans konvertini yozadi** (yakuniy `endedAt`, `activeMs` bo'yicha og'irlangan yig'indilar) — so'z, kun va hisoblagichlarga **tegmaydi**.
4. **Seans `id` si seans boshida ajratiladi** (hozir `recordAndClose` ichida, `:385`).
   ⚠️ Bu `recordAndClose` ning `null` qaytarishini buzadi — `endSession` shu `null` ga qarab `/` yoki `/results/:id` ni tanlaydi (`:414-425`). **Alohida "hech narsa yozilmadi" signali kerak.**
5. **`hasWrittenSentence` darvozasi saqlanadi** (`src/core/session.ts:101`; PLAN §7 da test bilan mixlangan — hammasi `Escape` bilan tashlangan seans hech narsa yozmaydi). Amalga oshirish: **ketma-ket kelgan barcha** `skipped` gaplar buferda ushlanadi (bittasi emas) va birinchi yozilgan gap paydo bo'lganda birga quyiladi; seans butunlay `skipped` bilan tugasa **bufer tashlanadi**.

### 8.3. Muammo emas, lekin yozib qo'yiladi

- **`Tab` qayta boshlash xavfsiz** — `restartSentence` (`:525`) faqat `restartsRef` ni oshiradi, yozuv qo'shmaydi. Faqat oxirgi urinish yoziladi.
- **Audio `epoch` qorovuli** (`:259-264`) faqat eskirgan ovoz callback'lariga tegishli; saqlashga aloqasi yo'q.
- **StrictMode ning soxta unmount'i** (`:705`) ham xavfsiz — `finishSentence` effektdan emas, `keydown` dan chaqiriladi.

### 8.4. ⚠️ IndexedDB operatsion tuzoqlari — qo'lda yozilgan o'ram ularni HAL QILISHI SHART

Bu tuzoqlar mashhur va ularni bilmasdan yozilgan o'ram jimgina buziladi. **M2 (§12) uchun majburiy talablar:**

**(a) Tranzaksiya avto-commit.** IndexedDB tranzaksiyasi kutilayotgan IDB so'rovisiz hodisalar siklga qaytsa **avtomatik yopiladi**. Ya'ni tranzaksiya ichida IDB'ga tegishli bo'lmagan promise'ni `await` qilish — masalan `fetch` yoki hatto `Promise.resolve()` — tranzaksiyani o'ldiradi va keyingi so'rov `TransactionInactiveError` bilan yiqiladi. §8.2 dagi "bitta tranzaksiyada" shartnomasi shu qoidaga bo'ysunishi kerak: **barcha o'qish/yozish uzluksiz IDB zanjirida bo'lsin.**

**(b) `versionchange` / `blocked` — bu "ko'p tab hal bo'ladi" da'vosini cheklaydi.** Yangi versiyani ochish boshqa tab eski versiyani ushlab turgan bo'lsa `onblocked` beradi va **kutib qoladi**. Ochiq ulanishlar `db.onversionchange` ni tinglab **o'zini yopishi** shart, aks holda migratsiya muzlab qoladi.
Ya'ni: **oddiy yozuvlar uchun tranzaksiya ko'p tab muammosini hal qiladi (§3.2b), lekin sxema yangilanishi uchun yangi muammo tug'diradi.** Ikkalasini ham yozish halol.

**(c) Sxema o'zgarishi faqat `upgradeneeded` ichida.** `createObjectStore` va indekslar boshqa joyda yaratilmaydi.

**(d) Muhit farqlari.** Firefox private rejimida IndexedDB seans bilan tozalanadi; WebKit skript yozadigan omborni ma'lum sharoitlarda cheklaydi (§3.3). Shuning uchun IDB **yo'q yoki ishlamayotgan** holat uchun ochiq banner kerak, jim ishlamaslik emas.

---

## 9. Migratsiya

1. Boot'da IDB ochiladi (`onupgradeneeded` → store'lar yaratiladi).
2. `dnt.stats.v1` **mavjud v1 parseri bilan** o'qiladi (parser saqlanadi, o'chirilmaydi) va ko'chiriladi.
3. `de`/`dx` §6.5 qoidasi bilan urug'lantiriladi.
4. `meta.lifetime` §4.3 jadvali bo'yicha, maydonma-maydon.

### 9.1. ⚠️ `f` va `l` — sizning ikkinchi so'rovingiz

`f = l = migratsiya kuni` deb qo'yish **"oxirgi marta qachon" so'rovini yo'q qiladi**: birinchi kuni ustun ~3–9 ming so'z uchun bir xil bugungi sanani ko'rsatadi — maydon mavjud, ekranga ulangan va **butunlay ma'nosiz**. Siyrak uchraydigan so'z uchun bu holat yillab davom etadi.

Shuning uchun §4.3 dagi tiklanish intizomi **bu yerga ham qo'llanadi**:

- **`l` qisman tiklanadi.** Omon qolgan seanslarda `lessonId` + `sentenceIndex` + `at` bor, va `Results.tsx:196-208` aynan shu qayta qurishni allaqachon namoyish qiladi: `getLesson(session.lessonId)` → `lesson.sentences[record.sentenceIndex]` → `tokenize()`. Ya'ni ~8 oygacha orqaga tiklash mumkin.
- **Tiklanmaganlari UI da "noma'lum (migratsiyagacha)" deb chiziladi**, migratsiya sanasi sifatida **emas**.
- **`f` battarroq.** `l` keyingi ta'sirlanishda o'zini tuzatadi; `f` esa kech qo'yilgan minimum bo'lib **hech qachon tuzalmaydi**. Tiklanmagan `f` doimiy "noma'lum" bo'lib qoladi.

### 9.2. Yo'qotiladigan narsalar

Bularni ochiq yozish shart — ular almashuv, yaxshilanish emas:

- **Buzuq payload tiklash quyi tizimi butunlay o'chadi** — `stats.ts:159-197` (`backupCorrupt`, `corruptStatsBackup`, `discardCorruptStatsBackup`), `Stats.tsx` dagi tiklash UI si va **11 test**. IndexedDB'da "buzuq satr" tushunchasi yo'q: strukturaviy nusxa yo muvaffaqiyatli, yo baza umuman ochilmaydi. O'rnini `persist()` + muntazam eksport bosadi.
- ⚠️ **`unknownSessions` mexanizmi bilan birga OLDINGA MOSLIK ham yo'qoladi.** Bugungi parser tanimagan seans yozuvini saqlab qoladi va diskka qaytaradi (`stats.ts:203-209`) — ya'ni **yangi versiyada yozilgan yozuvni eski build o'chirib yubormaydi**. IndexedDB'ga o'tgach bu himoya yo'qoladi: eski build yangi sxemadagi maydonlarni bilmaydi. Ilova bitta qurilmada, bitta versiyada ishlagani uchun xatar past, lekin **u nolga tushmaydi** (masalan eski tab ochiq qolsa). Kamaytirish: har o'qishda notanish maydonlarni saqlab qoldirish (`{...row, ...known}` emas, balki butun qatorni saqlash).
- **Testlar:** `tests/core/stats.test.ts` da 66 `it()`. Uchta blok — `buzuq payload zaxirasi` (294-qator), `buzuq seans yozuvi` (458), `kvota siqilganda qisqartirish` (507), jami 17 test — **o'chiriladi, qayta yozilmaydi**: IDB'da analogi yo'q. Qolgan 49 tasi `await` bilan omon qoladi.
- **`version !== 1` rad etishi** o'qishda halokatli emas (buzuq nusxaga ketadi). Uning real oqibati `importJson` da (`stats.ts:861`) — ya'ni **sizning eski zaxira fayllaringizda**.

### 9.3. ⚠️ `clearStats()` va v1 nusxasi

`stats.ts:882-887` ochiq va'da beradi va u test bilan mixlangan:

> *"hammasini o'chir" degan buyruqdan keyin o'sha ma'lumotning yashirin nusxasi qolib ketishi va'daga zid bo'lardi*

Migratsiyadan keyin `dnt.stats.v1` ni orqaga qaytish uchun saqlab qo'yish **shu va'dani buzadi**. Qaror:

- **`clearStats()` ikkalasini ham o'chiradi** — va'da saqlanadi.
- **Orqaga qaytish oynasi vaqt bilan chegaralanadi:** v1 nusxa keyingi relizda yoki `navigator.storage.estimate()` 60% dan oshganda o'chadi — qaysi biri oldin.
- Migratsiya paytida **bir bosishlik eksport** taklif qilinadi.

Sabab: `dnt.lessons.v1` o'sha 5 MB byudjetni bo'lishadi va u har importda o'sishda davom etadi. Cheksiz muzlatilgan ~2.3 MB nusxa bir kuni katta importni jimgina kesib qo'yardi.

### 9.4. Async'ga o'tadigan chaqiruvlar — ~17 ta, uch ekran

| Fayl | Chaqiruvlar |
|---|---|
| `Stats.tsx` | 11 ta: `loadStats:152`, `totals:153`, `streakDays:154`, `hardestWords:155`, `audioComparison:156`, `exportJson:200`, `corruptStatsBackup:246`, `dailySeries:336`, `importJson:358`, `clearStats:398`, `discardCorruptStatsBackup:408` (oxirgi ikkitasi §9.2 bo'yicha o'chadi) |
| `Results.tsx` | 4 ta: `:211`, `:230`, `:252`, `:305` |
| `Home.tsx` | `:165` — **bitta qatorda ikkita** (`totals()` va `streakDays()`) |

Alohida diqqat:
- `Results.tsx:230` `previousSession()` butun omborni yuklab saralaydi → `by_endedAt` bo'yicha **teskari kursorga** aylanishi shart.
- `Stats.tsx:336` `dailySeries` har oraliq o'zgarishida qayta hisoblanadi → loading holati kerak.

### 9.5. Eksport / import v2

```ts
type StatsFile = { version: 2; kind: 'stats'; words: […]; days: […]; sessions: […]; lifetime: {…} }
```

- **`kind: 'stats'` qo'shiladi** — bugungi stats eksportida u yo'q, lessons eksportida bor (`lessons.ts:549`). Nomuvofiqlik tuzatiladi.
- **`meta.lifetime` konvertga kiritiladi.** Usiz tiklash umrbod hisoblagichlarni nolga tushirardi yoki eskisini jimgina saqlab qolardi.
- **Birlashtirish qoidasi:** monoton hisoblagichlar `max()` bilan, qolgani almashtirish bilan.
- **v1 fayllarni o'qish majburiy** — sizning eski zaxiralaringiz.
- Semantika hamon **almashtirish** (merge emas): yig'indilarni qo'shish ikki marta sanashga olib kelardi. Bu bugungi qaror bilan bir xil.

---

## 10. Ataylab rad etilganlar

| Nima | Nega |
|---|---|
| **Lemmatizatsiya** (`runs`/`running`/`ran` ni birlashtirish) | Stemmer bog'liqligi kerak, terish mashqi esa aynan **yuza shakl** haqida: `running` ni yozish `run` ni yozish emas. |
| **Wilson pastki chegarasi** | §6.6, raqamlar bilan. |
| **Spaced repetition (FSRS/HLR)** | §7.1 — vazifa boshqa (matn ko'rinib turadi), mashq birligi gap. Poydevor mos, keyin qo'shiladi. |
| **Belgi darajasidagi statistika** | §7.2 — `charErrors` bor, lekin bu ilova terish tezligi emas, imlo↔talaffuz uchun. |
| **Oylik rollup** | §4.2 arifmetikasi: 20 yilda 2.5 MB. Kod murakkabligi foydasiz. |
| **So'z bo'yicha tarix massivi** | Chegarasiz o'sadi — aynan siz qochmoqchi bo'lgan narsa. `de`/`dx` uni ikkita songa siqadi. |
| **`US` va `us` ni ajratish** | Audio ularni **ajratadi** (`us@caps.mp3` — `shared/filename.ts:127`, `tokenize.ts:25` dagi `caps` bayrog'i), statistika esa `toLowerCase()` bilan **ataylab birlashtiradi**: reyting so'zning o'zi haqida, uning gap boshida turgani haqida emas. **Ma'lum nomuvofiqlik** — qayd etiladi, tuzatilmaydi. |

---

## 11. Ochiq savollar — siz hal qilasiz

> ✅ **HAMMASIGA JAVOB BERILDI.** Quyidagi savollar dastlab ochiq qoldirilgan edi; qabul qilingan javoblar shu yerda. Savol matnlari o'zgartirilmagan — ular qarorning nima uchun qiyin bo'lganini saqlab turadi.
>
> | Savol | Javob | Kim hal qildi |
> |---|---|---|
> | **11.1** Raqamli id kerakmi? | **Yo'q — `keyPath: 'w'`.** Hujjatning o'z tavsiyasi qabul qilindi | foydalanuvchi |
> | **11.2** 90 kunlik half-life to'g'rimi? | **Ha, MVP uchun.** `HALF_LIFE_DAYS` eksport qilinadigan konstanta va kodda ham, `PLAN.md` §11 da ham "MVP soddalashtirishi, sanoat standarti EMAS" deb belgilangan | hujjat |
> | **11.3** `fake-indexeddb` qo'shilsinmi? | **Ha, devDependency.** Adapter varianti §8.4 ning to'rtta tuzog'ini aynan testsiz qoldirardi — ular esa M2 ning qabul qilish mezoni | Claude |
> | **11.4** ⭐ Minimal ta'sirlanish to'sig'i | **Hozirgi farq saqlanadi** (Statistika 5, Natijalar 1). Ustiga `measureG()` Statistika ekranida ko'rsatiladi va `g ≥ 0.143` da ogohlantirish chiqadi — §6.2 dagi xatar endi jimgina emas, KO'RINADIGAN | Claude |
> | **11.5** O'lchov tizimimi yoki o'qitish? | **O'lchov.** SRS qo'shilmadi; poydevor (`l`, `de`/`dx`, `s`/`b`) §7.1 dagidek mos qoldirildi | hujjat |
>
> ⚠️ **11.4 ga qo'shimcha, §6.3 ga taalluqli tuzatish.** Amalga oshirish paytida `estimateBeta` ning dastlabki ko'rinishi kuzatilgan nisbatlarga **sof Beta** momentlarini qo'llagani aniqlandi — §6.3 va §15 iqtibos qilgan **beta-binomial** emas. Farq amaliy: `Var(p_i) = Var(θ) + E[θ(1−θ)]·E[1/n_i]`, ya'ni binomial had dispersiyani shishiradi va `m̂` ni pasaytiradi. Beta(2, 23) simulyatsiyasida (haqiqiy `m = 25`) `exposures = 2000` da `m̂ = 27.6`, lekin **haqiqiy so'z jadvalida (`exposures` 1–20) `m̂ ≈ 3`** — §6.2 talab qiladigan `m > 7.9` dan pastda. Tuzatilmaganda M4 dagi "konstantani ma'lumot bilan tekshirib turish" `m = 20` ni "juda katta" deb ko'rsatib, uni pasaytirishga undardi va reytingni aynan §6.2 ogohlantirgan tarzda ag'darardi. Binomial had ayirildi.

**11.1. ⭐ Raqamli id kerakmi?**
§2.5 dagi tahlil. `keyPath: 'w'` kamroq mexanizm bilan bir xil natija beradi; raqamli id faqat kalit qoidasi kelajakda o'zgarganda yutadi. **Tavsiya: `keyPath: 'w'`.** Siz "bitta id" so'ragansiz — shuning uchun bu qarorni yashirmasdan sizga qaytaraman.

**11.2. 90 kunlik yarim yemirilish to'g'rimi?**
§5.1 ko'rsatdiki, sobit global half-life — **soddalashtirish**, nashr etilgan amaliyot emas (HLR va FSRS uni element bo'yicha o'rganadi). Bu MVP uchun oqlanadi, lekin konstanta sizning takrorlash odatingizga moslanishi kerak: tez-tez qaytarsangiz qisqaroq (60 kun), siyrak qaytarsangiz uzunroq (120–180 kun).

**11.3. `fake-indexeddb` — repodagi birinchi yangi bog'liqlik.**
Testlar Node muhitida ishlaydi (`vitest.config.ts`, uchala proyekt ham `environment: 'node'`), IndexedDB esa u yerda yo'q. Variantlar: (a) `fake-indexeddb` devDependency qo'shish — standart yechim; (b) IDB qatlamini ingichka adapter interfeysi orqasiga yashirib, uni sof qism sifatida test qilish — bog'liqlik kerak bo'lmaydi, lekin adapter qatlami qo'shiladi. Repo bugungacha nol bog'liqlik bilan yashagan, shuning uchun bu sizning qaroringiz.

**11.4. ⭐ `hardestWords` minimal ta'sirlanish to'sig'i.**
§6.2 ko'rsatdiki, `g` yuqori bo'lsa **hech qanday formula** kam ko'rilgan so'zni to'g'ri tartibda ushlab tura olmaydi — haqiqiy kafolat shu to'siq. Bugun Statistika ekrani `5` ni, Natijalar ekrani `1` ni ishlatadi (`Results.tsx:211`), va farq UI da tushuntirilgan. Shrinkage'dan keyin bu farq saqlanadimi yoki yagona qoidaga keladimi?

⚠️ **Bu savolga javob berishdan oldin `g` o'lchansin** (§12 M0). Sizning haqiqiy `g` qiymatingiz to'siq qanchalik muhimligini hal qiladi: `g` past bo'lsa (≈0.05) formula o'zi yetarli, yuqori bo'lsa (≥0.143) to'siq **majburiy**.

**11.5. Yo'nalish: o'lchov tizimimi yoki o'qitish tizimi?**
§7 ochiq qo'ydi: bu taklif **o'lchov** tizimini yaxshilaydi. Agar maqsad "menga bugun nimani mashq qilishni ayt" bo'lsa, bu butunlay boshqa xususiyat (so'zdan matn generatsiyasi + SRS navbati) va uni **hozir bilib qo'yish** rejaga ta'sir qiladi.

---

## 12. Bosqichlar

**M0 + M1 — bitta `localStorage` inkrementi.** ~150 qator, IndexedDB'siz, qaytariladigan.

- ⭐ **`navigator.storage.persist()` ni chaqirish** — §3.1: u bugungi `localStorage` ni ham himoya qiladi, migratsiyani kutmaydi. **Eng arzon g'alaba.**
- ⭐ **`g` ni O'LCHASH** — `g = Σx / Σe` bugungi `dnt.stats.v1` dagi `words` jadvalidan **bir qatorda** hisoblanadi, ma'lumot allaqachon diskda. §6.2 ga ko'ra `g ≥ 0.184` bo'lsa butun formula yaroqsiz. **Buni M1 dan OLDIN bilish kerak** — aks holda `m = 20` tekshirilmagan taxminga aylanadi. Bu hujjatdagi eng katta ochiq xatarni eng arzon yo'l bilan yopadi.
- `words` jadvaliga `lastDay` + `de`/`dx` qo'shish
- `src/core/wordScore.ts`: `dayNumber`, `decayTo`, `shrunkScore` — **sof funksiyalar**
- `hardestWords()` ni shu ballga ulash
- Sonlarni yaxlitlash; `SentenceRecord` dan ortiqcha `lessonId` ni olib tashlash

⚠️ **M0 ni M1 dan ayirmaslik kerak.** Faqat `lastDay` qo'shilsa, uni hech kim iste'mol qilmaydi va reyting o'zgarmaydi — ya'ni asosiy shikoyat (§1.1) hal bo'lmaydi. **Uch maydon VA fossillashmagan reyting birga bo'lgandagina so'rov bajariladi.**

`wordScore.ts` sof bo'lgani uchun mavjud `core` vitest proyekti uni **hech qanday mock'siz** qamrab oladi — repo'ning "core = sof mantiq, DOM yo'q" bo'linishiga to'liq mos.

**M2 — IDB qatlami.** `db.ts` (ingichka o'ram), `schema.ts`, `migrate.ts`.
⚠️ **§8.4 dagi to'rtta tuzoq (avto-commit, `versionchange`/`blocked`, `upgradeneeded`, muhit farqlari) qabul qilish mezoni sifatida.** Testlar §11.3 qaroriga qarab.

**M3 — ko'chirish.** O'qish/yozish v2 ga, uch ekran async, §8 dagi gap darajasida yozish shartnomasi, IDB yo'q bo'lgandagi banner.

**M4 — uzoq muddat.** `compact()` retention, `persisted()`/`estimate()` ko'rsatkichi, eksport/import v2, `g` va `m` ni ma'lumotdan qayta baholash (§6.3).

---

## 13. Xatarlar

| Xatar | Yumshatish |
|---|---|
| ⚠️ Gap darajasida yozish **ikki marta sanashi** | §8.2 shartnomasi. **Eng jiddiy amalga oshirish xatari.** |
| ⚠️ Tranzaksiya avto-commit (`TransactionInactiveError`) | §8.4a — zanjirda IDB'siz `await` yo'q. |
| ⚠️ `meta.lifetime` `pagehide` da yo'qolishi | §8.2: deltalar har gapda, yopilishda emas. |
| ⚠️ `totals()` jimgina qisqarishi | §4.3, maydonma-maydon tiklanish bilan. |
| ⚠️ `f`/`l` migratsiya sanasi bilan ma'nosizlanishi | §9.1: omon qolgan seanslardan tiklash, qolgani "noma'lum". |
| ⚠️ Reyting `g` o'sganda teskari bo'lishi | §6.2: `m=20`, sezgirlik jadvali, §11.4 to'sig'i haqiqiy kafolat. |
| ⚠️ Sxema yangilanishi ochiq tab tufayli bloklanishi | §8.4b — `onversionchange` da ulanishni yopish. |
| ⚠️ Oldinga moslik yo'qolishi (`unknownSessions`) | §9.2 — notanish maydonlarni saqlab qoldirish. |
| ⚠️ v1 nusxasi `clearStats` va'dasini buzishi / kvotani yeyishi | §9.3: ikkalasi o'chadi, oyna chegaralangan. |
| Sinxron UI buziladi | 3 ekran, ~17 chaqiruv. |
| 17 test o'chadi, tiklash quyi tizimi yo'qoladi | §9.2 da ochiq yozilgan. |
| **Mintaqa almashishi** | Kun kaliti lokal sanadan. DST **allaqachon xavfsiz** — `startOfLocalDay` + `setDate()` ataylab shunday (`stats.ts:452-458`). Qolgan chekka holat: boshqa mintaqaga **ko'chish** kunni siljitadi va `streakDays()` da uzilish yasashi mumkin. `decayTo` da Δ = `max(0, …)` bilan qopqoqlangan. |
| `persist()` rad etilishi mumkin | §3.3 — Statistika ekranida holat ko'rsatkichi + muntazam eksport. |

---

## 14. ADR

**Qaror.** So'z jadvaliga vaqt o'lchovi (`f`, `l`), so'nuvchi hisoblagichlar (`de`, `dx`) va empirik Bayes reytingi qo'shish; omborni IndexedDB'ga ko'chirish; `words` + `days` abadiy, `sessions` 180 kun. `persist()` ni **darhol** chaqirish.

**Drayverlar.**
1. Umrbod nisbatning fossillashuvi — foydalanuvchining asosiy shikoyati.
2. Ko'p tabdagi ma'lumot yo'qolishi — hujjatlashtirilgan nuqson.
3. Sinxron 2 MB yozuv asosiy oqimni bloklashi.
4. M2/M3 gate'ning eskirish bilan zaiflashuvi.

**Ko'rib chiqilgan muqobillar.**
- **`localStorage` da qolish** (~1.5 MB barqaror, ~80 qator — §2.3). **Rad etildi — lekin sababi teskari:** hajm hech qachon muammo bo'lmagan. IndexedDB **asinxronlik, tranzaksiya va qisman yozuv** uchun sotib olinadi. M0+M1 baribir `localStorage` da bajariladi.
- **Hamma narsani abadiy saqlash** — chiziqli o'sish, foydasi yo'q: 180 kundan eski gap yozuvining butun ma'lumoti `days` va `meta.lifetime` da yashaydi.
- **Local serverda fayl** (Fastify allaqachon ishlab turibdi) — eng ishonchli va qurilmalararo ishlaydi, lekin API va sinxronizatsiya semantikasi kerak. Foydalanuvchi brauzer variantini tanladi.
- **Raqamli id** — §2.5, §11.1. Tavsiya `keyPath: 'w'`, qaror foydalanuvchida.
- **Wilson pastki chegarasi** — §6.6, raqamlar bilan rad etildi.
- **FSRS / HLR spaced repetition** — §7.1, kechiktirildi (poydevor mos qoldirildi).
- **Per-key statistika** — §7.2, ataylab rad etildi.

**Nega shu.** IndexedDB tranzaksiyalari ma'lum ma'lumot yo'qolishini tuzatadi; asinxronlik 2 MB sinxron yozuvni yo'q qiladi; qisman yozuv gap darajasida saqlashni mumkin qiladi. So'nish + shrinkage esa asosiy shikoyatni O(1) xotira bilan hal qiladi.
**Eviction himoyasi bu ro'yxatda YO'Q** — `persist()` ikkala omborni ham bir xil himoya qiladi (§3.1), shuning uchun u IndexedDB'ni oqlamaydi va undan oldin bajarilishi kerak.

**Oqibatlar.**
- Stats API **async** bo'ladi; uch ekran, ~17 chaqiruv joyi loading holatiga muhtoj.
- 17 test o'chadi va **buzuq payload tiklash quyi tizimi yo'qoladi** — bu almashuv.
- **Oldinga moslik himoyasi yo'qoladi** (§9.2).
- Ehtimol `fake-indexeddb` devDependency (§11.3).
- Reyting to'g'riligi `g` ga **sezgir** va §11.4 dagi to'siqqa tayanadi.
- Sobit 90 kunlik half-life — **ataylab qilingan soddalashtirish** (§5.1), sanoat standarti emas.
- `k`, `nc`, audio chelaklar va `f`/`l` faqat qisman orqaga tiklanadi; qolgani ochiq "noma'lum" deb ko'rsatiladi.

**Keyingi ishlar.** Qaror qabul qilinsa: M0+M1 mustaqil ravishda darhol qiymat beradi va IndexedDB ko'chishini bekor qilmaydi. `PLAN.md` ga yangi **`PLAN.md` §11** bo'limi qo'shilib, shu hujjatga havola qilinadi (`PLAN.md` hozir §10 da tugaydi).

---

## 15. Manbalar

Tashqi da'volar shu manbalardan tekshirilgan (2026-08-09):

- **Storage / eviction:** [WHATWG Storage Standard](https://storage.spec.whatwg.org/) · [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — `persist()` bucket darajasida ishlaydi, `localStorage` ni ham qamraydi (§3.1).
- **localStorage sinxronligi:** [web.dev — Storage for the web](https://web.dev/articles/storage-for-the-web) — *"LocalStorage should be avoided because it is synchronous and will block the main thread"* (§3.2a).
- **IndexedDB tuzoqlari:** [MDN — Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) · [jakearchibald/idb](https://github.com/jakearchibald/idb) (§8.4).
- **Spaced repetition:** [Settles & Meeder, ACL 2016 — Half-Life Regression](https://research.duolingo.com/papers/settles.acl16.pdf) · [duolingo/halflife-regression](https://github.com/duolingo/halflife-regression) · [FSRS4Anki wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki) (§5.1, §7.1).
- **Empirik Bayes:** [Method of moments for beta-binomial](https://statproofbook.github.io/P/betabin-mome.html) · [Variance Explained — Empirical Bayes estimation](http://varianceexplained.org/r/empirical_bayes_baseball/) (§6.3).
- **Terish trenajyorlari:** keybr.com (per-key adaptiv model), Monkeytype (belgi darajasidagi xato xaritasi) (§7.2).
