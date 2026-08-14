-- Table d'ingrédients partagée entre tous les projets (initialement utilisée par Lylo).
CREATE TABLE IF NOT EXISTS ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('top', 'heart', 'base') NOT NULL,
  category VARCHAR(255),
  language VARCHAR(10) NOT NULL DEFAULT 'fr',
  description TEXT,
  intensity VARCHAR(50),
  allergens JSON,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
