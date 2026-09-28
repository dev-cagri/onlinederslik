-- Mevcut veritabanlarını yönetici sistemine yükseltir (yeni kurulumda schema.sql yeterli).
-- MariaDB 10.5+ sözdizimi (IF NOT EXISTS). Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/001_admins.sql
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin (admin_id),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS created_by INT NULL AFTER chat_locked;
ALTER TABLE rooms ADD CONSTRAINT fk_rooms_created_by
  FOREIGN KEY IF NOT EXISTS (created_by) REFERENCES admins(id) ON DELETE SET NULL;
