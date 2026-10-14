-- Filtre d'une option par atelier, en plus du filtre par coffret existant (option_coffrets).
-- Même modèle : une option sans ligne dans option_ateliers est disponible pour tous les
-- ateliers ; une option avec des lignes n'est disponible que pour ceux listés. Les deux
-- filtres (coffret et atelier) se combinent en ET côté requête.
CREATE TABLE IF NOT EXISTS option_ateliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  option_id INT NOT NULL,
  atelier_id INT NOT NULL,
  FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
  FOREIGN KEY (atelier_id) REFERENCES ateliers(id) ON DELETE CASCADE,
  UNIQUE KEY uq_option_atelier (option_id, atelier_id)
);
