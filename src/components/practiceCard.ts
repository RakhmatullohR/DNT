// Mashq kartasining umumiy o'lchov tokenlari.
//
// ⭐ NEGA ALOHIDA FAYL: bitta kartani IKKI fayl chizadi — `Practice.tsx`
// (kartaning o'zi, yozuv qavati va o'ng raf) va `SentenceNote.tsx` (izoh, rasm
// va yordam qavatlari hamda rafga portal qilinadigan ikkita tugma). Ikkovi
// AYNAN bir xil chekka va tugma shaklini ishlatishi SHART: "yozuv, izoh va
// rasm bir vertikalda boshlanadi" hamda "rafdagi tugmalar bir xil enda"
// va'dalari shu yagona manbaga tayanadi; qiymatlar ko'chirib yozilsa, birini
// o'zgartirgan odam ikkinchisini jimgina buzardi.
//
// Yo'nalish ham majburiy: `SentenceNote` `Practice.tsx` dan import qila
// olmaydi (aylanma bog'lanish), shuning uchun tokenlar ikkovidan ham pastda,
// hech kimga bog'lanmagan faylda turadi.

/** Kartadagi qavatning gorizontal chekkasi — uchala qavatda bir xil. */
export const BAND_X = 'px-0'

/** Qavatlar orasidagi chiziq — karta chegarasi (`PANEL`) bilan bir xil rangda. */
export const DIVIDER = 'border-t border-[#1d2833]'

/**
 * O'ng raf: mashqning BARCHA tugmasi shu yerda, ustma-ust.
 *
 * Ilgari tugmalar uch joyga sochilgan edi — kartaning ostidagi qator (ovoz,
 * qaytarish, bosh harf, izoh, diqqat), izoh panelining ichi (rasm qo'shish) va
 * uning pastki qatori (yozuvga qaytish). Bittasini topish uchun ko'z uch
 * marta sakrardi.
 *
 * ⚠️ Tor ekranda (`sm` dan pastda) raf USTUN BO'LA OLMAYDI: 224px lik ustun
 * telefonda matnga deyarli joy qoldirmasdi. U yerda raf kartaning OSTIGA
 * tushadi va tugmalar odatdagidek qatorga yoyiladi — shu sabab chegara ham
 * almashadi: tor ekranda tepada chiziq, kengida chapda.
 *
 * `sm:w-56` (224px) — eng uzun yorliq ("Bosh harf rejimi" + holat nuqtasi,
 * 13px monoshrift) 163px ni egallaydi, ustiga tugmaning va rafning chekkasi
 * qo'shiladi. `Button` da `whitespace-nowrap` bor, ya'ni raf tor bo'lsa yozuv
 * qatorga sig'may chiqib ketardi — zaxira ATAYIN.
 */
export const RAIL = [
  'flex shrink-0 flex-row flex-wrap items-start gap-2 p-3',
  'border-t border-[#1d2833]',
  'sm:w-56 sm:flex-col sm:flex-nowrap sm:border-t-0 sm:border-l',
].join(' ')

/**
 * Rafdagi tugma.
 *
 * `sm:w-full` — ustundagi hamma tugma bir xil enda; turli enli tugmalar
 * ustuni o'ng tomondan tishli chekka berardi. ⚠️ `sm:` SHART: qiymat shartsiz
 * berilsa, tor ekranda (raf kartaning ostidagi o'ralgan QATORGA aylanadigan
 * joyda) har bir tugma butun qatorni egallab, ro'yxat yetti qatorga cho'zilib
 * ketardi — `RAIL` dagi "tugmalar odatdagidek qatorga yoyiladi" va'dasi
 * aynan shu yerda buzilardi.
 *
 * `justify-start!` — yozuv chapdan boshlanadi, ya'ni ko'z bitta vertikal
 * chiziq bo'ylab yuguradi. Muhimlik belgisi SHART: `Button` asosida
 * `justify-center` bor va bitta xossa uchun kurashadigan ikki sinfning
 * g'olibini sinf tartibi emas, uslublar jadvalidagi tartib hal qilardi
 * (`FocusToggle` dagi `px-0!` bilan bir xil sabab). U ham `sm:` da: mazmun
 * bo'yicha qisqargan tugmada tekislashning ma'nosi yo'q.
 *
 * `ring-offset-[#0e141c]!` — tugmalar endi sahifa fonida emas, KARTA ustida
 * turadi. `Button` ning standart offseti sahifa foniga (`--color-base`)
 * sozlangan va karta ustida halqa ostidan qorong'i chok bo'lib chiqardi —
 * `Practice.tsx` dagi `LINK_BTN_BASE` bir xil sababdan shunday tuzatilgan.
 * Muhimlik belgisi bu yerda ham SHART va bu o'lchab tekshirilgan: yig'ilgan
 * CSS da o'zboshimcha qiymatli qoida (`ring-offset-[#0e141c]`) nomli
 * qoidadan (`ring-offset-base`) OLDIN turadi, ya'ni belgisiz variant jimgina
 * yutqazardi.
 */
export const RAIL_BTN = 'focus-visible:ring-offset-[#0e141c]! sm:w-full sm:justify-start!'

/** Rafdagi kichik matn (hisoblagich) — tugma yozuvi bilan bir chekkada. */
export const RAIL_NOTE = 'px-3 font-mono text-[11px] text-[#7d8b9c] tabular-nums'
