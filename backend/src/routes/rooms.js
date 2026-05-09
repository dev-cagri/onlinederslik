import { Router } from 'express';
import { nanoid } from 'nanoid';
import { TrackSource } from 'livekit-server-sdk';
import { pool } from '../db/pool.js';
import { roomService, buildSourcesFor, isParticipantHost } from '../lib/livekit.js';

const MIC_VALUES = new Set([TrackSource.MICROPHONE, 2, 'microphone', 'MICROPHONE']);
const CAM_VALUES = new Set([TrackSource.CAMERA, 1, 'camera', 'CAMERA']);
const SS_VALUES = new Set([TrackSource.SCREEN_SHARE, 3, 'screen_share', 'SCREEN_SHARE']);

function matchesSource(track, source) {
  if (source === 'microphone') return MIC_VALUES.has(track.source);
  if (source === 'camera') return CAM_VALUES.has(track.source);
  if (source === 'screen_share') return SS_VALUES.has(track.source);
  return false;
}

export function buildRoomsRouter(io) {
  const router = Router();

  // --- Oda oluşturma & bilgi ---

  router.post('/', async (req, res) => {
    const name = (req.body?.name || 'Yeni Toplantı').toString().slice(0, 255);
    const password = req.body?.password ? req.body.password.toString().slice(0, 120) : null;
    const lobbyEnabled = req.body?.lobbyEnabled ? 1 : 0;
    const id = nanoid(10);
    const hostToken = nanoid(32);

    await pool.query(
      'INSERT INTO rooms (id, name, host_token, password, lobby_enabled) VALUES (?, ?, ?, ?, ?)',
      [id, name, hostToken, password, lobbyEnabled]
    );

    res.json({ id, name, hostToken, hasPassword: !!password, lobbyEnabled: !!lobbyEnabled });
  });

  router.get('/:id', async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, password IS NOT NULL AS has_password, lobby_enabled,
              host_only_video, allow_screen_share, chat_locked,
              created_at, ended_at
       FROM rooms WHERE id = ?`,
      [req.params.id]
    );
    const room = rows[0];
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
    res.json({
      id: room.id,
      name: room.name,
      hasPassword: !!room.has_password,
      lobbyEnabled: !!room.lobby_enabled,
      hostOnlyVideo: !!room.host_only_video,
      allowScreenShare: !!room.allow_screen_share,
      chatLocked: !!room.chat_locked,
      createdAt: room.created_at,
      endedAt: room.ended_at,
    });
  });

  router.get('/:id/messages', async (req, res) => {
    const [rows] = await pool.query(
      'SELECT sender_name, body, created_at FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 200',
      [req.params.id]
    );
    res.json(rows.reverse());
  });

  // --- Host kontrolleri ---
  async function requireHost(req, res) {
    const { hostToken } = req.body || {};
    const [rows] = await pool.query(
      `SELECT id, host_token, host_only_video, allow_screen_share, chat_locked
       FROM rooms WHERE id = ?`,
      [req.params.id]
    );
    const room = rows[0];
    if (!room) {
      res.status(404).json({ error: 'Oda bulunamadı' });
      return null;
    }
    if (!hostToken || hostToken !== room.host_token) {
      res.status(403).json({ error: 'Yetkisiz' });
      return null;
    }
    return room;
  }

  // Mevcut bağlı katılımcılara güncel izinleri uygula. Host olmayanların
  // canPublishSources'unu yeni ayara göre ayarlar; gerekirse track'leri sustur.
  async function reapplyPermissions(roomId) {
    const [rows] = await pool.query(
      'SELECT host_only_video, allow_screen_share FROM rooms WHERE id = ?',
      [roomId]
    );
    const room = rows[0];
    if (!room) return;
    const participants = await roomService.listParticipants(roomId).catch(() => []);

    for (const p of participants) {
      if (isParticipantHost(p)) continue;
      const sources = buildSourcesFor({
        isHost: false,
        hostOnlyVideo: !!room.host_only_video,
        allowScreenShare: !!room.allow_screen_share,
      });

      await roomService.updateParticipant(roomId, p.identity, {
        permission: {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          canPublishSources: sources,
        },
      }).catch(() => {});

      // Yasaklanan kaynakların aktif track'lerini sustur
      for (const t of p.tracks || []) {
        const isCam = matchesSource(t, 'camera');
        const isSs = matchesSource(t, 'screen_share');
        const shouldMute =
          (isCam && room.host_only_video && !t.muted) ||
          (isSs && !room.allow_screen_share && !t.muted);
        if (shouldMute) {
          await roomService.mutePublishedTrack(roomId, p.identity, t.sid, true).catch(() => {});
        }
      }
    }
  }

  router.post('/:id/mute', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const { identity, source = 'microphone', muted = true } = req.body || {};
      if (!identity) return res.status(400).json({ error: 'identity zorunlu' });

      const participant = await roomService.getParticipant(room.id, identity);
      const tracks = participant.tracks || [];
      const target = tracks.find((t) => matchesSource(t, source));
      if (!target) return res.json({ ok: true, note: 'İlgili track bulunamadı' });

      await roomService.mutePublishedTrack(room.id, identity, target.sid, !!muted);
      res.json({ ok: true, muted: !!muted });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/mute-all', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const source = req.body?.source === 'camera' ? 'camera' : 'microphone';

      const participants = await roomService.listParticipants(room.id);
      const tasks = [];
      for (const p of participants) {
        for (const t of p.tracks || []) {
          if (matchesSource(t, source) && !t.muted) {
            tasks.push(
              roomService.mutePublishedTrack(room.id, p.identity, t.sid, true).catch(() => {})
            );
          }
        }
      }
      await Promise.all(tasks);
      res.json({ ok: true, source, muted: tasks.length });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/host-only-video', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const enabled = !!req.body?.enabled;

      await pool.query('UPDATE rooms SET host_only_video = ? WHERE id = ?', [enabled ? 1 : 0, room.id]);
      await reapplyPermissions(room.id);

      io.to(room.id).emit('room:settings', { hostOnlyVideo: enabled });
      io.to(`host:${room.id}`).emit('room:settings', { hostOnlyVideo: enabled });
      res.json({ ok: true, enabled });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/allow-screen-share', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const enabled = !!req.body?.enabled;

      await pool.query('UPDATE rooms SET allow_screen_share = ? WHERE id = ?', [enabled ? 1 : 0, room.id]);
      await reapplyPermissions(room.id);

      io.to(room.id).emit('room:settings', { allowScreenShare: enabled });
      io.to(`host:${room.id}`).emit('room:settings', { allowScreenShare: enabled });
      res.json({ ok: true, enabled });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/lock-chat', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const locked = !!req.body?.locked;

      await pool.query('UPDATE rooms SET chat_locked = ? WHERE id = ?', [locked ? 1 : 0, room.id]);

      io.to(room.id).emit('room:settings', { chatLocked: locked });
      io.to(`host:${room.id}`).emit('room:settings', { chatLocked: locked });
      res.json({ ok: true, locked });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/kick', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const { identity } = req.body || {};
      if (!identity) return res.status(400).json({ error: 'identity zorunlu' });

      await roomService.removeParticipant(room.id, identity);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
