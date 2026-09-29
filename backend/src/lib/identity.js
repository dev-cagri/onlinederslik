// Telefon: ülke kodu ayrı gelir. Türkiye (90) için yalnız 5XXXXXXXXX GSM numaraları;
// diğer ülkelerde E.164 kuralı (ülke kodu + numara en fazla 15 hane).
// Dönen phone: "+<ülke kodu><numara>" (veritabanında bu biçimde saklanır).
export function normalizePhone(dialCode, number) {
  const cc = String(dialCode || '').replace(/\D/g, '');
  let national = String(number || '').replace(/\D/g, '');
  if (!/^[1-9]\d{0,2}$/.test(cc)) return null;
  if (national.startsWith(cc) && national.length > 10) national = national.slice(cc.length);
  national = national.replace(/^0+/, '');

  if (cc === '90') {
    return /^5\d{9}$/.test(national) ? { cc, national, domestic: true, phone: `+90${national}` } : null;
  }
  const total = cc.length + national.length;
  if (national.length < 6 || total > 15) return null;
  return { cc, national, domestic: false, phone: `+${cc}${national}` };
}

// Ad/soyad: harf, boşluk, kesme ve tire; baş/son boşluk ve çoklu boşluk temizlenir.
export function normalizePersonName(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) return null;
  return /^\p{L}[\p{L} '’-]*$/u.test(name) ? name : null;
}
