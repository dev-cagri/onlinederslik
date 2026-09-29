import { pool } from '../db/pool.js';
import { getCurrentShare } from '../routes/share.js';

export function attachChat(socket, io) {
  let joinedRoom = null;
  let displayName = null;

  socket.on('room:join', async ({ roomId, name }) => {
    if (!roomId || !name) return;
    const [rows] = await pool.query('SELECT id FROM rooms WHERE id = ?', [roomId]);
    if (!rows[0]) {
      socket.emit('error:room', 'Oda bulunamadı');
      return;
    }
    joinedRoom = roomId;
    displayName = name.toString().slice(0, 60);
    socket.join(roomId);
    socket.to(roomId).emit('presence:join', { name: displayName });

    // Yeni katılana o an aktif paylaşım varsa hemen gönder
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
  });

  socket.on('chat:send', async ({ body, hostToken }) => {
    if (!joinedRoom || !displayName || !body) return;
    const text = body.toString().slice(0, 2000);

    // chat_locked aktifse yalnız host yazabilir.
    const [roomRows] = await pool.query(
      'SELECT chat_locked, host_token FROM rooms WHERE id = ?',
      [joinedRoom]
    );
    const room = roomRows[0];
    if (room?.chat_locked) {
      const isHost =
        socket.data?.hostRooms?.has(joinedRoom) ||
        (hostToken && hostToken === room.host_token);
      if (!isHost) {
        socket.emit('chat:rejected', { reason: 'Sohbet kilitli — yalnız host yazabilir' });
        return;
      }
    }

    const [result] = await pool.query(
      'INSERT INTO messages (room_id, sender_name, body) VALUES (?, ?, ?)',
      [joinedRoom, displayName, text]
    );
    const message = {
      id: result.insertId,
      sender_name: displayName,
      body: text,
      created_at: new Date().toISOString(),
    };
    io.to(joinedRoom).emit('chat:new', message);
  });

  // Emoji tepkiler: küçük, store edilmez, anlık broadcast.
  socket.on('reaction:send', async ({ emoji, hostToken }) => {
    if (!joinedRoom || !displayName) return;
    const safe = (emoji || '').toString().slice(0, 16);
    if (!safe) return;
    // Host tepkileri kapattıysa yalnız host gönderebilir
    const [[room]] = await pool.query('SELECT allow_reactions, host_token FROM rooms WHERE id = ?', [joinedRoom]);
    if (room && !room.allow_reactions && !(hostToken && hostToken === room.host_token)) return;
    io.to(joinedRoom).emit('reaction:new', {
      id: Math.random().toString(36).slice(2, 10),
      emoji: safe,
      senderName: displayName,
      at: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    if (joinedRoom && displayName) {
      socket.to(joinedRoom).emit('presence:leave', { name: displayName });
    }
  });
}
