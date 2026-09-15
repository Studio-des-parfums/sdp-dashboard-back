-- Ateliers organisés par l'entreprise, chacun rattaché à un coffret précis
-- (un atelier = un seul coffret). Suppression du coffret bloquée (RESTRICT)
-- tant qu'un atelier y est rattaché, pour éviter une perte de données silencieuse.
CREATE TABLE IF NOT EXISTS ateliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coffret_id INT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (coffret_id) REFERENCES coffrets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS atelier_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  atelier_id INT NOT NULL,
  language VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  FOREIGN KEY (atelier_id) REFERENCES ateliers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_atelier_language (atelier_id, language)
);
