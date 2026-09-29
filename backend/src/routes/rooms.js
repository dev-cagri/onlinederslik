import { Router } from 'express';
import { nanoid } from 'nanoid';
import { TrackSource, DataPacket_Kind } from 'livekit-server-sdk';
import { pool } from '../db/pool.js';
import {
  roomService, buildSourcesFor, isParticipantHost, roomPermissions, publishPermission, sendNotice,
} from '../lib/livekit.js';
import { requireAdmin } from '../lib/auth.js';

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

  // Toplantı yalnızca giriş yapmış yönetici tarafından açılabilir.
  // validDays: link ömrü (gün); verilmezse ya da null ise süresiz.
  router.post('/', requireAdmin, async (req, res) => {
    const name = (req.body?.name || `${req.admin.name} - Toplantı`).toString().slice(0, 255);
    const password = req.body?.password ? req.body.password.toString().slice(0, 120) : null;
    const lobbyEnabled = req.body?.lobbyEnabled ? 1 : 0;
    const validDays = req.body?.validDays ? Math.floor(Number(req.body.validDays)) : null;
    if (validDays !== null && !(validDays >= 1 && validDays <= 365)) {
      return res.status(400).json({ error: 'Link süresi 1 ile 365 gün arasında olmalı' });
    }
    const id = nanoid(10);
    const hostToken = nanoid(32);

    await pool.query(
      `INSERT INTO rooms (id, name, host_token, password, lobby_enabled, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW() + INTERVAL ? DAY))`,
      [id, name, hostToken, password, lobbyEnabled, req.admin.id, validDays, validDays]
    );
    const [[room]] = await pool.query('SELECT expires_at FROM rooms WHERE id = ?', [id]);

    res.json({ id, name, hostToken, hasPassword: !!password, lobbyEnabled: !!lobbyEnabled, expiresAt: room.expires_at });
  });

  router.get('/:id', async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    const room = rows[0];
    if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
    res.json({
      id: room.id,
      name: room.name,
      hasPassword: !!room.password,
      createdAt: room.created_at,
      endedAt: room.ended_at,
      expiresAt: room.expires_at,
      expired: !!room.expires_at && new Date(room.expires_at) < new Date(),
      ...publicSettings(room),
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
    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
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

  async function nonHostParticipants(roomId) {
    const participants = await roomService.listParticipants(roomId).catch(() => []);
    return participants.filter((p) => !isParticipantHost(p));
  }

  // Bağlı katılımcılara güncel izinleri uygula: host olmayanların canPublishSources'unu
  // yeni ayara göre ayarla, artık izinli olmayan kaynakların açık track'lerini sustur.
  async function reapplyPermissions(room) {
    const perms = roomPermissions(room);
    const sources = buildSourcesFor({ isHost: false, ...perms });
    for (const p of await nonHostParticipants(room.id)) {
      await roomService.updateParticipant(room.id, p.identity, {
        permission: { canSubscribe: true, canPublishData: true, ...publishPermission(sources) },
      }).catch(() => {});

      for (const t of p.tracks || []) {
        const forbidden =
          (matchesSource(t, 'microphone') && !perms.allowMic) ||
          (matchesSource(t, 'camera') && (!perms.allowCamera || perms.hostOnlyVideo)) ||
          (matchesSource(t, 'screen_share') && !perms.allowScreenShare);
        if (forbidden && !t.muted) {
          await roomService.mutePublishedTrack(room.id, p.identity, t.sid, true).catch(() => {});
        }
      }
    }
  }

  // Tek katılımcının mikrofon/kamerasını kapat-aç; katılımcıya bildirim gider
  router.post('/:id/mute', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const { identity, source = 'microphone', muted = true } = req.body || {};
      if (!identity) return res.status(400).json({ error: 'identity zorunlu' });

      const participant = await roomService.getParticipant(room.id, identity);
      const target = (participant.tracks || []).find((t) => matchesSource(t, source));
      if (!target) return res.json({ ok: true, note: 'İlgili track bulunamadı' });

      await roomService.mutePublishedTrack(room.id, identity, target.sid, !!muted);
      const what = source === 'camera' ? 'kameranızı' : 'mikrofonunuzu';
      await sendNotice(room.id, `Host ${what} ${muted ? 'kapattı' : 'açtı'}`, [identity]);
      res.json({ ok: true, muted: !!muted });
    } catch (err) {
      next(err);
    }
  });

  // Host hariç herkesin mikrofonunu ya da kamerasını kapat
  router.post('/:id/mute-all', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const source = req.body?.source === 'camera' ? 'camera' : 'microphone';

      const others = await nonHostParticipants(room.id);
      const muted = [];
      await Promise.all(others.map(async (p) => {
        const open = (p.tracks || []).filter((t) => matchesSource(t, source) && !t.muted);
        if (!open.length) return;
        await Promise.all(open.map((t) => roomService.mutePublishedTrack(room.id, p.identity, t.sid, true).catch(() => {})));
        muted.push(p.identity);
      }));
      await sendNotice(
        room.id,
        source === 'camera' ? 'Host tüm kameraları kapattı' : 'Host tüm mikrofonları kapattı',
        others.map((p) => p.identity)
      );
      res.json({ ok: true, source, muted: muted.length });
    } catch (err) {
      next(err);
    }
  });

  // Ders ayarları (kısmi güncelleme). Gövde: { hostToken, <ayar>: değer, ... }
  router.post('/:id/settings', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const body = req.body || {};
      const updates = {};
      for (const [key, column] of Object.entries(SETTING_COLUMNS)) {
        if (typeof body[key] === 'boolean') updates[column] = body[key] ? 1 : 0;
      }
      if (typeof body.name === 'string') {
        const name = body.name.trim().slice(0, 255);
        if (!name) return res.status(400).json({ error: 'Ders adı boş olamaz' });
        updates.name = name;
      }
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'Değiştirilecek ayar yok' });

      await pool.query('UPDATE rooms SET ? WHERE id = ?', [updates, room.id]);
      const updated = { ...room, ...updates };
      if (PERMISSION_COLUMNS.some((c) => c in updates)) await reapplyPermissions(updated);

      const settings = publicSettings(updated);
      io.to(room.id).emit('room:settings', settings);
      io.to(`host:${room.id}`).emit('room:settings', settings);
      res.json({ ok: true, settings });
    } catch (err) {
      next(err);
    }
  });

  // Katılımcıyı toplantı yöneticisi yap: bu toplantıda hemen host kontrolleri alır.
  // scope 'room' → yalnız bu toplantı (yeniden bağlanınca da yönetici kalır);
  // scope 'all' → sonraki tüm toplantılara da host girer (yönetim paneli → Üyeler'den kaldırılır).
  router.post('/:id/promote', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      const { identity } = req.body || {};
      const scope = req.body?.scope === 'all' ? 'all' : 'room';
      if (!identity) return res.status(400).json({ error: 'identity zorunlu' });

      const participant = await roomService.getParticipant(room.id, identity).catch(() => null);
      if (!participant) return res.status(404).json({ error: 'Katılımcı toplantıda değil' });
      let meta = {};
      try { meta = JSON.parse(participant.metadata || '{}'); } catch { /* yoksay */ }
      if (!meta.memberId) return res.status(400).json({ error: 'Bu katılımcı üye değil' });

      const [r] = scope === 'all'
        ? await pool.query(
          "UPDATE members SET is_host = 1, status = 'approved' WHERE id = ? AND registered_at IS NOT NULL",
          [meta.memberId]
        )
        : await pool.query(
          `INSERT IGNORE INTO room_hosts (room_id, member_id)
           SELECT ?, id FROM members WHERE id = ? AND registered_at IS NOT NULL`,
          [room.id, meta.memberId]
        );
      if (!r.affectedRows && scope === 'all') return res.status(404).json({ error: 'Üye bulunamadı' });

      // Canlı oturumda: tüm kaynakları yayınlayabilsin, katılımcı listesinde host görünsün
      await roomService.updateParticipant(room.id, identity, {
        metadata: JSON.stringify({ ...meta, isHost: true }),
        permission: { canSubscribe: true, canPublish: true, canPublishData: true },
      }).catch(() => {});
      // İstemci host kontrollerini açabilsin diye host anahtarı yalnız ona gönderilir
      const data = new TextEncoder().encode(JSON.stringify({ hostToken: room.host_token }));
      await roomService.sendData(room.id, data, DataPacket_Kind.RELIABLE, {
        topic: 'promote', destinationIdentities: [identity],
      }).catch(() => {});
      await sendNotice(room.id, scope === 'all'
        ? 'Host sizi tüm toplantıların yöneticisi yaptı'
        : 'Host sizi bu toplantının yöneticisi yaptı', [identity]);
      res.json({ ok: true, scope });
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

  // Dersi herkes için bitir: yeni girişler kapanır, LiveKit odası silinir (herkes çıkarılır)
  router.post('/:id/end', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      await pool.query('UPDATE rooms SET room_locked = 1, ended_at = NOW() WHERE id = ?', [room.id]);
      io.to(room.id).emit('room:settings', { locked: true });
      await roomService.deleteRoom(room.id).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// İstek gövdesindeki ayar adı → rooms kolonu
const SETTING_COLUMNS = {
  hostOnlyVideo: 'host_only_video',
  allowScreenShare: 'allow_screen_share',
  allowMic: 'allow_mic',
  allowCamera: 'allow_camera',
  allowReactions: 'allow_reactions',
  chatLocked: 'chat_locked',
  lobbyEnabled: 'lobby_enabled',
  locked: 'room_locked',
};
// Değişince bağlı katılımcıların LiveKit izinleri yeniden uygulanır
const PERMISSION_COLUMNS = ['host_only_video', 'allow_screen_share', 'allow_mic', 'allow_camera'];

// İstemciye (herkese) açık ders ayarları
function publicSettings(room) {
  return {
    name: room.name,
    hostOnlyVideo: !!room.host_only_video,
    allowScreenShare: !!room.allow_screen_share,
    allowMic: !!room.allow_mic,
    allowCamera: !!room.allow_camera,
    allowReactions: !!room.allow_reactions,
    chatLocked: !!room.chat_locked,
    lobbyEnabled: !!room.lobby_enabled,
    locked: !!room.room_locked,
  };
}
