import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { deleteRoomCompletely, findStaleRooms } from './roomCleanup.js';

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

// KVKK aydınlatma metnindeki saklama sürelerini uygular:
// - yoklama (derse giriş) kayıtları ATTENDANCE_RETENTION_DAYS gün sonra silinir
// - SMS doğrulanıp ad/soyad girilmeden bırakılan üyelikler 24 saat sonra silinir
// - süresi dolan oturumlar ve SMS kodu/gönderim kayıtları temizlenir
export async function purgeExpiredData() {
  const run = async (sql, params) => (await pool.query(sql, params))[0].affectedRows;
  const attendance = await run(
    'DELETE FROM room_attendance WHERE last_joined_at < NOW() - INTERVAL ? DAY',
    [config.members.attendanceRetentionDays]
  );
  const unregistered = await run(
    'DELETE FROM members WHERE registered_at IS NULL AND created_at < NOW() - INTERVAL 1 DAY'
  );
  const sessions = await run('DELETE FROM admin_sessions WHERE expires_at < NOW()')
    + await run('DELETE FROM member_sessions WHERE expires_at < NOW()');
  await run('DELETE FROM login_otps WHERE expires_at < NOW() - INTERVAL 1 DAY');
  await run('DELETE FROM otp_sends WHERE created_at < NOW() - INTERVAL 1 DAY');
  // Süresi dolalı / bitirileli saklama süresi kadar geçmiş toplantılar dosyalarıyla silinir
  const staleRooms = await findStaleRooms(config.members.attendanceRetentionDays);
  for (const id of staleRooms) await deleteRoomCompletely(id);

  if (attendance || unregistered || sessions || staleRooms.length) {
    console.log(`Saklama süresi: ${attendance} yoklama kaydı, ${unregistered} yarım üyelik, ${sessions} oturum, ${staleRooms.length} eski toplantı silindi`);
  }
  return { attendance, unregistered, sessions, rooms: staleRooms.length };
}

export function startRetentionJob() {
  const run = () => purgeExpiredData().catch((err) => console.error('Saklama süresi temizliği:', err.message));
  run();
  setInterval(run, RUN_EVERY_MS).unref();
}
