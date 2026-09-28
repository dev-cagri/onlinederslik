import { Router } from 'express';
import { pool } from '../db/pool.js';
import { issueToken } from '../lib/livekit.js';
import { findCompletedVerification, markVerificationJoined } from '../lib/verification.js';

export const tokensRouter = Router();

// Doğrudan token üret (parola/lobby kontrol edilir).
// Yanıtlar:
//  200 + { token, url, isHost, displayName } → giriş izinli (katılımcıda ad doğrulanmış kimlikten)
//  202 + { lobby: true }           → lobby'ye düşmesi gerekiyor (Socket.IO ile devam et)
//  401 + { error: 'password' }     → parola gerekli/yanlış
//  403 + { error: 'verification_required' } → KVKK/TC/SMS/konum doğrulaması eksik
tokensRouter.post('/', async (req, res, next) => {
  try {
    const { roomId, hostToken, password, verificationId } = req.body || {};
    let { displayName } = req.body || {};

    if (!roomId) {
      return res.status(400).json({ error: 'roomId zorunlu' });
    }

    const [rows] = await pool.query(
      `SELECT id, host_token, password, lobby_enabled,
              host_only_video, allow_screen_share, chat_locked
       FROM rooms WHERE id = ?`,
      [roomId]
    );
    const room = rows[0];
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });

    const isHost = hostToken && hostToken === room.host_token;

    // Host her zaman doğrudan girer; parola/doğrulama/lobby kuralları onun için geçerli değil.
    if (isHost) {
      if (!displayName) return res.status(400).json({ error: 'displayName zorunlu' });
    } else {
      if (room.password) {
        if (!password || password !== room.password) {
          return res.status(401).json({ error: 'password' });
        }
      }
      const verification = await findCompletedVerification(roomId, verificationId);
      if (!verification) {
        return res.status(403).json({ error: 'verification_required' });
      }
      // Görünen ad doğrulanmış kimlikten gelir; istemcinin gönderdiği ad kullanılmaz
      displayName = verification.displayName;
      if (room.lobby_enabled) {
        return res.status(202).json({ lobby: true });
      }
      await markVerificationJoined(verification.id);
    }

    const { token, url } = await issueToken({
      roomId,
      displayName,
      isHost,
      hostOnlyVideo: !!room.host_only_video,
      allowScreenShare: !!room.allow_screen_share,
    });
    res.json({ token, url, isHost, displayName });
  } catch (err) {
    next(err);
  }
});
