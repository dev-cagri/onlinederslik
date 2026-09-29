import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { sendOtpSms } from '../lib/sms.js';
import { normalizePhone, normalizePersonName } from '../lib/identity.js';
import { createMemberSession, destroyMemberSession, getSessionMember } from '../lib/auth.js';
import { toMemberProfile, autoApproveIfOpen } from '../lib/members.js';
import { normalizeAccessCode } from '../lib/accessCodes.js';
import { isSmsEnabled } from '../lib/siteSettings.js';

// OTP ve SMS kötüye kullanım sınırları
const OTP_TTL_SEC = 180;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;
const OTP_MAX_SENDS_PER_PHONE_HOUR = 5;
// Okul/kurum ağında tüm sınıf aynı IP'den çıkabilir; bu yüzden geniş tutuldu
const OTP_MAX_SENDS_PER_IP_HOUR = 100;

function hashOtp(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

// SMS kapalıyken telefonla giriş: IP başına saatte en fazla 30 giriş (sahte hesap yağmuruna karşı)
const PHONE_LOGIN_MAX_PER_HOUR = 30;
const phoneLogins = new Map();

function phoneLoginAllowed(ip) {
  const now = Date.now();
  const recent = (phoneLogins.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PHONE_LOGIN_MAX_PER_HOUR) return false;
  recent.push(now);
  phoneLogins.set(ip, recent);
  return true;
}

// Giriş kodu tahmin denemelerine karşı: IP başına 15 dakikada en fazla 10 hatalı kod (bellekte)
const CODE_MAX_FAILS = 10;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const codeFails = new Map();

function codeFailCount(ip) {
  const entry = codeFails.get(ip);
  if (entry && Date.now() - entry.first > CODE_WINDOW_MS) codeFails.delete(ip);
  return codeFails.get(ip)?.count || 0;
}

function recordCodeFail(ip) {
  const entry = codeFails.get(ip);
  if (!entry || Date.now() - entry.first > CODE_WINDOW_MS) codeFails.set(ip, { count: 1, first: Date.now() });
  else entry.count += 1;
}

// Express 4 async hataları yakalamaz; reddedilen promise'i hata middleware'ine ilet
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Numara geçersizse 400 yanıtı verir ve null döner
function phoneTarget(req, res) {
  const target = normalizePhone(req.body?.dialCode, req.body?.phone);
  if (!target) {
    res.status(400).json({ error: 'Geçerli bir cep telefonu numarası girin' });
    return null;
  }
  if (!config.sms.allowedDialCodes.includes(target.cc)) {
    res.status(400).json({ error: 'Bu ülkeye SMS gönderilemiyor' });
    return null;
  }
  return target;
}

// Katılımcı üyeliği: telefon + SMS koduyla giriş → (ilk girişte) ad/soyad → yönetici onayı.
// /api/member
export function buildMemberRouter() {
  const router = Router();

  // Oturumdaki üye; giriş yapılmamışsa 401
  router.get('/me', route(async (req, res) => {
    const member = await getSessionMember(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Giriş yapılmamış' });
    res.json(toMemberProfile(member));
  }));

  // 1) SMS ile giriş kodu gönder. KVKK açık rızası numara SMS sağlayıcısına gitmeden önce alınır.
  router.post('/otp', route(async (req, res) => {
    if (!(await isSmsEnabled())) return res.status(400).json({ error: 'SMS doğrulaması kapalı' });
    if (req.body?.kvkkAccepted !== true || !req.body?.kvkkVersion) {
      return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    }
    const target = phoneTarget(req, res);
    if (!target) return;
    const { phone } = target;

    const [[counts]] = await pool.query(
      `SELECT SUM(phone = ?) AS perPhone, SUM(ip = ?) AS perIp
       FROM otp_sends WHERE created_at > NOW() - INTERVAL 1 HOUR`,
      [phone, req.ip]
    );
    if (Number(counts.perPhone) >= OTP_MAX_SENDS_PER_PHONE_HOUR
      || Number(counts.perIp) >= OTP_MAX_SENDS_PER_IP_HOUR) {
      return res.status(429).json({ error: 'Çok fazla SMS istendi. Lütfen daha sonra tekrar deneyin.' });
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Numaranın aktif kodu yoksa ekle; varsa yalnız bekleme süresi dolduysa yenile.
    // Koşullu UPDATE sayesinde aynı anda gelen iki istekten yalnızca biri geçer.
    const otpHash = hashOtp(phone, code);
    const [ins] = await pool.query(
      `INSERT IGNORE INTO login_otps (phone, otp_hash, sent_at, expires_at)
       VALUES (?, ?, NOW(), NOW() + INTERVAL ? SECOND)`,
      [phone, otpHash, OTP_TTL_SEC]
    );
    const [upd] = ins.affectedRows ? [ins] : await pool.query(
      `UPDATE login_otps
       SET otp_hash = ?, sent_at = NOW(), expires_at = NOW() + INTERVAL ? SECOND, attempts = 0
       WHERE phone = ? AND sent_at < NOW() - INTERVAL ? SECOND`,
      [otpHash, OTP_TTL_SEC, phone, OTP_RESEND_COOLDOWN_SEC]
    );
    if (upd.affectedRows === 0) {
      const [[w]] = await pool.query(
        `SELECT GREATEST(0, ? - TIMESTAMPDIFF(SECOND, sent_at, NOW())) AS wait
         FROM login_otps WHERE phone = ?`,
        [OTP_RESEND_COOLDOWN_SEC, phone]
      );
      return res.status(429).json({
        error: 'Yeni kod için lütfen bekleyin',
        retryAfter: Number(w?.wait) || OTP_RESEND_COOLDOWN_SEC,
      });
    }

    try {
      await sendOtpSms(target, code);
    } catch (err) {
      console.error('Giriş SMS\'i gönderilemedi:', err.message);
      // Başarısız gönderim bekleme süresine sayılmasın
      await pool.query('DELETE FROM login_otps WHERE phone = ?', [phone]);
      return res.status(502).json({ error: 'SMS gönderilemedi. Lütfen biraz sonra tekrar deneyin.' });
    }

    await pool.query('INSERT INTO otp_sends (phone, ip) VALUES (?, ?)', [phone, req.ip]);
    res.json({ ok: true, expiresIn: OTP_TTL_SEC, resendIn: OTP_RESEND_COOLDOWN_SEC });
  }));

  // 2) Kodu doğrula → üye yoksa oluşturulur, oturum açılır
  router.post('/otp/verify', route(async (req, res) => {
    const target = phoneTarget(req, res);
    if (!target) return;
    const { phone } = target;
    const kvkkVersion = String(req.body?.kvkkVersion || '').slice(0, 20);
    if (!kvkkVersion) return res.status(400).json({ error: 'KVKK onayı zorunlu' });

    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (code.length !== 6) return res.status(400).json({ error: '6 haneli kodu girin' });

    const [att] = await pool.query(
      `UPDATE login_otps SET attempts = attempts + 1
       WHERE phone = ? AND expires_at > NOW() AND attempts < ?`,
      [phone, OTP_MAX_ATTEMPTS]
    );
    if (att.affectedRows === 0) {
      return res.status(410).json({ error: 'Kodun süresi doldu veya çok fazla deneme yapıldı. Yeni kod isteyin.' });
    }

    const [[otp]] = await pool.query('SELECT otp_hash FROM login_otps WHERE phone = ?', [phone]);
    const expected = Buffer.from(otp.otp_hash, 'hex');
    const actual = Buffer.from(hashOtp(phone, code), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
      return res.status(400).json({ error: 'Kod hatalı' });
    }
    // Kod tek kullanımlık; silinmezse süresi dolana kadar tekrar kullanılabilirdi
    const [del] = await pool.query('DELETE FROM login_otps WHERE phone = ? AND otp_hash = ?', [phone, otp.otp_hash]);
    if (del.affectedRows === 0) {
      return res.status(410).json({ error: 'Kod zaten kullanıldı. Yeni kod isteyin.' });
    }

    const ua = (req.get('user-agent') || '').slice(0, 255);
    await pool.query(
      `INSERT INTO members (phone, kvkk_version, last_login_at, last_ip, user_agent)
       VALUES (?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE kvkk_version = VALUES(kvkk_version), kvkk_accepted_at = NOW(),
         last_login_at = NOW(), last_ip = VALUES(last_ip), user_agent = VALUES(user_agent)`,
      [phone, kvkkVersion, req.ip, ua]
    );
    const [[member]] = await pool.query(
      'SELECT id, phone, first_name, last_name, status, registered_at FROM members WHERE phone = ?',
      [phone]
    );
    await createMemberSession(req, res, member.id);
    res.json(toMemberProfile(await autoApproveIfOpen(member)));
  }));

  // SMS doğrulaması kapalıyken: telefon numarasıyla kodsuz giriş. Numara doğrulanmaz;
  // yönetici onayı (yeni üyede) aynen geçerlidir.
  router.post('/phone-login', route(async (req, res) => {
    if (await isSmsEnabled()) return res.status(400).json({ error: 'Giriş için SMS kodu gerekiyor' });
    const kvkkVersion = String(req.body?.kvkkVersion || '').slice(0, 20);
    if (req.body?.kvkkAccepted !== true || !kvkkVersion) {
      return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    }
    const target = normalizePhone(req.body?.dialCode, req.body?.phone);
    if (!target) return res.status(400).json({ error: 'Geçerli bir cep telefonu numarası girin' });
    if (!phoneLoginAllowed(req.ip)) {
      return res.status(429).json({ error: 'Çok fazla giriş denemesi. Lütfen daha sonra tekrar deneyin.' });
    }

    const ua = (req.get('user-agent') || '').slice(0, 255);
    await pool.query(
      `INSERT INTO members (phone, kvkk_version, last_login_at, last_ip, user_agent)
       VALUES (?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE kvkk_version = VALUES(kvkk_version), kvkk_accepted_at = NOW(),
         last_login_at = NOW(), last_ip = VALUES(last_ip), user_agent = VALUES(user_agent)`,
      [target.phone, kvkkVersion, req.ip, ua]
    );
    const [[member]] = await pool.query(
      'SELECT id, phone, first_name, last_name, status, registered_at FROM members WHERE phone = ?',
      [target.phone]
    );
    await createMemberSession(req, res, member.id);
    res.json(toMemberProfile(await autoApproveIfOpen(member)));
  }));

  // Giriş koduyla üyelik: SMS ve yönetici onayı atlanır. Oturumda onay bekleyen (SMS ile
  // girmiş) üye varsa o üye onaylanır; yoksa telefonsuz yeni üye açılır. Ardından ad/soyad istenir.
  router.post('/code-login', route(async (req, res) => {
    if (codeFailCount(req.ip) >= CODE_MAX_FAILS) {
      return res.status(429).json({ error: 'Çok fazla hatalı kod denendi. 15 dakika sonra tekrar deneyin.' });
    }
    const kvkkVersion = String(req.body?.kvkkVersion || '').slice(0, 20);
    if (req.body?.kvkkAccepted !== true || !kvkkVersion) {
      return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    }
    const code = normalizeAccessCode(req.body?.code);
    const [[accessCode]] = code
      ? await pool.query('SELECT id FROM access_codes WHERE code = ?', [code])
      : [[]];
    // Kullanım hakkı koşullu UPDATE ile düşülür; aynı anda gelen isteklerde sınır aşılmaz
    const [use] = accessCode
      ? await pool.query(
        `UPDATE access_codes SET uses = uses + 1
         WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [accessCode.id]
      )
      : [{ affectedRows: 0 }];
    if (!use.affectedRows) {
      recordCodeFail(req.ip);
      return res.status(400).json({ error: 'Giriş kodu geçersiz, süresi dolmuş ya da kullanım sınırına ulaşmış.' });
    }

    const ua = (req.get('user-agent') || '').slice(0, 255);
    const current = await getSessionMember(req.headers.cookie);
    let memberId;
    if (current) {
      memberId = current.id;
      await pool.query(
        `UPDATE members SET status = 'approved', access_code_id = ?, reviewed_at = NOW(), reviewed_by = NULL,
           kvkk_version = ?, kvkk_accepted_at = NOW(), last_login_at = NOW(), last_ip = ?, user_agent = ?
         WHERE id = ?`,
        [accessCode.id, kvkkVersion, req.ip, ua, memberId]
      );
    } else {
      const [ins] = await pool.query(
        `INSERT INTO members (access_code_id, status, reviewed_at, kvkk_version, last_login_at, last_ip, user_agent)
         VALUES (?, 'approved', NOW(), ?, NOW(), ?, ?)`,
        [accessCode.id, kvkkVersion, req.ip, ua]
      );
      memberId = ins.insertId;
      await createMemberSession(req, res, memberId);
    }
    const [[member]] = await pool.query(
      'SELECT id, phone, first_name, last_name, status, registered_at FROM members WHERE id = ?',
      [memberId]
    );
    res.json(toMemberProfile(member));
  }));

  // 3) İlk girişte ad/soyad. Onay beklerken düzeltilebilir; onaylı/reddedilmiş üye değiştiremez.
  router.post('/register', route(async (req, res) => {
    const member = await getSessionMember(req.headers.cookie);
    if (!member) return res.status(401).json({ error: 'Giriş yapılmamış' });
    if (member.registered_at && member.status !== 'pending') {
      return res.status(409).json({ error: 'Onaylanan üyelik bilgileri değiştirilemez' });
    }
    const firstName = normalizePersonName(req.body?.firstName);
    const lastName = normalizePersonName(req.body?.lastName);
    if (!firstName) return res.status(400).json({ error: 'Geçerli bir ad girin' });
    if (!lastName) return res.status(400).json({ error: 'Geçerli bir soyad girin' });

    await pool.query(
      `UPDATE members SET first_name = ?, last_name = ?, registered_at = COALESCE(registered_at, NOW())
       WHERE id = ?`,
      [firstName, lastName, member.id]
    );
    const updated = { ...member, first_name: firstName, last_name: lastName, registered_at: member.registered_at || new Date() };
    res.json(toMemberProfile(await autoApproveIfOpen(updated)));
  }));

  router.post('/logout', route(async (req, res) => {
    await destroyMemberSession(req, res);
    res.json({ ok: true });
  }));

  return router;
}
