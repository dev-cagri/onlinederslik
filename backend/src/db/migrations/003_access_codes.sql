-- Giriş kodları (SMS ve yönetici onayı olmadan üyelik). MySQL 8 / MariaDB; bir kez çalıştırın.
-- Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/003_access_codes.sql
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

ALTER TABLE members MODIFY phone VARCHAR(16) NULL;
ALTER TABLE members ADD COLUMN access_code_id INT NULL AFTER phone,
  ADD CONSTRAINT fk_members_access_code
  FOREIGN KEY (access_code_id) REFERENCES access_codes(id) ON DELETE SET NULL;
