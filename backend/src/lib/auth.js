import crypto from 'crypto';
import { promisify } from 'util';
import { pool } from '../db/pool.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'od_admin';
const SESSION_TTL_DAYS = 7;

// Şifre özeti: "scrypt$<salt hex>$<hash hex>"
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, value, maxAgeSec) {
  // HttpOnly: JS okuyamaz; SameSite=Lax: başka sitelerden gelen POST'larda gönderilmez
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  return parts.join('; ');
}

export async function createSession(req, res, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
     VALUES (?, ?, NOW() + INTERVAL ? DAY)`,
    [sha256(token), adminId, SESSION_TTL_DAYS]
  );
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_TTL_DAYS * 86400));
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256(token)]);
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
}

// Çerezdeki oturuma ait yöneticiyi döndürür; yoksa/süresi dolduysa null.
export async function getSessionAdmin(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT a.id, a.email, a.name FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [sha256(token)]
  );
  return rows[0] || null;
}

// Yalnızca giriş yapmış yöneticiye izin verir; req.admin'i doldurur.
export function requireAdmin(req, res, next) {
  getSessionAdmin(req)
    .then((admin) => {
      if (!admin) return res.status(401).json({ error: 'Yönetici girişi gerekli' });
      req.admin = admin;
      next();
    })
    .catch(next);
}
