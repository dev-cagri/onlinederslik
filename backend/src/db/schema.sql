-- Yöneticiler: yalnızca bunlar oda açabilir (backend/scripts/create-admin.js ile eklenir)
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Yönetici oturumları; çerezdeki token'ın yalnızca SHA-256 özeti saklanır
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin (admin_id),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  host_token VARCHAR(64) NOT NULL,
  password VARCHAR(120) NULL,
  lobby_enabled TINYINT(1) NOT NULL DEFAULT 0,
  host_only_video TINYINT(1) NOT NULL DEFAULT 0,
  allow_screen_share TINYINT(1) NOT NULL DEFAULT 0,
  allow_mic TINYINT(1) NOT NULL DEFAULT 1,
  allow_camera TINYINT(1) NOT NULL DEFAULT 1,
  allow_reactions TINYINT(1) NOT NULL DEFAULT 1,
  chat_locked TINYINT(1) NOT NULL DEFAULT 0,
  -- 1 → host dışında yeni katılım yok (dersi bitirince de 1 olur)
  room_locked TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Link ömrü: geçince katılımcılar giremez; NULL → süresiz
  expires_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  INDEX idx_created (created_at),
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(40) NOT NULL,
  sender_name VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_room_time (room_id, created_at),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sunucu tarafı kayıtlar (LiveKit Egress). Toplantı silinse de kayıt kalır (room_id NULL olur).
CREATE TABLE IF NOT EXISTS recordings (
  id VARCHAR(40) PRIMARY KEY,
  room_id VARCHAR(40) NULL,
  room_name VARCHAR(255) NULL,
  egress_id VARCHAR(80) NULL,
  status ENUM('starting','active','processing','completed','failed','aborted') NOT NULL,
  filename VARCHAR(255) NULL,
  filepath VARCHAR(500) NULL,
  size_bytes BIGINT NULL,
  duration_sec INT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  INDEX idx_room (room_id),
  INDEX idx_egress (egress_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Giriş kodları: yöneticinin verdiği kodla katılımcı SMS ve yönetici onayı olmadan üye olur.
-- max_uses / expires_at NULL → sınırsız.
CREATE TABLE IF NOT EXISTS access_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  label VARCHAR(120) NULL,
  max_uses INT NULL,
  uses INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Katılımcı üyeleri: telefon + SMS koduyla (ya da giriş koduyla) giriş yapar, ilk girişte ad/soyad girer.
-- Derse yalnız onaylı (status = 'approved') üyeler girebilir; giriş koduyla gelen üye doğrudan onaylıdır.
-- phone NULL → yalnız giriş koduyla üye olmuş (access_code_id dolu).
-- registered_at NULL → SMS doğrulandı ama ad/soyad henüz girilmedi (24 saatte temizlenir).
CREATE TABLE IF NOT EXISTS members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(16) NULL UNIQUE,
  access_code_id INT NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  -- 1 → toplantı yöneticisi: tüm toplantılara host yetkisiyle girer
  is_host TINYINT(1) NOT NULL DEFAULT 0,
  kvkk_version VARCHAR(20) NOT NULL,
  kvkk_accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_at TIMESTAMP NULL,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  last_ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  INDEX idx_status (status, registered_at),
  FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL,
  FOREIGN KEY (access_code_id) REFERENCES access_codes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Üye oturumları; çerezdeki token'ın yalnızca SHA-256 özeti saklanır
CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  member_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_member (member_id),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Numara başına tek aktif SMS giriş kodu (yalnızca özeti saklanır)
CREATE TABLE IF NOT EXISTS login_otps (
  phone VARCHAR(16) PRIMARY KEY,
  otp_hash CHAR(64) NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  attempts TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gönderilen her giriş SMS'i; numara/IP başına hız sınırı için.
CREATE TABLE IF NOT EXISTS otp_sends (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(16) NOT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone_time (phone, created_at),
  INDEX idx_ip_time (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Yoklama: hangi üye hangi derse ne zaman girdi
CREATE TABLE IF NOT EXISTS room_attendance (
  room_id VARCHAR(40) NOT NULL,
  member_id INT NOT NULL,
  first_joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  join_count INT NOT NULL DEFAULT 1,
  ip VARCHAR(45) NULL,
  PRIMARY KEY (room_id, member_id),
  INDEX idx_member (member_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Site ayarları (anahtar/değer): logo_path → yüklenen logonun /uploads altındaki yolu
CREATE TABLE IF NOT EXISTS site_settings (
  name VARCHAR(64) PRIMARY KEY,
  value TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Yalnız belirli bir toplantının yöneticisi yapılan üyeler (toplantı sırasında host atar)
CREATE TABLE IF NOT EXISTS room_hosts (
  room_id VARCHAR(40) NOT NULL,
  member_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, member_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
