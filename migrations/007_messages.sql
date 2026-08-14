CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_conversation (sender_id, receiver_id, created_at),
  INDEX idx_receiver_unread (receiver_id, is_read)
);

ALTER TABLE notifications
  MODIFY COLUMN type ENUM('ticket_status_change', 'new_message') NOT NULL DEFAULT 'ticket_status_change';

ALTER TABLE notifications
  ADD COLUMN message_id INT NULL AFTER ticket_id,
  ADD FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
