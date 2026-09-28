import { pool } from '../db/pool.js';
import { config } from '../config.js';

// Odaya ait, tüm adımları tamamlanmış ve süresi dolmamış doğrulamayı döndürür; yoksa null.
// Token üretimi ve bekleme odası bu kontrolü geçmeyen katılımcıyı içeri almaz.
export async function findCompletedVerification(roomId, verificationId) {
  if (!verificationId || typeof verificationId !== 'string') return null;
  const [rows] = await pool.query(
    `SELECT id, first_name, last_name FROM participant_verifications
     WHERE id = ? AND room_id = ?
       AND tc_verified_at IS NOT NULL
       AND phone_verified_at IS NOT NULL
       AND location_at IS NOT NULL
       AND created_at > NOW() - INTERVAL ? HOUR`,
    [verificationId, roomId, config.verification.validHours]
  );
  const v = rows[0];
  if (!v) return null;
  return { id: v.id, displayName: `${v.first_name} ${v.last_name}` };
}

export async function markVerificationJoined(verificationId) {
  await pool.query(
    'UPDATE participant_verifications SET last_joined_at = NOW() WHERE id = ?',
    [verificationId]
  );
}
