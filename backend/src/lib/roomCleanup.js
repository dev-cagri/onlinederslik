import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { roomService } from './livekit.js';
import { UPLOADS_DIR } from '../routes/share.js';

// Toplantıyı siler: bağlı herkes çıkarılır, paylaşılan dosyalar diskten, satırlar veritabanından
// kalkar (mesaj ve katılım satırları FK CASCADE ile). Kayıtlar silinmez; Kayıtlar bölümünde
// toplantı adıyla kalır ve oradan ayrıca silinir.
export async function deleteRoomCompletely(roomId) {
  await roomService.deleteRoom(roomId).catch(() => {});
  const [r] = await pool.query('DELETE FROM rooms WHERE id = ?', [roomId]);
  if (/^[A-Za-z0-9_-]+$/.test(roomId)) {
    await fs.rm(path.join(UPLOADS_DIR, roomId), { recursive: true, force: true });
  }
  return r.affectedRows > 0;
}

// Süresi dolmuş ya da bitirilmiş toplantılar (olderThanDays verilirse o kadar gün önce)
export async function findStaleRooms(olderThanDays = 0) {
  const [rows] = await pool.query(
    `SELECT id FROM rooms
     WHERE (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL ? DAY)
        OR (ended_at IS NOT NULL AND ended_at < NOW() - INTERVAL ? DAY)`,
    [olderThanDays, olderThanDays]
  );
  return rows.map((r) => r.id);
}
