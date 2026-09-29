import { config } from '../config.js';
import { getSetting, getSiteName, smsSafe } from './siteSettings.js';

// NETGSM bilgileri yönetim panelinden (site_settings) gelir; panelde girilmemişse .env'deki değerler
export async function getNetgsmConfig() {
  const [usercode, password, msgheader] = await Promise.all(
    ['netgsm_usercode', 'netgsm_password', 'netgsm_msgheader'].map(getSetting)
  );
  const env = config.sms.netgsm;
  return {
    usercode: usercode || env.usercode,
    password: password || env.password,
    msgheader: msgheader ?? env.msgheader,
    fromPanel: !!(usercode || password),
  };
}

// Yurt içi numaralar hızlı OTP kanalından, yurt dışı numaralar normal SMS kanalından gider
// (OTP kanalı yalnız Türkiye operatörlerine gönderir; yurt dışında numaranın başına 00 eklenir).
const NETGSM_OTP_URL = 'https://api.netgsm.com.tr/sms/rest/v2/otp';
const NETGSM_SEND_URL = 'https://api.netgsm.com.tr/sms/rest/v2/send';

// NETGSM /sms/rest/v2/otp ve /send yanıt kodları
const NETGSM_ERRORS = {
  20: 'Mesaj metni hatalı veya 160 karakteri aşıyor',
  30: 'Kullanıcı adı/şifre hatalı, API yetkisi kapalı veya IP izinli değil',
  40: 'Mesaj başlığı sistemde tanımlı değil',
  41: 'Mesaj başlığı geçersiz',
  50: 'Numara hatalı',
  51: 'Numara hatalı',
  52: 'Numara hatalı',
  60: 'OTP SMS paketi/kredisi yok',
  70: 'Parametre hatası',
  100: 'NETGSM sistem hatası',
  101: 'NETGSM sistem hatası',
};

if (config.sms.provider === 'console' && process.env.NODE_ENV === 'production') {
  console.warn('UYARI: SMS_PROVIDER=console — OTP kodları SMS yerine loga yazılıyor!');
}

// target: normalizePhone() çıktısı. Mesajda Türkçe karakter yok (160 karakter, tek parça).
export async function sendOtpSms(target, code) {
  const site = smsSafe(await getSiteName()).slice(0, 40);
  return sendSms(target, `${site} dogrulama kodunuz: ${code}. Bu kodu kimseyle paylasmayin.`);
}

export async function sendSms(target, msg) {
  if (config.sms.provider === 'console') {
    console.log(`[SMS:console] ${target.phone} → ${msg}`);
    return;
  }
  if (config.sms.provider !== 'netgsm') {
    throw new Error(`Bilinmeyen SMS_PROVIDER: ${config.sms.provider}`);
  }

  const { usercode, password, msgheader } = await getNetgsmConfig();
  if (!usercode || !password) throw new Error('NETGSM bilgileri girilmemiş');
  const [url, body] = target.domestic
    ? [NETGSM_OTP_URL, { msgheader, msg, no: target.national }]
    // iysfilter 0: bilgilendirme mesajı (ticari ileti değil, İYS kontrolüne girmez)
    : [NETGSM_SEND_URL, { msgheader, iysfilter: '0', messages: [{ msg, no: `00${target.cc}${target.national}` }] }];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${usercode}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  let data = null;
  try { data = await res.json(); } catch { /* yoksay */ }
  if (data?.code === '00') return;

  const errCode = data?.code || `HTTP ${res.status}`;
  throw new Error(`NETGSM: ${NETGSM_ERRORS[errCode] || 'bilinmeyen hata'} (kod ${errCode})`);
}
