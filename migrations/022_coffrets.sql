-- Les coffrets deviennent une vraie table (au lieu du tag libre `ingredients.box_sets`)
-- pour pouvoir être référencés par d'autres entités (ex: ateliers). Même modèle
-- que ingredients/ingredient_translations : nom traduit par langue.
CREATE TABLE IF NOT EXISTS coffrets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coffret_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coffret_id INT NOT NULL,
  language VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  FOREIGN KEY (coffret_id) REFERENCES coffrets(id) ON DELETE CASCADE,
  UNIQUE KEY uq_coffret_language (coffret_id, language)
);

-- Remplace ingredients.box_sets (JSON de noms libres) par une vraie relation
-- many-to-many vers coffrets. Peuplée par server/scripts/migrate-box-sets-to-coffrets.ts
-- à partir des données existantes ; box_sets est retiré par ce script une fois
-- la migration de données vérifiée (pas dans ce fichier, pour ne pas perdre de
-- données si le script échoue avant d'avoir tout recopié).
CREATE TABLE IF NOT EXISTS ingredient_coffrets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT NOT NULL,
  coffret_id INT NOT NULL,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
  FOREIGN KEY (coffret_id) REFERENCES coffrets(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ingredient_coffret (ingredient_id, coffret_id)
);
