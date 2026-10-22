-- Conversations de groupe. Les messages de groupe vivent dans la table messages (group_id,
-- receiver_id NULL) pour partager vocaux, pièces jointes, suppression et purge 30 jours.
-- Seul le propriétaire (owner_id) ajoute des participants, transfère la propriété ou supprime
-- le groupe. Non-lus : chaque membre retient le dernier message lu (last_read_message_id).
CREATE TABLE IF NOT EXISTS message_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  owner_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS message_group_members (
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  last_read_message_id INT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES message_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE messages
  MODIFY receiver_id INT NULL,
  ADD COLUMN group_id INT NULL AFTER receiver_id,
  ADD CONSTRAINT fk_messages_group FOREIGN KEY (group_id) REFERENCES message_groups(id) ON DELETE CASCADE,
  ADD INDEX idx_group_messages (group_id, id);
