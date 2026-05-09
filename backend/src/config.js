import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secretdevkeyforlocaluseonly1234567890',
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'zoomtr',
    password: process.env.DB_PASSWORD || 'zoomtrpass',
    database: process.env.DB_NAME || 'zoomtr',
  },
};
