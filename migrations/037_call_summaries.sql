-- Compte rendu IA d'un appel visio : message posté dans la conversation, rattaché à l'appel
-- (summary_for_call = call_url de l'appel), avec le contenu structuré (résumé, décisions, actions).
ALTER TABLE messages
  ADD COLUMN summary_for_call VARCHAR(255) NULL AFTER call_url,
  ADD COLUMN call_summary JSON NULL AFTER summary_for_call;
