import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { buildRoomsRouter } from './routes/rooms.js';
import { tokensRouter } from './routes/tokens.js';
import { buildShareRouter, UPLOADS_DIR } from './routes/share.js';
import { buildRecordingRouter, handleEgressWebhook } from './routes/recording.js';
import { buildVerificationRouter } from './routes/verification.js';
import { buildAdminRouter } from './routes/admin.js';
import { attachSocketHandlers } from './socket/index.js';
import { startRetentionJob } from './lib/retention.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: config.corsOrigin, credentials: true },
  maxHttpBufferSize: 1e7,
});
app.use('/api/admin', buildAdminRouter());
app.use('/api/rooms', buildRoomsRouter(io));
app.use('/api/tokens', tokensRouter);
app.use('/api/rooms/:id/share', buildShareRouter(io));
app.use('/api/rooms/:id/recordings', buildRecordingRouter(io));
app.use('/api/rooms/:id/verification', buildVerificationRouter());

// LiveKit Egress webhook — text/webhook+json olarak gelir; raw body kullan
app.post('/api/livekit/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body.toString('utf-8'));
    await handleEgressWebhook(payload, io);
  } catch { /* yoksay */ }
  res.json({ ok: true });
});
attachSocketHandlers(io);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Sunucu hatası' });
});

server.listen(config.port, () => {
  console.log(`Online Derslik backend ${config.port} portunda dinliyor`);
  startRetentionJob();
});
