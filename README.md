# Online Derslik

Eğitim odaklı, kendi sunucunuzda çalışan, açık kaynak video konferans uygulaması. Kayıt gerektirmez — adınızı girin, link oluşturun ve paylaşın.


---

## Özellikler

### Toplantı
- Sınırsız oda, sınırsız katılımcı (donanım sınırlarına kadar)
- HD video + ses + ekran paylaşımı (LiveKit WebRTC SFU)
- Adaptive simulcast — düşük internetli istemciler 180p, geniş bantlı 720p
- VP9 codec ile bandwidth ~%30-50 tasarruf
- Dynacast — kimsenin görmediği katmanlar yayınlanmaz
- DTX/RED ses optimizasyonu

### Katılım
- Linkle, kayıt gerektirmeden katılım
- Parola korumalı odalar
- Bekleme odası (host her katılımcıyı tek tek onaylar)
- Misafir mod, sadece ad-soyad

### Host Kontrolleri
- Tüm mikrofonları sustur / tüm kameraları kapat
- "Sadece host görünür" modu (yayın + görsel filtre)
- Tek tek katılımcının mikrofon/kamerasını aç-kapat
- Katılımcıyı odadan çıkarma
- Sohbeti kilitleme (sadece host yazar)
- Ekran paylaşımı izni yönetimi (LiveKit `canPublishSources` ile server-side enforce)
- Bekleyen onaylar paneli

### Sohbet & Etkileşim
- Real-time chat (Socket.IO, mesaj geçmişi DB'de)
- Emoji tepkiler — sağ-altta yukarı uçan animasyon (👍 ❤️ 👏 🎉 😂 😮 ❓ ✋)
- Katılımcı arama
- Mesaj geçmişi yenilemede de yüklenir

### Dosya Paylaşımı
- Görsel (jpeg, png, webp, gif) ve PDF yansıtma
- Senkronize **zoom + pan** — host kontrol eder, herkes aynı görünümü görür
- Pinch-to-zoom (touch) + drag-pan (mouse + touch) + mouse wheel zoom
- Yeni gelenler de o anki paylaşımı görür
- Aynı zamanda tek paylaşım, host değiştirebilir/durdurabilir

### Kayıt
- **Browser-side**: MediaRecorder + getDisplayMedia → WebM (VP9+Opus, ~6 MB/dakika)
  - Local'de Docker olmadan çalışır
  - Host'un sekmesi yakalanır
- **Server-side** (production): LiveKit Egress → MP4 (H.264 800kbps + AAC 64kbps mono, 720p/24fps, ~6 MB/dakika)
  - iPad host'lar için zorunlu (iOS Safari getDisplayMedia desteklemiyor)
  - Docker container'da headless Chrome
- Kayıt bitince otomatik indirme linki açılır
- Kayıt geçmişi listesi (Ayarlar tab'ında)
- Banner'da 🔴 KAYIT badge'i (nabız animasyonu)

### Tam Ekran & Görünüm
- Tek tıkla tam ekran modu (sadece video alanı)
- Mobile slide-up panel (chat/katılımcı/ayar) — sağ-altta floating button ile
- Dynamic viewport (`100dvh`) — iOS Safari adres çubuğu davranışına uyum

### PWA & Mobil
- iPad/iOS Safari **"Ana Ekrana Ekle"** desteği
- Standalone mode (browser chrome'suz)
- Safe area insets (notch / home indicator)
- Touch-optimized (minimum 44px touch hedefler, hover-only state yok)
- Apple-touch-icon 152/167/180 px, manifest icon 192/512 px

---

## Teknoloji Yığını

### Frontend
- **React 18** + **Vite** (ES modules, HMR)
- **@livekit/components-react** + **livekit-client** — WebRTC client + UI primitive'leri
- **socket.io-client** — chat, presence, reactions, share viewport
- **react-router-dom** — routing
- Vanilla CSS (CSS variables, modern flex/grid, no Tailwind/styled-components)

### Backend
- **Node.js 20+** ES modules
- **Express 4** — REST API
- **Socket.IO 4** — real-time
- **livekit-server-sdk** — `AccessToken`, `RoomServiceClient`, `EgressClient`
- **mysql2** — connection pool
- **multer** — multipart file uploads (paylaşım + browser kayıt)
- **nanoid** — short ID generation

### Infrastructure
- **LiveKit Server** (Go binary) — WebRTC SFU
- **Redis** — LiveKit signaling backend, gerekli
- **MariaDB / MySQL** — rooms, messages, recordings
- **Nginx** (production) — reverse proxy + static + WS upgrade
- **LiveKit Egress** (Docker, opsiyonel) — server-side recording


### Veri akışı örnekleri
- **Toplantıya katılım**: `POST /api/tokens` → JWT al → LiveKit'e WS bağlan → SFU üzerinden medya akışı
- **Chat**: socket `chat:send` → backend → DB insert → odaya broadcast
- **Dosya paylaşımı**: multipart upload → `/uploads/...` → socket `share:show` broadcast → herkes overlay görür
- **Zoom/pan sync**: host RAF ile `share:set-viewport` emit → backend doğrular → odaya `share:viewport` broadcast → herkes aynı transform uygular
- **Kayıt (browser)**: MediaRecorder → Blob → `/api/rooms/:id/recordings/upload` → WebM file
- **Kayıt (egress)**: `/api/rooms/:id/recordings/start` → LiveKit Egress polling → headless Chrome composite → MP4

---

## Hızlı Başlangıç (development, macOS)

### 1. Bağımlılıklar
```bash
brew install node@20 mysql redis livekit
brew services start mysql redis
```

### 2. Veritabanı
```bash
mysql -u root <<'SQL'
CREATE DATABASE zoomtr CHARACTER SET utf8mb4;
CREATE USER 'zoomtr'@'localhost' IDENTIFIED BY 'zoomtrpass';
GRANT ALL ON zoomtr.* TO 'zoomtr'@'localhost';
SQL

mysql -u zoomtr -pzoomtrpass zoomtr < backend/src/db/schema.sql
```

### 3. LiveKit
```bash
livekit-server --config livekit.yaml > /tmp/livekit.log 2>&1 &
```

### 4. Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev   # → http://localhost:4000
```

### 5. Frontend
```bash
cd ../frontend
npm install
npm run dev   # → http://localhost:5173
```

Tarayıcıda `http://localhost:5173` aç.

> **Server-side recording (Egress)** lokalde çalışmaz — Docker gerektirir. Browser-side recording (MediaRecorder) Chrome/Edge/Safari Mac'te direkt çalışır.

---

## Production Deployment (Linux, aaPanel veya benzeri)

### 1. Sistem gereksinimleri
- Node.js 20+
- MySQL/MariaDB 10.5+
- Redis 7+
- Nginx
- (Opsiyonel) Docker — sadece Egress kayıt için

### 2. Firewall + AWS Security Group portları

| Port | Protokol | Amaç |
|------|----------|------|
| 80, 443 | TCP | HTTP/HTTPS |
| 7880, 7881 | TCP | LiveKit (Nginx üzerinden proxy edilir, dış erişim opsiyonel) |
| **50000-50200** | **UDP** | **WebRTC media — açılmazsa video çalışmaz** |

### 3. LiveKit
`livekit.yaml`:
```yaml
keys:
  prodkey: <32+ karakter rastgele secret>
rtc:
  use_external_ip: true
  port_range_start: 50000
  port_range_end: 50200
redis:
  address: localhost:6379
room:
  auto_create: true
  max_participants: 1000
```

systemd unit ile çalıştır.

### 4. Backend
```bash
cd backend && npm install --production
pm2 start src/server.js --name online-derslik   # veya systemd
```

`.env`:
```env
PORT=4000
CORS_ORIGIN=https://egitim.alanadi.com
LIVEKIT_URL=wss://egitim.alanadi.com/livekit
LIVEKIT_API_KEY=prodkey
LIVEKIT_API_SECRET=<aynı 32+ karakter>
DB_HOST=127.0.0.1
DB_NAME=zoomtr
DB_USER=zoomtr
DB_PASSWORD=<güçlü>
```

### 5. Frontend build
```bash
cd frontend && npm run build
# dist/ → /www/wwwroot/<domain>/
```

### 6. Nginx
```nginx
location /api/ {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 60s;
}

location /socket.io/ {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 7d;
}

location /uploads/ {
  proxy_pass http://127.0.0.1:4000;
}

location /livekit {
  proxy_pass http://127.0.0.1:7880;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 7d;
}

location / {
  try_files $uri $uri/ /index.html;
}
```

### 7. SSL
Let's Encrypt ile sertifika al, HTTPS'e zorla. WebSocket için `wss://` zorunlu.

### 8. (Opsiyonel) Egress kayıt servisi
```bash
docker compose up -d egress
```

`livekit.yaml`'a webhook ekle:
```yaml
webhook:
  api_key: prodkey
  urls:
    - http://localhost:4000/api/livekit/webhook
```

---

## Konfigürasyon

| Env değişkeni | Default | Açıklama |
|---|---|---|
| `PORT` | 4000 | Backend HTTP/Socket.IO portu |
| `CORS_ORIGIN` | http://localhost:5173 | Frontend origin |
| `LIVEKIT_URL` | ws://localhost:7880 | LiveKit WS endpoint (frontend'e yansıtılır) |
| `LIVEKIT_API_KEY` | devkey | LiveKit API key |
| `LIVEKIT_API_SECRET` | (32+ char) | LiveKit API secret — production'da değiştir |
| `DB_HOST` | 127.0.0.1 | MySQL host |
| `DB_PORT` | 3306 | MySQL port |
| `DB_USER` | zoomtr | DB user |
| `DB_PASSWORD` | zoomtrpass | DB pass |
| `DB_NAME` | zoomtr | DB name |

---

## Proje Yapısı

```
online-derslik/
├── backend/
│   ├── src/
│   │   ├── server.js              Express + Socket.IO entry
│   │   ├── config.js              env değişkenleri
│   │   ├── lib/
│   │   │   └── livekit.js         RoomService, EgressClient, issueToken
│   │   ├── routes/
│   │   │   ├── rooms.js           Oda CRUD + host komutları
│   │   │   ├── tokens.js          JWT (parola/lobby validation)
│   │   │   ├── share.js           Dosya yükleme + viewport sync
│   │   │   └── recording.js       Browser + server-side kayıt
│   │   ├── socket/
│   │   │   ├── index.js           Socket handler aggregator
│   │   │   ├── chat.js            Mesaj + reaction + share initial
│   │   │   └── lobby.js           Bekleme odası + host:auth
│   │   └── db/
│   │       ├── pool.js            mysql2 pool
│   │       └── schema.sql
│   ├── recordings/                (gitignored) MP4/WebM dosyaları
│   ├── uploads/                   (gitignored) paylaşılan dosyalar
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── pages/
│   │   │   ├── Home.jsx           Giriş ekranı (oda oluştur / katıl)
│   │   │   └── Room.jsx           Oda + LiveKit bağlantı state machine
│   │   ├── components/
│   │   │   ├── MeetingStage.jsx   Video grid + meeting controls
│   │   │   ├── ChatPanel.jsx
│   │   │   ├── ParticipantList.jsx
│   │   │   ├── SettingsPanel.jsx  Host ayarları + kayıt + bekleyenler
│   │   │   ├── SharedContent.jsx  Paylaşım overlay + zoom/pan
│   │   │   ├── LobbyWaiting.jsx
│   │   │   ├── TopBar.jsx
│   │   │   └── icons.jsx
│   │   ├── lib/
│   │   │   ├── api.js             REST helpers
│   │   │   └── browserRecorder.js MediaRecorder wrapper
│   │   └── styles.css             Tüm stiller
│   ├── public/
│   │   ├── manifest.webmanifest   PWA
│   │   ├── icon-192.png, icon-512.png
│   │   ├── apple-touch-icon*.png  152/167/180
│   │   ├── cyikon.png             Ana logo
│   │   └── logo.webp              (legacy)
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── livekit.yaml                   LiveKit server config
├── egress.yaml                    LiveKit egress config (production)
├── docker-compose.yml             LiveKit + Redis + MariaDB + Egress
├── .env.example
└── README.md
```

---

## REST API

### Oda
| Method | Path | Açıklama |
|---|---|---|
| `POST` | `/api/rooms` | Yeni oda (parola, lobby seçenekleriyle) |
| `GET` | `/api/rooms/:id` | Oda meta (hasPassword, lobbyEnabled, hostOnlyVideo, allowScreenShare, chatLocked) |
| `GET` | `/api/rooms/:id/messages` | Son 200 chat mesajı |
| `POST` | `/api/tokens` | LiveKit JWT al |

### Host kontrolleri (hostToken zorunlu)
| Method | Path | |
|---|---|---|
| `POST` | `/api/rooms/:id/mute` | Tek katılımcının mic/cam mute/unmute |
| `POST` | `/api/rooms/:id/mute-all` | Tüm mikrofon veya kamera kapat |
| `POST` | `/api/rooms/:id/host-only-video` | "Sadece host görünür" toggle |
| `POST` | `/api/rooms/:id/allow-screen-share` | Ekran paylaşım izni toggle |
| `POST` | `/api/rooms/:id/lock-chat` | Sohbet kilidi toggle |
| `POST` | `/api/rooms/:id/kick` | Katılımcıyı çıkar |

### Dosya paylaşımı
| Method | Path | |
|---|---|---|
| `POST` | `/api/rooms/:id/share` | Dosya yükle (multipart, max 25 MB) |
| `POST` | `/api/rooms/:id/share/clear` | Paylaşımı durdur |
| `GET` | `/uploads/:id/:file` | Yüklenen dosyayı serve et |

### Kayıt
| Method | Path | |
|---|---|---|
| `POST` | `/api/rooms/:id/recordings/announce-start` | Browser kaydı başladı broadcast |
| `POST` | `/api/rooms/:id/recordings/upload` | Browser MediaRecorder Blob upload |
| `POST` | `/api/rooms/:id/recordings/start` | Server-side Egress başlat |
| `POST` | `/api/rooms/:id/recordings/stop` | Server-side Egress durdur |
| `GET` | `/api/rooms/:id/recordings` | Tamamlanmış kayıtlar |
| `GET` | `/api/rooms/:id/recordings/active` | Aktif kayıt |
| `GET` | `/api/rooms/:id/recordings/:rid/download` | Dosyayı indir |
| `POST` | `/api/livekit/webhook` | LiveKit Egress webhook hedefi |

---

## Socket.IO Events

### Client → Server
- `room:join { roomId, name }` — oda kanalına katıl
- `chat:send { body, hostToken? }` — mesaj gönder
- `reaction:send { emoji }` — emoji tepki
- `host:auth { roomId, hostToken }` — host olarak doğrula
- `lobby:request { roomId, name, password }` — bekleme odasına gir
- `lobby:approve / lobby:reject { roomId, requestId }` — host onayı (host:auth sonrası)
- `share:set-viewport { roomId, hostToken, viewport }` — zoom/pan sync (host)

### Server → Client
- `chat:new` — yeni mesaj broadcast
- `chat:rejected { reason }` — chat lock nedeniyle ret
- `presence:join / leave` — katılım/ayrılma
- `reaction:new` — emoji tepki broadcast
- `lobby:pending` — host'a yeni istek
- `lobby:approved { token, url }` — başvurana token
- `lobby:rejected { reason }` — başvuruya ret
- `lobby:resolved { requestId }` — host'lar arasında senkron
- `share:show / hide / viewport` — paylaşım yaşam döngüsü
- `room:settings { hostOnlyVideo, allowScreenShare, chatLocked }` — ayar değişti
- `recording:started / stopped / ready` — kayıt durumu

---

## Veritabanı Şeması

### `rooms`
| Kolon | Tip | Açıklama |
|---|---|---|
| id | VARCHAR(40) PK | Oda ID (nanoid) |
| name | VARCHAR(255) | Oda adı |
| host_token | VARCHAR(64) | Host yetki token'ı |
| password | VARCHAR(120) NULL | Oda parolası |
| lobby_enabled | TINYINT(1) | Bekleme odası açık mı |
| host_only_video | TINYINT(1) | Sadece host görünür modu |
| allow_screen_share | TINYINT(1) | Katılımcı ekran paylaşabilir mi |
| chat_locked | TINYINT(1) | Sohbet kilitli mi |
| created_at, ended_at | TIMESTAMP | |

### `messages`
Chat geçmişi (room_id, sender_name, body, created_at).

### `recordings`
Kayıt meta (egress_id, status, filepath, size_bytes, duration_sec, started_at, ended_at).

---

## Performans Optimizasyonları

- **Simulcast 3 katman** — `VideoPresets.h180`, `h360`, `h720`
- **Adaptive stream** — alıcı ekran/bant'a göre katman seçer
- **Dynacast** — yayıncı kullanılmayan katmanları durdurur
- **VP9 codec** — VP8'e göre %30-50 daha az bandwidth (encoder yoksa otomatik VP8 fallback)
- **DTX (Discontinuous Transmission)** — sessizlikte ses paketi yollanmaz
- **RED audio redundancy** — paket kaybına karşı dayanıklılık
- **Server-side enforce** — izinler LiveKit grant'larıyla (`canPublishSources`) — istemci bypass edemez
- **In-memory share state** — yeni gelenlere sunucu tarafından enjekte edilir, ek socket roundtrip yok
- **RAF throttling** — viewport sync `requestAnimationFrame` ile pacing'lenir, network'ü doldurmaz

### Ölçek tahmini (32GB RAM AWS)

| Senaryo | m5.2xlarge (8 vCPU) | c5.4xlarge (16 vCPU) |
|---|---|---|
| 1 hoca + sessiz dinleyici | 300-450 öğrenci | 600-800 öğrenci |
| Ara sıra soru | 200-300 öğrenci | 400-500 öğrenci |
| Aktif tartışma | 100-150 öğrenci | 200-300 öğrenci |
| Çoğunlukla kameralı | 50-100 öğrenci | 100-180 öğrenci |

CPU genelde ilk darboğaz. Network ikinci. RAM 32GB rahat yeter. 1000+ kullanıcı için multi-node cluster gerekir.

---

## Tarayıcı Uyumluluğu

| Tarayıcı | Video | Ekran paylaş | Kayıt (browser) | Kayıt (server) | PWA |
|---|---|---|---|---|---|
| Chrome / Edge (desktop) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Safari (macOS 14.3+) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Safari (iOS/iPadOS) | ✓ | ✗ (iOS limit) | ✗ | ✓ | ✓ |
| Firefox | ✓ | ✓ | ⚠ MIME farklı | ✓ | ✓ |

iPad host'lar için **server-side Egress** zorunlu (iOS getDisplayMedia desteklemez).

---

## Yol Haritası

- [ ] **TURN sunucusu (coturn)** — kurum/okul firewall'ları için. Production'da kritik
- [ ] El kaldırma (raise hand)
- [ ] Beyaz tahta / annotation (paylaşılan görsel üzerine çizim)
- [ ] Q&A modu (modere edilmiş soru-cevap)
- [ ] Multi-region cluster (LiveKit cluster + Redis pub/sub)
- [ ] LiveKit Cloud entegrasyonu (büyük ölçek alternatifi)
- [ ] Active speaker spotlight
- [ ] Breakout rooms

---

## Geliştirici

**Çağrı Yılmaz** — `mail@cagriyilmaz.com.tr`

---

## Lisans

MIT
