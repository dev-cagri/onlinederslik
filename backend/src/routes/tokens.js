import { Router } from 'express';
import { pool } from '../db/pool.js';
import { issueToken } from '../lib/livekit.js';
import { getSessionMember } from '../lib/auth.js';
import { memberJoinBlocker, memberDisplayName, recordAttendance } from '../lib/members.js';

export const tokensRouter = Router();

// Doğrudan token üret (parola/lobby kontrol edilir).
// Yanıtlar:
//  200 + { token, url, isHost, displayName } → giriş izinli (katılımcıda ad üyelikten)
//  202 + { lobby: true }           → lobby'ye düşmesi gerekiyor (Socket.IO ile devam et)
//  401 + { error: 'password' }     → parola gerekli/yanlış
//  403 + { error: 'login_required' | 'registration_required' | 'not_approved' }
//                                  → SMS girişi / ad-soyad / yönetici onayı eksik
//  403 + { error: 'room_locked' }  → host toplantıyı yeni katılımlara kapattı (ya da bitirdi)
//  403 + { error: 'room_expired' } → toplantı linkinin süresi doldu
tokensRouter.post('/', async (req, res, next) => {
  try {
    const { roomId, hostToken, password } = req.body || {};
    let { displayName } = req.body || {};

    if (!roomId) {
      return res.status(400).json({ error: 'roomId zorunlu' });
    }

    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    const room = rows[0];
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });

    let isHost = hostToken && hostToken === room.host_token;
    // Toplantı yöneticisi üye (tüm toplantılar ya da yalnız bu toplantı için atanmış):
    // host token'ı olmasa da host olarak girer ve token'ı alır
    const member = await getSessionMember(req.headers.cookie);
    let memberIsHost = false;
    if (!isHost && member && !memberJoinBlocker(member)) {
      if (member.is_host) memberIsHost = true;
      else {
        const [[rh]] = await pool.query('SELECT 1 AS ok FROM room_hosts WHERE room_id = ? AND member_id = ?', [roomId, member.id]);
        memberIsHost = !!rh;
      }
    }
    if (memberIsHost) {
      isHost = true;
      displayName = memberDisplayName(member);
    }

    // Host her zaman doğrudan girer; parola/üyelik/lobby kuralları onun için geçerli değil.
    if (isHost) {
      if (!displayName) return res.status(400).json({ error: 'displayName zorunlu' });
    } else {
      if (room.password) {
        if (!password || password !== room.password) {
          return res.status(401).json({ error: 'password' });
        }
      }
      // Yalnız SMS ile giriş yapmış ve yöneticinin onayladığı üyeler girebilir
      const blocker = memberJoinBlocker(member);
      if (blocker) return res.status(403).json({ error: blocker });
      if (room.expires_at && new Date(room.expires_at) < new Date()) {
        return res.status(403).json({ error: 'room_expired' });
      }
      if (room.room_locked) return res.status(403).json({ error: 'room_locked' });
      // Görünen ad üyelikten gelir; istemcinin gönderdiği ad kullanılmaz
      displayName = memberDisplayName(member);
      if (room.lobby_enabled) {
        return res.status(202).json({ lobby: true });
      }
      await recordAttendance(roomId, member.id, req.ip);
    }

    if (memberIsHost) await recordAttendance(roomId, member.id, req.ip);
    const { token, url } = await issueToken({ roomId, displayName, isHost, room, memberId: member?.id });
    res.json({ token, url, isHost, displayName, ...(memberIsHost ? { hostToken: room.host_token } : {}) });
  } catch (err) {
    next(err);
  }
});
