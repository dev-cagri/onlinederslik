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
  chat_locked TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS recordings (
  id VARCHAR(40) PRIMARY KEY,
  room_id VARCHAR(40) NOT NULL,
  egress_id VARCHAR(80) NULL,
  status ENUM('starting','active','completed','failed','aborted') NOT NULL,
  filename VARCHAR(255) NULL,
  filepath VARCHAR(500) NULL,
  size_bytes BIGINT NULL,
  duration_sec INT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  INDEX idx_room (room_id),
  INDEX idx_egress (egress_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Katılımcı doğrulaması: KVKK onayı → kimlik (ad, soyad, TC) → SMS OTP → konum.
-- Host dışındaki herkes odaya girmeden önce bu adımların hepsini tamamlamak zorunda.
-- id aynı zamanda istemcide tutulan gizli anahtardır (tahmin edilemez nanoid).
CREATE TABLE IF NOT EXISTS participant_verifications (
  id VARCHAR(40) PRIMARY KEY,
  room_id VARCHAR(40) NOT NULL,
  kvkk_version VARCHAR(20) NOT NULL,
  kvkk_accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  tc_no CHAR(11) NULL,
  tc_verified_at TIMESTAMP NULL,
  phone VARCHAR(16) NULL,
  otp_hash CHAR(64) NULL,
  otp_sent_at TIMESTAMP NULL,
  otp_expires_at TIMESTAMP NULL,
  otp_attempts TINYINT NOT NULL DEFAULT 0,
  phone_verified_at TIMESTAMP NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  location_accuracy_m FLOAT NULL,
  location_at TIMESTAMP NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_joined_at TIMESTAMP NULL,
  INDEX idx_room (room_id),
  INDEX idx_tc (tc_no),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gönderilen her OTP SMS'i; numara/IP başına hız sınırı için.
CREATE TABLE IF NOT EXISTS otp_sends (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  verification_id VARCHAR(40) NOT NULL,
  phone VARCHAR(16) NOT NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone_time (phone, created_at),
  INDEX idx_ip_time (ip, created_at),
  FOREIGN KEY (verification_id) REFERENCES participant_verifications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
