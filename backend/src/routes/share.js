import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { pool } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/uploads — proje köküne yakın, gitignore'da
export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|pdf)$/i;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 8);
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.test(file.originalname || '');
    if (!ok) {
      const err = new Error(`Desteklenmeyen tür: ${file.mimetype || 'bilinmiyor'}`);
      err.status = 415;
      return cb(err);
    }
    cb(null, true);
  },
});

// Aktif paylaşımlar (in-memory): roomId → { url, type, name, sharedAt, viewport, localPath }
const currentShare = new Map();

const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 };

export function getCurrentShare(roomId) {
  return currentShare.get(roomId) || null;
}

export function setCurrentShare(roomId, value) {
  if (value) currentShare.set(roomId, value);
  else currentShare.delete(roomId);
}

function clampViewport(v) {
  const zoom = Math.max(0.5, Math.min(5, Number(v?.zoom) || 1));
  const panX = Math.max(-5000, Math.min(5000, Number(v?.panX) || 0));
  const panY = Math.max(-5000, Math.min(5000, Number(v?.panY) || 0));
  return { zoom, panX, panY };
}

// Host viewport değiştirir; socket handler bu fonksiyonu çağırır.
export function attachShareSocket(io) {
  io.on('connection', (socket) => {
    socket.on('share:set-viewport', async ({ roomId, hostToken, viewport }, ack) => {
      try {
        if (!roomId || !hostToken) return ack?.({ ok: false });
        // Host doğrulaması: socket.data.hostRooms (host:auth ile) veya hostToken DB karşılaştırması
        const isHostBySocket = socket.data?.hostRooms?.has(roomId);
        let isHost = isHostBySocket;
        if (!isHost) {
          const { pool } = await import('../db/pool.js');
          const [rows] = await pool.query(
            'SELECT host_token FROM rooms WHERE id = ?',
            [roomId]
          );
          isHost = rows[0]?.host_token === hostToken;
        }
        if (!isHost) return ack?.({ ok: false, error: 'unauthorized' });

        const share = currentShare.get(roomId);
        if (!share) return ack?.({ ok: false, error: 'no_share' });

        const v = clampViewport(viewport);
        share.viewport = v;
        currentShare.set(roomId, share);

        io.to(roomId).emit('share:viewport', v);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });
  });
}

export { DEFAULT_VIEWPORT };

export function buildShareRouter(io) {
  const router = Router({ mergeParams: true });

  // POST /api/rooms/:id/share — multipart, file alanı 'file', body'de hostToken
  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      const { hostToken } = req.body || {};
      const [rows] = await pool.query(
        'SELECT id, host_token FROM rooms WHERE id = ?',
        [req.params.id]
      );
      const room = rows[0];
      if (!room) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Oda bulunamadı' });
      }
      if (hostToken !== room.host_token) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'Yetkisiz' });
      }
      if (!req.file) return res.status(400).json({ error: 'Dosya gerekli' });

      // Önceki paylaşımı sil (tek seferde tek paylaşım)
      const prev = currentShare.get(room.id);
      if (prev?.localPath) fs.unlink(prev.localPath, () => {});

      const url = `/uploads/${room.id}/${req.file.filename}`;
      const share = {
        url,
        type: req.file.mimetype,
        name: req.file.originalname.slice(0, 200),
        size: req.file.size,
        sharedAt: new Date().toISOString(),
        localPath: req.file.path,
        viewport: { ...DEFAULT_VIEWPORT },
      };
      currentShare.set(room.id, share);

      io.to(room.id).emit('share:show', {
        url: share.url,
        type: share.type,
        name: share.name,
        sharedAt: share.sharedAt,
        viewport: share.viewport,
      });

      res.json({ ok: true, url, type: share.type, name: share.name });
    } catch (err) {
      next(err);
    }
  });

  // Multer hatalarını proper HTTP status'a çevir
  router.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Dosya çok büyük (maks. 25 MB)' });
    }
    if (err?.status) return res.status(err.status).json({ error: err.message });
    if (err) return res.status(400).json({ error: err.message || 'Yükleme hatası' });
  });

  // POST /api/rooms/:id/share/clear — paylaşımı kaldır
  router.post('/clear', async (req, res, next) => {
    try {
      const { hostToken } = req.body || {};
      const [rows] = await pool.query(
        'SELECT id, host_token FROM rooms WHERE id = ?',
        [req.params.id]
      );
      const room = rows[0];
      if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
      if (hostToken !== room.host_token) {
        return res.status(403).json({ error: 'Yetkisiz' });
      }
      const prev = currentShare.get(room.id);
      if (prev?.localPath) fs.unlink(prev.localPath, () => {});
      currentShare.delete(room.id);
      io.to(room.id).emit('share:hide');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
