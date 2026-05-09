CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  host_token VARCHAR(64) NOT NULL,
  password VARCHAR(120) NULL,
  lobby_enabled TINYINT(1) NOT NULL DEFAULT 0,
  host_only_video TINYINT(1) NOT NULL DEFAULT 0,
  allow_screen_share TINYINT(1) NOT NULL DEFAULT 0,
  chat_locked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  INDEX idx_created (created_at)
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
