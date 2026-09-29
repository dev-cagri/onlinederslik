import { nanoid } from 'nanoid';
import { pool } from '../db/pool.js';
import { issueToken } from '../lib/livekit.js';
import { getCurrentShare } from '../routes/share.js';
import { getSessionMember } from '../lib/auth.js';
import { memberJoinBlocker, memberDisplayName, recordAttendance } from '../lib/members.js';

// pending[roomId] = Map<requestId, { name, socketId, memberId, ip }>
const pending = new Map();
// hostsByRoom[roomId] = Set<socketId>
const hostsByRoom = new Map();

// Nginx aynı makinede (loopback) ise gerçek istemci IP'si X-Forwarded-For'dadır;
// HTTP tarafındaki trust proxy = 'loopback' ayarıyla aynı mantık.
function clientIp(socket) {
  const { address, headers } = socket.handshake;
  const isLoopback = /^(127\.|::1$|::ffff:127\.)/.test(address || '');
  const forwarded = String(headers['x-forwarded-for'] || '').split(',').pop().trim();
  return (isLoopback && forwarded) || address;
}

function pendingFor(roomId) {
  if (!pending.has(roomId)) pending.set(roomId, new Map());
  return pending.get(roomId);
}

function listPending(roomId) {
  return Array.from(pendingFor(roomId).entries()).map(([requestId, p]) => ({
    requestId,
    name: p.name,
  }));
}

async function loadRoom(roomId) {
  const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
  return rows[0] || null;
}

export function attachLobby(socket, io) {
  // socket.data.hostRooms = Set<roomId> (host olarak doğrulandığı odalar)
  socket.data.hostRooms ??= new Set();
  // socket.data.lobbyEntries = [{ roomId, requestId }]
  socket.data.lobbyEntries ??= [];

  // Host odaya doğrulanır → bekleyenler listesini alır.
  socket.on('host:auth', async ({ roomId, hostToken }, ack) => {
    try {
      const room = await loadRoom(roomId);
      if (!room || room.host_token !== hostToken) {
        return ack?.({ ok: false, error: 'unauthorized' });
      }
      socket.data.hostRooms.add(roomId);
      socket.join(`host:${roomId}`);
      // Host paylaşım/chat broadcast'lerini de alabilsin
      socket.join(roomId);
      const share = getCurrentShare(roomId);
      if (share) {
        socket.emit('share:show', {
          url: share.url,
          type: share.type,
          name: share.name,
          sharedAt: share.sharedAt,
          viewport: share.viewport,
        });
      }
      ack?.({ ok: true, pending: listPending(roomId) });
    } catch {
      ack?.({ ok: false, error: 'server' });
    }
  });

  // Katılımcı lobby'ye düşer.
  socket.on('lobby:request', async ({ roomId, password }, ack) => {
    try {
      const room = await loadRoom(roomId);
      if (!room) return ack?.({ ok: false, error: 'not_found' });
      if (!room.lobby_enabled) return ack?.({ ok: false, error: 'no_lobby' });
      if (room.room_locked) return ack?.({ ok: false, error: 'room_locked' });
      if (room.expires_at && new Date(room.expires_at) < new Date()) return ack?.({ ok: false, error: 'room_locked' });
      if (room.password && password !== room.password) {
        return ack?.({ ok: false, error: 'password' });
      }
      // Bekleme odasına da yalnız onaylı üye girer (oturum çerezi handshake'te gelir);
      // host'a görünen ad üyelikten gelir.
      const member = await getSessionMember(socket.handshake.headers.cookie);
      const blocker = memberJoinBlocker(member);
      if (blocker) return ack?.({ ok: false, error: blocker });
      const cleanName = memberDisplayName(member).slice(0, 60);

      const requestId = nanoid(12);
      pendingFor(roomId).set(requestId, {
        name: cleanName,
        socketId: socket.id,
        memberId: member.id,
        ip: clientIp(socket),
      });
      socket.data.lobbyEntries.push({ roomId, requestId });

      io.to(`host:${roomId}`).emit('lobby:pending', { requestId, name: cleanName });
      ack?.({ ok: true, requestId });
    } catch {
      ack?.({ ok: false, error: 'server' });
    }
  });

  // Host onaylar → katılımcıya token gönder.
  socket.on('lobby:approve', async ({ roomId, requestId }, ack) => {
    try {
      if (!socket.data.hostRooms.has(roomId)) {
        return ack?.({ ok: false, error: 'unauthorized' });
      }
      const map = pendingFor(roomId);
      const entry = map.get(requestId);
      if (!entry) return ack?.({ ok: false, error: 'not_found' });

      const room = await loadRoom(roomId);
      const { token, url } = await issueToken({ roomId, displayName: entry.name, isHost: false, room, memberId: entry.memberId });
      io.to(entry.socketId).emit('lobby:approved', { token, url, displayName: entry.name });
      await recordAttendance(roomId, entry.memberId, entry.ip);
      map.delete(requestId);
      io.to(`host:${roomId}`).emit('lobby:resolved', { requestId });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, error: 'server' });
    }
  });

  // Host reddeder.
  socket.on('lobby:reject', ({ roomId, requestId, reason }, ack) => {
    try {
      if (!socket.data.hostRooms.has(roomId)) {
        return ack?.({ ok: false, error: 'unauthorized' });
      }
      const map = pendingFor(roomId);
      const entry = map.get(requestId);
      if (!entry) return ack?.({ ok: false, error: 'not_found' });

      io.to(entry.socketId).emit('lobby:rejected', { reason: reason || 'reddedildi' });
      map.delete(requestId);
      io.to(`host:${roomId}`).emit('lobby:resolved', { requestId });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, error: 'server' });
    }
  });

  socket.on('disconnect', () => {
    // Host odalarından temizle (sadece socket.io'nun otomatik room ayrılması yetiyor)
    socket.data.hostRooms.clear();

    // Bu socket'in pending istekleri varsa kaldır + hostlara haber ver
    for (const { roomId, requestId } of socket.data.lobbyEntries) {
      const map = pendingFor(roomId);
      if (map.delete(requestId)) {
        io.to(`host:${roomId}`).emit('lobby:resolved', { requestId });
      }
    }
    socket.data.lobbyEntries = [];
  });
}
