import { pool } from '../db/pool.js';
import { config } from '../config.js';

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

// KVKK aydınlatma metnindeki saklama süresini uygular: süresi dolan katılımcı doğrulama
// kayıtları (TC, telefon, konum, IP) silinir; otp_sends satırları FK CASCADE ile gider.
export async function purgeExpiredData() {
  const [v] = await pool.query(
    'DELETE FROM participant_verifications WHERE created_at < NOW() - INTERVAL ? DAY',
    [config.verification.retentionDays]
  );
  const [s] = await pool.query('DELETE FROM admin_sessions WHERE expires_at < NOW()');
  if (v.affectedRows || s.affectedRows) {
    console.log(`Saklama süresi: ${v.affectedRows} doğrulama kaydı, ${s.affectedRows} oturum silindi`);
  }
  return { verifications: v.affectedRows, sessions: s.affectedRows };
}

export function startRetentionJob() {
  const run = () => purgeExpiredData().catch((err) => console.error('Saklama süresi temizliği:', err.message));
  run();
  setInterval(run, RUN_EVERY_MS).unref();
}
