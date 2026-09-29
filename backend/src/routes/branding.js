import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { pool } from '../db/pool.js';
import { requireAdmin } from '../lib/auth.js';
import { UPLOADS_DIR } from './share.js';
import { isSmsEnabled, getSiteName, isApprovalRequired, getSetting } from '../lib/siteSettings.js';

const BRANDING_DIR = path.join(UPLOADS_DIR, 'branding');
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Tür, istemcinin bildirdiği MIME'a değil dosyanın ilk baytlarına göre belirlenir.
// SVG kabul edilmez: aynı origin'den sunulan SVG içinde script çalışabilir.
function detectImageType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LOGO_BYTES, files: 1 } });

const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function getLogoPath() {
  const [[row]] = await pool.query("SELECT value FROM site_settings WHERE name = 'logo_path'");
  return row?.value || null;
}

// Önceki logo dosyasını siler (yalnız branding klasörü içindeyse)
async function removeLogoFile(logoPath) {
  if (!logoPath?.startsWith('/uploads/branding/')) return;
  await fs.unlink(path.join(BRANDING_DIR, path.basename(logoPath))).catch(() => {});
}

// Site görünümü: /api/branding
export function buildBrandingRouter() {
  const router = Router();

  // Herkese açık site ayarları: logo (yoksa null → varsayılan logo) ve SMS doğrulaması açık mı
  router.get('/', route(async (_req, res) => {
    res.json({
      logoUrl: await getLogoPath(),
      smsEnabled: await isSmsEnabled(),
      approvalRequired: await isApprovalRequired(),
      siteName: await getSiteName(),
      // Görünüm: ana renk (null → varsayılan tema) ve ana sayfa alt yazısı (null → varsayılan)
      brandColor: (await getSetting('brand_color')) || null,
      tagline: (await getSetting('site_tagline')) || null,
    });
  }));

  // PWA manifest ("Ana ekrana ekle" adı site adından). index.html bu adrese bağlanır.
  router.get('/manifest.webmanifest', route(async (_req, res) => {
    const name = await getSiteName();
    const color = (await getSetting('brand_color')) || '#09090b';
    res.type('application/manifest+json').json({
      name,
      short_name: name.length > 14 ? name.split(' ')[0].slice(0, 14) : name,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#ffffff',
      theme_color: color,
      lang: 'tr',
      dir: 'ltr',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
      ],
    });
  }));

  router.post('/logo', requireAdmin, (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Logo en fazla 2 MB olabilir' });
      if (err) return next(err);
      saveLogo(req, res).catch(next);
    });
  });

  router.delete('/logo', requireAdmin, route(async (_req, res) => {
    const previous = await getLogoPath();
    await pool.query("DELETE FROM site_settings WHERE name = 'logo_path'");
    await removeLogoFile(previous);
    res.json({ logoUrl: null });
  }));

  return router;
}

async function saveLogo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Logo dosyası seçin' });
  const type = detectImageType(req.file.buffer);
  if (!type) return res.status(400).json({ error: 'Logo PNG, JPG ya da WEBP olmalı' });

  await fs.mkdir(BRANDING_DIR, { recursive: true });
  // Her yüklemede yeni ad: tarayıcı önbelleği eski logoyu göstermez
  const filename = `logo-${nanoid(10)}.${type}`;
  await fs.writeFile(path.join(BRANDING_DIR, filename), req.file.buffer);

  const logoUrl = `/uploads/branding/${filename}`;
  const previous = await getLogoPath();
  await pool.query(
    `INSERT INTO site_settings (name, value) VALUES ('logo_path', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [logoUrl]
  );
  await removeLogoFile(previous);
  res.json({ logoUrl });
}
