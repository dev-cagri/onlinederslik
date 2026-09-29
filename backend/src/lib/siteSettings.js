import { pool } from '../db/pool.js';

// site_settings (anahtar/değer) yardımcıları
export async function getSetting(name) {
  const [[row]] = await pool.query('SELECT value FROM site_settings WHERE name = ?', [name]);
  return row ? row.value : null;
}

export async function setSetting(name, value) {
  await pool.query(
    'INSERT INTO site_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [name, value]
  );
}

export const DEFAULT_SITE_NAME = 'Online Derslik';

// Tarayıcı sekmesi başlığı ve SMS metninde kullanılan site adı
export async function getSiteName() {
  return (await getSetting('site_name')) || DEFAULT_SITE_NAME;
}

// SMS'ler Türkçe karakter içerirse tek parça 160 yerine 70 karaktere düşer; ASCII'ye çevrilir
export function smsSafe(text) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
  return String(text).replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c]).replace(/[^\x20-\x7E]/g, '');
}

// Yeni üyelerin yönetici onayı beklemesi; kapalıysa kayıt olan doğrudan katılır. Ayar yoksa açık
export async function isApprovalRequired() {
  return (await getSetting('approval_required')) !== '0';
}

// SMS doğrulaması yönetim panelinden kapatılabilir; ayar yoksa açık
export async function isSmsEnabled() {
  return (await getSetting('sms_enabled')) !== '0';
}
