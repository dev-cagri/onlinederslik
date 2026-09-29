-- Host toplantı ayarları: katılımcı mikrofon/kamera/tepki izinleri, toplantıyı kilitleme ve link ömrü.
-- Çalıştırma: mysql -u <kullanıcı> -p <veritabanı> < src/db/migrations/005_room_controls.sql
ALTER TABLE rooms
  ADD COLUMN allow_mic TINYINT(1) NOT NULL DEFAULT 1 AFTER allow_screen_share,
  ADD COLUMN allow_camera TINYINT(1) NOT NULL DEFAULT 1 AFTER allow_mic,
  ADD COLUMN allow_reactions TINYINT(1) NOT NULL DEFAULT 1 AFTER allow_camera,
  ADD COLUMN room_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER chat_locked,
  ADD COLUMN expires_at TIMESTAMP NULL AFTER created_at;
