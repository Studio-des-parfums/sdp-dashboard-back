-- Image illustrant l'atelier (URL publique S3, préfixe ateliers/ du bucket
-- partagé avec sdp-ocr-back — voir server/services/s3.ts).
ALTER TABLE ateliers ADD COLUMN image_url VARCHAR(500) AFTER description;
