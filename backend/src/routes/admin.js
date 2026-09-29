import { Router } from 'express';
import { pool } from '../db/pool.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAdmin,
} from '../lib/auth.js';
import { generateAccessCode, formatAccessCode } from '../lib/accessCodes.js';
import { deleteRoomCompletely, findStaleRooms } from '../lib/roomCleanup.js';
import { setSetting, getSetting, isSmsEnabled, getSiteName, smsSafe, isApprovalRequired } from '../lib/siteSettings.js';
import { getNetgsmConfig, sendSms } from '../lib/sms.js';
import { normalizePhone } from '../lib/identity.js';
import { RECORDINGS_DIR } from './recording.js';
import { egressClient } from '../lib/livekit.js';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

// Express 4 async hataları yakalamaz; reddedilen promise'i hata middleware'ine ilet
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Kaba kuvvet koruması: IP+e-posta başına 15 dakikada en fazla 5 hatalı giriş (bellekte)
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map();

// Olmayan e-postada da aynı süreli scrypt kontrolü yapılsın (e-posta varlığı sızmasın)
const DUMMY_HASH = await hashPassword('dummy-password-never-matches');

function tooManyFails(key) {
  const entry = loginFails.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFails.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordFail(key) {
  const entry = loginFails.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFails.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

const MEMBER_STATUSES = new Set(['pending', 'approved', 'rejected']);

// Yönetici paneli: /api/admin
export function buildAdminRouter() {
  const router = Router();

  router.post('/login', route(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${email}`;
    if (tooManyFails(key)) {
      return res.status(429).json({ error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' });
    }

    const [rows] = await pool.query('SELECT id, name, password_hash FROM admins WHERE email = ?', [email]);
    const admin = rows[0];
    const ok = await verifyPassword(password, admin?.password_hash || DUMMY_HASH);
    if (!admin || !ok) {
      recordFail(key);
      return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
    }

    loginFails.delete(key);
    await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
    await createSession(req, res, admin.id);
    res.json({ id: admin.id, email, name: admin.name });
  }));

  router.post('/logout', route(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  }));

  router.get('/me', requireAdmin, (req, res) => res.json(req.admin));

  router.post('/password', requireAdmin, route(async (req, res) => {
    const current = String(req.body?.currentPassword || '');
    const next = String(req.body?.newPassword || '');
    if (next.length < 10) return res.status(400).json({ error: 'Yeni şifre en az 10 karakter olmalı' });

    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
    if (!(await verifyPassword(current, rows[0]?.password_hash))) {
      return res.status(401).json({ error: 'Mevcut şifre hatalı' });
    }
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [await hashPassword(next), req.admin.id]);
    res.json({ ok: true });
  }));

  // Tüm odalar (yönetici ekibi hepsini görür); hostToken ile panelden host olarak girilir
  router.get('/rooms', requireAdmin, route(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT r.id, r.name, r.host_token, r.password IS NOT NULL AS has_password,
              r.lobby_enabled, r.created_at, r.expires_at, r.ended_at, r.room_locked,
              a.name AS created_by_name,
              (SELECT COUNT(*) FROM room_attendance ra WHERE ra.room_id = r.id) AS attendee_count
       FROM rooms r LEFT JOIN admins a ON a.id = r.created_by
       ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      hostToken: r.host_token,
      hasPassword: !!r.has_password,
      lobbyEnabled: !!r.lobby_enabled,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      endedAt: r.ended_at,
      locked: !!r.room_locked,
      createdBy: r.created_by_name,
      attendeeCount: Number(r.attendee_count),
    })));
  }));

  // Site ayarları: SMS doğrulaması ve NETGSM bilgileri. Şifre hiçbir zaman geri gönderilmez.
  async function siteSettings() {
    const netgsm = await getNetgsmConfig();
    return {
      smsEnabled: await isSmsEnabled(),
      approvalRequired: await isApprovalRequired(),
      siteName: await getSiteName(),
      brandColor: (await getSetting('brand_color')) || null,
      tagline: (await getSetting('site_tagline')) || null,
      netgsm: {
        usercode: netgsm.usercode || '',
        msgheader: netgsm.msgheader || '',
        passwordSet: !!netgsm.password,
      },
    };
  }

  router.get('/settings', requireAdmin, route(async (_req, res) => res.json(await siteSettings())));

  router.post('/settings', requireAdmin, route(async (req, res) => {
    const { smsEnabled, netgsm, siteName, approvalRequired, brandColor, tagline } = req.body || {};
    // Görünüm: boş/null gönderilirse varsayılana döner
    if (brandColor !== undefined) {
      if (brandColor && !/^#[0-9a-f]{6}$/i.test(brandColor)) return res.status(400).json({ error: 'Renk #RRGGBB biçiminde olmalı' });
      await setSetting('brand_color', brandColor ? brandColor.toLowerCase() : '');
    }
    if (tagline !== undefined) {
      const text = String(tagline || '').trim().replace(/\s+/g, ' ');
      if (text.length > 120) return res.status(400).json({ error: 'Alt yazı en fazla 120 karakter olabilir' });
      await setSetting('site_tagline', text);
    }
    let autoApproved = 0;
    if (typeof approvalRequired === 'boolean') {
      await setSetting('approval_required', approvalRequired ? '1' : '0');
      // Onay kapatılınca bekleyenler de beklemede kalmasın
      if (!approvalRequired) {
        const [r] = await pool.query(
          `UPDATE members SET status = 'approved', reviewed_at = NOW(), reviewed_by = ?
           WHERE status = 'pending' AND registered_at IS NOT NULL`,
          [req.admin.id]
        );
        autoApproved = r.affectedRows;
      }
    }
    if (typeof siteName === 'string') {
      const name = siteName.trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Site adı 2–60 karakter olmalı' });
      await setSetting('site_name', name);
    }
    if (typeof smsEnabled === 'boolean') await setSetting('sms_enabled', smsEnabled ? '1' : '0');
    if (netgsm && typeof netgsm === 'object') {
      const usercode = String(netgsm.usercode ?? '').trim();
      const msgheader = String(netgsm.msgheader ?? '').trim();
      if (usercode && !/^\d{6,15}$/.test(usercode)) {
        return res.status(400).json({ error: 'NETGSM kullanıcı kodu yalnız rakamlardan oluşmalı' });
      }
      if (msgheader.length > 11) return res.status(400).json({ error: 'Mesaj başlığı en fazla 11 karakter olabilir' });
      await setSetting('netgsm_usercode', usercode);
      await setSetting('netgsm_msgheader', msgheader);
      // Boş gönderilen şifre mevcut şifreyi korur
      if (typeof netgsm.password === 'string' && netgsm.password) {
        await setSetting('netgsm_password', netgsm.password.slice(0, 100));
      }
    }
    res.json({ ...(await siteSettings()), autoApproved });
  }));

  // NETGSM bilgilerini denemek için test SMS'i (IP başına 15 dakikada en fazla 5)
  router.post('/settings/sms-test', requireAdmin, route(async (req, res) => {
    const key = `sms-test|${req.ip}`;
    if (tooManyFails(key)) return res.status(429).json({ error: 'Çok fazla test SMS\'i. Biraz sonra tekrar deneyin.' });
    const target = normalizePhone(req.body?.dialCode || '90', req.body?.phone);
    if (!target) return res.status(400).json({ error: 'Geçerli bir cep telefonu numarası girin' });
    recordFail(key);
    try {
      await sendSms(target, `${smsSafe(await getSiteName()).slice(0, 40)} test mesaji: NETGSM ayarlariniz calisiyor.`);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }));

  // === Yöneticiler ===
  router.get('/admins', requireAdmin, route(async (_req, res) => {
    const [rows] = await pool.query('SELECT id, email, name, created_at, last_login_at FROM admins ORDER BY created_at');
    res.json(rows.map((a) => ({
      id: a.id, email: a.email, name: a.name, createdAt: a.created_at, lastLoginAt: a.last_login_at,
    })));
  }));

  // Yeni yönetici; şifre verilmezse rastgele üretilir ve yalnız bu yanıtta bir kez gösterilir
  router.post('/admins', requireAdmin, route(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim().slice(0, 120);
    let password = String(req.body?.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Geçerli bir e-posta girin' });
    if (!name) return res.status(400).json({ error: 'Ad soyad girin' });
    if (password && password.length < 10) return res.status(400).json({ error: 'Şifre en az 10 karakter olmalı' });
    const generated = !password;
    if (generated) password = crypto.randomBytes(12).toString('base64url');
    try {
      const [r] = await pool.query(
        'INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)',
        [email, name, await hashPassword(password)]
      );
      res.json({ id: r.insertId, email, name, ...(generated ? { password } : {}) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Bu e-postayla bir yönetici zaten var' });
      throw err;
    }
  }));

  router.delete('/admins/:id', requireAdmin, route(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.admin.id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM admins');
    if (n <= 1) return res.status(400).json({ error: 'Son yönetici silinemez' });
    const [r] = await pool.query('DELETE FROM admins WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Yönetici bulunamadı' });
    res.json({ ok: true });
  }));

  // === Kayıtlar (sunucu tarafı) ===
  router.get('/recordings', requireAdmin, route(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT rec.id, rec.room_id, COALESCE(r.name, rec.room_name) AS room_name, rec.status,
              rec.size_bytes, rec.duration_sec, rec.started_at, rec.ended_at
       FROM recordings rec LEFT JOIN rooms r ON r.id = rec.room_id
       ORDER BY rec.started_at DESC LIMIT 500`
    );
    const [[{ total }]] = await pool.query(
      "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM recordings WHERE status = 'completed'"
    );
    res.json({
      totalBytes: Number(total),
      recordings: rows.map((x) => ({
        id: x.id,
        roomId: x.room_id,
        roomName: x.room_name || 'Silinmiş toplantı',
        status: x.status,
        sizeBytes: x.size_bytes ? Number(x.size_bytes) : null,
        durationSec: x.duration_sec,
        startedAt: x.started_at,
        endedAt: x.ended_at,
      })),
    });
  }));

  // Kayıt dosyası: tarayıcıda izleme (Range destekli) ya da ?download=1 ile indirme
  router.get('/recordings/:id/file', requireAdmin, route(async (req, res) => {
    const [[rec]] = await pool.query(
      `SELECT rec.filepath, rec.started_at, COALESCE(r.name, rec.room_name) AS room_name
       FROM recordings rec LEFT JOIN rooms r ON r.id = rec.room_id
       WHERE rec.id = ? AND rec.status = 'completed'`,
      [req.params.id]
    );
    if (!rec || !insideRecordings(rec.filepath) || !fs.existsSync(rec.filepath)) {
      return res.status(404).json({ error: 'Kayıt dosyası bulunamadı' });
    }
    if (req.query.download) {
      const date = new Date(rec.started_at).toISOString().slice(0, 10);
      const safe = String(rec.room_name || 'kayit').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'kayit';
      return res.download(rec.filepath, `${safe} ${date}.mp4`);
    }
    res.sendFile(rec.filepath);
  }));

  router.delete('/recordings/:id', requireAdmin, route(async (req, res) => {
    const [[rec]] = await pool.query('SELECT filepath, egress_id, status FROM recordings WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: 'Kayıt bulunamadı' });
    if (['starting', 'active'].includes(rec.status) && rec.egress_id) {
      await egressClient.stopEgress(rec.egress_id).catch(() => {});
    }
    await pool.query('DELETE FROM recordings WHERE id = ?', [req.params.id]);
    if (insideRecordings(rec.filepath)) fs.unlink(rec.filepath, () => {});
    res.json({ ok: true });
  }));

  // Toplantıyı sil (katılımcılar çıkarılır; paylaşılan dosyalar, kayıtlar ve yoklama da silinir)
  router.delete('/rooms/:id', requireAdmin, route(async (req, res) => {
    if (!(await deleteRoomCompletely(req.params.id))) return res.status(404).json({ error: 'Toplantı bulunamadı' });
    res.json({ ok: true });
  }));

  // Süresi dolmuş ya da bitirilmiş tüm toplantıları sil
  router.post('/rooms/cleanup', requireAdmin, route(async (_req, res) => {
    const ids = await findStaleRooms(0);
    for (const id of ids) await deleteRoomCompletely(id);
    res.json({ ok: true, deleted: ids.length });
  }));

  // Odanın yoklaması: derse giren üyeler (KVKK kapsamındaki veriler — yalnız yöneticiye)
  router.get('/rooms/:id/participants', requireAdmin, route(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT m.id, m.first_name, m.last_name, m.phone,
              ra.first_joined_at, ra.last_joined_at, ra.join_count, ra.ip
       FROM room_attendance ra JOIN members m ON m.id = ra.member_id
       WHERE ra.room_id = ?
       ORDER BY ra.first_joined_at`,
      [req.params.id]
    );
    res.json(rows.map((r) => ({
      memberId: r.id,
      name: `${r.first_name} ${r.last_name}`,
      phone: r.phone,
      firstJoinedAt: r.first_joined_at,
      lastJoinedAt: r.last_joined_at,
      joinCount: r.join_count,
      ip: r.ip,
    })));
  }));

  // Üyeler: SMS ile giriş yapıp ad/soyadını girmiş katılımcılar. status: pending | approved | rejected
  router.get('/members', requireAdmin, route(async (req, res) => {
    const status = MEMBER_STATUSES.has(req.query.status) ? req.query.status : 'pending';
    const [counts] = await pool.query(
      `SELECT status, COUNT(*) AS n FROM members WHERE registered_at IS NOT NULL GROUP BY status`
    );
    const [rows] = await pool.query(
      `SELECT m.id, m.first_name, m.last_name, m.phone, m.status, m.is_host, m.registered_at,
              m.last_login_at, m.reviewed_at, a.name AS reviewed_by_name,
              c.code AS access_code, c.label AS access_code_label,
              (SELECT COUNT(*) FROM room_attendance ra WHERE ra.member_id = m.id) AS room_count
       FROM members m
       LEFT JOIN admins a ON a.id = m.reviewed_by
       LEFT JOIN access_codes c ON c.id = m.access_code_id
       WHERE m.registered_at IS NOT NULL AND m.status = ?
       ORDER BY ${status === 'pending' ? 'm.registered_at' : 'm.reviewed_at DESC'}
       LIMIT 1000`,
      [status]
    );
    res.json({
      counts: Object.fromEntries([...MEMBER_STATUSES].map((s) => [
        s, Number(counts.find((c) => c.status === s)?.n || 0),
      ])),
      members: rows.map((m) => ({
        id: m.id,
        name: `${m.first_name} ${m.last_name}`,
        phone: m.phone,
        status: m.status,
        isHost: !!m.is_host,
        registeredAt: m.registered_at,
        lastLoginAt: m.last_login_at,
        reviewedAt: m.reviewed_at,
        reviewedBy: m.reviewed_by_name,
        // Giriş koduyla onaylandıysa kodun etiketi (yoksa kodun kendisi)
        viaCode: m.access_code ? (m.access_code_label || formatAccessCode(m.access_code)) : null,
        roomCount: Number(m.room_count),
      })),
    });
  }));

  // Üyeyi onayla / reddet / tekrar beklemeye al
  router.post('/members/:id/status', requireAdmin, route(async (req, res) => {
    const status = req.body?.status;
    if (!MEMBER_STATUSES.has(status)) return res.status(400).json({ error: 'Geçersiz durum' });
    const [r] = await pool.query(
      `UPDATE members SET status = ?, reviewed_at = NOW(), reviewed_by = ?
       WHERE id = ? AND registered_at IS NOT NULL`,
      [status, req.admin.id, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Üye bulunamadı' });
    res.json({ ok: true, status });
  }));

  // Toplantı yöneticisi yetkisi ver/kaldır (verilince üye onaylanır)
  router.post('/members/:id/host', requireAdmin, route(async (req, res) => {
    const isHost = !!req.body?.isHost;
    const [r] = isHost
      ? await pool.query(
        `UPDATE members SET is_host = 1, status = 'approved',
           reviewed_at = COALESCE(reviewed_at, NOW()), reviewed_by = COALESCE(reviewed_by, ?)
         WHERE id = ? AND registered_at IS NOT NULL`,
        [req.admin.id, req.params.id]
      )
      : await pool.query('UPDATE members SET is_host = 0 WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Üye bulunamadı' });
    res.json({ ok: true, isHost });
  }));

  // Onay bekleyen herkesi onayla
  router.post('/members/approve-pending', requireAdmin, route(async (req, res) => {
    const [r] = await pool.query(
      `UPDATE members SET status = 'approved', reviewed_at = NOW(), reviewed_by = ?
       WHERE status = 'pending' AND registered_at IS NOT NULL`,
      [req.admin.id]
    );
    res.json({ ok: true, approved: r.affectedRows });
  }));

  // Üyeyi ve tüm verilerini sil (KVKK silme talebi); oturumlar ve yoklama kayıtları CASCADE ile gider
  router.delete('/members/:id', requireAdmin, route(async (req, res) => {
    const [r] = await pool.query('DELETE FROM members WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Üye bulunamadı' });
    res.json({ ok: true });
  }));

  // Giriş kodları: SMS ve yönetici onayı olmadan üyelik
  router.get('/access-codes', requireAdmin, route(async (_req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id, c.code, c.label, c.max_uses, c.uses, c.expires_at, c.created_at,
              a.name AS created_by_name,
              (c.max_uses IS NOT NULL AND c.uses >= c.max_uses)
                OR (c.expires_at IS NOT NULL AND c.expires_at <= NOW()) AS exhausted
       FROM access_codes c LEFT JOIN admins a ON a.id = c.created_by
       ORDER BY c.created_at DESC`
    );
    res.json(rows.map(toAccessCode));
  }));

  router.post('/access-codes', requireAdmin, route(async (req, res) => {
    const label = String(req.body?.label || '').trim().slice(0, 120) || null;
    const maxUses = req.body?.maxUses ? Math.floor(Number(req.body.maxUses)) : null;
    const validDays = req.body?.validDays ? Math.floor(Number(req.body.validDays)) : null;
    if (maxUses !== null && !(maxUses >= 1 && maxUses <= 100000)) {
      return res.status(400).json({ error: 'Kullanım sınırı 1 ile 100000 arasında olmalı' });
    }
    if (validDays !== null && !(validDays >= 1 && validDays <= 3650)) {
      return res.status(400).json({ error: 'Geçerlilik süresi 1 ile 3650 gün arasında olmalı' });
    }
    // Çakışma olasılığı çok düşük; yine de UNIQUE ihlalinde yeni kod denenir
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [ins] = await pool.query(
          `INSERT INTO access_codes (code, label, max_uses, expires_at, created_by)
           VALUES (?, ?, ?, IF(? IS NULL, NULL, NOW() + INTERVAL ? DAY), ?)`,
          [generateAccessCode(), label, maxUses, validDays, validDays, req.admin.id]
        );
        const [[row]] = await pool.query(
          `SELECT c.*, ? AS created_by_name, 0 AS exhausted FROM access_codes c WHERE c.id = ?`,
          [req.admin.name, ins.insertId]
        );
        return res.json(toAccessCode(row));
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    throw new Error('Kod üretilemedi');
  }));

  // Kodu siler; kodla gelmiş üyeler onaylı üye olarak kalır
  router.delete('/access-codes/:id', requireAdmin, route(async (req, res) => {
    const [r] = await pool.query('DELETE FROM access_codes WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Kod bulunamadı' });
    res.json({ ok: true });
  }));

  return router;
}

// Veritabanındaki yol yalnız kayıt klasörünün içindeyse kullanılır
function insideRecordings(p) {
  return !!p && path.resolve(p).startsWith(path.resolve(RECORDINGS_DIR) + path.sep);
}

function toAccessCode(c) {
  return {
    id: c.id,
    code: formatAccessCode(c.code),
    label: c.label,
    maxUses: c.max_uses,
    uses: c.uses,
    expiresAt: c.expires_at,
    active: !c.exhausted,
    createdAt: c.created_at,
    createdBy: c.created_by_name,
  };
}
