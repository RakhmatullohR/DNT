// Omograflar uchun qo'lda tuzatiladigan sintez jadvali (PLAN §3).
//
// NIMA UCHUN `.json` EMAS, `.ts`:
// Node 24 da `import x from './overrides.json'` — `ERR_IMPORT_ATTRIBUTE_MISSING`
// bilan yiqiladi (amalda tekshirildi), ya'ni import attribute (`with { type: 'json' }`)
// SHART. Vite esa `.json` ni JS moduliga aylantirib beradi va brauzerdagi dev
// rejimida o'sha attribute mos kelmay qolishi mumkin. Bu fayl SERVER VA KLIENT
// ikkalasi tomonidan import qilinadi (PLAN §1, §10 — eng nozik nuqta), shuning
// uchun ikkala toolchain'da ham shubhasiz ishlaydigan yagona yechim tanlandi:
// oddiy `.ts` moduli. Hech qanday attribute, hech qanday resolver farqi.
//
// Kalit — DOIM kichik harfli so'z. Qiymat — sintezatorga beriladigan matn.
// Fayl nomi imlodan olinadi, sintez matni esa shu jadvaldan almashadi.
export const OVERRIDES: Record<string, string> = {
  read: 'reed',
  lead: 'leed',
  live: 'liv',
  wind: 'wind',
  tear: 'teer',
  row: 'roh',
  bow: 'boh',
  sow: 'soh',
  close: 'klohss',
}
