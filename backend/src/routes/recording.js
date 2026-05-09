import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EncodedFileType, EncodedFileOutput, EgressStatus } from 'livekit-server-sdk';
import { pool } from '../db/pool.js';
import { egressClient } from '../lib/livekit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS_DIR = path.resolve(__dirname, '../../recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// === Server-side egress için optimize encoding (production) ===
//   720p · 24 fps · H.264 · 800 kbps video · AAC mono · 64 kbps audio
const ENCODING_OPTIONS = {
  width: 1280,
  height: 720,
  framerate: 24,
  videoCodec: 1, // H264_MAIN
  videoBitrate: 800,
  keyFrameInterval: 4,
  audioCodec: 1, // AAC
  audioBitrate: 64,
  audioFrequency: 48000,
};

// === Browser-side upload için multer ===
const ALLOWED_MIME = new Set([
  'video/webm', 'video/mp4', 'application/octet-stream',
]);
const ALLOWED_EXT = /\.(webm|mp4|mkv)$/i;

const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(RECORDINGS_DIR, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.webm';
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.test(file.originalname || '');
    if (!ok) {
      const err = new Error(`Desteklenmeyen tür: ${file.mimetype}`);
      err.status = 415;
      return cb(err);
    }
    cb(null, true);
  },
});

function safeEgressError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    return 'Egress sunucusu çalışmıyor';
  }
  return msg;
}

export function buildRecordingRouter(io) {
  const router = Router({ mergeParams: true });

  async function requireHost(req, res) {
    const hostToken = req.body?.hostToken || req.headers['x-host-token'];
    const [rows] = await pool.query(
      'SELECT id, host_token FROM rooms WHERE id = ?',
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

  router.get('/active', async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, status, started_at FROM recordings
         WHERE room_id = ? AND status IN ('starting','active')
         ORDER BY started_at DESC LIMIT 1`,
        [req.params.id]
      );
      res.json(rows[0] || null);
    } catch (err) { next(err); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, status, filename, size_bytes, duration_sec, started_at, ended_at
         FROM recordings WHERE room_id = ? AND status = 'completed'
         ORDER BY started_at DESC LIMIT 50`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  // === Browser-side recording: announce start (sadece broadcast + state)
  router.post('/announce-start', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;
      io.to(room.id).emit('recording:started', { startedAt: new Date().toISOString() });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // === Browser-side recording: upload (host MediaRecorder Blob'unu yükler)
  router.post('/upload', recordingUpload.single('file'), async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return;
      }
      if (!req.file) return res.status(400).json({ error: 'Dosya gerekli' });

      const id = nanoid(12);
      const startedAt = req.body?.startedAt ? new Date(req.body.startedAt) : new Date();
      const duration = req.body?.durationSec ? Math.max(0, Math.floor(Number(req.body.durationSec))) : null;

      await pool.query(
        `INSERT INTO recordings
           (id, room_id, status, filename, filepath, size_bytes, duration_sec, started_at, ended_at)
         VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, NOW())`,
        [id, room.id, req.file.filename, req.file.path, req.file.size, duration, startedAt]
      );

      io.to(room.id).emit('recording:stopped', { id });
      io.to(room.id).emit('recording:ready', {
        id,
        url: `/api/rooms/${room.id}/recordings/${id}/download`,
      });

      res.json({
        ok: true,
        id,
        url: `/api/rooms/${room.id}/recordings/${id}/download`,
        size: req.file.size,
      });
    } catch (err) {
      next(err);
    }
  });

  // === Server-side egress: start (production yolu) ===
  router.post('/start', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;

      const [active] = await pool.query(
        `SELECT id FROM recordings WHERE room_id = ? AND status IN ('starting','active') LIMIT 1`,
        [room.id]
      );
      if (active[0]) {
        return res.status(409).json({ error: 'Bu odada zaten aktif bir kayıt var' });
      }

      const id = nanoid(12);
      const ts = Date.now();
      const filename = `${ts}-${id}.mp4`;
      const filepath = path.join(RECORDINGS_DIR, room.id, filename);
      fs.mkdirSync(path.dirname(filepath), { recursive: true });

      await pool.query(
        `INSERT INTO recordings (id, room_id, status, filename, filepath)
         VALUES (?, ?, 'starting', ?, ?)`,
        [id, room.id, filename, filepath]
      );

      try {
        const fileOutput = new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath });
        const egressInfo = await egressClient.startRoomCompositeEgress(
          room.id,
          { file: fileOutput },
          { layout: 'speaker', encodingOptions: ENCODING_OPTIONS }
        );

        await pool.query(
          `UPDATE recordings SET egress_id = ?, status = 'starting' WHERE id = ?`,
          [egressInfo.egressId, id]
        );

        const ACTIVE = new Set([EgressStatus.EGRESS_ACTIVE, 1, 'EGRESS_ACTIVE']);
        const FAIL = new Set([
          EgressStatus.EGRESS_FAILED, 4, 'EGRESS_FAILED',
          EgressStatus.EGRESS_ABORTED, 5, 'EGRESS_ABORTED',
        ]);
        let confirmed = false;
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 500));
          try {
            const list = await egressClient.listEgress({ egressId: egressInfo.egressId });
            const cur = list?.[0];
            if (cur && ACTIVE.has(cur.status)) { confirmed = true; break; }
            if (cur && FAIL.has(cur.status)) break;
          } catch { /* dene */ }
        }
        if (!confirmed) {
          try { await egressClient.stopEgress(egressInfo.egressId); } catch {}
          await pool.query(`DELETE FROM recordings WHERE id = ?`, [id]);
          return res.status(503).json({ error: 'Egress worker yanıt vermiyor' });
        }

        await pool.query(`UPDATE recordings SET status = 'active' WHERE id = ?`, [id]);
        io.to(room.id).emit('recording:started', { id, startedAt: new Date().toISOString() });
        res.json({ ok: true, id, egressId: egressInfo.egressId });
      } catch (err) {
        await pool.query(`DELETE FROM recordings WHERE id = ?`, [id]);
        return res.status(503).json({ error: safeEgressError(err) });
      }
    } catch (err) { next(err); }
  });

  // === Server-side egress: stop ===
  router.post('/stop', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;

      const [rows] = await pool.query(
        `SELECT id, egress_id FROM recordings
         WHERE room_id = ? AND status IN ('starting','active')
         ORDER BY started_at DESC LIMIT 1`,
        [room.id]
      );
      const rec = rows[0];
      if (!rec) return res.status(404).json({ error: 'Aktif kayıt yok' });

      try { if (rec.egress_id) await egressClient.stopEgress(rec.egress_id); } catch {}
      await new Promise((r) => setTimeout(r, 1500));

      const [r] = await pool.query('SELECT filepath, started_at FROM recordings WHERE id = ?', [rec.id]);
      const filepath = r[0]?.filepath;
      const fileExists = filepath && fs.existsSync(filepath) && fs.statSync(filepath).size > 0;

      if (!fileExists) {
        await pool.query('DELETE FROM recordings WHERE id = ?', [rec.id]);
        io.to(room.id).emit('recording:stopped', { id: rec.id, deleted: true });
        return res.json({ ok: true, id: rec.id, deleted: true, reason: 'Egress dosya üretmedi' });
      }

      const stat = fs.statSync(filepath);
      const startedAt = new Date(r[0].started_at).getTime();
      const dur = Math.round((Date.now() - startedAt) / 1000);
      await pool.query(
        `UPDATE recordings SET status = 'completed', ended_at = NOW(),
                size_bytes = ?, duration_sec = ? WHERE id = ?`,
        [stat.size, dur, rec.id]
      );
      io.to(room.id).emit('recording:stopped', { id: rec.id });
      res.json({ ok: true, id: rec.id });
    } catch (err) { next(err); }
  });

  router.get('/:recordingId/download', async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        'SELECT filepath, filename FROM recordings WHERE id = ? AND room_id = ?',
        [req.params.recordingId, req.params.id]
      );
      const rec = rows[0];
      if (!rec || !rec.filepath || !fs.existsSync(rec.filepath)) {
        return res.status(404).json({ error: 'Kayıt dosyası bulunamadı' });
      }
      res.download(rec.filepath, rec.filename);
    } catch (err) { next(err); }
  });

  // Multer error handler
  router.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Dosya çok büyük' });
    }
    if (err?.status) return res.status(err.status).json({ error: err.message });
    if (err) return res.status(400).json({ error: err.message || 'Yükleme hatası' });
  });

  return router;
}

export async function handleEgressWebhook(event, io) {
  try {
    const info = event.egressInfo;
    if (!info?.egressId) return;
    const status = event.event === 'egress_ended'
      ? (info.status === 'EGRESS_COMPLETE' ? 'completed' : 'failed')
      : 'active';

    if (event.event === 'egress_ended') {
      const fileResult = info.fileResults?.[0] || info.file;
      const size = fileResult?.size ? Number(fileResult.size) : null;
      const duration = info.startedAt && info.endedAt
        ? Math.round((Number(info.endedAt) - Number(info.startedAt)) / 1e9)
        : null;
      await pool.query(
        `UPDATE recordings
         SET status = ?, size_bytes = COALESCE(?, size_bytes),
             duration_sec = COALESCE(?, duration_sec),
             ended_at = NOW()
         WHERE egress_id = ?`,
        [status, size, duration, info.egressId]
      );
      if (status === 'completed' && io) {
        const [rows] = await pool.query('SELECT id, room_id FROM recordings WHERE egress_id = ?', [info.egressId]);
        const rec = rows[0];
        if (rec) {
          io.to(rec.room_id).emit('recording:ready', {
            id: rec.id, url: `/api/rooms/${rec.room_id}/recordings/${rec.id}/download`,
          });
        }
      }
    } else {
      await pool.query(`UPDATE recordings SET status = ? WHERE egress_id = ?`, [status, info.egressId]);
    }
  } catch { /* yoksay */ }
}
