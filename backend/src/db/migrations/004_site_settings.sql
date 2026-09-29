-- Site ayarları (yüklenebilir logo). Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/004_site_settings.sql
CREATE TABLE IF NOT EXISTS site_settings (
  name VARCHAR(64) PRIMARY KEY,
  value TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
