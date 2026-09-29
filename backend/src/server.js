import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { buildRoomsRouter } from './routes/rooms.js';
import { tokensRouter } from './routes/tokens.js';
import { buildShareRouter, UPLOADS_DIR } from './routes/share.js';
import { buildRecordingRouter } from './routes/recording.js';
import { buildMemberRouter } from './routes/member.js';
import { buildBrandingRouter } from './routes/branding.js';
import { buildAdminRouter } from './routes/admin.js';
import { attachSocketHandlers } from './socket/index.js';
import { startRetentionJob } from './lib/retention.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
// nosniff: yüklenen dosya uzantısındaki türden başka bir şey (ör. HTML) olarak yorumlanmasın
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '1h',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: config.corsOrigin, credentials: true },
  maxHttpBufferSize: 1e7,
});
app.use('/api/admin', buildAdminRouter());
app.use('/api/member', buildMemberRouter());
app.use('/api/branding', buildBrandingRouter());
app.use('/api/rooms', buildRoomsRouter(io));
app.use('/api/tokens', tokensRouter);
app.use('/api/rooms/:id/share', buildShareRouter(io));
app.use('/api/rooms/:id/recordings', buildRecordingRouter(io));

// Not: kayıt durumu Egress'ten düzenli sorgulanır (routes/recording.js syncRecordings);
// doğrulamasız webhook ucu bilinçli olarak yok.
attachSocketHandlers(io);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Sunucu hatası' });
});

server.listen(config.port, () => {
  console.log(`Online Derslik backend ${config.port} portunda dinliyor`);
  startRetentionJob();
});
