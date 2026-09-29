import { Router } from 'express';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EncodedFileType, EncodedFileOutput, EgressStatus, EncodingOptions, VideoCodec, AudioCodec,
} from 'livekit-server-sdk';
import { pool } from '../db/pool.js';
import { egressClient } from '../lib/livekit.js';
import { requireAdmin } from '../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS_DIR = path.resolve(__dirname, '../../recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// Sunucu tarafı kayıt (LiveKit Egress, "konuşan kişi" düzeni) — yer kaplamasın diye sıkıştırılmış:
// 720p · 15 fps · H.264 Main 600 kbps · AAC 48 kbps → yaklaşık 290 MB / saat.
// Ders/toplantı içeriği (yüzler, slaytlar) için 15 fps yeterli; ekran yazıları 720p'de okunur kalır.
const ENCODING = new EncodingOptions({
  width: 1280,
  height: 720,
  framerate: 15,
  videoCodec: VideoCodec.H264_MAIN,
  videoBitrate: 600,
  keyFrameInterval: 4,
  audioCodec: AudioCodec.AAC,
  audioBitrate: 48,
  audioFrequency: 44100,
});

const ENDED = new Set([
  EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED,
  EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED,
]);

function egressError(err) {
  const msg = err?.message || String(err);
  if (/ECONNREFUSED|fetch failed|no response|not connected|egress not connected/i.test(msg)) {
    return 'Kayıt servisi şu an çalışmıyor';
  }
  if (/room does not exist/i.test(msg)) return 'Toplantıda henüz kimse yok; kayıt, toplantı başladıktan sonra alınabilir';
  return msg;
}

// Devam eden kayıtların Egress durumunu kontrol eder; bitenleri dosya boyutu/süresiyle tamamlar.
// Hem durdurma sonrası hem de düzenli aralıkla çağrılır (toplantı kapanınca Egress kendiliğinden biter).
export async function syncRecordings(io) {
  const [rows] = await pool.query(
    `SELECT id, room_id, egress_id, filepath, started_at FROM recordings
     WHERE status IN ('starting','active','processing') AND egress_id IS NOT NULL`
  );
  for (const rec of rows) {
    let info;
    try {
      [info] = await egressClient.listEgress({ egressId: rec.egress_id });
    } catch { continue; }
    if (!info || !ENDED.has(info.status)) continue;

    const file = info.fileResults?.[0];
    const exists = rec.filepath && fs.existsSync(rec.filepath);
    const size = exists ? fs.statSync(rec.filepath).size : Number(file?.size || 0);
    const ok = info.status !== EgressStatus.EGRESS_FAILED && size > 0;
    const duration = file?.duration
      ? Math.round(Number(file.duration) / 1e9)
      : Math.round((Date.now() - new Date(rec.started_at).getTime()) / 1000);

    await pool.query(
      `UPDATE recordings SET status = ?, size_bytes = ?, duration_sec = ?, ended_at = COALESCE(ended_at, NOW())
       WHERE id = ?`,
      [ok ? 'completed' : 'failed', size || null, duration, rec.id]
    );
    if (!ok && exists) fs.unlink(rec.filepath, () => {});
    if (io && rec.room_id) io.to(rec.room_id).emit('recording:stopped', { id: rec.id });
  }
}

// /api/rooms/:id/recordings
export function buildRecordingRouter(io) {
  const router = Router({ mergeParams: true });

  // Egress'in kendiliğinden bittiği kayıtları (toplantı kapandı vb.) yakala
  setInterval(() => syncRecordings(io).catch(() => {}), 30_000).unref();

  async function requireHost(req, res) {
    const hostToken = req.body?.hostToken || req.headers['x-host-token'];
    const [rows] = await pool.query('SELECT id, name, host_token FROM rooms WHERE id = ?', [req.params.id]);
    const room = rows[0];
    if (!room) {
      res.status(404).json({ error: 'Toplantı bulunamadı' });
      return null;
    }
    if (!hostToken || hostToken !== room.host_token) {
      res.status(403).json({ error: 'Yetkisiz' });
      return null;
    }
    return room;
  }

  // Kayıt sürüyor mu (toplantıdaki "Kayıt" rozeti için; herkese açık, dosya bilgisi içermez)
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

  // Toplantının kayıtları — yalnız yönetici (dosyalar yönetim paneli üzerinden indirilir)
  router.get('/', requireAdmin, async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, status, size_bytes, duration_sec, started_at, ended_at
         FROM recordings WHERE room_id = ? AND status IN ('processing','completed')
         ORDER BY started_at DESC LIMIT 50`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.post('/start', async (req, res, next) => {
    try {
      const room = await requireHost(req, res);
      if (!room) return;

      const [active] = await pool.query(
        `SELECT id FROM recordings WHERE room_id = ? AND status IN ('starting','active') LIMIT 1`,
        [room.id]
      );
      if (active[0]) return res.status(409).json({ error: 'Bu toplantıda zaten kayıt sürüyor' });

      const id = nanoid(12);
      // Egress konteyneri ayrı bir kullanıcıyla çalışır; backend'in açtığı alt klasörlere yazamaz.
      // Bu yüzden dosyalar doğrudan (herkese yazılabilir, sticky) kayıt klasörüne yazılır.
      const filename = `${room.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${id}.mp4`;
      const filepath = path.join(RECORDINGS_DIR, filename);

      await pool.query(
        `INSERT INTO recordings (id, room_id, room_name, status, filename, filepath)
         VALUES (?, ?, ?, 'starting', ?, ?)`,
        [id, room.id, room.name, filename, filepath]
      );

      try {
        const egressInfo = await egressClient.startRoomCompositeEgress(
          room.id,
          new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath, disableManifest: true }),
          { layout: 'speaker', encodingOptions: ENCODING }
        );
        await pool.query('UPDATE recordings SET egress_id = ? WHERE id = ?', [egressInfo.egressId, id]);

        // Egress'in gerçekten başladığını doğrula (en fazla ~10 sn)
        let started = false;
        for (let i = 0; i < 20 && !started; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const [cur] = await egressClient.listEgress({ egressId: egressInfo.egressId }).catch(() => []);
          if (cur?.status === EgressStatus.EGRESS_ACTIVE) started = true;
          else if (cur && ENDED.has(cur.status)) break;
        }
        if (!started) {
          await egressClient.stopEgress(egressInfo.egressId).catch(() => {});
          await pool.query('DELETE FROM recordings WHERE id = ?', [id]);
          return res.status(503).json({ error: 'Kayıt başlatılamadı; kayıt servisi yanıt vermiyor' });
        }

        await pool.query(`UPDATE recordings SET status = 'active', started_at = NOW() WHERE id = ?`, [id]);
        io.to(room.id).emit('recording:started', { id, startedAt: new Date().toISOString() });
        res.json({ ok: true, id });
      } catch (err) {
        await pool.query('DELETE FROM recordings WHERE id = ?', [id]);
        return res.status(503).json({ error: egressError(err) });
      }
    } catch (err) { next(err); }
  });

  // Durdur: Egress dosyayı kapatır; tamamlanma syncRecordings ile yakalanır (birkaç saniye sürer)
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
      if (!rec) return res.status(404).json({ error: 'Süren kayıt yok' });

      if (rec.egress_id) await egressClient.stopEgress(rec.egress_id).catch(() => {});
      await pool.query(`UPDATE recordings SET status = 'processing', ended_at = NOW() WHERE id = ?`, [rec.id]);
      io.to(room.id).emit('recording:stopped', { id: rec.id });
      for (const ms of [3000, 10_000, 30_000]) setTimeout(() => syncRecordings(io).catch(() => {}), ms);
      res.json({ ok: true, id: rec.id });
    } catch (err) { next(err); }
  });

  return router;
}
