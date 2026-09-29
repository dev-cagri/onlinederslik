import crypto from 'crypto';

// Karışabilen karakterler (0/O, 1/I/L) yok; kod XXXX-XXXX biçiminde gösterilir, tiresiz saklanır
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

export function generateAccessCode() {
  return Array.from({ length: LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}

// Kullanıcının yazdığı kodu saklanan biçime çevirir (büyük harf, boşluk/tire yok)
export function normalizeAccessCode(input) {
  const code = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : null;
}

export const formatAccessCode = (code) => code.replace(/^(.{4})(.+)$/, '$1-$2');
