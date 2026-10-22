-- Pièce jointe d'un message (image ou PDF) : fichier privé sur S3 (préfixe messages/files/,
-- lu via URL pré-signée). content garde la légende saisie, ou un libellé ("📷 Image", "📄 nom.pdf")
-- pour les aperçus (liste des conversations, toasts).
ALTER TABLE messages
  ADD COLUMN attachment_key VARCHAR(500) NULL AFTER audio_duration,
  ADD COLUMN attachment_name VARCHAR(255) NULL AFTER attachment_key,
  ADD COLUMN attachment_type VARCHAR(150) NULL AFTER attachment_name,
  ADD COLUMN attachment_size INT NULL AFTER attachment_type;
