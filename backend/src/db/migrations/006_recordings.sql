-- Sunucu tarafı kayıtlar: toplantı silinse de kayıt kalır (Kayıtlar bölümünden yönetilir),
-- durdurulup dosyası kapanan kayıt için 'processing' durumu.
-- Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/006_recordings.sql
ALTER TABLE recordings DROP FOREIGN KEY recordings_ibfk_1;
ALTER TABLE recordings
  MODIFY room_id VARCHAR(40) NULL,
  MODIFY status ENUM('starting','active','processing','completed','failed','aborted') NOT NULL,
  ADD COLUMN room_name VARCHAR(255) NULL AFTER room_id,
  ADD CONSTRAINT fk_recordings_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
UPDATE recordings rec JOIN rooms r ON r.id = rec.room_id SET rec.room_name = r.name;
