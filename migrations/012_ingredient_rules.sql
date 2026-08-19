-- Règles de composition entre notes olfactives, rattachées à une note source.
-- Trois types de règles pour le moment :
--   incompatibility : si la note source est choisie, les notes cibles sont interdites.
--   max_dosage      : si la note source est choisie, elle est plafonnée à max_ml
--                      (optionnellement pour une taille de flacon donnée, ex: "30ml").
--   recommendation  : si la note source est choisie, les notes cibles sont suggérées.
-- Le stockage ne fait qu'enregistrer les règles ; leur application lors de la
-- génération d'une formule (Lylo ou autre) reste à brancher séparément.
CREATE TABLE IF NOT EXISTS ingredient_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_ingredient_id INT NOT NULL,
  rule_type ENUM('incompatibility', 'max_dosage', 'recommendation') NOT NULL,
  -- Utilisé uniquement par max_dosage : plafond en ml pour la note source.
  max_ml DECIMAL(5,2),
  -- Utilisé uniquement par max_dosage : restreint la règle à une taille de
  -- flacon précise (ex: "30ml"). NULL = s'applique à toutes les tailles.
  bottle_size VARCHAR(20),
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (source_ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
);

-- Notes cibles d'une règle (utilisé par incompatibility et recommendation ;
-- inutilisé par max_dosage, qui ne porte que sur la note source elle-même).
CREATE TABLE IF NOT EXISTS ingredient_rule_targets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  target_ingredient_id INT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES ingredient_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (target_ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rule_target (rule_id, target_ingredient_id)
);
