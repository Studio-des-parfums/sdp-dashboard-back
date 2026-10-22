-- Appel visio (Daily) annoncé par un message : URL de la salle privée. L'accès passe par un
-- jeton délivré par le serveur aux seuls membres de la conversation (voir routes/messages.ts).
ALTER TABLE messages ADD COLUMN call_url VARCHAR(255) NULL AFTER attachment_size;
