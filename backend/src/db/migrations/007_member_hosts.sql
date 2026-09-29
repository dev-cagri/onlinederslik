-- Toplantı yöneticisi üyeler: tüm toplantılara host yetkisiyle girer (yönetim paneline erişemez).
-- Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/007_member_hosts.sql
ALTER TABLE members ADD COLUMN is_host TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- Yalnız belirli bir toplantının yöneticisi yapılan üyeler (toplantı sırasında host atar)
CREATE TABLE IF NOT EXISTS room_hosts (
  room_id VARCHAR(40) NOT NULL,
  member_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, member_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
