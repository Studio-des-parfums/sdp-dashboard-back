-- Une note olfactive n'est plus dupliquée par langue : `ingredients` porte les
-- champs communs (type, catégorie, description, intensité, allergènes, coffrets,
-- statut), et chaque nom traduit vit dans `ingredient_translations`
-- (une ligne par langue, extensible à de nouvelles langues sans migration).
CREATE TABLE IF NOT EXISTS ingredient_translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT NOT NULL,
  language VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ingredient_language (ingredient_id, language)
);
