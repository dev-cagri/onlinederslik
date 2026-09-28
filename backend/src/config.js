import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secretdevkeyforlocaluseonly1234567890',
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    // Tarayıcıların bağlanacağı adres (prod: wss://alanadi/livekit). Backend sunucu içinden
    // LIVEKIT_URL'e bağlanır; ayrı verilmezse ikisi aynıdır.
    publicUrl: process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL || 'ws://localhost:7880',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'zoomtr',
    password: process.env.DB_PASSWORD || 'zoomtrpass',
    database: process.env.DB_NAME || 'zoomtr',
  },
  // Nginx aynı makinede reverse proxy; gerçek istemci IP'si X-Forwarded-For'dan okunur
  trustProxy: process.env.TRUST_PROXY || 'loopback',
  sms: {
    // 'netgsm' → gerçek SMS; 'console' → kod backend loguna yazılır (sadece geliştirme)
    provider: process.env.SMS_PROVIDER || 'console',
    netgsm: {
      usercode: process.env.NETGSM_USERCODE || '',
      password: process.env.NETGSM_PASSWORD || '',
      msgheader: process.env.NETGSM_MSGHEADER || '',
    },
    // SMS gönderilebilecek ülke kodları. Yurt dışı SMS pahalı ve kötüye kullanıma açık
    // (sahte numaralara SMS pompalama); listeyi ihtiyaç olan ülkelerle sınırlı tutun.
    allowedDialCodes: (process.env.SMS_ALLOWED_DIAL_CODES
      || '90,49,31,32,33,43,41,44,45,46,47,39,34,1,30,40,359,387,383,389,7,994,995,993,996,998,964,966,971,974')
      .split(',').map((c) => c.trim()).filter(Boolean),
  },
  verification: {
    // Tamamlanan doğrulama bu süre boyunca aynı odaya tekrar girişte geçerli
    validHours: Number(process.env.VERIFICATION_VALID_HOURS) || 12,
    // KVKK saklama süresi (gün): bu süreyi aşan doğrulama kayıtları otomatik silinir.
    // Frontend'deki KVKK metni (lib/kvkk.js RETENTION_DAYS) ile aynı olmalı.
    retentionDays: Number(process.env.VERIFICATION_RETENTION_DAYS) || 30,
  },
};
