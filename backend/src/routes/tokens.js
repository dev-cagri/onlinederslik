import { Router } from 'express';
import { pool } from '../db/pool.js';
import { issueToken } from '../lib/livekit.js';

export const tokensRouter = Router();

// Doğrudan token üret (parola/lobby kontrol edilir).
// Yanıtlar:
//  200 + { token, url, isHost }   → giriş izinli
//  202 + { lobby: true }           → lobby'ye düşmesi gerekiyor (Socket.IO ile devam et)
//  401 + { error: 'password' }     → parola gerekli/yanlış
tokensRouter.post('/', async (req, res, next) => {
  try {
    const { roomId, displayName, hostToken, password } = req.body || {};

    if (!roomId || !displayName) {
      return res.status(400).json({ error: 'roomId ve displayName zorunlu' });
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

    // Host her zaman doğrudan girer; parola/lobby kuralları onun için geçerli değil.
    if (!isHost) {
      if (room.password) {
        if (!password || password !== room.password) {
          return res.status(401).json({ error: 'password' });
        }
      }
      if (room.lobby_enabled) {
        return res.status(202).json({ lobby: true });
      }
    }

    const { token, url } = await issueToken({
      roomId,
      displayName,
      isHost,
      hostOnlyVideo: !!room.host_only_video,
      allowScreenShare: !!room.allow_screen_share,
    });
    res.json({ token, url, isHost });
  } catch (err) {
    next(err);
  }
});
