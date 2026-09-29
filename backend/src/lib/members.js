import { pool } from '../db/pool.js';
import { isApprovalRequired } from './siteSettings.js';

// İstemciye dönen üye profili (getSessionMember satırından)
export function toMemberProfile(m) {
  return {
    id: m.id,
    phone: m.phone,
    firstName: m.first_name,
    lastName: m.last_name,
    registered: !!m.registered_at,
    status: m.status,
    isHost: !!m.is_host,
  };
}

// Onay ayarı kapalıysa kaydını tamamlamış, onay bekleyen üyeyi onaylar (reddedilmişe dokunmaz).
// Güncellenmiş üye satırını döndürür.
export async function autoApproveIfOpen(member) {
  if (!member?.registered_at || member.status !== 'pending' || await isApprovalRequired()) return member;
  await pool.query(
    "UPDATE members SET status = 'approved', reviewed_at = NOW(), reviewed_by = NULL WHERE id = ? AND status = 'pending'",
    [member.id]
  );
  return { ...member, status: 'approved' };
}

export const memberDisplayName = (m) => `${m.first_name} ${m.last_name}`;

// Derse giriş engeli: null → girebilir; aksi hâlde istemciye dönecek hata kodu.
// Üye yoksa giriş, ad/soyad yoksa kayıt, onay yoksa yönetici onayı beklenir.
export function memberJoinBlocker(member) {
  if (!member) return 'login_required';
  if (!member.registered_at) return 'registration_required';
  if (member.status !== 'approved') return 'not_approved';
  return null;
}

// Yoklama: üyenin bu derse girişini kaydeder (ilk/son giriş ve giriş sayısı)
export async function recordAttendance(roomId, memberId, ip) {
  await pool.query(
    `INSERT INTO room_attendance (room_id, member_id, ip) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_joined_at = NOW(), join_count = join_count + 1, ip = VALUES(ip)`,
    [roomId, memberId, ip || null]
  );
}
