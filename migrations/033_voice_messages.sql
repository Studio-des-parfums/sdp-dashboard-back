-- Messages vocaux : fichier audio privé sur S3 (préfixe messages/voice/, lu via URL pré-signée)
-- et durée en secondes (les enregistrements webm du navigateur n'ont pas de durée lisible).
-- content garde un libellé ("🎤 Message vocal") pour les aperçus (liste, toasts).
ALTER TABLE messages
  ADD COLUMN audio_key VARCHAR(500) NULL AFTER content,
  ADD COLUMN audio_duration INT NULL AFTER audio_key;
