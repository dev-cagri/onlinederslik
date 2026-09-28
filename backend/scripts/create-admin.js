// Yönetici ekler ya da mevcut yöneticinin şifresini sıfırlar.
// Kullanım: npm run admin:create -- <e-posta> "<Ad Soyad>"
// Şifre ADMIN_PASSWORD ortam değişkeniyle verilebilir; verilmezse rastgele üretilip bir kez yazdırılır.
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/lib/auth.js';

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const name = nameParts.join(' ').trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('Kullanım: npm run admin:create -- <e-posta> "<Ad Soyad>"');
  process.exit(1);
}

const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const [res] = await pool.query(
  `INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)
   ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)`,
  [email, name, await hashPassword(password)]
);
// Şifre sıfırlandıysa eski oturumlar da kapansın
if (res.affectedRows === 2) {
  await pool.query('DELETE s FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE a.email = ?', [email]);
}

console.log(res.affectedRows === 1 ? 'Yönetici oluşturuldu.' : 'Yönetici güncellendi, şifre sıfırlandı.');
if (process.env.ADMIN_PASSWORD) {
  console.log(`E-posta: ${email}\nŞifre:   (ADMIN_PASSWORD ile verilen)`);
} else {
  console.log(`E-posta: ${email}\nŞifre:   ${password}\n(Şifre yalnızca bir kez gösterilir; panelden değiştirilebilir.)`);
}
await pool.end();
