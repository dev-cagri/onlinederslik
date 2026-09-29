-- Oda bazlı kimlik doğrulamasından (TC + SMS + konum) üyelik sistemine geçiş.
-- DİKKAT: eski doğrulama kayıtları (TC, telefon, konum) kalıcı olarak silinir.
-- Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/002_members.sql
DROP TABLE IF EXISTS otp_sends;
DROP TABLE IF EXISTS participant_verifications;

-- Katılımcı üyeleri: telefon + SMS koduyla giriş yapar, ilk girişte ad/soyad girer.
-- Derse yalnız yöneticinin onayladığı (status = 'approved') üyeler girebilir.
-- registered_at NULL → SMS doğrulandı ama ad/soyad henüz girilmedi (24 saatte temizlenir).
CREATE TABLE IF NOT EXISTS members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(16) NOT NULL UNIQUE,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
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
  FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL
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
