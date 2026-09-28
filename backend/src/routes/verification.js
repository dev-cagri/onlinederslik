import { Router } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { sendOtpSms } from '../lib/sms.js';
import { isValidTcKimlikNo, normalizePhone, normalizePersonName } from '../lib/identity.js';

// OTP ve SMS kötüye kullanım sınırları
const OTP_TTL_SEC = 180;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 60;
const OTP_MAX_SENDS_PER_VERIFICATION = 3;
const OTP_MAX_SENDS_PER_PHONE_HOUR = 5;
// Okul/kurum ağında tüm sınıf aynı IP'den çıkabilir; bu yüzden geniş tutuldu
const OTP_MAX_SENDS_PER_IP_HOUR = 100;

function hashOtp(verificationId, code) {
  return crypto.createHash('sha256').update(`${verificationId}:${code}`).digest('hex');
}

// Express 4 async hataları yakalamaz; reddedilen promise'i hata middleware'ine ilet
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function stepsOf(v) {
  return {
    kvkk: true,
    identity: !!v.tc_verified_at,
    phone: !!v.phone_verified_at,
    location: !!v.location_at,
  };
}

// Katılımcı doğrulama akışı: /api/rooms/:id/verification
export function buildVerificationRouter() {
  const router = Router({ mergeParams: true });

  async function loadVerification(req, res) {
    const [rows] = await pool.query(
      `SELECT * FROM participant_verifications
       WHERE id = ? AND room_id = ? AND created_at > NOW() - INTERVAL ? HOUR`,
      [req.params.vid, req.params.id, config.verification.validHours]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Doğrulama oturumu bulunamadı veya süresi doldu' });
      return null;
    }
    return rows[0];
  }

  // 1) KVKK onayı → doğrulama oturumu açılır. Parolalı odada parola burada kontrol
  //    edilir ki linki bilmeyen biri SMS gönderimi tetikleyemesin.
  router.post('/', route(async (req, res) => {
    const { kvkkAccepted, kvkkVersion, password } = req.body || {};
    const [rooms] = await pool.query('SELECT id, password FROM rooms WHERE id = ?', [req.params.id]);
    const room = rooms[0];
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
    if (room.password && password !== room.password) {
      return res.status(401).json({ error: 'password' });
    }
    if (kvkkAccepted !== true || !kvkkVersion) {
      return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    }

    const id = nanoid(32);
    await pool.query(
      `INSERT INTO participant_verifications (id, room_id, kvkk_version, ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [id, room.id, String(kvkkVersion).slice(0, 20), req.ip, (req.get('user-agent') || '').slice(0, 255)]
    );
    res.json({ verificationId: id });
  }));

  // Yarım kalan akışı sayfa yenilemesinden sonra kaldığı yerden sürdürmek için
  router.get('/:vid', route(async (req, res) => {
    const v = await loadVerification(req, res);
    if (!v) return;
    const steps = stepsOf(v);
    res.json({
      steps,
      complete: steps.identity && steps.phone && steps.location,
      phone: v.phone_verified_at ? null : v.phone,
    });
  }));

  // 2) Kimlik: ad, soyad, TC
  router.post('/:vid/identity', route(async (req, res) => {
    const v = await loadVerification(req, res);
    if (!v) return;
    if (v.phone_verified_at) {
      return res.status(409).json({ error: 'Telefon doğrulandıktan sonra kimlik değiştirilemez' });
    }
    const firstName = normalizePersonName(req.body?.firstName);
    const lastName = normalizePersonName(req.body?.lastName);
    const tcNo = String(req.body?.tcNo || '').trim();
    if (!firstName) return res.status(400).json({ error: 'Geçerli bir ad girin' });
    if (!lastName) return res.status(400).json({ error: 'Geçerli bir soyad girin' });
    if (!isValidTcKimlikNo(tcNo)) {
      return res.status(400).json({ error: 'T.C. kimlik numarası geçersiz' });
    }

    await pool.query(
      `UPDATE participant_verifications
       SET first_name = ?, last_name = ?, tc_no = ?, tc_verified_at = NOW()
       WHERE id = ?`,
      [firstName, lastName, tcNo, v.id]
    );
    res.json({ ok: true });
  }));

  // 3a) SMS ile OTP gönder
  router.post('/:vid/otp', route(async (req, res) => {
    const v = await loadVerification(req, res);
    if (!v) return;
    if (!v.tc_verified_at) return res.status(409).json({ error: 'Önce kimlik bilgilerinizi girin' });
    if (v.phone_verified_at) return res.status(409).json({ error: 'Telefon zaten doğrulandı' });

    const target = normalizePhone(req.body?.dialCode, req.body?.phone);
    if (!target) {
      return res.status(400).json({ error: 'Geçerli bir cep telefonu numarası girin' });
    }
    if (!config.sms.allowedDialCodes.includes(target.cc)) {
      return res.status(400).json({ error: 'Bu ülkeye SMS gönderilemiyor' });
    }
    const { phone } = target;

    const [[counts]] = await pool.query(
      `SELECT
         SUM(verification_id = ?) AS perVerification,
         SUM(phone = ? AND created_at > NOW() - INTERVAL 1 HOUR) AS perPhone,
         SUM(ip = ? AND created_at > NOW() - INTERVAL 1 HOUR) AS perIp
       FROM otp_sends
       WHERE verification_id = ? OR created_at > NOW() - INTERVAL 1 HOUR`,
      [v.id, phone, req.ip, v.id]
    );
    if (Number(counts.perVerification) >= OTP_MAX_SENDS_PER_VERIFICATION
      || Number(counts.perPhone) >= OTP_MAX_SENDS_PER_PHONE_HOUR
      || Number(counts.perIp) >= OTP_MAX_SENDS_PER_IP_HOUR) {
      return res.status(429).json({ error: 'Çok fazla SMS istendi. Lütfen daha sonra tekrar deneyin.' });
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Koşullu UPDATE: aynı anda gelen iki istekten yalnızca biri bekleme süresini geçer
    const [upd] = await pool.query(
      `UPDATE participant_verifications
       SET phone = ?, otp_hash = ?, otp_sent_at = NOW(),
           otp_expires_at = NOW() + INTERVAL ? SECOND, otp_attempts = 0
       WHERE id = ? AND (otp_sent_at IS NULL OR otp_sent_at < NOW() - INTERVAL ? SECOND)`,
      [phone, hashOtp(v.id, code), OTP_TTL_SEC, v.id, OTP_RESEND_COOLDOWN_SEC]
    );
    if (upd.affectedRows === 0) {
      const [[w]] = await pool.query(
        `SELECT GREATEST(0, ? - TIMESTAMPDIFF(SECOND, otp_sent_at, NOW())) AS wait
         FROM participant_verifications WHERE id = ?`,
        [OTP_RESEND_COOLDOWN_SEC, v.id]
      );
      return res.status(429).json({
        error: 'Yeni kod için lütfen bekleyin',
        retryAfter: Number(w?.wait) || OTP_RESEND_COOLDOWN_SEC,
      });
    }

    try {
      await sendOtpSms(target, code);
    } catch (err) {
      console.error('OTP SMS gönderilemedi:', err.message);
      // Başarısız gönderim bekleme süresine sayılmasın
      await pool.query(
        'UPDATE participant_verifications SET otp_hash = NULL, otp_sent_at = NULL WHERE id = ?',
        [v.id]
      );
      return res.status(502).json({ error: 'SMS gönderilemedi. Lütfen biraz sonra tekrar deneyin.' });
    }

    await pool.query(
      'INSERT INTO otp_sends (verification_id, phone, ip) VALUES (?, ?, ?)',
      [v.id, phone, req.ip]
    );
    res.json({ ok: true, expiresIn: OTP_TTL_SEC, resendIn: OTP_RESEND_COOLDOWN_SEC });
  }));

  // 3b) OTP kodunu doğrula
  router.post('/:vid/otp/verify', route(async (req, res) => {
    const v = await loadVerification(req, res);
    if (!v) return;
    if (v.phone_verified_at) return res.json({ ok: true });

    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (code.length !== 6) return res.status(400).json({ error: '6 haneli kodu girin' });

    const [att] = await pool.query(
      `UPDATE participant_verifications SET otp_attempts = otp_attempts + 1
       WHERE id = ? AND otp_hash IS NOT NULL AND otp_expires_at > NOW() AND otp_attempts < ?`,
      [v.id, OTP_MAX_ATTEMPTS]
    );
    if (att.affectedRows === 0) {
      return res.status(410).json({ error: 'Kodun süresi doldu veya çok fazla deneme yapıldı. Yeni kod isteyin.' });
    }

    const expected = Buffer.from(v.otp_hash, 'hex');
    const actual = Buffer.from(hashOtp(v.id, code), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
      return res.status(400).json({ error: 'Kod hatalı' });
    }

    await pool.query(
      `UPDATE participant_verifications
       SET phone_verified_at = NOW(), otp_hash = NULL, otp_expires_at = NULL
       WHERE id = ?`,
      [v.id]
    );
    res.json({ ok: true });
  }));

  // 4) Konum — son adım; kaydedilince doğrulama tamamlanır
  router.post('/:vid/location', route(async (req, res) => {
    const v = await loadVerification(req, res);
    if (!v) return;
    if (!v.phone_verified_at) return res.status(409).json({ error: 'Önce telefonunuzu doğrulayın' });

    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    const accuracy = Number(req.body?.accuracy);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Geçersiz konum' });
    }

    await pool.query(
      `UPDATE participant_verifications
       SET latitude = ?, longitude = ?, location_accuracy_m = ?, location_at = NOW()
       WHERE id = ?`,
      [lat, lng, Number.isFinite(accuracy) ? accuracy : null, v.id]
    );
    res.json({ ok: true, displayName: `${v.first_name} ${v.last_name}` });
  }));

  return router;
}
