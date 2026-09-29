import crypto from 'crypto';
import { promisify } from 'util';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'od_admin';
export const MEMBER_COOKIE = 'od_member';
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

// Express isteği ya da Socket.IO handshake'inin Cookie başlığını ayrıştırır
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, name, value, maxAgeSec) {
  // HttpOnly: JS okuyamaz; SameSite=Lax: başka sitelerden gelen POST'larda gönderilmez
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  return parts.join('; ');
}

// Yönetici ve üye oturumları aynı mekanizmayı kullanır; yalnız çerez adı, tablo ve süre farklı.
function sessionStore({ cookie, table, ownerColumn, ttlDays }) {
  const tokenHash = (cookieHeader) => {
    const token = parseCookies(cookieHeader)[cookie];
    return token ? sha256(token) : null;
  };
  return {
    tokenHash,
    async create(req, res, ownerId) {
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(
        `INSERT INTO ${table} (token_hash, ${ownerColumn}, expires_at) VALUES (?, ?, NOW() + INTERVAL ? DAY)`,
        [sha256(token), ownerId, ttlDays]
      );
      res.append('Set-Cookie', sessionCookie(req, cookie, token, ttlDays * 86400));
    },
    async destroy(req, res) {
      const hash = tokenHash(req.headers.cookie);
      if (hash) await pool.query(`DELETE FROM ${table} WHERE token_hash = ?`, [hash]);
      res.append('Set-Cookie', sessionCookie(req, cookie, '', 0));
    },
  };
}

const adminSessions = sessionStore({
  cookie: SESSION_COOKIE, table: 'admin_sessions', ownerColumn: 'admin_id', ttlDays: SESSION_TTL_DAYS,
});
const memberSessions = sessionStore({
  cookie: MEMBER_COOKIE, table: 'member_sessions', ownerColumn: 'member_id', ttlDays: config.members.sessionDays,
});

export const createSession = adminSessions.create;
export const destroySession = adminSessions.destroy;
export const createMemberSession = memberSessions.create;
export const destroyMemberSession = memberSessions.destroy;

// Çerezdeki oturuma ait yöneticiyi döndürür; yoksa/süresi dolduysa null.
export async function getSessionAdmin(req) {
  const hash = adminSessions.tokenHash(req.headers.cookie);
  if (!hash) return null;
  const [rows] = await pool.query(
    `SELECT a.id, a.email, a.name FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [hash]
  );
  return rows[0] || null;
}

// Cookie başlığındaki oturuma ait üyeyi döndürür; yoksa/süresi dolduysa null.
// HTTP isteğinde req.headers.cookie, Socket.IO'da socket.handshake.headers.cookie verilir.
export async function getSessionMember(cookieHeader) {
  const hash = memberSessions.tokenHash(cookieHeader);
  if (!hash) return null;
  const [rows] = await pool.query(
    `SELECT m.id, m.phone, m.first_name, m.last_name, m.status, m.is_host, m.registered_at
     FROM member_sessions s
     JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [hash]
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
