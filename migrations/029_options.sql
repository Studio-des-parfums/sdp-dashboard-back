-- Options du parfum (ex: Ruban, Champagne, Flacon murano) : plusieurs sélectionnables à la
-- fois côté client, non liées à un coffret précis par défaut. Même modèle que
-- ingredients/ingredient_coffrets : une option sans ligne dans option_coffrets est disponible
-- pour tous les coffrets ; une option avec des lignes n'est disponible que pour ceux listés.
CREATE TABLE IF NOT EXISTS options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  description TEXT,
  image_url VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS option_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  option_id INT NOT NULL,
  language VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
  UNIQUE KEY uq_option_language (option_id, language)
);

CREATE TABLE IF NOT EXISTS option_coffrets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  option_id INT NOT NULL,
  coffret_id INT NOT NULL,
  FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
  FOREIGN KEY (coffret_id) REFERENCES coffrets(id) ON DELETE CASCADE,
  UNIQUE KEY uq_option_coffret (option_id, coffret_id)
);
