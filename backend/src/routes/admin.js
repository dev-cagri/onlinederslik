import { Router } from 'express';
import { pool } from '../db/pool.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAdmin,
} from '../lib/auth.js';

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
              r.lobby_enabled, r.created_at, a.name AS created_by_name,
              (SELECT COUNT(*) FROM participant_verifications v
                WHERE v.room_id = r.id AND v.location_at IS NOT NULL) AS verified_count
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
      createdBy: r.created_by_name,
      verifiedCount: Number(r.verified_count),
    })));
  }));

  // Odanın doğrulama kayıtları (KVKK kapsamındaki veriler — yalnız yöneticiye)
  router.get('/rooms/:id/participants', requireAdmin, route(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT first_name, last_name, tc_no, phone, latitude, longitude, location_accuracy_m,
              ip, kvkk_version, created_at, location_at, last_joined_at
       FROM participant_verifications
       WHERE room_id = ? AND tc_verified_at IS NOT NULL
       ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows.map((v) => ({
      name: `${v.first_name} ${v.last_name}`,
      tcNo: v.tc_no,
      phone: v.phone,
      latitude: v.latitude != null ? Number(v.latitude) : null,
      longitude: v.longitude != null ? Number(v.longitude) : null,
      accuracy: v.location_accuracy_m,
      ip: v.ip,
      kvkkVersion: v.kvkk_version,
      startedAt: v.created_at,
      completedAt: v.location_at,
      lastJoinedAt: v.last_joined_at,
    })));
  }));

  return router;
}
